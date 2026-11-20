// Dashboard side of STOCK_POLICY=on_acceptance (pure): such an order is Worker-managed (its status goes through the
// Worker, never written from the browser), its stock label says "deducted when ACCEPTED", and the Worker's
// APPROVAL_PENDING refusal has a clear Arabic message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWorkerManaged, inventoryState, inventoryLabelAr, canCancel, messageFor, INVENTORY_LABEL_AR } from '../../src/services/adminOrders.ts';

const acc = (state, status = 'processing') => ({ status, inventory: { policy: 'on_acceptance', state } });

test('on_acceptance orders are Worker-managed like on_delivery ones; old orders are not', () => {
  assert.equal(isWorkerManaged(acc('deducted')), true);
  assert.equal(isWorkerManaged({ inventory: { policy: 'on_delivery', state: 'reserved' } }), true);
  assert.equal(isWorkerManaged({ status: 'new' }), false);
  assert.equal(isWorkerManaged({ inventory: { policy: 'something_else' } }), false);
  assert.equal(inventoryState(acc('reserved', 'new')), 'reserved');
});

test('stock label: "deducted when the order was ACCEPTED" for on_acceptance; the delivery label stays for on_delivery', () => {
  assert.match(inventoryLabelAr(acc('deducted')), /عند قبول الطلب/);
  assert.match(inventoryLabelAr(acc('reserved', 'new')), /تُخصم عند قبول الطلب/);
  assert.match(inventoryLabelAr(acc('restocked', 'cancelled')), /أُعيدت الكمية/);
  assert.equal(inventoryLabelAr({ inventory: { policy: 'on_delivery', state: 'deducted' } }), INVENTORY_LABEL_AR.deducted);
  assert.equal(inventoryLabelAr({ status: 'new' }), '');
});

test('cancel rules unchanged: a delivered Worker order only as a return; the APPROVAL_PENDING refusal is explained', () => {
  assert.equal(canCancel(acc('deducted', 'delivered')), true);
  assert.equal(canCancel(acc('restocked', 'cancelled')), false);
  assert.match(messageFor('APPROVAL_PENDING'), /بانتظار القبول[\s\S]*يُخصم المخزون عند القبول/);
});
