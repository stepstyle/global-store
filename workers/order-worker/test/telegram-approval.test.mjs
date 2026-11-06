import test from 'node:test';
import assert from 'node:assert/strict';
import { decideOrder } from '../src/approval.js';
import { encodeFields, decodeFields } from '../src/firestore.js';

const ID = 'ORD-ABCD-1234';
function fixture(stock = 5) {
  const records = new Map();
  let seq = 0;
  function put(path, obj) { records.set(path, { exists: true, fields: encodeFields(obj), updateTime: String(++seq) }); }
  put('orders/' + ID, { id: ID, status: 'new', items: [{ productId: 'p1', quantity: 2 }] });
  put('orderLedger/' + ID, { orderId: ID, inventoryWorkflow: 'approval-v1', stockDecision: 'pending' });
  put('products/p1', { name: 'test', price: 2, stock });
  let commits = 0;
  const fs = {
    name: (p) => p,
    async batchGet(paths) { return paths.map(p => records.get(p) || { exists: false }); },
    async commit(writes) {
      for (const w of writes) {
        const prev = records.get(w.update.name);
        if (!prev || prev.updateTime !== w.currentDocument?.updateTime) return { ok: false, data: { error: { status: 'FAILED_PRECONDITION' } } };
      }
      for (const w of writes) {
        const prev = records.get(w.update.name);
        const fields = { ...prev.fields };
        for (const k of w.updateMask.fieldPaths) fields[k] = w.update.fields[k];
        records.set(w.update.name, { exists: true, fields, updateTime: String(++seq) });
      }
      commits++;
      return { ok: true };
    },
  };
  const read = (p) => decodeFields(records.get(p).fields);
  return { fs, read, commits: () => commits };
}
test('accept deducts exactly once on repeated request', async () => {
  const t = fixture();
  const first = await decideOrder(t.fs, ID, 'accept');
  assert.equal(first.code, 'DECIDED');
  assert.equal(t.read('products/p1').stock, 3);
  assert.equal(t.read('orders/' + ID).status, 'processing');
  const again = await decideOrder(t.fs, ID, 'accept');
  assert.equal(again.code, 'ALREADY_DECIDED');
  assert.equal(t.read('products/p1').stock, 3);
  assert.equal(t.commits(), 1);
});
test('reject keeps inventory unchanged', async () => {
  const t = fixture();
  assert.equal((await decideOrder(t.fs, ID, 'reject')).code, 'DECIDED');
  assert.equal(t.read('products/p1').stock, 5);
  assert.equal(t.read('orders/' + ID).status, 'cancelled');
});
test('insufficient inventory leaves order new and records no decision', async () => {
  const t = fixture(1);
  assert.equal((await decideOrder(t.fs, ID, 'accept')).code, 'INSUFFICIENT_STOCK');
  assert.equal(t.read('products/p1').stock, 1);
  assert.equal(t.read('orders/' + ID).status, 'new');
  assert.equal(t.read('orderLedger/' + ID).stockDecision, 'pending');
  assert.equal(t.commits(), 0);
});
test('legacy orders are not inadvertently charged twice', async () => {
  const t = fixture();
  const ledger = t.read('orderLedger/' + ID);
  delete ledger.inventoryWorkflow;
  const prior = t.fs.batchGet;
  t.fs.batchGet = async paths => (await prior(paths)).map((doc, i) => paths[i] === 'orderLedger/' + ID ? { ...doc, fields: encodeFields(ledger) } : doc);
  assert.equal((await decideOrder(t.fs, ID, 'accept')).code, 'LEGACY_ORDER');
  assert.equal(t.read('products/p1').stock, 5);
});
