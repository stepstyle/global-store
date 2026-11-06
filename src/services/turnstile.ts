// Cloudflare Turnstile for the checkout (official explicit-render API). No React, no secrets: the SITE key is public
// (VITE_TURNSTILE_SITE_KEY); the secret lives only in the Worker. Injectable (api / loader / clock) — unit-tested.
//
// Guarantees
// - A token is SINGLE-USE: getToken() hands out a token at most once and resets the widget for the next attempt,
//   so every send of orderSubmit (getTurnstileToken, asked before EVERY send) gets a fresh one.
// - A token older than TOKEN_MAX_AGE_MS (Cloudflare: valid 300 s) or reported expired is never returned.
// - Failure is SAFE: script not loadable / widget error / no token within TOKEN_WAIT_MS -> null. The caller must
//   then not send (Checkout shows a message); the Worker would refuse a missing token anyway (TURNSTILE_MODE=enforce).

export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const TOKEN_MAX_AGE_MS = 280_000;
export const TOKEN_WAIT_MS = 30_000;
export const SCRIPT_TIMEOUT_MS = 15_000;

export type TurnstileStatus = 'idle' | 'loading' | 'ready' | 'waiting' | 'expired' | 'error' | 'disabled';

export type TurnstileRenderOptions = {
  sitekey: string;
  action?: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': (code?: string) => boolean | void;
  'timeout-callback': () => void;
  'refresh-expired'?: 'auto' | 'manual' | 'never';
  retry?: 'auto' | 'never';
  language?: string;
};
export type TurnstileApi = {
  render: (el: unknown, opts: TurnstileRenderOptions) => string | undefined;
  reset: (id?: string) => void;
  remove?: (id?: string) => void;
};

/** The public site key, or '' when unset/malformed (then Turnstile is not used at all). */
export function siteKeyFrom(value: unknown): string {
  const k = typeof value === 'string' ? value.trim() : '';
  return /^[0-9][xX][0-9A-Za-z_-]{10,64}$/.test(k) ? k : '';
}

type Win = { turnstile?: TurnstileApi; document?: any };
let loading: Promise<TurnstileApi> | null = null;

/** Loads the official script once (explicit render). Rejects on network error / timeout; the next call retries. */
export function loadTurnstile(win: Win = globalThis as unknown as Win, timeoutMs = SCRIPT_TIMEOUT_MS): Promise<TurnstileApi> {
  if (win.turnstile) return Promise.resolve(win.turnstile);
  if (loading) return loading;
  const doc = win.document;
  if (!doc?.createElement) return Promise.reject(new Error('turnstile: no document'));
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    let done = false;
    const finish = (e: Error | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (e || !win.turnstile) { loading = null; reject(e || new Error('turnstile: api missing after load')); }
      else resolve(win.turnstile);
    };
    const timer = setTimeout(() => finish(new Error('turnstile: script timeout')), timeoutMs);
    const s = doc.createElement('script');
    s.src = TURNSTILE_SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => finish(null);
    s.onerror = () => finish(new Error('turnstile: script failed to load'));
    doc.head.appendChild(s);
  });
  return loading;
}

export type TurnstileController = {
  getToken: () => Promise<string | null>;
  status: () => TurnstileStatus;
  destroy: () => void;
};

/** Renders the widget into `container` and manages single-use tokens. */
export function createTurnstileController(opts: {
  api: TurnstileApi;
  container: unknown;
  siteKey: string;
  now?: () => number;
  waitMs?: number;
  language?: string;
  onStatus?: (s: TurnstileStatus) => void;
}): TurnstileController {
  const { api, container, siteKey } = opts;
  const now = opts.now ?? Date.now;
  const waitMs = opts.waitMs ?? TOKEN_WAIT_MS;
  let token: string | null = null;
  let tokenAt = 0;
  let status: TurnstileStatus = 'loading';
  let waiters: Array<(t: string | null) => void> = [];
  const setStatus = (s: TurnstileStatus) => { status = s; opts.onStatus?.(s); };
  const flush = (t: string | null) => { const w = waiters; waiters = []; for (const f of w) f(t); };

  let id: string | undefined;
  try {
    id = api.render(container, {
      sitekey: siteKey,
      action: 'checkout',
      language: opts.language,
      'refresh-expired': 'auto',
      retry: 'auto',
      callback: (t: string) => {
        if (typeof t !== 'string' || !t) return;
        token = t;
        tokenAt = now();
        setStatus('ready');
        if (waiters.length) flush(take());
      },
      'expired-callback': () => { token = null; setStatus('expired'); },
      'timeout-callback': () => { token = null; setStatus('expired'); },
      'error-callback': () => { token = null; setStatus('error'); flush(null); return true; },
    });
  } catch {
    setStatus('error');
  }

  /** hands out the current token ONCE and prepares the next one */
  const take = (): string | null => {
    const t = token;
    token = null;
    try { api.reset(id); } catch {}
    return t;
  };

  const fresh = () => token !== null && now() - tokenAt < TOKEN_MAX_AGE_MS;

  return {
    status: () => status,
    getToken: () => {
      if (status === 'error' && id === undefined) return Promise.resolve(null);
      if (fresh()) return Promise.resolve(take());
      // stale / none yet: ask the widget for a new one and wait (bounded)
      if (token !== null) { token = null; try { api.reset(id); } catch {} }
      setStatus('waiting');
      return new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => { waiters = waiters.filter((w) => w !== done); resolve(null); }, waitMs);
        const done = (t: string | null) => { clearTimeout(timer); resolve(t); };
        waiters.push(done);
      });
    },
    destroy: () => { flush(null); try { api.remove?.(id); } catch {} },
  };
}

/** test hook: forget the cached script promise */
export function _resetTurnstileLoaderForTests() { loading = null; }
