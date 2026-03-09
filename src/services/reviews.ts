// src/services/reviews.ts
import { db } from './storage';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';

import { db as firebaseDb, isFirebaseInitialized } from './firebase';
import type { AppUser, ReviewDoc, ReviewInput, ReviewStatus } from '../types';

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

/**
 * يتحقق مما إذا كان المستخدم قد اشترى المنتج واستلمه (أو قيد الشحن).
 */
const requirePurchased = async (userId: string, productId: string): Promise<boolean> => {
  try {
    return await db.orders.hasPurchasedProduct(userId, productId, ['processing', 'shipped', 'delivered']);
  } catch (error) {
    console.error('Error verifying purchase status:', error);
    return false;
  }
};

const roundToOneDecimal = (n: number): number => Math.round(n * 10) / 10;

const calcAggregate = (items: Array<Partial<ReviewDoc>>) => {
  const published = items.filter((r) => (r.status || 'published') === 'published');
  const count = published.length;
  const avg = count === 0 
    ? 0 
    : roundToOneDecimal(published.reduce((sum, r) => sum + clampRating(r.rating), 0) / count);

  return { avg, count };
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
      const col = collection(firebaseDb, 'reviews');
      const q = query(col, where('productId', '==', pid)); // نجلب الكل لتجنب الـ Composite Index المعقد
      const snap = await getDocs(q);

      const all = snap.docs.map((d) => d.data() as Partial<ReviewDoc>);
      const { avg, count } = calcAggregate(all);

      await updateDoc(doc(firebaseDb, 'products', pid), {
        ratingAvg: avg,
        ratingCount: count,
        rating: avg, // Backward compatibility
        reviews: count, // Backward compatibility
        updatedAt: serverTimestamp(),
      });
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
export const reviewsApi = {
  
  /**
   * 📥 جلب تقييمات المنتج
   * - للعميل: يرى المنشور فقط (published).
   * - للمدير: يرى الكل بما فيها المخفية.
   */
  async listByProduct(productId: string, viewer: AppUser | null): Promise<ReviewDoc[]> {
    const pid = sanitize(productId);
    if (!pid) return [];

    try {
      if (isFirebaseInitialized && firebaseDb) {
        const col = collection(firebaseDb, 'reviews');
        const q = query(col, where('productId', '==', pid), orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);

        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ReviewDoc[];
        return isAdmin(viewer) ? all : all.filter((r) => (r.status || 'published') === 'published');
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
   * 🔍 جلب تقييم مستخدم معين لمنتج (لمنع التكرار أو للتعديل)
   */
  async getMyReview(productId: string, userId: string): Promise<ReviewDoc | null> {
    const pid = sanitize(productId);
    const uid = sanitize(userId);
    if (!pid || !uid) return null;

    try {
      if (isFirebaseInitialized && firebaseDb) {
        const col = collection(firebaseDb, 'reviews');
        const q = query(col, where('productId', '==', pid), where('userId', '==', uid));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
          const d = snap.docs[0];
          return { id: d.id, ...d.data() } as ReviewDoc;
        }
        return null;
      }
    } catch (error) {
      console.warn('Firebase getMyReview failed, using local storage.', error);
    }

    return lsRead().find((r) => r.productId === pid && r.userId === uid) || null;
  },

  /**
   * ✍️ إضافة أو تعديل التقييم (Upsert)
   */
  async upsertReview(input: ReviewInput): Promise<void> {
    const pid = sanitize(input.productId);
    const uid = sanitize(input.userId);
    const userName = sanitize(input.userName) || 'User';
    const userEmail = sanitize(input.userEmail);
    const comment = sanitize(input.comment);
    const rating = clampRating(input.rating);

    if (!pid || !uid) throw new Error('بيانات المستخدم أو المنتج مفقودة.');
    if (!comment || comment.length < 3) throw new Error('يرجى كتابة تعليق واضح (3 أحرف على الأقل).');

    // ✅ شرط الشراء الأساسي (Enterprise standard)
    const purchased = await requirePurchased(uid, pid);
    if (!purchased) {
      throw new Error('عذراً، لا يمكنك تقييم هذا المنتج إلا بعد شرائه واستلامه.');
    }

    try {
      if (isFirebaseInitialized && firebaseDb) {
        const col = collection(firebaseDb, 'reviews');
        const q = query(col, where('productId', '==', pid), where('userId', '==', uid));
        const snap = await getDocs(q);

        if (snap.empty) {
          // Insert new
          await addDoc(col, {
            productId: pid,
            userId: uid,
            userName,
            userEmail,
            rating,
            comment,
            status: 'published', // أو 'hidden' إذا أردت مراجعة الإدارة أولاً
            likesCount: 0,
            likesBy: {},
            adminReply: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          // Update existing
          const d = snap.docs[0];
          await updateDoc(doc(firebaseDb, 'reviews', d.id), {
            rating,
            comment,
            userName,
            userEmail,
            updatedAt: serverTimestamp(),
          });
        }

        await syncProductAggregate(pid);
        return;
      }
    } catch (error) {
      console.error('Firebase upsert failed, falling back to local:', error);
    }

    // Local Fallback
    const items = lsRead();
    const idx = items.findIndex((r) => r.productId === pid && r.userId === uid);
    const now = Date.now();

    if (idx === -1) {
      items.unshift({
        id: makeLocalId(),
        productId: pid,
        userId: uid,
        userName,
        userEmail,
        rating,
        comment,
        status: 'published',
        likesCount: 0,
        likesBy: {},
        adminReply: null,
        createdAtMs: now,
        updatedAtMs: now,
      } as LsReview);
    } else {
      items[idx] = {
        ...items[idx],
        rating,
        comment,
        userName,
        userEmail,
        updatedAtMs: now,
      };
    }

    lsWrite(items);
    await syncProductAggregate(pid);
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