// Smart auto-approval switch (config/autoApproval). Admin-only: Firestore rules (firestore.rules.final) let only store
// admins read / write this document, validate every field, refuse CliQ and record who / when. The switch alone never
// enables anything: the order Worker also needs AUTO_APPROVAL_MODE=on (server ceiling, off by default).
import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFirestoreDb, getFirebaseAuth } from '../services/firebase';

/** the store owner's decisions (2026-11) — the Worker applies the same defaults (workers/order-worker/src/autoapproval.js) */
export const AUTO_LIMITS = { maxLineQty: 5, maxTotalQty: 15, maxOrderTotal: 50, duplicateWindowHours: 24 } as const;

type State = { loading: boolean; enabled: boolean; error: string | null; saving: boolean };

const AutoApprovalSwitch: React.FC = () => {
  const [s, setS] = useState<State>({ loading: true, enabled: false, error: null, saving: false });

  useEffect(() => {
    const db = getFirestoreDb();
    if (!db) {
      setS((p) => ({ ...p, loading: false, error: 'قاعدة البيانات غير متصلة' }));
      return undefined;
    }
    return onSnapshot(
      doc(db, 'config', 'autoApproval'),
      (snap) => setS((p) => ({ ...p, loading: false, error: null, enabled: snap.exists() && snap.data()?.enabled === true })),
      () => setS((p) => ({ ...p, loading: false, error: 'لا توجد صلاحية لقراءة الإعداد' })),
    );
  }, []);

  const toggle = async () => {
    const db = getFirestoreDb();
    const uid = getFirebaseAuth()?.currentUser?.uid;
    if (!db || !uid || s.saving) return;
    const next = !s.enabled;
    if (next && !window.confirm('تشغيل القبول التلقائي؟ الطلبات التي تجتاز كل الفحوص ستُقبل ويُخصم مخزونها دون مراجعة.')) return;
    setS((p) => ({ ...p, saving: true, error: null }));
    try {
      // the whole document is rewritten with the store's limits; CliQ stays manual (the rules refuse anything else)
      await setDoc(doc(db, 'config', 'autoApproval'), { enabled: next, ...AUTO_LIMITS, allowCliq: false, updatedAt: serverTimestamp(), updatedBy: uid });
    } catch {
      setS((p) => ({ ...p, error: 'تعذّر الحفظ (صلاحية المشرف مطلوبة)' }));
    } finally {
      setS((p) => ({ ...p, saving: false }));
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800">🤖 القبول التلقائي الذكي</h3>
          <p className="text-sm text-slate-500">
            حتى {AUTO_LIMITS.maxLineQty} قطع للمنتج، و{AUTO_LIMITS.maxTotalQty} قطعة للطلب، و{AUTO_LIMITS.maxOrderTotal} د.أ.
            طلبات CliQ ونفس الهاتف خلال {AUTO_LIMITS.duplicateWindowHours} ساعة تبقى للمراجعة اليدوية.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={s.enabled}
          disabled={s.loading || s.saving || !!(s.error && s.loading)}
          onClick={toggle}
          className={`rounded-xl px-4 py-2 font-bold text-white transition-colors disabled:opacity-50 ${s.enabled ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-400 hover:bg-slate-500'}`}
        >
          {s.loading ? '…' : s.enabled ? 'مُفعّل — اضغط للإيقاف' : 'متوقف — اضغط للتشغيل'}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        يعمل فقط إذا كان مفعّلًا أيضًا على الخادم. القبول التلقائي لا يثبت هوية صاحب رقم الهاتف، ولا يغيّر الحالة إلى «تم الشحن» أو «تم التسليم».
      </p>
      {s.error && <p className="mt-2 text-sm font-bold text-red-600">{s.error}</p>}
    </div>
  );
};

export default AutoApprovalSwitch;
