// First-visit popup (TEST builds only, VITE_WHEEL_MODE=test). Shown ONCE on the first visit when the campaign is open
// (a browser flag — comfort only: the number of spins is decided by the Worker, per verified account). Closable with
// the X button, Escape or a click outside; reopened from the small floating button. Never over checkout / admin / login.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { useCart } from '../../App';
import type { SubmitDeps } from '../../services/orderSubmit';
import { BACKEND_ENABLED } from '../../config/deployEnv';
import { fetchWheelPublic, markPopupSeen, popupSeen } from '../../services/wheel';
import WheelExperience from './WheelExperience';

const { useLocation } = ReactRouterDOM as any;
const QUIET_PATHS = [/^\/checkout/, /^\/admin/, /^\/login/, /^\/order-success/, /^\/wheel/];

export default function WheelPopup() {
  const { language } = useCart() as any;
  const isAR = language !== 'en';
  const location = useLocation();
  const quiet = QUIET_PATHS.some((re) => re.test(location?.pathname || ''));
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocus = useRef<Element | null>(null);
  const workerUrl = BACKEND_ENABLED ? String(import.meta.env.VITE_WORKER_URL || '') : '';
  const deps = useMemo<SubmitDeps>(() => ({ fetch: (url, init) => window.fetch(url, init as RequestInit) as any }), []);

  // first visit only: is there an open campaign? (one request; never repeated on later visits)
  useEffect(() => {
    if (popupSeen() || quiet) return;
    let stop = false;
    const t = window.setTimeout(async () => {
      const p = await fetchWheelPublic(workerUrl, deps);
      if (stop) return;
      const ok = p.kind === 'ok' && p.value.campaign === 'open' && p.value.slots.length >= 2;
      setAvailable(ok);
      if (ok) { markPopupSeen(); setOpen(true); }
    }, 1200);
    return () => { stop = true; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {!open && !quiet && available !== false && (
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
            <WheelExperience variant="popup" onClose={close} />
          </div>
        </div>
      )}
    </>
  );
}
