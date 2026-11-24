// src/pages/Checkout.tsx
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useCart } from '../App';
import Button from '../components/Button';
import {
  CheckCircle,
  Truck,
  MapPin,
  Shield,
  DollarSign,
  Smartphone,
  ShoppingBag,
  Mail,
  Phone,
  MessageCircle,
  Copy,
  Search,
  Zap,
  Clock,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import * as ReactRouterDOM from 'react-router-dom';
import { Order, Product } from '../types';
import { localAttemptStore, openAttempts, type OrderPayload, type SubmitDeps, type SubmitOptions, type PendingRecovery } from '../services/orderSubmit';
import {
  createSubmitLock, placeOrder, retrySameOrder, shouldClearCart, messageFor, whatsappUrl, whatsappNewOrderUrl, confirmedOrders,
  recoverPendingAttempts, restorablePayload, takeOwnerNotices, STORE_WHATSAPP,
  type CheckoutResult,
} from '../services/checkoutFlow';
import { CLIQ } from '../config/contact';
import { previewServerPricing } from '../services/pricePreview';
import { getFirebaseAuth, currentIdentity } from '../services/firebase';
import { siteKeyFrom } from '../services/turnstile';
import { useTurnstile } from '../components/useTurnstile';

// Cloudflare Turnstile: PUBLIC site key only (the secret stays in the Worker). Unset = no widget (the Worker decides:
// TURNSTILE_MODE=enforce refuses orders without a token).
const TURNSTILE_SITE_KEY = siteKeyFrom(import.meta.env.VITE_TURNSTILE_SITE_KEY);
import { ORDER_LIMITS, ORDER_EMAIL_RE, checkOrderLimits, sanitizeOrderLine } from '../services/orderLimits';

/** uid of the customer signed in with Firebase Auth right now, or null (guest / not signed in / local mock user). */
const firebaseUid = (): string | null => getFirebaseAuth()?.currentUser?.uid || null;
import SEO from '../components/SEO';
import LazyImage from '../components/LazyImage';
import SuggestionRail from '../components/SuggestionRail';
import { liveCartLine } from '../services/priceDisplay';
import { cartSuggestions } from '../services/recommendations';
import { BACKEND_ENABLED } from '../config/deployEnv';
import {
  WHEEL_ENABLED, WHEEL_SPIN_ID_RE, chosenPrize, choosePrize, fetchWheelState, prizeEffect, prizeText, usablePrize,
  claimGuestResult, fetchGuestResult, guestAsSpin, prizeExpired, DEFAULT_HOLD_MINUTES, isSecondOrder, prizeWaiting, SECOND_ORDER_HOURS,
  type WheelSpin, type WheelState,
} from '../services/wheel';
import PrizeCountdown from '../components/wheel/PrizeCountdown';
import SecondOrderStatus from '../components/wheel/SecondOrderStatus';
import { googleMessage, saveCheckoutResume, takeCheckoutResume, type GoogleOutcome } from '../services/googleGate';
import { currentGoogleUid, finishGoogleRedirect, googlePopup, googleRedirect } from '../services/googleAuth';

// Owner's rule: every order is confirmed by a Google account (signed in BEFORE sending; the Worker checks the signed
// token itself once ORDER_SIGN_IN=google). VITE_ORDER_SIGN_IN=optional keeps the old guest checkout (tests / rollback).
const ORDER_SIGN_IN_GOOGLE = String(import.meta.env.VITE_ORDER_SIGN_IN || 'google') !== 'optional';

const { useNavigate } = ReactRouterDOM as any;

type PaymentMethod = 'cod' | 'cliq';

const safeTrim = (s: any) => String(s ?? '').trim();

const clampQty = (n: any) => {
  const x = Math.round(Number(n) || 1);
  return Math.max(1, Math.min(99, x));
};

/**
 * Copies text; true only when the copy really happened (Clipboard API, then the textarea fallback for older iOS /
 * non-secure contexts). The page shows "copied" only on true.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall back */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

const JO_COUNTRY = { code: 'JO', nameAr: 'الأردن', nameEn: 'Jordan' };

const REGIONS = [
  {
    labelAr: 'محافظات الوسط',
    labelEn: 'Central Region',
    govs: [
      { slug: 'amman', ar: 'عمّان (العاصمة)', en: 'Amman' },
      { slug: 'zarqa', ar: 'الزرقاء', en: 'Zarqa' },
      { slug: 'balqa', ar: 'البلقاء (السلط)', en: 'Balqa' },
      { slug: 'madaba', ar: 'مادبا', en: 'Madaba' },
    ]
  },
  {
    labelAr: 'محافظات الشمال',
    labelEn: 'Northern Region',
    govs: [
      { slug: 'irbid', ar: 'إربد', en: 'Irbid' },
      { slug: 'jerash', ar: 'جرش', en: 'Jerash' },
      { slug: 'ajloun', ar: 'عجلون', en: 'Ajloun' },
      { slug: 'mafraq', ar: 'المفرق', en: 'Mafraq' },
    ]
  },
  {
    labelAr: 'محافظات الجنوب',
    labelEn: 'Southern Region',
    govs: [
      { slug: 'karak', ar: 'الكرك', en: 'Karak' },
      { slug: 'tafilah', ar: 'الطفيلة', en: 'Tafilah' },
      { slug: 'maan', ar: 'معان', en: "Ma'an" },
      { slug: 'aqaba', ar: 'العقبة', en: 'Aqaba' },
    ]
  }
];

const JO_GOVS = REGIONS.flatMap(r => r.govs);

// 🚀 قائمة مناطق عمان الذكية
const AMMAN_AREAS = [
  { id: 'a1', nameAr: 'النزهة / طبربور / طارق / ضاحية الأمير حسن', nameEn: 'Nuzha / Tabarbour / Tariq / Dahiyet Al Amir Hassan', price: 1.5, isOutskirt: false },
  { id: 'a2', nameAr: 'جبل الحسين / اللويبدة / العبدلي', nameEn: 'Jabal Hussein / Lweibdeh / Abdali', price: 2.0, isOutskirt: false },
  { id: 'a3', nameAr: 'الهاشمي الشمالي والجنوبي / ماركا', nameEn: 'Hashimi / Marka', price: 2.0, isOutskirt: false },
  { id: 'a4', nameAr: 'ضاحية الأقصى / الاستقلال', nameEn: 'Dahiyet Al Aqsa / Istiqlal', price: 1.5, isOutskirt: false },
  { id: 'a5', nameAr: 'وسط البلد / الأشرفية / الوحدات', nameEn: 'Downtown / Ashrafieh / Wehdat', price: 2.5, isOutskirt: false },
  { id: 'a6', nameAr: 'تلاع العلي / خلدا / أم السماق', nameEn: 'Tlaa Al Ali / Khalda / Um Al Summaq', price: 2.0, isOutskirt: false },
  { id: 'a7', nameAr: 'الشميساني / عبدون / دير غبار / الصويفية', nameEn: 'Shmeisani / Abdoun / Sweifieh', price: 2.0, isOutskirt: false },
  { id: 'a8', nameAr: 'الدوار السابع والثامن / البيادر', nameEn: '7th & 8th Circle / Bayader', price: 2.0, isOutskirt: false },
  { id: 'a9', nameAr: 'الجبيهة / أبو نصير / شفا بدران', nameEn: 'Jubeiha / Abu Nuseir / Shafa Badran', price: 2.5, isOutskirt: false },
  { id: 'a10', nameAr: 'دابوق / بدر الجديدة / الفحيص', nameEn: 'Dabouq / Badr Al Jadeedah', price: 2.5, isOutskirt: false },
  { id: 'a11', nameAr: 'مرج الحمام / المقابلين / البنيات', nameEn: 'Marj Al Hamam / Muqabalain', price: 2.5, isOutskirt: false },
  { id: 'a12', nameAr: 'سحاب / أبو علندا / اليادودة', nameEn: 'Sahab / Abu Alanda / Yadoudeh', price:2.5, isOutskirt: true },
  { id: 'a13', nameAr: 'الجيزة / خريبة السوق / القسطل', nameEn: 'Jizah / Khreibet Souq', price: 2.5, isOutskirt: true },
  { id: 'a14', nameAr: 'ناعور / طريق المطار', nameEn: 'Naour / Airport Road', price: 2.5, isOutskirt: true },
  // 🛡️ الخيار البديل
  { id: 'other', nameAr: 'منطقة أخرى (غير مذكورة في القائمة)', nameEn: 'Other Area (Not Listed)', price: 2.0, isOutskirt: true },
];

type DialOption = { code: string; dial: string; flag: string; nameAr: string; nameEn: string };
const DIAL_OPTIONS: DialOption[] = [
  { code: 'JO', dial: '+962', flag: '🇯🇴', nameAr: 'الأردن', nameEn: 'Jordan' },
];

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidJordanPhone = (phone: string) => {
  const cleanPhone = digitsOnly(phone);
  return /^(079|078|077)\d{7}$/.test(cleanPhone);
};

const digitsOnly = (s: string) => String(s ?? '').replace(/[^\d]/g, '');

const normalizeName = (name: string) => safeTrim(name).replace(/\s+/g, ' ');
const normalizeAddress = (addr: string) => safeTrim(addr).replace(/\s+/g, ' ');

const normalizePhoneGlobal = (dial: string, local: string) => {
  const d = String(dial || '').trim();
  const num = digitsOnly(local);
  if (!d || !num) return '';
  const cleanLocal = num.startsWith('0') ? num.substring(1) : num;
  return `${d}${cleanLocal}`;
};

const Checkout: React.FC = () => {
  const {
    cart,
    products,
    t,
    showToast,
    getProductTitle,
    clearCart,
    user,
    refreshProducts,
    language,
    orderNote,
    setOrderNote,
    clearOrderNote,
  } = useCart() as any;

  const navigate = useNavigate();
  const isAR = language === 'ar';
  const isLoggedIn = !!user?.id;

  const tr = (ar: string, en: string) => (isAR ? ar : en);

  const tt = (key: string, fallbackAr: string, fallbackEn: string) => {
    try {
      const out = t(key as any);
      if (!out || String(out) === key) return tr(fallbackAr, fallbackEn);
      return String(out);
    } catch {
      return tr(fallbackAr, fallbackEn);
    }
  };

  const [step, setStep] = useState(1);
  const [shippingMethodId, setShippingMethodId] = useState<string>('standard');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [isProcessing, setIsProcessing] = useState(false);

  // ---- order submission (Worker v2 is the only writer of the order) ----
  const submittingRef = useRef(false); // synchronous guard against double clicks / double taps
  const lockRef = useRef(createSubmitLock()); // second lock inside placeOrder()
  // order number + content hash + tracking key of each attempt, shared by ALL tabs and kept after closing the browser
  // (localStorage; no personal data). An unresolved attempt blocks a new number until it is settled.
  const attemptStoreRef = useRef(localAttemptStore());
  // the same content confirmed AFTER this page was opened (another tab / recovery) is never ordered twice
  const openedAtRef = useRef(Date.now());
  // earlier attempts of this browser found when the page opened: recovered (saved and ours) or still unresolved
  const [pendingAttempts, setPendingAttempts] = useState<PendingRecovery[]>([]);
  const [pendingChecked, setPendingChecked] = useState(false);
  // the signed-in account could not be confirmed in time (Firebase session restore slow/failed): nothing bound to an
  // account is restored or shown; the customer can check again
  const [identityUnknown, setIdentityUnknown] = useState(false);
  const [identityCheck, setIdentityCheck] = useState(0);
  // the account this page was opened (and filled in) for; a different account at the moment of sending -> not sent
  const identityAtOpenRef = useRef<string | null>(null);
  const lastPayloadRef = useRef<OrderPayload | null>(null); // exact payload of the last send (same-number retry)
  const resultPanelRef = useRef<HTMLDivElement | null>(null);
  const [submitResult, setSubmitResult] = useState<CheckoutResult | null>(null);
  // why the order was NOT sent (checked locally before sending); shown inline — App's toasts are not rendered
  const [submitBlocked, setSubmitBlocked] = useState('');
  // Owner's sequence: "confirm order" -> Google account chooser (if not signed in) -> security check (Turnstile) ->
  // "final confirm" -> ONE send. googleUid: the Google session this page knows of (set right after the sign-in).
  const GOOGLE_GATE = BACKEND_ENABLED && ORDER_SIGN_IN_GOOGLE;
  const [googleUid, setGoogleUid] = useState<string | null>(() => currentGoogleUid());
  useEffect(() => { setGoogleUid(currentGoogleUid()); }, [user?.id]);
  const googleReady = !GOOGLE_GATE || !!googleUid;
  // Turnstile widget on the payment step — with the Google rule only AFTER the sign-in; a FRESH single-use token is
  // asked before every send (orderSubmit)
  const turnstile = useTurnstile(TURNSTILE_SITE_KEY, step === 3 && googleReady, isAR ? 'ar' : 'en');
  // prize wheel (VITE_WHEEL_MODE=test only): the account's won prizes come from the Worker (never from this browser
  // alone); the one used is sent with the SIGNED-IN order ONLY when it applies, and the Worker re-checks everything.
  // Not signed in yet: the result of the spin made WITHOUT an account (this browser's ticket) is SHOWN, never sent —
  // it is linked to the Google account right after the sign-in, before the final confirmation.
  const [wheelState, setWheelState] = useState<WheelState | null>(null);
  const [guestPrize, setGuestPrize] = useState<WheelSpin | null>(null);
  const [wheelNotice, setWheelNotice] = useState('');
  const [wheelPick, setWheelPick] = useState<string | null>(() => chosenPrize()?.spinId ?? null);
  const [wheelRemoved, setWheelRemoved] = useState(false);
  // re-evaluated when the shown prize's 60-minute window ends (PrizeCountdown), so it stops being applied at once
  const [prizeClock, setPrizeClock] = useState(0);
  const onPrizeExpire = useCallback(() => setPrizeClock((n) => n + 1), []);
  const wheelPrize = useMemo(() => {
    if (!WHEEL_ENABLED || wheelRemoved) return null;
    if (wheelState) {
      const usable = wheelState.spins.filter((s) => usablePrize(s));
      return usable.find((s) => s.spinId === wheelPick) ?? usable[usable.length - 1] ?? null;
    }
    return guestPrize && usablePrize(guestPrize) ? guestPrize : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheelState, guestPrize, wheelPick, wheelRemoved, prizeClock]);
  // nothing usable, but a prize whose window just passed: shown as EXPIRED (never applied, never sent)
  const expiredPrize = useMemo(() => {
    if (!WHEEL_ENABLED || wheelRemoved || wheelPrize) return null;
    const list = wheelState ? wheelState.spins : guestPrize ? [guestPrize] : [];
    return list.filter((s) => prizeExpired(s)).pop() ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheelState, guestPrize, wheelPrize, wheelRemoved, prizeClock]);
  const holdMin = wheelState?.prizeHoldMinutes ?? DEFAULT_HOLD_MINUTES;
  // a second-order discount kept for this account until its first delivery (shown, never applied to this order)
  const waitingPrize = useMemo(() => {
    if (!WHEEL_ENABLED || wheelPrize) return null;
    const list = wheelState ? wheelState.spins : guestPrize ? [guestPrize] : [];
    return list.filter((s) => prizeWaiting(s)).pop() ?? null;
  }, [wheelState, guestPrize, wheelPrize]);
  const secondDays = (wheelState?.secondOrderHours ?? SECOND_ORDER_HOURS) / 24;
  const fmtWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(isAR ? 'ar-JO' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const prizeIsGuest = !!wheelPrize && !wheelPrize.spinId;
  const wheelAttachRef = useRef<string | null>(null); // the spin id sent with the order (only when the prize applies)
  // Google sign-in at "confirm order" (owner's rule)
  const [googleIssue, setGoogleIssue] = useState<GoogleOutcome | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [resumeNotice, setResumeNotice] = useState('');
  const turnstileTokenRef = useRef(turnstile.getToken);
  turnstileTokenRef.current = turnstile.getToken;
  const workerOpts = useMemo<SubmitOptions>(
    () => ({
      // 🛡️ Deploy guard: a sandbox build never calls any Worker (and has no VITE_WORKER_URL in its bundle); without a
      // Worker URL orderSubmit refuses to send. local-test: the loopback Worker validated by firebase-env-guard.
      workerUrl: BACKEND_ENABLED ? String(import.meta.env.VITE_WORKER_URL || '') : '',
      ...(TURNSTILE_SITE_KEY ? { getTurnstileToken: () => turnstileTokenRef.current() } : {}),
      ...(WHEEL_ENABLED ? { getWheelSpinId: () => wheelAttachRef.current } : {}),
      // Firebase ID token of the signed-in customer (refreshed on request after a 401); null for guests
      getAuthToken: async (forceRefresh: boolean) => {
        const current = getFirebaseAuth()?.currentUser;
        return current ? current.getIdToken(forceRefresh) : null;
      },
    }),
    []
  );
  useEffect(() => {
    let alive = true;
    (async () => {
      const store = attemptStoreRef.current;
      // who uses this browser now — only after Firebase restored a saved session (else a customer looks like a guest).
      // null = could not be decided in time: restore/show NOTHING bound to an identity, offer to check again.
      const who = await currentIdentity();
      if (!alive) return;
      if (who === null) {
        setIdentityUnknown(true);
        setPendingAttempts(openAttempts(store).map((r) => ({ orderId: r.orderId, state: 'unknown' as const })));
        setPendingChecked(true);
        return;
      }
      setIdentityUnknown(false);
      if (identityAtOpenRef.current === null) identityAtOpenRef.current = who;
      // the owner is back: their orders recovered while another account used this device
      const notices = takeOwnerNotices(store, who);
      if (!openAttempts(store).length) {
        setPendingAttempts(notices);
        setPendingChecked(true);
        return;
      }
      // the exact payload of the newest open attempt, if THIS tab still has it (refresh) AND it matches its content hash
      const kept = await restorablePayload(store, undefined, who);
      if (kept && alive) lastPayloadRef.current = kept;
      const res = await recoverPendingAttempts(store, workerOpts, { fetch: (url, init) => window.fetch(url, init as RequestInit) as any }, undefined, undefined, who);
      if (alive) {
        setPendingAttempts([...notices, ...res]);
        setPendingChecked(true);
      }
    })().catch(() => alive && setPendingChecked(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityCheck]);

  const workerDeps = useMemo<SubmitDeps>(
    () => ({
      fetch: (url, init) => window.fetch(url, init as RequestInit) as any,
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    }),
    []
  );

  // prize wheel: signed in -> this browser's guest result (if any) is linked to the account FIRST (the Worker decides,
  // once), then the account's prizes; not signed in -> the guest result, for display only
  const refreshWheel = useCallback(async (isStale: () => boolean = () => false) => {
    if (!WHEEL_ENABLED || !BACKEND_ENABLED) return;
    const url = String(import.meta.env.VITE_WORKER_URL || '');
    const t = await getFirebaseAuth()?.currentUser?.getIdToken().catch(() => null);
    if (!t) {
      const g = await fetchGuestResult(url, workerDeps);
      if (isStale()) return;
      setWheelState(null);
      setGuestPrize(g && g !== 'unavailable' ? guestAsSpin(g) : null);
      return;
    }
    const c = await claimGuestResult(t, url, workerDeps);
    if (isStale()) return;
    if (c.kind === 'claimed' && c.result?.status === 'issued') { choosePrize({ spinId: c.spinId, label: c.result.label }); setWheelPick(c.spinId); }
    if (c.kind === 'account_has_spin') setWheelNotice(tr('لحسابك نتيجة دولاب سابقة، فبقيت هي المعتمدة ولم تُضف نتيجة اللفة التي قمت بها قبل تسجيل الدخول.', 'Your account already has a wheel result: it stays, and the spin made before signing in is not added.'));
    else if (c.kind === 'expired') setWheelNotice(tr('انتهت صلاحية جائزة الدولاب (60 دقيقة من لحظة اللفة) قبل تسجيل الدخول وتأكيد الطلب، فلم تعد صالحة للاستعمال. تُحسب لفّتك الترحيبية لهذا الحساب.', 'The wheel prize window (60 minutes from the spin) ended before you signed in and confirmed, so it can no longer be used. It counts as this account\'s welcome spin.'));
    else if (c.kind === 'not_second_order') setWheelNotice(tr('ربحت خصم «الطلب الثاني»، لكن حسابك تجاوز طلبه الثاني، فلا يمكن استخدامه. تُحسب لفّتك الترحيبية لهذا الحساب.', 'You won the "second order" discount, but your account is already past its second order, so it cannot be used. It counts as this account\'s welcome spin.'));
    else if (c.kind === 'claimed_by_other') setWheelNotice(tr('نتيجة الدولاب في هذا المتصفح مرتبطة بحساب آخر، فلا تُطبَّق على هذا الحساب.', 'The wheel result in this browser belongs to another account, so it does not apply here.'));
    else if (c.kind === 'unavailable') setWheelNotice(tr('تعذّر ربط جائزة الدولاب بحسابك الآن، فلن تُطبَّق على هذا الطلب. يمكنك إكمال الطلب بدونها أو إعادة المحاولة لاحقًا؛ تبقى محفوظة في هذا المتصفح.', 'The wheel prize could not be linked to your account right now, so it is not applied to this order. You can order without it or try later; it stays saved in this browser.'));
    const r = await fetchWheelState(t, url, workerDeps);
    if (isStale()) return;
    setGuestPrize(null);
    setWheelState(r.kind === 'ok' ? r.value : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerDeps, isAR]);
  useEffect(() => {
    let stop = false;
    void refreshWheel(() => stop);
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const [email, setEmail] = useState<string>(() => safeTrim(user?.email || ''));
  useEffect(() => {
    const uEmail = safeTrim(user?.email || '');
    if (uEmail && !safeTrim(email)) setEmail(uEmail);
  }, [user?.email]);

  const [dialCode, setDialCode] = useState<string>(() => '+962');
  const [cliqRef, setCliqRef] = useState('');

  const [areaSearchQuery, setAreaSearchQuery] = useState('');
  const [isAreaDropdownOpen, setIsAreaDropdownOpen] = useState(false);

  const [formData, setFormData] = useState({
    fullName: '',
    country: JO_COUNTRY.nameEn,
    citySlug: '',
    ammanAreaId: '', 
    streetAddress: '', 
    postalCode: '',
    phoneLocal: '',
    saveInfo: true,
    billingSameAsShipping: true,
  });

  const [acceptPolicies, setAcceptPolicies] = useState(true);
  const [acceptDeliveryPolicy, setAcceptDeliveryPolicy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // back from the Google PAGE (fallback when the popup was blocked): the details typed before leaving are restored
  // once; nothing is sent automatically — the customer reviews and confirms again
  useEffect(() => {
    const saved = takeCheckoutResume();
    if (!saved) return;
    const f = saved.formData;
    if (f && typeof f === 'object') setFormData((p) => ({ ...p, ...(f as Record<string, any>) }));
    if (typeof saved.email === 'string') setEmail(saved.email);
    if (typeof saved.dialCode === 'string') setDialCode(saved.dialCode);
    if (saved.shippingMethodId === 'standard' || saved.shippingMethodId === 'fast') setShippingMethodId(saved.shippingMethodId);
    if (saved.paymentMethod === 'cod' || saved.paymentMethod === 'cliq') setPaymentMethod(saved.paymentMethod as PaymentMethod);
    if (typeof saved.cliqRef === 'string') setCliqRef(saved.cliqRef);
    if (typeof saved.acceptDeliveryPolicy === 'boolean') setAcceptDeliveryPolicy(saved.acceptDeliveryPolicy);
    setStep(3);
    // nothing is sent automatically: the customer reviews, passes the security check and confirms
    void finishGoogleRedirect().then(async (g) => {
      if (g?.outcome === 'ok' && g.uid) await afterGoogleSignIn(g.uid);
      else if (g) { setGoogleIssue(g.outcome); setSubmitBlocked(googleMessage(g.outcome, isAR)); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeStep = (newStep: number) => {
    setStep(newStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(isAR ? 'ar-JO' : 'en-JO', {
        style: 'currency',
        currency: 'JOD',
        maximumFractionDigits: 2,
      });
    } catch {
      return null;
    }
  }, [isAR]);

  const formatMoney = (value: number) =>
    fmt ? fmt.format(value) : `JOD ${Number(value || 0).toFixed(2)}`;

  const filteredAreas = useMemo(() => {
    if (!areaSearchQuery) return AMMAN_AREAS;
    const q = areaSearchQuery.toLowerCase();
    return AMMAN_AREAS.filter(a =>
      a.nameAr.toLowerCase().includes(q) || a.nameEn.toLowerCase().includes(q)
    );
  }, [areaSearchQuery]);

  const selectedAmmanArea = useMemo(() => {
    return AMMAN_AREAS.find(a => a.id === formData.ammanAreaId);
  }, [formData.ammanAreaId]);

  const baseShippingCost = useMemo(() => {
    const slug = formData.citySlug;
    if (!slug) return 0;

    if (slug === 'amman') {
      const area = AMMAN_AREAS.find(a => a.id === formData.ammanAreaId);
      if (!area) return 0;
      return area.price;
    }
    return 3.0;
  }, [formData.citySlug, formData.ammanAreaId]);

  const dynamicShippingMethods = useMemo(() => {
    const methods = [
      {
        id: 'standard',
        nameAr: 'توصيل عادي (خلال 48 ساعة)',
        nameEn: 'Standard Delivery (48 Hours)',
        durationAr: 'نفس التسعيرة الأساسية لمنطقتك',
        durationEn: 'Base price for your area',
        price: baseShippingCost,
        icon: Truck,
      }
    ];

    if (formData.citySlug === 'amman') {
      methods.push({
        id: 'fast',
        nameAr: 'توصيل سريع (خلال 12 ساعة)',
        nameEn: 'Fast Delivery (12 Hours)',
        durationAr: 'أولوية التجهيز (+ 1 دينار)',
        durationEn: 'Priority fulfillment (+ 1 JD)',
        price: baseShippingCost + 1.0,
        icon: Zap,
      });
    }

    return methods;
  }, [baseShippingCost, formData.citySlug]);

  useEffect(() => {
    if (formData.citySlug !== 'amman' && shippingMethodId === 'fast') {
      setShippingMethodId('standard');
    }
  }, [formData.citySlug, shippingMethodId]);

  const selectedShipping = useMemo(
    () => dynamicShippingMethods.find((m) => m.id === shippingMethodId) || dynamicShippingMethods[0],
    [shippingMethodId, dynamicShippingMethods]
  );

  const validatedCart = useMemo(() => {
    const safeCart = Array.isArray(cart) ? cart : [];
    // price / stock from the LIVE catalogue (variant looked up by id), the numbers the order server uses
    return safeCart.map((cartItem: any) => {
      const live = liveCartLine(cartItem, products as Product[]);
      return {
        ...cartItem,
        selectedVariant: live.selectedVariant ?? cartItem.selectedVariant,
        price: live.price,
        stock: live.stock,
      };
    });
  }, [cart, products]);
  // first step only, three at most: related products the customer may add (never added by itself)
  const checkoutSuggestions = useMemo(() => cartSuggestions(Array.isArray(cart) ? cart : [], products as Product[], 3), [cart, products]);

  const subtotal = useMemo(
    () =>
      validatedCart.reduce((sum: number, item: any) => {
        const price = Number(item.price || 0);
        const qty = clampQty(item.quantity);
        return sum + price * qty;
      }, 0),
    [validatedCart]
  );

  const totalItems = useMemo(
    () => validatedCart.reduce((sum: number, item: any) => sum + clampQty(item.quantity), 0),
    [validatedCart]
  );

  const volumeDiscount = useMemo(
    () => (totalItems > 2 ? subtotal * 0.1 : 0),
    [subtotal, totalItems]
  );

  const baseShippingFee = selectedShipping ? Number(selectedShipping.price || 0) : 0;
  // the wheel prize, computed like the Worker (services/wheel.ts prizeEffect): applied only when its conditions hold
  const prizeFx = useMemo(
    () => (wheelPrize ? prizeEffect(wheelPrize, { subtotal, volumeDiscount, shippingCost: baseShippingFee, previousDelivered: wheelState?.previousDelivered ?? null }) : null),
    [wheelPrize, subtotal, volumeDiscount, baseShippingFee, wheelState]
  );
  const prizeApplies = !!prizeFx && prizeFx.state === 'applies';
  const wheelDiscount = prizeApplies && prizeFx.state === 'applies' ? prizeFx.discountJod : 0;
  const shippingWaived = prizeApplies && prizeFx.state === 'applies' ? prizeFx.shippingWaivedJod : 0;
  // what the order sends (same fields as before): volume discount + wheel discount, delivery after a waiver
  const discountAmount = volumeDiscount + wheelDiscount;
  const shippingCost = baseShippingFee - shippingWaived;
  const total = Math.max(0, subtotal - discountAmount + shippingCost);

  const setField = (key: string, value: any) => {
    setFormData((p) => ({ ...p, [key]: value }));
    setErrors((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
  };

  const setEmailField = (value: string) => {
    setEmail(value);
    setErrors((p) => {
      const next = { ...p };
      delete next.email;
      return next;
    });
  };

  const validateStep1 = () => {
    const nextErr: Record<string, string> = {};
    const currentEmail = safeTrim(email || user?.email || '');

    // with the Google rule the e-mail comes from the Google account at "confirm order" (typed one wins if given)
    if (!isLoggedIn && !currentEmail && !ORDER_SIGN_IN_GOOGLE) {
      nextErr.email = tr('البريد الإلكتروني مطلوب للضيوف', 'Email is required for guests');
    } else if (currentEmail && (!emailRegex.test(currentEmail) || currentEmail.length > ORDER_LIMITS.emailMax || !ORDER_EMAIL_RE.test(currentEmail))) {
      nextErr.email = tr('البريد الإلكتروني غير صحيح', 'Invalid email');
    }

    const name = normalizeName(formData.fullName);
    if (name.length < 5) {
      nextErr.fullName = tt('nameMin5', 'الاسم يجب أن يكون 5 أحرف على الأقل', 'Name must be at least 5 characters.');
    } else if (name.length > ORDER_LIMITS.nameMax) {
      nextErr.fullName = tr(`الاسم طويل جدًا: الحد الأقصى ${ORDER_LIMITS.nameMax} حرفًا.`, `Name is too long (max ${ORDER_LIMITS.nameMax} characters).`);
    }

    if (normalizeAddress(formData.streetAddress).length > ORDER_LIMITS.streetMax) {
      nextErr.streetAddress = tr(`العنوان التفصيلي طويل جدًا: الحد الأقصى ${ORDER_LIMITS.streetMax} حرف.`, `Address is too long (max ${ORDER_LIMITS.streetMax} characters).`);
    }

    if (!safeTrim(formData.citySlug)) {
      nextErr.citySlug = tt('cityRequired', 'المحافظة مطلوبة', 'City is required.');
    } else if (formData.citySlug === 'amman' && !safeTrim(formData.ammanAreaId)) {
      nextErr.ammanAreaId = tt('areaRequired', 'يرجى تحديد منطقتك السكنية', 'Please select your residential area.');
    }

    if (!isValidJordanPhone(formData.phoneLocal)) {
      nextErr.phoneLocal = tt('phoneInvalid', 'يرجى إدخال رقم أردني صحيح (يبدأ بـ 079, 078, 077)', 'Please enter a valid Jordanian number (079, 078, 077).');
    }

    if (!acceptPolicies) {
      nextErr.acceptPolicies = tt('acceptPoliciesRequired', 'يجب الموافقة على سياسات المتجر لإتمام الطلب', 'You must accept the store policies to place the order.');
    }

    setErrors(nextErr);
    return Object.keys(nextErr).length === 0;
  };

  const goToShipping = () => {
    const ok = validateStep1();
    if (!ok) {
      showToast(tt('fixErrors', 'يرجى تصحيح الحقول المحددة باللون الأحمر', 'Please fix the required fields.'), 'error');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    changeStep(2);
  };

  /** The order exactly as before (same fields, same prices) — WITHOUT a number: the attempt store assigns it. */
  const buildDraft = (): Record<string, any> => {
      const shippingPhoneE164 = normalizePhoneGlobal(dialCode, formData.phoneLocal) || safeTrim(formData.phoneLocal);

      let shippingCityName = '';
      REGIONS.forEach(r => {
        const gov = r.govs.find(g => g.slug === formData.citySlug);
        if (gov) shippingCityName = isAR ? gov.ar : gov.en;
      });

      if (formData.citySlug === 'amman' && selectedAmmanArea) {
        shippingCityName = `${shippingCityName} - ${isAR ? selectedAmmanArea.nameAr : selectedAmmanArea.nameEn}`;
      }

      const shippingStreet = normalizeAddress(formData.streetAddress) || 'لم يتم إدخال عنوان تفصيلي';

      const now = new Date();
      const nowIso = now.toISOString();
      const nowDate = nowIso.split('T')[0];

      // 🚀 تجهيز الطلب مع دمج الخيارات (الألوان والأحجام)
      const newOrder: Omit<Order, 'id'> & any = {
        // identity comes from Firebase Auth (proven to the Worker by the ID token), not from a locally stored user
        userId: firebaseUid() || 'guest',
        status: 'new',
        seenByAdmin: false,
        date: nowDate,
        createdAt: nowIso,
        createdAtMs: now.getTime(),
        updatedAt: nowIso,
        
        items: validatedCart.map((item: any) => {
          const variantSuffix = item.selectedVariant?.label && item.selectedVariant.label !== '.' 
            ? ` - ${item.selectedVariant.label}` 
            : '';
            
          return sanitizeOrderLine({
            productId: item.id,
            name: `${item.name}${variantSuffix}`,
            price: Number(item.price || 0),
            quantity: clampQty(item.quantity),
            image: item.image,
            selectedVariant: item.selectedVariant || null,
          });
        }),
        
        subtotal,
        discountAmount,
        shippingCost,
        total,
        shippingMethodId,
        shippingMethod: isAR ? selectedShipping.nameAr : selectedShipping.nameEn,
        paymentMethod,
        customerEmail: safeTrim(email) || safeTrim(user?.email || '') || safeTrim(getFirebaseAuth()?.currentUser?.email || ''),
        consents: {
          acceptedStorePolicies: !!acceptPolicies,
          acceptedDeliveryPolicy: !!acceptDeliveryPolicy,
          saveInfo: !!formData.saveInfo,
          billingSameAsShipping: !!formData.billingSameAsShipping,
        },
        note: safeTrim(orderNote) || undefined,
        paymentDetails: paymentMethod === 'cliq' ? { cliqReference: safeTrim(cliqRef), isPaid: false } : undefined,
        address: { fullName: normalizeName(formData.fullName) || 'Guest', city: shippingCityName, street: shippingStreet, phone: shippingPhoneE164 },
        addressMeta: { country: JO_COUNTRY.nameEn, countryCode: JO_COUNTRY.code, citySlug: formData.citySlug, ammanAreaId: formData.ammanAreaId, saveInfo: !!formData.saveInfo, phoneDial: dialCode, phoneLocal: safeTrim(formData.phoneLocal) },
      };
      return newOrder;
  };

  /** Apply a submission result. ONLY a Worker-verified confirmation clears the cart and opens the success page. */
  const applyResult = (r: CheckoutResult) => {
    if (r.status === 'busy') return;
    if (shouldClearCart(r) && r.status === 'confirmed') {
      try {
        // display details for the success page on THIS device (the page still verifies with the Worker)
        sessionStorage.setItem(`order_success_${r.orderId}`, JSON.stringify(r.payload));
      } catch {}
      confirmedOrders().add(r.orderId);
      // the prize travelled with this (signed-in) order: it is now reserved for it
      if (wheelAttachRef.current) { choosePrize(null); wheelAttachRef.current = null; }
      lastPayloadRef.current = null;
      setSubmitResult(null);
      clearCart();
      if (typeof clearOrderNote === 'function') clearOrderNote();
      // not tt('alertSet', …): that translation key means 'alert registered' and would show the wrong text
      showToast(tr('تم تأكيد طلبك بنجاح', 'Your order is confirmed.'), 'success');
      navigate(`/order-success/${r.orderId}`, { replace: true });
      return;
    }
    if (r.status === 'account_changed') {
      // the earlier account's payload is never resent under this one; the page now belongs to the current account
      lastPayloadRef.current = null;
      identityAtOpenRef.current = r.current;
      setSubmitResult(r);
      setTimeout(() => resultPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }
    // the Worker refused the prize (expired, used, …): reload the prizes so the next confirmation is sent without it
    if (String((r as any).code || '').startsWith('WHEEL_')) { setPrizeClock((n) => n + 1); void refreshWheel(); }
    // not confirmed: keep the cart, keep the exact payload for a same-number retry
    lastPayloadRef.current = 'payload' in r ? r.payload : r.status === 'rejected' ? null : lastPayloadRef.current;
    setSubmitResult(r);
    setTimeout(() => resultPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  const runSubmission = async (fn: () => Promise<CheckoutResult>) => {
    if (submittingRef.current) return; // synchronous: a second click/tap is ignored
    submittingRef.current = true;
    setIsProcessing(true);
    try {
      applyResult(await fn());
    } catch (error: any) {
      console.error('Checkout submit failed:', error);
      applyResult({ status: 'misconfigured', orderId: '', reason: String(error?.message || error) });
    } finally {
      submittingRef.current = false;
      setIsProcessing(false);
    }
  };

  /**
   * Right after a successful Google sign-in (popup or the Google page): the page now belongs to this account (a payload
   * prepared for another identity is never resent under it), the guest wheel result is linked, the account's prizes
   * are loaded — all BEFORE the final confirmation, so the summary the customer confirms is the one sent.
   */
  const afterGoogleSignIn = async (uid: string) => {
    if (identityAtOpenRef.current !== uid) {
      identityAtOpenRef.current = uid;
      lastPayloadRef.current = null;
    }
    setGoogleUid(uid);
    await refreshWheel();
    setResumeNotice(TURNSTILE_SITE_KEY
      ? tr('تم تسجيل الدخول بحساب Google. أكمل التحقق الأمني أدناه، ثم اضغط «تأكيد الطلب النهائي» لإرسال الطلب.', 'Signed in with Google. Complete the security check below, then press "Final confirmation" to send the order.')
      : tr('تم تسجيل الدخول بحساب Google. راجع الملخص ثم اضغط «تأكيد الطلب النهائي» لإرسال الطلب.', 'Signed in with Google. Review the summary, then press "Final confirmation" to send the order.'));
  };

  const handlePlaceOrder = async () => {
    if (submittingRef.current) return;
    setSubmitBlocked('');

    if (!Array.isArray(validatedCart) || validatedCart.length === 0) {
      showToast(tt('cartEmpty', 'سلتك فارغة', 'Your cart is empty'), 'error');
      return;
    }

    const ok = validateStep1();
    if (!ok) {
      showToast(tt('fixErrors', 'يرجى تصحيح الحقول المطلوبة', 'Please fix the required fields.'), 'error');
      changeStep(1);
      return;
    }

    if (!selectedShipping) {
      showToast(tt('shippingRequired', 'يرجى اختيار طريقة التوصيل', 'Please select a shipping method.'), 'error');
      changeStep(2);
      return;
    }

    if (paymentMethod === 'cliq') {
      const ref = safeTrim(cliqRef);
      if (!ref) {
        // shown inline only (one display per error)
        setSubmitBlocked(tt('enterCliqRef', 'يرجى إدخال الرقم المرجعي لحوالة CliQ', 'Please enter the CliQ reference number.'));
        return;
      }
    }

    // the Worker's input limits: refuse HERE with a clear message (nothing is sent; cart and pending attempt untouched)
    const limitProblems = checkOrderLimits({
      fullName: normalizeName(formData.fullName),
      street: normalizeAddress(formData.streetAddress),
      email: safeTrim(email) || safeTrim(user?.email || ''),
      note: safeTrim(orderNote),
      paymentMethod,
      cliqRef: safeTrim(cliqRef),
      quantities: validatedCart.map((item: any) => clampQty(item.quantity)),
      total: Number(total),
    });
    if (limitProblems.length) {
      const first = limitProblems[0];
      // shown inline only (one display per error)
      setSubmitBlocked(isAR ? first.ar : first.en);
      if (first.field === 'fullName' || first.field === 'streetAddress' || first.field === 'email') changeStep(1);
      return;
    }

    // Owner's sequence. Not signed in with Google -> the Google window (account chooser) opens NOW, straight from this
    // click (nothing awaited before it, else the browser blocks it). NOTHING is sent by this click:
    //   closed / failed -> cart, form and prize stay as they are, the message says the order was not sent
    //   signed in       -> the wheel result made before signing in is linked to the account (prices updated), the
    //                      security check (Turnstile) appears, and the customer presses "final confirm" to send ONCE.
    // A valid saved Google session -> this is already the final confirmation.
    // (a sandbox build has no Firebase and no Worker: nothing can be sent there, the usual "not sent" message applies)
    if (GOOGLE_GATE && !currentGoogleUid()) {
      setGoogleIssue(null);
      setResumeNotice('');
      setGoogleBusy(true);
      submittingRef.current = true; // a second click while the Google window is open does nothing
      try {
        const g = await googlePopup();
        if (g.outcome !== 'ok' || !g.uid) {
          setGoogleIssue(g.outcome);
          setSubmitBlocked(googleMessage(g.outcome === 'ok' ? 'failed' : g.outcome, isAR));
          return;
        }
        await afterGoogleSignIn(g.uid);
      } finally {
        submittingRef.current = false;
        setGoogleBusy(false);
      }
      return;
    }

    // Turnstile configured but unavailable: nothing is sent (the Worker would refuse a missing token anyway)
    if (turnstile.enabled && turnstile.status === 'error') {
      setSubmitBlocked(tr('تعذّر تحميل التحقق الأمني، فلم يُرسل الطلب. حدّث الصفحة ثم أعد المحاولة.', 'The security check is unavailable, so the order was not sent. Refresh the page and try again.'));
      return;
    }

    // the prize travels with THIS attempt only when it applies AND belongs to the signed-in account (a result made
    // before signing in is never sent; the Worker re-checks owner, status, minimum, prices)
    wheelAttachRef.current = prizeApplies && wheelPrize && WHEEL_SPIN_ID_RE.test(wheelPrize.spinId) ? wheelPrize.spinId : null;

    await runSubmission(() =>
      placeOrder({
        draft: buildDraft(),
        store: attemptStoreRef.current,
        opts: workerOpts,
        deps: workerDeps,
        lock: lockRef.current,
        lastPayload: lastPayloadRef.current,
        openedAt: openedAtRef.current,
        // decided at the moment of sending (after the saved session was restored) — never a customer turned guest
        identity: () => currentIdentity(),
        expectedIdentity: identityAtOpenRef.current,
      })
    );
  };

  // the button names the step: "confirm order" (opens the Google sign-in, sends nothing) -> "final confirmation" (sends)
  const confirmLabel = googleBusy
    ? tr('بانتظار تسجيل الدخول بـ Google…', 'Waiting for Google sign-in…')
    : isProcessing
    ? tr('جاري تأكيد الطلب...', 'Confirming the order…')
    : GOOGLE_GATE
    ? (googleReady ? tr('تأكيد الطلب النهائي', 'Final confirmation') : tr('تأكيد الطلب', 'Confirm order'))
    : tt('placeOrder', 'تأكيد وإتمام الطلب', 'Confirm & Place Order');

  /** "Retry with the same number": resends the exact last payload (never a new number). */
  const handleRetrySame = async () => {
    const last = lastPayloadRef.current;
    if (!last) return handlePlaceOrder();
    await runSubmission(() =>
      retrySameOrder({ store: attemptStoreRef.current, opts: workerOpts, deps: workerDeps, lock: lockRef.current, lastPayload: last, openedAt: openedAtRef.current, identity: () => currentIdentity(), expectedIdentity: identityAtOpenRef.current })
    );
  };

  /** What the Worker's own pricing code computes for this cart (preview, step 3 only). */
  const pricePreview = useMemo(() => {
    if (step !== 3) return null;
    try {
      const adj = prizeApplies && wheelPrize ? (wheelPrize.type === 'discount' ? { discountJod: wheelPrize.valueJod } : wheelPrize.type === 'free_delivery' ? { shippingCapJod: wheelPrize.valueJod } : null) : null;
      const p = previewServerPricing(buildDraft(), Array.isArray(products) ? products : [], adj);
      return p.ok ? p : null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, validatedCart, products, formData, shippingMethodId, paymentMethod, cliqRef, email, orderNote, subtotal, discountAmount, shippingCost, total, prizeApplies, wheelPrize]);

  const inputClass = (hasError: boolean) => [
    'w-full p-4 bg-slate-50 border rounded-2xl outline-none transition-all duration-300 font-medium text-slate-800',
    hasError 
      ? 'border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-500/10' 
      : 'border-slate-200 focus:border-sky-400 focus:ring-4 focus:ring-sky-400/20 hover:border-slate-300'
  ].join(' ');

  // Earlier attempt(s) of this browser (after a refresh / closing the browser). Shown on the normal checkout AND on the
  // empty-cart view (e.g. another tab emptied the cart): the order number and the way to the shop never disappear.
  const pendingBanner = pendingAttempts.length > 0 || identityUnknown ? (
          <div className="mb-8 space-y-3" data-testid="pending-attempts" data-checked={pendingChecked ? 'yes' : 'no'}>
            {identityUnknown && (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 text-start" role="status" data-testid="identity-unknown">
                <p className="font-black text-slate-900">{tr('تعذّر التحقق من حسابك الآن', 'We could not confirm your account right now')}</p>
                <p className="text-sm font-bold text-slate-600 mt-1 leading-relaxed">
                  {tr('لن نعرض أو نستعيد بيانات أي طلب سابق قبل التأكد من الحساب. تحقق من الاتصال ثم أعد المحاولة.', 'We will not show or restore any earlier order before your account is confirmed. Check your connection and try again.')}
                </p>
                <button type="button" onClick={() => setIdentityCheck((n) => n + 1)} data-testid="identity-retry" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white">
                  {tr('إعادة التحقق', 'Check again')}
                </button>
              </div>
            )}
            {pendingAttempts.map((p) =>
              p.state === 'recovered' ? (
                <div key={p.orderId} className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-start" role="status" data-testid="pending-attempt" data-status="recovered" data-order-id={p.orderId}>
                  <p className="font-black text-emerald-800">{tr('تم تسجيل طلبك السابق بنجاح', 'Your earlier order was saved')}</p>
                  <p className="text-sm font-bold text-emerald-700 mt-1 leading-relaxed">
                    {tr('رقم الطلب', 'Order number')} <span dir="ltr" className="font-black">#{p.orderId}</span>.{' '}
                    {tr('لا حاجة لإرساله مرة أخرى.', 'There is no need to send it again.')}{' '}
                    <ReactRouterDOM.Link to={`/order-success/${p.orderId}`} className="underline">{tr('عرض الطلب', 'View the order')}</ReactRouterDOM.Link>
                  </p>
                </div>
              ) : (
                <div key={p.orderId} className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-start" role="alert" data-testid="pending-attempt" data-status={p.state} data-order-id={p.orderId}>
                  <p className="font-black text-amber-900">{tr('لديك طلب سابق لم نتمكن من تأكيده بعد', 'You have an earlier order we could not confirm yet')}</p>
                  <p className="text-sm font-bold text-amber-800 mt-1 leading-relaxed">
                    {tr('رقم الطلب', 'Order number')} <span dir="ltr" className="font-black">#{p.orderId}</span>.{' '}
                    {p.state === 'exists_unverified'
                      ? tr('يوجد طلب مسجّل بهذا الرقم لكن لا يمكن التحقق من تفاصيله من هذا الجهاز.', 'An order with this number exists, but this device cannot verify its details.')
                      : tr('لم يصلنا بعد ما يؤكد حفظه، وقد يكون ما زال قيد المعالجة.', 'We have no confirmation yet; it may still be processing.')}{' '}
                    {tr(
                      'لن نُنشئ طلبًا جديدًا قبل حسمه حتى لا يتكرر. إذا كانت سلتك وبياناتك كما هي فأكّد الطلب لإعادة المحاولة بنفس الرقم بأمان، وإلا تواصل مع المكتبة برقم الطلب.',
                      'We will not create a new order before it is settled, to avoid duplicates. If your cart and details are unchanged, confirm to retry safely with the same number; otherwise contact the shop with the order number.'
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {lastPayloadRef.current?.id === p.orderId && (
                      <button type="button" onClick={handleRetrySame} disabled={isProcessing} data-testid="pending-retry-same" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">
                        {tr('إعادة المحاولة بنفس الرقم', 'Retry with the same number')}
                      </button>
                    )}
                    <a href={whatsappUrl(STORE_WHATSAPP, p.orderId, { kind: 'unconfirmed' })} target="_blank" rel="noopener noreferrer" data-testid="pending-whatsapp" className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-black text-white">
                      {tr('تواصل مع المكتبة عبر واتساب', 'Contact the shop on WhatsApp')}
                    </a>
                  </div>
                </div>
              )
            )}
          </div>
  ) : null;

  if (!Array.isArray(validatedCart) || validatedCart.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <SEO title={tt('checkout', 'إتمام الطلب', 'Checkout')} noIndex={true} />
        {pendingBanner && <div className="w-full max-w-2xl">{pendingBanner}</div>}
        <div className="w-full max-w-md bg-white rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/40 p-10 text-center animate-in zoom-in-95 duration-500">
          <div className="mx-auto w-20 h-20 rounded-full bg-sky-50 flex items-center justify-center text-sky-500 mb-6 shadow-inner">
            <ShoppingBag size={32} strokeWidth={2.5} />
          </div>
          <h2 className="text-3xl font-heading font-black text-slate-900 mb-3">
            {tt('cartEmpty', 'سلتك فارغة', 'Your cart is empty')}
          </h2>
          <Button onClick={() => navigate('/shop')} className="w-full py-4 text-lg mt-8">
            {tt('browseProducts', 'تصفح المنتجات', 'Browse products')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 lg:py-12 pb-32 lg:pb-12">
      <SEO title={tt('checkout', 'إتمام الطلب', 'Checkout')} noIndex={true} />

      <div className="container mx-auto px-4 lg:px-8 max-w-7xl">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-10">
          <div className="min-w-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h1 className="text-4xl font-heading font-black text-slate-900 flex items-center gap-3">
              {tt('checkout', 'إتمام الدفع', 'Secure Checkout')}
            </h1>
            <p className="text-slate-500 font-medium mt-2">
              {tt('checkoutHint', 'نضمن لك تجربة تسوق آمنة وسريعة', 'Simple, fast, and secure checkout process.')}
            </p>
          </div>
        </div>

        {pendingBanner}

        <div className="flex flex-col lg:flex-row gap-8 xl:gap-12">
          {/* Form Steps Container */}
          <div className="flex-1 space-y-6 lg:max-w-3xl">
            
            {/* Step Indicator */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4 sm:p-6 sticky top-20 z-20">
              <div className="flex items-center justify-between gap-2">
                {[1, 2, 3].map((i) => {
                  const active = step === i;
                  const done = step > i;
                  const title = i === 1 ? tt('address', 'عنوان الاستلام', 'Shipping Address') : i === 2 ? tt('shipping', 'خيارات التوصيل', 'Delivery Method') : tt('payment', 'طريقة الدفع', 'Payment Method');
                  const hint = i === 1 ? tt('stepAddressHint', 'بيانات الوجهة', 'Delivery details') : i === 2 ? tt('stepShippingHint', 'تأكيد التسعيرة', 'Confirm shipping') : tt('stepPaymentHint', 'تأكيد الطلب', 'Confirm order');

                  return (
                    <div key={i} className={`flex-1 flex flex-col sm:flex-row items-center sm:items-start gap-3 text-center sm:text-start transition-opacity duration-300 ${!active && !done ? 'opacity-50' : 'opacity-100'}`}>
                      <div className={['w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0 transition-all duration-500', active ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30 scale-110' : done ? 'bg-black text-white shadow-md' : 'bg-slate-100 text-slate-400'].join(' ')}>
                        {done ? <CheckCircle size={20} strokeWidth={3} /> : i}
                      </div>
                      <div className="min-w-0 hidden sm:block mt-1">
                        <p className={`text-sm font-black ${done || active ? 'text-slate-900' : 'text-slate-500'}`}>{title}</p>
                        <p className="text-[11px] font-bold text-slate-400 line-clamp-1 mt-0.5">{hint}</p>
                      </div>
                      {i < 3 && <div className="hidden sm:block h-[3px] rounded-full bg-slate-100 flex-1 mx-4 mt-4" ><div className={`h-full bg-black rounded-full transition-all duration-700 ${done ? 'w-full' : 'w-0'}`} /></div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* STEP 1: Address */}
            {step === 1 && (
              <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-8 pb-4 border-b border-slate-100">
                  <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3">
                    <MapPin className="text-sky-500" size={28} strokeWidth={2.5} />
                    {tt('deliveryAddress', 'معلومات الاستلام', 'Shipping Information')}
                  </h2>
                  <div className="text-xs font-bold text-sky-600 bg-sky-50 px-3 py-1.5 rounded-lg border border-sky-100">
                    متاح داخل الأردن فقط 🇯🇴
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('emailAddress', 'البريد الإلكتروني', 'Email Address')}
                      {!isLoggedIn && <span className="text-red-500">*</span>}
                    </label>

                    <div className="relative">
                      <Mail size={18} className="absolute left-4 rtl:left-auto rtl:right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={email}
                        onChange={(e) => setEmailField(e.target.value)}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder={isLoggedIn ? 'name@example.com (اختياري)' : 'name@example.com'}
                        className={inputClass(!!errors.email) + ' pl-12 pr-4 rtl:pl-4 rtl:pr-12'}
                        dir="ltr"
                      />
                    </div>

                    <p className="mt-1.5 ms-1 text-[11px] font-bold text-slate-400">
                      {isLoggedIn
                        ? 'إذا تركته فارغًا سيتم استخدام بريد الحساب المسجل.'
                        : 'مطلوب لإرسال تأكيد الطلب ومتابعة الحالة.'}
                    </p>

                    {errors.email && (
                      <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.email}</p>
                    )}
                  </div>
                  
                  <div className="md:col-span-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('fullName', 'الاسم الكامل', 'Full Name')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      name="fullName"
                      value={formData.fullName}
                      onChange={(e) => setField('fullName', e.target.value)}
                      maxLength={ORDER_LIMITS.nameMax}
                      type="text"
                      placeholder="الاسم الأول والأخير"
                      className={inputClass(!!errors.fullName)}
                    />
                    {errors.fullName && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.fullName}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('phone', 'رقم الجوال', 'Mobile Number')} <span className="text-red-500">*</span>
                    </label>
                    <div className={inputClass(!!errors.phoneLocal) + ' flex items-center gap-2 p-1.5'}>
                      <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white border border-slate-200 shadow-sm shrink-0">
                        <Phone size={16} className="text-slate-400 hidden sm:block" />
                        <span className="text-sm font-black text-slate-700" dir="ltr">+962</span>
                      </div>
                      <input
                        value={formData.phoneLocal}
                        onChange={(e) => setField('phoneLocal', e.target.value)}
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="0791234567"
                        className="flex-1 min-w-0 bg-transparent border-none outline-none px-3 font-bold text-lg tabular-nums placeholder:text-slate-300"
                        dir="ltr"
                      />
                    </div>
                    {errors.phoneLocal && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.phoneLocal}</p>}
                    {/* no SMS verification (zero budget): the number is only checked for format, never called "verified" */}
                    <p className="mt-1.5 ms-1 text-[11px] font-medium text-slate-400" data-testid="phone-note">{tr('يُستخدم للتواصل والتوصيل فقط. لا نرسل رسائل تحقق.', 'Used for contact and delivery only. We do not send verification texts.')}</p>
                  </div>

                  {/* اختيار المحافظة */}
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      المحافظة <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.citySlug}
                      onChange={(e) => {
                        setField('citySlug', e.target.value);
                        setField('ammanAreaId', ''); // مسح المنطقة إذا غير المحافظة
                        setAreaSearchQuery('');
                      }}
                      className={inputClass(!!errors.citySlug) + ' appearance-none cursor-pointer'}
                    >
                      <option value="" disabled>— اختر المحافظة —</option>
                      {REGIONS.map((region, idx) => (
                        <optgroup key={idx} label={isAR ? region.labelAr : region.labelEn} className="font-black text-slate-900 bg-slate-50">
                          {region.govs.map((gov) => (
                            <option key={gov.slug} value={gov.slug} className="font-bold text-slate-700 bg-white">
                              {isAR ? gov.ar : gov.en}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {errors.citySlug && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.citySlug}</p>}
                  </div>

                  {/* 🚀 نظام البحث الذكي لمناطق عمان */}
                  {formData.citySlug === 'amman' && (
                    <div className="md:col-span-2 animate-in fade-in slide-in-from-top-4 duration-300 relative">
                      <label className="block text-xs font-black uppercase tracking-widest text-sky-600 mb-2 ms-1">
                        تحديد المنطقة (أو القريبة منها إذا لم تكن منطقتك موجودة) <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={formData.ammanAreaId ? (AMMAN_AREAS.find(a => a.id === formData.ammanAreaId)?.nameAr || areaSearchQuery) : areaSearchQuery}
                          onChange={(e) => {
                            setAreaSearchQuery(e.target.value);
                            setField('ammanAreaId', ''); 
                            setIsAreaDropdownOpen(true);
                          }}
                          onFocus={() => setIsAreaDropdownOpen(true)}
                          onBlur={() => setTimeout(() => setIsAreaDropdownOpen(false), 200)}
                          placeholder="اكتب اسم منطقتك للبحث السريع..."
                          className={inputClass(!!errors.ammanAreaId) + ' w-full pr-12 rtl:pr-12 rtl:pl-4 bg-sky-50/30 border-sky-200'}
                        />
                        <Search size={20} className="absolute left-4 rtl:left-auto rtl:right-4 top-1/2 -translate-y-1/2 text-sky-400 pointer-events-none" />
                      </div>
                      
                      {isAreaDropdownOpen && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 shadow-2xl rounded-2xl max-h-60 overflow-y-auto z-50 p-2 animate-in fade-in zoom-in-95 duration-200">
                          {filteredAreas.length > 0 ? (
                            filteredAreas.map(area => (
                              <div
                                key={area.id}
                                className={`p-3 cursor-pointer rounded-xl transition-colors flex justify-between items-center ${area.id === 'other' ? 'bg-orange-50 hover:bg-orange-100 border border-orange-100 mt-2' : 'hover:bg-sky-50'}`}
                                onMouseDown={(e) => {
                                  e.preventDefault(); 
                                  setField('ammanAreaId', area.id);
                                  setAreaSearchQuery(area.nameAr);
                                  setIsAreaDropdownOpen(false);
                                }}
                              >
                                <span className={`font-bold ${area.id === 'other' ? 'text-orange-700' : 'text-slate-800'}`}>
                                  {area.nameAr}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="p-4 text-center text-slate-500 font-bold text-sm">
                              لا توجد منطقة مطابقة. يرجى اختيار "منطقة أخرى"
                            </div>
                          )}
                        </div>
                      )}
                      {errors.ammanAreaId && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.ammanAreaId}</p>}
                    </div>
                  )}

                  {/* 🚀 العنوان التفصيلي (اختياري) */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('detailedAddress', 'العنوان التفصيلي', 'Detailed Address')} <span className="text-slate-400 normal-case">(اختياري)</span>
                    </label>
                    <input
                      name="streetAddress"
                      value={formData.streetAddress}
                      onChange={(e) => setField('streetAddress', e.target.value)}
                      maxLength={ORDER_LIMITS.streetMax}
                      type="text"
                      placeholder="اسم الشارع - رقم البناية - الشقة (اختياري)"
                      className={inputClass(!!errors.streetAddress)}
                    />
                    {errors.streetAddress && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.streetAddress}</p>}
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100 flex justify-end">
                  <Button onClick={goToShipping} disabled={isProcessing} className="w-full sm:w-auto px-10 py-4 text-lg">
                    {tt('continueToShipping', 'متابعة لاختيار التوصيل', 'Continue to delivery options')}
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 2: Shipping Confirmation */}
            {step === 2 && (
              <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right-4 duration-500">
                <h2 className="text-2xl font-black text-slate-900 mb-8 pb-4 border-b border-slate-100 flex items-center gap-3">
                  <Truck className="text-sky-500" size={28} strokeWidth={2.5} />
                  تأكيد تسعيرة وسرعة التوصيل
                </h2>

                <div className="space-y-4">
                  {dynamicShippingMethods.map((method) => {
                    const active = shippingMethodId === method.id;
                    const Icon = method.icon;

                    return (
                      <label 
                        key={method.id} 
                        className={`flex items-center justify-between p-5 rounded-2xl border-2 cursor-pointer transition-all duration-300 ${active ? 'border-sky-500 bg-sky-50 shadow-md shadow-sky-500/10' : 'border-slate-200 hover:border-sky-300 hover:bg-slate-50'}`}
                      >
                        <div className="flex items-center gap-4">
                          <input 
                            type="radio" 
                            name="shippingMethod" 
                            value={method.id} 
                            checked={active} 
                            onChange={() => setShippingMethodId(method.id)} 
                            className="w-5 h-5 accent-sky-500" 
                          />
                          <div className="min-w-0">
                            <p className={`font-black flex items-center gap-2 ${active ? 'text-sky-700' : 'text-slate-800'}`}>
                              <Icon size={18} strokeWidth={2.5} className={active ? 'text-sky-500' : 'text-slate-400'} />
                              {isAR ? method.nameAr : method.nameEn}
                            </p>
                            <p className={`text-xs font-bold mt-1.5 ${active ? 'text-sky-600/80' : 'text-slate-500'}`}>
                              {isAR ? method.durationAr : method.durationEn}
                            </p>
                          </div>
                        </div>
                        <span className={`font-black text-lg tabular-nums shrink-0 ml-4 rtl:ml-0 rtl:mr-4 ${active ? 'text-sky-700' : 'text-slate-700'}`}>
                          {formatMoney(Number(method.price || 0))}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-between gap-4">
                  <Button variant="outline" onClick={() => changeStep(1)} disabled={isProcessing} className="w-full sm:w-auto px-8 py-4">
                    {tt('back', 'تعديل العنوان', 'Edit Address')}
                  </Button>
                  <Button onClick={() => changeStep(3)} disabled={isProcessing} className="w-full sm:w-auto px-10 py-4 text-lg shadow-xl shadow-sky-500/20">
                    {tt('continueToPayment', 'متابعة للدفع', 'Proceed to Payment')}
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 3: Payment */}
            {step === 3 && (
              <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right-4 duration-500">
                <h2 className="text-2xl font-black text-slate-900 mb-8 pb-4 border-b border-slate-100 flex items-center gap-3">
                  <Shield className="text-emerald-500" size={28} strokeWidth={2.5} />
                  {tt('paymentMethod', 'طريقة الدفع', 'Payment Method')}
                </h2>

                <div className="flex flex-col sm:flex-row gap-4 mb-8">
                  <button
                    onClick={() => setPaymentMethod('cliq')}
                    type="button"
                    className={['flex-1 py-5 px-4 rounded-2xl border-2 font-black transition-all duration-300 relative overflow-hidden', paymentMethod === 'cliq' ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-md shadow-indigo-500/10' : 'border-slate-100 text-slate-500 hover:bg-slate-50 hover:border-slate-300'].join(' ')}
                  >
                    {paymentMethod === 'cliq' && <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-indigo-200 to-transparent opacity-50 rounded-bl-full pointer-events-none" />}
                    <div className="flex flex-col items-center justify-center gap-2 relative z-10">
                      <Smartphone size={28} strokeWidth={2} className={paymentMethod === 'cliq' ? 'text-indigo-500' : 'text-slate-400'} /> 
                      <span className="text-lg">CliQ</span>
                    </div>
                  </button>

                  <button
                    onClick={() => setPaymentMethod('cod')}
                    type="button"
                    className={['flex-1 py-5 px-4 rounded-2xl border-2 font-black transition-all duration-300 relative overflow-hidden', paymentMethod === 'cod' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-md shadow-emerald-500/10' : 'border-slate-100 text-slate-500 hover:bg-slate-50 hover:border-slate-300'].join(' ')}
                  >
                    {paymentMethod === 'cod' && <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-emerald-200 to-transparent opacity-50 rounded-bl-full pointer-events-none" />}
                    <div className="flex flex-col items-center justify-center gap-2 relative z-10">
                      <DollarSign size={28} strokeWidth={2} className={paymentMethod === 'cod' ? 'text-emerald-500' : 'text-slate-400'} />
                      <span className="text-lg">{tt('cod', 'الدفع عند الاستلام', 'Cash on Delivery')}</span>
                    </div>
                  </button>
                </div>

                {paymentMethod === 'cliq' && (
                  <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 rounded-3xl p-6 text-center shadow-inner">
                      <p className="text-sm text-indigo-800 mb-4 font-bold">
                        حوّل المبلغ عبر CliQ إلى:
                      </p>

                      <div className="flex flex-col gap-3 max-w-sm mx-auto mb-6" data-testid="cliq-details">
                        <div className="bg-white px-5 py-4 rounded-xl shadow-sm border border-indigo-50 flex justify-between items-center gap-3">
                          <span className="text-slate-400 text-sm font-bold shrink-0">اسم المستفيد:</span>
                          <span dir="ltr" className="font-black text-indigo-900 text-[14px] leading-tight text-end" data-testid="cliq-beneficiary">
                            {CLIQ.beneficiary}
                          </span>
                        </div>

                        <button
                          type="button"
                          data-testid="cliq-copy"
                          onClick={async () => {
                            const ok = await copyText(CLIQ.alias);
                            showToast(ok ? 'تم نسخ رقم CliQ' : `تعذّر النسخ — انسخ الرقم يدويًا: ${CLIQ.alias}`, ok ? 'success' : 'error');
                          }}
                          className="w-full bg-white px-5 py-4 rounded-xl shadow-sm border border-indigo-200 flex justify-between items-center cursor-pointer hover:bg-indigo-50/80 transition-all group"
                          aria-label={`نسخ رقم CliQ ${CLIQ.alias}`}
                        >
                          <span className="text-slate-400 text-sm font-bold flex items-center gap-2">
                            <Copy size={14} className="group-hover:text-indigo-500 transition-colors" />
                            رقم CliQ (Alias):
                          </span>
                          <span dir="ltr" className="font-black text-xl text-indigo-600 tracking-widest tabular-nums" data-testid="cliq-alias">{CLIQ.alias}</span>
                        </button>

                        <div className="bg-white px-5 py-4 rounded-xl shadow-sm border border-indigo-50 flex justify-between items-center">
                          <span className="text-slate-400 text-sm font-bold">المحفظة:</span>
                          <span className="font-black text-indigo-900 text-sm" data-testid="cliq-wallet">{CLIQ.walletAr} ({CLIQ.walletEn})</span>
                        </div>
                      </div>

                      <div className="bg-indigo-900 text-white rounded-2xl py-5 flex flex-col items-center justify-center shadow-md">
                        <span className="text-indigo-200 text-sm mb-1 font-bold">المبلغ الإجمالي المطلوب تحويله:</span>
                        <span className="text-3xl font-black tabular-nums">{formatMoney(total)}</span>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 text-center">
                      <label className="block text-sm font-black text-slate-800 mb-3 text-start">
                        {tt('referenceOrReceipt', 'الرقم المرجعي للعملية (Reference Number)', 'Transaction Reference Number')} <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="رقم مكون من أرقام أو أحرف (e.g. 1234567890)"
                        value={cliqRef}
                        onChange={(e) => setCliqRef(e.target.value)}
                        maxLength={ORDER_LIMITS.cliqRefMax}
                        className={inputClass(false) + ' bg-white mb-5 text-center tracking-wider text-xl font-black'}
                      />

                      <div className="bg-[#25D366]/10 border border-[#25D366]/20 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4 text-start">
                        <div className="w-12 h-12 shrink-0 bg-[#25D366]/20 text-[#25D366] rounded-full flex items-center justify-center">
                           <MessageCircle size={24} strokeWidth={2.5} />
                        </div>
                        <p className="text-sm font-bold text-slate-700 leading-relaxed" data-testid="cliq-instructions">
                          بعد <span className="text-[#25D366] font-black">تأكيد الطلب</span> سيظهر لك زر لإرسال صورة الإيصال عبر الواتساب مع رقم الطلب.
                          <span className="block mt-1.5 text-slate-500 font-semibold">يبقى الطلب «بانتظار تأكيد الدفع» حتى نتحقق من وصول المبلغ إلى المحفظة؛ رقم المرجع وصورة الإيصال لا يكفيان وحدهما.</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {paymentMethod === 'cod' && (
                  <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-8 text-center animate-in fade-in duration-300">
                    <div className="w-20 h-20 bg-white shadow-sm text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-5">
                      <DollarSign size={40} strokeWidth={2.5} />
                    </div>
                    <h3 className="text-xl font-black text-emerald-900 mb-2">
                      {tt('payOnDelivery', 'الدفع الآمن عند الاستلام', 'Secure Pay on Delivery')}
                    </h3>
                    <p className="text-emerald-700/80 font-bold mb-5 max-w-sm mx-auto">
                      لن يتم خصم أي مبلغ إلكترونياً. يرجى تجهيز المبلغ المطلوب نقداً لمندوب التوصيل.
                    </p>
                    <div className="bg-white rounded-2xl py-4 px-6 inline-block shadow-sm border border-emerald-50">
                      <span className="text-sm font-bold text-slate-500 uppercase tracking-widest block mb-1">المبلغ المطلوب دفعه</span>
                      <span className="text-3xl font-black text-emerald-600 tabular-nums">{formatMoney(total)}</span>
                    </div>
                  </div>
                )}

                {/* Worker price preview: differences between the page and what the order system will compute */}
                {pricePreview && pricePreview.diffs.length > 0 && (
                  <div className="mt-8 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-start" role="status">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={22} />
                      <div className="min-w-0 flex-1">
                        <p className="font-black text-amber-900">
                          {tr('تنبيه: يوجد اختلاف في الأسعار', 'Notice: prices differ')}
                        </p>
                        <p className="mt-1 text-sm font-bold text-amber-800/90">
                          {pricePreview.diffs.includes('incomplete')
                            ? tr('تعذّر التحقق من سعر بعض المنتجات حاليًا. سيُراجع المتجر السعر النهائي.', 'Some prices could not be checked right now. The shop will review the final price.')
                            : tr('المجموع المعروض يختلف عن المجموع الذي سيحسبه نظام الطلبات حسب الأسعار الحالية. سيُعتمد السعر الحالي عند مراجعة الطلب.', 'The total shown differs from what the order system computes from current prices. The current price applies when the order is reviewed.')}
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold">
                          <span className="text-slate-600">{tr('المعروض في الصفحة', 'Shown on the page')}</span>
                          <span className="tabular-nums text-end text-slate-900">{formatMoney(total)}</span>
                          <span className="text-slate-600">{tr('حسب نظام الطلبات', 'Order system')}</span>
                          <span className="tabular-nums text-end text-amber-900">{formatMoney(pricePreview.server.total)}</span>
                        </div>
                        {pricePreview.lines.some((l) => l.serverUnitPrice !== null && l.clientUnitPrice !== null && Math.abs(l.serverUnitPrice - l.clientUnitPrice) > 0.009) && (
                          <ul className="mt-2 space-y-1 text-xs font-bold text-amber-900/80">
                            {pricePreview.lines
                              .filter((l) => l.serverUnitPrice !== null && l.clientUnitPrice !== null && Math.abs(l.serverUnitPrice - (l.clientUnitPrice as number)) > 0.009)
                              .map((l) => (
                                <li key={l.index}>
                                  {getProductTitle(validatedCart[l.index] || {})}: {formatMoney(l.clientUnitPrice as number)} ← {formatMoney(l.serverUnitPrice as number)}
                                </li>
                              ))}
                          </ul>
                        )}
                        {typeof refreshProducts === 'function' && (
                          <button type="button" onClick={() => refreshProducts()} className="mt-3 inline-flex items-center gap-2 text-xs font-black text-amber-900 underline">
                            <RefreshCw size={14} /> {tr('تحديث الأسعار', 'Refresh prices')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Cloudflare Turnstile (only when a site key is configured) */}
                {turnstile.enabled && (
                  <div className="mt-8" data-testid="turnstile">
                    <div ref={turnstile.containerRef} />
                    {turnstile.status === 'error' && (
                      <p className="mt-2 text-xs font-bold text-red-600" role="alert">
                        {tr('تعذّر تحميل التحقق الأمني. تحقّق من الاتصال ثم حدّث الصفحة. لن يُرسل الطلب بدونه.', 'The security check could not load. Check your connection and refresh the page. The order cannot be sent without it.')}
                      </p>
                    )}
                  </div>
                )}

                {/* Refused locally (input limits): nothing was sent, cart and any pending attempt are untouched */}
                {submitBlocked && (
                  <div className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-5 text-start text-sm font-bold text-red-700 leading-relaxed" role="alert" data-testid="submit-blocked" data-google={googleIssue || ''}>
                    {submitBlocked}
                    {googleIssue === 'blocked' && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={handlePlaceOrder} className="rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-black text-white" data-testid="google-retry">
                          {tr('تسجيل الدخول بـ Google', 'Sign in with Google')}
                        </button>
                        <button
                          type="button" data-testid="google-redirect"
                          className="rounded-xl border border-current px-4 py-2.5 text-sm font-black"
                          onClick={() => {
                            // the page is left: keep what the customer typed (this tab, 30 min, read once on return)
                            saveCheckoutResume({ formData, email, dialCode, shippingMethodId, paymentMethod, cliqRef, acceptDeliveryPolicy });
                            void googleRedirect().then((o) => { if (o !== 'ok') { setGoogleIssue(o); setSubmitBlocked(googleMessage(o, isAR)); } });
                          }}
                        >
                          {tr('المتابعة عبر صفحة Google', 'Continue on the Google page')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {resumeNotice && !submitBlocked && (
                  <div className="mt-8 rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800" role="status" data-testid="google-resumed">{resumeNotice}</div>
                )}
                {GOOGLE_GATE && !googleReady && (
                  <p className="mt-6 text-xs font-bold text-ink-600" data-testid="google-required-hint">
                    {tr('عند الضغط على «تأكيد الطلب» ستظهر نافذة Google لاختيار حسابك، ثم التحقق الأمني، ثم تضغط «تأكيد الطلب النهائي» فيُرسل الطلب مرة واحدة. هذا تسجيل دخول وليس دفعًا.', 'When you press "Confirm order", a Google window opens to choose your account, then the security check, then you press "Final confirmation" and the order is sent once. This is a sign-in, not a payment.')}
                  </p>
                )}

                {/* Submission result (anything but a confirmed order) */}
                {submitResult && (() => {
                  const m = messageFor(submitResult);
                  if (!m) return null;
                  const orderId = 'orderId' in submitResult ? submitResult.orderId : '';
                  const waKind = submitResult.status === 'conflict' ? 'conflict' : 'unconfirmed';
                  const tone = m.tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900';
                  return (
                    <div ref={resultPanelRef} className={`mt-8 rounded-3xl border p-5 text-start ${tone}`} role="alert" data-testid="submit-result" data-status={submitResult.status}>
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="shrink-0 mt-0.5" size={22} />
                        <div className="min-w-0 flex-1">
                          <p className="font-black">{tr(m.titleAr, m.titleEn)}</p>
                          <p className="mt-1 text-sm font-bold opacity-90">{tr(m.bodyAr, m.bodyEn)}</p>
                          {m.showOrderId && orderId && (
                            <p className="mt-3 text-sm font-bold">
                              {tr('رقم الطلب:', 'Order number:')}{' '}
                              <span className="font-black tracking-wider" dir="ltr" data-testid="submit-order-id">#{orderId}</span>
                            </p>
                          )}
                          <div className="mt-4 flex flex-wrap gap-2">
                            {(m.actions.includes('retry_same') || m.actions.includes('wait_retry') || m.actions.includes('check_connection')) && (
                              <button type="button" onClick={handleRetrySame} disabled={isProcessing} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">
                                <RefreshCw size={16} /> {tr('إعادة المحاولة بنفس رقم الطلب', 'Retry with the same order number')}
                              </button>
                            )}
                            {m.actions.includes('whatsapp') && orderId && (
                              <a href={whatsappUrl(STORE_WHATSAPP, orderId, { kind: waKind })} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-black text-white">
                                <MessageCircle size={16} /> {tr('تواصل مع المكتبة عبر واتساب', 'Contact the shop on WhatsApp')}
                              </a>
                            )}
                            {m.actions.includes('whatsapp') && !orderId && (
                              <a href={whatsappNewOrderUrl(STORE_WHATSAPP, (cart || []).map((it: any) => ({ title: getProductTitle(it), quantity: it.quantity })))} target="_blank" rel="noopener noreferrer" data-testid="order-whatsapp" className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-black text-white">
                                <MessageCircle size={16} /> {tr('اطلب عبر واتساب', 'Order on WhatsApp')}
                              </a>
                            )}
                            {m.actions.includes('check_identity') && (
                              <button type="button" onClick={handlePlaceOrder} disabled={isProcessing} data-testid="identity-submit-retry" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">
                                <RefreshCw size={16} /> {tr('إعادة المحاولة', 'Try again')}
                              </button>
                            )}
                            {m.actions.includes('fix_form') && (
                              <button type="button" onClick={() => changeStep(1)} className="inline-flex items-center gap-2 rounded-xl border border-current px-4 py-2.5 text-sm font-black">
                                {tr('مراجعة البيانات', 'Review details')}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-between items-center gap-4">
                  <button onClick={() => changeStep(2)} disabled={isProcessing} className="text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors w-full sm:w-auto py-3">
                    {tt('backToShipping', 'الرجوع لخيارات التوصيل', 'Back to Delivery')}
                  </button>
                  <Button
                    onClick={handlePlaceOrder}
                    className="w-full sm:w-auto px-12 py-5 text-lg shadow-xl shadow-sky-500/20"
                    isLoading={isProcessing || googleBusy}
                    disabled={isProcessing || googleBusy}
                    data-testid="checkout-confirm"
                    data-stage={GOOGLE_GATE ? (googleReady ? 'final' : 'sign-in') : 'single'}
                  >
                    {confirmLabel}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Order Summary Sidebar */}
          <div className="lg:w-[400px] shrink-0">
            <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/40 border border-slate-100 lg:sticky lg:top-24">
              <h3 className="font-heading font-black text-2xl mb-6 text-slate-900">
                {tt('orderSummary', 'ملخص الفاتورة', 'Order Summary')}
              </h3>

              <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2 rtl:pr-0 rtl:pl-2 custom-scrollbar mb-6">
                {validatedCart.map((item: any, idx: number) => {
                  const variant = item.selectedVariant;
                  return (
                    <div key={`${item.id}-${idx}`} className="flex gap-4 group">
                      <div className="relative">
                        <LazyImage
                          src={variant?.image || item.image}
                          alt={item.name}
                          className="w-16 h-16 rounded-2xl object-cover border border-slate-100 group-hover:border-sky-200 transition-colors"
                          containerClassName="w-16 h-16 shrink-0"
                        />
                        <span className="absolute -top-2 -right-2 rtl:-left-2 rtl:right-auto bg-slate-900 text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shadow-sm">
                          {clampQty(item.quantity)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0 pt-1">
                        <p className="text-sm font-black text-slate-800 line-clamp-1 leading-snug group-hover:text-sky-600 transition-colors">
                          {getProductTitle(item)}
                        </p>
                        {variant && (
                          <div className="mt-1 flex items-center gap-1.5 w-fit">
                            {variant.type === 'color' && variant.colorCode && (
                              <span 
                                className="w-2.5 h-2.5 rounded-full border border-black/10 shadow-inner block shrink-0" 
                                style={{ 
                                  background: variant.colorCode2 
                                    ? `linear-gradient(135deg, ${variant.colorCode} 50%, ${variant.colorCode2} 50%)`
                                    : variant.colorCode 
                                }}
                              />
                            )}
                            {variant.label && variant.label.trim() !== '.' && (
                              <span className="text-[10px] font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">{variant.label}</span>
                            )}
                          </div>
                        )}
                        <p className="font-black text-slate-500 tabular-nums mt-1 text-xs">
                          {formatMoney(Number(item.price || 0) * clampQty(item.quantity))}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {step === 1 && checkoutSuggestions.length > 0 && (
                <div className="mb-6 -mt-2">
                  <SuggestionRail products={checkoutSuggestions} title={tr('قد تحتاج أيضًا', 'You may also need')} compact testId="checkout-suggestions" />
                </div>
              )}

              {WHEEL_ENABLED && wheelNotice && (
                <p className="mb-4 rounded-2xl border border-ink-100 bg-paper-100 p-3 text-xs font-bold text-ink-800" role="status" data-testid="checkout-wheel-notice">🎡 {wheelNotice}</p>
              )}
              {WHEEL_ENABLED && wheelPrize && prizeFx && (
                <div className={`mb-4 rounded-2xl border p-3 text-sm ${prizeApplies ? 'border-gold-200 bg-gold-50' : 'border-ink-100 bg-paper-100'}`} data-testid="checkout-wheel-gift" data-state={prizeFx.state} data-prize-type={wheelPrize.type}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black text-ink-950">🎡 {tr('جائزة الدولاب', 'Wheel prize')}: {wheelPrize.label}</span>
                    <button type="button" className="text-xs font-bold text-ink-700 underline" onClick={() => { choosePrize(null); setWheelRemoved(true); }} data-testid="checkout-wheel-remove">
                      {tr('عدم استخدامها الآن', 'Not now')}
                    </button>
                  </div>
                  <p className="mt-1 text-xs font-bold text-ink-700">{prizeText(wheelPrize, isAR)}</p>
                  <p className="mt-1 text-xs font-bold" data-testid="checkout-wheel-status">
                    {prizeFx.state === 'applies' && (
                      <span className="text-emerald-700">{tr('تنطبق على هذا الطلب — بانتظار تأكيد الطلب، وتُثبَّت عند تسليمه.', 'Applies to this order — waiting for the order to be confirmed; final once delivered.')}</span>
                    )}
                    {prizeIsGuest && (
                      <span className="mt-1 block text-ink-700" data-testid="checkout-wheel-guest">{tr('نتيجة لفّتك قبل تسجيل الدخول: تُربط بحسابك عند تسجيل الدخول بـ Google في «تأكيد الطلب»، ثم تُطبَّق إذا حقق الطلب شروطها.', 'Your spin before signing in: linked to your account when you sign in with Google at "Confirm order", then applied if the order meets its conditions.')}</span>
                    )}
                    {prizeFx.state === 'below_min' && (
                      <span className="text-amber-800">
                        {wheelPrize.type === 'gift'
                          ? tr(`مبروك! ظهرت لك ${wheelPrize.label}، وتحتاج إلى إكمال مشترياتك حتى ${prizeFx.minOrderJod} دينارًا لاستحقاقها عند تأكيد الطلب (ينقصك ${formatMoney(prizeFx.missingJod)}).`, `You won ${wheelPrize.label}; complete your products to ${prizeFx.minOrderJod} JOD to receive it with the order (${formatMoney(prizeFx.missingJod)} to go).`)
                          : tr(`تحتاج إلى إكمال مشترياتك حتى ${prizeFx.minOrderJod} دينارًا لاستخدامها (ينقصك ${formatMoney(prizeFx.missingJod)}). يمكنك إتمام الطلب بدونها وتبقى الجائزة محفوظة حتى انتهاء صلاحيتها.`, `Complete your products to ${prizeFx.minOrderJod} JOD to use it (${formatMoney(prizeFx.missingJod)} to go). You can order without it; the prize stays until it expires.`)}
                      </span>
                    )}
                    {prizeFx.state === 'needs_previous_order' && (
                      <span className="text-ink-800" data-testid="checkout-wheel-second-note">{wheelState?.secondOrder === 'past'
                        ? tr('هذا الخصم لطلبك الثاني الفعلي فقط، ولديك طلب آخر غير ملغى، فلن يُطبَّق على هذا الطلب.', 'This discount is only for your actual second order, and you have another order that is not cancelled, so it does not apply here.')
                        : tr('هذا الخصم للطلب الثاني: يصبح متاحًا بعد استلام طلبك الأول، ولن يُطبَّق على هذا الطلب.', 'This discount is for your second order: available after your first order is delivered; it is not applied to this order.')}</span>
                    )}
                  </p>
                  {wheelPrize.expiresAt && (
                    <p className="mt-1.5 text-xs">
                      <PrizeCountdown expiresAt={wheelPrize.expiresAt} isAR={isAR} onExpire={onPrizeExpire} testId="checkout-wheel-countdown" urgentMs={isSecondOrder(wheelPrize) ? 12 * 3_600_000 : 5 * 60_000} />
                      <span className="block text-[11px] font-bold text-ink-600" data-testid="checkout-wheel-ends">{isSecondOrder(wheelPrize)
                        ? tr(`خصم الطلب الثاني صالح حتى ${fmtWhen(wheelPrize.expiresAt)} (${secondDays} أيام من تسليم طلبك الأول).`, `Second-order discount valid until ${fmtWhen(wheelPrize.expiresAt)} (${secondDays} days from your first delivery).`)
                        : tr(`صالحة ${holdMin} دقيقة من لحظة اللفة: أكّد الطلب قبل انتهائها لتبقى مرتبطة به.`, `Valid ${holdMin} minutes from the spin: confirm the order before it ends to keep it.`)}</span>
                    </p>
                  )}
                </div>
              )}
              {WHEEL_ENABLED && !wheelPrize && expiredPrize && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm" role="status" data-testid="checkout-wheel-expired" data-prize-id={expiredPrize.prizeId}>
                  <p className="font-black text-red-800">🎡 {tr(`انتهت صلاحية جائزة الدولاب: ${expiredPrize.label}`, `The wheel prize has expired: ${expiredPrize.label}`)}</p>
                  <p className="mt-1 text-xs font-bold leading-relaxed text-red-800">{isSecondOrder(expiredPrize)
                    ? tr(`انتهت مدة الأيام الخمسة بعد تسليم طلبك الأول دون استخدامها على طلبك الثاني، فلم تعد صالحة ولن تُطبَّق. يمكنك إتمام الطلب بدونها.`, `The ${secondDays} days after your first delivery passed without using it, so it no longer applies. You can still place the order without it.`)
                    : tr(`كانت صالحة ${holdMin} دقيقة من لحظة اللفة ولم تُستخدم في طلب مؤكَّد خلالها، فلم تعد صالحة للاستعمال ولن تُطبَّق. يمكنك إتمام الطلب بدونها.`, `It was valid for ${holdMin} minutes from the spin and was not used in a confirmed order in time, so it no longer applies. You can still place the order without it.`)}</p>
                </div>
              )}
              {WHEEL_ENABLED && !wheelPrize && !expiredPrize && waitingPrize && (
                <div className="mb-4 rounded-2xl border border-gold-200 bg-gold-50 p-3 text-sm" role="status" data-testid="checkout-wheel-waiting" data-prize-id={waitingPrize.prizeId}>
                  <p className="font-black text-ink-950">🎡 {tr(`محفوظ لك: ${waitingPrize.label}`, `Kept for you: ${waitingPrize.label}`)}</p>
                  <p className="mt-1 text-xs font-bold leading-relaxed text-ink-800">{tr('لا يُطبَّق على هذا الطلب. تابعه من «جوائزك» في صفحة الدولاب.', 'Not applied to this order. Follow it under "Your prizes" on the wheel page.')}</p>
                  <SecondOrderStatus spin={waitingPrize} accountState={wheelState?.secondOrder ?? null} isAR={isAR} onExpire={onPrizeExpire} days={secondDays} testId="checkout-second-status" />
                </div>
              )}

              <div className="bg-slate-50 rounded-3xl p-5 space-y-3">
                <div className="flex justify-between text-sm font-bold text-slate-500">
                  <span>{tt('subtotal', 'الإجمالي الفرعي', 'Subtotal')}</span>
                  <span className="tabular-nums text-slate-700">{formatMoney(subtotal)}</span>
                </div>

                {volumeDiscount > 0 && (
                  <div className="flex justify-between text-sm font-black text-emerald-600 bg-emerald-50/50 p-2 -mx-2 rounded-xl">
                    <span>{tt('discount', 'الخصم المكتسب', 'Earned Discount')}</span>
                    <span className="tabular-nums">-{formatMoney(volumeDiscount)}</span>
                  </div>
                )}
                {wheelDiscount > 0 && (
                  <div className="flex justify-between text-sm font-black text-emerald-700 bg-gold-50 p-2 -mx-2 rounded-xl" data-testid="summary-wheel-discount">
                    <span>{tr('خصم جائزة الدولاب', 'Wheel prize discount')}</span>
                    <span className="tabular-nums">-{formatMoney(wheelDiscount)}</span>
                  </div>
                )}

                <div className="flex justify-between text-sm font-bold text-slate-500">
                  <span>{tt('shipping', 'رسوم التوصيل', 'Shipping Fee')}</span>
                  <span className="tabular-nums text-slate-700" data-testid="summary-shipping">
                    {shippingWaived > 0 && <s className="me-2 text-slate-400">{formatMoney(baseShippingFee)}</s>}
                    {formatMoney(shippingCost)}
                  </span>
                </div>
                {shippingWaived > 0 && (
                  <p className="text-xs font-black text-emerald-700" data-testid="summary-free-delivery">{tr('توصيل مجاني من جائزة الدولاب', 'Free delivery from the wheel prize')}</p>
                )}

                <div className="border-t border-slate-200/60 pt-4 mt-2 flex justify-between items-end">
                  <span className="text-base font-black text-slate-900 uppercase tracking-widest">{tt('total', 'المجموع النهائي', 'Final Total')}</span>
                  <span className="text-3xl font-black text-sky-500 tabular-nums drop-shadow-sm leading-none">{formatMoney(total)}</span>
                </div>
              </div>

              <div className="mt-6">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ms-1">
                  {tt('orderNote', 'ملاحظات إضافية', 'Additional Notes')} <span className="normal-case">({tt('optional', 'اختياري', 'Optional')})</span>
                </label>
                <textarea
                  value={orderNote || ''}
                  onChange={(e) => setOrderNote(e.target.value)}
                  maxLength={ORDER_LIMITS.noteMax}
                  placeholder="تعليمات لمندوب التوصيل أو تفاصيل تغليف الهدية..."
                  className="w-full min-h-[80px] resize-none p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-400/10 text-sm font-bold placeholder:font-medium placeholder:text-slate-400 transition-all"
                />
              </div>

              <div className="mt-6 rounded-[2rem] border border-slate-100 bg-slate-50/70 p-4 sm:p-5">
                <div className="mb-4">
                  <h4 className="text-sm font-black text-slate-900">خيارات الطلب والموافقات</h4>
                  <p className="mt-1 text-xs font-bold text-slate-400">
                    إعدادات إضافية لتسريع الطلب وتجهيز بياناته بشكل أفضل
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:bg-slate-50 transition-all cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.saveInfo}
                      onChange={(e) => setField('saveInfo', e.target.checked)}
                      className="mt-1 h-5 w-5 shrink-0 accent-sky-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-slate-800">حفظ بياناتي لتسريع الدفع مستقبلاً</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">اختياري</span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-400">
                        يحفظ بيانات الاستلام لتعبئة أسرع في الطلبات القادمة
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:bg-slate-50 transition-all cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acceptDeliveryPolicy}
                      onChange={(e) => setAcceptDeliveryPolicy(e.target.checked)}
                      className="mt-1 h-5 w-5 shrink-0 accent-sky-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-slate-800">اطلعت على سياسة التوصيل</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">اختياري</span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-400">
                        يساعد في توضيح مواعيد وآلية التوصيل قبل تأكيد الطلب
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 rounded-2xl border p-4 transition-all cursor-pointer ${
                      errors.acceptPolicies
                        ? 'border-red-300 bg-red-50'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={acceptPolicies}
                      onChange={(e) => {
                        setAcceptPolicies(e.target.checked);
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.acceptPolicies;
                          return next;
                        });
                      }}
                      className="mt-1 h-5 w-5 shrink-0 accent-sky-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-slate-800">أوافق على سياسات المتجر وأحكام الخدمة</span>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-600">مطلوب</span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-400">
                        لا يمكن إتمام الطلب بدون الموافقة على سياسات المتجر
                      </p>
                    </div>
                  </label>
                </div>

                {errors.acceptPolicies && (
                  <p className="mt-3 ms-1 text-xs font-black text-red-500">{errors.acceptPolicies}</p>
                )}
              </div>
              <div className="mt-6 flex items-center justify-center gap-2 text-xs font-bold text-slate-400 bg-white border border-slate-100 py-3 rounded-2xl">
                <Shield size={16} className="text-emerald-500" />
                <span>{tt('secureCheckoutNote', 'بياناتك مشفرة ومحمية بالكامل 100%', 'Your data is 100% encrypted and secure')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sticky Checkout Button */}
      <div className="lg:hidden fixed bottom-0 left-0 w-full bg-white/90 backdrop-blur-md border-t border-slate-200 p-4 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] z-50 animate-in slide-in-from-bottom-full">
        <div className="flex items-center justify-between gap-4 max-w-md mx-auto">
          <div className="min-w-0 flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{tt('total', 'المطلوب للدفع', 'Total to pay')}</span>
            <span className="text-xl font-black text-slate-900 tabular-nums leading-none mt-0.5">{formatMoney(total)}</span>
          </div>

          <Button
            data-testid="checkout-sticky-action"
            onClick={() => {
              if (step === 1) goToShipping();
              else if (step === 2) changeStep(3);
              else handlePlaceOrder();
            }}
            className="flex-1 py-4 text-base shadow-xl shadow-sky-500/20"
            isLoading={isProcessing || googleBusy}
            disabled={isProcessing || googleBusy}
          >
            {step === 1
              ? tt('continueToShipping', 'متابعة للتوصيل', 'Continue to Delivery')
              : step === 2
              ? tt('continueToPayment', 'متابعة للدفع', 'Continue to Payment')
              : GOOGLE_GATE
              ? confirmLabel
              : tt('confirmOrder', 'تأكيد الطلب', 'Confirm Order')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Checkout;
