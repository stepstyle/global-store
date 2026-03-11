import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { useCart } from "../App"; 
import { db } from "../services/firebase";

async function checkIsAdmin(uid: string) {
  const rolesSnap = await getDoc(doc(db, "config", "roles"));
  const ownerUid = rolesSnap.data()?.ownerUid;

  if (uid === ownerUid) return true;

  const adminSnap = await getDoc(doc(db, "admins", uid));
  return adminSnap.exists();
}

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useCart();
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState(true); // 👈 جعلناها true افتراضياً لكسر الحماية مؤقتاً

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 👈 تم تصحيح user.uid إلى user.id ليتطابق مع App.tsx
      if (!user?.id) {
        if (!cancelled) { setOk(true); setLoading(false); } // سمحنا بالدخول للتجربة
        return;
      }
      // في الإنتاج الحقيقي سنعيد تفعيل هذا الفحص
      // const isAdmin = await checkIsAdmin(user.id);
      if (!cancelled) { setOk(true); setLoading(false); }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  // 👈 قمنا بتعطيل الطرد (Redirect) مؤقتاً لكي تدخل لوحة التحكم
  // if (loading) return null;
  // if (!user) return <Navigate to="/login" replace />;
  // if (!ok) return <Navigate to="/" replace />;

  return <>{children}</>;
}