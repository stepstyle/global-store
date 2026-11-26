// The checkout draft (services/checkoutDraft.ts): what is kept, for how long, and what is never kept.
//   node --test tests/unit/checkoutDraft.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveCheckoutDraft, readCheckoutDraft, clearCheckoutDraft, cleanDraft, DRAFT_KEY, DRAFT_TTL_MS, __resetDraftMemory } from '../../src/services/checkoutDraft.ts';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };
const D = { fullName: 'زبون', phoneLocal: '0791234567', dialCode: '+962', email: 'a@b.co', citySlug: 'zarqa', ammanAreaId: '', streetAddress: 'شارع 1', postalCode: '', shippingMethodId: 'fast', paymentMethod: 'cod', step: 3, owner: 'guest' };

beforeEach(() => __resetDraftMemory());

test('saved while typing, read back as typed (same tab)', () => {
  const s = mem();
  saveCheckoutDraft(D, s, 1000);
  assert.deepEqual(readCheckoutDraft(s, 2000), D);
});

test('an untouched form is not stored (and removes an older draft)', () => {
  const s = mem();
  saveCheckoutDraft(D, s, 1000);
  saveCheckoutDraft({ ...D, fullName: '', phoneLocal: '', email: '', citySlug: '', streetAddress: '' }, s, 1500);
  assert.equal(s.getItem(DRAFT_KEY), null);
  assert.equal(readCheckoutDraft(s, 2000), null);
});

test('expires after the time limit; a clock far in the future is refused', () => {
  const s = mem();
  saveCheckoutDraft(D, s, 0);
  assert.ok(readCheckoutDraft(s, DRAFT_TTL_MS - 1));
  assert.equal(readCheckoutDraft(s, DRAFT_TTL_MS + 1), null);
  assert.equal(s.getItem(DRAFT_KEY), null, 'removed once expired');
  saveCheckoutDraft(D, s, 10 * 60_000);
  assert.equal(readCheckoutDraft(s, 0), null, 'saved "in the future" = not trusted');
});

test('cleared after the order', () => {
  const s = mem();
  saveCheckoutDraft(D, s, 1000);
  clearCheckoutDraft(s);
  assert.equal(readCheckoutDraft(s, 1001), null);
});

test('storage blocked (private mode, some in-app browsers): kept in memory while the app is open, never throws', () => {
  assert.doesNotThrow(() => saveCheckoutDraft(D, blocked, 1000));
  assert.deepEqual(readCheckoutDraft(blocked, 2000), D);
  assert.doesNotThrow(() => clearCheckoutDraft(blocked));
  assert.equal(readCheckoutDraft(blocked, 2000), null);
  saveCheckoutDraft(D, null, 1000);
  assert.deepEqual(readCheckoutDraft(null, 1500), D);
});

test('only the delivery details: agreement, consents, security token, sign-in token, CliQ reference are never stored', () => {
  const s = mem();
  saveCheckoutDraft({ ...D, acceptPolicies: true, saveInfo: true, turnstileToken: 'x', idToken: 'y', cliqRef: 'REF-1', total: 1 }, s, 1000);
  const raw = s.getItem(DRAFT_KEY);
  for (const k of ['acceptPolicies', 'saveInfo', 'turnstile', 'idToken', 'cliqRef', 'REF-1', 'total']) assert.ok(!raw.includes(k), `${k} stored: ${raw}`);
});

test('a tampered / old draft is cleaned: unknown values fall back, sizes are limited', () => {
  const c = cleanDraft({ fullName: 'x'.repeat(500), phoneLocal: '07-91 23<script>', dialCode: 'javascript:', shippingMethodId: 'teleport', paymentMethod: 'card', step: 9 });
  assert.equal(c.fullName.length, 120);
  assert.equal(c.phoneLocal, '079123');
  assert.equal(c.dialCode, '+962');
  assert.equal(c.shippingMethodId, 'standard');
  assert.equal(c.paymentMethod, 'cod');
  assert.equal(c.step, 1);
  const s = mem();
  s.setItem(DRAFT_KEY, '{not json');
  assert.equal(readCheckoutDraft(s, 1), null);
});

test('the owner is kept with the draft (guest / account uid); an invalid owner falls back to guest', () => {
  const s = mem();
  saveCheckoutDraft({ ...D, owner: 'uidABC_123' }, s, 1000);
  assert.equal(readCheckoutDraft(s, 1001).owner, 'uidABC_123');
  assert.equal(cleanDraft({ ...D, owner: '../../x' }).owner, 'guest');
});
