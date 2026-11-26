// The result of a spin, shown ONCE in the middle of the screen right after the wheel stops on the segment the Worker
// drew (never while it turns, never a guess: it receives the stored result the wheel landed on).
//   won        -> a short celebration (soft pop-in + a few confetti pieces; nothing moves with "reduce motion"),
//                 the prize's real name, what it needs, and two clear actions (use it / keep shopping)
//   "حظ أوفر"  -> a kind message and "متابعة التسوق" — no word that suggests a prize
// Closing it (X, Escape, a button, a click outside) never loses the prize: it is stored by the Worker and kept in the
// wheel's own result box (the popup / page underneath) and at checkout, exactly as before.
// Rendered into <body> above every layer (header, cookie bar, assistant, the wheel popup itself), sized to the screen
// (dvh, safe areas): nothing to scroll on any phone, iPhone SE included.
import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as ReactRouterDOM from 'react-router-dom';
import { prizeText, isSecondOrder, type WheelSpin } from '../../services/wheel';
import PrizeCountdown from './PrizeCountdown';

const { Link } = ReactRouterDOM as any;

function Confetti() {
  // limited: 18 pieces, 1.4 s, transforms + opacity only (GPU), never repeated
  const bits = useMemo(() => Array.from({ length: 18 }, (_, i) => ({ left: 4 + ((i * 53) % 92), delay: (i % 6) * 0.06, drift: ((i * 29) % 60) - 30, hue: i % 4, rot: (i * 47) % 360 })), []);
  const colors = ['#D4A645', '#5786C1', '#ECD59A', '#35547B'];
  return (
    <div aria-hidden="true" className="wr-confetti pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden" data-testid="wheel-result-confetti">
      {bits.map((b, i) => (
        <span
          key={i}
          className="wr-bit absolute top-0 block h-2.5 w-1.5 rounded-[2px]"
          style={{ left: `${b.left}%`, background: colors[b.hue], animationDelay: `${b.delay}s`, ['--wr-drift' as any]: `${b.drift}px`, ['--wr-rot' as any]: `${b.rot}deg` }}
        />
      ))}
    </div>
  );
}

