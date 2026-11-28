// src/services/reviews.ts
import { db } from './storage';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore';

import { db as firebaseDb, isFirebaseInitialized, getFirebaseAuth } from './firebase';
import { BACKEND_ENABLED } from '../config/deployEnv';
import type { AppUser, ReviewDoc, ReviewStatus } from '../types';
import type { Deps } from './verifiedReviews';

/** the order Worker that writes verified reviews (same Worker as the dashboard's order actions) */
export const reviewWorkerBase = (): string =>
  BACKEND_ENABLED ? String(import.meta.env.VITE_ORDER_ADMIN_URL || import.meta.env.VITE_WORKER_URL || '').trim().replace(/\/+$/, '') : '';
export const verifiedReviewDeps = (): Deps => ({
  fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
  base: reviewWorkerBase(),
  idToken: async () => (await getFirebaseAuth()?.currentUser?.getIdToken().catch(() => null)) ?? null,
});

// ----------------------
// Constants & Types
// ----------------------
const LS_KEY = 'anta_reviews_v1';

type LsReview = ReviewDoc & { 
  id: string; 
  createdAtMs?: number; 
  updatedAtMs?: number; 
};

// ----------------------
// LocalStorage Fallback (Safe Helpers)
// ----------------------
const lsRead = (): LsReview[] => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to parse local reviews:', error);
    return [];
  }
};

const lsWrite = (items: LsReview[]) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch (error) {
    console.error('Failed to save local reviews:', error);
  }
};

