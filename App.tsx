// src/App.tsx
import React, { useState, createContext, useContext, Suspense, useEffect, useCallback } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';

import Header from './components/Header';
import Footer from './components/Footer';
import CartDrawer from './components/CartDrawer';
import QuickViewModal from './components/QuickViewModal';
import Toast from './components/Toast';
import CookieBanner from './components/CookieBanner';

import { Product, CartItem, ToastMessage, ToastType, Language, User } from './types';
import { trackPageView, trackEvent } from './services/analytics';
import { TRANSLATIONS } from './constants';
import { db } from './services/storage';

import { auth, isFirebaseInitialized } from './services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

// Lazy Load
const Cart = React.lazy(() => import('./pages/Cart'));
const Wishlist = React.lazy(() => import('./pages/Wishlist'));
const Home = React.lazy(() => import('./pages/Home'));
const Shop = React.lazy(() => import('./pages/Shop'));
const ProductDetails = React.lazy(() => import('./pages/ProductDetails'));
const Login = React.lazy(() => import('./pages/Login'));
const OrderTracking = React.lazy(() => import('./pages/OrderTracking'));
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'));
const Checkout = React.lazy(() => import('./pages/Checkout'));
const OrderSuccess = React.lazy(() => import('./pages/OrderSuccess'));
const MyOrders = React.lazy(() => import('./pages/MyOrders'));

/**
 * ✅ Order Note: جزء رسمي من الطلب
 * - مصدر الحقيقة: CartContext
 * - localStorage: فقط للحفظ المؤقت وتجربة المستخدم
 */
const ORDER_NOTE_KEY = 'anta_order_note_v1';
const ORDER_NOTE_MAX_CHARS = 600;
const NOTE_SAVE_DEBOUNCE_MS = 350;

const sanitizeOrderNote = (value: string) => {
  // ملاحظة: React يحمي من XSS في العرض النصي افتراضياً،
  // لكن نضع حدود واضحة ونقص الزائد لتجنب تضخيم التخزين.
  const v = String(value ?? '');
  return v.length > ORDER_NOTE_MAX_CHARS ? v.slice(0, ORDER_NOTE_MAX_CHARS) : v;
};

// Context Definitions
interface CartContextType {
  products: Product[];
  refreshProducts: () => Promise<void>;
  addProducts: (newProducts: Product[]) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  updateProduct: (p: Product) => Promise<void>;

  cart: CartItem[];
  wishlist: Set<string>;

  addToCart: (product: Product, quantity?: number) => Promise<void>;
  updateCartItemQuantity: (productId: string, nextQty: number) => Promise<void>;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;

  toggleWishlist: (product: Product) => void;

  cartCount: number;
  wishlistCount: number;

  isCartOpen: boolean;
  setIsCartOpen: (isOpen: boolean) => void;

  openQuickView: (product: Product) => void;

  showToast: (message: string, type: ToastType) => void;

  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: keyof typeof TRANSLATIONS['en'], params?: Record<string, string | number>) => string;

  getProductTitle: (product: Product) => string;

  user: User | null;
  login: (u: User) => void;
  logout: () => void;

  // ✅ NEW: Order Note (رسمي)
  orderNote: string;
  setOrderNote: (note: string) => void;
  clearOrderNote: () => void;

  isLoading: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within a CartProvider');
  return context;
};

// Analytics Wrapper Component
const AnalyticsTracker = () => {
  const location = useLocation();

  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location]);

  return null;
};

// Loading Component
const PageLoader = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-secondary-DEFAULT rounded-full animate-spin" />
      <p className="text-slate-500 font-medium animate-pulse">Loading...</p>
    </div>
  </div>
);

