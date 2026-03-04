// src/pages/Home.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  TrendingUp,
  Zap,
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
  Heart,
  GraduationCap,
  Puzzle,
  Blocks,
  Dices,
  Palette,
  PenTool,
  Backpack,
  NotebookPen,
  BookOpen,
  PartyPopper,
  Package,
  Sparkle,
  Gem,
  Shirt,
  Sparkles,
} from 'lucide-react';

import Button from '../components/Button';
import ProductCard from '../components/ProductCard';
import { useCart } from '../App';
import SEO from '../components/SEO';
import { ProductSkeletonGrid } from '../components/Skeleton';

// ✅ Single Source of Truth (Games subcategories + routes)
import { GAMES_SUBCATEGORIES, gamesTo } from '../config/nav';

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

// ✅ Social Links (تقدر تعدّلهم بسهولة)
const FB_URL = 'https://www.facebook.com/maktabatdayrsharafaleilmia/';
const IG_URL = 'https://www.instagram.com/deirsharaf/';
const MAPS_URL = 'https://maps.app.goo.gl/JeK1tvF4jysnLgjM9?g_st=iw';

// ✅ WhatsApp (عدّل الرقم فقط بدون +)
const WA_NUMBER = '9627XXXXXXXX'; // ← غيّر هذا الرقم لاحقاً
const WA_URL = `https://wa.me/${WA_NUMBER}`;

// ✅ Stationery + Gifts
const STATIONERY_SUBCATEGORIES = [
  { sub: 'Pens', labelAr: 'أقلام', labelEn: 'Pens' },
  { sub: 'Notebooks', labelAr: 'دفاتر', labelEn: 'Notebooks' },
  { sub: 'Colors', labelAr: 'ألوان', labelEn: 'Colors' },
  { sub: 'Bags', labelAr: 'حقائب', labelEn: 'Bags' },
  { sub: 'School', labelAr: 'قرطاسية مدرسية', labelEn: 'School Supplies' },
];

const GIFTS_SUBCATEGORIES = [
  { sub: 'Occasions', labelAr: 'مناسبات', labelEn: 'Occasions' },
  { sub: 'Wrap', labelAr: 'تغليف', labelEn: 'Gift Wrap' },
  { sub: 'Kids', labelAr: 'هدايا أطفال', labelEn: 'Kids Gifts' },
  { sub: 'Accessories', labelAr: 'إكسسوارات', labelEn: 'Accessories' },
  { sub: 'Premium', labelAr: 'هدايا فخمة', labelEn: 'Premium Gifts' },
];

// ✅ routes
const stationeryTo = (sub: string) => `/shop?filter=Stationery&sub=${encodeURIComponent(sub)}`;
const giftsTo = (sub: string) => `/shop?filter=Gifts&sub=${encodeURIComponent(sub)}`;

// ✅ pick icon automatically from sub text (fallback if no image)
const pickGameIcon = (subRaw: string) => {
  const s = (subRaw || '').toLowerCase();
  if (s.includes('boy') || s.includes('boys') || s.includes('male') || s.includes('toddler') || s.includes('baby')) return Baby;
  if (s.includes('girl') || s.includes('girls') || s.includes('female')) return Heart;
  if (s.includes('edu') || s.includes('learn') || s.includes('study') || s.includes('school') || s.includes('teach')) return GraduationCap;
  if (s.includes('puzzle') || s.includes('brain') || s.includes('logic')) return Puzzle;
  if (s.includes('build') || s.includes('lego') || s.includes('blocks') || s.includes('construction')) return Blocks;
  if (s.includes('board') || s.includes('dice') || s.includes('cards') || s.includes('party')) return Dices;
  return Gamepad2;
};

const pickStationeryIcon = (subRaw: string) => {
  const s = (subRaw || '').toLowerCase();
  if (s.includes('pen')) return PenTool;
  if (s.includes('note') || s.includes('book')) return NotebookPen;
  if (s.includes('color') || s.includes('paint')) return Palette;
  if (s.includes('bag') || s.includes('back')) return Backpack;
  if (s.includes('school')) return BookOpen;
  return PencilRuler;
};

const pickGiftsIcon = (subRaw: string) => {
  const s = (subRaw || '').toLowerCase();
  if (s.includes('occasion') || s.includes('event')) return PartyPopper;
  if (s.includes('wrap') || s.includes('pack')) return Package;
  if (s.includes('kid') || s.includes('child')) return Sparkle;
  if (s.includes('access')) return Shirt;
  if (s.includes('premium') || s.includes('lux') || s.includes('vip')) return Gem;
  return Gift;
};

type CardVariant = 'games' | 'stationery' | 'gifts';
const normalize = (v: string) => (v || '').toLowerCase().trim();

/**
 * ✅ هنا بس تحط صورك لكل فئة (بدون أي تعديل ثاني)
 * - المفتاح هو sub نفسه (لا تغيّره)
 * - حط الرابط تبع الصورة
 */
