// src/App.tsx
import React, { useState, createContext, useContext, Suspense, useEffect, useCallback, useMemo } from 'react';
import { HashRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';

// Components
import Header from './components/Header';
import Footer from './components/Footer';
import CartDrawer from './components/CartDrawer';
import QuickViewModal from './components/QuickViewModal';
import Toast from './components/Toast';
import CookieBanner from './components/CookieBanner';
import AdminGuard from './components/AdminGuard';

// Types & Services
import { Product, CartItem, ToastMessage, ToastType, Language, User } from './types';
import { trackPageView, trackEvent } from './services/analytics';
import { TRANSLATIONS } from './constants';
import { db } from './services/storage';
import { auth, isFirebaseInitialized } from './services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

// Lazy Load Pages - تحسين تجربة المستخدم في التحميل
import Account from './pages/Account';
const Home = React.lazy(() => import('./pages/Home'));
const Shop = React.lazy(() => import('./pages/Shop'));
const Cart = React.lazy(() => import('./pages/Cart'));
const Wishlist = React.lazy(() => import('./pages/Wishlist'));
const ProductDetails = React.lazy(() => import('./pages/ProductDetails'));
const Login = React.lazy(() => import('./pages/Login'));
const OrderTracking = React.lazy(() => import('./pages/OrderTracking'));
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'));
const Checkout = React.lazy(() => import('./pages/Checkout'));
const OrderSuccess = React.lazy(() => import('./pages/OrderSuccess'));
const MyOrders = React.lazy(() => import('./pages/MyOrders'));

const ORDER_NOTE_KEY = 'anta_order_note_v1';
const ORDER_NOTE_MAX_CHARS = 600;

// =========================================================
// ✅ Global Scroll Restoration
// =========================================================
const ScrollToTop: React.FC = () => {
  const { pathname, search } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname, search]);
  return null;
};

// =========================================================
// ✅ Context Definition
// =========================================================
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

