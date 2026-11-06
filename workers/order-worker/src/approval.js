// Atomic, idempotent Telegram decisions. Only new orders with deferred-stock
// policy can be approved here. Legacy orders might already have reduced inventory.
import { decodeFields, encodeFields, isConflict } from './firestore.js';
import { planInventory } from './inventory.js';
import { ORDER_ID_RE } from './validate.js';

const UNSAFE_STOCK = new Set([
  'PRODUCT_NOT_FOUND', 'VARIANT_NOT_FOUND', 'DUPLICATE_VARIANT_ID',
  'AMBIGUOUS_VARIANT', 'STOCK_UNTRACKED', 'STOCK_SHORTFALL', 'STOCK_NOT_DEDUCTED',
]);

function orderLines(items) {
  if (!Array.isArray(items) || !items.length || items.length > 30) return null;
  const lines = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const productId = it && typeof it.productId === 'string' ? it.productId : '';
    const quantity = it && it.quantity;
    const variantId = it && it.selectedVariant && it.selectedVariant.id;
    if (!productId || productId.includes('/') || productId.length > 256 ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 99 ||
        (variantId != null && (typeof variantId !== 'string' || variantId.includes('/')))) return null;
    lines.push({ index: i, productId, quantity, variantId: variantId || null });
  }
  return lines;
}

export async function decideOrder(fs, cfg, orderId, action) {
  if (!ORDER_ID_RE.test(orderId) || (action !== 'accept' && action !== 'reject')) {
    return { ok: false, code: 'INVALID_ACTION' };
  }
  if (!cfg.stockOnApproval) return { ok: false, code: 'FEATURE_DISABLED' };
  for (let attempt = 0; attempt < 5; attempt++) {
    const docs = await fs.batchGet(['orders/' + orderId, 'orderLedger/' + orderId]);
    const orderDoc = docs[0], ledgerDoc = docs[1];
    if (!orderDoc.exists || !ledgerDoc.exists) return { ok: false, code: 'ORDER_NOT_FOUND' };
    const order = decodeFields(orderDoc.fields);
    const ledger = decodeFields(ledgerDoc.fields);
    if (ledger.stockPolicy !== 'on_accept' || order.stockApprovalRequired !== true) {
      return { ok: false, code: 'LEGACY_ORDER' };
    }
    if (ledger.stockApplied === true && ledger.stockDecision === 'accepted' && order.status === 'processing') {
      return { ok: true, code: 'ALREADY_ACCEPTED' };
    }
    if (ledger.stockDecision === 'rejected' && order.status === 'cancelled') {
      return { ok: true, code: 'ALREADY_REJECTED' };
    }
    if (order.status !== 'new' || ledger.stockDecision || ledger.stockApplied !== false) {
      return { ok: false, code: 'ALREADY_RESOLVED' };
    }

    const writes = [];
    let stockDeductions = null;
    if (action === 'accept') {
      const lines = orderLines(order.items);
      if (!lines) return { ok: false, code: 'INVALID_ITEMS' };
      const ids = [...new Set(lines.map((l) => l.productId))];
      const productDocs = await fs.batchGet(ids.map((id) => 'products/' + id));
      const products = new Map(ids.map((id, i) => [id, productDocs[i]]));
      const planned = planInventory(lines, products, 'apply');
      if (planned.warnings.some((w) => UNSAFE_STOCK.has(w.code)) ||
          planned.deductions.length !== lines.length ||
          planned.writes.length === 0) {
        return { ok: false, code: 'STOCK_UNAVAILABLE' };
      }
      stockDeductions = planned.deductions;
      for (const w of planned.writes) {
        writes.push({
          update: { name: fs.name('products/' + w.productId), fields: w.fields },
          updateMask: { fieldPaths: w.mask },
          currentDocument: { updateTime: w.updateTime },
        });
      }
    }

    const accepted = action === 'accept';
    writes.push({
      update: {
        name: fs.name('orders/' + orderId),
        fields: encodeFields({ status: accepted ? 'processing' : 'cancelled', seenByAdmin: true }),
      },
      updateMask: { fieldPaths: ['status', 'seenByAdmin'] },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { updateTime: orderDoc.updateTime },
    });
    writes.push({
      update: {
        name: fs.name('orderLedger/' + orderId),
        fields: encodeFields({
          stockApplied: accepted,
          stockDecision: accepted ? 'accepted' : 'rejected',
          ...(accepted ? { stockDeductions } : {}),
        }),
      },
      updateMask: {
        fieldPaths: accepted
          ? ['stockApplied', 'stockDecision', 'stockDeductions']
          : ['stockApplied', 'stockDecision'],
      },
      updateTransforms: [{ fieldPath: 'stockDecisionAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { updateTime: ledgerDoc.updateTime },
    });

    const result = await fs.commit(writes);
    if (result.ok) return { ok: true, code: accepted ? 'ACCEPTED' : 'REJECTED' };
    if (!isConflict(result)) return { ok: false, code: 'DATABASE_UNAVAILABLE' };
  }
  return { ok: false, code: 'CONCURRENT_UPDATE' };
}
