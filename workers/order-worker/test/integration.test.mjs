// Integration tests — Firestore EMULATOR + local mock services only.
// Run via: npm run test:integration  (firebase emulators:exec --project demo-dairsharaf-orders …)

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  emulatorHost, startMockServices, makeEnv, callWorker, createOrderReq, runCron,
  clearDb, seedProducts, putDoc, getDecoded, count, eq, productStock, variantStock,
  browserEnv, browserWrite, adminDb, freshIp, sleep,
} from './helpers.mjs';
import { checkoutOrder, line, makeOrderId, PRODUCTS, CSV_PRODUCT_ID } from './fixtures.mjs';
import { encodeFields } from '../src/firestore.js';
import { makeTestSigner } from './token-signer.mjs';
import { clearKeyCache } from '../src/auth.js';
import { normalizeTrackingKey, hashTrackingKey } from '../src/tracking.js';

let mock;
const env = (o = {}) => makeEnv(mock.url, o);
const codes = (ledger) => (ledger?.warnings || []).map((w) => w.code);

async function fresh() {
  await clearDb();
  await seedProducts();
  mock.reset();
}

before(async () => {
  emulatorHost(); // throws unless FIRESTORE_EMULATOR_HOST is local
  mock = await startMockServices();
});

after(async () => {
  assert.deepEqual(mock.state.unexpected, [], 'Worker called an unexpected endpoint');
  await mock.close();
});

/** Invariants for one processed order with the DEFAULT cart. */
async function assertProcessedOnce(id, { modes = ['created', 'adopted'], msg = '' } = {}) {
  assert.equal(await count('orders', eq('id', id)), 1, `${msg} one order doc`);
  assert.equal(await count('orderLedger', eq('orderId', id)), 1, `${msg} one ledger`);
  const ledger = await getDecoded(`orderLedger/${id}`);
  assert.ok(modes.includes(ledger.mode), `${msg} mode ${ledger.mode}`);
  assert.equal(await productStock('p-simple'), 8, `${msg} p-simple deducted once`);
  assert.equal(await variantStock('p-variants', 'var_red'), 4, `${msg} var_red deducted once`);
  assert.equal(await variantStock('p-variants', 'var_blue'), 1, `${msg} var_blue untouched`);
  assert.equal(await productStock('p-variants'), 0, `${msg} top-level stock of variant product untouched`);
  assert.equal(mock.sent('telegram'), 1, `${msg} one telegram`);
  assert.equal(mock.sent('email'), 1, `${msg} one email`);
  const o = await getDecoded(`orders/${id}`);
  for (const k of ['id', 'status', 'total', 'items', 'address', 'createdAt', 'paymentMethod']) assert.ok(k in o, `${msg} order has ${k}`);
  assert.equal(o.status, 'new');
  assert.ok(o.createdAt instanceof Date, `${msg} createdAt is a timestamp`);
  assert.ok(o.workerCheck, `${msg} workerCheck attached`);
  return { ledger, order: o };
}

// ===========================================================================
describe('isolation guards', () => {
  const bad = {
    'production project id': { FIREBASE_PROJECT_ID: 'antastore1-82b50' },
    'real Firestore URL': { FIRESTORE_BASE_URL: 'https://firestore.googleapis.com/v1' },
    'real Telegram URL': { TELEGRAM_API_BASE: 'https://api.telegram.org' },
    'real SendGrid URL': { SENDGRID_API_BASE: 'https://api.sendgrid.com' },
    'service-account auth': { FIRESTORE_AUTH: 'service-account' },
    'no ENVIRONMENT': { ENVIRONMENT: '' },
  };
  for (const [name, o] of Object.entries(bad)) {
    test(`refuses to run with ${name}: CONFIG_ERROR, zero outbound calls, zero writes`, async () => {
      await fresh();
      const r = await createOrderReq(env(o), checkoutOrder());
      assert.equal(r.status, 500);
      assert.deepEqual(r.body, { ok: false, code: 'CONFIG_ERROR' });
      assert.equal(mock.state.calls.length, 0);
      assert.equal(await count('orders'), 0);
      const cron = await runCron(env(o));
      assert.equal(cron, undefined);
    });
  }
});

// ===========================================================================
describe('happy path (Worker only, guest)', () => {
  test('creates order + ledger, deducts stock once, notifies once, minimal response', async () => {
    await fresh();
    const order = checkoutOrder();
    const r = await createOrderReq(env(), order);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['ok', 'orderId', 'replay']);
    assert.deepEqual(r.body, { ok: true, orderId: order.id, replay: false });

    const { ledger, order: o } = await assertProcessedOnce(order.id, { modes: ['created'] });
    assert.equal(o.userId, 'guest');
    assert.equal(o.source, 'worker-v2');
    assert.equal(o.total, 8.2);
    assert.equal(ledger.priceMismatch, false);
    assert.equal(ledger.serverPricing.total, 8.2);
    assert.equal(ledger.notifyPending, false);
    assert.equal(ledger.notifications.telegram.state, 'sent');
    assert.equal(ledger.notifications.email.state, 'sent');
    const tg = mock.state.calls.find((c) => c.channel === 'telegram');
    assert.match(tg.body.text, new RegExp(order.id));
    assert.doesNotMatch(tg.body.text, /PRICE MISMATCH/);
  });
});

// ===========================================================================
for (const rulesName of ['prod', 'compat']) {
  describe(`compatibility with current Checkout — Firestore rules: ${rulesName}`, () => {
    let tenv;
    before(async () => {
      tenv = await browserEnv(rulesName);
    });
    after(async () => {
      await tenv.cleanup();
    });

    test('browser writes first, then Worker (x20) -> adopted, processed once', async () => {
      for (let i = 0; i < 20; i++) {
        await fresh();
        const o = checkoutOrder();
        assert.equal((await browserWrite(tenv, o)).ok, true, `#${i} browser write`);
        const r = await createOrderReq(env(), o);
        assert.equal(r.status, 200, `#${i}`);
        const { ledger } = await assertProcessedOnce(o.id, { modes: ['adopted'], msg: `#${i}` });
        assert.equal(ledger.userIdSource, 'browser-document');
      }
    });

    test('Worker first, then browser (x20) -> browser write rejected by rules, processed once', async () => {
      for (let i = 0; i < 20; i++) {
        await fresh();
        const o = checkoutOrder();
        const r = await createOrderReq(env(), o);
        assert.equal(r.status, 200, `#${i}`);
        const b = await browserWrite(tenv, o);
        assert.equal(b.ok, false, `#${i} browser overwrite must be denied`);
        await assertProcessedOnce(o.id, { modes: ['created'], msg: `#${i}` });
      }
    });

    test('parallel like Checkout, Worker waits 300ms (x20) -> processed once', async () => {
      for (let i = 0; i < 20; i++) {
        await fresh();
        const o = checkoutOrder();
        const [r] = await Promise.all([createOrderReq(env({ CREATE_WAIT_MS: '300' }), o), browserWrite(tenv, o)]);
        assert.equal(r.status, 200, `#${i}`);
        await assertProcessedOnce(o.id, { msg: `#${i}` });
      }
    });

    test('parallel, no wait — worst-case interleaving (x20) -> processed once', async () => {
      for (let i = 0; i < 20; i++) {
        await fresh();
        const o = checkoutOrder();
        const [r] = await Promise.all([createOrderReq(env({ CREATE_WAIT_MS: '0' }), o), browserWrite(tenv, o)]);
        assert.equal(r.status, 200, `#${i}`);
        await assertProcessedOnce(o.id, { msg: `#${i}` });
      }
    });

    test('Worker outage (never called) -> browser order stays unprocessed; reconcile disabled by default', async () => {
      await fresh();
      const o = checkoutOrder();
      assert.equal((await browserWrite(tenv, o)).ok, true);
      const cron = await runCron(env());
      assert.equal(cron.reconcile.enabled, false);
      assert.equal(await count('orderLedger'), 0);
      assert.equal(mock.state.calls.length, 0);
      assert.equal(await productStock('p-simple'), 10);
    });
  });
}

