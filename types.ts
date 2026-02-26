// src/types.ts

/** =========================================================
 * ✅ Core Types
 * ========================================================= */

export type Category =
  | 'Stationery'
  | 'Bags'
  | 'Offers'
  | 'ArtSupplies'
  | 'Courses'
  | 'EducationalCards'
  | 'Games';

/**
 * ✅ SubCategory مرن (string)
 * - يفضّل يكون "slug" ثابت مثل:
 *   pencils, pens, 1-2y, girls, bundle...
 */
export type SubCategory = string;

/** =========================================================
 * ✅ Product & Cart
 * ========================================================= */

export interface Product {
  id: string;

  /** Names */
  name: string; // Arabic
  nameEn: string; // English

  /** Pricing */
  price: number;
  originalPrice?: number;

  /** Category */
  category: Category;

  /**
   * ✅ SubCategory (Recommended key)
   * - هذا اللي لازم تستخدمه في Shop/Admin/EditProductModal
   */
  subCategory?: SubCategory;

  /**
   * ⚠️ Deprecated: قديم
   * - إذا عندك منتجات أو كود قديم يستخدم subcategory
   * - يفضّل توحيد المشروع على subCategory فقط
   */
  subcategory?: SubCategory;

  /** Optional tags/keywords */
  tags?: string[];

  /**
   * ✅ Ratings (Backward compatibility)
   * - هذه الحقول كانت موجودة من قبل (لا نحذفها عشان ما ينكسر الكود القديم)
   */
  rating: number; // will mirror ratingAvg
  reviews: number; // will mirror ratingCount

  /**
   * ✅ Real aggregate fields (World-Class)
   * - يتم تحديثها تلقائيًا في reviewsApi بعد أي إضافة/حذف/إخفاء
   */
  ratingAvg?: number; // 0..5
  ratingCount?: number; // number of published reviews

  /** Images */
  image: string; // primary image
  images?: string[]; // optional gallery (up to 10)

  /** Content */
  description: string;
  details?: string;
  brand?: string;

  /** Inventory */
  stock: number;
  isNew?: boolean;

  /** Media */
  videoUrl?: string;
}

export interface CartItem extends Product {
  quantity: number;
}

/** =========================================================
 * ✅ Simple Reviews (Legacy / UI Mock)
 * ========================================================= */

export interface Review {
  id: string;
  userName: string;
  rating: number; // 1..5
  comment: string;
  date: string; // ISO or yyyy-mm-dd
}

/** =========================================================
 * ✅ Shop Filtering & Sorting
 * ========================================================= */

export type SortOption = 'price-asc' | 'price-desc' | 'rating' | 'newest';

export interface FilterState {
  category: Category | 'All';
  subCategory?: SubCategory | 'All';
  minPrice: number;
  maxPrice: number;
  searchQuery: string;
}

/** =========================================================
 * ✅ Chat
 * ========================================================= */

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

/** =========================================================
 * ✅ Users
 * ========================================================= */

export type UserRole = 'admin' | 'customer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  password?: string; // Demo only (in real apps: hashed)
  orders: string[]; // Order IDs
}

/**
 * ✅ AppUser (يسهّل استعماله في الشاشات والخدمات)
 * - مطابق لـ User لكن بدون password
 */
export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  orders: string[];
};

/** =========================================================
 /** =========================================================
 * ✅ Orders
 * ========================================================= */

export interface OrderItem {
  productId: string;

  /** ✅ Names */
  name: string;
  nameEn?: string; // optional (helps bilingual UIs)

  price: number;
  quantity: number;

  image: string;
  images?: string[];

  /** ✅ store category info (optional, useful for analytics) */
  category?: Category;

  /** ✅ New preferred field */
  subCategory?: SubCategory;

  /** ⚠️ Deprecated old field */
  subcategory?: SubCategory;
}

export type OrderStatus = 'processing' | 'shipped' | 'delivered' | 'cancelled';

export type PaymentMethodId = 'card' | 'paypal' | 'cod' | 'cliq';

export type CliqPaymentDetails = {
  cliqReference?: string;
  receiptImage?: string; // ✅ NEW: DataURL or URL (optional)
  isPaid: boolean; // ✅ keeps official state
};

export interface Order {
  id: string;
  userId: string; // 'guest' or user id

  items: OrderItem[];

  status: OrderStatus;
  date: string; // yyyy-mm-dd or ISO string
  total: number;

  shippingMethod: string;

  paymentMethod: PaymentMethodId;

  /** ✅ NEW: Order note saved officially */
  note?: string;

  /** ✅ Payment details (CliQ or future gateways) */
  paymentDetails?: CliqPaymentDetails;

  address: {
    fullName: string;
    city: string;
    street: string;
    phone: string;
  };
}
/** =========================================================
 * ✅ UI: Toasts
 * ========================================================= */

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

/** =========================================================
 * ✅ App Language
 * ========================================================= */

export type Language = 'ar' | 'en';

/** =========================================================
 * ✅ Shipping / Payment
 * ========================================================= */

export interface ShippingMethod {
  id: string;
  name: string;
  price: number;
  duration: string;
  type: 'local' | 'international';
}

export interface PaymentMethod {
  id: PaymentMethodId;
  name: string;
}

/** =========================================================
 * ✅ Firestore Reviews (Real System)
 * ========================================================= */

export type ReviewStatus = 'published' | 'hidden';

export type AdminReply = {
  text: string;
  adminId: string;
  adminName: string;
  atMs: number; // local timestamp (مناسب لواجهة العرض)
};

export type ReviewDoc = {
  id: string;

  productId: string;
  userId: string;
  userName: string;
  userEmail?: string;

  rating: number; // 1..5
  comment: string;

  status?: ReviewStatus;

  likesCount?: number;
  likesBy?: Record<string, boolean>;

  adminReply?: AdminReply | null;

  // Firebase timestamps أو fallback محلي
  createdAt?: any;
  updatedAt?: any;
  createdAtMs?: number;
  updatedAtMs?: number;
};

export type ReviewInput = {
  productId: string;
  userId: string;
  userName: string;
  userEmail?: string;
  rating: number;
  comment: string;
};