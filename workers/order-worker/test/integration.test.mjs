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
    assert.equal(r.body.code, 'ORDER_ID_CONFLICT');
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
    assert.equal(r.body.code, 'ORDER_ID_CONFLICT');
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