// ===========================================================================
describe('duplicates, foreign order ids, injected fields, userId spoofing', () => {
  let tenv;
  before(async () => {
    tenv = await browserEnv('prod');
  });
  after(async () => {
    await tenv.cleanup();
  });

  test('5 sequential identical requests -> one ledger, one deduction, one notification', async () => {
    await fresh();
    const o = checkoutOrder();
    const replays = [];
    for (let i = 0; i < 5; i++) {
      const r = await createOrderReq(env(), o);
      assert.equal(r.status, 200);
      replays.push(r.body.replay);
    }
    assert.deepEqual(replays, [false, true, true, true, true]);
    await assertProcessedOnce(o.id, { modes: ['created'] });
  });

  test('5 parallel identical requests -> exactly one processed, others replay', async () => {
    for (let round = 0; round < 5; round++) {
      await fresh();
      const o = checkoutOrder();
      const rs = await Promise.all(Array.from({ length: 5 }, () => createOrderReq(env(), o)));
      assert.ok(rs.every((r) => r.status === 200), `round ${round}: ${rs.map((r) => r.status)}`);
      assert.equal(rs.filter((r) => r.body.replay === false).length, 1, `round ${round}`);
      await assertProcessedOnce(o.id, { modes: ['created'], msg: `round ${round}` });
    }
  });

  test('same id, different content after processing -> 409, nothing changes', async () => {
    await fresh();
    const o = checkoutOrder();
    await createOrderReq(env(), o);
    const attacker = { ...o, address: { ...o.address, phone: '+962780000000', fullName: 'Attacker' } };
    const r = await createOrderReq(env(), attacker);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'ORDER_EXISTS');
    const stored = await getDecoded(`orders/${o.id}`);
    assert.equal(stored.address.phone, '+962791234567');
    await assertProcessedOnce(o.id, { modes: ['created'] });
  });

  test("someone else's fresh, unprocessed order id with different content -> 409; victim then processed normally", async () => {
    await fresh();
    const victim = checkoutOrder();
    assert.equal((await browserWrite(tenv, victim)).ok, true);
    const attacker = checkoutOrder({ id: victim.id, items: [line('p-hundred', 50)] });
    const r = await createOrderReq(env(), attacker);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'ORDER_EXISTS');
    assert.equal(await count('orderLedger'), 0);
    assert.equal(await productStock('p-hundred'), 100);
    assert.equal(mock.state.calls.length, 0);
    const stored = await getDecoded(`orders/${victim.id}`);
    assert.equal(stored.items.length, 2);

    const ok = await createOrderReq(env(), victim);
    assert.equal(ok.status, 200);
    await assertProcessedOnce(victim.id, { modes: ['adopted'] });
  });

  test('existing order older than the adopt window -> 409 ORDER_EXISTS, untouched', async () => {
    await fresh();
    const o = checkoutOrder();
    assert.equal((await browserWrite(tenv, o)).ok, true);
    await sleep(900);
    const r = await createOrderReq(env({ ADOPT_WINDOW_MS: '500' }), o);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'ORDER_EXISTS');
    assert.equal(await count('orderLedger'), 0);
    assert.equal(mock.state.calls.length, 0);
    assert.equal(await productStock('p-simple'), 10);
  });

  test('injected fields are dropped: status/seenByAdmin forced, isPaid false, extras stripped', async () => {
    await fresh();
    const o = checkoutOrder({
      payment: 'cliq',
      overrides: { status: 'delivered', seenByAdmin: true, isVerified: true, fraudReason: 'x', paymentDetails: { cliqReference: '99', isPaid: true } },
    });
    const r = await createOrderReq(env(), o);
    assert.equal(r.status, 200);
    const stored = await getDecoded(`orders/${o.id}`);
    assert.equal(stored.status, 'new');
    assert.equal(stored.seenByAdmin, false);
    assert.equal(stored.paymentDetails.isPaid, false);
    assert.equal('isVerified' in stored, false);
    assert.equal('fraudReason' in stored, false);
    const ledger = await getDecoded(`orderLedger/${o.id}`);
    assert.deepEqual([...ledger.strippedFields].sort(), ['fraudReason', 'isVerified']);
  });

  test('userId spoof via Worker only -> stored as guest, claimedUserId kept, never linked to the victim', async () => {
    await fresh();
    const victimUid = 'victimUid00000000000000000001';
    const o = checkoutOrder({ userId: victimUid });
    const r = await createOrderReq(env(), o);
    assert.equal(r.status, 200);
    const stored = await getDecoded(`orders/${o.id}`);
    assert.equal(stored.userId, 'guest');
    assert.equal(stored.claimedUserId, victimUid);
    assert.equal(await count('orders', eq('userId', victimUid)), 0);
    const ledger = await getDecoded(`orderLedger/${o.id}`);
    assert.ok(codes(ledger).includes('USERID_UNVERIFIED'));
    assert.equal(ledger.userIdSource, 'claimed-unverified-dropped');
  });

  test('userId spoof via browser document is blocked by compat rules (Worker then stores guest)', async () => {
    const compat = await browserEnv('compat');
    try {
      await fresh();
      const o = checkoutOrder({ userId: 'victimUid00000000000000000002' });
      const b = await browserWrite(compat, o, 'malloryUid0000000000000000001');
      assert.equal(b.ok, false, 'compat rules must reject a foreign userId');
      const r = await createOrderReq(env(), o);
      assert.equal(r.status, 200);
      assert.equal((await getDecoded(`orders/${o.id}`)).userId, 'guest');
    } finally {
      await compat.cleanup();
    }
  });

  test('[RESIDUAL RISK] under current production rules a browser-written foreign userId is adopted as-is', async () => {
    // Emulator rules are per project: reload the production snapshot explicitly
    // (the previous test loaded the compat rules).
    const prodEnv = await browserEnv('prod');
    try {
      await fresh();
      const victimUid = 'victimUid00000000000000000003';
      const o = checkoutOrder({ userId: victimUid });
      assert.equal((await browserWrite(prodEnv, o, 'malloryUid0000000000000000002')).ok, true, 'prod rules allow it today');
      const r = await createOrderReq(env(), o);
      assert.equal(r.status, 200);
      assert.equal((await getDecoded(`orders/${o.id}`)).userId, victimUid);
      assert.equal((await getDecoded(`orderLedger/${o.id}`)).userIdSource, 'browser-document');
    } finally {
      await prodEnv.cleanup();
    }
  });
});

// ===========================================================================
describe('abuse / malformed input -> rejected with zero writes and zero notifications', () => {
  const cases = [
    ['quantity 999999', () => ({ body: { order: checkoutOrder({ items: [{ ...line('p-simple', 1), quantity: 999999 }] }) } }), 400, 'INVALID_ORDER'],
    ['order id path traversal', () => ({ body: { order: checkoutOrder({ id: '../../config/roles' }) } }), 400, 'INVALID_ORDER'],
    ['product id with slash', () => ({ body: { order: checkoutOrder({ items: [{ ...line('p-simple', 1), productId: 'products/x' }] }) } }), 400, 'INVALID_ORDER'],
    ['31 items', () => ({ body: { order: checkoutOrder({ items: Array.from({ length: 31 }, () => line('p-simple', 1)) }) } }), 400, 'INVALID_ORDER'],
    ['40KB payload', () => ({ rawBody: JSON.stringify({ order: checkoutOrder(), pad: 'x'.repeat(40 * 1024) }) }), 413, 'PAYLOAD_TOO_LARGE'],
    ['invalid JSON', () => ({ rawBody: '{"order": ' }), 400, 'INVALID_JSON'],
    ['no order object', () => ({ body: { hello: 1 } }), 400, 'INVALID_ORDER'],
  ];
  for (const [name, make, status, code] of cases) {
    test(name, async () => {
      await fresh();
      const r = await callWorker(env(), { method: 'POST', path: '/create-order', ...make() });
      assert.equal(r.status, status);
      assert.equal(r.body.code, code);
      assert.equal(await count('orders'), 0);
      assert.equal(await count('orderLedger'), 0);
      assert.equal(mock.state.calls.length, 0);
      assert.equal(await productStock('p-simple'), 10);
    });
  }
  test('GET /create-order -> 405', async () => {
    const r = await callWorker(env(), { method: 'GET', path: '/create-order' });
    assert.equal(r.status, 405);
  });
});

// ===========================================================================
describe('server-side prices', () => {
  test('tampered browser prices: order keeps what the customer saw, ledger flags mismatch, admin warned', async () => {
    await fresh();
    const o = checkoutOrder({ items: [{ ...line('p-simple', 2), price: 0.01 }, { ...line('p-variants', 1, { variantId: 'var_red' }), price: 0.01 }] });
    const r = await createOrderReq(env(), o);
    assert.equal(r.status, 200);
    const ledger = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(ledger.priceMismatch, true);
    assert.ok(codes(ledger).includes('PRICE_MISMATCH'));
    assert.equal(ledger.serverPricing.total, 8.2);
    assert.equal((await getDecoded(`orders/${o.id}`)).workerCheck.priceMismatch, true);
    const tg = mock.state.calls.find((c) => c.channel === 'telegram' && c.ok);
    assert.match(tg.body.text, /PRICE MISMATCH/);
    assert.match(tg.body.text, /JOD 8\.20/);
  });

  test('variant price comes from Firestore (var_blue 3.5 vs cart 3) -> mismatch', async () => {
    await fresh();
    const o = checkoutOrder({ items: [{ ...line('p-variants', 1, { variantId: 'var_blue' }), price: 3 }] });
    await createOrderReq(env(), o);
    const ledger = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(ledger.serverPricing.lines[0].unitPrice, 3.5);
    assert.equal(ledger.priceMismatch, true);
  });

  test('fast delivery Amman a7 (2+1) and Zarqa (3) priced correctly -> no mismatch', async () => {
    await fresh();
    const base = checkoutOrder({ items: [line('p-simple', 1)] });
    const fast = { ...base, id: makeOrderId(), shippingMethodId: 'fast', addressMeta: { ...base.addressMeta, ammanAreaId: 'a7' }, shippingCost: 3, total: 2.5 + 3 };
    const zarqa = { ...base, id: makeOrderId(), addressMeta: { ...base.addressMeta, citySlug: 'zarqa', ammanAreaId: '' }, shippingCost: 3, total: 2.5 + 3 };
    for (const o of [fast, zarqa]) {
      assert.equal((await createOrderReq(env(), o)).status, 200);
      const l = await getDecoded(`orderLedger/${o.id}`);
      assert.equal(l.priceMismatch, false, JSON.stringify(l.warnings));
      assert.equal(l.serverPricing.shipping, 3);
    }
  });

  test('no free-shipping rule: subtotal 25 still pays shipping', async () => {
    await fresh();
    const o = checkoutOrder({ items: [line('p-hundred', 25)] });
    await createOrderReq(env(), o);
    const l = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(l.serverPricing.subtotal, 25);
    assert.equal(l.serverPricing.shipping, 1);
    assert.equal(l.priceMismatch, false);
  });
});

