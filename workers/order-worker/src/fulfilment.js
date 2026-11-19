// Order status changes from the admin dashboard for STOCK_POLICY=on_delivery orders, each as ONE atomic commit.
//
//   new / processing / shipped  -> any of these        status only (stock and reservation untouched)
//   open -> delivered                                    stock deducted ONCE + reservation released
//   open -> cancelled                                    reservation released, stock untouched
//   delivered -> cancelled (confirmReturn === true)      the delivered quantities are put back ONCE (a return)
//   delivered -> anything else, cancelled -> anything    refused (TRANSITION_NOT_ALLOWED)
//   open -> delivered with a product / colour / size gone refused (ITEMS_MISSING), nothing written
//   open -> delivered with a line without a valid stock number refused (STOCK_UNTRACKED), nothing written
//   open -> delivered with recorded stock < quantity       refused (INSUFFICIENT_STOCK), nothing written
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
//
// Rollback safety net: syncDirectStatusChanges (below, cron, SYNC_DIRECT_STATUS=true only) applies the same stock
// effects to statuses written DIRECTLY by the old admin dashboard, should the site ever go back to it.
import { decodeFields, encodeFields, isConflict } from './firestore.js';
import { planInventory, planRestock } from './inventory.js';
import { reservationWrites } from './reservations.js';
import { wheelStatusWrites } from './wheel.js';
import { log } from './http.js';

export const ORDER_STATUSES = Object.freeze(['new', 'processing', 'shipped', 'delivered', 'cancelled']);
/** inventory.js warnings that make a delivery impossible: the line cannot be deducted, so it is never delivered */
export const DELIVERY_BLOCKERS = Object.freeze(['PRODUCT_NOT_FOUND', 'VARIANT_NOT_FOUND', 'DUPLICATE_VARIANT_ID', 'AMBIGUOUS_VARIANT']);
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

const NO_EFFECT = (inv) => ({ nextInv: inv, ledgerFields: {}, writes: [], outcome: {} });

/**
 * The stock effect of moving an on_delivery order from `from` to `to` (transition legality is checked by the
 * callers). Shared by the dashboard path (changeOrderStatus) and the rollback sync (syncDirectStatusChanges), so both
 * apply exactly the same rules. Returns { refusal } or { nextInv, ledgerFields, writes, outcome }.
 */
