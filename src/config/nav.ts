// src/config/nav.ts

export type SubOption = { sub: string; labelAr: string; labelEn: string };

/**
 * ✅ Global, consistent route builder for Shop filters.
 * تم تحديثه ليتوافق مع الروابط الجديدة للـ Mega Menu
 */
export const shopTo = (category: string, sub?: string) => {
  const params = new URLSearchParams();

  // Category filter
  params.set('category', category);

  // Optional subcategory
  const cleanSub = String(sub ?? '').trim();
  if (cleanSub && cleanSub !== 'all') params.set('sub', cleanSub);

  return `/shop?${params.toString()}`;
};

/**
 * ✅ Backward compatible: keep gamesTo for existing imports
 */
export const gamesTo = (sub: string) => shopTo('Games', sub);

/**
 * ✅ القاموس الشامل والوحيد لكل الأقسام في المتجر (النسخة الجديدة)
 * This is your single source of truth for sub-menus and filters.
 */
export const SUBCATEGORIES_BY_CATEGORY: Record<string, SubOption[]> = {
  Games: [
    { sub: 'all-toys', labelAr: 'جميع الألعاب', labelEn: 'All Toys' },
    { sub: 'baby-toys', labelAr: 'ألعاب البيبي', labelEn: 'Baby Toys' },
    { sub: 'girls-toys', labelAr: 'ألعاب للبنات', labelEn: 'Girls Toys' },
    { sub: 'boys-toys', labelAr: 'ألعاب للأولاد', labelEn: 'Boys Toys' },
    { sub: 'montessori', labelAr: 'ألعاب منتسوري', labelEn: 'Montessori' },
    { sub: 'memory-focus', labelAr: 'الذاكرة والتركيز', labelEn: 'Memory & Focus' },
    { sub: 'challenge-iq', labelAr: 'التحدي والذكاء', labelEn: 'Challenge & IQ' },
    { sub: 'letters-words', labelAr: 'الحروف والكلمات', labelEn: 'Letters & Words' },
    { sub: 'math-numbers', labelAr: 'الرياضيات والحساب', labelEn: 'Math & Numbers' },
    { sub: 'science-experiments', labelAr: 'التجارب العلمية', labelEn: 'Science Experiments' },
    { sub: 'drawing-coloring', labelAr: 'الرسم والتلوين', labelEn: 'Drawing & Coloring' },
    { sub: 'kitchen-toys', labelAr: 'العاب مطابخ', labelEn: 'Kitchen Toys' },
    { sub: 'kids-tents', labelAr: 'خيم الاطفال', labelEn: 'Kids Tents' },
    { sub: 'audio-books', labelAr: 'الكتب الصوتية', labelEn: 'Audio Books' },
    { sub: 'activity-books', labelAr: 'الكتب والانشطة', labelEn: 'Activity Books' },
    { sub: 'sensory-toys', labelAr: 'ألعاب حسية', labelEn: 'Sensory Toys' },
    { sub: 'building-blocks', labelAr: 'العاب التركيب', labelEn: 'Building Blocks' },
    { sub: 'wooden-toys', labelAr: 'ألعاب خشبية', labelEn: 'Wooden Toys' },
    { sub: 'magnetic-toys', labelAr: 'الالعاب المغناطيسية', labelEn: 'Magnetic Toys' },
    { sub: 'group-games', labelAr: 'العاب جماعية', labelEn: 'Group Games' },
    { sub: 'premium-toys', labelAr: 'الالعاب المميزة', labelEn: 'Premium Toys' },
    { sub: 'matching-games', labelAr: 'ألعاب التطابق', labelEn: 'Matching Games' },
  ],
  BabyGear: [
    { sub: 'bicycles', labelAr: 'بسكليتات', labelEn: 'Bicycles' },
    { sub: 'ride-on-cars', labelAr: 'سيارات ركوب', labelEn: 'Ride-on Cars' },
    { sub: 'kids-trucks', labelAr: 'شاحنات أطفال', labelEn: 'Kids Trucks' },
    { sub: 'scooters', labelAr: 'سكوترات', labelEn: 'Scooters' },
    { sub: 'rc-cars', labelAr: 'سيارات التحكم', labelEn: 'RC Cars' },
    { sub: 'strollers', labelAr: 'عربيات الأطفال', labelEn: 'Strollers' },
    { sub: 'bouncers-rockers', labelAr: 'كراسي هزازة / جلاسات', labelEn: 'Bouncers & Rockers' },
    { sub: 'walkers', labelAr: 'مشايات أطفال', labelEn: 'Baby Walkers' },
    { sub: 'playmats', labelAr: 'سجاد وفرشات لعب', labelEn: 'Playmats & Gyms' },
  ],
  Stationery: [
    { sub: 'school-bags', labelAr: 'حقائب مدرسية', labelEn: 'School Bags' },
    { sub: 'pencil-cases', labelAr: 'مقالم / حافظات أقلام', labelEn: 'Pencil Cases' },
    { sub: 'lunch-bags', labelAr: 'حقائب طعام / لانش بوكس', labelEn: 'Lunch Bags' },
    { sub: 'pens-ballpoint', labelAr: 'أقلام حبر وجاف', labelEn: 'Pens & Ballpoints' },
    { sub: 'pencils', labelAr: 'أقلام رصاص', labelEn: 'Pencils' },
    { sub: 'colors-markers', labelAr: 'أقلام تلوين وماركرز', labelEn: 'Colors & Markers' },
    { sub: 'erasers-sharpeners', labelAr: 'محايات وبرايات', labelEn: 'Erasers & Sharpeners' },
    { sub: 'notebooks', labelAr: 'دفاتر مدرسية بجميع الأحجام', labelEn: 'Notebooks' },
    { sub: 'drawing-books', labelAr: 'دفاتر رسم وتلوين', labelEn: 'Drawing Books' },
    { sub: 'covers-notes', labelAr: 'تجليد وورق ملاحظات', labelEn: 'Covers & Sticky Notes' },
    { sub: 'geometry-rulers', labelAr: 'أدوات هندسة ومساطر', labelEn: 'Geometry & Rulers' },
    { sub: 'glue-tape', labelAr: 'صمغ ولاصق', labelEn: 'Glue & Tape' },
    { sub: 'clay-dough', labelAr: 'صلصال ومعجون', labelEn: 'Clay & Dough' },
    { sub: 'safe-scissors', labelAr: 'مقصات آمنة', labelEn: 'Safe Scissors' },
  ],
  Gifts: [
    { sub: 'gift-boxes', labelAr: 'صناديق وباكجات هدايا', labelEn: 'Gift Boxes & Bundles' },
    { sub: 'wrapping-paper', labelAr: 'ورق تغليف وأكياس', labelEn: 'Wrapping Paper & Bags' },
    { sub: 'greeting-cards', labelAr: 'بطاقات تهنئة', labelEn: 'Greeting Cards' },
    { sub: 'party-supplies', labelAr: 'مستلزمات حفلات', labelEn: 'Party Supplies' },
  ],
  Offers: [
    { sub: 'bundle', labelAr: 'باكج/حزمة التوفير', labelEn: 'Bundles' },
    { sub: 'discount', labelAr: 'خصومات حصرية', labelEn: 'Discounts' },
    { sub: 'clearance', labelAr: 'تصفية المخزون', labelEn: 'Clearance' },
  ],
};

/**
 * ✅ للحفاظ على توافق الكود القديم إن وجد
 */
export const GAMES_SUBCATEGORIES: SubOption[] = [
  { sub: 'all', labelAr: 'كل الألعاب', labelEn: 'All Games' },
  ...SUBCATEGORIES_BY_CATEGORY.Games
];