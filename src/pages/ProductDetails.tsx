// src/pages/ProductDetails.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  Star,
  ShoppingCart,
  Heart,
  Share2,
  Check,
  AlertCircle,
  Truck,
  RefreshCw,
  Bell,
  X,
  ThumbsUp,
  Trash2,
  EyeOff,
  Eye,
  MessageSquare,
  Save,
  Minus,
  Plus,
  ZoomIn,
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
    <div className="space-y-3">
      {blocks.map((b, idx) => {
        if (b.type === 'ul') {
          return (
            <ul key={idx} className="list-disc list-inside space-y-2 text-slate-700 leading-relaxed marker:text-secondary-DEFAULT">
              {b.items.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
          );
        }
        return <p key={idx} className="text-slate-700 leading-relaxed">{b.value}</p>;
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
      showToast(language === 'ar' ? 'حدث خطأ في التقييمات' : 'Reviews error', 'error');
    } finally {
      setReviewsLoading(false);
    }
  }, [id, viewer, isAdmin, showToast, language]);

  useEffect(() => { refreshReviews(); }, [refreshReviews]);

  useEffect(() => {
    const run = async () => {
      if (!product?.id || !viewer?.id) return;
      setCanReviewLoading(true);
      try {
        const ok = await db.orders.hasPurchasedProduct(viewer.id, product.id, ['processing', 'shipped', 'delivered']);
        setCanReview(ok);
      } catch { setCanReview(false); } finally { setCanReviewLoading(false); }
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
          showToast(language === 'ar' ? 'تمت الإضافة للسلة' : 'Added to cart', 'success');
          return;
        }
      } catch { }
      for (let i = 0; i < safeQ; i += 1) addToCart(p);
      showToast(language === 'ar' ? 'تمت الإضافة للسلة' : 'Added to cart', 'success');
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
      showToast(language === 'ar' ? 'تم تسجيل التنبيه بنجاح' : 'Notification saved', 'success');
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
        showToast(language === 'ar' ? 'تم نسخ رابط المنتج' : 'Link copied', 'success');
        return;
      }
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      showToast(language === 'ar' ? 'تم نسخ رابط المنتج' : 'Link copied', 'success');
    } catch {
      showToast(language === 'ar' ? 'فشل نسخ الرابط' : 'Failed to copy link', 'error');
    }
  }, [showToast, language]);

  // ------------ Reviews handlers ------------
  const handleSubmitReview = useCallback(async () => {
    if (!product || !viewer?.id) return;
    if (!canReview) {
      showToast(language === 'ar' ? 'لا يمكنك تقييم هذا المنتج إلا بعد شرائه' : 'You can review only after purchase', 'error');
      return;
    }
    const c = safeStr(myComment);
    if (c.length < 3) {
      showToast(language === 'ar' ? 'اكتب تعليق واضح (على الأقل 3 أحرف)' : 'Write a clearer comment', 'error');
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
      showToast(language === 'ar' ? 'تم نشر تقييمك بنجاح' : 'Review posted', 'success');
      await refreshReviews();
      setActiveTab('reviews');
    } catch (e: any) {
      showToast(language === 'ar' ? 'فشل حفظ التقييم' : 'Failed to save review', 'error');
    }
  }, [product, viewer, canReview, myComment, myRating, refreshReviews, showToast, language]);

  const handleToggleLike = useCallback(async (r: ReviewDoc) => {
    if (!viewer?.id) {
      showToast(language === 'ar' ? 'سجّل دخول أولاً' : 'Please login first', 'info');
      return;
    }
    try {
      await reviewsApi.toggleLike((r as any).id, viewer.id);
      await refreshReviews();
    } catch (e: any) { console.error(e); }
  }, [viewer?.id, refreshReviews, showToast, language]);

  const handleAdminToggleStatus = useCallback(async (r: ReviewDoc) => {
    if (!isAdmin) return;
    try {
      const current = ((r as any).status || 'published') as 'published' | 'hidden';
      const next = current === 'published' ? 'hidden' : 'published';
      await reviewsApi.setStatus((r as any).id, next);
      showToast(language === 'ar' ? 'تمت عملية التغيير' : 'Status updated', 'success');
      await refreshReviews();
    } catch (e: any) { showToast('Error', 'error'); }
  }, [isAdmin, refreshReviews, showToast, language]);

  const handleAdminDelete = useCallback(async (r: ReviewDoc) => {
    if (!isAdmin) return;
    if (!window.confirm(language === 'ar' ? 'حذف التقييم؟' : 'Delete review?')) return;
    try {
      await reviewsApi.remove((r as any).id);
      showToast(language === 'ar' ? 'تم الحذف' : 'Deleted', 'success');
      await refreshReviews();
    } catch (e: any) { showToast('Error', 'error'); }
  }, [isAdmin, refreshReviews, showToast, language]);

  const handleAdminReply = useCallback(async (r: ReviewDoc) => {
    if (!isAdmin || !viewer) return;
    try {
      const rid = String((r as any).id ?? '');
      const text = safeStr(replyDraft[rid] ?? '');
      await reviewsApi.setAdminReply(rid, text, viewer);
      showToast(language === 'ar' ? 'تم حفظ الرد' : 'Reply saved', 'success');
      await refreshReviews();
    } catch (e: any) { showToast('Error', 'error'); }
  }, [isAdmin, viewer, replyDraft, refreshReviews, showToast, language]);

  const handleTopStarClick = (rating: number) => {
    if (!viewer?.id) {
      showToast(language === 'ar' ? 'سجّل دخول للتقييم' : 'Login to review', 'info');
      return;
    }
    setMyRating(rating);
    setActiveTab('reviews');
    setTimeout(() => scrollToTabs(), 50);
  };

  if (isLoading) return <ProductDetailSkeleton />;
  if (!product) return <div className="text-center py-20">{language === 'ar' ? 'المنتج غير موجود' : 'Product not found'}</div>;

  return (
    <div className="min-h-screen bg-slate-50 py-8 lg:py-12 relative">
      <SEO title={productTitle} description={product.description} image={heroImage} type="product" />

      {showNotifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowNotifyModal(false)} />
          <div className="relative bg-white rounded-3xl p-8 w-full max-w-md animate-in zoom-in-95">
            <button onClick={() => setShowNotifyModal(false)} className="absolute top-4 right-4 text-slate-400"><X /></button>
            <div className="w-12 h-12 bg-secondary-light/20 text-secondary-DEFAULT rounded-2xl flex items-center justify-center mb-4"><Bell /></div>
            <h3 className="text-2xl font-bold mb-2">{t('notifyMe')}</h3>
            <p className="text-slate-500 mb-6 text-sm">{t('notifyMeMsg')}</p>
            <form onSubmit={handleNotifySubmit}>
              <input type="email" required value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} placeholder="email@example.com" className="w-full px-4 py-3 rounded-xl border mb-4 outline-none focus:ring-2 focus:ring-secondary-DEFAULT" />
              <Button type="submit" className="w-full">{t('confirmSubscribe')}</Button>
            </form>
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 lg:px-8">
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden mb-8 lg:mb-12">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Gallery */}
            <div className="bg-slate-50 p-4 md:p-8">
              <div className="flex flex-col lg:flex-row gap-4">
                {allImages.length > 1 && (
                  <div className="order-2 ltr:lg:order-1 rtl:lg:order-2 w-full lg:w-24">
                    <div className="flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto lg:max-h-[500px] scrollbar-hide">
                      {allImages.map((img, idx) => (
                        <button key={idx} onClick={() => setSelectedImage(img)} className={`shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-2xl overflow-hidden border-2 bg-white transition-all ${selectedImage === img ? 'border-secondary-DEFAULT shadow-md' : 'border-transparent'}`}>
                          <LazyImage src={img} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="relative w-full order-1 ltr:lg:order-2 rtl:lg:order-1">
                  <div className="relative group rounded-3xl overflow-hidden bg-white shadow-inner">
                    <ProductImageZoom key={heroImage} src={heroImage} alt={productTitle} containerClassName="animate-in fade-in duration-500" />
                    <button onClick={() => toggleWishlist(product)} className="absolute top-4 right-4 p-3 bg-white rounded-full shadow-md text-slate-400">
                      <Heart size={20} className={isLiked ? 'text-red-500' : ''} fill={isLiked ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Product Info */}
            <div className="p-6 lg:p-12 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <span className="bg-secondary-light/10 text-secondary-DEFAULT px-3 py-1 rounded-full text-xs font-bold uppercase">{product.category}</span>
                <button onClick={handleShare} className="text-slate-400 hover:text-secondary-DEFAULT"><Share2 size={20} /></button>
              </div>
              <h1 className="text-2xl lg:text-4xl font-extrabold text-slate-900 leading-tight">{productTitle}</h1>
              <div className="flex items-center gap-3 mt-4">
                <div className="flex text-yellow-400">
                  {[1, 2, 3, 4, 5].map(s => <Star key={s} size={18} fill={s <= Math.round(aggregate.avg) ? 'currentColor' : 'none'} onClick={() => handleTopStarClick(s)} className="cursor-pointer" />)}
                </div>
                <span className="font-bold text-slate-700 underline cursor-pointer" onClick={() => { setActiveTab('reviews'); setTimeout(() => scrollToTabs(), 50); }}>{aggregate.count} {t('reviews')}</span>
              </div>

              <div className="mt-8 p-6 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="flex items-baseline gap-4 mb-6">
                  <span className="text-4xl font-black text-slate-900">{formatMoneyJOD(product.price)}</span>
                  {product.originalPrice && <span className="text-lg text-slate-400 line-through">{formatMoneyJOD(product.originalPrice)}</span>}
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex items-center gap-1 bg-white border rounded-xl p-1">
                    <button onClick={decQty} className="p-2 hover:bg-slate-50 disabled:opacity-30" disabled={qty <= 1}><Minus size={18} /></button>
                    <input value={qty} onChange={onChangeQty} className="w-12 text-center font-bold outline-none" />
                    <button onClick={incQty} className="p-2 hover:bg-slate-50 disabled:opacity-30" disabled={qty >= stock}><Plus size={18} /></button>
                  </div>
                  <Button onClick={() => isInStock ? addToCartWithQty(product, qty) : setShowNotifyModal(true)} variant={isInStock ? 'primary' : 'secondary'} className="flex-1 shadow-lg shadow-secondary-light/30">
                    {isInStock ? <><ShoppingCart className="me-2" /> {t('addToCart')}</> : <><Bell className="me-2" /> {t('notifyMe')}</>}
                  </Button>
                </div>
              </div>

              <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex items-center gap-3 p-3 bg-white border rounded-2xl text-sm font-bold text-slate-600">
                  <Truck className="text-secondary-DEFAULT" /> {t('fastDelivery')}
                </div>
                <div className="flex items-center gap-3 p-3 bg-white border rounded-2xl text-sm font-bold text-slate-600">
                  <RefreshCw className="text-secondary-DEFAULT" /> {t('freeReturn')}
                </div>
                <div className="flex items-center gap-3 p-3 bg-white border rounded-2xl text-sm font-bold text-slate-600">
                  <Check className="text-secondary-DEFAULT" /> {t('securePayment')}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div ref={tabsRef} className="bg-white rounded-3xl p-6 lg:p-10 border shadow-sm mb-12 scroll-mt-24">
          <div className="flex gap-8 border-b mb-8 overflow-x-auto scrollbar-hide">
            <button onClick={() => setActiveTab('desc')} className={`pb-4 font-bold relative transition-colors ${activeTab === 'desc' ? 'text-secondary-DEFAULT' : 'text-slate-400 hover:text-slate-600'}`}>
              {t('descAndDetails')}
              {activeTab === 'desc' && <div className="absolute bottom-0 w-full h-1 bg-secondary-DEFAULT rounded-full" />}
            </button>
            <button onClick={() => setActiveTab('reviews')} className={`pb-4 font-bold relative transition-colors ${activeTab === 'reviews' ? 'text-secondary-DEFAULT' : 'text-slate-400 hover:text-slate-600'}`}>
              {t('reviews')} ({aggregate.count})
              {activeTab === 'reviews' && <div className="absolute bottom-0 w-full h-1 bg-secondary-DEFAULT rounded-full" />}
            </button>
          </div>

          <div className="min-h-[300px] animate-in fade-in duration-500">
            {activeTab === 'desc' ? (
              <div className="max-w-none">{renderRichText(product.description)}</div>
            ) : (
              <div className="space-y-8">
                {/* Review Form */}
                {viewer?.id && canReview && (
                  <div ref={reviewFormRef} className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                    <h3 className="text-xl font-bold mb-4">{language === 'ar' ? 'أضف تقييمك' : 'Write a review'}</h3>
                    <div className="flex gap-2 mb-4">
                      {[1, 2, 3, 4, 5].map(s => <Star key={s} size={24} onClick={() => setMyRating(s)} className={`cursor-pointer transition-colors ${s <= myRating ? 'text-yellow-400 fill-yellow-400' : 'text-slate-300'}`} />)}
                    </div>
                    <textarea value={myComment} onChange={(e) => setMyComment(e.target.value)} placeholder={language === 'ar' ? 'اكتب رأيك هنا...' : 'Your feedback...'} className="w-full min-h-[120px] p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-secondary-DEFAULT/20" />
                    <Button onClick={handleSubmitReview} className="mt-4 px-8">{t('saveReview') || 'Save'}</Button>
                  </div>
                )}

                {/* Reviews List */}
                <div className="space-y-6">
                  {publishedReviews.length === 0 ? (
                    <div className="text-center py-10 text-slate-400">{language === 'ar' ? 'لا توجد تقييمات بعد' : 'No reviews yet'}</div>
                  ) : (
                    publishedReviews.map((r: any, idx) => (
                      <div key={idx} className="bg-white border-b pb-6 last:border-0">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="font-extrabold text-slate-900">{r.userName}</div>
                            <div className="flex text-yellow-400 my-1">
                              {[1, 2, 3, 4, 5].map(s => <Star key={s} size={14} fill={s <= r.rating ? 'currentColor' : 'none'} className={s <= r.rating ? '' : 'text-slate-200'} />)}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-400">{formatDate(r)}</span>
                            {isAdmin && (
                              <div className="flex gap-1">
                                <button onClick={() => handleAdminToggleStatus(r)} className="p-1.5 hover:bg-slate-100 rounded-lg">{r.status === 'hidden' ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                                <button onClick={() => handleAdminDelete(r)} className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={14} /></button>
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="text-slate-700 text-sm leading-relaxed">{r.comment}</p>
                        {isAdmin && (
                          <div className="mt-4">
                            <textarea value={replyDraft[r.id] ?? ''} onChange={(e) => setReplyDraft({...replyDraft, [r.id]: e.target.value})} placeholder="رد الأدمن..." className="w-full p-3 text-xs bg-slate-50 border rounded-xl outline-none" />
                            <Button size="sm" onClick={() => handleAdminReply(r)} className="mt-2 text-xs">حفظ الرد</Button>
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
        <div className="mb-12">
          <h2 className="text-2xl font-bold mb-6 text-slate-900">{t('similarProducts')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {relatedProducts.map(p => <ProductCard key={p.id} product={p} onAddToCart={addToCart} onToggleWishlist={toggleWishlist} onQuickView={openQuickView} isLiked={wishlist.has(p.id)} />)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetails;