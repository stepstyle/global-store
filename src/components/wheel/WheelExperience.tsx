// The wheel experience (popup and /wheel page). The Worker draws and stores every result; this component only asks,
// then turns the wheel to the segment that was drawn and explains the prize's conditions.
//   NOT signed in -> spins at once, WITHOUT any sign-in (owner's rule): the result is stored by the Worker under this
//                    browser's random ticket; the Google sign-in comes only at "confirm order", where the prize is
//                    linked to the account (services/wheel.ts claimGuestResult)
//   signed in     -> the account's chances (welcome + one per qualifying delivered order); a kept guest ticket is
//                    linked to the account first (it IS the welcome spin)
//   one result per chance / per ticket: refresh, popup reopened, second tab = the same stored result, never a new draw
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { useCart } from '../../App';
import { getFirebaseAuth } from '../../services/firebase';
import type { SubmitDeps } from '../../services/orderSubmit';
import { BACKEND_ENABLED } from '../../config/deployEnv';
import {
  fetchWheelPublic, fetchWheelState, spinWheel, choosePrize, prizeText, targetRotation, usablePrize,
  spinAsGuest, fetchGuestResult, claimGuestResult, guestAsSpin, prizeExpired, DEFAULT_HOLD_MINUTES, isSecondOrder, prizeWaiting, SECOND_ORDER_HOURS,
  type WheelSlot, type WheelSpin, type WheelState,
} from '../../services/wheel';
import WheelDial from './WheelDial';
import PrizeCountdown from './PrizeCountdown';
import SecondOrderStatus, { secondOrderEndReason } from './SecondOrderStatus';

const { Link } = ReactRouterDOM as any;
const SPIN_MS = 4600;

