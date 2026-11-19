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
];

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