const SUBCATEGORY_IMAGES: Record<CardVariant, Record<string, string>> = {
  games: {
    boys: '/images/hero-school-19202.webp',
    girls: '/images/subs/games-girls.webp',
    baby: '/images/subs/games-baby.webp',
    educational: '/images/subs/games-educational.webp',
    puzzles: '/images/subs/games-puzzles.webp',
    blocks: '/images/subs/games-blocks.webp',
    board: '/images/subs/games-board.webp',
    generic: '/images/subs/games-generic.webp',
  },
  stationery: {
    Pens: '/images/subs/stationery-pens.webp',
    Notebooks: '/images/subs/stationery-notebooks.webp',
    Colors: '/images/subs/stationery-colors.webp',
    Bags: '/images/subs/stationery-bags.webp',
    School: '/images/subs/stationery-school.webp',
  },
  gifts: {
    Occasions: '/images/subs/gifts-occasions.webp',
    Wrap: '/images/subs/gifts-wrap.webp',
    Kids: '/images/subs/gifts-kids.webp',
    Accessories: '/images/subs/gifts-accessories.webp',
    Premium: '/images/subs/gifts-premium.webp',
  },
};

const getSubImage = (variant: CardVariant, sub: string) => {
  const dict = SUBCATEGORY_IMAGES?.[variant] || {};

  // ✅ exact match
  if (dict[sub]) return dict[sub];

  // ✅ normalized exact
  const nSub = normalize(sub);
  const exactNormalizedKey = Object.keys(dict).find((k) => normalize(k) === nSub);
  if (exactNormalizedKey) return dict[exactNormalizedKey];

  // ✅ SMART mapping for games (works with any sub naming)
  if (variant === 'games') {
    const s = nSub;
    const hit = (keys: string[]) => keys.some((k) => s.includes(k));

    if (hit(['boy', 'boys', 'male', 'ولادي', 'اولاد', 'أولاد'])) return dict['boys'] || '';
    if (hit(['girl', 'girls', 'female', 'بناتي', 'بنات'])) return dict['girls'] || '';
    if (hit(['baby', 'toddler', '0-9', '0–9', 'month', 'months', 'رضع', 'رُضّع'])) return dict['baby'] || '';
    if (hit(['edu', 'learn', 'teach', 'school', 'تعليمي', 'تعليم'])) return dict['educational'] || '';
    if (hit(['puzzle', 'brain', 'logic', 'ألغاز', 'لغز'])) return dict['puzzles'] || '';
    if (hit(['build', 'lego', 'blocks', 'construction', 'تركيب', 'بناء'])) return dict['blocks'] || '';
    if (hit(['board', 'dice', 'cards', 'party', 'جماعي', 'جماعية'])) return dict['board'] || '';

    return dict['generic'] || '';
  }

  return '';
};

// =========================================================
// ✅ World-Class: Preload Helper (للصور المهمة جداً مثل الهيرو)
// =========================================================
const preloadImage = (src?: string) => {
  if (!src) return;

  // ✅ 1) تحميل استباقي عبر Image (سريع وبسيط)
  const img = new Image();
  img.decoding = 'async';
  img.src = src;

  // ✅ 2) إضافة <link rel="preload"> (أقوى للـLCP)
  const id = `preload-${src}`;
  if (document.getElementById(id)) return;

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'preload';
  link.as = 'image';
  link.href = src;
  // ملاحظة: لا نضيف fetchpriority هنا لأن بعض المتصفحات لا تدعمه على link
  document.head.appendChild(link);
};

// =========================================================
// ✅ Components (خارج Home لتحسين الأداء وعدم إعادة الإنشاء)
// =========================================================
type SubCardProps = {
  title: string;
  Icon: any;
  to: string;
  variant: CardVariant;
  subKey: string;
  subtitle: string;
};

