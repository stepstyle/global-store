// Server-side price computation from trusted product data.

import {
  AMMAN_AREA_PRICES,
  OUTSIDE_AMMAN_SHIPPING,
  FAST_DELIVERY_SURCHARGE,
  VOLUME_DISCOUNT_MIN_ITEMS_EXCLUSIVE,
  VOLUME_DISCOUNT_RATE,
  PRICE_TOLERANCE,
} from './pricing-config.js';

const round3 = (n) => Math.round(n * 1000) / 1000;

export function shippingFor({ citySlug, ammanAreaId }, shippingMethodId) {
  const warnings = [];
  let shipping = null;
  if (!citySlug) {
    warnings.push({ code: 'SHIPPING_UNKNOWN' });
  } else if (citySlug === 'amman') {
    const base = AMMAN_AREA_PRICES[ammanAreaId];
    if (base === undefined) warnings.push({ code: 'SHIPPING_UNKNOWN' });
    else shipping = base + (shippingMethodId === 'fast' ? FAST_DELIVERY_SURCHARGE : 0);
  } else {
    shipping = OUTSIDE_AMMAN_SHIPPING;
    if (shippingMethodId === 'fast') warnings.push({ code: 'FAST_OUTSIDE_AMMAN' });
  }
  return { shipping, warnings };
}

/**
 * @param lines [{ index, quantity, serverUnitPrice: number|null }]
 */
export function computeServerPricing(lines, addressMeta, shippingMethodId) {
  const warnings = [];
  let subtotal = 0;
  let totalQty = 0;
  let complete = true;

  for (const l of lines) {
    totalQty += l.quantity;
    if (l.serverUnitPrice === null || l.serverUnitPrice === undefined) {
      complete = false;
      warnings.push({ code: 'PRICE_UNKNOWN', line: l.index });
      continue;
    }
    subtotal += l.serverUnitPrice * l.quantity;
  }

  const discount = totalQty > VOLUME_DISCOUNT_MIN_ITEMS_EXCLUSIVE ? subtotal * VOLUME_DISCOUNT_RATE : 0;
  const ship = shippingFor(addressMeta, shippingMethodId);
  warnings.push(...ship.warnings);
  if (ship.shipping === null) complete = false;

  const total = Math.max(0, subtotal - discount + (ship.shipping ?? 0));
  return {
    subtotal: round3(subtotal),
    discount: round3(discount),
    shipping: ship.shipping === null ? null : round3(ship.shipping),
    total: round3(total),
    totalQty,
    complete,
    warnings,
  };
}

/** Stock/variant warnings that make the server price of a line unknowable or ambiguous (enforce refuses them). */
export const PRICE_BLOCKING_WARNINGS = Object.freeze(['PRODUCT_NOT_FOUND', 'VARIANT_NOT_FOUND', 'AMBIGUOUS_VARIANT', 'DUPLICATE_VARIANT_ID']);

/**
 * PRICE_CHECK_MODE=enforce: everything that must hold before an order may be saved. Returns [] when the order's
 * numbers equal the SERVER's (trusted product / variant prices from Firestore + server discount & shipping rules),
 * otherwise the list of problems. Nothing the browser sends is trusted: each line's unit price, subtotal, discount,
 * shipping and total must be PRESENT and equal (± PRICE_TOLERANCE) to what the server computed.
 * @param server  computeServerPricing(...) result
 * @param client  validated clientPricing { subtotal, discountAmount, shippingCost, total }
 * @param lines   planInventory lineInfo [{ index, serverUnitPrice }]
 * @param items   validated order items [{ clientUnitPrice }] (same order as lines)
 * @param warnings planInventory + pricing warnings
 */
export function enforcePriceProblems(server, client, lines, items, warnings = []) {
  const p = new Set(comparePricing(server, client)); // totals that differ + 'incomplete'
  for (const k of ['subtotal', 'discountAmount', 'shippingCost', 'total']) {
    if (client?.[k] === null || client?.[k] === undefined) p.add(`missing:${k}`);
  }
  lines.forEach((l, i) => {
    const c = items[i]?.clientUnitPrice;
    if (c === null || c === undefined) p.add(`missing:items[${l.index}].price`);
    else if (l.serverUnitPrice === null || l.serverUnitPrice === undefined || Math.abs(l.serverUnitPrice - c) > PRICE_TOLERANCE) p.add(`items[${l.index}].price`);
  });
  for (const w of warnings) if (PRICE_BLOCKING_WARNINGS.includes(w.code)) p.add(w.line !== undefined ? `${w.code}:items[${w.line}]` : w.code);
  return [...p];
}

/** Returns the list of fields where the browser's numbers differ from the server's. */
export function comparePricing(server, client) {
  const diffs = [];
  const check = (field, s, c) => {
    if (c === null || c === undefined || s === null || s === undefined) return;
    if (Math.abs(s - c) > PRICE_TOLERANCE) diffs.push(field);
  };
  check('subtotal', server.subtotal, client.subtotal);
  check('discountAmount', server.discount, client.discountAmount);
  check('shippingCost', server.shipping, client.shippingCost);
  check('total', server.total, client.total);
  if (!server.complete) diffs.push('incomplete');
  return diffs;
}
