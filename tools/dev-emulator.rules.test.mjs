// Behaviour of the LOCAL production rules snapshot (firebase/firestore.rules.prod-snapshot) as loaded by the
// DEV emulator (firebase/dev-emulator.firebase.json) — real Firebase JS SDK, real Auth-emulator tokens,
// fake users, demo- project, 127.0.0.1 only. Run:
//   npm run test:dev-rules
// Expectations encode what the snapshot rules DO today. Cases marked "CURRENT WEAKNESS" pass because the
// rules allow them — they document risks to fix later (Phase 3), they are not endorsements.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  initializeFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, serverTimestamp, terminate,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { resolveFirebaseTarget } from '../src/services/firebaseTarget.ts';

// ---------------------------------------------------------------- target (refuses anything but demo- @ 127.0.0.1)
const T = resolveFirebaseTarget({
  isDev: true,
  env: {
    VITE_FIREBASE_TARGET: 'emulator',
    VITE_FIREBASE_PROJECT_ID: process.env.GCLOUD_PROJECT,
    VITE_FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
    VITE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  },
  productionConfig: null,
  localOverride: null,
});
const P = T.config.projectId;
const FS_REST = `http://${T.firestore.host}:${T.firestore.port}/v1/projects/${P}/databases/(default)/documents`;
const RUN = Date.now().toString(36).toUpperCase();
const oid = (tag) => `ORD-${tag}${RUN}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

// ---------------------------------------------------------------- server-side seeding (owner token bypasses rules)
const enc = (v) => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
  return { stringValue: String(v) };
};
async function seed(path, data) {
  const r = await fetch(`${FS_REST}/${path}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }),
  });
  if (!r.ok) throw new Error(`seed ${path} failed ${r.status}`);
}
async function serverGet(path) {
  const r = await fetch(`${FS_REST}/${path}`, { headers: { authorization: 'Bearer owner' } });
  return r.status === 200 ? r.json() : null;
}

