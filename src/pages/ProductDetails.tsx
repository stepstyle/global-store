// src/pages/ProductDetails.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  Star,
  ShoppingCart,
  Heart,
  Share2,
  Check,
  Truck,
  RefreshCw,
  Bell,
  X,
  Trash2,
  EyeOff,
  Eye,
  MessageSquare,
  Minus,
  Plus,
  Shield,
} from 'lucide-react';

import Button from '../components/Button';
import ProductCard from '../components/ProductCard';
import { useCart } from '../App';
import { Product, ReviewDoc, AppUser } from '../types';
import SEO from '../components/SEO';
import LazyImage from '../components/LazyImage';
import ProductImageZoom from '../components/ProductImageZoom';
import { ProductDetailSkeleton } from '../components/Skeleton';
import { reviewsApi } from '../services/reviews';
import { db } from '../services/storage';

// ---------------- Helpers ----------------
const safeStr = (v: any) => String(v ?? '').trim();

const isValidImageSrc = (u: string) => {
  if (!u) return false;
  return /^https?:\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('/');
};

const normalizeImages = (p: Product | null): string[] => {
  if (!p) return [];
  const rawList: any[] = [];
  const anyP = p as any;
  if (Array.isArray(anyP.images)) rawList.push(...anyP.images);
  if (anyP.image) rawList.push(anyP.image);
  const cleaned = rawList.map(safeStr).filter(Boolean).filter(isValidImageSrc);
  return Array.from(new Set(cleaned));
};

