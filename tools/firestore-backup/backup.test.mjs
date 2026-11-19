// LOCAL ONLY (Firestore EMULATOR, demo- projects): backup -> encrypted file -> restore into another demo project ->
// verify. Run: firebase emulators:exec --only firestore --project demo-backup-src "node --test tools/firestore-backup/backup.test.mjs"
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, restore, verify, client, decrypt, docHash } from './backup.mjs';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const SRC = 'demo-backup-src';
const DST = 'demo-backup-dst';
const PASS = 'test-only-passphrase-0123456789';
const dir = mkdtempSync(join(tmpdir(), 'fsbk-'));
const file = join(dir, 'b.fsbk');

const wipe = (p) => fetch(`http://${EMU}/emulator/v1/projects/${p}/databases/(default)/documents`, { method: 'DELETE' });
async function seed() {
  const c = client({ project: SRC, emulator: EMU, readOnly: false });
  const N = (p) => `${c.root}/${p}`;
  const ts = { timestampValue: '2026-11-19T10:00:00.123456Z' };
  const writes = [
    { update: { name: N('products/p1'), fields: { name: { stringValue: 'دفتر' }, price: { doubleValue: 2.5 }, stock: { integerValue: '10' }, variants: { arrayValue: { values: [{ mapValue: { fields: { id: { stringValue: 'v1' }, stock: { integerValue: '3' } } } }] } } } } },
    { update: { name: N('orders/ORD-1'), fields: { userId: { stringValue: 'u1' }, total: { doubleValue: 8.2 }, createdAt: ts, address: { mapValue: { fields: { phone: { stringValue: '+962790000000' } } } }, note: { nullValue: null } } } },
    { update: { name: N('orderLedger/ORD-1'), fields: { inventory: { stringValue: 'reserved' }, reservations: { arrayValue: { values: [] } }, ref: { referenceValue: N('orders/ORD-1') } } } },
    { update: { name: N('stockReservations/p1'), fields: { product: { integerValue: '2' }, variants: { mapValue: { fields: {} } } } } },
    { update: { name: N('users/u1'), fields: { role: { stringValue: 'customer' }, loc: { geoPointValue: { latitude: 31.95, longitude: 35.93 } }, avatar: { bytesValue: Buffer.from('xyz').toString('base64') } } } },
    { update: { name: N('users/u1/addresses/a1'), fields: { city: { stringValue: 'الزرقاء' } } } }, // sub-collection
    { update: { name: N('legacy/ghost/items/i1'), fields: { x: { booleanValue: true } } } }, // parent with NO document
    { update: { name: N('config/roles'), fields: { ownerUid: { stringValue: 'owner1' } } } },
    { update: { name: N('reviews/p1_u1'), fields: { rating: { integerValue: '5' }, updatedAt: ts } } },
  ];
  // > one page (300): pagination
  for (let i = 0; i < 650; i++) writes.push({ update: { name: N(`bulk/d${String(i).padStart(4, '0')}`), fields: { i: { integerValue: String(i) } } } });
  for (let i = 0; i < writes.length; i += 400) await c.call('POST', `${c.root}:commit`, { writes: writes.slice(i, i + 400) });
  return writes.length;
}

let seeded = 0;
before(async () => {
  assert.ok(/^(127\.0\.0\.1|localhost):\d+$/.test(EMU || ''), 'emulator only');
  await wipe(SRC);
  await wipe(DST);
  seeded = await seed();
});

test('backup reads every collection and sub-collection (also under a parent with no document), > 1 page, all types', async () => {
  const r = await backup({ project: SRC, out: file, emulator: EMU, passphrase: PASS });
  assert.equal(r.documents, seeded);
  assert.equal(r.counts['users/*/addresses'], 1);
  assert.equal(r.counts['legacy/*/items'], 1);
  assert.equal(r.counts.bulk, 650);
  const raw = readFileSync(file);
  assert.ok(!raw.includes(Buffer.from('962790000000')) && !raw.includes(Buffer.from('دفتر')), 'nothing readable in the file');
});

test('restore into ANOTHER demo project + verify: every document identical (types, values, paths)', async () => {
  const r = await restore({ inFile: file, emulator: EMU, project: DST, passphrase: PASS });
  assert.equal(r.documents, seeded);
  const v = await verify({ inFile: file, emulator: EMU, project: DST, passphrase: PASS });
  assert.deepEqual({ ok: v.ok, missing: v.missing, extra: v.extra, changed: v.changed, documents: v.documents }, { ok: true, missing: 0, extra: 0, changed: 0, documents: seeded });
  // spot check of exact types after the round trip
  const c = client({ project: DST, emulator: EMU, readOnly: true });
  const u = await c.call('GET', `${c.root}/users/u1`);
  assert.deepEqual(u.fields.loc, { geoPointValue: { latitude: 31.95, longitude: 35.93 } });
  const o = await c.call('GET', `${c.root}/orders/ORD-1`);
  assert.equal(o.fields.createdAt.timestampValue, '2026-11-19T10:00:00.123456Z');
  assert.deepEqual(o.fields.total, { doubleValue: 8.2 });
});

