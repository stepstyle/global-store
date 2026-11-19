// src/components/ProductCard.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { Star, ShoppingCart, Heart, Eye, Minus, Plus, PlaySquare, Palette } from 'lucide-react';
import { Product } from '../types';
import { useCart } from '../App';
import LazyImage from './LazyImage';
import { availableStock, displayPrice, saleInfo, hasPriceRange, formatJod } from '../services/priceDisplay';

const { Link, useNavigate } = ReactRouterDOM as any;

interface ProductCardProps {
  product: Product;
  onAddToCart: ((product: Product) => void) | ((product: Product, qty: number) => void);
  onToggleWishlist: (product: Product) => void;
  onQuickView?: (product: Product) => void;
  isLiked: boolean;
  priority?: boolean;
  disableLift?: boolean;
}

// 🧮 دالة مساعدة لحساب التقييمات
const resolveRating = (p: Product) => {
  const anyP = p as any;
  const avgRaw = anyP.ratingAvg ?? anyP.avgRating ?? p.rating ?? 0;
  const countRaw = anyP.ratingCount ?? anyP.reviewCount ?? p.reviews ?? 0;
  const avg = Number(avgRaw);
  const count = Number(countRaw);
  return {
    avg: Number.isFinite(avg) ? Math.max(0, Math.min(5, avg)) : 0,
    count: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0,
  };
};

// ⭐ دالة رسم النجوم
const renderStars = (avg: number) => {
  const full = Math.floor(avg);
  const hasHalf = avg - full >= 0.5;
  return (
    <div className="flex items-center gap-0.5 text-yellow-400 drop-shadow-sm" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => {
        const isFull = i < full;
        const isHalf = i === full && hasHalf;
        return (
          <Star
            key={i}
            size={12}
            className={isFull || isHalf ? 'text-yellow-400' : 'text-slate-200'}
            fill={isFull ? 'currentColor' : isHalf ? 'currentColor' : 'none'}
            style={isHalf ? { opacity: 0.6 } : undefined}
          />
        );
      })}
    </div>
  );
};

const normalizeImg = (raw: any) => {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('data:') || s.startsWith('blob:')) return s;
  if (s.startsWith('/')) return s;
  return `/${s.replace(/^\.?\//, '')}`;
};

const resolveImages = (p: Product) => {
  const anyP = p as any;
  const imgs = Array.isArray(anyP.images) ? anyP.images : [];
  const primary = normalizeImg(imgs[0] || anyP.image || p.image || '');
  const secondary = normalizeImg(imgs[1] || anyP.hoverImage || anyP.image2 || '');
  return { primary, secondary };
};

