// src/pages/Shop.tsx
import React, { useEffect, useMemo, useState, useCallback, useDeferredValue } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Filter, SlidersHorizontal, ChevronLeft, ChevronRight, 
  Star, X, Tag, Search, LayoutGrid, List, Sparkles, ShoppingBag 
} from 'lucide-react';

import ProductCard from '../components/ProductCard';
import { CATEGORIES } from '../constants';
import { useCart } from '../App';
import { Category, SortOption, Product } from '../types';
import { ProductSkeletonGrid } from '../components/Skeleton';
import SEO from '../components/SEO';
import Button from '../components/Button';

// ✅ Single Source of Truth for Games subcategories
import { GAMES_SUBCATEGORIES } from '../config/nav';

// ✅ Enterprise Standards: معايير عالمية للأداء والتقسيم
const ITEMS_PER_PAGE = 24; 
const PRICE_MIN = 0;
const PRICE_MAX = 1000;

type SubOption = { value: string; labelAr: string; labelEn: string };

// ✅ Subcategories (Slug-based) - الحفاظ على الهيكل الكامل كما هو
const CATEGORY_SUBCATEGORIES: Partial<Record<Category, SubOption[]>> = {
  Games: GAMES_SUBCATEGORIES.filter((x) => x.sub !== 'all').map((x) => ({
    value: x.sub, labelAr: x.labelAr, labelEn: x.labelEn,
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

// ---------------- Helpers (World-Class Performance) ----------------
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

const ALL_SUB_OPTIONS: SubOption[] = Object.values(CATEGORY_SUBCATEGORIES).flatMap((v) => (v || []) as SubOption[]);

// ✅ Debounce Hook (لضمان سلاسة البحث في القوائم الضخمة)
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
  
  // ✅ Stable Mobile Detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ✅ Scroll to top on query change
  const spKey = useMemo(() => searchParams.toString(), [searchParams]);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [spKey]);

  // ✅ State Management
  const [selectedCategory, setSelectedCategory] = useState<Category | 'All'>('All');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>(''); 
  const [priceRange, setPriceRange] = useState<[number, number]>([PRICE_MIN, PRICE_MAX]);
  const [minRating, setMinRating] = useState<number>(0);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // ✅ Initialize & Sync from URL (Safe Parsing)
  useEffect(() => {
    const rawCat = searchParams.get('filter');
    const aliased = rawCat ? (CATEGORY_ALIASES[rawCat] || rawCat) : null;
    const cat = CATEGORIES.some(c => c.id === aliased) ? (aliased as Category) : 'All';

    const rawSub = (searchParams.get('sub') || '').trim();
    const pageNum = Number(searchParams.get('page')) || 1;

    setSelectedCategory(cat);
    setSelectedSubCategory(rawSub === 'all' ? '' : rawSub);
    setCurrentPage(pageNum > 0 ? Math.floor(pageNum) : 1);
  }, [searchParams]);

  // ✅ Search Indexing (Optimized for 1000+ Products)
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
        ...makePrefixes(p.brand || '')
      ]);
      map.set(id, { full, prefixes });
    });
    return map;
  }, [products]);

  // ✅ Filtering & Sorting Engine (World-Class Logic)
  const filteredProducts = useMemo(() => {
    let result = Array.isArray(products) ? [...products] : [];

    // 1. Intelligent Search
    if (deferredSearch) {
      result = result.filter(p => {
        const entry = searchIndex.get(String(p.id));
        if (!entry) return false;
        return entry.full.includes(deferredSearch) || entry.prefixes.has(deferredSearch);
      });
    }

    // 2. Category & SubCategory
    if (selectedCategory !== 'All') {
      result = result.filter(p => p.category === selectedCategory);
      if (selectedSubCategory) {
        result = result.filter(p => getSubValue(p) === selectedSubCategory);
      }
    }

    // 3. Price Range (Enterprise Filtering)
    result = result.filter(p => {
      const pPrice = parsePrice(p);
      return pPrice >= priceRange[0] && pPrice <= priceRange[1];
    });

    // 4. Rating Filter
    if (minRating > 0) {
      result = result.filter(p => parseRating(p) >= minRating);
    }

    // 5. Global Standard Sorting
    switch (sortBy) {
      case 'price-asc': result.sort((a, b) => parsePrice(a) - parsePrice(b)); break;
      case 'price-desc': result.sort((a, b) => parsePrice(b) - parsePrice(a)); break;
      case 'rating': result.sort((a, b) => parseRating(b) - parseRating(a)); break;
      default: result.sort((a, b) => {
        const aNew = !!a?.isNew; const bNew = !!b?.isNew;
        if (aNew && !bNew) return -1;
        if (!aNew && bNew) return 1;
        return getIdTimestamp(b?.id) - getIdTimestamp(a?.id);
      });
    }

    return result;
  }, [products, deferredSearch, searchIndex, selectedCategory, selectedSubCategory, priceRange, minRating, sortBy]);

  // ✅ Pagination
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredProducts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredProducts, currentPage]);

  // ✅ URL & State Handlers
  const handlePageChange = (page: number) => {
    const p = clamp(Math.floor(page), 1, totalPages);
    setCurrentPage(p);
    setSearchParams(prev => {
      if (p <= 1) prev.delete('page'); else prev.set('page', String(p));
      return prev;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCategoryChange = (cat: Category | 'All') => {
    setSelectedCategory(cat);
    setSelectedSubCategory('');
    setSearchParams(prev => {
      if (cat === 'All') prev.delete('filter'); else prev.set('filter', cat);
      prev.delete('sub'); prev.delete('page');
      return prev;
    });
  };

  const handleSubCategoryChange = (sub: string) => {
    const clean = String(sub ?? '').trim();
    setSelectedSubCategory(clean);
    setSearchParams(prev => {
      if (!clean) prev.delete('sub'); else prev.set('sub', clean);
      prev.delete('page');
      return prev;
    });
  };

  const clearFilters = () => {
    setSearchParams({});
    setPriceRange([PRICE_MIN, PRICE_MAX]);
    setMinRating(0);
    setSortBy('newest');
    setCurrentPage(1);
  };

  // ✅ UI Helpers
  const subCategoryOptions = useMemo(() => {
    if (selectedCategory === 'All') return [];
    return (CATEGORY_SUBCATEGORIES[selectedCategory] || []) as SubOption[];
  }, [selectedCategory]);

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    const q = searchParams.get('search');
    if (q) chips.push({ key: 'q', label: `"${q}"`, onRemove: () => setSearchParams(p => { p.delete('search'); return p; }) });
    if (selectedCategory !== 'All') chips.push({ key: 'cat', label: selectedCategory, onRemove: () => handleCategoryChange('All') });
    if (selectedSubCategory) chips.push({ key: 'sub', label: selectedSubCategory, onRemove: () => handleSubCategoryChange('') });
    if (priceRange[1] < PRICE_MAX) chips.push({ key: 'pr', label: `< ${priceRange[1]} JOD`, onRemove: () => setPriceRange([PRICE_MIN, PRICE_MAX]) });
    return chips;
  }, [searchParams, selectedCategory, selectedSubCategory, priceRange]);

  return (
    <div className="min-h-screen bg-slate-50 pt-8 pb-24">
      <SEO title={t('shop')} />

      <div className="container mx-auto px-4 lg:px-8">
        {/* Header - التصميم العالمي للهيدر */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
          <div className="animate-in fade-in duration-700">
            <h1 className="text-4xl font-heading font-black text-slate-900 tracking-tight flex items-center gap-3">
              <ShoppingBag className="text-secondary-DEFAULT" size={32} />
              {t('shop')}
            </h1>
            <div className="flex items-center gap-3 mt-2 text-slate-500 font-medium">
               <span>{filteredProducts.length} {t('productsAvailable')}</span>
               {activeChips.length > 0 && <span className="w-1 h-1 rounded-full bg-slate-300" />}
               <div className="flex gap-2">
                 {activeChips.map(c => (
                   <button key={c.key} onClick={c.onRemove} className="flex items-center gap-1 bg-white border px-2 py-0.5 rounded-full text-[10px] hover:text-red-500 transition-colors">
                     {c.label} <X size={10} />
                   </button>
                 ))}
               </div>
            </div>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto">
            {/* Sorting Dropdown - معيار عالمي */}
            <div className="relative flex-1 md:w-64">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="w-full appearance-none bg-white px-10 py-4 rounded-2xl border border-slate-200 shadow-sm font-bold text-sm focus:ring-2 focus:ring-secondary-DEFAULT outline-none transition-all"
              >
                <option value="newest">{t('newest')}</option>
                <option value="price-asc">{t('priceLowHigh')}</option>
                <option value="price-desc">{t('priceHighLow')}</option>
                <option value="rating">{t('ratingHigh')}</option>
              </select>
              <SlidersHorizontal className="absolute left-3 rtl:right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
            </div>

            <button
              onClick={() => setIsFilterOpen(true)}
              className="md:hidden flex items-center justify-center p-4 bg-slate-900 text-white rounded-2xl shadow-xl hover:bg-secondary-DEFAULT transition-all"
            >
              <Filter size={24} />
            </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-8 lg:gap-12">
          {/* Sidebar - نظام الفلترة الاحترافي */}
          <aside className={`
            fixed inset-0 z-[100] bg-white/95 backdrop-blur-md p-8 transition-transform duration-500 md:relative md:inset-auto md:z-0 md:bg-transparent md:p-0 md:translate-x-0 md:w-80
            ${isFilterOpen ? 'translate-x-0' : (isRTL ? 'translate-x-full' : '-translate-x-full')}
          `}>
            <div className="sticky top-28 bg-white md:p-10 md:rounded-[3rem] md:border md:shadow-2xl md:shadow-slate-200/50">
              <div className="flex justify-between items-center mb-10 md:hidden border-b pb-4">
                <h2 className="text-2xl font-black">{t('filter')}</h2>
                <button onClick={() => setIsFilterOpen(false)} className="p-2 bg-slate-100 rounded-full"><X size={24} /></button>
              </div>

              {/* Categories */}
              <div className="mb-10">
                <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-6">{t('categories')}</h3>
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto custom-scrollbar">
                  <button
                    onClick={() => handleCategoryChange('All')}
                    className={`w-full text-start px-5 py-3.5 rounded-2xl text-sm font-bold transition-all ${selectedCategory === 'All' ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    {t('allProducts')}
                  </button>
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => handleCategoryChange(cat.id)}
                      className={`w-full text-start px-5 py-3.5 rounded-2xl text-sm font-bold transition-all ${selectedCategory === cat.id ? 'bg-secondary-DEFAULT text-white shadow-xl' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                      {isRTL ? cat.label : cat.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              {/* SubCategories - تظهر فقط عند اختيار قسم */}
              {selectedCategory !== 'All' && subCategoryOptions.length > 0 && (
                <div className="mb-10 pt-8 border-t">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-6">{t('subCategory')}</h3>
                  <select
                    value={selectedSubCategory}
                    onChange={(e) => handleSubCategoryChange(e.target.value)}
                    className="w-full bg-slate-50 border-none p-4 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-secondary-DEFAULT/20"
                  >
                    <option value="">{isRTL ? '— الكل —' : '— All —'}</option>
                    {subCategoryOptions.map(s => <option key={s.value} value={s.value}>{isRTL ? s.labelAr : s.labelEn}</option>)}
                  </select>
                </div>
              )}

              {/* Price Range */}
              <div className="mb-10 pt-8 border-t">
                 <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-8">{t('price')}</h3>
                 <input
                   type="range" min={PRICE_MIN} max={PRICE_MAX} step={5} value={priceRange[1]}
                   onChange={(e) => setPriceRange([0, Number(e.target.value)])}
                   className="w-full h-1.5 accent-slate-900 cursor-pointer"
                 />
                 <div className="flex justify-between mt-6 text-[10px] font-black text-slate-900">
                    <span className="bg-slate-50 px-3 py-1.5 rounded-lg border italic">Min: 0</span>
                    <span className="bg-secondary-light/10 text-secondary-DEFAULT px-3 py-1.5 rounded-lg border border-secondary-DEFAULT shadow-sm">Max: {priceRange[1]} JOD</span>
                 </div>
              </div>

              <button
                onClick={clearFilters}
                className="w-full py-5 text-[10px] font-black uppercase tracking-widest text-red-500 border border-red-50 rounded-3xl hover:bg-red-50 transition-all active:scale-95"
              >
                {t('clearAll')}
              </button>
            </div>
          </aside>

          {/* Product Feed - عرض الصور الاحترافي */}
          <main className="flex-1">
            {isLoading ? (
              <ProductSkeletonGrid count={9} />
            ) : paginatedProducts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10 animate-in fade-in slide-in-from-bottom-6 duration-1000">
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
              <div className="flex flex-col items-center justify-center py-40 bg-white rounded-[4rem] border border-dashed border-slate-200">
                <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mb-8 shadow-inner animate-bounce">
                  <Search className="text-slate-200" size={48} />
                </div>
                <h2 className="text-3xl font-black text-slate-900 mb-4">{t('noProducts')}</h2>
                <p className="text-slate-500 mb-8 max-w-xs text-center">{t('noProductsDesc') || 'Try changing your search filters'}</p>
                <Button onClick={clearFilters} className="px-12 rounded-2xl shadow-xl shadow-secondary-light/30">{t('resetFilters')}</Button>
              </div>
            )}

            {/* Pagination - تصميم أمازون المطور */}
            {totalPages > 1 && (
              <div className="mt-24 flex justify-center items-center gap-4">
                 <button
                   onClick={() => handlePageChange(currentPage - 1)}
                   disabled={currentPage === 1}
                   className="w-16 h-16 flex items-center justify-center bg-white border border-slate-100 rounded-[1.5rem] disabled:opacity-20 hover:border-secondary-DEFAULT hover:shadow-xl transition-all"
                 >
                   <ChevronRight className={isRTL ? "" : "rotate-180"} size={20} />
                 </button>

                 <div className="flex items-center gap-3 px-8 py-4 bg-white border border-slate-100 rounded-[1.5rem] shadow-sm">
                   <span className="text-sm font-black tabular-nums">{currentPage}</span>
                   <span className="text-xs font-bold text-slate-300">/</span>
                   <span className="text-sm font-bold text-slate-400 tabular-nums">{totalPages}</span>
                 </div>

                 <button
                   onClick={() => handlePageChange(currentPage + 1)}
                   disabled={currentPage === totalPages}
                   className="w-16 h-16 flex items-center justify-center bg-white border border-slate-100 rounded-[1.5rem] disabled:opacity-20 hover:border-secondary-DEFAULT hover:shadow-xl transition-all"
                 >
                   <ChevronLeft className={isRTL ? "" : "rotate-180"} size={20} />
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