// Link a GUEST order to the signed-in customer's account.
//
//   POST /orders/:id/claim   headers: Authorization: Bearer <Firebase ID token>, x-tracking-key: <the order's key>
//
// Ownership is proven ONLY by the order's tracking key (its sha256 is in orderLedger, written once at creation by the
// Worker) + a verified Firebase identity. Name, phone or e-mail are never proof.
//   - a guest order is linked once: order.userId = uid, ledger.ownerUid = uid (+ claim time) — both in ONE commit
//     with updateTime preconditions, so two simultaneous claims cannot both win (the loser re-reads and gets
//     ALREADY_LINKED, or "already yours").
//   - an order that already belongs to an account (verified owner or a non-guest userId) is never moved.
//   - every refusal of the key looks the same (404 NOT_FOUND): no hint whether an order number exists.
// The log keeps the order number and the outcome only (no uid, no key, no personal data).

import { encodeFields, isConflict } from './firestore.js';
import { ORDER_ID_RE } from './validate.js';
import { normalizeTrackingKey, hashTrackingKey, sameHex, TRACKING_KEY_HASH_RE } from './tracking.js';
import { log } from './http.js';

export const CLAIM_ATTEMPTS = 4;

function owner(ledgerDoc, orderDoc) {
  const f = ledgerDoc.fields || {};
  const ownerUid = f.ownerUid?.stringValue;
  if (ownerUid) return ownerUid;
  const userId = orderDoc.fields?.userId?.stringValue || '';
  if (f.userIdVerified?.booleanValue === true) return userId && userId !== 'guest' ? userId : '\u0000unknown';
  // an unverified non-guest userId (old orders) still belongs to someone: never moved by a claim
  return userId && userId !== 'guest' ? userId : null;
}

export async function claimOrder(fs, { id, key, uid, now = () => Date.now() }) {
  const notFound = { status: 404, body: { ok: false, code: 'NOT_FOUND' } };
  if (!ORDER_ID_RE.test(String(id || '')) || typeof uid !== 'string' || !uid) return notFound;
  const normalized = normalizeTrackingKey(key);
  const keyHash = normalized ? await hashTrackingKey(normalized) : null; // computed even for an unknown order

  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const [orderDoc, ledgerDoc] = await fs.batchGet([`orders/${id}`, `orderLedger/${id}`]);
    if (!orderDoc.exists || !ledgerDoc.exists) return notFound;
    const stored = ledgerDoc.fields?.trackingKeyHash?.stringValue || '';
    if (!(keyHash !== null && TRACKING_KEY_HASH_RE.test(stored) && sameHex(keyHash, stored))) return notFound;

    const current = owner(ledgerDoc, orderDoc);
    if (current === uid) return { status: 200, body: { ok: true, linked: false, alreadyYours: true } };
    if (current !== null) {
      log('order.claim_refused', { orderId: id, reason: 'already_linked' });
      return { status: 409, body: { ok: false, code: 'ALREADY_LINKED' } };
    }

    const at = new Date(now()).toISOString();
    const r = await fs.commit([
      {
        update: { name: fs.name(`orders/${id}`), fields: encodeFields({ userId: uid, userIdVerified: true }) },
        updateMask: { fieldPaths: ['userId', 'userIdVerified'] },
        currentDocument: { updateTime: orderDoc.updateTime },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }, { fieldPath: 'linkedAt', setToServerValue: 'REQUEST_TIME' }],
      },
      {
        update: { name: fs.name(`orderLedger/${id}`), fields: { ownerUid: { stringValue: uid }, claim: encodeFields({ c: { method: 'tracking-key', at } }).c } },
        updateMask: { fieldPaths: ['ownerUid', 'claim'] },
        currentDocument: { updateTime: ledgerDoc.updateTime },
      },
    ]);
    if (r.ok) {
      log('order.claimed', { orderId: id });
      return { status: 200, body: { ok: true, linked: true } };
    }
    if (!isConflict(r)) {
      log('order.claim_failed', { orderId: id, status: r.status });
      return { status: 503, body: { ok: false, code: 'UNAVAILABLE' } };
    }
    // someone changed the order / ledger meanwhile (another claim, a status change): re-read and decide again
  }
  return { status: 409, body: { ok: false, code: 'BUSY' } };
}
