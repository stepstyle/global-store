// src/pages/Home.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  TrendingUp,
  Truck,
  ShieldCheck,
  RefreshCcw,
  Headset,
  ChevronLeft,
  ChevronRight,
  Facebook,
  Instagram,
  MapPin,
  MessageCircle,
  Gamepad2,
  PencilRuler,
  Gift,
  Shapes,
  Baby,
  Blocks,
  Dices,
  Palette,
  PenTool,
  Backpack,
  NotebookPen,
  PartyPopper,
  Package,
  Sparkles,
  Heart,
  GraduationCap,
  Sparkle
} from 'lucide-react';

import Button from '../components/Button';
import ProductCard from '../components/ProductCard';
import { useCart } from '../App';
import SEO from '../components/SEO';
import { ProductSkeletonGrid } from '../components/Skeleton';

// ✅ استدعاء الروابط الجديدة من nav.ts
import { shopTo } from '../config/nav';

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

const FB_URL = 'https://www.facebook.com/maktabatdayrsharafaleilmia/';
const IG_URL = 'https://www.instagram.com/deirsharaf/';
const MAPS_URL = 'https://maps.app.goo.gl/JeK1tvF4jysnLgjM9?g_st=iw';
const WA_NUMBER = '9627XXXXXXXX'; 
const WA_URL = `https://wa.me/${WA_NUMBER}`;

// 🚀 الأقسام الدائرية (مربوطة بالصور، ومحمية بأيقونات قياسية 100%)
const GAMES_SHOWCASE = [
  { sub: 'montessori', labelAr: 'ألعاب اطفال ', labelEn: 'Montessori', Icon: Shapes, image: '/images/categories/montessori.png' },
  { sub: 'girls-toys', labelAr: 'ألعاب للبنات', labelEn: 'Girls Toys', Icon: Heart, image: '/images/categories/girls.png' },
  { sub: 'boys-toys', labelAr: 'ألعاب للأولاد', labelEn: 'Boys Toys', Icon: Gamepad2, image: '/images/categories/boys.png' },
  { sub: 'building-blocks', labelAr: 'العاب التركيب', labelEn: 'Building Blocks', Icon: Blocks, image: '/images/categories/blocks.png' },
  { sub: 'group-games', labelAr: 'العاب جماعية', labelEn: 'Group Games', Icon: Dices, image: '/images/categories/group.png' },
];

const BABY_GEAR_SHOWCASE = [
  { sub: 'bicycles', labelAr: 'بسكليتات', labelEn: 'Bicycles', Icon: Sparkles, image: '/images/categories/bicycles.png' },
  { sub: 'ride-on-cars', labelAr: 'سيارات ركوب', labelEn: 'Ride-on Cars', Icon: Truck, image: '/images/categories/cars.png' },
  { sub: 'scooters', labelAr: 'سكوترات', labelEn: 'Scooters', Icon: Sparkles, image: '/images/categories/scooters.png' },
  { sub: 'strollers', labelAr: 'عربيات الأطفال', labelEn: 'Strollers', Icon: Baby, image: '/images/categories/strollers.png' },
  { sub: 'playmats', labelAr: 'سجاد لعب', labelEn: 'Playmats', Icon: Shapes, image: '/images/categories/playmats.png' },
];

const STATIONERY_SHOWCASE = [
  { sub: 'school-bags', labelAr: 'حقائب مدرسية', labelEn: 'School Bags', Icon: Backpack, image: '/images/categories/bags.png' },
  { sub: 'notebooks', labelAr: 'دفاتر مدرسية', labelEn: 'Notebooks', Icon: NotebookPen, image: '/images/categories/notebooks.png' },
  { sub: 'pens-ballpoint', labelAr: 'أقلام حبر', labelEn: 'Pens', Icon: PenTool, image: '/images/categories/pens.png' },
  { sub: 'colors-markers', labelAr: 'ألوان وماركرز', labelEn: 'Colors', Icon: Palette, image: '/images/categories/colors.png' },
  { sub: 'geometry-rulers', labelAr: 'أدوات هندسية', labelEn: 'Geometry Tools', Icon: PencilRuler, image: '/images/categories/geometry.png' },
];

