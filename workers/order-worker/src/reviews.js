// Verified-purchase product reviews. A review is accepted ONLY here, for a REAL order that was DELIVERED and a product
// that is IN that order; the Firestore rules refuse every review written by a browser.
//
//   POST /admin/orders/:id/review-link   admin (ID token): a private link for a delivered order -> { url, expiresAt }
//   POST /reviews/state                  { orderId, token } or the signed-in owner (ID token): what can be reviewed
//   POST /reviews/submit                 { orderId, token?, productId, rating 1..5, comment?, name }
//   POST /reviews/eligible               signed-in (ID token) { productId }: the customer's delivered orders of it
//   POST /admin/reviews/:id/moderate     admin: flag / hide (with a reason) / publish again — never "delete"
//
// Who may review an order:
//   - the holder of the order's review link. The admin creates it (only for a delivered order) and sends it by hand.
//     Token: 120 random bits (24 Crockford chars) generated HERE; only sha256("rvw1:" + token) is stored, in
//     reviewInvites/{orderId} (no Firestore rule matches it: browsers can neither read nor write it). A new link
//     replaces the old one (the old link stops working). Links expire (REVIEW_LINK_DAYS, default 90).
//   - the signed-in account that OWNS the order — proven by the Worker's own ledger (ownerUid, or a userId the
//     Worker verified at creation), never by a userId a browser wrote.
// Every refusal before the proof (unknown order, wrong / expired token, not the owner) answers the same 404, so the
// endpoint tells nothing about which order numbers exist.
//
// One review per product per order, whatever the number of pieces and whichever way (link or account): the review
// and its private key reviewKeys/{orderId}__{productId} are created in ONE commit, both with exists:false. Two
// simultaneous submits cannot both succeed; a repeat answers 409 ALREADY_REVIEWED.
//
// Privacy: the public review holds the display name the customer chose, the stars, the comment, the colour / size
// bought and "verified purchase" — never the order number, phone, address, e-mail or account id. The order number
// lives only in the private key document. Nothing here touches the order, its stock, the ledger or the wheel.

import { decodeFields, encodeFields, isConflict } from './firestore.js';
import { ORDER_ID_RE } from './validate.js';
import { sameHex } from './tracking.js';
import { GENERIC_GIFT_PRODUCT } from './wheel.js';
import { recomputeProductRating, PRODUCT_ID_RE } from './ratings.js';
import { log } from './http.js';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I, L, O, U)
export const REVIEW_TOKEN_RE = /^[0-9A-HJKMNP-TV-Z]{24}$/;
export const REVIEW_ID_RE = /^[A-Za-z0-9_-]{1,160}$/;
export const COMMENT_MAX = 1000;
export const NAME_MIN = 2;
export const NAME_MAX = 40;
export const MAX_ITEMS = 30;
/** reasons an admin may hide or flag a review for. A negative opinion is NOT one of them. */
export const MODERATION_REASONS = Object.freeze(['abusive', 'personal_data', 'spam', 'off_topic', 'other']);
const MODERATION_LOG_MAX = 20;

const notFound = () => ({ status: 404, body: { ok: false, code: 'NOT_FOUND' } });
const refuse = (status, code, extra = {}) => ({ status, body: { ok: false, code, ...extra } });

/** 24 Crockford base32 characters from 120 random bits (each byte & 31: uniform, 256 is a multiple of 32) */
export function newReviewToken() {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => B32[b & 31]).join('');
}
/** "abcd-efgh …" -> "ABCDEFGH…" (Crockford: O->0, I/L->1), or null when it cannot be a review token */
export function normalizeReviewToken(input) {
  if (typeof input !== 'string' || input.length > 64) return null;
  const k = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return REVIEW_TOKEN_RE.test(k) ? k : null;
}
export async function hashReviewToken(normalizedToken) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rvw1:${normalizedToken}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const newReviewId = () => `vr_${[...crypto.getRandomValues(new Uint8Array(20))].map((b) => B32[b & 31]).join('')}`;
export const reviewKeyPath = (orderId, productId) => `reviewKeys/${orderId}__${productId}`;

