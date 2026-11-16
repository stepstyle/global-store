// Fixtures shaped exactly like the current app writes them.

// Copied verbatim from src/pages/Checkout.tsx (makeOrderId)
export const makeOrderId = () => {
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  const uuid = globalThis?.crypto?.randomUUID?.();
  if (uuid) return `ORD-${uuid.split('-')[0].toUpperCase()}-${ts}`;
  return `ORD-${ts}-${rnd}`;
};

// Fallback branch of makeOrderId (when crypto.randomUUID is unavailable)
export const makeOrderIdFallback = () => {
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  return `ORD-${ts}-${rnd}`;
};

export const CSV_PRODUCT_ID = 'CSV 001 دفتر';

// Product shapes observed in the app code (types.ts, AdminAddProduct.tsx, CSV import) + edge cases.
export const PRODUCTS = {
  // A. legacy product, no variants field
  'p-simple': { name: 'دفتر', price: 2.5, stock: 10, category: 'Stationery' },
  // B. empty variants array
  'p-empty-variants': { name: 'مسطرة', price: 4, stock: 5, variants: [] },
  // C. variant product: top-level stock is an independent manual number
  'p-variants': {
    name: 'قلم',
    price: 3,
    stock: 0,
    variants: [
      { id: 'var_red', label: 'أحمر', type: 'color', price: 3, originalPrice: 4.25, stock: 5, colorCode: '#ff0000', colorCode2: '', image: 'https://example.invalid/r.jpg' },
      { id: 'var_blue', label: 'أزرق', type: 'color', price: 3.5, stock: 1, colorCode: '#0000ff', colorCode2: '#ffffff', image: null },
    ],
  },
  // D. variant labelled '.' (hidden label in UI)
  'p-dot-label': { name: 'ممحاة', price: 2, stock: 9, variants: [{ id: 'var_dot', label: '.', type: 'color', price: 2, stock: 3, colorCode: '#000000' }] },
  // E. colour variant without a label
  'p-unnamed-color': { name: 'ألوان', price: 2, stock: 0, variants: [{ id: 'var_x', label: '', type: 'color', price: 2, stock: 2, colorCode: '#00ff00' }] },
  // F. CSV-imported product with a free-text id
  [CSV_PRODUCT_ID]: { name: 'دفتر مستورد', price: 1.25, stock: 7, category: 'Stationery' },
  // edge: stock stored as a numeric string
  'p-string-stock': { name: 'نص', price: 1, stock: '8' },
  // edge: no stock field
  'p-no-stock': { name: 'بلا مخزون', price: 1 },
  // edge: duplicated variant ids
  'p-dup-variant': { name: 'مكرر', price: 1, stock: 0, variants: [{ id: 'var_dup', label: 'أ', type: 'size', price: 1, stock: 4 }, { id: 'var_dup', label: 'ب', type: 'size', price: 1, stock: 4 }] },
  // edge: variant without an id
  'p-variant-no-id': { name: 'بلا معرف', price: 1, stock: 0, variants: [{ label: 'x', type: 'size', price: 1, stock: 3 }] },
  // concurrency targets
  'p-last-one': { name: 'آخر قطعة', price: 5, stock: 1 },
  'p-hundred': { name: 'مئة', price: 1, stock: 100 },
};

export const variantSnapshot = (productId, variantId) => {
  const v = PRODUCTS[productId].variants.find((x) => x.id === variantId);
  return { ...v };
};

/** Default cart: p-simple x2 (2.5) + p-variants/var_red x1 (3) -> 8, discount 0.8, Amman a1 shipping 1 -> 8.2 */
export function checkoutOrder({
  id = makeOrderId(),
  userId = 'guest',
  payment = 'cod',
  items,
  overrides = {},
} = {}) {
  const lines = items ?? [
    { productId: 'p-simple', name: 'دفتر', price: 2.5, quantity: 2, image: 'https://example.invalid/a.jpg', selectedVariant: null },
    { productId: 'p-variants', name: 'قلم - أحمر', price: 3, quantity: 1, image: 'https://example.invalid/b.jpg', selectedVariant: variantSnapshot('p-variants', 'var_red') },
  ];
  const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const qty = lines.reduce((s, l) => s + l.quantity, 0);
  const discountAmount = qty > 2 ? subtotal * 0.1 : 0;
  const shippingCost = 1;
  const order = {
    id,
    userId,
    status: 'new',
    seenByAdmin: false,
    date: '2026-11-03',
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
    updatedAt: new Date().toISOString(),
    items: lines,
    subtotal,
    discountAmount,
    shippingCost,
    total: Math.max(0, subtotal - discountAmount + shippingCost),
    shippingMethodId: 'standard',
    shippingMethod: 'توصيل عادي (خلال 48 ساعة)',
    paymentMethod: payment,
    customerEmail: 'buyer@example.com',
    consents: { acceptedStorePolicies: true, acceptedDeliveryPolicy: false, saveInfo: true, billingSameAsShipping: true },
    note: 'اتصل قبل الوصول',
    address: { fullName: 'Test Buyer', city: 'عمّان (العاصمة) - النزهة', street: 'شارع 1', phone: '+962791234567' },
    addressMeta: { country: 'Jordan', countryCode: 'JO', citySlug: 'amman', ammanAreaId: 'a1', saveInfo: true, phoneDial: '+962', phoneLocal: '0791234567' },
  };
  if (payment === 'cliq') order.paymentDetails = { cliqReference: '1234567890', isPaid: false };
  return { ...order, ...overrides };
}

export const line = (productId, quantity, { variantId = null, price } = {}) => {
  const p = PRODUCTS[productId];
  const sv = variantId ? (p.variants || []).find((v) => v.id === variantId) || { id: variantId, label: '?', type: 'color', price: 1 } : null;
  return {
    productId,
    name: p?.name || productId,
    price: price ?? (sv?.price ?? p?.price ?? 1),
    quantity,
    image: '',
    selectedVariant: sv ? { ...sv } : null,
  };
};