async function planStockEffect(fs, L, from, to, { confirmReturn = false, at, by, orderId }) {
  const inv = L.inventory || 'none';
  if (from === 'delivered') {
    // a return: the delivered goods are put back ONLY when the admin explicitly confirms they came back
    if (confirmReturn !== true) return { refusal: refuse(409, 'RETURN_CONFIRMATION_REQUIRED') };
    if (inv !== 'deducted') return NO_EFFECT(inv);
    const applied = (Array.isArray(L.stockDeductions) ? L.stockDeductions : []).filter((d) => d.applied === true);
    const ids = [...new Set(applied.map((d) => d.productId))];
    const docs = ids.length ? await fs.batchGet(ids.map((id) => `products/${id}`)) : [];
    const rs = planRestock(applied, new Map(ids.map((id, i) => [id, docs[i]])));
    return {
      nextInv: 'restocked',
      ledgerFields: { stockRestored: rs.restored, restockWarnings: rs.warnings, returnedAt: at, returnedBy: by },
      writes: productWrites(fs, rs.writes),
      outcome: { restored: rs.restored, warnings: rs.warnings },
    };
  }
  if (to === 'delivered') {
    // inv === 'deducted' cannot normally happen here (delivered is left only to cancelled); never deduct twice
    if (inv !== 'reserved' && inv !== 'none') return NO_EFFECT(inv);
    const lines = (Array.isArray(L.orderLines) ? L.orderLines : []).map((l) => ({ index: l.index, productId: l.productId, variantId: l.variantId || null, quantity: l.quantity }));
    const ids = [...new Set(lines.map((l) => l.productId))];
    const docs = ids.length ? await fs.batchGet(ids.map((id) => `products/${id}`)) : [];
    const plan = planInventory(lines, new Map(ids.map((id, i) => [id, docs[i]])), 'apply');
    // a product / colour / size of the order no longer exists (deleted, variant removed or renamed, ambiguous):
    // never "delivered" without deducting it. The whole change is refused; nothing is written.
    const missing = plan.warnings.filter((w) => DELIVERY_BLOCKERS.includes(w.code));
    if (missing.length) {
      const problems = missing.map((w) => {
        const l = lines.find((x) => x.index === w.line);
        return { index: w.line, productId: l?.productId, variantId: l?.variantId || null, reason: w.code };
      });
      log('order.deliver_refused', { orderId, reason: 'items_missing', problems: problems.length });
      return { refusal: refuse(409, 'ITEMS_MISSING', { problems }) };
    }
    // a line of a REAL product (colour / size included) without a valid stock number (missing, empty, text,
    // negative): it could not be deducted, so the order is never "delivered" silently. Nothing is written.
    const untracked = plan.warnings.filter((w) => w.code === 'STOCK_UNTRACKED');
    if (untracked.length) {
      const problems = untracked.map((w) => {
        const l = lines.find((x) => x.index === w.line);
        return { index: w.line, productId: l?.productId, variantId: l?.variantId || null, reason: 'STOCK_UNTRACKED' };
      });
      log('order.deliver_refused', { orderId, reason: 'stock_untracked', problems: problems.length });
      return { refusal: refuse(409, 'STOCK_UNTRACKED', { problems }) };
    }
    // never deduct a wrong quantity: the recorded stock is lower than what is being delivered (e.g. edited by hand).
    // The admin corrects the stock first; nothing is written now.
    const short = plan.warnings.filter((w) => w.code === 'STOCK_SHORTFALL');
    if (short.length) {
      const problems = short.map((w) => ({ index: w.line, productId: lines.find((l) => l.index === w.line)?.productId, available: w.available, requested: w.requested }));
      log('order.deliver_refused', { orderId, reason: 'insufficient_stock', problems: problems.length });
      return { refusal: refuse(409, 'INSUFFICIENT_STOCK', { problems }) };
    }
    const resMap = await readReservations(fs, L.reservations);
    return {
      nextInv: 'deducted',
      ledgerFields: { stockDeductions: plan.deductions, stockWarnings: plan.warnings, deliveredAt: at, deliveredBy: by },
      writes: [...productWrites(fs, plan.writes), ...reservationWrites(fs, L.reservations, resMap, -1).writes],
      outcome: { deductions: plan.deductions.filter((d) => d.applied) },
    };
  }
  if (to === 'cancelled') {
    if (inv !== 'reserved') return NO_EFFECT(inv);
    const resMap = await readReservations(fs, L.reservations);
    const rel = reservationWrites(fs, L.reservations, resMap, -1);
    return {
      nextInv: 'released',
      ledgerFields: { releasedAt: at, releasedBy: by, ...(rel.warnings.length ? { releaseWarnings: rel.warnings } : {}) },
      writes: rel.writes,
      outcome: {},
    };
  }
  return NO_EFFECT(inv); // open -> open: status only
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
    if (from === status) return { status: 200, body: { ok: true, orderId, status, result: 'unchanged', inventory: L.inventory || 'none' } };
    if (from === 'cancelled' || (from === 'delivered' && status !== 'cancelled')) return refuse(409, 'TRANSITION_NOT_ALLOWED', { from, to: status });

    const at = new Date();
    const by = { source: 'admin', uid: String(actor?.uid || '') };
    const eff = await planStockEffect(fs, L, from, status, { confirmReturn, at, by, orderId });
    if (eff.refusal) return eff.refusal;
    const history = [...(Array.isArray(L.statusHistory) ? L.statusHistory : []), { from, to: status, at, by }].slice(-HISTORY_MAX);
    // prize wheel (only orders whose ledger carries `wheel`): prize consumed / given back, chance granted / revoked
    const wheelW = await wheelStatusWrites(fs, L, orderId, from, status, at);
    const writes = [
      ledgerUpdate(fs, orderId, ledgerDoc, { ...eff.ledgerFields, inventory: eff.nextInv, statusHistory: history }),
      orderUpdate(fs, orderId, orderDoc, { status, seenByAdmin: true, inventory: { policy: 'on_delivery', state: eff.nextInv } }),
      ...eff.writes,
      ...wheelW,
    ];
    const r = await fs.commit(writes);
    if (r.ok) {
      log('order.status_changed', { orderId, from, to: status, inventory: eff.nextInv, attempt });
      return { status: 200, body: { ok: true, orderId, status, result: 'changed', inventory: eff.nextInv, ...eff.outcome } };
    }
    if (!isConflict(r)) {
      log('order.status_failed', { orderId, status: r.status, code: r.data?.error?.status });
      return refuse(503, 'RETRY_LATER');
    }
    await sleep(40 * (attempt + 1) + Math.floor(Math.random() * 40));
  }
  return refuse(503, 'BUSY');
}

