// src/pages/ProductDetails.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  Star, ShoppingCart, Heart, Share2, Truck, RefreshCw, Bell, X, Trash2,
  EyeOff, Eye, MessageSquare, Minus, Plus, Shield, Play, Volume2, VolumeX, ImageOff, Loader2, CheckCircle2, MessageCircle
} from 'lucide-react';
import { STORE_PHONE_INTL } from '../config/contact';
import { IS_LIVE } from '../config/deployEnv';

import Button from '../components/Button';
import ProductCard from '../components/ProductCard';
import { useCart } from '../App';
import { Product, ReviewDoc, AppUser, ProductVariant } from '../types';
import SEO from '../components/SEO';
import { ProductDetailSkeleton } from '../components/Skeleton';
import { reviewsApi } from '../services/reviews';
import { saleInfo, formatJod } from '../services/priceDisplay';
import { similarProducts } from '../services/recommendations';
import { earlyProduct, samePlainData } from '../services/productEarly';
import { isPublicVerified } from '../services/verifiedReviews';
import { StarsRow } from '../components/reviews/ReviewParts';
// the reviews tab (form, list, admin moderation) is loaded only when it is opened: nothing added to the first paint
const ProductReviews = React.lazy(() => import('../components/reviews/ProductReviews'));

const safeStr = (v: any) => String(v ?? '').trim();

const isVideoUrl = (url: string) => {
  if (!url) return false;
  const s = String(url).toLowerCase();
  return (
    s.includes('/video/upload/') ||
    s.includes('.mp4') ||
    s.includes('.mov') ||
    s.includes('.webm') ||
    s.includes('.m3u8')
  );
};

const optimizeVideoUrl = (url: string) => {
  if (!url) return '';
  if (url.includes('cloudinary.com') && url.includes('/upload/') && !url.includes('/f_')) {
    return url.replace('/upload/', '/upload/f_mp4,q_auto/');
  }
  return url;
};

const normalizeImages = (p: Product | null): string[] => {
  if (!p) return [];
  const rawList: any[] = [];
  if (Array.isArray(p.images)) rawList.push(...p.images);
  if ((p as any).image) rawList.push((p as any).image);

  return Array.from(
    new Set(
      rawList
        .map(safeStr)
        .filter((u) => u && !isVideoUrl(u))
    )
  );
};

const formatDate = (r: ReviewDoc) => {
  const anyR = r as any;
  if (anyR.createdAt?.toDate) {
    try {
      return anyR.createdAt.toDate().toISOString().slice(0, 10);
    } catch {}
  }
  if (anyR.createdAtMs) return new Date(anyR.createdAtMs).toISOString().slice(0, 10);
  return '';
};

const avgRating = (items: ReviewDoc[]) => {
  if (!items.length) return 0;
  const sum = items.reduce((a, b) => a + Number((b as any).rating || 0), 0);
  return Math.round((sum / items.length) * 10) / 10;
};

const formatMoneyJOD = (value: any) => {
  const n = Number(value);
  const unit = typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'JOD' : 'د.أ';
  if (!Number.isFinite(n)) return `0.00 ${unit}`;
  return `${n.toFixed(2)} ${unit}`;
};

const clampInt = (v: any, min: number, max: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

// 🚀 دالة الوصف الذكية (Smart Parser)
const renderRichText = (raw: string) => {
  const text = safeStr(raw);
  if (!text) return null;

  const autoFormattedText = text.replace(/(✅|✔️|🛠️|🧩|🚀|🌈|🔒|🎲|✨|💡|📌|🎯|- |\* |• )/g, '\n$1');
  const lines = autoFormattedText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  return (
    <div className="grid grid-cols-1 gap-3 py-2">
      {lines.map((line, idx) => {
        const isBullet = /^(-|\*|•|✅|✔️|✨|🚀|🌈|🔒|🛠️|🧩|🎲|💡|📌|🎯)/.test(line);
        if (isBullet) {
          return (
            <div 
              key={idx} 
              className="flex items-start gap-4 p-4 md:p-5 bg-white rounded-2xl border border-slate-100 shadow-[0_4px_20px_-5px_rgba(0,0,0,0.04)] hover:border-yellow-400/40 hover:shadow-md transition-all duration-300"
            >
              <div className="shrink-0 mt-0.5">
                <CheckCircle2 size={22} className="text-emerald-500" />
              </div>
              <p className="text-slate-700 leading-relaxed text-[15px] font-bold">
                {line}
              </p>
            </div>
          );
        }
        return (
          <p key={idx} className="text-slate-600 leading-[2] text-[15px] font-semibold px-2 py-1">
            {line}
          </p>
        );
      })}
    </div>
  );
};

const StableProductImage = ({ src, alt, className = '', style }: { src: string; alt: string; className?: string; style?: React.CSSProperties }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 text-slate-300">
        <ImageOff size={34} />
        <span className="mt-2 text-sm font-semibold">Image unavailable</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="eager"
      // the product's main photo is what the visitor came for: fetched before the thumbnails / similar products
      fetchPriority="high"
      decoding="async"
      onError={() => setFailed(true)}
      className={`w-full h-full object-contain bg-white ${className}`}
      style={style}
    />
  );
};

const NativeVideoPlayer = ({ src, poster }: { src: string; poster: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const v = videoRef.current;
    if (!v) return;

    if (v.paused) {
      const playPromise = v.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.warn("Video play blocked safely:", err);
            setIsPlaying(false);
          });
      }
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  if (!src) return <div className="w-full h-full flex items-center justify-center bg-slate-100">Video unavailable</div>;

  return (
    <div 
      className="relative w-full h-full bg-black flex items-center justify-center cursor-pointer overflow-hidden rounded-[2rem]"
      onClick={togglePlay}
    >
      <video
        ref={videoRef}
        poster={poster}
        className="w-full h-full object-contain"
        playsInline
        preload="metadata"
        muted={isMuted}
        loop
      >
        <source src={src} type="video/mp4" />
        <source src={src} />
      </video>

      {!isPlaying && (
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-10">
          <div className="w-16 h-16 bg-white/95 rounded-full flex items-center justify-center shadow-2xl">
            <Play size={34} className="text-slate-900 fill-current ms-1" />
          </div>
        </div>
      )}

      {isPlaying && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsMuted(!isMuted);
          }}
          className="absolute bottom-4 end-4 z-20 p-3 bg-black/60 backdrop-blur-md rounded-full text-white border border-white/20 shadow-xl"
        >
          {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
      )}
    </div>
  );
};

