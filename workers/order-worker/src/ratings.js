// Product rating figures (ratingAvg / ratingCount + the legacy rating / reviews fields) are computed HERE, from the
// published reviews, with the Worker's service account. Browsers can no longer write them (firestore rules: products
// are admin-only), so a customer cannot set any star average on any product.
//
//   POST /products/:id/ratings   (Firebase ID token of any signed-in customer; rate limited)
// The caller is only a trigger: the result depends on the reviews stored in Firestore, never on the request body.

import { encodeFields, rawNumber } from './firestore.js';

export const PRODUCT_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
export const REVIEWS_SCAN_LIMIT = 2000;

/** 1..5 (rounded); a missing / non-numeric rating is IGNORED (null), never counted as a 1. */
const clampRating = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : null;
};

/** Published reviews only; rating rounded to one decimal; { avg: 0, count: 0 } when there is none. */
export function aggregateRatings(reviews) {
  let sum = 0;
  let count = 0;
  for (const r of reviews) {
    if ((r.status ?? 'published') !== 'published') continue;
    const v = clampRating(r.rating);
    if (v === null) continue;
    sum += v;
    count += 1;
  }
  return { avg: count ? Math.round((sum / count) * 10) / 10 : 0, count };
}

/** rawNumber() returns { value, fromString }; only a real stored number counts */
const num = (f) => {
  const { value } = rawNumber(f);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export async function recomputeProductRating(fs, productId) {
  if (!PRODUCT_ID_RE.test(productId)) return { status: 400, body: { ok: false, code: 'INVALID_ID' } };
  const product = await fs.get(`products/${productId}`);
  if (!product.exists) return { status: 404, body: { ok: false, code: 'NOT_FOUND' } };
  const docs = await fs.runQuery({
    from: [{ collectionId: 'reviews' }],
    where: { fieldFilter: { field: { fieldPath: 'productId' }, op: 'EQUAL', value: { stringValue: productId } } },
    select: { fields: [{ fieldPath: 'rating' }, { fieldPath: 'status' }] },
    limit: REVIEWS_SCAN_LIMIT,
  });
  const reviews = docs.map((d) => ({ rating: num(d.fields?.rating), status: d.fields?.status?.stringValue }));
  const { avg, count } = aggregateRatings(reviews);
  const f = product.fields || {};
  if (num(f.ratingAvg) === avg && num(f.ratingCount) === count && num(f.rating) === avg && num(f.reviews) === count) {
    return { status: 200, body: { ok: true, avg, count, changed: false } };
  }
  const fields = { ratingAvg: avg, ratingCount: count, rating: avg, reviews: count };
  // only these four fields are written (updateMask); the product must still exist
  const r = await fs.commit([{
    update: { name: fs.name(`products/${productId}`), fields: encodeFields(fields) },
    updateMask: { fieldPaths: Object.keys(fields) },
    currentDocument: { exists: true },
  }]);
  if (!r.ok) return { status: 503, body: { ok: false, code: 'UNAVAILABLE' } };
  return { status: 200, body: { ok: true, avg, count, changed: true } };
}
