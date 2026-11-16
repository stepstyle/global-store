// Discovery vocabulary, mapped to the STORE taxonomy (src/constants.ts CATEGORIES / SUBCATEGORIES ids).
// Written in plain Arabic and normalized once at load, so spelling variants never drift from normalizeArabic().
import { normalizeArabic } from './arabicText.ts';
import type { DiscoveryCategory, Occasion, Recipient } from './types.ts';

export const STORE_CATEGORIES: readonly DiscoveryCategory[] = Object.freeze([
  'Stationery', 'Bags', 'Offers', 'ArtSupplies', 'Courses', 'EducationalCards', 'Games',
] as DiscoveryCategory[]);

/** Arabic labels as shown in the store (constants.ts) — used in explanations only. */
export const CATEGORY_LABEL_AR: Readonly<Record<DiscoveryCategory, string>> = Object.freeze({
  Stationery: 'قرطاسية',
  Bags: 'حقائب',
  ArtSupplies: 'لوازم الفنون',
  Courses: 'الكورسات',
  EducationalCards: 'بطاقات تعليمية',
  Games: 'الألعاب',
  Offers: 'العروض',
});

/** Arabic labels of the store subCategory slugs (constants.ts SUBCATEGORIES) — explanations only. */
export const SUBCATEGORY_LABEL_AR: Readonly<Record<string, string>> = Object.freeze({
  '0-9m': 'ألعاب من شهر إلى 9 أشهر', '1-2y': 'ألعاب من سنة إلى سنتين', '2-3y': 'ألعاب من سنتين إلى 3 سنوات',
  girls: 'ألعاب بناتي', boys: 'ألعاب ولادي', edu: 'ألعاب تعليمية',
  pencils: 'أقلام رصاص', pens: 'أقلام حبر', markers: 'أقلام تخطيط', erasers: 'محايات', sharpeners: 'برايات', notebooks: 'دفاتر', files: 'ملفات/حافظات',
  colors: 'ألوان', brushes: 'فُرش رسم', canvas: 'كانفاس', craft: 'أشغال يدوية',
  school: 'شنط مدرسية', backpack: 'حقائب ظهر', lunch: 'شنط طعام',
  arabic: 'بطاقات عربية', english: 'بطاقات إنجليزي', math: 'بطاقات رياضيات',
  kids: 'دورات للأطفال', art: 'دورات رسم', programming: 'دورات برمجة',
  bundle: 'باكج/حزمة', discount: 'خصم', clearance: 'تصفية',
});

/**
 * sub   = store subCategory slug(s) ("a|b" = any of them)
 * type  = a SPECIFIC product noun without a slug (مقلمة، بازل، دمية): matched on the product name/tags, never by
 *         sharing a category ("مقلمة" must not be satisfied by a notebook)
 * label = how the need is named to the customer (default: slug label or the phrase)
 */
type Entry = { phrases: string[]; category: DiscoveryCategory; sub?: string; type?: boolean; label?: string };

