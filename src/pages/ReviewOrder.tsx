// #/review/<orderId> — review the products of ONE delivered order.
//   - with the private link the admin sent (the token was moved out of the address bar at app start, main.tsx), or
//   - as the signed-in customer who owns the order (from «طلباتي»).
// The order Worker checks everything (link / owner, delivered, product in the order, once per product).
// The page shows no personal data: products, the order date and the name the customer chooses to show.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, CheckCircle2, ShieldCheck, PackageCheck, AlertCircle } from 'lucide-react';
import { useCart } from '../App';
import SEO from '../components/SEO';
import { StarPicker, StarsRow, VerifiedBadge } from '../components/reviews/ReviewParts';
import { verifiedReviewDeps } from '../services/reviews';
import { getFirebaseAuth } from '../services/firebase';
import {
  loadReviewOrder, submitReview, checkReviewInput, reviewErrorAr,
  REVIEW_ORDER_ID_RE, COMMENT_MAX, NAME_MAX, type ReviewItem, type ReviewOrderState,
} from '../services/verifiedReviews';
import { reviewTokenFor, stashReviewToken } from '../services/reviewLink';

const session = (): Storage | null => { try { return window.sessionStorage; } catch { return null; } };

type Draft = { rating: number; comment: string; sending: boolean; error: string; done: boolean };

