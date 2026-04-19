// src/pages/Shop.tsx
import React, { useEffect, useMemo, useState, useDeferredValue } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Filter,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  X,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Crown, // تم إضافة أيقونة التاج للفخامة
} from 'lucide-react';

import ProductCard from '../components/ProductCard';
import { useCart } from '../App';
import { SortOption } from '../types';
import { ProductSkeletonGrid } from '../components/Skeleton';
import SEO from '../components/SEO';

const ITEMS_PER_PAGE = 24;
const PRICE_MIN = 0;
const PRICE_MAX = 1000;

type SubOption = { value: string; labelAr: string; labelEn: string };

// 🚀 الأقسام الرئيسية الجديدة (موحدة عشان تظهر بالقائمة الجانبية بشكل سليم)
const DISPLAY_CATEGORIES = [
  { id: 'Games', labelAr: 'الألعاب', labelEn: 'Toys' },
  { id: 'BabyGear', labelAr: 'مستلزمات بيبي وركوب', labelEn: 'Baby Gear & Ride-ons' },
  { id: 'Stationery', labelAr: 'قرطاسية ومدرسية', labelEn: 'Stationery & School' },
  { id: 'Gifts', labelAr: 'الهدايا والمناسبات', labelEn: 'Gifts & Occasions' },
  { id: 'Offers', labelAr: 'العروض والتصفيات', labelEn: 'Offers & Clearance' },
];

