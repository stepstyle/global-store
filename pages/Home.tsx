// src/pages/Home.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { ArrowLeft, TrendingUp, Zap, Truck, ShieldCheck, RefreshCcw, Headset, ChevronLeft, ChevronRight } from 'lucide-react';

import Button from '../components/Button';
import ProductCard from '../components/ProductCard';
import { useCart } from '../App';
import SEO from '../components/SEO';
import { ProductSkeletonGrid } from '../components/Skeleton';

// ✅ Single Source of Truth (Games subcategories + routes)
import { GAMES_SUBCATEGORIES, gamesTo } from '../config/nav';

const { Link } = ReactRouterDOM as any;

type HeroImageSet = {
  s600: string;
  s1200: string;
  s1920: string;
};

type HeroSlide = {
  key: string;
  badge: string;
  title1: string;
  title2: string;
  desc: string;
  ctaText: string;
  ctaLink: string;
  image: HeroImageSet;
  emoji: string;
};

const FALLBACK_HERO: HeroImageSet = {
  s600: '/images/hero-school-19202.webp',
  s1200: '/images/hero-school-19202.webp',
  s1920: '/images/hero-school-19202.webp',
};

const ROTATE_MS = 6500;

const Home: React.FC = () => {
  const { products, addToCart, toggleWishlist, wishlist, openQuickView, t, language, isLoading } = useCart() as any;

  const isRTL = useMemo(() => (language ?? 'ar') === 'ar', [language]);

  const slides = useMemo<HeroSlide[]>(
    () => [
      {
        key: 'back-to-school',
        badge: String((t('hero_badge') as string) ?? 'جديد الموسم: تشكيلة العودة للمدارس'),
        title1: language === 'ar' ? 'استعد للمدرسة' : 'Get Ready for School',
        title2: language === 'ar' ? 'بأناقة وذكاء' : 'In Style & Smart',
        desc:
          language === 'ar'
            ? 'قرطاسية، حقائب، أدوات ذكية… كل ما تحتاجه العائلة والطلاب بجودة عالية.'
            : 'Stationery, bags, smart tools… everything students and families need with great quality.',
        ctaText: language === 'ar' ? 'تسوق القرطاسية' : 'Shop Stationery',
        ctaLink: '/shop?filter=Stationery',
        image: FALLBACK_HERO,
        emoji: '🎒',
      },
      {
        key: 'toys',
        badge: language === 'ar' ? 'الأكثر طلبًا للأطفال' : 'Most Popular for Kids',
        title1: language === 'ar' ? 'ألعاب آمنة' : 'Safe Toys',
        title2: language === 'ar' ? 'وتعليمية' : 'and Educational',
        desc:
          language === 'ar'
            ? 'ألعاب مختارة بعناية حسب العمر لتنمية المهارات وإضافة المرح لكل طفل.'
            : 'Carefully selected toys by age to build skills and add fun for every child.',
        ctaText: language === 'ar' ? 'تسوق الألعاب' : 'Shop Games',
        ctaLink: '/shop?filter=Games',
        image: FALLBACK_HERO,
        emoji: '🧸',
      },
      {
        key: 'gifts',
        badge: language === 'ar' ? 'هدايا لكل المناسبات' : 'Gifts for Every Occasion',
        title1: language === 'ar' ? 'هدايا مميزة' : 'Special Gifts',
        title2: language === 'ar' ? 'تفرّح العائلة' : 'That Make Them Smile',
        desc:
          language === 'ar'
            ? 'اختيارات راقية للهدايا واللوازم المكتبية والمنتجات الجميلة للمناسبات.'
            : 'Premium picks for gifts, office supplies, and beautiful items for special moments.',
        ctaText: language === 'ar' ? 'تسوق الهدايا' : 'Shop Offers',
        ctaLink: '/shop?filter=Offers',
        image: FALLBACK_HERO,
        emoji: '🎁',
      },
    ],
    [t, language]
  );

  const [activeSlide, setActiveSlide] = useState<number>(0);
  const [isPaused, setIsPaused] = useState(false);

  // Keep activeSlide valid if slides change
  useEffect(() => {
    if (activeSlide >= slides.length) setActiveSlide(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  const goNext = useCallback(() => {
    setActiveSlide((s) => (slides.length ? (s + 1) % slides.length : 0));
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setActiveSlide((s) => (slides.length ? (s - 1 + slides.length) % slides.length : 0));
  }, [slides.length]);

  // Auto-rotate (pause on hover/focus)
  useEffect(() => {
    if (slides.length <= 1) return;
    if (isPaused) return;

    const id = window.setInterval(() => {
      setActiveSlide((s) => (s + 1) % slides.length);
    }, ROTATE_MS);

    return () => window.clearInterval(id);
  }, [slides.length, isPaused]);

  const slide = slides[activeSlide] ?? slides[0];

  // Preload next image
  useEffect(() => {
    if (!slide || slides.length <= 1) return;
    const next = slides[(activeSlide + 1) % slides.length];
    const src = next?.image?.s1200 || '';
    if (!src) return;

    const img = new Image();
    img.src = src;
  }, [activeSlide, slides, slide]);

  // Keyboard navigation (← →)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') (isRTL ? goPrev() : goNext());
      if (e.key === 'ArrowLeft') (isRTL ? goNext() : goPrev());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, goPrev, isRTL]);

  // Featured products: prefer isFeatured then fallback to first 4
  const featuredProducts = useMemo(() => {
    const list = Array.isArray(products) ? products : [];
    const picked = list.filter((p: any) => !!p?.isFeatured).slice(0, 4);
    return picked.length ? picked : list.slice(0, 4);
  }, [products]);

  // ✅ Better schema (no fake phone)
  const homeSchema = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'Store',
      name: 'مكتبة دير شرف العلمية',
      image: slide?.image?.s1200 || FALLBACK_HERO.s1200,
      description: slide?.desc || 'متجر شامل للقرطاسية والألعاب والهدايا في الأردن.',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'دوار النزهة',
        addressLocality: 'Amman',
        addressCountry: 'JO',
      },
    }),
    [slide?.image?.s1200, slide?.desc]
  );

  // ✅ Subcategories grid: exclude "all" because there's already "View all"
  const gameSubs = useMemo(() => GAMES_SUBCATEGORIES.filter((x: any) => x.sub !== 'all'), []);

  return (
    <div className="min-h-screen">
      <SEO title={String(t('home') ?? 'Home')} description={slide?.desc} type="website" schema={homeSchema} />

      {/* Hero Section */}
      <section
        className="relative overflow-hidden bg-slate-50 py-12 lg:py-28"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocusCapture={() => setIsPaused(true)}
        onBlurCapture={() => setIsPaused(false)}
        aria-label="Homepage hero"
      >
        {/* Background */}
        <div className="absolute top-0 right-0 w-3/4 lg:w-1/2 h-full bg-gradient-to-l from-primary-light/50 to-transparent rounded-bl-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-2/3 lg:w-1/3 h-2/3 bg-gradient-to-t from-secondary-light/50 to-transparent rounded-tr-[100px] pointer-events-none" />
        <div className="absolute top-20 left-20 w-16 h-16 bg-primary-DEFAULT/20 rounded-full blur-2xl animate-pulse" />

        <div className="container mx-auto px-4 lg:px-8 relative z-10">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            {/* Text */}
            <div className="flex-1 text-center lg:text-right rtl:lg:text-right ltr:lg:text-left order-2 lg:order-1">
              <div className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-100 mb-6 animate-in slide-in-from-bottom-5 fade-in duration-700">
                <span className="text-lg" aria-hidden="true">{slide?.emoji}</span>
                <span className="text-sm font-semibold text-slate-600">{slide?.badge}</span>
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-6xl font-heading font-bold text-slate-900 leading-tight mb-6 animate-in slide-in-from-bottom-5 fade-in duration-700 delay-100">
                {slide?.title1} <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-l from-secondary-DEFAULT to-primary-DEFAULT">
                  {slide?.title2}
                </span>
              </h1>

              <p className="text-base sm:text-lg text-slate-600 mb-8 max-w-lg mx-auto lg:mx-0 animate-in slide-in-from-bottom-5 fade-in duration-700 delay-200">
                {slide?.desc}
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start animate-in slide-in-from-bottom-5 fade-in duration-700 delay-300">
                <Link to={slide?.ctaLink || '/shop'} aria-label="Primary CTA">
                  <Button size="lg" className="rounded-full w-full sm:w-auto">
                    {slide?.ctaText}
                  </Button>
                </Link>

                <Link to="/shop?filter=Offers" aria-label="View offers">
                  <Button variant="outline" size="lg" className="rounded-full w-full sm:w-auto">
                    {String(t('viewOffers') ?? 'View Offers')}
                  </Button>
                </Link>
              </div>

              {/* Trust Bar */}
              <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto lg:mx-0">
                <div className="bg-white/80 backdrop-blur rounded-2xl border border-slate-100 p-3 flex items-center gap-2">
                  <Truck className="text-secondary-DEFAULT" size={18} />
                  <span className="text-xs font-bold text-slate-700">{String(t('fastShipping') ?? 'شحن سريع')}</span>
                </div>
                <div className="bg-white/80 backdrop-blur rounded-2xl border border-slate-100 p-3 flex items-center gap-2">
                  <ShieldCheck className="text-secondary-DEFAULT" size={18} />
                  <span className="text-xs font-bold text-slate-700">{String(t('securePayment') ?? 'دفع آمن')}</span>
                </div>
                <div className="bg-white/80 backdrop-blur rounded-2xl border border-slate-100 p-3 flex items-center gap-2">
                  <RefreshCcw className="text-secondary-DEFAULT" size={18} />
                  <span className="text-xs font-bold text-slate-700">{String(t('easyReturns') ?? 'استرجاع سهل')}</span>
                </div>
                <div className="bg-white/80 backdrop-blur rounded-2xl border border-slate-100 p-3 flex items-center gap-2">
                  <Headset className="text-secondary-DEFAULT" size={18} />
                  <span className="text-xs font-bold text-slate-700">{String(t('support') ?? 'دعم سريع')}</span>
                </div>
              </div>

              {/* Dots + Arrows */}
              {slides.length > 1 && (
                <div className="mt-6 flex items-center justify-center lg:justify-start gap-3">
                  <button
                    type="button"
                    onClick={goPrev}
                    className="p-2 rounded-full bg-white border border-slate-200 hover:border-secondary-DEFAULT hover:text-secondary-DEFAULT transition focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT"
                    aria-label="Previous slide"
                  >
                    <ChevronRight size={18} className="rtl:rotate-180 ltr:rotate-0" />
                  </button>

                  <div className="flex items-center gap-2">
                    {slides.map((s, i) => (
                      <button
                        key={s.key}
                        onClick={() => setActiveSlide(i)}
                        aria-label={`Slide ${i + 1}`}
                        className={`h-2 rounded-full transition-all ${
                          i === activeSlide ? 'w-8 bg-secondary-DEFAULT' : 'w-2 bg-slate-300 hover:bg-slate-400'
                        }`}
                        type="button"
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={goNext}
                    className="p-2 rounded-full bg-white border border-slate-200 hover:border-secondary-DEFAULT hover:text-secondary-DEFAULT transition focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT"
                    aria-label="Next slide"
                  >
                    <ChevronLeft size={18} className="rtl:rotate-180 ltr:rotate-0" />
                  </button>
                </div>
              )}
            </div>

            {/* Image */}
            <div className="flex-1 relative animate-in zoom-in duration-1000 w-full order-1 lg:order-2">
              <div className="relative z-10 bg-white p-3 lg:p-4 rounded-3xl shadow-2xl lg:rotate-3 lg:hover:rotate-0 transition-transform duration-500">
                <div className="rounded-2xl bg-slate-100 overflow-hidden">
                  <img
                    src={slide?.image?.s1200 || FALLBACK_HERO.s1200}
                    srcSet={`
                      ${slide?.image?.s600 || FALLBACK_HERO.s600} 600w,
                      ${slide?.image?.s1200 || FALLBACK_HERO.s1200} 1200w,
                      ${slide?.image?.s1920 || FALLBACK_HERO.s1920} 1920w
                    `}
                    sizes="(max-width: 640px) 600px, (max-width: 1024px) 1200px, 1920px"
                    alt={`${slide?.title1 ?? ''} ${slide?.title2 ?? ''}`.trim()}
                    className="rounded-2xl w-full object-cover h-[200px] sm:h-[300px] lg:h-[420px]"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                  />
                </div>

                {/* Floating Badge */}
                <div className="absolute -bottom-6 -right-2 lg:-right-6 bg-white p-3 lg:p-4 rounded-2xl shadow-xl border border-slate-100 flex items-center gap-3 scale-90 lg:scale-100">
                  <div className="bg-green-100 p-2 rounded-full text-green-600">
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-bold">{String(t('topSales') ?? 'Top Sales')}</p>
                    <p className="font-bold text-slate-900">+10k</p>
                  </div>
                </div>
              </div>

              <div className="absolute top-0 right-0 w-full h-full border-2 border-primary-DEFAULT rounded-3xl -z-10 translate-x-3 translate-y-3 lg:translate-x-4 lg:translate-y-4" />
            </div>
          </div>
        </div>
      </section>

      {/* Games Subcategories */}
      <section className="py-12 lg:py-20 bg-white">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-end mb-12 gap-4">
            <div className="text-center sm:text-right rtl:sm:text-right ltr:sm:text-left w-full sm:w-auto">
              <h2 className="text-2xl lg:text-3xl font-heading font-bold text-slate-900 mb-2">
                {String(t('shopByCategory') ?? 'Shop by Category')}
              </h2>
              <p className="text-slate-500">{String(t('categoryDesc') ?? '')}</p>
            </div>

            <Link
              to={gamesTo('all')}
              className="text-secondary-DEFAULT font-semibold flex items-center gap-1 hover:gap-2 transition-all self-center sm:self-auto"
              aria-label="View all games"
            >
              {String(t('viewAll') ?? 'View All')}{' '}
              <ArrowLeft size={16} className="rtl:rotate-0 ltr:rotate-180" />
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 lg:gap-4">
            {gameSubs.map((it: any) => (
              <Link
                key={it.sub}
                to={gamesTo(it.sub)}
                className="group bg-slate-50 p-4 lg:p-6 rounded-2xl flex flex-col items-center justify-center hover:bg-secondary-light/10 border border-transparent hover:border-secondary-DEFAULT transition-all duration-300"
                aria-label={`Games subcategory ${language === 'ar' ? it.labelAr : it.labelEn}`}
              >
                <span className="text-3xl lg:text-4xl mb-3 lg:mb-4 group-hover:scale-110 transition-transform duration-300" aria-hidden="true">
                  🎮
                </span>
                <h3 className="font-bold text-sm lg:text-base text-slate-700 group-hover:text-secondary-DEFAULT text-center">
                  {language === 'ar' ? it.labelAr : it.labelEn}
                </h3>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-12 lg:py-20 bg-slate-50">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="flex items-end justify-between gap-4 mb-10 lg:mb-16">
            <div className="text-center sm:text-right rtl:sm:text-right ltr:sm:text-left w-full sm:w-auto">
              <span className="text-secondary-DEFAULT font-bold tracking-widest text-xs uppercase mb-2 block">
                {String(t('ourPicks') ?? 'Our Picks')}
              </span>
              <h2 className="text-2xl lg:text-3xl font-heading font-bold text-slate-900">
                {String(t('featuredProducts') ?? 'Featured Products')}
              </h2>
            </div>

            <Link
              to="/shop"
              className="text-secondary-DEFAULT font-semibold flex items-center gap-1 hover:gap-2 transition-all"
              aria-label="View all products"
            >
              {String(t('viewAll') ?? 'View All')}{' '}
              <ArrowLeft size={16} className="rtl:rotate-0 ltr:rotate-180" />
            </Link>
          </div>

          {isLoading ? (
            <ProductSkeletonGrid count={4} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {featuredProducts.map((product: any, idx: number) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAddToCart={addToCart}
                  onToggleWishlist={toggleWishlist}
                  onQuickView={openQuickView}
                  isLiked={wishlist.has(product.id)}
                  priority={idx < 2}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Offer Banner */}
      <section className="py-10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="relative rounded-3xl overflow-hidden p-8 lg:p-12 flex flex-col md:flex-row items-center justify-between text-center md:text-right rtl:md:text-right ltr:md:text-left">
            <div className="absolute inset-0 bg-gradient-to-r from-secondary-DEFAULT to-primary-DEFAULT z-0" />

            <div className="relative z-10 max-w-xl mb-8 md:mb-0">
              <div className="flex items-center justify-center md:justify-start gap-2 text-white font-bold mb-4">
                <Zap fill="currentColor" /> {String(t('specialOffer') ?? 'Special Offer')}
              </div>
              <h2 className="text-3xl lg:text-4xl font-bold mb-4 text-white">{String(t('offerTitle') ?? '')}</h2>
              <p className="text-white/85 mb-8 font-medium">{String(t('offerDesc') ?? '')}</p>

              <Link to="/shop?filter=Offers" aria-label="Browse offers">
                <Button
                  variant="primary"
                  className="bg-white text-slate-900 hover:bg-slate-100 border-none shadow-xl w-full sm:w-auto"
                >
                  {String(t('browseCourses') ?? 'Browse')}
                </Button>
              </Link>
            </div>

            <div className="relative z-10">
              <div className="w-48 h-32 lg:w-64 lg:h-40 bg-white/20 backdrop-blur-md rounded-2xl border border-white/30 flex items-center justify-center rotate-6 shadow-2xl">
                <span className="text-6xl" aria-hidden="true">🎓</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;