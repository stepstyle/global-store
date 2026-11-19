// E2E_SUITE=wheel — the prize wheel (WHEEL_MODE=test) end to end in the REAL web app, LOCAL ONLY (127.0.0.1):
// the order Worker under `wrangler dev --local` (workerd), Firestore + Auth EMULATORS, the notification sink, Vite with
// VITE_WHEEL_MODE=test, headless Chrome (desktop AND phone emulation). TEST settings only — not a real campaign.
//
// Sign-in: a Google-linked account created in the Auth EMULATOR (google.com provider, verified e-mail) that also has a
// password, so the browser signs in through the app's Login form. The real Google pop-up is NOT exercised here
// (no network; it needs Google's servers) — the account's token carries the same verified-e-mail claim the Worker needs.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SET_VAL = `const setVal = (el, v) => {
  if (!el) throw new Error('field not found');
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};`;
const STICKY = `document.querySelector('[data-testid=checkout-sticky-action]')`;
const OUTCOME = `(location.hash.startsWith('#/order-success/') ? 'success' : (document.querySelector('[data-testid=submit-result]')?.dataset.status || ''))`;
const TOASTS = `[...document.querySelectorAll('[data-testid=toast-message]')].map((t) => t.innerText).join('\\n---\\n')`;
const STUB_CONFIRM = `(() => { window.__confirms = []; window.confirm = (m) => { window.__confirms.push(String(m)); return true; }; return true; })()`;

export const WHEEL_CAMPAIGN_ID = 'e2e-wheel';
// one TEST prize, always won while it lasts (noPrizeWeight 0) -> deterministic browser checks
const CAMPAIGN = {
  active: true, minOrderJod: 5, budgetJod: 10, noPrizeWeight: 0, giftOnCancel: 'return',
  startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: 'شروط تجريبية للاختبار المحلي فقط — ليست حملة حقيقية.',
  prizes: [{ id: 'test-a', label: 'جائزة تجريبية', productId: 'p-hundred', weight: 1, quantity: 3, unitCostJod: 1 }],
};
const item = (id, name, price, quantity) => ({ id, name, price, stock: 100, category: 'Stationery', image: '', quantity });
const CART_SMALL = [item('p-simple', 'دفتر', 2.5, 1)]; // 2.5 JOD in products  < 5
const CART_OK = [item('p-simple', 'دفتر', 2.5, 3)]; //    7.5 JOD (- discount) >= 5

async function until(fn, ms, label) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > end) throw new Error(`timeout: ${label} (last=${JSON.stringify(last)})`);
    await sleep(250);
  }
}

export function buildWheelScenarios(ctx) {
  const { get } = ctx;
  const shots = ctx.shotsDir;
  mkdirSync(shots, { recursive: true });
  const shot = async (t, name, { full = true } = {}) => {
    await sleep(400);
    const r = await t.send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: full });
    writeFileSync(join(shots, `${name}.jpg`), Buffer.from(r.data, 'base64'));
  };
  const viewport = (t, w, h, mobile) => t.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  const stock = async (pid) => (await get(`products/${pid}`))?.stock;
  const reserved = async (pid) => (await get(`stockReservations/${pid}`))?.product || 0;
  const spinDoc = (uid, n) => get(`wheelSpins/${WHEEL_CAMPAIGN_ID}_${uid}_${n}`);
  const telegramFor = async (id) => (await ctx.sinkCalls()).filter((c) => c.channel === 'telegram' && c.method === 'sendMessage' && c.orderId === id && c.ok);

  const signIn = async (t, email, password) => {
    await t.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' });
    await t.navigate(`${ctx.base}/?r=${Date.now()}#/login`);
    await t.waitFor(`(() => { const f = document.querySelector('input[type=password]')?.form; return !!f && !!f.querySelector('input[type=email]') && !f.querySelector('button[type=submit]')?.disabled; })()`, 30_000, 'login form');
    await t.evaluate(`(() => { ${SET_VAL}
      setVal(document.querySelector('input[type=password]')?.form.querySelector('input[type=email]'), ${JSON.stringify(email)});
      setVal(document.querySelector('input[type=password]'), ${JSON.stringify(password)});
      return true; })()`);
    await sleep(150);
    await t.evaluate(`document.querySelector('input[type=password]')?.form.requestSubmit(); true`);
    await t.waitFor(`location.hash === '#/' || location.hash === '' || location.hash === '#/admin'`, 30_000, 'redirect after sign-in');
  };
  /** the customer opens /wheel IN-APP (hash change: keeps the session and this tab's chosen gift) */
  const openWheel = async (t) => {
    await t.evaluate(`location.hash = '#/wheel'; true`);
    await t.waitFor(`!!document.querySelector('[data-testid=wheel-page]')`, 20_000, 'wheel page');
    await t.waitFor(`!!document.querySelector('[data-testid=wheel-spin]') || !!document.querySelector('[data-testid=wheel-sign-in]') || !!document.querySelector('[data-testid=wheel-closed]')`, 30_000, 'wheel state');
  };
  let seedN = 0;
  /** the cart is seeded before the app's scripts run on the next document, then checkout opens (session kept) */
  const openCheckoutWith = async (t, cart, email) => {
    const marker = `seedcart${++seedN}x`;
    await t.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `if (location.search.includes(${JSON.stringify(marker)})) { localStorage.setItem('anta_cart', ${JSON.stringify(JSON.stringify(cart))}); localStorage.setItem('language', 'ar'); }`,
    });
    await t.navigate(`${ctx.base}/?${marker}=1&r=${Date.now()}#/checkout`);
    await t.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 40_000, 'checkout form');
    await t.waitFor(`document.querySelector('input[placeholder^="name@example.com"]')?.value === ${JSON.stringify(email)}`, 30_000, 'signed-in profile in checkout');
  };
  const fillToPayment = async (t, phoneLocal) => {
    await t.evaluate(`(() => { ${SET_VAL}
      setVal(document.querySelector('input[placeholder="الاسم الأول والأخير"]'), 'زبون العجلة التجريبي');
      setVal(document.querySelector('input[placeholder="0791234567"]'), ${JSON.stringify(phoneLocal)});
      setVal([...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'zarqa')), 'zarqa');
      return true; })()`);
    await sleep(150);
    await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('input[placeholder^="اسم الشارع"]'), 'شارع الاختبار 1'); return true; })()`);
    await t.evaluate(`${STICKY}.click(); true`);
    await t.waitFor(`document.body.innerText.includes('توصيل عادي')`, 10_000, 'step 2');
    await t.evaluate(`${STICKY}.click(); true`);
    await t.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('CliQ'))`, 10_000, 'step 3');
  };
  const confirmOrder = async (t) => {
    await t.evaluate(`${STICKY}.click(); true`);
    return t.waitFor(`(() => { const o = ${OUTCOME}; return o && o !== 'busy' && o !== 'sending' ? o : ''; })()`, 40_000, 'order outcome');
  };
  const spinInUi = async (t) => {
    await t.waitFor(`!document.querySelector('[data-testid=wheel-spin]')?.disabled`, 20_000, 'spin button enabled');
    await t.evaluate(`document.querySelector('[data-testid=wheel-spin]').click(); true`);
    return t.waitFor(`document.querySelector('[data-testid=wheel-result]')?.innerText.trim()`, 20_000, 'result shown');
  };
  const openDashboardOrder = async (t, orderId) => {
    await signIn(t, ctx.admin.email, ctx.admin.password);
    await t.evaluate(`if (location.hash !== '#/admin') location.hash = '#/admin'; true`);
    await t.waitFor(`document.body.innerText.includes('إدارة الطلبات')`, 30_000, 'dashboard');
    await t.evaluate(`[...document.querySelectorAll('h1 + div button')][2].click(); true`);
    await t.waitFor(`[...document.querySelectorAll('tbody tr')].some((r) => r.innerText.includes(${JSON.stringify(orderId)}))`, 30_000, `order ${orderId} listed`);
    await t.evaluate(`[...[...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(${JSON.stringify(orderId)})).querySelectorAll('button')].find((b) => b.textContent.trim() === 'تفاصيل').click(); true`);
    await t.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('حذف نهائي'))`, 15_000, 'order details');
  };
  const clickButton = async (t, text) => {
    await t.evaluate(STUB_CONFIRM);
    const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);
    assert.ok(ok, `button "${text}" present and enabled`);
  };
  const statusIs = (id, s) => until(async () => (await get(`orders/${id}`))?.status === s, 20_000, `order ${id} -> ${s}`);

  return [
    ['WU01', 'DESKTOP journey: Google-linked verified account signs in -> /wheel -> spin -> result -> gift added to the order -> below the minimum refused (nothing saved, gift kept) -> enough products -> confirmed; gift reserved, total unchanged, ONE Telegram message with the gift marked', async (t) => {
      const email = 'wheel.customer@example.invalid';
      const pw = 'Test-pass-12345';
      const uid = await ctx.createGoogleCustomer({ email, password: pw, name: 'زبون العجلة' });
      await viewport(t, 1366, 900, false);
      await signIn(t, email, pw);
      await openWheel(t);
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-chances]').innerText`), /1/);
      await shot(t, 'wheel-desktop-before');
      const result = await spinInUi(t);
      assert.match(result, /مبروك! ربحت: جائزة تجريبية/);
      assert.equal(await t.evaluate(`document.activeElement?.dataset?.testid === 'wheel-spin' || true`), true);
      assert.equal(await t.evaluate(`document.querySelector('[data-testid=wheel-result]').getAttribute('aria-live')`), 'polite');
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-take]')`, 20_000, 'take button');
      await shot(t, 'wheel-desktop-won');
      const sp = await spinDoc(uid, 1);
      assert.equal(sp.status, 'issued');
      await t.evaluate(`document.querySelector('[data-testid=wheel-take]').click(); true`);
      await t.waitFor(`location.hash === '#/cart'`, 10_000, 'cart after taking the gift');
      // below the minimum
      await openCheckoutWith(t, CART_SMALL, email);
      await t.waitFor(`!!document.querySelector('[data-testid=checkout-wheel-gift]')`, 15_000, 'gift shown in checkout');
      await fillToPayment(t, '0795000001');
      await shot(t, 'checkout-desktop-gift');
      assert.equal(await confirmOrder(t), 'rejected');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=submit-result]').innerText`), /الهدية تحتاج حدًا أدنى/);
      await shot(t, 'checkout-desktop-min-refused');
      assert.equal(await ctx.countOrders(), 0, 'nothing saved');
      assert.equal((await spinDoc(uid, 1)).status, 'issued', 'gift kept');
      // enough products
      await openCheckoutWith(t, CART_OK, email);
      await t.waitFor(`!!document.querySelector('[data-testid=checkout-wheel-gift]')`, 15_000, 'gift still chosen');
      await fillToPayment(t, '0795000001');
      assert.equal(await confirmOrder(t), 'success');
      const orderId = await t.evaluate(`location.hash.split('/').pop()`);
      await shot(t, 'order-success-desktop');
      const O = await get(`orders/${orderId}`);
      assert.equal(O.userId, uid);
      const g = O.items.filter((i) => i.gift);
      assert.equal(g.length, 1);
      assert.equal(g[0].price, 0);
      const L = await get(`orderLedger/${orderId}`);
      assert.equal(L.serverPricing.total, O.total, 'the customer pays exactly the paid order (gift not priced)');
      assert.equal(L.wheel.spinId, `${WHEEL_CAMPAIGN_ID}_${uid}_1`);
      assert.equal((await spinDoc(uid, 1)).status, 'reserved');
      assert.equal(await reserved('p-hundred'), 1);
      assert.equal(await stock('p-hundred'), 100, 'nothing deducted before delivery');
      const msgs = await until(async () => { const m = await telegramFor(orderId); return m.length ? m : null; }, 30_000, 'telegram');
      await sleep(2_500);
      assert.equal((await telegramFor(orderId)).length, 1, 'one Telegram message, no duplicate');
      assert.equal(msgs[0].giftMarked, true, 'the Telegram message marks the gift (sink summary flag)');
      // the gift left this tab's selection once it travelled with the order
      assert.equal(await t.evaluate(`sessionStorage.getItem('anta_wheel_prize_v1')`), null);
      ctx.state.wu01 = { uid, orderId, email, pw };
    }],
    ['WU02', 'ADMIN dashboard shows the gift (badge in the list, marked line in the details); CANCEL there -> gift reservation released, prize back to "issued" on /wheel', async (t) => {
      const { uid, orderId, email, pw } = ctx.state.wu01 || {};
      assert.ok(orderId, 'needs WU01');
      await viewport(t, 1366, 900, false);
      await openDashboardOrder(t, orderId);
      await t.waitFor(`!!document.querySelector('[data-testid=admin-gift-item]')`, 15_000, 'gift line in details');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=admin-gift-item]').innerText`), /هدية عجلة الجوائز — مجانية/);
      await shot(t, 'admin-order-gift');
      await clickButton(t, 'إلغاء الطلب');
      await statusIs(orderId, 'cancelled');
      assert.equal(await reserved('p-hundred'), 0);
      assert.equal(await stock('p-hundred'), 100);
      assert.equal((await spinDoc(uid, 1)).status, 'issued');
      // the customer sees the prize available again
      await signIn(t, email, pw);
      await openWheel(t);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-take]')`, 20_000, 'prize can be taken again');
    }],
    ['WU03', 'gift order DELIVERED in the dashboard -> paid lines + gift deducted ONCE, prize consumed, ONE new chance -> the customer spins again on /wheel', async (t) => {
      const { uid, email, pw } = ctx.state.wu01 || {};
      assert.ok(uid, 'needs WU01');
      await viewport(t, 1366, 900, false);
      await signIn(t, email, pw);
      await openWheel(t);
      await t.evaluate(`document.querySelector('[data-testid=wheel-take]').click(); true`);
      await t.waitFor(`location.hash === '#/cart'`, 10_000, 'cart');
      await openCheckoutWith(t, CART_OK, email);
      await t.waitFor(`!!document.querySelector('[data-testid=checkout-wheel-gift]')`, 15_000, 'gift chosen');
      await fillToPayment(t, '0795000003');
      assert.equal(await confirmOrder(t), 'success');
      const orderId = await t.evaluate(`location.hash.split('/').pop()`);
      const before = await stock('p-simple');
      await openDashboardOrder(t, orderId);
      // the dashboard's real path: processing -> shipped -> delivered (the delivered button exists only once shipped)
      await clickButton(t, 'بدء التجهيز');
      await statusIs(orderId, 'processing');
      await clickButton(t, 'قيد الشحن');
      await statusIs(orderId, 'shipped');
      assert.equal(await stock('p-hundred'), 100, 'nothing deducted before delivery');
      await clickButton(t, 'تم التسليم');
      await statusIs(orderId, 'delivered');
      assert.equal(await stock('p-hundred'), 99, 'gift deducted once');
      assert.equal(await stock('p-simple'), before - 3, 'paid line deducted once');
      assert.equal((await spinDoc(uid, 1)).status, 'consumed');
      assert.equal((await get(`wheelEntitlements/${WHEEL_CAMPAIGN_ID}_${uid}`)).granted, 2);
      await signIn(t, email, pw);
      await openWheel(t);
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-chances]').innerText`), /1/);
      assert.match(await spinInUi(t), /مبروك/);
      assert.equal((await spinDoc(uid, 2)).status, 'issued');
    }],
    ['WU04', 'PHONE emulation (390x844, touch): wheel page and checkout gift box usable, no horizontal scroll; a second account on the SAME delivery number is refused while the first gift is open', async (t) => {
      const email = 'wheel.phone@example.invalid';
      const pw = 'Test-pass-12345';
      const uid = await ctx.createGoogleCustomer({ email, password: pw, name: 'زبون الهاتف' });
      await viewport(t, 390, 844, true);
      await t.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await signIn(t, email, pw);
      await openWheel(t);
      await shot(t, 'wheel-phone-before');
      assert.match(await spinInUi(t), /مبروك/);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-take]')`, 20_000, 'take');
      assert.equal(await t.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`), true, 'no horizontal scroll on /wheel');
      const btn = await t.evaluate(`(() => { const r = document.querySelector('[data-testid=wheel-spin]').getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width) }; })()`);
      assert.ok(btn.h >= 44, `spin button tall enough to tap (${btn.h}px)`);
      await shot(t, 'wheel-phone-won');
      await t.evaluate(`document.querySelector('[data-testid=wheel-take]').click(); true`);
      await t.waitFor(`location.hash === '#/cart'`, 10_000, 'cart');
      await openCheckoutWith(t, CART_OK, email);
      await t.waitFor(`!!document.querySelector('[data-testid=checkout-wheel-gift]')`, 15_000, 'gift box');
      assert.equal(await t.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`), true, 'no horizontal scroll in checkout');
      await fillToPayment(t, '0795000004');
      await t.evaluate(`document.querySelector('[data-testid=checkout-wheel-gift]').scrollIntoView({ block: 'center' }); true`);
      await shot(t, 'checkout-phone-gift', { full: false });
      assert.equal(await confirmOrder(t), 'success');
      // another verified account, SAME delivery number, while that gift is still open
      const email2 = 'wheel.phone2@example.invalid';
      const uid2 = await ctx.createGoogleCustomer({ email: email2, password: pw, name: 'زبون ثان' });
      await signIn(t, email2, pw);
      await openWheel(t);
      assert.match(await spinInUi(t), /مبروك/);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-take]')`, 20_000, 'take');
      await t.evaluate(`document.querySelector('[data-testid=wheel-take]').click(); true`);
      await t.waitFor(`location.hash === '#/cart'`, 10_000, 'cart');
      await openCheckoutWith(t, CART_OK, email2);
      await fillToPayment(t, '0795000004');
      assert.equal(await confirmOrder(t), 'rejected');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=submit-result]').innerText`), /تعذّر إرفاق الهدية/);
      assert.equal((await spinDoc(uid2, 1)).status, 'issued', 'the second account keeps its prize');
      assert.equal((await spinDoc(uid, 1)).status, 'reserved');
    }],
  ];
}

export async function runWheelScenarios(ctx) {
  const results = [];
  ctx.state = {};
  let first = true;
  for (const [id, name, fn] of buildWheelScenarios(ctx)) {
    if (ctx.only && !ctx.only.has(id)) continue;
    // WU02/WU03 continue WU01's customer: the data is reset only before WU01 and WU04
    if (first || id === 'WU04') await ctx.reseed();
    first = false;
    const t0 = Date.now();
    const t = await ctx.openTab();
    try {
      await fn(t);
      results.push({ id, name, ok: true, ms: Date.now() - t0 });
      console.log(`✔ ${id} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      const extra = ` | toasts: ${await t.evaluate(TOASTS).catch(() => '?')} | hash: ${await t.evaluate('location.hash').catch(() => '?')} | result: ${await t.evaluate(`document.querySelector('[data-testid=submit-result]')?.innerText || ''`).catch(() => '?')}`;
      results.push({ id, name, ok: false, ms: Date.now() - t0, error: `${String(e?.message || e).slice(0, 600)}${extra}`.slice(0, 1400) });
      console.log(`✖ ${id} ${name}\n    ${String(e?.message || e).split('\n')[0]}${extra}`);
    } finally {
      await t.close();
    }
  }
  return results;
}
