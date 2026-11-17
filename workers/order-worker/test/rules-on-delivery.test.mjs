// firebase/firestore.rules.on-delivery — the browser paths under the TRANSITION rules (Firestore emulator, demo-
// project, @firebase/rules-unit-testing). The Worker itself uses the service account and is not subject to rules.
//   firebase emulators:exec --only firestore --project demo-dairsharaf-orders --config test/firebase.json \
//     "node --test --test-concurrency=1 test/rules-on-delivery.test.mjs"
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { emulatorHost, PROJECT_ID } from './helpers.mjs';

const RULES = readFileSync(new URL('../../../firebase/firestore.rules.on-delivery', import.meta.url), 'utf8');
const SNAPSHOT = readFileSync(new URL('../../../firebase/firestore.rules.prod-snapshot', import.meta.url), 'utf8');
const OWNER = 'owner-1';
const ADMIN = 'admin-2';
const CUSTOMER = 'cust-3';
let env;

before(async () => {
  const [host, port] = emulatorHost().split(':');
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: RULES, host, port: Number(port) } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'config/roles'), { ownerUid: OWNER });
    await setDoc(doc(db, `admins/${ADMIN}`), { active: true });
    await setDoc(doc(db, 'products/p1'), { name: 'x', price: 1, stock: 5 });
    // Worker-managed orders (written by the service account)
    await setDoc(doc(db, 'orders/ORD-RESERVED-AAAA'), { id: 'ORD-RESERVED-AAAA', status: 'new', userId: CUSTOMER, seenByAdmin: false, inventory: { policy: 'on_delivery', state: 'reserved' } });
    await setDoc(doc(db, 'orders/ORD-RELEASED-BBBB'), { id: 'ORD-RELEASED-BBBB', status: 'cancelled', userId: CUSTOMER, inventory: { policy: 'on_delivery', state: 'released' } });
    await setDoc(doc(db, 'orders/ORD-DELIVERD-CCCC'), { id: 'ORD-DELIVERD-CCCC', status: 'delivered', userId: CUSTOMER, inventory: { policy: 'on_delivery', state: 'deducted' } });
    // legacy order (old site / Worker v1)
    await setDoc(doc(db, 'orders/ORD-LEGACYAA-DDDD'), { id: 'ORD-LEGACYAA-DDDD', status: 'new', userId: CUSTOMER, seenByAdmin: false });
    await setDoc(doc(db, 'orderLedger/ORD-RESERVED-AAAA'), { stockPolicy: 'on_delivery' });
    await setDoc(doc(db, 'stockReservations/p1'), { productId: 'p1', product: 1, variants: {} });
  });
});

const as = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const statusUpdate = (status) => ({ status, seenByAdmin: true, updatedAt: serverTimestamp() }); // = storage.ts updateStatus

test('R1. Worker-managed order: no browser (admin or owner) can change its status or inventory', async () => {
  for (const uid of [OWNER, ADMIN]) {
    for (const [id, current] of [['ORD-RESERVED-AAAA', 'new'], ['ORD-DELIVERD-CCCC', 'delivered']]) {
      // (writing the SAME status changes only seenByAdmin/updatedAt — that is allowed, see R2)
      for (const s of ['new', 'processing', 'shipped', 'delivered', 'cancelled'].filter((x) => x !== current)) {
        await assertFails(updateDoc(doc(as(uid), `orders/${id}`), statusUpdate(s)));
      }
      await assertFails(updateDoc(doc(as(uid), `orders/${id}`), { inventory: { policy: 'on_delivery', state: 'released' } }));
      await assertFails(updateDoc(doc(as(uid), `orders/${id}`), { inventory: { policy: 'legacy', state: 'none' } }));
    }
  }
});

test('R2. Worker-managed order: the admin can still mark it seen', async () => {
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'orders/ORD-RESERVED-AAAA'), { seenByAdmin: true, updatedAt: serverTimestamp() }));
});