const ProductDetails: React.FC = () => {
  const params = useParams();
  const id = String((params as any)?.id ?? '');
  const location = useLocation();

  const {
    products,
    addToCart,
    toggleWishlist,
    wishlist,
    openQuickView,
    t,
    getProductTitle,
    isLoading,
    user,
    showToast,
    language
  } = useCart();

  const isAR = language === 'ar';
  const tr = (ar: string, en: string) => (isAR ? ar : en);

  const tt = (key: string, fallbackAr: string, fallbackEn: string) => {
    try {
      const out = t(key as any);
      if (!out || String(out) === key) return tr(fallbackAr, fallbackEn);
      return String(out);
    } catch {
      return tr(fallbackAr, fallbackEn);
    }
  };

  const viewer = user as unknown as AppUser | null;
  const isAdmin = viewer?.role === 'admin';

  const catalogueProduct = useMemo(() => products?.find((p) => p.id === id) || null, [products, id]);

  // the product of an ad / shared link, read on its own (services/productEarly.ts): shown while the catalogue is
  // still on its way. When the catalogue brings the SAME data, the early object is kept, so nothing the visitor chose
  // (colour, quantity, photo) is reset; if the data changed meanwhile, the catalogue's (newer) copy is shown.
  const catalogueEmpty = !products || products.length === 0;
  const [early, setEarly] = useState<Product | null>(null);
  useEffect(() => {
    if (!catalogueEmpty || (early && early.id === id)) return;
    const pending = earlyProduct(id);
    if (!pending) return;
    let alive = true;
    void pending.then((p) => { if (alive && p && p.id === id) setEarly(p); });
    return () => { alive = false; };
  }, [id, catalogueEmpty, early]);
  const product = useMemo(() => {
    const e = early && early.id === id ? early : null;
    if (catalogueProduct) return e && samePlainData(e, catalogueProduct) ? e : catalogueProduct;
    return catalogueEmpty ? e : null;
  }, [catalogueProduct, early, id, catalogueEmpty]);

  const [activeTab, setActiveTab] = useState<'desc' | 'reviews'>('desc');
  const [qty, setQty] = useState<number>(1);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [activeMedia, setActiveMedia] = useState<{ type: 'image' | 'video'; url: string } | null>(null);

  const [reviews, setReviews] = useState<ReviewDoc[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  const tabsRef = useRef<HTMLDivElement | null>(null);

  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);

  useEffect(() => {
    if (product?.variants && product.variants.length > 0) {
      setSelectedVariant(product.variants[0]);
    } else {
      setSelectedVariant(null);
    }
    setQty(1);
  }, [product]);

  const scrollToTabs = useCallback(() => {
    tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const productTitle = useMemo(() => (product ? getProductTitle(product) : ''), [product, getProductTitle]);

  const displayDesc = useMemo(() => {
    if (!product) return '';
    if (!isAR && (product as any).descriptionEn) {
      return (product as any).descriptionEn;
    }
    return product.description || '';
  }, [product, isAR]);

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get('tab') === 'reviews') {
      setActiveTab('reviews');
      setTimeout(() => scrollToTabs(), 50);
    }
  }, [location.search, scrollToTabs]);

  const stock = useMemo(() => {
    if (selectedVariant) return Math.max(0, Number(selectedVariant.stock ?? 0));
    return Math.max(0, Number(product?.stock ?? 0));
  }, [product?.stock, selectedVariant]);
  
  const isInStock = stock > 0;

  // 🚀 التعديل الأهم: لوجيك السعر والسعر الأصلي (معدل)
  const displayPrice = selectedVariant?.price ?? product?.price ?? 0;
  
  const variantOrig = Number(selectedVariant?.originalPrice);
  const productOrig = Number(product?.originalPrice);
  
  // a strike-through price only from REAL data for THIS price: the variant's own original price, or the product's
  // original price when the shown price IS the product price (never another price's original: no invented discount)
  const origForThisPrice = !isNaN(variantOrig) && variantOrig > 0 ? variantOrig : Number(displayPrice) === Number(product?.price) ? productOrig : NaN;
  const pdSale = saleInfo(displayPrice, origForThisPrice);
  const displayOriginalPrice: number | undefined = pdSale.onSale ? pdSale.original : undefined;

  // 🚀 السحر يبدأ هنا: تغيير الصورة بذكاء حسب الخيار!
  const allImages = useMemo(() => normalizeImages(product), [product]);
  const heroPoster = allImages[0] || '';

  const allMedia = useMemo(() => {
    const media: Array<{ type: 'image' | 'video'; url: string }> = [];
    allImages.forEach((img) => { media.push({ type: 'image', url: img }); });
    if ((product as any)?.videoUrl) {
      media.push({ type: 'video', url: optimizeVideoUrl((product as any).videoUrl) });
    }
    return media;
  }, [allImages, (product as any)?.videoUrl]);

  // تحديث الميديا الفعالة لتكون صورة الخيار (إذا وجدت) أو الصورة الأولى
  useEffect(() => {
    if (selectedVariant && selectedVariant.image) {
      setActiveMedia({ type: 'image', url: selectedVariant.image });
      return;
    }
    if (!allMedia.length) { setActiveMedia(null); return; }
    const firstImage = allMedia.find((m) => m.type === 'image');
    setActiveMedia(firstImage || allMedia[0]);
  }, [product?.id, allMedia, selectedVariant]);

  // 🚀 إعدادات عرض الصورة
  const imgFit = product?.imageFit === 'cover' ? 'object-cover' : 'object-contain';
  const imgStyle = product?.imagePosition ? {
    objectPosition: `${product.imagePosition.x}% ${product.imagePosition.y}%`,
    transform: `scale(${product.imagePosition.zoom || 1})`,
    transformOrigin: 'center'
  } : {};

  const refreshReviews = useCallback(async () => {
    if (!id) return;
    setReviewsLoading(true);
    try {
      setReviews(await reviewsApi.listByProduct(id, viewer));
    } catch {
      console.error("Error fetching reviews");
    } finally {
      setReviewsLoading(false);
    }
  }, [id, viewer]);

  useEffect(() => {
    const timer = window.setTimeout(() => { refreshReviews(); }, 250);
    return () => window.clearTimeout(timer);
  }, [refreshReviews]);

  // the figures every visitor sees: published reviews of a VERIFIED purchase only (the admin sees the same numbers)
  const publicReviews = useMemo(() => reviews.filter(isPublicVerified), [reviews]);
  const aggregate = useMemo(() => ({
    avg: avgRating(publicReviews),
    count: publicReviews.length
  }), [publicReviews]);

  const isLiked = useMemo(() => (product ? wishlist.has(product.id) : false), [wishlist, product]);

  // "similar products": shared category / sub-categories / tags (rarer tags count more), buyable only, never this
  // product (services/recommendations.ts); computed from the products already loaded, no extra request
  const relatedProducts = useMemo(() => similarProducts(product, products, 8), [products, product]);

  const addToCartWithQty = useCallback(
    (p: Product, q: number) => {
      const st = Math.max(0, Number(selectedVariant ? selectedVariant.stock : p?.stock ?? 0));
      if (st <= 0) return;
      const safeQ = clampInt(q, 1, st);
      const fnAny = addToCart as any;
      if (typeof fnAny === 'function') {
        // App.addToCart() shows the single result toast itself (success, or the stock-limit error)
        fnAny({ ...p, selectedVariant }, safeQ);
      }
    },
    [addToCart, showToast, language, selectedVariant]
  );

  const incQty = useCallback(() => { if (isInStock) setQty((q) => clampInt(q + 1, 1, stock)); }, [isInStock, stock]);
  const decQty = useCallback(() => { if (isInStock) setQty((q) => clampInt(q - 1, 1, stock)); }, [isInStock, stock]);
  const onChangeQty = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '') { setQty(1); return; }
    setQty(clampInt(raw, 1, stock > 0 ? stock : 1));
  }, [stock]);

  const handleNotifySubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!safeStr(notifyEmail)) return;
    showToast(tt('notifySaved', 'تم تسجيل التنبيه بنجاح', 'Notification saved'), 'success');
    setTimeout(() => { setShowNotifyModal(false); setNotifyEmail(''); }, 1200);
  }, [notifyEmail, showToast, language]);

  const handleShare = useCallback(async () => {
    try {
      const url = window.location.href;
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        showToast(tt('linkCopied', 'تم نسخ رابط المنتج', 'Link copied'), 'success');
      }
    } catch {
      showToast(tt('copyFailed', 'فشل نسخ الرابط', 'Failed to copy link'), 'error');
    }
  }, [showToast, language]);

  // the stars at the top open the reviews tab (writing a review: services/verifiedReviews.ts, checked by the Worker)
  const handleTopStarClick = () => {
    setActiveTab('reviews');
    setTimeout(() => scrollToTabs(), 50);
  };

  // the skeleton until THIS product is known (its own early read, or the catalogue); "not found" only once the
  // catalogue has arrived
  if (!product && (isLoading || catalogueEmpty)) return <ProductDetailSkeleton />;

  if (!product) {
    return (
      <div className="text-center py-32 text-xl font-black text-slate-400 flex flex-col items-center gap-4">
        <X size={48} />
        المنتج غير موجود أو تم حذفه
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 py-4 lg:py-12 relative">
      <SEO title={productTitle} description={displayDesc} image={heroPoster || ''} type="product" />

      {/* opened from a suggestion in checkout: one tap back (the details typed there are kept, services/checkoutDraft.ts) */}
      {(location.state as any)?.from === 'checkout' && (
        <div className="max-w-7xl mx-auto px-4 mb-3 lg:mb-5">
          <Link to="/checkout" data-testid="back-to-checkout" className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-ink-900 px-5 text-[14px] font-black text-white shadow-soft hover:bg-ink-800">
            <span aria-hidden="true">{isAR ? '→' : '←'}</span>{tr('العودة لإتمام الطلب — بياناتك محفوظة', 'Back to checkout — your details are kept')}
          </Link>
        </div>
      )}

      {showNotifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowNotifyModal(false)} />
          <div className="relative bg-white rounded-3xl p-8 w-full max-w-md animate-in zoom-in-95 shadow-2xl">
            <button onClick={() => setShowNotifyModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-red-500">
              <X />
            </button>
            <div className="w-14 h-14 bg-slate-100 text-slate-900 rounded-2xl flex items-center justify-center mb-5">
              <Bell size={28} />
            </div>
            <h3 className="text-2xl font-extrabold mb-2 text-slate-900">{tt('notifyMe', 'أعلمني عند التوفر', 'Notify Me')}</h3>
            <p className="text-slate-500 mb-6 text-sm leading-relaxed">{tt('notifyMeMsg', 'سجل بريدك وسنعلمك فور توفر المنتج.', 'Enter your email.')}</p>
            <form onSubmit={handleNotifySubmit}>
              <input type="email" required value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} placeholder="email@example.com" className="w-full px-4 py-3 rounded-xl border border-slate-200 mb-4 outline-none focus:ring-2 focus:ring-slate-900" />
              <Button type="submit" className="w-full bg-slate-900 text-white hover:bg-yellow-400 hover:text-slate-900 font-extrabold py-3 rounded-xl">
                {tt('confirmSubscribe', 'تأكيد الاشتراك', 'Confirm')}
              </Button>
            </form>
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 lg:px-8 max-w-7xl">
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden mb-8 lg:mb-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:gap-4">
            <div className="p-4 sm:p-6 lg:p-10 flex flex-col lg:flex-row gap-4">
              {allMedia.length > 1 && (
                <div className="order-2 ltr:lg:order-1 rtl:lg:order-2 w-full lg:w-20">
                  <div className="flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto lg:max-h-[500px] scrollbar-hide pb-2">
                    {allMedia.map((media, idx) => (
                      <button key={idx} onClick={() => setActiveMedia(media)} className={`shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-2xl overflow-hidden border-2 transition-all ${activeMedia?.url === media.url ? 'border-slate-900 shadow-md scale-95' : 'border-slate-100 hover:border-slate-300'}`}>
                        {media.type === 'video' ? (
                          <div className="w-full h-full bg-slate-900 flex items-center justify-center relative">
                            {heroPoster && <img loading="lazy" decoding="async" src={heroPoster} alt="v-thumb" className="w-full h-full object-cover opacity-50" />}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-8 h-8 bg-white/30 backdrop-blur-md rounded-full flex items-center justify-center border border-white/50">
                                <Play size={14} className="text-white fill-current ms-0.5" />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <img loading="lazy" decoding="async" src={media.url} alt={`thumb-${idx}`} className="w-full h-full object-cover" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="relative w-full order-1 ltr:lg:order-2 rtl:lg:order-1">
                <div className={`relative group rounded-3xl overflow-hidden bg-slate-100 aspect-square flex items-center justify-center border border-slate-100 shadow-inner ${product?.imageFit === 'contain' ? 'p-6' : ''}`}>
                  {activeMedia?.type === 'video' ? (
                    <NativeVideoPlayer src={activeMedia.url} poster={heroPoster} />
                  ) : activeMedia?.url ? (
                    // 🚀 تطبيق الإعدادات الخاصة بالعرض
                    <div className="w-full h-full relative overflow-hidden" style={imgStyle}>
                      <StableProductImage src={activeMedia.url} alt={productTitle} className={`${imgFit} bg-transparent p-0 w-full h-full`} />
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-400 font-semibold">{isAR ? 'لا توجد صورة' : 'No media available'}</div>
                  )}
                  <button onClick={() => toggleWishlist(product)} className="absolute top-4 end-4 p-3 bg-white/90 backdrop-blur-md rounded-full shadow-md text-slate-300 hover:text-red-500 z-30">
                    <Heart size={24} className={isLiked ? 'text-red-500' : ''} fill={isLiked ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </div>
            </div>

            <div className="p-6 lg:p-10 flex flex-col justify-center">
              <div className="flex items-center justify-between mb-4">
                <span className="bg-gold-50 text-gold-700 ring-1 ring-gold-200 px-4 py-1.5 rounded-full text-xs font-bold">{language === 'ar' ? ({ Games: 'ألعاب', Stationery: 'قرطاسية', BabyGear: 'مستلزمات وركوب', Gifts: 'هدايا', Offers: 'عروض' } as Record<string, string>)[String(product.category)] || product.category : product.category}</span>
                <button onClick={handleShare} className="text-slate-400 hover:text-slate-900 transition-colors bg-white border border-slate-100 shadow-sm p-2 rounded-full">
                  <Share2 size={16} />
                </button>
              </div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-slate-900 leading-tight">{productTitle}</h1>
              <button type="button" onClick={handleTopStarClick} className="flex items-center gap-2 mt-4 rounded-lg text-start hover:opacity-90" data-testid="product-rating-summary" aria-label={aggregate.count > 0 ? (isAR ? `التقييم ${aggregate.avg.toFixed(1)} من 5 — ${aggregate.count} تقييم موثّق` : `Rated ${aggregate.avg.toFixed(1)} of 5 — ${aggregate.count} verified reviews`) : (isAR ? 'التقييمات' : 'Reviews')}>
                <StarsRow value={aggregate.avg} size={18} />
                {aggregate.count > 0 ? (
                  <span className="text-[14px] font-bold text-ink-700"><span className="tabular-nums">{aggregate.avg.toFixed(1)}</span> · {isAR ? `${aggregate.count} ${aggregate.count === 1 ? 'تقييم موثّق' : aggregate.count === 2 ? 'تقييمان موثّقان' : 'تقييمات موثّقة'}` : `${aggregate.count} verified`}</span>
                ) : (
                  <span className="text-[14px] font-semibold text-ink-500">{isAR ? 'لا تقييمات بعد' : 'No reviews yet'}</span>
                )}
              </button>
              
              <div className="mt-8">

                {/* 🚀 السحر في الأزرار والخلايا والألوان المدمجة */}
                {product.variants && product.variants.length > 0 && (
                  <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                    <h3 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">
                      {isAR ? 'الخيارات المتاحة:' : 'Available Options:'}
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      {product.variants.map((variant) => {
                        const isSelected = selectedVariant?.id === variant.id;
                        const isColor = variant.type === 'color';
                        const outOfStock = variant.stock <= 0;
                        const hasName = variant.label && variant.label.trim() !== '';

                        return (
                          <button
                            key={variant.id}
                            disabled={outOfStock}
                            onClick={() => { setSelectedVariant(variant); setQty(1); }}
                            className={`
                              relative flex items-center justify-center gap-2 rounded-xl font-bold text-sm transition-all overflow-hidden border-2
                              ${!hasName && isColor ? 'p-1.5 rounded-full' : 'px-4 py-2.5'}
                              ${isSelected ? 'border-slate-900 bg-slate-900 text-white shadow-md scale-[1.02]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}
                              ${outOfStock ? 'opacity-50 cursor-not-allowed border-slate-100 bg-slate-50' : 'cursor-pointer'}
                            `}
                            title={outOfStock ? tr('غير متوفر', 'Out of stock') : variant.label}
                          >
                            {/* 🚀 دائرة اللون، وإذا كانت مدمجة تظهر مقسومة نصفين! */}
                            {isColor && variant.colorCode && (
                              <span 
                                className={`rounded-full border border-black/10 shadow-inner ${!hasName ? 'w-8 h-8' : 'w-5 h-5'}`} 
                                style={{ 
                                  background: variant.colorCode2 
                                    ? `linear-gradient(135deg, ${variant.colorCode} 50%, ${variant.colorCode2} 50%)`
                                    : variant.colorCode 
                                }}
                              />
                            )}
                            
                            {/* إظهار الاسم فقط إذا كان موجوداً */}
                            {hasName && <span>{variant.label}</span>}
                            
                            {/* خط أحمر في حال نفاد المخزون */}
                            {outOfStock && (
                              <span className="absolute inset-0 flex items-center justify-center bg-white/40">
                                <span className="w-full h-px bg-red-400 absolute rotate-12" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 mb-6" data-testid="product-price-block">
                  {/* السعر — a real discount only (an original price above THIS price, entered by the admin) */}
                  <span className={`font-heading text-4xl font-bold ${pdSale.onSale ? 'text-rose-700' : 'text-ink-900'}`} data-testid="product-price">{formatMoneyJOD(displayPrice)}</span>
                  {displayOriginalPrice && <span className="text-lg font-bold text-slate-400 line-through" data-testid="product-original-price">{formatMoneyJOD(displayOriginalPrice)}</span>}
                  {pdSale.onSale && (
                    <span className="inline-flex items-center gap-2 self-center">
                      <span className="rounded-full bg-rose-600 text-white text-[12px] font-bold px-2.5 py-1" data-testid="product-sale-badge">{language === 'ar' ? <>خصم <bdi dir="ltr">{pdSale.percent}%</bdi></> : `${pdSale.percent}% off`}</span>
                      <span className="rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-100 text-[12px] font-bold px-2.5 py-1 tabular-nums" data-testid="product-save">{language === 'ar' ? `وفّر ${formatJod(pdSale.save)} د.أ` : `Save ${formatJod(pdSale.save)} JOD`}</span>
                    </span>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl p-1.5 w-full sm:w-36 shadow-inner">
                    <button onClick={decQty} className="p-3 text-slate-600 hover:bg-white rounded-xl transition-all shadow-sm" disabled={qty <= 1}><Minus size={20} /></button>
                    <input value={qty} onChange={onChangeQty} className="w-10 text-center font-black text-slate-900 text-lg outline-none bg-transparent" />
                    <button onClick={incQty} className="p-3 text-slate-600 hover:bg-white rounded-xl transition-all shadow-sm" disabled={qty >= stock}><Plus size={20} /></button>
                  </div>
                  <Button onClick={() => isInStock ? addToCartWithQty(product, qty) : setShowNotifyModal(true)} className={`flex-1 flex items-center justify-center gap-2 py-4 sm:py-5 rounded-2xl text-lg font-bold transition-all shadow-lg ${isInStock ? 'bg-ink-900 text-white hover:bg-gold-500' : 'bg-paper-200 text-ink-400'}`}>
                    {isInStock ? <><ShoppingCart size={22} /> {tt('addToCart', 'أضف للسلة', 'Add to Cart')}</> : <><Bell size={22} /> {tt('notifyMe', 'أعلمني عند التوفر', 'Notify Me')}</>}
                  </Button>
                </div>
                {/* WhatsApp question about THIS product (opens WhatsApp only: no order, no cart or stock change) */}
                <a
                  data-testid="product-whatsapp"
                  href={`https://wa.me/${STORE_PHONE_INTL}?text=${encodeURIComponent([
                    'مرحباً مكتبة دير شرف 👋',
                    'أرغب بالاستفسار عن هذا المنتج:',
                    `*${productTitle}*`,
                    ...(selectedVariant?.label && selectedVariant.label !== '.' ? [`الخيار المحدد: ${selectedVariant.label}`] : []),
                    // the live site always links to the canonical domain; previews / local copies link to themselves
                    IS_LIVE ? `https://dairsharaf.com/#/product/${encodeURIComponent(String(product.id))}` : typeof window !== 'undefined' ? window.location.href : '',
                  ].filter(Boolean).join('\n'))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex w-full sm:w-auto self-start items-center justify-center gap-2 rounded-full border border-emerald-600/30 bg-emerald-50 px-5 py-2.5 text-[14px] font-bold text-emerald-800 hover:bg-emerald-100 transition"
                >
                  <MessageCircle size={17} /> {language === 'ar' ? 'استفسر عبر واتساب' : 'Ask on WhatsApp'}
                </a>
              </div>
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-paper-300 pt-6">
                <div className="flex items-center gap-3 p-3 bg-paper-100 rounded-xl text-sm font-semibold text-ink-700"><Truck size={20} className="text-gold-600" /> {language === 'ar' ? 'توصيل لكل المحافظات' : 'Delivery across Jordan'}</div>
                <div className="flex items-center gap-3 p-3 bg-paper-100 rounded-xl text-sm font-semibold text-ink-700"><Shield size={20} className="text-gold-600" /> {language === 'ar' ? 'الدفع عند الاستلام أو CliQ' : 'Cash on delivery or CliQ'}</div>
                <div className="flex items-center gap-3 p-3 bg-paper-100 rounded-xl text-sm font-semibold text-ink-700"><RefreshCw size={20} className="text-gold-600" /> {language === 'ar' ? 'استبدال العطل المصنعي خلال 24 ساعة' : 'Factory defects: 24h exchange'}</div>
              </div>
            </div>
          </div>
        </div>

        <div ref={tabsRef} className="bg-white rounded-3xl p-6 lg:p-10 border border-slate-100 shadow-sm mb-12 scroll-mt-24">
          <div className="flex gap-8 border-b border-slate-100 mb-8 overflow-x-auto scrollbar-hide">
            <button onClick={() => setActiveTab('desc')} className={`pb-4 font-extrabold text-lg relative transition-all whitespace-nowrap ${activeTab === 'desc' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>{tt('descAndDetails', 'الوصف والتفاصيل', 'Description & Details')}{activeTab === 'desc' && <div className="absolute bottom-0 left-0 w-full h-1 bg-yellow-400 rounded-t-full" />}</button>
            <button onClick={() => setActiveTab('reviews')} className={`pb-4 font-extrabold text-lg relative transition-all whitespace-nowrap ${activeTab === 'reviews' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>{tt('reviews', 'التقييمات', 'Reviews')} ({aggregate.count}){activeTab === 'reviews' && <div className="absolute bottom-0 left-0 w-full h-1 bg-yellow-400 rounded-t-full" />}</button>
          </div>

          <div className="min-h-[250px] animate-in fade-in duration-300">
            {activeTab === 'desc' ? (
              <div className="max-w-4xl">{renderRichText(displayDesc)}</div>
            ) : (
              <React.Suspense fallback={<div className="py-10 text-center text-ink-400 font-bold">{isAR ? 'جارٍ تحميل التقييمات…' : 'Loading reviews…'}</div>}>
                <ProductReviews productId={product.id} viewer={viewer} isAdmin={isAdmin} reviews={reviews} loading={reviewsLoading} onChanged={refreshReviews} showToast={showToast as any} isAR={isAR} />
              </React.Suspense>
            )}
          </div>
        </div>

        {relatedProducts.length > 0 && (
          <div className="mb-12">
            <h2 className="font-heading text-2xl font-bold mb-1 text-ink-900 flex items-center gap-2"><span className="w-1.5 h-6 bg-gold-400 rounded-full inline-block"></span>{language === 'ar' ? 'قد يعجبك أيضًا' : 'You may also like'}</h2>
            <p className="text-sm text-ink-500 mb-6">{language === 'ar' ? 'منتجات متوفرة من نفس القسم والاهتمامات' : 'In-stock products from the same department and interests'}</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5" data-testid="similar-products">
              {relatedProducts.map((p) => (
                <ProductCard key={p.id} product={p} onAddToCart={addToCart} onToggleWishlist={toggleWishlist} onQuickView={openQuickView} isLiked={wishlist.has(p.id)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductDetails;