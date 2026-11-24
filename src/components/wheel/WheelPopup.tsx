// The wheel popup (wheel builds: VITE_WHEEL_MODE=test, or =live for the approved campaign).
//  - ONE campaign check per page load; nothing of the wheel is shown unless the Worker says the campaign is open
//  - opens BY ITSELF on the HOME page, a moment after it loads, ONCE PER CAMPAIGN (a browser flag holding the campaign's
//    fingerprint — comfort only: the number of spins is decided by the Worker). Moving between pages never reopens it;
//    a new / changed campaign opens it once again
//  - reopened any time from the small floating button; the answer of the check is handed to the wheel, so opening it
//    shows the wheel at once (no second request, no long "loading")
//  - closable with the X button, Escape or a click outside. Never over checkout / admin / login.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { useCart } from '../../App';
import type { SubmitDeps } from '../../services/orderSubmit';
import { BACKEND_ENABLED } from '../../config/deployEnv';
import { fetchWheelPublic, campaignFingerprint, markPopupSeenFor, popupSeenFor, type WheelPublic } from '../../services/wheel';
import WheelExperience from './WheelExperience';

const { useLocation } = ReactRouterDOM as any;
const QUIET_PATHS = [/^\/checkout/, /^\/admin/, /^\/login/, /^\/order-success/, /^\/wheel/];
// the small floating button is also hidden where it would cover the price / quantity (found on phones)
const FAB_HIDDEN_PATHS = [/^\/product\//, /^\/cart/];
// the campaign check starts shortly after the page (never competing with the first paint); one retry when the Worker
// did not answer (a cold start can take a few seconds)
const CHECK_DELAY_MS = 600;
const RETRY_DELAY_MS = 6000;
// on the home page the popup opens this long after the campaign is known to be open
export const AUTO_OPEN_MS = 1500;
const isHome = (path: string) => path === '/' || path === '';

export default function WheelPopup() {
  const { language } = useCart() as any;
  const isAR = language !== 'en';
  const location = useLocation();
  const path: string = location?.pathname || '';
  const quiet = QUIET_PATHS.some((re) => re.test(path));
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [pub, setPub] = useState<WheelPublic | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocus = useRef<Element | null>(null);
  const workerUrl = BACKEND_ENABLED ? String(import.meta.env.VITE_WORKER_URL || '') : '';
  const deps = useMemo<SubmitDeps>(() => ({ fetch: (url, init) => window.fetch(url, init as RequestInit) as any }), []);

  // every page load: is there an open campaign? Closed / unreachable = nothing shown (one retry for a cold Worker)
  useEffect(() => {
    let stop = false;
    let t: number | undefined;
    const check = async (retry: boolean) => {
      const p = await fetchWheelPublic(workerUrl, deps);
      if (stop) return;
      if (p.kind === 'ok') {
        const ok = p.value.campaign === 'open' && p.value.slots.length >= 2;
        setPub(ok ? p.value : null);
        setAvailable(ok);
        return;
      }
      setAvailable(false);
      if (retry) t = window.setTimeout(() => void check(false), RETRY_DELAY_MS);
    };
    t = window.setTimeout(() => void check(true), CHECK_DELAY_MS);
    return () => { stop = true; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // by itself: on the home page, once per campaign
  useEffect(() => {
    if (!available || !pub || open || !isHome(path)) return undefined;
    const fp = campaignFingerprint(pub);
    if (popupSeenFor(fp)) return undefined;
    const t = window.setTimeout(() => { markPopupSeenFor(fp); setOpen(true); }, AUTO_OPEN_MS);
    return () => window.clearTimeout(t);
  }, [available, pub, open, path]);

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      (lastFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      {!open && !quiet && available === true && !FAB_HIDDEN_PATHS.some((re) => re.test(path)) && (
        <button
          type="button" onClick={() => setOpen(true)} data-testid="wheel-fab"
          className="fixed bottom-24 start-4 z-[60] flex items-center gap-2 rounded-full border border-gold-200 bg-paper-50/95 px-3.5 py-2 text-sm font-black text-ink-900 shadow-lift backdrop-blur focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-300"
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
            className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-4xl bg-gradient-to-b from-paper-50 to-ink-50 p-5 pt-12 shadow-lift outline-none sm:max-w-md sm:rounded-4xl sm:p-7 sm:pt-12"
          >
            <button
              type="button" onClick={close} data-testid="wheel-close"
              className="absolute end-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl font-black text-ink-800 shadow-soft focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-300"
              aria-label={isAR ? 'إغلاق' : 'Close'}
            >×</button>
            <WheelExperience variant="popup" onClose={close} onClosed={close} initial={pub} />
          </div>
        </div>
      )}
    </>
  );
}
