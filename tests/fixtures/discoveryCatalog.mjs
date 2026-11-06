// MOCK store products for the AI Product Discovery tests ONLY (shape of src/types.ts Product).
// Invented test data — not store data; never imported by the app.
const base = { rating: 0, reviews: 0, image: '/img/mock.png', description: '' };

export const MOCK_PRODUCTS = Object.freeze([
  { ...base, id: 'm-math-cards', name: 'بطاقات الرياضيات للأطفال', nameEn: 'Kids Math Cards', price: 6.5, category: 'EducationalCards', subCategory: 'math', stock: 12, tags: ['6-8 سنوات', 'جمع وطرح'], ratingAvg: 4.6, ratingCount: 9 },
  { ...base, id: 'm-puzzle-edu', name: 'بازل خريطة العالم التعليمي', nameEn: 'World Map Puzzle', price: 11.5, category: 'Games', subCategory: 'edu', stock: 4, tags: ['+6'], description: 'لعبة تركيب تعليمية' },
  { ...base, id: 'm-science-kit', name: 'مجموعة التجارب العلمية', nameEn: 'Science Kit', price: 13, category: 'Games', subCategory: 'edu', stock: 3, description: 'تجارب آمنة للأطفال من 7 إلى 10 سنوات' },
  { ...base, id: 'm-robot-kit', name: 'روبوت البرمجة للمبتدئين', nameEn: 'Coding Robot', price: 24, category: 'Games', subCategory: 'edu', stock: 2, tags: ['8+'] },
  { ...base, id: 'm-arabic-cards', name: 'بطاقات الحروف العربية', nameEn: 'Arabic Letters Cards', price: 4, category: 'EducationalCards', subCategory: 'arabic', stock: 30, tags: ['3-5 سنوات'] },
  { ...base, id: 'm-english-cards', name: 'بطاقات الحروف الإنجليزية', nameEn: 'English Letters Cards', price: 5, category: 'EducationalCards', subCategory: 'english', stock: 0 },
  { ...base, id: 'm-doll', name: 'دمية قماشية ناعمة', nameEn: 'Soft Doll', price: 7, category: 'Games', subCategory: '2-3y', stock: 6 },
  { ...base, id: 'm-baby-rattle', name: 'خشخيشة للرضع', nameEn: 'Baby Rattle', price: 3.5, category: 'Games', subCategory: '0-9m', stock: 10 },
  { ...base, id: 'm-car', name: 'سيارة سباق', nameEn: 'Race Car', price: 9, category: 'Games', subCategory: 'boys', stock: 5 },
  { ...base, id: 'm-wood-colors', name: 'ألوان خشب 24 لون', nameEn: 'Wooden Colors 24', price: 4.5, category: 'ArtSupplies', subCategory: 'colors', stock: 20 },
  { ...base, id: 'm-water-colors', name: 'ألوان مائية مع فرشاة', nameEn: 'Watercolor Set', price: 8, category: 'ArtSupplies', subCategory: 'colors', stock: 7 },
  { ...base, id: 'm-clay', name: 'صلصال ملون', nameEn: 'Play Clay', price: 6, category: 'ArtSupplies', subCategory: 'craft', stock: 15, tags: ['3+'] },
  { ...base, id: 'm-bag-girls', name: 'شنطة مدرسية وردية', nameEn: 'Pink School Bag', price: 18, category: 'Bags', subCategory: 'school', stock: 3 },
  { ...base, id: 'm-bag-big', name: 'شنطة مدرسية كبيرة', nameEn: 'Large School Bag', price: 25, category: 'Bags', subCategory: 'school', stock: 8 },
  { ...base, id: 'm-backpack', name: 'حقيبة ظهر رياضية', nameEn: 'Sport Backpack', price: 15, category: 'Bags', subCategory: 'backpack', stock: 0 },
  { ...base, id: 'm-notebook-offer', name: 'دفتر 100 ورقة', nameEn: 'Notebook 100 sheets', price: 2, originalPrice: 3, category: 'Stationery', subCategory: 'notebooks', stock: 50, categories: ['Stationery', 'Offers'] },
  // no stock number in the data -> 'unknown', never assumed available
  { ...base, id: 'm-pens', name: 'أقلام حبر جاف 10 قطع', nameEn: 'Ballpoint Pens x10', price: 1.75, category: 'Stationery', subCategory: 'pens' },
  // variants: the cheapest IN-STOCK variant sets the price
  {
    ...base, id: 'm-pencil-case', name: 'مقلمة بسحاب', nameEn: 'Zip Pencil Case', price: 5, category: 'Stationery', stock: 0,
    variants: [
      { id: 'v1', label: 'صغير', type: 'size', price: 3, stock: 0 },
      { id: 'v2', label: 'كبير', type: 'size', price: 4.25, stock: 9 },
    ],
  },
  // no valid price -> never recommended
  { ...base, id: 'm-no-price', name: 'لعبة تعليمية بدون سعر', nameEn: 'Unpriced Edu Game', price: 0, category: 'Games', subCategory: 'edu', stock: 5 },
  { ...base, id: 'm-course', name: 'دورة برمجة للأطفال', nameEn: 'Kids Programming Course', price: 35, category: 'Courses', subCategory: 'programming', stock: 100 },
  // invalid record (no name) -> skipped
  { ...base, id: 'm-broken', name: '', nameEn: '', price: 5, category: 'Games', stock: 1 },
]);
