// The reviews tab of a product page.
//   - visitors see ONLY published reviews of a verified purchase (written by the order Worker for a delivered order)
//   - a signed-in customer with a delivered, not yet reviewed order of this product gets the form (the Worker checks
//     everything again); everyone else is told how reviewing works (after delivery, from «طلباتي» or the private link)
//   - the admin sees everything (hidden, flagged, old unverified) and moderates with a REASON through the Worker;
//     a verified review cannot be deleted — a negative opinion is not a reason to remove it
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Loader2, Shield, Flag, EyeOff, Eye, Trash2, CheckCircle2, PackageCheck } from 'lucide-react';
import type { AppUser, ReviewDoc } from '../../types';
import { StarPicker, StarsRow, VerifiedBadge } from './ReviewParts';
import { reviewsApi, verifiedReviewDeps } from '../../services/reviews';
import {
  eligibleOrders, submitReview, moderateReview, checkReviewInput, isPublicVerified, reviewErrorAr,
  MODERATION_REASONS_AR, COMMENT_MAX, NAME_MAX, type ModerationReason,
} from '../../services/verifiedReviews';

type Toast = (msg: string, type?: 'success' | 'error' | 'info') => void;

const dateOf = (r: any): string => {
  const c = r?.createdAt;
  try {
    if (c?.toDate) return c.toDate().toISOString().slice(0, 10);
    if (typeof c?.seconds === 'number') return new Date(c.seconds * 1000).toISOString().slice(0, 10);
  } catch { /* fall through */ }
  return r?.createdAtMs ? new Date(r.createdAtMs).toISOString().slice(0, 10) : '';
};