const formatDate = (r: ReviewDoc) => {
  const anyR = r as any;
  if (anyR.createdAt?.toDate) {
    try {
      const d = anyR.createdAt.toDate();
      return d.toISOString().slice(0, 10);
    } catch { }
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
  try {
    return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} JOD`;
  } catch {
    return `${n.toFixed(2)} JOD`;
  }
};

const clampInt = (v: any, min: number, max: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  const i = Math.floor(n);
  return Math.max(min, Math.min(max, i));
};

const renderRichText = (raw: string) => {
  const text = safeStr(raw);
  if (!text) return null;
  const lines = text.replace(/\r/g, '\n').split('\n').map((l) => l.trim());
  const blocks: Array<{ type: 'p'; value: string } | { type: 'ul'; items: string[] }> = [];
  let currentList: string[] = [];
  const pushListIfAny = () => {
    if (currentList.length > 0) {
      blocks.push({ type: 'ul', items: currentList });
      currentList = [];
    }
  };
  for (const line of lines) {
    if (!line) { pushListIfAny(); continue; }
    const isBullet = /^(-|\*|•)\s+/.test(line);
    if (isBullet) {
      const item = line.replace(/^(-|\*|•)\s+/, '').trim();
      if (item) currentList.push(item);
      continue;
    }
    pushListIfAny();
    blocks.push({ type: 'p', value: line });
  }
  pushListIfAny();
  return (
    <div className="space-y-4">
      {blocks.map((b, idx) => {
        if (b.type === 'ul') {
          return (
            <ul key={idx} className="list-disc list-inside space-y-2 text-slate-700 leading-relaxed marker:text-slate-400 bg-slate-50 p-4 rounded-xl">
              {b.items.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
          );
        }
        return <p key={idx} className="text-slate-700 leading-relaxed text-[15px]">{b.value}</p>;
      })}
    </div>
  );
};

// ---------------- Component ----------------
const ProductDetails: React.FC = () => {
  const params = useParams();
  const id = String((params as any)?.id ?? '');
  const location = useLocation();

  const {
    products, addToCart, toggleWishlist, wishlist, openQuickView,
    t, getProductTitle, isLoading, user, showToast, language,
  } = useCart();

  // Helper للترجمة مع نصوص بديلة قوية (لحل مشكلة securePayment وغيرها)
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

  const [product, setProduct] = useState<Product | null>(null);
  const [activeTab, setActiveTab] = useState<'desc' | 'reviews'>('desc');
  const [qty, setQty] = useState<number>(1);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [isNotified, setIsNotified] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string>('');
  const [reviews, setReviews] = useState<ReviewDoc[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [canReview, setCanReview] = useState<boolean>(false);
  const [canReviewLoading, setCanReviewLoading] = useState<boolean>(false);
  const [myReviewId, setMyReviewId] = useState<string | null>(null);
  const [myRating, setMyRating] = useState<number>(5);
  const [myComment, setMyComment] = useState<string>('');
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});

  const tabsRef = useRef<HTMLDivElement | null>(null);
  const reviewFormRef = useRef<HTMLDivElement | null>(null);

  const scrollToTabs = useCallback(() => {
    tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const productTitle = useMemo(() => (product ? getProductTitle(product) : ''), [product, getProductTitle]);

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const tab = sp.get('tab');
    if (tab === 'reviews') {
      setActiveTab('reviews');
      setTimeout(() => scrollToTabs(), 50);
    }
  }, [location.search, scrollToTabs]);

  useEffect(() => {
    const found = products.find((p) => p.id === id);
    setProduct(found || null);
    window.scrollTo(0, 0);
    setIsNotified(false);
    setShowNotifyModal(false);
    setNotifyEmail('');
    setQty(1);
  }, [id, products]);

  const stock = useMemo(() => Math.max(0, Number(product?.stock ?? 0)), [product?.stock]);
  const isInStock = stock > 0;

  useEffect(() => {
    const max = stock > 0 ? stock : 1;
    setQty((q) => clampInt(q, 1, max));
  }, [stock, product?.id]);

  const allImages = useMemo(() => normalizeImages(product), [product]);
  useEffect(() => {
    const first = allImages[0] || '';
    setSelectedImage(first);
  }, [product?.id, allImages]);

  const heroImage = selectedImage || allImages[0] || '';

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
          if (!rid) continue;
          initial[rid] = safeStr((r as any).adminReply?.text ?? '');
        }
        setReplyDraft(initial);
      }
      if (viewer?.id) {
        const mine = await reviewsApi.getMyReview(id, viewer.id);
        if (mine) {
          setMyReviewId(mine.id);
          setMyRating(Number((mine as any).rating || 5));
          setMyComment(String((mine as any).comment || ''));
        }
      }
    } catch (e: any) {
      showToast(tt('reviewsError', 'حدث خطأ في التقييمات', 'Reviews error'), 'error');
    } finally {
      setReviewsLoading(false);
    }
  }, [id, viewer, isAdmin, showToast, language]);

  useEffect(() => { refreshReviews(); }, [refreshReviews]);

  // ------- تعديل ميزة التقييم (بإمكانك التقييم بدون شراء لتجربة الموقع) -------
  useEffect(() => {
    const run = async () => {
      if (!product?.id || !viewer?.id) {
        setCanReview(false);
        return;
      }
      // تم تخطي شرط الشراء لتسهيل التقييم
      setCanReview(true); 
    };
    run();
  }, [viewer?.id, product?.id]);

  const publishedReviews = useMemo(() => {
    if (isAdmin) return reviews;
    return reviews.filter((r) => ((r as any).status || 'published') === 'published');
  }, [reviews, isAdmin]);

  const aggregate = useMemo(() => ({ avg: avgRating(publishedReviews), count: publishedReviews.length }), [publishedReviews]);
  const isLiked = useMemo(() => (product ? wishlist.has(product.id) : false), [wishlist, product]);
  const relatedProducts = useMemo(() => product ? products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4) : [], [products, product]);

  const addToCartWithQty = useCallback(
    (p: Product, q: number) => {
      const st = Math.max(0, Number((p as any)?.stock ?? 0));
      if (st <= 0) return;
      const safeQ = clampInt(q, 1, st);
      const fnAny = addToCart as any;
      try {
        if (typeof fnAny === 'function' && fnAny.length >= 2) {
          fnAny(p, safeQ);
          showToast(tt('addedToCart', 'تمت الإضافة للسلة', 'Added to cart'), 'success');
          return;
        }
      } catch { }
      for (let i = 0; i < safeQ; i += 1) addToCart(p);
      showToast(tt('addedToCart', 'تمت الإضافة للسلة', 'Added to cart'), 'success');
    },
    [addToCart, showToast, language]
  );

  const incQty = useCallback(() => {
    if (!isInStock) return;
    setQty((q) => clampInt(q + 1, 1, stock));
  }, [isInStock, stock]);

  const decQty = useCallback(() => {
    if (!isInStock) return;
    setQty((q) => clampInt(q - 1, 1, stock));
  }, [isInStock, stock]);

  const onChangeQty = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const max = stock > 0 ? stock : 1;
      if (raw === '') { setQty(1); return; }
      setQty(clampInt(raw, 1, max));
    },
    [stock]
  );

  const handleNotifySubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const email = safeStr(notifyEmail);
      if (!email) return;
      setIsNotified(true);
      showToast(tt('notifySaved', 'تم تسجيل التنبيه بنجاح', 'Notification saved'), 'success');
      setTimeout(() => { setShowNotifyModal(false); setNotifyEmail(''); }, 1200);
    },
    [notifyEmail, showToast, language]
  );

  const handleShare = useCallback(async () => {
    try {
      const url = typeof window !== 'undefined' ? window.location.href : '';
      if (!url) return;
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        showToast(tt('linkCopied', 'تم نسخ رابط المنتج', 'Link copied'), 'success');
        return;
      }
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      showToast(tt('linkCopied', 'تم نسخ رابط المنتج', 'Link copied'), 'success');
    } catch {
      showToast(tt('copyFailed', 'فشل نسخ الرابط', 'Failed to copy link'), 'error');
    }
  }, [showToast, language]);

  // ------------ Reviews handlers ------------
  const handleSubmitReview = useCallback(async () => {
    if (!product || !viewer?.id) return;
    if (!canReview) {
      showToast(tt('reviewAfterPurchase', 'لا يمكنك تقييم هذا المنتج إلا بعد شرائه', 'You can review only after purchase'), 'error');
      return;
    }
    const c = safeStr(myComment);
    if (c.length < 3) {
      showToast(tt('commentTooShort', 'اكتب تعليق واضح (على الأقل 3 أحرف)', 'Write a clearer comment'), 'error');
      return;
    }
    try {
      await reviewsApi.upsertReview({
        productId: product.id,
        userId: viewer.id,
        userName: viewer.name || 'User',
        userEmail: viewer.email || '',
        rating: myRating,
        comment: c,
      });
      showToast(tt('reviewPosted', 'تم نشر تقييمك بنجاح', 'Review posted'), 'success');
      await refreshReviews();
      setActiveTab('reviews');
    } catch (e: any) {
      showToast(tt('reviewFailed', 'فشل حفظ التقييم', 'Failed to save review'), 'error');
    }
  }, [product, viewer, canReview, myComment, myRating, refreshReviews, showToast, language]);

  const handleAdminToggleStatus = useCallback(async (r: ReviewDoc) => {
    if (!isAdmin) return;
    try {
      const current = ((r as any).status || 'published') as 'published' | 'hidden';
      const next = current === 'published' ? 'hidden' : 'published';
      await reviewsApi.setStatus((r as any).id, next);
      showToast(tt('statusUpdated', 'تمت عملية التغيير', 'Status updated'), 'success');
      await refreshReviews();
    } catch (e: any) { showToast('Error', 'error'); }
  }, [isAdmin, refreshReviews, showToast, language]);

  const handleAdminDelete = useCallback(async (r: ReviewDoc) => {
    if (!isAdmin) return;
    if (!window.confirm(tr('حذف التقييم؟', 'Delete review?'))) return;
    try {
      await reviewsApi.remove((r as any).id);
      showToast(tt('deleted', 'تم الحذف', 'Deleted'), 'success');
      await refreshReviews();
    } catch (e: any) { showToast('Error', 'error'); }
  }, [isAdmin, refreshReviews, showToast, language]);

  const handleAdminReply = useCallback(async (r: ReviewDoc) => {
    if (!isAdmin || !viewer) return;
    try {
      const rid = String((r as any).id ?? '');
      const text = safeStr(replyDraft[rid] ?? '');
      await reviewsApi.setAdminReply(rid, text, viewer);
      showToast(tt('replySaved', 'تم حفظ الرد', 'Reply saved'), 'success');
      await refreshReviews();
    } catch (e: any) { showToast('Error', 'error'); }
  }, [isAdmin, viewer, replyDraft, refreshReviews, showToast, language]);

  const handleTopStarClick = (rating: number) => {
    if (!viewer?.id) {
      showToast(tt('loginToReview', 'سجّل دخول للتقييم', 'Login to review'), 'info');
      return;
    }
    setMyRating(rating);
    setActiveTab('reviews');
    setTimeout(() => scrollToTabs(), 50);
  };

  if (isLoading) return <ProductDetailSkeleton />;
  if (!product) return <div className="text-center py-20 font-bold text-slate-500">{tt('productNotFound', 'المنتج غير موجود', 'Product not found')}</div>;

  return (
    <div className="min-h-screen bg-white py-6 lg:py-12 relative">
      <SEO title={productTitle} description={product.description} image={heroImage} type="product" />

      {/* Notify Modal */}
      {showNotifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowNotifyModal(false)} />
          <div className="relative bg-white rounded-3xl p-8 w-full max-w-md animate-in zoom-in-95 shadow-2xl">
            <button onClick={() => setShowNotifyModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-red-500 transition-colors"><X /></button>
            <div className="w-14 h-14 bg-slate-100 text-slate-900 rounded-2xl flex items-center justify-center mb-5"><Bell size={28} /></div>
            <h3 className="text-2xl font-extrabold mb-2 text-slate-900">{tt('notifyMe', 'أعلمني عند التوفر', 'Notify Me')}</h3>
            <p className="text-slate-500 mb-6 text-sm leading-relaxed">{tt('notifyMeMsg', 'سجل بريدك وسنعلمك فور توفر المنتج.', 'Enter your email and we will notify you.')}</p>
            <form onSubmit={handleNotifySubmit}>
              <input type="email" required value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} placeholder="email@example.com" className="w-full px-4 py-3 rounded-xl border border-slate-200 mb-4 outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all" />
              <Button type="submit" className="w-full bg-slate-900 text-white hover:bg-yellow-400 hover:text-slate-900 font-extrabold py-3 rounded-xl transition-all">
                {tt('confirmSubscribe', 'تأكيد الاشتراك', 'Confirm')}
              </Button>
            </form>
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 lg:px-8 max-w-7xl">
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden mb-8 lg:mb-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:gap-4">
            {/* Gallery Section */}
            <div className="p-4 sm:p-6 lg:p-10 flex flex-col lg:flex-row gap-4">
              {allImages.length > 1 && (
                <div className="order-2 ltr:lg:order-1 rtl:lg:order-2 w-full lg:w-20">
                  <div className="flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto lg:max-h-[500px] scrollbar-hide pb-2 lg:pb-0">
                    {allImages.map((img, idx) => (
                      <button key={idx} onClick={() => setSelectedImage(img)} className={`shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-2xl overflow-hidden border-2 bg-white transition-all duration-300 ${selectedImage === img ? 'border-slate-800 shadow-md scale-95' : 'border-slate-100 hover:border-slate-300'}`}>
                        <LazyImage src={img} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="relative w-full order-1 ltr:lg:order-2 rtl:lg:order-1">
                <div className="relative group rounded-3xl overflow-hidden bg-white aspect-square flex items-center justify-center border border-slate-100">
                  <ProductImageZoom key={heroImage} src={heroImage} alt={productTitle} containerClassName="animate-in fade-in duration-500 w-full h-full object-contain mix-blend-multiply p-4" />
                  <button onClick={() => toggleWishlist(product)} className="absolute top-4 right-4 p-3 bg-white rounded-full shadow-sm text-slate-300 hover:text-red-500 border border-slate-100 transition-colors z-10">
                    <Heart size={22} className={isLiked ? 'text-red-500' : ''} fill={isLiked ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </div>
            </div>

            {/* Product Info Section */}
            <div className="p-6 lg:p-10 flex flex-col justify-center">
              <div className="flex items-center justify-between mb-4">
                <span className="bg-slate-100 text-slate-700 px-4 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-wider">{product.category}</span>
                <button onClick={handleShare} className="text-slate-400 hover:text-slate-900 transition-colors bg-white border border-slate-100 shadow-sm p-2 rounded-full"><Share2 size={16} /></button>
              </div>
              
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-slate-900 leading-tight">{productTitle}</h1>
              
              <div className="flex items-center gap-3 mt-4">
                <div className="flex text-yellow-400">
                  {[1, 2, 3, 4, 5].map(s => <Star key={s} size={18} fill={s <= Math.round(aggregate.avg) ? 'currentColor' : 'none'} onClick={() => handleTopStarClick(s)} className="cursor-pointer hover:scale-110 transition-transform" />)}
                </div>
                <span className="font-bold text-slate-500 hover:text-slate-900 cursor-pointer transition-colors" onClick={() => { setActiveTab('reviews'); setTimeout(() => scrollToTabs(), 50); }}>
                  ({aggregate.count} {tt('reviews', 'تقييمات', 'Reviews')})
                </span>
              </div>

              {/* Price and Cart Action */}
              <div className="mt-8">
                <div className="flex items-baseline gap-4 mb-6">
                  {/* السعر الآن بلون داكن فخم */}
                  <span className="text-4xl font-black text-slate-900">{formatMoneyJOD(product.price)}</span>
                  {product.originalPrice && <span className="text-lg font-bold text-slate-400 line-through">{formatMoneyJOD(product.originalPrice)}</span>}
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                  {/* عداد الكمية بحدود هادئة */}
                  <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-1.5 w-full sm:w-32 shadow-sm">
                    <button onClick={decQty} className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-all disabled:opacity-30" disabled={qty <= 1}><Minus size={18} /></button>
                    <input value={qty} onChange={onChangeQty} className="w-10 text-center font-black text-slate-900 outline-none bg-transparent" />
                    <button onClick={incQty} className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-all disabled:opacity-30" disabled={qty >= stock}><Plus size={18} /></button>
                  </div>
                  
                  {/* زر الإضافة للسلة بالتصميم الفخم الجديد */}
                  <Button 
                    onClick={() => isInStock ? addToCartWithQty(product, qty) : setShowNotifyModal(true)} 
                    className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl text-lg font-black transition-all duration-300 shadow-md ${
                      isInStock 
                        ? 'bg-slate-900 text-white hover:bg-yellow-400 hover:text-slate-900 border border-slate-900 hover:border-yellow-400' 
                        : 'bg-slate-200 text-slate-500 hover:bg-slate-300 border border-slate-200'
                    }`}
                  >
                    {isInStock ? <><ShoppingCart size={20} /> {tt('addToCart', 'أضف للسلة', 'Add to Cart')}</> : <><Bell size={20} /> {tt('notifyMe', 'أعلمني عند التوفر', 'Notify Me')}</>}
                  </Button>
                </div>
              </div>

              {/* قسم المميزات - تصميم ناعم واحترافي */}
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex items-center gap-3 p-4 bg-white border border-slate-100 rounded-2xl text-sm font-bold text-slate-700 hover:border-slate-200 transition-colors">
                  <Truck size={20} className="text-slate-400" /> {tt('fastDelivery', 'توصيل سريع', 'Fast Delivery')}
                </div>
                <div className="flex items-center gap-3 p-4 bg-white border border-slate-100 rounded-2xl text-sm font-bold text-slate-700 hover:border-slate-200 transition-colors">
                  <RefreshCw size={20} className="text-slate-400" /> {tt('freeReturn', 'إرجاع مجاني', 'Free Return')}
                </div>
                <div className="flex items-center gap-3 p-4 bg-white border border-slate-100 rounded-2xl text-sm font-bold text-slate-700 hover:border-slate-200 transition-colors">
                  <Check size={20} className="text-slate-400" /> {tt('securePayment', 'دفع آمن', 'Secure Payment')}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Section */}
        <div ref={tabsRef} className="bg-white rounded-3xl p-6 lg:p-10 border border-slate-100 shadow-sm mb-12 scroll-mt-24">
          <div className="flex gap-8 border-b border-slate-100 mb-8 overflow-x-auto scrollbar-hide">
            <button 
              onClick={() => setActiveTab('desc')} 
              className={`pb-4 font-extrabold text-lg relative transition-all whitespace-nowrap px-2 ${activeTab === 'desc' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {tt('descAndDetails', 'الوصف والتفاصيل', 'Description & Details')}
              {activeTab === 'desc' && <div className="absolute bottom-0 left-0 w-full h-1 bg-yellow-400 rounded-t-full" />}
            </button>
            <button 
              onClick={() => setActiveTab('reviews')} 
              className={`pb-4 font-extrabold text-lg relative transition-all whitespace-nowrap px-2 ${activeTab === 'reviews' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {tt('reviews', 'التقييمات', 'Reviews')} ({aggregate.count})
              {activeTab === 'reviews' && <div className="absolute bottom-0 left-0 w-full h-1 bg-yellow-400 rounded-t-full" />}
            </button>
          </div>

          <div className="min-h-[250px] animate-in fade-in duration-500">
            {activeTab === 'desc' ? (
              <div className="max-w-4xl">{renderRichText(product.description)}</div>
            ) : (
              <div className="space-y-8 max-w-4xl">
                {/* Review Form */}
                {viewer?.id && canReview && (
                  <div ref={reviewFormRef} className="bg-slate-50 p-6 md:p-8 rounded-3xl border border-slate-100">
                    <h3 className="text-xl font-extrabold mb-4 text-slate-900">{tt('addReview', 'أضف تقييمك', 'Add Review')}</h3>
                    <div className="flex gap-2 mb-5 bg-white inline-flex p-3 rounded-2xl shadow-sm border border-slate-100">
                      {[1, 2, 3, 4, 5].map(s => <Star key={s} size={28} onClick={() => setMyRating(s)} className={`cursor-pointer transition-all hover:scale-110 ${s <= myRating ? 'text-yellow-400 fill-yellow-400 drop-shadow-sm' : 'text-slate-200'}`} />)}
                    </div>
                    <textarea 
                      value={myComment} 
                      onChange={(e) => setMyComment(e.target.value)} 
                      placeholder={tt('reviewPlaceholder', 'اكتب رأيك بصراحة عن المنتج هنا...', 'Write your review...')} 
                      className="w-full min-h-[120px] p-5 rounded-2xl border border-slate-200 outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent resize-none text-[15px]" 
                    />
                    <div className="mt-4 flex justify-end">
                      <Button onClick={handleSubmitReview} className="px-10 py-3 bg-slate-900 text-white hover:bg-yellow-400 hover:text-slate-900 font-extrabold rounded-xl transition-all">
                        {tt('saveReview', 'حفظ التقييم', 'Save Review')}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Reviews List */}
                <div className="space-y-6 mt-8">
                  {publishedReviews.length === 0 ? (
                    <div className="text-center py-16 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                      <MessageSquare className="mx-auto text-slate-300 mb-3" size={40} />
                      <div className="text-slate-500 font-bold">{tt('noReviews', 'لا توجد تقييمات بعد، كن أول من يقيّم المنتج!', 'No reviews yet.')}</div>
                    </div>
                  ) : (
                    publishedReviews.map((r: any, idx) => (
                      <div key={idx} className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-slate-100 text-slate-700 rounded-full flex items-center justify-center font-black text-lg uppercase">
                              {r.userName.charAt(0)}
                            </div>
                            <div>
                              <div className="font-extrabold text-slate-900">{r.userName}</div>
                              <div className="flex text-yellow-400 my-1">
                                {[1, 2, 3, 4, 5].map(s => <Star key={s} size={14} fill={s <= r.rating ? 'currentColor' : 'none'} className={s <= r.rating ? '' : 'text-slate-200'} />)}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">{formatDate(r)}</span>
                            {isAdmin && (
                              <div className="flex gap-1 bg-slate-50 p-1 rounded-xl">
                                <button onClick={() => handleAdminToggleStatus(r)} className={`p-1.5 rounded-lg transition-colors ${r.status === 'hidden' ? 'bg-slate-200 text-slate-600' : 'hover:bg-slate-200 text-slate-900'}`} title="إخفاء/إظهار">
                                  {r.status === 'hidden' ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                                <button onClick={() => handleAdminDelete(r)} className="p-1.5 hover:bg-red-100 text-red-500 rounded-lg transition-colors"><Trash2 size={16} /></button>
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="text-slate-700 text-[15px] leading-relaxed mt-2 pl-14 rtl:pl-0 rtl:pr-14">{r.comment}</p>
                        
                        {r.adminReply?.text && (
                           <div className="mt-4 ml-10 rtl:ml-0 rtl:mr-10 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                             <div className="text-xs font-black text-slate-800 mb-1 flex items-center gap-1"><Shield size={12}/> {tt('adminReply', 'رد الإدارة:', 'Admin Reply:')}</div>
                             <p className="text-slate-700 text-sm">{r.adminReply.text}</p>
                           </div>
                        )}

                        {isAdmin && (
                          <div className="mt-5 ml-10 rtl:ml-0 rtl:mr-10 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                            <textarea 
                              value={replyDraft[r.id] ?? ''} 
                              onChange={(e) => setReplyDraft({...replyDraft, [r.id]: e.target.value})} 
                              placeholder="أضف أو عدل رد الإدارة هنا..." 
                              className="w-full p-3 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900 resize-none min-h-[80px]" 
                            />
                            <div className="flex justify-end mt-2">
                              <Button size="sm" onClick={() => handleAdminReply(r)} className="bg-slate-900 text-white hover:bg-yellow-400 hover:text-slate-900 rounded-lg px-6">
                                حفظ الرد
                              </Button>
                            </div>
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

        {/* Similar Products */}
        {relatedProducts.length > 0 && (
          <div className="mb-12">
            <h2 className="text-2xl font-black mb-6 text-slate-900 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-yellow-400 rounded-full inline-block"></span>
              {tt('similarProducts', 'منتجات مشابهة', 'Similar Products')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {relatedProducts.map(p => <ProductCard key={p.id} product={p} onAddToCart={addToCart} onToggleWishlist={toggleWishlist} onQuickView={openQuickView} isLiked={wishlist.has(p.id)} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductDetails;