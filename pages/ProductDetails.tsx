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
} from 'lucide-react';

import Button from '../components/Button';
import ProductCard from '../components/ProductCard';
import { useCart } from '../App';
import { Product, ReviewDoc, AppUser } from '../types';
import SEO from '../components/SEO';
import LazyImage from '../components/LazyImage';
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

  const scrollToReviewForm = useCallback(() => {
    reviewFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const productTitle = useMemo(() => (product ? getProductTitle(product) : ''), [product, getProductTitle]);

  // ✅ Sync tab with URL (?tab=reviews)
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const tab = sp.get('tab');
    if (tab === 'reviews') {
      setActiveTab('reviews');
      // Scroll بعد رندر بسيط
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
  }, [id, products]);

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

      // Initialize admin reply drafts from backend values (once per load)
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

      // My review
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
  }, [id, viewer, viewer?.id, isAdmin, showToast, language]);

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

  const reviewDisabled = !viewer?.id || !canReview || canReviewLoading;

  const descRaw = safeStr(product?.description);
  const descPreview = useMemo(() => {
    const d = descRaw;
    if (!d) return '';
    return d.length > 220 ? `${d.slice(0, 220)}…` : d;
  }, [descRaw]);

  const handleNotifySubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const email = safeStr(notifyEmail);
      if (!email) return;

      // Mock (يمكن لاحقاً ربطه بسيرفر)
      setIsNotified(true);
      showToast(language === 'ar' ? 'تم تسجيل التنبيه بنجاح' : 'Notification saved', 'success');

      setTimeout(() => {
        setShowNotifyModal(false);
        setNotifyEmail('');
      }, 1200);
    },
    [notifyEmail, showToast, language]
  );

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

      showToast(myReviewId ? (language === 'ar' ? 'تم تعديل تقييمك' : 'Review updated') : (language === 'ar' ? 'تم نشر تقييمك' : 'Review posted'), 'success');

      await refreshReviews();

      setActiveTab('reviews');
      setTimeout(() => scrollToReviewForm(), 50);
    } catch (e: any) {
      showToast(e?.message || (language === 'ar' ? 'فشل حفظ التقييم' : 'Failed to save review'), 'error');
    }
  }, [
    product,
    viewer?.id,
    viewer?.name,
    viewer?.email,
    canReview,
    myComment,
    myRating,
    myReviewId,
    refreshReviews,
    showToast,
    scrollToReviewForm,
    language,
  ]);

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

        showToast(next === 'hidden' ? (language === 'ar' ? 'تم إخفاء التقييم' : 'Review hidden') : (language === 'ar' ? 'تم نشر التقييم' : 'Review published'), 'success');
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
      setTimeout(() => scrollToReviewForm(), 50);
    },
    [viewer?.id, canReviewLoading, canReview, showToast, scrollToTabs, scrollToReviewForm, language]
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

      // fallback
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
              <div className="relative">
                <LazyImage
                  src={heroImage}
                  alt={productTitle}
                  containerClassName="w-full aspect-square rounded-3xl bg-white border border-slate-200 overflow-hidden"
                  className="w-full h-full object-contain mix-blend-multiply hover:scale-105 transition-transform duration-500"
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />

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

              {/* Thumbnails */}
              {allImages.length > 1 && (
                <div className="mt-4">
                  <div className="text-xs text-slate-500 mb-2">{language === 'ar' ? 'صور المنتج' : 'Product images'}</div>
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    {allImages.slice(0, 10).map((img, idx) => {
                      const isActive = (selectedImage || allImages[0]) === img;
                      return (
                        <button
                          key={`${img}-${idx}`}
                          type="button"
                          onClick={() => {
                            const clean = safeStr(img);
                            if (clean) setSelectedImage(clean);
                          }}
                          className={`shrink-0 w-16 h-16 rounded-2xl overflow-hidden border transition-colors ${
                            isActive ? 'border-secondary-DEFAULT' : 'border-slate-200 hover:border-slate-300'
                          }`}
                          aria-label={`Select image ${idx + 1}`}
                        >
                          <LazyImage
                            src={img}
                            alt=""
                            containerClassName="w-full h-full"
                            className="w-full h-full object-cover"
                            cloudinarySize={140}
                            loading="lazy"
                            decoding="async"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Product Info */}
            <div className="p-5 md:p-8 lg:p-12 flex flex-col">
              {/* Meta */}
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-secondary-DEFAULT font-bold text-xs tracking-wider uppercase bg-secondary-light/10 px-3 py-1.5 rounded-full">
                    {product.category}
                  </span>
                  {(product as any).brand && (
                    <span className="text-slate-500 text-sm font-medium">{(product as any).brand}</span>
                  )}
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
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-heading font-extrabold text-slate-900 leading-tight">
                {productTitle}
              </h1>

              {/* Rating */}
              <div className="flex items-center gap-3 mt-3">
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
                        <Star
                          size={18}
                          fill={filled ? 'currentColor' : 'none'}
                          className={filled ? 'text-yellow-400' : 'text-slate-300'}
                        />
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
              </div>

              {/* Price + Stock + CTA */}
              <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 p-5">
                <div className="flex items-end justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">{t('price') ?? (language === 'ar' ? 'السعر' : 'Price')}</div>
                    <div className="flex items-end gap-3 flex-wrap">
                      <span className="text-4xl font-extrabold text-slate-900 tracking-tight">
                        {formatMoneyJOD(product.price)}
                      </span>

                      {product.originalPrice && (
                        <span className="text-lg text-slate-400 line-through mb-1">
                          {formatMoneyJOD(product.originalPrice)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-sm">
                    {(product.stock ?? 0) > 0 ? (
                      <div className="flex items-center gap-2 text-green-700 font-bold bg-green-50 border border-green-100 px-3 py-2 rounded-xl">
                        <Check size={16} />
                        <span>
                          {t('availableStock')} ({product.stock} {t('piece')})
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

                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={() => ((product.stock ?? 0) > 0 ? addToCart(product) : setShowNotifyModal(true))}
                    variant={(product.stock ?? 0) > 0 ? 'primary' : 'secondary'}
                    size="lg"
                    className="flex-1 shadow-xl shadow-secondary-light/20 w-full"
                  >
                    {(product.stock ?? 0) > 0 ? (
                      <>
                        <ShoppingCart className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" />
                        {t('addToCart')}
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
        <div
          ref={tabsRef}
          className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8 mb-12 scroll-mt-24"
        >
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

          <div className="min-h-[200px]">
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

            {activeTab === 'reviews' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                {/* Add / Edit Review Form */}
                <div ref={reviewFormRef} className="bg-slate-50 p-6 rounded-2xl border border-slate-100 scroll-mt-24">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <div className="font-bold text-slate-900 text-lg">
                        {viewer?.id ? (myReviewId ? (language === 'ar' ? 'عدّل تقييمك' : 'Edit your review') : (language === 'ar' ? 'اكتب تقييمك' : 'Write a review')) : (language === 'ar' ? 'سجّل دخول للتقييم' : 'Login to review')}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        ⭐ {language === 'ar' ? 'التقييم يظهر للزوار — والأدمن يمكنه إخفاء/حذف أي تقييم مخالف.' : 'Reviews are public — admin may hide/delete abusive reviews.'}
                      </div>
                    </div>
                  </div>

                  {!viewer?.id ? (
                    <div className="mt-4 text-sm text-slate-700 bg-white border border-slate-200 px-4 py-3 rounded-xl">
                      {language === 'ar' ? 'لازم تسجل دخول عشان تقدر تكتب تقييم.' : 'You must login to write a review.'}
                    </div>
                  ) : canReviewLoading ? (
                    <div className="mt-4 text-sm text-slate-600">
                      {language === 'ar' ? 'جاري التحقق من إمكانية التقييم...' : 'Checking eligibility...'}
                    </div>
                  ) : !canReview ? (
                    <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">
                      {language === 'ar' ? 'لا يمكنك تقييم هذا المنتج إلا بعد شرائه.' : 'You can review this product only after purchase.'}
                    </div>
                  ) : null}

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm font-bold text-slate-700 mb-2">{language === 'ar' ? 'تقييم النجوم' : 'Star rating'}</div>
                      <div className="flex items-center gap-2">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => !reviewDisabled && setMyRating(s)}
                            className={`p-2 rounded-xl border transition-colors ${
                              myRating >= s ? 'border-yellow-300 bg-yellow-50' : 'border-slate-200 bg-white'
                            } ${reviewDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}
                            disabled={reviewDisabled}
                            aria-label={`rate-${s}`}
                          >
                            <Star size={18} fill={myRating >= s ? 'currentColor' : 'none'} className="text-yellow-400" />
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-sm font-bold text-slate-700 mb-2">{language === 'ar' ? 'التعليق' : 'Comment'}</div>
                      <textarea
                        value={myComment}
                        onChange={(e) => setMyComment(e.target.value)}
                        rows={3}
                        disabled={reviewDisabled}
                        placeholder={
                          !viewer?.id
                            ? language === 'ar'
                              ? 'سجّل دخول أولاً'
                              : 'Login first'
                            : !canReview
                            ? language === 'ar'
                              ? 'لا يمكنك التقييم قبل الشراء'
                              : 'Purchase required'
                            : language === 'ar'
                            ? 'اكتب رأيك بكل صراحة…'
                            : 'Share your honest feedback…'
                        }
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-secondary-DEFAULT outline-none text-sm disabled:bg-slate-100"
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      type="button"
                      onClick={handleSubmitReview}
                      className="shadow-lg shadow-secondary-light/20"
                      disabled={reviewDisabled}
                    >
                      <Save size={18} className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" />
                      {myReviewId ? (language === 'ar' ? 'حفظ التعديل' : 'Save changes') : (language === 'ar' ? 'نشر التقييم' : 'Post review')}
                    </Button>
                  </div>
                </div>

                {/* Reviews List */}
                {reviewsLoading ? (
                  <div className="text-sm text-slate-500">{language === 'ar' ? 'جاري تحميل التقييمات…' : 'Loading reviews…'}</div>
                ) : publishedReviews.length === 0 ? (
                  <div className="text-sm text-slate-500 bg-slate-50 p-6 rounded-2xl">
                    {language === 'ar' ? 'لا يوجد تقييمات بعد. كن أول من يكتب تقييم 🎉' : 'No reviews yet. Be the first 🎉'}
                  </div>
                ) : (
                  publishedReviews.map((review) => {
                    const rid = String((review as any).id ?? '');
                    const likedByMe = !!(review as any).likesBy?.[viewer?.id || ''];
                    const status = ((review as any).status || 'published') as 'published' | 'hidden';

                    return (
                      <div key={rid} className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                        <div className="flex justify-between items-start mb-2 gap-4">
                          <div>
                            <span className="font-bold text-slate-900 block">{String((review as any).userName ?? '')}</span>
                            <span className="text-xs text-slate-400">
                              {formatDate(review)} {status === 'hidden' ? (language === 'ar' ? '• (مخفي)' : '• (hidden)') : ''}
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="flex text-yellow-400" aria-hidden="true">
                              {[...Array(5)].map((_, i) => (
                                <Star
                                  key={i}
                                  size={14}
                                  fill={i < Number((review as any).rating || 0) ? 'currentColor' : 'none'}
                                  className={i < Number((review as any).rating || 0) ? '' : 'text-slate-300'}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        <p className="text-slate-600 text-sm leading-relaxed">{String((review as any).comment ?? '')}</p>

                        {(review as any).adminReply?.text && (
                          <div className="mt-4 bg-white border border-slate-200 p-4 rounded-2xl">
                            <div className="text-xs text-slate-500 mb-1 flex items-center gap-2">
                              <MessageSquare size={14} />
                              {language === 'ar' ? 'رد الأدمن:' : 'Admin reply:'}{' '}
                              <span className="font-bold text-slate-700">{String((review as any).adminReply.adminName ?? '')}</span>
                            </div>
                            <div className="text-sm text-slate-700">{String((review as any).adminReply.text ?? '')}</div>
                          </div>
                        )}

                        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleToggleLike(review)}
                            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-colors ${
                              likedByMe
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <ThumbsUp size={14} />
                            {(language === 'ar' ? 'إعجاب' : 'Like')} ({Number((review as any).likesCount || 0)})
                          </button>

                          {isAdmin && (
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() => handleAdminToggleStatus(review)}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs hover:bg-slate-100"
                                title={language === 'ar' ? 'إخفاء/إظهار' : 'Hide/Show'}
                              >
                                {status === 'published' ? <EyeOff size={14} /> : <Eye size={14} />}
                                {status === 'published' ? (language === 'ar' ? 'إخفاء' : 'Hide') : (language === 'ar' ? 'إظهار' : 'Show')}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleAdminDelete(review)}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-200 bg-white text-xs text-red-600 hover:bg-red-50"
                                title={language === 'ar' ? 'حذف' : 'Delete'}
                              >
                                <Trash2 size={14} />
                                {language === 'ar' ? 'حذف' : 'Delete'}
                              </button>
                            </div>
                          )}
                        </div>

                        {isAdmin && (
                          <div className="mt-4">
                            <div className="text-xs font-bold text-slate-700 mb-2">{language === 'ar' ? 'رد الأدمن (اختياري)' : 'Admin reply (optional)'}</div>
                            <div className="flex gap-2">
                              <input
                                value={replyDraft[rid] ?? ''}
                                onChange={(e) => setReplyDraft((prev) => ({ ...prev, [rid]: e.target.value }))}
                                placeholder={language === 'ar' ? 'اكتب رد… أو اتركه فارغ لحذف الرد' : 'Write a reply… or leave empty to remove'}
                                className="flex-1 px-4 py-2 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-secondary-DEFAULT outline-none text-sm"
                              />
                              <button
                                type="button"
                                onClick={() => handleAdminReply(review)}
                                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm hover:bg-slate-800"
                              >
                                {language === 'ar' ? 'حفظ' : 'Save'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                <Button variant="outline" className="w-full" type="button" onClick={refreshReviews}>
                  {language === 'ar' ? 'تحديث التقييمات' : 'Refresh reviews'}
                </Button>
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