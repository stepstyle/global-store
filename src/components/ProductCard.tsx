// src/components/ProductCard.tsx
import React, { useCallback, useMemo } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { Star, ShoppingCart, Heart, Eye, Bell } from 'lucide-react';

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

/**
 * ✅ Professional rating resolver (long-term compatible)
 */
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

/**
 * ✅ Product image resolver
 */
const resolveImage = (p: Product) => {
  const anyP = p as any;
  const imgs = Array.isArray(anyP.images) ? anyP.images : [];
  return imgs[0] || p.image || '';
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
  const imageSrc = useMemo(() => resolveImage(product), [product]);

  const productTitle = useMemo(() => getProductTitle(product), [getProductTitle, product]);
  const productLink = useMemo(() => `/product/${product.id}`, [product.id]);

  const isInStock = (product.stock ?? 0) > 0;

  const badge = useMemo(() => {
    if (product.originalPrice) return t('sale');
    if (product.isNew) return t('new');
    return '';
  }, [product.originalPrice, product.isNew, t]);

  const categoryLabel = useMemo(() => String(product.category ?? '').trim(), [product.category]);

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

  const ctaLabel = isInStock ? t('addToCart') : t('notifyMe');
  const ctaAria = isInStock ? 'Add to cart' : 'Notify me';

  return (
    <div
      className="
        group relative bg-white rounded-2xl overflow-hidden
        border border-slate-100 shadow-sm hover:shadow-xl
        transition-all duration-500
        flex flex-col h-full
        md:transform-gpu md:will-change-transform md:hover:-translate-y-2
      "
      data-product-id={product.id}
    >
      {/* Badge */}
      {badge ? (
        <div
          className={`absolute top-3 left-3 rtl:left-3 rtl:right-auto ltr:right-auto ltr:left-3 z-10 text-white text-xs font-bold px-2 py-1 rounded-full shadow-md ${
            product.originalPrice ? 'bg-red-500 animate-pulse' : 'bg-secondary-DEFAULT'
          }`}
        >
          {badge}
        </div>
      ) : null}

      {/* Action Buttons Top Right */}
      <div
        className="
          absolute top-3 right-3 rtl:right-3 rtl:left-auto ltr:left-auto ltr:right-3 z-10
          flex flex-col gap-2 transition-opacity duration-300
          opacity-100 md:opacity-0 md:group-hover:opacity-100
          md:translate-x-4 rtl:md:-translate-x-4 ltr:md:translate-x-4
          md:group-hover:translate-x-0
        "
      >
        <button
          onClick={onClickWishlist}
          className={`p-2 rounded-full backdrop-blur-md transition-colors shadow-sm ${
            isLiked ? 'bg-red-50 text-red-500' : 'bg-white/90 text-slate-400 hover:text-red-500'
          }`}
          aria-label={wishlistLabel}
          type="button"
        >
          <Heart size={18} fill={isLiked ? 'currentColor' : 'none'} />
        </button>

        {onQuickView ? (
          <button
            onClick={onClickQuickView}
            className="hidden md:block p-2 rounded-full bg-white/90 backdrop-blur-md text-slate-400 hover:text-secondary-DEFAULT transition-colors shadow-sm"
            aria-label={quickViewLabel}
            type="button"
          >
            <Eye size={18} />
          </button>
        ) : null}
      </div>

      {/* Image */}
      <Link to={productLink} className="block relative" aria-label={productTitle}>
        <LazyImage
          src={imageSrc}
          alt={productTitle}
          containerClassName="aspect-square bg-slate-50"
          className="w-full h-full object-cover transition-transform duration-700 md:group-hover:scale-110 md:mix-blend-multiply"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
        />
        <div className="absolute inset-0 bg-black/5 opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      </Link>

      {/* Content */}
      <div className="p-4 flex flex-col flex-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span
            className="
              text-[10px] text-secondary-DEFAULT font-bold uppercase tracking-wider
              bg-secondary-light/10 px-2 py-0.5 rounded-md truncate max-w-[55%]
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
            <span className="text-xs text-slate-600 font-bold tabular-nums">{rating.avg || 0}</span>
            <span className="text-[10px] text-slate-400 tabular-nums">({rating.count})</span>
          </button>
        </div>

        <Link to={productLink} className="block mb-2 md:group-hover:text-secondary-DEFAULT transition-colors">
          <h3 className="font-bold text-slate-800 line-clamp-1 text-sm md:text-base">{productTitle}</h3>
          {product.nameEn ? <p className="text-xs text-slate-400 line-clamp-1">{product.nameEn}</p> : null}
        </Link>

        <div className="mt-auto pt-4 flex items-center justify-between border-t border-slate-50">
          <div className="flex flex-col">
            <span className="font-bold text-lg text-slate-900 tabular-nums">
              {Number(product.price ?? 0)} <span className="text-xs font-normal"></span>
            </span>
            {product.originalPrice ? (
              <span className="text-xs text-slate-400 line-through tabular-nums">{Number(product.originalPrice)}</span>
            ) : null}
          </div>

          <Button
            onClick={onClickCart}
            variant={isInStock ? 'primary' : 'secondary'}
            size="sm"
            disabled={!isInStock}
            className="rounded-lg shadow-none px-3 py-2"
            aria-label={ctaAria}
            title={ctaLabel}
          >
            {isInStock ? <ShoppingCart size={18} /> : <Bell size={18} />}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;