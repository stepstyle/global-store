// src/pages/Shop.tsx
import React, { useEffect, useMemo, useState, useDeferredValue } from 'react';
import { useSearchParams } from 'react-router-dom';
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
} from 'lucide-react';

import ProductCard from '../components/ProductCard';
import { CATEGORIES } from '../constants';
import { useCart } from '../App';
import { Category, SortOption } from '../types';
import { ProductSkeletonGrid } from '../components/Skeleton';
import SEO from '../components/SEO';

import { GAMES_SUBCATEGORIES } from '../config/nav';

const ITEMS_PER_PAGE = 24;
const PRICE_MIN = 0;
const PRICE_MAX = 1000;

type SubOption = { value: string; labelAr: string; labelEn: string };

const CATEGORY_SUBCATEGORIES: Partial<Record<Category, SubOption[]>> = {
  Games: GAMES_SUBCATEGORIES.filter((x) => x.sub !== 'all').map((x) => ({
    value: x.sub,
    labelAr: x.labelAr,
    labelEn: x.labelEn,
  })),

  Stationery: [
    { value: 'pencils', labelAr: 'أقلام رصاص', labelEn: 'Pencils' },
    { value: 'pens', labelAr: 'أقلام حبر', labelEn: 'Pens' },
    { value: 'markers', labelAr: 'أقلام تخطيط', labelEn: 'Markers' },
    { value: 'erasers', labelAr: 'محايات', labelEn: 'Erasers' },
    { value: 'sharpeners', labelAr: 'برايات', labelEn: 'Sharpeners' },
    { value: 'notebooks', labelAr: 'دفاتر', labelEn: 'Notebooks' },
    { value: 'colors', labelAr: 'ألوان', labelEn: 'Colors' },
    { value: 'geometry', labelAr: 'مساطر وأدوات هندسية', labelEn: 'Geometry Tools' },
    { value: 'stickers', labelAr: 'لواصق وستيكرات', labelEn: 'Stickers' },
    { value: 'files', labelAr: 'ملفات وفواصل', labelEn: 'Files/Folders' },
    { value: 'misc', labelAr: 'قرطاسية متنوعة', labelEn: 'Misc' },
  ],

  Offers: [
    { value: 'occasion', labelAr: 'هدايا مناسبات', labelEn: 'Occasion Gifts' },
    { value: 'kids', labelAr: 'هدايا للأطفال', labelEn: 'Kids Gifts' },
    { value: 'wrap', labelAr: 'تغليف وورق هدايا', labelEn: 'Gift Wrap' },
    { value: 'bouquets', labelAr: 'بوكيهات وورد', labelEn: 'Bouquets' },
    { value: 'bundle', labelAr: 'باكج/حزمة', labelEn: 'Bundle' },
    { value: 'discount', labelAr: 'خصم', labelEn: 'Discount' },
    { value: 'clearance', labelAr: 'تصفية', labelEn: 'Clearance' },
  ],

  Bags: [
    { value: 'school', labelAr: 'شنط مدرسية', labelEn: 'School Bags' },
    { value: 'backpack', labelAr: 'حقائب ظهر', labelEn: 'Backpacks' },
    { value: 'pencilcase', labelAr: 'مقلمات', labelEn: 'Pencil Cases' },
    { value: 'kids', labelAr: 'شنط أطفال', labelEn: 'Kids Bags' },
    { value: 'travel-mini', labelAr: 'شنط سفر صغيرة', labelEn: 'Small Travel Bags' },
  ],

  ArtSupplies: [
    { value: 'colors', labelAr: 'ألوان', labelEn: 'Colors' },
    { value: 'brushes', labelAr: 'فرش', labelEn: 'Brushes' },
    { value: 'canvas', labelAr: 'كانفاس', labelEn: 'Canvas' },
    { value: 'drawing-tools', labelAr: 'أدوات رسم', labelEn: 'Drawing Tools' },
    { value: 'clay', labelAr: 'صلصال', labelEn: 'Clay' },
  ],

  Courses: [
    { value: 'kids', labelAr: 'دورات أطفال', labelEn: 'Kids Courses' },
    { value: 'art', labelAr: 'دورات رسم', labelEn: 'Art Courses' },
    { value: 'support', labelAr: 'دورات تقوية', labelEn: 'Support Courses' },
    { value: 'languages', labelAr: 'دورات لغات', labelEn: 'Language Courses' },
  ],

  EducationalCards: [
    { value: 'letters', labelAr: 'بطاقات حروف', labelEn: 'Letters Cards' },
    { value: 'numbers', labelAr: 'بطاقات أرقام', labelEn: 'Numbers Cards' },
    { value: 'mix', labelAr: 'بطاقات تعليمية متنوعة', labelEn: 'Mixed Educational Cards' },
  ],
};

