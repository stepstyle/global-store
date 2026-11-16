// firestore.rules.final vs the storefront's REAL Firestore calls — EMULATOR ONLY (demo- project).
// Every case replays an operation the current frontend code performs (same collection, query shape and payload,
// file:line in the case name), so a rule that would break a page shows up here — not only the rule table.
//   firebase emulators:exec --only firestore --project demo-dairsharaf-rules --config firebase.json "node --test app-paths.final.test.mjs"
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, getDocs, collection, query, where, orderBy, serverTimestamp, deleteField } from 'firebase/firestore';

const PROJECT_ID = 'demo-dairsharaf-rules';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Refusing: FIRESTORE_EMULATOR_HOST must be a local emulator');
if (!PROJECT_ID.startsWith('demo-')) throw new Error('Refusing: demo- project only');
const [eh, ep] = host.split(':');
const RULES = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'firestore.rules.final'), 'utf8');

const OWNER = 'owner-uid';
const ADMIN = 'admin-uid';
const ALICE = 'alice-uid';
const MALLORY = 'mallory-uid';
const NEWBIE = 'newbie-uid';
const ORD_ALICE = 'ORD-ALICE001-AAAA'; // created by the Worker from Alice's verified ID token (userId = uid)
const ORD_GUEST = 'ORD-GUEST001-BBBB'; // guest order created by the Worker
let env;

const as = {
  guest: () => env.unauthenticatedContext().firestore(),
  owner: () => env.authenticatedContext(OWNER, { email: 'owner@example.com', email_verified: true }).firestore(),
  admin: () => env.authenticatedContext(ADMIN, { email: 'admin@example.com', email_verified: true }).firestore(),
  alice: () => env.authenticatedContext(ALICE, { email: 'alice@example.com', email_verified: true }).firestore(),
  mallory: () => env.authenticatedContext(MALLORY, { email: 'mallory@example.com', email_verified: true }).firestore(),
  newbie: () => env.authenticatedContext(NEWBIE, { email: 'newbie@example.com', email_verified: false }).firestore(),
};

// Worker-written order (service account; createdAt = server timestamp)
const workerOrder = (id, userId, email) => ({
  id, userId, status: 'new', seenByAdmin: false, date: '2026-11-06', createdAt: new Date('2026-11-06T08:00:00Z'), createdAtMs: 1793700000000,
  items: [{ productId: 'p1', name: 'دفتر', price: 2.5, quantity: 1 }], subtotal: 2.5, discountAmount: 0, shippingCost: 1, total: 3.5,
  paymentMethod: 'cod', customerEmail: email, address: { fullName: 'Synthetic', city: 'Amman', street: 'x', phone: '+962790000000' }, source: 'worker-v2',
});

before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host: eh, port: Number(ep), rules: RULES } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'config/roles'), { ownerUid: OWNER });
    await setDoc(doc(db, 'config/sendgrid'), { apiKey: 'fake-not-a-key' });
    await setDoc(doc(db, `admins/${ADMIN}`), { email: 'admin@example.com' });
    await setDoc(doc(db, 'products/p1'), { name: 'دفتر', price: 2.5, stock: 10, category: 'Stationery', ratingAvg: 0, ratingCount: 0, rating: 0, reviews: 0 });
    await setDoc(doc(db, 'categories/Stationery'), { name: 'قرطاسية' });
    await setDoc(doc(db, `orders/${ORD_ALICE}`), workerOrder(ORD_ALICE, ALICE, 'alice@example.com'));
    await setDoc(doc(db, `orders/${ORD_GUEST}`), workerOrder(ORD_GUEST, 'guest', 'alice@example.com'));
    await setDoc(doc(db, `orderLedger/${ORD_GUEST}`), { orderId: ORD_GUEST });
    await setDoc(doc(db, 'stagingMarker/marker'), { syntheticDataOnly: true });
    await setDoc(doc(db, `users/${ALICE}`), { id: ALICE, name: 'Alice', email: 'alice@example.com', role: 'customer' });
    await setDoc(doc(db, 'reviews/r1'), { productId: 'p1', userId: ALICE, userName: 'Alice', userEmail: 'alice@example.com', rating: 4, comment: 'ok', status: 'published', likesCount: 0, likesBy: {}, adminReply: null });
  });
});

// ------------------------------------------------------------------ catalogue (storage.ts products.getAll/list/getById)
test('WORKS products: guest lists all, queries by category, reads one (storage.ts:194/285/299)', async () => {
  await assertSucceeds(getDocs(collection(as.guest(), 'products')));
  await assertSucceeds(getDocs(query(collection(as.guest(), 'products'), where('category', '==', 'Stationery'))));
  await assertSucceeds(getDoc(doc(as.guest(), 'products/p1')));
  await assertSucceeds(getDocs(collection(as.guest(), 'categories')));
});

