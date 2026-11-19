// Orders: LIVE rules (firestore.rules.on-delivery) vs the proposed FINAL rules (firestore.rules.on-delivery-final).
// Emulator only (demo project) — never a real Firebase project.
//   npx firebase emulators:exec --only firestore --project demo-dairsharaf-rules --config firebase.orders-final.json "node --test orders-final.test.mjs"
// Each case states the expected result for both rule sets: the "gap" rows show what the live rules allow today.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('run inside firebase emulators:exec (FIRESTORE_EMULATOR_HOST missing)');
const RULES = {
  live: readFileSync(new URL('../firestore.rules.on-delivery', import.meta.url), 'utf8'),
  final: readFileSync(new URL('../firestore.rules.on-delivery-final', import.meta.url), 'utf8'),
};
const OWNER = 'ownerUid000000000000000000001';
const ADMIN = 'adminUid000000000000000000002';
const ALICE = 'aliceUid000000000000000000003';
const MALLORY = 'malloryUid0000000000000000004';
const order = (id, extra = {}) => ({ id, status: 'new', userId: 'guest', total: 5, items: [{ productId: 'p1', quantity: 1, price: 5 }], address: { fullName: 'زبون', phone: '0790000000' }, ...extra });
const workerOrder = (id, state, extra = {}) => order(id, { inventory: { policy: 'on_delivery', state }, ...extra });

