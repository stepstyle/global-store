// Telegram-only decision: stock changes exactly once, in the same Firestore commit as the order status.
// Never trust the callback payload for quantities or customer data.
import { decodeFields, encodeFields, isConflict } from './firestore.js';
import { planInventory } from './inventory.js';
import { ORDER_ID_RE } from './validate.js';

const INVALID_STOCK = new Set(['PRODUCT_NOT_FOUND','VARIANT_NOT_FOUND','DUPLICATE_VARIANT_ID','AMBIGUOUS_VARIANT','STOCK_UNTRACKED','STOCK_SHORTFALL']);

export async function decideOrder(fs, orderId, action) {
  if (!ORDER_ID_RE.test(orderId) || !['accept','reject'].includes(action)) return { ok: false, code: 'INVALID_ACTION' };
  for (let attempt = 0; attempt < 5; attempt++) {
    const [orderDoc, ledgerDoc] = await fs.batchGet([`orders/${orderId}`, `orderLedger/${orderId}`]);
    if (!orderDoc.exists || !ledgerDoc.exists) return { ok: false, code: 'ORDER_NOT_FOUND' };
    const order = decodeFields(orderDoc.fields);
    const ledger = decodeFields(ledgerDoc.fields);
    if (ledger.stockDecision === 'accepted' || ledger.stockDecision === 'rejected') {
      return { ok: true, code: 'ALREADY_DECIDED', decision: ledger.stockDecision };
    }
    // Do not retroactively decide orders from the old inventory-on-create workflow.
    if (ledger.inventoryWorkflow !== 'approval-v1') return { ok: false, code: 'LEGACY_ORDER' };
    if (order.status !== 'new') return { ok: false, code: 'STATUS_CHANGED' };
    let stockWrites = [];
    let deductions = [];
    if (action === 'accept') {
      const items = Array.isArray(order.items) ? order.items : [];
      if (!items.length || items.length > 30) return { ok: false, code: 'INVALID_ITEMS' };
      const lines = items.map((it, index) => ({
        index, productId: it.productId, variantId: it.selectedVariant?.id || null, quantity: Number(it.quantity),
      }));
      if (lines.some((l) => typeof l.productId !== 'string' || !l.productId || l.productId.includes('/') || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 99)) {
        return { ok: false, code: 'INVALID_ITEMS' };
      }
      const pids = [...new Set(lines.map((l) => l.productId))];
      const docs = await fs.batchGet(pids.map((id) => `products/${id}`));
      const inventory = planInventory(lines, new Map(pids.map((id, i) => [id, docs[i]])), 'apply');
      if (inventory.warnings.some((w) => INVALID_STOCK.has(w.code)) || inventory.deductions.length !== lines.length || inventory.writes.length === 0) {
        return { ok: false, code: 'INSUFFICIENT_STOCK', warnings: inventory.warnings.map((w) => w.code) };
      }
      stockWrites = inventory.writes;
      deductions = inventory.deductions;
    }
    const decision = action === 'accept' ? 'accepted' : 'rejected';
    const writes = [
      {
        update: { name: fs.name(`orderLedger/${orderId}`), fields: encodeFields({
          stockDecision: decision, stockDeductions: deductions, stockApplied: action === 'accept',
        }) },
        updateMask: { fieldPaths: ['stockDecision', 'stockDeductions', 'stockApplied'] },
        currentDocument: { updateTime: ledgerDoc.updateTime },
      },
      {
        update: { name: fs.name(`orders/${orderId}`), fields: encodeFields({
          status: action === 'accept' ? 'processing' : 'cancelled',
        }) },
        updateMask: { fieldPaths: ['status'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { updateTime: orderDoc.updateTime },
      },
      ...stockWrites.map((w) => ({
        update: { name: fs.name(`products/${w.productId}`), fields: w.fields },
        updateMask: { fieldPaths: w.mask },
        currentDocument: { updateTime: w.updateTime },
      })),
    ];
    const result = await fs.commit(writes);
    if (result.ok) return { ok: true, code: 'DECIDED', decision, deductions };
    if (!isConflict(result)) return { ok: false, code: 'DB_ERROR' };
  }
  return { ok: false, code: 'RETRY' };
}