/**
 * Plain text of a customer field: NFC, control characters removed (a line break kept in comments), spaces collapsed,
 * trimmed. Returns null when it is not a string. HTML is NOT stripped: the store shows it as text, never as markup.
 */
export function cleanText(v, { multiline = false } = {}) {
  if (typeof v !== 'string') return null;
  let s = v.normalize('NFC').replace(/\r\n?/g, '\n');
  // C0 / C1 controls, bidi overrides and zero-width characters (they can disguise text); \n kept for comments only
  s = s.replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, '');
  if (multiline) s = s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n');
  else s = s.replace(/\s+/g, ' ');
  return s.trim();
}

/** integer 1..5 only (a string, 4.5, 0 or 6 is refused, never rounded into a valid rating) */
export const validRating = (v) => Number.isInteger(v) && v >= 1 && v <= 5;

/**
 * The products of an order that can be reviewed: one entry per product (several pieces / colours of the same product
 * = ONE review), wheel gifts excluded (not bought). Name / image / colour come from the order itself.
 */
export function reviewableItems(order) {
  const byId = new Map();
  for (const it of Array.isArray(order?.items) ? order.items : []) {
    const pid = typeof it?.productId === 'string' ? it.productId : '';
    if (!PRODUCT_ID_RE.test(pid) || pid === GENERIC_GIFT_PRODUCT || it?.gift === true) continue;
    const variant = typeof it?.selectedVariant?.label === 'string' && it.selectedVariant.label.trim() !== '.' ? it.selectedVariant.label.trim().slice(0, 80) : '';
    const e = byId.get(pid);
    if (e) {
      if (variant && !e.variants.includes(variant)) e.variants.push(variant);
      continue;
    }
    if (byId.size >= MAX_ITEMS) break;
    byId.set(pid, {
      productId: pid,
      name: typeof it?.name === 'string' ? it.name.slice(0, 200) : '',
      // an http(s) picture, or one of the site's own pictures ("/images/…"); nothing else (no data:, no javascript:)
      image: typeof it?.image === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(it.image) && it.image.length <= 500 ? it.image : '',
      variants: variant ? [variant] : [],
    });
  }
  return [...byId.values()];
}

/** the account that owns an order, ONLY as recorded by the Worker (ledger owner, or a userId it verified) */
function verifiedOwner(order, ledger) {
  if (!ledger) return null;
  if (typeof ledger.ownerUid === 'string' && ledger.ownerUid) return ledger.ownerUid;
  if (ledger.userIdVerified === true || order?.userIdVerified === true) {
    const u = typeof order?.userId === 'string' ? order.userId : '';
    return u && u !== 'guest' ? u : null;
  }
  return null;
}

const firstName = (order) => {
  const n = cleanText(order?.address?.fullName ?? order?.address?.name ?? '') || '';
  return n.split(' ')[0].slice(0, NAME_MAX);
};

/**
 * Proof that the caller may review THIS order. { ok, order, via } or a refusal.
 * Proof first (404 for any failure), then the order's state (the caller is legitimate and may be told why).
 */