export default function ProductReviews({ productId, viewer, isAdmin, reviews, loading, onChanged, showToast, isAR }: {
  productId: string; viewer: AppUser | null; isAdmin: boolean; reviews: ReviewDoc[]; loading: boolean;
  onChanged: () => Promise<void> | void; showToast: Toast; isAR: boolean;
}) {
  const visible = useMemo(() => (isAdmin ? reviews : reviews.filter(isPublicVerified)), [reviews, isAdmin]);

  // ---------------- the signed-in customer's delivered orders of this product (checked by the Worker) ----------------
  const [eligible, setEligible] = useState<Array<{ orderId: string; date: string; variants: string[] }> | null>(null);
  useEffect(() => {
    let alive = true;
    setEligible(null);
    if (!viewer?.id || !productId) return;
    eligibleOrders(verifiedReviewDeps(), productId).then((r) => { if (alive) setEligible(r.ok ? r.orders : []); });
    return () => { alive = false; };
  }, [viewer?.id, productId]);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  useEffect(() => { setName(String(viewer?.name || '').trim().split(/\s+/)[0]?.slice(0, NAME_MAX) || ''); }, [viewer?.name]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    const target = eligible?.[0];
    if (!target) return;
    const check = checkReviewInput({ rating, comment, name });
    if ('field' in check) {
      setError(check.field === 'rating' ? reviewErrorAr('INVALID_RATING') : check.field === 'name' ? reviewErrorAr('INVALID_NAME') : reviewErrorAr('INVALID_COMMENT'));
      return;
    }
    setSending(true);
    setError('');
    const r = await submitReview(verifiedReviewDeps(), { orderId: target.orderId, token: null, productId, rating, comment, name });
    setSending(false);
    if ('code' in r) { setError(reviewErrorAr(r.code)); return; }
    showToast('تم نشر تقييمك. شكرًا لك!', 'success');
    setRating(0);
    setComment('');
    setEligible((e) => (e ? e.slice(1) : e));
    await onChanged();
  };

  // ---------------- admin moderation ----------------
  const [modFor, setModFor] = useState<{ id: string; action: 'flag' | 'hide' } | null>(null);
  const [modReason, setModReason] = useState<ModerationReason>('abusive');
  const [modNote, setModNote] = useState('');
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!isAdmin) return;
    setReplyDraft(Object.fromEntries(reviews.map((r: any) => [r.id, String(r.adminReply?.text ?? '')])));
  }, [reviews, isAdmin]);

  const moderate = useCallback(async (id: string, action: 'flag' | 'unflag' | 'hide' | 'publish', reason?: ModerationReason, note?: string) => {
    const r = await moderateReview(verifiedReviewDeps(), id, action, reason, note);
    if ('code' in r) { showToast(r.code === 'NOTE_REQUIRED' ? 'اكتب ملاحظة توضّح السبب.' : `تعذّر الحفظ (${r.code})`, 'error'); return; }
    setModFor(null);
    setModNote('');
    showToast(action === 'hide' ? 'أُخفي التقييم وسُجّل السبب.' : action === 'flag' ? 'عُلّم للمراجعة (ما زال ظاهرًا).' : 'تم.', 'success');
    await onChanged();
  }, [onChanged, showToast]);

  const legacyAction = useCallback(async (r: ReviewDoc, what: 'toggle' | 'delete') => {
    try {
      if (what === 'delete') {
        if (!window.confirm('حذف هذا التقييم القديم غير الموثّق؟')) return;
        await reviewsApi.remove(r.id);
      } else {
        await reviewsApi.setStatus(r.id, (r.status || 'published') === 'published' ? 'hidden' : 'published');
      }
      await onChanged();
    } catch { showToast('تعذّر الحفظ', 'error'); }
  }, [onChanged, showToast]);

  const saveReply = useCallback(async (r: ReviewDoc) => {
    if (!viewer) return;
    try {
      await reviewsApi.setAdminReply(r.id, String(replyDraft[r.id] ?? '').trim(), viewer);
      showToast('تم حفظ الرد', 'success');
      await onChanged();
    } catch { showToast('تعذّر حفظ الرد', 'error'); }
  }, [viewer, replyDraft, onChanged, showToast]);

  // ---------------- render ----------------
  const howItWorks = (
    <div className="rounded-2xl border border-paper-300 bg-paper-100 p-4 sm:p-5 flex gap-4 items-start" data-testid="review-how">
      <span className="shrink-0 w-10 h-10 rounded-xl bg-white ring-1 ring-paper-300 flex items-center justify-center"><PackageCheck size={20} className="text-gold-600" aria-hidden="true" /></span>
      <div className="min-w-0">
        <h3 className="font-heading text-[16px] font-bold text-ink-900 mb-1">{isAR ? 'تقييمات من مشترين حقيقيين فقط' : 'Reviews from real buyers only'}</h3>
        <p className="text-[14px] leading-relaxed text-ink-700">
          {isAR
            ? 'يستطيع تقييم هذا المنتج من اشتراه واستلم طلبه فقط، ويظهر كل تقييم بعلامة «شراء موثّق». بعد تسليم طلبك قيّمه من «طلباتي» أو من رابط التقييم الخاص الذي نرسله لك.'
            : 'Only customers who bought this product and received their order can review it; every review carries a “verified purchase” mark. After delivery, review it from “My orders” or the private link we send you.'}
        </p>
        {viewer?.id ? (
          <Link to="/my-orders" className="mt-3 inline-flex text-[14px] font-bold text-ink-900 underline underline-offset-4 hover:text-gold-700">{isAR ? 'طلباتي' : 'My orders'}</Link>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-8 max-w-4xl" data-testid="product-reviews">
      {viewer?.id && eligible === null ? (
        <div className="rounded-3xl border border-paper-300 bg-paper-50 p-6 text-ink-500 text-sm font-semibold flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> {isAR ? 'نتحقق من طلباتك المسلَّمة…' : 'Checking your delivered orders…'}</div>
      ) : eligible && eligible.length > 0 ? (
        <div className="rounded-3xl border border-gold-200 bg-gold-50/60 p-6 md:p-8" data-testid="review-form">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h3 className="font-heading text-xl font-bold text-ink-900">{isAR ? 'قيّم هذا المنتج' : 'Review this product'}</h3>
            <VerifiedBadge variant={eligible[0].variants.join('، ')} />
          </div>
          <p className="text-[13.5px] text-ink-600 mb-4">{isAR ? <>من طلبك المسلَّم بتاريخ <bdi dir="ltr">{eligible[0].date}</bdi>. تقييم واحد لكل منتج في الطلب.</> : <>From your order delivered on {eligible[0].date}. One review per product per order.</>}</p>
          <StarPicker value={rating} onChange={(n) => { setRating(n); setError(''); }} testId="review-stars" />
          <label className="block mt-5 text-[14px] font-bold text-ink-800" htmlFor="rv-comment">{isAR ? 'تعليقك (اختياري)' : 'Your comment (optional)'}</label>
          <textarea id="rv-comment" value={comment} maxLength={COMMENT_MAX} onChange={(e) => setComment(e.target.value)} placeholder={isAR ? 'ما الذي أعجبك؟ وما الذي يمكن تحسينه؟' : 'What did you like? What could be better?'} className="mt-1.5 w-full min-h-[110px] p-4 rounded-2xl border border-paper-300 bg-white outline-none focus:ring-2 focus:ring-ink-900 resize-y text-[15px]" />
          <div className="text-[12px] text-ink-500 text-end tabular-nums">{comment.length}/{COMMENT_MAX}</div>
          <label className="block mt-3 text-[14px] font-bold text-ink-800" htmlFor="rv-name">{isAR ? 'الاسم الظاهر مع تقييمك' : 'Name shown with your review'}</label>
          <input id="rv-name" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-full sm:w-72 p-3 rounded-xl border border-paper-300 bg-white outline-none focus:ring-2 focus:ring-ink-900 text-[15px]" />
          <p className="mt-1.5 text-[12.5px] text-ink-500">{isAR ? 'لا نعرض رقم هاتفك أو عنوانك أو رقم طلبك.' : 'We never show your phone, address or order number.'}</p>
          {error && <p role="alert" className="mt-3 text-[14px] font-semibold text-rose-700">{error}</p>}
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={send} disabled={sending} className="inline-flex items-center gap-2 rounded-xl bg-ink-900 px-8 py-3 text-[15px] font-bold text-white hover:bg-gold-600 disabled:opacity-60 transition" data-testid="review-submit">
              {sending ? <><Loader2 size={18} className="animate-spin" /> {isAR ? 'جارٍ النشر…' : 'Publishing…'}</> : (isAR ? 'نشر التقييم' : 'Publish review')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-4" data-testid="review-list">
        {loading ? (
          <div className="text-center py-10 text-ink-400 font-bold">{isAR ? 'جارٍ تحميل التقييمات…' : 'Loading reviews…'}</div>
        ) : visible.length === 0 ? (
          <div className="text-center py-14 rounded-3xl border border-dashed border-paper-300 bg-paper-50">
            <MessageSquare className="mx-auto text-paper-300 mb-3" size={40} aria-hidden="true" />
            <div className="text-ink-600 font-bold">{isAR ? 'لا توجد تقييمات من مشترين بعد.' : 'No reviews from buyers yet.'}</div>
          </div>
        ) : (
          visible.map((r) => {
            const verified = r.verifiedPurchase === true;
            const hidden = (r.status || 'published') === 'hidden';
            const flagged = r.moderation?.flagged === true;
            return (
              <article key={r.id} className={`rounded-3xl border p-5 sm:p-6 bg-white ${hidden ? 'border-rose-200 bg-rose-50/40' : 'border-paper-300'}`} data-testid="review-item" data-verified={verified ? '1' : '0'}>
                <header className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-10 h-10 shrink-0 rounded-full bg-ink-50 text-ink-800 flex items-center justify-center font-bold text-lg" aria-hidden="true">{(r.userName || '؟').charAt(0)}</span>
                    <div className="min-w-0">
                      <div className="font-bold text-ink-900 truncate">{r.userName}</div>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5"><StarsRow value={r.rating} /> {verified && <VerifiedBadge variant={r.purchasedVariant} />}</div>
                    </div>
                  </div>
                  <span className="text-[12px] font-semibold text-ink-500 tabular-nums" dir="ltr">{dateOf(r)}</span>
                </header>
                {r.comment ? <p className="mt-3 text-[15px] leading-relaxed text-ink-800 whitespace-pre-line break-words">{r.comment}</p> : null}
                {r.adminReply?.text && (
                  <div className="mt-4 ms-6 rounded-2xl bg-paper-100 border border-paper-300 p-4">
                    <div className="text-[12px] font-bold text-ink-800 mb-1 flex items-center gap-1"><Shield size={12} aria-hidden="true" /> {isAR ? 'رد المكتبة' : 'Store reply'}</div>
                    <p className="text-ink-700 text-sm whitespace-pre-line">{r.adminReply.text}</p>
                  </div>
                )}

                {isAdmin && (
                  <div className="mt-4 rounded-2xl border border-dashed border-ink-200 bg-ink-50/50 p-3 space-y-3" data-testid="review-admin">
                    <div className="flex items-center gap-2 flex-wrap text-[12.5px] font-bold">
                      {!verified && <span className="rounded-full bg-amber-100 text-amber-900 px-2 py-0.5">تقييم قديم غير موثّق — لا يظهر للزوار ولا يُحتسب</span>}
                      {hidden && <span className="rounded-full bg-rose-100 text-rose-800 px-2 py-0.5">مخفي{r.moderation?.reason ? ` — ${MODERATION_REASONS_AR[r.moderation.reason as ModerationReason] ?? r.moderation.reason}` : ''}</span>}
                      {flagged && !hidden && <span className="rounded-full bg-amber-100 text-amber-900 px-2 py-0.5">مُعلَّم للمراجعة — {MODERATION_REASONS_AR[r.moderation?.reason as ModerationReason] ?? ''}</span>}
                    </div>
                    {verified ? (
                      <div className="flex gap-2 flex-wrap">
                        {!hidden && !flagged && <button type="button" onClick={() => setModFor({ id: r.id, action: 'flag' })} className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-ink-200 px-3 py-1.5 text-[13px] font-bold text-ink-800 hover:bg-amber-50"><Flag size={14} /> إبلاغ للمراجعة</button>}
                        {flagged && !hidden && <button type="button" onClick={() => moderate(r.id, 'unflag')} className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-ink-200 px-3 py-1.5 text-[13px] font-bold text-emerald-800 hover:bg-emerald-50"><CheckCircle2 size={14} /> راجعته: لا مخالفة</button>}
                        {!hidden && <button type="button" onClick={() => setModFor({ id: r.id, action: 'hide' })} className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-rose-200 px-3 py-1.5 text-[13px] font-bold text-rose-800 hover:bg-rose-50"><EyeOff size={14} /> إخفاء لمخالفة</button>}
                        {hidden && <button type="button" onClick={() => moderate(r.id, 'publish')} className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-ink-200 px-3 py-1.5 text-[13px] font-bold text-ink-800 hover:bg-ink-50"><Eye size={14} /> إظهار من جديد</button>}
                      </div>
                    ) : (
                      <div className="flex gap-2 flex-wrap">
                        <button type="button" onClick={() => legacyAction(r, 'toggle')} className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-ink-200 px-3 py-1.5 text-[13px] font-bold text-ink-800">{hidden ? <><Eye size={14} /> إظهار</> : <><EyeOff size={14} /> إخفاء</>}</button>
                        <button type="button" onClick={() => legacyAction(r, 'delete')} className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-rose-200 px-3 py-1.5 text-[13px] font-bold text-rose-700"><Trash2 size={14} /> حذف (قديم)</button>
                      </div>
                    )}
                    {modFor?.id === r.id && (
                      <div className="rounded-xl bg-white ring-1 ring-ink-200 p-3 space-y-2" data-testid="moderation-panel">
                        <p className="text-[13px] font-bold text-ink-900">{modFor.action === 'hide' ? 'سبب الإخفاء' : 'سبب الإبلاغ'} <span className="font-semibold text-ink-500">(الرأي السلبي ليس سببًا)</span></p>
                        <select value={modReason} onChange={(e) => setModReason(e.target.value as ModerationReason)} className="w-full rounded-lg border border-paper-300 p-2 text-[14px]">
                          {(Object.keys(MODERATION_REASONS_AR) as ModerationReason[]).map((k) => <option key={k} value={k}>{MODERATION_REASONS_AR[k]}</option>)}
                        </select>
                        <input value={modNote} maxLength={200} onChange={(e) => setModNote(e.target.value)} placeholder="ملاحظة داخلية (اختيارية، إلا مع «سبب آخر»)" className="w-full rounded-lg border border-paper-300 p-2 text-[14px]" />
                        <div className="flex gap-2 justify-end">
                          <button type="button" onClick={() => setModFor(null)} className="rounded-lg px-3 py-1.5 text-[13px] font-bold text-ink-600">إلغاء</button>
                          <button type="button" onClick={() => moderate(r.id, modFor.action, modReason, modNote)} className="rounded-lg bg-ink-900 px-4 py-1.5 text-[13px] font-bold text-white">{modFor.action === 'hide' ? 'إخفاء' : 'إبلاغ'}</button>
                        </div>
                      </div>
                    )}
                    {!hidden && (
                      <div>
                        <textarea value={replyDraft[r.id] ?? ''} onChange={(e) => setReplyDraft({ ...replyDraft, [r.id]: e.target.value })} maxLength={1000} placeholder="رد المكتبة (يظهر للجميع تحت التقييم)" className="w-full p-2.5 text-sm bg-white border border-paper-300 rounded-xl outline-none focus:ring-2 focus:ring-ink-900 resize-y min-h-[64px]" />
                        <div className="flex justify-end mt-1.5"><button type="button" onClick={() => saveReply(r)} className="rounded-lg bg-ink-900 text-white px-4 py-1.5 text-[13px] font-bold">حفظ الرد</button></div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
      {!(eligible && eligible.length > 0) && !(viewer?.id && eligible === null) ? howItWorks : null}
    </div>
  );
}
