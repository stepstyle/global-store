// src/services/storage.ts
import { Product, Order, User } from '../types';
import { MOCK_PRODUCTS, MOCK_ORDERS } from '../constants';
import { db as firestore, auth, isFirebaseInitialized } from './firebase';

import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDoc,
  orderBy,
  limit,
  startAfter,
  DocumentSnapshot,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendEmailVerification,
} from 'firebase/auth';

// Keys for LocalStorage
const KEYS = {
  PRODUCTS: 'anta_products',
  ORDERS: 'anta_orders',
  USERS: 'anta_users',
  CURRENT_USER: 'anta_current_user',
};

/**
 * ✅ Firebase readiness (supports boolean OR function export safely)
 */
const firebaseReady = (): boolean => {
  try {
    return typeof isFirebaseInitialized === 'function'
      ? !!(isFirebaseInitialized as any)()
      : !!isFirebaseInitialized;
  } catch {
    return false;
  }
};

/**
 * ✅ Remove any undefined recursively (Firestore doesn't accept undefined)
 * ✅ IMPORTANT: only deep-clean PLAIN objects (not Firestore special types like Timestamp/FieldValue)
 */
const isPlainObject = (v: any) =>
  v !== null &&
  typeof v === 'object' &&
  (v.constructor === Object || Object.getPrototypeOf(v) === Object.prototype);

const cleanForFirestore = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map((v) => cleanForFirestore(v))
      .filter((v) => v !== undefined) as any;
  }

  // ✅ Do NOT traverse Firestore sentinel objects (serverTimestamp etc.)
  if (isPlainObject(value)) {
    const out: any = {};
    Object.keys(value as any).forEach((k) => {
      const v = (value as any)[k];
      if (v === undefined) return;
      const cleaned = cleanForFirestore(v);
      if (cleaned === undefined) return;
      out[k] = cleaned;
    });
    return out;
  }

  return value;
};

// ==============================
// ✅ Search Helpers (Prefix Search)
// ==============================

/** end range helper for prefix query */
const prefixEnd = (s: string) => s + '\uf8ff';

/**
 * normalize for index:
 * - lower case
 * - remove symbols
 * - normalize spaces
 */
export const normalizeIndex = (s: string) =>
  String(s || '')
    .toLowerCase()
    // keep letters+numbers from any language + spaces
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Ensure required fields exist on product:
 * - nameIndex: `${name} ${nameEn}` normalized
 * - createdAt: ms timestamp (number)
 * - ratingAvg: default 0
 */
const ensureProductSearchFields = (p: Product): Product => {
  const anyP: any = p as any;

  const name = String(anyP?.name ?? '').trim();
  const nameEn = String(anyP?.nameEn ?? '').trim();

  const nameIndex = normalizeIndex(`${name} ${nameEn}`);
  const createdAt =
    typeof anyP?.createdAt === 'number' && Number.isFinite(anyP.createdAt)
      ? anyP.createdAt
      : Date.now();

  const ratingAvg =
    Number.isFinite(Number(anyP?.ratingAvg))
      ? Number(anyP.ratingAvg)
      : 0;

  return {
    ...(p as any),
    nameIndex,
    createdAt,
    ratingAvg,
  } as Product;
};

/**
 * ✅ Local fallback only (when Firebase isn't available)
 */
const initLocalData = () => {
  if (!localStorage.getItem(KEYS.PRODUCTS)) {
    localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(MOCK_PRODUCTS));
  }
  if (!localStorage.getItem(KEYS.ORDERS)) {
    localStorage.setItem(KEYS.ORDERS, JSON.stringify(MOCK_ORDERS));
  }
  if (!localStorage.getItem(KEYS.USERS)) {
    const defaultAdmin: User = {
      id: 'admin-1',
      name: 'Admin User',
      email: 'admin@antastore.com',
      role: 'admin',
      password: 'admin',
      orders: [],
    };
    localStorage.setItem(KEYS.USERS, JSON.stringify([defaultAdmin]));
  }
};

initLocalData();

// ==============================
// ✅ Types for listing products
// ==============================

export type ProductListSort = 'newest' | 'price-asc' | 'price-desc' | 'rating';

export type ProductListArgs = {
  q?: string;
  category?: string;
  subcategory?: string;
  priceMax?: number;
  minRating?: number;
  sort?: ProductListSort;
  pageSize?: number;
  cursor?: DocumentSnapshot | null;
};

export type ProductListResult = {
  items: Product[];
  nextCursor: DocumentSnapshot | null;
};

/**
 * ✅ DB Service
 * - Firebase ON: Firestore
 * - Firebase OFF: LocalStorage + MOCK
 */
