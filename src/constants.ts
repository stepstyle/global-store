import { Product, Category, Review, Order, ShippingMethod } from './types';

/** =========================================================
 * ✅ Categories
 * ========================================================= */
export const CATEGORIES: { id: Category; label: string; labelEn: string; icon: string }[] = [
  { id: 'Stationery', label: 'قرطاسية', labelEn: 'Stationery', icon: '✏️' },
  { id: 'Bags', label: 'حقائب', labelEn: 'Bags', icon: '🎒' },
  { id: 'ArtSupplies', label: 'لوازم الفنون', labelEn: 'Art Supplies', icon: '🎨' },
  { id: 'Courses', label: 'الكورسات', labelEn: 'Courses', icon: '🎓' },
  { id: 'EducationalCards', label: 'بطاقات تعليمية', labelEn: 'Edu Cards', icon: '🎴' },
  { id: 'Games', label: 'الألعاب', labelEn: 'Games', icon: '🎮' },
  { id: 'Offers', label: 'العروض', labelEn: 'Offers', icon: '🔥' },
];

/** =========================================================
 * ✅ Subcategories (Slug-based) — MUST match Admin/Edit/Shop/Header
 * ========================================================= */
export const SUBCATEGORIES: Record<
  Category,
  { value: string; labelAr: string; labelEn: string }[]
> = {
  Games: [
    { value: '0-9m', labelAr: 'ألعاب (من شهر إلى 9 أشهر)', labelEn: 'Games (0–9 months)' },
    { value: '1-2y', labelAr: 'ألعاب (من سنة إلى سنتين)', labelEn: 'Games (1–2 years)' },
    { value: '2-3y', labelAr: 'ألعاب (من سنتين إلى 3 سنوات)', labelEn: 'Games (2–3 years)' },
    { value: 'girls', labelAr: 'ألعاب بناتي', labelEn: 'Girls Games' },
    { value: 'boys', labelAr: 'ألعاب ولادي', labelEn: 'Boys Games' },
    { value: 'edu', labelAr: 'ألعاب تعليمية', labelEn: 'Educational Games' },
  ],

  Stationery: [
    { value: 'pencils', labelAr: 'أقلام رصاص', labelEn: 'Pencils' },
    { value: 'pens', labelAr: 'أقلام حبر', labelEn: 'Pens' },
    { value: 'markers', labelAr: 'أقلام تخطيط', labelEn: 'Markers' },
    { value: 'erasers', labelAr: 'محايات', labelEn: 'Erasers' },
    { value: 'sharpeners', labelAr: 'برايات', labelEn: 'Sharpeners' },
    { value: 'notebooks', labelAr: 'دفاتر', labelEn: 'Notebooks' },
    { value: 'files', labelAr: 'ملفات/حافظات', labelEn: 'Files/Folders' },
  ],

  ArtSupplies: [
    { value: 'colors', labelAr: 'ألوان', labelEn: 'Colors' },
    { value: 'brushes', labelAr: 'فُرش رسم', labelEn: 'Brushes' },
    { value: 'canvas', labelAr: 'كانفاس', labelEn: 'Canvas' },
    { value: 'craft', labelAr: 'أشغال يدوية', labelEn: 'Craft' },
  ],

  Bags: [
    { value: 'school', labelAr: 'شنط مدرسية', labelEn: 'School Bags' },
    { value: 'backpack', labelAr: 'حقائب ظهر', labelEn: 'Backpacks' },
    { value: 'lunch', labelAr: 'شنط طعام', labelEn: 'Lunch Bags' },
  ],

  EducationalCards: [
    { value: 'arabic', labelAr: 'بطاقات عربية', labelEn: 'Arabic Cards' },
    { value: 'english', labelAr: 'بطاقات إنجليزي', labelEn: 'English Cards' },
    { value: 'math', labelAr: 'بطاقات رياضيات', labelEn: 'Math Cards' },
  ],

  Courses: [
    { value: 'kids', labelAr: 'دورات للأطفال', labelEn: 'Kids Courses' },
    { value: 'art', labelAr: 'دورات رسم', labelEn: 'Art Courses' },
    { value: 'programming', labelAr: 'دورات برمجة', labelEn: 'Programming Courses' },
  ],

  Offers: [
    { value: 'bundle', labelAr: 'باكج/حزمة', labelEn: 'Bundle' },
    { value: 'discount', labelAr: 'خصم', labelEn: 'Discount' },
    { value: 'clearance', labelAr: 'تصفية', labelEn: 'Clearance' },
  ],
};

/**
 * ✅ تحويل القيم القديمة (مثل Pencils/Age_1_2 أو عربي) إلى slug ثابت
 * - مهم جداً لتوافق المنتجات القديمة + CSV قديم.
 */
