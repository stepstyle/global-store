// src/components/ProductCard.tsx
import React, { useCallback, useEffect, useMemo } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { Star, ShoppingCart, Heart, Eye } from 'lucide-react';
import { Product } from '../types';
import { useCart } from '../App';
import Button from './Button';
import LazyImage from './LazyImage';

const { Link, useNavigate } = ReactRouterDOM as any;

interface ProductCardProps {
  product: Product;
  onAddToCart: (product: Product) => void;
  onToggleWishlist: (product: Product) => void;
  onQuickView?: (product: Product) => void;
  isLiked: boolean;
  priority?: boolean;
}

/** ✅ Rating resolver (safe + flexible) */
const resolveRating = (p: Product) => {
  const anyP = p as any;
  const avgRaw = anyP.ratingAvg ?? anyP.avgRating ?? p.rating ?? 0;
  const countRaw = anyP.ratingCount ?? anyP.reviewCount ?? p.reviews ?? 0;

  const avg = Number(avgRaw);
  const count = Number(countRaw);

  const safeAvg = Number.isFinite(avg) ? Math.max(0, Math.min(5, avg)) : 0;
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

  return { avg: Math.round(safeAvg * 10) / 10, count: safeCount };
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

/** ✅ Image normalize (external + local) */
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

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onAddToCart,
  onToggleWishlist,
  onQuickView,
  isLiked,
  priority = false,
}) => {
  const { t, getProductTitle, language } = useCart();
  const navigate = useNavigate();

  const rating = useMemo(() => resolveRating(product), [product]);
  const { primary: image1, secondary: image2 } = useMemo(() => resolveImages(product), [product]);
  const productTitle = useMemo(() => getProductTitle(product), [getProductTitle, product]);
  const productLink = useMemo(() => `/product/${product.id}`, [product.id]);

  const isInStock = (product.stock ?? 0) > 0;

  const badge = useMemo(() => {
    if (product.originalPrice) return t('sale');
    if ((product as any).isNew) return t('new');
    return '';
  }, [product.originalPrice, t, product]);

  const categoryLabel = useMemo(() => String(product.category ?? '').trim(), [product.category]);

  /** ✅ Preload hover image for instant swap (global stores do this) */
  useEffect(() => {
    if (!image2) return;
    const img = new Image();
    img.src = image2;
  }, [image2]);

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
      onAddToCart(product);
    },
    [onAddToCart, product]
  );

  const wishlistLabel =
    isLiked
      ? language === 'ar'
        ? 'إزالة من المفضلة'
        : 'Remove from wishlist'
      : language === 'ar'
        ? 'إضافة للمفضلة'
        : 'Add to wishlist';

  const quickViewLabel = language === 'ar' ? 'عرض سريع' : 'Quick view';
  const reviewsLabel = language === 'ar' ? 'عرض التقييمات' : 'Open reviews';

  return (
    <div
      className="
        group relative bg-white rounded-2xl overflow-hidden
        border border-slate-100 shadow-sm
        hover:shadow-2xl transition-all duration-500
        flex flex-col h-full
        transform-gpu will-change-transform hover:-translate-y-1.5
      "
      data-product-id={product.id}
    >
      {/* ✅ Badge */}
      {badge ? (
        <div
          className={`
            absolute top-3 left-3 rtl:left-3 rtl:right-auto ltr:right-auto ltr:left-3
            z-30 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow-md
            ${product.originalPrice ? 'bg-red-500' : 'bg-secondary-DEFAULT'}
          `}
        >
          {badge}
        </div>
      ) : null}

      {/* ✅ Top actions (appear on hover like global stores) */}
      <div
        className="
          absolute top-3 right-3 rtl:right-3 rtl:left-auto ltr:left-auto ltr:right-3
          z-30 flex flex-col gap-2
          opacity-0 group-hover:opacity-100
          translate-x-2 group-hover:translate-x-0
          transition-all duration-300
        "
      >
        <button
          onClick={onClickWishlist}
          className={`
            p-2 rounded-full shadow-sm backdrop-blur-md transition
            ${isLiked ? 'bg-red-50 text-red-600' : 'bg-white/90 text-slate-600 hover:text-red-600'}
            hover:shadow-md active:scale-95
          `}
          aria-label={wishlistLabel}
          type="button"
        >
          <Heart size={18} fill={isLiked ? 'currentColor' : 'none'} />
        </button>

        {onQuickView ? (
          <button
            onClick={onClickQuickView}
            className="
              p-2 rounded-full bg-white/90 backdrop-blur-md
              text-slate-600 hover:text-secondary-DEFAULT
              shadow-sm hover:shadow-md transition active:scale-95
            "
            aria-label={quickViewLabel}
            type="button"
          >
            <Eye size={18} />
          </button>
        ) : null}
      </div>

      {/* ✅ Image (fixed ratio + contain + hover swap instantly) */}
      <Link to={productLink} className="block relative" aria-label={productTitle}>
        <div className="relative w-full aspect-square bg-slate-50 overflow-hidden">
          {/* Primary */}
          <div
            className={`
              absolute inset-0 p-4
              transition-opacity duration-300
              ${image2 ? 'opacity-100 group-hover:opacity-0' : 'opacity-100'}
            `}
          >
            {image1 ? (
              <LazyImage
                src={image1}
                alt={productTitle}
                containerClassName="w-full h-full"
                className="w-full h-full object-contain"
                loading={priority ? 'eager' : 'lazy'}
                fetchPriority={priority ? 'high' : 'auto'}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-300 text-sm">
                No Image
              </div>
            )}
          </div>

          {/* Secondary (on hover) */}
          {image2 ? (
            <div className="absolute inset-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <LazyImage
                src={image2}
                alt={productTitle}
                containerClassName="w-full h-full"
                className="w-full h-full object-contain"
                loading="eager"
                fetchPriority="high"
              />
            </div>
          ) : null}

          {/* Overlay */}
          <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
        </div>
      </Link>

      {/* ✅ Content */}
      <div className="p-4 flex flex-col flex-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span
            className="
              text-[10px] text-secondary-DEFAULT font-bold uppercase tracking-wider
              bg-secondary-light/10 px-2 py-1 rounded-md truncate max-w-[55%]
            "
            title={categoryLabel}
          >
            {categoryLabel}
          </span>

          <button
            type="button"
            onClick={onClickReviews}
            className="flex items-center gap-1 hover:opacity-90 active:scale-[0.99]"
            title={reviewsLabel}
            aria-label={reviewsLabel}
          >
            {renderStars(rating.avg)}
            <span className="text-xs text-slate-700 font-bold tabular-nums">{rating.avg || 0}</span>
            <span className="text-[10px] text-slate-400 tabular-nums">({rating.count})</span>
          </button>
        </div>

        <Link to={productLink} className="block mb-2 transition-colors group-hover:text-secondary-DEFAULT">
          <h3 className="font-bold text-slate-800 line-clamp-1 text-sm md:text-base">{productTitle}</h3>
          {(product as any).nameEn ? (
            <p className="text-xs text-slate-400 line-clamp-1">{(product as any).nameEn}</p>
          ) : null}
        </Link>

        <div className="mt-auto pt-4 flex items-center justify-between border-t border-slate-100">
          <div className="flex flex-col">
            <span className="font-extrabold text-lg text-slate-900 tabular-nums leading-none">
              {Number(product.price ?? 0)}
              <span className="text-xs font-normal ms-1 text-slate-500">JOD</span>
            </span>
            {product.originalPrice ? (
              <span className="text-xs text-slate-400 line-through tabular-nums mt-1">
                {Number(product.originalPrice)} <span className="ms-1">JOD</span>
              </span>
            ) : null}
          </div>

          {/* ✅ Cart button always visible + brand color */}
         <button
  onClick={onClickCart}
  disabled={!isInStock}
  className="
    flex items-center gap-2
    px-3 py-2
    rounded-xl
    bg-secondary-DEFAULT
    hover:bg-secondary-dark
    text-blue
    text-xs font-semibold
    shadow-sm hover:shadow-md
    transition-all duration-200
    active:scale-95
    disabled:opacity-50 disabled:cursor-not-allowed
  "
  aria-label={isInStock ? 'Add to cart' : 'Out of stock'}
>
  <ShoppingCart size={16} strokeWidth={2.2} />
  <span className="whitespace-nowrap">
    {language === 'ar' ? 'أضف للسلة' : 'Add to cart'}
  </span>
</button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;