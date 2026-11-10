// Smart auto-approval — running the review for ONE order (phase 2). The rules are in src/autoapproval.js (pure).
//
// Lifecycle of orderLedger/{id}.autoReview (only for Telegram-approval orders CREATED while AUTO_APPROVAL_MODE=on):
//   queued   written IN THE SAME COMMIT that creates the order (src/orders.js) — a saved order can never lose its review
//   done     { outcome: auto_accepted | manual_review | disabled | superseded, reasons, version, doneAt, recovered }
//
// Who finishes a 'queued' review:
//   1. the request that created the order (ctx.waitUntil), right after the commit, BEFORE any notification;
//   2. if that request stopped (crash / timeout / lost connection): the cron, through processNotifications — the order is
//      in the notification queue anyway, and its notification waits for the review (settleAutoReview).
// Exactly-once stock: acceptance is ONLY src/approval.js decideOrder('accept') — one commit with updateTime
// preconditions on ledger + order + every product, the FINAL stock check inside it, idempotent (`already_accepted`).
// A repeated / concurrent / recovered review therefore never deducts twice. Anything that cannot be verified
// (settings unreadable, duplicate lookup failed, …) ends in manual review, never in an automatic acceptance.
import { decodeFields, encodeFields, isConflict } from './firestore.js';
import { planInventory } from './inventory.js';
import { decideOrder } from './approval.js';
import { assessOrder, phoneFingerprint } from './autoapproval.js';
import { log } from './http.js';

export const SETTINGS_PATH = 'config/autoApproval';
export const AUTO_ACTOR = Object.freeze({ source: 'auto', userId: 'auto' });

/** test-only fault injection (honoured ONLY when cfg.environment === 'local'): simulate a stop at a given point */
export const __test = { stopAt: null, afterAssess: null, settingsUnavailable: false };
class TestStop extends Error {}
/** true for the simulated stop: the caller then behaves like a stopped Worker (no notification either) */
export const isTestStop = (e) => e instanceof TestStop;
const testHook = (cfg, point) => {
  if (cfg.environment === 'local' && __test.stopAt === point) throw new TestStop(`test stop at ${point}`);
};

// ------------------------------------------------------------------ settings (dashboard switch + limits)
let settingsCache = null; // { at, value }
export function clearAutoSettingsCache() { settingsCache = null; }

/** @returns {{ ok: true, raw } | { ok: false }} — raw is the stored document (undefined = none = switch OFF) */
export async function loadAutoSettings(fs, cfg, now = Date.now()) {
  if (cfg.environment === 'local' && __test.settingsUnavailable) return { ok: false };
  const ttl = cfg.autoApproval?.settingsCacheMs ?? 30_000;
  if (settingsCache && ttl > 0 && now - settingsCache.at < ttl) return { ok: true, raw: settingsCache.value };
  try {
    const d = await fs.get(SETTINGS_PATH);
    const value = d.exists ? decodeFields(d.fields) : undefined;
    settingsCache = { at: now, value };
    return { ok: true, raw: value };
  } catch {
    return { ok: false };
  }
}

// ------------------------------------------------------------------ fields written at creation (src/orders.js)
/** null when auto-approval is off for this order; otherwise the ledger fields of the creation commit */
export async function autoReviewCreationFields(cfg, order, { turnstileVerified }) {
  if (cfg.autoApprovalMode !== 'on' || cfg.approvalMode !== 'telegram') return null;
  let phoneHash = null;
  if (cfg.autoApproval?.hashSecret) {
    try { phoneHash = await phoneFingerprint(order.address?.phone, cfg.autoApproval.hashSecret); } catch { phoneHash = null; }
  }
  return {
    autoReview: { state: 'queued', queuedAt: new Date(), turnstileVerified: turnstileVerified === true },
    ...(phoneHash ? { phoneHash } : {}),
  };
}

// ------------------------------------------------------------------ same phone within the window
/** other orders of the same phone fingerprint, pending or accepted, created within the window; null = unknown */
export async function countRecentSamePhone(fs, phoneHash, orderId, windowHours, now = Date.now()) {
  if (!phoneHash) return null;
  try {
    // one equality filter = Firestore's automatic single-field index (no composite index); the window is checked here
    const docs = await fs.runQuery({
      from: [{ collectionId: 'orderLedger' }],
      where: { fieldFilter: { field: { fieldPath: 'phoneHash' }, op: 'EQUAL', value: { stringValue: phoneHash } } },
      limit: 50,
    });
    const since = now - windowHours * 3600 * 1000;
    let n = 0;
    for (const d of docs) {
      const L = decodeFields(d.fields || {});
      if (L.orderId === orderId) continue;
      const created = L.createdAt instanceof Date ? L.createdAt.getTime() : NaN;
      if (!(created >= since)) continue;
      const decision = L.decision || (L.stockPolicy === 'on_approval' ? 'pending' : 'accepted');
      if (decision === 'pending' || decision === 'accepted') n++;
    }
    return docs.length >= 50 ? Math.max(n, 1) : n;
  } catch {
    return null;
  }
}

