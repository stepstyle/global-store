// Logical stock reservations (STOCK_POLICY=on_delivery). Pure functions: no I/O.
//
// The physical stock (products/{id}.stock, variants[i].stock) is ONLY changed when an order is delivered
// (src/fulfilment.js). Until then the quantities of open orders are held in stockReservations/{productId}:
//   { productId, product: <qty reserved on the top-level stock>, variants: { <variantId>: <qty> } }
// written ONLY by the Worker's service account (the Firestore rules deny every browser write). They live outside the
// product document on purpose: the admin product editor rewrites the whole variants array, which would wipe them.
//
//   available = stock - reserved        (an order is refused when ANY of its lines needs more than is available)
//
// Line resolution follows src/inventory.js exactly (same product shapes, same warnings): a line that inventory.js
// would not deduct (product / variant missing, ambiguous, stock not a number) is not reserved either.
import { rawNumber, decodeFields, encodeFields } from './firestore.js';

function variantId(rawVariant) {
  const f = rawVariant?.mapValue?.fields;
  return f?.id && 'stringValue' in f.id ? f.id.stringValue : null;
}

/** qty reserved for (productId, variantId) in a raw stockReservations document */
export function reservedOf(resDoc, vid) {
  if (!resDoc?.exists) return 0;
  const R = decodeFields(resDoc.fields);
  const n = vid ? R.variants?.[vid] : R.product;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** the physical stock a line would be deducted from, or a warning code (same rules as planInventory) */
export function resolveLine(line, productDoc) {
  if (!productDoc?.exists) return { warning: 'PRODUCT_NOT_FOUND' };
  const f = productDoc.fields || {};
  const raw = f.variants?.arrayValue?.values;
  const variants = Array.isArray(raw) ? raw : [];
  if (line.variantId) {
    const idx = [];
    variants.forEach((v, i) => { if (variantId(v) === line.variantId) idx.push(i); });
    if (idx.length === 0) return { warning: 'VARIANT_NOT_FOUND' };
    if (idx.length > 1) return { warning: 'DUPLICATE_VARIANT_ID' };
    const s = rawNumber(variants[idx[0]].mapValue?.fields?.stock);
    if (s.value === null) return { warning: 'STOCK_UNTRACKED' };
    return { stock: s.value };
  }
  if (variants.length > 0) return { warning: 'AMBIGUOUS_VARIANT' };
  const s = rawNumber(f.stock);
  if (s.value === null) return { warning: 'STOCK_UNTRACKED' };
  return { stock: s.value };
}

const keyOf = (pid, vid) => `${pid}\u0000${vid || ''}`;

function docWrite(fs, productId, resDoc, data) {
  return {
    update: { name: fs.name(`stockReservations/${productId}`), fields: encodeFields(data) },
    // every reservation change is conditional on the version that was read: two orders racing for the last piece
    // cannot both commit (the loser re-reads, sees the new reservation and is refused)
    currentDocument: resDoc?.exists ? { updateTime: resDoc.updateTime } : { exists: false },
  };
}

function nextData(productId, resDoc) {
  const R = resDoc?.exists ? decodeFields(resDoc.fields) : {};
  const variants = {};
  for (const [k, v] of Object.entries(R.variants && typeof R.variants === 'object' ? R.variants : {})) {
    if (Number.isInteger(v) && v > 0) variants[k] = v;
  }
  return { productId, product: Number.isInteger(R.product) && R.product > 0 ? R.product : 0, variants };
}

/**
 * Reserve the lines of a NEW order.
 * @param lines        [{ index, productId, variantId, quantity }]
 * @param products     Map<productId, raw doc>
 * @param reservations Map<productId, raw stockReservations doc>
 * @returns { reservations: [{productId, variantId, qty}], shortfalls: [{index, productId, variantId, requested, available}],
 *            warnings, writes(fs) }
 */
export function planReservation(lines, products, reservations) {
  const warnings = [];
  const need = new Map(); // key -> { productId, variantId, qty, stock, lines: [index] }
  for (const line of lines) {
    const r = resolveLine(line, products.get(line.productId));
    if (r.warning) { warnings.push({ code: r.warning, line: line.index }); continue; }
    const k = keyOf(line.productId, line.variantId);
    const cur = need.get(k) || { productId: line.productId, variantId: line.variantId || null, qty: 0, stock: r.stock, lines: [] };
    cur.qty += line.quantity;
    cur.lines.push(line.index);
    need.set(k, cur);
  }
  const shortfalls = [];
  for (const n of need.values()) {
    const available = n.stock - reservedOf(reservations.get(n.productId), n.variantId);
    if (n.qty > available) {
      for (const index of n.lines) shortfalls.push({ index, productId: n.productId, variantId: n.variantId, requested: n.qty, available: Math.max(0, available) });
    }
  }
  const reserved = shortfalls.length ? [] : [...need.values()].map((n) => ({ productId: n.productId, variantId: n.variantId, qty: n.qty }));
  return { reservations: reserved, shortfalls, warnings };
}

/**
 * Firestore writes that add (sign +1, a new order) or give back (sign -1, delivered / cancelled) the quantities of
 * `list` ([{ productId, variantId, qty }]) on the reservation documents that were read (`reservations`). A give-back
 * is floored at 0 (warning RESERVATION_UNDERFLOW, never negative).
 */
export function reservationWrites(fs, list, reservations, sign) {
  const warnings = [];
  const byProduct = new Map();
  for (const r of Array.isArray(list) ? list : []) {
    const qty = Number(r?.qty);
    if (!r?.productId || !Number.isInteger(qty) || qty <= 0) continue;
    if (!byProduct.has(r.productId)) byProduct.set(r.productId, nextData(r.productId, reservations.get(r.productId)));
    const d = byProduct.get(r.productId);
    if (r.variantId) {
      const after = (d.variants[r.variantId] || 0) + sign * qty;
      if (after < 0) warnings.push({ code: 'RESERVATION_UNDERFLOW', productId: r.productId, variantId: r.variantId });
      if (after > 0) d.variants[r.variantId] = after;
      else delete d.variants[r.variantId];
    } else {
      const after = d.product + sign * qty;
      if (after < 0) warnings.push({ code: 'RESERVATION_UNDERFLOW', productId: r.productId });
      d.product = Math.max(0, after);
    }
  }
  const writes = [...byProduct.entries()].map(([pid, data]) => docWrite(fs, pid, reservations.get(pid), data));
  return { writes, warnings };
}
