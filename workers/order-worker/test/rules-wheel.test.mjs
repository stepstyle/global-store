// Firestore rules vs EVERY prize-wheel collection (Firestore emulator, demo- project, @firebase/rules-unit-testing).
// The wheel is written ONLY by the Worker (service account, not subject to rules): no browser — signed in or not, even an
// admin account — may read or write any of these documents, under every rules file of the repository.
//     "node --test --test-concurrency=1 test/rules-wheel.test.mjs"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { emulatorHost, PROJECT_ID } from './helpers.mjs';

const FILES = ['firestore.rules.on-delivery', 'firestore.rules.on-delivery-final', 'firestore.rules.prod-snapshot'];
const COLLECTIONS = ['wheelCampaigns', 'wheelCampaignHistory', 'wheelPool', 'wheelEntitlements', 'wheelSpins', 'wheelGrants', 'wheelPhoneGifts', 'wheelGuestSpins', 'wheelGuestIps', 'wheelAccountOrders', 'wheelBudget'];
const OWNER = 'ownerUid00000000000000000000O1';
const [host, port] = emulatorHost().split(':');
const envs = {};

before(async () => {
  for (const f of FILES) {
    const rules = readFileSync(new URL(`../../../firebase/${f}`, import.meta.url), 'utf8');
    envs[f] = await initializeTestEnvironment({ projectId: `${PROJECT_ID}-${f.replace(/[^a-z]/g, '').slice(0, 12)}`, firestore: { rules, host, port: Number(port) } });
    await envs[f].withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'config/roles'), { ownerUid: OWNER });
      for (const c of COLLECTIONS) await setDoc(doc(db, `${c}/x`), { secret: 1 });
    });
  }
});
after(async () => { for (const e of Object.values(envs)) await e.cleanup(); });

for (const f of FILES) {
  test(`${f}: no browser can read, list or write any wheel collection (guest, customer, admin)`, async () => {
    const e = envs[f];
    const who = [
      ['guest', e.unauthenticatedContext()],
      ['customer', e.authenticatedContext('custUid000000000000000000000C1', { email: 'c@example.invalid', email_verified: true, firebase: { sign_in_provider: 'google.com' } })],
      ['admin', e.authenticatedContext(OWNER, { email: 'o@example.invalid', email_verified: true })],
    ];
    for (const [name, ctx] of who) {
      const db = ctx.firestore();
      for (const c of COLLECTIONS) {
        await assertFails(getDoc(doc(db, `${c}/x`)));
        await assertFails(getDocs(collection(db, c)));
        await assertFails(setDoc(doc(db, `${c}/y`), { tier: 'loyal', heldMils: -999999, remaining: 999 }));
        assert.ok(true, `${name} ${c}`);
      }
    }
  });
}