const STOCK_CODES = new Set(['STOCK_SHORTFALL', 'PRODUCT_NOT_FOUND', 'VARIANT_NOT_FOUND', 'DUPLICATE_VARIANT_ID', 'AMBIGUOUS_VARIANT', 'STOCK_UNTRACKED', 'STOCK_NOT_DEDUCTED', 'STOCK_STRING_NORMALIZED']);

/**
 * Finish the review of one order if it is still 'queued'. Idempotent: an already finished review is returned as is.
 * @returns {{ state: 'none' | 'queued' | 'done', outcome?, reasons? }} — 'queued' = could not finish now (retry later)
 */
export async function runAutoReview(fs, cfg, orderId, { recovery = false, now = Date.now() } = {}) {
  const ledgerPath = `orderLedger/${orderId}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const [orderDoc, ledgerDoc] = await fs.batchGet([`orders/${orderId}`, ledgerPath]);
    if (!ledgerDoc.exists) return { state: 'none' };
    const L = decodeFields(ledgerDoc.fields);
    const ar = L.autoReview;
    if (!ar || ar.state !== 'queued') return { state: ar?.state || 'none', outcome: ar?.outcome, reasons: ar?.reasons };
    const O = orderDoc.exists ? decodeFields(orderDoc.fields) : null;

    let outcome;
    let reasons;
    let version;
    const settings = await loadAutoSettings(fs, cfg, now);
    if (L.decision && L.decision !== 'pending') {
      // already decided: by THIS review before a stop (recovery: never decide again), or by an admin
      outcome = L.decision === 'accepted' && L.decidedBy?.source === 'auto' ? 'auto_accepted' : 'superseded';
      reasons = [];
    } else if (!O || L.stockPolicy !== 'on_approval') {
      outcome = 'manual_review';
      reasons = [{ code: 'NOT_NEW' }];
    } else if (!settings.ok) {
      // the switch / limits could not be read: never accept blind
      outcome = 'manual_review';
      reasons = [{ code: 'SETTINGS_UNAVAILABLE' }];
    } else {
      // stock PRE-check from the CURRENT product documents (the final check is inside decideOrder's commit)
      const lines = (Array.isArray(L.approvalLines) ? L.approvalLines : []).map((l) => ({ index: l.index, productId: l.productId, variantId: l.variantId || null, quantity: l.quantity }));
      const ids = [...new Set(lines.map((l) => l.productId))];
      let stockWarnings = [{ code: 'STOCK_NOT_DEDUCTED' }];
      try {
        const docs = ids.length ? await fs.batchGet(ids.map((id) => `products/${id}`)) : [];
        stockWarnings = planInventory(lines, new Map(ids.map((id, i) => [id, docs[i]])), cfg.stockMode).warnings;
      } catch { /* unreadable products -> STOCK_NOT_DEDUCTED -> manual review */ }
      const windowHours = Number(settings.raw?.duplicateWindowHours) > 0 ? Number(settings.raw.duplicateWindowHours) : 24;
      const a = assessOrder({
        order: { items: O.items, address: O.address, addressMeta: O.addressMeta, paymentMethod: O.paymentMethod },
        status: O.status,
        warnings: [...(Array.isArray(L.warnings) ? L.warnings : []).filter((w) => !STOCK_CODES.has(w?.code)), ...stockWarnings],
        serverTotal: L.serverPricing?.total ?? null,
        turnstileVerified: ar.turnstileVerified === true,
        recentSamePhone: await countRecentSamePhone(fs, L.phoneHash, orderId, windowHours, now),
        phoneHash: L.phoneHash || null,
        locks: { serverMode: cfg.autoApprovalMode, approvalMode: cfg.approvalMode },
        settings: settings.raw,
      });
      version = a.version;
      reasons = a.reasons;
      if (cfg.environment === 'local' && typeof __test.afterAssess === 'function') await __test.afterAssess(orderId, a);
      testHook(cfg, 'after_assess');
      if (a.decision !== 'auto_accept') {
        outcome = a.decision; // manual_review | disabled
      } else {
        // the ONLY way stock is taken: the same atomic, idempotent acceptance an admin's button uses
        const d = await decideOrder(fs, cfg, { orderId, action: 'accept', actor: AUTO_ACTOR });
        testHook(cfg, 'after_decide');
        if (d.result === 'accepted') outcome = 'auto_accepted';
        else if (d.result === 'already_accepted') {
          // our own earlier attempt (recovery) — or an admin was faster
          const fresh = decodeFields((await fs.get(ledgerPath)).fields || {});
          outcome = fresh.decidedBy?.source === 'auto' ? 'auto_accepted' : 'superseded';
        } else if (d.result === 'cannot_accept') {
          outcome = 'manual_review';
          reasons = [{ code: 'STOCK_PROBLEM', final: true, codes: [...new Set((d.problems || []).map((p) => p.code))] }];
        } else if (['already_rejected', 'already_cancelled', 'status_changed', 'not_found', 'legacy'].includes(d.result)) {
          outcome = 'superseded';
        } else {
          log('autoreview.decide_retry', { orderId, result: d.result });
          return { state: 'queued' }; // busy / error: finished later (cron), nothing was written
        }
      }
    }

    // close the review — only if it is still the 'queued' one we read (precondition on the CURRENT ledger)
    const cur = await fs.get(ledgerPath);
    if (!cur.exists) return { state: 'none' };
    if (decodeFields(cur.fields).autoReview?.state !== 'queued') continue; // someone else finished it: re-read
    const done = { state: 'done', outcome, reasons: reasons || [], version: version ?? null, doneAt: new Date(), recovered: recovery, queuedAt: ar.queuedAt ?? null };
    const r = await fs.commit([{
      update: { name: fs.name(ledgerPath), fields: encodeFields({ autoReview: done }) },
      updateMask: { fieldPaths: ['autoReview'] },
      currentDocument: { updateTime: cur.updateTime },
    }]);
    if (r.ok) {
      log('autoreview.done', { orderId, outcome, reasons: (reasons || []).map((x) => x.code), recovered: recovery });
      return { state: 'done', outcome, reasons: done.reasons };
    }
    if (!isConflict(r)) return { state: 'queued' };
    // the ledger changed meanwhile (e.g. a notification claim): re-run; decideOrder is idempotent
  }
  return { state: 'queued' };
}

/** close a review that could not be finished for too long: manual review, nothing deducted by this step */
async function giveUp(fs, orderId) {
  const ledgerPath = `orderLedger/${orderId}`;
  for (let i = 0; i < 4; i++) {
    const cur = await fs.get(ledgerPath);
    if (!cur.exists) return;
    const ar = decodeFields(cur.fields).autoReview;
    if (ar?.state !== 'queued') return;
    const r = await fs.commit([{
      update: { name: fs.name(ledgerPath), fields: encodeFields({ autoReview: { state: 'done', outcome: 'manual_review', reasons: [{ code: 'AUTO_REVIEW_FAILED' }], version: null, doneAt: new Date(), recovered: true, queuedAt: ar.queuedAt ?? null } }) },
      updateMask: { fieldPaths: ['autoReview'] },
      currentDocument: { updateTime: cur.updateTime },
    }]);
    if (r.ok) { log('autoreview.gave_up', { orderId }); return; }
  }
}

/**
 * Called by processNotifications for an order whose review is still 'queued'.
 * @returns true = the review is finished, send the notification now; false = deferred (the order stays queued).
 */
export async function settleAutoReview(fs, cfg, orderId, L, now = Date.now()) {
  const queuedAt = L.autoReview?.queuedAt instanceof Date ? L.autoReview.queuedAt.getTime() : 0;
  const age = now - queuedAt;
  const defer = async (ms) => {
    try {
      const cur = await fs.get(`orderLedger/${orderId}`);
      if (cur.exists) await fs.commit([{ update: { name: fs.name(`orderLedger/${orderId}`), fields: encodeFields({ notifyNextAt: new Date(now + ms) }) }, updateMask: { fieldPaths: ['notifyNextAt'] }, currentDocument: { updateTime: cur.updateTime } }]);
    } catch { /* stays due: picked up again */ }
    return false;
  };
  if (age < (cfg.autoApproval?.recoverAfterMs ?? 60_000)) {
    // the creating request is (probably) still reviewing it: wait, behind the other due orders
    return defer((cfg.autoApproval?.recoverAfterMs ?? 60_000) - age + 1_000);
  }
  let r = { state: 'queued' };
  try { r = await runAutoReview(fs, cfg, orderId, { recovery: true, now }); } catch (e) { log('autoreview.recovery_error', { orderId, message: String(e?.message || e).slice(0, 120) }); }
  if (r.state !== 'queued') return true;
  if (age >= (cfg.autoApproval?.giveUpAfterMs ?? 30 * 60_000)) {
    await giveUp(fs, orderId);
    return true;
  }
  return defer(60_000);
}
