// The wheel experience (popup and /wheel page). The Worker draws and stores the result with the verified account; this
// component only asks, then turns the wheel to the segment that was drawn and explains the prize's conditions.
//   not signed in -> the spin button opens the Google window (account chooser) first, then spins
//   one result per chance (refresh / second tab / other device = the same stored result, never a new draw)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { useCart } from '../../App';
import { getFirebaseAuth } from '../../services/firebase';
import type { SubmitDeps } from '../../services/orderSubmit';
import { BACKEND_ENABLED } from '../../config/deployEnv';
import {
  fetchWheelPublic, fetchWheelState, spinWheel, choosePrize, prizeText, targetRotation, usablePrize,
  type WheelSlot, type WheelSpin, type WheelState,
} from '../../services/wheel';
import { googlePopup } from '../../services/googleAuth';
import WheelDial from './WheelDial';

const { Link } = ReactRouterDOM as any;
const SPIN_MS = 4600;

const STATUS_AR: Record<string, string> = { issued: 'أولية — تُثبَّت عند تأكيد طلب مؤهَّل', reserved: 'بانتظار تأكيد الطلب', consumed: 'مستحقة ومستخدمة', expired: 'منتهية أو ملغاة', none: 'حظ أوفر' };
const STATUS_EN: Record<string, string> = { issued: 'Provisional — confirmed with a qualifying order', reserved: 'Waiting for the order to be confirmed', consumed: 'Earned and used', expired: 'Expired or cancelled', none: 'Better luck' };

function Confetti() {
  const bits = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ left: (i * 37) % 100, delay: (i % 9) * 0.07, hue: i % 3 })), []);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="wheel-confetti">
      <style>{`@keyframes ws-fall{0%{transform:translateY(-10%) rotate(0);opacity:1}100%{transform:translateY(420px) rotate(540deg);opacity:0}}@media (prefers-reduced-motion: reduce){.ws-bit{display:none}}`}</style>
      {bits.map((b, i) => (
        <span key={i} className="ws-bit absolute top-0 h-2 w-1.5 rounded-sm" style={{ left: `${b.left}%`, background: ['#D4A645', '#5786C1', '#ECD59A'][b.hue], animation: `ws-fall 1.6s ease-out ${b.delay}s forwards` }} />
      ))}
    </div>
  );
}

