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
 */
export const signInWithGoogle = async (): Promise<User | void> => {
  const auth = getFirebaseAuth();
  
  if (!auth) {
    throw { code: 'auth/not-initialized' };
  }
  
  const provider = new GoogleAuthProvider();
  // إجبار جوجل على إظهار حسابات المستخدم لاختيار واحد منها
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    // 💻 + 📱 استخدام النافذة المنبثقة السريعة لجميع الأجهزة (بعد تفعيل الدومين الرسمي)
    const res = await signInWithPopup(auth, provider);
    return res.user;
  } catch (error: any) {
    console.error("Google Sign-In Exception:", error);
    
    // فضح الخطأ إذا كان من سفاري عشان نعرفه (بدون ما يزعج الزبون إذا سكر النافذة بيده)
    if (error.code !== 'auth/popup-closed-by-user') {
      alert("رمز الخطأ الحقيقي: " + error.code);
    }
    
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
    const res = await signInWithPopup(auth, provider);
    return res.user;
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