const ReviewOrder: React.FC = () => {
  const { orderId = '', token: tokenInPath } = useParams();
  const { user, showToast } = useCart() as any;
  // normally main.tsx already moved the token out of the address; if not, do it now (same rules)
  const token = useMemo(() => {
    if (!REVIEW_ORDER_ID_RE.test(orderId)) return null;
    if (tokenInPath) stashReviewToken(window.location, session(), window.history);
    return reviewTokenFor(orderId, session());
  }, [orderId, tokenInPath]);

  const [authReady, setAuthReady] = useState(!!token);
  useEffect(() => {
    if (token) return;
    let alive = true;
    const a: any = getFirebaseAuth();
    Promise.resolve(a?.authStateReady ? a.authStateReady() : null).catch(() => null).then(() => { if (alive) setAuthReady(true); });
    return () => { alive = false; };
  }, [token]);

  const [state, setState] = useState<ReviewOrderState | null>(null);
  const [failure, setFailure] = useState<string>('');
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const needsSignIn = !token && authReady && !user;
  useEffect(() => {
    let alive = true;
    if (!REVIEW_ORDER_ID_RE.test(orderId)) { setFailure('NOT_FOUND'); return; }
    if (!authReady || needsSignIn) return;
    setFailure('');
    loadReviewOrder(verifiedReviewDeps(), orderId, token).then((r) => {
      if (!alive) return;
      if ('code' in r) { setFailure(r.code); return; }
      setState(r);
      setName((n) => n || r.suggestedName || String(user?.name || '').trim().split(/\s+/)[0]?.slice(0, NAME_MAX) || '');
      setDrafts(Object.fromEntries(r.items.map((i) => [i.productId, { rating: 0, comment: '', sending: false, error: '', done: i.reviewed }])));
    });
    return () => { alive = false; };
  }, [orderId, token, authReady, needsSignIn, user?.id]);

  const patch = (pid: string, p: Partial<Draft>) => setDrafts((d) => ({ ...d, [pid]: { ...d[pid], ...p } }));

  const send = async (item: ReviewItem) => {
    const d = drafts[item.productId];
    const check = checkReviewInput({ rating: d.rating, comment: d.comment, name });
    if ('field' in check) {
      patch(item.productId, { error: reviewErrorAr(check.field === 'rating' ? 'INVALID_RATING' : check.field === 'name' ? 'INVALID_NAME' : 'INVALID_COMMENT') });
      return;
    }
    patch(item.productId, { sending: true, error: '' });
    const r = await submitReview(verifiedReviewDeps(), { orderId, token, productId: item.productId, rating: d.rating, comment: d.comment, name });
    if ('code' in r) {
      patch(item.productId, { sending: false, error: reviewErrorAr(r.code), done: r.code === 'ALREADY_REVIEWED' });
      return;
    }
    patch(item.productId, { sending: false, done: true });
    showToast?.('تم نشر تقييمك. شكرًا لك!', 'success');
  };

  const items = state?.items ?? [];
  const left = items.filter((i) => i.available && !drafts[i.productId]?.done).length;

  return (
    <div className="min-h-[70vh] bg-paper py-8 sm:py-12" dir="rtl" data-testid="review-order-page">
      <SEO title="قيّم مشترياتك" description="تقييم المنتجات من طلب تم تسليمه" noIndex />
      <div className="mx-auto max-w-2xl px-4">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-11 h-11 rounded-2xl bg-white ring-1 ring-paper-300 flex items-center justify-center"><PackageCheck size={22} className="text-gold-600" aria-hidden="true" /></span>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-ink-900">قيّم مشترياتك</h1>
        </div>
        <p className="text-[15px] text-ink-600 mb-6">
          {state ? <>طلبك المسلَّم {state.date ? <>بتاريخ <bdi dir="ltr">{state.date}</bdi></> : null}. قيّم كل منتج مرة واحدة: من نجمة إلى خمس نجوم، والتعليق اختياري.</> : 'تقييمات متجرنا من مشترين حقيقيين فقط.'}
        </p>

        {needsSignIn || failure === 'NOT_FOUND' && !token ? (
          <Notice icon="info" title="افتح رابط التقييم كما وصلك" testId="review-need-link">
            هذه الصفحة تعمل من الرابط الخاص الذي أرسلته لك المكتبة بعد تسليم طلبك، أو من «طلباتي» إذا كان الطلب على حسابك.
            <div className="mt-3 flex gap-3 flex-wrap"><Link to="/login" className="font-bold underline underline-offset-4">تسجيل الدخول</Link><Link to="/my-orders" className="font-bold underline underline-offset-4">طلباتي</Link></div>
          </Notice>
        ) : failure ? (
          <Notice icon="error" title="تعذّر فتح التقييم" testId="review-failure">{reviewErrorAr(failure)}</Notice>
        ) : !state ? (
          <div className="flex items-center gap-2 text-ink-500 font-semibold py-10 justify-center"><Loader2 size={18} className="animate-spin" /> جارٍ التحقق من الطلب…</div>
        ) : (
          <>
            <div className="rounded-3xl bg-white ring-1 ring-paper-300 p-5 mb-5">
              <label htmlFor="rv-display-name" className="block text-[14px] font-bold text-ink-800">الاسم الظاهر مع تقييمك</label>
              <input id="rv-display-name" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-full sm:w-80 p-3 rounded-xl border border-paper-300 bg-paper-50 outline-none focus:ring-2 focus:ring-ink-900 text-[15px]" data-testid="review-name" />
              <p className="mt-2 text-[12.5px] text-ink-500 flex items-start gap-1.5"><ShieldCheck size={15} className="shrink-0 text-emerald-600 mt-px" aria-hidden="true" /> لا نعرض رقم هاتفك أو عنوانك أو رقم طلبك. يظهر هذا الاسم والنجوم والتعليق فقط، مع علامة «شراء موثّق».</p>
            </div>

            <ol className="space-y-4" data-testid="review-items">
              {items.map((item) => {
                const d = drafts[item.productId] || { rating: 0, comment: '', sending: false, error: '', done: false };
                return (
                  <li key={item.productId} className={`rounded-3xl ring-1 p-5 ${d.done ? 'bg-emerald-50/60 ring-emerald-200' : 'bg-white ring-paper-300'}`} data-testid="review-order-item" data-product-id={item.productId}>
                    <div className="flex gap-4 items-start">
                      <div className="w-20 h-20 shrink-0 rounded-2xl bg-paper-200 overflow-hidden ring-1 ring-paper-300">
                        {item.image ? <img src={item.image} alt="" className="w-full h-full object-cover" loading="lazy" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="font-bold text-ink-900 text-[16px] leading-snug">{item.name || 'منتج'}</h2>
                        <div className="mt-1.5"><VerifiedBadge variant={item.variants.join('، ')} /></div>
                      </div>
                    </div>
                    {!item.available ? (
                      <p className="mt-4 text-[14px] text-ink-500">هذا المنتج لم يعد معروضًا في المتجر، فلا يمكن تقييمه.</p>
                    ) : d.done ? (
                      <p className="mt-4 flex items-center gap-2 text-[15px] font-bold text-emerald-800" data-testid="review-done"><CheckCircle2 size={20} aria-hidden="true" /> تم نشر تقييمك{d.rating ? <> <StarsRow value={d.rating} /></> : null}. شكرًا لك!</p>
                    ) : (
                      <div className="mt-4">
                        <StarPicker value={d.rating} onChange={(n) => patch(item.productId, { rating: n, error: '' })} label={`تقييم ${item.name}`} testId="review-stars" />
                        <label htmlFor={`rv-c-${item.productId}`} className="block mt-4 text-[14px] font-bold text-ink-800">تعليقك (اختياري)</label>
                        <textarea id={`rv-c-${item.productId}`} value={d.comment} maxLength={COMMENT_MAX} onChange={(e) => patch(item.productId, { comment: e.target.value })} placeholder="ما الذي أعجبك؟ وما الذي يمكن تحسينه؟" className="mt-1.5 w-full min-h-[96px] p-3.5 rounded-2xl border border-paper-300 bg-paper-50 outline-none focus:ring-2 focus:ring-ink-900 resize-y text-[15px]" />
                        {d.error && <p role="alert" className="mt-2 text-[14px] font-semibold text-rose-700">{d.error}</p>}
                        <div className="mt-3 flex justify-end">
                          <button type="button" onClick={() => send(item)} disabled={d.sending} className="inline-flex items-center gap-2 rounded-xl bg-ink-900 px-7 py-3 text-[15px] font-bold text-white hover:bg-gold-600 disabled:opacity-60 transition" data-testid="review-submit">
                            {d.sending ? <><Loader2 size={18} className="animate-spin" /> جارٍ النشر…</> : 'نشر التقييم'}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {items.length > 0 && left === 0 && (
              <div className="mt-6 text-center" data-testid="review-all-done">
                <p className="font-bold text-ink-900">شكرًا لك! تقييمك يساعد غيرك على الاختيار.</p>
                <Link to="/shop" className="mt-3 inline-flex rounded-xl bg-gold-500 px-6 py-3 font-bold text-white hover:bg-gold-600">تابع التسوق</Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

function Notice({ icon, title, children, testId }: { icon: 'info' | 'error'; title: string; children: React.ReactNode; testId?: string }) {
  return (
    <div role={icon === 'error' ? 'alert' : undefined} className={`rounded-3xl p-6 ring-1 flex gap-4 ${icon === 'error' ? 'bg-rose-50 ring-rose-200 text-rose-900' : 'bg-white ring-paper-300 text-ink-800'}`} data-testid={testId}>
      <AlertCircle size={24} className="shrink-0 mt-0.5" aria-hidden="true" />
      <div className="text-[15px] leading-relaxed"><p className="font-bold mb-1">{title}</p>{children}</div>
    </div>
  );
}

export default ReviewOrder;
