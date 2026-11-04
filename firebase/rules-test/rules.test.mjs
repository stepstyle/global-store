// Firestore security-rules tests — EMULATOR ONLY.
//
// Runs the same case table against three rulesets and asserts the expected
// allow/deny for each:
//   prod   = ../firestore.rules.prod-snapshot   (what is deployed today)
//   compat = ./firestore.rules.compat           (Phase 1 candidate, no app change needed)
//   target = ./firestore.rules.target           (Phase 3, needs frontend v2 + Worker endpoints)
//
// "prod" expectations document CURRENT behaviour, including known holes —
// a passing prod row marked [SEC] means the hole is confirmed, not fixed.
//
// Run (from this folder, after `npm install`):
//   npm test                      -> all three rulesets
//   RULES=compat npm test         -> one ruleset (PowerShell: $env:RULES='compat'; npm test)

import { describe, test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Safety guards: never touch a real project
// ---------------------------------------------------------------------------
const PROJECT_ID = 'demo-dairsharaf-rules';
const PROD_PROJECT_ID = 'antastore1-82b50';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulatorHost) {
  throw new Error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set. These tests run against the local emulator only.');
}
if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(emulatorHost)) {
  throw new Error(`Refusing to run: FIRESTORE_EMULATOR_HOST must be local, got "${emulatorHost}".`);
}
if (!PROJECT_ID.startsWith('demo-') || PROJECT_ID === PROD_PROJECT_ID) {
  throw new Error('Refusing to run: project id must be a demo- project.');
}
const [emuHost, emuPort] = emulatorHost.replace(/^\[|\]/g, '').split(/:(?=\d+$)/);

const here = dirname(fileURLToPath(import.meta.url));
const RULESETS = {
  prod: resolve(here, '../firestore.rules.prod-snapshot'),
  compat: resolve(here, './firestore.rules.compat'),
  target: resolve(here, './firestore.rules.target'),
  // proposals (test-only): final = target without e-mail based reads; transition = compat with order reads closed
  final: resolve(here, './firestore.rules.final'),
  transition: resolve(here, './firestore.rules.transition'),
};
const selected = (process.env.RULES || 'prod,compat,target,final,transition')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s in RULESETS);

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------
const OWNER = 'owner-uid';
const ADMIN = 'admin-uid'; // listed in admins/, not the owner
const ALICE = 'alice-uid'; // regular customer (victim in some cases)
const MALLORY = 'mallory-uid'; // regular customer (attacker)
const NEWBIE = 'newbie-uid'; // just signed up, no users/ doc yet
const ADMIN2 = 'admin2-uid'; // a second non-owner admin
const LEGACY = 'legacy-uid'; // customer whose doc already says role:'admin' (written under the old rules)
const V2_ORDER = 'ORD-V2ALICE1-CCCC'; // order saved by Worker v2 for signed-in Alice (userId 'guest' + claimedUserId)

const ctx = (env) => ({
  guest: () => env.unauthenticatedContext().firestore(),
  owner: () => env.authenticatedContext(OWNER, { email: 'owner@example.com', email_verified: true }).firestore(),
  admin: () => env.authenticatedContext(ADMIN, { email: 'admin@example.com', email_verified: true }).firestore(),
  alice: () => env.authenticatedContext(ALICE, { email: 'alice@example.com', email_verified: true }).firestore(),
  aliceUnverified: () => env.authenticatedContext(ALICE, { email: 'alice@example.com', email_verified: false }).firestore(),
  mallory: () => env.authenticatedContext(MALLORY, { email: 'mallory@example.com', email_verified: true }).firestore(),
  legacy: () => env.authenticatedContext(LEGACY, { email: 'legacy@example.com', email_verified: true }).firestore(),
  newbie: () => env.authenticatedContext(NEWBIE, { email: 'newbie@example.com', email_verified: false }).firestore(),
});

// ---------------------------------------------------------------------------
// Fixtures — shapes copied from the current app code
// ---------------------------------------------------------------------------

// Checkout.tsx newOrder  ->  storage.ts db.orders.create() (createdAt/updatedAt = serverTimestamp, undefined removed)
function checkoutOrder({ id, userId, payment = 'cod', overrides = {} }) {
  const order = {
    id,
    userId,
    status: 'new',
    seenByAdmin: false,
    date: '2026-11-03',
    createdAt: serverTimestamp(),
    createdAtMs: 1793700000000,
    updatedAt: serverTimestamp(),
    items: [
      { productId: 'p-simple', name: 'دفتر', price: 2.5, quantity: 2, image: 'https://example.invalid/a.jpg', selectedVariant: null },
      {
        productId: 'p-variants',
        name: 'قلم - أحمر',
        price: 3,
        quantity: 1,
        image: 'https://example.invalid/b.jpg',
        selectedVariant: { id: 'var_1', label: 'أحمر', type: 'color', price: 3, stock: 5, colorCode: '#ff0000' },
      },
    ],
    subtotal: 8,
    discountAmount: 0.8,
    shippingCost: 1,
    total: 8.2,
    shippingMethodId: 'standard',
    shippingMethod: 'توصيل عادي (خلال 48 ساعة)',
    paymentMethod: payment,
    customerEmail: 'buyer@example.com',
    consents: { acceptedStorePolicies: true, acceptedDeliveryPolicy: false, saveInfo: true, billingSameAsShipping: true },
    note: 'اتصل قبل الوصول',
    address: { fullName: 'Test Buyer', city: 'عمّان (العاصمة) - النزهة', street: 'شارع 1', phone: '+962791234567' },
    addressMeta: { country: 'Jordan', countryCode: 'JO', citySlug: 'amman', ammanAreaId: 'a1', saveInfo: true, phoneDial: '+962', phoneLocal: '0791234567' },
  };
  if (payment === 'cliq') order.paymentDetails = { cliqReference: '1234567890', isPaid: false };
  return { ...order, ...overrides };
}