const clampInt = (v: any, min: number, max: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onAddToCart,
  onToggleWishlist,
  onQuickView,
  isLiked,
  priority = false,
  disableLift = false,
}) => {
  const { t, getProductTitle, language } = useCart();
  const navigate = useNavigate();
  
  // 🌍 دالة مساعدة لتبسيط الترجمة
  const L = useCallback((ar: string, en: string) => (language === 'ar' ? ar : en), [language]);

  const rating = useMemo(() => resolveRating(product), [product]);
  const { primary: image1, secondary: image2 } = useMemo(() => resolveImages(product), [product]);
  const productTitle = useMemo(() => getProductTitle(product), [getProductTitle, product]);
  const productLink = useMemo(() => `/product/${product.id}`, [product.id]);
  // what can really be bought: the variants' stock for a variant product (the product-level number can be stale)
  const stock = useMemo(() => availableStock(product as any), [product]);
  // the price shown = the cheapest in-stock variant (or the product price); a sale only with a REAL higher original price
  const shown = useMemo(() => displayPrice(product as any), [product]);
  const sale = useMemo(() => saleInfo(shown.price, shown.originalPrice), [shown]);
  const fromPrice = useMemo(() => hasPriceRange(product as any), [product]);
  const isInStock = stock > 0;

  const badge = useMemo(() => {
    if (sale.onSale) return t('sale');
    if ((product as any).isNew) return t('new');
    return '';
  }, [product, t, sale]);

  const categoryLabel = useMemo(() => String(product.category ?? '').trim(), [product.category]);
  const [hovered, setHovered] = useState(false);

  // 🖼️ تحميل الصورة الثانية (الخلفية) مسبقاً
  useEffect(() => {
    if (!hovered) return;
    if (!image2) return;
    const img = new Image();
    img.src = image2;
  }, [hovered, image2]);

  const [qty, setQty] = useState<number>(1);
  useEffect(() => {
    const max = stock > 0 ? stock : 1;
    setQty((q) => clampInt(q, 1, max));
  }, [product.id, stock]);

  const incQty = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!isInStock) return;
    setQty((q) => clampInt(q + 1, 1, stock));
  }, [isInStock, stock]);

  const decQty = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!isInStock) return;
    setQty((q) => clampInt(q - 1, 1, stock));
  }, [isInStock, stock]);

  const onChangeQty = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const max = stock > 0 ? stock : 1;
    setQty(clampInt(raw, 1, max));
  }, [stock]);

  const onClickWishlist = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    onToggleWishlist(product);
  }, [onToggleWishlist, product]);

  const onClickQuickView = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    onQuickView?.(product);
  }, [onQuickView, product]);

  const onClickReviews = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    navigate(`${productLink}?tab=reviews`);
  }, [navigate, productLink]);

  // 🚀 منع الإضافة المباشرة إذا كان المنتج له خيارات متعددة لتوجيه الزبون لصفحة المنتج
  const hasVariants = product.variants && product.variants.length > 0;

  const onClickCart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    
    if (!isInStock) return;

    if (hasVariants) {
      // توجيه لصفحة المنتج لاختيار اللون/الحجم
      navigate(productLink);
      return;
    }

    const safeQty = clampInt(qty, 1, stock);
    const fnAny = onAddToCart as any;
    if (typeof fnAny === 'function') {
      try {
        if (fnAny.length >= 2) {
          fnAny(product, safeQty);
          return;
        }
      } catch {}
    }
    for (let i = 0; i < safeQty; i++) (onAddToCart as (p: Product) => void)(product);
  }, [isInStock, onAddToCart, product, qty, stock, hasVariants, navigate, productLink]);

  const mainCloudinarySize = priority ? 600 : 460;

  // 🚀 قراءة إعدادات الصورة
  const imgFit = product.imageFit === 'cover' ? 'object-cover' : 'object-contain';
  const imgStyle = product.imagePosition ? {
    objectPosition: `${product.imagePosition.x}% ${product.imagePosition.y}%`,
    transform: `scale(${product.imagePosition.zoom || 1})`,
    transformOrigin: 'center'
  } : {};

  const CATEGORY_AR: Record<string, string> = { Games: 'ألعاب', Stationery: 'قرطاسية', BabyGear: 'مستلزمات وركوب', Gifts: 'هدايا', Offers: 'عروض' };
  const categoryText = language === 'ar' ? CATEGORY_AR[categoryLabel] || categoryLabel : categoryLabel;
  const discountPct = sale.onSale ? sale.percent : 0;

  return (
    <div
      className={[
        'group relative flex flex-col h-full bg-white rounded-3xl',
        'ring-1 ring-ink-900/[0.06] shadow-soft',
        'transition-all duration-500 hover:shadow-lift hover:ring-gold-300/60',
        disableLift ? 'overflow-visible' : 'overflow-hidden hover:-translate-y-1',
      ].join(' ')}
      data-product-id={product.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* image on a warm paper stage */}
      <Link to={productLink} className="block relative m-2 mb-0 rounded-[1.25rem] overflow-hidden bg-gradient-to-b from-paper-100 to-paper-200" aria-label={productTitle}>
        <div className={`relative w-full aspect-[4/4.3] ${product.imageFit === 'cover' ? '' : 'p-4 sm:p-6'}`}>
          {image1 ? (
            <div className="w-full h-full relative" style={imgStyle}>
              <LazyImage
                src={image1}
                alt={productTitle}
                containerClassName="w-full h-full"
                className={`w-full h-full mix-blend-multiply transition-transform duration-700 ease-out group-hover:scale-[1.06] pointer-events-none ${imgFit}`}
                loading={priority ? 'eager' : 'lazy'}
                fetchPriority={priority ? 'high' : 'auto'}
                cloudinarySize={mainCloudinarySize}
                expectedDisplayWidth={280}
                aspectRatioHint="1 / 1"
              />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-300 text-sm font-bold">{L('لا توجد صورة', 'No Image')}</div>
          )}
          {image2 && (
            <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-paper-100 ${product.imageFit === 'cover' ? '' : 'p-4 sm:p-6'}`}>
              <div className="w-full h-full relative" style={imgStyle}>
                <LazyImage src={image2} alt={productTitle} containerClassName="w-full h-full" className={`w-full h-full mix-blend-multiply pointer-events-none ${imgFit}`} loading="lazy" fetchPriority="low" cloudinarySize={460} expectedDisplayWidth={280} aspectRatioHint="1 / 1" />
              </div>
            </div>
          )}
          {!isInStock && (
            <div className="absolute inset-x-3 bottom-3 rounded-full bg-ink-900/85 text-white text-[11px] font-bold text-center py-1.5 backdrop-blur">{L('نفدت الكمية', 'Sold out')}</div>
          )}
        </div>
      </Link>

      {/* badges */}
      <div className="absolute top-4 start-4 z-20 flex flex-col items-start gap-1.5">
        {discountPct > 0 ? (
          <span className="rounded-full bg-gold-500 text-white text-[11px] font-bold px-2.5 py-1 shadow-gold">-{discountPct}%</span>
        ) : badge ? (
          <span className="rounded-full bg-ink-900 text-gold-200 text-[11px] font-bold px-2.5 py-1">{badge}</span>
        ) : null}
        {product.videoUrl && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/95 text-royal-700 text-[10px] font-bold px-2 py-1 ring-1 ring-ink-900/10">
            <PlaySquare size={11} /> {L('فيديو', 'Video')}
          </span>
        )}
      </div>

      {/* wishlist (always visible: phones have no hover) + quick view */}
      <div className="absolute top-4 end-4 z-20 flex flex-col gap-2">
        <button
          onClick={onClickWishlist}
          className={`w-9 h-9 rounded-full flex items-center justify-center shadow-soft transition-all duration-300 ${isLiked ? 'bg-ink-900 text-gold-300' : 'bg-white/95 text-ink-400 hover:text-ink-900'}`}
          aria-label={isLiked ? L('إزالة من المفضلة', 'Remove from wishlist') : L('إضافة للمفضلة', 'Add to wishlist')}
          type="button"
        >
          <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} strokeWidth={2.2} />
        </button>
        {onQuickView && (
          <button
            onClick={onClickQuickView}
            className="hidden sm:flex w-9 h-9 rounded-full items-center justify-center bg-white/95 text-ink-400 hover:text-ink-900 shadow-soft opacity-0 group-hover:opacity-100 transition-all duration-300"
            aria-label={L('عرض سريع', 'Quick view')}
            type="button"
          >
            <Eye size={16} strokeWidth={2.2} />
          </button>
        )}
      </div>

      {/* details */}
      <div className="flex flex-col flex-1 px-3.5 sm:px-5 pt-3.5 pb-4 sm:pb-5">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[11px] font-semibold text-gold-600 truncate" title={categoryLabel}>{categoryText}</span>
          {rating.count > 0 && (
            <button type="button" onClick={onClickReviews} className="flex items-center gap-1 text-[11px] font-semibold text-ink-400 hover:text-ink-900" aria-label={L('عرض التقييمات', 'Open reviews')}>
              <Star size={12} className="text-gold-400" fill="currentColor" />
              <span className="tabular-nums">{rating.avg.toFixed(1)}</span>
            </button>
          )}
        </div>

        <Link to={productLink} className="block mb-2">
          <h3 className="font-heading font-semibold text-ink-900 text-[14px] sm:text-[15.5px] leading-snug line-clamp-2 min-h-[2.6em] group-hover:text-royal-700 transition-colors">{productTitle}</h3>
        </Link>

        {hasVariants && (
          <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-royal-600">
            <Palette size={13} /> {L('ألوان أو مقاسات متعددة', 'Several options')}
          </div>
        )}

        <div className="mt-auto">
          <div className="flex items-end justify-between gap-2">
            <div className="flex flex-col leading-none">
              {sale.onSale && (
                <span className="text-[12px] text-ink-300 font-semibold line-through tabular-nums mb-1" data-testid="card-original-price">{formatJod(sale.original)} {L('د.أ', 'JOD')}</span>
              )}
              <span className="font-heading font-bold text-ink-900 text-[18px] sm:text-[20px] tabular-nums" data-testid="card-price">
                {fromPrice && <span className="text-[11px] font-semibold text-ink-400 me-1">{L('من', 'from')}</span>}
                {formatJod(shown.price ?? product.price)}
                <span className="text-[11px] font-semibold text-gold-600 ms-1">{L('د.أ', 'JOD')}</span>
              </span>
            </div>

            <button
              onClick={onClickCart}
              disabled={!isInStock}
              className={`shrink-0 inline-flex items-center justify-center gap-1.5 h-10 rounded-full text-[13px] font-bold transition-all duration-300 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${hasVariants ? 'px-3.5 bg-paper-200 text-ink-900 hover:bg-gold-100' : 'w-10 sm:w-auto sm:px-4 bg-ink-900 text-white hover:bg-gold-500'}`}
              aria-label={isInStock ? (hasVariants ? L('اختر', 'Select') : L('أضف للسلة', 'Add to cart')) : L('غير متوفر', 'Out of stock')}
              type="button"
            >
              {hasVariants ? (
                <span>{L('اختر', 'Choose')}</span>
              ) : (
                <>
                  <ShoppingCart size={17} strokeWidth={2.2} />
                  <span className="hidden sm:inline">{L('أضف', 'Add')}</span>
                </>
              )}
            </button>
          </div>

          {!hasVariants && isInStock && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex items-center rounded-full bg-paper-100 ring-1 ring-ink-900/[0.06] p-0.5">
                <button type="button" onClick={decQty} disabled={qty <= 1} className="w-7 h-7 rounded-full flex items-center justify-center text-ink-500 hover:bg-white disabled:opacity-30" aria-label={L('تقليل الكمية', 'Decrease quantity')}>
                  <Minus size={13} strokeWidth={2.6} />
                </button>
                <input value={String(qty)} onChange={onChangeQty} inputMode="numeric" pattern="[0-9]*" className="w-7 text-center bg-transparent text-[13px] font-bold tabular-nums focus:outline-none text-ink-900 !border-0 !shadow-none" aria-label={L('الكمية', 'Quantity')} />
                <button type="button" onClick={incQty} disabled={qty >= stock} className="w-7 h-7 rounded-full flex items-center justify-center text-ink-500 hover:bg-white disabled:opacity-30" aria-label={L('زيادة الكمية', 'Increase quantity')}>
                  <Plus size={13} strokeWidth={2.6} />
                </button>
              </div>
              <span className="text-[11px] font-semibold text-emerald-700">{stock <= 5 ? L(`باقي ${stock} فقط`, `Only ${stock} left`) : L('متوفر', 'In stock')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductCard;