// src/services/authProviders.ts
import { GoogleAuthProvider, FacebookAuthProvider, signInWithPopup, User } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

/**
 * 🚀 خدمة تسجيل الدخول باستخدام حساب جوجل (Google Sign-In)
 * تفتح نافذة منبثقة آمنة وتجبر المستخدم على اختيار الحساب.
 * @returns {Promise<User>} بيانات المستخدم (User Object) من Firebase
 * @throws {Error} رسالة خطأ واضحة باللغة العربية لعرضها في الواجهة
 */
export const signInWithGoogle = async (): Promise<User> => {
  const auth = getFirebaseAuth();
  
  if (!auth) {
    throw new Error("خدمة المصادقة غير مهيأة حالياً. يرجى تحديث الصفحة والمحاولة لاحقاً.");
  }

  const provider = new GoogleAuthProvider();
  // إجبار المستخدم على اختيار الحساب في كل مرة يضغط فيها على الزر (أفضل لتجربة المستخدم)
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    // محاولة فتح النافذة وتسجيل الدخول
    const res = await signInWithPopup(auth, provider);
    return res.user;

  } catch (error: any) {
    console.error("Google Sign-In Exception:", error);

    // 🛡️ معالجة وتصفية أخطاء Firebase الشائعة لتحسين الـ UX
    switch (error.code) {
      case 'auth/popup-closed-by-user':
        throw new Error("تم إلغاء عملية تسجيل الدخول. يمكنك المحاولة مرة أخرى متى شئت.");
        
      case 'auth/popup-blocked':
        throw new Error("تم حظر النافذة المنبثقة بواسطة المتصفح. يرجى السماح بالنوافذ المنبثقة لهذا الموقع.");
        
      case 'auth/network-request-failed':
        throw new Error("فشل الاتصال. يرجى التحقق من جودة اتصالك بالإنترنت.");
        
      case 'auth/account-exists-with-different-credential':
        throw new Error("البريد الإلكتروني مسجل مسبقاً بطريقة دخول مختلفة (مثل كلمة المرور).");
        
      default:
        throw new Error(error.message || "حدث خطأ غير متوقع أثناء تسجيل الدخول بجوجل. يرجى المحاولة لاحقاً.");
    }
  }
};

/**
 * 📘 خدمة تسجيل الدخول باستخدام حساب فيسبوك (Facebook Sign-In)
 * تفتح نافذة منبثقة آمنة للمصادقة عبر فيسبوك.
 * @returns {Promise<User>} بيانات المستخدم (User Object) من Firebase
 * @throws {Error} رسالة خطأ واضحة باللغة العربية لعرضها في الواجهة
 */
export const signInWithFacebook = async (): Promise<User> => {
  const auth = getFirebaseAuth();
  
  if (!auth) {
    throw new Error("خدمة المصادقة غير مهيأة حالياً. يرجى تحديث الصفحة والمحاولة لاحقاً.");
  }

  const provider = new FacebookAuthProvider();
  // إضافة صلاحية طلب البريد الإلكتروني (أساسي لربط الحسابات)
  provider.addScope('email');

  try {
    const res = await signInWithPopup(auth, provider);
    return res.user;

  } catch (error: any) {
    console.error("Facebook Sign-In Exception:", error);

    switch (error.code) {
      case 'auth/popup-closed-by-user':
        throw new Error("تم إلغاء عملية تسجيل الدخول عبر فيسبوك.");
        
      case 'auth/popup-blocked':
        throw new Error("تم حظر النافذة المنبثقة بواسطة المتصفح. يرجى السماح بالنوافذ المنبثقة لهذا الموقع.");
        
      case 'auth/network-request-failed':
        throw new Error("فشل الاتصال. يرجى التحقق من جودة اتصالك بالإنترنت.");
        
      case 'auth/account-exists-with-different-credential':
        throw new Error("هذا البريد مسجل مسبقاً بطريقة دخول أخرى (مثل جوجل). يرجى تسجيل الدخول بالطريقة الأصلية.");
        
      default:
        throw new Error(error.message || "حدث خطأ غير متوقع أثناء تسجيل الدخول بفيسبوك. يرجى المحاولة لاحقاً.");
    }
  }
};