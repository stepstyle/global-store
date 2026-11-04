// Checkout flow on top of orderSubmit.ts — pure and injectable, so the React pages stay thin and every branch is
// unit- and integration-tested (tests/unit/checkoutFlow.test.mjs, workers/order-worker/test/local-e2e).
//
// Rules
// - The order Worker v2 is the ONLY writer of the order (no Firestore write from the browser, no localStorage order).
// - The cart is cleared ONLY on a Worker-verified confirmation.
// - An unresolved earlier attempt is never bypassed: its number is shown with a way to contact the shop.
// - Nothing is sent automatically; nothing personal is stored beyond what the page already keeps.

import {
  prepareAttempt, submitPrepared, checkOrderStatus, trackingKeyHash, normalizeTrackingKey, resolvePendingAttempts, recordFor, openAttempts, attemptKey, dropOpenUnsent, identityOf, ownerNoticesFor,
  type AttemptStore, type OrderPayload, type SubmitDeps, type SubmitOptions, type SubmitOutcome, type PendingRecovery,
} from './orderSubmit.ts';

// ------------------------------------------------------------------------------------------------ cross-tab lock
type LockManager = { request: <T>(name: string, cb: () => Promise<T>) => Promise<T> };
export const CHECKOUT_LOCK_NAME = 'anta-checkout-submit';
/** No cross-tab lock could be obtained: the order is NOT sent (never a silent unlocked send). */
export class CheckoutLockUnavailable extends Error {
  readonly why: 'busy' | 'unsupported';
  constructor(why: 'busy' | 'unsupported') {
    super(`checkout lock ${why}`);
    this.why = why;
  }
}

// IndexedDB fallback. Per the IndexedDB spec, readwrite transactions whose scopes overlap run one after the other for
// ALL connections of the origin (every tab), so "read the lock record and write it if free/expired" inside ONE readwrite
// transaction is an atomic compare-and-set across tabs — unlike localStorage. A lease (renewed while held) frees the
// lock if a tab dies holding it.
type IdbFactory = { open(name: string, version?: number): any };
const IDB_NAME = 'anta-checkout-lock';
const IDB_STORE = 'lock';
const IDB_KEY = 'submit';
export const IDB_LEASE_MS = 120_000; // > the longest possible send (≈ 80 s: 3 × 12 s timeouts + backoffs + status checks + verify)
export const IDB_WAIT_MS = 150_000; // give up waiting for another tab after this (the customer gets a clear message)

function idbOpen(idb: IdbFactory): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = idb.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}
/** ONE readwrite transaction: take the lock if free/expired (or already ours: renew). Resolves after the commit. */
function idbTryTake(db: any, owner: string, now: number, leaseMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const st = tx.objectStore(IDB_STORE);
    let taken = false;
    const g = st.get(IDB_KEY);
    g.onsuccess = () => {
      const cur = g.result as { owner: string; until: number } | undefined;
      if (!cur || cur.until <= now || cur.owner === owner) {
        st.put({ owner, until: now + leaseMs }, IDB_KEY);
        taken = true;
      }
    };
    tx.oncomplete = () => resolve(taken);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}
function idbRelease(db: any, owner: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const st = tx.objectStore(IDB_STORE);
      const g = st.get(IDB_KEY);
      g.onsuccess = () => {
        if ((g.result as { owner?: string } | undefined)?.owner === owner) st.delete(IDB_KEY);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
/** Extend the lease only if it is still OURS and still valid (never re-acquire). Resolves false = lost. */
function idbRenew(db: any, owner: string, now: number, leaseMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const st = tx.objectStore(IDB_STORE);
    let kept = false;
    const g = st.get(IDB_KEY);
    g.onsuccess = () => {
      const cur = g.result as { owner: string; until: number } | undefined;
      if (cur && cur.owner === owner && cur.until > now) {
        st.put({ owner, until: now + leaseMs }, IDB_KEY);
        kept = true;
      }
    };
    tx.oncomplete = () => resolve(kept);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}
/** Is the lease still ours, with at least marginMs left (enough to start the send)? Read-only. */
function idbHeld(db: any, owner: string, now: number, marginMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const g = tx.objectStore(IDB_STORE).get(IDB_KEY);
    let held = false;
    g.onsuccess = () => {
      const cur = g.result as { owner: string; until: number } | undefined;
      held = !!cur && cur.owner === owner && cur.until > now + marginMs;
    };
    tx.oncomplete = () => resolve(held);
    tx.onerror = () => reject(tx.error);
  });
}
/** Before sending, at least this much of the lease must remain (covers the moment the request starts). */
export const OWNERSHIP_MARGIN_MS = 15_000;