/** phrase -> category (+ optional subCategory slug). Multi-word phrases are matched before single words. */
const RAW_TERMS: Entry[] = [
  // Stationery
  { phrases: ['قرطاسية', 'قرطاسيه', 'ادوات مدرسية', 'ادوات مكتبية', 'مستلزمات مدرسية', 'stationery'], category: 'Stationery' },
  { phrases: ['قلم رصاص', 'اقلام رصاص', 'رصاص', 'pencil', 'pencils'], category: 'Stationery', sub: 'pencils' },
  { phrases: ['قلم حبر', 'اقلام حبر', 'حبر', 'ناشف', 'جاف', 'pen', 'pens'], category: 'Stationery', sub: 'pens' },
  { phrases: ['اقلام تخطيط', 'تخطيط', 'فلوماستر', 'ماركر', 'هايلايتر', 'markers', 'marker'], category: 'Stationery', sub: 'markers' },
  { phrases: ['محاية', 'محايه', 'ممحاة', 'مساحة', 'محايات', 'eraser'], category: 'Stationery', sub: 'erasers' },
  { phrases: ['براية', 'برايه', 'برايات', 'مبراة', 'sharpener'], category: 'Stationery', sub: 'sharpeners' },
  { phrases: ['دفتر', 'دفاتر', 'كشكول', 'notebook', 'notebooks'], category: 'Stationery', sub: 'notebooks' },
  { phrases: ['ملف', 'ملفات', 'حافظة', 'حافظات', 'folder'], category: 'Stationery', sub: 'files' },
  // "قلم" alone = any kind of pen/pencil/marker (so a pen is never called an "alternative" for "قلم")
  { phrases: ['قلم', 'اقلام'], category: 'Stationery', sub: 'pencils|pens|markers', label: 'أقلام' },
  { phrases: ['مقلمة', 'مقلمه', 'مقالم'], category: 'Stationery', type: true, label: 'مقلمة' },
  { phrases: ['مسطرة', 'مساطر'], category: 'Stationery', type: true, label: 'مسطرة' },
  // Bags
  { phrases: ['شنطة مدرسة', 'شنطة مدرسية', 'شنط مدرسية', 'حقيبة مدرسية', 'school bag'], category: 'Bags', sub: 'school' },
  { phrases: ['حقيبة ظهر', 'شنطة ظهر', 'backpack'], category: 'Bags', sub: 'backpack' },
  { phrases: ['شنطة اكل', 'شنطة طعام', 'لانش بوكس', 'lunch bag', 'lunch box'], category: 'Bags', sub: 'lunch' },
  { phrases: ['شنطة', 'شنطه', 'شنط', 'جنطة', 'جنط', 'حقيبة', 'حقائب', 'bag', 'bags'], category: 'Bags' },
  // Art supplies
  { phrases: ['الوان', 'تلوين', 'الوان خشب', 'الوان مائية', 'colors', 'crayons'], category: 'ArtSupplies', sub: 'colors' },
  { phrases: ['فرشاة', 'فرشايه', 'فرش رسم', 'brushes', 'brush'], category: 'ArtSupplies', sub: 'brushes' },
  { phrases: ['كانفس', 'كانفاس', 'canvas'], category: 'ArtSupplies', sub: 'canvas' },
  { phrases: ['اشغال يدوية', 'صلصال', 'معجون', 'قص ولصق', 'craft'], category: 'ArtSupplies', sub: 'craft' },
  { phrases: ['رسم', 'فن', 'فنون', 'art'], category: 'ArtSupplies' },
  // Courses
  { phrases: ['كورس برمجة', 'دورة برمجة', 'برمجة', 'programming', 'coding'], category: 'Courses', sub: 'programming' },
  { phrases: ['دورة رسم', 'كورس رسم'], category: 'Courses', sub: 'art' },
  { phrases: ['كورس', 'كورسات', 'دورة', 'دورات', 'course', 'courses'], category: 'Courses' },
  // Educational cards
  { phrases: ['بطاقات عربي', 'بطاقات حروف', 'حروف عربي'], category: 'EducationalCards', sub: 'arabic' },
  { phrases: ['بطاقات انجليزي', 'حروف انجليزي', 'انجليزي', 'english'], category: 'EducationalCards', sub: 'english' },
  { phrases: ['بطاقات رياضيات', 'رياضيات', 'ارقام', 'حساب', 'math'], category: 'EducationalCards', sub: 'math' },
  { phrases: ['بطاقات', 'بطاقات تعليمية', 'كروت', 'فلاش كارد', 'flash cards', 'cards'], category: 'EducationalCards' },
  // Games
  { phrases: ['العاب تعليمية', 'لعبة تعليمية', 'لعبه تعليميه'], category: 'Games', sub: 'edu' },
  { phrases: ['بازل', 'تركيب', 'تركيبات', 'ليغو', 'ليجو', 'مكعبات', 'puzzle', 'lego'], category: 'Games', type: true, label: 'بازل/تركيب' },
  { phrases: ['دمية', 'دمى', 'عروسة', 'عروسه', 'باربي', 'doll'], category: 'Games', type: true, label: 'دمية' },
  { phrases: ['لعبة', 'لعبه', 'العاب', 'لعب', 'ألعاب', 'toy', 'toys', 'game', 'games'], category: 'Games' },
  // Offers
  { phrases: ['عرض', 'عروض', 'خصم', 'خصومات', 'تنزيلات', 'تخفيض', 'اوكازيون', 'offer', 'sale', 'discount'], category: 'Offers' },
];

export interface TermMatch {
  phrase: string;
  category: DiscoveryCategory;
  sub: string | null;
  /** a specific product type (slug or named type), as opposed to a whole category ("قرطاسية", "ألعاب") */
  specific: boolean;
  /** customer-facing name of the need ("دفاتر", "أقلام", "مقلمة") */
  label: string;
}
/** normalized phrase -> match, longest phrases first */
export const CATEGORY_TERMS: readonly TermMatch[] = Object.freeze(
  RAW_TERMS.flatMap((e) => e.phrases.map((p) => ({
    phrase: normalizeArabic(p),
    category: e.category,
    sub: e.sub ?? null,
    specific: Boolean(e.sub || e.type),
    label: e.label ?? (e.sub && !e.sub.includes('|') ? SUBCATEGORY_LABEL_AR[e.sub] ?? p : e.sub ? p : CATEGORY_LABEL_AR[e.category]),
  })))
    .sort((a, b) => b.phrase.length - a.phrase.length),
);