// ===========================================================================
describe('stock per product shape (end to end)', () => {
  const one = async (items, extraEnv = {}) => {
    await fresh();
    const o = checkoutOrder({ items });
    const r = await createOrderReq(env(extraEnv), o);
    assert.equal(r.status, 200);
    assert.equal(mock.sent('telegram'), 1, 'order is always notified');
    return getDecoded(`orderLedger/${o.id}`);
  };

  test('A legacy product (no variants field)', async () => {
    await one([line('p-simple', 3)]);
    assert.equal(await productStock('p-simple'), 7);
  });
  test('B empty variants array', async () => {
    await one([line('p-empty-variants', 2)]);
    assert.equal(await productStock('p-empty-variants'), 3);
  });
  test('C variant: only selected variant; top-level and sibling untouched; every other field preserved', async () => {
    await one([line('p-variants', 2, { variantId: 'var_red' })]);
    const p = await getDecoded('products/p-variants');
    const expected = PRODUCTS['p-variants'].variants.map((v) => (v.id === 'var_red' ? { ...v, stock: 3 } : v));
    assert.deepEqual(p.variants, expected);
    assert.equal(p.stock, 0);
    assert.equal(p.price, 3);
    assert.equal(p.name, 'قلم');
  });
  test('D variant labelled "."', async () => {
    await one([line('p-dot-label', 1, { variantId: 'var_dot' })]);
    assert.equal(await variantStock('p-dot-label', 'var_dot'), 2);
    assert.equal(await productStock('p-dot-label'), 9);
  });
  test('E unnamed colour variant', async () => {
    await one([line('p-unnamed-color', 2, { variantId: 'var_x' })]);
    assert.equal(await variantStock('p-unnamed-color', 'var_x'), 0);
  });
  test('F CSV free-text product id', async () => {
    await one([line(CSV_PRODUCT_ID, 2)]);
    assert.equal(await productStock(CSV_PRODUCT_ID), 5);
  });
  test('numeric-string stock -> deducted, stored back as a number', async () => {
    const l = await one([line('p-string-stock', 3)]);
    assert.equal(await productStock('p-string-stock'), 5);
    assert.ok(codes(l).includes('STOCK_STRING_NORMALIZED'));
  });
  test('no stock field -> untracked, untouched, warned', async () => {
    const l = await one([line('p-no-stock', 1)]);
    assert.equal(await productStock('p-no-stock'), undefined);
    assert.ok(codes(l).includes('STOCK_UNTRACKED'));
  });
  test('duplicate variant ids -> untouched, warned', async () => {
    const l = await one([line('p-dup-variant', 1, { variantId: 'var_dup' })]);
    const p = await getDecoded('products/p-dup-variant');
    assert.deepEqual(p.variants.map((v) => v.stock), [4, 4]);
    assert.ok(codes(l).includes('DUPLICATE_VARIANT_ID'));
  });
  test('variant product, cart variant has no id -> untouched, warned', async () => {
    const l = await one([{ ...line('p-variant-no-id', 1), selectedVariant: { label: 'x', type: 'size', price: 1 } }]);
    assert.equal((await getDecoded('products/p-variant-no-id')).variants[0].stock, 3);
    assert.ok(codes(l).includes('AMBIGUOUS_VARIANT'));
  });
  test('unknown variant id / deleted product -> warned, order still created and notified', async () => {
    const l1 = await one([line('p-variants', 1, { variantId: 'var_ghost' })]);
    assert.ok(codes(l1).includes('VARIANT_NOT_FOUND'));
    const l2 = await one([{ ...line('p-simple', 1), productId: 'p-deleted' }]);
    assert.ok(codes(l2).includes('PRODUCT_NOT_FOUND'));
  });
  test('shortfall on one line -> nothing in the order deducted (no partial)', async () => {
    const l = await one([line('p-simple', 1), line('p-variants', 2, { variantId: 'var_blue' })]);
    assert.equal(await productStock('p-simple'), 10);
    assert.equal(await variantStock('p-variants', 'var_blue'), 1);
    assert.ok(codes(l).includes('STOCK_SHORTFALL'));
    assert.ok(codes(l).includes('STOCK_NOT_DEDUCTED'));
  });
  test('two variants of one product in one order', async () => {
    await one([line('p-variants', 1, { variantId: 'var_red' }), line('p-variants', 1, { variantId: 'var_blue' })]);
    assert.equal(await variantStock('p-variants', 'var_red'), 4);
    assert.equal(await variantStock('p-variants', 'var_blue'), 0);
  });
  test('STOCK_MODE=log -> nothing written, deductions recorded as not applied', async () => {
    const l = await one([line('p-simple', 2)], { STOCK_MODE: 'log' });
    assert.equal(await productStock('p-simple'), 10);
    assert.equal(l.stockDeductions[0].applied, false);
  });

  test('race for the last item (x10): exactly one deduction, other order warned, never negative', async () => {
    for (let i = 0; i < 10; i++) {
      await fresh();
      const a = checkoutOrder({ items: [line('p-last-one', 1)] });
      const b = checkoutOrder({ items: [line('p-last-one', 1)], overrides: { address: { ...a.address, phone: '+962771111111' } } });
      const rs = await Promise.all([createOrderReq(env(), a), createOrderReq(env(), b)]);
      assert.ok(rs.every((r) => r.status === 200), `#${i}`);
      assert.equal(await productStock('p-last-one'), 0, `#${i}`);
      const ls = [await getDecoded(`orderLedger/${a.id}`), await getDecoded(`orderLedger/${b.id}`)];
      assert.equal(ls.filter((l) => l.stockDeductions.some((d) => d.applied)).length, 1, `#${i}`);
      assert.equal(ls.filter((l) => codes(l).includes('STOCK_SHORTFALL')).length, 1, `#${i}`);
      assert.equal(mock.sent('telegram'), 2, `#${i}`);
    }
  });

  test('10 concurrent orders on one product -> no lost update (100 -> 90)', async () => {
    await fresh();
    const orders = Array.from({ length: 10 }, () => checkoutOrder({ items: [line('p-hundred', 1)] }));
    const rs = await Promise.all(orders.map((o) => createOrderReq(env(), o)));
    assert.ok(rs.every((r) => r.status === 200), rs.map((r) => r.status).join(','));
    assert.equal(await productStock('p-hundred'), 90);
    assert.equal(await count('orderLedger'), 10);
  });
});

// ===========================================================================
describe('notifications', () => {
  const setTelegram = async (id, st, notifyPending = true) => {
    const fs = adminDb();
    const r = await fs.commit([
      {
        update: { name: fs.name(`orderLedger/${id}`), fields: encodeFields({ notifications: { telegram: st }, notifyPending }) },
        updateMask: { fieldPaths: ['notifications.telegram', 'notifyPending'] },
      },
    ]);
    assert.ok(r.ok);
  };

  test('Telegram fails twice -> retried by cron -> sent exactly once', async () => {
    await fresh();
    mock.state.failNext.telegram = 2;
    const o = checkoutOrder();
    await createOrderReq(env(), o);
    let l = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(l.notifications.telegram.state, 'failed');
    assert.equal(l.notifications.email.state, 'sent');
    assert.equal(l.notifyPending, true);
    await runCron(env());
    await runCron(env());
    l = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(l.notifications.telegram.state, 'sent');
    assert.equal(l.notifications.telegram.attempts, 3);
    assert.equal(l.notifyPending, false);
    assert.equal(mock.sent('telegram'), 1);
    assert.equal(mock.sent('email'), 1);
    await runCron(env());
    assert.equal(mock.attempts('telegram'), 3);
  });

  test('permanent failure stops after NOTIFY_MAX_ATTEMPTS', async () => {
    await fresh();
    mock.state.failAlways.telegram = true;
    const e = env({ NOTIFY_MAX_ATTEMPTS: '3' });
    const o = checkoutOrder();
    await createOrderReq(e, o);
    for (let i = 0; i < 5; i++) await runCron(e);
    const l = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(l.notifications.telegram.state, 'failed');
    assert.equal(l.notifications.telegram.attempts, 3);
    assert.equal(l.notifyPending, false);
    assert.equal(mock.attempts('telegram'), 3);
  });

  test('3 concurrent notification runs for one order -> one Telegram message', async () => {
    await fresh();
    mock.state.failNext.telegram = 1;
    const o = checkoutOrder();
    await createOrderReq(env(), o);
    assert.equal(mock.sent('telegram'), 0);
    const auth = { 'x-worker-auth': 'test-worker-auth-token-0001' };
    await Promise.all(Array.from({ length: 3 }, () => callWorker(env(), { method: 'POST', path: '/notify-order', body: { orderId: o.id }, headers: auth })));
    assert.equal(mock.sent('telegram'), 1);
  });

  test('stale lease (crash after claim) is retried once; a live lease is respected', async () => {
    await fresh();
    const o = checkoutOrder();
    await createOrderReq(env(), o);
    assert.equal(mock.sent('telegram'), 1);
    await setTelegram(o.id, { state: 'sending', attempts: 1, leaseUntil: new Date(Date.now() + 60_000) });
    await runCron(env());
    assert.equal(mock.sent('telegram'), 1, 'live lease: no send');
    await setTelegram(o.id, { state: 'sending', attempts: 1, leaseUntil: new Date(Date.now() - 1000) });
    await runCron(env());
    assert.equal(mock.sent('telegram'), 2, 'expired lease: exactly one resend');
    await runCron(env());
    assert.equal(mock.sent('telegram'), 2);
  });

  test('very long order -> Telegram text <= 3900 chars', async () => {
    await fresh();
    const items = Array.from({ length: 30 }, () => ({ ...line('p-hundred', 1), name: 'ن'.repeat(300) }));
    const o = checkoutOrder({ items, overrides: { note: 'م'.repeat(600) } });
    assert.equal((await createOrderReq(env(), o)).status, 200);
    const tg = mock.state.calls.find((c) => c.channel === 'telegram');
    assert.ok(tg.body.text.length <= 3900, `length ${tg.body.text.length}`);
  });

  test('email channel skipped when SendGrid is not configured', async () => {
    await fresh();
    const o = checkoutOrder();
    await createOrderReq(env({ SENDGRID_API_KEY: '' }), o);
    const l = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(l.notifications.email.state, 'skipped');
    assert.equal(mock.attempts('email'), 0);
    assert.equal(l.notifyPending, false);
  });
});

