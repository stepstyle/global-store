// LOCAL CPU probe: runs the exact WebCrypto calls of src/firestore.js fetchServiceAccountToken()
// (importKey pkcs8 RSASSA-PKCS1-v1_5/SHA-256 + sign) n times, without any network request.
//   GET /jwt?n=50        -> importKey + sign, n times (cold token: what a new isolate pays once per hour)
//   GET /sign-only?n=50  -> one importKey, then n signs
//   GET /prep            -> make a TEST RSA key pair + one Firebase-style ID token (outside any measured batch)
//   GET /verify-cold?n=  -> n x src/auth.js verifyFirebaseIdToken with an EMPTY key cache (JWK parse + importKey + verify:
//                           what a new isolate pays on its first signed-in request; keys come from an in-memory fake fetch)
//   GET /verify-warm?n=  -> keys cached once, then n x verifyFirebaseIdToken (every later signed-in request)
//   GET /tracking-hash?n= -> n x src/tracking.js normalize + sha-256 (create with a key / summary)
//   GET /                -> ok
import { verifyFirebaseIdToken, clearKeyCache } from '../../src/auth.js';
import { normalizeTrackingKey, hashTrackingKey } from '../../src/tracking.js';

const PROJECT = 'demo-cpu-probe';
let prepared = null; // { token, jwks, nowMs }
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
async function prep() {
  const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', publicKey);
  const now = Math.floor(Date.now() / 1000);
  const data = `${enc({ alg: 'RS256', typ: 'JWT', kid: 'probe' })}.${enc({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'probe-uid', iat: now, auth_time: now, exp: now + 3600 })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(data));
  prepared = { token: `${data}.${b64url(sig)}`, jwks: JSON.stringify({ keys: [{ kty: 'RSA', n: pub.n, e: pub.e, alg: 'RS256', use: 'sig', kid: 'probe' }] }) };
}
const verifyOnce = () =>
  verifyFirebaseIdToken(prepared.token, {
    projectId: PROJECT, jwksUrl: 'http://probe.local/jwks',
    fetch: async () => new Response(prepared.jwks, { status: 200, headers: { 'cache-control': 'max-age=3600' } }),
  });

function pemToArrayBuffer(pem) {
  const b64 = String(pem || '')
    .replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const importKey = (pem) => crypto.subtle.importKey('pkcs8', pemToArrayBuffer(pem), ALG, false, ['sign']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const n = Math.max(1, Math.min(200, Number(url.searchParams.get('n') || 1)));
    const data = new TextEncoder().encode('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJwcm9iZSJ9');
    if (url.pathname === '/jwt') {
      for (let i = 0; i < n; i++) {
        const key = await importKey(env.PROBE_PRIVATE_KEY);
        await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
      }
      return Response.json({ ok: true, n });
    }
    if (url.pathname === '/sign-only') {
      const key = await importKey(env.PROBE_PRIVATE_KEY);
      for (let i = 0; i < n; i++) await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
      return Response.json({ ok: true, n });
    }
    if (url.pathname === '/prep') {
      await prep();
      clearKeyCache();
      await verifyOnce(); // sanity: the token verifies
      return Response.json({ ok: true });
    }
    if (url.pathname === '/verify-cold') {
      for (let i = 0; i < n; i++) {
        clearKeyCache();
        await verifyOnce();
      }
      return Response.json({ ok: true, n });
    }
    if (url.pathname === '/verify-warm') {
      clearKeyCache();
      await verifyOnce();
      for (let i = 0; i < n; i++) await verifyOnce();
      return Response.json({ ok: true, n });
    }
    if (url.pathname === '/tracking-hash') {
      for (let i = 0; i < n; i++) await hashTrackingKey(normalizeTrackingKey('7k3m-9p2q-4r6t-8v0w-1x5y-7z9a'));
      return Response.json({ ok: true, n });
    }
    return Response.json({ ok: true, probe: 'cpu' });
  },
};
