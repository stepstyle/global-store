// Smoke test of the LOCAL development wiring, run inside the dev emulators:
//   firebase emulators:exec --only firestore,auth --project demo-dairsharaf-dev \
//     --config firebase/dev-emulator.firebase.json "node tools/dev-emulator.smoke.mjs"
// The dev emulator loads the LOCAL production rules snapshot (firebase/firestore.rules.prod-snapshot).
// Uses the same resolveFirebaseTarget() as the web app + the real Firebase JS SDK (Firestore + Auth),
// then confirms through the emulator's own REST API that the data landed in the EMULATOR.
// Refuses to run unless the emulators are on 127.0.0.1 and the project is demo-.

import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, terminate } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { resolveFirebaseTarget } from '../src/services/firebaseTarget.ts';

const env = {
  VITE_FIREBASE_TARGET: 'emulator',
  VITE_FIREBASE_PROJECT_ID: process.env.GCLOUD_PROJECT,
  VITE_FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
  VITE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
};
// productionConfig only needs the identifiers to refuse them; the real ones are checked by the guard tests.
const target = resolveFirebaseTarget({ isDev: true, env, productionConfig: null, localOverride: null });
assert.equal(target.kind, 'emulator');
console.log(`[smoke] target: emulator, project ${target.config.projectId}, firestore ${target.firestore.host}:${target.firestore.port}, auth ${target.auth.host}:${target.auth.port}`);

const app = initializeApp(target.config, `dev-smoke-${Date.now()}`);
const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
connectFirestoreEmulator(db, target.firestore.host, target.firestore.port);
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${target.auth.host}:${target.auth.port}`, { disableWarnings: true });

const id = `ORD-SMOKE${Date.now().toString(36).toUpperCase()}-DEV`;
const cred = await createUserWithEmailAndPassword(auth, `smoke-${Date.now()}@example.com`, 'local-only-password-1');
assert.ok(cred.user.uid);

// rules are really loaded: a collection the production rules do not mention is denied
await assert.rejects(setDoc(doc(db, 'devSmoke', id), { ok: true }), (e) => e?.code === 'permission-denied', 'devSmoke must be denied (rules loaded)');
// and an order as the shop creates it is allowed
await setDoc(doc(db, 'orders', id), { id, userId: cred.user.uid, status: 'new', total: 1 });
assert.equal((await getDoc(doc(db, 'orders', id))).data().status, 'new');

// confirm through the emulator's admin REST endpoint (owner token) that it landed in the EMULATOR
const fsBase = `http://${target.firestore.host}:${target.firestore.port}/v1/projects/${target.config.projectId}/databases/(default)/documents`;
const r = await fetch(`${fsBase}/orders/${id}`, { headers: { authorization: 'Bearer owner' } });
assert.equal(r.status, 200, 'document is in the Firestore emulator');
console.log(`[smoke] rules loaded (unlisted collection denied); order created in the Firestore emulator; auth emulator user created (${cred.user.uid.slice(0, 6)}…)`);

await signOut(auth);
await terminate(db);
await deleteApp(app);
console.log('[smoke] PASS');
process.exit(0);
