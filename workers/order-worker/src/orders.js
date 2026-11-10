// Order creation / adoption / reconciliation with one atomic Firestore commit.
//
// orderLedger/{id} is the idempotency lock: created with exists:false in the SAME commit as the
// stock deductions. The browser never writes it (rules deny), so it cannot be wiped.

import { encodeFields, decodeFields, isConflict } from './firestore.js';
import { validateOrderInput, orderHash, ORDER_ID_RE } from './validate.js';
import { planInventory } from './inventory.js';
import { planReservation, reservationWrites } from './reservations.js';
import { computeServerPricing, comparePricing, enforcePriceProblems } from './pricing.js';
import { initialNotifications, processNotifications } from './notify.js';
import { autoReviewCreationFields, runAutoReview, isTestStop } from './autoreview.js';
import { WORKER_VERSION } from './config.js';
import { log } from './http.js';
import { loadGiftForOrder, openCampaign, phoneKey, prizeAdjustment, secondOrderWindowMs, firstDeliveryMs, accountSeqPath, accountSeqBump, accountSeqGuardedBump, GENERIC_GIFT_PRODUCT } from './wheel.js';
import { TRACKING_KEY_HASH_RE, normalizeTrackingKey, hashTrackingKey, sameHex, projectSummary } from './tracking.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATUS_ALLOWLIST = new Set(['new', 'processing', 'shipped', 'delivered', 'cancelled']);

