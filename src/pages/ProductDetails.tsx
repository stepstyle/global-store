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
    } catch {
      // ignore
    }
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

/**
 * ✅ Safe rich text formatter (NO dangerous HTML)
 * - supports new lines
 * - supports bullets: -, *, •
 */
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
    if (!line) {
      pushListIfAny();
      continue;
    }

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
            <ul key={idx} className="list-disc list-inside space-y-2 text-slate-700 leading-relaxed">
              {b.items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={idx} className="text-slate-700 leading-relaxed">
            {b.value}
          </p>
        );
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
    language,
  } = useCart();

  const viewer = user as unknown as AppUser | null;
  const isAdmin = viewer?.role === 'admin';

  const [product, setProduct] = useState<Product | null>(null);
  const [activeTab, setActiveTab] = useState<'desc' | 'reviews'>('desc');

  // Quantity
  const [qty, setQty] = useState<number>(1);

  // Notify Modal State
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [isNotified, setIsNotified] = useState(false);

  // Gallery
  const [selectedImage, setSelectedImage] = useState<string>('');

  // Reviews
  const [reviews, setReviews] = useState<ReviewDoc[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  // Purchase Gate
  const [canReview, setCanReview] = useState<boolean>(false);
  const [canReviewLoading, setCanReviewLoading] = useState<boolean>(false);

  // My review (edit mode)
  const [myReviewId, setMyReviewId] = useState<string | null>(null);
  const [myRating, setMyRating] = useState<number>(5);
  const [myComment, setMyComment] = useState<string>('');

  // Admin reply drafts (per review id)
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});

  // Refs for smooth scrolling
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const reviewFormRef = useRef<HTMLDivElement | null>(null);

  const scrollToTabs = useCallback(() => {
    tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const productTitle = useMemo(() => (product ? getProductTitle(product) : ''), [product, getProductTitle]);

  // Sync tab with URL (?tab=reviews)
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const tab = sp.get('tab');
    if (tab === 'reviews') {
      setActiveTab('reviews');
      setTimeout(() => scrollToTabs(), 50);
    }
  }, [location.search, scrollToTabs]);

  // Load product
  useEffect(() => {
    const found = products.find((p) => p.id === id);
    setProduct(found || null);

    window.scrollTo(0, 0);

    // reset notify modal state on product change
    setIsNotified(false);
    setShowNotifyModal(false);
    setNotifyEmail('');

    // reset qty when product changes
    setQty(1);
  }, [id, products]);

  const stock = useMemo(() => Math.max(0, Number(product?.stock ?? 0)), [product?.stock]);
  const isInStock = stock > 0;

  // keep qty valid when stock changes
  useEffect(() => {
    const max = stock > 0 ? stock : 1;
    setQty((q) => clampInt(q, 1, max));
  }, [stock, product?.id]);

  // Images
  const allImages = useMemo(() => normalizeImages(product), [product]);

  useEffect(() => {
    const first = allImages[0] || '';
    setSelectedImage(first);
  }, [product?.id, allImages]);

  const heroImage = selectedImage || allImages[0] || '';

  // Fetch reviews
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
          const existing = safeStr((r as any).adminReply?.text ?? '');
          initial[rid] = existing;
        }
        setReplyDraft(initial);
      } else {
        setReplyDraft({});
      }

      if (viewer?.id) {
        const mine = await reviewsApi.getMyReview(id, viewer.id);
        if (mine) {
          setMyReviewId(mine.id);
          setMyRating(Number((mine as any).rating || 5));
          setMyComment(String((mine as any).comment || ''));
        } else {
          setMyReviewId(null);
          setMyRating(5);
          setMyComment('');
        }
      } else {
        setMyReviewId(null);
        setMyRating(5);
        setMyComment('');
      }
    } catch (e: any) {
      showToast(e?.message || (language === 'ar' ? 'حدث خطأ أثناء تحميل التقييمات' : 'Failed to load reviews'), 'error');
    } finally {
      setReviewsLoading(false);
    }
  }, [id, viewer, isAdmin, showToast, language]);

  useEffect(() => {
    refreshReviews();
  }, [refreshReviews]);

  // Check purchase gate for review
  useEffect(() => {
    const run = async () => {
      if (!product?.id) return;

      if (!viewer?.id) {
        setCanReview(false);
        return;
      }

      setCanReviewLoading(true);
      try {
        const ok = await db.orders.hasPurchasedProduct(viewer.id, product.id, ['processing', 'shipped', 'delivered']);
        setCanReview(ok);
      } catch {
        setCanReview(false);
      } finally {
        setCanReviewLoading(false);
      }
    };

    run();
  }, [viewer?.id, product?.id]);

  const publishedReviews = useMemo(() => {
    if (isAdmin) return reviews;
    return reviews.filter((r) => ((r as any).status || 'published') === 'published');
  }, [reviews, isAdmin]);

  const aggregate = useMemo(() => {
    return {
      avg: avgRating(publishedReviews),
      count: publishedReviews.length,
    };
  }, [publishedReviews]);

  const isLiked = useMemo(() => (product ? wishlist.has(product.id) : false), [wishlist, product]);

  const relatedProducts = useMemo(() => {
    if (!product) return [];
    return products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4);
  }, [products, product]);

  const keywords = useMemo(() => {
    if (!product) return '';
    return [product.category, (product as any).brand, product.name, product.nameEn].filter(Boolean).join(', ');
  }, [product]);

  // SEO Schema
  const productSchema = useMemo(() => {
    if (!product) return undefined;

    return {
      '@context': 'https://schema.org/',
      '@type': 'Product',
      name: product.nameEn || product.name,
      image: allImages.length > 0 ? allImages : undefined,
      description: product.description,
      sku: product.id,
      brand: {
        '@type': 'Brand',
        name: (product as any).brand || 'مكتبة دير شرف العلمية',
      },
      offers: {
        '@type': 'Offer',
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        priceCurrency: 'JOD',
        price: Number(product.price || 0),
        priceValidUntil: '2026-12-31',
        itemCondition: 'https://schema.org/NewCondition',
        availability: (product.stock ?? 0) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: aggregate.avg || 0,
        reviewCount: aggregate.count || 0,
      },
    };
  }, [product, allImages, aggregate.avg, aggregate.count]);

  const descRaw = safeStr(product?.description);
  const descPreview = useMemo(() => {
    const d = descRaw;
    if (!d) return '';
    return d.length > 220 ? `${d.slice(0, 220)}…` : d;
  }, [descRaw]);

  // add with quantity
  const addToCartWithQty = useCallback(
    (p: Product, q: number) => {
      const st = Math.max(0, Number((p as any)?.stock ?? 0));
      if (st <= 0) return;

      const safeQ = clampInt(q, 1, st);

      const fnAny = addToCart as any;
      try {
        if (typeof fnAny === 'function' && fnAny.length >= 2) {
          fnAny(p, safeQ);
          return;
        }
      } catch {
        // fallback below
      }

      for (let i = 0; i < safeQ; i += 1) addToCart(p);
    },
    [addToCart]
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
      if (raw === '') {
        setQty(1);
        return;
      }
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

      setTimeout(() => {
        setShowNotifyModal(false);
        setNotifyEmail('');
      }, 1200);
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
    if (!product) return;

    if (!viewer?.id) {
      showToast(language === 'ar' ? 'لازم تسجل دخول قبل ما تكتب تقييم' : 'Please login to post a review', 'error');
      return;
    }

    if (!canReview) {
      showToast(language === 'ar' ? 'لا يمكنك تقييم هذا المنتج إلا بعد شرائه' : 'You can review only after purchase', 'error');
      return;
    }

    const c = safeStr(myComment);
    if (!c || c.length < 3) {
      showToast(language === 'ar' ? 'اكتب تعليق واضح (على الأقل 3 أحرف)' : 'Write a clearer comment (min 3 chars)', 'error');
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

      showToast(
        myReviewId ? (language === 'ar' ? 'تم تعديل تقييمك' : 'Review updated') : (language === 'ar' ? 'تم نشر تقييمك' : 'Review posted'),
        'success'
      );

      await refreshReviews();

      setActiveTab('reviews');
      setTimeout(() => reviewFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e: any) {
      showToast(e?.message || (language === 'ar' ? 'فشل حفظ التقييم' : 'Failed to save review'), 'error');
    }
  }, [product, viewer?.id, viewer?.name, viewer?.email, canReview, myComment, myRating, myReviewId, refreshReviews, showToast, language]);

  const handleToggleLike = useCallback(
    async (r: ReviewDoc) => {
      if (!viewer?.id) {
        showToast(language === 'ar' ? 'سجّل دخول عشان تقدر تعمل إعجاب' : 'Please login to like', 'info');
        return;
      }
      try {
        await reviewsApi.toggleLike((r as any).id, viewer.id);
        await refreshReviews();
      } catch (e: any) {
        showToast(e?.message || (language === 'ar' ? 'فشل الإعجاب' : 'Failed to like'), 'error');
      }
    },
    [viewer?.id, refreshReviews, showToast, language]
  );

  const handleAdminToggleStatus = useCallback(
    async (r: ReviewDoc) => {
      if (!isAdmin) return;
      try {
        const current = ((r as any).status || 'published') as 'published' | 'hidden';
        const next = current === 'published' ? 'hidden' : 'published';
        await reviewsApi.setStatus((r as any).id, next);

        showToast(
          next === 'hidden' ? (language === 'ar' ? 'تم إخفاء التقييم' : 'Review hidden') : (language === 'ar' ? 'تم نشر التقييم' : 'Review published'),
          'success'
        );
        await refreshReviews();
      } catch (e: any) {
        showToast(e?.message || (language === 'ar' ? 'فشل تغيير الحالة' : 'Failed to change status'), 'error');
      }
    },
    [isAdmin, refreshReviews, showToast, language]
  );

  const handleAdminDelete = useCallback(
    async (r: ReviewDoc) => {
      if (!isAdmin) return;
      const ok = window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف هذا التقييم؟' : 'Delete this review?');
      if (!ok) return;

      try {
        await reviewsApi.remove((r as any).id);
        showToast(language === 'ar' ? 'تم حذف التقييم' : 'Review deleted', 'success');
        await refreshReviews();
      } catch (e: any) {
        showToast(e?.message || (language === 'ar' ? 'فشل حذف التقييم' : 'Failed to delete review'), 'error');
      }
    },
    [isAdmin, refreshReviews, showToast, language]
  );

  const handleAdminReply = useCallback(
    async (r: ReviewDoc) => {
      if (!isAdmin || !viewer) return;

      try {
        const rid = String((r as any).id ?? '');
        const text = safeStr(replyDraft[rid] ?? '');

        await reviewsApi.setAdminReply(rid, text, viewer);

        showToast(text ? (language === 'ar' ? 'تم حفظ الرد' : 'Reply saved') : (language === 'ar' ? 'تم حذف الرد' : 'Reply removed'), 'success');
        await refreshReviews();
      } catch (e: any) {
        showToast(e?.message || (language === 'ar' ? 'فشل حفظ الرد' : 'Failed to save reply'), 'error');
      }
    },
    [isAdmin, viewer, replyDraft, refreshReviews, showToast, language]
  );

  const handleTopStarClick = useCallback(
    (rating: number) => {
      if (!viewer?.id) {
        showToast(language === 'ar' ? 'لازم تسجل دخول أولاً حتى تقيّم' : 'Login first to review', 'info');
        setActiveTab('reviews');
        setTimeout(() => scrollToTabs(), 50);
        return;
      }
      if (canReviewLoading) {
        showToast(language === 'ar' ? 'جاري التحقق من إمكانية التقييم…' : 'Checking eligibility…', 'info');
        return;
      }
      if (!canReview) {
        showToast(language === 'ar' ? 'لا يمكنك تقييم هذا المنتج إلا بعد شرائه' : 'You can review only after purchase', 'error');
        setActiveTab('reviews');
        setTimeout(() => scrollToTabs(), 50);
        return;
      }

      setMyRating(rating);
      setActiveTab('reviews');
      setTimeout(() => reviewFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    },
    [viewer?.id, canReviewLoading, canReview, showToast, scrollToTabs, language]
  );

  // ---------------- UI states ----------------
  if (isLoading || (!product && products.length === 0)) {
    return <ProductDetailSkeleton />;
  }

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        {language === 'ar' ? 'المنتج غير موجود.' : 'Product not found.'}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 lg:py-12 relative">
      <SEO
        title={productTitle}
        description={product.description}
        image={heroImage}
        type="product"
        schema={productSchema}
        keywords={keywords}
        price={product.price}
        currency="JOD"
      />

      {/* Notify Modal */}
      {showNotifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowNotifyModal(false)} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowNotifyModal(false)}
              className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-red-500"
              type="button"
              aria-label="close"
            >
              <X size={20} />
            </button>

            {!isNotified ? (
              <>
                <div className="w-12 h-12 bg-secondary-light/20 text-secondary-DEFAULT rounded-2xl flex items-center justify-center mb-4">
                  <Bell size={24} />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 mb-2">{t('notifyMeDesc')}</h3>
                <p className="text-slate-500 mb-6 text-sm leading-relaxed">{t('notifyMeMsg')}</p>

                <form onSubmit={handleNotifySubmit}>
                  <div className="mb-4">
                    <label className="block text-sm font-bold text-slate-700 mb-1">{t('emailPlaceholder')}</label>
                    <input
                      type="email"
                      required
                      value={notifyEmail}
                      onChange={(e) => setNotifyEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-secondary-DEFAULT outline-none transition-shadow bg-slate-50 focus:bg-white"
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    {t('confirmSubscribe')}
                  </Button>
                </form>
              </>
            ) : (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-in zoom-in duration-300">
                  <Check size={32} />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">{t('subscribedSuccess')}</h3>
                <p className="text-slate-500 text-sm">
                  {t('subscribedMsg')} <span className="font-bold">{notifyEmail}</span>.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 lg:px-8">
        {/* Main Details */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden mb-8 lg:mb-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
            {/* Image Gallery */}
            <div className="bg-slate-50 p-4 md:p-8">
              {/* ✅ Layout جديد: موبايل (الصورة ثم thumbnails تحت) / ديسكتوب (thumbnails يمين الصورة) */}
              <div className="flex flex-col lg:flex-row gap-4 items-start">
                {/* ✅ Thumbnails */}
                {allImages.length > 1 ? (
                  <div
                    className={[
                      // ✅ موبايل: تحت الصورة
                      'order-2',
                      // ✅ لُغات: ديسكتوب
                      'ltr:lg:order-2 rtl:lg:order-1',
                      'w-full lg:w-24',
                    ].join(' ')}
                  >
                    <div className="text-xs text-slate-500 mb-2">{language === 'ar' ? 'صور المنتج' : 'Product images'}</div>

                    <div
                      className={[
                        // mobile row scroll
                        'flex gap-2 overflow-x-auto pb-2 scrollbar-hide',
                        // desktop column scroll
                        'lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pb-0',
                        // limit height to match main image area
                        'lg:max-h-[560px]',
                      ].join(' ')}
                    >
                      {allImages.slice(0, 12).map((img, idx) => {
                        const isActive = (selectedImage || allImages[0]) === img;
                        return (
                          <button
                            key={`${img}-${idx}`}
                            type="button"
                            onClick={() => {
                              const clean = safeStr(img);
                              if (clean) setSelectedImage(clean);
                            }}
                            className={[
                              'shrink-0 rounded-2xl overflow-hidden border transition-colors bg-white',
                              // mobile size
                              'w-16 h-16',
                              // desktop size a bit bigger
                              'lg:w-20 lg:h-20',
                              isActive ? 'border-secondary-DEFAULT ring-2 ring-secondary-light/30' : 'border-slate-200 hover:border-slate-300',
                            ].join(' ')}
                            aria-label={language === 'ar' ? `اختر صورة رقم ${idx + 1}` : `Select image ${idx + 1}`}
                            title={language === 'ar' ? `صورة ${idx + 1}` : `Image ${idx + 1}`}
                          >
                            <LazyImage
                              src={img}
                              alt=""
                              containerClassName="w-full h-full"
                              className="w-full h-full object-cover"
                              cloudinarySize={160}
                              loading="lazy"
                              decoding="async"
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* ✅ Main Image */}
                <div className={['relative w-full', 'order-1', 'ltr:lg:order-1 rtl:lg:order-2'].join(' ')}>
                  <div className="relative">
                    {/* ✅ Amazon-like Zoom: hover zoom + modal */}
                    <ProductImageZoom src={heroImage} alt={productTitle} priority={true} containerClassName="rounded-3xl" />

                    {/* Zoom hint button */}
                    <button
                      type="button"
                      onClick={() => showToast(language === 'ar' ? 'اضغط على الصورة للتكبير' : 'Click the image to zoom', 'info')}
                      className="absolute bottom-4 left-4 rtl:left-auto rtl:right-4 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/90 backdrop-blur border border-slate-200 shadow-sm text-slate-700 hover:bg-white"
                      aria-label={language === 'ar' ? 'تكبير' : 'Zoom'}
                    >
                      <ZoomIn size={18} />
                      <span className="text-xs font-bold">{language === 'ar' ? 'تكبير' : 'Zoom'}</span>
                    </button>

                    {/* Wishlist */}
                    <div className="absolute top-4 right-4 rtl:right-auto rtl:left-4">
                      <button
                        onClick={() => toggleWishlist(product)}
                        className={`p-3 rounded-full bg-white shadow-md transition-colors ${
                          isLiked ? 'text-red-500' : 'text-slate-400 hover:text-red-500'
                        }`}
                        type="button"
                        aria-label={language === 'ar' ? 'مفضلة' : 'Wishlist'}
                      >
                        <Heart size={20} fill={isLiked ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Product Info */}
            <div className="p-5 md:p-8 lg:p-12 flex flex-col">
              {/* Meta */}
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-secondary-DEFAULT font-bold text-xs tracking-wider uppercase bg-secondary-light/10 px-3 py-1.5 rounded-full">
                    {product.category}
                  </span>
                  {(product as any).brand && <span className="text-slate-500 text-sm font-medium">{(product as any).brand}</span>}
                </div>

                <button
                  type="button"
                  onClick={handleShare}
                  className="hidden sm:inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                  aria-label={language === 'ar' ? 'مشاركة' : 'Share'}
                >
                  <Share2 size={18} />
                  <span className="text-sm font-bold">{t('share') ?? (language === 'ar' ? 'مشاركة' : 'Share')}</span>
                </button>
              </div>

              {/* Title */}
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-heading font-extrabold text-slate-900 leading-tight">{productTitle}</h1>

              {/* Rating */}
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => {
                    const filled = s <= Math.round(aggregate.avg || 0);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleTopStarClick(s)}
                        className="p-1 rounded-md hover:bg-slate-100 transition-colors"
                        aria-label={`top-rate-${s}`}
                      >
                        <Star size={18} fill={filled ? 'currentColor' : 'none'} className={filled ? 'text-yellow-400' : 'text-slate-300'} />
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="text-slate-500 text-sm font-medium hover:text-slate-700"
                  onClick={() => {
                    setActiveTab('reviews');
                    setTimeout(() => scrollToTabs(), 50);
                  }}
                >
                  <span className="underline">
                    {aggregate.count} {t('reviews')}
                  </span>
                  <span className="mx-2 text-slate-300">•</span>
                  <span className="font-bold text-slate-700">{aggregate.avg || 0}/5</span>
                </button>

                <button
                  type="button"
                  onClick={handleShare}
                  className="sm:hidden inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                  aria-label={language === 'ar' ? 'مشاركة' : 'Share'}
                >
                  <Share2 size={18} />
                  <span className="text-sm font-bold">{t('share') ?? (language === 'ar' ? 'مشاركة' : 'Share')}</span>
                </button>
              </div>

              {/* Price + Stock + CTA */}
              <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 p-5">
                <div className="flex items-end justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">{t('price') ?? (language === 'ar' ? 'السعر' : 'Price')}</div>
                    <div className="flex items-end gap-3 flex-wrap">
                      <span className="text-4xl font-extrabold text-slate-900 tracking-tight">{formatMoneyJOD(product.price)}</span>
                      {product.originalPrice && <span className="text-lg text-slate-400 line-through mb-1">{formatMoneyJOD(product.originalPrice)}</span>}
                    </div>
                  </div>

                  <div className="text-sm">
                    {isInStock ? (
                      <div className="flex items-center gap-2 text-green-700 font-bold bg-green-50 border border-green-100 px-3 py-2 rounded-xl">
                        <Check size={16} />
                        <span>
                          {t('availableStock')} ({stock} {t('piece')})
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-red-600 font-bold bg-red-50 border border-red-100 px-3 py-2 rounded-xl">
                        <AlertCircle size={16} />
                        <span>{t('outOfStock')}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Quantity + Buttons */}
                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                  <div className="w-full sm:w-auto">
                    <div className="text-xs text-slate-500 mb-1">{language === 'ar' ? 'الكمية' : 'Quantity'}</div>
                    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={decQty}
                        disabled={!isInStock || qty <= 1}
                        className="p-2 rounded-lg hover:bg-slate-50 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label={language === 'ar' ? 'تقليل الكمية' : 'Decrease quantity'}
                      >
                        <Minus size={18} />
                      </button>

                      <input
                        value={String(qty)}
                        onChange={onChangeQty}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        disabled={!isInStock}
                        className="w-16 text-center py-2 text-sm font-extrabold tabular-nums focus:outline-none"
                        aria-label={language === 'ar' ? 'الكمية' : 'Quantity'}
                      />

                      <button
                        type="button"
                        onClick={incQty}
                        disabled={!isInStock || qty >= stock}
                        className="p-2 rounded-lg hover:bg-slate-50 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label={language === 'ar' ? 'زيادة الكمية' : 'Increase quantity'}
                      >
                        <Plus size={18} />
                      </button>
                    </div>

                    {isInStock ? <div className="mt-1 text-[11px] text-slate-500">{language === 'ar' ? `الحد الأقصى: ${stock}` : `Max: ${stock}`}</div> : null}
                  </div>

                  <Button
                    onClick={() => (isInStock ? addToCartWithQty(product, qty) : setShowNotifyModal(true))}
                    variant={isInStock ? 'primary' : 'secondary'}
                    size="lg"
                    className="flex-1 shadow-xl shadow-secondary-light/20 w-full"
                  >
                    {isInStock ? (
                      <>
                        <ShoppingCart className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" />
                        {t('addToCart')}
                        <span className="ms-2 text-white/90 text-sm font-bold tabular-nums">×{qty}</span>
                      </>
                    ) : (
                      <>
                        <Bell className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" />
                        {t('notifyMe')}
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full sm:w-auto px-5"
                    type="button"
                    onClick={() => toggleWishlist(product)}
                  >
                    <Heart size={18} className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" />
                    {isLiked ? (t('remove') ?? (language === 'ar' ? 'إزالة' : 'Remove')) : (t('wishlist') ?? (language === 'ar' ? 'مفضلة' : 'Wishlist'))}
                  </Button>
                </div>

                <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex items-center gap-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <Truck size={18} className="text-secondary-DEFAULT" />
                    <span className="font-medium">{t('fastDelivery')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <RefreshCw size={18} className="text-secondary-DEFAULT" />
                    <span className="font-medium">{t('freeReturn')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <Check size={18} className="text-secondary-DEFAULT" />
                    <span className="font-medium">{t('securePayment') ?? (language === 'ar' ? 'دفع آمن' : 'Secure payment')}</span>
                  </div>
                </div>

                {descPreview && (
                  <div className="mt-5 text-sm text-slate-600 leading-relaxed">
                    {descPreview}
                    <button
                      type="button"
                      className="mx-2 text-secondary-DEFAULT font-bold hover:underline"
                      onClick={() => {
                        setActiveTab('desc');
                        setTimeout(() => scrollToTabs(), 50);
                      }}
                    >
                      {t('readMore') ?? (language === 'ar' ? 'اقرأ المزيد' : 'Read more')}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1" />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div ref={tabsRef} className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8 mb-12 scroll-mt-24">
          <div className="flex gap-6 md:gap-8 border-b border-slate-100 mb-6 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setActiveTab('desc')}
              className={`pb-4 text-base md:text-lg font-bold transition-colors relative whitespace-nowrap ${
                activeTab === 'desc' ? 'text-secondary-DEFAULT' : 'text-slate-400 hover:text-slate-600'
              }`}
              type="button"
            >
              {t('descAndDetails')}
              {activeTab === 'desc' && <span className="absolute bottom-0 left-0 w-full h-1 bg-secondary-DEFAULT rounded-t-full" />}
            </button>

            <button
              onClick={() => setActiveTab('reviews')}
              className={`pb-4 text-base md:text-lg font-bold transition-colors relative whitespace-nowrap ${
                activeTab === 'reviews' ? 'text-secondary-DEFAULT' : 'text-slate-400 hover:text-slate-600'
              }`}
              type="button"
            >
              {t('reviews')} ({aggregate.count})
              {activeTab === 'reviews' && <span className="absolute bottom-0 left-0 w-full h-1 bg-secondary-DEFAULT rounded-t-full" />}
            </button>
          </div>

          <div className="min-h-[220px]">
            {activeTab === 'desc' && (
              <div className="animate-in fade-in slide-in-from-bottom-2">
                <h3 className="font-bold text-xl mb-4 text-slate-800">{t('descAndDetails')}</h3>
                <div className="text-slate-600">
                  {renderRichText(product.description) || <p className="leading-relaxed">{product.description}</p>}
                </div>

                {product.details && (
                  <>
                    <h4 className="font-bold text-lg mb-2 text-slate-800 mt-6">{t('productSpecs')}</h4>
                    <ul className="list-disc list-inside text-slate-600 space-y-2">
                      {String(product.details)
                        .split('،')
                        .map((item) => item.trim())
                        .filter(Boolean)
                        .map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* ✅ نفس قسم الريفيوز عندك (بدون تغيير المنطق) */}
            {activeTab === 'reviews' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                {/* Summary */}
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <div className="text-xs text-slate-500 mb-1">{language === 'ar' ? 'ملخص التقييمات' : 'Reviews summary'}</div>
                      <div className="flex items-center gap-3">
                        <div className="text-3xl font-extrabold text-slate-900 tabular-nums">{aggregate.avg || 0}</div>
                        <div className="text-sm text-slate-500">/ 5</div>
                        <span className="text-slate-300">•</span>
                        <div className="text-sm text-slate-600">
                          <span className="font-bold tabular-nums">{aggregate.count}</span> {t('reviews')}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-slate-500">
                      {language === 'ar'
                        ? isAdmin
                          ? 'أنت أدمن: تشوف كل التقييمات وتقدر تخفي/تحذف/ترد'
                          : 'فقط من اشترى المنتج يمكنه كتابة تقييم'
                        : isAdmin
                          ? 'Admin mode: you can manage all reviews'
                          : 'Only buyers can post a review'}
                    </div>
                  </div>
                </div>

                {/* Write review */}
                <div ref={reviewFormRef} className="rounded-2xl border border-slate-100 bg-white p-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-lg font-extrabold text-slate-900">{language === 'ar' ? 'اكتب تقييمك' : 'Write your review'}</h3>
                      <p className="text-xs text-slate-500 mt-1">
                        {viewer?.id
                          ? canReviewLoading
                            ? language === 'ar'
                              ? 'جاري التحقق من إمكانية التقييم…'
                              : 'Checking eligibility…'
                            : canReview
                              ? language === 'ar'
                                ? 'مسموح لك بالتقييم لأنك اشتريت المنتج.'
                                : 'You can review because you purchased this product.'
                              : language === 'ar'
                                ? 'لا يمكنك التقييم إلا بعد شراء المنتج.'
                                : 'You can review only after purchase.'
                          : language === 'ar'
                            ? 'سجّل دخول لتقدر تكتب تقييم.'
                            : 'Login to post a review.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setMyRating(s)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                          aria-label={`rate-${s}`}
                          disabled={!viewer?.id || !canReview || canReviewLoading}
                        >
                          <Star size={18} fill={s <= myRating ? 'currentColor' : 'none'} className={s <= myRating ? 'text-yellow-400' : 'text-slate-300'} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4">
                    <textarea
                      value={myComment}
                      onChange={(e) => setMyComment(e.target.value)}
                      placeholder={language === 'ar' ? 'اكتب تعليقك…' : 'Write your comment…'}
                      className="w-full min-h-[110px] resize-none p-4 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-secondary-DEFAULT focus:ring-2 focus:ring-secondary-DEFAULT/30 text-sm"
                      disabled={!viewer?.id || !canReview || canReviewLoading}
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="text-[11px] text-slate-500">{language === 'ar' ? 'الرجاء كتابة تعليق واضح (٣ أحرف على الأقل).' : 'Please write a clear comment (min 3 chars).'}</div>
                      <Button onClick={handleSubmitReview} variant="primary" size="sm" className="px-4" disabled={!viewer?.id || !canReview || canReviewLoading}>
                        <Save size={16} className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" />
                        {language === 'ar' ? 'حفظ التقييم' : 'Save review'}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Reviews list */}
                <div className="rounded-2xl border border-slate-100 bg-white p-5">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                    <h3 className="text-lg font-extrabold text-slate-900">{language === 'ar' ? 'كل التقييمات' : 'All reviews'}</h3>
                    <div className="text-xs text-slate-500">
                      {reviewsLoading ? (language === 'ar' ? 'جاري التحميل…' : 'Loading…') : `${publishedReviews.length} / ${aggregate.count}`}
                    </div>
                  </div>

                  {reviewsLoading ? (
                    <div className="space-y-3">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />
                      ))}
                    </div>
                  ) : publishedReviews.length === 0 ? (
                    <div className="text-center py-10 rounded-2xl bg-slate-50 border border-dashed border-slate-200">
                      <div className="text-5xl opacity-40 mb-3">⭐</div>
                      <div className="font-bold text-slate-800">{language === 'ar' ? 'لا يوجد تقييمات بعد' : 'No reviews yet'}</div>
                      <div className="text-sm text-slate-500 mt-1">{language === 'ar' ? 'كن أول من يكتب تقييمًا لهذا المنتج.' : 'Be the first to review this product.'}</div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {publishedReviews.map((r: any) => {
                        const rid = String(r?.id ?? '');
                        const ratingV = Number(r?.rating || 0);
                        const likes = Number(r?.likesCount || 0);
                        const mine = viewer?.id && String(r?.userId || '') === String(viewer.id);

                        const status = String(r?.status || 'published');
                        const hidden = status === 'hidden';

                        return (
                          <div key={rid} className="rounded-2xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                            <div className="flex items-start justify-between gap-4 flex-wrap">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <div className="font-extrabold text-slate-900 line-clamp-1">{String(r?.userName || 'User')}</div>
                                  {mine ? (
                                    <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-secondary-light/20 text-secondary-DEFAULT">{language === 'ar' ? 'تقييمك' : 'You'}</span>
                                  ) : null}
                                  {hidden ? (
                                    <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-slate-200 text-slate-700">{language === 'ar' ? 'مخفي' : 'Hidden'}</span>
                                  ) : null}
                                </div>

                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <div className="flex items-center gap-1">
                                    {[1, 2, 3, 4, 5].map((s) => (
                                      <Star key={s} size={14} fill={s <= ratingV ? 'currentColor' : 'none'} className={s <= ratingV ? 'text-yellow-400' : 'text-slate-200'} />
                                    ))}
                                  </div>
                                  <span className="text-xs text-slate-400">•</span>
                                  <span className="text-xs text-slate-500 tabular-nums">{formatDate(r as any)}</span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleToggleLike(r as any)}
                                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-white"
                                >
                                  <ThumbsUp size={16} />
                                  <span className="text-xs font-bold tabular-nums">{likes}</span>
                                </button>

                                {isAdmin ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleAdminToggleStatus(r as any)}
                                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-white"
                                      aria-label="toggle-status"
                                      title={hidden ? (language === 'ar' ? 'إظهار' : 'Publish') : (language === 'ar' ? 'إخفاء' : 'Hide')}
                                    >
                                      {hidden ? <Eye size={16} /> : <EyeOff size={16} />}
                                      <span className="text-xs font-bold">{hidden ? (language === 'ar' ? 'إظهار' : 'Publish') : (language === 'ar' ? 'إخفاء' : 'Hide')}</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => handleAdminDelete(r as any)}
                                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50"
                                      aria-label="delete-review"
                                    >
                                      <Trash2 size={16} />
                                      <span className="text-xs font-bold">{language === 'ar' ? 'حذف' : 'Delete'}</span>
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{String(r?.comment || '')}</div>

                            {/* Admin reply */}
                            {isAdmin ? (
                              <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-100 p-3">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 mb-2">
                                  <MessageSquare size={14} />
                                  {language === 'ar' ? 'رد الإدارة' : 'Admin reply'}
                                </div>

                                <textarea
                                  value={replyDraft[rid] ?? ''}
                                  onChange={(e) =>
                                    setReplyDraft((prev) => ({
                                      ...prev,
                                      [rid]: e.target.value,
                                    }))
                                  }
                                  placeholder={language === 'ar' ? 'اكتب رد الإدارة…' : 'Write admin reply…'}
                                  className="w-full min-h-[80px] resize-none p-3 rounded-2xl bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-secondary-DEFAULT/30 text-sm"
                                />

                                <div className="mt-2 flex justify-end">
                                  <Button size="sm" onClick={() => handleAdminReply(r as any)}>
                                    <Save size={16} className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" />
                                    {language === 'ar' ? 'حفظ الرد' : 'Save reply'}
                                  </Button>
                                </div>
                              </div>
                            ) : r?.adminReply?.text ? (
                              <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-100 p-4">
                                <div className="text-xs font-extrabold text-slate-700 mb-2">{language === 'ar' ? 'رد الإدارة' : 'Admin reply'}</div>
                                <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{String(r.adminReply.text)}</div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Related Products */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">{t('similarProducts')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {relatedProducts.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onAddToCart={addToCart}
                onToggleWishlist={toggleWishlist}
                onQuickView={openQuickView}
                isLiked={wishlist.has(p.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetails;