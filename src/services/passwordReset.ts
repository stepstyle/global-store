import { sendPasswordResetEmail } from 'firebase/auth';
import { getFirebaseAuth } from './firebase';

// ✅ دالة مساعدة للتحقق من صحة صيغة البريد الإلكتروني
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * 🔐 خدمة استعادة كلمة المرور (Password Reset Service)
 * ترسل رابطاً لبريد المستخدم لإعادة تعيين كلمة المرور الخاصة به.
 *
 * @param email البريد الإلكتروني الخاص بالمستخدم.
 * @throws {Error} رسالة خطأ واضحة في حال فشل الإرسال أو خطأ في الإدخال.
 */
export const sendResetEmail = async (email: string): Promise<void> => {
  const sanitizedEmail = email?.trim();

  // 1. التحقق من المدخلات (Validation)
  if (!sanitizedEmail) {
    throw new Error('يرجى إدخال البريد الإلكتروني.');
  }

  if (!isValidEmail(sanitizedEmail)) {
    throw new Error('صيغة البريد الإلكتروني غير صحيحة، تأكد من كتابته بشكل صحيح.');
  }

  // 2. التحقق من تهيئة Firebase
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error('خدمة المصادقة (Firebase Auth) غير مهيأة حالياً. يرجى المحاولة لاحقاً.');
  }

  // 3. إعدادات التوجيه (يعيد المستخدم لصفحة تسجيل الدخول بعد تغيير كلمة السر)
  const actionCodeSettings = {
    url: `${window.location.origin}/login`,
    handleCodeInApp: false,
  };

  // 4. تنفيذ الطلب مع معالجة الأخطاء (Error Handling)
  try {
    await sendPasswordResetEmail(auth, sanitizedEmail, actionCodeSettings);
  } catch (error: any) {
    console.error('Password reset email error:', error);

    // ✅ ترجمة وتحويل أخطاء Firebase لرسائل مفهومة لتجربة مستخدم (UX) ممتازة
    switch (error.code) {
      case 'auth/user-not-found':
        throw new Error('لا يوجد حساب مرتبط بهذا البريد الإلكتروني.');
      case 'auth/invalid-email':
        throw new Error('البريد الإلكتروني المدخل غير صالح.');
      case 'auth/too-many-requests':
        throw new Error('تم إرسال طلبات كثيرة مؤخراً. يرجى الانتظار قليلاً ثم المحاولة مجدداً.');
      case 'auth/network-request-failed':
        throw new Error('فشل الاتصال بالشبكة. يرجى التحقق من اتصالك بالإنترنت.');
      default:
        throw new Error('حدث خطأ غير متوقع أثناء إرسال رابط الاستعادة. يرجى المحاولة مرة أخرى.');
    }
  }
};