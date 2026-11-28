// The private review link's token, handled at app start (main.tsx) — kept tiny: it is in the main bundle.
// "#/review/<order>/<token>" -> "#/review/<order>" before anything renders or any analytics (after consent) can read the
// URL; the token is kept for this tab only (sessionStorage, plus memory if storage is refused). No imports.

const REVIEW_TOKEN_RE = /^[0-9A-HJKMNP-TV-Z]{24}$/;
const LINK_HASH_RE = /^#\/review\/(ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16})\/([0-9A-HJKMNP-TV-Z]{24})\/?$/;
const TOKEN_KEY = (orderId: string) => `ds_review_token_${orderId}`;

type StoreLike = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
type HistoryLike = { replaceState(data: unknown, unused: string, url?: string): void };

/**
 * Called once at app start: a "#/review/<order>/<token>" address is rewritten to "#/review/<order>" and the token
 * kept in this tab's sessionStorage. Returns the order id when a token was taken. Never throws.
 */
export function stashReviewToken(loc: { hash: string; pathname: string; search: string }, store: StoreLike | null, history: HistoryLike | null): string | null {
  try {
    const m = LINK_HASH_RE.exec(String(loc.hash || ''));
    if (!m) return null;
    const [, orderId, token] = m;
    try { store?.setItem(TOKEN_KEY(orderId), token); } catch { /* storage refused: the in-memory copy below still works */ }
    memoryTokens.set(orderId, token);
    history?.replaceState(null, '', `${loc.pathname}${loc.search}#/review/${orderId}`);
    return orderId;
  } catch {
    return null;
  }
}
const memoryTokens = new Map<string, string>();
export function reviewTokenFor(orderId: string, store: StoreLike | null): string | null {
  const mem = memoryTokens.get(orderId);
  if (mem) return mem;
  try {
    const t = store?.getItem(TOKEN_KEY(orderId)) || '';
    return REVIEW_TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}
export function forgetReviewToken(orderId: string, store: StoreLike | null): void {
  memoryTokens.delete(orderId);
  try { store?.removeItem(TOKEN_KEY(orderId)); } catch { /* nothing to do */ }
}

