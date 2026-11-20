// Official Firebase Google sign-in (popup with the account chooser; redirect only as a fallback). No alerts, no
// password, nothing stored by us: Firebase keeps the session. The Worker verifies the resulting ID token itself.
import { GoogleAuthProvider, getRedirectResult, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { getFirebaseAuth } from './firebase';
import { googleOutcome, hasGoogleSession, type GoogleOutcome } from './googleGate';

const provider = () => {
  const p = new GoogleAuthProvider();
  // ask Google to show the account chooser (whether it appears also depends on Google, the browser and the device)
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
};

/** already signed in with Google (valid saved session): nothing to do */
export function currentGoogleUid(): string | null {
  const u = getFirebaseAuth()?.currentUser ?? null;
  return hasGoogleSession(u as any) ? (u as any).uid : null;
}

/**
 * Opens the Google window. MUST be called directly from the click (no await before it), else browsers block it.
 */
export async function googlePopup(): Promise<{ outcome: GoogleOutcome; uid?: string }> {
  const auth = getFirebaseAuth();
  if (!auth) return { outcome: 'unavailable' };
  try {
    const res = await signInWithPopup(auth, provider());
    return { outcome: 'ok', uid: res.user.uid };
  } catch (e: any) {
    return { outcome: googleOutcome(e?.code) };
  }
}

/** after coming back from the Google page: completes the redirect sign-in (null = there was none / it failed) */
export async function finishGoogleRedirect(): Promise<{ outcome: GoogleOutcome; uid?: string } | null> {
  const auth = getFirebaseAuth();
  if (!auth) return null;
  try {
    const res = await getRedirectResult(auth);
    return res?.user ? { outcome: 'ok', uid: res.user.uid } : null;
  } catch (e: any) {
    return { outcome: googleOutcome(e?.code) };
  }
}

/** fallback when the popup is blocked: the page is left (the caller saved the form first) */
export async function googleRedirect(): Promise<GoogleOutcome> {
  const auth = getFirebaseAuth();
  if (!auth) return 'unavailable';
  try {
    await signInWithRedirect(auth, provider());
    return 'ok';
  } catch (e: any) {
    return googleOutcome(e?.code);
  }
}