const without = (obj, ...keys) => {
  const o = { ...obj };
  for (const k of keys) delete o[k];
  return o;
};
// deployed Checkout, guest COD, with every optional value empty -> cleanForFirestore() drops undefined:
// no note, no paymentDetails, empty customerEmail, no ammanAreaId, name/street fallbacks
const minimalDeployedOrder = (id) => {
  const o = without(checkoutOrder({ id, userId: 'guest' }), 'note', 'paymentDetails');
  o.customerEmail = '';
  o.address = { fullName: 'Guest', city: 'الزرقاء', street: 'لم يتم إدخال عنوان تفصيلي', phone: '+962791234567' };
  o.addressMeta = { country: 'Jordan', countryCode: 'JO', citySlug: 'zarqa', saveInfo: false, phoneDial: '+962', phoneLocal: '0791234567' };
  o.consents = { acceptedStorePolicies: true, acceptedDeliveryPolicy: true, saveInfo: false, billingSameAsShipping: true };
  return o;
};
const manyItems = (n) => Array.from({ length: n }, (_, i) => ({ productId: `p-${i}`, name: `منتج ${i}`, price: 1, quantity: 1, image: '', selectedVariant: null }));

// what Worker v2 (workers/order-worker/src/orders.js) stores for a signed-in customer whose uid it cannot verify
const v2Order = (overrides = {}) => ({
  id: V2_ORDER, userId: 'guest', claimedUserId: ALICE, userIdVerified: false, userIdSource: 'claimed-unverified-dropped',
  status: 'delivered', total: 8, customerEmail: 'alice@example.com', paymentMethod: 'cod',
  items: [{ productId: 'p-simple', name: 'دفتر', price: 2.5, quantity: 2 }],
  address: { fullName: 'Alice Victim', phone: '+962790000001', city: 'Amman', street: 'Secret St 5' },
  ...overrides,
});

// storage.ts db.users.register()
const registerPayload = (uid, role = 'customer') => ({
  id: uid,
  name: 'New Customer',
  email: `${uid}@example.com`,
  role,
  orders: [],
  createdAt: '2026-11-03T10:00:00.000Z',
});

// reviews.ts upsertReview() (insert branch)
const reviewPayload = (userId, overrides = {}) => ({
  productId: 'p-simple',
  userId,
  userName: 'Reviewer',
  userEmail: 'r@example.com',
  rating: 5,
  comment: 'منتج ممتاز',
  status: 'published',
  likesCount: 0,
  likesBy: {},
  adminReply: null,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
});

// reviews.ts syncProductAggregate()
const aggregate = (avg, count, extra = {}) => ({
  ratingAvg: avg,
  ratingCount: count,
  rating: avg,
  reviews: count,
  updatedAt: serverTimestamp(),
  ...extra,
});

async function seed(env) {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'config/roles'), { ownerUid: OWNER });
    await setDoc(doc(db, 'config/sendgrid'), { apikey: 'TEST-NOT-A-REAL-KEY', fromEmail: 'test@example.invalid' });
    await setDoc(doc(db, `admins/${ADMIN}`), { addedBy: OWNER });
    await setDoc(doc(db, `admins/${ADMIN2}`), { addedBy: OWNER });
    await setDoc(doc(db, 'config/other'), { note: 'some other config doc' });
    await setDoc(doc(db, `users/${LEGACY}`), registerPayload(LEGACY, 'admin'));
    await setDoc(doc(db, `orders/${V2_ORDER}`), v2Order());
    await setDoc(doc(db, 'orders/ORD-MALLORY1-DDDD'), {
      id: 'ORD-MALLORY1-DDDD', userId: MALLORY, status: 'new', total: 3, customerEmail: 'mallory@example.com',
      address: { fullName: 'Mallory', phone: '+962790000003', city: 'Irbid', street: 'y' },
    });
    await setDoc(doc(db, `users/${ALICE}`), registerPayload(ALICE));
    await setDoc(doc(db, `users/${MALLORY}`), registerPayload(MALLORY));
    await setDoc(doc(db, 'products/p-simple'), {
      name: 'دفتر', price: 2.5, stock: 10, category: 'Stationery',
      ratingAvg: 4, ratingCount: 2, rating: 4, reviews: 2,
    });
    await setDoc(doc(db, 'products/p-variants'), {
      name: 'قلم', price: 3, stock: 0, category: 'Stationery',
      variants: [{ id: 'var_1', label: 'أحمر', type: 'color', price: 3, stock: 5 }],
    });
    await setDoc(doc(db, 'products/p-drift'), {
      name: 'منتج قديم', price: 1, stock: 3, rating: 4.5, reviews: 57, // legacy mock numbers, no ratingCount
    });
    // Alice's existing order (contains personal data)
    await setDoc(doc(db, 'orders/ORD-ALICE001-AAAA'), {
      id: 'ORD-ALICE001-AAAA', userId: ALICE, status: 'new', total: 10,
      customerEmail: 'alice@example.com',
      address: { fullName: 'Alice Victim', phone: '+962790000001', city: 'Amman', street: 'Secret St 5' },
    });
    // A guest order placed with Alice's email
    await setDoc(doc(db, 'orders/ORD-GUEST001-BBBB'), {
      id: 'ORD-GUEST001-BBBB', userId: 'guest', status: 'new', total: 5,
      customerEmail: 'alice@example.com',
      address: { fullName: 'Alice Guest', phone: '+962790000002', city: 'Zarqa', street: 'x' },
    });
    await setDoc(doc(db, 'orderLedger/ORD-ALICE001-AAAA'), { stockDeducted: true });
    await setDoc(doc(db, 'reviews/r-alice'), {
      productId: 'p-simple', userId: ALICE, userName: 'Alice', userEmail: 'alice@example.com',
      rating: 4, comment: 'جيد', status: 'published', likesCount: 1, likesBy: { [MALLORY]: true }, adminReply: null,
    });
    await setDoc(doc(db, 'reviews/r-alice-hidden'), {
      productId: 'p-variants', userId: ALICE, userName: 'Alice', userEmail: 'alice@example.com',
      rating: 1, comment: 'مسيء', status: 'hidden', likesCount: 0, likesBy: {}, adminReply: null,
    });
  });
}