const CATEGORY_ALIASES: Record<string, Category> = {
  Gifts: 'Offers' as Category,
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

const getSubValue = (p: any) => String((p?.subcategory ?? p?.subCategory ?? '') as any).trim();

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
  }, [isMobile]);

  const spKey = useMemo(() => searchParams.toString(), [searchParams]);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [spKey]);

  const [selectedCategory, setSelectedCategory] = useState<Category | 'All'>('All');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>('');
  const [priceRange, setPriceRange] = useState<[number, number]>([PRICE_MIN, PRICE_MAX]);
  const [minRating, setMinRating] = useState<number>(0);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const rawCat = searchParams.get('filter');
    const aliased = rawCat ? CATEGORY_ALIASES[rawCat] || rawCat : null;
    const cat = CATEGORIES.some((c) => c.id === aliased) ? (aliased as Category) : 'All';

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
      const full = `${p.name} ${p.nameEn} ${p.category} ${p.brand || ''} ${p.subcategory || ''}`.toLowerCase();
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
        result = result.filter((p) => getSubValue(p) === selectedSubCategory);
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

  const handleCategoryChange = (cat: Category | 'All') => {
    setSelectedCategory(cat);
    setSelectedSubCategory('');
    setCurrentPage(1);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (cat === 'All') next.delete('filter');
      else next.set('filter', cat);
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

  const getCategoryLabel = (cat: Category | 'All') => {
    if (cat === 'All') return tx('allProducts', 'كل المنتجات', 'All products');
    const item = CATEGORIES.find((c) => c.id === cat);
    if (!item) return cat;
    return isRTL ? item.label : item.labelEn;
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
    <div className="min-h-screen bg-slate-50 pt-8 pb-24">
      <SEO title={tx('shop', 'المتجر', 'Shop')} />

      <div className="container mx-auto px-4 lg:px-8">
        <div className="mb-8 lg:mb-10 overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm">
          <div className="relative p-6 sm:p-8 lg:p-10">
            <div className="absolute inset-0 bg-gradient-to-br from-[#EAB308]/10 via-white to-[#3B82F6]/10" />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-xs font-black text-slate-600 shadow-sm">
                  <Sparkles size={14} className="text-[#EAB308]" />
                  {tx('shopIntro', 'تجربة تسوق مرتبة وواضحة', 'A refined, easy shopping experience')}
                </div>

                <h1 className="mt-4 flex items-center gap-3 text-3xl sm:text-4xl lg:text-5xl font-heading font-black tracking-tight text-slate-900">
                  <ShoppingBag className="text-sky-500" size={34} />
                  {tx('shop', 'المتجر', 'Shop')}
                </h1>

                <p className="mt-3 max-w-xl text-sm sm:text-base leading-7 text-slate-500">
                  {tx(
                    'shopDescription',
                    'تصفّح المنتجات بسهولة، واستخدم الفلاتر الذكية للوصول إلى الخيارات المناسبة بسرعة.',
                    'Browse products with clarity and use smart filters to find the best matches faster.'
                  )}
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-500">
                  <span className="rounded-full bg-white px-4 py-2 shadow-sm border border-slate-200">
                    {filteredProducts.length} {tx('productsAvailable', 'منتج متاح', 'products available')}
                  </span>
                  <span className="rounded-full bg-white px-4 py-2 shadow-sm border border-slate-200">
                    {tx('showingRange', 'عرض', 'Showing')} {visibleFrom}-{visibleTo}
                  </span>
                  {activeChips.length > 0 && (
                    <span className="rounded-full bg-white px-4 py-2 shadow-sm border border-slate-200">
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
                    className="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-12 py-4 text-sm font-bold text-slate-800 shadow-sm outline-none transition-all focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
                  >
                    <option value="newest">{tx('newest', 'الأحدث', 'Newest')}</option>
                    <option value="price-asc">{tx('priceLowHigh', 'السعر: من الأقل للأعلى', 'Price: Low to High')}</option>
                    <option value="price-desc">{tx('priceHighLow', 'السعر: من الأعلى للأقل', 'Price: High to Low')}</option>
                    <option value="rating">{tx('ratingHigh', 'الأعلى تقييماً', 'Highest Rated')}</option>
                  </select>
                  <SlidersHorizontal
                    className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-sky-500 ${isRTL ? 'right-4' : 'left-4'}`}
                    size={18}
                  />
                </div>

                <button
                  onClick={() => setIsFilterOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-black px-5 py-4 text-sm font-extrabold text-white shadow-lg shadow-black/20 transition-all hover:bg-slate-800 lg:hidden"
                  aria-label="Open Filters"
                >
                  <Filter size={18} />
                  {tx('filter', 'الفلاتر', 'Filters')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {activeChips.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {activeChips.map((c) => (
              <button
                key={c.key}
                onClick={c.onRemove}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 shadow-sm transition-all hover:border-red-100 hover:bg-red-50 hover:text-red-500"
              >
                <span>{c.label}</span>
                <X size={12} strokeWidth={3} />
              </button>
            ))}

            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-2 text-xs font-extrabold text-red-500 transition-all hover:bg-red-100"
            >
              {tx('clearAll', 'مسح الكل', 'Clear all')}
            </button>
          </div>
        )}

        <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
          <aside
            className={`fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 lg:relative lg:inset-auto lg:z-0 lg:bg-transparent ${
              isFilterOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none lg:opacity-100 lg:pointer-events-auto'
            }`}
            onClick={() => setIsFilterOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`absolute top-0 bottom-0 w-[88%] max-w-sm overflow-y-auto bg-white shadow-2xl transition-transform duration-500 ease-out lg:relative lg:top-auto lg:bottom-auto lg:w-[300px] xl:w-[320px] lg:max-w-none lg:translate-x-0 lg:overflow-visible lg:rounded-[2rem] lg:border lg:border-slate-100 lg:bg-white lg:shadow-xl lg:shadow-slate-200/40 ${
                isRTL ? 'right-0' : 'left-0'
              } ${isFilterOpen ? 'translate-x-0' : isRTL ? 'translate-x-full' : '-translate-x-full'}`}
            >
              <div className="min-h-full p-6 lg:sticky lg:top-28 lg:p-7">
                <div className="mb-8 flex items-center justify-between border-b border-slate-100 pb-5 lg:mb-7 lg:border-b-0 lg:pb-0">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">
                      {tx('filterPanel', 'لوحة الفلاتر', 'Filter panel')}
                    </p>
                    <h2 className="mt-2 text-2xl font-black text-slate-900">
                      {tx('filter', 'الفلاتر', 'Filters')}
                    </h2>
                  </div>

                  <button
                    onClick={() => setIsFilterOpen(false)}
                    className="rounded-full bg-slate-50 p-2.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 lg:hidden"
                  >
                    <X size={20} strokeWidth={3} />
                  </button>
                </div>

                <div className="mb-8 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between text-sm font-bold text-slate-600">
                    <span>{tx('results', 'النتائج', 'Results')}</span>
                    <span className="rounded-full bg-white px-3 py-1.5 text-slate-900 shadow-sm">
                      {filteredProducts.length}
                    </span>
                  </div>
                </div>

                <div className="mb-8">
                  <h3 className="mb-4 text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">
                    {tx('categories', 'التصنيفات', 'Categories')}
                  </h3>

                  <div className="space-y-1.5 max-h-[42vh] overflow-y-auto pr-1 custom-scrollbar lg:max-h-[320px]">
                    <button
                      onClick={() => handleCategoryChange('All')}
                      className={`w-full rounded-2xl px-5 py-3.5 text-start text-sm font-bold transition-all ${
                        selectedCategory === 'All'
                          ? 'bg-black text-white shadow-lg shadow-black/20'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      {tx('allProducts', 'كل المنتجات', 'All products')}
                    </button>

                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => handleCategoryChange(cat.id)}
                        className={`w-full rounded-2xl px-5 py-3.5 text-start text-sm font-bold transition-all ${
                          selectedCategory === cat.id
                            ? 'bg-sky-400 text-white shadow-lg shadow-sky-400/30'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        {isRTL ? cat.label : cat.labelEn}
                      </button>
                    ))}
                  </div>
                </div>

                {selectedCategory !== 'All' && subCategoryOptions.length > 0 && (
                  <div className="mb-8 border-t border-slate-100 pt-8">
                    <h3 className="mb-4 text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">
                      {tx('subCategory', 'التصنيف الفرعي', 'Subcategory')}
                    </h3>

                    <select
                      value={selectedSubCategory}
                      onChange={(e) => handleSubCategoryChange(e.target.value)}
                      className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold text-slate-700 outline-none transition-all focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
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

                <div className="mb-8 border-t border-slate-100 pt-8">
                  <h3 className="mb-5 text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">
                    {tx('price', 'السعر', 'Price')}
                  </h3>

                  <input
                    type="range"
                    min={PRICE_MIN}
                    max={PRICE_MAX}
                    step={5}
                    value={priceRange[1]}
                    onChange={(e) => setPriceRange([PRICE_MIN, Number(e.target.value)])}
                    className="w-full appearance-none rounded-full accent-sky-500"
                  />

                  <div className="mt-5 flex items-center justify-between gap-3 text-[11px] font-black">
                    <span className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-slate-400">
                      Min: 0
                    </span>
                    <span className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-2 text-sky-600 shadow-sm">
                      Max: {priceRange[1]} JOD
                    </span>
                  </div>
                </div>

                <div className="mb-8 border-t border-slate-100 pt-8">
                  <h3 className="mb-5 text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">
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
                              ? 'border-sky-200 bg-sky-50 text-sky-700 shadow-sm'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
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
                  className="w-full rounded-2xl border-2 border-red-50 py-4 text-xs font-black uppercase tracking-widest text-red-500 transition-all hover:border-red-100 hover:bg-red-50 active:scale-[0.99]"
                >
                  {tx('clearAll', 'مسح الكل', 'Clear all')}
                </button>
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-medium text-slate-500">
                {tx('showingResults', 'عرض النتائج', 'Showing results')}:
                <span className="ms-2 font-extrabold text-slate-900">
                  {visibleFrom}-{visibleTo}
                </span>
                <span className="mx-2 text-slate-300">/</span>
                <span className="font-extrabold text-slate-900">{filteredProducts.length}</span>
              </div>

              <div className="hidden lg:flex items-center gap-2 text-xs font-bold text-slate-400">
                <span className="inline-flex h-2 w-2 rounded-full bg-green-500" />
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
              <div className="flex flex-col items-center justify-center rounded-[2.5rem] border border-dashed border-slate-200 bg-white px-4 py-20 text-center lg:py-28">
                <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-sky-50 shadow-inner">
                  <Search className="text-sky-400" size={40} strokeWidth={2.5} />
                </div>

                <h2 className="mb-3 text-2xl lg:text-3xl font-black text-slate-900">
                  {tx('noProducts', 'لا توجد منتجات', 'No products found')}
                </h2>

                <p className="mb-8 max-w-md text-sm sm:text-base leading-7 text-slate-500">
                  {tx(
                    'noProductsDesc',
                    'لم نعثر على منتجات تطابق الفلاتر الحالية. جرّب تعديل الفلاتر أو امسحها كلها.',
                    "We couldn't find products matching your current filters. Try adjusting them or clear all filters."
                  )}
                </p>

                <button
                  onClick={clearFilters}
                  className="rounded-2xl bg-black px-8 py-4 font-extrabold text-white shadow-lg shadow-black/20 transition-all hover:bg-slate-800"
                >
                  {tx('resetFilters', 'إعادة ضبط الفلاتر', 'Reset filters')}
                </button>
              </div>
            )}

            {totalPages > 1 && (
              <div className="mt-16 flex items-center justify-center gap-3 sm:gap-4">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-all hover:border-sky-400 hover:text-sky-500 hover:shadow-lg hover:shadow-sky-400/10 disabled:opacity-30 disabled:hover:border-slate-200 disabled:hover:text-slate-600 sm:h-16 sm:w-16"
                  aria-label="Previous Page"
                >
                  <ChevronRight className={isRTL ? '' : 'rotate-180'} size={24} strokeWidth={2.5} />
                </button>

                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm sm:px-8 sm:py-5">
                  <span className="tabular-nums text-sm sm:text-base font-black text-slate-900">{currentPage}</span>
                  <span className="mx-1 text-xs sm:text-sm font-bold text-slate-300">/</span>
                  <span className="tabular-nums text-sm sm:text-base font-bold text-slate-400">{totalPages}</span>
                </div>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-all hover:border-sky-400 hover:text-sky-500 hover:shadow-lg hover:shadow-sky-400/10 disabled:opacity-30 disabled:hover:border-slate-200 disabled:hover:text-slate-600 sm:h-16 sm:w-16"
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