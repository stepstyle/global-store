// "Offers & discounts": ONLY products with a REAL discount (an original price above the selling price, entered by the
// admin) that can be bought now. Filter by department, sort by biggest discount / saving / price / newest. No invented
// countdowns, no "only a few left" unless the stock says so (the product card shows the real stock).
import React, { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgePercent, ArrowLeft, ArrowRight, SlidersHorizontal } from 'lucide-react';
import { useCart } from '../App';
import SEO from '../components/SEO';
import ProductCard from '../components/ProductCard';
import { ProductSkeletonGrid } from '../components/Skeleton';
import { offerProducts } from '../services/recommendations';
import { formatJod } from '../services/priceDisplay';

const CATEGORY_LABEL: Record<string, [string, string]> = {
  Stationery: ['القرطاسية', 'Stationery'], Games: ['الألعاب', 'Toys'], BabyGear: ['مستلزمات وركوب', 'Ride-ons & Baby'],
  Gifts: ['الهدايا', 'Gifts'], Offers: ['العروض', 'Offers'], Bags: ['الحقائب', 'Bags'], ArtSupplies: ['أدوات فنية', 'Art supplies'],
};
const SORTS = [
  { id: 'percent', ar: 'أكبر نسبة خصم', en: 'Biggest discount' },
  { id: 'save', ar: 'أكبر توفير بالدينار', en: 'Biggest saving' },
  { id: 'price-asc', ar: 'السعر: من الأقل', en: 'Price: low to high' },
  { id: 'price-desc', ar: 'السعر: من الأعلى', en: 'Price: high to low' },
  { id: 'new', ar: 'الأحدث', en: 'Newest' },
] as const;
type SortId = (typeof SORTS)[number]['id'];

const toMillis = (v: any): number => {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Date.parse(v) || 0;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  return 0;
};

