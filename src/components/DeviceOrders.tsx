// «طلباتي» on THIS device (guest) and linking those guest orders to the signed-in account.
// Order numbers + tracking keys live on the device (per identity); everything shown about an order comes from the
// order Worker (summary without personal data). Keys never appear in a URL, a link or analytics.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { Package, RefreshCw, Link2, Search, CheckCircle2, AlertTriangle } from 'lucide-react';
import { trackingKeys } from '../services/checkoutFlow';
import { deviceOrderIds, loadDeviceOrders, claimOrder, PHONE_LAST4_RE, type DeviceOrder, type ClaimResult } from '../services/myOrders';
import { getFirebaseAuth } from '../services/firebase';
import type { SubmitDeps, SubmitOptions } from '../services/orderSubmit';

const { Link, useNavigate } = ReactRouterDOM as any;

const STATUS_AR: Record<string, string> = { new: 'تم استلام الطلب', processing: 'قيد التجهيز', shipped: 'في الطريق إليك', delivered: 'تم التسليم', cancelled: 'ملغى' };
const STATUS_EN: Record<string, string> = { new: 'Received', processing: 'Preparing', shipped: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
const STATUS_TONE: Record<string, string> = { delivered: 'bg-emerald-50 text-emerald-700', cancelled: 'bg-rose-50 text-rose-700', shipped: 'bg-sky-50 text-sky-700' };

type Props = {
  /** 'guest': the visitor's own orders on this device. 'link': a signed-in customer may link this device's guest orders. */
  mode: 'guest' | 'link';
  /** signed-in uid (mode 'link') */
  uid?: string;
  isAR: boolean;
  /** after a successful link (the account's list should reload) */
  onLinked?: () => void;
};

export default function DeviceOrders({ mode, uid, isAR, onLinked }: Props) {
  const navigate = useNavigate();
  const L = (ar: string, en: string) => (isAR ? ar : en);
  const opts = useMemo<SubmitOptions>(() => ({ workerUrl: String(import.meta.env.VITE_WORKER_URL || ''), timeoutMs: 12_000 }), []);
  const deps = useMemo<SubmitDeps>(() => ({ fetch: (url, init) => window.fetch(url, init as RequestInit) as any }), []);
  const store = useMemo(() => trackingKeys(), []);
  const [entries, setEntries] = useState(() => deviceOrderIds(store, 'guest'));
  const [rows, setRows] = useState<DeviceOrder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [last4, setLast4] = useState<Record<string, string>>({});
  const [claimState, setClaimState] = useState<Record<string, ClaimResult | 'busy'>>({});
  const [lookupId, setLookupId] = useState('');
  const [lookupCode, setLookupCode] = useState('');

  const load = useCallback(async () => {
    const list = deviceOrderIds(store, 'guest');
    setEntries(list);
    if (!list.length) { setRows([]); return; }
    setLoading(true);
    try {
      setRows(await loadDeviceOrders(list, opts, deps));
    } finally {
      setLoading(false);
    }
  }, [store, opts, deps]);

  useEffect(() => { void load(); }, [load]);

  const money = (n: number) => `${(Number(n) || 0).toFixed(2)} ${L('د.أ', 'JOD')}`;
  const statusLabel = (s: string) => (isAR ? STATUS_AR[s] : STATUS_EN[s]) || L('غير معروف', 'Unknown');

  const doClaim = async (orderId: string) => {
    const entry = entries.find((e) => e.orderId === orderId);
    if (!entry || !uid) return;
    setClaimState((s) => ({ ...s, [orderId]: 'busy' }));
    const token = await getFirebaseAuth()?.currentUser?.getIdToken().catch(() => null);
    const r = await claimOrder(orderId, entry.key, (last4[orderId] || '').trim(), token ?? null, opts, deps);
    setClaimState((s) => ({ ...s, [orderId]: r }));
    if (r.kind === 'linked' || r.kind === 'already_yours') {
      store.reassign?.(orderId, 'guest', uid); // this device now keeps it under the account (never mixed with guests)
      onLinked?.();
      setTimeout(() => void load(), 600);
    }
  };

  const claimMsg = (r: ClaimResult | 'busy' | undefined) => {
    if (!r || r === 'busy') return null;
    const m: Record<ClaimResult['kind'], [string, string, boolean]> = {
      linked: ['تم ربط الطلب بحسابك.', 'The order is now linked to your account.', true],
      already_yours: ['هذا الطلب مرتبط بحسابك مسبقًا.', 'This order is already in your account.', true],
      already_linked: ['هذا الطلب مرتبط بحساب آخر ولا يمكن نقله.', 'This order belongs to another account and cannot be moved.', false],
      not_matching: ['البيانات غير مطابقة لهذا الطلب. تأكد من آخر 4 أرقام من هاتف الطلب.', 'The details do not match this order. Check the last 4 digits of the order phone.', false],
      sign_in_required: ['انتهت جلسة الدخول. سجّل الدخول ثم أعد المحاولة.', 'Your session ended. Sign in and try again.', false],
      unavailable: ['تعذّر الاتصال الآن. تحقق من الإنترنت وأعد المحاولة.', 'Could not connect now. Check your connection and try again.', false],
    };
    const [ar, en, ok] = m[r.kind];
    return <p data-testid="claim-result" data-kind={r.kind} className={`mt-2 text-xs font-bold ${ok ? 'text-emerald-700' : 'text-rose-700'}`}>{L(ar, en)}</p>;
  };

  if (mode === 'link' && entries.length === 0) return null;

  return (
    <section data-testid={mode === 'guest' ? 'device-orders' : 'link-orders'} className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-heading font-bold text-ink-900">
            {mode === 'guest' ? L('طلباتك على هذا الجهاز', 'Your orders on this device') : L('طلبات أرسلتها كزائر على هذا الجهاز', 'Orders you placed as a guest on this device')}
          </h2>
          <p className="text-[13px] text-ink-500 mt-1 leading-6">
            {mode === 'guest'
              ? L('نعرض حالة كل طلب من نظام المتجر مباشرة. لحفظ طلباتك في حساب دائم، سجّل الدخول.', 'Each status comes straight from the store system. Sign in to keep your orders in an account.')
              : L('اربط الطلب بحسابك ليظهر لك من أي جهاز. نطلب آخر 4 أرقام من هاتف الطلب لحماية الأجهزة المشتركة.', 'Link an order to your account to see it on any device. We ask for the last 4 digits of the order phone to protect shared devices.')}
          </p>
        </div>
        {entries.length > 0 && (
          <button type="button" onClick={() => void load()} disabled={loading} className="shrink-0 inline-flex items-center gap-1.5 rounded-full ring-1 ring-ink-900/10 bg-white px-3 py-2 text-[12.5px] font-bold text-ink-700 disabled:opacity-50" aria-label={L('تحديث', 'Refresh')}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {L('تحديث', 'Refresh')}
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-3xl bg-white ring-1 ring-ink-900/[0.06] p-6 text-center" data-testid="device-orders-empty">
          <Package size={34} className="mx-auto text-ink-200" />
          <p className="mt-3 font-bold text-ink-900">{L('لا توجد طلبات محفوظة على هذا الجهاز', 'No orders saved on this device')}</p>
          <p className="mt-1 text-[13px] text-ink-500 leading-6">
            {L('إذا طلبت من جهاز آخر أو حذفت بيانات المتصفح، استخدم رقم الطلب ورمز التتبع من صفحة تأكيد الطلب، أو تواصل معنا عبر واتساب.', 'If you ordered on another device or cleared your browser data, use the order number and tracking code from your confirmation, or contact us on WhatsApp.')}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {entries.map(({ orderId }) => {
            const row = rows?.find((r) => r.orderId === orderId);
            const cs = claimState[orderId];
            return (
              <li key={orderId} data-testid="device-order" data-order-id={orderId} data-state={row?.state || 'loading'} className="rounded-3xl bg-white ring-1 ring-ink-900/[0.06] p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span dir="ltr" className="font-mono text-[13px] font-bold text-ink-900">#{orderId}</span>
                  {row?.state === 'ok' && (
                    <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${STATUS_TONE[row.summary.status] || 'bg-gold-50 text-gold-800'}`} data-testid="device-order-status">{statusLabel(row.summary.status)}</span>
                  )}
                </div>
                {!row ? (
                  <p className="mt-2 text-[13px] text-ink-400">{L('جارٍ التحقق من الطلب…', 'Checking the order…')}</p>
                ) : row.state === 'ok' ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-600">
                    <span>{row.summary.date} · {L(`${row.summary.items.reduce((s, i) => s + i.quantity, 0)} قطعة`, `${row.summary.items.reduce((s, i) => s + i.quantity, 0)} item(s)`)} · <b className="text-ink-900 tabular-nums">{money(row.summary.total)}</b></span>
                    <Link to={`/tracking?orderId=${encodeURIComponent(orderId)}`} className="font-bold text-gold-700 hover:underline">{L('تفاصيل وتتبع', 'Details & tracking')}</Link>
                  </div>
                ) : row.state === 'unavailable' ? (
                  <p className="mt-2 text-[13px] font-bold text-amber-700 flex items-center gap-1.5" data-testid="device-order-offline"><AlertTriangle size={14} /> {L('تعذّر التحقق الآن (الاتصال). لا نعرض حالة غير مؤكدة — أعد المحاولة.', 'Could not check now (connection). No unconfirmed status is shown — try again.')}</p>
                ) : (
                  <p className="mt-2 text-[13px] text-ink-500" data-testid="device-order-denied">{L('لم نتمكن من التحقق من هذا الطلب بالرمز المحفوظ. تواصل معنا عبر واتساب برقم الطلب.', 'This order could not be verified with the saved code. Contact us on WhatsApp with the order number.')}</p>
                )}

                {mode === 'link' && row?.state === 'ok' && !(cs && cs !== 'busy' && (cs.kind === 'linked' || cs.kind === 'already_yours')) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      inputMode="numeric" maxLength={4} dir="ltr" autoComplete="off"
                      value={last4[orderId] || ''}
                      onChange={(e) => setLast4((m) => ({ ...m, [orderId]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                      placeholder={L('آخر 4 أرقام', 'Last 4 digits')}
                      aria-label={L('آخر 4 أرقام من هاتف الطلب', 'Last 4 digits of the order phone')}
                      data-testid="claim-last4"
                      className="w-32 rounded-xl bg-paper-100 px-3 py-2.5 text-center tracking-widest !border-0"
                    />
                    <button type="button" data-testid="claim-button" disabled={cs === 'busy' || !PHONE_LAST4_RE.test(last4[orderId] || '')} onClick={() => void doClaim(orderId)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-ink-900 px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-40">
                      <Link2 size={15} /> {cs === 'busy' ? L('جارٍ الربط…', 'Linking…') : L('ربط بحسابي', 'Link to my account')}
                    </button>
                  </div>
                )}
                {cs && cs !== 'busy' && cs.kind === 'linked' && <p className="mt-2 text-xs font-bold text-emerald-700 flex items-center gap-1"><CheckCircle2 size={14} /> {L('تم الربط', 'Linked')}</p>}
                {claimMsg(cs)}
              </li>
            );
          })}
        </ul>
      )}

      {mode === 'guest' && (
        <form
          data-testid="lookup-form"
          onSubmit={(e) => {
            e.preventDefault();
            const id = lookupId.trim().toUpperCase();
            if (!id) return;
            // the code travels in navigation state (memory), never in the URL
            navigate(`/tracking?orderId=${encodeURIComponent(id)}`, { state: { trackingCode: lookupCode.trim() } });
          }}
          className="rounded-3xl bg-paper-100 ring-1 ring-ink-900/[0.06] p-4 sm:p-5"
        >
          <p className="font-bold text-ink-900 flex items-center gap-2"><Search size={16} /> {L('طلب من جهاز آخر؟', 'Ordered on another device?')}</p>
          <p className="text-[12.5px] text-ink-500 mt-1">{L('أدخل رقم الطلب ورمز التتبع الظاهرين في صفحة تأكيد الطلب.', 'Enter the order number and tracking code shown on your confirmation page.')}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input dir="ltr" value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="ORD-XXXXXXXX-XXXXXX" aria-label={L('رقم الطلب', 'Order number')} data-testid="lookup-id" className="rounded-xl bg-white px-3 py-2.5 !border-0 font-mono text-[13px]" />
            <input dir="ltr" value={lookupCode} onChange={(e) => setLookupCode(e.target.value)} placeholder={L('رمز التتبع', 'Tracking code')} aria-label={L('رمز التتبع', 'Tracking code')} autoComplete="off" data-testid="lookup-code" className="rounded-xl bg-white px-3 py-2.5 !border-0 font-mono text-[13px]" />
            <button type="submit" className="rounded-xl bg-ink-900 px-5 py-2.5 text-[13.5px] font-bold text-white">{L('عرض الطلب', 'View order')}</button>
          </div>
        </form>
      )}
    </section>
  );
}
