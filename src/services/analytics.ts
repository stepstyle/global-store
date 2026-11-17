// Meta commerce event helpers. Pixel base initialization stays in index.html.
type MetaItem = { id: string; price: number; quantity: number };
type MetaFbq = (command: string, event: string, params?: Record<string, unknown>, options?: Record<string, unknown>) => void;

declare global {
  interface Window { fbq?: MetaFbq }
}

const sendMeta = (event: string, params: Record<string, unknown>, eventId?: string) => {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  try {
    window.fbq('track', event, params, eventId ? { eventID: eventId } : undefined);
  } catch (error) {
    console.warn('[Meta] Could not send', event, error);
  }
};

export const trackMetaAddToCart = (item: MetaItem) => {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) return;
  const price = Number(item.price);
  sendMeta('AddToCart', {
    content_ids: [item.id],
    content_type: 'product',
    contents: [{ id: item.id, quantity: item.quantity, item_price: price }],
    value: Number.isFinite(price) ? Number((price * item.quantity).toFixed(3)) : 0,
    currency: 'JOD',
  });
};

export const trackMetaPurchase = (order: {
  id: string; total: number; items: Array<{ productId: string; quantity: number; price: number }>;
}) => {
  // Prevent browser-side duplicate tracking for the same order across retries/navigation.
  const key = 'meta_purchase_sent_' + order.id;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch { /* Some browsers block storage; checkout calls this once on success. */ }
  sendMeta('Purchase', {
    content_ids: order.items.map(i => String(i.productId)),
    content_type: 'product',
    contents: order.items.map(i => ({ id: String(i.productId), quantity: i.quantity, item_price: i.price })),
    value: Number(order.total),
    currency: 'JOD',
    num_items: order.items.reduce((n, i) => n + i.quantity, 0),
  }, String(order.id));
};

// Existing development-only analytics loggers.
export const trackPageView = (path: string) => console.log(`[Analytics] Page View: ${path}`);
export const trackEvent = (category: string, action: string, label?: string) =>
  console.log(`[Analytics] Event: ${category} - ${action} ${label ? `(${label})` : ''}`);
