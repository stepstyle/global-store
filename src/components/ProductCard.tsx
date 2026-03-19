// src/components/ProductCard.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { Star, ShoppingCart, Heart, Eye, Minus, Plus, PlaySquare, Palette } from 'lucide-react';
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
  const stock = useMemo(() => Math.max(0, Number(product.stock ?? 0)), [product.stock]);
  const isInStock = stock > 0;

  const badge = useMemo(() => {
    if ((product as any).originalPrice) return t('sale');
    if ((product as any).isNew) return t('new');
    return '';
  }, [product, t]);

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

  return (
    <div
      className={[
        'group relative bg-white rounded-[2rem]',
        'border border-slate-100 shadow-sm',
        'hover:shadow-2xl hover:shadow-slate-200/50 hover:border-slate-200 transition-all duration-500',
        'flex flex-col h-full',
        'transform-gpu will-change-transform',
        disableLift ? 'overflow-visible' : 'overflow-hidden hover:-translate-y-1.5',
      ].join(' ')}
      data-product-id={product.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 🏷️ حاوية الشارات العلوية (الخصم + مؤشر الفيديو) */}
      <div className="absolute top-4 start-4 z-30 flex flex-col gap-2">
        {badge && (
          <div
            className={[
              'text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full shadow-lg',
              (product as any).originalPrice ? 'bg-rose-500 shadow-rose-500/30' : 'bg-black shadow-black/30',
            ].join(' ')}
          >
            {badge}
          </div>
        )}
        
        {/* 🎥 شارة الفيديو */}
        {product.videoUrl && (
          <div className="flex items-center justify-center gap-1.5 bg-sky-50 border border-sky-100 text-sky-600 text-[9px] font-black uppercase px-2 py-1.5 rounded-full shadow-md backdrop-blur-sm animate-in fade-in zoom-in">
            <PlaySquare size={12} className="fill-current" />
            <span>{L('فيديو', 'Video')}</span>
          </div>
        )}
      </div>

      {/* 🔘 أزرار التفاعل السريعة */}
      <div className="absolute top-4 end-4 z-30 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-4 rtl:-translate-x-4 group-hover:translate-x-0 rtl:group-hover:translate-x-0">
        <button
          onClick={onClickWishlist}
          className={`p-2.5 rounded-2xl shadow-md transition-all duration-300 ${isLiked ? 'bg-rose-50 text-rose-500' : 'bg-white/90 backdrop-blur text-slate-400 hover:text-rose-500 hover:bg-white hover:scale-110'}`}
          aria-label={isLiked ? L('إزالة من المفضلة', 'Remove from wishlist') : L('إضافة للمفضلة', 'Add to wishlist')}
          type="button"
        >
          <Heart size={18} fill={isLiked ? 'currentColor' : 'none'} strokeWidth={2.5} />
        </button>

        {onQuickView && (
          <button
            onClick={onClickQuickView}
            className="p-2.5 rounded-2xl bg-white/90 backdrop-blur text-slate-400 hover:text-sky-500 hover:bg-white hover:scale-110 shadow-md transition-all duration-300"
            aria-label={L('عرض سريع', 'Quick view')}
            type="button"
          >
            <Eye size={18} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* 📸 صورة المنتج */}
      <Link to={productLink} className="block relative bg-slate-50/50" aria-label={productTitle}>
        <div className={`relative w-full aspect-square overflow-hidden ${product.imageFit === 'cover' ? '' : 'p-6'}`}>
          {image1 ? (
            <div className="w-full h-full relative" style={imgStyle}>
              <LazyImage
                src={image1}
                alt={productTitle}
                containerClassName="w-full h-full"
                className={`w-full h-full mix-blend-multiply transition-transform duration-700 ease-out group-hover:scale-[1.05] pointer-events-none ${imgFit}`}
                loading={priority ? 'eager' : 'lazy'}
                fetchPriority={priority ? 'high' : 'auto'}
                cloudinarySize={mainCloudinarySize}
                expectedDisplayWidth={280}
                aspectRatioHint="1 / 1"
              />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-300 text-sm font-bold">
              {L('لا توجد صورة', 'No Image')}
            </div>
          )}
          
          {/* صورة التمرير (Hover Image) */}
          {image2 && (
            <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-white ${product.imageFit === 'cover' ? '' : 'p-6'}`}>
              <div className="w-full h-full relative" style={imgStyle}>
                <LazyImage
                  src={image2}
                  alt={productTitle}
                  containerClassName="w-full h-full"
                  className={`w-full h-full mix-blend-multiply transition-transform duration-700 ease-out group-hover:scale-[1.05] pointer-events-none ${imgFit}`}
                  loading="lazy"
                  fetchPriority="low"
                  cloudinarySize={460}
                  expectedDisplayWidth={280}
                  aspectRatioHint="1 / 1"
                />
              </div>
            </div>
          )}
        </div>
      </Link>

      {/* 📝 تفاصيل المنتج */}
      <div className="p-5 sm:p-6 flex flex-col flex-1 bg-white">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {/* التصنيف (Badge) */}
          <span className="text-[9px] text-sky-500 font-black uppercase tracking-widest bg-sky-50 border border-sky-100 px-2.5 py-1 rounded-lg truncate max-w-[55%]" title={categoryLabel}>
            {categoryLabel}
          </span>

          {/* التقييم */}
          <button
            type="button"
            onClick={onClickReviews}
            className="flex items-center gap-1.5 hover:opacity-80 active:scale-[0.99] transition-opacity"
            title={L('عرض التقييمات', 'Open reviews')}
            aria-label={L('عرض التقييمات', 'Open reviews')}
          >
            {renderStars(rating.avg)}
            <span className="text-[11px] text-slate-400 font-bold tabular-nums">({rating.count})</span>
          </button>
        </div>

        {/* عنوان المنتج */}
        <Link to={productLink} className="block mb-2 transition-colors group-hover:text-sky-500">
          <h3 className="font-black text-slate-900 line-clamp-2 text-sm sm:text-base leading-snug">{productTitle}</h3>
        </Link>

        {/* 🚀 مؤشر وجود خيارات (ألوان/أحجام) */}
        {hasVariants && (
          <div className="mb-2.5 flex items-center gap-1.5">
            <Palette size={14} className="text-amber-500" />
            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
              {L('متوفر بخيارات متعددة', 'Available in options')}
            </span>
          </div>
        )}

        {/* 🔢 أزرار اختيار الكمية والمخزون */}
        <div className="mb-4 mt-auto flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-slate-400">
            {isInStock ? (
              <span className="text-emerald-500">{L(`متوفر: ${stock}`, `In stock: ${stock}`)}</span>
            ) : (
              <span className="text-red-500">{L('غير متوفر', 'Out of stock')}</span>
            )}
          </div>
          
          {/* إخفاء اختيار الكمية إذا كان فيه خيارات (نوجهه لصفحة المنتج ليختار) */}
          {!hasVariants && (
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-slate-50 border border-slate-100 rounded-xl p-1">
                <button
                  type="button"
                  onClick={decQty}
                  disabled={!isInStock || qty <= 1}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white transition-all disabled:opacity-30 disabled:hover:bg-transparent shadow-sm"
                  aria-label={L('تقليل الكمية', 'Decrease quantity')}
                >
                  <Minus size={14} strokeWidth={3} />
                </button>

                <input
                  value={String(qty)}
                  onChange={onChangeQty}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  disabled={!isInStock}
                  className="w-8 sm:w-10 text-center bg-transparent text-sm font-black tabular-nums focus:outline-none disabled:opacity-50 text-slate-800"
                  aria-label={L('الكمية', 'Quantity')}
                />

                <button
                  type="button"
                  onClick={incQty}
                  disabled={!isInStock || qty >= stock}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white transition-all disabled:opacity-30 disabled:hover:bg-transparent shadow-sm"
                  aria-label={L('زيادة الكمية', 'Increase quantity')}
                >
                  <Plus size={14} strokeWidth={3} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 💰 قسم السعر وزر الإضافة للسلة */}
        <div className="pt-4 flex items-center justify-between border-t border-slate-100 border-dashed gap-2">
          <div className="flex flex-col">
            <span className="font-black text-lg text-slate-900 tabular-nums leading-none">
              {Number(product.price ?? 0)}
              <span className="text-[10px] font-black ms-1 text-slate-400 uppercase">JOD</span>
            </span>
            {(product as any).originalPrice && (
              <span className="text-[11px] text-slate-400 font-bold line-through decoration-slate-300 decoration-2 tabular-nums mt-1">
                {Number((product as any).originalPrice)} <span className="ms-0.5 uppercase">JOD</span>
              </span>
            )}
          </div>

          <button
            onClick={onClickCart}
            disabled={!isInStock}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-extrabold transition-all duration-300 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none group/btn ${hasVariants ? 'bg-amber-400 hover:bg-amber-500 text-slate-900 shadow-lg shadow-amber-400/30' : 'bg-sky-400 hover:bg-sky-500 text-white shadow-lg shadow-sky-400/30'}`}
            aria-label={isInStock ? (hasVariants ? L('اختر', 'Select') : L('أضف للسلة', 'Add to cart')) : L('غير متوفر', 'Out of stock')}
            type="button"
          >
            {hasVariants ? (
              <span className="inline-block px-2">{L('تحديد خيار', 'Select Option')}</span>
            ) : (
              <>
                <ShoppingCart size={18} strokeWidth={2.5} className="group-hover/btn:scale-110 transition-transform" />
                <span className="hidden sm:inline-block">{L('أضف', 'Add')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;