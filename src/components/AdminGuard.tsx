import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { useCart } from '../App';
import { db } from '../services/firebase';

async function checkIsAdmin(uid: string, role?: string) {
  if (!uid) return false;
  if (String(role || '').toLowerCase() === 'admin') return true;
  if (!db) return false;

  try {
    const rolesSnap = await getDoc(doc(db, 'config', 'roles'));
    const ownerUid = rolesSnap.data()?.ownerUid;
    if (uid === ownerUid) return true;
  } catch (error) {
    console.warn('AdminGuard roles lookup failed:', error);
  }

  try {
    const adminSnap = await getDoc(doc(db, 'admins', uid));
    return adminSnap.exists();
  } catch (error) {
    console.warn('AdminGuard admins lookup failed:', error);
    return false;
  }
}

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useCart();
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!user?.id) {
        if (!cancelled) {
          setOk(false);
          setLoading(false);
        }
        return;
      }

      const isAdmin = await checkIsAdmin(user.id, user.role);
      if (!cancelled) {
        setOk(isAdmin);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!ok) return <Navigate to="/" replace />;

  return <>{children}</>;
}