// ---------------------------------------------------------------------------
// Case table.  x(prod, compat, target): 'A' = must succeed, 'D' = must be denied
//   [SEC]  security property (customer data / privilege / integrity)
//   [FUNC] existing app feature that must keep working
//   [INFO] documents a trade-off of the new rules
// ---------------------------------------------------------------------------
// final defaults to target, transition to compat; the cases where they differ are listed in FINAL_TRANSITION below
const x = (prod, compat, target) => ({ prod, compat, target, final: target, transition: compat });

const CASES = [
  // ---------------- orders: create ----------------
  ['[FUNC] guest places order — exact Checkout payload (COD)', x('A', 'A', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00001-C0D1'), checkoutOrder({ id: 'ORD-NEW00001-C0D1', userId: 'guest' }))],
  ['[FUNC] guest places order — exact Checkout payload (CliQ)', x('A', 'A', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00002-CL1Q'), checkoutOrder({ id: 'ORD-NEW00002-CL1Q', userId: 'guest', payment: 'cliq' }))],
  ['[FUNC] signed-in customer places own order', x('A', 'A', 'D'),
    (c) => setDoc(doc(c.alice(), 'orders/ORD-NEW00003-ALIC'), checkoutOrder({ id: 'ORD-NEW00003-ALIC', userId: ALICE }))],
  ['[FUNC] signed-in customer before profile loaded (userId=guest)', x('A', 'A', 'D'),
    (c) => setDoc(doc(c.alice(), 'orders/ORD-NEW00004-GST1'), checkoutOrder({ id: 'ORD-NEW00004-GST1', userId: 'guest' }))],
  ['[SEC] attacker creates order under victim userId (shows in victim "My Orders")', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.mallory(), 'orders/ORD-NEW00005-SPF1'), checkoutOrder({ id: 'ORD-NEW00005-SPF1', userId: ALICE }))],
  ['[SEC] guest creates order with status=delivered', x('D', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00006-STAT'), checkoutOrder({ id: 'ORD-NEW00006-STAT', userId: 'guest', overrides: { status: 'delivered' } }))],
  ['[SEC] guest injects isVerified / fraudReason fields', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00007-INJ1'), checkoutOrder({ id: 'ORD-NEW00007-INJ1', userId: 'guest', overrides: { isVerified: true, systemNote: 'ok' } }))],
  ['[SEC] guest marks CliQ payment as paid', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00008-PAID'), checkoutOrder({ id: 'ORD-NEW00008-PAID', userId: 'guest', payment: 'cliq', overrides: { paymentDetails: { cliqReference: '1', isPaid: true } } }))],
  ['[SEC] guest sends total as string', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00009-TOTS'), checkoutOrder({ id: 'ORD-NEW00009-TOTS', userId: 'guest', overrides: { total: '0' } }))],
  ['[SEC] guest sends 5000-char note', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00010-NOTE'), checkoutOrder({ id: 'ORD-NEW00010-NOTE', userId: 'guest', overrides: { note: 'x'.repeat(5000) } }))],
  ['[SEC] guest sets createdAt in the past', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00011-DATE'), checkoutOrder({ id: 'ORD-NEW00011-DATE', userId: 'guest', overrides: { createdAt: new Date('2020-01-01') } }))],
  ['[SEC] document id differs from order.id', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00012-IDMM'), checkoutOrder({ id: 'ORD-OTHER000-XXXX', userId: 'guest' }))],
  ['[INFO] stale local mock user (no Firebase auth, userId=admin-1) — Worker still saves', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00013-MOCK'), checkoutOrder({ id: 'ORD-NEW00013-MOCK', userId: 'admin-1' }))],

  // ---------------- orders: overwrite / race ----------------
  ['[SEC] guest overwrites an existing order (setDoc on existing id)', x('D', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-ALICE001-AAAA'), checkoutOrder({ id: 'ORD-ALICE001-AAAA', userId: 'guest' }))],
  ['[INFO] browser setDoc after Worker already created same id → rejected (race order 2)', x('D', 'D', 'D'),
    (c) => setDoc(doc(c.alice(), 'orders/ORD-ALICE001-AAAA'), checkoutOrder({ id: 'ORD-ALICE001-AAAA', userId: ALICE }))],

  // ---------------- orders: read (customer data exposure) ----------------
  ['[SEC] guest reads any order by id (name/phone/address)', x('A', 'A', 'D'),
    (c) => getDoc(doc(c.guest(), 'orders/ORD-ALICE001-AAAA'))],
  ['[SEC] signed-in attacker reads victim order by id', x('A', 'A', 'D'),
    (c) => getDoc(doc(c.mallory(), 'orders/ORD-ALICE001-AAAA'))],
  ['[FUNC] customer reads own order by id', x('A', 'A', 'A'),
    (c) => getDoc(doc(c.alice(), 'orders/ORD-ALICE001-AAAA'))],
  ['[FUNC] customer reads guest order placed with her verified email', x('A', 'A', 'A'),
    (c) => getDoc(doc(c.alice(), 'orders/ORD-GUEST001-BBBB'))],
  ['[SEC] unverified email cannot read guest order by email match (target)', x('A', 'A', 'D'),
    (c) => getDoc(doc(c.aliceUnverified(), 'orders/ORD-GUEST001-BBBB'))],
  ['[SEC] guest lists all orders', x('D', 'D', 'D'),
    (c) => getDocs(collection(c.guest(), 'orders'))],
  ['[SEC] customer lists all orders without filter', x('D', 'D', 'D'),
    (c) => getDocs(collection(c.alice(), 'orders'))],
  ['[FUNC] MyOrders: list where userId == own uid', x('A', 'A', 'A'),
    (c) => getDocs(query(collection(c.alice(), 'orders'), where('userId', '==', ALICE)))],
  ['[SEC] attacker lists where userId == victim uid', x('D', 'D', 'D'),
    (c) => getDocs(query(collection(c.mallory(), 'orders'), where('userId', '==', ALICE)))],
  ['[FUNC] Account.tsx: list where customerEmail == own verified email (broken in prod)', x('D', 'A', 'A'),
    (c) => getDocs(query(collection(c.alice(), 'orders'), where('customerEmail', '==', 'alice@example.com')))],
  ['[SEC] attacker lists where customerEmail == victim email', x('D', 'D', 'D'),
    (c) => getDocs(query(collection(c.mallory(), 'orders'), where('customerEmail', '==', 'alice@example.com')))],
  ['[FUNC] admin lists all orders (dashboard)', x('A', 'A', 'A'),
    (c) => getDocs(collection(c.admin(), 'orders'))],

  // ---------------- orders: update / delete ----------------
  ['[FUNC] admin updates order status (storage.updateStatus)', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.admin(), 'orders/ORD-ALICE001-AAAA'), { status: 'processing', seenByAdmin: true, updatedAt: serverTimestamp() })],
  ['[SEC] customer changes own order status', x('D', 'D', 'D'),
    (c) => updateDoc(doc(c.alice(), 'orders/ORD-ALICE001-AAAA'), { status: 'cancelled' })],
  ['[SEC] admin edits order total (target: status-only updates)', x('A', 'A', 'D'),
    (c) => updateDoc(doc(c.admin(), 'orders/ORD-ALICE001-AAAA'), { total: 0 })],
  ['[FUNC] owner deletes order', x('A', 'A', 'A'),
    (c) => deleteDoc(doc(c.owner(), 'orders/ORD-ALICE001-AAAA'))],
  ['[SEC] non-owner admin deletes order', x('D', 'D', 'D'),
    (c) => deleteDoc(doc(c.admin(), 'orders/ORD-ALICE001-AAAA'))],
  ['[SEC] client reads orderLedger', x('D', 'D', 'D'),
    (c) => getDoc(doc(c.admin(), 'orderLedger/ORD-ALICE001-AAAA'))],
  ['[SEC] client writes orderLedger', x('D', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orderLedger/ORD-X'), { stockDeducted: false })],

  // ---------------- users / privilege escalation ----------------
  ['[FUNC] registration creates own user doc (role=customer)', x('A', 'A', 'A'),
    (c) => setDoc(doc(c.newbie(), `users/${NEWBIE}`), registerPayload(NEWBIE))],
  ['[SEC] registration with role=admin', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.newbie(), `users/${NEWBIE}`), registerPayload(NEWBIE, 'admin'))],
  ['[SEC] registration creating someone else user doc', x('D', 'D', 'D'),
    (c) => setDoc(doc(c.newbie(), 'users/someone-else'), registerPayload('someone-else'))],
  ['[SEC] customer sets own role to admin', x('A', 'D', 'D'),
    (c) => updateDoc(doc(c.alice(), `users/${ALICE}`), { role: 'admin' })],
  ['[SEC] customer changes own id field', x('A', 'D', 'D'),
    (c) => updateDoc(doc(c.alice(), `users/${ALICE}`), { id: MALLORY })],
  ['[FUNC] customer updates own name', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.alice(), `users/${ALICE}`), { name: 'Alice B' })],
  ['[SEC] customer reads another user', x('D', 'D', 'D'),
    (c) => getDoc(doc(c.mallory(), `users/${ALICE}`))],
  ['[FUNC] admin reads a user', x('A', 'A', 'A'),
    (c) => getDoc(doc(c.admin(), `users/${ALICE}`))],
  ['[FUNC] admin changes a user role', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.admin(), `users/${ALICE}`), { role: 'admin' })],
  ['[SEC] customer adds self to admins/', x('D', 'D', 'D'),
    (c) => setDoc(doc(c.mallory(), `admins/${MALLORY}`), { x: 1 })],
  ['[FUNC] non-owner admin reads own admins doc (AdminGuard)', x('D', 'A', 'A'),
    (c) => getDoc(doc(c.admin(), `admins/${ADMIN}`))],
  ['[SEC] customer reads someone else admins doc', x('D', 'D', 'D'),
    (c) => getDoc(doc(c.mallory(), `admins/${ADMIN}`))],

  // ---------------- config ----------------
  ['[SEC] customer reads config/roles', x('D', 'D', 'D'),
    (c) => getDoc(doc(c.alice(), 'config/roles'))],
  ['[FUNC] admin reads config/roles (AdminGuard)', x('A', 'A', 'A'),
    (c) => getDoc(doc(c.admin(), 'config/roles'))],
  ['[SEC] non-owner admin reads config/sendgrid (API key)', x('A', 'D', 'D'),
    (c) => getDoc(doc(c.admin(), 'config/sendgrid'))],
  ['[FUNC] owner reads config/sendgrid', x('A', 'A', 'A'),
    (c) => getDoc(doc(c.owner(), 'config/sendgrid'))],
  ['[SEC] admin writes config/roles (owner only)', x('D', 'D', 'D'),
    (c) => setDoc(doc(c.admin(), 'config/roles'), { ownerUid: ADMIN })],

  // ---------------- products ----------------
  ['[FUNC] guest reads product', x('A', 'A', 'A'),
    (c) => getDoc(doc(c.guest(), 'products/p-simple'))],
  ['[SEC] customer changes price', x('D', 'D', 'D'),
    (c) => updateDoc(doc(c.alice(), 'products/p-simple'), { price: 0.01 })],
  ['[SEC] customer changes stock', x('D', 'D', 'D'),
    (c) => updateDoc(doc(c.alice(), 'products/p-simple'), { stock: 0 })],
  ['[SEC] customer changes variants', x('D', 'D', 'D'),
    (c) => updateDoc(doc(c.alice(), 'products/p-variants'), { variants: [] })],
  ['[SEC] customer sets rating 5 / count 9999 on any product', x('A', 'D', 'D'),
    (c) => updateDoc(doc(c.mallory(), 'products/p-simple'), aggregate(5, 9999))],
  ['[SEC] customer sets ratingAvg 50', x('A', 'D', 'D'),
    (c) => updateDoc(doc(c.mallory(), 'products/p-simple'), aggregate(50, 3))],
  ['[SEC] customer sets rating != ratingAvg', x('A', 'D', 'D'),
    (c) => updateDoc(doc(c.mallory(), 'products/p-simple'), aggregate(4.3, 3, { rating: 5 }))],
  ['[FUNC] reviews.ts aggregate sync after new review (+1)', x('A', 'A', 'D'),
    (c) => updateDoc(doc(c.alice(), 'products/p-simple'), aggregate(4.3, 3))],
  ['[FUNC] reviews.ts aggregate sync after edited review (count unchanged)', x('A', 'A', 'D'),
    (c) => updateDoc(doc(c.alice(), 'products/p-simple'), aggregate(4.5, 2))],
  ['[INFO] aggregate sync on legacy product with drifted counts (refused in compat)', x('A', 'D', 'D'),
    (c) => updateDoc(doc(c.alice(), 'products/p-drift'), aggregate(5, 3))],
  ['[FUNC] admin creates product', x('A', 'A', 'A'),
    (c) => setDoc(doc(c.admin(), 'products/p-new'), { name: 'جديد', price: 1, stock: 1, category: 'Toys' })],
  ['[FUNC] admin updates product (setDoc merge)', x('A', 'A', 'A'),
    (c) => setDoc(doc(c.admin(), 'products/p-variants'), { price: 4, variants: [{ id: 'var_1', label: 'أحمر', type: 'color', price: 4, stock: 9 }] }, { merge: true })],
  ['[FUNC] admin deletes product', x('A', 'A', 'A'),
    (c) => deleteDoc(doc(c.admin(), 'products/p-simple'))],

  // ---------------- reviews ----------------
  ['[FUNC] customer creates own review (upsertReview payload)', x('A', 'A', 'A'),
    (c) => setDoc(doc(c.mallory(), 'reviews/r-new'), reviewPayload(MALLORY))],
  ['[SEC] customer creates review as another user', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.mallory(), 'reviews/r-spoof'), reviewPayload(ALICE))],
  ['[SEC] customer creates review with rating 10', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.mallory(), 'reviews/r-ten'), reviewPayload(MALLORY, { rating: 10 }))],
  ['[SEC] customer creates review with forged adminReply', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.mallory(), 'reviews/r-forge'), reviewPayload(MALLORY, { adminReply: { text: 'رد رسمي', adminId: OWNER } }))],
  ['[FUNC] review author edits rating/comment', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.alice(), 'reviews/r-alice'), { rating: 5, comment: 'ممتاز', updatedAt: serverTimestamp() })],
  ['[SEC] review author re-publishes a review the admin hid', x('A', 'D', 'D'),
    (c) => updateDoc(doc(c.alice(), 'reviews/r-alice-hidden'), { status: 'published', updatedAt: serverTimestamp() })],
  ['[SEC] review author forges adminReply', x('A', 'D', 'D'),
    (c) => updateDoc(doc(c.alice(), 'reviews/r-alice'), { adminReply: { text: 'x' } })],
  ['[FUNC] user toggles own like (toggleLike)', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.alice(), 'reviews/r-alice'), { likesBy: { [MALLORY]: true, [ALICE]: true }, likesCount: 2, updatedAt: serverTimestamp() })],
  ['[SEC] user removes other users likes', x('A', 'D', 'D'),
    (c) => updateDoc(doc(c.alice(), 'reviews/r-alice'), { likesBy: {}, likesCount: 0 })],
  ['[SEC] user sets likesCount 9999', x('A', 'D', 'D'),
    (c) => updateDoc(doc(c.mallory(), 'reviews/r-alice'), { likesBy: {}, likesCount: 9999 })],
  ['[FUNC] admin hides review (setStatus)', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.admin(), 'reviews/r-alice'), { status: 'hidden', updatedAt: serverTimestamp() })],
  ['[FUNC] admin deletes review', x('A', 'A', 'A'),
    (c) => deleteDoc(doc(c.admin(), 'reviews/r-alice'))],

  // =====================================================================
  // Added 2026-11-04: deployed-checkout compatibility, owner vs admin, v2 orders, config, extra abuse cases
  // =====================================================================

  // ---------------- orders: deployed Checkout (origin/main) shapes that compat must accept ----------------
  ['[FUNC] deployed payload: guest COD, all optional values empty (no note/paymentDetails/email/ammanAreaId, fallbacks)', x('A', 'A', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00020-MINI'), minimalDeployedOrder('ORD-NEW00020-MINI'))],
  ['[FUNC] deployed payload: long free text the form does not limit (name 250, street 1200, note 2500, CliQ ref 250)', x('A', 'A', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00021-LONG'), checkoutOrder({
      id: 'ORD-NEW00021-LONG', userId: 'guest', payment: 'cliq',
      overrides: {
        note: 'ن'.repeat(2500),
        paymentDetails: { cliqReference: 'R'.repeat(250), isPaid: false },
        address: { fullName: 'ا'.repeat(250), city: 'عمّان (العاصمة) - '.repeat(5), street: 'ش'.repeat(1200), phone: '+962791234567' },
      },
    }))],
  ['[FUNC] deployed payload: 150 cart lines', x('A', 'A', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00022-MANY'), checkoutOrder({ id: 'ORD-NEW00022-MANY', userId: 'guest', overrides: { items: manyItems(150) } }))],
  ['[FUNC] deployed payload: free shipping (0) + discount, express method', x('A', 'A', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00023-FREE'), checkoutOrder({ id: 'ORD-NEW00023-FREE', userId: 'guest', overrides: { shippingCost: 0, discountAmount: 2, total: 6, shippingMethodId: 'express', shippingMethod: 'توصيل سريع' } }))],
  ['[FUNC] signed-in customer places own CliQ order', x('A', 'A', 'D'),
    (c) => setDoc(doc(c.mallory(), 'orders/ORD-NEW00024-MCLQ'), checkoutOrder({ id: 'ORD-NEW00024-MCLQ', userId: MALLORY, payment: 'cliq' }))],

  // ---------------- orders: create abuse ----------------
  ['[SEC] signed-out guest creates order under a real customer uid', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00025-GSPF'), checkoutOrder({ id: 'ORD-NEW00025-GSPF', userId: ALICE }))],
  ['[SEC] extra key smuggled inside consents', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00026-CONS'), checkoutOrder({ id: 'ORD-NEW00026-CONS', userId: 'guest', overrides: { consents: { acceptedStorePolicies: true, isPaid: true } } }))],
  ['[SEC] extra key smuggled inside addressMeta', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00027-AMET'), checkoutOrder({ id: 'ORD-NEW00027-AMET', userId: 'guest', overrides: { addressMeta: { country: 'Jordan', verifiedByAdmin: true } } }))],
  ['[SEC] addressMeta is not a map', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00028-AMST'), checkoutOrder({ id: 'ORD-NEW00028-AMST', userId: 'guest', overrides: { addressMeta: 'x'.repeat(1000) } }))],
  ['[SEC] empty items list', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00029-EMPT'), checkoutOrder({ id: 'ORD-NEW00029-EMPT', userId: 'guest', overrides: { items: [] } }))],
  ['[SEC] 201 items', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00030-201I'), checkoutOrder({ id: 'ORD-NEW00030-201I', userId: 'guest', overrides: { items: manyItems(201) } }))],
  ['[SEC] seenByAdmin true on create', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00031-SEEN'), checkoutOrder({ id: 'ORD-NEW00031-SEEN', userId: 'guest', overrides: { seenByAdmin: true } }))],
  ['[SEC] unknown payment method', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00032-CARD'), checkoutOrder({ id: 'ORD-NEW00032-CARD', userId: 'guest', payment: 'card' }))],
  ['[SEC] negative total', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00033-NEGT'), checkoutOrder({ id: 'ORD-NEW00033-NEGT', userId: 'guest', overrides: { total: -5 } }))],
  ['[SEC] createdAtMs as a string', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00034-MSST'), checkoutOrder({ id: 'ORD-NEW00034-MSST', userId: 'guest', overrides: { createdAtMs: 'yesterday' } }))],
  ['[SEC] note longer than 3000 chars', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00035-N301'), checkoutOrder({ id: 'ORD-NEW00035-N301', userId: 'guest', overrides: { note: 'x'.repeat(3001) } }))],

  // ---------------- orders: cross-account reads ----------------
  ['[SEC] customer lists where userId == another customer', x('D', 'D', 'D'),
    (c) => getDocs(query(collection(c.alice(), 'orders'), where('userId', '==', MALLORY)))],
  ['[SEC] customer reads another customer order by id (Alice -> Mallory)', x('A', 'A', 'D'),
    (c) => getDoc(doc(c.alice(), 'orders/ORD-MALLORY1-DDDD'))],
  ['[SEC] attacker reads victim Worker-v2 order by id', x('A', 'A', 'D'),
    (c) => getDoc(doc(c.mallory(), `orders/${V2_ORDER}`))],
  ['[FUNC] customer reads own Worker-v2 order by id (verified email match)', x('A', 'A', 'A'),
    (c) => getDoc(doc(c.alice(), `orders/${V2_ORDER}`))],
  ['[INFO] customer queries where claimedUserId == own uid (unverified claim) -> denied', x('D', 'D', 'D'),
    (c) => getDocs(query(collection(c.alice(), 'orders'), where('claimedUserId', '==', ALICE)))],
  ['[SEC] attacker queries where claimedUserId == victim uid', x('D', 'D', 'D'),
    (c) => getDocs(query(collection(c.mallory(), 'orders'), where('claimedUserId', '==', ALICE)))],
  ['[SEC] customer updates own Worker-v2 order', x('D', 'D', 'D'),
    (c) => updateDoc(doc(c.alice(), `orders/${V2_ORDER}`), { status: 'cancelled' })],
  ['[FUNC] admin updates status of a Worker-v2 order', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.admin(), `orders/${V2_ORDER}`), { status: 'shipped', seenByAdmin: true, updatedAt: serverTimestamp() })],

  // ---------------- owner (config/roles.ownerUid) ----------------
  ['[FUNC] owner lists all orders', x('A', 'A', 'A'),
    (c) => getDocs(collection(c.owner(), 'orders'))],
  ['[FUNC] owner updates order status', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.owner(), 'orders/ORD-ALICE001-AAAA'), { status: 'shipped', seenByAdmin: true, updatedAt: serverTimestamp() })],
  ['[FUNC] owner adds an admin', x('A', 'A', 'A'),
    (c) => setDoc(doc(c.owner(), 'admins/new-admin-uid'), { addedBy: OWNER })],
  ['[FUNC] owner removes an admin', x('A', 'A', 'A'),
    (c) => deleteDoc(doc(c.owner(), `admins/${ADMIN2}`))],
  ['[FUNC] owner reads any admins doc', x('A', 'A', 'A'),
    (c) => getDoc(doc(c.owner(), `admins/${ADMIN2}`))],
  ['[FUNC] owner reads config/roles', x('A', 'A', 'A'),
    (c) => getDoc(doc(c.owner(), 'config/roles'))],
  ['[FUNC] owner writes config/roles', x('A', 'A', 'A'),
    (c) => setDoc(doc(c.owner(), 'config/roles'), { ownerUid: OWNER })],
  ['[FUNC] owner reads other config docs', x('A', 'A', 'A'),
    (c) => getDoc(doc(c.owner(), 'config/other'))],
  ['[FUNC] owner creates product', x('A', 'A', 'A'),
    (c) => setDoc(doc(c.owner(), 'products/p-owner'), { name: 'منتج', price: 2, stock: 4, category: 'Toys' })],
  ['[FUNC] owner changes price and stock', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.owner(), 'products/p-simple'), { price: 3, stock: 20 })],
  ['[FUNC] owner reads a user and changes a role', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.owner(), `users/${ALICE}`), { role: 'customer' })],
  ['[FUNC] owner deletes a user doc', x('A', 'A', 'A'),
    (c) => deleteDoc(doc(c.owner(), `users/${MALLORY}`))],
  ['[FUNC] owner hides a review', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.owner(), 'reviews/r-alice'), { status: 'hidden', updatedAt: serverTimestamp() })],

  // ---------------- non-owner admin (admins/{uid}) ----------------
  ['[FUNC] admin changes price and stock', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.admin(), 'products/p-simple'), { price: 3, stock: 20 })],
  ['[FUNC] admin replies to a review', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.admin(), 'reviews/r-alice'), { adminReply: { text: 'شكرًا', adminId: ADMIN }, updatedAt: serverTimestamp() })],
  ['[SEC] admin adds another admin (owner only)', x('D', 'D', 'D'),
    (c) => setDoc(doc(c.admin(), 'admins/someone'), { addedBy: ADMIN })],
  ['[SEC] admin removes another admin', x('D', 'D', 'D'),
    (c) => deleteDoc(doc(c.admin(), `admins/${ADMIN2}`))],
  ['[SEC] admin reads another admin doc', x('D', 'D', 'D'),
    (c) => getDoc(doc(c.admin(), `admins/${ADMIN2}`))],
  ['[SEC] admin reads config docs other than roles', x('A', 'D', 'A'),
    (c) => getDoc(doc(c.admin(), 'config/other'))],
  ['[SEC] admin deletes a user doc (owner only)', x('D', 'D', 'D'),
    (c) => deleteDoc(doc(c.admin(), `users/${ALICE}`))],

  // ---------------- config/sendgrid for everyone else ----------------
  ['[SEC] customer reads config/sendgrid', x('D', 'D', 'D'),
    (c) => getDoc(doc(c.alice(), 'config/sendgrid'))],
  ['[SEC] guest reads config/sendgrid', x('D', 'D', 'D'),
    (c) => getDoc(doc(c.guest(), 'config/sendgrid'))],
  ['[SEC] admin writes config/sendgrid', x('D', 'D', 'D'),
    (c) => setDoc(doc(c.admin(), 'config/sendgrid'), { apikey: 'x' })],

  // ---------------- users / role ----------------
  ['[SEC] customer removes the role field from own doc', x('A', 'D', 'D'),
    (c) => updateDoc(doc(c.alice(), `users/${ALICE}`), { role: deleteField() })],
  ['[SEC] customer setDoc(merge) role=admin on own existing doc', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.alice(), `users/${ALICE}`), { role: 'admin' }, { merge: true })],
  ['[INFO] doc that already says role=admin (old rules) keeps it: self-update of name still allowed -> needs data cleanup', x('A', 'A', 'A'),
    (c) => updateDoc(doc(c.legacy(), `users/${LEGACY}`), { name: 'Legacy' })],
  ['[SEC] role=admin in users doc grants NO data access (admin list of all orders)', x('D', 'D', 'D'),
    (c) => getDocs(collection(c.legacy(), 'orders'))],
  ['[SEC] role=admin in users doc grants NO product writes', x('D', 'D', 'D'),
    (c) => updateDoc(doc(c.legacy(), 'products/p-simple'), { price: 0.01 })],

  // ---------------- products: price / stock / ratings ----------------
  ['[SEC] guest updates product', x('D', 'D', 'D'),
    (c) => updateDoc(doc(c.guest(), 'products/p-simple'), { stock: 0 })],
  ['[SEC] customer setDoc(merge) price', x('D', 'D', 'D'),
    (c) => setDoc(doc(c.mallory(), 'products/p-simple'), { price: 0.01 }, { merge: true })],
  ['[SEC] customer deletes product', x('D', 'D', 'D'),
    (c) => deleteDoc(doc(c.mallory(), 'products/p-simple'))],
  ['[SEC] customer creates product', x('D', 'D', 'D'),
    (c) => setDoc(doc(c.mallory(), 'products/p-fake'), { name: 'x', price: 0, stock: 1 })],
  ['[SEC] customer sets ratingCount -1', x('A', 'D', 'D'),
    (c) => updateDoc(doc(c.mallory(), 'products/p-simple'), aggregate(4, -1))],
  ['[INFO] customer pushes ratingAvg to 0 with count +1 (residual in compat; Worker in target)', x('A', 'A', 'D'),
    (c) => updateDoc(doc(c.mallory(), 'products/p-simple'), aggregate(0, 3))],

  // ---------------- reviews ----------------
  ['[SEC] customer deletes own review (admin only)', x('D', 'D', 'D'),
    (c) => deleteDoc(doc(c.alice(), 'reviews/r-alice'))],
  ['[SEC] customer hides another customer review', x('D', 'D', 'D'),
    (c) => updateDoc(doc(c.mallory(), 'reviews/r-alice'), { status: 'hidden' })],
  ['[SEC] review with rating 0', x('A', 'D', 'D'),
    (c) => setDoc(doc(c.mallory(), 'reviews/r-zero'), reviewPayload(MALLORY, { rating: 0 }))],
  ['[SEC] guest creates review', x('D', 'D', 'D'),
    (c) => setDoc(doc(c.guest(), 'reviews/r-guest'), reviewPayload('guest'))],
];