const STATUS_AR: Record<string, string> = { waiting: 'محفوظة — تبدأ الأيام الخمسة عند تسليم طلبك الأول', issued: 'أولية — تُثبَّت عند تأكيد طلب مؤهَّل', reserved: 'بانتظار تأكيد الطلب', consumed: 'مستحقة ومستخدمة', expired: 'منتهية أو ملغاة', none: 'حظ أوفر' };
const STATUS_EN: Record<string, string> = { waiting: 'Kept — the 5 days start when your first order is delivered', issued: 'Provisional — confirmed with a qualifying order', reserved: 'Waiting for the order to be confirmed', consumed: 'Earned and used', expired: 'Expired or cancelled', none: 'Better luck' };

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
  // this browser's guest result (not signed in): the wheel is "used" — shown again, never drawn again
  const [guestSpun, setGuestSpun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [rotation, setRotation] = useState(0);
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<WheelSpin | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  // the prize window (minutes, from the Worker) and a re-render when the shown prize's time is up
  const [holdMin, setHoldMin] = useState(DEFAULT_HOLD_MINUTES);
  const [, setExpiredTick] = useState(0);
  const onExpire = useCallback(() => setExpiredTick((n) => n + 1), []);
  const alive = useRef(true);
  // set on EVERY mount (React may mount, unmount and mount again: a flag left false would drop every answer)
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const idToken = async () => (await getFirebaseAuth()?.currentUser?.getIdToken().catch(() => null)) ?? null;
  const signedIn = !!getFirebaseAuth()?.currentUser;

  const loadAccount = useCallback(async (): Promise<WheelState | null> => {
    const t = await idToken();
    if (!t) { setSt(null); return null; }
    // a guest result kept in this browser is the account's welcome spin: link it first (the Worker decides, once)
    await claimGuestResult(t, workerUrl, deps);
    const r = await fetchWheelState(t, workerUrl, deps);
    if (r.kind === 'ok') {
      setSt(r.value);
      if (r.value.slots.length) setSlots(r.value.slots);
      return r.value;
    }
    if (r.kind === 'not_verified') setMsg(L('يلزم تأكيد بريدك الإلكتروني أولًا (حسابات Google مؤكَّدة تلقائيًا).', 'Please verify your e-mail first (Google accounts are verified automatically).'));
    return null;
  }, [workerUrl, deps, isAR]);

  /** the result already stored for this browser's ticket: shown in place, the wheel resting on its segment */
  const showGuest = useCallback(async (list: WheelSlot[]) => {
    const g = await fetchGuestResult(workerUrl, deps);
    if (!alive.current || !g || g === 'unavailable') return;
    const spin = guestAsSpin(g);
    setGuestSpun(true);
    setResult(spin);
    const idx = list.findIndex((s) => s.id === g.prizeId);
    if (idx >= 0) { setDuration(0); setRotation(targetRotation(0, idx, list.length, 0, 0)); setHighlight(g.prizeId); }
  }, [workerUrl, deps]);

  const load = useCallback(async () => {
    const p = await fetchWheelPublic(workerUrl, deps);
    if (!alive.current) return;
    if (p.kind !== 'ok') { setPhase('unavailable'); return; }
    if (p.value.campaign !== 'open' || p.value.slots.length < 2) { setPhase('closed'); return; }
    setSlots(p.value.slots);
    setTerms(p.value.terms);
    setHoldMin(p.value.prizeHoldMinutes);
    setPhase('ready');
    if (getFirebaseAuth()?.currentUser) await loadAccount();
    else { setSt(null); await showGuest(p.value.slots); }
  }, [workerUrl, deps, loadAccount, showGuest]);

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
    if (r.spinId && usablePrize(r)) choosePrize({ spinId: r.spinId, label: r.label });
  };

  const accountSpin = async () => {
    const state = await loadAccount();
    if (!state) return;
    if (state.campaign !== 'open') { setPhase('closed'); return; }
    if (state.chancesLeft < 1) {
      setMsg(L('لا توجد لفة متاحة الآن. تحصل على لفة جديدة مع كل طلب مؤهَّل جديد بعد تسليمه.', 'No spin available now. You get a new spin with every new qualifying order once it is delivered.'));
      return;
    }
    const r = await spinWheel(await idToken(), workerUrl, deps);
    if (r.kind !== 'ok') {
      setMsg(r.kind === 'not_verified' ? L('يلزم تأكيد بريدك الإلكتروني أولًا.', 'Please verify your e-mail first.') : r.kind === 'closed' ? L('الحملة غير متاحة حاليًا.', 'The campaign is not available right now.') : L('تعذّر الاتصال الآن. لم تُستخدم لفتك؛ حاول لاحقًا.', 'Could not connect. Your spin was not used; try again later.'));
      return;
    }
    await animateTo(r.value.result);
    await loadAccount();
  };

  // no sign-in here, ever (owner's rule): the Worker draws for this browser's ticket
  const guestSpin = async () => {
    const r = await spinAsGuest(workerUrl, deps);
    if (r.kind !== 'ok') {
      setMsg(
        r.kind === 'limit' ? L('وصلت اللفات من هذه الشبكة إلى الحد اليومي. حاول لاحقًا.', 'The daily spin limit for this network was reached. Try again later.')
          : r.kind === 'closed' ? L('الحملة غير متاحة حاليًا.', 'The campaign is not available right now.')
            : r.kind === 'no_storage' ? L('لا يمكن حفظ نتيجتك في هذا المتصفح (وضع التصفح الخاص أو التخزين معطّل). استخدم نافذة عادية للّف.', 'Your result cannot be saved in this browser (private mode or storage disabled). Use a normal window to spin.')
              : L('تعذّر الاتصال الآن. حاول لاحقًا.', 'Could not connect. Try again later.'),
      );
      return;
    }
    setGuestSpun(true);
    await animateTo(guestAsSpin(r.result));
  };

  const onSpin = async () => {
    if (busy || guestSpun) return;
    setBusy(true);
    setMsg('');
    setResult(null);
    setHighlight(null);
    try {
      if (getFirebaseAuth()?.currentUser) await accountSpin();
      else await guestSpin();
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  // a second-order prize waiting for the first delivery is WON (kept), just not usable yet
  const won = result && (usablePrize(result) || prizeWaiting(result));
  const expired = !!result && prizeExpired(result);
  const second = !!result && isSecondOrder(result);
  const secondH = st?.secondOrderHours ?? SECOND_ORDER_HOURS;
  const fmtWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(isAR ? 'ar-JO' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const isGuestResult = !!result && !result.spinId;
  const myPrizes = (st?.spins || []).filter((s) => s.type !== 'none').slice().reverse();
  const used = guestSpun && !signedIn;

  return (
    <div className="relative" dir={isAR ? 'rtl' : 'ltr'} data-testid="wheel-experience" data-phase={phase}>
      {won && !reduced.current && <Confetti />}
      <p className="mb-2 inline-block rounded-full bg-gold-100 px-3 py-1 text-[11px] font-black text-gold-800">{L('نسخة تجريبية — ليست حملة حقيقية', 'Test version — not a real campaign')}</p>
      <h2 className="font-heading text-2xl font-black text-ink-950" id="wheel-title">{L('دولاب الحظ', 'Lucky wheel')}</h2>
      <p className="mt-1 text-sm font-medium text-ink-700">{L('لفّة ترحيبية واحدة الآن دون تسجيل، ولفّة جديدة مع كل طلب مؤهَّل جديد.', 'One welcome spin now, no sign-in needed, and a new spin with every new qualifying order.')}</p>

      {phase === 'loading' && <p className="mt-6 text-center text-ink-500" role="status">{L('جارٍ التحميل…', 'Loading…')}</p>}
      {phase === 'closed' && <p className="mt-6 rounded-2xl bg-paper-200 p-4 text-center font-bold text-ink-800" data-testid="wheel-closed">{L('الحملة غير متاحة حاليًا.', 'The campaign is not available right now.')}</p>}
      {phase === 'unavailable' && <p className="mt-6 rounded-2xl bg-paper-200 p-4 text-center font-bold text-ink-800">{L('تعذّر الاتصال الآن. حاول لاحقًا.', 'Could not connect. Try again later.')}</p>}

      {phase === 'ready' && (
        <>
          <div className="mt-5">
            <WheelDial slots={slots} rotation={rotation} durationMs={duration} highlight={highlight} />
          </div>
          <button
            type="button" onClick={() => void onSpin()} disabled={busy || used} data-testid="wheel-spin" data-used={used ? '1' : '0'}
            className="mt-5 w-full rounded-2xl bg-ink-900 py-3.5 font-black text-paper-50 shadow-soft transition hover:bg-ink-800 disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-300"
          >
            {busy ? L('جارٍ اللف…', 'Spinning…') : used ? L('استخدمت لفّتك — نتيجتك محفوظة', 'Spin used — your result is saved') : L('لفّ الدولاب', 'Spin the wheel')}
          </button>
          {st && <p className="mt-2 text-center text-xs font-bold text-ink-600" data-testid="wheel-chances">{L(`اللفات المتاحة لحسابك: ${st.chancesLeft}`, `Spins available: ${st.chancesLeft}`)}</p>}

          <div aria-live="polite" role="status" className="mt-4 min-h-[1rem]" data-testid="wheel-result" data-prize-id={result?.prizeId || ''} data-prize-type={result?.type || ''} data-guest={isGuestResult ? '1' : '0'}>
            {msg && <p className="rounded-2xl bg-paper-200 p-3 text-sm font-bold text-ink-800" data-testid="wheel-message">{msg}</p>}
            {result && expired && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4" data-testid="wheel-expired" data-prize-id={result.prizeId}>
                <p className="font-heading text-base font-black text-red-800">{L(`انتهت صلاحية الجائزة: ${result.label}`, `The prize has expired: ${result.label}`)}</p>
                <p className="mt-1 text-xs font-bold leading-relaxed text-red-800">{second ? L(`انتهت مدة الأيام الخمسة بعد تسليم طلبك الأول دون استخدامها على طلبك الثاني، فلم تعد صالحة.`, 'The 5 days after your first delivery passed without using it on your second order, so it is no longer valid.') : L(`كانت صالحة ${holdMin} دقيقة من لحظة اللفة ولم تُستخدم في طلب مؤكَّد خلالها، فلم تعد صالحة للاستعمال.`, `It was valid for ${holdMin} minutes from the spin and was not used in a confirmed order in time, so it can no longer be used.`)}</p>
              </div>
            )}
            {result && !expired && (won ? (
              <div className="rounded-2xl border border-gold-200 bg-gold-50 p-4" data-testid="wheel-won" data-spin-id={result.spinId}>
                <p className="font-heading text-lg font-black text-ink-950">{L(`مبروك! ظهرت لك: ${result.label}`, `Congratulations! You got: ${result.label}`)}</p>
                <p className="mt-1 text-sm font-bold text-ink-800">{prizeText(result, isAR)}</p>
                <p className="mt-2 text-xs font-medium leading-relaxed text-ink-700">
                  {isGuestResult
                    ? L('النتيجة محفوظة في أنظمتنا لهذا المتصفح. أكمل تسوّقك؛ عند «تأكيد الطلب» تسجّل الدخول بـ Google فتُربط الجائزة بحسابك وتُطبَّق إذا حقق الطلب شروطها.', 'Your result is saved by our system for this browser. Keep shopping; at "Confirm order" you sign in with Google, the prize is linked to your account and applied if the order meets its conditions.')
                    : L('هذه نتيجة أولية: تُثبَّت الجائزة فقط عند تأكيد طلب يحقق شروطها، ولا تُصرف للطلبات الملغاة.', 'This is a provisional result: the prize is confirmed only with an order that meets its conditions, and never for cancelled orders.')}
                  {second
                    ? (result.status === 'waiting'
                      ? L(` خصم الطلب الثاني محفوظ لك ولا ينتهي بعد ساعة: أنشئ طلبك الأول خلال ${secondH / 24} أيام من الفوز، وبعد تسليمه تبدأ ${secondH / 24} أيام لاستخدامه على طلبك الثاني الفعلي بمنتجات ${result.minOrderJod ?? 15} د.أ فأكثر. تابعه من «جوائزك» في حسابك.`, ` Your second-order discount is kept (it does not end after an hour): place your first order within ${secondH / 24} days of the win; once it is delivered you have ${secondH / 24} days to use it on your actual second order with products of ${result.minOrderJod ?? 15} JOD or more. Follow it under "Your prizes" in your account.`)
                      : L(` يُستخدم على طلبك الثاني الفعلي بمنتجات ${result.minOrderJod ?? 15} د.أ فأكثر، وينتهي في ${fmtWhen(result.expiresAt)}.`, ` For your actual second order with products of ${result.minOrderJod ?? 15} JOD or more; ends ${fmtWhen(result.expiresAt)}.`))
                    : L(` صالحة ${holdMin} دقيقة من لحظة اللفة: أكّد طلبًا مؤهَّلًا قبل انتهائها لتبقى مرتبطة به.`, ` Valid for ${holdMin} minutes from the spin: confirm a qualifying order before it ends to keep it.`)}
                </p>
                {second && <SecondOrderStatus spin={result} accountState={st?.secondOrder ?? null} isAR={isAR} onExpire={onExpire} days={secondH / 24} testId="wheel-second-status" />}
                {!second && result.expiresAt && <p className="mt-2 text-sm"><PrizeCountdown expiresAt={result.expiresAt} isAR={isAR} onExpire={onExpire} testId="wheel-countdown" /></p>}
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
                      <span className="text-[11px] font-bold text-ink-600">{(isAR ? STATUS_AR : STATUS_EN)[prizeExpired(s) ? 'expired' : s.status] || s.status}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-600">{prizeText(s, isAR)}{s.orderId ? L(` — الطلب ${s.orderId}`, ` — order ${s.orderId}`) : ''}</p>
                    {isSecondOrder(s) && s.status === 'expired' && secondOrderEndReason(s.expiredReason, isAR) && <p className="mt-1 text-xs font-bold text-red-700" data-testid="wheel-row-ended" data-reason={s.expiredReason || ''}>{secondOrderEndReason(s.expiredReason, isAR)}</p>}
                    {isSecondOrder(s) && !prizeExpired(s) && <SecondOrderStatus spin={s} accountState={st?.secondOrder ?? null} isAR={isAR} onExpire={onExpire} days={secondH / 24} testId="wheel-row-second" />}
                    {!isSecondOrder(s) && s.status === 'issued' && !prizeExpired(s) && s.expiresAt && <p className="mt-0.5 text-xs"><PrizeCountdown expiresAt={s.expiresAt} isAR={isAR} onExpire={onExpire} testId="wheel-row-countdown" /></p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* honesty: the segments are drawn the SAME size; the chances are not — say so and show them */}
          <p className="mt-4 text-center text-[11px] font-bold text-ink-600" data-testid="wheel-odds-note">{L('حجم الخانات متساوٍ ولا يمثّل فرصة الفوز؛ معظم اللفات «حظ أوفر». الفرص الفعلية في «فرص الفوز» أدناه.', 'Segments are drawn the same size; that is not the chance of winning — most spins are "better luck". The real chances are under "Chances" below.')}</p>
          {slots.some((s) => s.chance !== null) && (
            <details className="mt-3 text-xs text-ink-700" data-testid="wheel-odds">
              <summary className="cursor-pointer font-black">{L('فرص الفوز', 'Chances')}</summary>
              <ul className="mt-2 space-y-0.5 ps-1">
                {(Object.values(slots.reduce((acc, s) => {
                  // the three "حظ أوفر" segments are one outcome: shown as one line with their total chance
                  const k = s.type === 'none' ? 'none' : s.id;
                  acc[k] = acc[k] ? { ...acc[k], chance: (acc[k].chance ?? 0) + (s.chance ?? 0) } : { ...s };
                  return acc;
                }, {} as Record<string, WheelSlot>)) as WheelSlot[]).map((s) => (
                  <li key={s.id} className="flex justify-between gap-3" data-testid="wheel-odds-row" data-slot-id={s.type === 'none' ? 'none' : s.id} data-chance={s.chance ?? ''}>
                    <span>{s.type === 'none' ? L('حظ أوفر (الخانات الثلاث)', 'Better luck (the three segments)') : s.label}</span>
                    <span className="font-black tabular-nums" dir="ltr">{s.chance === null ? '—' : `${(Math.round(s.chance * 1000) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px]">{L('الفرص لفئتك الحالية (حسب طلباتك المُسلَّمة؛ الزائر دون حساب = زبون جديد)، وتتغير مع نفاد الكميات وميزانية الحملة.', 'For your current tier (from your delivered orders; a visitor without an account = new customer); they change as prizes run out and with the campaign budget.')}</p>
            </details>
          )}
          <details className="mt-5 text-xs text-ink-700">
            <summary className="cursor-pointer font-black">{L('الشروط', 'Terms')}</summary>
            <ul className="mt-2 list-disc space-y-1 ps-5">
              <li>{L('النتيجة تُحدَّد وتُحفظ في أنظمتنا؛ تحديث الصفحة أو إعادة فتح الدولاب لا يمنح لفة جديدة.', 'The result is decided and stored by our system; refreshing or reopening the wheel does not give a new spin.')}</li>
              <li>{L('عند تأكيد الطلب تُربط النتيجة بحساب Google الخاص بك. لكل حساب نتيجة ترحيبية واحدة؛ إن كان لحسابك نتيجة سابقة تبقى هي المعتمدة.', 'At checkout the result is linked to your Google account. Each account has one welcome result; if your account already has one, that one stays.')}</li>
              <li>{L(`استثناء: خصم «الطلب الثاني» لا يخضع لمدة ${holdMin} دقيقة؛ يُحفظ حتى تسليم طلبك الأول، ثم يكون صالحًا ${secondH / 24} أيام على طلبك الثاني الفعلي (منتجات 15 د.أ فأكثر)، مرة واحدة.`, `Exception: the "second order" discount is not limited to ${holdMin} minutes; it is kept until your first order is delivered, then valid ${secondH / 24} days on your actual second order (products of 15 JOD or more), once.`)}</li>
              <li>{L(`الجائزة صالحة ${holdMin} دقيقة من لحظة اللفة. إذا أكّدت طلبًا مؤهَّلًا خلالها ترتبط به وتتبع حالته (التسليم أو الإلغاء)، وإلا تنتهي ويعود حجزها إلى الحملة تلقائيًا.`, `The prize is valid for ${holdMin} minutes from the spin. Confirm a qualifying order in that time and it follows the order (delivery or cancellation); otherwise it ends and goes back to the campaign automatically.`)}</li>
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