// 🚀 القاموس الشامل للأقسام الفرعية
const CATEGORY_SUBCATEGORIES: Record<string, SubOption[]> = {
  Games: [
    { value: 'all-toys', labelAr: 'جميع الألعاب', labelEn: 'All Toys' },
    { value: 'baby-toys', labelAr: 'ألعاب البيبي', labelEn: 'Baby Toys' },
    { value: 'girls-toys', labelAr: 'ألعاب للبنات', labelEn: 'Girls Toys' },
    { value: 'boys-toys', labelAr: 'ألعاب للأولاد', labelEn: 'Boys Toys' },
    { value: 'montessori', labelAr: 'ألعاب منتسوري', labelEn: 'Montessori' },
    { value: 'memory-focus', labelAr: 'الذاكرة والتركيز', labelEn: 'Memory & Focus' },
    { value: 'challenge-iq', labelAr: 'التحدي والذكاء', labelEn: 'Challenge & IQ' },
    { value: 'letters-words', labelAr: 'الحروف والكلمات', labelEn: 'Letters & Words' },
    { value: 'math-numbers', labelAr: 'الرياضيات والحساب', labelEn: 'Math & Numbers' },
    { value: 'science-experiments', labelAr: 'التجارب العلمية', labelEn: 'Science Experiments' },
    { value: 'drawing-coloring', labelAr: 'الرسم والتلوين', labelEn: 'Drawing & Coloring' },
    { value: 'kitchen-toys', labelAr: 'العاب مطابخ', labelEn: 'Kitchen Toys' },
    { value: 'kids-tents', labelAr: 'خيم الاطفال', labelEn: 'Kids Tents' },
    { value: 'audio-books', labelAr: 'الكتب الصوتية', labelEn: 'Audio Books' },
    { value: 'activity-books', labelAr: 'الكتب والانشطة', labelEn: 'Activity Books' },
    { value: 'sensory-toys', labelAr: 'ألعاب حسية', labelEn: 'Sensory Toys' },
    { value: 'building-blocks', labelAr: 'العاب التركيب', labelEn: 'Building Blocks' },
    { value: 'wooden-toys', labelAr: 'ألعاب خشبية', labelEn: 'Wooden Toys' },
    { value: 'magnetic-toys', labelAr: 'الالعاب المغناطيسية', labelEn: 'Magnetic Toys' },
    { value: 'group-games', labelAr: 'العاب جماعية', labelEn: 'Group Games' },
    { value: 'premium-toys', labelAr: 'الالعاب المميزة', labelEn: 'Premium Toys' },
    { value: 'matching-games', labelAr: 'ألعاب التطابق', labelEn: 'Matching Games' },
  ],
  BabyGear: [
    { value: 'bicycles', labelAr: 'بسكليتات', labelEn: 'Bicycles' },
    { value: 'ride-on-cars', labelAr: 'سيارات ركوب', labelEn: 'Ride-on Cars' },
    { value: 'kids-trucks', labelAr: 'شاحنات أطفال', labelEn: 'Kids Trucks' },
    { value: 'scooters', labelAr: 'سكوترات', labelEn: 'Scooters' },
    { value: 'rc-cars', labelAr: 'سيارات التحكم', labelEn: 'RC Cars' },
    { value: 'strollers', labelAr: 'عربيات الأطفال', labelEn: 'Strollers' },
    { value: 'bouncers-rockers', labelAr: 'كراسي هزازة / جلاسات', labelEn: 'Bouncers & Rockers' },
    { value: 'walkers', labelAr: 'مشايات أطفال', labelEn: 'Baby Walkers' },
    { value: 'playmats', labelAr: 'سجاد وفرشات لعب', labelEn: 'Playmats & Gyms' },
  ],
  Stationery: [
    { value: 'school-bags', labelAr: 'حقائب مدرسية', labelEn: 'School Bags' },
    { value: 'pencil-cases', labelAr: 'مقالم / حافظات أقلام', labelEn: 'Pencil Cases' },
    { value: 'lunch-bags', labelAr: 'حقائب طعام / لانش بوكس', labelEn: 'Lunch Bags' },
    { value: 'pens-ballpoint', labelAr: 'أقلام حبر وجاف', labelEn: 'Pens & Ballpoints' },
    { value: 'pencils', labelAr: 'أقلام رصاص', labelEn: 'Pencils' },
    { value: 'colors-markers', labelAr: 'أقلام تلوين وماركرز', labelEn: 'Colors & Markers' },
    { value: 'erasers-sharpeners', labelAr: 'محايات وبرايات', labelEn: 'Erasers & Sharpeners' },
    { value: 'notebooks', labelAr: 'دفاتر مدرسية بجميع الأحجام', labelEn: 'Notebooks' },
    { value: 'drawing-books', labelAr: 'دفاتر رسم وتلوين', labelEn: 'Drawing Books' },
    { value: 'covers-notes', labelAr: 'تجليد وورق ملاحظات', labelEn: 'Covers & Sticky Notes' },
    { value: 'geometry-rulers', labelAr: 'أدوات هندسة ومساطر', labelEn: 'Geometry & Rulers' },
    { value: 'glue-tape', labelAr: 'صمغ ولاصق', labelEn: 'Glue & Tape' },
    { value: 'clay-dough', labelAr: 'صلصال ومعجون', labelEn: 'Clay & Dough' },
    { value: 'safe-scissors', labelAr: 'مقصات آمنة', labelEn: 'Safe Scissors' },
  ],
  Gifts: [
    { value: 'gift-boxes', labelAr: 'صناديق وباكجات هدايا', labelEn: 'Gift Boxes & Bundles' },
    { value: 'wrapping-paper', labelAr: 'ورق تغليف وأكياس', labelEn: 'Wrapping Paper & Bags' },
    { value: 'greeting-cards', labelAr: 'بطاقات تهنئة', labelEn: 'Greeting Cards' },
    { value: 'party-supplies', labelAr: 'مستلزمات حفلات', labelEn: 'Party Supplies' },
  ],
  Offers: [
    { value: 'bundle', labelAr: 'باكج/حزمة التوفير', labelEn: 'Bundles' },
    { value: 'discount', labelAr: 'خصومات حصرية', labelEn: 'Discounts' },
    { value: 'clearance', labelAr: 'تصفية المخزون', labelEn: 'Clearance' },
  ],
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const safeLower = (v: unknown) => String(v ?? '').toLowerCase().trim();

const parseRating = (p: any) => {
  const raw = p?.ratingAvg ?? p?.avgRating ?? p?.rating ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

const parsePrice = (p: any) => {
  const n = Number(p?.price);
  return Number.isFinite(n) ? n : 0;
};

const getIdTimestamp = (id: unknown): number => {
  const s = String(id ?? '');
  const m = s.match(/^p-(\d+)-/);
  if (m?.[1]) return Number(m[1]) || 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
};

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const makePrefixes = (text: string, maxLen = 8) => {
  const out: string[] = [];
  const t = safeLower(text).replace(/\s+/g, ' ').trim();
  if (!t) return out;
  const parts = t.split(' ').filter(Boolean);
  for (const w of parts) {
    const ww = w.trim();
    if (!ww) continue;
    for (let i = 1; i <= Math.min(maxLen, ww.length); i += 1) {
      out.push(ww.slice(0, i));
    }
  }
  return Array.from(new Set(out));
};

const Shop: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { products, addToCart, toggleWishlist, wishlist, openQuickView, t, language, isLoading } = useCart() as any;

  const isRTL = useMemo(() => (language ?? 'ar') === 'ar', [language]);

  const tx = (key: string, fallbackAr: string, fallbackEn: string) => {
    try {
      const out = t(key);
      if (!out || String(out) === key) return isRTL ? fallbackAr : fallbackEn;
      return String(out);
    } catch {
      return isRTL ? fallbackAr : fallbackEn;
    }
  };

  const [isMobile, setIsMobile] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>('');
  const [priceRange, setPriceRange] = useState<[number, number]>([PRICE_MIN, PRICE_MAX]);
  const [minRating, setMinRating] = useState<number>(0);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // المتغير الأساسي اللي بحدد حالة الفخامة
  const isLuxury = selectedCategory === 'Gifts';

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (isMobile && isFilterOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isMobile, isFilterOpen]);

  const spKey = useMemo(() => searchParams.toString(), [searchParams]);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [spKey]);

  useEffect(() => {
    // 🚨 قراءة الرابط بناءً على النظام الجديد
    const rawCat = searchParams.get('category') || searchParams.get('filter');
    const isValidCategory = DISPLAY_CATEGORIES.some((c) => c.id === rawCat) || Object.keys(CATEGORY_SUBCATEGORIES).includes(rawCat as string);
    const cat = isValidCategory ? (rawCat as string) : 'All';

    const rawSub = (searchParams.get('sub') || '').trim();
    const pageNum = Number(searchParams.get('page')) || 1;

    setSelectedCategory(cat);
    setSelectedSubCategory(rawSub === 'all' ? '' : rawSub);
    setCurrentPage(pageNum > 0 ? Math.floor(pageNum) : 1);
  }, [searchParams]);

  const rawSearch = safeLower(searchParams.get('search'));
  const debouncedSearch = useDebouncedValue(rawSearch, 180);
  const deferredSearch = useDeferredValue(debouncedSearch);

  const searchIndex = useMemo(() => {
    const map = new Map<string, { full: string; prefixes: Set<string> }>();
    if (!Array.isArray(products)) return map;

    products.forEach((p: any) => {
      const id = String(p?.id ?? '');
      const full = `${p.name} ${p.nameEn} ${p.category} ${p.brand || ''} ${p.subcategory || p.subCategory || ''}`.toLowerCase();
      const prefixes = new Set<string>([
        ...makePrefixes(p.name || ''),
        ...makePrefixes(p.nameEn || ''),
        ...makePrefixes(p.brand || ''),
      ]);
      map.set(id, { full, prefixes });
    });

    return map;
  }, [products]);

  const filteredProducts = useMemo(() => {
    let result = Array.isArray(products) ? [...products] : [];

    if (deferredSearch) {
      result = result.filter((p) => {
        const entry = searchIndex.get(String(p.id));
        if (!entry) return false;
        return entry.full.includes(deferredSearch) || entry.prefixes.has(deferredSearch);
      });
    }

    if (selectedCategory !== 'All') {
      result = result.filter((p) => p.category === selectedCategory);
      
      if (selectedSubCategory) {
        result = result.filter((p) => {
          const prodSubValue = String(p?.subCategory || p?.subcategory || '').trim();
          if (!prodSubValue) return false;
          return prodSubValue.split(',').map(s => s.trim()).includes(selectedSubCategory);
        });
      }
    }

    result = result.filter((p) => {
      const pPrice = parsePrice(p);
      return pPrice >= priceRange[0] && pPrice <= priceRange[1];
    });

    if (minRating > 0) {
      result = result.filter((p) => parseRating(p) >= minRating);
    }

    switch (sortBy) {
      case 'price-asc':
        result.sort((a, b) => parsePrice(a) - parsePrice(b));
        break;
      case 'price-desc':
        result.sort((a, b) => parsePrice(b) - parsePrice(a));
        break;
      case 'rating':
        result.sort((a, b) => parseRating(b) - parseRating(a));
        break;
      default:
        result.sort((a, b) => {
          const aNew = !!a?.isNew;
          const bNew = !!b?.isNew;
          if (aNew && !bNew) return -1;
          if (!aNew && bNew) return 1;
          return getIdTimestamp(b?.id) - getIdTimestamp(a?.id);
        });
    }

    return result;
  }, [products, deferredSearch, searchIndex, selectedCategory, selectedSubCategory, priceRange, minRating, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (totalPages <= 1) next.delete('page');
        else next.set('page', String(totalPages));
        return next;
      });
    }
  }, [currentPage, totalPages, setSearchParams]);

  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredProducts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredProducts, currentPage]);

  const handlePageChange = (page: number) => {
    const p = clamp(Math.floor(page), 1, totalPages);
    setCurrentPage(p);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p <= 1) next.delete('page');
      else next.set('page', String(p));
      return next;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    setSelectedSubCategory('');
    setCurrentPage(1);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (cat === 'All') {
        next.delete('category');
        next.delete('filter');
      } else {
        next.set('category', cat);
        next.delete('filter');
      }
      next.delete('sub');
      next.delete('page');
      return next;
    });
  };

  const handleSubCategoryChange = (sub: string) => {
    const clean = String(sub ?? '').trim();
    setSelectedSubCategory(clean);
    setCurrentPage(1);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!clean) next.delete('sub');
      else next.set('sub', clean);
      next.delete('page');
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedCategory('All');
    setSelectedSubCategory('');
    setPriceRange([PRICE_MIN, PRICE_MAX]);
    setMinRating(0);
    setSortBy('newest');
    setCurrentPage(1);
    setIsFilterOpen(false);
    setSearchParams({});
  };

  const subCategoryOptions = useMemo(() => {
    if (selectedCategory === 'All') return [];
    return (CATEGORY_SUBCATEGORIES[selectedCategory] || []) as SubOption[];
  }, [selectedCategory]);

  const getCategoryLabel = (cat: string) => {
    if (cat === 'All') return tx('allProducts', 'كل المنتجات', 'All products');
    const item = DISPLAY_CATEGORIES.find((c) => c.id === cat);
    if (!item) return cat;
    return isRTL ? item.labelAr : item.labelEn;
  };

  const getSubCategoryLabel = (sub: string) => {
    if (!sub || selectedCategory === 'All') return sub;
    const item = subCategoryOptions.find((x) => x.value === sub);
    return item ? (isRTL ? item.labelAr : item.labelEn) : sub;
  };

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    const q = searchParams.get('search');

    if (q) {
      chips.push({
        key: 'q',
        label: `${tx('search', 'بحث', 'Search')}: "${q}"`,
        onRemove: () =>
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('search');
            next.delete('page');
            return next;
          }),
      });
    }

    if (selectedCategory !== 'All') {
      chips.push({
        key: 'cat',
        label: getCategoryLabel(selectedCategory),
        onRemove: () => handleCategoryChange('All'),
      });
    }

    if (selectedSubCategory) {
      chips.push({
        key: 'sub',
        label: getSubCategoryLabel(selectedSubCategory),
        onRemove: () => handleSubCategoryChange(''),
      });
    }

    if (priceRange[1] < PRICE_MAX) {
      chips.push({
        key: 'pr',
        label: `${tx('price', 'السعر', 'Price')}: 0 - ${priceRange[1]} JOD`,
        onRemove: () => setPriceRange([PRICE_MIN, PRICE_MAX]),
      });
    }

    if (minRating > 0) {
      chips.push({
        key: 'rating',
        label: `${minRating}+ ${tx('ratingHigh', 'تقييم', 'Rating')}`,
        onRemove: () => setMinRating(0),
      });
    }

    return chips;
  }, [searchParams, selectedCategory, selectedSubCategory, priceRange, minRating, isRTL, subCategoryOptions]);

  const visibleFrom = filteredProducts.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const visibleTo = Math.min(currentPage * ITEMS_PER_PAGE, filteredProducts.length);

  return (
    <div className={`min-h-screen pt-8 pb-24 transition-colors duration-700 ${isLuxury ? 'bg-[#0B0B0B]' : 'bg-slate-50'}`}>
      <SEO title={isLuxury ? 'AntarLuxi Collection' : tx('shop', 'المتجر', 'Shop')} />

      <div className="container mx-auto px-4 lg:px-8">
        <div className={`mb-8 lg:mb-10 overflow-hidden rounded-[2rem] border shadow-sm transition-colors duration-700 ${isLuxury ? 'border-[#D4AF37]/20 bg-[#121212]' : 'border-slate-100 bg-white'}`}>
          <div className="relative p-6 sm:p-8 lg:p-10">
            <div className={`absolute inset-0 transition-opacity duration-700 ${isLuxury ? 'bg-gradient-to-br from-[#D4AF37]/10 via-[#121212] to-[#000000] opacity-100' : 'bg-gradient-to-br from-[#EAB308]/10 via-white to-[#3B82F6]/10'}`} />
            
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black shadow-sm transition-colors ${isLuxury ? 'border-[#D4AF37]/30 bg-[#1A1A1A] text-[#D4AF37]' : 'border-slate-200 bg-white/80 text-slate-600'}`}>
                  <Sparkles size={14} className={isLuxury ? 'text-[#D4AF37]' : 'text-[#EAB308]'} />
                  {isLuxury ? 'AntarLuxi Exclusive Collection' : tx('shopIntro', 'تجربة تسوق مرتبة وواضحة', 'A refined, easy shopping experience')}
                </div>

                <h1 className={`mt-4 flex items-center gap-3 text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight transition-colors ${isLuxury ? 'font-serif text-[#D4AF37]' : 'font-heading text-slate-900'}`}>
                  {isLuxury ? <Crown className="text-[#D4AF37]" size={34} /> : <ShoppingBag className="text-sky-500" size={34} />}
                  {isLuxury ? 'AntarLuxi' : tx('shop', 'المتجر', 'Shop')}
                </h1>

                <p className={`mt-3 max-w-xl text-sm sm:text-base leading-7 transition-colors ${isLuxury ? 'text-gray-400' : 'text-slate-500'}`}>
                  {isLuxury 
                    ? 'اكتشف مجموعتنا الحصرية من الساعات الفاخرة، حيث تجتمع الأناقة الكلاسيكية مع الدقة المتناهية.' 
                    : tx('shopDescription', 'تصفّح المنتجات بسهولة، واستخدم الفلاتر الذكية للوصول إلى الخيارات المناسبة بسرعة.', 'Browse products with clarity and use smart filters to find the best matches faster.')}
                </p>

                <div className={`mt-5 flex flex-wrap items-center gap-3 text-sm font-semibold transition-colors ${isLuxury ? 'text-[#D4AF37]' : 'text-slate-500'}`}>
                  <span className={`rounded-full px-4 py-2 shadow-sm border ${isLuxury ? 'border-[#D4AF37]/20 bg-[#1A1A1A]' : 'border-slate-200 bg-white'}`}>
                    {filteredProducts.length} {tx('productsAvailable', 'منتج متاح', 'products available')}
                  </span>
                  <span className={`rounded-full px-4 py-2 shadow-sm border ${isLuxury ? 'border-[#D4AF37]/20 bg-[#1A1A1A]' : 'border-slate-200 bg-white'}`}>
                    {tx('showingRange', 'عرض', 'Showing')} {visibleFrom}-{visibleTo}
                  </span>
                  {activeChips.length > 0 && (
                    <span className={`rounded-full px-4 py-2 shadow-sm border ${isLuxury ? 'border-[#D4AF37]/20 bg-[#1A1A1A]' : 'border-slate-200 bg-white'}`}>
                      {activeChips.length} {tx('activeFilters', 'فلتر نشط', 'active filters')}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex w-full flex-col gap-3 sm:flex-row md:w-auto">
                <div className="relative min-w-0 flex-1 md:w-72">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className={`w-full appearance-none rounded-2xl border px-12 py-4 text-sm font-bold shadow-sm outline-none transition-all ${
                      isLuxury 
                        ? 'border-[#D4AF37]/40 bg-[#1A1A1A] text-[#D4AF37] focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20' 
                        : 'border-slate-200 bg-white text-slate-800 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20'
                    }`}
                  >
                    <option value="newest">{tx('newest', 'الأحدث', 'Newest')}</option>
                    <option value="price-asc">{tx('priceLowHigh', 'السعر: من الأقل للأعلى', 'Price: Low to High')}</option>
                    <option value="price-desc">{tx('priceHighLow', 'السعر: من الأعلى للأقل', 'Price: High to Low')}</option>
                    <option value="rating">{tx('ratingHigh', 'الأعلى تقييماً', 'Highest Rated')}</option>
                  </select>
                  <SlidersHorizontal
                    className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${isLuxury ? 'text-[#D4AF37]' : 'text-sky-500'} ${isRTL ? 'right-4' : 'left-4'}`}
                    size={18}
                  />
                </div>

                <button
                  onClick={() => setIsFilterOpen(true)}
                  className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-4 text-sm font-extrabold shadow-lg transition-all lg:hidden ${
                    isLuxury 
                      ? 'bg-[#D4AF37] text-black hover:bg-[#C5A028] shadow-[#D4AF37]/20' 
                      : 'bg-black text-white hover:bg-slate-800 shadow-black/20'
                  }`}
                  aria-label="Open Filters"
                >
                  <Filter size={18} />
                  {tx('filter', 'الفلاتر', 'Filters')}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
          <aside
            className={`fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 lg:relative lg:inset-auto lg:z-0 lg:bg-transparent ${
              isFilterOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none lg:opacity-100 lg:pointer-events-auto'
            }`}
            onClick={() => setIsFilterOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`absolute top-0 bottom-0 w-[88%] max-w-sm overflow-y-auto shadow-2xl transition-all duration-500 ease-out lg:relative lg:top-auto lg:bottom-auto lg:w-[300px] xl:w-[320px] lg:max-w-none lg:translate-x-0 lg:overflow-visible lg:rounded-[2rem] lg:border lg:shadow-xl ${
                isLuxury ? 'bg-[#121212] border-[#D4AF37]/20 shadow-[#D4AF37]/5' : 'bg-white border-slate-100 shadow-slate-200/40'
              } ${isRTL ? 'right-0' : 'left-0'} ${isFilterOpen ? 'translate-x-0' : isRTL ? 'translate-x-full' : '-translate-x-full'}`}
            >
              <div className="min-h-full p-6 lg:sticky lg:top-28 lg:p-7">
                <div className={`mb-8 flex items-center justify-between border-b pb-5 lg:mb-7 lg:border-b-0 lg:pb-0 ${isLuxury ? 'border-gray-800' : 'border-slate-100'}`}>
                  <div>
                    <p className={`text-[11px] font-black uppercase tracking-[0.25em] ${isLuxury ? 'text-[#D4AF37]/70' : 'text-slate-400'}`}>
                      {tx('filterPanel', 'لوحة الفلاتر', 'Filter panel')}
                    </p>
                    <h2 className={`mt-2 text-2xl font-black ${isLuxury ? 'text-[#D4AF37]' : 'text-slate-900'}`}>
                      {tx('filter', 'الفلاتر', 'Filters')}
                    </h2>
                  </div>

                  <button
                    onClick={() => setIsFilterOpen(false)}
                    className={`rounded-full p-2.5 transition-colors lg:hidden ${isLuxury ? 'bg-[#1A1A1A] text-gray-400 hover:bg-red-900/30 hover:text-red-500' : 'bg-slate-50 text-slate-400 hover:bg-red-50 hover:text-red-500'}`}
                  >
                    <X size={20} strokeWidth={3} />
                  </button>
                </div>

                <div className={`mb-8 rounded-2xl border p-4 ${isLuxury ? 'bg-[#1A1A1A] border-[#D4AF37]/20' : 'bg-slate-50 border-slate-100'}`}>
                  <div className={`flex items-center justify-between text-sm font-bold ${isLuxury ? 'text-gray-300' : 'text-slate-600'}`}>
                    <span>{tx('results', 'النتائج', 'Results')}</span>
                    <span className={`rounded-full px-3 py-1.5 shadow-sm ${isLuxury ? 'bg-[#D4AF37] text-black' : 'bg-white text-slate-900'}`}>
                      {filteredProducts.length}
                    </span>
                  </div>
                </div>

                <div className="mb-8">
                  <h3 className={`mb-4 text-[10px] font-black uppercase tracking-[0.25em] ${isLuxury ? 'text-[#D4AF37]/70' : 'text-slate-400'}`}>
                    {tx('categories', 'التصنيفات', 'Categories')}
                  </h3>

                  <div className="space-y-1.5 max-h-[42vh] overflow-y-auto pr-1 custom-scrollbar lg:max-h-[320px]">
                    <button
                      onClick={() => handleCategoryChange('All')}
                      className={`w-full rounded-2xl px-5 py-3.5 text-start text-sm font-bold transition-all ${
                        selectedCategory === 'All'
                          ? (isLuxury ? 'bg-[#D4AF37] text-black shadow-lg shadow-[#D4AF37]/20' : 'bg-black text-white shadow-lg shadow-black/20')
                          : (isLuxury ? 'text-gray-400 hover:bg-[#1A1A1A] hover:text-[#D4AF37]' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')
                      }`}
                    >
                      {tx('allProducts', 'كل المنتجات', 'All products')}
                    </button>

                    {DISPLAY_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => handleCategoryChange(cat.id)}
                        className={`w-full rounded-2xl px-5 py-3.5 text-start text-sm font-bold transition-all ${
                          selectedCategory === cat.id
                            ? (isLuxury ? 'bg-[#D4AF37] text-black shadow-lg shadow-[#D4AF37]/20' : 'bg-sky-400 text-white shadow-lg shadow-sky-400/30')
                            : (isLuxury ? 'text-gray-400 hover:bg-[#1A1A1A] hover:text-[#D4AF37]' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')
                        }`}
                      >
                        {isRTL ? cat.labelAr : cat.labelEn}
                      </button>
                    ))}
                  </div>
                </div>

                {selectedCategory !== 'All' && subCategoryOptions.length > 0 && (
                  <div className={`mb-8 border-t pt-8 ${isLuxury ? 'border-gray-800' : 'border-slate-100'}`}>
                    <h3 className={`mb-4 text-[10px] font-black uppercase tracking-[0.25em] ${isLuxury ? 'text-[#D4AF37]/70' : 'text-slate-400'}`}>
                      {tx('subCategory', 'التصنيف الفرعي', 'Subcategory')}
                    </h3>

                    <select
                      value={selectedSubCategory}
                      onChange={(e) => handleSubCategoryChange(e.target.value)}
                      className={`w-full appearance-none rounded-2xl border px-5 py-4 text-sm font-bold outline-none transition-all ${
                        isLuxury 
                          ? 'bg-[#1A1A1A] border-[#D4AF37]/20 text-[#D4AF37] focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20' 
                          : 'bg-slate-50 border-slate-200 text-slate-700 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20'
                      }`}
                    >
                      <option value="">{isRTL ? '— الكل —' : '— All —'}</option>
                      {subCategoryOptions.map((s) => (
                        <option key={s.value} value={s.value}>
                          {isRTL ? s.labelAr : s.labelEn}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className={`mb-8 border-t pt-8 ${isLuxury ? 'border-gray-800' : 'border-slate-100'}`}>
                  <h3 className={`mb-5 text-[10px] font-black uppercase tracking-[0.25em] ${isLuxury ? 'text-[#D4AF37]/70' : 'text-slate-400'}`}>
                    {tx('price', 'السعر', 'Price')}
                  </h3>

                  <input
                    type="range"
                    min={PRICE_MIN}
                    max={PRICE_MAX}
                    step={5}
                    value={priceRange[1]}
                    onChange={(e) => setPriceRange([PRICE_MIN, Number(e.target.value)])}
                    className={`w-full appearance-none rounded-full ${isLuxury ? 'accent-[#D4AF37]' : 'accent-sky-500'}`}
                  />

                  <div className="mt-5 flex items-center justify-between gap-3 text-[11px] font-black">
                    <span className={`rounded-xl border px-3 py-2 ${isLuxury ? 'bg-[#1A1A1A] border-gray-800 text-gray-500' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                      Min: 0
                    </span>
                    <span className={`rounded-xl border px-4 py-2 shadow-sm ${isLuxury ? 'bg-[#D4AF37]/10 border-[#D4AF37]/30 text-[#D4AF37]' : 'bg-sky-50 border-sky-100 text-sky-600'}`}>
                      Max: {priceRange[1]} JOD
                    </span>
                  </div>
                </div>

                <div className={`mb-8 border-t pt-8 ${isLuxury ? 'border-gray-800' : 'border-slate-100'}`}>
                  <h3 className={`mb-5 text-[10px] font-black uppercase tracking-[0.25em] ${isLuxury ? 'text-[#D4AF37]/70' : 'text-slate-400'}`}>
                    {tx('ratingHigh', 'التقييم', 'Rating')}
                  </h3>

                  <div className="grid grid-cols-2 gap-3">
                    {[4, 3, 2, 1].map((rating) => {
                      const active = minRating === rating;
                      return (
                        <button
                          key={rating}
                          onClick={() => setMinRating(active ? 0 : rating)}
                          className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition-all ${
                            active
                              ? (isLuxury ? 'border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#D4AF37] shadow-sm' : 'border-sky-200 bg-sky-50 text-sky-700 shadow-sm')
                              : (isLuxury ? 'border-gray-800 bg-[#121212] text-gray-400 hover:bg-[#1A1A1A]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')
                          }`}
                        >
                          <Star size={16} className={active ? 'fill-current' : ''} />
                          {rating}+
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  onClick={clearFilters}
                  className={`w-full rounded-2xl border-2 py-4 text-xs font-black uppercase tracking-widest transition-all active:scale-[0.99] ${
                    isLuxury 
                      ? 'border-[#D4AF37]/20 text-[#D4AF37] hover:bg-[#D4AF37]/10' 
                      : 'border-red-50 text-red-500 hover:border-red-100 hover:bg-red-50'
                  }`}
                >
                  {tx('clearAll', 'مسح الكل', 'Clear all')}
                </button>
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div className={`text-sm font-medium ${isLuxury ? 'text-gray-400' : 'text-slate-500'}`}>
                {tx('showingResults', 'عرض النتائج', 'Showing results')}:
                <span className={`ms-2 font-extrabold ${isLuxury ? 'text-[#D4AF37]' : 'text-slate-900'}`}>
                  {visibleFrom}-{visibleTo}
                </span>
                <span className={`mx-2 ${isLuxury ? 'text-gray-700' : 'text-slate-300'}`}>/</span>
                <span className={`font-extrabold ${isLuxury ? 'text-[#D4AF37]' : 'text-slate-900'}`}>{filteredProducts.length}</span>
              </div>

              <div className={`hidden lg:flex items-center gap-2 text-xs font-bold ${isLuxury ? 'text-gray-500' : 'text-slate-400'}`}>
                <span className={`inline-flex h-2 w-2 rounded-full ${isLuxury ? 'bg-[#D4AF37]' : 'bg-emerald-500'}`} />
                {tx('updatedInstantly', 'النتائج تتحدث مباشرة', 'Results update instantly')}
              </div>
            </div>

            {isLoading ? (
              <ProductSkeletonGrid count={12} />
            ) : paginatedProducts.length > 0 ? (
              <div className="grid grid-cols-1 gap-6 animate-in fade-in slide-in-from-bottom-6 duration-700 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {paginatedProducts.map((p: any, idx: number) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onAddToCart={addToCart}
                    onToggleWishlist={toggleWishlist}
                    onQuickView={openQuickView}
                    isLiked={wishlist.has(p.id)}
                    priority={idx < 6}
                  />
                ))}
              </div>
            ) : (
              <div className={`flex flex-col items-center justify-center rounded-[2.5rem] border border-dashed px-4 py-20 text-center lg:py-28 shadow-sm ${isLuxury ? 'border-[#D4AF37]/30 bg-[#121212]' : 'border-slate-200 bg-white'}`}>
                <div className={`mb-6 flex h-24 w-24 items-center justify-center rounded-full shadow-inner border ${isLuxury ? 'bg-[#1A1A1A] border-[#D4AF37]/20' : 'bg-slate-50 border-slate-100'}`}>
                  <Search className={isLuxury ? 'text-[#D4AF37]' : 'text-slate-300'} size={40} strokeWidth={2.5} />
                </div>

                <h2 className={`mb-3 text-2xl lg:text-3xl font-black tracking-tight ${isLuxury ? 'text-[#D4AF37]' : 'text-slate-900'}`}>
                  {tx('noProducts', 'لم نجد ما تبحث عنه!', 'No products found')}
                </h2>

                <p className={`mb-8 max-w-md text-sm sm:text-base leading-7 ${isLuxury ? 'text-gray-400' : 'text-slate-500'}`}>
                  {tx(
                    'noProductsDesc',
                    'عذراً، لا توجد منتجات تطابق الفلاتر الحالية. حاول تخفيف الفلاتر أو البحث بكلمة مختلفة.',
                    "Sorry, we couldn't find products matching your filters. Try adjusting them or clear all filters."
                  )}
                </p>

                <button
                  onClick={clearFilters}
                  className={`rounded-2xl px-8 py-4 font-extrabold shadow-xl transition-all hover:scale-105 active:scale-95 ${
                    isLuxury 
                      ? 'bg-[#D4AF37] text-black shadow-[#D4AF37]/20 hover:bg-[#C5A028]' 
                      : 'bg-black text-white shadow-black/20 hover:bg-slate-800'
                  }`}
                >
                  {tx('resetFilters', 'إعادة ضبط البحث', 'Reset search')}
                </button>
              </div>
            )}

            {totalPages > 1 && (
              <div className="mt-16 flex items-center justify-center gap-3 sm:gap-4">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className={`flex h-14 w-14 items-center justify-center rounded-2xl border transition-all disabled:opacity-30 sm:h-16 sm:w-16 ${
                    isLuxury 
                      ? 'bg-[#121212] border-gray-800 text-gray-400 hover:border-[#D4AF37] hover:text-[#D4AF37] hover:shadow-lg hover:shadow-[#D4AF37]/10 disabled:hover:border-gray-800 disabled:hover:text-gray-400' 
                      : 'bg-white border-slate-200 text-slate-600 hover:border-sky-400 hover:text-sky-500 hover:shadow-lg hover:shadow-sky-400/10 disabled:hover:border-slate-200 disabled:hover:text-slate-600'
                  }`}
                  aria-label="Previous Page"
                >
                  <ChevronRight className={isRTL ? '' : 'rotate-180'} size={24} strokeWidth={2.5} />
                </button>

                <div className={`flex items-center gap-2 rounded-2xl border px-6 py-4 shadow-sm sm:px-8 sm:py-5 ${isLuxury ? 'bg-[#1A1A1A] border-gray-800' : 'bg-white border-slate-200'}`}>
                  <span className={`tabular-nums text-sm sm:text-base font-black ${isLuxury ? 'text-[#D4AF37]' : 'text-slate-900'}`}>{currentPage}</span>
                  <span className={`mx-1 text-xs sm:text-sm font-bold ${isLuxury ? 'text-gray-600' : 'text-slate-300'}`}>/</span>
                  <span className={`tabular-nums text-sm sm:text-base font-bold ${isLuxury ? 'text-gray-500' : 'text-slate-400'}`}>{totalPages}</span>
                </div>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className={`flex h-14 w-14 items-center justify-center rounded-2xl border transition-all disabled:opacity-30 sm:h-16 sm:w-16 ${
                    isLuxury 
                      ? 'bg-[#121212] border-gray-800 text-gray-400 hover:border-[#D4AF37] hover:text-[#D4AF37] hover:shadow-lg hover:shadow-[#D4AF37]/10 disabled:hover:border-gray-800 disabled:hover:text-gray-400' 
                      : 'bg-white border-slate-200 text-slate-600 hover:border-sky-400 hover:text-sky-500 hover:shadow-lg hover:shadow-sky-400/10 disabled:hover:border-slate-200 disabled:hover:text-slate-600'
                  }`}
                  aria-label="Next Page"
                >
                  <ChevronLeft className={isRTL ? '' : 'rotate-180'} size={24} strokeWidth={2.5} />
                </button>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default Shop;