// Telegram order approval: accept / reject / cancel-after-accept, each as ONE atomic Firestore commit.
//
// Atomicity & concurrency (no separate GET-then-UPDATE): the decision reads the ledger, the order and the products
// (one batchGet), then commits ALL its writes in a single commit where EVERY written document carries the
// updateTime it was read with as a precondition. Firestore applies the whole commit or nothing; if any of those
// documents changed in between (another decision, another order taking the same stock, an admin edit) the commit is
// refused and the decision re-reads and re-evaluates (bounded). This is the optimistic-concurrency form of a
// Firestore transaction.
//
// Idempotency: the decision is recorded in orderLedger/{id} (written ONLY by the Worker's service account). A second
// accept of an accepted order returns 'already_accepted' and writes nothing — stock is deducted exactly once.
// Legacy safety: only ledgers with stockPolicy === 'on_approval' can be decided here. Orders without a ledger
// (browser / old Worker v1) or with stock taken at creation are refused ('legacy') — never deducted again.
import { decodeFields, encodeFields, isConflict } from './firestore.js';
import { planInventory, planRestock } from './inventory.js';
import { reservationWrites } from './reservations.js';
import { wheelStatusWrites } from './wheel.js';
import { log } from './http.js';

export const ACTIONS = Object.freeze(['accept', 'reject', 'cancel']);
/** warnings that make an acceptance impossible (no partial deduction, never a guess) */
const ACCEPT_BLOCKERS = ['STOCK_SHORTFALL', 'PRODUCT_NOT_FOUND', 'VARIANT_NOT_FOUND', 'DUPLICATE_VARIANT_ID', 'AMBIGUOUS_VARIANT'];
export const DECISION_ATTEMPTS = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/**
 * @param action 'accept' | 'reject' | 'cancel'
 * @param actor  { source: 'telegram', userId: string }  — already AUTHORISED by the caller
 * @returns { result, ... } — result: accepted | rejected | cancelled | already_accepted | already_rejected |
 *          already_cancelled | not_accepted | cannot_accept | status_changed | legacy | not_found | busy | error
 */
export async function decideOrder(fs, cfg, { orderId, action, actor }) {
  if (!ACTIONS.includes(action)) return { result: 'error', reason: 'bad_action' };
  for (let attempt = 0; attempt < DECISION_ATTEMPTS; attempt++) {
    const [orderDoc, ledgerDoc] = await fs.batchGet([`orders/${orderId}`, `orderLedger/${orderId}`]);
    if (!ledgerDoc.exists) return { result: orderDoc.exists ? 'legacy' : 'not_found' };
    const L = decodeFields(ledgerDoc.fields);
    // STOCK_POLICY=on_acceptance: reserved at creation, deducted here on acceptance (its own commit path, below)
    if (L.stockPolicy === 'on_acceptance') return decideOnAcceptance(fs, cfg, { orderId, action, actor });
    if (L.stockPolicy !== 'on_approval') return { result: 'legacy' };
    if (!orderDoc.exists) return { result: 'not_found' };
    const O = decodeFields(orderDoc.fields);
    const decision = L.decision || 'pending';
    const by = { source: actor?.source || 'telegram', userId: String(actor?.userId || '') };
    const at = new Date();
    let writes;
    let outcome;

    if (action === 'accept') {
      if (decision !== 'pending') return { result: `already_${decision}` };
      if (O.status !== 'new') return { result: 'status_changed', status: O.status };
      const lines = (Array.isArray(L.approvalLines) ? L.approvalLines : []).map((l) => ({ index: l.index, productId: l.productId, variantId: l.variantId || null, quantity: l.quantity }));
      if (!lines.length) return { result: 'error', reason: 'no_lines' };
      const ids = [...new Set(lines.map((l) => l.productId))];
      const docs = await fs.batchGet(ids.map((id) => `products/${id}`));
      const inv = planInventory(lines, new Map(ids.map((id, i) => [id, docs[i]])), cfg.stockMode);
      const blockers = inv.warnings.filter((w) => ACCEPT_BLOCKERS.includes(w.code));
      if (blockers.length) return { result: 'cannot_accept', problems: blockers };
      writes = [
        ledgerUpdate(fs, orderId, ledgerDoc, { decision: 'accepted', decidedAt: at, decidedBy: by, stockDeductions: inv.deductions, stockWarnings: inv.warnings }),
        orderUpdate(fs, orderId, orderDoc, { status: 'processing', approval: { policy: 'telegram', state: 'accepted', decidedAt: at, decidedBy: by } }),
        ...productWrites(fs, inv.writes),
      ];
      outcome = { result: 'accepted', deductions: inv.deductions.filter((d) => d.applied), warnings: inv.warnings };
    } else if (action === 'reject') {
      if (decision !== 'pending') return { result: `already_${decision}` };
      if (O.status !== 'new') return { result: 'status_changed', status: O.status };
      writes = [
        ledgerUpdate(fs, orderId, ledgerDoc, { decision: 'rejected', decidedAt: at, decidedBy: by }),
        orderUpdate(fs, orderId, orderDoc, { status: 'cancelled', approval: { policy: 'telegram', state: 'rejected', decidedAt: at, decidedBy: by } }),
      ];
      outcome = { result: 'rejected' };
    } else {
      // cancel AFTER acceptance: give back exactly what this order took, once
      if (decision === 'pending') return { result: 'not_accepted' };
      if (decision !== 'accepted') return { result: `already_${decision}` };
      if (O.status !== 'processing') return { result: 'status_changed', status: O.status };
      const applied = (Array.isArray(L.stockDeductions) ? L.stockDeductions : []).filter((d) => d.applied === true);
      const ids = [...new Set(applied.map((d) => d.productId))];
      const docs = ids.length ? await fs.batchGet(ids.map((id) => `products/${id}`)) : [];
      const rs = planRestock(applied, new Map(ids.map((id, i) => [id, docs[i]])));
      writes = [
        ledgerUpdate(fs, orderId, ledgerDoc, { decision: 'cancelled', cancelledAt: at, cancelledBy: by, stockRestored: rs.restored, restockWarnings: rs.warnings }),
        orderUpdate(fs, orderId, orderDoc, { status: 'cancelled', approval: { policy: 'telegram', state: 'cancelled', decidedAt: L.decidedAt ?? null, cancelledAt: at, decidedBy: L.decidedBy ?? by, cancelledBy: by } }),
        ...productWrites(fs, rs.writes),
      ];
      outcome = { result: 'cancelled', restored: rs.restored, warnings: rs.warnings };
    }

    const r = await fs.commit(writes);
    if (r.ok) {
      log('order.decided', { orderId, action, result: outcome.result, by: by.userId, attempt });
      return outcome;
    }
    if (!isConflict(r)) {
      log('order.decision_failed', { orderId, action, status: r.status, code: r.data?.error?.status });
      return { result: 'error', reason: 'commit_failed' };
    }
    // something changed since the read (concurrent decision / stock taken by another order): re-read and re-decide
    await sleep(40 * (attempt + 1) + Math.floor(Math.random() * 40));
  }
  return { result: 'busy' };
}

