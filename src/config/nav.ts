// src/config/nav.ts
import { Category } from '../types';

export type SubOption = { sub: string; labelAr: string; labelEn: string };

/**
 * ✅ Global, consistent route builder for Shop filters.
 * - Works correctly with BrowserRouter or HashRouter (HashRouter will prefix with # automatically).
 * - Keeps URLs clean and avoids hardcoding "/#/" inside the app.
 */
export const shopTo = (category: Category, sub?: string) => {
  const params = new URLSearchParams();

  // Category filter
  params.set('filter', category);

  // Optional subcategory
  const cleanSub = String(sub ?? '').trim();
  if (cleanSub && cleanSub !== 'all') params.set('sub', cleanSub);

  return `/shop?${params.toString()}`;
};

/**
 * ✅ Backward compatible: keep gamesTo for existing imports
 * but route is now clean (no "/#/").
 */
export const gamesTo = (sub: string) => shopTo('Games' as Category, sub);

/**
 * ✅ Games (Single source used across Navbar + Shop)
 * Note: keep "all" for display purposes, but route builder treats it as no sub-filter.
 */
export const GAMES_SUBCATEGORIES: SubOption[] = [
  { sub: 'all', labelAr: 'كل الألعاب', labelEn: 'All Games' },
  { sub: '0-9m', labelAr: 'ألعاب (من شهر إلى 9 أشهر)', labelEn: 'Games (0–9 months)' },
  { sub: '1-2y', labelAr: 'ألعاب (من سنة إلى سنتين)', labelEn: 'Games (1–2 years)' },
  { sub: '2-3y', labelAr: 'ألعاب (من سنتين إلى 3 سنوات)', labelEn: 'Games (2–3 years)' },
  { sub: 'girls', labelAr: 'ألعاب بناتي', labelEn: 'Girls Games' },
  { sub: 'boys', labelAr: 'ألعاب ولادي', labelEn: 'Boys Games' },
  { sub: 'edu', labelAr: 'ألعاب تعليمية', labelEn: 'Educational Games' },
];

/**
 * ✅ All subcategories by category (slug-based)
 * This is your single source of truth for sub-menus and filters.
 */
export const SUBCATEGORIES_BY_CATEGORY: Partial<Record<Category, SubOption[]>> = {
  Games: GAMES_SUBCATEGORIES.filter((x) => x.sub !== 'all'),

  Stationery: [
    { sub: 'pencils', labelAr: 'أقلام رصاص', labelEn: 'Pencils' },
    { sub: 'pens', labelAr: 'أقلام حبر', labelEn: 'Pens' },
    { sub: 'markers', labelAr: 'أقلام تخطيط', labelEn: 'Markers' },
    { sub: 'erasers', labelAr: 'محايات', labelEn: 'Erasers' },
    { sub: 'sharpeners', labelAr: 'برايات', labelEn: 'Sharpeners' },
    { sub: 'notebooks', labelAr: 'دفاتر', labelEn: 'Notebooks' },
    { sub: 'files', labelAr: 'ملفات/حافظات', labelEn: 'Files/Folders' },
    { sub: 'colors', labelAr: 'ألوان', labelEn: 'Colors' },
  ],

  Bags: [
    { sub: 'school', labelAr: 'شنط مدرسية', labelEn: 'School Bags' },
    { sub: 'backpack', labelAr: 'حقائب ظهر', labelEn: 'Backpacks' },
    { sub: 'lunch', labelAr: 'شنط طعام', labelEn: 'Lunch Bags' },
  ],

  ArtSupplies: [
    { sub: 'colors', labelAr: 'ألوان', labelEn: 'Colors' },
    { sub: 'brushes', labelAr: 'فُرش رسم', labelEn: 'Brushes' },
    { sub: 'canvas', labelAr: 'كانفاس', labelEn: 'Canvas' },
    { sub: 'craft', labelAr: 'أشغال يدوية', labelEn: 'Craft' },
  ],

  EducationalCards: [
    { sub: 'arabic', labelAr: 'بطاقات عربية', labelEn: 'Arabic Cards' },
    { sub: 'english', labelAr: 'بطاقات إنجليزي', labelEn: 'English Cards' },
    { sub: 'math', labelAr: 'بطاقات رياضيات', labelEn: 'Math Cards' },
  ],

  Courses: [
    { sub: 'kids', labelAr: 'دورات للأطفال', labelEn: 'Kids Courses' },
    { sub: 'art', labelAr: 'دورات رسم', labelEn: 'Art Courses' },
    { sub: 'programming', labelAr: 'دورات برمجة', labelEn: 'Programming Courses' },
  ],

  Offers: [
    { sub: 'bundle', labelAr: 'باكج/حزمة', labelEn: 'Bundle' },
    { sub: 'discount', labelAr: 'خصم', labelEn: 'Discount' },
    { sub: 'clearance', labelAr: 'تصفية', labelEn: 'Clearance' },
  ],
};