// ---------------------------------------------------------------- suitability evidence (store data only)
/** Categories whose products are made for children (store taxonomy). */
export const CHILD_CATEGORIES: readonly DiscoveryCategory[] = Object.freeze(['Games', 'EducationalCards'] as DiscoveryCategory[]);
/** subCategory slugs that mark a children's product. */
export const CHILD_SUBCATEGORIES: readonly string[] = Object.freeze(['0-9m', '1-2y', '2-3y', 'girls', 'boys', 'edu', 'school', 'lunch', 'kids', 'arabic', 'english', 'math']);
/** words in a product's name/tags/description that mark a children's product (normalized). */
export const CHILD_WORDS: readonly string[] = Object.freeze(
  ['اطفال', 'الاطفال', 'للاطفال', 'طفل', 'للطفل', 'رضع', 'للرضع', 'رضيع', 'الصغار', 'مدرسية', 'kids', 'children', 'child', 'baby', 'toddler', 'school']
    .map(normalizeArabic),
);
/**
 * Categories where the AGE decides suitability (toys, learning material, courses). For a child of 4+ a product of these
 * categories without an age in the store data is NOT recommended (listed as "not confirmed"). Under 4 the age must be
 * confirmed for EVERY product.
 */
export const AGE_CRITICAL_CATEGORIES: readonly DiscoveryCategory[] = Object.freeze(['Games', 'EducationalCards', 'Courses'] as DiscoveryCategory[]);
/** Below this age (years) every recommendation needs a confirmed age range. */
export const YOUNG_CHILD_MAX_AGE = 4;

/**
 * Store subCategory slugs that can stand in for each other ("بديل قريب"). Anything else in the same category is NOT
 * offered as an alternative (a notebook is no substitute for a pen; colors are no substitute for clay).
 */
export const SUBSTITUTE_FAMILIES: readonly (readonly string[])[] = Object.freeze([
  ['pencils', 'pens', 'markers'],
  ['erasers', 'sharpeners'],
  ['school', 'backpack'],
  ['colors', 'brushes', 'canvas'],
  ['arabic', 'english', 'math'],
  ['kids', 'art', 'programming'],
  ['bundle', 'discount', 'clearance'],
].map((f) => Object.freeze(f)));
export function areSubstitutes(a: string, b: string): boolean {
  return a === b || SUBSTITUTE_FAMILIES.some((f) => f.includes(a) && f.includes(b));
}

/** "رجعة المدارس" without a product type: the school basics, each as its own need. */
export const BACK_TO_SCHOOL_NEEDS: readonly { category: DiscoveryCategory; sub: string; label: string }[] = Object.freeze([
  { category: 'Stationery', sub: 'notebooks', label: 'دفاتر' },
  { category: 'Stationery', sub: 'pencils|pens|markers', label: 'أقلام' },
  { category: 'Bags', sub: 'school', label: 'شنط مدرسية' },
] as { category: DiscoveryCategory; sub: string; label: string }[]);

export const OCCASION_TERMS: readonly { phrase: string; occasion: Occasion }[] = Object.freeze(
  ([
    [['هدية', 'هدايا', 'هديه', 'gift', 'present', 'اهدي', 'اهديها', 'اهديه'], 'gift'],
    [['عيد ميلاد', 'عيد ميلادو', 'عيد ميلادها', 'عيد ميلاده', 'ميلاد', 'بيرثدي', 'birthday'], 'birthday'],
    [['رجعة المدارس', 'رجعه المدارس', 'العودة للمدارس', 'بداية المدرسة', 'اول يوم مدرسة', 'دوام المدرسة', 'back to school'], 'back_to_school'],
    [['نجاح', 'نجح', 'تخرج', 'تفوق', 'شهادة'], 'success'],
    [['عيدية', 'العيد', 'عيد الفطر', 'عيد الاضحى', 'رمضان'], 'eid'],
  ] as [string[], Occasion][]).flatMap(([ps, o]) => ps.map((p) => ({ phrase: normalizeArabic(p), occasion: o })))
    .sort((a, b) => b.phrase.length - a.phrase.length),
);

