// The product a visitor LANDS on (an ad link straight to #/product/<id>) is read ON ITS OWN, as soon as the app starts,
// instead of waiting for the whole catalogue (measured on a slow phone: the catalogue read ends ~11 s after the click,
// the product's own document is a few KB). Same public document, same project, read with the public API key exactly
// like the catalogue read (rules: products `allow read: if true`); a plain GET = no CORS preflight round trip.
//
// The answer is used ONLY when it is plain data that the SDK would return identically (strings, numbers, booleans,
// null, arrays, maps). Anything else (a Timestamp, a reference, a GeoPoint, bytes), a missing document, a network or
// rules error -> null, and the page simply waits for the catalogue as before. The catalogue stays the source for
// everything else on the page (similar products, the cart, search) and replaces this copy when it arrives.

import type { Product } from '../types';

/** where to read: the cloud project (production; staging in local development) via Firestore REST + its public API key,
 * or the local Firestore emulator (local tests only) */
export type EarlyReadTarget =
  | { kind: 'cloud'; projectId: string; apiKey: string }
  | { kind: 'emulator'; projectId: string; host: string; port: number };

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** the product id of an ad / shared link: '#/product/<id>' (optionally followed by '?…' or '/…'); anything else -> null */
export function landingProductId(hash: string): string | null {
  const m = /^#\/product\/([^/?#]+)(?:[/?].*)?$/.exec(String(hash || ''));
  if (!m) return null;
  let id: string;
  try { id = decodeURIComponent(m[1]); } catch { return null; }
  return ID_RE.test(id) ? id : null;
}

export function productDocUrl(t: EarlyReadTarget, id: string): string | null {
  if (!ID_RE.test(id) || !/^[a-z0-9-]{1,64}$/.test(t.projectId)) return null;
  const path = `/v1/projects/${t.projectId}/databases/(default)/documents/products/${id}`;
  if (t.kind === 'cloud') return /^[A-Za-z0-9_-]{10,100}$/.test(t.apiKey) ? `https://firestore.googleapis.com${path}?key=${t.apiKey}` : null;
  if (!/^(127\.0\.0\.1|localhost)$/.test(t.host) || !Number.isInteger(t.port)) return null;
  return `http://${t.host}:${t.port}${path}`;
}

class Special extends Error {}

/** one Firestore REST value -> the same JS value the SDK gives; a special type throws Special */
function decodeValue(v: any): unknown {
  if (!v || typeof v !== 'object') throw new Special();
  if ('stringValue' in v) return String(v.stringValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('nullValue' in v) return null;
  if ('integerValue' in v) {
    const n = Number(v.integerValue);
    // the SDK gives a JS number too; a value it could not represent exactly is left to the SDK read
    if (!Number.isSafeInteger(n)) throw new Special();
    return n;
  }
  if ('doubleValue' in v) {
    const n = typeof v.doubleValue === 'number' ? v.doubleValue : Number(v.doubleValue);
    if (Number.isNaN(n) && v.doubleValue !== 'NaN') throw new Special();
    return n;
  }
  if ('mapValue' in v) return decodeFields(v.mapValue?.fields);
  if ('arrayValue' in v) return (Array.isArray(v.arrayValue?.values) ? v.arrayValue.values : []).map(decodeValue);
  // timestampValue / referenceValue / geoPointValue / bytesValue / anything new: not plain data
  throw new Special();
}

function decodeFields(fields: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields && typeof fields === 'object') for (const k of Object.keys(fields)) out[k] = decodeValue(fields[k]);
  return out;
}

/** a Firestore REST document of `products/<id>` -> the same object the catalogue read builds ({...data, id}); else null */
export function decodeProductDocument(json: any, id: string): Product | null {
  try {
    if (!json || typeof json !== 'object' || typeof json.name !== 'string') return null;
    if (!json.name.endsWith(`/documents/products/${id}`)) return null;
    const data = decodeFields(json.fields);
    return { ...(data as any), id } as Product;
  } catch {
    return null;
  }
}

let early: { id: string; promise: Promise<Product | null> } | null = null;

/** start the read of the landing product (once per page load); nothing happens when the link is not a product link */
export function startEarlyProduct(
  target: EarlyReadTarget | null,
  hash: string,
  deps: { fetch?: typeof fetch; win?: unknown } = {},
): void {
  if (early || !target) return;
  const id = landingProductId(hash);
  const url = id ? productDocUrl(target, id) : null;
  const f = deps.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!id || !url || !f) return;
  // the same read, already started by index.html (scripts/product-early.mjs): taken over once, for the same product
  // AND the same project (an admin's localStorage project override = this app reads elsewhere -> its own request)
  const w = (deps.win !== undefined ? deps.win : typeof window !== 'undefined' ? window : null) as any;
  const handed = w && w.__productEarly && typeof w.__productEarly === 'object' ? w.__productEarly : null;
  if (w) { try { delete w.__productEarly; } catch { w.__productEarly = undefined; } }
  const fromPage = handed && handed.id === id && target.kind === 'cloud' && handed.projectId === target.projectId
    && handed.r && typeof handed.r.then === 'function' ? (handed.r as Promise<unknown>) : null;
  const promise = (async () => {
    if (fromPage) {
      const json = await fromPage.catch(() => null);
      const p = json ? decodeProductDocument(json, id) : null;
      if (p) return p;
      // the page's request failed (network, 404, an odd answer): the app asks once itself
    }
    try {
      const r = await f(url, { method: 'GET', credentials: 'omit', cache: 'no-store' });
      if (!r || r.status !== 200) return null;
      return decodeProductDocument(await r.json(), id);
    } catch {
      return null;
    }
  })();
  early = { id, promise };
}

/** the early read for THIS product id (the landing product only), or null */
export function earlyProduct(id: string): Promise<Product | null> | null {
  return early && early.id === id ? early.promise : null;
}

/** test helper */
export function __resetEarlyProduct(): void { early = null; }

/** same plain data (key order ignored)? Used to keep the early copy when the catalogue brings the very same product,
 * so nothing on the page is reset (chosen colour / quantity / photo). */
export function samePlainData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => samePlainData(x, bb[i]));
  }
  const ka = Object.keys(a as object).filter((k) => (a as any)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as any)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && samePlainData((a as any)[k], (b as any)[k]));
}