test('verify detects a changed, a missing and an extra document', async () => {
  const c = client({ project: DST, emulator: EMU, readOnly: false });
  await c.call('POST', `${c.root}:commit`, { writes: [
    { update: { name: `${c.root}/products/p1`, fields: { name: { stringValue: 'changed' } } } },
    { delete: `${c.root}/config/roles` },
    { update: { name: `${c.root}/extra/e1`, fields: {} } },
  ] });
  const v = await verify({ inFile: file, emulator: EMU, project: DST, passphrase: PASS });
  assert.deepEqual({ ok: v.ok, missing: v.missing, extra: v.extra, changed: v.changed }, { ok: false, missing: 1, extra: 1, changed: 1 });
});

test('wrong passphrase / one changed byte -> unreadable; short passphrase refused', async () => {
  assert.throws(() => decrypt(readFileSync(file), 'another-passphrase-000000'), /cannot decrypt/);
  const b = readFileSync(file);
  b[b.length - 5] ^= 1;
  const t = join(dir, 't.fsbk');
  writeFileSync(t, b);
  assert.throws(() => decrypt(readFileSync(t), PASS), /cannot decrypt/);
  await assert.rejects(backup({ project: SRC, out: join(dir, 'x.fsbk'), emulator: EMU, passphrase: 'short' }), /at least 16/);
});

test('guards: no production backup without the typed approval; restore never into a real project or a remote host; no writes in read-only mode', async () => {
  await assert.rejects(backup({ project: 'antastore1-82b50', out: join(dir, 'p.fsbk'), passphrase: PASS }), /PRODUCTION backup refused/);
  await assert.rejects(backup({ project: 'antastore1-82b50', out: join(dir, 'p.fsbk'), ownerApproved: 'other', passphrase: PASS }), /PRODUCTION backup refused/);
  await assert.rejects(restore({ inFile: file, emulator: EMU, project: 'antastore1-82b50', passphrase: PASS }), /demo- project/);
  await assert.rejects(restore({ inFile: file, emulator: 'firestore.googleapis.com:443', project: DST, passphrase: PASS }), /LOOPBACK/);
  await assert.rejects(backup({ project: SRC, out: join(dir, 'y.fsbk'), emulator: 'example.com:8080', passphrase: PASS }), /loopback/);
  const ro = client({ project: SRC, emulator: EMU, readOnly: true });
  await assert.rejects(ro.call('POST', `${ro.root}:commit`, { writes: [] }), /read-only/);
  await assert.rejects(ro.call('PATCH', `${ro.root}/x/y`, { fields: {} }), /read-only/);
  await assert.rejects(ro.call('DELETE', `${ro.root}/x/y`), /read-only/);
});

test('docHash is independent of key order', () => {
  assert.equal(docHash({ a: { integerValue: '1' }, b: { stringValue: 'x' } }), docHash({ b: { stringValue: 'x' }, a: { integerValue: '1' } }));
});

// ---------------- audit additions ----------------
import { seal, unseal, insideGitTree, loadCredentials } from './backup.mjs';
import { existsSync as exists2 } from 'node:fs';
import { spawnSync } from 'node:child_process';

