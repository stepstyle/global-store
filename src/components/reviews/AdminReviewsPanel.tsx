// Admin dashboard tab "التقييمات": the latest reviews of every product, to check flagged / hidden ones. Moderation
// itself (flag, hide with a reason, publish, reply) happens on the product's reviews tab, through the order Worker.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { Loader2, ExternalLink } from 'lucide-react';
import { db, isFirebaseInitialized } from '../../services/firebase';
import type { Product, ReviewDoc } from '../../types';
import { StarsRow, VerifiedBadge } from './ReviewParts';
import { MODERATION_REASONS_AR, type ModerationReason } from '../../services/verifiedReviews';

type Filter = 'all' | 'flagged' | 'hidden' | 'legacy';

export default function AdminReviewsPanel({ products }: { products: Product[] }) {
  const [rows, setRows] = useState<ReviewDoc[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  useEffect(() => {
    let alive = true;
    if (!isFirebaseInitialized || !db) { setRows([]); return; }
    getDocs(query(collection(db, 'reviews'), orderBy('createdAt', 'desc'), limit(200)))
      .then((s) => { if (alive) setRows(s.docs.map((d) => ({ id: d.id, ...d.data() })) as ReviewDoc[]); })
      .catch(() => { if (alive) { setRows([]); setError('تعذّر تحميل التقييمات.'); } });
    return () => { alive = false; };
  }, []);
  const names = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const counts = useMemo(() => {
    const r = rows || [];
    return {
      all: r.length,
      flagged: r.filter((x) => x.moderation?.flagged && (x.status || 'published') !== 'hidden').length,
      hidden: r.filter((x) => x.status === 'hidden').length,
      legacy: r.filter((x) => x.verifiedPurchase !== true).length,
    };
  }, [rows]);
  const shown = (rows || []).filter((x) =>
    filter === 'all' ? true : filter === 'flagged' ? x.moderation?.flagged && x.status !== 'hidden' : filter === 'hidden' ? x.status === 'hidden' : x.verifiedPurchase !== true);
  const label: Record<Filter, string> = { all: 'الكل', flagged: 'للمراجعة', hidden: 'مخفية', legacy: 'قديمة غير موثّقة' };

  return (
    <div className="bg-white rounded-3xl border border-slate-100 p-5 sm:p-6" dir="rtl" data-testid="admin-reviews-panel">
      <h2 className="text-xl font-bold text-ink-900">التقييمات</h2>
      <p className="mt-1 text-[13.5px] text-ink-600">كل تقييم منشور مرتبط بطلب مُسلَّم. للإبلاغ أو الإخفاء (بسبب محدد) أو الرد، افتح صفحة المنتج. الرأي السلبي لا يُحذف.</p>
      <div className="mt-4 flex gap-2 flex-wrap" role="tablist">
        {(Object.keys(label) as Filter[]).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold ring-1 ${filter === f ? 'bg-ink-900 text-white ring-ink-900' : 'bg-white text-ink-700 ring-paper-300'}`}>
            {label[f]} <span className="tabular-nums opacity-80">{counts[f]}</span>
          </button>
        ))}
      </div>
      {rows === null ? (
        <div className="py-10 flex items-center justify-center gap-2 text-ink-500"><Loader2 size={18} className="animate-spin" /> جارٍ التحميل…</div>
      ) : error ? (
        <p role="alert" className="mt-4 text-rose-700 font-semibold">{error}</p>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-ink-500">لا توجد تقييمات هنا.</p>
      ) : (
        <ul className="mt-4 divide-y divide-paper-300">
          {shown.map((r) => (
            <li key={r.id} className="py-3.5 flex gap-3 items-start" data-testid="admin-review-row">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <StarsRow value={r.rating} />
                  {r.verifiedPurchase ? <VerifiedBadge compact /> : <span className="rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[12px] font-bold">غير موثّق</span>}
                  {r.status === 'hidden' && <span className="rounded-full bg-rose-100 text-rose-800 px-2 py-0.5 text-[12px] font-bold">مخفي{r.moderation?.reason ? ` — ${MODERATION_REASONS_AR[r.moderation.reason as ModerationReason] ?? ''}` : ''}</span>}
                  {r.moderation?.flagged && r.status !== 'hidden' && <span className="rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[12px] font-bold">للمراجعة</span>}
                </div>
                <p className="mt-1 text-[14px] text-ink-800 break-words line-clamp-3">{r.comment || <span className="text-ink-400">(بدون تعليق)</span>}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-500">{r.userName} · {names.get(r.productId) || r.productId}</p>
              </div>
              <Link to={`/product/${encodeURIComponent(r.productId)}?tab=reviews`} className="shrink-0 inline-flex items-center gap-1 rounded-lg ring-1 ring-paper-300 px-2.5 py-1.5 text-[12.5px] font-bold text-ink-800 hover:bg-paper-100"><ExternalLink size={13} /> المنتج</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