/** fn receives stillOwned(): false once the lock was lost (e.g. this tab was frozen past its lease). */
export type StillOwned = () => Promise<boolean>;
export async function withIdbLock<T>(fn: (stillOwned: StillOwned) => Promise<T>, idb: IdbFactory, o: { leaseMs?: number; waitMs?: number; pollMs?: number; marginMs?: number; now?: () => number } = {}): Promise<T> {
  const leaseMs = o.leaseMs ?? IDB_LEASE_MS;
  const marginMs = o.marginMs ?? OWNERSHIP_MARGIN_MS;
  const waitMs = o.waitMs ?? IDB_WAIT_MS;
  const pollMs = o.pollMs ?? 150;
  const now = o.now ?? Date.now;
  let db: any;
  try {
    db = await idbOpen(idb);
  } catch {
    throw new CheckoutLockUnavailable('unsupported');
  }
  const owner = `${now()}-${Math.random().toString(36).slice(2)}`;
  const giveUpAt = now() + waitMs;
  try {
    for (;;) {
      let taken = false;
      try {
        taken = await idbTryTake(db, owner, now(), leaseMs);
      } catch {
        throw new CheckoutLockUnavailable('unsupported');
      }
      if (taken) break;
      if (now() > giveUpAt) throw new CheckoutLockUnavailable('busy');
      await new Promise((r) => setTimeout(r, pollMs + Math.floor(Math.random() * pollMs)));
    }
    // keep the lease alive while fn runs — ONLY extending a lease we still hold. A tab that was frozen past its lease
    // and resumes never takes the lock back: it learns it lost it (stillOwned() -> false) and stops renewing.
    let lost = false;
    const renew = setInterval(() => {
      idbRenew(db, owner, now(), leaseMs).then((ok) => {
        if (!ok) {
          lost = true;
          clearInterval(renew);
        }
      }, () => {});
    }, Math.max(1_000, Math.floor(leaseMs / 3)));
    const stillOwned = async (): Promise<boolean> => {
      if (lost) return false;
      try {
        const ok = await idbHeld(db, owner, now(), marginMs);
        if (!ok) lost = true;
        return ok;
      } catch {
        return false;
      }
    };
    try {
      return await fn(stillOwned);
    } finally {
      clearInterval(renew);
      await idbRelease(db, owner);
    }
  } finally {
    try {
      db.close();
    } catch {}
  }
}

/**
 * Runs fn while holding ONE lock shared by ALL tabs of this site, so two tabs never prepare/send at the same time
 * (the second one then sees the first one's record: same content -> same number or "already confirmed").
 *   1. Web Locks API (navigator.locks) when available;
 *   2. otherwise an IndexedDB lock (atomic across tabs, see above);
 *   3. neither available -> CheckoutLockUnavailable('unsupported'): the order is NOT sent (fail closed).
 * localStorage is never used as a lock.
 */
export async function withCheckoutLock<T>(
  fn: (stillOwned: StillOwned) => Promise<T>,
  locks: LockManager | null | undefined = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks,
  idb: IdbFactory | null | undefined = (globalThis as { indexedDB?: IdbFactory }).indexedDB,
): Promise<T> {
  // a Web Lock is held until fn settles (it cannot expire under us)
  if (locks && typeof locks.request === 'function') return locks.request(CHECKOUT_LOCK_NAME, () => fn(async () => true));
  if (idb && typeof idb.open === 'function') return withIdbLock(fn, idb);
  // not a browser (unit tests / tools): there are no tabs to race with
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') return fn(async () => true);
  throw new CheckoutLockUnavailable('unsupported');
}

// ------------------------------------------------------------------------------------------------ original payload
type SessionKv = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
export const PENDING_PAYLOAD_KEY = 'anta_checkout_pending_payload';
/**
 * The exact payload of the open attempt, kept ONLY in this tab's sessionStorage (cleared when the tab closes and when
 * the order is confirmed or refused): after a refresh the same number can be resent byte-for-byte. It holds the order
 * data the customer typed — never written to localStorage.
 */
export function pendingPayloadStore(storage: SessionKv | null | undefined = (globalThis as { sessionStorage?: SessionKv }).sessionStorage) {
  return {
    get(orderId: string): OrderPayload | null {
      try {
        const v = JSON.parse(storage?.getItem(PENDING_PAYLOAD_KEY) || 'null');
        return v && v.orderId === orderId && v.payload && v.payload.id === orderId ? (v.payload as OrderPayload) : null;
      } catch {
        return null;
      }
    },
    set(payload: OrderPayload) {
      try {
        storage?.setItem(PENDING_PAYLOAD_KEY, JSON.stringify({ orderId: payload.id, payload }));
      } catch {}
    },
    clear() {
      try {
        storage?.removeItem(PENDING_PAYLOAD_KEY);
      } catch {}
    },
  };
}