export const RECIPIENT_TERMS: readonly { phrase: string; recipient: Recipient }[] = Object.freeze(
  ([
    [['ابني', 'ولدي', 'ولد', 'صبي', 'ابن', 'اخوي', 'ابن اختي', 'ابن اخوي', 'boy', 'son'], 'boy'],
    [['بنتي', 'بنت', 'صبية', 'اختي', 'بنت اختي', 'بنت اخوي', 'girl', 'daughter'], 'girl'],
    [['طفل', 'طفلة', 'اطفال', 'ولاد', 'اولاد', 'صغير', 'صغيرة', 'kid', 'kids', 'child'], 'child'],
    [['رضيع', 'رضيعة', 'مولود', 'مولودة', 'بيبي', 'baby'], 'baby'],
    [['مراهق', 'مراهقة', 'teen'], 'teen'],
    [['طالب جامعة', 'جامعي', 'جامعية', 'موظف', 'معلم', 'معلمة', 'استاذ', 'استاذة', 'adult'], 'adult'],
  ] as [string[], Recipient][]).flatMap(([ps, r]) => ps.map((p) => ({ phrase: normalizeArabic(p), recipient: r })))
    .sort((a, b) => b.phrase.length - a.phrase.length),
);

export const EDUCATIONAL_TERMS: readonly string[] = Object.freeze(
  ['تعليمي', 'تعليمية', 'تعليميه', 'تعليم', 'تعلم', 'يتعلم', 'تتعلم', 'مفيد', 'مفيدة', 'تنمية', 'ذكاء', 'مهارات', 'مونتيسوري', 'educational', 'learning', 'stem']
    .map(normalizeArabic),
);

/** Words that carry no product meaning (MSA + Jordanian/Levantine dialect + English). Matched after normalization. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  [
    'بدي', 'بدنا', 'بدك', 'بده', 'بدها', 'ابغى', 'اريد', 'نريد', 'حاب', 'حابب', 'حابه', 'ممكن', 'لو', 'سمحت', 'سمحتي', 'رجاء', 'من', 'فضلك',
    'شو', 'ايش', 'وين', 'في', 'فيه', 'عندكم', 'عندك', 'اشي', 'شي', 'شيء', 'اشياء', 'حاجة', 'حاجه', 'منيح', 'منيحه', 'كويس', 'حلو', 'حلوه', 'زاكي',
    'عشان', 'علشان', 'مشان', 'لانه', 'لاني', 'كرمال', 'ل', 'لل', 'الى', 'لـ', 'على', 'عن', 'مع', 'او', 'و', 'ب', 'هاد', 'هاي', 'هذا', 'هذه', 'هيك',
    'يكون', 'تكون', 'يناسب', 'تناسب', 'مناسب', 'مناسبه', 'مناسبة', 'يصلح', 'بيصلح', 'لطفل', 'عمره', 'عمرها', 'عمر', 'بعمر', 'سن', 'بسن',
    'سنه', 'سنوات', 'سنين', 'سنتين', 'عام', 'اعوام', 'شهر', 'اشهر', 'شهور', 'دينار', 'دنانير', 'جد', 'jd', 'jod', 'د', 'ا',
    'بحدود', 'حدود', 'حوالي', 'تقريبا', 'تقريبي', 'اقل', 'اكثر', 'تحت', 'فوق', 'بين', 'لحد', 'لغايه', 'لغاية', 'اقصى', 'حد', 'ميزانيه', 'ميزانية', 'سعر', 'بسعر',
    'رخيص', 'رخيصه', 'غالي', 'كتير', 'كثير', 'جدا', 'اكتر', 'ما', 'مش', 'بس', 'كمان', 'برضو', 'يعني', 'لا', 'نعم', 'اه', 'هلا', 'مرحبا', 'السلام',
    'the', 'a', 'an', 'for', 'to', 'of', 'and', 'or', 'with', 'my', 'i', 'want', 'need', 'please', 'under', 'below', 'around', 'about', 'year', 'years', 'old',
  ].map(normalizeArabic),
);

/** Categories that make sense as gifts when the customer gives no category. */
export const GIFT_FRIENDLY: readonly DiscoveryCategory[] = Object.freeze(['Games', 'EducationalCards', 'ArtSupplies', 'Bags'] as DiscoveryCategory[]);
/** "رجعة المدارس" without a product type means school supplies. */
export const SCHOOL_SUPPLIES: readonly DiscoveryCategory[] = Object.freeze(['Stationery', 'Bags', 'ArtSupplies'] as DiscoveryCategory[]);