const App: React.FC = () => {
  // Global State
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [wishlist, setWishlist] = useState<Set<string>>(new Set());
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // ✅ NEW: Order Note (رسمي) - تحميل أولي من localStorage
  const [orderNote, setOrderNoteState] = useState<string>(() => {
    try {
      return sanitizeOrderNote(localStorage.getItem(ORDER_NOTE_KEY) || '');
    } catch {
      return '';
    }
  });

  // Language State with Persistence
  const [language, setLanguageState] = useState<Language>(() => {
    const savedLang = localStorage.getItem('language');
    return savedLang === 'ar' || savedLang === 'en' ? savedLang : 'ar';
  });

  // Translation Helper
  const t = useCallback(
    (key: keyof typeof TRANSLATIONS['en'], params?: Record<string, string | number>) => {
      let text = TRANSLATIONS[language][key] || key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(`{${k}}`, String(v));
        });
      }
      return text;
    },
    [language]
  );

  // Product Title Helper
  const getProductTitle = useCallback(
    (product: Product) => (language === 'ar' ? product.name : product.nameEn),
    [language]
  );

  const showToast = useCallback((message: string, type: ToastType) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const refreshProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await db.products.getAll();
      setProducts(Array.isArray(data) ? data : []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial Load from DB + Local Storage + Auth
  useEffect(() => {
    refreshProducts();

    // Load wishlist
    const savedWishlist = localStorage.getItem('anta_wishlist');
    if (savedWishlist) {
      try {
        setWishlist(new Set(JSON.parse(savedWishlist)));
      } catch {
        setWishlist(new Set());
      }
    }

    // Load Cart
    const savedCart = localStorage.getItem('anta_cart');
    if (savedCart) {
      try {
        setCart(JSON.parse(savedCart));
      } catch {
        setCart([]);
      }
    }

    // Handle Auth State Persistence
    if (isFirebaseInitialized && auth) {
      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (!firebaseUser) {
          setUser(null);
          return;
        }

        try {
          const firestore = getFirestore();
          const docRef = doc(firestore, 'users', firebaseUser.uid);
          const docSnap = await getDoc(docRef);

          if (docSnap.exists()) {
            const userData: any = docSnap.data();
            setUser({
              id: firebaseUser.uid,
              name: userData?.name || firebaseUser.displayName || 'User',
              email: firebaseUser.email || '',
              role: userData?.role || 'customer',
              orders: userData?.orders || [],
            });
          } else {
            setUser({
              id: firebaseUser.uid,
              name: firebaseUser.displayName || 'User',
              email: firebaseUser.email || '',
              role: 'customer',
              orders: [],
            });
          }
        } catch (e) {
          console.error('Error fetching user details:', e);
        }
      });

      return () => unsubscribe();
    }

    // Mock Fallback
    const currentUser = db.users.getCurrent();
    if (currentUser) setUser(currentUser);
  }, [refreshProducts]);

  // Sync Cart & Wishlist
  useEffect(() => {
    localStorage.setItem('anta_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem('anta_wishlist', JSON.stringify(Array.from(wishlist)));
  }, [wishlist]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('language', lang);
  }, []);

  // Handle Direction and Lang Attribute
  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  // ✅ NEW: ضبط orderNote عبر Context (مع sanitize)
  const setOrderNote = useCallback((note: string) => {
    setOrderNoteState(sanitizeOrderNote(note));
  }, []);

  const clearOrderNote = useCallback(() => {
    setOrderNoteState('');
    try {
      localStorage.removeItem(ORDER_NOTE_KEY);
    } catch {
      // ignore
    }
  }, []);

  // ✅ NEW: حفظ orderNote في localStorage بشكل Debounced (أداء أفضل)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(ORDER_NOTE_KEY, sanitizeOrderNote(orderNote));
      } catch {
        // ignore
      }
    }, NOTE_SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [orderNote]);

  // ✅ تحديث كمية منتج في السلة (Fix عالمي + stock check)
  const updateCartItemQuantity = useCallback(
    async (productId: string, nextQty: number) => {
      const qty = Math.max(1, Math.min(99, Math.round(Number(nextQty) || 1)));

      const currentProduct = await db.products.getById(productId);
      const availableStock = currentProduct ? Number((currentProduct as any).stock || 0) : 0;

      // إذا المنتج غير موجود أو مخزونه صفر
      if (availableStock <= 0) {
        showToast(t('outOfStock'), 'error');
        return;
      }

      // لا تتجاوز المخزون
      if (qty > availableStock) {
        showToast(`${t('outOfStock')} (Max: ${availableStock})`, 'error');
        return;
      }

      setCart((prev) => prev.map((item) => (item.id === productId ? { ...item, quantity: qty } : item)));
      trackEvent('Cart', 'UpdateQuantity', productId);
    },
    [showToast, t]
  );

  // Actions
  const addProducts = useCallback(
    async (newProducts: Product[]) => {
      setIsLoading(true);
      try {
        await db.products.add(newProducts);
        await refreshProducts();
        showToast(`${t('uploadProducts')} ${t('completed')}`, 'success');
      } finally {
        setIsLoading(false);
      }
    },
    [refreshProducts, showToast, t]
  );

  const deleteProduct = useCallback(
    async (id: string) => {
      setIsLoading(true);
      try {
        const updated = await db.products.delete(id);
        setProducts(updated);
        showToast('Product deleted successfully', 'success');
      } finally {
        setIsLoading(false);
      }
    },
    [showToast]
  );

  const updateProduct = useCallback(
    async (p: Product) => {
      setIsLoading(true);
      try {
        const updated = await db.products.update(p);
        setProducts(updated);
        showToast('Product updated successfully', 'success');
      } finally {
        setIsLoading(false);
      }
    },
    [showToast]
  );

  const addToCart = useCallback(
    async (product: Product, quantity: number = 1) => {
      const qty = Math.max(1, Math.min(99, Math.round(Number(quantity) || 1)));

      const currentProduct = await db.products.getById(product.id);
      const availableStock = currentProduct ? Number((currentProduct as any).stock || 0) : 0;

      if (availableStock <= 0) {
        showToast(t('outOfStock'), 'error');
        return;
      }

      setCart((prev) => {
        const existing = prev.find((item) => item.id === product.id);
        const currentQty = existing ? Number(existing.quantity || 0) : 0;

        if (currentQty + qty > availableStock) {
          showToast(`${t('outOfStock')} (Max: ${availableStock})`, 'error');
          return prev;
        }

        trackEvent('Cart', 'Add', product.id);

        if (existing) {
          showToast(`${t('quantity')} ${t('completed')}`, 'info');
          return prev.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + qty } : item));
        }

        showToast(`${getProductTitle(product)} ${t('addToCart')}`, 'success');
        setIsCartOpen(true);
        return [...prev, { ...product, quantity: qty }];
      });
    },
    [getProductTitle, showToast, t]
  );

  const removeFromCart = useCallback(
    (productId: string) => {
      setCart((prev) => prev.filter((item) => item.id !== productId));
      trackEvent('Cart', 'Remove', productId);
      showToast(t('remove'), 'error');
    },
    [showToast, t]
  );

  const clearCart = useCallback(() => {
    setCart([]);
    // ✅ اختياري ومناسب بعد نجاح الطلب: تفريغ ملاحظة الطلب مع السلة
    // إذا بدك تظل الملاحظة حتى لو السلة فاضية، احذف السطر التالي:
    setOrderNoteState('');
  }, []);

  const toggleWishlist = useCallback(
    (product: Product) => {
      setWishlist((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(product.id)) {
          newSet.delete(product.id);
          trackEvent('Wishlist', 'Remove', product.id);
          showToast(t('remove'), 'info');
        } else {
          newSet.add(product.id);
          trackEvent('Wishlist', 'Add', product.id);
          showToast(t('wishlist'), 'success');
        }
        return newSet;
      });
    },
    [showToast, t]
  );

  const openQuickView = useCallback((product: Product) => {
    setQuickViewProduct(product);
    trackEvent('Product', 'QuickView', product.id);
  }, []);

  const closeQuickView = useCallback(() => {
    setQuickViewProduct(null);
  }, []);

  const login = useCallback((u: User) => {
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    db.users.logout();
    setUser(null);

    // ✅ أمان/خصوصية: لا نترك بيانات طلب سابقة بعد تسجيل الخروج
    clearOrderNote();

    showToast(t('logout'), 'info');
    window.location.hash = '/';
  }, [showToast, t, clearOrderNote]);

  const cartCount = cart.reduce((acc, item) => acc + Number(item.quantity || 0), 0);
  const wishlistCount = wishlist.size;

  return (
    <CartContext.Provider
      value={{
        products,
        refreshProducts,
        addProducts,
        deleteProduct,
        updateProduct,

        cart,
        wishlist,
        addToCart,
        updateCartItemQuantity,
        removeFromCart,
        clearCart,
        toggleWishlist,

        cartCount,
        wishlistCount,

        isCartOpen,
        setIsCartOpen,

        openQuickView,
        showToast,

        language,
        setLanguage,
        t,
        getProductTitle,

        user,
        login,
        logout,

        // ✅ NEW: Order Note (رسمي)
        orderNote,
        setOrderNote,
        clearOrderNote,

        isLoading,
      }}
    >
      <HashRouter>
        <AnalyticsTracker />

        <div
          className={`flex flex-col min-h-screen font-sans bg-slate-50 text-slate-900 ${
            language === 'ar' ? 'font-ar' : 'font-en'
          }`}
          dir={language === 'ar' ? 'rtl' : 'ltr'}
        >
          <Header />
          <CartDrawer />

          <QuickViewModal product={quickViewProduct} isOpen={!!quickViewProduct} onClose={closeQuickView} />

          <CookieBanner />

          {/* Toast Container */}
          <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
            {toasts.map((toast) => (
              <div key={toast.id} className="pointer-events-auto">
                <Toast toast={toast} onClose={removeToast} />
              </div>
            ))}
          </div>

          <main className="flex-grow">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/shop" element={<Shop />} />
                <Route path="/cart" element={<Cart />} />
                <Route path="/product/:id" element={<ProductDetails />} />
                <Route path="/wishlist" element={<Wishlist />} />
                <Route path="/login" element={<Login />} />
                <Route path="/tracking" element={<OrderTracking />} />
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/checkout" element={<Checkout />} />
                <Route path="/order-success/:id" element={<OrderSuccess />} />
                <Route path="/my-orders" element={<MyOrders />} />
              </Routes>
            </Suspense>
          </main>

          <Footer />
        </div>
      </HashRouter>
    </CartContext.Provider>
  );
};

export default App;