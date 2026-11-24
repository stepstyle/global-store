// "Complete your order" / suggestion rail for the cart and checkout: compact cards of REAL products (photo, name, price,
// a real discount if any) with one "add" button. Nothing is ever added by itself; a product with options (colours /
// sizes) opens its page to choose. Horizontal scroll on phones inside its own box (never a page-wide scroll).
import React, { useCallback } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { Plus, Check } from 'lucide-react';
import LazyImage from './LazyImage';
import { useCart } from '../App';
import { displayPrice, saleInfo, formatJod } from '../services/priceDisplay';
import type { Product } from '../types';

const { Link } = ReactRouterDOM as any;

const imageOf = (p: any) => (Array.isArray(p?.images) && p.images.find(Boolean)) || p?.image || '';

export const SuggestionCard: React.FC<{ product: Product; compact?: boolean }> = ({ product, compact = false }) => {
  const { addToCart, getProductTitle, language } = useCart() as any;
  const L = (ar: string, en: string) => (language === 'en' ? en : ar);
  const [added, setAdded] = React.useState(false);
  const d = displayPrice(product as any);
  const sale = saleInfo(d.price, d.originalPrice);
  const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
  const title = getProductTitle ? getProductTitle(product) : product.name;
  const onAdd = useCallback(async () => {
    await addToCart(product, 1);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  }, [addToCart, product]);

  return (
    <div className={`relative flex ${compact ? 'gap-2.5 p-2.5' : 'gap-3 p-3'} rounded-2xl bg-white ring-1 ring-ink-900/[0.07] shadow-soft min-w-0`} data-testid="suggestion-card" data-product-id={product.id}>
      <Link to={`/product/${product.id}`} className={`relative shrink-0 ${compact ? 'w-16 h-16' : 'w-20 h-20'} rounded-xl bg-paper-100 overflow-hidden`} aria-label={title}>
        {imageOf(product) ? (
          <LazyImage src={imageOf(product)} alt={title} containerClassName="w-full h-full" className="w-full h-full object-contain p-1.5 mix-blend-multiply" loading="lazy" cloudinarySize={200} expectedDisplayWidth={80} aspectRatioHint="1 / 1" />
        ) : null}
        {sale.onSale && <span className="absolute top-1 start-1 rounded-full bg-rose-600 text-white text-[9.5px] font-bold px-1.5 py-0.5" dir="ltr">-{sale.percent}%</span>}
      </Link>
      <div className="flex-1 min-w-0 flex flex-col">
        <Link to={`/product/${product.id}`} className="text-[12.5px] font-bold leading-snug text-ink-900 line-clamp-2 hover:text-royal-700">{title}</Link>
        <div className="mt-auto pt-1.5 flex items-end justify-between gap-2">
          <div className="flex flex-col leading-none min-w-0">
            {sale.onSale && <span className="text-[10.5px] text-ink-300 font-semibold line-through tabular-nums mb-0.5">{formatJod(sale.original)} {L('د.أ', 'JOD')}</span>}
            <span className={`text-[14px] font-heading font-bold tabular-nums ${sale.onSale ? 'text-rose-700' : 'text-ink-900'}`}>
              {formatJod(d.price ?? product.price)} <span className="text-[10px] text-gold-600">{L('د.أ', 'JOD')}</span>
            </span>
          </div>
          {hasVariants ? (
            <Link to={`/product/${product.id}`} className="shrink-0 h-8 px-3 rounded-full bg-paper-200 text-ink-900 text-[12px] font-bold inline-flex items-center hover:bg-gold-100" data-testid="suggestion-choose">{L('اختر', 'Choose')}</Link>
          ) : (
            <button type="button" onClick={() => void onAdd()} className={`shrink-0 h-8 px-3 rounded-full text-[12px] font-bold inline-flex items-center gap-1 transition active:scale-95 ${added ? 'bg-emerald-600 text-white' : 'bg-ink-900 text-white hover:bg-gold-500'}`} data-testid="suggestion-add" aria-label={L(`أضف ${title} للسلة`, `Add ${title} to cart`)}>
              {added ? <Check size={14} /> : <Plus size={14} />}{added ? L('أُضيف', 'Added') : L('أضف', 'Add')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/** a titled rail of suggestion cards (cart: grid; checkout: compact list) */
export default function SuggestionRail({ products, title, subtitle, compact = false, testId = 'suggestions' }: { products: Product[]; title: string; subtitle?: string; compact?: boolean; testId?: string }) {
  if (!products.length) return null;
  return (
    <section className={compact ? 'mt-5' : 'mt-6 rounded-3xl bg-gradient-to-b from-paper-100 to-white ring-1 ring-ink-900/[0.06] p-4 sm:p-6'} data-testid={testId} aria-label={title}>
      <div className="flex items-end justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className={`font-heading font-bold text-ink-900 ${compact ? 'text-[15px]' : 'text-[18px] sm:text-[20px]'}`}>{title}</h2>
          {subtitle && <p className="text-[12px] text-ink-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {compact ? (
        <div className="grid gap-2">{products.map((p) => <SuggestionCard key={p.id} product={p} compact />)}</div>
      ) : (
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex sm:grid sm:grid-cols-2 xl:grid-cols-3 gap-3 overflow-x-auto sm:overflow-visible snap-x snap-mandatory scrollbar-hide pb-1" data-testid={`${testId}-list`}>
          {products.map((p) => <div key={p.id} className="snap-start shrink-0 w-[82%] sm:w-auto"><SuggestionCard product={p} /></div>)}
        </div>
      )}
    </section>
  );
}
