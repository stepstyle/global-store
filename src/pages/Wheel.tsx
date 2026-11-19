// Prize wheel page — TEST ONLY (route exists only when VITE_WHEEL_MODE=test). Never a forced popup: the customer
// opens it. The result comes from the Worker; the animation only shows it (and is skipped with reduced motion).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { useCart } from '../App';
import SEO from '../components/SEO';
import { getFirebaseAuth } from '../services/firebase';
import type { SubmitDeps } from '../services/orderSubmit';
import { fetchWheelState, spinWheel, choosePrize, chosenPrize, type WheelSpin, type WheelState } from '../services/wheel';
import { BACKEND_ENABLED } from '../config/deployEnv';

const { Link, useNavigate } = ReactRouterDOM as any;
const SEGMENTS = 8;
const COLORS = ['#0ea5e9', '#f59e0b', '#10b981', '#f43f5e', '#6366f1', '#14b8a6', '#eab308', '#a855f7'];

export default function Wheel() {
  const { user, language } = useCart() as any;
  const isAR = language !== 'en';
  const L = (ar: string, en: string) => (isAR ? ar : en);
  const navigate = useNavigate();
  const workerUrl = BACKEND_ENABLED ? String(import.meta.env.VITE_WORKER_URL || '') : '';
  const deps = useMemo<SubmitDeps>(() => ({ fetch: (url, init) => window.fetch(url, init as RequestInit) as any }), []);
  const [state, setState] = useState<WheelState | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'sign_in' | 'not_verified' | 'closed' | 'unavailable'>('loading');
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<WheelSpin | null>(null);
  const [angle, setAngle] = useState(0);
  const [chosen, setChosen] = useState(() => chosenPrize());
  const reduced = useRef(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  const token = async () => (await getFirebaseAuth()?.currentUser?.getIdToken().catch(() => null)) ?? null;

  const load = useCallback(async () => {
    const r = await fetchWheelState(await token(), workerUrl, deps);
    if (r.kind === 'ok') { setState(r.value); setStatus(r.value.campaign === 'open' ? 'ready' : 'closed'); }
    else setStatus(r.kind === 'sign_in_required' ? 'sign_in' : r.kind === 'closed' ? 'closed' : 'unavailable');
  }, [workerUrl, deps]);

  useEffect(() => { void load(); }, [load, user?.id]);

  // a win: bring its row (with the "add to my order" button) to the middle of the screen, clear of the cookie bar
  // and of the phone's bottom edge (instant with reduced motion)
  useEffect(() => {
    if (!result || result.prizeId === 'none') return;
    const row = document.querySelector(`[data-spin-id="${result.spinId}"]`);
    row?.scrollIntoView({ block: 'center', behavior: reduced.current ? 'auto' : 'smooth' });
  }, [result, state]);

  const onSpin = async () => {
    if (spinning) return;
    setSpinning(true);
    setResult(null);
    const r = await spinWheel(await token(), workerUrl, deps);
    if (r.kind !== 'ok') {
      setSpinning(false);
      setStatus(r.kind === 'sign_in_required' ? 'sign_in' : r.kind === 'not_verified' ? 'not_verified' : r.kind === 'closed' ? 'closed' : 'unavailable');
      return;
    }
    const wait = reduced.current ? 0 : 3200;
    setAngle((a) => a + 360 * 5 + Math.floor(Math.random() * 360));
    window.setTimeout(() => {
      setResult(r.value.result);
      setSpinning(false);
      void load();
    }, wait);
  };

  const take = (s: WheelSpin) => {
    choosePrize({ spinId: s.spinId, label: s.label });
    setChosen({ spinId: s.spinId, label: s.label });
    navigate('/cart');
  };

  const won = (s: WheelSpin | null) => !!s && s.status === 'issued' && s.prizeId !== 'none';

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4" dir={isAR ? 'rtl' : 'ltr'} data-testid="wheel-page">
      <SEO title={L('عجلة الجوائز (تجريبية)', 'Prize wheel (test)')} description="" />
      <div className="mx-auto max-w-xl rounded-3xl bg-white p-6 shadow-sm border border-slate-100">
        <p className="mb-2 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">{L('نسخة تجريبية — ليست حملة حقيقية', 'Test version — not a real campaign')}</p>
        <h1 className="font-heading text-2xl font-black text-slate-900">{L('عجلة الجوائز', 'Prize wheel')}</h1>

        {status === 'loading' && <p className="mt-4 text-slate-500" role="status">{L('جارٍ التحميل…', 'Loading…')}</p>}
        {status === 'sign_in' && (
          <p className="mt-4 text-slate-700" data-testid="wheel-sign-in">
            {L('سجّل الدخول بحسابك لتدوير العجلة. لكل حساب فرصة أولى، وفرصة إضافية عند استلام طلب مؤهَّل.', 'Sign in to spin. Every account gets a first chance, plus one per qualifying delivered order.')}{' '}
            <Link to="/login" className="font-bold text-sky-700 underline">{L('تسجيل الدخول', 'Sign in')}</Link>
          </p>
        )}
        {status === 'not_verified' && <p className="mt-4 text-slate-700" data-testid="wheel-not-verified">{L('يلزم تأكيد بريدك الإلكتروني أولًا (حسابات Google مؤكّدة تلقائيًا).', 'Please verify your e-mail first (Google accounts are verified automatically).')}</p>}
        {status === 'closed' && <p className="mt-4 text-slate-700" data-testid="wheel-closed">{L('الحملة غير متاحة حاليًا.', 'The campaign is not available right now.')}</p>}
        {status === 'unavailable' && <p className="mt-4 text-slate-700">{L('تعذّر الاتصال الآن. حاول لاحقًا.', 'Could not connect. Try again later.')}</p>}

        {status === 'ready' && state && (
          <>
            <div className="relative mx-auto my-6 h-64 w-64" aria-hidden="true">
              <div className="absolute left-1/2 top-[-6px] z-10 h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[18px] border-x-transparent border-t-slate-900" />
              <svg viewBox="-1 -1 2 2" className="h-full w-full" style={{ transform: `rotate(${angle}deg)`, transition: reduced.current ? 'none' : 'transform 3.2s cubic-bezier(.17,.67,.21,1)' }}>
                {Array.from({ length: SEGMENTS }, (_, i) => {
                  const a0 = (i / SEGMENTS) * 2 * Math.PI;
                  const a1 = ((i + 1) / SEGMENTS) * 2 * Math.PI;
                  return <path key={i} d={`M0 0 L${Math.cos(a0)} ${Math.sin(a0)} A1 1 0 0 1 ${Math.cos(a1)} ${Math.sin(a1)} Z`} fill={COLORS[i % COLORS.length]} stroke="#fff" strokeWidth="0.01" />;
                })}
                <circle r="0.12" fill="#fff" />
              </svg>
            </div>
            <p className="text-center text-sm text-slate-600" data-testid="wheel-chances">
              {L(`الفرص المتبقية: ${state.chancesLeft}`, `Chances left: ${state.chancesLeft}`)}
            </p>
            <button
              type="button" onClick={onSpin} disabled={spinning || state.chancesLeft < 1} data-testid="wheel-spin"
              className="mt-3 w-full rounded-2xl bg-sky-600 py-3 font-black text-white disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300"
            >
              {spinning ? L('جارٍ التدوير…', 'Spinning…') : L('دوّر العجلة', 'Spin')}
            </button>
            {state.minOrderJod !== null && (
              <p className="mt-3 text-xs text-slate-500">{L(`تُستلم الهدية مع طلب لا تقل قيمة منتجاته عن ${state.minOrderJod} د.أ (بدون التوصيل).`, `The gift ships with an order of at least ${state.minOrderJod} JOD in products (delivery excluded).`)}</p>
            )}
          </>
        )}

        <div aria-live="polite" role="status" className="mt-4" data-testid="wheel-result">
          {result && (won(result)
            ? <p className="rounded-2xl bg-emerald-50 p-3 font-bold text-emerald-800">{L(`مبروك! ربحت: ${result.label}`, `You won: ${result.label}`)}</p>
            : <p className="rounded-2xl bg-slate-100 p-3 font-bold text-slate-700">{L('حظ أوفر في المرة القادمة.', 'Better luck next time.')}</p>)}
        </div>

        {state && state.spins.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-2 font-black text-slate-800">{L('نتائجك', 'Your results')}</h2>
            <ul className="space-y-2">
              {state.spins.map((s) => (
                <li key={s.spinId} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 p-2 text-sm" data-testid="wheel-spin-row" data-status={s.status} data-spin-id={s.spinId}>
                  <span>{s.prizeId === 'none' ? L('بدون جائزة', 'No prize') : s.label}</span>
                  {won(s) ? (
                    chosen?.spinId === s.spinId
                      ? <span className="text-xs font-bold text-emerald-700">{L('ستُرسل مع طلبك القادم', 'Will ship with your next order')}</span>
                      : <button type="button" className="text-xs font-bold text-sky-700 underline" onClick={() => take(s)} data-testid="wheel-take">{L('استلمها مع طلبي', 'Add to my order')}</button>
                  ) : (
                    <span className="text-xs text-slate-500">{s.status === 'reserved' ? L('مرفقة بطلب', 'Attached to an order') : s.status === 'consumed' ? L('تم التسليم', 'Delivered') : s.status === 'expired' ? L('منتهية', 'Expired') : ''}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {state?.terms && (
          <details className="mt-6 text-xs text-slate-600">
            <summary className="cursor-pointer font-bold">{L('الشروط', 'Terms')}</summary>
            <p className="mt-2 whitespace-pre-line">{state.terms}</p>
          </details>
        )}
      </div>
    </div>
  );
}
