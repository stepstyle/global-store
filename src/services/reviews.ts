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

const LS_KEY = 'anta_reviews_v1';

// ----------------------
// LocalStorage Fallback
// ----------------------
type LsReview = ReviewDoc & { id: string };

const lsRead = (): LsReview[] => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as LsReview[]) : [];
  } catch {
    return [];
  }
};

const lsWrite = (items: LsReview[]) => {
  localStorage.setItem(LS_KEY, JSON.stringify(items));
};

const makeLocalId = () => `r-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

// ----------------------
// Helpers
// ----------------------
const isAdmin = (u: AppUser | null) => u?.role === 'admin';

const sanitize = (v: any) => String(v ?? '').trim();

const clampRating = (r: number) => {
  const n = Number.isFinite(r) ? r : 5;
  return Math.max(1, Math.min(5, Math.round(n)));
};

const requirePurchased = async (userId: string, productId: string) => {
  // ✅ إذا بدك “فقط بعد التسليم” بدل السطر اللي تحت:
  // return db.orders.hasPurchasedProduct(userId, productId, ['delivered']);

  return db.orders.hasPurchasedProduct(userId, productId, ['processing', 'shipped', 'delivered']);
};

const round1 = (n: number) => Math.round(n * 10) / 10;

const calcAggregate = (items: Array<{ rating?: number; status?: ReviewStatus }>) => {
  const published = items.filter((r) => (r.status || 'published') === 'published');
  const count = published.length;
  const avg =
    count === 0
      ? 0
      : round1(
          published.reduce((sum, r) => sum + Number(r.rating || 0), 0) / count
        );

  return { avg, count };
};

/**
 * ✅ تحديث تقييم المنتج داخل products
 * - ratingAvg / ratingCount (الحقول الجديدة “الحقيقية”)
 * - rating / reviews (للتوافق مع أجزاء قديمة من الواجهة)
 */
const syncProductAggregate = async (productId: string) => {
  const pid = sanitize(productId);
  if (!pid) return;

  // Firebase mode
  if (isFirebaseInitialized && firebaseDb) {
    // نجلب كل تقييمات المنتج ونفلتر published محليًا لتجنب مشاكل index
    const col = collection(firebaseDb, 'reviews');
    const q = query(col, where('productId', '==', pid), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);

    const all = snap.docs.map((d) => d.data() as any) as Array<{ rating?: number; status?: ReviewStatus }>;
    const { avg, count } = calcAggregate(all);

    // تحديث المنتج
    await updateDoc(doc(firebaseDb, 'products', pid), {
      ratingAvg: avg,
      ratingCount: count,

      // Backward compatible fields
      rating: avg,
      reviews: count,

      updatedAt: serverTimestamp(),
    } as any);

    return;
  }

  // Local mode
  const items = lsRead().filter((r) => r.productId === pid);
  const { avg, count } = calcAggregate(items);

  const existing = await db.products.getById(pid);
  if (!existing) return;

  await db.products.update({
    ...(existing as any),
    ratingAvg: avg,
    ratingCount: count,

    // Backward compatible fields
    rating: avg,
    reviews: count,
  });
};

// ----------------------
// Public API
// ----------------------
export const reviewsApi = {
  /**
   * ✅ جلب تقييمات منتج:
   * - المستخدم العادي: published فقط
   * - الأدمن: الكل (published + hidden)
   */
  async listByProduct(productId: string, viewer: AppUser | null): Promise<ReviewDoc[]> {
    const pid = sanitize(productId);
    if (!pid) return [];

    // Firebase
    if (isFirebaseInitialized && firebaseDb) {
      const col = collection(firebaseDb, 'reviews');
      const q = query(col, where('productId', '==', pid), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);

      const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ReviewDoc[];

      if (isAdmin(viewer)) return all;
      return all.filter((r) => ((r as any).status || 'published') === 'published');
    }

    // Local mode
    const all = lsRead().filter((r) => r.productId === pid);
    if (isAdmin(viewer)) return all;
    return all.filter((r) => ((r as any).status || 'published') === 'published');
  },

  /**
   * ✅ جلب تقييم المستخدم لنفس المنتج (Edit بدل تكرار)
   */
  async getMyReview(productId: string, userId: string): Promise<ReviewDoc | null> {
    const pid = sanitize(productId);
    const uid = sanitize(userId);
    if (!pid || !uid) return null;

    if (isFirebaseInitialized && firebaseDb) {
      const col = collection(firebaseDb, 'reviews');
      const q = query(col, where('productId', '==', pid), where('userId', '==', uid));
      const snap = await getDocs(q);
      if (snap.empty) return null;

      const d = snap.docs[0];
      return { id: d.id, ...(d.data() as any) } as ReviewDoc;
    }

    return lsRead().find((r) => r.productId === pid && r.userId === uid) || null;
  },

  /**
   * ✅ إضافة/تعديل تقييم (Upsert)
   * ✅ شرط الشراء قبل التقييم (World-Class)
   * ✅ تحديث ratingAvg/ratingCount تلقائيًا داخل المنتج
   */
  async upsertReview(input: ReviewInput): Promise<void> {
    const pid = sanitize(input.productId);
    const uid = sanitize(input.userId);

    const userName = sanitize(input.userName) || 'User';
    const userEmail = sanitize(input.userEmail);
    const comment = sanitize(input.comment);
    const rating = clampRating(Number(input.rating || 5));

    if (!pid || !uid) throw new Error('Missing productId/userId');
    if (!comment || comment.length < 3) throw new Error('اكتب تعليق واضح (على الأقل 3 أحرف)');

    // ✅ شرط الشراء
    const purchased = await requirePurchased(uid, pid);
    if (!purchased) {
      throw new Error('لا يمكنك تقييم هذا المنتج إلا بعد شرائه.');
    }

    // Firebase
    if (isFirebaseInitialized && firebaseDb) {
      const col = collection(firebaseDb, 'reviews');
      const q = query(col, where('productId', '==', pid), where('userId', '==', uid));
      const snap = await getDocs(q);

      if (snap.empty) {
        await addDoc(col, {
          productId: pid,
          userId: uid,
          userName,
          userEmail,
          rating,
          comment,
          status: 'published' as ReviewStatus, // لو بدك مراجعة قبل النشر: 'hidden'
          likesCount: 0,
          likesBy: {},
          adminReply: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const d = snap.docs[0];
        await updateDoc(doc(firebaseDb, 'reviews', d.id), {
          rating,
          comment,
          userName,
          userEmail,
          updatedAt: serverTimestamp(),
        });
      }

      // ✅ تحديث المنتج
      await syncProductAggregate(pid);
      return;
    }

    // Local mode
    const items = lsRead();
    const idx = items.findIndex((r) => r.productId === pid && r.userId === uid);

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
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      });
    } else {
      items[idx] = {
        ...items[idx],
        rating,
        comment,
        userName,
        userEmail,
        updatedAtMs: Date.now(),
      };
    }

    lsWrite(items);

    // ✅ تحديث المنتج
    await syncProductAggregate(pid);
  },

  /**
   * ✅ إعجاب/إلغاء إعجاب
   * (لا يؤثر على متوسط التقييم)
   */
  async toggleLike(reviewId: string, userId: string): Promise<void> {
    const rid = sanitize(reviewId);
    const uid = sanitize(userId);
    if (!rid || !uid) return;

    if (isFirebaseInitialized && firebaseDb) {
      const ref = doc(firebaseDb, 'reviews', rid);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;

      const data = snap.data() as any;
      const likesBy: Record<string, boolean> = data.likesBy || {};
      const liked = !!likesBy[uid];

      if (liked) delete likesBy[uid];
      else likesBy[uid] = true;

      await updateDoc(ref, {
        likesBy,
        likesCount: Object.keys(likesBy).length,
        updatedAt: serverTimestamp(),
      });

      return;
    }

    const items = lsRead();
    const idx = items.findIndex((r) => r.id === rid);
    if (idx === -1) return;

    const likesBy = items[idx].likesBy || {};
    const liked = !!likesBy[uid];
    if (liked) delete likesBy[uid];
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
   * ✅ (Admin) إخفاء/إظهار
   * ✅ يعيد تحديث ratingAvg/ratingCount لأن hidden لا يدخل بالحساب
   */
  async setStatus(reviewId: string, status: ReviewStatus): Promise<void> {
    const rid = sanitize(reviewId);
    if (!rid) return;

    // Firebase
    if (isFirebaseInitialized && firebaseDb) {
      const ref = doc(firebaseDb, 'reviews', rid);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;

      const data = snap.data() as any;
      const pid = sanitize(data.productId);

      await updateDoc(ref, {
        status,
        updatedAt: serverTimestamp(),
      });

      if (pid) await syncProductAggregate(pid);
      return;
    }

    // Local
    const items = lsRead();
    const idx = items.findIndex((r) => r.id === rid);
    if (idx === -1) return;

    const pid = sanitize(items[idx].productId);

    items[idx] = { ...items[idx], status, updatedAtMs: Date.now() };
    lsWrite(items);

    if (pid) await syncProductAggregate(pid);
  },

  /**
   * ✅ (Admin) رد
   * (لا يؤثر على متوسط التقييم)
   */
  async setAdminReply(reviewId: string, replyText: string, admin: AppUser): Promise<void> {
    const rid = sanitize(reviewId);
    const text = sanitize(replyText);
    if (!rid) return;

    const reply = text
      ? {
          text,
          adminId: admin.id,
          adminName: admin.name || 'Admin',
          atMs: Date.now(),
        }
      : null;

    if (isFirebaseInitialized && firebaseDb) {
      await updateDoc(doc(firebaseDb, 'reviews', rid), {
        adminReply: reply,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const items = lsRead();
    const idx = items.findIndex((r) => r.id === rid);
    if (idx === -1) return;

    items[idx] = { ...items[idx], adminReply: reply as any, updatedAtMs: Date.now() };
    lsWrite(items);
  },

  /**
   * ✅ (Admin) حذف
   * ✅ يعيد تحديث ratingAvg/ratingCount
   */
  async remove(reviewId: string): Promise<void> {
    const rid = sanitize(reviewId);
    if (!rid) return;

    // Firebase
    if (isFirebaseInitialized && firebaseDb) {
      const ref = doc(firebaseDb, 'reviews', rid);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;

      const data = snap.data() as any;
      const pid = sanitize(data.productId);

      await deleteDoc(ref);

      if (pid) await syncProductAggregate(pid);
      return;
    }

    // Local
    const items = lsRead();
    const target = items.find((r) => r.id === rid);
    const pid = sanitize(target?.productId);

    const next = items.filter((r) => r.id !== rid);
    lsWrite(next);

    if (pid) await syncProductAggregate(pid);
  },
};