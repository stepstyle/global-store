// How a price, a discount and stock are SHOWN (cards, product page, quick view). Display only — the order Worker
// prices every order itself from the catalogue; nothing here is ever sent as a price.
//
// A sale is shown ONLY when the original price is a real number strictly above the selling price. Equal / lower /
// missing / invalid original prices show no strike-through, no "sale" badge and no percentage (never invented).

const money = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
};

// save: what the customer saves per unit (original - price, in fils precision)
export type SaleInfo = { onSale: false } | { onSale: true; original: number; percent: number; save: number };

export function saleInfo(price: unknown, originalPrice: unknown): SaleInfo {
  const p = money(price);
  const o = money(originalPrice);
  if (p === null || o === null || o <= p) return { onSale: false };
  const percent = Math.round((1 - p / o) * 100);
  // a 0% "discount" (rounding of a tiny difference) is not shown as a sale; neither is a nonsensical 100%
  if (percent < 1 || percent > 95) return { onSale: false };
  return { onSale: true, original: o, percent, save: Math.round((o - p) * 1000) / 1000 };
}

/** JOD with up to 3 decimals (fils), trailing zeros removed: 2 -> "2", 2.5 -> "2.5", 1.255 -> "1.255". */
export function formatJod(v: unknown): string {
  const n = money(v) ?? 0;
  return String(Math.round(n * 1000) / 1000);
}

type VariantLike = { price?: unknown; originalPrice?: unknown; stock?: unknown };

/** The price a product card shows: the cheapest IN-STOCK variant (else cheapest priced variant), else the product price. */
export function displayPrice(product: { price?: unknown; originalPrice?: unknown; variants?: VariantLike[] | null }): { price: number | null; originalPrice: number | null } {
  const vs = Array.isArray(product.variants) ? product.variants.filter((v) => v && money(v.price) !== null) : [];
  if (vs.length) {
    const inStock = vs.filter((v) => Number(v.stock) > 0);
    const pool = inStock.length ? inStock : vs;
    const best = pool.reduce((a, b) => ((money(a.price) as number) <= (money(b.price) as number) ? a : b));
    // the variant's OWN original price; the product-level one only when it belongs to the SAME price (product price ==
    // this variant's price). Otherwise it would invent a discount (e.g. a 0.5 variant shown as "-50%" against a
    // product original price of 1 that belonged to the product price 1).
    const vp = money(best.price);
    const own = money(best.originalPrice);
    return { price: vp, originalPrice: own ?? (vp !== null && vp === money(product.price) ? money(product.originalPrice) : null) };
  }
  return { price: money(product.price), originalPrice: money(product.originalPrice) };
}

/** Units that can really be bought: the sum of the variants' stock when the product has variants, else its stock. */
export function availableStock(product: { stock?: unknown; variants?: VariantLike[] | null }): number {
  const vs = Array.isArray(product.variants) ? product.variants.filter(Boolean) : [];
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0; };
  return vs.length ? vs.reduce((s, v) => s + n(v.stock), 0) : n(product.stock);
}

/** true when the variants are sold at different prices (the card then shows "from" the lowest). */
export function hasPriceRange(product: { variants?: VariantLike[] | null }): boolean {
  const ps = (Array.isArray(product.variants) ? product.variants : []).map((v) => money(v?.price)).filter((x): x is number => x !== null);
  return new Set(ps).size > 1;
}

// ------------------------------------------------------------------ a cart line priced from the LIVE catalogue
type LiveVariant = VariantLike & { id?: unknown };
type LiveProduct = { id?: unknown; price?: unknown; originalPrice?: unknown; stock?: unknown; variants?: LiveVariant[] | null };

/**
 * The price / original price / stock of a cart line from the CURRENT catalogue (the products the site just loaded),
 * never from what was stored in this browser when the item was added: the variant is looked up by its id in the live
 * product. Falls back to the stored values only when the product / variant is not in the catalogue any more (the
 * order Worker then refuses the line itself). The order Worker computes the real price anyway; this keeps the cart,
 * the checkout and the server on the SAME number (no surprise "price changed").
 */
export function liveCartLine(item: { id?: unknown; price?: unknown; stock?: unknown; selectedVariant?: LiveVariant | null }, products: LiveProduct[] | null | undefined) {
  const real = (Array.isArray(products) ? products : []).find((p) => p && p.id === item.id) || null;
  const stored = item.selectedVariant || null;
  const live = stored && real && Array.isArray(real.variants) ? real.variants.find((v) => v && v.id !== undefined && v.id === stored.id) || null : null;
  const v = live || stored;
  const price = v ? money(v.price) : real ? money(real.price) : money(item.price);
  const rawStock = v ? v.stock : real ? real.stock : item.stock;
  const stock = rawStock === undefined || rawStock === null || rawStock === '' ? undefined : Number(rawStock);
  // the original price that belongs to THIS price (same rule as the product page): the variant's own, or the product's
  // when the line is sold at the product price
  const original = v ? (money(v.originalPrice) ?? (real && price !== null && price === money(real.price) ? money(real.originalPrice) : null)) : real ? money(real.originalPrice) : null;
  return {
    price: price ?? 0,
    stock: stock !== undefined && Number.isFinite(stock) ? stock : undefined,
    sale: saleInfo(price, original),
    selectedVariant: live ? { ...stored, ...live } : stored,
  };
}
