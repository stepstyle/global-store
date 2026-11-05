// Synthetic Firebase Auth users for the STAGING tests (dairsharaf-staging only) — created at the start of a run,
// deleted at its end. Firebase Auth REST (Identity Toolkit) with the staging WEB API key: no service account, no
// admin endpoint. Every call goes through guardedFetch (staging/guard.mjs), which only allows signUp /
// signInWithPassword / delete with exactly that key.
//
// - e-mails: stg-<run>-<label>-<n>@example.invalid (a reserved, undeliverable domain)
// - passwords: random, kept in memory only for this run (needed to sign in again for the deletion)
// - every ID token is checked to belong to dairsharaf-staging (aud / iss / sub) before it is used
// - no password or token ever appears in an error message, a log line or a return value of cleanup()
// - cleanup(): deletes every user this run created (retries; signs in again if the token expired); what could not
//   be deleted is REPORTED (e-mails only) so it can be removed by hand — never silently ignored

import { randomBytes } from 'node:crypto';
import { StagingGuardError, STAGING_PROJECT_ID } from './guard.mjs';

const ITK = 'https://identitytoolkit.googleapis.com/v1';
export const TEST_EMAIL_DOMAIN = 'example.invalid';
const RUN_ID_RE = /^[a-z0-9]{6,16}$/;

export class StagingAuthError extends Error {
  constructor(step, status, code) {
    super(`Firebase Auth ${step} refused (${status}${code ? ` ${code}` : ''})`);
    this.name = 'StagingAuthError';
    this.step = step;
    this.status = status;
    this.code = code || '';
  }
}

const b64urlJson = (s) => JSON.parse(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
/** Claims of an ID token (no signature check here — the Worker verifies the signature against Google's keys). */
export function tokenClaims(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new StagingGuardError(['Firebase Auth returned something that is not an ID token']);
  try {
    return b64urlJson(parts[1]);
  } catch {
    throw new StagingGuardError(['Firebase Auth returned an unreadable ID token']);
  }
}
/** The token must belong to the staging project (else: wrong project / wrong API key — stop). */
export function assertStagingToken(idToken, { projectId = STAGING_PROJECT_ID, uid } = {}) {
  const c = tokenClaims(idToken);
  const p = [];
  if (c.aud !== projectId) p.push(`ID token audience is "${c.aud}", expected ${projectId}`);
  if (c.iss !== `https://securetoken.google.com/${projectId}`) p.push('ID token issuer is not the staging project');
  if (uid !== undefined && c.sub !== uid) p.push('ID token subject does not match the created user');
  if (p.length) throw new StagingGuardError(p);
  return c;
}

export function newRunId() {
  return randomBytes(6).toString('hex');
}

/**
 * @param st     validated staging config (assertStagingConfig)
 * @param deps   { fetch (guarded), runId, retries, retryDelayMs, sleep }
 */
export function makeStagingUsers(st, { fetch = globalThis.fetch, runId = newRunId(), retries = 3, retryDelayMs = 500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (st?.projectId !== STAGING_PROJECT_ID) throw new StagingGuardError([`test users may only be created in ${STAGING_PROJECT_ID}`]);
  if (!RUN_ID_RE.test(String(runId))) throw new StagingGuardError(['invalid run id']);
  const apiKey = String(st.firebaseWebConfig?.apiKey || '');
  if (!apiKey) throw new StagingGuardError(['staging web API key missing']);
  const created = []; // { label, email, password, uid, idToken, deleted }
  let n = 0;

  const call = async (step, body) => {
    const r = await fetch(`${ITK}/accounts:${step}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let j = null;
    try {
      j = await r.json();
    } catch {}
    if (!r.ok) throw new StagingAuthError(step, r.status, String(j?.error?.message || '').split(' ')[0].slice(0, 60));
    return j || {};
  };

  return {
    runId,
    emailPrefix: `stg-${runId}-`,
    /** A fresh synthetic customer: { uid, email, idToken }. */
    async create(label = 'u') {
      if (!/^[a-z0-9]{1,12}$/.test(label)) throw new StagingGuardError(['invalid user label']);
      n += 1;
      const email = `stg-${runId}-${label}-${n}@${TEST_EMAIL_DOMAIN}`;
      const password = randomBytes(18).toString('base64url');
      const j = await call('signUp', { email, password, returnSecureToken: true });
      const rec = { label, email, password, uid: String(j.localId || ''), idToken: String(j.idToken || ''), deleted: false };
      created.push(rec); // registered BEFORE the checks: cleanup also covers a user whose token is then refused
      assertStagingToken(rec.idToken, { uid: rec.uid });
      return { uid: rec.uid, email, idToken: rec.idToken };
    },
    /** A token-shaped string that is NOT a valid Google-signed ID token (for refusal tests). */
    forged() {
      const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      return `${enc({ alg: 'RS256', kid: 'forged', typ: 'JWT' })}.${enc({ aud: STAGING_PROJECT_ID, iss: `https://securetoken.google.com/${STAGING_PROJECT_ID}`, sub: 'forged-uid', iat: now, exp: now + 600 })}.${randomBytes(64).toString('base64url')}`;
    },
    /** e-mails of the users created so far (never passwords / tokens) */
    emails: () => created.map((u) => u.email),
    /** Deletes every user of this run. Returns { deleted, failed: [{ email, reason }] } — never throws. */
    async cleanup() {
      const failed = [];
      let deleted = 0;
      for (const u of created) {
        if (u.deleted) continue;
        let reason = '';
        for (let attempt = 1; attempt <= retries && !u.deleted; attempt++) {
          try {
            try {
              await call('delete', { idToken: u.idToken });
            } catch (e) {
              // expired / revoked token: sign in again (same password, in memory) and delete with the fresh token
              if (!(e instanceof StagingAuthError) || !/TOKEN|CREDENTIAL/.test(e.code)) throw e;
              const s = await call('signInWithPassword', { email: u.email, password: u.password, returnSecureToken: true });
              assertStagingToken(s.idToken, { uid: u.uid });
              u.idToken = String(s.idToken);
              await call('delete', { idToken: u.idToken });
            }
            u.deleted = true;
          } catch (e) {
            if (e instanceof StagingAuthError && /USER_NOT_FOUND|EMAIL_NOT_FOUND/.test(e.code)) {
              u.deleted = true; // already gone
              break;
            }
            reason = e instanceof StagingAuthError || e instanceof StagingGuardError ? e.message : 'network error';
            if (attempt < retries) await sleep(retryDelayMs * attempt);
          }
        }
        if (u.deleted) deleted += 1;
        else failed.push({ email: u.email, reason });
      }
      // nothing secret is kept after cleanup
      for (const u of created) {
        u.password = '';
        u.idToken = '';
      }
      return { deleted, failed };
    },
  };
}
