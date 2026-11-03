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
