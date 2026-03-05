// src/components/ProductCard.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { Star, ShoppingCart, Heart, Eye, Minus, Plus } from 'lucide-react';
import { Product } from '../types';
import { useCart } from '../App';
import LazyImage from './LazyImage';

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

const renderStars = (avg: number) => {
  const full = Math.floor(avg);
  const hasHalf = avg - full >= 0.5;
  return (
    <div className="flex items-center gap-0.5 text-yellow-400" aria-hidden="true">
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
  const rating = useMemo(() => resolveRating(product), [product]);
  const { primary: image1, secondary: image2 } = useMemo(() => resolveImages(product), [product]);
  const productTitle = useMemo(() => getProductTitle(product), [getProductTitle, product]);
  const productLink = useMemo(() => `/product/${product.id}`, [product.id]);
  const stock = useMemo(() => Math.max(0, Number(product.stock ?? 0)), [product.stock]);
  const isInStock = stock > 0;

  const badge = useMemo(() => {
    if ((product as any).originalPrice) return t('sale');
    if ((product as any).isNew) return t('new');
    return '';
  }, [product, t]);

  const categoryLabel = useMemo(() => String(product.category ?? '').trim(), [product.category]);
  const [hovered, setHovered] = useState(false);

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

  const incQty = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isInStock) return;
      setQty((q) => clampInt(q + 1, 1, stock));
    },
    [isInStock, stock]
  );

  const decQty = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isInStock) return;
      setQty((q) => clampInt(q - 1, 1, stock));
    },
    [isInStock]
  );

  const onChangeQty = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const max = stock > 0 ? stock : 1;
      setQty(clampInt(raw, 1, max));
    },
    [stock]
  );

  const onClickWishlist = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onToggleWishlist(product);
    },
    [onToggleWishlist, product]
  );

  const onClickQuickView = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onQuickView?.(product);
    },
    [onQuickView, product]
  );

  const onClickReviews = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      navigate(`${productLink}?tab=reviews`);
    },
    [navigate, productLink]
  );

  const onClickCart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isInStock) return;
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
    },
    [isInStock, onAddToCart, product, qty, stock]
  );

  const wishlistLabel =
    isLiked
      ? language === 'ar'
        ? 'إزالة من المفضلة'
        : 'Remove from wishlist'
      : language === 'ar'
        ? 'إضافة للمفضلة'
        : 'Add to wishlist';

  const mainCloudinarySize = priority ? 600 : 460; // ✅ تصغير الصورة للكارد

  const qtyLabel = language === 'ar' ? 'الكمية' : 'Qty';
  const inStockLabel = language === 'ar' ? `متوفر: ${stock}` : `In stock: ${stock}`;

  return (
    <div
      className={[
        'group relative bg-white rounded-xl', // ✅ تصغير الكارد شوي
        'border border-slate-100 shadow-sm',
        'hover:shadow-xl transition-all duration-300',
        'flex flex-col h-full',
        'transform-gpu will-change-transform',
        disableLift ? 'overflow-visible' : 'overflow-hidden hover:-translate-y-1',
      ].join(' ')}
      data-product-id={product.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Badge */}
      {badge && (
        <div
          className={[
            'absolute top-2 left-2 z-30 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md',
            (product as any).originalPrice ? 'bg-red-500' : 'bg-secondary-DEFAULT',
          ].join(' ')}
        >
          {badge}
        </div>
      )}

      {/* Top actions */}
      <div
        className={[
          'absolute top-2 right-2 z-30 flex flex-col gap-2',
          'opacity-0 group-hover:opacity-100 transition-all duration-300',
        ].join(' ')}
      >
        <button
          onClick={onClickWishlist}
          className={[
            'p-2 rounded-full shadow-sm transition',
            isLiked ? 'bg-red-50 text-red-600' : 'bg-white/90 text-slate-600 hover:text-red-600',
          ].join(' ')}
          aria-label={wishlistLabel}
          type="button"
        >
          <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} />
        </button>

        {onQuickView && (
          <button
            onClick={onClickQuickView}
            className={[
              'p-2 rounded-full bg-white/90 text-slate-600 hover:text-secondary-DEFAULT shadow-sm transition',
            ].join(' ')}
            aria-label={language === 'ar' ? 'عرض سريع' : 'Quick view'}
            type="button"
          >
            <Eye size={16} />
          </button>
        )}
      </div>

      {/* Image */}
      <Link to={productLink} className="block relative" aria-label={productTitle}>
        <div className="relative w-full aspect-square bg-slate-50 overflow-hidden p-3"> {/* ✅ padding أقل */}
          {image1 ? (
            <LazyImage
              src={image1}
              alt={productTitle}
              containerClassName="w-full h-full"
              className="w-full h-full object-contain pointer-events-none"
              loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : 'auto'}
              cloudinarySize={mainCloudinarySize}
              expectedDisplayWidth={280} // ✅ أقل من السابق
              aspectRatioHint="1 / 1"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-300 text-sm">
              No Image
            </div>
          )}
          {image2 && (
            <div className="absolute inset-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-250">
              <LazyImage
                src={image2}
                alt={productTitle}
                containerClassName="w-full h-full"
                className="w-full h-full object-contain pointer-events-none"
                loading="lazy"
                fetchPriority="low"
                cloudinarySize={460}
                expectedDisplayWidth={280}
                aspectRatioHint="1 / 1"
              />
            </div>
          )}
        </div>
      </Link>

      {/* Content */}
      <div className="p-3 flex flex-col flex-1 text-sm"> {/* ✅ padding أقل + font أصغر */}
        <div className="mb-1 flex items-center justify-between gap-2">
          <span
            className="text-[9px] text-secondary-DEFAULT font-bold uppercase tracking-wider bg-secondary-light/10 px-2 py-0.5 rounded-md truncate max-w-[55%]"
            title={categoryLabel}
          >
            {categoryLabel}
          </span>

          <button
            type="button"
            onClick={onClickReviews}
            className="flex items-center gap-1 hover:opacity-90 active:scale-[0.99]"
            title={language === 'ar' ? 'عرض التقييمات' : 'Open reviews'}
            aria-label={language === 'ar' ? 'عرض التقييمات' : 'Open reviews'}
          >
            {renderStars(rating.avg)}
            <span className="text-xs text-slate-700 font-bold tabular-nums">{rating.avg || 0}</span>
            <span className="text-[10px] text-slate-400 tabular-nums">({rating.count})</span>
          </button>
        </div>

        <Link to={productLink} className="block mb-1 transition-colors group-hover:text-secondary-DEFAULT">
          <h3 className="font-bold text-slate-800 line-clamp-1 text-sm">{productTitle}</h3>
        </Link>

        {/* Quantity + stock hint */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-semibold">{qtyLabel}</span>
            <div className="mt-1 flex items-center gap-1">
              <button
                type="button"
                onClick={decQty}
                disabled={!isInStock || qty <= 1}
                className="p-2 rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={language === 'ar' ? 'تقليل الكمية' : 'Decrease quantity'}
              >
                <Minus size={14} />
              </button>

              <input
                value={String(qty)}
                onChange={onChangeQty}
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={!isInStock}
                className="w-12 text-center rounded-lg border border-slate-200 py-1 text-sm font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT/30 disabled:opacity-50"
                aria-label={language === 'ar' ? 'الكمية' : 'Quantity'}
              />

              <button
                type="button"
                onClick={incQty}
                disabled={!isInStock || qty >= stock}
                className="p-2 rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={language === 'ar' ? 'زيادة الكمية' : 'Increase quantity'}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div className="text-[10px] text-slate-500 font-semibold text-end">
            {isInStock ? inStockLabel : language === 'ar' ? 'غير متوفر' : 'Out of stock'}
          </div>
        </div>

        <div className="mt-auto pt-3 flex items-center justify-between border-t border-slate-100">
          <div className="flex flex-col">
            <span className="font-extrabold text-base text-slate-900 tabular-nums leading-none">
              {Number(product.price ?? 0)}
              <span className="text-xs font-normal ms-1 text-slate-500">JOD</span>
            </span>
            {(product as any).originalPrice && (
              <span className="text-xs text-slate-400 line-through tabular-nums mt-1">
                {Number((product as any).originalPrice)} <span className="ms-1">JOD</span>
              </span>
            )}
          </div>

          <button
            onClick={onClickCart}
            disabled={!isInStock}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary-DEFAULT hover:bg-secondary-dark text-white text-xs font-semibold shadow-sm hover:shadow-md transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={isInStock ? (language === 'ar' ? 'أضف للسلة' : 'Add to cart') : (language === 'ar' ? 'غير متوفر' : 'Out of stock')}
            type="button"
          >
            <ShoppingCart size={16} strokeWidth={2.2} />
            <span className="whitespace-nowrap">{language === 'ar' ? 'أضف للسلة' : 'Add to cart'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;