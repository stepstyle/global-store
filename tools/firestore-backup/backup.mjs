#!/usr/bin/env node
// Firestore backup (READ-ONLY) + restore into the LOCAL EMULATOR only + verification. No dependencies.
//
//   backup  : node tools/firestore-backup/backup.mjs backup  --project <id> --out <file.fsbk> [--emulator 127.0.0.1:8080]
//             production (no --emulator) ALSO needs: --owner-approved <id>  (the same project id, typed again)
//             credentials (production only): FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY in the environment
//   restore : node tools/firestore-backup/backup.mjs restore --in <file.fsbk> --emulator 127.0.0.1:8080 --project demo-<name>
//   verify  : node tools/firestore-backup/backup.mjs verify  --in <file.fsbk> --emulator 127.0.0.1:8080 --project demo-<name>
//   both need BACKUP_PASSPHRASE (>= 16 characters) in the environment — never on the command line.
//
// Safety
// - backup sends ONLY reads: GET (list documents) and :listCollectionIds; any other request is refused in code.
// - every collection and sub-collection is DISCOVERED (no fixed list): old / unknown collections are included.
// - documents are kept in Firestore's own typed REST form (timestamps, references, bytes, geo points, doubles vs
//   integers stay exact), plus createTime/updateTime for audit.
// - the output is encrypted (AES-256-GCM, key = scrypt(passphrase, random salt)); a wrong passphrase or one changed
//   byte makes it unreadable. Nothing personal is printed: only collection names and document counts.
// - restore / verify write and read ONLY a loopback emulator and ONLY a demo- project: production can never be written.
import { createSign, randomBytes, scryptSync, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const MAGIC = 'FSBK1';
const PAGE = 300;

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const o = { cmd };
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--')) throw new Error(`unexpected argument: ${rest[i]}`);
    o[rest[i].slice(2)] = rest[i + 1];
  }
  return o;
}

const isLoopback = (h) => /^(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/.test(String(h || ''));

// ------------------------------------------------------------------ encryption
export function encrypt(plain, passphrase) {
  if (!passphrase || passphrase.length < 16) throw new Error('BACKUP_PASSPHRASE must be at least 16 characters');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from(MAGIC), salt, iv, c.getAuthTag(), body]);
}
export function decrypt(buf, passphrase) {
  if (buf.subarray(0, 5).toString() !== MAGIC) throw new Error('not a backup file');
  const salt = buf.subarray(5, 21);
  const iv = buf.subarray(21, 33);
  const tag = buf.subarray(33, 49);
  const key = scryptSync(passphrase || '', salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(buf.subarray(49)), d.final()]);
  } catch {
    throw new Error('cannot decrypt: wrong passphrase or the file was changed');
  }
}

// ------------------------------------------------------------------ REST client
async function serviceAccountToken() {
  const email = process.env.FIREBASE_CLIENT_EMAIL;
  const key = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key.includes('PRIVATE KEY')) throw new Error('FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY missing');
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  if (!r.ok) throw new Error(`token request failed (${r.status})`); // body never printed
  return (await r.json()).access_token;
}

export function client({ project, emulator, readOnly }) {
  const base = emulator ? `http://${emulator}/v1` : 'https://firestore.googleapis.com/v1';
  const root = `projects/${project}/databases/(default)/documents`;
  let token = emulator ? 'owner' : null;
  const call = async (method, path, body) => {
    // read-only mode: only listing documents (GET) and :listCollectionIds may leave this process
    if (readOnly && !(method === 'GET' || (method === 'POST' && path.endsWith(':listCollectionIds')))) {
      throw new Error(`refused: ${method} is not a read (read-only backup)`);
    }
    if (!token) token = await serviceAccountToken();
    const r = await fetch(`${base}/${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${path.split('?')[0].replace(root, '<root>')} failed (${r.status} ${data?.error?.status || ''})`);
    return data;
  };
  return { root, call };
}

async function collectionIds(c, parent) {
  const ids = [];
  let pageToken;
  do {
    const r = await c.call('POST', `${parent}:listCollectionIds`, { pageSize: 100, ...(pageToken ? { pageToken } : {}) });
    ids.push(...(r?.collectionIds || []));
    pageToken = r?.nextPageToken;
  } while (pageToken);
  return ids.sort();
}