test('R3. legacy order: the dashboard status change works exactly as before', async () => {
  for (const s of ['processing', 'shipped', 'delivered', 'cancelled']) await assertSucceeds(updateDoc(doc(as(ADMIN), 'orders/ORD-LEGACYAA-DDDD'), statusUpdate(s)));
  await assertFails(updateDoc(doc(as(CUSTOMER), 'orders/ORD-LEGACYAA-DDDD'), statusUpdate('delivered')));
});

test('R4. delete: a still-reserved Worker order cannot be deleted (cancel first); released / legacy can (owner only)', async () => {
  await assertFails(deleteDoc(doc(as(OWNER), 'orders/ORD-RESERVED-AAAA')));
  await assertSucceeds(deleteDoc(doc(as(OWNER), 'orders/ORD-RELEASED-BBBB')));
  await assertSucceeds(deleteDoc(doc(as(OWNER), 'orders/ORD-LEGACYAA-DDDD')));
  await assertFails(deleteDoc(doc(as(ADMIN), 'orders/ORD-DELIVERD-CCCC')), 'admin (not owner) never deletes');
});

test('R5. old-site browser order creation keeps working; a browser order can never pose as Worker-managed', async () => {
  const base = { id: 'ORD-NEWBROWS-EEEE', status: 'new', userId: 'guest', seenByAdmin: false, items: [], total: 1, createdAt: serverTimestamp() };
  await assertFails(setDoc(doc(as(null), 'orders/ORD-NEWBROWS-FFFF'), { ...base, id: 'ORD-NEWBROWS-FFFF', inventory: { policy: 'on_delivery', state: 'deducted' } }));
  await assertFails(setDoc(doc(as(null), 'orders/ORD-NEWBROWS-GGGG'), { ...base, id: 'ORD-NEWBROWS-GGGG', approval: { policy: 'telegram', state: 'accepted' } }));
  await assertFails(setDoc(doc(as(null), 'orders/ORD-NEWBROWS-HHHH'), { ...base, id: 'ORD-NEWBROWS-HHHH', status: 'delivered' }));
  await assertSucceeds(setDoc(doc(as(null), 'orders/ORD-NEWBROWS-EEEE'), base));
});

test('R6. stockReservations and orderLedger: no browser read or write, not even the owner', async () => {
  for (const uid of [null, CUSTOMER, ADMIN, OWNER]) {
    await assertFails(getDoc(doc(as(uid), 'stockReservations/p1')));
    await assertFails(setDoc(doc(as(uid), 'stockReservations/p1'), { product: 0 }));
    await assertFails(setDoc(doc(as(uid), 'stockReservations/p2'), { product: 0 }));
    await assertFails(getDoc(doc(as(uid), 'orderLedger/ORD-RESERVED-AAAA')));
    await assertFails(updateDoc(doc(as(uid), 'orderLedger/ORD-RESERVED-AAAA'), { inventory: 'released' }));
  }
});

test('R7. unchanged paths: products (admin edits stock), order reads, customer list of own orders', async () => {
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'products/p1'), { stock: 9 }));
  await assertFails(updateDoc(doc(as(CUSTOMER), 'products/p1'), { stock: 0 }));
  await assertSucceeds(getDoc(doc(as(null), 'orders/ORD-RESERVED-AAAA')));
  await assertSucceeds(getDocs(query(collection(as(CUSTOMER), 'orders'), where('userId', '==', CUSTOMER))));
  await assertSucceeds(getDocs(collection(as(ADMIN), 'orders')));
});

test('R8. the transition file differs from the production snapshot ONLY in the orders block (+ comments)', () => {
  const strip = (t) => t.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '').trimEnd()).filter((l) => l.trim()).join('\n');
  const outside = (t) => strip(t).replace(/function workerManaged\(\)[\s\S]*?\n {4}match \/reviews/, 'match /reviews').replace(/match \/orders\/\{id\} \{[\s\S]*?\n {4}\}\n/, '');
  assert.equal(outside(RULES).replace(/\n\s*match \/reviews/, '\nmatch /reviews'), outside(SNAPSHOT).replace(/\n\s*match \/reviews/, '\nmatch /reviews'));
});