const HISTORY_MAX = 50;
async function readReservations(fs, list) {
  const ids = [...new Set((Array.isArray(list) ? list : []).map((r) => r.productId).filter(Boolean))];
  const docs = ids.length ? await fs.batchGet(ids.map((id) => `stockReservations/${id}`)) : [];
  return new Map(ids.map((id, i) => [id, docs[i]]));
}

/**
 * STOCK_POLICY=on_acceptance — the order was RESERVED at creation (like on_delivery). One atomic commit per decision,
 * every written document on the version it was read with (concurrent decisions / dashboard changes -> re-read):
 *   accept  pending + 'new'        -> stock DEDUCTED once (orderLines, wheel gift included) + reservation released;
 *                                     status 'processing'; ledger.inventory 'deducted'
 *   reject  pending + 'new'        -> reservation released, nothing deducted; status 'cancelled'
 *   cancel  accepted + 'processing' -> what was deducted is put back ONCE ('restocked'); status 'cancelled'
 * The prize wheel follows the order in the SAME commit (src/wheel.js wheelStatusWrites: prize given back / ended,
 * phone slot, account sequence, budget). Later statuses (shipped, delivered, return) go through src/fulfilment.js.
 */
async function decideOnAcceptance(fs, cfg, { orderId, action, actor }) {
  for (let attempt = 0; attempt < DECISION_ATTEMPTS; attempt++) {
    const [orderDoc, ledgerDoc] = await fs.batchGet([`orders/${orderId}`, `orderLedger/${orderId}`]);
    if (!ledgerDoc.exists || !orderDoc.exists) return { result: 'not_found' };
    const L = decodeFields(ledgerDoc.fields);
    const O = decodeFields(orderDoc.fields);
    const decision = L.decision || 'pending';
    const by = { source: actor?.source || 'telegram', userId: String(actor?.userId || '') };
    const at = new Date();
    const history = (to) => [...(Array.isArray(L.statusHistory) ? L.statusHistory : []), { from: O.status || 'new', to, at, by }].slice(-HISTORY_MAX);
    let writes;
    let outcome;
    if (action === 'accept' || action === 'reject') {
      if (decision !== 'pending') return { result: `already_${decision}` };
      if (O.status !== 'new') return { result: 'status_changed', status: O.status };
    }
    if (action === 'accept') {
      const lines = (Array.isArray(L.orderLines) ? L.orderLines : []).map((l) => ({ index: l.index, productId: l.productId, variantId: l.variantId || null, quantity: l.quantity }));
      if (!lines.length) return { result: 'error', reason: 'no_lines' };
      const ids = [...new Set(lines.map((l) => l.productId))];
      const docs = await fs.batchGet(ids.map((id) => `products/${id}`));
      const inv = planInventory(lines, new Map(ids.map((id, i) => [id, docs[i]])), 'apply');
      const blockers = inv.warnings.filter((w) => ACCEPT_BLOCKERS.includes(w.code));
      if (blockers.length) return { result: 'cannot_accept', problems: blockers };
      const rel = reservationWrites(fs, L.reservations, await readReservations(fs, L.reservations), -1);
      writes = [
        ledgerUpdate(fs, orderId, ledgerDoc, { decision: 'accepted', decidedAt: at, decidedBy: by, stockDeductions: inv.deductions, stockWarnings: inv.warnings, inventory: 'deducted', acceptedAt: at, statusHistory: history('processing') }),
        orderUpdate(fs, orderId, orderDoc, { status: 'processing', approval: { policy: 'telegram', state: 'accepted', decidedAt: at, decidedBy: by }, inventory: { policy: 'on_acceptance', state: 'deducted' } }),
        ...productWrites(fs, inv.writes),
        ...rel.writes,
        ...(await wheelStatusWrites(fs, L, orderId, 'new', 'processing', at)),
      ];
      outcome = { result: 'accepted', deductions: inv.deductions.filter((d) => d.applied), warnings: inv.warnings };
    } else if (action === 'reject') {
      const inv0 = L.inventory || 'none';
      const rel = inv0 === 'reserved' ? reservationWrites(fs, L.reservations, await readReservations(fs, L.reservations), -1) : { writes: [] };
      writes = [
        ledgerUpdate(fs, orderId, ledgerDoc, { decision: 'rejected', decidedAt: at, decidedBy: by, inventory: inv0 === 'reserved' ? 'released' : inv0, releasedAt: at, statusHistory: history('cancelled') }),
        orderUpdate(fs, orderId, orderDoc, { status: 'cancelled', approval: { policy: 'telegram', state: 'rejected', decidedAt: at, decidedBy: by }, inventory: { policy: 'on_acceptance', state: inv0 === 'reserved' ? 'released' : inv0 } }),
        ...rel.writes,
        ...(await wheelStatusWrites(fs, L, orderId, 'new', 'cancelled', at)),
      ];
      outcome = { result: 'rejected' };
    } else {
      if (decision === 'pending') return { result: 'not_accepted' };
      if (decision !== 'accepted') return { result: `already_${decision}` };
      if (O.status !== 'processing') return { result: 'status_changed', status: O.status };
      if (L.inventory !== 'deducted') return { result: 'error', reason: 'not_deducted' };
      const applied = (Array.isArray(L.stockDeductions) ? L.stockDeductions : []).filter((d) => d.applied === true);
      const ids = [...new Set(applied.map((d) => d.productId))];
      const docs = ids.length ? await fs.batchGet(ids.map((id) => `products/${id}`)) : [];
      const rs = planRestock(applied, new Map(ids.map((id, i) => [id, docs[i]])));
      writes = [
        ledgerUpdate(fs, orderId, ledgerDoc, { decision: 'cancelled', cancelledAt: at, cancelledBy: by, stockRestored: rs.restored, restockWarnings: rs.warnings, inventory: 'restocked', statusHistory: history('cancelled') }),
        orderUpdate(fs, orderId, orderDoc, { status: 'cancelled', approval: { policy: 'telegram', state: 'cancelled', decidedAt: L.decidedAt ?? null, cancelledAt: at, decidedBy: L.decidedBy ?? by, cancelledBy: by }, inventory: { policy: 'on_acceptance', state: 'restocked' } }),
        ...productWrites(fs, rs.writes),
        ...(await wheelStatusWrites(fs, L, orderId, 'processing', 'cancelled', at)),
      ];
      outcome = { result: 'cancelled', restored: rs.restored, warnings: rs.warnings };
    }
    const r = await fs.commit(writes);
    if (r.ok) {
      log('order.decided', { orderId, action, result: outcome.result, by: by.userId, policy: 'on_acceptance', attempt });
      return outcome;
    }
    if (!isConflict(r)) {
      log('order.decision_failed', { orderId, action, status: r.status, code: r.data?.error?.status });
      return { result: 'error', reason: 'commit_failed' };
    }
    await sleep(40 * (attempt + 1) + Math.floor(Math.random() * 40));
  }
  return { result: 'busy' };
}