const Offers: React.FC = () => {
  const { products, addToCart, toggleWishlist, wishlist, openQuickView, language, isLoading } = useCart() as any;
  const isRtl = (language ?? 'ar') === 'ar';
  const L = useCallback((ar: string, en: string) => (isRtl ? ar : en), [isRtl]);
  const [params, setParams] = useSearchParams();
  const cat = params.get('cat') || 'all';
  const sort = (SORTS.some((s) => s.id === params.get('sort')) ? params.get('sort') : 'percent') as SortId;

  const offers = useMemo(() => offerProducts(Array.isArray(products) ? products : []), [products]);
  const cats = useMemo(() => {
    const c = new Map<string, number>();
    for (const o of offers) c.set(String(o.p.category || ''), (c.get(String(o.p.category || '')) || 0) + 1);
    return [...c.entries()].filter(([k]) => k).sort((a, b) => b[1] - a[1]);
  }, [offers]);
  const shown = useMemo(() => {
    const list = offers.filter((o) => cat === 'all' || o.p.category === cat);
    const by: Record<SortId, (a: typeof list[number], b: typeof list[number]) => number> = {
      percent: (a, b) => b.percent - a.percent || b.save - a.save,
      save: (a, b) => b.save - a.save || b.percent - a.percent,
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      new: (a, b) => toMillis((b.p as any).createdAt) - toMillis((a.p as any).createdAt),
    };
    return [...list].sort((a, b) => by[sort](a, b) || (a.p.id < b.p.id ? -1 : 1));
  }, [offers, cat, sort]);
  const maxPercent = useMemo(() => offers.reduce((m, o) => Math.max(m, o.percent), 0), [offers]);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if ((k === 'cat' && v === 'all') || (k === 'sort' && v === 'percent')) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };
  const catLabel = (c: string) => (CATEGORY_LABEL[c] ? L(CATEGORY_LABEL[c][0], CATEGORY_LABEL[c][1]) : c);

  return (
    <div className="bg-paper min-h-screen" data-testid="offers-page">
      <SEO title={L('العروض والتخفيضات', 'Offers & discounts')} description={L('تخفيضات حقيقية على القرطاسية والألعاب والهدايا من مكتبة دير شرف العلمية.', 'Real discounts on stationery, toys and gifts at Dair Sharaf Library.')} type="website" />

      <section className="relative overflow-hidden bg-ink-900 text-white">
        <div className="absolute inset-0 bg-ink-glow" aria-hidden />
        <div className="ds-container relative py-8 sm:py-12">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 ring-1 ring-white/15 px-3.5 py-1.5 text-[12px] font-semibold text-gold-200 mb-3">
            <BadgePercent size={14} /> {L('أسعار مخفّضة فعلًا', 'Genuinely reduced prices')}
          </div>
          <h1 className="font-heading font-bold text-[28px] sm:text-[42px] leading-tight">{L('العروض والتخفيضات', 'Offers & discounts')}</h1>
          <p className="mt-2 text-[14.5px] sm:text-[16px] text-ink-100/85 max-w-2xl leading-7">
            {!offers.length ? L('لا توجد عروض في الوقت الحالي.', 'No offers right now.') : isRtl
              ? <>{offers.length} منتجًا بسعر مخفّض الآن — خصومات حتى <bdi dir="ltr">{maxPercent}%</bdi>. السعر القديم مشطوب والسعر الجديد هو ما تدفعه.</>
              : `${offers.length} products reduced right now — up to ${maxPercent}% off. The old price is struck through; the new one is what you pay.`}
          </p>
        </div>
      </section>

      <div className="ds-container py-6 sm:py-10">
        {offers.length > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist" aria-label={L('الأقسام', 'Departments')}>
              {[['all', offers.length] as [string, number], ...cats].map(([c, n]) => (
                <button
                  key={c} type="button" role="tab" aria-selected={cat === c} onClick={() => set('cat', c)} data-testid="offers-cat"
                  className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-bold ring-1 transition ${cat === c ? 'bg-ink-900 text-white ring-ink-900' : 'bg-white text-ink-800 ring-ink-900/[0.08] hover:bg-paper-200'}`}
                >
                  {c === 'all' ? L('كل العروض', 'All offers') : catLabel(c)} <span className="opacity-60 tabular-nums">({n})</span>
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-2 text-[13px] font-bold text-ink-700 shrink-0">
              <SlidersHorizontal size={16} />
              <span className="sr-only sm:not-sr-only">{L('ترتيب حسب', 'Sort by')}</span>
              <select value={sort} onChange={(e) => set('sort', e.target.value)} className="rounded-full bg-white ring-1 ring-ink-900/[0.08] px-3 py-2 text-[13px] font-bold text-ink-900 !border-0" data-testid="offers-sort">
                {SORTS.map((s) => <option key={s.id} value={s.id}>{L(s.ar, s.en)}</option>)}
              </select>
            </label>
          </div>
        )}

        {isLoading && !offers.length ? (
          <ProductSkeletonGrid count={8} />
        ) : shown.length ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5" data-testid="offers-grid">
            {shown.map((o, i) => (
              <ProductCard key={o.p.id} product={o.p as any} onAddToCart={addToCart} onToggleWishlist={toggleWishlist} onQuickView={openQuickView} isLiked={wishlist.has(o.p.id)} priority={i < 2} />
            ))}
          </div>
        ) : (
          <div className="rounded-3xl bg-white ring-1 ring-ink-900/[0.06] p-10 text-center" data-testid="offers-empty">
            <BadgePercent size={36} className="mx-auto text-gold-500 mb-3" />
            <p className="font-heading font-bold text-ink-900 text-lg">{L('لا توجد عروض في هذا القسم الآن', 'No offers in this department right now')}</p>
            <Link to="/shop" className="mt-4 inline-flex items-center gap-2 ds-btn-ink">{L('تصفّح كل المنتجات', 'Browse all products')} {isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}</Link>
          </div>
        )}
        {shown.length > 0 && (
          <p className="mt-6 text-center text-[12px] text-ink-400">{L(`أكبر توفير في هذه القائمة: ${formatJod(Math.max(...shown.map((o) => o.save)))} د.أ للقطعة`, `Biggest saving in this list: ${formatJod(Math.max(...shown.map((o) => o.save)))} JOD per item`)}</p>
        )}
      </div>
    </div>
  );
};

export default Offers;
