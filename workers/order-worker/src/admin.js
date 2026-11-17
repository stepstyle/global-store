// Admin identity for dashboard actions (POST /admin/orders/:id/status).
//
// 1. "Authorization: Bearer <Firebase ID token>" verified with src/auth.js (signature, issuer, audience, expiry).
// 2. The verified uid must be the store owner (config/roles.ownerUid) or have an admins/{uid} document whose
//    `active` is not false — read with the Worker's service account, the same documents the Firestore rules use.
// Nothing from the request body is ever used as identity. Answers: 401 (no / bad token), 403 NOT_ADMIN, 503.
import { AuthError, bearerToken, verifyFirebaseIdToken } from './auth.js';
import { decodeFields } from './firestore.js';
import { log } from './http.js';

const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** @returns {{ ok: true, uid: string } | { ok: false, status: number, code: string }} */
export async function requireAdmin(request, fs, cfg) {
  let uid;
  try {
    const token = bearerToken(request.headers.get('authorization'));
    if (token === undefined) return { ok: false, status: 401, code: 'AUTH_REQUIRED' };
    uid = (await verifyFirebaseIdToken(token, { projectId: cfg.projectId, jwksUrl: cfg.authJwksUrl })).uid;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    log('admin.auth_rejected', { code: e.code, reason: e.reason });
    return e.code === 'AUTH_UNAVAILABLE' ? { ok: false, status: 503, code: 'AUTH_UNAVAILABLE' } : { ok: false, status: 401, code: e.code };
  }
  if (!UID_RE.test(uid)) return { ok: false, status: 403, code: 'NOT_ADMIN' };
  const [roles, admin] = await fs.batchGet(['config/roles', `admins/${uid}`]);
  const ownerUid = roles.exists ? decodeFields(roles.fields).ownerUid : null;
  if (typeof ownerUid === 'string' && ownerUid && ownerUid === uid) return { ok: true, uid };
  if (admin.exists && decodeFields(admin.fields).active !== false) return { ok: true, uid };
  log('admin.not_admin', {});
  return { ok: false, status: 403, code: 'NOT_ADMIN' };
}