// [name, { live: true|false, final: true|false }, async (ctx) => promise]   true = allowed
const CASES = [
  ['guest creates an order directly (skips the Worker: no Turnstile, no price check, no Telegram)', { live: true, final: false },
    (c) => setDoc(doc(c.guest(), 'orders/ORD-GUEST001-AAAA'), order('ORD-GUEST001-AAAA'))],
  ['signed-in user creates an order that shows in ANOTHER customer\'s «طلباتي»', { live: true, final: false },
    (c) => setDoc(doc(c.as(MALLORY), 'orders/ORD-FAKE0001-AAAA'), order('ORD-FAKE0001-AAAA', { userId: ALICE }))],
  ['an order claiming to be paid / delivered (fake status)', { live: false, final: false },
    (c) => setDoc(doc(c.guest(), 'orders/ORD-PAID0001-AAAA'), order('ORD-PAID0001-AAAA', { status: 'delivered' }))],
  ['an order pretending to be Worker-managed (inventory field)', { live: false, final: false },
    (c) => setDoc(doc(c.guest(), 'orders/ORD-INV00001-AAAA'), order('ORD-INV00001-AAAA', { inventory: { policy: 'on_delivery', state: 'reserved' } }))],
  ['the admin creates an order from the browser (orders come only from the Worker)', { live: true, final: false },
    (c) => setDoc(doc(c.as(ADMIN), 'orders/ORD-ADMIN001-AAAA'), order('ORD-ADMIN001-AAAA'))],
  ['a guest reads ANY order by its number (name, phone, address)', { live: true, final: false },
    (c) => getDoc(doc(c.guest(), 'orders/ORD-ALICE001-AAAA'))],
  ['another signed-in user reads Alice\'s order by its number', { live: true, final: false },
    (c) => getDoc(doc(c.as(MALLORY), 'orders/ORD-ALICE001-AAAA'))],
  ['Alice reads her own order', { live: true, final: true },
    (c) => getDoc(doc(c.as(ALICE), 'orders/ORD-ALICE001-AAAA'))],
  ['Alice lists her own orders («طلباتي»)', { live: true, final: true },
    (c) => getDocs(query(collection(c.as(ALICE), 'orders'), where('userId', '==', ALICE)))],
  ['Mallory lists Alice\'s orders', { live: false, final: false },
    (c) => getDocs(query(collection(c.as(MALLORY), 'orders'), where('userId', '==', ALICE)))],
  ['the admin reads and lists all orders (dashboard)', { live: true, final: true },
    async (c) => { await getDoc(doc(c.as(ADMIN), 'orders/ORD-ALICE001-AAAA')); return getDocs(collection(c.as(ADMIN), 'orders')); }],
  ['the admin changes the status of an OLD (v1) order', { live: true, final: true },
    (c) => updateDoc(doc(c.as(ADMIN), 'orders/ORD-LEGACY01-AAAA'), { status: 'processing' })],
  ['the admin changes the status of a Worker order directly (stock would be skipped)', { live: false, final: false },
    (c) => updateDoc(doc(c.as(ADMIN), 'orders/ORD-WORKER01-AAAA'), { status: 'delivered' })],
  ['the admin marks a Worker order as seen', { live: true, final: true },
    (c) => updateDoc(doc(c.as(ADMIN), 'orders/ORD-WORKER01-AAAA'), { seenByAdmin: true })],
  ['the owner deletes a Worker order that still holds a reservation', { live: false, final: false },
    (c) => deleteDoc(doc(c.as(OWNER), 'orders/ORD-WORKER01-AAAA'))],
  ['the owner deletes a cancelled (released) Worker order', { live: true, final: true },
    (c) => deleteDoc(doc(c.as(OWNER), 'orders/ORD-WORKER02-AAAA'))],
  ['a browser reads stockReservations / orderLedger', { live: false, final: false },
    async (c) => { await getDoc(doc(c.as(ADMIN), 'stockReservations/p1')); return getDoc(doc(c.as(ADMIN), 'orderLedger/ORD-WORKER01-AAAA')); }],
  ['products: anyone reads; a customer cannot change the price', { live: false, final: false },
    async (c) => { await assertSucceeds(getDoc(doc(c.guest(), 'products/p1'))); return updateDoc(doc(c.as(ALICE), 'products/p1'), { price: 0.01 }); }],

  // ---------------- ratings, reviews, roles ----------------
  ['a customer sets any star average on a product (ratingAvg 5, ratingCount 999)', { live: true, final: false },
    (c) => updateDoc(doc(c.as(MALLORY), 'products/p1'), { ratingAvg: 5, ratingCount: 999 })],
  ['the admin edits a product', { live: true, final: true },
    (c) => updateDoc(doc(c.as(ADMIN), 'products/p1'), { price: 3 })],
  ['a customer posts a valid review (id = product_uid)', { live: true, final: true },
    (c) => setDoc(doc(c.as(MALLORY), `reviews/p1_${MALLORY}`), review('p1', MALLORY))],
  ['a customer posts reviews under random ids (unlimited reviews on one product)', { live: true, final: false },
    (c) => setDoc(doc(c.as(MALLORY), 'reviews/any-random-id-1'), review('p1', MALLORY))],
  ['a customer posts a review in ANOTHER customer\'s name', { live: true, final: false },
    // a NEW document (p1_ALICE already exists in the seed, so writing there would be an update, not a create)
    (c) => setDoc(doc(c.as(MALLORY), 'reviews/impersonated-1'), review('p1', ALICE))],
  ['a review with 50 stars', { live: true, final: false },
    (c) => setDoc(doc(c.as(MALLORY), `reviews/p1_${MALLORY}`), review('p1', MALLORY, { rating: 50 }))],
  ['a new review that starts with 100 likes and an "admin" reply', { live: true, final: false },
    (c) => setDoc(doc(c.as(MALLORY), `reviews/p1_${MALLORY}`), review('p1', MALLORY, { likesCount: 100, adminReply: { text: 'رد رسمي' } }))],
  ['Alice edits her own review (rating + comment)', { live: true, final: true },
    (c) => updateDoc(doc(c.as(ALICE), `reviews/p1_${ALICE}`), { rating: 4, comment: 'تعديل' })],
  ['Alice publishes her own hidden review / writes an admin reply', { live: true, final: false },
    (c) => updateDoc(doc(c.as(ALICE), `reviews/p1_${ALICE}`), { status: 'published', adminReply: { text: 'x' } })],
  ['Mallory likes Alice\'s review (only her own like)', { live: true, final: true },
    (c) => updateDoc(doc(c.as(MALLORY), `reviews/p1_${ALICE}`), { likesBy: { [MALLORY]: true }, likesCount: 1 })],
  ['Mallory inflates likes (likesCount 999 / adds someone else\'s like)', { live: true, final: false },
    (c) => updateDoc(doc(c.as(MALLORY), `reviews/p1_${ALICE}`), { likesBy: { [MALLORY]: true, [OWNER]: true }, likesCount: 999 })],
  ['a user makes herself "admin" in users/{uid}.role', { live: true, final: false },
    (c) => setDoc(doc(c.as(MALLORY), `users/${MALLORY}`), { id: MALLORY, name: 'm', role: 'admin' })],
  ['a user creates / updates her own profile (customer)', { live: true, final: true },
    async (c) => { await setDoc(doc(c.as(MALLORY), `users/${MALLORY}`), { id: MALLORY, name: 'm', role: 'customer' }); return updateDoc(doc(c.as(MALLORY), `users/${MALLORY}`), { name: 'Mallory' }); }],
  ['an admin reads their OWN admins entry (dashboard check without trusting users.role)', { live: false, final: true },
    (c) => getDoc(doc(c.as(ADMIN), `admins/${ADMIN}`))],
  ['a customer reads an admins entry', { live: false, final: false },
    (c) => getDoc(doc(c.as(MALLORY), `admins/${ADMIN}`))],
  ['a user reads another user\'s profile', { live: false, final: false },
    (c) => getDoc(doc(c.as(MALLORY), `users/${ALICE}`))],
];
function review(productId, userId, extra = {}) {
  return { productId, userId, userName: 'زبون', rating: 5, comment: 'منتج ممتاز', status: 'published', likesCount: 0, likesBy: {}, adminReply: null, ...extra };
}