// ------------------------------------------------------------------------------------------------ tracking keys
type LocalKv = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export const TRACKING_KEYS_STORAGE = 'anta_tracking_keys';
/** `who` = the identity using this device now ('guest' or the Firebase uid): a key is returned only to the identity it was stored for. */
export type TrackingKeyStore = { get(orderId: string, who?: string): string | null; add(orderId: string, key: string, who?: string): void };

/**
 * Tracking keys of orders confirmed on THIS device (order number -> key), newest first, max 30. Kept in localStorage
 * so the tracking page works later on the same device; never in a URL, never sent anywhere except the x-tracking-key
 * header of the Worker summary request.
 */
export function trackingKeys(storage: LocalKv | null | undefined = (globalThis as { localStorage?: LocalKv }).localStorage): TrackingKeyStore {
  const read = (): { o: string; k: string; w?: string }[] => {
    try {
      const v = JSON.parse(storage?.getItem(TRACKING_KEYS_STORAGE) || '[]');
      return Array.isArray(v) ? v.filter((x) => x && /^ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16}$/.test(x.o) && normalizeTrackingKey(x.k) === x.k && (x.w === undefined || typeof x.w === 'string')) : [];
    } catch {
      return [];
    }
  };
  return {
    // shared device: another account (or a signed-in user for a guest's order, and vice versa) never gets the key
    get: (orderId, who = 'guest') => {
      const e = read().find((x) => x.o === orderId);
      return e && (e.w ?? 'guest') === who ? e.k : null;
    },
    add: (orderId, key, who = 'guest') => {
      const k = normalizeTrackingKey(key);
      if (!k || !/^ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16}$/.test(orderId)) return;
      try {
        storage?.setItem(TRACKING_KEYS_STORAGE, JSON.stringify([{ o: orderId, k, w: who }, ...read().filter((x) => x.o !== orderId)].slice(0, 30)));
      } catch {}
    },
  };
}

// ------------------------------------------------------------------------------------------------ submit lock
/** A real lock (not React state): a second click while a submission runs is ignored synchronously. */
export function createSubmitLock() {
  let busy = false;
  return {
    tryAcquire(): boolean {
      if (busy) return false;
      busy = true;
      return true;
    },
    release(): void {
      busy = false;
    },
    get busy(): boolean {
      return busy;
    },
  };
}
export type SubmitLock = ReturnType<typeof createSubmitLock>;

// ------------------------------------------------------------------------------------------------ results
export type CheckoutResult =
  | { status: 'busy' }
  | { status: 'confirmed'; orderId: string; payload: OrderPayload; replay: boolean; via: 'create' | 'verify' }
  | { status: 'not_confirmed'; orderId: string; payload: OrderPayload; reason: string; existsOnServer: boolean | null }
  | { status: 'blocked_previous'; orderId: string }
  | { status: 'already_confirmed'; orderId: string }
  | { status: 'lock_unavailable'; why: 'busy' | 'unsupported' }
  | { status: 'conflict'; orderId: string; code: string; payload: OrderPayload }
  | { status: 'rejected'; orderId: string; code: string; field?: string }
  | { status: 'rate_limited'; orderId: string; retryAfterMs: number; payload: OrderPayload }
  | { status: 'offline'; orderId: string; payload: OrderPayload }
  | { status: 'auth_required'; orderId: string; code: string; payload: OrderPayload }
  | { status: 'misconfigured'; orderId: string; reason: string }
  /** the account could not be confirmed in time (session restore slow/failed): NOTHING sent, no attempt created */
  | { status: 'identity_unknown' }
  /** the signed-in account changed (since the page opened, or since the pending attempt): NOTHING sent */
  | { status: 'account_changed'; orderId: string; current: string };

export function mapOutcome(outcome: SubmitOutcome, payload: OrderPayload): CheckoutResult {
  switch (outcome.kind) {
    case 'confirmed':
      return { status: 'confirmed', orderId: outcome.orderId, payload, replay: outcome.replay, via: outcome.via };
    case 'not_confirmed':
      return { status: 'not_confirmed', orderId: outcome.orderId, payload, reason: outcome.lastCode || outcome.reason, existsOnServer: outcome.existsOnServer };
    case 'conflict':
      return { status: 'conflict', orderId: outcome.orderId, code: outcome.code, payload };
    case 'rejected':
      return { status: 'rejected', orderId: outcome.orderId, code: outcome.code, ...(outcome.field ? { field: outcome.field } : {}) };
    case 'rate_limited':
      return { status: 'rate_limited', orderId: outcome.orderId, retryAfterMs: outcome.retryAfterMs, payload };
    case 'offline':
      return { status: 'offline', orderId: outcome.orderId, payload };
    case 'auth_required':
      return { status: 'auth_required', orderId: outcome.orderId, code: outcome.code, payload };
    case 'misconfigured':
    default:
      return { status: 'misconfigured', orderId: (outcome as { orderId: string }).orderId, reason: (outcome as { reason?: string }).reason || 'unknown' };
  }
}