export const normalizeSubCategory = (raw: any): string => {
  const s = String(raw ?? '').trim();
  if (!s) return '';

  const map: Record<string, string> = {
    // Stationery
    Pencils: 'pencils',
    Pens: 'pens',
    Markers: 'markers',
    Erasers: 'erasers',
    Sharpeners: 'sharpeners',
    Notebooks: 'notebooks',
    Files: 'files',
    Colors: 'colors',

    'أقلام رصاص': 'pencils',
    'أقلام حبر': 'pens',
    'أقلام تخطيط': 'markers',
    'محايات': 'erasers',
    'برايات': 'sharpeners',
    'دفاتر': 'notebooks',
    'ملفات/حافظات': 'files',
    'ألوان': 'colors',

    // Games
    Age_0_9m: '0-9m',
    Age_1_2: '1-2y',
    Age_2_3: '2-3y',
    Girls: 'girls',
    Boys: 'boys',
    Educational: 'edu',

    'ألعاب (من شهر إلى 9 أشهر)': '0-9m',
    'ألعاب (من سنة إلى سنتين)': '1-2y',
    'ألعاب (من سنتين إلى 3 سنوات)': '2-3y',
    'ألعاب بناتي': 'girls',
    'ألعاب ولادي': 'boys',
    'ألعاب تعليمية': 'edu',

    // Offers
    Bundle: 'bundle',
    Discount: 'discount',
    Clearance: 'clearance',
    'باكج/حزمة': 'bundle',
    'خصم': 'discount',
    'تصفية': 'clearance',
  };

  // لو هو أصلاً slug (مثل pencils / 1-2y)
  const looksLikeSlug = /^[a-z0-9-]+$/i.test(s);
  if (looksLikeSlug && s.length <= 30) return s;

  return map[s] || s;
};

/** =========================================================
 * ✅ Base products (demo)
 * ========================================================= */
const BASE_PRODUCTS: Product[] = [
  {
    id: '1',
    name: 'طقم أقلام احترافي',
    nameEn: 'Professional Pen Set',
    price: 45,
    category: 'Stationery',
    subcategory: 'pens',
    rating: 4.8,
    reviews: 124,
    image: 'https://picsum.photos/400/400?random=1',
    description: 'طقم أقلام حبر جاف عالية الجودة للكتابة السلسة. مناسبة للمحترفين والطلاب.',
    details: 'حبر ياباني عالي الجودة، تصميم مريح لليد، متوفر بـ 5 ألوان.',
    brand: 'AntaPens',
    stock: 50,
    isNew: true,
  },
  {
    id: '2',
    name: 'حقيبة ظهر ذكية',
    nameEn: 'Smart Backpack',
    price: 150,
    originalPrice: 200,
    category: 'Bags',
    subcategory: 'backpack',
    rating: 4.9,
    reviews: 85,
    image: 'https://picsum.photos/400/400?random=2',
    description: 'حقيبة ظهر مقاومة للماء مع منفذ شحن USB وتصميم مريح للظهر.',
    details: 'مقاومة للماء، منفذ USB خارجي، مساحة لابتوب 15.6 بوصة.',
    brand: 'TechGear',
    stock: 20,
  },
  {
    id: '3',
    name: 'ألوان مائية فنية',
    nameEn: 'Watercolor Set',
    price: 85,
    category: 'ArtSupplies',
    subcategory: 'colors',
    rating: 4.7,
    reviews: 43,
    image: 'https://picsum.photos/400/400?random=3',
    description: 'مجموعة ألوان مائية احترافية 24 لونًا للرسامين.',
    brand: 'ArtPro',
    stock: 15,
  },
  {
    id: '4',
    name: 'كورس الرسم الرقمي',
    nameEn: 'Digital Art Course',
    price: 299,
    originalPrice: 450,
    category: 'Courses',
    subcategory: 'art',
    rating: 5.0,
    reviews: 210,
    image: 'https://picsum.photos/400/400?random=4',
    description: 'دورة شاملة لتعلم الرسم الرقمي من الصفر حتى الاحتراف مع شهادة معتمدة.',
    brand: 'AntaAcademy',
    stock: 999,
  },
  {
    id: '5',
    name: 'بطاقات الحروف العربية',
    nameEn: 'Arabic Alphabet Cards',
    price: 30,
    category: 'EducationalCards',
    subcategory: 'arabic',
    rating: 4.5,
    reviews: 56,
    image: 'https://picsum.photos/400/400?random=5',
    description: 'بطاقات تعليمية تفاعلية للأطفال لتعلم الحروف بطريقة ممتعة.',
    brand: 'LearnFun',
    stock: 100,
  },
  {
    id: '6',
    name: 'لعبة التركيب الذكية',
    nameEn: 'Smart Puzzle Game',
    price: 65,
    category: 'Games',
    subcategory: 'edu',
    rating: 4.6,
    reviews: 32,
    image: 'https://picsum.photos/400/400?random=6',
    description: 'لعبة تركيب تساعد على تنمية مهارات التفكير المنطقي والهندسي.',
    brand: 'SmartToys',
    stock: 45,
  },
  {
    id: '7',
    name: 'كراسة رسم فاخرة',
    nameEn: 'Premium Sketchbook',
    price: 25,
    category: 'Stationery',
    subcategory: 'notebooks',
    rating: 4.4,
    reviews: 89,
    image: 'https://picsum.photos/400/400?random=7',
    description: 'ورق سميك عالي الجودة مناسب لجميع أنواع الرسم والألوان.',
    brand: 'ArtPro',
    stock: 200,
  },
  {
    id: '8',
    name: 'حقيبة لابتوب',
    nameEn: 'Laptop Bag',
    price: 120,
    category: 'Bags',
    subcategory: 'school',
    rating: 4.3,
    reviews: 22,
    image: 'https://picsum.photos/400/400?random=8',
    description: 'حماية قصوى لجهازك المحمول مع جيوب متعددة للملحقات.',
    brand: 'TechGear',
    stock: 12,
  },
];

