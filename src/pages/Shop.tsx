// src/pages/Shop.tsx
import React, { useEffect, useMemo, useState, useCallback, useDeferredValue } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter, SlidersHorizontal, ChevronLeft, ChevronRight, Star, X, Tag } from 'lucide-react';

import ProductCard from '../components/ProductCard';
import { CATEGORIES } from '../constants';
import { useCart } from '../App';
import { Category, SortOption, Product } from '../types';
import { ProductSkeletonGrid } from '../components/Skeleton';
import SEO from '../components/SEO';

// ✅ Single Source of Truth for Games subcategories (Navbar/Home)
import { GAMES_SUBCATEGORIES } from '../config/nav';

const ITEMS_PER_PAGE = 20;

// Keep these stable and consistent across the app
const PRICE_MIN = 0;
const PRICE_MAX = 1000;

type SubOption = { value: string; labelAr: string; labelEn: string };

// ✅ Subcategories (Slug-based)
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

// ✅ Category aliases for legacy URLs
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

// ✅ Cache all sub options once
const ALL_SUB_OPTIONS: SubOption[] = Object.values(CATEGORY_SUBCATEGORIES).flatMap((v) => (v || []) as SubOption[]);

// ✅ Debounce hook
function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

// ✅ Stable isMobile
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);

    if ((mql as any).addEventListener) (mql as any).addEventListener('change', onChange);
    else (mql as any).addListener(onChange);

    setIsMobile(mql.matches);

    return () => {
      if ((mql as any).removeEventListener) (mql as any).removeEventListener('change', onChange);
      else (mql as any).removeListener(onChange);
    };
  }, [breakpoint]);

  return isMobile;
}

/**
 * ✅ Prefix + Contains Search (World-Class)
 * - prefix: أسرع وإحساسه طبيعي (مثال: "دف" يطلع "دفتر")
 * - contains: أدق لعبارات كاملة
 *
 * Strategy:
 * - query length <= 2 => prefix-only
 * - length 3..5 => prefix OR contains
 * - length >= 6 => contains primary + prefix fallback
 */
