// Legacy Cloud Functions (functions/: sendOrderEmail, security/: secureOrderPrices) vs order Worker v2 — LOCAL ONLY.
// Nothing is deployed or contacted: the helpers are pure; the trigger files are checked statically.
//   node --test tools/legacy-functions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWorkerV2Order as tsHelper } from '../functions/src/workerOrders.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { isWorkerV2Order: jsHelper } = createRequire(import.meta.url)('../security/workerOrders.js');
const yes = async () => true;
const no = async () => false;
const boom = async () => { throw new Error('firestore down'); };

for (const [name, h] of [['functions/src/workerOrders.ts', tsHelper], ['security/workerOrders.js', jsHelper]]) {
  test(`${name}: a Worker v2 order needs source 'worker-v2' AND its orderLedger entry`, async () => {
    assert.equal(await h({ source: 'worker-v2' }, yes), true);
    assert.equal(await h({ source: 'worker-v2' }, no), false, 'browser-forged source without a ledger');
    assert.equal(await h({ source: 'web' }, yes), false);
    assert.equal(await h({}, yes), false, 'old browser order (no source)');
    assert.equal(await h(undefined, yes), false);
    assert.equal(await h({ source: 'worker-v2' }, boom), false, 'lookup error -> legacy behaviour');
  });
}

test('sendOrderEmail: skips Worker v2 orders BEFORE loading SendGrid / sending; everything else unchanged', () => {
  const src = readFileSync(resolve(ROOT, 'functions/src/index.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export const sendOrderEmail'));
  const guard = fn.indexOf('isWorkerV2Order(order, ledgerExists)');
  assert.ok(guard > 0, 'guard present');
  assert.ok(guard < fn.indexOf('loadSendgridConfig()') && guard < fn.indexOf('sgMail.send'), 'guard runs first');
  assert.match(fn, /orderLedger\/\$\{event\.params\.orderId\}/);
});

test('secureOrderPrices: skips Worker v2 orders BEFORE any price check / status write; old orders unchanged', () => {
  const src = readFileSync(resolve(ROOT, 'security/index.js'), 'utf8');
  const guard = src.indexOf('isWorkerV2Order(orderData');
  assert.ok(guard > 0);
  assert.ok(guard < src.indexOf("status: 'fraud'") && guard < src.indexOf('isVerified: true'), 'no write before the guard');
  assert.match(src, /orderLedger\/\$\{orderId\}/);
});