const SubCard: React.FC<SubCardProps> = ({ title, Icon, to, variant, subKey, subtitle }) => {
  const theme = {
    games: {
      card: 'bg-amber-50 border-amber-100 hover:bg-amber-100/40 hover:border-amber-200 focus:ring-amber-200',
      circle: 'bg-amber-100 border-amber-300 group-hover:bg-amber-200 group-hover:border-amber-400',
      icon: 'text-amber-700 group-hover:text-amber-800',
    },
    stationery: {
      card: 'bg-sky-50 border-sky-100 hover:bg-sky-100/40 hover:border-sky-200 focus:ring-sky-200',
      circle: 'bg-sky-100 border-sky-300 group-hover:bg-sky-200 group-hover:border-sky-400',
      icon: 'text-sky-700 group-hover:text-sky-800',
    },
    gifts: {
      card: 'bg-violet-50 border-violet-100 hover:bg-violet-100/40 hover:border-violet-200 focus:ring-violet-200',
      circle: 'bg-violet-100 border-violet-300 group-hover:bg-violet-200 group-hover:border-violet-400',
      icon: 'text-violet-700 group-hover:text-violet-800',
    },
  }[variant];

  const imgSrc = getSubImage(variant, subKey);

  return (
    <Link
      to={to}
      className={`
        group
        rounded-2xl
        border
        px-5 py-6 sm:px-6 sm:py-7
        shadow-[0_1px_0_rgba(15,23,42,0.03)]
        transition-all duration-300
        hover:-translate-y-[2px]
        hover:shadow-[0_14px_35px_rgba(15,23,42,0.08)]
        focus:outline-none focus:ring-2
        active:translate-y-0
        ${theme.card}
      `}
      aria-label={title}
    >
      <div className="flex flex-col items-center text-center">
        {/* ✅ الدائرة المنقّطة */}
        <div
          className={`
            w-24 h-24 sm:w-28 sm:h-28 lg:w-32 lg:h-32
            rounded-full
            border-2 border-dashed
            flex items-center justify-center
            transition-all duration-300
            ${theme.circle}
          `}
        >
          {/* ✅ صورة (Lazy) + fallback Icon بدون state (أداء أفضل) */}
          {imgSrc ? (
            <div className="w-full h-full rounded-full overflow-hidden shadow-md">
              <img
                src={imgSrc}
                alt={title}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                loading="lazy"
                decoding="async"
                width={256}
                height={256}
                style={{ aspectRatio: '1 / 1' }} // ✅ يمنع CLS
                draggable={false}
                onError={(e) => {
                  // ✅ fallback: إذا الصورة فشلت، نخفيها ونظهر الآيكون عبر DOM بسيط
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
              {/* ✅ الآيكون موجود دائماً تحت الصورة، وسيظهر تلقائياً إذا الصورة اختفت */}
              <div className="absolute opacity-0 pointer-events-none" />
            </div>
          ) : null}

          {/* ✅ fallback icon (يظهر إذا لا يوجد imgSrc أو لو الصورة اختفت) */}
          {!imgSrc && (
            <Icon
              size={40}
              strokeWidth={2.8}
              className={`transition-all duration-300 group-hover:scale-[1.06] ${theme.icon}`}
            />
          )}
        </div>

        <h3 className="mt-4 text-sm sm:text-base font-black text-slate-900 tracking-tight">{title}</h3>
        <p className="mt-1 text-[11px] sm:text-xs font-bold text-slate-500">{subtitle}</p>
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
  items: Array<{ sub: string; labelAr: string; labelEn: string; Icon?: any }>;
  toFn: (sub: string) => string;
  L: (ar: string, en: string) => string;
};

const CategorySection: React.FC<CategorySectionProps> = ({
  titleAr,
  titleEn,
  descAr,
  descEn,
  viewAllTo,
  Icon,
  items,
  toFn,
  variant,
  L,
}) => (
  <section className="py-10 lg:py-14">
    <div className="container mx-auto px-4 lg:px-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6 lg:mb-8">
        <div className="text-center sm:text-right rtl:sm:text-right ltr:sm:text-left">
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
          className="
            inline-flex items-center justify-center gap-2
            rounded-full px-5 py-2.5
            bg-white border border-slate-200
            text-slate-800 font-semibold
            hover:border-secondary-DEFAULT hover:text-secondary-DEFAULT
            transition
          "
          aria-label="View all"
        >
          {L('عرض الكل', 'View All')}
          <ArrowLeft size={16} className="rtl:rotate-0 ltr:rotate-180" />
        </Link>
      </div>

      {/* ✅ Responsive: موبايل 2 جنب بعض */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 lg:gap-5">
        {items.map((it, index) => {
          const sub = String(it?.sub ?? `item-${index}`);
          const title = L(String(it?.labelAr ?? 'قسم'), String(it?.labelEn ?? 'Category'));
          const ItemIcon = it?.Icon ?? Shapes;

          return (
            <SubCard
              key={`${sub}-${index}`}
              title={title}
              Icon={ItemIcon}
              to={toFn(sub)}
              variant={variant}
              subKey={sub}
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

  const slides = useMemo<HeroSlide[]>(
    () => [
      {
        key: 'back-to-school',
        badge: String((t('hero_badge') as string) ?? L('جديد الموسم: تشكيلة العودة للمدارس', 'New season: Back to School picks')),
        title1: L('مكتبة دير شرف', 'Dair Sharaf'),
        title2: L('العلمية', 'Scientific Store'),
        desc: L(
          'قرطاسية، حقائب، أدوات ذكية… كل ما تحتاجه العائلة والطلاب بجودة عالية.',
          'Stationery, bags, and smart essentials — everything students and families need with great quality.'
        ),
        ctaText: L('تسوق القرطاسية', 'Shop Stationery'),
        ctaLink: '/shop?filter=Stationery',
        image: FALLBACK_HERO,
        emoji: '🎒',
      },
      {
        key: 'toys',
        badge: L('الأكثر طلبًا للأطفال', 'Most Popular for Kids'),
        title1: L('ألعاب', 'Safe Toys'),
        title2: L('آمنة وتعليمية', 'and Educational'),
        desc: L(
          'ألعاب مختارة بعناية حسب العمر لتنمية المهارات وإضافة المرح لكل طفل.',
          'Carefully selected toys by age to build skills and add fun for every child.'
        ),
        ctaText: L('تسوق الألعاب', 'Shop Games'),
        ctaLink: '/shop?filter=Games',
        image: FALLBACK_HERO,
        emoji: '🧸',
      },
      {
        key: 'gifts',
        badge: L('هدايا لكل المناسبات', 'Gifts for Every Occasion'),
        title1: L('هدايا', 'Special Gifts'),
        title2: L('تليق بالمناسبات', 'for Every Moment'),
        desc: L(
          'اختيارات راقية للهدايا واللوازم المكتبية والمنتجات الجميلة للمناسبات.',
          'Premium picks for gifts, office supplies, and beautiful items for special moments.'
        ),
        ctaText: L('تسوق الهدايا', 'Shop Gifts'),
        ctaLink: '/shop?filter=Gifts',
        image: FALLBACK_HERO,
        emoji: '🎁',
      },
    ],
    [t, language, L]
  );

  const [activeSlide, setActiveSlide] = useState<number>(0);
  const [isPaused, setIsPaused] = useState(false);

  const goNext = useCallback(() => {
    setActiveSlide((s) => (slides.length ? (s + 1) % slides.length : 0));
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setActiveSlide((s) => (slides.length ? (s - 1 + slides.length) % slides.length : 0));
  }, [slides.length]);

  // ✅ Swipe / Drag
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

    if (delta < 0) {
      isRTL ? goPrev() : goNext();
    } else {
      isRTL ? goNext() : goPrev();
    }
  };

  const onPointerLeave = () => {
    dragging.current = false;
    dragStartX.current = null;
  };

  useEffect(() => {
    if (activeSlide >= slides.length) setActiveSlide(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  // ✅ Auto rotate
  useEffect(() => {
    if (slides.length <= 1) return;
    if (isPaused) return;

    const id = window.setInterval(() => {
      setActiveSlide((s) => (s + 1) % slides.length);
    }, ROTATE_MS);

    return () => window.clearInterval(id);
  }, [slides.length, isPaused]);

  const slide = slides[activeSlide] ?? slides[0];

  // =========================================================
  // ✅ World-Class: Hero Image Preload
  // =========================================================
  /**
   * ✅ نعمل preload للصورة الحالية (LCP) + التالية (للانتقال السريع)
   * - هذا يرفع الأداء ويقلل تأخير ظهور الصورة
   */
  useEffect(() => {
    if (!slides.length) return;

    // current (LCP)
    preloadImage(slide?.image?.s1200 || FALLBACK_HERO.s1200);

    // next (smooth slide)
    const next = slides[(activeSlide + 1) % slides.length];
    preloadImage(next?.image?.s1200 || FALLBACK_HERO.s1200);
  }, [activeSlide, slides, slide?.image?.s1200]);

  // ✅ Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') (isRTL ? goPrev() : goNext());
      if (e.key === 'ArrowLeft') (isRTL ? goNext() : goPrev());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, goPrev, isRTL]);

  const featuredProducts = useMemo(() => {
    const list = Array.isArray(products) ? products : [];
    const picked = list.filter((p: any) => !!p?.isFeatured).slice(0, 4);
    return picked.length ? picked : list.slice(0, 4);
  }, [products]);

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

  const trustItems = useMemo(
    () => [
      { Icon: Truck, labelAr: 'شحن سريع', labelEn: 'Fast Shipping' },
      { Icon: ShieldCheck, labelAr: 'دفع آمن', labelEn: 'Secure Payment' },
      { Icon: RefreshCcw, labelAr: 'استرجاع سهل', labelEn: 'Easy Returns' },
      { Icon: Headset, labelAr: 'دعم سريع', labelEn: 'Quick Support' },
    ],
    []
  );

  // ✅ decorated lists
  const gameSubsDecorated = useMemo(() => {
    const list = Array.isArray(GAMES_SUBCATEGORIES) ? GAMES_SUBCATEGORIES : [];
    return list
      .filter((x: any) => x?.sub !== 'all')
      .map((x: any) => {
        const sub = String(x?.sub ?? '');
        return { ...x, sub, Icon: pickGameIcon(sub) };
      });
  }, []);

  const stationeryDecorated = useMemo(() => {
    return STATIONERY_SUBCATEGORIES.map((x) => ({ ...x, Icon: pickStationeryIcon(x.sub) }));
  }, []);

  const giftsDecorated = useMemo(() => {
    return GIFTS_SUBCATEGORIES.map((x) => ({ ...x, Icon: pickGiftsIcon(x.sub) }));
  }, []);

  // =========================================================
  // ✅ Footer Config (هنا كل الأشياء اللي بدك تعدّلها لاحقاً)
  // =========================================================
  const STORE_INFO = useMemo(
    () => ({
      // ✅ الاسم
      nameAr: 'مكتبة دير شرف العلمية',
      nameEn: 'Dair Sharaf Scientific Library',

      // ✅ الشعار (تقدر تغيّره لاحقاً بسهولة)
      sloganAr: 'تنوّع، جودة، وتوصيل سريع — كل احتياجاتك في مكان واحد.',
      sloganEn: 'Variety, quality, and fast delivery — everything you need in one place.',

      // ✅ العنوان الحقيقي
      addressAr: 'عمّان - دوار النزهة - مقابل بنك الأردن',
      addressEn: 'Amman - Al Nozha Circle - Opposite Bank of Jordan',

      // ✅ مدة التوصيل
      deliveryAr: 'من 12 ساعة إلى 48 ساعة لجميع محافظات الأردن',
      deliveryEn: '12 to 48 hours delivery across Jordan',

      // ✅ سياسة الشحن المجاني (حسب كلامك)
      freeShippingAr: 'الشحن المجاني للطلبات فوق 20 دينار (قابل للتعديل لاحقاً)',
      freeShippingEn: 'Free shipping for orders over 20 JOD (subject to change)',

      // ✅ طرق الدفع
      paymentAr: 'الدفع: كاش أو تحويل عن طريق كليك',
      paymentEn: 'Payment: Cash or CliQ transfer',

      // ✅ رقم الهاتف (افتراضي للتعديل)
      phoneDisplay: '+962 7X XXX XXXX', // ← اكتب الرقم اللي بدك ينعرض للناس
      phoneTel: 'tel:+9627XXXXXXXX', // ← اكتب الرقم بصيغة الاتصال

      // ✅ البريد (إذا ما عندك بريد رسمي، خليه مؤقت)
      email: 'support@deirsharaf.com', // ← عدّله لاحقاً
    }),
    []
  );

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
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerLeave}
        onPointerLeave={onPointerLeave}
        style={{ touchAction: 'pan-y' }}
      >
        {/* Background */}
        <div className="absolute top-0 right-0 w-3/4 lg:w-1/2 h-full bg-gradient-to-l from-primary-light/50 to-transparent rounded-bl-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-2/3 lg:w-1/3 h-2/3 bg-gradient-to-t from-secondary-light/50 to-transparent rounded-tr-[100px] pointer-events-none" />
        <div className="absolute top-20 left-20 w-16 h-16 bg-primary-DEFAULT/20 rounded-full blur-2xl animate-pulse" />

        <div className="container mx-auto px-4 lg:px-8 relative z-10">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            {/* Text */}
            <div className="flex-1 text-center lg:text-right rtl:lg:text-right ltr:lg:text-left order-2 lg:order-1">
              {/* Brand */}
              <div className="mb-6">
                <h1 className="text-3xl sm:text-4xl lg:text-6xl font-heading font-extrabold text-slate-900 tracking-tight leading-[1.15]">
                  {L('مكتبة دير شرف العلمية', 'Dair Sharaf Scientific Library')}
                </h1>

                <div className="mt-2 flex items-center justify-center lg:justify-start gap-3 text-slate-500">
                  <span className="text-sm sm:text-base font-semibold">{L('منذ عام 2000', 'Since 2000')}</span>
                  <span className="w-1 h-1 rounded-full bg-slate-300" />

                  <div className="flex items-center gap-2">
                    <a
                      href={FB_URL}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Facebook"
                      title="Facebook"
                      className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center transition hover:-translate-y-[1px] hover:shadow-md active:scale-95"
                    >
                      <Facebook size={18} className="text-[#1877F2]" />
                    </a>

                    <a
                      href={IG_URL}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Instagram"
                      title="Instagram"
                      className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center transition hover:-translate-y-[1px] hover:shadow-md active:scale-95"
                    >
                      <Instagram size={18} className="text-[#E1306C]" />
                    </a>

                    <a
                      href={WA_URL}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="WhatsApp"
                      title="WhatsApp"
                      className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center transition hover:-translate-y-[1px] hover:shadow-md active:scale-95"
                    >
                      <MessageCircle size={18} className="text-[#25D366]" />
                    </a>

                    <a
                      href={MAPS_URL}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Maps"
                      title={L('الموقع على الخرائط', 'Open in Maps')}
                      className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center transition hover:-translate-y-[1px] hover:shadow-md active:scale-95"
                    >
                      <MapPin size={18} className="text-[#EA4335]" />
                    </a>
                  </div>
                </div>
              </div>

              {/* Badge */}
              <div className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-100 mb-5">
                <span className="text-lg" aria-hidden="true">
                  {slide?.emoji}
                </span>
                <span className="text-sm font-semibold text-slate-700">{slide?.badge}</span>
              </div>

              <p className="text-base sm:text-lg text-slate-600 mb-7 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                {slide?.desc}
              </p>

              {/* CTA */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Link to={slide?.ctaLink || '/shop'} aria-label="Primary CTA">
                  <Button size="lg" className="rounded-full w-full sm:w-auto px-7">
                    {slide?.ctaText}
                  </Button>
                </Link>

                <Link to="/shop?filter=Offers" aria-label="View offers">
                  <Button variant="outline" size="lg" className="rounded-full w-full sm:w-auto px-7">
                    {String(t('viewOffers') ?? L('شاهد العروض', 'View Offers'))}
                  </Button>
                </Link>
              </div>

              {/* Trust */}
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

              {/* Dots + Arrows */}
              {slides.length > 1 && (
                <div className="mt-6 flex items-center justify-center lg:justify-start gap-3">
                  <button
                    type="button"
                    onClick={() => (isRTL ? goNext() : goPrev())}
                    className="p-2 rounded-full bg-white border border-slate-200 hover:border-secondary-DEFAULT hover:text-secondary-DEFAULT transition focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT"
                    aria-label="Previous slide"
                  >
                    <ChevronRight size={18} />
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
                    onClick={() => (isRTL ? goPrev() : goNext())}
                    className="p-2 rounded-full bg-white border border-slate-200 hover:border-secondary-DEFAULT hover:text-secondary-DEFAULT transition focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT"
                    aria-label="Next slide"
                  >
                    <ChevronLeft size={18} />
                  </button>
                </div>
              )}

              {slides.length > 1 && (
                <p className="mt-3 text-xs text-slate-400 font-semibold">{L('اسحب يمين/يسار لتغيير العرض', 'Drag left/right to change')}</p>
              )}
            </div>

            {/* Image (LCP) */}
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
                    loading="eager" // ✅ LCP
                    decoding="async"
                    fetchPriority="high" // ✅ دعم المتصفحات الحديثة
                    draggable={false}
                    width={1200}
                    height={800}
                    style={{ aspectRatio: '3 / 2' }} // ✅ يقلل CLS حتى قبل تحميل الصورة
                  />
                </div>

                <div className="absolute -bottom-6 -right-2 lg:-right-6 bg-white p-3 lg:p-4 rounded-2xl shadow-xl border border-slate-100 flex items-center gap-3 scale-90 lg:scale-100">
                  <div className="bg-green-100 p-2 rounded-full text-green-600">
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-bold">{String(t('topSales') ?? L('مبيعات عالية', 'Top Sales'))}</p>
                    <p className="font-bold text-slate-900">+10k</p>
                  </div>
                </div>
              </div>

              <div className="absolute top-0 right-0 w-full h-full border-2 border-primary-DEFAULT rounded-3xl -z-10 translate-x-3 translate-y-3 lg:translate-x-4 lg:translate-y-4" />
            </div>
          </div>
        </div>
      </section>

      {/* ✅ Shop by Category */}
      <div className="bg-slate-50">
        <CategorySection
          titleAr="تسوّق الألعاب حسب الفئة"
          titleEn="Shop Games by Category"
          descAr="اختر النوع المناسب بسرعة (ولادي / بناتي / تعليمي...)"
          descEn="Pick the right type (boys / girls / educational...)"
          viewAllTo="/shop?filter=Games"
          Icon={Gamepad2}
          variant="games"
          items={gameSubsDecorated as any}
          toFn={(sub: string) => gamesTo(sub)}
          L={L}
        />

        <CategorySection
          titleAr="تسوّق القرطاسية حسب القسم"
          titleEn="Shop Stationery by Section"
          descAr="كل مستلزمات المدرسة والمكتب بشكل مرتب"
          descEn="Neatly organized school & office essentials"
          viewAllTo="/shop?filter=Stationery"
          Icon={PencilRuler}
          variant="stationery"
          items={stationeryDecorated as any}
          toFn={(sub: string) => stationeryTo(sub)}
          L={L}
        />

        <CategorySection
          titleAr="تسوّق الهدايا حسب النوع"
          titleEn="Shop Gifts by Type"
          descAr="هدايا مرتبة لكل المناسبات"
          descEn="Curated gifts for every occasion"
          viewAllTo="/shop?filter=Gifts"
          Icon={Gift}
          variant="gifts"
          items={giftsDecorated as any}
          toFn={(sub: string) => giftsTo(sub)}
          L={L}
        />

        <div className="container mx-auto px-4 lg:px-8 pb-6">
          <div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
        </div>
      </div>

      {/* Featured Products */}
      <section className="py-12 lg:py-20 bg-white">
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
                <Sparkles size={18} /> {String(t('specialOffer') ?? 'Special Offer')}
              </div>
              <h2 className="text-3xl lg:text-4xl font-bold mb-4 text-white">{String(t('offerTitle') ?? '')}</h2>
              <p className="text-white/85 mb-8 font-medium">{String(t('offerDesc') ?? '')}</p>

              <Link to="/shop?filter=Offers" aria-label="Browse offers">
                <Button variant="primary" className="bg-white text-slate-900 hover:bg-slate-100 border-none shadow-xl w-full sm:w-auto">
                  {String(t('browseCourses') ?? 'Browse')}
                </Button>
              </Link>
            </div>

            <div className="relative z-10">
              <div className="w-48 h-32 lg:w-64 lg:h-40 bg-white/20 backdrop-blur-md rounded-2xl border border-white/30 flex items-center justify-center rotate-6 shadow-2xl">
                <Zap fill="currentColor" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
          ✅ Footer عالمي (إضافة احترافية)
          - روابط واضحة + معلومات موثوقة
          - السياسات قابلة للفتح داخل نفس الصفحة
          - كل شيء قابل للتعديل من STORE_INFO فوق
         ========================================================= */}
      <footer className="mt-8 bg-slate-950 text-slate-200">
        <div className="container mx-auto px-4 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
            {/* 1) Brand + Slogan */}
            <div>
              <h3 className="text-2xl font-extrabold text-white">{L(STORE_INFO.nameAr, STORE_INFO.nameEn)}</h3>
              <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                {L(STORE_INFO.sloganAr, STORE_INFO.sloganEn)}
              </p>

              {/* Social (Brand Colors) */}
              <div className="mt-5 flex items-center gap-3">
                <a
                  href={WA_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="WhatsApp"
                  title="WhatsApp"
                  className="w-11 h-11 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center hover:bg-white/15 transition"
                >
                  <MessageCircle size={18} style={{ color: '#25D366' }} />
                </a>

                <a
                  href={IG_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Instagram"
                  title="Instagram"
                  className="w-11 h-11 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center hover:bg-white/15 transition"
                >
                  <Instagram size={18} style={{ color: '#E1306C' }} />
                </a>

                <a
                  href={FB_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Facebook"
                  title="Facebook"
                  className="w-11 h-11 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center hover:bg-white/15 transition"
                >
                  <Facebook size={18} style={{ color: '#1877F2' }} />
                </a>

                <a
                  href={MAPS_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Maps"
                  title={L('الموقع على الخرائط', 'Open in Maps')}
                  className="w-11 h-11 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center hover:bg-white/15 transition"
                >
                  <MapPin size={18} style={{ color: '#EA4335' }} />
                </a>
              </div>
            </div>

            {/* 2) معلومات المتجر */}
            <div>
              <h4 className="text-white font-extrabold mb-4">{L('معلومات المتجر', 'Store Info')}</h4>
              <ul className="space-y-3 text-sm text-slate-300">
                <li>
                  <span className="text-slate-400">{L('العنوان:', 'Address:')} </span>
                  {L(STORE_INFO.addressAr, STORE_INFO.addressEn)}
                </li>
                <li>
                  <span className="text-slate-400">{L('التوصيل:', 'Delivery:')} </span>
                  {L(STORE_INFO.deliveryAr, STORE_INFO.deliveryEn)}
                </li>
                <li>
                  <span className="text-slate-400">{L('الدفع:', 'Payment:')} </span>
                  {L(STORE_INFO.paymentAr, STORE_INFO.paymentEn)}
                </li>
                <li>
                  <span className="text-slate-400">{L('الشحن المجاني:', 'Free Shipping:')} </span>
                  {L(STORE_INFO.freeShippingAr, STORE_INFO.freeShippingEn)}
                </li>

                {/* ✅ هاتف + إيميل (قابلة للتعديل من STORE_INFO) */}
                <li>
                  <span className="text-slate-400">{L('الهاتف:', 'Phone:')} </span>
                  <a href={STORE_INFO.phoneTel} className="text-white hover:underline">
                    {STORE_INFO.phoneDisplay}
                  </a>
                </li>
                <li>
                  <span className="text-slate-400">{L('البريد:', 'Email:')} </span>
                  <a href={`mailto:${STORE_INFO.email}`} className="text-white hover:underline">
                    {STORE_INFO.email}
                  </a>
                </li>
              </ul>
            </div>

            {/* 3) روابط سريعة */}
            <div>
              <h4 className="text-white font-extrabold mb-4">{L('روابط سريعة', 'Quick Links')}</h4>
              <ul className="space-y-3 text-sm">
                <li>
                  <Link to="/shop" className="text-slate-300 hover:text-white transition">
                    {L('المتجر', 'Shop')}
                  </Link>
                </li>
                <li>
                  <Link to="/shop?filter=Offers" className="text-slate-300 hover:text-white transition">
                    {L('العروض', 'Offers')}
                  </Link>
                </li>
                <li>
                  <Link to="/shop?filter=Games" className="text-slate-300 hover:text-white transition">
                    {L('الألعاب', 'Games')}
                  </Link>
                </li>
                <li>
                  <Link to="/shop?filter=Stationery" className="text-slate-300 hover:text-white transition">
                    {L('القرطاسية', 'Stationery')}
                  </Link>
                </li>
                <li>
                  <Link to="/shop?filter=Gifts" className="text-slate-300 hover:text-white transition">
                    {L('الهدايا', 'Gifts')}
                  </Link>
                </li>
              </ul>
            </div>

            {/* 4) السياسات (تفتح النص داخل الصفحة) */}
            <div>
              <h4 className="text-white font-extrabold mb-4">{L('السياسات', 'Policies')}</h4>

              <div className="space-y-3">
                {/* سياسة الإرجاع */}
                <details className="rounded-2xl bg-white/5 border border-white/10 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-white">
                    {L('سياسة الإرجاع والاستبدال', 'Returns & Exchange Policy')}
                  </summary>
                  <div className="mt-3 text-sm text-slate-300 leading-relaxed space-y-2">
                    <p>نحرص على رضا العميل وجودة المنتجات، لذلك نوفّر سياسة إرجاع/استبدال واضحة.</p>
                    <p>
                      يمكنك طلب الإرجاع أو الاستبدال خلال <span className="text-white font-bold">24 ساعة</span> من وقت شراء/استلام
                      المنتج في حال وجود <span className="text-white font-bold">عطل مصنعي</span> أو مشكلة واضحة.
                    </p>
                    <p className="text-white font-bold">شروط الإرجاع:</p>
                    <ul className="list-disc ps-5 space-y-1">
                      <li>يجب أن يكون المنتج على حالته الأصلية كما استلمته.</li>
                      <li>وجود التغليف الأصلي قدر الإمكان.</li>
                      <li>إرفاق إثبات الشراء (فاتورة/رسالة الطلب).</li>
                    </ul>
                    <p className="text-white font-bold">حالات لا يشملها الإرجاع (إلا بوجود عطل مصنعي):</p>
                    <ul className="list-disc ps-5 space-y-1">
                      <li>التلف الناتج عن سوء الاستخدام أو الاستخدام غير المناسب.</li>
                    </ul>
                  </div>
                </details>

                {/* سياسة الخصوصية */}
                <details className="rounded-2xl bg-white/5 border border-white/10 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-white">{L('سياسة الخصوصية', 'Privacy Policy')}</summary>
                  <div className="mt-3 text-sm text-slate-300 leading-relaxed space-y-2">
                    <p>نحن نحترم خصوصيتك ونلتزم بحماية بياناتك عند استخدام موقعنا.</p>
                    <p className="text-white font-bold">المعلومات التي نجمعها:</p>
                    <ul className="list-disc ps-5 space-y-1">
                      <li>الاسم ورقم الهاتف وعنوان التوصيل.</li>
                      <li>البريد الإلكتروني (إن تم إدخاله).</li>
                      <li>معلومات الطلب (المنتجات، الكمية، القيمة).</li>
                      <li>بيانات تقنية عامة لتحسين الأداء والأمان.</li>
                    </ul>
                    <p className="text-white font-bold">كيف نستخدم المعلومات:</p>
                    <ul className="list-disc ps-5 space-y-1">
                      <li>تنفيذ الطلبات والتوصيل داخل الأردن.</li>
                      <li>التواصل بخصوص الطلب أو أي تحديثات.</li>
                      <li>تحسين تجربة الموقع وحمايته.</li>
                      <li>إرسال عروض عبر البريد فقط إذا اشتركت أنت بالنشرة.</li>
                    </ul>
                    <p className="text-white font-bold">مشاركة المعلومات:</p>
                    <ul className="list-disc ps-5 space-y-1">
                      <li>لا نبيع بياناتك لأي طرف ثالث.</li>
                      <li>قد نشارك بيانات التوصيل فقط مع شركة/مندوب التوصيل لتنفيذ الطلب.</li>
                    </ul>
                    <p className="text-slate-400">
                      ملاحظة: لا يوجد نظام على الإنترنت يضمن حماية 100%، لكننا نطبق إجراءات أمان مناسبة لحماية بياناتك.
                    </p>
                  </div>
                </details>

                {/* الشروط والأحكام */}
                <details className="rounded-2xl bg-white/5 border border-white/10 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-white">{L('الشروط والأحكام', 'Terms & Conditions')}</summary>
                  <div className="mt-3 text-sm text-slate-300 leading-relaxed space-y-2">
                    <p>باستخدامك للموقع فأنت توافق على ما يلي:</p>
                    <ul className="list-disc ps-5 space-y-1">
                      <li>الأسعار والمخزون قابلة للتغيير دون إشعار مسبق.</li>
                      <li>نلتزم عادةً بالتوصيل خلال 12–48 ساعة وقد تختلف حسب ضغط الطلبات أو الموقع.</li>
                      <li>طرق الدفع المتاحة: كاش أو تحويل عبر كليك.</li>
                      <li>المستخدم مسؤول عن إدخال بيانات صحيحة للتوصيل والتواصل.</li>
                      <li>يمنع إساءة استخدام الموقع أو محاولة اختراقه أو تعطيله.</li>
                      <li>أي نزاع يتم التعامل معه وفق الأنظمة المعمول بها داخل الأردن.</li>
                    </ul>
                  </div>
                </details>

                {/* الشحن والتوصيل */}
                <details className="rounded-2xl bg-white/5 border border-white/10 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-white">{L('الشحن والتوصيل', 'Shipping & Delivery')}</summary>
                  <div className="mt-3 text-sm text-slate-300 leading-relaxed space-y-2">
                    <ul className="list-disc ps-5 space-y-1">
                      <li>نوصل لجميع محافظات الأردن.</li>
                      <li>مدة التوصيل: 12 إلى 48 ساعة.</li>
                      <li>الشحن المجاني: للطلبات فوق 20 دينار (قابل للتعديل لاحقاً).</li>
                      <li>قد يتم التواصل مع العميل لتأكيد الطلب عند الحاجة.</li>
                    </ul>
                  </div>
                </details>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-xs text-slate-400">
            <p>
              © {new Date().getFullYear()} {L(STORE_INFO.nameAr, STORE_INFO.nameEn)} — {L('جميع الحقوق محفوظة', 'All rights reserved')}.
            </p>
            <p className="text-slate-500">
              {L('تم التطوير بعناية للأداء والأمان وتجربة مستخدم ممتازة.', 'Built with performance, security, and great UX in mind.')}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home;