const envs = {};
before(async () => {
  for (const [name, rules] of Object.entries(RULES)) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    // one demo project per rule set: the emulator keeps ONE ruleset per project
    envs[name] = await initializeTestEnvironment({ projectId: `demo-dairsharaf-rules-${name}`, firestore: { rules, host, port: Number(port) } });
  }
});
after(async () => { for (const e of Object.values(envs)) await e.cleanup(); });

async function seed(env) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'config/roles'), { ownerUid: OWNER });
    await setDoc(doc(db, `admins/${ADMIN}`), { role: 'admin' });
    await setDoc(doc(db, 'products/p1'), { name: 'دفتر', price: 2.5, stock: 10 });
    await setDoc(doc(db, 'orders/ORD-ALICE001-AAAA'), order('ORD-ALICE001-AAAA', { userId: ALICE }));
    await setDoc(doc(db, 'orders/ORD-LEGACY01-AAAA'), order('ORD-LEGACY01-AAAA'));
    await setDoc(doc(db, 'orders/ORD-WORKER01-AAAA'), workerOrder('ORD-WORKER01-AAAA', 'reserved'));
    await setDoc(doc(db, 'orders/ORD-WORKER02-AAAA'), workerOrder('ORD-WORKER02-AAAA', 'released', { status: 'cancelled' }));
    await setDoc(doc(db, 'stockReservations/p1'), { reserved: 1 });
    await setDoc(doc(db, 'orderLedger/ORD-WORKER01-AAAA'), { decision: 'accepted' });
    await setDoc(doc(db, `reviews/p1_${ALICE}`), review('p1', ALICE, { status: 'hidden' }));
    await setDoc(doc(db, `users/${ALICE}`), { id: ALICE, name: 'Alice', role: 'customer' });
  });
}

for (const name of ['live', 'final']) {
  for (const [label, expect, run] of CASES) {
    test(`[${name}] ${expect[name] ? 'ALLOWED' : 'DENIED '} — ${label}`, async () => {
      const env = envs[name];
      await seed(env);
      const c = { guest: () => env.unauthenticatedContext().firestore(), as: (uid) => env.authenticatedContext(uid).firestore() };
      await (expect[name] ? assertSucceeds : assertFails)(run(c));
    });
  }
}