// Order READS in final/transition: only admins and the verified owner (userId == uid). No public get, no e-mail match.
const FINAL_TRANSITION = {
  '[SEC] guest reads any order by id (name/phone/address)': { final: 'D', transition: 'D' },
  '[SEC] signed-in attacker reads victim order by id': { final: 'D', transition: 'D' },
  '[FUNC] customer reads guest order placed with her verified email': { final: 'D', transition: 'D' },
  '[SEC] unverified email cannot read guest order by email match (target)': { final: 'D', transition: 'D' },
  '[FUNC] Account.tsx: list where customerEmail == own verified email (broken in prod)': { final: 'D', transition: 'D' },
  '[SEC] customer reads another customer order by id (Alice -> Mallory)': { final: 'D', transition: 'D' },
  '[SEC] attacker reads victim Worker-v2 order by id': { final: 'D', transition: 'D' },
  '[FUNC] customer reads own Worker-v2 order by id (verified email match)': { final: 'D', transition: 'D' },
};
for (const [title, exp] of CASES) if (FINAL_TRANSITION[title]) Object.assign(exp, FINAL_TRANSITION[title]);
const missingNames = Object.keys(FINAL_TRANSITION).filter((k) => !CASES.some(([title]) => title === k));
if (missingNames.length) throw new Error('FINAL_TRANSITION names unknown cases: ' + missingNames.join(' | '));