test('BLOCKED price / stock changes by anyone but an admin (storage.ts updateStock:314 / update:360)', async () => {
  for (const who of ['guest', 'alice', 'newbie']) {
    await assertFails(updateDoc(doc(as[who](), 'products/p1'), { stock: 0 }));
    await assertFails(updateDoc(doc(as[who](), 'products/p1'), { price: 0.01 }));
    await assertFails(setDoc(doc(as[who](), 'products/p1'), { name: 'دفتر', price: 0.01, stock: 999 }, { merge: true }));
    await assertFails(setDoc(doc(as[who](), 'products/new'), { name: 'x', price: 1 }));
    await assertFails(deleteDoc(doc(as[who](), 'products/p1')));
  }
  await assertSucceeds(updateDoc(doc(as.admin(), 'products/p1'), { price: 3 }));
  await assertSucceeds(setDoc(doc(as.owner(), 'products/new'), { name: 'x', price: 1 }));
});

// ------------------------------------------------------------------ orders
test('BLOCKED direct order creation in Firestore — guests and signed-in (old storage.ts db.orders.create:476, unused)', async () => {
  const o = { ...workerOrder('ORD-NEW00001-CCCC', 'guest', 'x@example.com'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertFails(setDoc(doc(as.guest(), 'orders/ORD-NEW00001-CCCC'), o));
  await assertFails(setDoc(doc(as.alice(), 'orders/ORD-NEW00002-CCCC'), { ...o, id: 'ORD-NEW00002-CCCC', userId: ALICE }));
});

test('PROTECTED order reads: no read by id for guests/others, no e-mail match, no unfiltered list', async () => {
  await assertFails(getDoc(doc(as.guest(), `orders/${ORD_GUEST}`)));
  await assertFails(getDoc(doc(as.guest(), `orders/${ORD_ALICE}`)));
  await assertFails(getDoc(doc(as.mallory(), `orders/${ORD_ALICE}`)));
  await assertFails(getDocs(query(collection(as.mallory(), 'orders'), where('userId', '==', ALICE))));
  await assertFails(getDocs(collection(as.alice(), 'orders')));
  await assertFails(getDocs(query(collection(as.alice(), 'orders'), where('customerEmail', '==', 'alice@example.com'))), 'guest order with her e-mail: not hers');
  await assertFails(getDoc(doc(as.alice(), `orderLedger/${ORD_GUEST}`)));
  await assertFails(getDoc(doc(as.guest(), 'stagingMarker/marker')));
});

test('WORKS account pages: own orders by verified uid (Account.tsx:64 no orderBy; MyOrders/hasPurchasedProduct storage.ts:417 + orderBy)', async () => {
  const a = await assertSucceeds(getDocs(query(collection(as.alice(), 'orders'), where('userId', '==', ALICE))));
  if (a.size !== 1) throw new Error(`expected Alice's 1 order, got ${a.size}`);
  await assertSucceeds(getDocs(query(collection(as.alice(), 'orders'), where('userId', '==', ALICE), orderBy('createdAt', 'desc'))));
  await assertSucceeds(getDoc(doc(as.alice(), `orders/${ORD_ALICE}`)));
});

test('WORKS admin dashboard: list all orders (storage.ts:383/405), update status (storage.ts:508); nothing else', async () => {
  await assertSucceeds(getDocs(query(collection(as.admin(), 'orders'), orderBy('createdAt', 'desc'))));
  await assertSucceeds(updateDoc(doc(as.admin(), `orders/${ORD_GUEST}`), { status: 'processing', seenByAdmin: true, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as.admin(), `orders/${ORD_GUEST}`), { total: 0 }));
  await assertFails(updateDoc(doc(as.alice(), `orders/${ORD_ALICE}`), { status: 'delivered', seenByAdmin: true, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(as.admin(), `orders/${ORD_GUEST}`)), 'AdminDashboard.tsx:511 delete: owner only');
  await assertSucceeds(deleteDoc(doc(as.owner(), `orders/${ORD_GUEST}`)));
});

// ------------------------------------------------------------------ users / admin guard
test('users: registration doc (storage.ts:597-606) allowed as customer only; own read (App.tsx:298); others protected', async () => {
  const reg = { id: NEWBIE, name: 'New', email: 'newbie@example.com', role: 'customer', orders: [], createdAt: new Date().toISOString() };
  await assertSucceeds(setDoc(doc(as.newbie(), `users/${NEWBIE}`), reg));
  await env.clearFirestore();
  await assertFails(setDoc(doc(as.newbie(), `users/${NEWBIE}`), { ...reg, role: 'admin' }));
  await assertFails(setDoc(doc(as.newbie(), `users/${NEWBIE}`), { ...reg, id: ALICE }));
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `users/${ALICE}`), { id: ALICE, role: 'customer', name: 'Alice' }));
  await assertSucceeds(getDoc(doc(as.alice(), `users/${ALICE}`)));
  await assertFails(getDoc(doc(as.mallory(), `users/${ALICE}`)));
  await assertFails(getDocs(collection(as.mallory(), 'users')));
  await assertFails(updateDoc(doc(as.alice(), `users/${ALICE}`), { role: 'admin' }));
  await assertSucceeds(updateDoc(doc(as.alice(), `users/${ALICE}`), { name: 'Alice B' }));
});