// =========================================================
// ✅ Main App Component
// =========================================================
const App: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [wishlist, setWishlist] = useState<Set<string>>(new Set());
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [orderNote, setOrderNoteState] = useState('');
  const [language, setLanguageState] = useState<Language>('ar');

  // --- Helpers ---
  const showToast = useCallback((message: string, type: ToastType) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const t = useCallback((key: any, params?: any) => {
    let text = TRANSLATIONS[language][key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => { text = text.replace(`{${k}}`, String(v)); });
    }
    return text;
  }, [language]);

  const getProductTitle = useCallback((product: Product) => 
    language === 'ar' ? product.name : (product.nameEn || product.name), [language]
  );

  // --- Core Actions ---
  const refreshProducts = useCallback(async () => {
    try {
      const data = await db.products.getAll();
      setProducts(data || []);
    } catch (e) { console.error(e); }
  }, []);

  const addToCart = useCallback(async (product: Product, quantity: number = 1) => {
    const qty = Math.max(1, Math.round(quantity));
    setCart((prev) => {
      const existing = prev.find(i => i.id === product.id);
      if (existing) {
        showToast(t('quantity') + ' ' + t('completed'), 'info');
        return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + qty } : i);
      }
      showToast(getProductTitle(product) + ' ' + t('addToCart'), 'success');
      setIsCartOpen(true);
      return [...prev, { ...product, quantity: qty }];
    });
  }, [t, getProductTitle, showToast]);

  const updateCartItemQuantity = useCallback(async (pid: string, n: number) => {
    setCart(prev => prev.map(i => i.id === pid ? { ...i, quantity: Math.max(1, n) } : i));
  }, []);

  const removeFromCart = useCallback((pid: string) => {
    setCart(prev => prev.filter(i => i.id !== pid));
    showToast(t('remove'), 'error');
  }, [t, showToast]);

  const toggleWishlist = useCallback((p: Product) => {
    setWishlist(prev => {
      const next = new Set(prev);
      if (next.has(p.id)) {
        next.delete(p.id); showToast(t('remove'), 'info');
      } else {
        next.add(p.id); showToast(t('wishlist'), 'success');
      }
      return next;
    });
  }, [t, showToast]);

  // --- Effects & Initialization ---
  useEffect(() => {
    // 1. Load Language
    const savedLang = localStorage.getItem('language') as Language;
    if (savedLang) setLanguageState(savedLang);

    // 2. Load Initial Data
    refreshProducts();
    const sc = localStorage.getItem('anta_cart');
    if (sc) try { setCart(JSON.parse(sc)); } catch { }
    
    const sw = localStorage.getItem('anta_wishlist');
    if (sw) try { setWishlist(new Set(JSON.parse(sw))); } catch { }

    const sn = localStorage.getItem(ORDER_NOTE_KEY);
    if (sn) setOrderNoteState(sn);

    // 3. Auth Listener
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const docSnap = await getDoc(doc(getFirestore(), 'users', fbUser.uid));
        const d = docSnap.data();
        setUser({
          id: fbUser.uid,
          name: d?.name || fbUser.displayName || 'User',
          email: fbUser.email || '',
          role: d?.role || 'customer',
          orders: d?.orders || []
        });
      } else { setUser(null); }
    });
    return () => unsubscribe();
  }, [refreshProducts]);

  useEffect(() => {
    localStorage.setItem('anta_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem('anta_wishlist', JSON.stringify(Array.from(wishlist)));
  }, [wishlist]);

  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  const cartCount = useMemo(() => cart.reduce((a, c) => a + c.quantity, 0), [cart]);

  return (
    <CartContext.Provider value={{
      products, refreshProducts, cart, wishlist, addToCart, updateCartItemQuantity,
      removeFromCart, clearCart: () => setCart([]), toggleWishlist, cartCount,
      wishlistCount: wishlist.size, isCartOpen, setIsCartOpen, openQuickView: (p) => setQuickViewProduct(p),
      showToast, language, setLanguage: (l) => { setLanguageState(l); localStorage.setItem('language', l); },
      t, getProductTitle, user, login: setUser, logout: () => auth.signOut(),
      orderNote, setOrderNote: (n) => { setOrderNoteState(n); localStorage.setItem(ORDER_NOTE_KEY, n); },
      clearOrderNote: () => { setOrderNoteState(''); localStorage.removeItem(ORDER_NOTE_KEY); },
      isLoading, addProducts: async () => {}, deleteProduct: async () => {}, updateProduct: async () => {}
    }}>
      <HashRouter>
        <ScrollToTop />
        <div className={`flex flex-col min-h-screen bg-slate-50 ${language === 'ar' ? 'font-ar' : 'font-en'}`}>
          <Header />
          <CartDrawer />
          <QuickViewModal product={quickViewProduct} isOpen={!!quickViewProduct} onClose={() => setQuickViewProduct(null)} />
          <CookieBanner />

          {/* Toast System */}
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 sm:left-auto sm:right-6 sm:translate-x-0 z-[100] flex flex-col gap-2 pointer-events-none">
            {toasts.map(toast => <div key={toast.id} className="pointer-events-auto"><Toast toast={toast} onClose={removeToast} /></div>)}
          </div>

          <main className="flex-grow">
            <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-10 h-10 border-4 border-t-secondary-DEFAULT rounded-full animate-spin" /></div>}>
              <Routes>
                <Route path="/account" element={<Account />} />
                <Route path="/" element={<Home />} />
                <Route path="/shop" element={<Shop />} />
                <Route path="/cart" element={<Cart />} />
                <Route path="/product/:id" element={<ProductDetails />} />
                <Route path="/wishlist" element={<Wishlist />} />
                <Route path="/login" element={<Login />} />
                <Route path="/tracking" element={<OrderTracking />} />
                <Route path="/checkout" element={<Checkout />} />
                <Route path="/order-success/:id" element={<OrderSuccess />} />
                <Route path="/my-orders" element={<MyOrders />} />
                <Route path="/admin" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
                <Route path="*" element={<Navigate to="/" replace />} />
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