// ---------------------------------------------------------------- clients (one Firebase app per identity)
const clients = [];
async function client(name, signUp = true) {
  const app = initializeApp(T.config, `${name}-${RUN}`);
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  connectFirestoreEmulator(db, T.firestore.host, T.firestore.port);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${T.auth.host}:${T.auth.port}`, { disableWarnings: true });
  let uid = null;
  if (signUp) uid = (await createUserWithEmailAndPassword(auth, `${name}-${RUN.toLowerCase()}@example.com`, 'local-only-password-1')).user.uid;
  const c = { name, app, db, auth, uid };
  clients.push(c);
  return c;
}
const denied = (p, label) => assert.rejects(p, (e) => e?.code === 'permission-denied', `expected DENIED: ${label}`);
const allowed = (p, label) => assert.doesNotReject(p, `expected ALLOWED: ${label}`);

/** Same shape as Checkout.tsx -> storage.ts db.orders.create(): setDoc with serverTimestamp(). */
const checkoutOrder = (id, userId, extra = {}) => ({
  id, userId, status: 'new', seenByAdmin: false, items: [{ productId: 'p-1', name: 'Test', price: 5, quantity: 1 }],
  subtotal: 5, shippingCost: 2, total: 7, paymentMethod: 'cod',
  address: { fullName: 'Fake Buyer', city: 'Amman', street: 'Test St', phone: '+962790000000' },
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
});

let guest, A, B, admin, owner;
const ORD_A = oid('A');
const ORD_B = oid('B');

before(async () => {
  if (!/^demo-/.test(P)) throw new Error('refusing: not a demo- project');
  [guest, A, B, admin, owner] = await Promise.all([client('guest', false), client('cust-a'), client('cust-b'), client('admin'), client('owner')]);
  await seed('config/roles', { ownerUid: owner.uid });
  await seed(`admins/${admin.uid}`, { role: 'admin' });
  await seed(`orders/${ORD_A}`, { id: ORD_A, userId: A.uid, status: 'new', total: 7, address: { fullName: 'Customer A', phone: '+962791111111' }, createdAt: new Date() });
  await seed(`orders/${ORD_B}`, { id: ORD_B, userId: B.uid, status: 'new', total: 9, createdAt: new Date() });
  await seed('products/p-1', { name: 'Notebook', price: 5, stock: 10, ratingAvg: 4, ratingCount: 2 });
  await seed(`orderLedger/${ORD_A}`, { orderId: ORD_A, mode: 'created' });
});

after(async () => {
  for (const c of clients) {
    try {
      if (c.uid) await signOut(c.auth);
      await terminate(c.db);
      await deleteApp(c.app);
    } catch {}
  }
});

// ================================================================ orders: create
test('orders/create: guest creates an order exactly as Checkout does (status new) -> allowed', async () => {
  const id = oid('G');
  await allowed(setDoc(doc(guest.db, 'orders', id), checkoutOrder(id, 'guest')), 'guest checkout create');
  assert.ok(await serverGet(`orders/${id}`), 'stored in the emulator');
});

test('orders/create: status other than "new" or missing -> denied', async () => {
  const id1 = oid('S');
  await denied(setDoc(doc(guest.db, 'orders', id1), checkoutOrder(id1, 'guest', { status: 'delivered' })), 'status delivered');
  const id2 = oid('S');
  const noStatus = checkoutOrder(id2, 'guest');
  delete noStatus.status;
  await denied(setDoc(doc(guest.db, 'orders', id2), noStatus), 'missing status');
});

test('orders/create: overwriting an existing order (same id) -> denied, original unchanged', async () => {
  await denied(setDoc(doc(guest.db, 'orders', ORD_A), checkoutOrder(ORD_A, 'guest', { total: 0.01 })), 'guest overwrite');
  await denied(setDoc(doc(A.db, 'orders', ORD_A), checkoutOrder(ORD_A, A.uid, { total: 0.01 })), 'owner-customer overwrite');
  assert.equal((await serverGet(`orders/${ORD_A}`)).fields.total.integerValue, '7');
});

test('orders/create: signed-in customer creates own order -> allowed', async () => {
  const id = oid('C');
  await allowed(setDoc(doc(A.db, 'orders', id), checkoutOrder(id, A.uid)), 'customer own order');
});

test('orders/create: CURRENT WEAKNESS — any client may set userId of ANOTHER customer -> allowed', async () => {
  const id = oid('X');
  await allowed(setDoc(doc(A.db, 'orders', id), checkoutOrder(id, B.uid)), 'spoofed userId by customer');
  const id2 = oid('X');
  await allowed(setDoc(doc(guest.db, 'orders', id2), checkoutOrder(id2, B.uid)), 'spoofed userId by guest');
});

// ================================================================ orders: read
test('orders/get: CURRENT WEAKNESS — anyone with the order id reads it (incl. name/phone) -> allowed', async () => {
  const g = await getDoc(doc(guest.db, 'orders', ORD_A));
  assert.equal(g.data().address.phone, '+962791111111', 'guest reads PII of order A');
  const b = await getDoc(doc(B.db, 'orders', ORD_A));
  assert.equal(b.data().userId, A.uid, 'customer B reads order A');
});

test('orders/list: guest -> denied; customer: own filter allowed, unfiltered or other uid denied', async () => {
  await denied(getDocs(collection(guest.db, 'orders')), 'guest list');
  const own = await getDocs(query(collection(A.db, 'orders'), where('userId', '==', A.uid)));
  assert.ok(own.docs.some((d) => d.id === ORD_A));
  assert.ok(own.docs.every((d) => d.data().userId === A.uid));
  await denied(getDocs(collection(A.db, 'orders')), 'customer unfiltered list');
  await denied(getDocs(query(collection(A.db, 'orders'), where('userId', '==', B.uid))), 'customer lists B');
});

// ================================================================ orders: update / delete
test('orders/update: customer (even the order owner) -> denied; admin -> allowed', async () => {
  await denied(updateDoc(doc(A.db, 'orders', ORD_A), { status: 'cancelled' }), 'owner-customer update');
  await denied(updateDoc(doc(guest.db, 'orders', ORD_A), { status: 'cancelled' }), 'guest update');
  await allowed(updateDoc(doc(admin.db, 'orders', ORD_A), { status: 'processing', seenByAdmin: true }), 'admin update');
  await allowed(updateDoc(doc(owner.db, 'orders', ORD_A), { seenByAdmin: true }), 'owner update');
});

test('orders/list: admin and owner list all orders -> allowed', async () => {
  for (const c of [admin, owner]) {
    const all = await getDocs(collection(c.db, 'orders'));
    assert.ok(all.docs.some((d) => d.id === ORD_A) && all.docs.some((d) => d.id === ORD_B), c.name);
  }
});

test('orders/delete: customer and admin -> denied; owner -> allowed', async () => {
  const id = oid('D');
  await seed(`orders/${id}`, { id, userId: A.uid, status: 'new' });
  await denied(deleteDoc(doc(A.db, 'orders', id)), 'customer delete');
  await denied(deleteDoc(doc(admin.db, 'orders', id)), 'admin delete');
  await allowed(deleteDoc(doc(owner.db, 'orders', id)), 'owner delete');
  assert.equal(await serverGet(`orders/${id}`), null);
});

// ================================================================ orderLedger (Worker-only)
test('orderLedger: no client can read or write it (guest, customer, admin, owner) -> denied', async () => {
  for (const c of [guest, A, admin, owner]) {
    await denied(getDoc(doc(c.db, 'orderLedger', ORD_A)), `${c.name} read`);
    await denied(setDoc(doc(c.db, 'orderLedger', oid('L')), { mode: 'created' }), `${c.name} write`);
  }
});

// ================================================================ privilege escalation
test('config/roles and admins: customers cannot read or take over -> denied', async () => {
  await denied(getDoc(doc(A.db, 'config', 'roles')), 'customer reads roles');
  await denied(setDoc(doc(A.db, 'config', 'roles'), { ownerUid: A.uid }), 'customer becomes owner');
  await denied(setDoc(doc(A.db, 'admins', A.uid), { role: 'admin' }), 'customer adds self as admin');
  await denied(setDoc(doc(admin.db, 'admins', A.uid), { role: 'admin' }), 'admin adds admins (owner only)');
  await allowed(getDoc(doc(admin.db, 'config', 'roles')), 'admin reads roles');
});

test('users: own doc allowed, other users denied; CURRENT WEAKNESS: role field is self-writable but grants NO data access', async () => {
  await allowed(setDoc(doc(A.db, 'users', A.uid), { name: 'A', role: 'customer' }), 'create own profile');
  await denied(getDoc(doc(A.db, 'users', B.uid)), 'read other user');
  await denied(setDoc(doc(A.db, 'users', B.uid), { role: 'customer' }), 'write other user');
  // AdminGuard.tsx trusts users/{uid}.role === 'admin' for the ADMIN UI; the rules let the user set it:
  await allowed(updateDoc(doc(A.db, 'users', A.uid), { role: 'admin' }), 'self-promote role field');
  // ...but the rules use config/roles + admins/{uid}, so data stays protected:
  await denied(getDocs(collection(A.db, 'orders')), 'self-promoted user lists all orders');
  await denied(updateDoc(doc(A.db, 'orders', ORD_B), { status: 'cancelled' }), 'self-promoted user updates an order');
  await denied(updateDoc(doc(A.db, 'products', 'p-1'), { price: 0.01 }), 'self-promoted user changes a price');
});

// ================================================================ products
test('products: public read; customers may only touch rating fields; admin edits prices', async () => {
  assert.equal((await getDoc(doc(guest.db, 'products', 'p-1'))).data().price, 5);
  await denied(updateDoc(doc(A.db, 'products', 'p-1'), { price: 0.01 }), 'customer price');
  await denied(updateDoc(doc(A.db, 'products', 'p-1'), { stock: 999 }), 'customer stock');
  await denied(updateDoc(doc(guest.db, 'products', 'p-1'), { ratingAvg: 5 }), 'guest rating');
  await allowed(updateDoc(doc(A.db, 'products', 'p-1'), { ratingAvg: 4.5, ratingCount: 3 }), 'customer rating only');
  await allowed(updateDoc(doc(admin.db, 'products', 'p-1'), { price: 6 }), 'admin price');
  await denied(setDoc(doc(A.db, 'products', 'p-new'), { name: 'x', price: 1 }), 'customer creates product');
});
