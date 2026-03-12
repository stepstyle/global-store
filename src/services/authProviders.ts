// src/services/authProviders.ts
import { 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  signInWithPopup, 
  signInWithRedirect, // 👈 تم إضافة هذه للاستخدام في الموبايل
  User,
  sendEmailVerification 
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

// 📱 دالة مساعدة لمعرفة إذا كان الزبون يفتح من موبايل
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

/**
 * 🚀 خدمة تسجيل الدخول باستخدام حساب جوجل (Google Sign-In)
 * تفتح نافذة منبثقة للكمبيوتر، أو تحويل مباشر للموبايل لتجنب الحظر.
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
    if (isMobileDevice()) {
      // 🚀 التحويل (Redirect) هو الحل الأكيد والآمن للموبايل (iPhone & Android)
      await signInWithRedirect(auth, provider);
      // نعيد كائن فارغ مؤقتاً لأن الصفحة ستقوم بعمل Refresh للانتقال إلى جوجل
      return {} as User;
    } else {
      // 💻 النافذة المنبثقة (Popup) السريعة للكمبيوتر
      const res = await signInWithPopup(auth, provider);
      return res.user;
    }
  } catch (error: any) {
    console.error("Google Sign-In Exception:", error);
    // 🛡️ نرمي الخطأ الأصلي ليتم ترجمته في الواجهة (Login.tsx) حسب لغة المتجر الحالية
    throw error;
  }
};

/**
 * 📘 خدمة تسجيل الدخول باستخدام حساب فيسبوك (Facebook Sign-In)
 * تفتح نافذة منبثقة للكمبيوتر، أو تحويل مباشر للموبايل.
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
    if (isMobileDevice()) {
      // 🚀 التحويل (Redirect) للموبايل
      await signInWithRedirect(auth, provider);
      return {} as User;
    } else {
      // 💻 النافذة المنبثقة (Popup) للكمبيوتر
      const res = await signInWithPopup(auth, provider);
      return res.user;
    }
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