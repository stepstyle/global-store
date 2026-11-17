// Order status changes from the admin dashboard for STOCK_POLICY=on_delivery orders, each as ONE atomic commit.
//
//   new / processing / shipped  -> any of these        status only (stock and reservation untouched)
//   open -> delivered                                    stock deducted ONCE + reservation released
//   open -> cancelled                                    reservation released, stock untouched
//   delivered -> cancelled (confirmReturn === true)      the delivered quantities are put back ONCE (a return)
//   delivered -> anything else, cancelled -> anything    refused (TRANSITION_NOT_ALLOWED)
//   same status again                                    nothing written ('unchanged')
//
// Atomicity / concurrency: one batchGet (order, ledger, products, reservations), then ONE commit in which every written
// document carries the updateTime it was read with (or exists:false). Firestore applies all of it or nothing; if
// anything changed in between (a second click, another tab, another order reserving the same product, a product
// edit) the commit is refused and the change is re-read and re-evaluated (bounded). orderLedger/{id}.inventory
// ('reserved' | 'none' | 'released' | 'deducted' | 'restocked') is the record that makes every stock effect happen
// at most once; the ledger is written ONLY by the Worker (rules deny the browser).
//
// Legacy safety: only orders whose ledger says stockPolicy === 'on_delivery' are handled here. Everything else
// (Worker v1 / browser orders without a ledger, v2 on_creation / on_approval orders) is refused with LEGACY_ORDER and
// never touches stock — those orders had their stock taken by their own policy.
import { decodeFields, encodeFields, isConflict } from './firestore.js';
import { planInventory, planRestock } from './inventory.js';
import { reservationWrites } from './reservations.js';
import { log } from './http.js';

export const ORDER_STATUSES = Object.freeze(['new', 'processing', 'shipped', 'delivered', 'cancelled']);
const OPEN = new Set(['new', 'processing', 'shipped']);
export const FULFIL_ATTEMPTS = 6;
const HISTORY_MAX = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const refuse = (status, code, extra = {}) => ({ status, body: { ok: false, code, ...extra } });

function orderUpdate(fs, orderId, orderDoc, fields) {
  return {
    update: { name: fs.name(`orders/${orderId}`), fields: encodeFields(fields) },
    updateMask: { fieldPaths: Object.keys(fields) },
    currentDocument: { updateTime: orderDoc.updateTime },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
  };
}
function ledgerUpdate(fs, orderId, ledgerDoc, fields) {
  return {
    update: { name: fs.name(`orderLedger/${orderId}`), fields: encodeFields(fields) },
    updateMask: { fieldPaths: Object.keys(fields) },
    currentDocument: { updateTime: ledgerDoc.updateTime },
  };
}
const productWrites = (fs, writes) => writes.map((w) => ({
  update: { name: fs.name(`products/${w.productId}`), fields: w.fields },
  updateMask: { fieldPaths: w.mask },
  currentDocument: { updateTime: w.updateTime },
}));

async function readReservations(fs, list) {
  const ids = [...new Set((Array.isArray(list) ? list : []).map((r) => r.productId).filter(Boolean))];
  const docs = ids.length ? await fs.batchGet(ids.map((id) => `stockReservations/${id}`)) : [];
  return new Map(ids.map((id, i) => [id, docs[i]]));
}

/**
 * @param input { orderId, status, confirmReturn, actor: { uid } }  — the actor is an AUTHORISED admin (src/admin.js)
 * @returns { status, body }
 */
