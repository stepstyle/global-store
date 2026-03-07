import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { useCart } from "../App"; // عندك user هنا
import { db } from "../services/firebase"; // عدّل المسار حسب مشروعك

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
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!user?.uid) {
        if (!cancelled) { setOk(false); setLoading(false); }
        return;
      }
      const isAdmin = await checkIsAdmin(user.uid);
      if (!cancelled) { setOk(isAdmin); setLoading(false); }
    })();

    return () => { cancelled = true; };
  }, [user?.uid]);

  if (loading) return null; // أو Spinner
  if (!user) return <Navigate to="/login" replace />;
  if (!ok) return <Navigate to="/" replace />;

  return <>{children}</>;
}