/** =========================================================
 * ✅ Generate Mock Products (large dataset)
 * ========================================================= */
const generateMockProducts = (count: number): Product[] => {
  const products: Product[] = [...BASE_PRODUCTS];
  const brands = ['AntaPens', 'TechGear', 'ArtPro', 'SmartToys', 'LearnFun'];

  // Helper: random subcategory from selected category
  const pickSub = (cat: Category): string => {
    const list = SUBCATEGORIES[cat] || [];
    if (!list.length) return '';
    return list[Math.floor(Math.random() * list.length)].value;
  };

  for (let i = BASE_PRODUCTS.length + 1; i <= count; i++) {
    const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)].id;
    const isOffer = Math.random() > 0.8;
    const price = Math.floor(Math.random() * 200) + 10;

    products.push({
      id: i.toString(),
      name: `منتج تجريبي ${i}`,
      nameEn: `Test Product ${i}`,
      price,
      originalPrice: isOffer ? price + Math.floor(Math.random() * 50) : undefined,
      category,
      subcategory: pickSub(category),
      rating: parseFloat((Math.random() * 2 + 3).toFixed(1)),
      reviews: Math.floor(Math.random() * 500),
      image: `https://picsum.photos/400/400?random=${i}`,
      description: `هذا وصف تجريبي للمنتج رقم ${i}. يتميز بجودة عالية وسعر منافس.`,
      brand: brands[Math.floor(Math.random() * brands.length)],
      stock: Math.random() > 0.1 ? Math.floor(Math.random() * 100) : 0,
      isNew: Math.random() > 0.9,
    });
  }

  return products;
};

export const MOCK_PRODUCTS: Product[] = generateMockProducts(2000);

/** =========================================================
 * ✅ Mock Reviews
 * ========================================================= */
export const MOCK_REVIEWS: Review[] = [
  {
    id: 'r1',
    userName: 'أحمد محمد',
    rating: 5,
    comment: 'منتج رائع وتوصيل سريع جداً! أنصح به بشدة.',
    date: '2023-10-15',
  },
  {
    id: 'r2',
    userName: 'سارة علي',
    rating: 4,
    comment: 'الجودة ممتازة مقارنة بالسعر، لكن التغليف كان يمكن أن يكون أفضل.',
    date: '2023-10-12',
  },
  {
    id: 'r3',
    userName: 'خالد عمر',
    rating: 5,
    comment: 'ممتاز جداً ومطابق للمواصفات.',
    date: '2023-10-10',
  },
];

/** =========================================================
 * ✅ Mock Orders
 * ========================================================= */
export const MOCK_ORDERS: Order[] = [
  {
    id: 'ORD-001',
    userId: 'user-001',
    items: [
      { productId: '1', name: 'طقم أقلام احترافي', price: 45, quantity: 2, image: 'https://picsum.photos/400/400?random=1' },
      { productId: '2', name: 'حقيبة ظهر ذكية', price: 150, quantity: 1, image: 'https://picsum.photos/400/400?random=2' },
    ],
    status: 'delivered',
    date: '2023-09-20',
    total: 240,
    shippingMethod: 'Local Standard',
    paymentMethod: 'card',
    address: {
      fullName: 'أحمد محمد',
      city: 'الرياض',
      street: 'شارع الملك فهد',
      phone: '0501234567',
    },
  },
  {
    id: 'ORD-002',
    userId: 'user-002',
    items: [
      { productId: '3', name: 'ألوان مائية فنية', price: 85, quantity: 1, image: 'https://picsum.photos/400/400?random=3' },
      { productId: '7', name: 'كراسة رسم فاخرة', price: 25, quantity: 1, image: 'https://picsum.photos/400/400?random=7' },
    ],
    status: 'shipped',
    date: '2023-10-18',
    total: 110,
    shippingMethod: 'Express Shipping',
    paymentMethod: 'paypal',
    address: {
      fullName: 'سارة علي',
      city: 'جدة',
      street: 'شارع التحلية',
      phone: '0559876543',
    },
  },
  {
    id: 'ORD-003',
    userId: 'guest',
    items: [
      { productId: '6', name: 'لعبة التركيب الذكية', price: 65, quantity: 1, image: 'https://picsum.photos/400/400?random=6' },
    ],
    status: 'processing',
    date: '2023-10-20',
    total: 85, // 65 + 20 shipping
    shippingMethod: 'Standard Shipping',
    paymentMethod: 'cod',
    address: {
      fullName: 'خالد عمر',
      city: 'الدمام',
      street: 'شارع الخليج',
      phone: '0543210987',
    },
  },
];

