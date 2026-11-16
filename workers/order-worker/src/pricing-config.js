// Server-side pricing constants.
// ⚠️ Copied verbatim from src/pages/Checkout.tsx (REGIONS / AMMAN_AREAS / shipping rules) and
// src/pages/Cart.tsx (volume discount) on 2026-11-03. Phase 2 moves these to one shared source.
// No free-shipping rule: the footer text ("free over 20 JOD") is NOT implemented anywhere and
// awaits a business decision.

export const JO_GOV_SLUGS = [
  'amman', 'zarqa', 'balqa', 'madaba',
  'irbid', 'jerash', 'ajloun', 'mafraq',
  'karak', 'tafilah', 'maan', 'aqaba',
];

export const AMMAN_AREA_PRICES = {
  a1: 1.0,
  a2: 1.0,
  a3: 1.0,
  a4: 1.0,
  a5: 1.5,
  a6: 1.5,
  a7: 2.0,
  a8: 1.5,
  a9: 2.5,
  a10: 2.5,
  a11: 2.5,
  a12: 2.5,
  a13: 2.5,
  a14: 2.5,
  other: 2.0,
};

export const OUTSIDE_AMMAN_SHIPPING = 3.0;
export const FAST_DELIVERY_SURCHARGE = 1.0; // Amman only
export const SHIPPING_METHODS = ['standard', 'fast'];

export const VOLUME_DISCOUNT_MIN_ITEMS_EXCLUSIVE = 2; // discount when total quantity > 2
export const VOLUME_DISCOUNT_RATE = 0.1;

export const PRICE_TOLERANCE = 0.01;
