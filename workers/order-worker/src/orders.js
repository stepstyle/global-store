// Order creation / adoption / reconciliation with one atomic Firestore commit.
//
// orderLedger/{id} is the idempotency lock: created with exists:false in the SAME commit as the
// stock deductions. The browser never writes it (rules deny), so it cannot be wiped.

import { encodeFields, decodeFields, isConflict } from './firestore.js';
import { validateOrderInput, orderHash, ORDER_ID_RE } from './validate.js';
import { planInventory } from './inventory.js';
import { computeServerPricing, comparePricing } from './pricing.js';
import { initialNotifications, processNotifications } from './notify.js';
import { WORKER_VERSION } from './config.js';
import { log } from './http.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATUS_ALLOWLIST = new Set(['new', 'processing', 'shipped', 'delivered', 'cancelled']);

async function buildAndCommit(fs, cfg, { input, hash, mode, existingOrder, strippedFields, userIdWarning }) {
  const v = input;
  const lines = v.items.map((it, index) => ({ index, productId: it.productId, variantId: it.variantId, quantity: it.quantity }));
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const productDocs = await fs.batchGet(productIds.map((id) => `products/${id}`));
  const products = new Map(productIds.map((id, i) => [id, productDocs[i]]));

  const inv = planInventory(lines, products, cfg.stockMode);
  const pricing = computeServerPricing(inv.lineInfo, v.addressMeta, v.shippingMethodId);
  const mismatchFields = comparePricing(pricing, v.clientPricing);
  const priceMismatch = mismatchFields.length > 0;

  const warnings = [...inv.warnings, ...pricing.warnings];
  if (priceMismatch) warnings.push({ code: 'PRICE_MISMATCH', fields: mismatchFields });
  if (userIdWarning) warnings.push(userIdWarning);

  const serverPricing = {
    subtotal: pricing.subtotal,
    discount: pricing.discount,
    shipping: pricing.shipping,
    total: pricing.total,
    lines: inv.lineInfo.map((l) => ({ index: l.index, productId: l.productId, variantId: l.variantId, unitPrice: l.serverUnitPrice })),
  };
  const workerCheck = { version: WORKER_VERSION, mode, serverPricing, priceMismatch, warnings };

  const id = v.id;
  const ledgerPath = `orderLedger/${id}`;
  const orderPath = `orders/${id}`;

  const ledger = {
    orderId: id,
    payloadHash: hash,
    mode,
    workerVersion: WORKER_VERSION,
    stockMode: cfg.stockMode,
    serverPricing,
    clientPricing: v.clientPricing,
    priceMismatch,
    warnings,
    stockDeductions: inv.deductions,
    strippedFields,
    userIdVerified: false,
    // created: guest, or claimed uid dropped to 'guest'; adopted/reconciled: taken from the browser-written
    // document (validated by Firestore rules only once the compat rules are deployed).
    userIdSource: mode === 'created' ? (userIdWarning ? 'claimed-unverified-dropped' : 'guest') : 'browser-document',
    notifications: initialNotifications(cfg),
    notifyPending: true,
  };

  const writes = [
    {
      update: { name: fs.name(ledgerPath), fields: encodeFields(ledger) },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
    },
  ];

  if (mode === 'created') {
    const resolvedUserId = v.userId === 'guest' || !userIdWarning ? v.userId : 'guest';
    const order = {
      id,
      userId: resolvedUserId,
      ...(resolvedUserId !== v.userId ? { claimedUserId: v.userId } : {}),
      status: 'new',
      seenByAdmin: false,
      date: new Date().toISOString().slice(0, 10),
      createdAtMs: Date.now(),
      items: v.items.map((it) => ({
        productId: it.productId,
        name: it.name,
        price: it.clientUnitPrice ?? 0,
        quantity: it.quantity,
        image: it.image,
        selectedVariant: it.selectedVariant,
      })),
      subtotal: v.clientPricing.subtotal ?? 0,
      discountAmount: v.clientPricing.discountAmount ?? 0,
      shippingCost: v.clientPricing.shippingCost ?? 0,
      total: v.clientPricing.total,
      shippingMethodId: v.shippingMethodId,
      shippingMethod: v.shippingMethod,
      paymentMethod: v.paymentMethod,
      customerEmail: v.customerEmail,
      consents: v.consents,
      ...(v.note ? { note: v.note } : {}),
      ...(v.paymentMethod === 'cliq' ? { paymentDetails: { cliqReference: v.cliqReference, isPaid: false } } : {}),
      address: v.address,
      addressMeta: v.addressMeta,
      source: 'worker-v2',
      workerCheck,
    };
    writes.push({
      update: { name: fs.name(orderPath), fields: encodeFields(order) },
      currentDocument: { exists: false },
      updateTransforms: [
        { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    });
  } else {
    // adopted / reconciled: never rewrite the browser's fields — only attach the server check.
    writes.push({
      update: { name: fs.name(orderPath), fields: encodeFields({ workerCheck }) },
      updateMask: { fieldPaths: ['workerCheck'] },
      currentDocument: { updateTime: existingOrder.updateTime },
    });
  }

  for (const w of inv.writes) {
    writes.push({
      update: { name: fs.name(`products/${w.productId}`), fields: w.fields },
      updateMask: { fieldPaths: w.mask },
      currentDocument: { updateTime: w.updateTime },
    });
  }

  const r = await fs.commit(writes);
  if (r.ok) {
    log('order.committed', { orderId: id, mode, warnings: warnings.map((w) => w.code), deductions: inv.deductions.length });
    return { ok: true };
  }
  if (isConflict(r)) return { ok: false, conflict: true };
  log('order.commit_failed', { orderId: id, status: r.status, code: r.data?.error?.status });
  return { ok: false, conflict: false };
}

/**
 * Handles POST /create-order. Returns { status, body }.
 */
export async function createOrder(fs, cfg, rawOrder, ctx) {
  const parsed = validateOrderInput(rawOrder);
  if (!parsed.ok) return { status: 400, body: { ok: false, code: 'INVALID_ORDER', field: parsed.field } };
  const input = parsed.value;
  const hash = await orderHash(input);
  const id = input.id;

  let waited = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const [orderDoc, ledgerDoc] = await fs.batchGet([`orders/${id}`, `orderLedger/${id}`]);

    if (ledgerDoc.exists) {
      const stored = ledgerDoc.fields?.payloadHash?.stringValue;
      if (stored === hash) return { status: 200, body: { ok: true, orderId: id, replay: true } };
      log('order.id_conflict', { orderId: id, reason: 'ledger_hash_mismatch' });
      return { status: 409, body: { ok: false, code: 'ORDER_ID_CONFLICT' } };
    }

    let mode;
    let existingOrder = null;
    let userIdWarning = null;

    if (orderDoc.exists) {
      const ageMs = Date.now() - Date.parse(orderDoc.createTime);
      if (!(ageMs >= 0 && ageMs <= cfg.adoptWindowMs)) {
        log('order.id_conflict', { orderId: id, reason: 'existing_order_outside_adopt_window' });
        return { status: 409, body: { ok: false, code: 'ORDER_EXISTS' } };
      }
      const stored = validateOrderInput(decodeFields(orderDoc.fields));
      if (!stored.ok || (await orderHash(stored.value)) !== hash) {
        log('order.id_conflict', { orderId: id, reason: 'stored_order_differs' });
        return { status: 409, body: { ok: false, code: 'ORDER_ID_CONFLICT' } };
      }
      mode = 'adopted';
      existingOrder = orderDoc;
    } else {
      if (!waited && cfg.createWaitMs > 0) {
        // Current Checkout writes the order itself right after calling us: give that write a
        // moment so the common path is "adopt" (browser-written, rules-validated document).
        waited = true;
        attempt -= 1;
        await sleep(cfg.createWaitMs);
        continue;
      }
      mode = 'created';
      if (input.userId !== 'guest') {
        // No verifiable identity in Phase 1 => never attach an order to an account on our own.
        userIdWarning = { code: 'USERID_UNVERIFIED' };
      }
    }

    const r = await buildAndCommit(fs, cfg, { input, hash, mode, existingOrder, strippedFields: parsed.strippedFields, userIdWarning });
    if (r.ok) {
      const p = processNotifications(fs, cfg, id).catch((e) => log('notify.error', { orderId: id, message: String(e?.message || e) }));
      if (ctx?.waitUntil) ctx.waitUntil(p);
      return { status: 200, body: { ok: true, orderId: id, replay: false } };
    }
    if (!r.conflict) return { status: 503, body: { ok: false, code: 'RETRY_LATER' } };
    await sleep(40 * (attempt + 1) + Math.floor(Math.random() * 40));
  }
  return { status: 503, body: { ok: false, code: 'RETRY_LATER' } };
}

/**
 * GET /orders/:id/status — existence + coarse status only. No personal data.
 */
export async function orderStatus(fs, id) {
  if (!ORDER_ID_RE.test(id)) return { status: 400, body: { ok: false, code: 'INVALID_ID' } };
  const doc = await fs.get(`orders/${id}`);
  if (!doc.exists) return { status: 404, body: { ok: true, exists: false } };
  const raw = doc.fields?.status?.stringValue || '';
  const status = STATUS_ALLOWLIST.has(raw) ? raw : 'unknown';
  return { status: 200, body: { ok: true, exists: true, status } };
}

/**
 * Cron: adopt browser-written orders that never reached the Worker. DISABLED by default.
 * An order is only processed when ALL checks pass:
 *  - no ledger yet; status 'new'; document id == order.id; full schema validation passes
 *  - createdAt is a server timestamp (within 60s of the document's createTime -> not client-forged)
 *  - createTime inside [now - window, now - grace]
 */
export async function reconcileOrphans(fs, cfg) {
  if (!cfg.reconcileEnabled) return { enabled: false, processed: 0, skipped: [] };
  const now = Date.now();
  const since = new Date(now - cfg.reconcileWindowMs).toISOString();
  const docs = await fs.runQuery({
    from: [{ collectionId: 'orders' }],
    where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: since } } },
    limit: cfg.reconcileBatch,
  });

  const skipped = [];
  let processed = 0;
  for (const d of docs) {
    const docId = d.name.split('/').pop();
    const skip = (reason) => skipped.push({ orderId: docId, reason });

    const created = Date.parse(d.createTime);
    if (!(now - created >= cfg.reconcileGraceMs && now - created <= cfg.reconcileWindowMs)) { skip('outside_window'); continue; }
    const ledger = await fs.get(`orderLedger/${docId}`);
    if (ledger.exists) { skip('already_processed'); continue; }

    const f = d.fields || {};
    if (f.status?.stringValue !== 'new') { skip('status_not_new'); continue; }
    if (!('timestampValue' in (f.createdAt || {}))) { skip('createdAt_not_timestamp'); continue; }
    if (Math.abs(Date.parse(f.createdAt.timestampValue) - created) > 60_000) { skip('createdAt_not_server_time'); continue; }

    const parsed = validateOrderInput(decodeFields(f));
    if (!parsed.ok) { skip(`invalid:${parsed.field}`); continue; }
    if (parsed.value.id !== docId) { skip('id_mismatch'); continue; }

    const hash = await orderHash(parsed.value);
    const r = await buildAndCommit(fs, cfg, {
      input: parsed.value,
      hash,
      mode: 'reconciled',
      existingOrder: d,
      strippedFields: parsed.strippedFields,
      userIdWarning: null,
    });
    if (r.ok) {
      processed += 1;
      await processNotifications(fs, cfg, docId);
    } else {
      skip(r.conflict ? 'conflict' : 'commit_failed');
    }
  }
  return { enabled: true, processed, skipped };
}
