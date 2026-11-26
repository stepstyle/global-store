// The wheel popup (wheel builds: VITE_WHEEL_MODE=test, or =live for the approved campaign).
//  - ONE campaign check, started as soon as the app starts (it never waits for the products or their photos); nothing
//    of the wheel is shown unless the Worker says the campaign is open (stopped / ended / unreachable = nothing)
//  - opens BY ITSELF for a new visitor on ANY page (home, shop, a product, …), right after the answer, ONCE PER
//    CAMPAIGN (a browser flag holding the campaign's fingerprint — comfort only: the number of spins is decided by the
//    Worker). Moving between pages or reloading never reopens it; a new / changed campaign opens it once again
//  - never over checkout / login / admin / order confirmation / the wheel page, and never on top of another open window
//    (cart drawer, quick view…): it waits until the visitor is somewhere quiet, then opens (still once). Entering checkout
//    while it is open closes it (the order flow is never covered)
//  - the check failed / timed out: no popup with an unknown campaign; it is asked again in the background (a cold Worker
//    can take a few seconds); the wheel itself shows a clear error with "try again" if a later request fails
//  - reopened any time from the small floating button; the answer of the check is handed to the wheel, so opening it
//    shows the wheel at once (no second request, no long "loading")
//  - closable with the large X button, Escape or a click outside
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { useCart } from '../../App';
import type { SubmitDeps } from '../../services/orderSubmit';
import { BACKEND_ENABLED } from '../../config/deployEnv';
import { fetchWheelPublic, takePrefetchedWheelPublic, campaignFingerprint, markPopupSeenFor, popupSeenFor, isQuietPath, type WheelPublic } from '../../services/wheel';
import WheelExperience from './WheelExperience';

const { useLocation } = ReactRouterDOM as any;
// the small floating button is also hidden where it would cover the price / quantity (found on phones)
const FAB_HIDDEN_PATHS = [/^\/product\//, /^\/cart/];
// the campaign check: at once (one tiny GET), then again after a failure (cold Worker / weak network)
const RETRY_DELAYS_MS = [3000, 8000, 20000];
// a short breath after the answer so the page under it has painted once (not a wait for images)
export const AUTO_OPEN_MS = 250;
// another window is open (cart drawer, quick view, a confirmation…): look again this often
const BLOCKED_RECHECK_MS = 800;

/** is another modal window open (not the wheel)? The wheel then waits instead of covering it */
const otherModalOpen = () => {
  try {
    return [...document.querySelectorAll('[aria-modal="true"]')].some((el) => !el.closest('[data-testid=wheel-popup],[data-testid=wheel-result-dialog]'));
  } catch { return false; }
};

export default function WheelPopup() {
  const { language } = useCart() as any;
  const isAR = language !== 'en';
  const location = useLocation();
  const path: string = location?.pathname || '';
  const quiet = isQuietPath(path);
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [pub, setPub] = useState<WheelPublic | null>(null);
  const [blockedTick, setBlockedTick] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocus = useRef<Element | null>(null);
  const workerUrl = BACKEND_ENABLED ? String(import.meta.env.VITE_WORKER_URL || '') : '';
  const deps = useMemo<SubmitDeps>(() => ({ fetch: (url, init) => window.fetch(url, init as RequestInit) as any }), []);

  // once per page load: is there an open campaign? Closed = nothing; unreachable = asked again a few times
  useEffect(() => {
    let stop = false;
    let t: number | undefined;
    const check = async (attempt: number) => {
      // the first answer: the one App.tsx asked for at start-up (no second request)
      const early = attempt === 0 ? takePrefetchedWheelPublic() : null;
      const p = await (early ?? fetchWheelPublic(workerUrl, deps));
      if (stop) return;
      if (p.kind === 'ok') {
        const ok = p.value.campaign === 'open' && p.value.slots.length >= 2;
        setPub(ok ? p.value : null);
        setAvailable(ok);
        return;
      }
      // a definite "closed" answer is final; a network / server problem is retried
      if (p.kind === 'closed') { setAvailable(false); return; }
      setAvailable((v) => (v === true ? v : false));
      if (attempt < RETRY_DELAYS_MS.length) t = window.setTimeout(() => void check(attempt + 1), RETRY_DELAYS_MS[attempt]);
    };
    void check(0);
    return () => { stop = true; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // by itself: any page except the quiet ones, once per campaign, never over another window
  useEffect(() => {
    if (!available || !pub || open || quiet) return undefined;
    const fp = campaignFingerprint(pub);
    if (popupSeenFor(fp)) return undefined;
    const t = window.setTimeout(() => {
      if (otherModalOpen()) { setBlockedTick((n) => n + 1); return; }
      markPopupSeenFor(fp);
      setOpen(true);
    }, blockedTick ? BLOCKED_RECHECK_MS : AUTO_OPEN_MS);
    return () => window.clearTimeout(t);
  }, [available, pub, open, quiet, blockedTick]);

  // the order flow is never covered: going to checkout (or sign-in / admin) closes the popup
  useEffect(() => { if (quiet && open) setOpen(false); }, [quiet, open]);

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement;
    dialogRef.current?.focus({ preventScroll: true } as any);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      (lastFocus.current as HTMLElement | null)?.focus?.({ preventScroll: true } as any);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      {!open && !quiet && available === true && !FAB_HIDDEN_PATHS.some((re) => re.test(path)) && (
        <button
          type="button" onClick={() => setOpen(true)} data-testid="wheel-fab"
          className="fixed bottom-24 start-4 z-[60] flex min-h-[44px] items-center gap-2 rounded-full border border-gold-200 bg-paper-50/95 px-3.5 py-2 text-sm font-black text-ink-900 shadow-lift backdrop-blur focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-300"
          aria-label={isAR ? 'افتح دولاب الحظ' : 'Open the lucky wheel'}
        >
          <span aria-hidden="true">🎡</span>{isAR ? 'دولاب الحظ' : 'Lucky wheel'}
        </button>
      )}
      {open && (
        // above every other layer (cookie bar, shopping assistant, toasts): a modal must never be covered
        <div className="fixed inset-0 z-[2147483000] flex items-end justify-center bg-ink-950/45 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} data-testid="wheel-popup">
          <div
            ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="wheel-title"
            className="relative flex max-h-[92vh] max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-4xl bg-gradient-to-b from-paper-50 to-ink-50 shadow-lift outline-none sm:max-w-md sm:rounded-4xl"
          >
            {/* the X stays in place while the content scrolls (large, high contrast, 48 px) */}
            <button
              type="button" onClick={close} data-testid="wheel-close"
              className="absolute end-3 top-3 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-white text-ink-900 shadow-soft ring-1 ring-ink-100 transition hover:bg-ink-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-300"
              aria-label={isAR ? 'إغلاق' : 'Close'}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
            </button>
            <div className="overflow-y-auto overscroll-contain p-5 pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-7 sm:pt-7" data-testid="wheel-popup-body">
              <WheelExperience variant="popup" onClose={close} onClosed={close} initial={pub} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