// ===========================================================================
describe('order status endpoint: no personal data, no unauthorized querying', () => {
  test('existing order -> exactly {ok, exists, status}; no PII anywhere in the body', async () => {
    await fresh();
    const o = checkoutOrder();
    await createOrderReq(env(), o);
    const r = await callWorker(env(), { path: `/orders/${o.id}/status` });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, exists: true, status: 'new' });
    for (const pii of ['+962791234567', 'Test Buyer', 'buyer@example.com', 'شارع', '8.2', 'p-simple']) {
      assert.equal(r.text.includes(pii), false, `leaked ${pii}`);
    }
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  test('unknown but valid id -> 404 {exists:false}', async () => {
    const r = await callWorker(env(), { path: `/orders/${makeOrderId()}/status` });
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, { ok: true, exists: false });
  });

  for (const bad of ['..%2Fconfig%2Froles', '..%2F..%2Fusers%2Fx', 'ORD-1', 'ord-abcd1234-xyz9', '%E0%A4%A', 'ORD-ABCD1234-XYZ9%2Fx']) {
    test(`invalid id "${bad}" -> 400`, async () => {
      const r = await callWorker(env(), { path: `/orders/${bad}/status` });
      assert.equal(r.status, 400);
      assert.equal(r.body.code, 'INVALID_ID');
    });
  }

  test('non-standard stored status is reported as "unknown"', async () => {
    await fresh();
    const id = makeOrderId();
    await putDoc(`orders/${id}`, { id, status: 'fraud', address: { phone: '+962790000000' } });
    const r = await callWorker(env(), { path: `/orders/${id}/status` });
    assert.deepEqual(r.body, { ok: true, exists: true, status: 'unknown' });
  });

  test('POST -> 405; rate limit -> 429 after the limit', async () => {
    assert.equal((await callWorker(env(), { method: 'POST', path: `/orders/${makeOrderId()}/status` })).status, 405);
    const e = env({ RATE_LIMIT_STATUS_PER_MIN: '5' });
    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await callWorker(e, { path: `/orders/${makeOrderId()}/status`, headers: { 'cf-connecting-ip': ip } })).status);
    assert.deepEqual(statuses, [404, 404, 404, 404, 404, 429, 429]);
  });

  test('CORS: allowed origin echoed, foreign origin gets no allow header', async () => {
    const good = await callWorker(env(), { path: `/orders/${makeOrderId()}/status`, headers: { origin: 'https://dairsharaf.com' } });
    assert.equal(good.headers.get('access-control-allow-origin'), 'https://dairsharaf.com');
    const evil = await callWorker(env(), { path: `/orders/${makeOrderId()}/status`, headers: { origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    const pre = await callWorker(env(), { method: 'OPTIONS', path: '/create-order', headers: { origin: 'https://evil.example' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
  });
});

// ===========================================================================
describe('protected routes, rate limit, Turnstile', () => {
  test('/test requires x-worker-auth', async () => {
    await fresh();
    assert.equal((await callWorker(env(), { path: '/test' })).status, 401);
    assert.equal((await callWorker(env(), { path: '/test', headers: { 'x-worker-auth': 'wrong-token-wrong-token' } })).status, 401);
    assert.equal(mock.state.calls.length, 0);
    assert.equal((await callWorker(env(), { path: '/test', headers: { 'x-worker-auth': 'test-worker-auth-token-0001' } })).status, 200);
    assert.equal(mock.sent('telegram'), 1);
  });

  test('/firestore-test removed; /notify-order requires auth', async () => {
    assert.equal((await callWorker(env(), { method: 'POST', path: '/firestore-test' })).status, 404);
    assert.equal((await callWorker(env(), { method: 'POST', path: '/notify-order', body: { orderId: makeOrderId() } })).status, 401);
  });

  test('create-order rate limit per IP', async () => {
    await fresh();
    const e = env({ RATE_LIMIT_CREATE_PER_MIN: '3' });
    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await callWorker(e, { method: 'POST', path: '/create-order', rawBody: '{', headers: { 'cf-connecting-ip': ip } })).status);
    assert.deepEqual(statuses, [400, 400, 400, 429, 429]);
  });

  test('Turnstile enforce: missing/invalid token -> 403 with no writes; valid -> 200; log mode never blocks', async () => {
    await fresh();
    const e = env({ TURNSTILE_MODE: 'enforce' });
    const o1 = checkoutOrder();
    assert.equal((await createOrderReq(e, o1)).status, 403);
    assert.equal((await callWorker(e, { method: 'POST', path: '/create-order', body: { order: o1, turnstileToken: 'bad' } })).status, 403);
    assert.equal(await count('orders'), 0);
    assert.equal((await callWorker(e, { method: 'POST', path: '/create-order', body: { order: o1, turnstileToken: 'pass-token' } })).status, 200);
    assert.equal((await createOrderReq(env({ TURNSTILE_MODE: 'log' }), checkoutOrder())).status, 200);
  });
});

// ===========================================================================
describe('reconciliation (disabled by default; strict checks when enabled)', () => {
  let tenv;
  before(async () => {
    tenv = await browserEnv('prod');
  });
  after(async () => {
    await tenv.cleanup();
  });
  const on = (o = {}) => env({ RECONCILE_ENABLED: 'true', RECONCILE_GRACE_MS: '0', ...o });

  test('enabled: valid browser-only order is processed exactly once', async () => {
    await fresh();
    const o = checkoutOrder();
    assert.equal((await browserWrite(tenv, o)).ok, true);
    const c1 = await runCron(on());
    assert.equal(c1.reconcile.processed, 1);
    const { ledger } = await assertProcessedOnce(o.id, { modes: ['reconciled'] });
    assert.equal(ledger.userIdSource, 'browser-document');
    const c2 = await runCron(on());
    assert.equal(c2.reconcile.processed, 0);
    assert.ok(c2.reconcile.skipped.some((s) => s.reason === 'already_processed'));
    assert.equal(mock.sent('telegram'), 1);
  });

  const skipCase = async (name, seed, cronEnv, expectReason) => {
    test(`skips: ${name}`, async () => {
      await fresh();
      const id = await seed();
      const c = await runCron(cronEnv());
      assert.equal(c.reconcile.processed, 0);
      if (expectReason) assert.ok(c.reconcile.skipped.some((s) => s.orderId === id && s.reason === expectReason), JSON.stringify(c.reconcile.skipped));
      assert.equal(await count('orderLedger'), 0);
      assert.equal(mock.state.calls.length, 0);
      assert.equal(await productStock('p-simple'), 10);
    });
  };

  const seeded = (overrides, { serverTime = true, docId } = {}) => async () => {
    const o = checkoutOrder({ overrides });
    const id = docId || o.id;
    const { createdAt, updatedAt, ...rest } = o;
    await putDoc(`orders/${id}`, overrides.createdAt !== undefined ? { ...rest, createdAt: overrides.createdAt } : rest, { serverTimeFields: serverTime ? ['createdAt', 'updatedAt'] : [] });
    return id;
  };

  skipCase('status not "new"', seeded({ status: 'processing' }), on, 'status_not_new');
  skipCase('fails schema (bad phone)', seeded({ address: { fullName: 'X Y Z W', phone: '123', city: '', street: '' } }), on, 'invalid:address.phone');
  skipCase('document id != order.id', seeded({}, { docId: 'ORD-AAAA1111-MISMATCH' }), on, 'id_mismatch');
  skipCase('client-forged createdAt (not server time)', seeded({ createdAt: new Date(Date.now() - 30 * 60_000) }, { serverTime: false }), on, 'createdAt_not_server_time');
  skipCase('v1-style string createdAt (never selected)', seeded({ createdAt: new Date().toISOString() }, { serverTime: false }), on, null);
  skipCase('inside grace period', seeded({}), () => on({ RECONCILE_GRACE_MS: '60000' }), 'outside_window');

  test('skips: outside the reconcile window', async () => {
    await fresh();
    const o = checkoutOrder();
    assert.equal((await browserWrite(tenv, o)).ok, true);
    await sleep(1500);
    const c = await runCron(on({ RECONCILE_WINDOW_MS: '1000' }));
    assert.equal(c.reconcile.processed, 0);
    assert.equal(await count('orderLedger'), 0);
  });

  test('disabled by default even with eligible orders', async () => {
    await fresh();
    const o = checkoutOrder();
    assert.equal((await browserWrite(tenv, o)).ok, true);
    const c = await runCron(env({ RECONCILE_GRACE_MS: '0' }));
    assert.equal(c.reconcile.enabled, false);
    assert.equal(await count('orderLedger'), 0);
  });
});

// ===========================================================================
// Signed-in customers: Firebase ID token -> verified uid (TEST keys from a local mock, no Google service)
// ===========================================================================
describe('signed-in customers (Firebase ID token)', () => {
  const PROJECT = 'demo-dairsharaf-orders';
  const ALICE = 'aliceUid000000000000000000A1';
  const MALLORY = 'malloryUid0000000000000000M1';
  let signer; // the "Google" key set the mock serves
  let forger; // a different key pair claiming the same kid
  const bearer = (t) => ({ authorization: `Bearer ${t}` });
  const tokenFor = (uid, o = {}) => signer.idToken({ projectId: PROJECT, uid, ...o });

  before(async () => {
    signer = await makeTestSigner('test-kid-1');
    forger = await makeTestSigner('test-kid-1');
  });

  async function freshAuth() {
    await fresh();
    clearKeyCache();
    mock.state.jwks = { keys: [signer.jwk] };
    mock.state.jwksFail = false;
  }
  async function nothingWritten(id, msg) {
    assert.equal(await count('orders'), 0, `${msg}: no order`);
    assert.equal(await count('orderLedger'), 0, `${msg}: no ledger`);
    assert.equal(await productStock('p-simple'), 10, `${msg}: stock untouched`);
    assert.equal(mock.sent('telegram') + mock.sent('email'), 0, `${msg}: no notification`);
    assert.equal(await getDecoded(`orders/${id}`), null);
  }

  test('valid token + body userId = same uid -> order linked to the verified uid, processed once', async () => {
    await freshAuth();
    const o = checkoutOrder({ userId: ALICE });
    const r = await createOrderReq(env(), o, bearer(await tokenFor(ALICE)));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { ok: true, orderId: o.id, replay: false });
    const { ledger, order } = await assertProcessedOnce(o.id, { modes: ['created'] });
    assert.equal(order.userId, ALICE);
    assert.equal(order.userIdVerified, true);
    assert.equal('claimedUserId' in order, false);
    assert.equal(ledger.userIdVerified, true);
    assert.equal(ledger.userIdSource, 'firebase-id-token');
    assert.ok(!codes(ledger).includes('USERID_UNVERIFIED'));
  });

  test('valid token + body userId "guest" (profile not loaded yet) -> still linked to the verified uid', async () => {
    await freshAuth();
    const o = checkoutOrder({ userId: 'guest' });
    const r = await createOrderReq(env(), o, bearer(await tokenFor(ALICE)));
    assert.equal(r.status, 200);
    assert.equal((await getDecoded(`orders/${o.id}`)).userId, ALICE);
  });

  test('no token: guest order unchanged; body uid without token -> guest + claimedUserId (old site unchanged)', async () => {
    await freshAuth();
    const g = checkoutOrder({ userId: 'guest' });
    assert.equal((await createOrderReq(env(), g)).status, 200);
    assert.equal((await getDecoded(`orders/${g.id}`)).userId, 'guest');
    const c = checkoutOrder({ userId: ALICE });
    assert.equal((await createOrderReq(env(), c)).status, 200);
    const stored = await getDecoded(`orders/${c.id}`);
    assert.equal(stored.userId, 'guest');
    assert.equal(stored.claimedUserId, ALICE);
    assert.equal((await getDecoded(`orderLedger/${c.id}`)).userIdSource, 'claimed-unverified-dropped');
  });

  test('token uid differs from body userId -> 403 USERID_MISMATCH, nothing written', async () => {
    await freshAuth();
    const o = checkoutOrder({ userId: ALICE });
    const r = await createOrderReq(env(), o, bearer(await tokenFor(MALLORY)));
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { ok: false, code: 'USERID_MISMATCH' });
    await nothingWritten(o.id, 'mismatch');
  });

  test('EXPIRED token -> 401 AUTH_EXPIRED, nothing written; fresh token, SAME id -> created once; again -> replay', async () => {
    await freshAuth();
    const o = checkoutOrder({ userId: ALICE });
    const old = await tokenFor(ALICE, { nowSec: Math.floor(Date.now() / 1000) - 7200 }); // expired an hour ago
    const r1 = await createOrderReq(env(), o, bearer(old));
    assert.equal(r1.status, 401);
    assert.deepEqual(r1.body, { ok: false, code: 'AUTH_EXPIRED' });
    await nothingWritten(o.id, 'expired');
    const r2 = await createOrderReq(env(), o, bearer(await tokenFor(ALICE)));
    assert.deepEqual(r2.body, { ok: true, orderId: o.id, replay: false });
    const r3 = await createOrderReq(env(), o, bearer(await tokenFor(ALICE, { extra: { iat: Math.floor(Date.now() / 1000) - 1 } })));
    assert.deepEqual(r3.body, { ok: true, orderId: o.id, replay: true }, 'renewed token -> same payload hash -> replay');
    await assertProcessedOnce(o.id, { modes: ['created'] });
    assert.equal((await getDecoded(`orders/${o.id}`)).userId, ALICE);
  });

  const unsignedNone = () => {
    const b = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    return `${b({ alg: 'none', typ: 'JWT' })}.${b({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: ALICE, iat: now, auth_time: now, exp: now + 3600 })}.`;
  };
  for (const [name, make] of [
    ['FORGED signature (other key, same kid)', () => forger.idToken({ projectId: PROJECT, uid: ALICE })],
    ['token of ANOTHER project', () => signer.idToken({ projectId: 'demo-other-project', uid: ALICE })],
    ['unsigned alg:none token (Auth-emulator style)', async () => unsignedNone()],
    ['token issued in the future', () => signer.idToken({ projectId: PROJECT, uid: ALICE, nowSec: Math.floor(Date.now() / 1000) + 3600 })],
  ]) {
    test(`${name} -> 401 AUTH_INVALID, nothing written, never downgraded to guest`, async () => {
      await freshAuth();
      const o = checkoutOrder({ userId: ALICE });
      const r = await createOrderReq(env(), o, bearer(await make()));
      assert.equal(r.status, 401);
      assert.deepEqual(r.body, { ok: false, code: 'AUTH_INVALID' });
      await nothingWritten(o.id, name);
    });
  }

  test('malformed Authorization header (Basic, empty Bearer) -> 401, nothing written', async () => {
    await freshAuth();
    const o = checkoutOrder({ userId: 'guest' });
    for (const h of ['Basic dXNlcjpwYXNz', 'Bearer ', 'Bearer']) {
      const r = await createOrderReq(env(), o, { authorization: h });
      assert.equal(r.status, 401, h);
    }
    await nothingWritten(o.id, 'malformed header');
  });

  test('key server unavailable -> 503 AUTH_UNAVAILABLE, nothing written; later the same id succeeds', async () => {
    await freshAuth();
    mock.state.jwksFail = true;
    const o = checkoutOrder({ userId: ALICE });
    const t = await tokenFor(ALICE);
    const r1 = await createOrderReq(env(), o, bearer(t));
    assert.equal(r1.status, 503);
    assert.deepEqual(r1.body, { ok: false, code: 'AUTH_UNAVAILABLE' });
    await nothingWritten(o.id, 'keys down');
    mock.state.jwksFail = false;
    assert.deepEqual((await createOrderReq(env(), o, bearer(t))).body, { ok: true, orderId: o.id, replay: false });
  });

  test('owner never changes after saving: guest order + later token -> replay, still guest', async () => {
    await freshAuth();
    const o = checkoutOrder({ userId: 'guest' });
    assert.equal((await createOrderReq(env(), o)).status, 200);
    const r = await createOrderReq(env(), o, bearer(await tokenFor(ALICE)));
    assert.deepEqual(r.body, { ok: true, orderId: o.id, replay: true });
    assert.equal((await getDecoded(`orders/${o.id}`)).userId, 'guest');
    await assertProcessedOnce(o.id, { modes: ['created'] });
  });

  // ---------------- replay of an order OWNED by a verified account ----------------
  const EXISTS409 = { ok: false, code: 'ORDER_EXISTS' };
  async function aliceOwnedOrder() {
    await freshAuth();
    const o = checkoutOrder({ userId: ALICE });
    assert.equal((await createOrderReq(env(), o, bearer(await tokenFor(ALICE)))).status, 200);
    const ledger = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(ledger.ownerUid, ALICE, 'verified owner stored in the ledger');
    return o;
  }
  async function unchangedAfter(o, msg) {
    await assertProcessedOnce(o.id, { modes: ['created'], msg }); // 1 order, 1 ledger, stock once, 1 telegram + 1 email
    const stored = await getDecoded(`orders/${o.id}`);
    assert.equal(stored.userId, ALICE, `${msg}: owner unchanged`);
    assert.equal((await getDecoded(`orderLedger/${o.id}`)).ownerUid, ALICE, `${msg}: ledger owner unchanged`);
  }

  test('replay: the OWNER (fresh token) -> replay; nothing processed twice', async () => {
    const o = await aliceOwnedOrder();
    for (let i = 0; i < 3; i++) {
      assert.deepEqual((await createOrderReq(env(), o, bearer(await tokenFor(ALICE)))).body, { ok: true, orderId: o.id, replay: true });
    }
    await unchangedAfter(o, 'owner replays');
  });

  test('replay: ANOTHER account -> 409 ORDER_EXISTS, identical whether the payload matches or not; nothing changes', async () => {
    const o = await aliceOwnedOrder();
    const same = await createOrderReq(env(), o, bearer(await tokenFor(MALLORY)));
    const otherPhone = await createOrderReq(env(), { ...o, address: { ...o.address, phone: '+962790000999' } }, bearer(await tokenFor(MALLORY)));
    const otherItems = await createOrderReq(env(), { ...o, userId: MALLORY }, bearer(await tokenFor(MALLORY)));
    for (const r of [same, otherPhone, otherItems]) {
      assert.equal(r.status, 409);
      assert.deepEqual(r.body, EXISTS409);
    }
    assert.equal(same.text, otherPhone.text, 'byte-identical answers: no confirmation oracle');
    assert.equal(same.text, otherItems.text);
    await unchangedAfter(o, 'other account');
  });

  test('replay: NO token -> 409 ORDER_EXISTS, identical for matching and non-matching payloads; nothing changes', async () => {
    const o = await aliceOwnedOrder();
    const same = await createOrderReq(env(), o);
    const differs = await createOrderReq(env(), { ...o, address: { ...o.address, phone: '+962790000998' } });
    assert.equal(same.status, 409);
    assert.deepEqual(same.body, EXISTS409);
    assert.equal(same.text, differs.text);
    assert.equal(same.status, differs.status);
    await unchangedAfter(o, 'no token');
  });

  test('replay: owned order created with body userId "guest" (profile not loaded) -> still owner-only', async () => {
    await freshAuth();
    const o = checkoutOrder({ userId: 'guest' });
    assert.equal((await createOrderReq(env(), o, bearer(await tokenFor(ALICE)))).status, 200);
    assert.deepEqual((await createOrderReq(env(), o)).body, EXISTS409, 'the body says guest, the ledger says Alice');
    assert.deepEqual((await createOrderReq(env(), o, bearer(await tokenFor(MALLORY)))).body, EXISTS409);
    assert.deepEqual((await createOrderReq(env(), o, bearer(await tokenFor(ALICE)))).body, { ok: true, orderId: o.id, replay: true });
    assert.equal((await getDecoded(`orders/${o.id}`)).userId, ALICE);
  });

  test('account switch while an attempt is pending: Alice saved (answer lost), Mallory signs in and retries -> 409, then Alice -> replay', async () => {
    const o = await aliceOwnedOrder(); // Alice's first send was saved; pretend its answer never arrived
    const r1 = await createOrderReq(env(), o, bearer(await tokenFor(MALLORY))); // same tab, other account, same frozen payload
    assert.deepEqual(r1.body, EXISTS409, 'no false "confirmed" for Mallory, no USERID_MISMATCH detail either');
    const r2 = await createOrderReq(env(), o, bearer(await tokenFor(ALICE)));
    assert.deepEqual(r2.body, { ok: true, orderId: o.id, replay: true });
    await unchangedAfter(o, 'account switch');
  });

  test('replay: parallel owner + other account + no token -> owner gets replay, others 409; one order, stock once', async () => {
    const o = await aliceOwnedOrder();
    const rs = await Promise.all([
      createOrderReq(env(), o, bearer(await tokenFor(ALICE))),
      createOrderReq(env(), o, bearer(await tokenFor(MALLORY))),
      createOrderReq(env(), o),
      createOrderReq(env(), o, bearer(await tokenFor(ALICE))),
    ]);
    assert.deepEqual(rs.map((r) => r.status), [200, 409, 409, 200]);
    await unchangedAfter(o, 'parallel');
  });

  test('legacy ledger WITHOUT ownerUid but userIdVerified (written before this change): owner taken from the order doc', async () => {
    const o = await aliceOwnedOrder();
    const fsA = adminDb();
    const del = await fsA.commit([{ update: { name: fsA.name(`orderLedger/${o.id}`), fields: {} }, updateMask: { fieldPaths: ['ownerUid'] } }]);
    assert.ok(del.ok);
    assert.equal('ownerUid' in (await getDecoded(`orderLedger/${o.id}`)), false);
    assert.deepEqual((await createOrderReq(env(), o, bearer(await tokenFor(MALLORY)))).body, EXISTS409);
    assert.deepEqual((await createOrderReq(env(), o)).body, EXISTS409);
    assert.deepEqual((await createOrderReq(env(), o, bearer(await tokenFor(ALICE)))).body, { ok: true, orderId: o.id, replay: true });
  });

  test('legacy verified ledger whose order doc was deleted -> owner unprovable -> nobody gets a confirmation, nothing recreated', async () => {
    const o = await aliceOwnedOrder();
    const fsA = adminDb();
    await fsA.commit([
      { update: { name: fsA.name(`orderLedger/${o.id}`), fields: {} }, updateMask: { fieldPaths: ['ownerUid'] } },
      { delete: fsA.name(`orders/${o.id}`) },
    ]);
    for (const h of [bearer(await tokenFor(ALICE)), bearer(await tokenFor(MALLORY)), {}]) {
      assert.deepEqual((await createOrderReq(env(), o, h)).body, EXISTS409);
    }
    assert.equal(await getDecoded(`orders/${o.id}`), null, 'never recreated');
    assert.equal(await productStock('p-simple'), 8, 'no second deduction');
  });

  test('guest orders unchanged: anyone may replay the same payload (no identity to check); different payload -> ORDER_EXISTS (single 409 code)', async () => {
    await freshAuth();
    const o = checkoutOrder({ userId: 'guest' });
    assert.equal((await createOrderReq(env(), o)).status, 200);
    assert.equal('ownerUid' in (await getDecoded(`orderLedger/${o.id}`)), false);
    assert.deepEqual((await createOrderReq(env(), o)).body, { ok: true, orderId: o.id, replay: true });
    assert.deepEqual((await createOrderReq(env(), o, bearer(await tokenFor(MALLORY)))).body, { ok: true, orderId: o.id, replay: true });
    const diff = await createOrderReq(env(), { ...o, address: { ...o.address, phone: '+962790000997' } });
    assert.deepEqual(diff.body, { ok: false, code: 'ORDER_EXISTS' });
    assert.equal((await getDecoded(`orders/${o.id}`)).userId, 'guest');
    await assertProcessedOnce(o.id, { modes: ['created'] });
  });

  test('old site, no token, claimed uid (stored as guest): replay unchanged, ledger has no owner', async () => {
    await freshAuth();
    const o = checkoutOrder({ userId: ALICE });
    assert.equal((await createOrderReq(env(), o)).status, 200);
    const ledger = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(ledger.userIdVerified, false);
    assert.equal('ownerUid' in ledger, false);
    assert.deepEqual((await createOrderReq(env(), o)).body, { ok: true, orderId: o.id, replay: true });
    assert.equal((await getDecoded(`orders/${o.id}`)).userId, 'guest');
  });

  test('old site: browser-written order doc WITHOUT ledger -> adopted (owner from the browser doc is NOT treated as verified) -> replay unchanged', async () => {
    await freshAuth();
    const o = checkoutOrder({ userId: 'guest' });
    await putDoc(`orders/${o.id}`, { ...o, status: 'new', seenByAdmin: false }, { serverTimeFields: ['createdAt', 'updatedAt'] });
    const r1 = await createOrderReq(env(), o, bearer(await tokenFor(ALICE)));
    assert.deepEqual(r1.body, { ok: true, orderId: o.id, replay: false });
    const ledger = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(ledger.mode, 'adopted');
    assert.equal('ownerUid' in ledger, false, 'adoption never assigns a verified owner');
    assert.equal((await getDecoded(`orders/${o.id}`)).userId, 'guest', 'browser document untouched');
    assert.deepEqual((await createOrderReq(env(), o)).body, { ok: true, orderId: o.id, replay: true });
    await assertProcessedOnce(o.id, { modes: ['adopted'] });
  });

  test('5 parallel identical requests with valid tokens -> one order for the uid, others replay', async () => {
    await freshAuth();
    const o = checkoutOrder({ userId: ALICE });
    const rs = await Promise.all(Array.from({ length: 5 }, async () => createOrderReq(env(), o, bearer(await tokenFor(ALICE)))));
    assert.ok(rs.every((r) => r.status === 200 && r.body.ok === true));
    assert.equal(rs.filter((r) => r.body.replay === false).length, 1);
    await assertProcessedOnce(o.id, { modes: ['created'] });
  });

  test('CORS preflight allows the Authorization header for allowed origins only', async () => {
    const good = await callWorker(env(), { method: 'OPTIONS', path: '/create-order', headers: { origin: 'https://dairsharaf.com', 'access-control-request-headers': 'authorization, content-type' } });
    assert.equal(good.status, 204);
    assert.equal(good.headers.get('access-control-allow-origin'), 'https://dairsharaf.com');
    assert.match(good.headers.get('access-control-allow-headers'), /(^|, )authorization(,|$)/);
    const evil = await callWorker(env(), { method: 'OPTIONS', path: '/create-order', headers: { origin: 'https://evil.example', 'access-control-request-headers': 'authorization' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    assert.equal(evil.headers.get('access-control-allow-headers'), null);
  });

  test('CORS is not authentication: an allowed origin with a forged token is still refused', async () => {
    await freshAuth();
    const o = checkoutOrder({ userId: ALICE });
    const r = await createOrderReq(env(), o, { origin: 'https://dairsharaf.com', ...bearer(await forger.idToken({ projectId: PROJECT, uid: ALICE })) });
    assert.equal(r.status, 401);
    await nothingWritten(o.id, 'forged with allowed origin');
  });

  for (const rulesName of ['prod', 'compat']) {
    test(`[${rulesName} rules] My Orders and the review purchase check see the token-linked order (only Alice's)`, async () => {
      await freshAuth();
      const mine = checkoutOrder({ userId: ALICE });
      const theirs = checkoutOrder({ userId: MALLORY });
      const unverified = checkoutOrder({ userId: ALICE }); // old-site style: no token
      assert.equal((await createOrderReq(env(), mine, bearer(await tokenFor(ALICE)))).status, 200);
      assert.equal((await createOrderReq(env(), theirs, bearer(await tokenFor(MALLORY)))).status, 200);
      assert.equal((await createOrderReq(env(), unverified)).status, 200);
      // admin marks Alice's order delivered (status-only update, like storage.ts updateStatus)
      const fsAdmin = adminDb();
      const up = await fsAdmin.commit([{ update: { name: fsAdmin.name(`orders/${mine.id}`), fields: encodeFields({ status: 'delivered' }) }, updateMask: { fieldPaths: ['status'] } }]);
      assert.ok(up.ok);

      const tenv = await browserEnv(rulesName);
      try {
        const { collection, query, where, orderBy, getDocs } = await import('firebase/firestore');
        const db = tenv.authenticatedContext(ALICE, { email: 'alice@example.com', email_verified: true }).firestore();
        // = storage.ts db.orders.getByUserId (MyOrders.tsx, hasPurchasedProduct)
        const snap = await getDocs(query(collection(db, 'orders'), where('userId', '==', ALICE), orderBy('createdAt', 'desc')));
        assert.deepEqual(snap.docs.map((d) => d.id), [mine.id], 'only the verified order of Alice');
        const bought = snap.docs.some((d) => ['processing', 'shipped', 'delivered'].includes(d.data().status) && (d.data().items || []).some((i) => i.productId === 'p-simple'));
        assert.equal(bought, true, 'review allowed once delivered');
        const mdb = tenv.authenticatedContext(MALLORY, { email: 'm@example.com', email_verified: true }).firestore();
        await assert.rejects(getDocs(query(collection(mdb, 'orders'), where('userId', '==', ALICE))));
      } finally {
        await tenv.cleanup();
      }
    });
  }
});

// ===========================================================================
// Order summary for tracking (GET /orders/:id/summary): tracking key or verified owner, never personal data
// ===========================================================================
describe('order summary (tracking key)', () => {
  const PROJECT = 'demo-dairsharaf-orders';
  const ALICE = 'aliceUid000000000000000000A1';
  const MALLORY = 'malloryUid0000000000000000M1';
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const newKey = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => B32[b % 32]).join('');
  const hashOf = async (k) => hashTrackingKey(normalizeTrackingKey(k));
  let signer;
  before(async () => {
    signer = await makeTestSigner('test-kid-summary');
  });
  async function freshS() {
    await fresh();
    clearKeyCache();
    mock.state.jwks = { keys: [signer.jwk] };
    mock.state.jwksFail = false;
  }
  const create = (order, { keyHash, token } = {}) =>
    callWorker(env(), {
      method: 'POST', path: '/create-order',
      body: { order, ...(keyHash !== undefined ? { trackingKeyHash: keyHash } : {}) },
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const summary = (id, { key, token } = {}) =>
    callWorker(env(), {
      path: `/orders/${encodeURIComponent(id)}/summary`,
      headers: { ...(key !== undefined ? { 'x-tracking-key': key } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
  const DENIED = '{"ok":false,"code":"NOT_FOUND"}';
  const PII = (o) => [o.address.fullName, o.address.phone, o.address.street, o.address.city, o.customerEmail, o.note, o.paymentDetails?.cliqReference, 'claimedUserId', 'userId', 'ownerUid', 'trackingKeyHash'].filter(Boolean);
  const piiOrder = (over = {}) => checkoutOrder({
    payment: 'cliq',
    overrides: {
      customerEmail: 'secret.buyer@example.com', note: 'leave with neighbour 0799000111',
      address: { fullName: 'Secret Buyer Name', city: 'Hidden City', street: 'Hidden Street 9', phone: '+962791234567' },
      ...over,
    },
  });

  test('key holder gets the summary: allow-listed fields only, NO personal data (CliQ order)', async () => {
    await freshS();
    const k = newKey();
    const o = piiOrder();
    assert.equal((await create(o, { keyHash: await hashOf(k) })).status, 200);
    const r = await summary(o.id, { key: k });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(Object.keys(r.body), ['ok', 'order']);
    assert.deepEqual(Object.keys(r.body.order).sort(), ['date', 'discountAmount', 'id', 'items', 'paid', 'paymentMethod', 'shippingCost', 'shippingMethod', 'status', 'subtotal', 'total'].sort());
    for (const secret of PII(o)) assert.equal(r.text.includes(secret), false, `summary leaks ${secret}`);
    assert.equal(r.text.includes(k), false, 'the key is never echoed');
    assert.equal(r.body.order.status, 'new');
    assert.equal(r.body.order.paymentMethod, 'cliq');
    assert.equal(r.body.order.paid, false);
    assert.equal(r.body.order.items.length, o.items.length);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    // the key works in any formatting the customer may type
    const typed = k.toLowerCase().match(/.{4}/g).join('-');
    assert.equal((await summary(o.id, { key: typed })).status, 200);
  });

  test('every refusal is the SAME 404: missing / wrong / malformed key, other order\'s key, unknown order', async () => {
    await freshS();
    const k1 = newKey();
    const k2 = newKey();
    const o1 = piiOrder();
    const o2 = piiOrder({ address: { fullName: 'Other Buyer', city: 'X', street: 'Y', phone: '+962791234568' } });
    assert.equal((await create(o1, { keyHash: await hashOf(k1) })).status, 200);
    assert.equal((await create(o2, { keyHash: await hashOf(k2) })).status, 200);
    const answers = [
      await summary(o1.id),
      await summary(o1.id, { key: newKey() }),
      await summary(o1.id, { key: 'not-a-key' }),
      await summary(o1.id, { key: k2 }), // swapped keys
      await summary(o2.id, { key: k1 }),
      await summary(makeOrderId(), { key: k1 }), // unknown order
      await summary('not-an-id', { key: k1 }),
    ];
    for (const a of answers) {
      assert.equal(a.status, 404);
      assert.equal(a.text, DENIED);
    }
    assert.equal((await summary(o1.id, { key: k1 })).status, 200);
    assert.equal((await summary(o2.id, { key: k2 })).status, 200);
  });

  test('order number alone: public status only (no details), summary refused', async () => {
    await freshS();
    const o = piiOrder();
    assert.equal((await create(o, { keyHash: await hashOf(newKey()) })).status, 200);
    const st = await callWorker(env(), { path: `/orders/${o.id}/status` });
    assert.deepEqual(st.body, { ok: true, exists: true, status: 'new' });
    assert.equal((await summary(o.id)).text, DENIED);
  });

  test('lost create response: the browser already has the key; the retry is a replay and the key works', async () => {
    await freshS();
    const k = newKey();
    const h = await hashOf(k);
    const o = piiOrder();
    assert.equal((await create(o, { keyHash: h })).status, 200); // saved, answer "lost"
    const again = await create(o, { keyHash: h }); // same attempt -> same key -> same hash
    assert.deepEqual(again.body, { ok: true, orderId: o.id, replay: true });
    assert.equal((await getDecoded(`orderLedger/${o.id}`)).trackingKeyHash, h);
    assert.equal((await summary(o.id, { key: k })).status, 200);
    await assertProcessedOnce(o.id, { modes: ['created'] });
  });

  test('a third party replaying the SAME guest payload with its own key gets nothing: stored hash unchanged, its key refused', async () => {
    await freshS();
    const kOwner = newKey();
    const kAttacker = newKey();
    const o = piiOrder();
    assert.equal((await create(o, { keyHash: await hashOf(kOwner) })).status, 200);
    const r = await create(o, { keyHash: await hashOf(kAttacker) });
    assert.deepEqual(r.body, { ok: true, orderId: o.id, replay: true }, 'replay says nothing about the key');
    assert.equal(r.text.includes(kOwner), false);
    assert.equal((await getDecoded(`orderLedger/${o.id}`)).trackingKeyHash, await hashOf(kOwner), 'hash written once');
    assert.equal((await summary(o.id, { key: kAttacker })).text, DENIED);
    assert.equal((await summary(o.id, { key: kOwner })).status, 200);
    await assertProcessedOnce(o.id, { modes: ['created'] });
  });

  test('old orders (no key stored, guest or claimed uid): status works, summary refused for any key', async () => {
    await freshS();
    const g = checkoutOrder({ userId: 'guest' });
    const c = checkoutOrder({ userId: ALICE });
    assert.equal((await create(g)).status, 200);
    assert.equal((await create(c)).status, 200);
    for (const o of [g, c]) {
      assert.equal('trackingKeyHash' in (await getDecoded(`orderLedger/${o.id}`)), false);
      assert.equal((await summary(o.id, { key: newKey() })).text, DENIED);
      assert.equal((await callWorker(env(), { path: `/orders/${o.id}/status` })).body.exists, true);
    }
  });

  test('old site: browser-written order without ledger -> summary refused until processed', async () => {
    await freshS();
    const o = checkoutOrder({ userId: 'guest' });
    await putDoc(`orders/${o.id}`, { ...o, status: 'new', seenByAdmin: false }, { serverTimeFields: ['createdAt', 'updatedAt'] });
    assert.equal((await summary(o.id, { key: newKey() })).text, DENIED);
  });

  test('malformed trackingKeyHash in a create request is ignored (order still created, no hash stored)', async () => {
    await freshS();
    const o = checkoutOrder({ userId: 'guest' });
    assert.equal((await create(o, { keyHash: 'XYZ' })).status, 200);
    assert.equal('trackingKeyHash' in (await getDecoded(`orderLedger/${o.id}`)), false);
  });

  test('verified OWNER may read the summary without a key; other account / bad token / no token refused', async () => {
    await freshS();
    const o = checkoutOrder({ userId: ALICE });
    const aliceToken = await signer.idToken({ projectId: PROJECT, uid: ALICE });
    assert.equal((await create(o, { token: aliceToken })).status, 200);
    assert.equal((await summary(o.id, { token: aliceToken })).status, 200);
    assert.equal((await summary(o.id, { token: await signer.idToken({ projectId: PROJECT, uid: MALLORY }) })).text, DENIED);
    assert.equal((await summary(o.id, { token: 'garbage.token.here' })).text, DENIED);
    assert.equal((await summary(o.id)).text, DENIED);
  });

  test('unified 409: owned order (other account) and guest order (different payload) answer byte-identically', async () => {
    await freshS();
    const owned = checkoutOrder({ userId: ALICE });
    const guest = checkoutOrder({ userId: 'guest' });
    assert.equal((await create(owned, { token: await signer.idToken({ projectId: PROJECT, uid: ALICE }) })).status, 200);
    assert.equal((await create(guest)).status, 200);
    const a = await create(owned, { token: await signer.idToken({ projectId: PROJECT, uid: MALLORY }) });
    const b = await create({ ...guest, address: { ...guest.address, phone: '+962790000123' } });
    assert.equal(a.status, 409);
    assert.equal(a.text, b.text);
    assert.equal(a.text, '{"ok":false,"code":"ORDER_EXISTS"}');
  });

  test('CORS: allowed origin may send x-tracking-key; summary rate-limited like status', async () => {
    const pre = await callWorker(env(), { method: 'OPTIONS', path: '/orders/ORD-AAAA1111-BBBB/summary', headers: { origin: 'https://dairsharaf.com', 'access-control-request-headers': 'x-tracking-key' } });
    assert.match(pre.headers.get('access-control-allow-headers'), /x-tracking-key/);
    const lim = env({ RATE_LIMIT_STATUS_PER_MIN: '2' });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await callWorker(lim, { path: '/orders/ORD-AAAA1111-BBBB/summary', headers: { 'cf-connecting-ip': '10.200.0.9' } })).status);
    assert.ok(codes.includes(429), codes.join(','));
  });
});

// ===========================================================================
describe('cron: ONE order per run, oldest due first, channels independent, no duplicates', () => {
  const sentFor = (ch, id) => mock.state.calls.filter((c) => c.channel === ch && c.ok && c.orderId === id).length;
  const triesFor = (ch, id) => mock.state.calls.filter((c) => c.channel === ch && c.orderId === id).length;
  /** n orders whose inline notifications BOTH failed (created in this order: oldest first) */
  const failedOrders = async (n, e = env()) => {
    mock.state.failAlways.telegram = true;
    mock.state.failAlways.email = true;
    const out = [];
    for (let i = 0; i < n; i++) {
      const o = checkoutOrder();
      assert.equal((await createOrderReq(e, o)).status, 200);
      out.push(o.id);
      await sleep(5); // distinct due times
    }
    mock.state.failAlways.telegram = false;
    mock.state.failAlways.email = false;
    return out;
  };

  test('each run handles exactly ONE order, the oldest due first; nothing removed from the queue before it is done', async () => {
    await fresh();
    const [a, b, c] = await failedOrders(3);
    for (const id of [a, b, c]) {
      const l = await getDecoded(`orderLedger/${id}`);
      assert.equal(l.notifyPending, true);
      assert.ok(l.notifyNextAt instanceof Date, 'queued with a due time');
    }
    assert.equal((await runCron(env())).retried, 1);
    assert.deepEqual([a, b, c].map((id) => sentFor('telegram', id) + sentFor('email', id)), [2, 0, 0], 'run 1: the oldest only');
    await runCron(env());
    assert.deepEqual([a, b, c].map((id) => sentFor('telegram', id) + sentFor('email', id)), [2, 2, 0], 'run 2: the next oldest');
    await runCron(env());
    assert.deepEqual([a, b, c].map((id) => sentFor('telegram', id) + sentFor('email', id)), [2, 2, 2]);
    for (const id of [a, b, c]) {
      const l = await getDecoded(`orderLedger/${id}`);
      assert.equal(l.notifyPending, false);
      assert.equal('notifyNextAt' in l, false, 'left the queue only when done');
    }
    // more runs: nothing is sent again
    const before = mock.state.calls.length;
    for (let i = 0; i < 4; i++) assert.equal((await runCron(env())).retried, 0);
    assert.equal(mock.state.calls.length, before, 'no unintended duplicates');
  });

  test('a permanently failing (older) order never blocks the others; its working channel is sent once; it stops after NOTIFY_MAX_ATTEMPTS', async () => {
    await fresh();
    const e = env({ NOTIFY_MAX_ATTEMPTS: '3' });
    const [bad, b, c] = await failedOrders(3, e);
    mock.state.failOrder.telegram.add(bad);
    await runCron(e); // bad: telegram fails again, email sent; moved behind the others
    await runCron(e); // b
    await runCron(e); // c
    assert.equal(sentFor('telegram', b) + sentFor('email', b), 2, 'b not blocked');
    assert.equal(sentFor('telegram', c) + sentFor('email', c), 2, 'c not blocked');
    assert.equal(sentFor('email', bad), 1, "bad's e-mail sent once (channels independent)");
    for (let i = 0; i < 4; i++) await runCron(e);
    const l = await getDecoded(`orderLedger/${bad}`);
    assert.equal(l.notifications.telegram.state, 'failed', 'never marked sent without a confirmed send');
    assert.equal(l.notifications.telegram.attempts, 3);
    assert.equal(triesFor('telegram', bad), 3);
    assert.equal(sentFor('email', bad), 1, 'e-mail never resent');
    assert.equal(l.notifyPending, false);
  });

  test('two cron runs AT THE SAME TIME: no message sent twice; every order completes', async () => {
    await fresh();
    const ids = await failedOrders(3);
    for (let round = 0; round < 3; round++) await Promise.all([runCron(env()), runCron(env())]);
    for (const id of ids) {
      assert.equal(sentFor('telegram', id), 1, `${id}: one telegram`);
      assert.equal(sentFor('email', id), 1, `${id}: one e-mail`);
    }
    await Promise.all([runCron(env()), runCron(env())]);
    for (const id of ids) assert.equal(sentFor('telegram', id) + sentFor('email', id), 2);
  });

  test('Telegram-only failure: the e-mail is sent once and never again; Telegram retried by cron, sent once', async () => {
    await fresh();
    mock.state.failNext.telegram = 1;
    const o = checkoutOrder();
    await createOrderReq(env(), o);
    let l = await getDecoded(`orderLedger/${o.id}`);
    assert.deepEqual([l.notifications.telegram.state, l.notifications.email.state], ['failed', 'sent']);
    await runCron(env());
    await runCron(env());
    l = await getDecoded(`orderLedger/${o.id}`);
    assert.deepEqual([l.notifications.telegram.state, l.notifications.email.state], ['sent', 'sent']);
    assert.equal(sentFor('telegram', o.id), 1);
    assert.equal(triesFor('email', o.id), 1, 'e-mail not retried');
  });

  test('E-mail-only failure: Telegram sent once and never again; e-mail retried by cron, sent once', async () => {
    await fresh();
    mock.state.failNext.email = 1;
    const o = checkoutOrder();
    await createOrderReq(env(), o);
    let l = await getDecoded(`orderLedger/${o.id}`);
    assert.deepEqual([l.notifications.telegram.state, l.notifications.email.state], ['sent', 'failed']);
    await runCron(env());
    await runCron(env());
    l = await getDecoded(`orderLedger/${o.id}`);
    assert.deepEqual([l.notifications.telegram.state, l.notifications.email.state], ['sent', 'sent']);
    assert.equal(triesFor('telegram', o.id), 1, 'telegram not retried');
    assert.equal(sentFor('email', o.id), 1);
  });

  test('connection lost to the provider (no answer): NOT marked sent; retried by cron; sent once', async () => {
    await fresh();
    mock.state.drop.telegram = 1;
    const o = checkoutOrder();
    await createOrderReq(env(), o);
    let l = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(l.notifications.telegram.state, 'failed');
    assert.equal(l.notifications.telegram.lastStatus, 0);
    await runCron(env());
    l = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(l.notifications.telegram.state, 'sent');
    assert.equal(sentFor('telegram', o.id), 1);
    assert.equal(sentFor('email', o.id), 1);
  });

  test('provider TIMEOUT (request never answered): the send is aborted before the lease ends, NOT marked sent; retried; sent once', async () => {
    await fresh();
    const e = env({ NOTIFY_SEND_TIMEOUT_MS: '400', NOTIFY_LEASE_MS: '60000' });
    mock.state.hang.telegram = 1;
    const o = checkoutOrder();
    const t0 = Date.now();
    await createOrderReq(e, o);
    assert.ok(Date.now() - t0 < 30_000, 'the hung send did not hold the request until the lease');
    let l = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(l.notifications.telegram.state, 'failed', 'timed out -> failed, never sent');
    assert.equal(l.notifyPending, true);
    await runCron(e);
    l = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(l.notifications.telegram.state, 'sent');
    assert.equal(sentFor('telegram', o.id), 1);
    assert.equal(triesFor('telegram', o.id), 2, 'one hung + one delivered');
  });

  // lease taken over by ANOTHER run while this run is still sending; this run's result arrives late
  const waitCall = async (ch, kind) => {
    for (let i = 0; i < 150 && !mock.state.calls.some((c) => c.channel === ch && (kind ? c.broken === kind : true)); i++) await sleep(20);
  };
  const putChannel = async (id, ch, st) => {
    const fs = adminDb();
    assert.ok((await fs.commit([{ update: { name: fs.name(`orderLedger/${id}`), fields: encodeFields({ notifications: { [ch]: st } }) }, updateMask: { fieldPaths: [`notifications.${ch}`] } }])).ok);
  };
  for (const ch of ['telegram', 'email']) {
    const other = ch === 'telegram' ? 'email' : 'telegram';
    test(`${ch}: lease taken over DURING the send, newer run delivered it -> the old run's late "failed" never overwrites "sent"`, async () => {
      await fresh();
      const e = env({ NOTIFY_SEND_TIMEOUT_MS: '1500' });
      mock.state.hang[ch] = 1;
      const o = checkoutOrder();
      const pending = createOrderReq(e, o); // run 1: claims ${ch}; the send hangs
      await waitCall(ch, 'hang');
      const claimed = (await getDecoded(`orderLedger/${o.id}`)).notifications[ch];
      assert.equal(claimed.state, 'sending');
      assert.ok(claimed.claimId, 'the claim carries its own id');
      await putChannel(o.id, ch, { state: 'sent', attempts: 2, sentAt: new Date(), claimId: 'run-2' }); // run 2 took over and delivered
      assert.equal((await pending).status, 200); // run 1 times out -> tries to record "failed"
      const l = await getDecoded(`orderLedger/${o.id}`);
      assert.equal(l.notifications[ch].state, 'sent', 'the newer state is kept');
      assert.equal(l.notifications[ch].attempts, 2);
      assert.equal(l.notifications[other].state, 'sent', 'the other channel is unaffected');
      assert.equal(l.notifyPending, false);
      await runCron(e);
      await runCron(e);
      assert.equal(triesFor(ch, o.id), 1, 'nothing resent');
      assert.equal(triesFor(other, o.id), 1);
    });

    test(`${ch}: newer run claimed the channel, old run's send succeeded LATE -> its late "sent" never overwrites the newer claim (documented at-least-once: a second message is possible)`, async () => {
      await fresh();
      const e = env({ NOTIFY_SEND_TIMEOUT_MS: '5000' });
      mock.state.late[ch] = 1;
      mock.state.lateMs = 1_500;
      const o = checkoutOrder();
      const pending = createOrderReq(e, o); // run 1: delivered, but the answer comes late
      await waitCall(ch);
      // run 2 claimed the channel (run 1's lease considered expired) and then crashed: its lease has expired too
      await putChannel(o.id, ch, { state: 'sending', attempts: 2, leaseUntil: new Date(Date.now() - 1000), claimId: 'run-2' });
      assert.equal((await pending).status, 200); // run 1's late success: its claim is gone -> nothing written
      let l = await getDecoded(`orderLedger/${o.id}`);
      assert.equal(l.notifications[ch].state, 'sending', 'run 2 still owns the channel');
      assert.equal(l.notifications[ch].claimId, 'run-2');
      assert.equal(l.notifyPending, true, 'still queued');
      await runCron(e); // run 2's lease expired -> re-claimed and sent
      l = await getDecoded(`orderLedger/${o.id}`);
      assert.equal(l.notifications[ch].state, 'sent');
      assert.equal(l.notifications[ch].attempts, 3);
      assert.equal(l.notifyPending, false);
      // the limit, made explicit: the provider got the message twice (no idempotency key at Telegram / SendGrid)
      assert.equal(sentFor(ch, o.id), 2, 'at-least-once, not exactly-once');
      assert.equal(sentFor(other, o.id), 1, 'the other channel was sent once');
    });
  }

  test('a ledger queued BEFORE notifyNextAt existed (notifyPending only) is still processed', async () => {
    await fresh();
    mock.state.failNext.telegram = 1;
    const o = checkoutOrder();
    await createOrderReq(env(), o);
    const fs = adminDb();
    // drop the due time (as on a ledger written by an earlier version)
    assert.ok((await fs.commit([{ update: { name: fs.name(`orderLedger/${o.id}`), fields: {} }, updateMask: { fieldPaths: ['notifyNextAt'] } }])).ok);
    assert.equal('notifyNextAt' in (await getDecoded(`orderLedger/${o.id}`)), false);
    assert.equal((await runCron(env())).retried, 1);
    const l = await getDecoded(`orderLedger/${o.id}`);
    assert.equal(l.notifications.telegram.state, 'sent');
    assert.equal(l.notifyPending, false);
  });
});
