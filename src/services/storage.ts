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
} from 'firebase/firestore';

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
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
 */
const cleanForFirestore = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map((v) => cleanForFirestore(v))
      .filter((v) => v !== undefined) as any;
  }

  if (value && typeof value === 'object') {
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
          // ✅ safer merge order (data then id)
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
          // ✅ clean undefined before save
          const safeProduct = cleanForFirestore(p);
          await setDoc(doc(firestore, 'products', p.id), safeProduct as any);
        }
        return newProducts;
      }

      const products = JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]');
      const updated = [...products, ...newProducts];
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
        const safeProduct = cleanForFirestore(updatedProduct);
        await setDoc(doc(firestore, 'products', updatedProduct.id), safeProduct as any, { merge: true });
        return db.products.getAll();
      }

      const products = JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]');
      const index = products.findIndex((p: Product) => p.id === updatedProduct.id);
      if (index !== -1) {
        products[index] = updatedProduct;
        localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(products));
      }
      return products;
    },
  },

  orders: {
    getAll: async (): Promise<Order[]> => {
      if (firebaseReady()) {
        const snapshot = await getDocs(collection(firestore, 'orders'));
        return snapshot.docs.map((d) => ({ ...(d.data() as any), id: d.id } as Order));
      }

      return new Promise((resolve) => {
        setTimeout(() => resolve(JSON.parse(localStorage.getItem(KEYS.ORDERS) || '[]')), 300);
      });
    },

    getByUserId: async (userId: string): Promise<Order[]> => {
      if (firebaseReady()) {
        const q = query(collection(firestore, 'orders'), where('userId', '==', userId));
        const snapshot = await getDocs(q);
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

    /**
     * ✅ World-Class: هل المستخدم اشترى المنتج؟
     * - Firebase: Query orders حسب userId ثم فلترة داخل items
     * - LocalStorage: نفس المنطق
     */
    hasPurchasedProduct: async (
      userId: string,
      productId: string,
      allowedStatuses: Order['status'][] = ['processing', 'shipped', 'delivered']
    ): Promise<boolean> => {
      const uid = String(userId || '').trim();
      const pid = String(productId || '').trim();

      if (!uid || !pid) return false;
      if (uid === 'guest') return false;

      const orders = await db.orders.getByUserId(uid);

      return orders.some((o) => {
        if (!allowedStatuses.includes(o.status)) return false;
        const items = Array.isArray(o.items) ? o.items : [];
        return items.some((it) => it?.productId === pid);
      });
    },

    create: async (order: Order): Promise<Order> => {
      if (firebaseReady()) {
        // ✅ Firestore rejects undefined: clean the order deeply
        const safeOrder = cleanForFirestore(order);
        await setDoc(doc(firestore, 'orders', order.id), safeOrder as any);

        for (const item of order.items) {
          await db.products.updateStock(item.productId, item.quantity);
        }
        return order;
      }

      const orders = JSON.parse(localStorage.getItem(KEYS.ORDERS) || '[]');
      orders.unshift(order);
      localStorage.setItem(KEYS.ORDERS, JSON.stringify(orders));

      order.items.forEach((item) => {
        db.products.updateStock(item.productId, item.quantity);
      });

      return new Promise((resolve) => setTimeout(() => resolve(order), 800));
    },

    updateStatus: async (id: string, status: Order['status']): Promise<Order[]> => {
      if (firebaseReady()) {
        await updateDoc(doc(firestore, 'orders', id), { status });
        return db.orders.getAll();
      }

      const orders = JSON.parse(localStorage.getItem(KEYS.ORDERS) || '[]');
      const index = orders.findIndex((o: Order) => o.id === id);
      if (index !== -1) {
        orders[index].status = status;
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
          const userCredential = await createUserWithEmailAndPassword(
            auth,
            user.email,
            user.password || '123456'
          );
          const uid = userCredential.user.uid;

          await updateProfile(userCredential.user, { displayName: user.name });

          const firestoreUser: any = cleanForFirestore({
            id: uid,
            name: user.name,
            email: user.email,
            role: user.role,
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