async function access(fs, { orderId, token, uid, now }) {
  if (!ORDER_ID_RE.test(String(orderId || ''))) return { refusal: notFound() };
  const normalized = token === undefined || token === null ? null : normalizeReviewToken(token);
  if (token !== undefined && token !== null && normalized === null) return { refusal: notFound() };
  if (normalized === null && !uid) return { refusal: notFound() };
  const tokenHash = normalized ? await hashReviewToken(normalized) : null; // computed even for an unknown order

  const [orderDoc, ledgerDoc, inviteDoc] = await fs.batchGet([`orders/${orderId}`, `orderLedger/${orderId}`, `reviewInvites/${orderId}`]);
  if (!orderDoc.exists) return { refusal: notFound() };
  const order = decodeFields(orderDoc.fields);
  const ledger = ledgerDoc.exists ? decodeFields(ledgerDoc.fields) : null;
  let via;
  if (tokenHash) {
    const inv = inviteDoc.exists ? decodeFields(inviteDoc.fields) : null;
    if (!inv || !sameHex(tokenHash, String(inv.tokenHash || ''))) return { refusal: notFound() };
    const exp = inv.expiresAt instanceof Date ? inv.expiresAt.getTime() : NaN;
    if (!(exp > now)) return { refusal: refuse(410, 'LINK_EXPIRED') };
    via = 'link';
  } else {
    if (verifiedOwner(order, ledger) !== uid) return { refusal: notFound() };
    via = 'account';
  }
  if (order.status !== 'delivered') return { refusal: refuse(409, 'NOT_DELIVERED') };
  return { order, via };
}

async function reviewedMap(fs, orderId, items) {
  const docs = items.length ? await fs.batchGet(items.map((i) => reviewKeyPath(orderId, i.productId))) : [];
  return new Map(items.map((i, k) => [i.productId, docs[k].exists ? decodeFields(docs[k].fields) : null]));
}

/** POST /reviews/state — what this order lets the caller review. No personal data except the buyer's first name
 *  (a suggestion for the display name, shown only to the holder of the private link). */
export async function reviewState(fs, { orderId, token, uid, now = () => Date.now() }) {
  const a = await access(fs, { orderId, token, uid, now: now() });
  if (a.refusal) return a.refusal;
  const items = reviewableItems(a.order);
  const productDocs = items.length ? await fs.batchGet(items.map((i) => `products/${i.productId}`)) : [];
  const done = await reviewedMap(fs, orderId, items);
  return {
    status: 200,
    body: {
      ok: true,
      orderId,
      via: a.via,
      date: typeof a.order.date === 'string' ? a.order.date.slice(0, 10) : '',
      suggestedName: a.via === 'link' ? firstName(a.order) : '',
      items: items.map((i, k) => {
        const d = done.get(i.productId);
        return { ...i, available: productDocs[k].exists, reviewed: !!d, ...(d ? { rating: d.rating ?? null } : {}) };
      }),
    },
  };
}

/** POST /reviews/submit — one review for one product of one delivered order (atomic, never twice). */
export async function submitReview(fs, cfg, { orderId, token, uid, productId, rating, comment, name, now = () => Date.now() }) {
  const a = await access(fs, { orderId, token, uid, now: now() });
  if (a.refusal) return a.refusal;
  const pid = typeof productId === 'string' ? productId : '';
  const item = reviewableItems(a.order).find((i) => i.productId === pid);
  if (!item) return refuse(422, 'PRODUCT_NOT_IN_ORDER');
  if (!validRating(rating)) return refuse(422, 'INVALID_RATING');
  const text = comment === undefined || comment === null ? '' : cleanText(comment, { multiline: true });
  if (text === null || text.length > COMMENT_MAX) return refuse(422, 'INVALID_COMMENT', { max: COMMENT_MAX });
  const display = cleanText(name);
  if (display === null || display.length < NAME_MIN || display.length > NAME_MAX) return refuse(422, 'INVALID_NAME', { min: NAME_MIN, max: NAME_MAX });

  const product = await fs.get(`products/${pid}`);
  if (!product.exists) return refuse(409, 'PRODUCT_UNAVAILABLE');

  const reviewId = newReviewId();
  const at = new Date(now()).toISOString();
  const review = {
    productId: pid,
    userId: 'verified-buyer', // never the account id: the review is public
    userName: display,
    rating,
    comment: text,
    status: 'published',
    verifiedPurchase: true,
    purchasedVariant: item.variants.join('، ').slice(0, 120),
    likesCount: 0,
    likesBy: {},
    adminReply: null,
    moderation: { flagged: false },
  };
  const r = await fs.commit([
    {
      update: { name: fs.name(reviewKeyPath(orderId, pid)), fields: encodeFields({ reviewId, orderId, productId: pid, rating, via: a.via, at, ...(a.via === 'account' ? { uid } : {}) }) },
      currentDocument: { exists: false },
    },
    {
      update: { name: fs.name(`reviews/${reviewId}`), fields: encodeFields(review) },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }, { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    },
  ]);
  if (!r.ok) {
    if (isConflict(r)) {
      log('review.duplicate', { orderId });
      return refuse(409, 'ALREADY_REVIEWED');
    }
    log('review.submit_failed', { orderId, status: r.status });
    return refuse(503, 'UNAVAILABLE');
  }
  log('review.created', { orderId, via: a.via });
  // the product's star figures: recomputed from the stored reviews now (a failure is fixed by the next recompute)
  const agg = await recomputeProductRating(fs, pid).catch(() => null);
  return { status: 200, body: { ok: true, reviewId, ...(agg?.body?.ok ? { ratingAvg: agg.body.avg, ratingCount: agg.body.count } : {}) } };
}

