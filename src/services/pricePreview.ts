// Price preview with the order Worker v2's OWN pricing code (no copy, no network):
// validateOrderInput -> planInventory (unit price per line) -> computeServerPricing -> comparePricing,
// run on the product data the page already loaded. Shows the customer, BEFORE confirming, whether the totals on the
// page differ from what the Worker will compute. The Worker remains the authority (Phase 1: mismatch is logged, not
// rejected); the preview can only be as fresh as the loaded product list.

import { validateOrderInput } from '../../workers/order-worker/src/validate.js';
import { planInventory } from '../../workers/order-worker/src/inventory.js';
import { computeServerPricing, comparePricing } from '../../workers/order-worker/src/pricing.js';
import { encodeFields } from '../../workers/order-worker/src/firestore.js';

export type PreviewProduct = { id: string; name?: unknown; price?: unknown; stock?: unknown; variants?: unknown };

export type PricePreview =
  | {
      ok: true;
      server: { subtotal: number; discount: number; shipping: number | null; total: number; complete: boolean };
      client: { subtotal: number | null; discountAmount: number | null; shippingCost: number | null; total: number };
      diffs: string[]; // e.g. ['subtotal', 'total'] | ['incomplete']
      lines: Array<{ index: number; productId: string; serverUnitPrice: number | null; clientUnitPrice: number | null }>;
    }
  | { ok: false; field: string };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Only the fields the Worker's pricing reads, encoded like a Firestore document. */
function productDoc(p: PreviewProduct | undefined) {
  if (!p) return { exists: false };
  const variants = Array.isArray(p.variants)
    ? p.variants.map((v) => {
        const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
        return { id: typeof r.id === 'string' ? r.id : undefined, label: typeof r.label === 'string' ? r.label : undefined, price: num(r.price), stock: num(r.stock) };
      })
    : [];
  const fields = encodeFields({ name: typeof p.name === 'string' ? p.name : '', price: num(p.price), stock: num(p.stock), variants });
  return { exists: true, fields, updateTime: null };
}

export function previewServerPricing(order: Record<string, unknown>, products: PreviewProduct[]): PricePreview {
  const parsed = validateOrderInput({ ...order, id: 'ORD-PREVIEW0-PREVIEW0' }); // the number is irrelevant to pricing
  if ('field' in parsed) return { ok: false, field: parsed.field };
  const v = parsed.value;
  const lines = v.items.map((it: { productId: string; variantId: string | null; quantity: number }, index: number) => ({ index, productId: it.productId, variantId: it.variantId, quantity: it.quantity }));
  const byId = new Map(products.map((p) => [p.id, p]));
  const docs = new Map(lines.map((l: { productId: string }) => [l.productId, productDoc(byId.get(l.productId))]));
  const inv = planInventory(lines, docs, 'off');
  const s = computeServerPricing(inv.lineInfo, v.addressMeta, v.shippingMethodId);
  return {
    ok: true,
    server: { subtotal: s.subtotal, discount: s.discount, shipping: s.shipping, total: s.total, complete: s.complete },
    client: v.clientPricing,
    diffs: comparePricing(s, v.clientPricing),
    lines: inv.lineInfo.map((l: { index: number; productId: string; serverUnitPrice: number | null }) => ({
      index: l.index, productId: l.productId, serverUnitPrice: l.serverUnitPrice, clientUnitPrice: v.items[l.index]?.clientUnitPrice ?? null,
    })),
  };
}