/** =========================================================
 * ✅ Shipping Methods
 * ========================================================= */
export const SHIPPING_METHODS: ShippingMethod[] = [
  { id: 'local_std', name: 'شحن محلي قياسي', price: 15, duration: '3-5 أيام', type: 'local' },
  { id: 'local_exp', name: 'شحن محلي سريع', price: 35, duration: '1-2 يوم', type: 'local' },
  { id: 'intl_std', name: 'شحن دولي', price: 60, duration: '7-14 يوم', type: 'international' },
];

/** =========================================================
 * ✅ Translations
 * ========================================================= */
export const TRANSLATIONS = {
  ar: {
    // Header
    home: 'الرئيسية',
    shop: 'المتجر',
    offers: 'العروض',
    courses: 'الكورسات',
    search: 'ابحث عن منتج...',
    cart: 'السلة',
    wishlist: 'المفضلة',
    login: 'دخول',
    logout: 'خروج',
    dashboard: 'لوحة التحكم',
    tracking: 'تتبع الطلب',
    menu_main: 'القائمة الرئيسية',
    menu_account: 'حسابي',
    myOrders: 'طلباتي',
    
    // Footer
    footerDesc:
      'متجرك الأول لكل ما هو حديث وتقني. نوفر لك أفضل المستلزمات القرطاسية، التعليمية، والفنية بأسلوب عصري.',
    quickLinks: 'روابط سريعة',
    aboutUs: 'عن المتجر',
    blog: 'المدونة',
    careers: 'الوظائف',
    privacyPolicy: 'سياسة الخصوصية',
    terms: 'الشروط والأحكام',
    shopping: 'التسوق',
    newsletter: 'النشرة البريدية',
    newsletterDesc: 'اشترك ليصلك كل جديد من العروض والمنتجات.',
    subscribe: 'اشترك الآن',
    emailPlaceholder: 'بريدك الإلكتروني',
    rightsReserved: 'جميع الحقوق محفوظة.',

    // Home
    hero_badge: 'جديد الموسم: تشكيلة العودة للمدارس',
    hero_title_1: 'أطلق العنان لإبداعك',
    hero_title_2: 'بأسلوب عصري',
    hero_desc:
      'اكتشف أفضل الأدوات القرطاسية، الحقائب الذكية، والكورسات التعليمية في منصة واحدة تجمع بين التقنية والفن.',
    shopNow: 'تسوق الآن',
    viewOffers: 'شاهد العروض',
    topSales: 'مبيعات عالية',
    shopByCategory: 'تسوق حسب الفئة',
    categoryDesc: 'كل ما تحتاجه في مكان واحد',
    viewAll: 'عرض الكل',
    ourPicks: 'مختاراتنا لك',
    featuredProducts: 'منتجات مميزة',
    specialOffer: 'عرض خاص',
    offerTitle: 'احصل على خصم 20% على جميع الكورسات',
    offerDesc: 'طور مهاراتك الفنية والتقنية مع نخبة من المدربين. العرض ساري لفترة محدودة.',
    browseCourses: 'تصفح الكورسات',

    // Shop
    productsAvailable: 'منتج متوفر',
    searchResults: 'نتائج البحث',
    clearAll: 'مسح الكل',
    filter: 'تصفية',
    sortBy: 'ترتيب حسب',
    newest: 'الأحدث',
    priceLowHigh: 'السعر: من الأقل للأعلى',
    priceHighLow: 'السعر: من الأعلى للأقل',
    ratingHigh: 'الأعلى تقييماً',
    categories: 'الفئات',
    all: 'الكل',
    price: 'السعر',
    rating: 'التقييم',
    andUp: '& أعلى',
    noProducts: 'لا توجد منتجات',
    noProductsDesc: 'حاول تغيير خيارات التصفية أو البحث.',
    clearFilters: 'مسح جميع الفلاتر',
    page: 'صفحة',
    of: 'من',

    // Product Card
    sale: 'تخفيض',
    new: 'جديد',
    addToCart: 'أضف للسلة',
    outOfStock: 'نفد من المخزون',

    // Product Details
    notifyMe: 'أعلمني',
    notifyMeDesc: 'تنبيه عند التوفر',
    notifyMeMsg: 'غير متوفر حالياً. أدخل بريدك الإلكتروني وسيتم إعلامك فور توفره.',
    confirmSubscribe: 'تأكيد الاشتراك',
    subscribedSuccess: 'تم الاشتراك بنجاح!',
    subscribedMsg: 'سنقوم بإرسال رسالة إلى',
    availableStock: 'متوفر',
    piece: 'قطعة',
    fastDelivery: 'توصيل سريع خلال 2-4 أيام',
    freeReturn: 'إرجاع مجاني خلال 2 يوم',
    descAndDetails: 'الوصف والتفاصيل',
    reviews: 'التقييمات',
    productSpecs: 'المواصفات:',
    showMoreReviews: 'عرض المزيد من التقييمات',
    similarProducts: 'منتجات مشابهة',
    quantity: 'الكمية',
    addQuantityToCart: 'إضافة {quantity} للسلة',
    viewFullDetails: 'عرض التفاصيل الكاملة',
    enterEmailAlert: 'أدخل بريدك الإلكتروني للتنبيه',
    confirm: 'تأكيد',
    alertSet: 'تم تسجيل التنبيه بنجاح',

    // Cart
    cartEmpty: 'سلة التسوق فارغة',
    browseProducts: 'تصفح المنتجات',
    confirmRemove: 'هل أنت متأكد من الحذف؟',
    remove: 'حذف',
    cancel: 'إلغاء',
    discountApplied: 'تم تطبيق خصم 10% لشرائك أكثر من منتجين!',
    subtotal: 'المجموع الفرعي',
    discount: 'خصم',
    total: 'الإجمالي',
    checkout: 'إتمام الطلب',
    continueShopping: 'متابعة التسوق',

    // Checkout
    address: 'العنوان',
    shipping: 'الشحن',
    payment: 'الدفع',
    deliveryAddress: 'عنوان التوصيل',
    firstName: 'الاسم الأول',
    lastName: 'الاسم الأخير',
    country: 'الدولة',
    city: 'المدينة',
    fullAddress: 'العنوان بالتفصيل',
    phone: 'رقم الهاتف',
    continueToShipping: 'متابعة للشحن',
    shippingMethod: 'طريقة الشحن',
    back: 'عودة',
    continueToPayment: 'متابعة للدفع',
    paymentMethod: 'طريقة الدفع',
    creditCard: 'بطاقة ائتمان',
    paypal: 'PayPal',
    cod: 'عند الاستلام',
    cardNumber: 'رقم البطاقة',
    secureData: 'بياناتك مشفرة ومحمية بالكامل',
    pay: 'دفع',
    payWithPaypal: 'الدفع بواسطة PayPal',
    confirmOrder: 'تأكيد الطلب',
    orderSummary: 'ملخص الطلب',

    // Login
    welcomeBack: 'مرحباً بعودتك',
    createAccount: 'إنشاء حساب جديد',
    loginDesc: 'سجل دخولك للمتابعة',
    registerDesc: 'انضم إلينا واستمتع بالعروض',
    fullName: 'الاسم الكامل',
    password: 'كلمة المرور',
    forgotPassword: 'نسيت كلمة المرور؟',
    orContinueWith: 'أو تابع باستخدام',
    twoFactor: 'التحقق الثنائي',
    enterCode: 'أدخل الرمز الذي تم إرساله إلى بريدك',
    verify: 'تحقق',
    invalidCode: 'رمز التحقق غير صحيح',
    loginSuccess: 'تم تسجيل الدخول بنجاح',

    // Order Tracking
    trackOrder: 'تتبع طلبك',
    enterOrderId: 'أدخل رقم الطلب (مثال: ORD-001)',
    track: 'تتبع',
    orderIdError: 'رقم الطلب غير صحيح، يرجى التحقق والمحاولة مرة أخرى.',
    orderDate: 'تاريخ الطلب',
    processing: 'قيد المعالجة',
    shipped: 'تم الشحن',
    delivered: 'تم التوصيل',
    cancelled: 'ملغي',
    orderNumber: 'رقم الطلب',

    // Order Success & History
    orderSuccess: 'تم الطلب بنجاح',
    thankYou: 'شكراً لك!',
    orderConfirmedMsg: 'تم استلام طلبك بنجاح. سنقوم بتجهيزه وشحنه قريباً.',
    trackYourOrder: 'تتبع طلبك',
    backToHome: 'العودة للرئيسية',
    noOrders: 'لا توجد طلبات سابقة',
    startShopping: 'ابدأ التسوق',
            // Common / Global
    loading: 'جاري التحميل...',
    retry: 'إعادة المحاولة',
    copy: 'نسخ',
    copied: 'تم النسخ',
    copyFailed: 'تعذر النسخ',

    // Order details errors (Global)
    orderIdMissing: 'رقم الطلب غير موجود.',
    orderNotFound: 'لم نتمكّن من العثور على الطلب. تأكد من رقم الطلب.',
    orderLoadError: 'حدث خطأ أثناء تحميل بيانات الطلب. حاول مرة أخرى.',

    // Order Note
    orderNote: 'ملاحظة الطلب',
    orderNoteHint: 'تم حفظها داخل الطلب.',
    noteSaved: 'تم الحفظ تلقائيًا.',
    showMore: 'عرض المزيد',
    showLess: 'عرض أقل',

    // Payments (friendly labels)
    cliq: 'كليك',
    card: 'بطاقة',
    cashOnDelivery: 'الدفع عند الاستلام',

    // My Orders extras
    myOrdersHint: 'تابع وراجع مشترياتك الأخيرة.',
    noOrdersHint: 'لم تقم بإجراء أي طلب بعد.',
    moreItems: 'منتجات إضافية',
    items: 'منتجات',
    loginToSeeOrders: 'يرجى تسجيل الدخول لعرض طلباتك.',
    required: 'مطلوب',
    loadFailed: 'فشل تحميل البيانات، حاول مرة أخرى.',
    startshopping: 'ابدأ التسوق',
    // Admin & Inventory
    totalSales: 'إجمالي المبيعات',
    newOrders: 'الطلبات الجديدة',
    users: 'المستخدمين',
    visits: 'الزيارات',
    uploadProducts: 'رفع المنتجات',
    dragDropCsv: 'اسحب وأفلت ملف CSV هنا',
    chooseFile: 'اختيار ملف',
    processingFile: 'جاري معالجة الملف...',
    monthlySales: 'تحليل المبيعات الشهرية',
    recentOrders: 'أحدث الطلبات',
    customer: 'العميل',
    status: 'الحالة',
    amount: 'المبلغ',
    completed: 'مكتمل',
    manageProductInventory: 'إدارة المنتج والمخزون',
    productNameEn: 'اسم المنتج (En)',
    productNameAr: 'اسم المنتج (Ar)',
    inventoryPriceDetails: 'تفاصيل المخزون والسعر',
    originalPriceOptional: 'السعر الأصلي (اختياري للخصم)',
    currentStock: 'الكمية في المخزون',
    saveChanges: 'حفظ التغييرات',
    inventoryAlertsTitle: 'تنبيهات المخزون!',
    inventoryAlertsMsg: 'لديك {out} منتجات نفدت و {low} منتجات قاربت على النفاد.',
    manageInventory: 'إدارة المخزون',
    overview: 'نظرة عامة',
    productInventory: 'المنتجات والمخزون',
    orderManagement: 'إدارة الطلبات',
    productManagement: 'إدارة المنتجات',
    searchProducts: 'بحث عن منتجات...',
    image: 'صورة',
    name: 'الاسم',
    stockLevel: 'مستوى المخزون',
    actions: 'إجراءات',
    ship: 'شحن',
    deliver: 'توصيل',
    seoTools: 'أدوات SEO',
    sitemapDesc: 'توليد ملف sitemap.xml لمساعدة محركات البحث في أرشفة متجرك.',
    generateSitemap: 'توليد Sitemap.xml',
    generateSuccess: 'تم توليد وتنزيل Sitemap.xml بنجاح!',
    description: 'الوصف',
    optional: 'اختياري',

    // Database Settings
    settings: 'الإعدادات',
    databaseSettings: 'إعدادات قاعدة البيانات (Firebase)',
    databaseDesc: 'قم بلصق إعدادات Firebase JSON هنا لربط الموقع بقاعدة بيانات حقيقية.',
    connectFirebase: 'ربط قاعدة البيانات',
    disconnectFirebase: 'فصل قاعدة البيانات',
    firebaseConnected: 'متصل بـ Firebase',
    firebaseNotConnected: 'يعمل في الوضع المحلي (Mock)',
    pasteConfigPlaceholder: '{ "apiKey": "AIza...", ... }',

    // ChatBot
    botName: 'المساعد الذكي',
    online: 'متصل الآن',
    typeMessage: 'اكتب استفسارك هنا...',
    botWelcome:
      'مرحباً بك في مكتبة دير شرف العلمية! 🤖 أنا هنا لمساعدتك في العثور على أفضل المنتجات. كيف يمكنني خدمتك اليوم؟',

    // Cookie
    cookieText: 'نستخدم ملفات تعريف الارتباط (Cookies) لتحسين تجربتك، تحليل حركة المرور، وتخصيص الإعلانات.',
    agree: 'موافق',
    decline: 'رفض',
  },

  en: {
    // Header
    home: 'Home',
    shop: 'Shop',
    offers: 'Offers',
    courses: 'Courses',
    search: 'Search for a product...',
    cart: 'Cart',
    wishlist: 'Wishlist',
    login: 'Login',
    logout: 'Logout',
    dashboard: 'Dashboard',
    tracking: 'Track Order',
    menu_main: 'Main Menu',
    menu_account: 'My Account',
    myOrders: 'My Orders',

    // Footer
    footerDesc:
      'Your #1 store for everything modern and tech. We provide the best stationery, educational, and art supplies in a modern style.',
    quickLinks: 'Quick Links',
    aboutUs: 'About Us',
    blog: 'Blog',
    careers: 'Careers',
    privacyPolicy: 'Privacy Policy',
    terms: 'Terms & Conditions',
    shopping: 'Shopping',
    newsletter: 'Newsletter',
    newsletterDesc: 'Subscribe to get the latest offers and products.',
    subscribe: 'Subscribe',
    emailPlaceholder: 'Your Email',
    rightsReserved: 'All rights reserved.',

    // Home
    hero_badge: 'New Season: Back to School Collection',
    hero_title_1: 'Unleash Your Creativity',
    hero_title_2: 'In Modern Style',
    hero_desc:
      'Discover the best stationery, smart bags, and educational courses in one platform combining tech and art.',
    shopNow: 'Shop Now',
    viewOffers: 'View Offers',
    topSales: 'Top Sales',
    shopByCategory: 'Shop by Category',
    categoryDesc: 'Everything you need in one place',
    viewAll: 'View All',
    ourPicks: 'Our Picks',
    featuredProducts: 'Featured Products',
    specialOffer: 'Special Offer',
    offerTitle: 'Get 20% Off All Courses',
    offerDesc: 'Upgrade your technical and artistic skills with elite instructors. Offer valid for a limited time.',
    browseCourses: 'Browse Courses',

    // Shop
    productsAvailable: 'products available',
    searchResults: 'Search results',
    clearAll: 'Clear All',
    filter: 'Filter',
    sortBy: 'Sort By',
    newest: 'Newest',
    priceLowHigh: 'Price: Low to High',
    priceHighLow: 'Price: High to Low',
    ratingHigh: 'Highest Rated',
    categories: 'Categories',
    all: 'All',
    price: 'Price',
    rating: 'Rating',
    andUp: '& Up',
    noProducts: 'No products found',
    noProductsDesc: 'Try changing the filters or search query.',
    clearFilters: 'Clear Filters',
    page: 'Page',
    of: 'of',

    // Product Card
    sale: 'Sale',
    new: 'New',
    addToCart: 'Add to Cart',
    outOfStock: 'Out of Stock',

    // Product Details
    notifyMe: 'Notify Me',
    notifyMeDesc: 'Notify when available',
    notifyMeMsg: 'Currently unavailable. Enter your email to get notified.',
    confirmSubscribe: 'Confirm Subscription',
    subscribedSuccess: 'Subscribed Successfully!',
    subscribedMsg: 'We will send an email to',
    availableStock: 'In Stock',
    piece: 'pcs',
    fastDelivery: 'Fast delivery within 2-4 days',
    freeReturn: 'Free return within 14 days',
    descAndDetails: 'Description & Details',
    reviews: 'Reviews',
    productSpecs: 'Specifications:',
    showMoreReviews: 'Show more reviews',
    similarProducts: 'Similar Products',
    quantity: 'Quantity',
    addQuantityToCart: 'Add {quantity} to Cart',
    viewFullDetails: 'View Full Details',
    enterEmailAlert: 'Enter email for alert',
    confirm: 'Confirm',
    alertSet: 'Alert set successfully',

    // Cart
    cartEmpty: 'Your cart is empty',
    browseProducts: 'Browse Products',
    confirmRemove: 'Are you sure?',
    remove: 'Remove',
    cancel: 'Cancel',
    discountApplied: '10% discount applied for buying more than 2 items!',
    subtotal: 'Subtotal',
    discount: 'Discount',
    total: 'Total',
    checkout: 'Checkout',
    continueShopping: 'Continue Shopping',

    // Checkout
    address: 'Address',
    shipping: 'Shipping',
    payment: 'Payment',
    deliveryAddress: 'Delivery Address',
    firstName: 'First Name',
    lastName: 'Last Name',
    country: 'Country',
    city: 'City',
    fullAddress: 'Full Address',
    phone: 'Phone Number',
    continueToShipping: 'Continue to Shipping',
    shippingMethod: 'Shipping Method',
    back: 'Back',
    continueToPayment: 'Continue to Payment',
    paymentMethod: 'Payment Method',
    creditCard: 'Credit Card',
    paypal: 'PayPal',
    cod: 'Cash on Delivery',
    cardNumber: 'Card Number',
    secureData: 'Your data is fully encrypted',
    pay: 'Pay',
    payWithPaypal: 'Pay with PayPal',
    confirmOrder: 'Confirm Order',
    orderSummary: 'Order Summary',

    // Login
    welcomeBack: 'Welcome Back',
    createAccount: 'Create New Account',
    loginDesc: 'Login to continue',
    registerDesc: 'Join us and enjoy offers',
    fullName: 'Full Name',
    password: 'Password',
    forgotPassword: 'Forgot Password?',
    orContinueWith: 'Or continue with',
    twoFactor: 'Two-Factor Auth',
    enterCode: 'Enter the code sent to your email',
    verify: 'Verify',
    invalidCode: 'Invalid verification code',
    loginSuccess: 'Logged in successfully',

    // Order Tracking
    trackOrder: 'Track Your Order',
    enterOrderId: 'Enter Order ID (e.g., ORD-001)',
    track: 'Track',
    orderIdError: 'Invalid Order ID, please check and try again.',
    orderDate: 'Order Date',
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    orderNumber: 'Order Number',

    // Order Success & History
    orderSuccess: 'Order Successful',
    thankYou: 'Thank You!',
    orderConfirmedMsg: 'Your order has been received successfully. We will prepare and ship it soon.',
    trackYourOrder: 'Track Your Order',
    backToHome: 'Back to Home',
    noOrders: 'No past orders',
    startShopping: 'Start Shopping',
        // Common / Global
    loading: 'Loading...',
    retry: 'Retry',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed',

    // Order details errors (Global)
    orderIdMissing: 'Order id is missing.',
    orderNotFound: 'We could not find this order. Please check the order id.',
    orderLoadError: 'An error occurred while loading the order. Please try again.',

    // Order Note
    orderNote: 'Order note',
    orderNoteHint: 'Saved with the order.',
    noteSaved: 'Saved automatically.',
    showMore: 'Show more',
    showLess: 'Show less',

    // Payments (friendly labels)
    cliq: 'CliQ',
    card: 'Card',
    cashOnDelivery: 'Cash on delivery',

    // My Orders extras
    myOrdersHint: 'Track and review your recent purchases.',
    noOrdersHint: 'You have not placed any orders yet.',
    moreItems: 'more items',
    items: 'items',
    loginToSeeOrders: 'Please login to view your orders.',
    required: 'Required',
    loadFailed: 'Failed to load. Please try again.',
    startshopping: 'Start shopping',
    // Admin & Inventory
    totalSales: 'Total Sales',
    newOrders: 'New Orders',
    users: 'Users',
    visits: 'Visits',
    uploadProducts: 'Bulk Upload',
    dragDropCsv: 'Drag & Drop CSV here',
    chooseFile: 'Choose File',
    processingFile: 'Processing file...',
    monthlySales: 'Monthly Sales Analysis',
    recentOrders: 'Recent Orders',
    customer: 'Customer',
    status: 'Status',
    amount: 'Amount',
    completed: 'Completed',
    manageProductInventory: 'Manage Product & Inventory',
    productNameEn: 'Product Name (En)',
    productNameAr: 'Product Name (Ar)',
    inventoryPriceDetails: 'Inventory & Price Details',
    originalPriceOptional: 'Original Price (Optional for Sale)',
    currentStock: 'Current Stock',
    saveChanges: 'Save Changes',
    inventoryAlertsTitle: 'Inventory Alerts Needed!',
    inventoryAlertsMsg: 'You have {out} items out of stock and {low} items running low.',
    manageInventory: 'Manage Inventory',
    overview: 'Overview',
    productInventory: 'Product & Inventory',
    orderManagement: 'Order Management',
    productManagement: 'Product Management',
    searchProducts: 'Search products...',
    image: 'Image',
    name: 'Name',
    stockLevel: 'Stock Level',
    actions: 'Actions',
    ship: 'Ship',
    deliver: 'Deliver',
    seoTools: 'SEO Tools',
    sitemapDesc:
      'Generate a sitemap.xml file containing all your product URLs to help Google index your store better.',
    generateSitemap: 'Generate Sitemap.xml',
    generateSuccess: 'Sitemap.xml generated and downloaded!',
    description: 'Description',
    optional: 'Optional',

    // Database Settings
    settings: 'Settings',
    databaseSettings: 'Database Settings (Firebase)',
    databaseDesc: 'Paste your Firebase JSON config here to connect to a real database.',
    connectFirebase: 'Connect Database',
    disconnectFirebase: 'Disconnect Database',
    firebaseConnected: 'Connected to Firebase',
    firebaseNotConnected: 'Running in Local Mode (Mock)',
    pasteConfigPlaceholder: '{ "apiKey": "AIza...", ... }',

    // ChatBot
    botName: 'Smart Assistant',
    online: 'Online',
    typeMessage: 'Type your message...',
    botWelcome:
      'Welcome to مكتبة دير شرف العلمية! 🤖 I am here to help you find the best products. How can I help you today?',

    // Cookie
    cookieText: 'We use cookies to improve your experience, analyze traffic, and personalize ads.',
    agree: 'Agree',
    decline: 'Decline',
  },
};