/** Only a Worker-verified confirmation empties the cart. */
export const shouldClearCart = (r: CheckoutResult): boolean => r.status === 'confirmed';

export type PlaceOrderInput = {
  /** the order exactly as built from the form, WITHOUT an id */
  draft: Record<string, unknown>;
  store: AttemptStore;
  opts: SubmitOptions;
  deps: SubmitDeps;
  lock: SubmitLock;
  /** the exact payload sent last time in this tab (reused byte-for-byte for a retry with the same number) */
  lastPayload?: OrderPayload | null;
  now?: () => number;
  /** where confirmed orders' tracking keys are kept on this device (default: localStorage) */
  trackingKeys?: TrackingKeyStore;
  /** where the open attempt's exact payload is kept for a same-tab refresh (default: sessionStorage) */
  payloads?: ReturnType<typeof pendingPayloadStore>;
  /** when this checkout page was opened: the same content confirmed AFTER that is not ordered twice */
  openedAt?: number;
  /** cross-tab lock (default: navigator.locks) */
  locks?: LockManager | null;
  /** IndexedDB used for the fallback lock (default: globalThis.indexedDB) */
  idb?: IdbFactory | null;
  /**
   * Who is sending NOW ('guest' | Firebase uid | null = unknown), decided at the moment of sending. When given, the
   * order's userId is taken from it (never from a value read before the session was restored), and an unknown
   * identity sends nothing. Omitted = the draft's userId is used as is (tools / tests).
   */
  identity?: () => Promise<string | null>;
  /** the identity the page was opened with (filled in for): a different one now = account_changed, nothing sent */
  expectedIdentity?: string | null;
};

/**
 * One click on "confirm order". Same content as an unfinished attempt -> same number (safe resend);
 * different content while an earlier attempt is unresolved -> blocked_previous (never a second order).
 */
export async function placeOrder(input: PlaceOrderInput): Promise<CheckoutResult> {
  if (!input.lock.tryAcquire()) return { status: 'busy' };
  try {
    // WHO is sending, decided now (after the saved session was restored): never a signed-in customer turned guest
    let draft = input.draft;
    if (input.identity) {
      const who = await input.identity();
      if (who === null) return { status: 'identity_unknown' };
      // a pending payload of ANOTHER identity is never resent under this one (no ownership transfer)
      if (input.lastPayload && identityOf(input.lastPayload) !== who) return { status: 'account_changed', orderId: input.lastPayload.id, current: who };
      if (typeof input.expectedIdentity === 'string' && input.expectedIdentity !== who) return { status: 'account_changed', orderId: '', current: who };
      draft = { ...input.draft, userId: who };
    }
    // prepare + send under ONE lock shared by every tab (re-reads the shared attempt records inside the lock)
    return await withCheckoutLock(async (stillOwned): Promise<CheckoutResult> => {
      const prepared = await prepareAttempt(draft, input.store, input.now, input.openedAt);
      if ('reason' in prepared) {
        return (prepared.reason === 'confirmed_while_open'
          ? { status: 'already_confirmed', orderId: prepared.previousOrderId }
          : { status: 'blocked_previous', orderId: prepared.previousOrderId }) as CheckoutResult;
      }
      // FENCING: the cross-tab lock may have been lost (this tab frozen past its lease, another tab took over).
      // Then send NOTHING; a record created by THIS call and never sent is removed (no orphan number left behind).
      if (!(await stillOwned())) {
        const rec = recordFor(input.store, prepared.orderId);
        if (!prepared.reused && rec && rec.lastSentAt === null) dropOpenUnsent(input.store, prepared.orderId);
        return { status: 'lock_unavailable', why: 'busy' };
      }
      const payloads = input.payloads ?? pendingPayloadStore();
      // exact payload of this attempt: this call's last payload, else the one kept in this tab, else built now
      const payload: OrderPayload =
        (input.lastPayload && input.lastPayload.id === prepared.orderId ? input.lastPayload : null) ??
        payloads.get(prepared.orderId) ??
        ({ ...draft, id: prepared.orderId } as OrderPayload);
      payloads.set(payload);
      // the attempt's tracking key (same for every resend): only its hash is sent, next to the order
      const opts = { ...input.opts, trackingKeyHash: await trackingKeyHash(prepared.trackingKey) };
      const outcome = await submitPrepared(payload, prepared, input.store, opts, input.deps, input.now);
      if (outcome.kind === 'confirmed') {
        (input.trackingKeys ?? trackingKeys()).add(prepared.orderId, prepared.trackingKey, identityOf(payload));
        payloads.clear();
      } else if (outcome.kind === 'rejected' && !recordFor(input.store, prepared.orderId)) {
        payloads.clear(); // refused and nothing could have been saved: the record is gone, so is the payload
      }
      return mapOutcome(outcome, payload);
    }, input.locks === undefined ? undefined : input.locks, input.idb === undefined ? undefined : input.idb);
  } catch (e) {
    // no cross-tab lock: NOTHING was prepared or sent (the attempt records are untouched)
    if (e instanceof CheckoutLockUnavailable) return { status: 'lock_unavailable', why: e.why };
    throw e;
  } finally {
    input.lock.release();
  }
}

/** "Retry with the same number" from the warning panel: resends the exact last payload. */
export async function retrySameOrder(input: Omit<PlaceOrderInput, 'draft'> & { lastPayload: OrderPayload }): Promise<CheckoutResult> {
  const { id, ...draft } = input.lastPayload;
  return placeOrder({ ...input, draft, lastPayload: input.lastPayload });
}

// ------------------------------------------------------------------------------------------------ messages
export type Action = 'retry_same' | 'whatsapp' | 'fix_form' | 'wait_retry' | 'check_connection' | 'check_identity';
export type UiMessage = { tone: 'success' | 'warning' | 'error'; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string; actions: Action[]; showOrderId: boolean };

const FIELD_AR: Record<string, string> = {
  'address.phone': 'رقم الهاتف', 'address.fullName': 'الاسم', items: 'المنتجات في السلة', customerEmail: 'البريد الإلكتروني',
  'addressMeta.citySlug': 'المحافظة', shippingMethodId: 'طريقة التوصيل', 'paymentDetails.cliqReference': 'الرقم المرجعي لحوالة CliQ',
  paymentMethod: 'طريقة الدفع', total: 'المجموع',
};

export function messageFor(r: CheckoutResult): UiMessage | null {
  switch (r.status) {
    case 'busy':
    case 'confirmed':
      return null;
    case 'not_confirmed':
      return {
        tone: 'warning', showOrderId: true, actions: ['retry_same', 'whatsapp'],
        titleAr: 'لم نتمكن بعد من تأكيد طلبك', titleEn: 'We could not confirm your order yet',
        bodyAr: 'قد يكون الطلب وصلنا بالفعل. لم نُنشئ رقم طلب جديدًا وسلّتك محفوظة. أعد المحاولة بنفس الرقم أو تواصل معنا وأرسل رقم الطلب — لا تنشئ طلبًا جديدًا حتى يتم التأكد.',
        bodyEn: 'Your order may already have reached us. No new order number was created and your cart is kept. Retry with the same number or contact us with the order number — do not place a new order until it is confirmed.',
      };
    case 'blocked_previous':
      return {
        tone: 'warning', showOrderId: true, actions: ['whatsapp'],
        titleAr: 'لديك طلب سابق لم يُحسم بعد', titleEn: 'You have an earlier order that is not settled yet',
        bodyAr: 'لا يمكن إرسال طلب ببيانات مختلفة قبل التأكد من الطلب السابق حتى لا يتكرر. أرجِع البيانات كما كانت لإعادة المحاولة بنفس الرقم، أو تواصل معنا برقم الطلب.',
        bodyEn: 'A different order cannot be sent before the earlier one is settled, to avoid duplicates. Restore the same details to retry with the same number, or contact us with the order number.',
      };
    case 'identity_unknown':
      return {
        tone: 'warning', showOrderId: false, actions: ['check_identity'],
        titleAr: 'تعذّر التحقق من حسابك، لذلك لم نُرسل الطلب', titleEn: 'We could not confirm your account, so the order was not sent',
        bodyAr: 'لم نُرسل الطلب ولم ننشئ رقم طلب. سلّتك وبياناتك محفوظة. تحقّق من الاتصال ثم أعد المحاولة؛ إذا كنت مسجّل الدخول فسيُسجَّل الطلب باسم حسابك بعد التحقق.',
        bodyEn: 'The order was not sent and no order number was created. Your cart and details are kept. Check your connection and try again; if you are signed in, the order will be placed under your account once it is confirmed.',
      };
    case 'account_changed':
      return {
        tone: 'warning', showOrderId: false, actions: ['fix_form'],
        titleAr: 'تغيّر الحساب المسجَّل في هذا المتصفح', titleEn: 'The signed-in account has changed in this browser',
        bodyAr: 'لم نُرسل الطلب. راجع البيانات ثم أكّد الطلب مرة أخرى ليُسجَّل باسم الحساب الحالي.',
        bodyEn: 'The order was not sent. Review the details, then confirm again to place it under the current account.',
      };
    case 'lock_unavailable':
      return r.why === 'busy'
        ? {
            tone: 'warning', showOrderId: false, actions: ['wait_retry'],
            titleAr: 'يوجد طلب قيد الإرسال من نافذة أخرى', titleEn: 'An order is being sent from another window',
            bodyAr: 'لم نُرسل هذا الطلب حتى لا يتكرر. انتظر حتى ينتهي الإرسال في النافذة الأخرى ثم أعد المحاولة؛ سلّتك محفوظة.',
            bodyEn: 'This order was not sent, to avoid a duplicate. Wait until the other window finishes, then try again; your cart is kept.',
          }
        : {
            tone: 'error', showOrderId: false, actions: ['whatsapp'],
            titleAr: 'متصفحك لا يدعم حماية الطلب من التكرار', titleEn: 'Your browser cannot protect the order from duplicates',
            bodyAr: 'لم نُرسل الطلب. حدّث المتصفح أو استخدم متصفحًا آخر، أو تواصل معنا عبر واتساب لإتمام طلبك.',
            bodyEn: 'The order was not sent. Update your browser or use another one, or contact us on WhatsApp to complete your order.',
          };
    case 'already_confirmed':
      return {
        tone: 'success', showOrderId: true, actions: [],
        titleAr: 'تم تأكيد هذا الطلب بالفعل', titleEn: 'This order is already confirmed',
        bodyAr: 'طلب بنفس المحتويات تم تأكيده بهذا الرقم بعد فتحك لهذه الصفحة (ربما من نافذة أخرى)، لذلك لم نُنشئ طلبًا مكررًا. إن كنت تريد طلبًا جديدًا مطابقًا فعلًا، أعد تحميل الصفحة ثم أكّد.',
        bodyEn: 'An order with the same content was confirmed with this number after you opened this page (perhaps in another window), so no duplicate was created. To place a genuinely new identical order, reload the page and confirm.',
      };
    case 'conflict':
      return {
        tone: 'error', showOrderId: true, actions: ['whatsapp'],
        titleAr: 'يوجد طلب مسجّل بهذا الرقم ببيانات مختلفة', titleEn: 'An order with this number exists with different details',
        bodyAr: 'لن ننشئ طلبًا بديلًا تلقائيًا. تواصل معنا برقم الطلب لنراجعه معك.',
        bodyEn: 'We will not create a replacement automatically. Contact us with the order number so we can check it with you.',
      };
    case 'rejected': {
      const fieldAr = r.field ? FIELD_AR[r.field] || r.field : '';
      if (r.code === 'TURNSTILE_FAILED') {
        return { tone: 'error', showOrderId: false, actions: ['fix_form'], titleAr: 'فشل التحقق الأمني', titleEn: 'Security check failed', bodyAr: 'لم يُرسل الطلب. حدّث الصفحة وأعد المحاولة.', bodyEn: 'The order was not sent. Refresh the page and try again.' };
      }
      if (r.code === 'USERID_MISMATCH') {
        return { tone: 'error', showOrderId: false, actions: ['fix_form'], titleAr: 'تغيّر الحساب المسجّل', titleEn: 'The signed-in account changed', bodyAr: 'الحساب المسجّل الآن يختلف عن الحساب الذي بدأت به هذا الطلب، فلم يُرسل. راجع بياناتك ثم أكّد الطلب من جديد.', bodyEn: 'The account signed in now differs from the one this order was started with, so it was not sent. Review your details and confirm again.' };
      }
      if (r.code === 'PAYLOAD_TOO_LARGE') {
        return { tone: 'error', showOrderId: false, actions: ['fix_form'], titleAr: 'الطلب كبير جدًا', titleEn: 'Order too large', bodyAr: 'قلّل عدد المنتجات أو طول الملاحظات ثم أعد المحاولة.', bodyEn: 'Reduce the items or the note length and try again.' };
      }
      return {
        tone: 'error', showOrderId: false, actions: ['fix_form'],
        titleAr: 'تعذّر قبول الطلب', titleEn: 'The order could not be accepted',
        bodyAr: `يرجى مراجعة البيانات${fieldAr ? ` (${fieldAr})` : ''} ثم المحاولة مرة أخرى. لم يُنشأ أي طلب.`,
        bodyEn: `Please check the details${r.field ? ` (${r.field})` : ''} and try again. No order was created.`,
      };
    }
    case 'rate_limited':
      return {
        tone: 'warning', showOrderId: false, actions: ['wait_retry'],
        titleAr: 'محاولات كثيرة خلال وقت قصير', titleEn: 'Too many attempts',
        bodyAr: 'انتظر قليلًا ثم أعد المحاولة. سلّتك محفوظة ولن يتغيّر رقم الطلب.', bodyEn: 'Please wait a moment and try again. Your cart and order number are kept.',
      };
    case 'auth_required':
      return {
        tone: 'warning', showOrderId: true, actions: ['retry_same', 'whatsapp'],
        titleAr: 'يلزم تأكيد تسجيل دخولك', titleEn: 'Please confirm your sign-in',
        bodyAr: 'انتهت جلسة تسجيل الدخول أو تعذّر التحقق منها، فلم نُرسل الطلب الآن. سلّتك ورقم الطلب محفوظان. سجّل الدخول من جديد في نفس المتصفح ثم اضغط «إعادة المحاولة بنفس الرقم» — لا تنشئ طلبًا جديدًا.',
        bodyEn: 'Your sign-in session expired or could not be verified, so the order was not sent now. Your cart and order number are kept. Sign in again in this browser, then press "Retry with the same number" — do not place a new order.',
      };
    case 'offline':
      return {
        tone: 'warning', showOrderId: false, actions: ['check_connection'],
        titleAr: 'لا يوجد اتصال بالإنترنت', titleEn: 'No internet connection',
        bodyAr: 'لم يُرسل الطلب. تحقّق من الاتصال ثم أعد المحاولة؛ سلّتك محفوظة.', bodyEn: 'The order was not sent. Check your connection and try again; your cart is kept.',
      };
    case 'misconfigured':
    default:
      return {
        tone: 'error', showOrderId: false, actions: ['whatsapp'],
        titleAr: 'خدمة الطلبات غير متاحة حاليًا', titleEn: 'Ordering is unavailable right now',
        bodyAr: 'لم يُرسل الطلب. تواصل معنا عبر واتساب لإتمام طلبك.', bodyEn: 'The order was not sent. Contact us on WhatsApp to complete your order.',
      };
  }
}

