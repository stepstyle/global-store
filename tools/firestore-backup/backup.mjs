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
import { readFileSync, writeFileSync, existsSync, unlinkSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
/** credentials: a service-account KEY FILE (recommended: a dedicated "Cloud Datastore Viewer" account), else env vars.
 *  Only client_email + private_key are used; nothing from the file is ever printed. */
export function loadCredentials(keyFile) {
  if (keyFile) {
    let j;
    try {
      j = JSON.parse(readFileSync(keyFile, 'utf8'));
    } catch {
      throw new Error('cannot read the key file (path or JSON)');
    }
    if (!j.client_email || !String(j.private_key || '').includes('PRIVATE KEY')) throw new Error('the key file is not a service-account key');
    return { email: j.client_email, key: j.private_key };
  }
  return { email: process.env.FIREBASE_CLIENT_EMAIL, key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n') };
}

async function serviceAccountToken(creds) {
  const { email, key } = creds || {};
  if (!email || !String(key || '').includes('PRIVATE KEY')) throw new Error('no credentials: --key-file <service-account.json> (or FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)');
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

export function client({ project, emulator, readOnly, readTime = null, creds = null }) {
  const base = emulator ? `http://${emulator}/v1` : 'https://firestore.googleapis.com/v1';
  const root = `projects/${project}/databases/(default)/documents`;
  let token = emulator ? 'owner' : null;
  const call = async (method, path, body) => {
    // read-only mode: only listing documents (GET) and :listCollectionIds may leave this process
    if (readOnly && !(method === 'GET' || (method === 'POST' && path.endsWith(':listCollectionIds')))) {
      throw new Error(`refused: ${method} is not a read (read-only backup)`);
    }
    // ONE moment for every read (point-in-time): documents written or changed during the backup are seen as they
    // were at readTime — orders, orderLedger and stockReservations stay consistent with each other
    if (readTime) {
      if (method === 'GET') path += `${path.includes('?') ? '&' : '?'}readTime=${encodeURIComponent(readTime)}`;
      else if (body) body = { ...body, readTime };
    }
    if (!token) token = await serviceAccountToken(creds);
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
/** the backup file must never land in a git working tree (it could be committed) */
export function insideGitTree(file) {
  let d = dirname(resolve(file));
  for (;;) {
    if (existsSync(join(d, '.git'))) return true;
    const up = dirname(d);
    if (up === d) return false;
    d = up;
  }
}
/** owner-only file permissions (Windows ACL: current user only; elsewhere 0600) */
export function restrictFile(file) {
  if (process.platform === 'win32') {
    const r = spawnSync('icacls', [file, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:(R,W)`], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error('could not restrict the file permissions (icacls)');
  } else chmodSync(file, 0o600);
}
function writeSecret(out, buf) {
  if (insideGitTree(out)) throw new Error('refused: --out is inside a git working tree (choose a folder outside every repository)');
  writeFileSync(out, buf, { flag: 'wx' }); // never overwrite an existing backup
  restrictFile(out);
}

export async function backup({ project, out, emulator, ownerApproved, passphrase, keyFile = null, readTime = null }) {
  if (!project || !out) throw new Error('backup needs --project and --out');
  if (!passphrase || passphrase.length < 16) throw new Error('BACKUP_PASSPHRASE must be at least 16 characters');
  if (emulator && !isLoopback(emulator)) throw new Error('--emulator must be a loopback host:port');
  if (!emulator && ownerApproved !== project) {
    throw new Error('PRODUCTION backup refused: add --owner-approved <the same project id> (only with the owner\'s explicit approval)');
  }
  if (insideGitTree(out)) throw new Error('refused: --out is inside a git working tree (choose a folder outside every repository)');
  // ONE point in time for the whole backup (Firestore keeps versions for 1 hour): 2 s in the past, so the moment is
  // already committed everywhere. A backup that takes longer than ~55 minutes fails instead of mixing moments.
  // The local EMULATOR does not implement point-in-time reads (list + readTime -> 400), so an emulator backup reads
  // "now"; the consistency check below covers both cases.
  const at = readTime || (emulator ? null : new Date(Date.now() - 2_000).toISOString());
  const started = Date.now();
  const c = client({ project, emulator, readOnly: true, readTime: at, creds: emulator ? null : loadCredentials(keyFile) });
  const docs = [];
  for await (const d of walk(c, c.root)) {
    if (Date.now() - started > 55 * 60_000) throw new Error('backup took longer than 55 minutes: the point-in-time read would expire — nothing written');
    docs.push({ path: relPath(d.name), fields: d.fields || {}, createTime: d.createTime, updateTime: d.updateTime, hash: docHash(d.fields) });
  }
  const consistency = checkConsistency(docs);
  const payload = { format: MAGIC, project, source: emulator ? 'emulator' : 'production', readTime: at, takenAt: new Date().toISOString(), counts: countsOf(docs), consistency, docs };
  writeSecret(out, encrypt(Buffer.from(JSON.stringify(payload)), passphrase));
  return { documents: docs.length, readTime: at, counts: payload.counts, consistency };
}

// ------------------------------------------------------------------ consistency (orders / orderLedger / stockReservations)
const raw = (v) => {
  if (!v || typeof v !== 'object') return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, raw(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(raw);
  return null;
};
/**
 * Business invariants that a torn copy (an order arriving while the collections are read one after another) breaks:
 *  - stockReservations == the sum of the reservations of the ledgers still 'reserved' (per product / variant)
 *  - (informational) every orderLedger has its orders/ document
 * Counts only (no order ids, no personal data). Not consistent -> take the backup again at a quiet moment.
 */
export function checkConsistency(docs) {
  const top = (d) => d.path.split('/');
  const want = new Map();
  let ledgers = 0;
  let ledgerWithoutOrder = 0;
  const orders = new Set(docs.filter((d) => top(d)[0] === 'orders' && top(d).length === 2).map((d) => top(d)[1]));
  for (const d of docs) {
    const [coll, id, sub] = top(d);
    if (coll !== 'orderLedger' || sub) continue;
    ledgers += 1;
    if (!orders.has(id)) ledgerWithoutOrder += 1;
    if (raw(d.fields.inventory) !== 'reserved') continue;
    for (const r of raw(d.fields.reservations) || []) {
      const k = `${r?.productId}\u0000${r?.variantId || ''}`;
      want.set(k, (want.get(k) || 0) + (Number(r?.qty) || 0));
    }
  }
  const have = new Map();
  for (const d of docs) {
    const [coll, pid, sub] = top(d);
    if (coll !== 'stockReservations' || sub) continue;
    const f = raw({ mapValue: { fields: d.fields } });
    if (Number(f.product) > 0) have.set(`${pid}\u0000`, Number(f.product));
    for (const [vid, q] of Object.entries(f.variants || {})) if (Number(q) > 0) have.set(`${pid}\u0000${vid}`, Number(q));
  }
  let reservationMismatches = 0;
  for (const k of new Set([...want.keys(), ...have.keys()])) if ((want.get(k) || 0) !== (have.get(k) || 0)) reservationMismatches += 1;
  // reservations and ledgers are written in ONE commit by the Worker -> a mismatch means a torn copy.
  // ledgerWithoutOrder is informational: the owner may delete a cancelled (released) order and keep its ledger.
  return { consistent: reservationMismatches === 0, ledgers, reservationMismatches, ledgerWithoutOrder };
}

/** encrypt any file (e.g. a Firebase Auth export) with the same scheme, then overwrite + delete the plaintext */
export function seal({ inFile, out, passphrase }) {
  const plain = readFileSync(inFile);
  writeSecret(out, encrypt(plain, passphrase));
  decrypt(readFileSync(out), passphrase); // proven readable before the plaintext goes
  writeFileSync(inFile, randomBytes(plain.length));
  unlinkSync(inFile);
  return { sealed: out, bytes: plain.length, plaintextRemoved: !existsSync(inFile) };
}
/** decrypt a sealed file to an owner-only file OUTSIDE git (for a local import test only) */
export function unseal({ inFile, out, passphrase }) {
  writeSecret(out, decrypt(readFileSync(inFile), passphrase));
  return { unsealed: out };
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
  const run = {
    backup: () => backup({ project: a.project, out: a.out, emulator: a.emulator, ownerApproved: a['owner-approved'], passphrase, keyFile: a['key-file'] }),
    restore: () => restore({ inFile: a.in, emulator: a.emulator, project: a.project, passphrase }),
    verify: () => verify({ inFile: a.in, emulator: a.emulator, project: a.project, passphrase }),
    seal: async () => seal({ inFile: a.in, out: a.out, passphrase }),
    unseal: async () => unseal({ inFile: a.in, out: a.out, passphrase }),
  }[a.cmd];
  if (!run) {
    console.error('usage: backup.mjs backup|restore|verify … (see the header of this file)');
    process.exit(2);
  }
  run().then((r) => { console.log(JSON.stringify(r, null, 2)); if (r.ok === false) process.exit(1); }).catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