/**
 * ROLLBACK SAFETY NET (cron; only when SYNC_DIRECT_STATUS=true — off by default, no reads at all otherwise).
 * If the site ever has to go back to the OLD admin dashboard (together with the production-snapshot rules), that
 * dashboard writes the status of new on_delivery orders directly into Firestore and knows nothing about stock. This
 * job applies the missing stock effect with the same rules as the dashboard path:
 *   order 'delivered' while still reserved -> deduct + release (a refused case is recorded, stock untouched)
 *   order 'cancelled' while still reserved -> release the reservation
 *   order deleted while still reserved     -> release the reservation
 * Exactly once: it only acts on ledgers whose inventory is still 'reserved', and every commit carries the ledger's
 * (and every product's / reservation's) read version as a precondition — a second run, an overlapping run or a
 * dashboard change in between makes the commit fail, and the next run sees the new state.
 * State-based, not event-based: whatever was missed while the Worker was down is found again on the next run.
 * Bounded work per run (Worker subrequest limits): reserved ledgers are scanned in pages (one query + ONE batchGet of
 * their orders per page, up to syncPages pages), then at most syncApplyPerRun stock effects are applied — new cases
 * first, previously refused ones after them, so a stuck order never blocks the others.
 */
export async function syncDirectStatusChanges(fs, cfg) {
  if (!cfg.syncDirectStatus || cfg.stockPolicy !== 'on_delivery') return { enabled: false, checked: 0, applied: 0, problems: 0, pending: 0 };
  const pageSize = cfg.syncBatch ?? 300;
  const candidates = [];
  let checked = 0;
  let after = null;
  for (let page = 0; page < (cfg.syncPages ?? 5); page++) {
    const ledgers = await fs.runQuery({
      from: [{ collectionId: 'orderLedger' }],
      where: { fieldFilter: { field: { fieldPath: 'inventory' }, op: 'EQUAL', value: { stringValue: 'reserved' } } },
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      ...(after ? { startAt: { values: [{ referenceValue: after }], before: false } } : {}),
      limit: pageSize,
    });
    if (!ledgers.length) break;
    checked += ledgers.length;
    const ids = ledgers.map((d) => d.name.split('/').pop());
    const orders = await fs.batchGet(ids.map((id) => `orders/${id}`));
    ledgers.forEach((ledgerDoc, i) => {
      const L = decodeFields(ledgerDoc.fields);
      if (L.stockPolicy !== 'on_delivery') return;
      const orderDoc = orders[i];
      const to = orderDoc.exists ? String(decodeFields(orderDoc.fields).status || 'new') : 'cancelled';
      if (to === 'delivered' || to === 'cancelled') candidates.push({ orderId: ids[i], ledgerDoc, L, orderDoc, to });
    });
    if (ledgers.length < pageSize) break;
    after = ledgers[ledgers.length - 1].name;
  }
  candidates.sort((a, b) => Number(!!a.L.syncProblem) - Number(!!b.L.syncProblem));
  let applied = 0;
  let problems = 0;
  const budget = cfg.syncApplyPerRun ?? 4;
  for (const { orderId, ledgerDoc, L, orderDoc, to } of candidates.slice(0, budget)) {
    const at = new Date();
    const by = { source: 'sync', uid: '' };
    const eff = await planStockEffect(fs, L, 'shipped', to, { at, by, orderId });
    if (eff.refusal) {
      // cannot deduct (item gone / no valid stock number / stock too low): stock untouched, the reason is kept for the
      // admin and retried on the next runs (written only when it changes)
      problems += 1;
      const code = eff.refusal.body.code;
      if (L.syncProblem?.code !== code) await fs.commit([ledgerUpdate(fs, orderId, ledgerDoc, { syncProblem: { code, at } })]).catch(() => {});
      log('sync.refused', { orderId, code });
      continue;
    }
    const wheelW = await wheelStatusWrites(fs, L, orderId, 'shipped', to, at);
    const writes = [
      ledgerUpdate(fs, orderId, ledgerDoc, { ...eff.ledgerFields, inventory: eff.nextInv, syncedAt: at, syncedStatus: orderDoc.exists ? to : 'deleted', syncProblem: null }),
      ...(orderDoc.exists ? [orderUpdate(fs, orderId, orderDoc, { inventory: { policy: 'on_delivery', state: eff.nextInv } })] : []),
      ...eff.writes,
      ...wheelW,
    ];
    const r = await fs.commit(writes);
    if (r.ok) {
      applied += 1;
      log('sync.applied', { orderId, status: to, inventory: eff.nextInv });
    } else {
      log('sync.skipped', { orderId, conflict: isConflict(r) });
    }
  }
  return { enabled: true, checked, applied, problems, pending: Math.max(0, candidates.length - budget) };
}
