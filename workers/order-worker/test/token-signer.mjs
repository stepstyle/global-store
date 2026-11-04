// TEST-ONLY Firebase-style ID token signer. Generates a fresh RSA key pair in memory on every run (never written
// to disk, never a real Google/Firebase key) and signs tokens shaped like Firebase Authentication ID tokens.
// The Worker verifies them against the matching public JWK served by a LOCAL mock (127.0.0.1).

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

/**
 * @param {string} kid
 * @returns {Promise<{ kid: string, jwk: object, sign(claims: object, header?: object): Promise<string>,
 *                     idToken(o: { projectId: string, uid: string, nowSec?: number, ttlSec?: number, extra?: object }): Promise<string> }>}
 */
export async function makeTestSigner(kid) {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pub = await crypto.subtle.exportKey('jwk', publicKey);
  const jwk = { kty: 'RSA', n: pub.n, e: pub.e, alg: 'RS256', use: 'sig', kid };

  async function sign(claims, header = {}) {
    const h = { alg: 'RS256', typ: 'JWT', kid, ...header };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    const c = { ...claims };
    for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
    const data = `${enc(h)}.${enc(c)}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(data));
    return `${data}.${b64url(new Uint8Array(sig))}`;
  }

  async function idToken({ projectId, uid, nowSec = Math.floor(Date.now() / 1000), ttlSec = 3600, extra = {} }) {
    return sign({
      iss: `https://securetoken.google.com/${projectId}`, aud: projectId, sub: uid, user_id: uid,
      auth_time: nowSec - 300, iat: nowSec - 5, exp: nowSec + ttlSec, firebase: { sign_in_provider: 'password' }, ...extra,
    });
  }

  return { kid, jwk, sign, idToken };
}
