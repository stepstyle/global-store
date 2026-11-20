// Google sign-in BEFORE an order is sent (owner's rule: every order). Pure helpers (unit-tested); the Firebase calls
// are in googleAuth.ts. The Worker is the real gate (ORDER_SIGN_IN=google checks the signed token's sign-in method);
// this only decides what the page does and keeps the customer's data across a redirect.

export type GoogleOutcome = 'ok' | 'cancelled' | 'blocked' | 'network' | 'failed' | 'unavailable';

/** Firebase Auth error code -> what the page tells the customer (nothing is sent in any non-'ok' case) */
export function googleOutcome(code: unknown): GoogleOutcome {
  switch (String(code || '')) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return 'cancelled';
    case 'auth/popup-blocked':
    case 'auth/operation-not-supported-in-this-environment':
      return 'blocked';
    case 'auth/network-request-failed':
    case 'auth/timeout':
      return 'network';
    case 'auth/not-initialized':
    case 'auth/unauthorized-domain':
    case 'auth/operation-not-allowed':
      return 'unavailable';
    default:
      return 'failed';
  }
}

type ProviderInfo = { providerId?: string | null };
/** the current Firebase user can place an order without a new sign-in: signed in, with Google linked */
export function hasGoogleSession(user: { uid?: string | null; providerData?: ProviderInfo[] | null; isAnonymous?: boolean } | null | undefined): boolean {
  return !!user && !!user.uid && user.isAnonymous !== true && Array.isArray(user.providerData) && user.providerData.some((p) => p?.providerId === 'google.com');
}

export function googleMessage(o: GoogleOutcome, isAR: boolean): string {
  const m: Record<Exclude<GoogleOutcome, 'ok'>, [string, string]> = {
    cancelled: ['أُغلقت نافذة Google قبل اختيار حساب، لذلك لم يُرسل الطلب. سلّتك وبياناتك محفوظة — اضغط «تأكيد الطلب» مرة أخرى عندما تكون جاهزًا.', 'The Google window was closed before an account was chosen, so the order was not sent. Your cart and details are kept — press "Confirm order" again when ready.'],
    blocked: ['منع المتصفح نافذة Google المنبثقة، لذلك لم يُرسل الطلب. اضغط الزر أدناه مرة أخرى، أو تابع عبر صفحة Google (ستعود إلى هنا وبياناتك محفوظة).', 'Your browser blocked the Google window, so the order was not sent. Press the button below again, or continue on the Google page (you will come back here with your details kept).'],
    network: ['تعذّر الاتصال بـ Google. تحقّق من الإنترنت ثم أعد المحاولة. لم يُرسل الطلب، وسلّتك محفوظة.', 'Could not reach Google. Check your connection and try again. The order was not sent and your cart is kept.'],
    failed: ['لم يكتمل تسجيل الدخول بـ Google، لذلك لم يُرسل الطلب. سلّتك وبياناتك محفوظة؛ أعد المحاولة.', 'The Google sign-in did not complete, so the order was not sent. Your cart and details are kept; please try again.'],
    unavailable: ['تسجيل الدخول بـ Google غير متاح الآن، لذلك لم يُرسل الطلب. تواصل معنا عبر واتساب لإتمام طلبك.', 'Google sign-in is unavailable right now, so the order was not sent. Contact us on WhatsApp to complete your order.'],
  };
  return o === 'ok' ? '' : m[o][isAR ? 0 : 1];
}

// ---- keeping the checkout form across a Google REDIRECT (only when the popup cannot open) ----------------------
// Same tab, sessionStorage, 30 minutes, read ONCE. Contains only what the customer typed for delivery (no payment
// secret: a CliQ reference number is not a secret, and no Turnstile token is ever kept).
export const RESUME_KEY = 'anta_checkout_resume_v1';
const RESUME_MAX_MS = 30 * 60 * 1000;
type Kv = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
const ss = (): Kv | null => {
  try { return (globalThis as { sessionStorage?: Kv }).sessionStorage ?? null; } catch { return null; }
};

export function saveCheckoutResume(data: Record<string, unknown>, store: Kv | null = ss(), now = Date.now()): boolean {
  if (!store) return false;
  try { store.setItem(RESUME_KEY, JSON.stringify({ at: now, data })); return true; } catch { return false; }
}
export function takeCheckoutResume(store: Kv | null = ss(), now = Date.now()): Record<string, unknown> | null {
  if (!store) return null;
  try {
    const raw = store.getItem(RESUME_KEY);
    store.removeItem(RESUME_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v.at !== 'number' || now - v.at > RESUME_MAX_MS || now < v.at - 60_000 || !v.data || typeof v.data !== 'object') return null;
    return v.data as Record<string, unknown>;
  } catch {
    return null;
  }
}