const makePrefixes = (text: string, maxLen = 8) => {
  const out: string[] = [];
  const t = safeLower(text).replace(/\s+/g, ' ').trim();
  if (!t) return out;

  // prefixes للكلمات
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
  const isMobile = useIsMobile(640);

  // ✅ Any change in query params -> scroll to top
  const spKey = useMemo(() => searchParams.toString(), [searchParams]);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [spKey]);

  // ✅ add-to-cart wrapper that supports qty
  const handleAddToCart = useCallback(
    (product: Product, qty: number = 1) => {
      const stock = Math.max(0, Number((product as any)?.stock ?? 0));
      if (stock <= 0) return;

      const safeQty = Math.max(1, Math.floor(Number(qty) || 1));
      const finalQty = Math.min(safeQty, stock);

      const fnAny = addToCart as any;
      try {
        if (typeof fnAny === 'function' && fnAny.length >= 2) {
          fnAny(product, finalQty);
          return;
        }
      } catch {
        // fallback below
      }

      for (let i = 0; i < finalQty; i += 1) addToCart(product);
    },
    [addToCart]
  );

  // State
  const [selectedCategory, setSelectedCategory] = useState<Category | 'All'>('All');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>(''); // slug
  const [priceRange, setPriceRange] = useState<[number, number]>([PRICE_MIN, PRICE_MAX]);
  const [minRating, setMinRating] = useState<number>(0);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const isValidCategory = (cat: unknown): cat is Category => CATEGORIES.some((c) => c.id === cat);

  const normalizeCategoryFromUrl = (raw: string | null): Category | null => {
    if (!raw) return null;
    const aliased = CATEGORY_ALIASES[raw] || raw;
    return isValidCategory(aliased) ? (aliased as Category) : null;
  };

  // ✅ Initialize from URL
  useEffect(() => {
    const rawCat = searchParams.get('filter');
    const cat = normalizeCategoryFromUrl(rawCat);

    const rawSub = (searchParams.get('sub') || '').trim();
    const sub = rawSub === 'all' ? '' : rawSub;

    const rawPage = searchParams.get('page');
    const pageNum = rawPage ? Number(rawPage) : 1;

    setSelectedCategory(cat ?? 'All');
    setSelectedSubCategory(sub);
    setCurrentPage(Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : 1);

    if (rawSub === 'all') {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('sub');
        next.delete('page');
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ✅ Close mobile filters with ESC + lock scroll
  useEffect(() => {
    if (!isFilterOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFilterOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = original;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isFilterOpen]);

  // ✅ Subcategory options
  const subCategoryOptions: SubOption[] = useMemo(() => {
    if (selectedCategory === 'All') return [];
    return (CATEGORY_SUBCATEGORIES[selectedCategory] || []) as SubOption[];
  }, [selectedCategory]);

  const getSubLabel = useCallback(
    (subValue: string): string => {
      if (!subValue) return '';
      const inCurrent = subCategoryOptions.find((s) => s.value === subValue);
      if (inCurrent) return language === 'ar' ? inCurrent.labelAr : inCurrent.labelEn;

      const found = ALL_SUB_OPTIONS.find((s) => s.value === subValue);
      if (found) return language === 'ar' ? found.labelAr : found.labelEn;

      return subValue;
    },
    [subCategoryOptions, language]
  );

  // ✅ If category changes and sub not allowed -> clear sub
  useEffect(() => {
    if (selectedCategory === 'All') return;

    const allowed = (CATEGORY_SUBCATEGORIES[selectedCategory] || []) as SubOption[];
    const ok = selectedSubCategory ? allowed.some((x) => x.value === selectedSubCategory) : true;

    if (selectedSubCategory && !ok) {
      setSelectedSubCategory('');
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('sub');
        next.delete('page');
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  // ✅ Dynamic SEO title + description
  const pageTitle = useMemo(() => {
    const s = searchParams.get('search');
    if (s) return `${t('searchResults') ?? 'Search'}: "${s}"`;

    if (selectedCategory !== 'All') {
      const cat = CATEGORIES.find((c) => c.id === selectedCategory);
      const base = language === 'ar' ? cat?.label || cat?.id : cat?.labelEn || cat?.id;
      if (selectedSubCategory) return `${base} - ${getSubLabel(selectedSubCategory)}`;
      return base || (t('shop') ?? 'Shop');
    }

    if (selectedSubCategory) return `${t('shop') ?? 'Shop'} - ${getSubLabel(selectedSubCategory)}`;
    return t('shop') ?? 'Shop';
  }, [searchParams, selectedCategory, selectedSubCategory, language, t, getSubLabel]);

  const pageDesc = useMemo(() => {
    const s = searchParams.get('search');
    if (s) return `${t('searchResults') ?? 'Search results'}: ${s}`;
    if (selectedCategory !== 'All' && selectedSubCategory) return `${getSubLabel(selectedSubCategory)}`;
    if (selectedCategory !== 'All') return `${t('categoryDesc') ?? 'Browse category'}: ${selectedCategory}`;
    return String(t('categoryDesc') ?? '');
  }, [searchParams, selectedCategory, selectedSubCategory, t, getSubLabel]);

  // ✅ Search input: debounce + defer
  const rawSearch = safeLower(searchParams.get('search'));
  const debouncedSearch = useDebouncedValue(rawSearch, 180);
  const deferredSearch = useDeferredValue(debouncedSearch);

  /**
   * ✅ World-Class Search Index:
   * - fullText (contains)
   * - prefixes (prefix search)
   */
  const searchIndex = useMemo(() => {
    const list = Array.isArray(products) ? (products as any[]) : [];
    const map = new Map<
      string,
      {
        full: string; // contains
        prefixes: Set<string>; // prefix
      }
    >();

    for (const p of list) {
      const id = String(p?.id ?? '');
      if (!id) continue;

      const name = safeLower(p?.name);
      const nameEn = safeLower(p?.nameEn);
      const cat = safeLower(p?.category);
      const brand = safeLower(p?.brand);
      const sub = safeLower(p?.subcategory ?? p?.subCategory ?? '');

      const full = `${name} ${nameEn} ${cat} ${brand} ${sub}`.replace(/\s+/g, ' ').trim();
      const prefixes = new Set<string>([
        ...makePrefixes(name),
        ...makePrefixes(nameEn),
        ...makePrefixes(brand),
        ...makePrefixes(cat),
        ...makePrefixes(sub),
      ]);

      map.set(id, { full, prefixes });
    }

    return map;
  }, [products]);

  // Filtering + Sorting (optimized)
  const filteredProducts = useMemo(() => {
    const list = Array.isArray(products) ? (products as any[]) : [];
    let result = list;

    // 1) Search (Prefix + Contains)
    if (deferredSearch) {
      const q = deferredSearch;
      const qLen = q.length;

      const usePrefixOnly = qLen <= 2;
      const useBoth = qLen >= 3 && qLen <= 5;

      result = result.filter((p) => {
        const id = String(p?.id ?? '');
        const entry = searchIndex.get(id);
        if (!entry) return false;

        // prefix
        const prefixHit = entry.prefixes.has(q);

        if (usePrefixOnly) return prefixHit;

        // contains
        const containsHit = entry.full.includes(q);

        if (useBoth) return prefixHit || containsHit;

        // long query: contains primary + prefix fallback
        return containsHit || prefixHit;
      });
    }

    // 2) Category
    if (selectedCategory !== 'All') {
      result = result.filter((p) => p?.category === selectedCategory);
    }

    // 2.1) SubCategory (slug)
    if (selectedSubCategory) {
      result = result.filter((p) => getSubValue(p) === selectedSubCategory);
    }

    // 3) Price
    const minP = clamp(Number(priceRange[0] ?? PRICE_MIN), PRICE_MIN, PRICE_MAX);
    const maxP = clamp(Number(priceRange[1] ?? PRICE_MAX), PRICE_MIN, PRICE_MAX);
    const from = Math.min(minP, maxP);
    const to = Math.max(minP, maxP);

    result = result.filter((p) => {
      const price = parsePrice(p);
      return price >= from && price <= to;
    });

    // 4) Rating
    if (minRating > 0) {
      result = result.filter((p) => parseRating(p) >= minRating);
    }

    // 5) Sorting
    const sorted = [...result];

    switch (sortBy) {
      case 'price-asc':
        sorted.sort((a, b) => parsePrice(a) - parsePrice(b));
        break;
      case 'price-desc':
        sorted.sort((a, b) => parsePrice(b) - parsePrice(a));
        break;
      case 'rating':
        sorted.sort((a, b) => parseRating(b) - parseRating(a));
        break;
      case 'newest':
      default:
        sorted.sort((a, b) => {
          const aNew = !!a?.isNew;
          const bNew = !!b?.isNew;
          if (aNew && !bNew) return -1;
          if (!aNew && bNew) return 1;
          return getIdTimestamp(b?.id) - getIdTimestamp(a?.id);
        });
        break;
    }

    return sorted;
  }, [products, deferredSearch, searchIndex, selectedCategory, selectedSubCategory, priceRange, minRating, sortBy]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));

  useEffect(() => {
    setCurrentPage((p) => clamp(p, 1, totalPages));
  }, [totalPages]);

  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredProducts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredProducts, currentPage]);

  const setPageInUrl = (page: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const p = Math.floor(page);
      if (p <= 1) next.delete('page');
      else next.set('page', String(p));
      return next;
    });
  };

  const handlePageChange = (newPage: number) => {
    const page = clamp(Math.floor(newPage), 1, totalPages);
    setCurrentPage(page);
    setPageInUrl(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearFilters = () => {
    setSelectedCategory('All');
    setSelectedSubCategory('');
    setPriceRange([PRICE_MIN, PRICE_MAX]);
    setMinRating(0);
    setSortBy('newest');
    setCurrentPage(1);
    setSearchParams(() => new URLSearchParams());
  };

  const handleCategoryChange = (cat: Category | 'All') => {
    setSelectedCategory(cat);
    setSelectedSubCategory('');
    setCurrentPage(1);

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);

      if (cat === 'All') {
        next.delete('filter');
        next.delete('sub');
        next.delete('page');
        return next;
      }

      next.set('filter', cat);
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

  const selectedSubLabel = selectedSubCategory ? getSubLabel(selectedSubCategory) : '';

  const hasActiveFilters =
    selectedCategory !== 'All' ||
    !!selectedSubCategory ||
    minRating > 0 ||
    !!searchParams.get('search') ||
    (Number.isFinite(priceRange[1]) && priceRange[1] < PRICE_MAX);

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];

    const q = searchParams.get('search');
    if (q)
      chips.push({
        key: 'q',
        label: `${t('searchResults') ?? 'Search'}: ${q}`,
        onRemove: () => {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('search');
            next.delete('page');
            return next;
          });
        },
      });

    if (selectedCategory !== 'All')
      chips.push({
        key: 'cat',
        label: `${t('categories') ?? 'Category'}: ${selectedCategory}`,
        onRemove: () => handleCategoryChange('All'),
      });

    if (selectedSubCategory)
      chips.push({
        key: 'sub',
        label: `${isRTL ? 'الفرع' : 'Sub'}: ${selectedSubLabel}`,
        onRemove: () => handleSubCategoryChange(''),
      });

    if (minRating > 0)
      chips.push({
        key: 'rate',
        label: `${t('rating') ?? 'Rating'}: ${minRating}+`,
        onRemove: () => setMinRating(0),
      });

    if (Number.isFinite(priceRange[1]) && priceRange[1] < PRICE_MAX)
      chips.push({
        key: 'price',
        label: `${t('price') ?? 'Price'} ≤ ${priceRange[1]}`,
        onRemove: () => setPriceRange([PRICE_MIN, PRICE_MAX]),
      });

    return chips;
  }, [searchParams, selectedCategory, selectedSubCategory, selectedSubLabel, minRating, priceRange, t, isRTL]);

  return (
    <div className="min-h-screen bg-slate-50 pt-8 pb-20">
      <SEO title={String(pageTitle)} description={String(pageDesc)} />

      <div className="container mx-auto px-4 lg:px-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div className="w-full md:w-auto">
            <h1 className="text-3xl font-heading font-bold text-slate-900">{t('shop') ?? 'Shop'}</h1>

            <p className="text-slate-500 mt-1">
              {filteredProducts.length} {t('productsAvailable') ?? 'products'}
              {searchParams.get('search') && (
                <span className="text-secondary-DEFAULT font-bold mx-1">
                  {t('searchResults') ?? 'Search'}: "{searchParams.get('search')}"
                </span>
              )}
              {selectedSubCategory && <span className="text-secondary-DEFAULT font-bold mx-1">• {selectedSubLabel}</span>}
            </p>

            {/* Active filter chips */}
            {activeChips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {activeChips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={c.onRemove}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:border-secondary-DEFAULT hover:text-secondary-DEFAULT transition"
                    aria-label={`Remove filter ${c.label}`}
                    title={c.label}
                  >
                    <Tag size={14} className="opacity-70" />
                    <span className="line-clamp-1">{c.label}</span>
                    <X size={14} className="opacity-60" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-4 items-center w-full md:w-auto justify-end">
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-red-500 text-sm font-bold flex items-center gap-1 hover:underline" type="button">
                <X size={16} /> {t('clearAll') ?? 'Clear'}
              </button>
            )}

            <button
              onClick={() => setIsFilterOpen((v) => !v)}
              className="md:hidden flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT"
              type="button"
              aria-expanded={isFilterOpen}
              aria-controls="shop-filters"
            >
              <Filter size={18} /> {t('filter') ?? 'Filter'}
            </button>

            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="appearance-none bg-white pl-8 pr-10 rtl:pl-10 rtl:pr-8 py-2 rounded-xl border border-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT text-sm"
                aria-label="Sort"
              >
                <option value="newest">{t('newest') ?? 'Newest'}</option>
                <option value="price-asc">{t('priceLowHigh') ?? 'Price: Low to High'}</option>
                <option value="price-desc">{t('priceHighLow') ?? 'Price: High to Low'}</option>
                <option value="rating">{t('ratingHigh') ?? 'Rating'}</option>
              </select>

              <SlidersHorizontal size={16} className="absolute right-3 rtl:right-auto rtl:left-3 top-3 text-slate-400 pointer-events-none" />
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-6 lg:gap-8">
          {/* Sidebar Filters */}
          <aside id="shop-filters" className={`w-full md:w-64 space-y-6 ${isFilterOpen ? 'block' : 'hidden md:block'}`}>
            {/* Mobile overlay */}
            {isFilterOpen && (
              <div
                className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[60] md:hidden"
                onClick={() => setIsFilterOpen(false)}
                aria-hidden="true"
              />
            )}

            <div className={`bg-white p-6 rounded-2xl shadow-sm border border-slate-100 sticky top-24 z-[70] md:z-auto relative`}>
              {/* Close button mobile */}
              <button
                type="button"
                onClick={() => setIsFilterOpen(false)}
                className="md:hidden absolute top-3 right-3 rtl:right-auto rtl:left-3 p-2 rounded-full hover:bg-slate-100 text-slate-500"
                aria-label="Close filters"
              >
                <X size={18} />
              </button>

              {/* Categories */}
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-800">{t('categories') ?? 'Categories'}</h3>
                {(selectedCategory !== 'All' || selectedSubCategory) && (
                  <button onClick={clearFilters} className="text-xs text-red-500" type="button">
                    {t('clearAll') ?? 'Clear'}
                  </button>
                )}
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="radio"
                    name="category"
                    checked={selectedCategory === 'All'}
                    onChange={() => handleCategoryChange('All')}
                    className="text-secondary-DEFAULT focus:ring-secondary-DEFAULT accent-secondary-DEFAULT"
                  />
                  <span className={`transition-colors text-sm group-hover:text-secondary-DEFAULT ${selectedCategory === 'All' ? 'text-secondary-DEFAULT font-semibold' : 'text-slate-600'}`}>
                    {t('all') ?? 'All'}
                  </span>
                </label>

                {CATEGORIES.map((cat) => (
                  <label key={cat.id} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="radio"
                      name="category"
                      checked={selectedCategory === cat.id}
                      onChange={() => handleCategoryChange(cat.id)}
                      className="text-secondary-DEFAULT focus:ring-secondary-DEFAULT accent-secondary-DEFAULT"
                    />
                    <span className={`transition-colors text-sm group-hover:text-secondary-DEFAULT ${selectedCategory === cat.id ? 'text-secondary-DEFAULT font-semibold' : 'text-slate-600'}`}>
                      {language === 'ar' ? cat.label : cat.labelEn}
                    </span>
                  </label>
                ))}
              </div>

              {/* SubCategory Filter */}
              {selectedCategory !== 'All' && subCategoryOptions.length > 0 && (
                <div className="mt-6 pt-6 border-t border-slate-100">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-slate-800">{language === 'ar' ? 'الفرع' : 'Subcategory'}</h3>
                    {selectedSubCategory && (
                      <button onClick={() => handleSubCategoryChange('')} className="text-xs text-red-500" type="button">
                        {t('clearAll') ?? 'Clear'}
                      </button>
                    )}
                  </div>

                  <select
                    value={selectedSubCategory}
                    onChange={(e) => handleSubCategoryChange(e.target.value)}
                    className="w-full bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT text-sm"
                    aria-label="Subcategory"
                  >
                    <option value="">{language === 'ar' ? '— كل الفروع —' : '— All —'}</option>

                    {subCategoryOptions.map((s) => (
                      <option key={s.value} value={s.value}>
                        {language === 'ar' ? s.labelAr : s.labelEn}
                      </option>
                    ))}
                  </select>

                  <p className="mt-2 text-[11px] text-slate-500">
                    ✅ {language === 'ar' ? 'الفروع تظهر حسب القسم المختار.' : 'Subcategories depend on selected category.'}
                  </p>
                </div>
              )}

              {/* Price */}
              <div className="mt-6 pt-6 border-t border-slate-100">
                <h3 className="font-bold mb-4 text-slate-800">{t('price') ?? 'Price'}</h3>
                <input
                  type="range"
                  min={PRICE_MIN}
                  max={PRICE_MAX}
                  step={10}
                  value={priceRange[1]}
                  onChange={(e) => setPriceRange([PRICE_MIN, clamp(parseInt(e.target.value, 10), PRICE_MIN, PRICE_MAX)])}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-secondary-DEFAULT"
                  aria-label="Max price"
                />
                <div className="flex justify-between mt-2 text-sm text-slate-600 tabular-nums">
                  <span>{PRICE_MIN}</span>
                  <span>≤ {priceRange[1]}</span>
                </div>
              </div>

              {/* Rating */}
              <div className="mt-6 pt-6 border-t border-slate-100">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-slate-800">{t('rating') ?? 'Rating'}</h3>
                  {minRating > 0 && (
                    <button onClick={() => setMinRating(0)} className="text-xs text-red-500" type="button">
                      {t('clearAll') ?? 'Clear'}
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {[4, 3, 2, 1].map((star) => (
                    <label key={star} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="radio"
                        name="rating"
                        checked={minRating === star}
                        onChange={() => setMinRating(star)}
                        className="text-secondary-DEFAULT focus:ring-secondary-DEFAULT accent-secondary-DEFAULT"
                      />

                      <div className="flex text-yellow-400" aria-hidden="true">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} size={14} fill={i < star ? 'currentColor' : 'none'} className={i < star ? '' : 'text-slate-200'} />
                        ))}
                      </div>

                      <span className="text-xs text-slate-500">{t('andUp') ?? 'and up'}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Mobile apply button */}
              {isFilterOpen && (
                <button
                  type="button"
                  onClick={() => setIsFilterOpen(false)}
                  className="md:hidden mt-6 w-full py-3 rounded-2xl bg-secondary-DEFAULT text-white font-extrabold shadow-md"
                >
                  {language === 'ar' ? 'تطبيق' : 'Apply'}
                </button>
              )}
            </div>
          </aside>

          {/* Product Grid */}
          <div className="flex-1">
            {isLoading ? (
              <ProductSkeletonGrid count={8} />
            ) : paginatedProducts.length > 0 ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-12 items-stretch auto-rows-fr">
                  {paginatedProducts.map((product: any, index: number) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      onAddToCart={handleAddToCart}
                      onToggleWishlist={toggleWishlist}
                      onQuickView={openQuickView}
                      isLiked={wishlist.has(product.id)}
                      priority={index < (isMobile ? 3 : 6)}
                    />
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex justify-center items-center gap-2 mt-6">
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="p-2 rounded-xl border border-slate-200 hover:bg-white hover:text-secondary-DEFAULT disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT"
                      type="button"
                      aria-label="Previous page"
                    >
                      <ChevronRight size={20} className="rtl:rotate-180 ltr:rotate-0" />
                    </button>

                    <span className="text-sm text-slate-500 font-medium tabular-nums">
                      {t('page') ?? 'Page'} {currentPage} {t('of') ?? 'of'} {totalPages}
                    </span>

                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="p-2 rounded-xl border border-slate-200 hover:bg-white hover:text-secondary-DEFAULT disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT"
                      type="button"
                      aria-label="Next page"
                    >
                      <ChevronLeft size={20} className="rtl:rotate-180 ltr:rotate-0" />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-dashed border-slate-200 animate-in fade-in">
                <div className="text-6xl mb-4 grayscale opacity-50">🔍</div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">{t('noProducts') ?? 'No products'}</h3>
                <p className="text-slate-500 text-center px-3">
                  {language === 'ar'
                    ? 'جرّب تغيير البحث أو إزالة بعض الفلاتر.'
                    : 'Try changing your search or clearing some filters.'}
                </p>
                <button onClick={clearFilters} className="mt-4 text-secondary-DEFAULT underline font-bold" type="button">
                  {t('clearFilters') ?? 'Clear filters'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Shop;