// The EMULATOR does not implement point-in-time reads (probe: list + readTime -> 400 'Only timestamps past epoch',
// runQuery + readTime -> empty), so the snapshot itself is NOT testable locally. What IS tested: the consistency
// check that detects a torn copy, whatever the read mechanism.
test('consistency check: a consistent copy passes; a reservation without its ledger (torn copy) is detected', async () => {
  const c = client({ project: SRC, emulator: EMU, readOnly: false });
  const W = (p, fields) => ({ update: { name: `${c.root}/${p}`, fields } });
  const res = (pid, qty, vid = null) => ({ mapValue: { fields: { productId: { stringValue: pid }, variantId: vid ? { stringValue: vid } : { nullValue: null }, qty: { integerValue: String(qty) } } } });
  // consistent state: two open orders reserving p1 (2 + 1) and variant v1 of p2 (1); one delivered (no longer counted)
  await c.call('POST', `${c.root}:commit`, { writes: [
    W('orderLedger/ORD-1', { inventory: { stringValue: 'reserved' }, reservations: { arrayValue: { values: [res('p1', 2)] } } }),
    W('orders/ORD-2', { total: { doubleValue: 3 } }),
    W('orderLedger/ORD-2', { inventory: { stringValue: 'reserved' }, reservations: { arrayValue: { values: [res('p1', 1), res('p2', 1, 'v1')] } } }),
    W('orders/ORD-3', { total: { doubleValue: 1 } }),
    W('orderLedger/ORD-3', { inventory: { stringValue: 'deducted' }, reservations: { arrayValue: { values: [res('p1', 5)] } } }),
    W('stockReservations/p1', { productId: { stringValue: 'p1' }, product: { integerValue: '3' }, variants: { mapValue: { fields: {} } } }),
    W('stockReservations/p2', { productId: { stringValue: 'p2' }, product: { integerValue: '0' }, variants: { mapValue: { fields: { v1: { integerValue: '1' } } } } }),
  ] });
  const ok = await backup({ project: SRC, out: join(dir, 'cons-ok.fsbk'), emulator: EMU, passphrase: PASS });
  assert.deepEqual(ok.consistency, { consistent: true, ledgers: 3, reservationMismatches: 0, ledgerWithoutOrder: 0 });
  // torn copy: the reservation of a NEW order is read, its ledger (read earlier) is not there
  await c.call('POST', `${c.root}:commit`, { writes: [W('stockReservations/p1', { productId: { stringValue: 'p1' }, product: { integerValue: '4' }, variants: { mapValue: { fields: {} } } })] });
  const torn = await backup({ project: SRC, out: join(dir, 'cons-torn.fsbk'), emulator: EMU, passphrase: PASS });
  assert.equal(torn.consistency.consistent, false);
  assert.equal(torn.consistency.reservationMismatches, 1);
  // a ledger whose (cancelled, released) order was deleted is reported, but is not a torn copy
  await c.call('POST', `${c.root}:commit`, { writes: [W('stockReservations/p1', { productId: { stringValue: 'p1' }, product: { integerValue: '3' }, variants: { mapValue: { fields: {} } } }), W('orderLedger/ORD-9', { inventory: { stringValue: 'released' } })] });
  const info = await backup({ project: SRC, out: join(dir, 'cons-info.fsbk'), emulator: EMU, passphrase: PASS });
  assert.deepEqual({ c: info.consistency.consistent, w: info.consistency.ledgerWithoutOrder }, { c: true, w: 1 });
});

test('production backups pin ONE read moment (readTime) on every request; emulator backups do not (unsupported there)', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return new Response(JSON.stringify(String(url).includes(':listCollectionIds') ? { collectionIds: [] } : {}), { status: 200 }); };
  try {
    const c = client({ project: 'any-project', emulator: '127.0.0.1:1', readOnly: true, readTime: '2026-11-19T10:00:00.000Z' });
    await c.call('POST', `${c.root}:listCollectionIds`, { pageSize: 100 });
    await c.call('GET', `${c.root}/orders?pageSize=300&showMissing=true`);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(seen[0].body.readTime, '2026-11-19T10:00:00.000Z');
  assert.match(seen[1].url, /readTime=2026-11-19T10%3A00%3A00\.000Z/);
});

test('output: never inside a git tree, never overwrites, owner-only permissions', async () => {
  assert.equal(insideGitTree(join(process.cwd(), 'x.fsbk')), true, 'the repository itself');
  await assert.rejects(backup({ project: SRC, out: join(process.cwd(), 'leak.fsbk'), emulator: EMU, passphrase: PASS }), /inside a git working tree/);
  assert.equal(exists2(join(process.cwd(), 'leak.fsbk')), false);
  await assert.rejects(backup({ project: SRC, out: file, emulator: EMU, passphrase: PASS }), /EEXIST/);
  if (process.platform === 'win32') {
    const acl = spawnSync('icacls', [file], { encoding: 'utf8' }).stdout;
    assert.ok(acl.includes(process.env.USERNAME), 'current user has access');
    assert.ok(!/BUILTIN\Users|Everyone|Authenticated Users/i.test(acl), 'no broad group access');
  }
});

test('seal / unseal (e.g. a Firebase Auth export): plaintext overwritten + removed, round trip exact, wrong passphrase fails', async () => {
  const plain = join(dir, 'accounts.json');
  const content = JSON.stringify({ users: [{ localId: 'u1', email: 'x@example.invalid', passwordHash: 'aGFzaA==' }] });
  writeFileSync(plain, content);
  const r = seal({ inFile: plain, out: join(dir, 'accounts.fsbk'), passphrase: PASS });
  assert.equal(r.plaintextRemoved, true);
  assert.equal(exists2(plain), false);
  assert.ok(!readFileSync(join(dir, 'accounts.fsbk')).includes(Buffer.from('x@example.invalid')));
  unseal({ inFile: join(dir, 'accounts.fsbk'), out: join(dir, 'accounts.back.json'), passphrase: PASS });
  assert.equal(readFileSync(join(dir, 'accounts.back.json'), 'utf8'), content);
  assert.throws(() => unseal({ inFile: join(dir, 'accounts.fsbk'), out: join(dir, 'nope.json'), passphrase: 'wrong-passphrase-0000000' }), /cannot decrypt/);
});

test('key file: a non-key / unreadable file is refused without echoing its content', () => {
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ secret: 'TOP-SECRET-VALUE' }));
  assert.throws(() => loadCredentials(bad), (e) => /not a service-account key/.test(e.message) && !e.message.includes('TOP-SECRET'));
  assert.throws(() => loadCredentials(join(dir, 'missing.json')), /cannot read the key file/);
});