export async function changeOrderStatus(fs, cfg, { orderId, status, confirmReturn = false, actor }) {
  if (!ORDER_STATUSES.includes(status)) return refuse(400, 'INVALID_STATUS');
  for (let attempt = 0; attempt < FULFIL_ATTEMPTS; attempt++) {
    const [orderDoc, ledgerDoc] = await fs.batchGet([`orders/${orderId}`, `orderLedger/${orderId}`]);
    if (!orderDoc.exists) return refuse(404, 'NOT_FOUND');
    const L = ledgerDoc.exists ? decodeFields(ledgerDoc.fields) : null;
    if (!L || L.stockPolicy !== 'on_delivery') return refuse(409, 'LEGACY_ORDER');
    const O = decodeFields(orderDoc.fields);
    const from = String(O.status || 'new');
    const inv = L.inventory || 'none';
    if (from === status) return { status: 200, body: { ok: true, orderId, status, result: 'unchanged', inventory: inv } };

    const at = new Date();
    const by = { source: 'admin', uid: String(actor?.uid || '') };
    const history = [...(Array.isArray(L.statusHistory) ? L.statusHistory : []), { from, to: status, at, by }].slice(-HISTORY_MAX);
    let nextInv = inv;
    let ledgerFields = {};
    let extraWrites = [];
    let outcome = {};

    if (from === 'cancelled') return refuse(409, 'TRANSITION_NOT_ALLOWED', { from, to: status });

    if (from === 'delivered') {
      if (status !== 'cancelled') return refuse(409, 'TRANSITION_NOT_ALLOWED', { from, to: status });
      // a return: the delivered goods are put back ONLY when the admin explicitly confirms they came back
      if (confirmReturn !== true) return refuse(409, 'RETURN_CONFIRMATION_REQUIRED');
      if (inv === 'deducted') {
        const applied = (Array.isArray(L.stockDeductions) ? L.stockDeductions : []).filter((d) => d.applied === true);
        const ids = [...new Set(applied.map((d) => d.productId))];
        const docs = ids.length ? await fs.batchGet(ids.map((id) => `products/${id}`)) : [];
        const rs = planRestock(applied, new Map(ids.map((id, i) => [id, docs[i]])));
        extraWrites = productWrites(fs, rs.writes);
        nextInv = 'restocked';
        ledgerFields = { stockRestored: rs.restored, restockWarnings: rs.warnings, returnedAt: at, returnedBy: by };
        outcome = { restored: rs.restored, warnings: rs.warnings };
      }
    } else if (status === 'delivered') {
      if (inv === 'reserved' || inv === 'none') {
        const lines = (Array.isArray(L.orderLines) ? L.orderLines : []).map((l) => ({ index: l.index, productId: l.productId, variantId: l.variantId || null, quantity: l.quantity }));
        const ids = [...new Set(lines.map((l) => l.productId))];
        const docs = ids.length ? await fs.batchGet(ids.map((id) => `products/${id}`)) : [];
        const plan = planInventory(lines, new Map(ids.map((id, i) => [id, docs[i]])), 'apply');
        const short = plan.warnings.filter((w) => w.code === 'STOCK_SHORTFALL');
        // never deduct a wrong quantity: the recorded stock is lower than what is being delivered (e.g. edited by
        // hand). The admin corrects the stock first; nothing is written now.
        if (short.length) {
          const problems = short.map((w) => ({ index: w.line, productId: lines.find((l) => l.index === w.line)?.productId, available: w.available, requested: w.requested }));
          log('order.deliver_refused', { orderId, problems: problems.length });
          return refuse(409, 'INSUFFICIENT_STOCK', { problems });
        }
        const resMap = await readReservations(fs, L.reservations);
        extraWrites = [...productWrites(fs, plan.writes), ...reservationWrites(fs, L.reservations, resMap, -1).writes];
        nextInv = 'deducted';
        ledgerFields = { stockDeductions: plan.deductions, stockWarnings: plan.warnings, deliveredAt: at, deliveredBy: by };
        outcome = { deductions: plan.deductions.filter((d) => d.applied) };
      }
      // inv === 'deducted' here cannot normally happen (delivered is left only to cancelled); never deduct twice
    } else if (status === 'cancelled') {
      if (inv === 'reserved') {
        const resMap = await readReservations(fs, L.reservations);
        const rel = reservationWrites(fs, L.reservations, resMap, -1);
        extraWrites = rel.writes;
        nextInv = 'released';
        ledgerFields = { releasedAt: at, releasedBy: by, ...(rel.warnings.length ? { releaseWarnings: rel.warnings } : {}) };
      }
    } else if (!OPEN.has(status)) {
      return refuse(400, 'INVALID_STATUS');
    }

    const writes = [
      ledgerUpdate(fs, orderId, ledgerDoc, { ...ledgerFields, inventory: nextInv, statusHistory: history }),
      orderUpdate(fs, orderId, orderDoc, { status, seenByAdmin: true, inventory: { policy: 'on_delivery', state: nextInv } }),
      ...extraWrites,
    ];
    const r = await fs.commit(writes);
    if (r.ok) {
      log('order.status_changed', { orderId, from, to: status, inventory: nextInv, attempt });
      return { status: 200, body: { ok: true, orderId, status, result: 'changed', inventory: nextInv, ...outcome } };
    }
    if (!isConflict(r)) {
      log('order.status_failed', { orderId, status: r.status, code: r.data?.error?.status });
      return refuse(503, 'RETRY_LATER');
    }
    await sleep(40 * (attempt + 1) + Math.floor(Math.random() * 40));
  }
  return refuse(503, 'BUSY');
}