test('admin guard (AdminGuard.tsx:13/21): admin reads config/roles + own admins doc; customers / sendgrid denied', async () => {
  await assertSucceeds(getDoc(doc(as.admin(), 'config/roles')));
  await assertSucceeds(getDoc(doc(as.admin(), `admins/${ADMIN}`)));
  await assertFails(getDoc(doc(as.alice(), 'config/roles')), 'AdminGuard catches this and denies access');
  await assertFails(getDoc(doc(as.admin(), 'config/sendgrid')));
  await assertSucceeds(getDoc(doc(as.owner(), 'config/sendgrid')));
});

// ------------------------------------------------------------------ reviews (reviews.ts)
test('WORKS reviews: public read; add (reviews.ts:234), author edit (:251), like (:323), admin status (:369) / reply (:406) / delete', async () => {
  await assertSucceeds(getDocs(query(collection(as.guest(), 'reviews'), where('productId', '==', 'p1'))));
  await assertSucceeds(addDoc(collection(as.mallory(), 'reviews'), { productId: 'p1', userId: MALLORY, userName: 'M', rating: 5, comment: 'good', status: 'published', likesCount: 0, likesBy: {}, adminReply: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as.alice(), 'reviews/r1'), { rating: 5, comment: 'better', userName: 'Alice', userEmail: deleteField(), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as.mallory(), 'reviews/r1'), { likesBy: { [MALLORY]: true }, likesCount: 1, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as.admin(), 'reviews/r1'), { status: 'hidden', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as.admin(), 'reviews/r1'), { adminReply: { text: 'thanks', adminId: ADMIN, adminName: 'Admin', atMs: 1 }, updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(as.admin(), 'reviews/r1')));
});

test('BLOCKED review abuse: fake likes, editing others, self-hidden/replied, guest review, admin actions by customers', async () => {
  await assertFails(addDoc(collection(as.guest(), 'reviews'), { productId: 'p1', userId: 'guest', rating: 5 }));
  await assertFails(addDoc(collection(as.mallory(), 'reviews'), { productId: 'p1', userId: ALICE, rating: 5, likesCount: 0 }));
  await assertFails(addDoc(collection(as.mallory(), 'reviews'), { productId: 'p1', userId: MALLORY, rating: 5, likesCount: 50 }));
  await assertFails(updateDoc(doc(as.mallory(), 'reviews/r1'), { rating: 1, comment: 'bad', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as.mallory(), 'reviews/r1'), { likesBy: { x: true, y: true }, likesCount: 2, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as.alice(), 'reviews/r1'), { adminReply: { text: 'self' }, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as.alice(), 'reviews/r1'), { status: 'hidden', updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(as.alice(), 'reviews/r1')));
});

// ------------------------------------------------------------------ what final BREAKS (documented, expected to fail)
test('BREAKS rating aggregate from the browser: syncProductAggregate (reviews.ts:110) by a customer is denied', async () => {
  const agg = { ratingAvg: 4.5, ratingCount: 2, rating: 4.5, reviews: 2, updatedAt: serverTimestamp() };
  await assertFails(updateDoc(doc(as.mallory(), 'products/p1'), agg), 'customer add/edit/like path: aggregate stays stale');
  await assertSucceeds(updateDoc(doc(as.admin(), 'products/p1'), agg), 'admin status/delete path still updates it');
});

test('GAP (not enforced by rules): a signed-in user who never bought the product can still create a review', async () => {
  // reviews.ts requirePurchased() is a CLIENT-side check only
  await assertSucceeds(addDoc(collection(as.newbie(), 'reviews'), { productId: 'p1', userId: NEWBIE, userName: 'N', rating: 1, comment: 'x', status: 'published', likesCount: 0, likesBy: {}, adminReply: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});

test('PRIVACY: no e-mail can be (re)written into a public review; an author may only REMOVE an old one', async () => {
  const base = { productId: 'p1', userId: MALLORY, userName: 'M', rating: 5, comment: 'good', status: 'published', likesCount: 0, likesBy: {}, adminReply: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertFails(addDoc(collection(as.mallory(), 'reviews'), { ...base, userEmail: 'mallory@example.com' }), 'new review with an e-mail');
  await assertSucceeds(addDoc(collection(as.mallory(), 'reviews'), base), 'the app\'s payload (reviews.ts) — no e-mail');
  await assertFails(updateDoc(doc(as.alice(), 'reviews/r1'), { rating: 5, comment: 'x', userName: 'Alice', userEmail: 'new@example.com', updatedAt: serverTimestamp() }), 'author re-writes an e-mail');
  await assertSucceeds(updateDoc(doc(as.alice(), 'reviews/r1'), { rating: 4, comment: 'ok', userName: 'Alice', userEmail: deleteField(), updatedAt: serverTimestamp() }), 'author removes the old e-mail');
  const after = await assertSucceeds(getDoc(doc(as.guest(), 'reviews/r1')));
  if ('userEmail' in after.data()) throw new Error('e-mail still public after the author edit');
  // reading reviews stays public (display unchanged)
  await assertSucceeds(getDocs(query(collection(as.guest(), 'reviews'), where('productId', '==', 'p1'))));
});

test('KNOWN (old data): reviews written BEFORE the fix still carry userEmail until the one-off cleanup', async () => {
  const s = await assertSucceeds(getDoc(doc(as.guest(), 'reviews/r1')));
  if (s.data().userEmail !== 'alice@example.com') throw new Error('fixture changed');
});

// ------------------------------------------------------------------ Telegram order approval (order.approval)
test('APPROVAL: pending orders cannot be decided from the dashboard; accepted ones only ship/deliver; legacy unchanged', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'orders/ORD-APPRPEND-AAAA'), { ...workerOrder('ORD-APPRPEND-AAAA', 'guest', 'x@example.com'), approval: { policy: 'telegram', state: 'pending' } });
    await setDoc(doc(db, 'orders/ORD-APPRACCP-AAAA'), { ...workerOrder('ORD-APPRACCP-AAAA', 'guest', 'x@example.com'), status: 'processing', approval: { policy: 'telegram', state: 'accepted' } });
  });
  const upd = (who, id, status) => updateDoc(doc(as[who](), `orders/${id}`), { status, seenByAdmin: true, updatedAt: serverTimestamp() });
  // pending: no accept / reject / cancel / fraud from the dashboard (the Worker decides, with the stock)
  for (const s of ['processing', 'cancelled', 'shipped', 'fraud', 'delivered']) await assertFails(upd('admin', 'ORD-APPRPEND-AAAA', s), `pending -> ${s}`);
  await assertSucceeds(updateDoc(doc(as.admin(), 'orders/ORD-APPRPEND-AAAA'), { seenByAdmin: true, updatedAt: serverTimestamp() }), 'marking as seen is fine');
  // accepted: only processing -> shipped -> delivered (cancelling must restock -> Telegram)
  await assertSucceeds(upd('admin', 'ORD-APPRACCP-AAAA', 'shipped'));
  await assertSucceeds(upd('admin', 'ORD-APPRACCP-AAAA', 'delivered'));
  await assertFails(upd('admin', 'ORD-APPRACCP-AAAA', 'cancelled'));
  await assertFails(upd('admin', 'ORD-APPRACCP-AAAA', 'new'));
  // nobody can write / fake / remove the approval marker
  await assertFails(updateDoc(doc(as.admin(), 'orders/ORD-APPRPEND-AAAA'), { approval: { policy: 'telegram', state: 'accepted' } }));
  await assertFails(updateDoc(doc(as.owner(), 'orders/ORD-APPRPEND-AAAA'), { status: 'processing', approval: { policy: 'telegram', state: 'accepted' } }));
  await assertFails(updateDoc(doc(as.alice(), `orders/${ORD_ALICE}`), { status: 'processing' }), 'customer cannot accept her own order');
  // legacy orders (no approval field): unchanged — the admin may still cancel / accept as before
  await assertSucceeds(upd('admin', ORD_GUEST, 'processing'));
  await assertSucceeds(upd('admin', ORD_GUEST, 'cancelled'));
  // products: no client can change stock (the Worker does, with its service account)
  await assertFails(updateDoc(doc(as.alice(), 'products/p1'), { stock: 999 }));
});
