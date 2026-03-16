// src/pages/ProductDetails.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  Star, ShoppingCart, Heart, Share2, Truck, RefreshCw, Bell, X, Trash2,
  EyeOff, Eye, MessageSquare, Minus, Plus, Shield, Play, Volume2, VolumeX, ImageOff, Loader2, CheckCircle2
} from 'lucide-react';

import Button from '../components/Button';
import ProductCard from '../components/ProductCard';
import { useCart } from '../App';
// 🚀 التعديل 1: إضافة ProductVariant إلى قائمة الاستيرادات
import { Product, ReviewDoc, AppUser, ProductVariant } from '../types';
import SEO from '../components/SEO';
import { ProductDetailSkeleton } from '../components/Skeleton';
import { reviewsApi } from '../services/reviews';

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
  if (!Number.isFinite(n)) return `0.00 JOD`;
  return `${n.toFixed(2)} JOD`;
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

const StableProductImage = ({ src, alt, className = '' }: { src: string; alt: string; className?: string; }) => {
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
      decoding="async"
      onError={() => setFailed(true)}
      className={`w-full h-full object-contain p-4 bg-white ${className}`}
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

  const product = useMemo(() => products?.find((p) => p.id === id) || null, [products, id]);

  const [activeTab, setActiveTab] = useState<'desc' | 'reviews'>('desc');
  const [qty, setQty] = useState<number>(1);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [activeMedia, setActiveMedia] = useState<{ type: 'image' | 'video'; url: string } | null>(null);

  const [reviews, setReviews] = useState<ReviewDoc[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [canReview, setCanReview] = useState<boolean>(false);
  
  const [myRating, setMyRating] = useState<number>(5);
  const [myComment, setMyComment] = useState<string>('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});

  const tabsRef = useRef<HTMLDivElement | null>(null);
  const reviewFormRef = useRef<HTMLDivElement | null>(null);

  // 🚀 التعديل 2: إدارة الخيار المحدد (اللون / الحجم)
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);

  // 🚀 التعديل 3: اختيار أول خيار تلقائياً عند تحميل المنتج
  useEffect(() => {
    if (product?.variants && product.variants.length > 0) {
      setSelectedVariant(product.variants[0]);
    } else {
      setSelectedVariant(null);
    }
    setQty(1); // إعادة ضبط الكمية عند تغيير المنتج
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

  // 🚀 التعديل 4: المخزون الديناميكي بناءً على الخيار المحدد
  const stock = useMemo(() => {
    if (selectedVariant) return Math.max(0, Number(selectedVariant.stock ?? 0));
    return Math.max(0, Number(product?.stock ?? 0));
  }, [product?.stock, selectedVariant]);
  
  const isInStock = stock > 0;

  // 🚀 التعديل 5: السعر الديناميكي بناءً على الخيار المحدد
  const displayPrice = selectedVariant ? selectedVariant.price : (product?.price ?? 0);
  const displayOriginalPrice = selectedVariant ? selectedVariant.originalPrice : product?.originalPrice;

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

  useEffect(() => {
    if (!allMedia.length) { setActiveMedia(null); return; }
    const firstImage = allMedia.find((m) => m.type === 'image');
    setActiveMedia(firstImage || allMedia[0]);
  }, [product?.id, allMedia]);

  const refreshReviews = useCallback(async () => {
    if (!id) return;
    setReviewsLoading(true);
    try {
      const list = await reviewsApi.listByProduct(id, viewer);
      setReviews(list);
      if (isAdmin) {
        const initial: Record<string, string> = {};
        for (const r of list) {
          const rid = String((r as any).id ?? '');
          if (rid) initial[rid] = safeStr((r as any).adminReply?.text ?? '');
        }
        setReplyDraft(initial);
      }
    } catch {
      console.error("Error fetching reviews");
    } finally {
      setReviewsLoading(false);
    }
  }, [id, viewer, isAdmin, language]);

  useEffect(() => {
    const timer = window.setTimeout(() => { refreshReviews(); }, 250);
    return () => window.clearTimeout(timer);
  }, [refreshReviews]);

  useEffect(() => {
    const run = async () => {
      if (!product?.id || !viewer?.id) {
        setCanReview(false);
        return;
      }
      try {
        const hasPurchased = await reviewsApi.requirePurchased(viewer.id, product.id);
        setCanReview(hasPurchased);
      } catch (err) {
        console.error("Index error or purchase check failed", err);
        setCanReview(false);
      }
    };
    run();
  }, [viewer?.id, product?.id]);

  const publishedReviews = useMemo(() => {
    if (isAdmin) return reviews;
    return reviews.filter((r) => ((r as any).status || 'published') === 'published');
  }, [reviews, isAdmin]);

  const aggregate = useMemo(() => ({
    avg: avgRating(publishedReviews),
    count: publishedReviews.length
  }), [publishedReviews]);

  const isLiked = useMemo(() => (product ? wishlist.has(product.id) : false), [wishlist, product]);

  const relatedProducts = useMemo(() => {
    return product
      ? products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4)
      : [];
  }, [products, product]);

  // 🚀 التعديل 6: تحديث دالة الإضافة للسلة لتمرر الخيار المحدد
  const addToCartWithQty = useCallback(
    (p: Product, q: number) => {
      const st = Math.max(0, Number(selectedVariant ? selectedVariant.stock : p?.stock ?? 0));
      if (st <= 0) return;
      const safeQ = clampInt(q, 1, st);
      const fnAny = addToCart as any;
      if (typeof fnAny === 'function') {
        // ندمج الخيار المختار مع كائن المنتج لكي يصل للسلة بنجاح
        fnAny({ ...p, selectedVariant }, safeQ);
        showToast(tt('addedToCart', 'تمت الإضافة للسلة', 'Added to cart'), 'success');
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

  const handleSubmitReview = async () => {
    if (!product || !viewer?.id) return;

    if (!canReview) {
      showToast(
        tt('reviewAfterPurchase', 'عذراً، يجب شراء المنتج أولاً لتتمكن من التقييم', 'You can review only after purchase'),
        'error'
      );
      return;
    }

    const c = safeStr(myComment);
    if (c.length < 3) {
      showToast(tt('commentTooShort', 'اكتب تعليقاً واضحاً (على الأقل 3 أحرف)', 'Write a clearer comment'), 'error');
      return;
    }

    setIsSubmittingReview(true);
    try {
      await reviewsApi.upsertReview({
        productId: product.id,
        userId: viewer.id,
        userName: viewer.name || 'User',
        userEmail: viewer.email || '',
        rating: myRating,
        comment: c,
      });
      
      showToast(tt('reviewPosted', 'تم نشر تقييمك بنجاح، شكراً لك!', 'Review posted successfully!'), 'success');
      
      setMyComment('');
      setMyRating(5);
      await refreshReviews();
      setActiveTab('reviews');
    } catch (err) {
      console.error(err);
      showToast(tt('reviewFailed', 'فشل حفظ التقييم، جرب مرة أخرى', 'Failed to save review'), 'error');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleAdminToggleStatus = useCallback(async (r: ReviewDoc) => {
    if (!isAdmin) return;
    try {
      const next = ((r as any).status || 'published') === 'published' ? 'hidden' : 'published';
      await reviewsApi.setStatus((r as any).id, next);
      showToast(tt('statusUpdated', 'تمت عملية التغيير', 'Status updated'), 'success');
      await refreshReviews();
    } catch { showToast('Error', 'error'); }
  }, [isAdmin, refreshReviews, showToast, language]);

  const handleAdminDelete = useCallback(async (r: ReviewDoc) => {
    if (!isAdmin) return;
    if (!window.confirm(tr('حذف التقييم؟', 'Delete review?'))) return;
    try {
      await reviewsApi.remove((r as any).id);
      showToast(tt('deleted', 'تم الحذف', 'Deleted'), 'success');
      await refreshReviews();
    } catch { showToast('Error', 'error'); }
  }, [isAdmin, refreshReviews, showToast, language]);

  const handleAdminReply = useCallback(async (r: ReviewDoc) => {
    if (!isAdmin || !viewer) return;
    try {
      const rid = String((r as any).id ?? '');
      await reviewsApi.setAdminReply(rid, safeStr(replyDraft[rid] ?? ''), viewer);
      showToast(tt('replySaved', 'تم حفظ الرد', 'Reply saved'), 'success');
      await refreshReviews();
    } catch { showToast('Error', 'error'); }
  }, [isAdmin, viewer, replyDraft, refreshReviews, showToast, language]);

  const handleTopStarClick = (rating: number) => {
    if (!viewer?.id) return showToast(tt('loginToReview', 'سجّل دخول للتقييم', 'Login to review'), 'info');
    
    if (!canReview) {
      setActiveTab('reviews');
      setTimeout(() => scrollToTabs(), 50);
      return showToast(tt('mustPurchaseFirst', 'عذراً، يجب شراء المنتج أولاً لتتمكن من إضافة تقييمك.', 'Please purchase the product to review'), 'info');
    }

    setMyRating(rating);
    setActiveTab('reviews');
    setTimeout(() => scrollToTabs(), 50);
  };

  if (isLoading || !products || products.length === 0) return <ProductDetailSkeleton />;

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
                <div className="relative group rounded-3xl overflow-hidden bg-slate-100 aspect-square flex items-center justify-center border border-slate-100 shadow-inner">
                  {activeMedia?.type === 'video' ? (
                    <NativeVideoPlayer src={activeMedia.url} poster={heroPoster} />
                  ) : activeMedia?.url ? (
                    <StableProductImage src={activeMedia.url} alt={productTitle} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-400 font-semibold">No media available</div>
                  )}
                  <button onClick={() => toggleWishlist(product)} className="absolute top-4 end-4 p-3 bg-white/90 backdrop-blur-md rounded-full shadow-md text-slate-300 hover:text-red-500 z-30">
                    <Heart size={24} className={isLiked ? 'text-red-500' : ''} fill={isLiked ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </div>
            </div>

            <div className="p-6 lg:p-10 flex flex-col justify-center">
              <div className="flex items-center justify-between mb-4">
                <span className="bg-slate-100 text-slate-700 px-4 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-wider">{product.category}</span>
                <button onClick={handleShare} className="text-slate-400 hover:text-slate-900 transition-colors bg-white border border-slate-100 shadow-sm p-2 rounded-full">
                  <Share2 size={16} />
                </button>
              </div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-slate-900 leading-tight">{productTitle}</h1>
              <div className="flex items-center gap-3 mt-4">
                <div className="flex text-yellow-400">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} size={18} fill={s <= Math.round(aggregate.avg) ? 'currentColor' : 'none'} onClick={() => handleTopStarClick(s)} className="cursor-pointer hover:scale-110 transition-transform" />
                  ))}
                </div>
                <span className="font-bold text-slate-500 hover:text-slate-900 cursor-pointer" onClick={() => { setActiveTab('reviews'); setTimeout(() => scrollToTabs(), 50); }}>
                  ({aggregate.count} {tt('reviews', 'تقييمات', 'Reviews')})
                </span>
              </div>
              
              <div className="mt-8">

                {/* 🚀 التعديل 7: واجهة أزرار الخيارات (الألوان / الأحجام) */}
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

                        return (
                          <button
                            key={variant.id}
                            disabled={outOfStock}
                            onClick={() => { setSelectedVariant(variant); setQty(1); }}
                            className={`
                              relative flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all overflow-hidden border-2
                              ${isSelected ? 'border-slate-900 bg-slate-900 text-white shadow-md scale-[1.02]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}
                              ${outOfStock ? 'opacity-50 cursor-not-allowed border-slate-100 bg-slate-50' : 'cursor-pointer'}
                            `}
                          >
                            {/* دائرة اللون إذا كان نوع الخيار لوناً */}
                            {isColor && variant.colorCode && (
                              <span 
                                className="w-5 h-5 rounded-full border border-black/10 shadow-inner" 
                                style={{ backgroundColor: variant.colorCode }}
                              />
                            )}
                            {variant.label}
                            
                            {/* خط أحمر وتأثير في حال نفاد المخزون لهذا الخيار */}
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

                <div className="flex items-baseline gap-4 mb-6">
                  {/* عرض السعر الديناميكي */}
                  <span className="text-4xl font-black text-slate-900">{formatMoneyJOD(displayPrice)}</span>
                  {displayOriginalPrice && <span className="text-lg font-bold text-slate-400 line-through">{formatMoneyJOD(displayOriginalPrice)}</span>}
                </div>
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl p-1.5 w-full sm:w-36 shadow-inner">
                    <button onClick={decQty} className="p-3 text-slate-600 hover:bg-white rounded-xl transition-all shadow-sm" disabled={qty <= 1}><Minus size={20} /></button>
                    <input value={qty} onChange={onChangeQty} className="w-10 text-center font-black text-slate-900 text-lg outline-none bg-transparent" />
                    <button onClick={incQty} className="p-3 text-slate-600 hover:bg-white rounded-xl transition-all shadow-sm" disabled={qty >= stock}><Plus size={20} /></button>
                  </div>
                  <Button onClick={() => isInStock ? addToCartWithQty(product, qty) : setShowNotifyModal(true)} className={`flex-1 flex items-center justify-center gap-2 py-4 sm:py-5 rounded-2xl text-lg font-black transition-all shadow-lg ${isInStock ? 'bg-slate-900 text-white hover:bg-yellow-400 hover:text-slate-900' : 'bg-slate-200 text-slate-500'}`}>
                    {isInStock ? <><ShoppingCart size={22} /> {tt('addToCart', 'أضف للسلة', 'Add to Cart')}</> : <><Bell size={22} /> {tt('notifyMe', 'أعلمني عند التوفر', 'Notify Me')}</>}
                  </Button>
                </div>
              </div>
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-100 pt-6">
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl text-sm font-bold text-slate-600"><Truck size={20} className="text-slate-400" /> {tt('fastDelivery', 'توصيل سريع', 'Fast Delivery')}</div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl text-sm font-bold text-slate-600"><Shield size={20} className="text-slate-400" /> {tt('securePayment', 'دفع آمن', 'Secure Payment')}</div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl text-sm font-bold text-slate-600"><RefreshCw size={20} className="text-slate-400" /> {tt('freeReturn', 'إرجاع مرن', 'Easy Return')}</div>
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
              <div className="space-y-8 max-w-4xl">
                
                {viewer?.id ? (
                  canReview ? (
                    <div ref={reviewFormRef} className="bg-slate-50 p-6 md:p-8 rounded-3xl border border-slate-100">
                      <h3 className="text-xl font-extrabold mb-4 text-slate-900">{tt('addReview', 'أضف تقييمك', 'Add Review')}</h3>
                      <div className="flex gap-2 mb-5 bg-white inline-flex p-3 rounded-2xl shadow-sm border border-slate-100">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star key={s} size={28} onClick={() => setMyRating(s)} className={`cursor-pointer transition-all active:scale-90 ${s <= myRating ? 'text-yellow-400 fill-yellow-400 drop-shadow-sm' : 'text-slate-200'}`} />
                        ))}
                      </div>
                      <textarea
                        value={myComment}
                        onChange={(e) => setMyComment(e.target.value)}
                        placeholder={tt('reviewPlaceholder', 'اكتب رأيك بصراحة عن المنتج هنا...', 'Write your review...')}
                        className="w-full min-h-[120px] p-5 rounded-2xl border border-slate-200 outline-none focus:ring-2 focus:ring-slate-900 resize-none text-[15px]"
                      />
                      <div className="mt-4 flex justify-end">
                        <Button
                          onClick={() => handleSubmitReview()} 
                          disabled={isSubmittingReview}
                          className="px-10 py-3 bg-slate-900 text-white hover:bg-yellow-400 hover:text-slate-900 font-extrabold rounded-xl transition-all shadow-xl active:scale-95"
                        >
                          {isSubmittingReview ? (
                            <div className="flex items-center gap-2">
                              <Loader2 className="animate-spin" size={18} />
                              {isAR ? 'جاري الحفظ...' : 'Saving...'}
                            </div>
                          ) : (
                            tt('saveReview', 'حفظ التقييم', 'Save Review')
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-sky-50/50 p-8 md:p-10 rounded-3xl border border-sky-100 flex flex-col items-center text-center shadow-sm">
                      <div className="flex gap-2 mb-5 opacity-60">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star key={s} size={28} className="text-slate-300 drop-shadow-sm" />
                        ))}
                      </div>
                      <h3 className="text-xl font-extrabold mb-3 text-slate-900">
                        {tt('weValueYourOpinion', 'نحن نهتم برأيك!', 'We value your opinion!')}
                      </h3>
                      <p className="text-slate-500 max-w-md leading-relaxed text-[15px] font-medium">
                        {tt(
                          'mustPurchaseMsg', 
                          'لضمان شفافية ومصداقية التقييمات في متجرنا، نتيح هذه الميزة فقط للعملاء الذين قاموا بتجربة المنتج فعلياً. نأمل أن نرى تقييمك قريباً بعد الشراء!', 
                          'To ensure authenticity, reviews are restricted to customers who purchased this product. We hope to see your review soon!'
                        )}
                      </p>
                    </div>
                  )
                ) : (
                  <div className="bg-slate-50 p-8 md:p-10 rounded-3xl border border-slate-200 flex flex-col items-center text-center shadow-sm">
                    <MessageSquare className="text-slate-300 mb-4" size={40} />
                    <h3 className="text-xl font-extrabold mb-2 text-slate-900">
                      {tt('joinToReview', 'شاركنا تجربتك', 'Share your experience')}
                    </h3>
                    <p className="text-slate-500 max-w-sm text-sm leading-relaxed">
                      {tt('loginToReviewMsg', 'يرجى تسجيل الدخول أو إنشاء حساب لتتمكن من تقييم هذا المنتج وقراءة آراء العملاء بشكل أفضل.', 'Please log in or create an account to review this product.')}
                    </p>
                  </div>
                )}

                <div className="space-y-6 mt-8">
                  {reviewsLoading ? (
                    <div className="text-center py-10 text-slate-400 font-bold">Loading reviews...</div>
                  ) : publishedReviews.length === 0 ? (
                    <div className="text-center py-16 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                      <MessageSquare className="mx-auto text-slate-300 mb-3" size={40} />
                      <div className="text-slate-500 font-bold">{tt('noReviews', 'لا توجد تقييمات بعد، كن أول من يقيّم المنتج!', 'No reviews yet.')}</div>
                    </div>
                  ) : (
                    publishedReviews.map((r: any, idx) => (
                      <div key={idx} className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-slate-100 text-slate-700 rounded-full flex items-center justify-center font-black text-lg uppercase">{r.userName?.charAt(0) || 'U'}</div>
                            <div>
                              <div className="font-extrabold text-slate-900">{r.userName}</div>
                              <div className="flex text-yellow-400 my-1">
                                {[1, 2, 3, 4, 5].map((s) => (
                                  <Star key={s} size={14} fill={s <= r.rating ? 'currentColor' : 'none'} className={s <= r.rating ? '' : 'text-slate-200'} />
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">{formatDate(r)}</span>
                            {isAdmin && (
                              <div className="flex gap-1 bg-slate-50 p-1 rounded-xl">
                                <button onClick={() => handleAdminToggleStatus(r)} className={`p-1.5 rounded-lg transition-colors ${r.status === 'hidden' ? 'bg-slate-200 text-slate-600' : 'hover:bg-slate-200 text-slate-900'}`}>{r.status === 'hidden' ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                                <button onClick={() => handleAdminDelete(r)} className="p-1.5 hover:bg-red-100 text-red-500 rounded-lg transition-colors"><Trash2 size={16} /></button>
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="text-slate-700 text-[15px] leading-relaxed mt-2 pl-14 rtl:pl-0 rtl:pr-14">{r.comment}</p>
                        {r.adminReply?.text && (
                          <div className="mt-4 ml-10 rtl:ml-0 rtl:mr-10 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                            <div className="text-xs font-black text-slate-800 mb-1 flex items-center gap-1"><Shield size={12} /> {tt('adminReply', 'رد الإدارة:', 'Admin Reply:')}</div>
                            <p className="text-slate-700 text-sm">{r.adminReply.text}</p>
                          </div>
                        )}
                        {isAdmin && (
                          <div className="mt-5 ml-10 rtl:ml-0 rtl:mr-10 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                            <textarea value={replyDraft[r.id] ?? ''} onChange={(e) => setReplyDraft({ ...replyDraft, [r.id]: e.target.value })} placeholder="أضف أو عدل رد الإدارة هنا..." className="w-full p-3 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900 resize-none min-h-[80px]" />
                            <div className="flex justify-end mt-2"><Button size="sm" onClick={() => handleAdminReply(r)} className="bg-slate-900 text-white hover:bg-yellow-400 hover:text-slate-900 rounded-lg px-6">حفظ الرد</Button></div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {relatedProducts.length > 0 && (
          <div className="mb-12">
            <h2 className="text-2xl font-black mb-6 text-slate-900 flex items-center gap-2"><span className="w-1.5 h-6 bg-yellow-400 rounded-full inline-block"></span>{tt('similarProducts', 'منتجات مشابهة', 'Similar Products')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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