// ------------------------------------------------------------------------------------------------ WhatsApp
/** The shop's WhatsApp number (same value as in Checkout.tsx). */
export const STORE_WHATSAPP = '962796969081';

/** Message to the shop with the order number only (+ CliQ reference when relevant). Opened by a user click. */
export function whatsappUrl(storePhone: string, orderId: string, opts: { kind: 'cliq_receipt' | 'unconfirmed' | 'conflict'; cliqReference?: string; customerName?: string }): string {
  const lines =
    opts.kind === 'cliq_receipt'
      ? ['مرحباً متجر دير شرف 👋', 'تم الدفع عبر CliQ، وهذا طلبي.', '', ...(opts.customerName ? [`*الاسم:* ${opts.customerName}`] : []), `*رقم الطلب:* #${orderId}`, ...(opts.cliqReference ? [`*الرقم المرجعي للتحويل:* ${opts.cliqReference}`] : []), '', '(مرفق صورة إيصال التحويل ✅)']
      : opts.kind === 'conflict'
      ? ['مرحباً متجر دير شرف 👋', `ظهرت لي رسالة أن هناك طلبًا مسجّلًا بالرقم #${orderId} ببيانات مختلفة. أرجو المساعدة.`]
      : ['مرحباً متجر دير شرف 👋', `حاولت إرسال طلب برقم #${orderId} ولم يظهر لي تأكيد. هل وصلكم الطلب؟`];
  return `https://wa.me/${storePhone}?text=${encodeURIComponent(lines.join('\n'))}`;
}