export default function WheelResultDialog({
  result, won, icon, isAR, holdMin, secondDays, guest, hasCart, onClose, onExpire,
}: {
  result: WheelSpin; won: boolean; icon?: string; isAR: boolean; holdMin: number; secondDays: number; guest: boolean; hasCart: boolean;
  onClose: () => void; onExpire?: () => void;
}) {
  const L = (ar: string, en: string) => (isAR ? ar : en);
  const second = isSecondOrder(result);
  const primaryRef = useRef<HTMLElement | null>(null);
  const lastFocus = useRef<Element | null>(null);
  // the latest close handler, read at call time: the keyboard / focus set-up below runs ONCE per window (a parent
  // re-render never re-registers it or moves the focus again)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    lastFocus.current = document.activeElement;
    // the main action gets the focus (keyboard / screen reader land on the result, not behind it)
    const t = window.setTimeout(() => primaryRef.current?.focus({ preventScroll: true } as any), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      (lastFocus.current as HTMLElement | null)?.focus?.({ preventScroll: true } as any);
    };
  }, []);

  const note = !won ? '' : second
    ? L(`خصم لطلبك الثاني: يُحفظ لك حتى تسليم طلبك الأول، ثم يكون صالحًا ${secondDays} أيام على طلبك الثاني بمنتجات ${result.minOrderJod ?? 15} د.أ فأكثر.`, `For your second order: kept until your first order is delivered, then valid ${secondDays} days on your second order with products of ${result.minOrderJod ?? 15} JOD or more.`)
    : guest
      ? L('الجائزة محفوظة لك. عند «تأكيد الطلب» تسجّل الدخول بـ Google فتُربط بحسابك وتُطبَّق إذا حقق الطلب شروطها.', 'Your prize is saved. At "Confirm order" you sign in with Google; it is linked to your account and applied if the order meets its conditions.')
      : L('تُثبَّت الجائزة عند تأكيد طلب يحقق شروطها.', 'The prize is confirmed with an order that meets its conditions.');

  const node = (
    <div
      className="wr-backdrop fixed inset-0 z-[2147483600] flex items-center justify-center bg-ink-950/60 px-4 py-[max(1rem,env(safe-area-inset-top))] backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="wheel-result-dialog" data-kind={won ? 'win' : 'none'} data-prize-id={result.prizeId} data-prize-type={result.type}
      dir={isAR ? 'rtl' : 'ltr'}
    >
      <div
        role="alertdialog" aria-modal="true" aria-labelledby="wheel-result-title" aria-describedby="wheel-result-desc"
        className={`wr-card relative w-full max-w-[24rem] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-[1.75rem] bg-white text-center shadow-2xl ring-1 ${won ? 'ring-gold-200' : 'ring-ink-100'}`}
        data-testid="wheel-result-card"
      >
        {won && <Confetti />}
        <button
          type="button" onClick={onClose} data-testid="wheel-result-close"
          className="absolute end-2.5 top-2.5 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-ink-50 text-ink-900 ring-1 ring-ink-100 transition hover:bg-ink-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-300"
          aria-label={L('إغلاق', 'Close')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
        </button>

        <div className={`px-6 pb-6 pt-8 sm:px-7 ${won ? 'bg-gradient-to-b from-gold-50 via-white to-white' : 'bg-gradient-to-b from-paper-100 via-white to-white'}`}>
          <div className={`wr-badge mx-auto flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full text-[2.1rem] shadow-soft ${won ? 'bg-gradient-to-b from-gold-200 to-gold-400' : 'bg-paper-200'}`} aria-hidden="true">
            {won ? (icon || '🎁') : '🍀'}
          </div>
          {won ? (
            <>
              <p className="mt-4 text-[13px] font-black tracking-wide text-gold-700">{L('مبروك!', 'Congratulations!')}</p>
              <h2 id="wheel-result-title" className="mt-1 font-heading text-[1.6rem] font-black leading-tight text-ink-950" data-testid="wheel-result-title">
                {L(`ربحت ${result.label}`, `You won ${result.label}`)}
              </h2>
              <p id="wheel-result-desc" className="mt-2 text-[15px] font-bold leading-relaxed text-ink-800" data-testid="wheel-result-detail">{prizeText(result, isAR)}</p>
              <p className="mt-2 text-[12.5px] font-medium leading-relaxed text-ink-600">{note}</p>
              {!second && result.expiresAt && (
                <p className="mt-2 text-sm"><PrizeCountdown expiresAt={result.expiresAt} isAR={isAR} onExpire={onExpire} testId="wheel-result-countdown" /></p>
              )}
              {!second && !result.expiresAt && <p className="mt-2 text-[12px] font-bold text-ink-600">{L(`صالحة ${holdMin} دقيقة من لحظة اللفة.`, `Valid for ${holdMin} minutes from the spin.`)}</p>}
              <div className="mt-5 grid gap-2.5">
                <Link
                  to={hasCart ? '/cart' : '/shop'} onClick={onClose} ref={primaryRef as any} data-testid="wheel-result-use"
                  className="flex min-h-[50px] items-center justify-center rounded-2xl bg-ink-900 px-5 text-[15px] font-black text-paper-50 shadow-soft transition hover:bg-ink-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-300"
                >
                  {hasCart ? L('استخدم الجائزة — اذهب إلى السلة', 'Use it — go to cart') : L('تسوّق واستخدم الجائزة', 'Shop and use your prize')}
                </Link>
                <button
                  type="button" onClick={onClose} data-testid="wheel-result-continue"
                  className="min-h-[48px] rounded-2xl border border-ink-200 bg-white px-5 text-[15px] font-black text-ink-900 transition hover:bg-ink-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-300"
                >
                  {L('متابعة التسوق', 'Continue shopping')}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 id="wheel-result-title" className="mt-4 font-heading text-[1.55rem] font-black leading-tight text-ink-950" data-testid="wheel-result-title">
                {L('حظ أوفر هذه المرة', 'Better luck this time')}
              </h2>
              <p id="wheel-result-desc" className="mt-2 text-[15px] font-medium leading-relaxed text-ink-700" data-testid="wheel-result-detail">
                {L('شكرًا لمشاركتك! تحصل على لفّة جديدة مع كل طلب مؤهَّل جديد.', 'Thanks for playing! You get a new spin with every new qualifying order.')}
              </p>
              <div className="mt-5 grid">
                <button
                  type="button" onClick={onClose} ref={primaryRef as any} data-testid="wheel-result-continue"
                  className="min-h-[50px] rounded-2xl bg-ink-900 px-5 text-[15px] font-black text-paper-50 shadow-soft transition hover:bg-ink-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-300"
                >
                  {L('متابعة التسوق', 'Continue shopping')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}
