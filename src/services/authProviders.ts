// src/services/authProviders.ts
import { 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  signInWithPopup, 
  User,
  sendEmailVerification 
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

/**
 * 🚀 خدمة تسجيل الدخول باستخدام حساب جوجل (Google Sign-In)
 * تفتح نافذة منبثقة آمنة وتجبر المستخدم على اختيار الحساب.
 * @returns {Promise<User>} بيانات المستخدم (User Object) من Firebase
 */
export const signInWithGoogle = async (): Promise<User> => {
  const auth = getFirebaseAuth();
  
  if (!auth) {
    // نرمي كود خطأ قياسي لتترجمه الواجهة
    throw { code: 'auth/not-initialized' };
  }
  
  const provider = new GoogleAuthProvider();
  // إجبار المستخدم على اختيار الحساب في كل مرة يضغط فيها على الزر (أفضل لتجربة المستخدم)
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    const res = await signInWithPopup(auth, provider);
    return res.user;
  } catch (error: any) {
    console.error("Google Sign-In Exception:", error);
    // 🛡️ نرمي الخطأ الأصلي ليتم ترجمته في الواجهة (Login.tsx) حسب لغة المتجر الحالية
    throw error;
  }
};

/**
 * 📘 خدمة تسجيل الدخول باستخدام حساب فيسبوك (Facebook Sign-In)
 * تفتح نافذة منبثقة آمنة للمصادقة عبر فيسبوك.
 * @returns {Promise<User>} بيانات المستخدم (User Object) من Firebase
 */
export const signInWithFacebook = async (): Promise<User> => {
  const auth = getFirebaseAuth();
  
  if (!auth) {
    throw { code: 'auth/not-initialized' };
  }

  const provider = new FacebookAuthProvider();
  // إضافة صلاحية طلب البريد الإلكتروني (أساسي لربط الحسابات)
  provider.addScope('email');

  try {
    const res = await signInWithPopup(auth, provider);
    return res.user;
  } catch (error: any) {
    console.error("Facebook Sign-In Exception:", error);
    // 🛡️ نرمي الخطأ الأصلي للواجهة
    throw error;
  }
};

/**
 * 📧 خدمة إرسال رابط التحقق
 */
export const sendUserVerification = async (user: User): Promise<void> => {
  try {
    await sendEmailVerification(user);
  } catch (error) {
    console.error("Verification error:", error);
    throw error;
  }
};