/** Order by WhatsApp when the site could NOT send it (no number exists): product names and quantities only, no personal data. */
export function whatsappNewOrderUrl(storePhone: string, items: Array<{ title: string; quantity: number }>): string {
  const lines = ['مرحباً متجر دير شرف 👋', 'لم أتمكن من إرسال الطلب من الموقع، وأرغب بطلب:', ...items.slice(0, 30).map((i) => `- ${String(i.title).slice(0, 120)} × ${Math.max(1, Math.floor(Number(i.quantity) || 1))}`)];
  return `https://wa.me/${storePhone}?text=${encodeURIComponent(lines.join('\n'))}`;
}

// ------------------------------------------------------------------------------------------------ success page
type KvStorage = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export const CONFIRMED_KEY = 'anta_confirmed_orders';

/** Order numbers this tab saw CONFIRMED by the Worker (numbers only, max 20). */
export function confirmedOrders(storage: KvStorage | null | undefined = (globalThis as { sessionStorage?: KvStorage }).sessionStorage) {
  const read = (): string[] => {
    try {
      const v = JSON.parse(storage?.getItem(CONFIRMED_KEY) || '[]');
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16}$/.test(x)) : [];
    } catch {
      return [];
    }
  };
  return {
    has: (id: string) => read().includes(id),
    add: (id: string) => {
      try {
        storage?.setItem(CONFIRMED_KEY, JSON.stringify([id, ...read().filter((x) => x !== id)].slice(0, 20)));
      } catch {}
    },
  };
}