export const db = {
  products: {
    getAll: async (): Promise<Product[]> => {
      if (firebaseReady()) {
        try {
          const snapshot = await getDocs(collection(firestore, 'products'));
          if (snapshot.empty) return [];
          return snapshot.docs.map((d) => ({ ...(d.data() as any), id: d.id } as Product));
        } catch (e) {
          console.error(e);
          return [];
        }
      }

      return new Promise((resolve) => {
        setTimeout(() => resolve(JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]')), 300);
      });
    },

    list: async (args: ProductListArgs): Promise<ProductListResult> => {
      const {
        q = '',
        category = '',
        subcategory = '',
        priceMax,
        minRating,
        sort = 'newest',
        pageSize = 20,
        cursor = null,
      } = args || {};

      if (!firebaseReady()) {
        const all = JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]') as any[];
        const qNorm = normalizeIndex(q);

        let result = all;

        if (qNorm) {
          result = result.filter((p) => {
            const idx = normalizeIndex(`${p?.name ?? ''} ${p?.nameEn ?? ''}`);
            return idx.startsWith(qNorm);
          });
        }

        if (category) result = result.filter((p) => String(p?.category) === String(category));
        if (subcategory) result = result.filter((p) => String(p?.subcategory) === String(subcategory));

        if (typeof priceMax === 'number' && Number.isFinite(priceMax)) {
          result = result.filter((p) => Number(p?.price || 0) <= priceMax);
        }

        if (typeof minRating === 'number' && minRating > 0) {
          result = result.filter((p) => Number(p?.ratingAvg || 0) >= minRating);
        }

        const sorted = [...result];
        if (sort === 'price-asc') sorted.sort((a, b) => Number(a?.price || 0) - Number(b?.price || 0));
        else if (sort === 'price-desc') sorted.sort((a, b) => Number(b?.price || 0) - Number(a?.price || 0));
        else if (sort === 'rating') sorted.sort((a, b) => Number(b?.ratingAvg || 0) - Number(a?.ratingAvg || 0));
        else sorted.sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));

        return { items: sorted.slice(0, pageSize), nextCursor: null };
      }

      const colRef = collection(firestore, 'products');

      const qNorm = normalizeIndex(q);
      const constraints: any[] = [];

      if (category) constraints.push(where('category', '==', category));
      if (subcategory) constraints.push(where('subcategory', '==', subcategory));

      if (typeof priceMax === 'number' && Number.isFinite(priceMax)) {
        constraints.push(where('price', '<=', priceMax));
      }

      if (typeof minRating === 'number' && minRating > 0) {
        constraints.push(where('ratingAvg', '>=', minRating));
      }

      if (qNorm) {
        constraints.push(where('nameIndex', '>=', qNorm));
        constraints.push(where('nameIndex', '<=', prefixEnd(qNorm)));
        constraints.push(orderBy('nameIndex', 'asc'));
      } else {
        if (sort === 'price-asc') constraints.push(orderBy('price', 'asc'));
        else if (sort === 'price-desc') constraints.push(orderBy('price', 'desc'));
        else if (sort === 'rating') constraints.push(orderBy('ratingAvg', 'desc'));
        else constraints.push(orderBy('createdAt', 'desc'));
      }

      constraints.push(limit(Math.max(1, Math.min(60, Math.floor(pageSize)))));

      let qRef = query(colRef, ...constraints);
      if (cursor) qRef = query(colRef, ...constraints, startAfter(cursor));

      const snap = await getDocs(qRef);

      const items = snap.docs.map((d) => ({ ...(d.data() as any), id: d.id } as Product));
      const nextCursor =
        snap.docs.length === Math.max(1, Math.min(60, Math.floor(pageSize)))
          ? snap.docs[snap.docs.length - 1]
          : null;

      return { items, nextCursor };
    },

    getById: async (id: string): Promise<Product | undefined> => {
      if (firebaseReady()) {
        const docRef = doc(firestore, 'products', id);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? ({ ...(docSnap.data() as any), id: docSnap.id } as Product) : undefined;
      }

      const products = JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]');
      return products.find((p: Product) => p.id === id);
    },

    updateStock: async (id: string, quantityToDeduct: number) => {
      if (firebaseReady()) {
        const docRef = doc(firestore, 'products', id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const currentStock = (docSnap.data() as any).stock ?? 0;
          await updateDoc(docRef, { stock: Math.max(0, currentStock - quantityToDeduct) });
        }
        return;
      }

      const products = JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]');
      const index = products.findIndex((p: Product) => p.id === id);
      if (index !== -1) {
        products[index].stock = Math.max(0, products[index].stock - quantityToDeduct);
        localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(products));
      }
    },

    add: async (newProducts: Product[]): Promise<Product[]> => {
      if (firebaseReady()) {
        for (const p of newProducts) {
          const enriched = ensureProductSearchFields(p);
          const safeProduct = cleanForFirestore(enriched);
          await setDoc(doc(firestore, 'products', (enriched as any).id), safeProduct as any);
        }
        return newProducts.map(ensureProductSearchFields);
      }

      const products = JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]');
      const updated = [...products, ...newProducts.map(ensureProductSearchFields)];
      localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(updated));
      return updated;
    },

    delete: async (id: string): Promise<Product[]> => {
      if (firebaseReady()) {
        await deleteDoc(doc(firestore, 'products', id));
        return db.products.getAll();
      }

      const products = JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]');
      const updated = products.filter((p: Product) => p.id !== id);
      localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(updated));
      return updated;
    },

    update: async (updatedProduct: Product): Promise<Product[]> => {
      if (firebaseReady()) {
        const enriched = ensureProductSearchFields(updatedProduct);
        const safeProduct = cleanForFirestore(enriched);

        await setDoc(doc(firestore, 'products', (enriched as any).id), safeProduct as any, { merge: true });
        return db.products.getAll();
      }

      const products = JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]');
      const index = products.findIndex((p: Product) => p.id === updatedProduct.id);
      if (index !== -1) {
        products[index] = ensureProductSearchFields(updatedProduct);
        localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(products));
      }
      return products;
    },
  },

    orders: {
    /**
     * ✅ Realtime subscription (Admin)
     */
   subscribeAll: (
  cb: (orders: Order[]) => void,
  onError?: (error: any) => void
) => {
  if (firebaseReady()) {
    const qRef = query(collection(firestore, 'orders'), orderBy('createdAt', 'desc'));

    return onSnapshot(
      qRef,
      (snap) => {
        const items = snap.docs.map(
          (d) => ({ ...(d.data() as any), id: d.id } as Order)
        );
        cb(items);
      },
      (error) => {
        console.error('db.orders.subscribeAll failed:', error);
        onError?.(error);
      }
    );
  }

  cb(JSON.parse(localStorage.getItem(KEYS.ORDERS) || '[]'));
  return () => {};
},
    getAll: async (): Promise<Order[]> => {
      if (firebaseReady()) {
        const qRef = query(collection(firestore, 'orders'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(qRef);
        return snapshot.docs.map((d) => ({ ...(d.data() as any), id: d.id } as Order));
      }

      return new Promise((resolve) => {
        setTimeout(() => resolve(JSON.parse(localStorage.getItem(KEYS.ORDERS) || '[]')), 300);
      });
    },

    getByUserId: async (userId: string): Promise<Order[]> => {
      if (firebaseReady()) {
        const qRef = query(collection(firestore, 'orders'), where('userId', '==', userId), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(qRef);
        return snapshot.docs.map((d) => ({ ...(d.data() as any), id: d.id } as Order));
      }

      const orders = JSON.parse(localStorage.getItem(KEYS.ORDERS) || '[]');
      return orders.filter((o: Order) => o.userId === userId);
    },

    getById: async (id: string): Promise<Order | undefined> => {
      if (firebaseReady()) {
        const docRef = doc(firestore, 'orders', id);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? ({ ...(docSnap.data() as any), id: docSnap.id } as Order) : undefined;
      }

      const orders = JSON.parse(localStorage.getItem(KEYS.ORDERS) || '[]');
      return orders.find((o: Order) => o.id === id);
    },

    hasPurchasedProduct: async (userId: string, productId: string, allowedStatuses: any[] = ['processing', 'shipped', 'delivered']): Promise<boolean> => {
      const uid = String(userId || '').trim();
      const pid = String(productId || '').trim();

      if (!uid || !pid) return false;
      if (uid === 'guest') return false;

      const orders = await db.orders.getByUserId(uid);

      return orders.some((o: any) => {
        if (!allowedStatuses.includes(o.status)) return false;
        const items = Array.isArray(o.items) ? o.items : [];
        return items.some((it: any) => it?.productId === pid);
      });
    },

    /**
     * ✅ Create order (GLOBAL SAFE):
     * - status: "new"
     * - seenByAdmin: false
     * - createdAt/updatedAt: serverTimestamp() ALWAYS in Firebase mode
     */
    create: async (order: Order): Promise<Order> => {
  const anyOrder: any = order as any;

  const base: any = {
    ...anyOrder,
    status: String(anyOrder?.status || 'new').toLowerCase(),
    seenByAdmin: typeof anyOrder?.seenByAdmin === 'boolean' ? anyOrder.seenByAdmin : false,
  };

  if (firebaseReady()) {
    const payload = cleanForFirestore({
      ...base,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    try {
      await setDoc(doc(firestore, 'orders', anyOrder.id), payload as any);
      return order;
    } catch (error) {
      console.error('db.orders.create failed:', error, {
        orderId: anyOrder?.id,
      });
      throw error;
    }
  }

  const orders = JSON.parse(localStorage.getItem(KEYS.ORDERS) || '[]');
  orders.unshift({
    ...base,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  localStorage.setItem(KEYS.ORDERS, JSON.stringify(orders));

  (anyOrder.items || []).forEach((item: any) => {
    db.products.updateStock(item.productId, item.quantity);
  });

  return new Promise((resolve) => setTimeout(() => resolve(order), 800));
},

    /**
     * ✅ Update status + updatedAt + seenByAdmin
     */
    updateStatus: async (id: string, status: any): Promise<Order[]> => {
      const nextStatus = String(status || '').toLowerCase();

      if (firebaseReady()) {
        await updateDoc(doc(firestore, 'orders', id), {
          status: nextStatus,
          seenByAdmin: true,
          updatedAt: serverTimestamp(),
        } as any);

        return db.orders.getAll();
      }

      const orders = JSON.parse(localStorage.getItem(KEYS.ORDERS) || '[]');
      const index = orders.findIndex((o: any) => o.id === id);
      if (index !== -1) {
        orders[index].status = nextStatus;
        orders[index].seenByAdmin = true;
        orders[index].updatedAt = new Date().toISOString();
        localStorage.setItem(KEYS.ORDERS, JSON.stringify(orders));
      }
      return orders;
    },
  },

  users: {
    login: async (email: string, password: string): Promise<User | null> => {
      if (firebaseReady()) {
        try {
          const userCredential = await signInWithEmailAndPassword(auth, email, password);
          const uid = userCredential.user.uid;

          const docRef = doc(firestore, 'users', uid);
          const docSnap = await getDoc(docRef);

          if (docSnap.exists()) {
            const userData = docSnap.data() as any;
            const user: User = {
              id: uid,
              name: userData.name || userCredential.user.displayName || 'User',
              email: userCredential.user.email || '',
              role: userData.role || 'customer',
              orders: userData.orders || [],
            };
            return user;
          }

          return {
            id: uid,
            name: userCredential.user.displayName || 'User',
            email: userCredential.user.email || '',
            role: 'customer',
            orders: [],
          };
        } catch (error) {
          console.error('Login Error:', error);
          throw error;
        }
      }

      const users: User[] = JSON.parse(localStorage.getItem(KEYS.USERS) || '[]');
      const user = users.find((u) => u.email === email && u.password === password);
      if (user) {
        localStorage.setItem(KEYS.CURRENT_USER, JSON.stringify(user));
        return new Promise((resolve) => setTimeout(() => resolve(user), 500));
      }
      throw new Error('Invalid email or password (Mock)');
    },

    register: async (user: User): Promise<User> => {
      if (firebaseReady()) {
        try {
          // 1. إنشاء الحساب في فايربيس
          const userCredential = await createUserWithEmailAndPassword(
            auth,
            user.email,
            user.password || '123456'
          );
          const uid = userCredential.user.uid;

          // 2. تحديث الاسم
          await updateProfile(userCredential.user, { displayName: user.name });

          // 🚀 3. الإضافة العالمية: إرسال الإيميل فوراً بعد نجاح الإنشاء
          try {
            await sendEmailVerification(userCredential.user);
            console.log("✅ Verification email sent successfully!");
          } catch (emailErr) {
            console.error("⚠️ Failed to send verification email:", emailErr);
            // لا نوقف عملية التسجيل إذا فشل الإيميل، لكن نسجل الخطأ
          }

          // 4. حفظ بيانات المستخدم في قاعدة البيانات (Firestore)
          const firestoreUser: any = cleanForFirestore({
            id: uid,
            name: user.name,
            email: user.email,
            role: user.role || 'customer',
            orders: [],
            createdAt: new Date().toISOString(),
          });

          await setDoc(doc(firestore, 'users', uid), firestoreUser);

          return { ...user, id: uid };
        } catch (error) {
          console.error('Registration Error:', error);
          throw error;
        }
      }

      // --- Fallback (Mock) ---
      const users: User[] = JSON.parse(localStorage.getItem(KEYS.USERS) || '[]');
      const existing = users.find((u) => u.email === user.email);
      if (existing) throw new Error('Email already exists (Mock)');

      users.push(user);
      localStorage.setItem(KEYS.USERS, JSON.stringify(users));
      localStorage.setItem(KEYS.CURRENT_USER, JSON.stringify(user));
      return new Promise((resolve) => setTimeout(() => resolve(user), 500));
    },

    getCurrent: (): User | null => {
      const stored = localStorage.getItem(KEYS.CURRENT_USER);
      return stored ? JSON.parse(stored) : null;
    },

    logout: async () => {
      localStorage.removeItem(KEYS.CURRENT_USER);
      if (firebaseReady()) {
        await signOut(auth);
      }
    },
  },
};