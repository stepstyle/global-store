import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

export const signInWithGoogle = async () => {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase Auth not initialized");

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  const res = await signInWithPopup(auth, provider);
  return res.user;
};