export default function WheelExperience({ variant = 'page', onClose }: { variant?: 'popup' | 'page'; onClose?: () => void }) {
  const { user, language } = useCart() as any;
  const isAR = language !== 'en';
  const L = (ar: string, en: string) => (isAR ? ar : en);
  const workerUrl = BACKEND_ENABLED ? String(import.meta.env.VITE_WORKER_URL || '') : '';
  const deps = useMemo<SubmitDeps>(() => ({ fetch: (url, init) => window.fetch(url, init as RequestInit) as any }), []);
  const reduced = useRef(typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  const [phase, setPhase] = useState<'loading' | 'ready' | 'closed' | 'unavailable'>('loading');
  const [slots, setSlots] = useState<WheelSlot[]>([]);
  const [terms, setTerms] = useState('');
  const [st, setSt] = useState<WheelState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [rotation, setRotation] = useState(0);
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<WheelSpin | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const idToken = async () => (await getFirebaseAuth()?.currentUser?.getIdToken().catch(() => null)) ?? null;

  const loadAccount = useCallback(async (): Promise<WheelState | null> => {
    const t = await idToken();
    if (!t) { setSt(null); return null; }
    const r = await fetchWheelState(t, workerUrl, deps);
    if (r.kind === 'ok') {
      setSt(r.value);
      if (r.value.slots.length) setSlots(r.value.slots);
      return r.value;
    }
    if (r.kind === 'not_verified') setMsg(L('يلزم تأكيد بريدك الإلكتروني أولًا (حسابات Google مؤكَّدة تلقائيًا).', 'Please verify your e-mail first (Google accounts are verified automatically).'));
    return null;
  }, [workerUrl, deps, isAR]);

  const load = useCallback(async () => {
    const p = await fetchWheelPublic(workerUrl, deps);
    if (!alive.current) return;
    if (p.kind !== 'ok') { setPhase('unavailable'); return; }
    if (p.value.campaign !== 'open' || p.value.slots.length < 2) { setPhase('closed'); return; }
    setSlots(p.value.slots);
    setTerms(p.value.terms);
    setPhase('ready');
    await loadAccount();
  }, [workerUrl, deps, loadAccount]);

  useEffect(() => { void load(); }, [load, user?.id]);

  const animateTo = async (r: WheelSpin) => {
    let list = slots;
    let idx = list.findIndex((s) => s.id === r.prizeId);
    if (idx < 0) {
      // the wheel changed since it was loaded (e.g. a prize ran out): show the CURRENT segments
      const p = await fetchWheelPublic(workerUrl, deps);
      if (p.kind === 'ok') { list = p.value.slots; setSlots(list); idx = list.findIndex((s) => s.id === r.prizeId); }
    }
    const ms = reduced.current ? 0 : SPIN_MS;
    if (idx >= 0) {
      setDuration(ms);
      setRotation((cur) => targetRotation(cur, idx, list.length, reduced.current ? 1 : 6, Math.random() * 0.5 - 0.25));
    }
    await new Promise((res) => setTimeout(res, ms + 60));
    if (!alive.current) return;
    setDuration(0);
    setHighlight(idx >= 0 ? r.prizeId : null);
    setResult(r);
    if (usablePrize(r)) choosePrize({ spinId: r.spinId, label: r.label });
  };

  const doSpin = async () => {
    setMsg('');
    setResult(null);
    setHighlight(null);
    const state = await loadAccount();
    if (!state) { setBusy(false); return; }
    if (state.campaign !== 'open') { setPhase('closed'); setBusy(false); return; }
    if (state.chancesLeft < 1) {
      setMsg(L('لا توجد لفة متاحة الآن. تحصل على لفة جديدة مع كل طلب مؤهَّل جديد بعد تسليمه.', 'No spin available now. You get a new spin with every new qualifying order once it is delivered.'));
      setBusy(false);
      return;
    }
    const r = await spinWheel(await idToken(), workerUrl, deps);
    if (r.kind !== 'ok') {
      setMsg(r.kind === 'not_verified' ? L('يلزم تأكيد بريدك الإلكتروني أولًا.', 'Please verify your e-mail first.') : r.kind === 'closed' ? L('الحملة غير متاحة حاليًا.', 'The campaign is not available right now.') : L('تعذّر الاتصال الآن. لم تُستخدم لفتك؛ حاول لاحقًا.', 'Could not connect. Your spin was not used; try again later.'));
      setBusy(false);
      return;
    }
    await animateTo(r.value.result);
    await loadAccount();
    if (alive.current) setBusy(false);
  };

  // The Google window must open DIRECTLY from the click (no await before it), else the browser blocks it.
  const onSpin = () => {
    if (busy) return;
    setBusy(true);
    if (!getFirebaseAuth()?.currentUser) {
      void googlePopup().then((g) => {
        if (g.outcome === 'ok') return doSpin();
        setBusy(false);
        setMsg(
          g.outcome === 'cancelled' ? L('أُغلقت نافذة Google قبل اختيار حساب. يمكنك المحاولة متى شئت.', 'The Google window was closed. You can try again any time.')
            : g.outcome === 'blocked' ? L('منع المتصفح نافذة Google. اضغط الزر مرة أخرى، أو سجّل الدخول من صفحة الحساب ثم عد إلى الدولاب.', 'Your browser blocked the Google window. Press the button again, or sign in from the account page and come back.')
              : g.outcome === 'network' ? L('تعذّر الاتصال بـ Google. تحقّق من الإنترنت ثم أعد المحاولة.', 'Could not reach Google. Check your connection and try again.')
                : L('لم يكتمل تسجيل الدخول. لم تُستخدم أي لفة؛ أعد المحاولة.', 'The sign-in did not complete. No spin was used; please try again.'),
        );
      });
      return;
    }
    void doSpin();
  };

  const won = result && usablePrize(result);
  const myPrizes = (st?.spins || []).filter((s) => s.type !== 'none').slice().reverse();
  const signedIn = !!user || !!getFirebaseAuth()?.currentUser;
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(isAR ? 'ar-JO' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

  return (
    <div className="relative" dir={isAR ? 'rtl' : 'ltr'} data-testid="wheel-experience" data-phase={phase}>
      {won && !reduced.current && <Confetti />}
      <p className="mb-2 inline-block rounded-full bg-gold-100 px-3 py-1 text-[11px] font-black text-gold-800">{L('نسخة تجريبية — ليست حملة حقيقية', 'Test version — not a real campaign')}</p>
      <h2 className="font-heading text-2xl font-black text-ink-950" id="wheel-title">{L('دولاب الحظ', 'Lucky wheel')}</h2>
      <p className="mt-1 text-sm font-medium text-ink-700">{L('لفّة واحدة لكل حساب للترحيب، ولفّة جديدة مع كل طلب مؤهَّل جديد.', 'One welcome spin per account, and a new spin with every new qualifying order.')}</p>

      {phase === 'loading' && <p className="mt-6 text-center text-ink-500" role="status">{L('جارٍ التحميل…', 'Loading…')}</p>}
      {phase === 'closed' && <p className="mt-6 rounded-2xl bg-paper-200 p-4 text-center font-bold text-ink-800" data-testid="wheel-closed">{L('الحملة غير متاحة حاليًا.', 'The campaign is not available right now.')}</p>}
      {phase === 'unavailable' && <p className="mt-6 rounded-2xl bg-paper-200 p-4 text-center font-bold text-ink-800">{L('تعذّر الاتصال الآن. حاول لاحقًا.', 'Could not connect. Try again later.')}</p>}

      {phase === 'ready' && (
        <>
          <div className="mt-5">
            <WheelDial slots={slots} rotation={rotation} durationMs={duration} highlight={highlight} />
          </div>
          <button
            type="button" onClick={onSpin} disabled={busy} data-testid="wheel-spin"
            className="mt-5 w-full rounded-2xl bg-ink-900 py-3.5 font-black text-paper-50 shadow-soft transition hover:bg-ink-800 disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-300"
          >
            {busy ? L('جارٍ اللف…', 'Spinning…') : signedIn ? L('لفّ الدولاب', 'Spin the wheel') : L('سجّل الدخول بـ Google ولفّ الدولاب', 'Sign in with Google and spin')}
          </button>
          {st && <p className="mt-2 text-center text-xs font-bold text-ink-600" data-testid="wheel-chances">{L(`اللفات المتاحة لحسابك: ${st.chancesLeft}`, `Spins available: ${st.chancesLeft}`)}</p>}

          <div aria-live="polite" role="status" className="mt-4 min-h-[1rem]" data-testid="wheel-result" data-prize-id={result?.prizeId || ''} data-prize-type={result?.type || ''}>
            {msg && <p className="rounded-2xl bg-paper-200 p-3 text-sm font-bold text-ink-800" data-testid="wheel-message">{msg}</p>}
            {result && (won ? (
              <div className="rounded-2xl border border-gold-200 bg-gold-50 p-4" data-testid="wheel-won" data-spin-id={result.spinId}>
                <p className="font-heading text-lg font-black text-ink-950">{L(`مبروك! ظهرت لك: ${result.label}`, `Congratulations! You got: ${result.label}`)}</p>
                <p className="mt-1 text-sm font-bold text-ink-800">{prizeText(result, isAR)}</p>
                <p className="mt-2 text-xs font-medium leading-relaxed text-ink-700">
                  {L('هذه نتيجة أولية: تُثبَّت الجائزة فقط عند تأكيد طلب يحقق شروطها، ولا تُصرف للطلبات الملغاة.', 'This is a provisional result: the prize is confirmed only with an order that meets its conditions, and never for cancelled orders.')}
                  {result.expiresAt && L(` صالحة حتى ${fmtDate(result.expiresAt)}.`, ` Valid until ${fmtDate(result.expiresAt)}.`)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {variant === 'popup' && <button type="button" onClick={onClose} className="rounded-xl bg-ink-900 px-4 py-2 text-sm font-black text-paper-50" data-testid="wheel-continue">{L('أكمل التسوق', 'Continue shopping')}</button>}
                  <Link to="/cart" onClick={onClose} className="rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm font-black text-ink-900">{L('اذهب إلى السلة', 'Go to cart')}</Link>
                </div>
              </div>
            ) : (
              <p className="rounded-2xl bg-paper-200 p-3 text-center font-heading font-black text-ink-800" data-testid="wheel-no-prize">{L('حظ أوفر هذه المرة!', 'Better luck this time!')}</p>
            ))}
          </div>

          {myPrizes.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-black text-ink-900">{L('جوائزك', 'Your prizes')}</h3>
              <ul className="space-y-2">
                {myPrizes.map((s) => (
                  <li key={s.spinId} className="rounded-xl border border-ink-100 bg-white p-2.5 text-sm" data-testid="wheel-spin-row" data-status={s.status} data-spin-id={s.spinId}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-ink-900">{s.label}</span>
                      <span className="text-[11px] font-bold text-ink-600">{(isAR ? STATUS_AR : STATUS_EN)[s.status] || s.status}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-600">{prizeText(s, isAR)}{s.status === 'issued' && s.expiresAt ? L(` — حتى ${fmtDate(s.expiresAt)}`, ` — until ${fmtDate(s.expiresAt)}`) : ''}{s.orderId ? L(` — الطلب ${s.orderId}`, ` — order ${s.orderId}`) : ''}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details className="mt-5 text-xs text-ink-700">
            <summary className="cursor-pointer font-black">{L('الشروط', 'Terms')}</summary>
            <ul className="mt-2 list-disc space-y-1 ps-5">
              <li>{L('النتيجة تُحدَّد وتُحفظ في أنظمتنا مع حسابك؛ تحديث الصفحة أو فتحها من جهاز آخر لا يمنح لفة جديدة.', 'The result is decided and stored by our system with your account; refreshing or another device does not give a new spin.')}</li>
              <li>{L('لكل جائزة حد أدنى لقيمة المنتجات (قبل الخصم ودون التوصيل) وصلاحية تظهر عند الفوز.', 'Each prize has a minimum products total (before the prize, delivery excluded) and a validity shown when you win.')}</li>
              <li>{L('جائزة واحدة كحد أقصى لكل طلب، ولا تُجمع الجوائز.', 'At most one prize per order; prizes cannot be combined.')}</li>
              <li>{L('تُلغى الجائزة إذا أُلغي الطلب أو أُرجع.', 'The prize is cancelled if the order is cancelled or returned.')}</li>
            </ul>
            {terms && <p className="mt-2 whitespace-pre-line">{terms}</p>}
          </details>
        </>
      )}
    </div>
  );
}
