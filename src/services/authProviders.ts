// src/services/authProviders.ts
import { 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  signInWithPopup,
  signInWithRedirect, // 👈 استيراد دالة التحويل لحل مشكلة الأيفون
  User,
  sendEmailVerification 
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

// 📱 دالة ذكية لاكتشاف إذا كان الزبون يفتح من موبايل
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

/**
 * 🚀 خدمة تسجيل الدخول باستخدام حساب جوجل (Google Sign-In)
 */
export const signInWithGoogle = async (): Promise<User | void> => {
  const auth = getFirebaseAuth();
  
  if (!auth) {
    throw { code: 'auth/not-initialized' };
  }
  
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    if (isMobileDevice()) {
      // 📱 للموبايل: نستخدم التحويل الكامل (Redirect) لضمان تخطي حظر متصفح Safari
      await signInWithRedirect(auth, provider);
      return; // الدالة تتوقف هنا لأن المتصفح سينتقل كلياً إلى صفحة جوجل
    } else {
      // 💻 للكمبيوتر: نستخدم النافذة المنبثقة (Popup) لأنها أسرع ولا يتم حظرها
      const res = await signInWithPopup(auth, provider);
      return res.user;
    }
  } catch (error: any) {
    console.error("Google Sign-In Exception:", error);
    throw error;
  }
};

/**
 * 📘 خدمة تسجيل الدخول باستخدام حساب فيسبوك (Facebook Sign-In)
 */
export const signInWithFacebook = async (): Promise<User | void> => {
  const auth = getFirebaseAuth();
  
  if (!auth) {
    throw { code: 'auth/not-initialized' };
  }

  const provider = new FacebookAuthProvider();
  provider.addScope('email');

  try {
    if (isMobileDevice()) {
      // 📱 للموبايل
      await signInWithRedirect(auth, provider);
      return;
    } else {
      // 💻 للكمبيوتر
      const res = await signInWithPopup(auth, provider);
      return res.user;
    }
  } catch (error: any) {
    console.error("Facebook Sign-In Exception:", error);
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