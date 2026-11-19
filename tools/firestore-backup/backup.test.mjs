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
