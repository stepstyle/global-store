// src/services/authProviders.ts
import { 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  signInWithPopup, 
  User,
  sendEmailVerification 
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

export const signInWithGoogle = async (): Promise<User> => {
  const auth = getFirebaseAuth();
  if (!auth) throw { code: 'auth/not-initialized' };
  
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    const res = await signInWithPopup(auth, provider);
    return res.user;
  } catch (error: any) {
    console.error("Google Sign-In Exception:", error);
    throw error;
  }
};

export const signInWithFacebook = async (): Promise<User> => {
  const auth = getFirebaseAuth();
  if (!auth) throw { code: 'auth/not-initialized' };

  const provider = new FacebookAuthProvider();
  provider.addScope('email');

  try {
    const res = await signInWithPopup(auth, provider);
    return res.user;
  } catch (error: any) {
    throw error;
  }
};

export const sendUserVerification = async (user: User): Promise<void> => {
  await sendEmailVerification(user);
};