const GIFTS_SHOWCASE = [
  { sub: 'gift-boxes', labelAr: 'صناديق هدايا', labelEn: 'Gift Boxes', Icon: Gift, image: '/images/categories/gift-boxes.png' },
  { sub: 'wrapping-paper', labelAr: 'تغليف هدايا', labelEn: 'Gift Wrap', Icon: Package, image: '/images/categories/wrap.png' },
  { sub: 'party-supplies', labelAr: 'مستلزمات حفلات', labelEn: 'Party Supplies', Icon: PartyPopper, image: '/images/categories/party.png' },
  { sub: 'bundle', labelAr: 'باكجات التوفير', labelEn: 'Bundles', Icon: Package, image: '/images/categories/bundles.png' },
  { sub: 'discount', labelAr: 'خصومات حصرية', labelEn: 'Discounts', Icon: Sparkle, image: '/images/categories/discount.png' },
];

type CardVariant = 'games' | 'stationery' | 'gifts' | 'babygear';

type SubCardProps = {
  title: string;
  Icon: any;
  image: string;
  to: string;
  variant: CardVariant;
  subtitle: string;
};

// 🎨 التعديل الاحترافي 1: تحويل الكرت إلى مربع تملأه الصورة والكلام بالأسفل
const SubCard: React.FC<SubCardProps> = ({ title, Icon, image, to, subtitle }) => {
  const [imgError, setImgError] = useState(false);

  return (
    <Link
      to={to}
      className="group flex flex-col bg-white rounded-3xl border border-slate-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)] overflow-hidden transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_20px_40px_-15px_rgba(14,165,233,0.15)] hover:border-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-100"
      aria-label={title}
    >
      {/* 📸 مساحة الصورة: تعبئ الجزء العلوي بالكامل */}
      <div className="relative w-full aspect-square bg-slate-50 flex items-center justify-center overflow-hidden">
        {image && !imgError ? (
          <img 
            src={image} 
            alt={title} 
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" 
            draggable={false}
            loading="eager"           
            decoding="sync"
            fetchpriority="high"
           onError={() => setImgError(true)}
          />
        ) : (
          /* الأيقونة تظهر في حال عدم وجود صورة */
          <Icon size={48} strokeWidth={1.5} className="text-slate-300 transition-all duration-500 group-hover:text-sky-500 group-hover:scale-110" />
        )}
        
        {/* تأثير لمعان خفيف عند وضع الماوس على الصورة */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      </div>

      {/* 📝 مساحة النصوص: في الجزء السفلي بخلفية بيضاء */}
      <div className="p-4 sm:p-5 flex flex-col items-center text-center bg-white z-10 border-t border-slate-50">
        <h3 className="text-sm sm:text-base font-black text-slate-800 tracking-tight group-hover:text-sky-600 transition-colors duration-300 line-clamp-1">{title}</h3>
        <p className="mt-1 text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest">{subtitle}</p>
      </div>
    </Link>
  );
};

type CategorySectionProps = {
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  viewAllTo: string;
  Icon: any;
  variant: CardVariant;
  items: Array<{ sub: string; labelAr: string; labelEn: string; Icon: any; image: string }>;
  toFn: (sub: string) => string;
  L: (ar: string, en: string) => string;
};

const CategorySection: React.FC<CategorySectionProps> = ({ titleAr, titleEn, descAr, descEn, viewAllTo, Icon, items, toFn, variant, L }) => (
  <section className="py-10 lg:py-14">
    <div className="container mx-auto px-4 lg:px-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6 lg:mb-8">
        <div className="text-center sm:text-start">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="inline-flex w-10 h-10 rounded-2xl bg-white border border-slate-200 shadow-sm items-center justify-center">
              <Icon size={18} className="text-secondary-DEFAULT" />
            </span>
            <span className="text-xs font-bold tracking-widest uppercase text-slate-500">
              {L('تسوّق حسب الفئة', 'Shop by Category')}
            </span>
          </div>
          <h2 className="text-2xl lg:text-3xl font-heading font-extrabold text-slate-900 leading-tight">
            {L(titleAr, titleEn)}
          </h2>
          <p className="mt-2 text-sm lg:text-base text-slate-500 max-w-xl mx-auto sm:mx-0">
            {L(descAr, descEn)}
          </p>
        </div>

        <Link
          to={viewAllTo}
          className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 bg-white border border-slate-200 text-slate-800 font-semibold hover:border-secondary-DEFAULT hover:text-secondary-DEFAULT transition"
          aria-label="View all"
        >
          {L('عرض الكل', 'View All')}
          <ArrowLeft size={16} className="rtl:rotate-0 ltr:rotate-180" />
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 lg:gap-5">
        {items.map((it, index) => {
          const title = L(it.labelAr, it.labelEn);
          return (
            <SubCard
              key={`${it.sub}-${index}`}
              title={title}
              Icon={it.Icon}
              image={it.image}
              to={toFn(it.sub)}
              variant={variant}
              subtitle={L('تصفّح المنتجات', 'Browse products')}
            />
          );
        })}
      </div>
    </div>
  </section>
);

const Home: React.FC = () => {
  const { products, addToCart, toggleWishlist, wishlist, openQuickView, t, language, isLoading } = useCart() as any;

  const isRTL = useMemo(() => (language ?? 'ar') === 'ar', [language]);
  const L = useCallback((ar: string, en: string) => ((language ?? 'ar') === 'ar' ? ar : en), [language]);

  const slides = useMemo<HeroSlide[]>(() => [
    {
      key: 'back-to-school',
      badge: String((t('hero_badge') as string) ?? L('جديد الموسم: تشكيلة العودة للمدارس', 'New season: Back to School picks')),
      title1: L('مكتبة دير شرف', 'Dair Sharaf'),
      title2: L('العلمية', 'Scientific Store'),
      desc: L('قرطاسية، حقائب، أدوات ذكية… كل ما تحتاجه العائلة والطلاب بجودة عالية.', 'Stationery, bags, and smart essentials — everything students and families need with great quality.'),
      ctaText: L('تسوق القرطاسية', 'Shop Stationery'),
      ctaLink: shopTo('Stationery'),
      image: FALLBACK_HERO,
      emoji: '🎒',
    },
    {
      key: 'toys',
      badge: L('الأكثر طلبًا للأطفال', 'Most Popular for Kids'),
      title1: L('ألعاب', 'Safe Toys'),
      title2: L('آمنة وتعليمية', 'and Educational'),
      desc: L('ألعاب مختارة بعناية حسب العمر لتنمية المهارات وإضافة المرح لكل طفل.', 'Carefully selected toys by age to build skills and add fun for every child.'),
      ctaText: L('تسوق الألعاب', 'Shop Games'),
      ctaLink: shopTo('Games'),
      image: FALLBACK_HERO,
      emoji: '🧸',
    },
    {
      key: 'gifts',
      badge: L('هدايا لكل المناسبات', 'Gifts for Every Occasion'),
      title1: L('هدايا', 'Special Gifts'),
      title2: L('تليق بالمناسبات', 'for Every Moment'),
      desc: L('اختيارات راقية للهدايا واللوازم المكتبية والمنتجات الجميلة للمناسبات.', 'Premium picks for gifts, office supplies, and beautiful items for special moments.'),
      ctaText: L('تسوق الهدايا', 'Shop Gifts'),
      ctaLink: shopTo('Gifts'),
      image: FALLBACK_HERO,
      emoji: '🎁',
    },
  ], [t, language, L]);

  const [activeSlide, setActiveSlide] = useState<number>(0);
  const [isPaused, setIsPaused] = useState(false);

  const goNext = useCallback(() => setActiveSlide((s) => (slides.length ? (s + 1) % slides.length : 0)), [slides.length]);
  const goPrev = useCallback(() => setActiveSlide((s) => (slides.length ? (s - 1 + slides.length) % slides.length : 0)), [slides.length]);

  const dragStartX = useRef<number | null>(null);
  const dragging = useRef<boolean>(false);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    dragStartX.current = e.clientX;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current || dragStartX.current == null) return;
    const delta = e.clientX - dragStartX.current;
    dragging.current = false;
    dragStartX.current = null;
    if (Math.abs(delta) < 40) return;
    if (delta < 0) { isRTL ? goPrev() : goNext(); } else { isRTL ? goNext() : goPrev(); }
  };

  const onPointerLeave = () => {
    dragging.current = false;
    dragStartX.current = null;
  };

  useEffect(() => {
    if (activeSlide >= slides.length) setActiveSlide(0);
  }, [slides.length, activeSlide]);

  useEffect(() => {
    if (slides.length <= 1 || isPaused) return;
    const id = window.setInterval(() => setActiveSlide((s) => (s + 1) % slides.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [slides.length, isPaused]);

  const slide = slides[activeSlide] ?? slides[0];

  const featuredProducts = useMemo(() => {
    const list = Array.isArray(products) ? products : [];
    const picked = list.filter((p: any) => !!p?.isFeatured).slice(0, 4);
    return picked.length ? picked : list.slice(0, 4);
  }, [products]);

  const trustItems = useMemo(() => [
    { Icon: Truck, labelAr: 'شحن سريع', labelEn: 'Fast Shipping' },
    { Icon: ShieldCheck, labelAr: 'دفع آمن', labelEn: 'Secure Payment' },
    { Icon: RefreshCcw, labelAr: 'استرجاع سهل', labelEn: 'Easy Returns' },
    { Icon: Headset, labelAr: 'دعم سريع', labelEn: 'Quick Support' },
  ], []);

  return (
    <div className="min-h-screen">
      <SEO title={String(t('home') ?? 'Home')} description={slide?.desc} type="website" />

      {/* Hero Section */}
      <section
        className="relative overflow-hidden bg-slate-50 py-12 lg:py-28"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocusCapture={() => setIsPaused(true)}
        onBlurCapture={() => setIsPaused(false)}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerLeave}
        onPointerLeave={onPointerLeave}
        style={{ touchAction: 'pan-y' }}
      >
        <div className="absolute top-0 end-0 w-3/4 lg:w-1/2 h-full rtl:bg-gradient-to-r ltr:bg-gradient-to-l from-primary-light/50 to-transparent rtl:rounded-br-[100px] ltr:rounded-bl-[100px] pointer-events-none" />
        <div className="absolute bottom-0 start-0 w-2/3 lg:w-1/3 h-2/3 bg-gradient-to-t from-secondary-light/50 to-transparent rtl:rounded-tl-[100px] ltr:rounded-tr-[100px] pointer-events-none" />
        <div className="absolute top-20 start-20 w-16 h-16 bg-primary-DEFAULT/20 rounded-full blur-2xl animate-pulse" />

        <div className="container mx-auto px-4 lg:px-8 relative z-10">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            
            <div className="flex-1 text-center lg:text-start order-2 lg:order-1">
              <div className="mb-6">
                <h1 className="text-3xl sm:text-4xl lg:text-6xl font-heading font-extrabold text-slate-900 tracking-tight leading-[1.15]">
                  {L('مكتبة دير شرف العلمية', 'Dair Sharaf Scientific Library')}
                </h1>

                <div className="mt-2 flex items-center justify-center lg:justify-start gap-3 text-slate-500">
                  <span className="text-sm sm:text-base font-semibold">{L('منذ عام 2000', 'Since 2000')}</span>
                  <span className="w-1 h-1 rounded-full bg-slate-300" />
                  
                  <div className="flex items-center gap-2">
                    {[
                      { href: FB_URL, icon: Facebook, color: '#1877F2', label: 'Facebook' },
                      { href: IG_URL, icon: Instagram, color: '#E1306C', label: 'Instagram' },
                      { href: WA_URL, icon: MessageCircle, color: '#25D366', label: 'WhatsApp' },
                      { href: MAPS_URL, icon: MapPin, color: '#EA4335', label: 'Maps' }
                    ].map((item, idx) => (
                      <a
                        key={idx}
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={item.label}
                        className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center transition hover:-translate-y-[1px] hover:shadow-md active:scale-95"
                      >
                        <item.icon size={18} style={{ color: item.color }} />
                      </a>
                    ))}
                  </div>
                </div>
              </div>

              <div className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-100 mb-5">
                <span className="text-lg" aria-hidden="true">{slide?.emoji}</span>
                <span className="text-sm font-semibold text-slate-700">{slide?.badge}</span>
              </div>

              <p className="text-base sm:text-lg text-slate-600 mb-7 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                {slide?.desc}
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Link to={slide?.ctaLink || '/shop'} aria-label="Primary CTA">
                  <Button size="lg" className="rounded-full w-full sm:w-auto px-7">{slide?.ctaText}</Button>
                </Link>
                <Link to={shopTo('Offers')} aria-label="View offers">
                  <Button variant="outline" size="lg" className="rounded-full w-full sm:w-auto px-7">
                    {String(t('viewOffers') ?? L('شاهد العروض', 'View Offers'))}
                  </Button>
                </Link>
              </div>

              <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto lg:mx-0">
                {trustItems.map(({ Icon, labelAr, labelEn }, idx) => (
                  <div key={idx} className="bg-white rounded-2xl border border-slate-200 px-3 py-2 flex items-center gap-2 shadow-sm">
                    <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                      <Icon className="text-slate-700" size={18} />
                    </div>
                    <span className="text-sm font-semibold text-slate-800 whitespace-nowrap">{L(labelAr, labelEn)}</span>
                  </div>
                ))}
              </div>

              {slides.length > 1 && (
                <div className="mt-6 flex items-center justify-center lg:justify-start gap-3">
                  <button onClick={() => (isRTL ? goNext() : goPrev())} className="p-2 rounded-full bg-white border border-slate-200 hover:border-secondary-DEFAULT hover:text-secondary-DEFAULT transition focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT" aria-label="Previous slide">
                    <ChevronRight size={18} className="rtl:rotate-180 ltr:rotate-0" />
                  </button>
                  <div className="flex items-center gap-2">
                    {slides.map((s, i) => (
                      <button key={s.key} onClick={() => setActiveSlide(i)} aria-label={`Slide ${i + 1}`} className={`h-2 rounded-full transition-all ${i === activeSlide ? 'w-8 bg-secondary-DEFAULT' : 'w-2 bg-slate-300 hover:bg-slate-400'}`} />
                    ))}
                  </div>
                  <button onClick={() => (isRTL ? goPrev() : goNext())} className="p-2 rounded-full bg-white border border-slate-200 hover:border-secondary-DEFAULT hover:text-secondary-DEFAULT transition focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT" aria-label="Next slide">
                    <ChevronLeft size={18} className="rtl:rotate-180 ltr:rotate-0" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 relative animate-in zoom-in duration-1000 w-full order-1 lg:order-2">
              <div className="relative z-10 bg-white p-3 lg:p-4 rounded-3xl shadow-2xl lg:rotate-3 lg:hover:rotate-0 transition-transform duration-500">
                <div className="rounded-2xl bg-slate-100 overflow-hidden">
                  <img
                    src={slide?.image?.s1200 || FALLBACK_HERO.s1200}
                    srcSet={`${slide?.image?.s600 || FALLBACK_HERO.s600} 600w, ${slide?.image?.s1200 || FALLBACK_HERO.s1200} 1200w, ${slide?.image?.s1920 || FALLBACK_HERO.s1920} 1920w`}
                    sizes="(max-width: 640px) 600px, (max-width: 1024px) 1200px, 1920px"
                    alt={`${slide?.title1 ?? ''} ${slide?.title2 ?? ''}`.trim()}
                    className="rounded-2xl w-full object-cover h-[200px] sm:h-[300px] lg:h-[420px]"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    draggable={false}
                    width={1200}
                    height={800}
                    style={{ aspectRatio: '3 / 2' }}
                  />
                </div>

                <div className="absolute -bottom-6 -end-2 lg:-end-6 bg-white p-3 lg:p-4 rounded-2xl shadow-xl border border-slate-100 flex items-center gap-3 scale-90 lg:scale-100">
                  <div className="bg-green-100 p-2 rounded-full text-green-600">
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-bold">{String(t('topSales') ?? L('مبيعات عالية', 'Top Sales'))}</p>
                    <p className="font-bold text-slate-900">+10k</p>
                  </div>
                </div>
              </div>
              
              <div className="absolute top-0 end-0 w-full h-full border-2 border-primary-DEFAULT rounded-3xl -z-10 rtl:-translate-x-3 ltr:translate-x-3 translate-y-3 lg:rtl:-translate-x-4 lg:ltr:translate-x-4 lg:translate-y-4" />
            </div>
          </div>
        </div>
      </section>

      {/* الأقسام */}
      <div className="bg-slate-50">
        <CategorySection titleAr="تسوّق الألعاب حسب الفئة" titleEn="Shop Games by Category" descAr="اختر النوع المناسب بسرعة (ولادي / بناتي / تعليمي...)" descEn="Pick the right type (boys / girls / educational...)" viewAllTo={shopTo('Games')} Icon={Gamepad2} variant="games" items={GAMES_SHOWCASE} toFn={(sub) => shopTo('Games', sub)} L={L} />
        
        <CategorySection titleAr="مركبات ومستلزمات الأطفال" titleEn="Kids Ride-ons & Gear" descAr="بسكليتات، سيارات ركوب، ومستلزمات العناية" descEn="Bicycles, ride-on cars, and baby gear" viewAllTo={shopTo('BabyGear')} Icon={Truck} variant="babygear" items={BABY_GEAR_SHOWCASE} toFn={(sub) => shopTo('BabyGear', sub)} L={L} />

        <CategorySection titleAr="تسوّق القرطاسية حسب القسم" titleEn="Shop Stationery by Section" descAr="كل مستلزمات المدرسة والمكتب بشكل مرتب" descEn="Neatly organized school & office essentials" viewAllTo={shopTo('Stationery')} Icon={PencilRuler} variant="stationery" items={STATIONERY_SHOWCASE} toFn={(sub) => shopTo('Stationery', sub)} L={L} />
        
        <CategorySection titleAr="تسوّق الهدايا حسب النوع" titleEn="Shop Gifts by Type" descAr="هدايا مرتبة لكل المناسبات" descEn="Curated gifts for every occasion" viewAllTo={shopTo('Gifts')} Icon={Gift} variant="gifts" items={GIFTS_SHOWCASE} toFn={(sub) => shopTo('Gifts', sub)} L={L} />
        
        <div className="container mx-auto px-4 lg:px-8 pb-6"><div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" /></div>
      </div>

      {/* Featured Products */}
      <section className="py-12 lg:py-20 bg-white">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="flex items-end justify-between gap-4 mb-10 lg:mb-16">
            <div className="text-center sm:text-start w-full sm:w-auto">
              <span className="text-secondary-DEFAULT font-bold tracking-widest text-xs uppercase mb-2 block">{String(t('ourPicks') ?? 'Our Picks')}</span>
              <h2 className="text-2xl lg:text-3xl font-heading font-bold text-slate-900">{String(t('featuredProducts') ?? 'Featured Products')}</h2>
            </div>
            <Link to="/shop" className="text-secondary-DEFAULT font-semibold flex items-center gap-1 hover:gap-2 transition-all" aria-label="View all products">
              {String(t('viewAll') ?? 'View All')} <ArrowLeft size={16} className="rtl:rotate-0 ltr:rotate-180" />
            </Link>
          </div>
          {isLoading ? (
            <ProductSkeletonGrid count={4} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {featuredProducts.map((product: any, idx: number) => (
                <ProductCard key={product.id} product={product} onAddToCart={addToCart} onToggleWishlist={toggleWishlist} onQuickView={openQuickView} isLiked={wishlist.has(product.id)} priority={idx < 2} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Offer Banner */}
      <section className="py-10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="relative rounded-3xl overflow-hidden p-8 lg:p-12 flex flex-col md:flex-row items-center justify-between text-center md:text-start">
            <div className="absolute inset-0 rtl:bg-gradient-to-l ltr:bg-gradient-to-r from-secondary-DEFAULT to-primary-DEFAULT z-0" />
            <div className="relative z-10 max-w-xl mb-8 md:mb-0">
              <div className="flex items-center justify-center md:justify-start gap-2 text-white font-bold mb-4">
                <Sparkles size={18} /> {String(t('specialOffer') ?? 'Special Offer')}
              </div>
              <h2 className="text-3xl lg:text-4xl font-black text-white mb-4 leading-tight">
                {isRTL ? 'خصومات تصل إلى 50% على تشكيلة مختارة' : 'Up to 50% off on selected items'}
              </h2>
              <p className="text-white/90 text-sm lg:text-base mb-8">
                {isRTL ? 'لا تفوت الفرصة! تسوق الآن واحصل على أفضل العروض قبل نفاذ الكمية.' : 'Don\'t miss out! Shop now and get the best deals before stock runs out.'}
              </p>
              <Link to={shopTo('Offers')} aria-label="Shop Offer">
                <Button className="bg-white text-primary-DEFAULT hover:bg-slate-50 px-8 py-3 rounded-xl font-bold shadow-lg transition-transform hover:-translate-y-1 active:scale-95">
                  {isRTL ? 'تسوق العرض الآن' : 'Shop Offer Now'}
                </Button>
              </Link>
            </div>
            <div className="relative z-10 w-full md:w-1/3 max-w-xs mx-auto md:mx-0">
              <img 
                src={FALLBACK_HERO.s600} 
                alt="Offer image" 
                className="w-full h-auto rounded-2xl shadow-2xl rotate-3 hover:rotate-0 transition-transform duration-500 border-4 border-white/20" 
              />
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};

export default Home;