/** POST /reviews/eligible — the signed-in customer's delivered, not yet reviewed orders that contain this product. */
export async function eligibleOrders(fs, { uid, productId }) {
  if (!PRODUCT_ID_RE.test(String(productId || ''))) return refuse(400, 'INVALID_ID');
  const docs = await fs.runQuery({
    from: [{ collectionId: 'orders' }],
    where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: uid } } },
    limit: 200,
  });
  const candidates = docs
    .map((d) => ({ id: d.name.split('/').pop(), o: decodeFields(d.fields) }))
    .filter(({ id, o }) => ORDER_ID_RE.test(id) && o.status === 'delivered' && reviewableItems(o).some((i) => i.productId === productId))
    .slice(0, 20);
  if (!candidates.length) return { status: 200, body: { ok: true, orders: [] } };
  const [ledgers, keys] = await Promise.all([
    fs.batchGet(candidates.map((c) => `orderLedger/${c.id}`)),
    fs.batchGet(candidates.map((c) => reviewKeyPath(c.id, productId))),
  ]);
  const orders = candidates
    .filter((c, k) => verifiedOwner(c.o, ledgers[k].exists ? decodeFields(ledgers[k].fields) : null) === uid && !keys[k].exists)
    .map((c) => ({ orderId: c.id, date: typeof c.o.date === 'string' ? c.o.date.slice(0, 10) : '', variants: reviewableItems(c.o).find((i) => i.productId === productId).variants }));
  return { status: 200, body: { ok: true, orders } };
}

/** POST /admin/orders/:id/review-link — admin only (checked by the caller). Only for a delivered order. */
export async function createReviewLink(fs, cfg, { orderId, adminUid, rotate = false, origin, now = () => Date.now() }) {
  if (!ORDER_ID_RE.test(String(orderId || ''))) return refuse(400, 'INVALID_ID');
  const [orderDoc, inviteDoc] = await fs.batchGet([`orders/${orderId}`, `reviewInvites/${orderId}`]);
  if (!orderDoc.exists) return refuse(404, 'NOT_FOUND');
  const order = decodeFields(orderDoc.fields);
  if (order.status !== 'delivered') return refuse(409, 'NOT_DELIVERED');
  const items = reviewableItems(order);
  if (!items.length) return refuse(409, 'NOTHING_TO_REVIEW');
  const prev = inviteDoc.exists ? decodeFields(inviteDoc.fields) : null;
  if (prev && rotate !== true) {
    return refuse(409, 'LINK_EXISTS', {
      createdAt: prev.createdAt instanceof Date ? prev.createdAt.toISOString() : null,
      expiresAt: prev.expiresAt instanceof Date ? prev.expiresAt.toISOString() : null,
    });
  }
  const token = newReviewToken();
  const t = now();
  const expiresAt = new Date(t + cfg.reviewLinkDays * 24 * 60 * 60 * 1000);
  const r = await fs.commit([{
    update: {
      name: fs.name(`reviewInvites/${orderId}`),
      fields: encodeFields({ tokenHash: await hashReviewToken(token), createdAt: new Date(t), createdBy: adminUid, expiresAt, rotations: (Number.isInteger(prev?.rotations) ? prev.rotations : -1) + 1 }),
    },
    currentDocument: inviteDoc.exists ? { updateTime: inviteDoc.updateTime } : { exists: false },
  }]);
  if (!r.ok) return isConflict(r) ? refuse(409, 'BUSY') : refuse(503, 'UNAVAILABLE');
  const done = await reviewedMap(fs, orderId, items);
  log('review.link_created', { orderId, rotated: !!prev });
  return {
    status: 200,
    body: {
      ok: true,
      url: `${origin}/#/review/${encodeURIComponent(orderId)}/${token}`,
      expiresAt: expiresAt.toISOString(),
      replaced: !!prev,
      items: items.length,
      reviewed: [...done.values()].filter(Boolean).length,
    },
  };
}