/** every document of every collection and sub-collection under `parent` (depth-first) */
async function* walk(c, parent) {
  for (const id of await collectionIds(c, parent)) {
    let pageToken;
    do {
      // showMissing: also lists "phantom" parents (no fields, only sub-collections) so their children are found
      const r = await c.call('GET', `${parent}/${encodeURIComponent(id)}?pageSize=${PAGE}&showMissing=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      for (const d of r?.documents || []) {
        if (d.fields || d.createTime) yield d;
        yield* walk(c, d.name); // its sub-collections (the full document name is the parent)
      }
      pageToken = r?.nextPageToken;
    } while (pageToken);
  }
}

const relPath = (name) => name.slice(name.indexOf('/documents/') + '/documents/'.length);
/** stable hash of a document's typed fields (key order normalised) */
export function docHash(fields) {
  const norm = (v) => (Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v);
  return createHash('sha256').update(JSON.stringify(norm(fields || {}))).digest('hex');
}
const countsOf = (docs) => {
  const m = {};
  for (const d of docs) {
    const parts = d.path.split('/');
    const coll = parts.filter((_, i) => i % 2 === 0).join('/*/'); // e.g. users/*/addresses
    m[coll] = (m[coll] || 0) + 1;
  }
  return m;
};

// ------------------------------------------------------------------ commands
export async function backup({ project, out, emulator, ownerApproved, passphrase }) {
  if (!project || !out) throw new Error('backup needs --project and --out');
  if (emulator && !isLoopback(emulator)) throw new Error('--emulator must be a loopback host:port');
  if (!emulator && ownerApproved !== project) {
    throw new Error('PRODUCTION backup refused: add --owner-approved <the same project id> (only with the owner\'s explicit approval)');
  }
  const c = client({ project, emulator, readOnly: true });
  const docs = [];
  for await (const d of walk(c, c.root)) docs.push({ path: relPath(d.name), fields: d.fields || {}, createTime: d.createTime, updateTime: d.updateTime, hash: docHash(d.fields) });
  const payload = { format: MAGIC, project, source: emulator ? 'emulator' : 'production', takenAt: new Date().toISOString(), counts: countsOf(docs), docs };
  writeFileSync(out, encrypt(Buffer.from(JSON.stringify(payload)), passphrase));
  return { documents: docs.length, counts: payload.counts };
}

function loadBackup(file, passphrase) {
  const p = JSON.parse(decrypt(readFileSync(file), passphrase).toString('utf8'));
  for (const d of p.docs) if (docHash(d.fields) !== d.hash) throw new Error(`backup content hash mismatch in ${d.path.split('/')[0]}`);
  return p;
}
function emulatorTarget(emulator, project) {
  if (!isLoopback(emulator)) throw new Error('restore/verify only into a LOOPBACK emulator (--emulator 127.0.0.1:<port>)');
  if (!/^demo-[a-z0-9-]+$/.test(String(project || ''))) throw new Error('restore/verify only into a demo- project (never a real project)');
  return client({ project, emulator, readOnly: false });
}

export async function restore({ inFile, emulator, project, passphrase }) {
  const p = loadBackup(inFile, passphrase);
  const c = emulatorTarget(emulator, project);
  for (let i = 0; i < p.docs.length; i += 400) {
    const writes = p.docs.slice(i, i + 400).map((d) => ({ update: { name: `${c.root}/${d.path}`, fields: d.fields } }));
    await c.call('POST', `${c.root}:commit`, { writes });
  }
  return { documents: p.docs.length, counts: p.counts };
}

export async function verify({ inFile, emulator, project, passphrase }) {
  const p = loadBackup(inFile, passphrase);
  const c = emulatorTarget(emulator, project);
  const found = [];
  for await (const d of walk(c, c.root)) found.push({ path: relPath(d.name), hash: docHash(d.fields) });
  const want = new Map(p.docs.map((d) => [d.path, d.hash]));
  const got = new Map(found.map((d) => [d.path, d.hash]));
  const missing = [...want.keys()].filter((k) => !got.has(k)).length;
  const extra = [...got.keys()].filter((k) => !want.has(k)).length;
  const changed = [...want.keys()].filter((k) => got.has(k) && got.get(k) !== want.get(k)).length;
  return { ok: missing === 0 && extra === 0 && changed === 0, documents: found.length, expected: p.docs.length, missing, extra, changed, counts: countsOf(found) };
}

// ------------------------------------------------------------------ CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const passphrase = process.env.BACKUP_PASSPHRASE;
  const run = { backup: () => backup({ project: a.project, out: a.out, emulator: a.emulator, ownerApproved: a['owner-approved'], passphrase }), restore: () => restore({ inFile: a.in, emulator: a.emulator, project: a.project, passphrase }), verify: () => verify({ inFile: a.in, emulator: a.emulator, project: a.project, passphrase }) }[a.cmd];
  if (!run) {
    console.error('usage: backup.mjs backup|restore|verify … (see the header of this file)');
    process.exit(2);
  }
  run().then((r) => { console.log(JSON.stringify(r, null, 2)); if (r.ok === false) process.exit(1); }).catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