const makeLocalId = () => `r-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// ----------------------
// Core Business Logic Helpers
// ----------------------
const isAdmin = (u: AppUser | null): boolean => u?.role === 'admin';

const sanitize = (v: unknown): string => String(v ?? '').trim();

const clampRating = (r: unknown): number => {
  const n = Number(r);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(5, Math.round(n)));
};

// A review is WRITTEN only by the order Worker (services/verifiedReviews.ts -> POST /reviews/submit), after it checked
// a delivered order that contains the product. The browser never writes one (the Firestore rules refuse it).

const roundToOneDecimal = (n: number): number => Math.round(n * 10) / 10;

const calcAggregate = (items: Array<Partial<ReviewDoc>>) => {
  const published = items.filter((r) => (r.status || 'published') === 'published');
  const count = published.length;
  const avg = count === 0 
    ? 0 
    : roundToOneDecimal(published.reduce((sum, r) => sum + clampRating(r.rating), 0) / count);

  return { avg, count };
};

/** POST {worker}/products/:id/ratings with the signed-in customer's ID token. Best effort: the review itself is saved. */
const requestRatingsRecompute = async (pid: string): Promise<void> => {
  const base = BACKEND_ENABLED ? String(import.meta.env.VITE_ORDER_ADMIN_URL || import.meta.env.VITE_WORKER_URL || '').trim().replace(/\/+$/, '') : '';
  const token = await getFirebaseAuth()?.currentUser?.getIdToken().catch(() => null);
  if (!base || !token) return;
  try {
    await fetch(`${base}/products/${encodeURIComponent(pid)}/ratings`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  } catch (e) {
    console.warn('ratings recompute request failed', e);
  }
};

/**
 * 🔄 مزامنة تقييم المنتج وتحديثه في مجموعة المنتجات
 */
const syncProductAggregate = async (productId: string): Promise<void> => {
  const pid = sanitize(productId);
  if (!pid) return;

  try {
    // Firebase mode
    if (isFirebaseInitialized && firebaseDb) {
      // the product's rating figures are computed by the order Worker from the PUBLISHED reviews (the Firestore rules no
      // longer let a browser write them); this call only asks it to recompute this product now
      await requestRatingsRecompute(pid);
      return;
    }

    // Local mode
    const items = lsRead().filter((r) => r.productId === pid);
    const { avg, count } = calcAggregate(items);

    const existing = await db.products.getById(pid);
    if (!existing) return;

    await db.products.update({
      ...existing,
      ratingAvg: avg,
      ratingCount: count,
      rating: avg,
      reviews: count,
    });
  } catch (error) {
    console.error(`Failed to sync aggregate for product ${pid}:`, error);
  }
};

// ----------------------
// Public Service API
// ----------------------
const createdMs = (r: any): number => {
  const c = r?.createdAt;
  if (c && typeof c.toMillis === 'function') return c.toMillis();
  if (c && typeof c.seconds === 'number') return c.seconds * 1000;
  return Number(r?.createdAtMs) || 0;
};

export const reviewsApi = {
  /**
   * 📥 جلب تقييمات المنتج
   * - للعميل: المنشور فقط (القواعد تشترط where status == 'published'؛ الترتيب هنا بلا فهرس مركّب).
   * - للمدير: الكل بما فيها المخفية والقديمة غير الموثّقة.
   */
  async listByProduct(productId: string, viewer: AppUser | null): Promise<ReviewDoc[]> {
    const pid = sanitize(productId);
    if (!pid) return [];

    try {
      if (isFirebaseInitialized && firebaseDb) {
        const col = collection(firebaseDb, 'reviews');
        if (isAdmin(viewer)) {
          const snap = await getDocs(query(col, where('productId', '==', pid), orderBy('createdAt', 'desc')));
          return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ReviewDoc[];
        }
        const snap = await getDocs(query(col, where('productId', '==', pid), where('status', '==', 'published')));
        return (snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ReviewDoc[]).sort((a, b) => createdMs(b) - createdMs(a));
      }
    } catch (error) {
      console.error('Firebase read failed, falling back to local:', error);
    }

    // Local Fallback
    const allLocal = lsRead()
      .filter((r) => r.productId === pid)
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)); // محاكاة orderBy('createdAt', 'desc')

    return isAdmin(viewer) 
      ? allLocal 
      : allLocal.filter((r) => (r.status || 'published') === 'published');
  },

  /**
   * 👍 إعجاب / إلغاء الإعجاب بتعليق
   */
  async toggleLike(reviewId: string, userId: string): Promise<void> {
    const rid = sanitize(reviewId);
    const uid = sanitize(userId);
    if (!rid || !uid) return;

    try {
      if (isFirebaseInitialized && firebaseDb) {
        const ref = doc(firebaseDb, 'reviews', rid);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;

        const data = snap.data();
        const likesBy: Record<string, boolean> = data.likesBy || {};
        
        if (likesBy[uid]) delete likesBy[uid];
        else likesBy[uid] = true;

        await updateDoc(ref, {
          likesBy,
          likesCount: Object.keys(likesBy).length,
          updatedAt: serverTimestamp(),
        });
        return;
      }
    } catch (error) {
      console.error('Firebase toggleLike failed:', error);
      if (isFirebaseInitialized && firebaseDb) throw error; // not saved: no local-only pretend
    }

    // Local Fallback
    const items = lsRead();
    const idx = items.findIndex((r) => r.id === rid);
    if (idx === -1) return;

    const likesBy = { ...(items[idx].likesBy || {}) };
    if (likesBy[uid]) delete likesBy[uid];
    else likesBy[uid] = true;

    items[idx] = {
      ...items[idx],
      likesBy,
      likesCount: Object.keys(likesBy).length,
      updatedAtMs: Date.now(),
    };

    lsWrite(items);
  },

  /**
   * 👁️ (للمدير) إخفاء أو إظهار التقييم
   */
  async setStatus(reviewId: string, status: ReviewStatus): Promise<void> {
    const rid = sanitize(reviewId);
    if (!rid) return;

    try {
      if (isFirebaseInitialized && firebaseDb) {
        const ref = doc(firebaseDb, 'reviews', rid);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;

        const data = snap.data();
        const pid = sanitize(data.productId);

        await updateDoc(ref, { status, updatedAt: serverTimestamp() });
        if (pid) await syncProductAggregate(pid);
        return;
      }
    } catch (error) {
      console.error('Firebase setStatus failed:', error);
      if (isFirebaseInitialized && firebaseDb) throw error; // not saved: no local-only pretend
    }

    // Local Fallback
    const items = lsRead();
    const idx = items.findIndex((r) => r.id === rid);
    if (idx === -1) return;

    const pid = sanitize(items[idx].productId);
    items[idx] = { ...items[idx], status, updatedAtMs: Date.now() };
    lsWrite(items);

    if (pid) await syncProductAggregate(pid);
  },

  /**
   * 💬 (للمدير) إضافة رد الإدارة على التقييم
   */
  async setAdminReply(reviewId: string, replyText: string, admin: AppUser): Promise<void> {
    const rid = sanitize(reviewId);
    const text = sanitize(replyText);
    if (!rid) return;

    const reply = text ? {
      text,
      adminId: admin.id,
      adminName: admin.name || 'Admin',
      atMs: Date.now(),
    } : null;

    try {
      if (isFirebaseInitialized && firebaseDb) {
        await updateDoc(doc(firebaseDb, 'reviews', rid), {
          adminReply: reply,
          updatedAt: serverTimestamp(),
        });
        return;
      }
    } catch (error) {
      console.error('Firebase setAdminReply failed:', error);
      if (isFirebaseInitialized && firebaseDb) throw error; // not saved: no local-only pretend
    }

    // Local Fallback
    const items = lsRead();
    const idx = items.findIndex((r) => r.id === rid);
    if (idx === -1) return;

    items[idx] = { ...items[idx], adminReply: reply as any, updatedAtMs: Date.now() };
    lsWrite(items);
  },

  /**
   * 🗑️ (للمدير أو النظام) حذف التقييم نهائياً
   */
  async remove(reviewId: string): Promise<void> {
    const rid = sanitize(reviewId);
    if (!rid) return;

    try {
      if (isFirebaseInitialized && firebaseDb) {
        const ref = doc(firebaseDb, 'reviews', rid);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;

        const pid = sanitize(snap.data().productId);
        await deleteDoc(ref);

        if (pid) await syncProductAggregate(pid);
        return;
      }
    } catch (error) {
      console.error('Firebase remove failed:', error);
      if (isFirebaseInitialized && firebaseDb) throw error; // not saved: no local-only pretend
    }

    // Local Fallback
    const items = lsRead();
    const target = items.find((r) => r.id === rid);
    const pid = sanitize(target?.productId);

    const next = items.filter((r) => r.id !== rid);
    lsWrite(next);

    if (pid) await syncProductAggregate(pid);
  },
};