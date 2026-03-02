import { sendPasswordResetEmail } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

export const sendResetEmail = async (email: string) => {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase Auth not initialized");

  // يرجّعك لصفحة تسجيل الدخول بعد تغيير كلمة السر (اختياري)
  const actionCodeSettings = {
    url: `${window.location.origin}/login`,
    handleCodeInApp: false,
  };

  await sendPasswordResetEmail(auth, email, actionCodeSettings);
};