/**
 * POST /admin/reviews/:id/moderate — admin only (checked by the caller).
 *   flag    mark for review (stays visible), reason required
 *   unflag  review done, nothing wrong (stays visible)
 *   hide    removed from the store, reason required (abusive, personal data, spam, off topic, other + note)
 *   publish shown again
 * There is no "negative" reason and no delete for a verified review: a bad opinion is not a reason to remove it.
 */
export async function moderateReview(fs, { reviewId, action, reason, note, adminUid, now = () => Date.now() }) {
  if (!REVIEW_ID_RE.test(String(reviewId || ''))) return refuse(400, 'INVALID_ID');
  if (!['flag', 'unflag', 'hide', 'publish'].includes(action)) return refuse(422, 'INVALID_ACTION');
  const needsReason = action === 'flag' || action === 'hide';
  if (needsReason && !MODERATION_REASONS.includes(reason)) return refuse(422, 'INVALID_REASON', { reasons: MODERATION_REASONS });
  const cleanNote = note === undefined || note === null ? '' : cleanText(note);
  if (cleanNote === null || cleanNote.length > 200) return refuse(422, 'INVALID_NOTE');
  if (needsReason && reason === 'other' && cleanNote.length < 3) return refuse(422, 'NOTE_REQUIRED');

  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = await fs.get(`reviews/${reviewId}`);
    if (!doc.exists) return refuse(404, 'NOT_FOUND');
    const cur = decodeFields(doc.fields);
    const at = new Date(now()).toISOString();
    const entry = { action, reason: needsReason ? reason : '', note: cleanNote, by: adminUid, at };
    const status = action === 'hide' ? 'hidden' : action === 'publish' ? 'published' : (cur.status === 'hidden' ? 'hidden' : 'published');
    const moderation = {
      flagged: action === 'flag',
      reason: needsReason ? reason : '',
      note: cleanNote,
      by: adminUid,
      at,
      lastAction: action,
      log: [...(Array.isArray(cur.moderation?.log) ? cur.moderation.log : []), entry].slice(-MODERATION_LOG_MAX),
    };
    const r = await fs.commit([{
      update: { name: fs.name(`reviews/${reviewId}`), fields: encodeFields({ status, moderation }) },
      updateMask: { fieldPaths: ['status', 'moderation'] },
      currentDocument: { updateTime: doc.updateTime },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    }]);
    if (r.ok) {
      log('review.moderated', { action, reason: entry.reason });
      if (typeof cur.productId === 'string') await recomputeProductRating(fs, cur.productId).catch(() => null);
      return { status: 200, body: { ok: true, status, flagged: moderation.flagged } };
    }
    if (!isConflict(r)) return refuse(503, 'UNAVAILABLE');
  }
  return refuse(409, 'BUSY');
}