async function buildAndCommit(fs, cfg, { input, hash, mode, existingOrder, strippedFields, userIdWarning, verifiedUid = null, trackingKeyHash = null, wheel = null, accountSeq = null, autoFields = null }) {
  const v = input;
  const lines = v.items.map((it, index) => ({ index, productId: it.productId, variantId: it.variantId, quantity: it.quantity }));
  // WHEEL_MODE=test: a prize won on the wheel travels as ONE extra line (index 1000, price 0) — reserved with the
  // order, deducted on delivery, released on cancellation, exactly like a paid line. It is never priced.
  // The prize (any type) is ONE per order. Only a gift that is a catalogue product becomes a stock line.
  const gift = wheel?.gift || null;
  const giftLine = gift && gift.type === 'gift' && gift.productId ? { index: GIFT_LINE_INDEX, productId: gift.productId, variantId: gift.variantId || null, quantity: 1 } : null;
  const productIds = [...new Set([...lines, ...(giftLine ? [giftLine] : [])].map((l) => l.productId))];
  const productDocs = await fs.batchGet(productIds.map((id) => `products/${id}`));
  const products = new Map(productIds.map((id, i) => [id, productDocs[i]]));

  const inv = planInventory(lines, products, cfg.stockMode);
  // APPROVAL_MODE=telegram: NOTHING is deducted now — the plan is only recorded; src/approval.js deducts atomically
  // when an authorised admin accepts. The ledger says which policy applied, so a later decision never deducts twice
  // and legacy orders (stock taken at creation, or no ledger at all) are never deducted again.
  const onApproval = cfg.approvalMode === 'telegram';
  // STOCK_POLICY=on_delivery: NOTHING is deducted now either — the quantities are only RESERVED (below, after the
  // price check); src/fulfilment.js deducts once when the admin marks the order delivered.
  const onDelivery = !onApproval && cfg.stockPolicy === 'on_delivery';
  if (onApproval || onDelivery) {
    for (const d of inv.deductions) { d.applied = false; d.skippedReason = d.skippedReason || (onApproval ? 'AWAITING_APPROVAL' : 'AWAITING_DELIVERY'); }
    inv.writes.length = 0;
  }
  // a discount / free-delivery prize changes the SERVER's numbers; the browser must send the same ones (enforce)
  const pricing = computeServerPricing(inv.lineInfo, v.addressMeta, v.shippingMethodId, prizeAdjustment(gift));
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

  // PRICE_CHECK_MODE=enforce: refuse BEFORE any write — no orders/ document, no orderLedger, no stock change, no
  // notification (all of those only happen after the commit below). log mode is unchanged (recorded, then saved).
  if (cfg.priceCheckMode === 'enforce') {
    const problems = enforcePriceProblems(pricing, v.clientPricing, inv.lineInfo, v.items, warnings);
    if (problems.length) {
      log('order.price_rejected', { orderId: v.id, mode, problems });
      return { ok: false, conflict: false, priceRejected: { problems, serverPricing } };
    }
  }
  // on_delivery: reserve against stock - (already reserved). Refused BEFORE any write when a line needs more than is
  // available — two orders racing for the last piece: the reservation documents carry their read version as a
  // precondition, so only one commit succeeds; the other re-reads (createOrder retry) and is refused here.
  // WHEEL: the minimum is measured on the PRODUCTS' prices (server prices, before the wheel prize, without delivery)
  // — the owner's rule. Each prize has its own minimum (fixed when it was won); an order below it may not carry the
  // prize (nothing is written, the prize stays available), and an order below the campaign minimum earns no new chance.
  const qualifyingSubtotal = Math.round(Number(pricing.subtotal) * 1000) / 1000;
  const paidSubtotal = Math.round((Number(pricing.subtotal) - Number(pricing.volumeDiscount ?? pricing.discount ?? 0)) * 1000) / 1000;
  const campaign = wheel?.campaign || null;
  const prizeMin = gift ? (gift.minOrderJod ?? campaign?.minOrderJod ?? null) : null;
  if (gift && !(campaign && prizeMin !== null && qualifyingSubtotal >= prizeMin)) {
    log('order.wheel_refused', { orderId: v.id, code: 'WHEEL_MIN_ORDER' });
    return { ok: false, conflict: false, wheelRefused: { code: 'WHEEL_MIN_ORDER', minOrderJod: prizeMin } };
  }
  if (gift && !onDelivery) return { ok: false, conflict: false, wheelRefused: { code: 'WHEEL_OFF' } };
  let reservation = null;
  let reservationDocs = null;
  if (onDelivery) {
    const resDocs = await fs.batchGet(productIds.map((pid) => `stockReservations/${pid}`));
    reservationDocs = new Map(productIds.map((pid, i) => [pid, resDocs[i]]));
    reservation = planReservation(giftLine ? [...lines, giftLine] : lines, products, reservationDocs);
    if (giftLine && (reservation.warnings.some((w) => w.line === GIFT_LINE_INDEX) || reservation.shortfalls.some((x) => x.index === GIFT_LINE_INDEX))) {
      // the prize itself cannot be supplied (product gone / no stock number / sold out): nothing is written, the
      // prize stays 'issued' for a later order
      log('order.wheel_refused', { orderId: v.id, code: 'WHEEL_PRIZE_UNAVAILABLE' });
      return { ok: false, conflict: false, wheelRefused: { code: 'WHEEL_PRIZE_UNAVAILABLE' } };
    }
    if (reservation.shortfalls.length) {
      log('order.out_of_stock', { orderId: v.id, mode, lines: reservation.shortfalls.length });
      return { ok: false, conflict: false, outOfStock: reservation.shortfalls };
    }
  }
  // WHEEL anti-abuse (a limit, not an identity check): at most campaign.openGiftsPerPhone gifts open at the same time
  // for one delivery number (many accounts, one address). The number is keyed with a server-only HMAC secret.
  let phoneGift = null;
  if (gift) {
    const key = await phoneKey(cfg.wheelPhoneSecret, wheel.campaignId, v.address?.phone);
    if (!key) return { ok: false, conflict: false, wheelRefused: { code: 'WHEEL_PHONE_REQUIRED' } };
    const doc = await fs.get(`wheelPhoneGifts/${key}`);
    const open = doc.exists ? Math.max(0, Number(decodeFields(doc.fields).open) || 0) : 0;
    if (open >= campaign.openGiftsPerPhone) {
      log('order.wheel_refused', { orderId: v.id, code: 'WHEEL_PHONE_LIMIT' });
      return { ok: false, conflict: false, wheelRefused: { code: 'WHEEL_PHONE_LIMIT' } };
    }
    phoneGift = { key, doc, open };
  }
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
    userIdVerified: !!verifiedUid,
    // the VERIFIED owner (Firebase ID token uid), written once with the ledger (exists:false precondition); later
    // ledger updates only touch notifications/notifyPending, and the browser can never write orderLedger.
    ...(verifiedUid ? { ownerUid: verifiedUid } : {}),
    // sha256 of the customer's tracking key (src/tracking.js); written once with the ledger, never returned
    ...(trackingKeyHash ? { trackingKeyHash } : {}),
    // created: verified Firebase ID token, guest, or claimed uid dropped to 'guest'; adopted/reconciled: taken from
    // the browser-written document (validated by Firestore rules only once the compat rules are deployed).
    userIdSource: mode === 'created' ? (verifiedUid ? 'firebase-id-token' : userIdWarning ? 'claimed-unverified-dropped' : 'guest') : 'browser-document',
    // which stock policy applied to THIS order — the only thing a later decision trusts (never the order status):
    //   on_creation: deducted (or not, see stockDeductions) right here, as before;
    //   on_approval: nothing deducted; src/approval.js deducts exactly once when an admin accepts.
    // Ledgers written before this field existed are treated as on_creation (legacy: never deducted again).
    //   on_delivery: reserved here (reservations / inventory); src/fulfilment.js deducts once on delivery.
    stockPolicy: onApproval ? 'on_approval' : onDelivery ? 'on_delivery' : 'on_creation',
    ...(onDelivery
      ? {
          // the server-validated lines the delivery will deduct (never re-read from the browser-written order)
          orderLines: inv.lineInfo.map((l) => ({
            index: l.index, productId: l.productId, variantId: l.variantId ?? null, quantity: l.quantity,
            unitPrice: l.serverUnitPrice, productName: l.productName, variantLabel: l.variantLabel,
          })).concat(giftLine ? [{ ...giftLine, unitPrice: 0, productName: gift.label, variantLabel: giftLine.variantId ? giftVariant(products.get(giftLine.productId), giftLine.variantId).label || null : null, gift: true }] : []),
          reservations: reservation.reservations,
          reservationWarnings: reservation.warnings,
          inventory: reservation.reservations.length ? 'reserved' : 'none',
        }
      : {}),
    ...(onApproval
      ? {
          decision: 'pending',
          // the server-validated lines the acceptance will deduct (never re-read from the browser-written order)
          approvalLines: inv.lineInfo.map((l) => ({
            index: l.index, productId: l.productId, variantId: l.variantId ?? null, quantity: l.quantity,
            unitPrice: l.serverUnitPrice, productName: l.productName, variantLabel: l.variantLabel,
          })),
          // smart auto-approval: the review marker is part of THIS commit, so a saved order is never "forgotten"
          // (finished by this request or, if it stops, by the cron — src/autoreview.js). Created orders only.
          ...(autoFields && mode === 'created' ? autoFields : {}),
        }
      : {}),
    // WHEEL (test): which prize this order carries and whether its delivery earns a new chance (src/wheel.js)
    ...(campaign && verifiedUid
      ? { wheel: {
          campaignId: wheel.campaignId, uid: verifiedUid, spinId: gift?.spinId ?? null, prizeId: gift?.prizeId ?? null,
          prizeType: gift?.type ?? null, prizeLabel: gift?.label ?? null, prizeMinOrderJod: prizeMin,
          discountJod: pricing.wheelDiscount ?? 0, shippingWaivedJod: pricing.shippingWaived ?? 0,
          qualifyingSubtotal, paidSubtotal, chanceEligible: qualifyingSubtotal >= campaign.minOrderJod,
          giftOnCancel: campaign.giftOnCancel, freeFirstChance: campaign.freeFirstChance, phoneKey: phoneGift?.key ?? null,
          // second-order prizes: their window after the account's first delivery (src/wheel.js), carried for fulfilment.js
          secondOrderHours: secondOrderWindowMs(cfg) / 3_600_000,
          firstDeliveryHours: firstDeliveryMs(cfg) / 3_600_000,
        } }
      : {}),
    notifications: initialNotifications(cfg),
    notifyPending: true,
    // cron queue position: due now (oldest orders first); moved back after each run, removed when all channels are done
    notifyNextAt: new Date(),
  };

  const writes = [
    {
      update: { name: fs.name(ledgerPath), fields: encodeFields(ledger) },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
    },
  ];

  if (mode === 'created') {
    const resolvedUserId = verifiedUid || (v.userId === 'guest' || !userIdWarning ? v.userId : 'guest');
    const order = {
      id,
      userId: resolvedUserId,
      ...(verifiedUid ? { userIdVerified: true } : {}),
      ...(!verifiedUid && resolvedUserId !== v.userId ? { claimedUserId: v.userId } : {}),
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
      })).concat(gift && gift.type === 'gift' ? [{ productId: giftLine ? giftLine.productId : GENERIC_GIFT_PRODUCT, name: `🎁 هدية العجلة: ${gift.label}`, price: 0, quantity: 1, gift: true, ...(giftLine?.variantId ? { selectedVariant: giftVariant(products.get(giftLine.productId), giftLine.variantId) } : {}) }] : []),
      ...(gift && gift.type === 'gift' ? { wheelGift: { label: gift.label, productId: giftLine ? giftLine.productId : null, variantId: giftLine?.variantId || null, ...(gift.valueJod ? { valueJod: gift.valueJod } : {}) } } : {}),
      // every prize (shown in the dashboard + notifications): what it is and what it changed in THIS order's prices
      ...(gift ? { wheelPrize: { type: gift.type, label: gift.label, valueJod: gift.valueJod || 0, appliesTo: gift.appliesTo, discountJod: pricing.wheelDiscount ?? 0, shippingWaivedJod: pricing.shippingWaived ?? 0 } } : {}),
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
      // shown in the admin dashboard / used by the Firestore rules: a Telegram-approval order is decided ONLY by
      // the Worker (written by the service account; the browser can never set or change it)
      ...(onApproval ? { approval: { policy: 'telegram', state: 'pending' } } : {}),
      // shown in the admin dashboard / used by the Firestore rules: the status of an on_delivery order is changed
      // ONLY through the Worker (POST /admin/orders/:id/status), so the stock moves exactly once
      ...(onDelivery ? { inventory: { policy: 'on_delivery', state: ledger.inventory } } : {}),
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
    const extra = onApproval
      ? { approval: { policy: 'telegram', state: 'pending' } }
      : onDelivery ? { inventory: { policy: 'on_delivery', state: ledger.inventory } } : {};
    writes.push({
      update: { name: fs.name(orderPath), fields: encodeFields({ workerCheck, ...extra }) },
      updateMask: { fieldPaths: ['workerCheck', ...Object.keys(extra)] },
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
  if (onDelivery) writes.push(...reservationWrites(fs, reservation.reservations, reservationDocs, +1).writes);
  if (gift) {
    // the prize is used by THIS order only: 'issued' -> 'reserved' in the same commit (a second order with the same
    // prize, or an order racing with it, fails the precondition, re-reads and finds it no longer 'issued')
    writes.push({
      update: { name: fs.name(`wheelSpins/${gift.spinId}`), fields: encodeFields({ status: 'reserved', orderId: id, reservedAt: new Date(), issuedExpiry: null }) },
      updateMask: { fieldPaths: ['status', 'orderId', 'reservedAt', 'issuedExpiry'] },
      currentDocument: { updateTime: gift.spinDoc.updateTime },
    });
    // the number's open-gift counter, conditional on the version read (two accounts racing with one number: one wins)
    writes.push({
      update: { name: fs.name(`wheelPhoneGifts/${phoneGift.key}`), fields: encodeFields({ campaignId: wheel.campaignId, open: phoneGift.open + 1 }) },
      currentDocument: phoneGift.doc.exists ? { updateTime: phoneGift.doc.updateTime } : { exists: false },
    });
  }

  // every new order of a verified account moves its order sequence; the one using a second-order discount only from
  // the version it read (a concurrent order of the same account -> conflict -> re-read -> refused if now third)
  if (accountSeq && mode === 'created') writes.push(accountSeq.guarded ? accountSeqGuardedBump(fs, accountSeq.uid, accountSeq.doc) : accountSeqBump(fs, accountSeq.uid));

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
 * The verified owner of an already processed order, from the ledger (never from the request body):
 *  - ledger.ownerUid                       -> that uid
 *  - ledger.userIdVerified true, no ownerUid (ledger written before ownerUid existed) -> the order's userId, or
 *    '\u0000unknown' when the order document is gone (owner cannot be proven -> nobody gets a confirmation)
 *  - otherwise (guest, unverified claim, adopted/reconciled browser order) -> null: replay works as before
 */
function verifiedOwner(ledgerDoc, orderDoc) {
  const f = ledgerDoc.fields || {};
  const ownerUid = f.ownerUid?.stringValue;
  if (typeof ownerUid === 'string' && ownerUid) return ownerUid;
  if (f.userIdVerified?.booleanValue === true) {
    const uid = orderDoc?.exists ? orderDoc.fields?.userId?.stringValue : null;
    return typeof uid === 'string' && uid && uid !== 'guest' ? uid : '\u0000unknown';
  }
  return null;
}

export const CREATE_ATTEMPTS = 6;

/** has this order number been committed since we last looked? (one read, only on the refusal path) */
const savedMeanwhile = async (fs, id) => (await fs.get(`orderLedger/${id}`)).exists;

/**
 * Handles POST /create-order. Returns { status, body }.
 */
export const GIFT_LINE_INDEX = 1000;

/** the gift's variant as the dashboard shows it (id + label/type/colors from the product document; never a price) */
function giftVariant(productDoc, variantId) {
  const list = productDoc?.exists ? decodeFields(productDoc.fields).variants : null;
  const v = Array.isArray(list) ? list.find((x) => x && x.id === variantId) : null;
  return v ? { id: v.id, label: v.label ?? '', type: v.type ?? '', ...(v.colorCode ? { colorCode: v.colorCode } : {}), ...(v.colorCode2 ? { colorCode2: v.colorCode2 } : {}) } : { id: variantId, label: '' };
}

export async function createOrder(fs, cfg, rawOrder, ctx, auth = null, extra = {}) {
  const wheelSpinId = extra?.wheelSpinId ?? null;
  // a prize is only ever requested by a wheel-aware site; with the wheel off it is refused (never silently dropped)
  if (wheelSpinId !== null && cfg.wheelMode === 'off') return { status: 422, body: { ok: false, code: 'WHEEL_OFF' } };
  const trackingKeyHash = TRACKING_KEY_HASH_RE.test(String(extra?.trackingKeyHash || '')) ? extra.trackingKeyHash : null;
  // auth = { uid } from a VERIFIED Firebase ID token (index.js), or null. The body's userId is never proof.
  const verifiedUid = auth && typeof auth.uid === 'string' && auth.uid ? auth.uid : null;
  const parsed = validateOrderInput(rawOrder);
  if (!parsed.ok) return { status: 400, body: { ok: false, code: 'INVALID_ORDER', field: parsed.field } };
  const input = parsed.value;
  const hash = await orderHash(input);
  const id = input.id;
  // smart auto-approval: null unless AUTO_APPROVAL_MODE=on (+ APPROVAL_MODE=telegram); Turnstile as verified by index.js
  const autoFields = await autoReviewCreationFields(cfg, input, { turnstileVerified: extra?.turnstileVerified === true });

  let waited = false;
  // stock contention (several orders on one product at once) is resolved by retrying the precondition commit; each
  // try costs ~3 subrequests, so 6 tries stay well inside one invocation's budget (only spent when a conflict occurs)
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const [orderDoc, ledgerDoc] = await fs.batchGet([`orders/${id}`, `orderLedger/${id}`]);

    if (ledgerDoc.exists) {
      // An order owned by a VERIFIED account is only ever confirmed again to that same account. Anyone else
      // (other uid, or no token) gets the SAME answer whether or not the payload matches — no confirmation oracle.
      // Nothing is written either way, and the owner never changes.
      const owner = verifiedOwner(ledgerDoc, orderDoc);
      if (owner !== null && owner !== verifiedUid) {
        log('order.replay_refused', { orderId: id, reason: verifiedUid ? 'other_account' : 'no_token' });
        return { status: 409, body: { ok: false, code: 'ORDER_EXISTS' } };
      }
      const stored = ledgerDoc.fields?.payloadHash?.stringValue;
      if (stored === hash) return { status: 200, body: { ok: true, orderId: id, replay: true } };
      log('order.id_conflict', { orderId: id, reason: 'ledger_hash_mismatch' });
      return { status: 409, body: { ok: false, code: 'ORDER_EXISTS' } }; // one 409 code for every case
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
        return { status: 409, body: { ok: false, code: 'ORDER_EXISTS' } }; // one 409 code for every case
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
      if (verifiedUid) {
        // signed-in customer: the body may say 'guest' (profile not loaded yet) or the SAME uid — never another one
        if (input.userId !== 'guest' && input.userId !== verifiedUid) {
          log('order.userid_mismatch', { orderId: id });
          return { status: 403, body: { ok: false, code: 'USERID_MISMATCH' } };
        }
      } else if (input.userId !== 'guest') {
        // No verified identity (old site / no token) => never attach an order to an account on our own.
        userIdWarning = { code: 'USERID_UNVERIFIED' };
      }
    }

    // WHEEL (test only): the prize is re-read on every attempt (its version is the commit's precondition)
    let wheel = null;
    // the account's order sequence, read BEFORE anything counts its orders (loadGiftForOrder): see accountSeqPath
    let accountSeq = null;
    if (cfg.wheelMode !== 'off' && verifiedUid && mode === 'created') accountSeq = { uid: verifiedUid, doc: await fs.get(accountSeqPath(verifiedUid)), guarded: false };
    if (cfg.wheelMode !== 'off') {
      if (wheelSpinId !== null) {
        if (mode !== 'created') return { status: 409, body: { ok: false, code: 'WHEEL_PRIZE_INVALID' } };
        const g = await loadGiftForOrder(fs, cfg, { spinId: wheelSpinId, uid: verifiedUid });
        // the prize is already reserved by THIS order number: a simultaneous identical send committed between our
        // ledger read and this read — read again, the ledger now answers (replay: same 200, never a false refusal)
        if (!g.ok && g.code === 'WHEEL_PRIZE_USED' && g.reservedFor === id) continue;
        if (!g.ok && (await savedMeanwhile(fs, id))) continue;
        if (!g.ok) return { status: g.code === 'WHEEL_SIGN_IN_REQUIRED' ? 401 : 422, body: { ok: false, code: g.code, ...(g.minOrderJod !== undefined ? { minOrderJod: g.minOrderJod } : {}) } };
        wheel = { campaignId: cfg.wheelCampaignId, gift: g.gift, campaign: g.campaign };
        // a second-order discount: this order is the actual second ONLY if no other order of the account was created
        // or changed since the sequence was read -> the commit is conditional on that version (atomic check + use)
        if (accountSeq && g.gift.appliesTo === 'next_order') accountSeq.guarded = true;
      } else if (verifiedUid && mode === 'created') {
        const c = await openCampaign(fs, cfg);
        if (c) wheel = { campaignId: cfg.wheelCampaignId, gift: null, campaign: c };
      }
    }

    // Owner is decided ONCE, here, at creation. A replay (ledger exists, above) or an adoption never changes it.
    const r = await buildAndCommit(fs, cfg, { input, hash, mode, existingOrder, strippedFields: parsed.strippedFields, userIdWarning, verifiedUid: mode === 'created' ? verifiedUid : null, trackingKeyHash, wheel, accountSeq, autoFields });
    if (r.ok) {
      // auto-approval review FIRST (so the Telegram message shows the real state), then the notifications.
      // A review that cannot finish leaves the marker 'queued': the notification waits and the cron finishes it.
      const p = (async () => {
        if (autoFields && mode === 'created') {
          try {
            await runAutoReview(fs, cfg, id);
          } catch (e) {
            if (isTestStop(e)) return; // test-only: behave like a Worker that stopped here (no notification either)
            log('autoreview.error', { orderId: id, message: String(e?.message || e).slice(0, 120) });
          }
        }
        await processNotifications(fs, cfg, id);
      })().catch((e) => log('notify.error', { orderId: id, message: String(e?.message || e) }));
      if (ctx?.waitUntil) ctx.waitUntil(p);
      return { status: 200, body: { ok: true, orderId: id, replay: false } };
    }
    // enforce: nothing was written. 422 (not 409): the storefront treats it as "refused, nothing saved".
    // The server's own numbers come back so the customer can be shown the current price.
    if (r.priceRejected) {
      const sp = r.priceRejected.serverPricing;
      return {
        status: 422,
        body: { ok: false, code: 'PRICE_CHANGED', problems: r.priceRejected.problems, serverPricing: { subtotal: sp.subtotal, discount: sp.discount, shipping: sp.shipping, total: sp.total, lines: sp.lines.map((l) => ({ index: l.index, unitPrice: l.unitPrice })) } },
      };
    }
    // on_delivery: not enough stock left after the other open orders' reservations. Nothing was written (422, like
    // PRICE_CHANGED: the storefront shows "out of stock" and keeps the cart). Only line indexes and the quantity still
    // available are returned.
    // a refusal caused by OUR OWN twin: an identical send of this order number committed while this one was reading
    // (its reservation / prize / phone slot is what we saw). Read again -> the ledger answers with the normal replay.
    if ((r.wheelRefused || r.outOfStock) && (await savedMeanwhile(fs, id))) continue;
    if (r.wheelRefused) return { status: 422, body: { ok: false, ...r.wheelRefused } };
    if (r.outOfStock) {
      return { status: 422, body: { ok: false, code: 'OUT_OF_STOCK', lines: r.outOfStock.map((s) => ({ index: s.index, available: s.available })) } };
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
 * GET /orders/:id/summary — NON-personal order summary (src/tracking.js projectSummary), only for:
 *  - the holder of the order's tracking key (x-tracking-key; compared by hash with orderLedger/{id}.trackingKeyHash), or
 *  - the VERIFIED owner (Firebase ID token uid == the ledger's owner).
 * Every refusal — no key, wrong key, another order's key, unknown order, order without a key (old orders) — is the
 * SAME 404, so the endpoint never says more than the public status endpoint does.
 */
export async function orderSummary(fs, id, { key = null, authUid = null } = {}) {
  const denied = { status: 404, body: { ok: false, code: 'NOT_FOUND' } };
  if (!ORDER_ID_RE.test(id)) return denied;
  const normalized = normalizeTrackingKey(key);
  const keyHash = normalized ? await hashTrackingKey(normalized) : null; // computed even if the order is unknown
  const [orderDoc, ledgerDoc] = await fs.batchGet([`orders/${id}`, `orderLedger/${id}`]);
  if (!orderDoc.exists || !ledgerDoc.exists) return denied;
  const stored = ledgerDoc.fields?.trackingKeyHash?.stringValue || '';
  const byKey = keyHash !== null && TRACKING_KEY_HASH_RE.test(stored) && sameHex(keyHash, stored);
  const owner = verifiedOwner(ledgerDoc, orderDoc);
  const byOwner = !!authUid && owner !== null && owner === authUid;
  if (!byKey && !byOwner) return denied;
  return { status: 200, body: { ok: true, order: projectSummary(id, decodeFields(orderDoc.fields)) } };
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
      skip(r.priceRejected ? 'price_changed' : r.conflict ? 'conflict' : 'commit_failed');
    }
  }
  return { enabled: true, processed, skipped };
}
