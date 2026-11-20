// Where a "discount on the SECOND order" prize stands, for the customer (display only — the Worker decides):
//   create-first-order  won, no order yet: create the first order before <date> (5 days from the win)
//   first-order-open    a first order exists: kept until it is delivered
//   active              first order delivered: usable on the actual second order until <date> (5 days)
import React from 'react';
import type { WheelSpin } from '../../services/wheel';
import PrizeCountdown from './PrizeCountdown';

const fmtWhen = (iso: string | null | undefined, isAR: boolean) =>
  iso ? new Date(iso).toLocaleString(isAR ? 'ar-JO' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

export function secondOrderStage(s: Pick<WheelSpin, 'status' | 'firstOrderId' | 'firstOrderBy'>, accountState: string | null): 'create-first-order' | 'first-order-open' | 'active' | null {
  if (s.status === 'issued') return 'active';
  if (s.status !== 'waiting') return null;
  return s.firstOrderId || accountState === 'pending' ? 'first-order-open' : 'create-first-order';
}

export default function SecondOrderStatus({ spin, accountState, isAR, onExpire, minOrderJod, days = 5, testId = 'second-status' }: {
  spin: WheelSpin; accountState: string | null; isAR: boolean; onExpire?: () => void; minOrderJod?: number | null; days?: number; testId?: string;
}) {
  const stage = secondOrderStage(spin, accountState);
  if (!stage) return null;
  const L = (ar: string, en: string) => (isAR ? ar : en);
  const min = minOrderJod ?? spin.minOrderJod ?? 15;
  return (
    <div className="mt-2 rounded-xl border border-gold-200 bg-white/70 p-2.5 text-xs font-bold leading-relaxed text-ink-800" data-testid={testId} data-state={stage}>
      {stage === 'create-first-order' && (
        <>
          <p>{L(`① أنشئ طلبك الأول قبل ${fmtWhen(spin.firstOrderBy, true)} — تُحفظ الجائزة حتى تسليمه، ثم تبدأ ${days} أيام لاستخدامها على طلبك الثاني (منتجات ${min} د.أ فأكثر).`, `① Place your first order before ${fmtWhen(spin.firstOrderBy, false)} — the prize is kept until it is delivered, then you have ${days} days to use it on your second order (products of ${min} JOD or more).`)}</p>
          {spin.firstOrderBy && <PrizeCountdown expiresAt={spin.firstOrderBy} isAR={isAR} onExpire={onExpire} label={L('الوقت المتبقي لإنشاء طلبك الأول: ', 'Time left to place your first order: ')} urgentMs={12 * 3_600_000} testId={`${testId}-countdown`} />}
        </>
      )}
      {stage === 'first-order-open' && (
        <p>{L(`② طلبك الأول قيد التنفيذ: الجائزة محفوظة حتى تسليمه، ثم تبدأ ${days} أيام لاستخدامها على طلبك الثاني. إذا أُلغي الطلب الأول يُعاد تقييم الاستحقاق.`, `② Your first order is in progress: the prize is kept until it is delivered, then you have ${days} days to use it on your second order. If the first order is cancelled, eligibility is re-checked.`)}</p>
      )}
      {stage === 'active' && (
        <>
          <p>{L(`③ تم تسليم طلبك الأول: الخصم صالح على طلبك الثاني الفعلي (منتجات ${min} د.أ فأكثر) حتى ${fmtWhen(spin.expiresAt, true)}.`, `③ Your first order was delivered: the discount is valid on your actual second order (products of ${min} JOD or more) until ${fmtWhen(spin.expiresAt, false)}.`)}</p>
          {spin.expiresAt && <PrizeCountdown expiresAt={spin.expiresAt} isAR={isAR} onExpire={onExpire} urgentMs={12 * 3_600_000} testId={`${testId}-countdown`} />}
        </>
      )}
    </div>
  );
}
