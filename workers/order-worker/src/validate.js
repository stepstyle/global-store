// Order input validation + normalisation (allow-list) + identity hash.
// Accepts the payload the CURRENT Checkout.tsx sends ({ order: newOrder }) and also a
// decoded Firestore order document (used when adopting / reconciling a browser-written order).

import { JO_GOV_SLUGS, SHIPPING_METHODS } from './pricing-config.js';

export const ORDER_ID_RE = /^ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16}$/;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PHONE_RE = /^\+9627[789]\d{7}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// Keys the current app writes on an order + keys Worker v2 adds. Everything else is stripped.
const KNOWN_ORDER_KEYS = new Set([
  'id', 'userId', 'status', 'seenByAdmin', 'date', 'createdAt', 'createdAtMs', 'updatedAt',
  'items', 'subtotal', 'discountAmount', 'shippingCost', 'total', 'shippingMethodId', 'shippingMethod',
  'paymentMethod', 'customerEmail', 'consents', 'note', 'paymentDetails', 'address', 'addressMeta',
  // written by Worker v2 itself:
  'source', 'claimedUserId', 'workerCheck',
]);

class Invalid extends Error {
  constructor(field) {
    super(`invalid ${field}`);
    this.field = field;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

function str(v, field, { min = 0, max, optional = false, re } = {}) {
  if (v === undefined || v === null) {
    if (optional) return '';
    throw new Invalid(field);
  }
  if (typeof v !== 'string') throw new Invalid(field);
  if (v.length < min || v.length > max) throw new Invalid(field);
  if (re && v !== '' && !re.test(v)) throw new Invalid(field);
  return v;
}

function money(v, field, { optional = false } = {}) {
  if (v === undefined || v === null) {
    if (optional) return null;
    throw new Invalid(field);
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100000) throw new Invalid(field);
  return v;
}

/** Product / variant ids: any Firestore-safe id (CSV imports allow free text). */
function docId(v, field, { optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw new Invalid(field);
  }
  if (typeof v !== 'string' || v.length > 256 || v.includes('/') || v === '.' || v === '..' || /^__.*__$/.test(v)) {
    throw new Invalid(field);
  }
  return v;
}

function normalizeItem(it, i) {
  if (!isObj(it)) throw new Invalid(`items[${i}]`);
  const productId = docId(it.productId ?? it.id, `items[${i}].productId`);
  const quantity = it.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Invalid(`items[${i}].quantity`);

  let selectedVariant = null;
  let variantId = null;
  if (it.selectedVariant !== undefined && it.selectedVariant !== null) {
    if (!isObj(it.selectedVariant)) throw new Invalid(`items[${i}].selectedVariant`);
    const sv = it.selectedVariant;
    variantId = docId(sv.id, `items[${i}].selectedVariant.id`, { optional: true });
    selectedVariant = {
      id: variantId,
      label: str(sv.label, `items[${i}].selectedVariant.label`, { max: 200, optional: true }),
      type: str(sv.type, `items[${i}].selectedVariant.type`, { max: 20, optional: true }),
      price: money(sv.price, `items[${i}].selectedVariant.price`, { optional: true }),
      colorCode: str(sv.colorCode, `items[${i}].selectedVariant.colorCode`, { max: 30, optional: true }),
      colorCode2: str(sv.colorCode2, `items[${i}].selectedVariant.colorCode2`, { max: 30, optional: true }),
      image: str(sv.image, `items[${i}].selectedVariant.image`, { max: 2000, optional: true }),
    };
  }

  return {
    productId,
    variantId,
    quantity,
    name: str(it.name, `items[${i}].name`, { max: 300, optional: true }),
    clientUnitPrice: money(it.price, `items[${i}].price`, { optional: true }),
    image: str(it.image, `items[${i}].image`, { max: 2000, optional: true }),
    selectedVariant,
  };
}

/**
 * @returns {{ok:true, value, strippedFields:string[]} | {ok:false, field:string}}
 */
export function validateOrderInput(raw) {
  try {
    if (!isObj(raw)) throw new Invalid('order');

    const strippedFields = Object.keys(raw).filter((k) => !KNOWN_ORDER_KEYS.has(k));

    const id = str(raw.id, 'id', { min: 1, max: 40, re: ORDER_ID_RE });
    const userId = str(raw.userId, 'userId', { min: 1, max: 128 });
    if (userId !== 'guest' && !USER_ID_RE.test(userId)) throw new Invalid('userId');

    if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 30) throw new Invalid('items');
    const items = raw.items.map(normalizeItem);

    if (!isObj(raw.address)) throw new Invalid('address');
    const address = {
      fullName: str(raw.address.fullName, 'address.fullName', { min: 1, max: 120 }),
      phone: str(raw.address.phone, 'address.phone', { min: 1, max: 20, re: PHONE_RE }),
      city: str(raw.address.city, 'address.city', { max: 200, optional: true }),
      street: str(raw.address.street, 'address.street', { max: 500, optional: true }),
    };

    const meta = isObj(raw.addressMeta) ? raw.addressMeta : {};
    const citySlug = str(meta.citySlug, 'addressMeta.citySlug', { max: 20, optional: true });
    if (citySlug && !JO_GOV_SLUGS.includes(citySlug)) throw new Invalid('addressMeta.citySlug');
    const addressMeta = {
      country: str(meta.country, 'addressMeta.country', { max: 40, optional: true }),
      countryCode: str(meta.countryCode, 'addressMeta.countryCode', { max: 4, optional: true }),
      citySlug,
      ammanAreaId: str(meta.ammanAreaId, 'addressMeta.ammanAreaId', { max: 10, optional: true }),
      phoneDial: str(meta.phoneDial, 'addressMeta.phoneDial', { max: 6, optional: true }),
      phoneLocal: str(meta.phoneLocal, 'addressMeta.phoneLocal', { max: 15, optional: true }),
      saveInfo: meta.saveInfo === true,
    };

    const paymentMethod = str(raw.paymentMethod, 'paymentMethod', { min: 1, max: 10 });
    if (!['cod', 'cliq'].includes(paymentMethod)) throw new Invalid('paymentMethod');
    const pd = isObj(raw.paymentDetails) ? raw.paymentDetails : {};
    const cliqReference = str(pd.cliqReference, 'paymentDetails.cliqReference', { max: 100, optional: true });
    if (paymentMethod === 'cliq' && !cliqReference.trim()) throw new Invalid('paymentDetails.cliqReference');

    const shippingMethodId = str(raw.shippingMethodId, 'shippingMethodId', { max: 20, optional: true }) || 'standard';
    if (!SHIPPING_METHODS.includes(shippingMethodId)) throw new Invalid('shippingMethodId');

    const customerEmail = str(raw.customerEmail, 'customerEmail', { max: 254, optional: true, re: EMAIL_RE });

    const consentsIn = isObj(raw.consents) ? raw.consents : {};
    const consents = {
      acceptedStorePolicies: consentsIn.acceptedStorePolicies === true,
      acceptedDeliveryPolicy: consentsIn.acceptedDeliveryPolicy === true,
      saveInfo: consentsIn.saveInfo === true,
      billingSameAsShipping: consentsIn.billingSameAsShipping === true,
    };

    const value = {
      id,
      userId,
      items,
      address,
      addressMeta,
      paymentMethod,
      cliqReference,
      shippingMethodId,
      shippingMethod: str(raw.shippingMethod, 'shippingMethod', { max: 200, optional: true }),
      customerEmail,
      note: str(raw.note, 'note', { max: 600, optional: true }),
      consents,
      clientPricing: {
        subtotal: money(raw.subtotal, 'subtotal', { optional: true }),
        discountAmount: money(raw.discountAmount, 'discountAmount', { optional: true }),
        shippingCost: money(raw.shippingCost, 'shippingCost', { optional: true }),
        total: money(raw.total, 'total'),
      },
    };
    return { ok: true, value, strippedFields };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, field: e.field };
    throw e;
  }
}

/** Identity hash: same order id + same content => same hash. */
export async function orderHash(v) {
  const canonical = JSON.stringify([
    v.id,
    v.userId,
    v.items.map((i) => [i.productId, i.variantId || '', i.quantity]),
    v.address.phone,
    v.paymentMethod,
    v.addressMeta.citySlug,
    v.addressMeta.ammanAreaId,
    v.shippingMethodId,
    Math.round(v.clientPricing.total * 1000),
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
