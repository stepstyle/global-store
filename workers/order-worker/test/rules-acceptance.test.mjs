// Firestore rules vs STOCK_POLICY=on_acceptance orders (emulator, demo- project, @firebase/rules-unit-testing):
// like on_delivery orders, their status and stock belong to the Worker ONLY — the admin's browser may mark them as
// seen, nothing else (otherwise a status written directly would skip the stock / prize-wheel effects).
//     "node --test --test-concurrency=1 test/rules-acceptance.test.mjs"
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { emulatorHost, PROJECT_ID } from './helpers.mjs';

const FILES = ['firestore.rules.on-delivery', 'firestore.rules.on-delivery-final'];
const OWNER = 'ownerUid00000000000000000000O1';
const [host, port] = emulatorHost().split(':');
const envs = {};
before(async () => {
  for (const f of FILES) {
    const rules = readFileSync(new URL(`../../../firebase/${f}`, import.meta.url), 'utf8');
    envs[f] = await initializeTestEnvironment({ projectId: `${PROJECT_ID}-acc-${f.length}`, firestore: { rules, host, port: Number(port) } });
    await envs[f].withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'config/roles'), { ownerUid: OWNER });
      await setDoc(doc(db, 'orders/acc-1'), { status: 'processing', inventory: { policy: 'on_acceptance', state: 'deducted' }, approval: { policy: 'telegram', state: 'accepted' }, seenByAdmin: false });
      await setDoc(doc(db, 'orders/acc-2'), { status: 'new', inventory: { policy: 'on_acceptance', state: 'reserved' }, approval: { policy: 'telegram', state: 'pending' }, seenByAdmin: false });
      await setDoc(doc(db, 'orders/old-1'), { status: 'new', seenByAdmin: false });
    });
  }
});
after(async () => { for (const e of Object.values(envs)) await e.cleanup(); });

for (const f of FILES) {
  test(`${f}: an on_acceptance order's status / stock cannot be written from the browser, even by the owner; "seen" can; a reserved one cannot be deleted`, async () => {
    const db = envs[f].authenticatedContext(OWNER, { email: 'o@example.invalid', email_verified: true }).firestore();
    await assertFails(updateDoc(doc(db, 'orders/acc-1'), { status: 'delivered' }));
    await assertFails(updateDoc(doc(db, 'orders/acc-1'), { inventory: { policy: 'on_acceptance', state: 'restocked' } }));
    await assertFails(updateDoc(doc(db, 'orders/acc-2'), { status: 'processing', approval: { policy: 'telegram', state: 'accepted' } }));
    await assertSucceeds(updateDoc(doc(db, 'orders/acc-1'), { seenByAdmin: true }));
    await assertFails(deleteDoc(doc(db, 'orders/acc-2')));
    // an old order (no Worker policy) keeps the old direct path (unchanged)
    await assertSucceeds(updateDoc(doc(db, 'orders/old-1'), { status: 'processing' }));
  });
}
