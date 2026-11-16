// Minimal Firestore REST client (get / batchGet / commit / runQuery) + value codec.
// Auth: emulator ("Bearer owner") for local, service-account JWT for production.

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------
export function encode(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((v) => (v === undefined ? { nullValue: null } : encode(v))) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      fields[k] = encode(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export const encodeFields = (obj) => encode(obj).mapValue.fields;

export function decode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('referenceValue' in v) return v.referenceValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('geoPointValue' in v) return { ...v.geoPointValue };
  return null;
}

export const decodeFields = (fields = {}) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decode(v)]));

/** Numeric read of a raw REST value: int/double, or a purely numeric string. */
export function rawNumber(v) {
  if (!v) return { value: null, fromString: false };
  if ('integerValue' in v) return { value: Number(v.integerValue), fromString: false };
  if ('doubleValue' in v) return { value: Number(v.doubleValue), fromString: false };
  if ('stringValue' in v && /^\s*\d+(\.\d+)?\s*$/.test(v.stringValue)) {
    return { value: Number(v.stringValue), fromString: true };
  }
  return { value: null, fromString: false };
}

export const encodeNumber = (n) =>
  Number.isSafeInteger(n) ? { integerValue: String(n) } : { doubleValue: n };

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
export class FirestoreError extends Error {
  constructor(op, status, data) {
    super(`firestore ${op} failed: ${status} ${data?.error?.status || ''}`);
    this.status = status;
    this.code = data?.error?.status || '';
  }
}

const CONFLICT_CODES = new Set(['ALREADY_EXISTS', 'FAILED_PRECONDITION', 'ABORTED']);
export const isConflict = (r) => !r.ok && CONFLICT_CODES.has(r.data?.error?.status);

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

function docFrom(d) {
  return {
    exists: true,
    name: d.name,
    fields: d.fields || {},
    createTime: d.createTime,
    updateTime: d.updateTime,
  };
}

let tokenCache = { token: null, exp: 0 };

export class Firestore {
  constructor(cfg) {
    this.cfg = cfg;
    this.root = `projects/${cfg.projectId}/databases/(default)/documents`;
    this.base = `${cfg.urls.firestore.replace(/\/+$/, '')}/${this.root}`;
  }

  name(path) {
    return `${this.root}/${path}`;
  }

  async authHeaders() {
    if (this.cfg.firestoreAuth === 'emulator') return { authorization: 'Bearer owner' };
    const now = Math.floor(Date.now() / 1000);
    if (!tokenCache.token || tokenCache.exp - 60 < now) {
      tokenCache = await fetchServiceAccountToken(this.cfg, now);
    }
    return { authorization: `Bearer ${tokenCache.token}` };
  }

  async request(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(await this.authHeaders()) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  }

  async get(path) {
    const r = await this.request('GET', `${this.base}/${encodePath(path)}`);
    if (r.status === 404) return { exists: false };
    if (!r.ok) throw new FirestoreError('get', r.status, r.data);
    return docFrom(r.data);
  }

  async batchGet(paths) {
    if (paths.length === 0) return [];
    const r = await this.request('POST', `${this.base}:batchGet`, { documents: paths.map((p) => this.name(p)) });
    if (!r.ok) throw new FirestoreError('batchGet', r.status, r.data);
    const found = new Map();
    for (const item of r.data || []) if (item.found) found.set(item.found.name, docFrom(item.found));
    return paths.map((p) => found.get(this.name(p)) || { exists: false });
  }

  /** Returns { ok, status, data } — callers inspect isConflict(). */
  commit(writes) {
    return this.request('POST', `${this.base}:commit`, { writes });
  }

  async runQuery(structuredQuery) {
    const r = await this.request('POST', `${this.base}:runQuery`, { structuredQuery });
    if (!r.ok) throw new FirestoreError('runQuery', r.status, r.data);
    return (r.data || []).filter((x) => x.document).map((x) => docFrom(x.document));
  }
}

// ---------------------------------------------------------------------------
// Service-account OAuth (ported from worker v1, URL now configurable)
// ---------------------------------------------------------------------------
function base64Url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

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

async function fetchServiceAccountToken(cfg, now) {
  const enc = new TextEncoder();
  const header = base64Url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64Url(
    enc.encode(
      JSON.stringify({
        iss: cfg.serviceAccount.clientEmail,
        scope: 'https://www.googleapis.com/auth/datastore',
        aud: cfg.urls.oauth,
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(cfg.serviceAccount.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${payload}`));
  const res = await fetch(cfg.urls.oauth, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${payload}.${base64Url(sig)}`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error('oauth token request failed');
  return { token: data.access_token, exp: now + Number(data.expires_in || 3600) };
}
