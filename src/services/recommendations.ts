// Product recommendations from the REAL catalogue only (the products the site loaded): "similar products" on a product
// page and "complete your order" in the cart / checkout. Pure functions, no network, no stored data.
//
// Relevance = what the products have in common: the main category, the sub-categories (the admin's comma-separated
// tags in subCategory), the extra categories and tags. Each shared tag counts by how RARE it is in the catalogue (a tag
// carried by almost every toy, like "all-toys", says little; "kitchen-toys" says a lot). A close price adds a little.
// Never: the product itself, anything already in the cart, anything that cannot be bought now (no stock).
import { availableStock, displayPrice, saleInfo } from './priceDisplay.ts';

type Variant = { price?: unknown; originalPrice?: unknown; stock?: unknown };
export type RecProduct = {
  id: string; category?: unknown; categories?: unknown; subCategory?: unknown; subcategory?: unknown; tags?: unknown;
  price?: unknown; originalPrice?: unknown; stock?: unknown; variants?: Variant[] | null; image?: unknown; images?: unknown; createdAt?: unknown;
};

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(norm).filter(Boolean);

/** the descriptive tags of a product: sub-categories, extra categories, tags (the main category is scored apart) */
export function tagsOf(p: RecProduct): Set<string> {
  const out = new Set<string>();
  for (const t of [...list(p.subCategory), ...list(p.subcategory)]) out.add(`sub:${t}`);
  for (const c of list(p.categories)) if (c !== norm(p.category)) out.add(`cat:${c}`);
  for (const t of list(p.tags)) out.add(`tag:${t}`);
  return out;
}

const hasImage = (p: RecProduct) => (Array.isArray(p.images) && p.images.some(Boolean)) || !!String(p.image ?? '').trim();
export const canBuy = (p: RecProduct) => availableStock(p as any) > 0;
const priceOf = (p: RecProduct) => displayPrice(p as any).price;

/** how rare each tag is in this catalogue: idf = ln(1 + N / count) */
function rarity(all: RecProduct[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const p of all) for (const t of tagsOf(p)) df.set(t, (df.get(t) || 0) + 1);
  const n = Math.max(1, all.length);
  const out = new Map<string, number>();
  for (const [t, c] of df) out.set(t, Math.log(1 + n / c));
  return out;
}

/** relevance of `b` for someone looking at `a` (0 = nothing in common) */
export function relevance(a: RecProduct, b: RecProduct, idf: Map<string, number>): number {
  let s = 0;
  const sameMain = norm(a.category) && norm(a.category) === norm(b.category);
  if (sameMain) s += 2;
  const ta = tagsOf(a);
  let shared = 0;
  for (const t of tagsOf(b)) if (ta.has(t)) shared += idf.get(t) || 0;
  s += Math.min(shared, 6);
  if (s <= 0) return 0;
  // a close price: up to +0.75 (same price) down to 0 (4x apart or more)
  const pa = priceOf(a); const pb = priceOf(b);
  if (pa && pb) s += Math.max(0, 0.75 * (1 - Math.abs(Math.log(pb / pa)) / Math.log(4)));
  return s;
}

const byScore = (a: { s: number; p: RecProduct }, b: { s: number; p: RecProduct }) => b.s - a.s || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0);

/** "Similar products" for a product page: related, buyable, never the product itself; best first. */
export function similarProducts<T extends RecProduct>(target: T | null | undefined, all: T[] | null | undefined, limit = 8): T[] {
  const pool = Array.isArray(all) ? all.filter((p) => p && p.id) : [];
  if (!target || !pool.length) return [];
  const idf = rarity(pool);
  return pool
    .filter((p) => p.id !== target.id && canBuy(p))
    .map((p) => ({ p, s: relevance(target, p, idf) + (hasImage(p) ? 0.2 : 0) }))
    .filter((x) => x.s > 0.2)
    .sort(byScore)
    .slice(0, limit)
    .map((x) => x.p);
}

/**
 * "Complete your order": products related to what is IN the cart, buyable, not already in it. Add-on friendly: an item
 * much dearer than anything in the cart is pushed down (a second ride-on car is not an add-on); a real discount and a
 * photo help a little. Never adds anything by itself — the page only SHOWS these.
 */
export function cartSuggestions<T extends RecProduct>(cartItems: Array<{ id?: unknown }> | null | undefined, all: T[] | null | undefined, limit = 6): T[] {
  const pool = Array.isArray(all) ? all.filter((p) => p && p.id) : [];
  const inCart = new Set((Array.isArray(cartItems) ? cartItems : []).map((i) => String(i?.id ?? '')));
  const bases = pool.filter((p) => inCart.has(p.id));
  if (!bases.length) return [];
  const idf = rarity(pool);
  const maxCartPrice = Math.max(...bases.map((b) => priceOf(b) || 0), 0);
  return pool
    .filter((p) => !inCart.has(p.id) && canBuy(p))
    .map((p) => {
      let s = Math.max(...bases.map((b) => relevance(b, p, idf)));
      if (s <= 0) return { p, s: 0 };
      const price = priceOf(p) || 0;
      if (maxCartPrice > 0 && price > maxCartPrice * 1.5) s *= 0.5;
      const sale = saleInfo(price, displayPrice(p as any).originalPrice);
      if (sale.onSale) s += 0.3;
      if (hasImage(p)) s += 0.2;
      return { p, s };
    })
    .filter((x) => x.s > 0.2)
    .sort(byScore)
    .slice(0, limit)
    .map((x) => x.p);
}

/** products with a REAL discount that can be bought now (offers page / home section) */
export function offerProducts<T extends RecProduct>(all: T[] | null | undefined): Array<{ p: T; percent: number; save: number; price: number }> {
  const out: Array<{ p: T; percent: number; save: number; price: number }> = [];
  for (const p of Array.isArray(all) ? all : []) {
    if (!p || !p.id || !canBuy(p)) continue;
    const d = displayPrice(p as any);
    const s = saleInfo(d.price, d.originalPrice);
    if (s.onSale && d.price !== null) out.push({ p, percent: s.percent, save: s.save, price: d.price });
  }
  return out;
}