const y = (prod, compat, target, final, transition) => ({ prod, compat, target, final, transition });
CASES.push(
  ['[FUNC] Account.tsx (new): list where userId == own uid', y('A', 'A', 'A', 'A', 'A'),
    (c) => getDocs(query(collection(c.alice(), 'orders'), where('userId', '==', ALICE)))],
  ['[SEC] guest lists orders where userId == guest', y('D', 'D', 'D', 'D', 'D'),
    (c) => getDocs(query(collection(c.guest(), 'orders'), where('userId', '==', 'guest')))],
  ['[SEC] signed-in customer reads a GUEST order by id (no e-mail rights any more)', y('A', 'A', 'A', 'D', 'D'),
    (c) => getDoc(doc(c.alice(), 'orders/ORD-GUEST001-BBBB'))],
  ['[FUNC] owner reads any order by id', y('A', 'A', 'A', 'A', 'A'),
    (c) => getDoc(doc(c.owner(), 'orders/ORD-GUEST001-BBBB'))],
  ['[FUNC] non-owner admin reads any order by id', y('A', 'A', 'A', 'A', 'A'),
    (c) => getDoc(doc(c.admin(), 'orders/ORD-GUEST001-BBBB'))],
  ['[FUNC] non-owner admin marks an order fraud (status-only update)', y('A', 'A', 'A', 'A', 'A'),
    (c) => updateDoc(doc(c.admin(), 'orders/ORD-GUEST001-BBBB'), { status: 'fraud', seenByAdmin: true, updatedAt: serverTimestamp() })],
  ['[SEC] browser writes an order directly (deployed Checkout payload)', y('A', 'A', 'D', 'D', 'A'),
    (c) => setDoc(doc(c.guest(), 'orders/ORD-NEW00040-DIRC'), checkoutOrder({ id: 'ORD-NEW00040-DIRC', userId: 'guest' }))],
  ['[SEC] client reads orderLedger (tracking-key hashes live there)', y('D', 'D', 'D', 'D', 'D'),
    (c) => getDoc(doc(c.alice(), 'orderLedger/ORD-ALICE001-AAAA'))],
);

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
for (const name of selected) {
  describe(`ruleset: ${name}`, () => {
    let env;

    before(async () => {
      env = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
          rules: readFileSync(RULESETS[name], 'utf8'),
          host: emuHost,
          port: Number(emuPort),
        },
      });
    });

    after(async () => {
      await env?.cleanup();
    });

    beforeEach(async () => {
      await env.clearFirestore();
      await seed(env);
    });

    for (const [title, expect, run] of CASES) {
      const want = expect[name];
      test(`[${name}] ${want === 'A' ? 'ALLOW' : 'DENY '} ${title}`, async () => {
        const op = run(ctx(env));
        if (want === 'A') await assertSucceeds(op);
        else await assertFails(op);
      });
    }

    // ---- Impact of Worker v2 orders (userId 'guest' + unverified claimedUserId) on what Alice's pages SEE.
    //      Same queries as the app: MyOrders.tsx / storage.ts getByUserId + hasPurchasedProduct, Account.tsx.
    const ids = (snap) => snap.docs.map((d) => d.id).sort();
    test(`[${name}] IMPACT MyOrders (userId == uid) does NOT show Alice's Worker-v2 order`, async () => {
      const snap = await assertSucceeds(getDocs(query(collection(ctx(env).alice(), 'orders'), where('userId', '==', ALICE))));
      assert.deepEqual(ids(snap), ['ORD-ALICE001-AAAA']);
    });
    test(`[${name}] IMPACT review purchase check (userId == uid) finds no purchase from the DELIVERED v2 order`, async () => {
      const snap = await assertSucceeds(getDocs(query(collection(ctx(env).alice(), 'orders'), where('userId', '==', ALICE))));
      const bought = snap.docs.some((d) => ['processing', 'shipped', 'delivered'].includes(d.data().status) && (d.data().items || []).some((i) => i.productId === 'p-simple'));
      assert.equal(bought, false);
    });
    const emailReads = name === 'compat' || name === 'target';
    test(`[${name}] IMPACT Account.tsx (customerEmail == verified email) ${emailReads ? 'shows the v2 order' : 'is denied (no e-mail based reads)'}`, async () => {
      const q = query(collection(ctx(env).alice(), 'orders'), where('customerEmail', '==', 'alice@example.com'));
      if (!emailReads) return void (await assertFails(getDocs(q)));
      const snap = await assertSucceeds(getDocs(q));
      assert.ok(ids(snap).includes(V2_ORDER));
      assert.ok(!ids(snap).includes('ORD-MALLORY1-DDDD'));
    });
    test(`[${name}] IMPACT Account.tsx with an UNVERIFIED email is denied (no reading by typed email)`, async () => {
      const q = query(collection(ctx(env).aliceUnverified(), 'orders'), where('customerEmail', '==', 'alice@example.com'));
      await assertFails(getDocs(q));
    });
  });
}