export type SuccessCheck = 'confirmed' | 'exists_unverified' | 'not_found' | 'unknown' | 'invalid';

/**
 * Success page verdict. NOT from navigation state or cached data alone, NOT from a Firestore read:
 * 'confirmed' requires BOTH a Worker-verified confirmation recorded in this tab AND the Worker's status
 * endpoint reporting the order now. Anything else is shown as what it is.
 */
export async function checkSuccessPage(orderId: string, confirmed: { has(id: string): boolean }, opts: SubmitOptions, deps: SubmitDeps): Promise<SuccessCheck> {
  if (!/^ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16}$/.test(orderId)) return 'invalid';
  const exists = await checkOrderStatus(orderId, opts, deps);
  if (exists === true) return confirmed.has(orderId) ? 'confirmed' : 'exists_unverified';
  if (exists === false) return 'not_found';
  return 'unknown';
}

// ------------------------------------------------------------------------------------------------ recovery after reopening
export type RecoveryView = PendingRecovery[];
/**
 * Called when Checkout opens: checks every unresolved attempt of this browser once. A 'recovered' order (summary
 * opened with this attempt's tracking key) is remembered as confirmed on this device; the others stay unresolved
 * (they keep blocking a new number) and are shown with their number and a way to contact the shop.
 */
export async function recoverPendingAttempts(
  store: AttemptStore, opts: SubmitOptions, deps: SubmitDeps,
  keys: TrackingKeyStore = trackingKeys(), confirmed: { add(id: string): void } = confirmedOrders(),
  /** who uses this device NOW ('guest' or the Firebase uid). Omitted = the attempts' own identity (no switch check). */
  currentUser?: string,
): Promise<RecoveryView> {
  const owners = new Map(openAttempts(store).map((r) => [r.orderId, r.who]));
  const res = await resolvePendingAttempts(store, opts, deps);
  return res.map((r): PendingRecovery => {
    if (r.state !== 'recovered') return r;
    const who = owners.get(r.orderId);
    if (currentUser !== undefined && who !== currentUser) {
      // saved, but placed by ANOTHER identity on this device (account switch, or a guest who signed in since). The
      // identity using the device now gets existence only (no code, no details, no ownership transfer). The order
      // no longer blocks this device. Its OWNER keeps it: the key stays on this device bound to the owner's identity
      // and the owner is told once they are back (ownerNoticesFor / takeOwnerNotices). A record of unknown owner
      // (written before identities were recorded) loses its key instead: nobody can be told safely.
      const rec = recordFor(store, r.orderId);
      if (rec && who) {
        keys.add(r.orderId, r.trackingKey, who);
        store.set({ ...rec, state: 'confirmed', ownerNotice: true });
      } else if (rec) {
        const { trackingKey: _drop, ...rest } = rec;
        store.set(rest);
      }
      return { orderId: r.orderId, state: 'exists_unverified' };
    }
    keys.add(r.orderId, r.trackingKey, who ?? 'guest');
    confirmed.add(r.orderId);
    return r;
  });
}

/**
 * The owner is back on this device: their saved orders that were recovered while another identity used it are
 * reported to them once ('recovered', with the device's key bound to them) and marked as confirmed here.
 */
export function takeOwnerNotices(
  store: AttemptStore, who: string,
  keys: TrackingKeyStore = trackingKeys(), confirmed: { add(id: string): void } = confirmedOrders(),
): PendingRecovery[] {
  return ownerNoticesFor(store, who).map((rec) => {
    keys.add(rec.orderId, rec.trackingKey as string, who);
    confirmed.add(rec.orderId);
    const { ownerNotice: _shown, ...rest } = rec;
    store.set(rest);
    return { orderId: rec.orderId, state: 'recovered', trackingKey: rec.trackingKey as string };
  });
}

/**
 * The exact payload of the newest OPEN attempt, if this tab still keeps it AND its content hash equals the attempt's
 * (so a resend can only ever carry the same content under that number). Anything else -> null (nothing is resent).
 */
export async function restorablePayload(
  store: AttemptStore, payloads: ReturnType<typeof pendingPayloadStore> = pendingPayloadStore(),
  /** who is signed in NOW ('guest' or the Firebase uid). Another identity -> the payload is not restored, and dropped */
  currentUserId?: string,
): Promise<OrderPayload | null> {
  const newest = openAttempts(store)[0];
  if (!newest) return null;
  const kept = payloads.get(newest.orderId);
  if (!kept) return null;
  if (currentUserId !== undefined && String(kept.userId ?? 'guest') !== currentUserId) {
    // e.g. signed out / another account on this device: never resend (or keep showing) someone else's order data
    payloads.clear();
    return null;
  }
  return (await attemptKey(kept)) === newest.key ? kept : null;
}
