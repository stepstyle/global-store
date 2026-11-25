// E2E_SUITE=wheel — prize wheel v2 + Google sign-in at checkout, end to end in the REAL web app, LOCAL ONLY (127.0.0.1):
// the order Worker under `wrangler dev --local` (workerd, WHEEL_MODE=test, ORDER_SIGN_IN=google, PRICE_CHECK_MODE
// =enforce), Firestore + Auth EMULATORS, the notification sink, Vite with VITE_WHEEL_MODE=test, headless Chrome
// (desktop AND phone emulation). TEST settings only — not a real campaign, not real prizes or probabilities.
//
// Google sign-in: the app's REAL signInWithPopup against the Auth EMULATOR — the popup is the emulator's own sign-in page
// (127.0.0.1), driven here like a customer would (add account / choose account, or close it). It is not Google's real
// account chooser (that needs Google's servers and the production domain): that last check stays a manual one.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { guestPath } from '../../src/wheel-guest.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SET_VAL = `const setVal = (el, v) => {
  if (!el) throw new Error('field not found');
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};`;
const STICKY = `document.querySelector('[data-testid=checkout-sticky-action]')`;
// the REQUIRED agreement box at step 3 is ticked by the customer (as a person would) before confirming; no-op elsewhere
const AGREE = "(() => { const b = document.querySelector('[data-testid=checkout-agreement-box]'); if (b && !b.checked) b.click(); return true; })();";
const OUTCOME = `(location.hash.startsWith('#/order-success/') ? 'success' : (document.querySelector('[data-testid=submit-result]')?.dataset.status || (document.querySelector('[data-testid=submit-blocked]') ? 'blocked:' + (document.querySelector('[data-testid=submit-blocked]').dataset.google || '') : '')))`;
const TOASTS = `[...document.querySelectorAll('[data-testid=toast-message]')].map((t) => t.innerText).join('\\n---\\n')`;
const STUB_CONFIRM = `(() => { window.__confirms = []; window.confirm = (m) => { window.__confirms.push(String(m)); return true; }; return true; })()`;
// which segment is under the top pointer (same geometry as services/wheel.ts segmentAt) vs the result the Worker drew
const LANDING = `(() => { const svg = document.querySelector('[data-testid=wheel-svg]'); const segs = [...document.querySelectorAll('[data-testid=wheel-segment]')]; const n = segs.length; const r = ((Number(svg.dataset.rotation) % 360) + 360) % 360; const i = Math.floor((((360 - r) % 360) / (360 / n))) % n; return { landed: segs[i]?.dataset.slotId || '', result: document.querySelector('[data-testid=wheel-result]')?.dataset.prizeId || '', n, rotation: Number(svg.dataset.rotation) }; })()`;

export const WHEEL_CAMPAIGN_ID = 'e2e-wheel';
const BIG = 1_000_000; // a slot with this weight is drawn (all but surely: the "حظ أوفر" slots have weight 1 each)
const NONES = [1, 2, 3].map((i) => ({ id: `none-${i}`, type: 'none', label: 'حظ أوفر', weight: 1 }));
const item = (id, name, price, quantity) => ({ id, name, price, stock: 100, category: 'Stationery', image: '', quantity });
const CART_SMALL = [item('p-simple', 'دفتر', 2.5, 1)]; //      2.5 JOD in products  < 5
const CART_OK = [item('p-simple', 'دفتر', 2.5, 3)]; //         7.5 JOD (volume discount 0.75)
const CART_1499 = [item('p-1499', 'منتج اختبار 14.99', 14.99, 1)];
const CART_15 = [item('p-15', 'منتج اختبار 15', 15, 1)];

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
  const fresh = async (t) => t.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'all' });

  /** password sign-in of a Google-LINKED account (a valid saved Google session: no popup needed at checkout) */
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
  /** drive the Auth emulator's Google popup: a NEW Google account (email + name), like choosing an account */
  const googleInPopup = async (email, name) => {
    const p = await ctx.attachPopup(20_000);
    assert.ok(p, 'the Google sign-in window opened');
    await p.waitFor(`!!document.querySelector('#add-account-button') || !!document.querySelector('.js-new-account') || !!document.querySelector('#email-input')`, 20_000, 'emulator sign-in page');
    await p.evaluate(`(() => { const b = document.querySelector('#add-account-button') || document.querySelector('.js-new-account'); if (b && !document.querySelector('#email-input')?.offsetParent) b.click(); return true; })()`);
    await p.waitFor(`!!document.querySelector('#email-input')?.offsetParent`, 10_000, 'new account form');
    await p.evaluate(`(() => { ${SET_VAL}
      setVal(document.querySelector('#email-input'), ${JSON.stringify(email)});
      setVal(document.querySelector('#display-name-input'), ${JSON.stringify(name)});
      return true; })()`);
    await sleep(200);
    await p.evaluate(`document.querySelector('#sign-in').click(); true`);
    await until(async () => !(await ctx.popupOpen()), 20_000, 'Google window closed after sign-in');
  };
  const openPopupFromFab = async (t) => {
    await t.waitFor(`!!document.querySelector('[data-testid=wheel-fab]')`, 15_000, 'wheel button');
    await t.evaluate(`document.querySelector('[data-testid=wheel-fab]').click(); true`);
    await t.waitFor(`!!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-spin]')`, 20_000, 'popup with the wheel');
  };
  const spinAndWait = async (t) => {
    await t.waitFor(`!document.querySelector('[data-testid=wheel-spin]')?.disabled`, 20_000, 'spin button enabled');
    await t.send('Runtime.evaluate', { expression: `document.querySelector('[data-testid=wheel-spin]').click(); true`, userGesture: true, returnByValue: true });
  };
  const waitResult = (t) => t.waitFor(`(() => { const r = document.querySelector('[data-testid=wheel-result]'); return r && (r.querySelector('[data-testid=wheel-won],[data-testid=wheel-no-prize],[data-testid=wheel-message]')) ? r.innerText.trim() : ''; })()`, 30_000, 'result shown');
  let seedN = 0;
  /** the cart is seeded before the app's scripts run on the next document, then checkout opens (session kept) */
  const openCheckoutWith = async (t, cart, email = null) => {
    const marker = `seedcart${++seedN}x`;
    await t.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `if (location.search.includes(${JSON.stringify(marker)})) { localStorage.setItem('anta_cart', ${JSON.stringify(JSON.stringify(cart))}); localStorage.setItem('language', 'ar'); }`,
    });
    await t.navigate(`${ctx.base}/?${marker}=1&r=${Date.now()}#/checkout`);
    await t.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 40_000, 'checkout form');
    if (email) await t.waitFor(`document.querySelector('input[placeholder^="name@example.com"]')?.value === ${JSON.stringify(email)}`, 30_000, 'signed-in profile in checkout');
  };
  const fillToPayment = async (t, phoneLocal) => {
    await t.evaluate(`(() => { ${SET_VAL}
      setVal(document.querySelector('input[placeholder="الاسم الأول والأخير"]'), 'زبون الدولاب التجريبي');
      setVal(document.querySelector('input[placeholder="0791234567"]'), ${JSON.stringify(phoneLocal)});
      setVal([...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'zarqa')), 'zarqa');
      return true; })()`);
    await sleep(150);
    await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('input[placeholder^="اسم الشارع"]'), 'شارع الاختبار 1'); return true; })()`);
    await t.evaluate(`${AGREE} ${STICKY}.click(); true`);
    await t.waitFor(`document.body.innerText.includes('توصيل عادي')`, 10_000, 'step 2');
    await t.evaluate(`${AGREE} ${STICKY}.click(); true`);
    await t.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('CliQ'))`, 10_000, 'step 3');
  };
  // a REAL user gesture (as a tap): browsers open the Google window only from one
  const gesture = (t, expr) => t.send('Runtime.evaluate', { expression: expr, userGesture: true, awaitPromise: true, returnByValue: true });
  const clickConfirm = (t) => gesture(t, `${AGREE} ${STICKY}.click(); true`);
  const outcome = (t) => t.waitFor(`(() => { const o = ${OUTCOME}; return o && o !== 'busy' && o !== 'sending' ? o : ''; })()`, 40_000, 'order outcome');
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
  const deliverInDashboard = async (t, orderId) => {
    await openDashboardOrder(t, orderId);
    await clickButton(t, 'بدء التجهيز'); await statusIs(orderId, 'processing');
    await clickButton(t, 'قيد الشحن'); await statusIs(orderId, 'shipped');
    await clickButton(t, 'تم التسليم'); await statusIs(orderId, 'delivered');
  };
  const prizeBox = (t) => t.evaluate(`(() => { const b = document.querySelector('[data-testid=checkout-wheel-gift]'); return b ? { state: b.dataset.state, type: b.dataset.prizeType, text: b.innerText } : null; })()`);
  const noHScroll = (t) => t.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`);

  return [
    ['WU01', 'DESKTOP first visit, NOT signed in: the popup opens by itself, THREE "حظ أوفر" segments; the spin works WITHOUT any sign-in (no Google window, ever) -> the server draws and stores it under the browser ticket -> the wheel stops ON the drawn segment; closed with X; a reload does NOT reopen it, reopening shows the SAME result and no new spin; cleared site data = a new visitor (documented limit); Escape closes', async (t) => {
      await ctx.setCampaign([
        { id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: 3, quantity: 50 }, NONES[0],
        { id: 'gift-2', type: 'gift', label: 'هدية بقيمة 2 د.أ', valueJod: 2, unitCostJod: 2, weight: 3, quantity: 50 }, NONES[1],
        { id: 'watch', type: 'gift', label: 'هدية ساعة', productId: 'p-hundred', unitCostJod: 1, minOrderJod: 15, weight: 1, quantity: 5 }, NONES[2],
      ]);
      await viewport(t, 1366, 900, false);
      await fresh(t);
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/`);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-spin]')`, 25_000, 'first-visit popup');
      const segs = await t.evaluate(`[...document.querySelectorAll('[data-testid=wheel-segment]')].map((s) => s.dataset.slotType + ':' + s.dataset.slotId)`);
      assert.deepEqual(segs, ['discount:disc-1', 'none:none-1', 'gift:gift-2', 'none:none-2', 'gift:watch', 'none:none-3']);
      assert.equal((await t.evaluate(`[...document.querySelectorAll('[data-testid=wheel-segment] text')].map((x) => x.textContent).join('|')`)).split('حظ أوفر').length - 1, 3, 'the three "حظ أوفر" labels are drawn');
      // honesty: equal segments are NOT equal chances — the note + the real chances (server) adding up to 100%
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-odds-note]').innerText`), /حجم الخانات متساوٍ ولا يمثّل فرصة الفوز/);
      const odds = await t.evaluate(`[...document.querySelectorAll('[data-testid=wheel-odds-row]')].map((r) => [r.dataset.slotId, Number(r.dataset.chance)])`);
      assert.deepEqual(odds.map((o) => o[0]), ['disc-1', 'none', 'gift-2', 'watch'], 'the three "حظ أوفر" as one line');
      assert.ok(Math.abs(odds.reduce((s, o) => s + o[1], 0) - 1) < 0.01, JSON.stringify(odds));
      assert.ok(Math.abs(odds.find((o) => o[0] === 'watch')[1] - 1 / 10) < 0.002, 'watch: weight 1 of 10');
      const label = await t.evaluate(`document.querySelector('[data-testid=wheel-spin]').innerText.trim()`);
      assert.equal(label, 'لفّ الدولاب');
      assert.doesNotMatch(await t.evaluate(`document.querySelector('[data-testid=wheel-popup]').innerText`), /سجّل الدخول بـ Google ولفّ/);
      await shot(t, 'wu01-popup-first-visit');
      await spinAndWait(t);
      const text = await waitResult(t);
      assert.equal(await ctx.popupOpen(), false, 'NO Google window for the spin');
      const land = await t.evaluate(LANDING);
      assert.ok(land.result, `a result: ${text}`);
      assert.equal(land.landed, land.result, `the wheel stops on the drawn segment ${JSON.stringify(land)}`);
      const gs = await ctx.guestSpins();
      assert.equal(gs.length, 1, 'the result is stored on the server');
      assert.equal(gs[0].prizeId, land.result);
      assert.equal(await ctx.countSpins(), 0, 'no account involved yet');
      assert.match(await t.evaluate(`localStorage.getItem('anta_wheel_guest_v1') || ''`), /^[A-Za-z0-9_-]{43}$/, 'the browser keeps only a random ticket');
      if (gs[0].prizeType !== 'none') assert.match(text, /مبروك! ظهرت لك[\s\S]*تسجّل الدخول بـ Google فتُربط الجائزة بحسابك/);
      await shot(t, 'wu01-popup-result');
      await t.evaluate(`document.querySelector('[data-testid=wheel-close]').click(); true`);
      await t.waitFor(`!document.querySelector('[data-testid=wheel-popup]')`, 5_000, 'popup closed');
      await t.reload();
      await sleep(4_000);
      assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=wheel-popup]')`), false, 'not shown again after a refresh');
      await openPopupFromFab(t);
      await t.waitFor(`document.querySelector('[data-testid=wheel-result]')?.dataset.prizeId === ${JSON.stringify(land.result)}`, 20_000, 'the SAME stored result is shown again');
      assert.equal(await t.evaluate(`document.querySelector('[data-testid=wheel-spin]').disabled`), true, 'no new spin');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-spin]').innerText`), /استخدمت لفّتك/);
      assert.equal((await t.evaluate(LANDING)).landed, land.result, 'the wheel rests on the stored segment');
      await t.evaluate(`document.querySelector('[data-testid=wheel-spin]').click(); true`);
      await sleep(1_500);
      assert.equal((await ctx.guestSpins()).length, 1, 'still one result');
      await shot(t, 'wu01-reopened-same-result');
      await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await t.waitFor(`!document.querySelector('[data-testid=wheel-popup]')`, 5_000, 'Escape closes');
      // HONEST LIMIT: before signing in there is no identity — cleared site data is a new visitor and can spin again
      // (the Worker's per-IP limit only slows this down; at checkout each Google account keeps ONE welcome result)
      await fresh(t);
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/`);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-spin]')`, 25_000, 'popup for a new visitor');
      await spinAndWait(t);
      await waitResult(t);
      assert.equal((await ctx.guestSpins()).length, 2, 'cleared storage = a second guest result (documented limit)');
    }],
    ['WU02', 'GUEST spin -> CHECKOUT: the prize is shown (linked at sign-in); "confirm order" starts the Google sign-in and sends NOTHING (offline it fails: cart, form, prize kept; a second press sends nothing); a guest order straight to the Worker is refused; signed in with Google -> the guest result becomes the account\'s welcome prize, the button becomes "final confirmation", ONE order with the server-checked discount', async (t) => {
      await ctx.setCampaign([{ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: BIG, quantity: 10 }, ...NONES]);
      await viewport(t, 1366, 900, false);
      await fresh(t);
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/`);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-spin]')`, 25_000, 'first-visit popup');
      await spinAndWait(t);
      assert.match(await waitResult(t), /مبروك! ظهرت لك: خصم دينار/);
      assert.equal(await ctx.popupOpen(), false, 'no Google window for the spin');
      await t.evaluate(`document.querySelector('[data-testid=wheel-close]').click(); true`);
      // shopping + details, still WITHOUT an account
      await openCheckoutWith(t, CART_OK);
      await t.waitFor(`document.querySelector('[data-testid=checkout-wheel-gift]')?.dataset.state === 'applies' && !!document.querySelector('[data-testid=checkout-wheel-guest]')`, 20_000, 'guest prize shown in the summary');
      await fillToPayment(t, '0795100001');
      assert.ok(await t.evaluate(`!!document.querySelector('[data-testid=google-required-hint]')`), 'the customer is told what happens at "confirm order"');
      assert.equal(await t.evaluate(`document.querySelector('[data-testid=checkout-confirm]').dataset.stage`), 'sign-in');
      assert.equal(await t.evaluate(`document.querySelector('[data-testid=checkout-sticky-action]').innerText.trim()`), 'تأكيد الطلب');
      await shot(t, 'wu02-guest-prize-checkout');
      // "confirm order": the Google sign-in starts from the click; OFFLINE it cannot complete (Firebase's popup flow loads
      // a script from apis.google.com, blocked by the isolation) -> the failure path: nothing sent, everything kept
      await clickConfirm(t);
      const o1 = await outcome(t);
      assert.ok(/^blocked:(failed|cancelled|network|blocked)$/.test(o1), `not sent, Google problem shown (${o1})`);
      assert.match(await t.evaluate(`document.querySelector('[data-testid=submit-blocked]').innerText`), /لم يُرسل الطلب/);
      assert.equal(await ctx.countOrders(), 0, 'nothing sent');
      assert.equal(await t.evaluate(`JSON.parse(localStorage.getItem('anta_cart') || '[]').length`), 1, 'cart kept');
      assert.equal(await t.evaluate(`document.querySelector('input[placeholder="الاسم الأول والأخير"]') ? 'form' : 'payment'`), 'payment', 'still on the payment step');
      assert.match(await t.evaluate(`localStorage.getItem('anta_wheel_guest_v1') || ''`), /^[A-Za-z0-9_-]{43}$/, 'the prize ticket is kept');
      assert.equal((await ctx.guestSpins())[0].status, 'held');
      await shot(t, 'wu02-google-failed');
      await clickConfirm(t);
      await sleep(1_500);
      assert.equal(await ctx.countOrders(), 0, 'still nothing sent');
      // the browser cannot bypass the rule: a guest order sent straight to the Worker is refused (ORDER_SIGN_IN=google)
      const direct = await t.evaluate(`fetch(${JSON.stringify(ctx.workerUrl)} + '/create-order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: { id: 'ORD-AAAA1111-BBBB2222' } }) }).then(async (r) => ({ s: r.status, b: await r.json() }))`);
      assert.equal(direct.s, 401);
      assert.equal(direct.b.code, 'SIGN_IN_REQUIRED');
      // the same visitor now has a Google session (Google-linked account; the real account chooser is a manual check)
      const email = 'wheel.checkout@example.invalid';
      const uid = await ctx.createGoogleCustomer({ email, password: 'Test-pass-12345', name: 'زبون الدفع' });
      await signIn(t, email, 'Test-pass-12345');
      await openCheckoutWith(t, CART_OK, email);
      // the guest result became the account's WELCOME result (same prize, once) and the ticket is forgotten
      const sp = await until(async () => spinDoc(uid, 1), 20_000, 'guest result linked to the account');
      assert.equal(sp.prizeId, 'disc-1');
      assert.equal(sp.fromGuest, true);
      assert.equal(sp.status, 'issued');
      assert.equal((await ctx.guestSpins())[0].status, 'claimed');
      await t.waitFor(`!localStorage.getItem('anta_wheel_guest_v1')`, 10_000, 'ticket forgotten after the link');
      await t.waitFor(`document.querySelector('[data-testid=checkout-wheel-gift]')?.dataset.state === 'applies' && !document.querySelector('[data-testid=checkout-wheel-guest]')`, 20_000, 'account prize applies');
      await fillToPayment(t, '0795100001');
      assert.equal(await t.evaluate(`document.querySelector('[data-testid=checkout-confirm]').dataset.stage`), 'final');
      assert.equal(await t.evaluate(`document.querySelector('[data-testid=checkout-sticky-action]').innerText.trim()`), 'تأكيد الطلب النهائي');
      assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=google-required-hint]')`), false);
      assert.match(await t.evaluate(`document.querySelector('[data-testid=summary-wheel-discount]')?.innerText || ''`), /خصم جائزة الدولاب/);
      await shot(t, 'wu02-final-confirmation');
      // "final confirmation", pressed three times: ONE order
      await t.evaluate(`(() => { ${AGREE} const b = ${STICKY}; b.click(); b.click(); b.click(); return true; })()`);
      assert.equal(await outcome(t), 'success');
      assert.equal(await ctx.popupOpen(), false, 'no Google window with a valid session');
      const orderId = await t.evaluate(`location.hash.split('/').pop()`);
      const O = await get(`orders/${orderId}`);
      assert.equal(O.userId, uid, 'placed under the Google account');
      assert.equal(O.userIdVerified, true);
      assert.equal(O.wheelPrize.discountJod, 1);
      assert.equal((await get(`orderLedger/${orderId}`)).serverPricing.total, 8.75, '7.5 - 0.75 volume - 1 prize + 3 delivery (Zarqa)');
      assert.equal((await spinDoc(uid, 1)).status, 'reserved');
      assert.equal(await ctx.countOrders(), 1, 'exactly one order');
      assert.equal(await ctx.countSpins(), 1, 'one result for the account');
      await shot(t, 'wu02-order-success');
    }],
    ['WU03', 'already signed in with Google (valid session): NO Google window; 1-JOD discount prize below 5 JOD -> shown with what is missing, order goes WITHOUT it (prize kept); 7.5 JOD -> applied (server-checked total); a triple click sends ONE order', async (t) => {
      await ctx.setCampaign([{ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: BIG, quantity: 10 }, ...NONES]);
      const email = 'wheel.linked@example.invalid';
      const pw = 'Test-pass-12345';
      const uid = await ctx.createGoogleCustomer({ email, password: pw, name: 'زبون مرتبط' });
      await viewport(t, 1366, 900, false);
      await signIn(t, email, pw);
      await t.evaluate(`location.hash = '#/wheel'; true`);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-page] [data-testid=wheel-spin]')`, 25_000, 'wheel page');
      await spinAndWait(t);
      await waitResult(t);
      assert.equal((await spinDoc(uid, 1))?.prizeId, 'disc-1');
      // below the minimum
      await openCheckoutWith(t, CART_SMALL, email);
      await t.waitFor(`document.querySelector('[data-testid=checkout-wheel-gift]')?.dataset.state === 'below_min'`, 20_000, 'prize below minimum');
      assert.match((await prizeBox(t)).text, /تحتاج إلى إكمال مشترياتك حتى 5 دينارًا/);
      await fillToPayment(t, '0795100003');
      assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=google-required-hint]')`), false, 'no Google window needed');
      await shot(t, 'wu03-below-min');
      await clickConfirm(t);
      assert.equal(await outcome(t), 'success');
      assert.equal(await ctx.popupOpen(), false, 'no Google window was opened');
      const o1 = await t.evaluate(`location.hash.split('/').pop()`);
      assert.equal((await get(`orders/${o1}`)).wheelPrize, undefined, 'the prize did NOT travel with the small order');
      assert.equal((await spinDoc(uid, 1)).status, 'issued', 'prize kept');
      // enough: applied, triple click
      await openCheckoutWith(t, CART_OK, email);
      await t.waitFor(`document.querySelector('[data-testid=checkout-wheel-gift]')?.dataset.state === 'applies'`, 20_000, 'prize applies');
      await fillToPayment(t, '0795100003');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=summary-wheel-discount]')?.innerText || ''`), /خصم جائزة الدولاب/);
      await shot(t, 'wu03-applies');
      await t.evaluate(`(() => { ${AGREE} const b = ${STICKY}; b.click(); b.click(); b.click(); return true; })()`);
      assert.equal(await outcome(t), 'success');
      const o2 = await t.evaluate(`location.hash.split('/').pop()`);
      const L = await get(`orderLedger/${o2}`);
      assert.equal(L.serverPricing.total, 8.75, '7.5 - 0.75 volume - 1 prize + 3 delivery (Zarqa)');
      assert.equal((await get(`orders/${o2}`)).wheelPrize.discountJod, 1);
      assert.equal((await spinDoc(uid, 1)).status, 'reserved');
      assert.equal(await ctx.countOrders(), 2, 'one order per confirmation (triple click = one)');
    }],
    ['WU04', 'BIG prize (watch, minimum 15): 14.99 JOD -> "مبروك! ظهرت لك هدية ساعة، وتحتاج إلى إكمال مشترياتك حتى 15 دينارًا…", ordered without it; exactly 15 -> the watch travels as a FREE line, reserved; ONE Telegram message marks it', async (t) => {
      await ctx.setCampaign([{ id: 'watch', type: 'gift', label: 'هدية ساعة', productId: 'p-hundred', unitCostJod: 1, minOrderJod: 15, weight: BIG, quantity: 3 }, ...NONES]);
      const email = 'wheel.watch@example.invalid';
      const pw = 'Test-pass-12345';
      const uid = await ctx.createGoogleCustomer({ email, password: pw, name: 'زبون الساعة' });
      await viewport(t, 1366, 900, false);
      await signIn(t, email, pw);
      await openPopupFromFab(t);
      await spinAndWait(t);
      assert.match(await waitResult(t), /مبروك! ظهرت لك: هدية ساعة/);
      assert.equal((await t.evaluate(LANDING)).landed, 'watch');
      await t.evaluate(`document.querySelector('[data-testid=wheel-close]').click(); true`);
      await openCheckoutWith(t, CART_1499, email);
      await t.waitFor(`document.querySelector('[data-testid=checkout-wheel-gift]')?.dataset.state === 'below_min'`, 20_000, 'watch below minimum');
      assert.match((await prizeBox(t)).text, /مبروك! ظهرت لك هدية ساعة، وتحتاج إلى إكمال مشترياتك حتى 15 دينارًا لاستحقاقها عند تأكيد الطلب/);
      await shot(t, 'wu04-watch-1499');
      await fillToPayment(t, '0795100004');
      await clickConfirm(t);
      assert.equal(await outcome(t), 'success');
      const o1 = await t.evaluate(`location.hash.split('/').pop()`);
      assert.ok(!(await get(`orders/${o1}`)).items.some((i) => i.gift), 'no watch on a 14.99 order');
      await openCheckoutWith(t, CART_15, email);
      await t.waitFor(`document.querySelector('[data-testid=checkout-wheel-gift]')?.dataset.state === 'applies'`, 20_000, 'watch applies at 15');
      await fillToPayment(t, '0795100004');
      await clickConfirm(t);
      assert.equal(await outcome(t), 'success');
      const o2 = await t.evaluate(`location.hash.split('/').pop()`);
      const O = await get(`orders/${o2}`);
      const g = O.items.filter((i) => i.gift);
      assert.equal(g.length, 1);
      assert.equal(g[0].price, 0);
      assert.equal((await get(`orderLedger/${o2}`)).serverPricing.total, 18, '15 + 3 delivery: the watch is free');
      assert.equal(await reserved('p-hundred'), 1);
      assert.equal(await stock('p-hundred'), 100, 'nothing deducted before delivery');
      assert.equal((await spinDoc(uid, 1)).status, 'reserved');
      const msgs = await until(async () => { const m = await telegramFor(o2); return m.length ? m : null; }, 30_000, 'telegram');
      await sleep(2_500);
      assert.equal((await telegramFor(o2)).length, 1, 'one Telegram message');
      assert.equal(msgs[0].giftMarked, true, 'the Telegram message marks the gift');
    }],
    ['WU05', 'SECOND-ORDER discount: not applied to the first order (explained); the first order DELIVERED in the dashboard; then applied (>= 15) with the server total; the dashboard shows the prize; a CANCEL gives the prize back (not consumed)', async (t) => {
      await ctx.setCampaign([{ id: 'second-4', type: 'discount', label: 'خصم 4 د.أ على الطلب الثاني', valueJod: 4, minOrderJod: 15, appliesTo: 'next_order', weight: BIG, quantity: 5 }, ...NONES]);
      const email = 'wheel.second@example.invalid';
      const pw = 'Test-pass-12345';
      const uid = await ctx.createGoogleCustomer({ email, password: pw, name: 'زبون الطلب الثاني' });
      await viewport(t, 1366, 900, false);
      await signIn(t, email, pw);
      await openPopupFromFab(t);
      await spinAndWait(t);
      assert.match(await waitResult(t), /طلبك الثاني/);
      // owner's exception: KEPT until the first delivery (no 60-minute countdown), explained in the wheel
      // stage ①: 5 days (from the win) to CREATE the first order, with the time left
      assert.equal(await t.evaluate(`document.querySelector('[data-testid=wheel-second-status]')?.dataset.state`), 'create-first-order');
      const firstLeft = Number(await t.evaluate(`document.querySelector('[data-testid=wheel-second-status-countdown]').dataset.remainingMs`));
      assert.ok(firstLeft > 119 * 3_600_000 && firstLeft <= 120 * 3_600_000, `about 5 days to place the first order (${firstLeft})`);
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-second-status]').textContent`), /أنشئ طلبك الأول قبل[\s\S]*الوقت المتبقي لإنشاء طلبك الأول/);
      assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=wheel-countdown]')`), false, 'no 60-minute countdown');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-won]').innerText`), /لا ينتهي بعد ساعة[\s\S]*5 أيام/);
      assert.equal((await spinDoc(uid, 1)).status, 'waiting');
      await shot(t, 'wu05-second-waiting');
      await t.evaluate(`document.querySelector('[data-testid=wheel-close]').click(); true`);
      await openCheckoutWith(t, CART_15, email);
      await t.waitFor(`!!document.querySelector('[data-testid=checkout-wheel-waiting]')`, 20_000, 'second-order kept, explained in checkout');
      assert.equal(await t.evaluate(`document.querySelector('[data-testid=checkout-second-status]')?.dataset.state`), 'create-first-order');
      assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=checkout-wheel-gift]')`), false, 'not applied to the first order');
      await fillToPayment(t, '0795100005');
      await clickConfirm(t);
      assert.equal(await outcome(t), 'success');
      const o1 = await t.evaluate(`location.hash.split('/').pop()`);
      assert.equal((await get(`orderLedger/${o1}`)).serverPricing.total, 18, 'first order: no discount');
      // stage ② in the account: the first order exists, not delivered yet -> kept until its delivery
      await t.evaluate(`location.hash = '#/wheel'; true`);
      await t.waitFor(`document.querySelector('[data-testid=wheel-row-second]')?.dataset.state === 'first-order-open'`, 25_000, 'kept until the first order is delivered');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-row-second]').textContent`), /طلبك الأول قيد التنفيذ/);
      // ...and the delivery deadline of that first order: 7 days from its creation, with the time left
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-row-second-delivery-countdown]')`, 10_000, 'delivery deadline shown');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-row-second-delivery-by]').textContent`), /يجب أن يُسلَّم طلبك الأول قبل[\s\S]*7 أيام من إنشائه/);
      const delLeft = Number(await t.evaluate(`document.querySelector('[data-testid=wheel-row-second-delivery-countdown]').dataset.remainingMs`));
      assert.ok(delLeft > 167 * 3_600_000 && delLeft <= 168 * 3_600_000, `about 7 days for the delivery (${delLeft})`);
      const delText = await t.evaluate(`document.querySelector('[data-testid=wheel-row-second-delivery-countdown]').textContent`);
      assert.ok(/6 يوم و 2[0-3]:[0-5]\d:[0-5]\d|7 يوم و 00:00:00/.test(delText), `never 'X days 24:00:00': ${JSON.stringify(delText)}`);
      await shot(t, 'wu05-first-order-open');
      await deliverInDashboard(t, o1);
      // the FIRST delivery starts the 5 days (from the delivery, not the spin) — the customer follows it in the account
      const act = await spinDoc(uid, 1);
      assert.equal(act.status, 'issued');
      assert.equal(act.expiresAt.getTime() - (await get(`orderLedger/${o1}`)).deliveredAt.getTime(), 120 * 3_600_000);
      await signIn(t, email, pw);
      await t.evaluate(`location.hash = '#/wheel'; true`);
      // stage ③ in the account: end date + time left
      await t.waitFor(`document.querySelector('[data-testid=wheel-row-second]')?.dataset.state === 'active' && !!document.querySelector('[data-testid=wheel-row-second-countdown]')`, 25_000, 'end date + time left in the account');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-row-second]').textContent`), /تم تسليم طلبك الأول[\s\S]*حتى/);
      const left = Number(await t.evaluate(`document.querySelector('[data-testid=wheel-row-second-countdown]').dataset.remainingMs`));
      assert.ok(left > 119 * 3_600_000 && left <= 120 * 3_600_000, `about 5 days left (${left})`);
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-row-second-countdown]').textContent`), /4 يوم و 2[0-3]:[0-5]\d:[0-5]\d|5 يوم و 00:00:00/, 'days + hh:mm:ss, hours 00-23 (never "24:00:00")');
      await shot(t, 'wu05-account-prize');
      await openCheckoutWith(t, CART_15, email);
      await t.waitFor(`document.querySelector('[data-testid=checkout-wheel-gift]')?.dataset.state === 'applies'`, 20_000, 'second-order discount applies');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=checkout-wheel-ends]').innerText`), /صالح حتى[\s\S]*5 أيام من تسليم طلبك الأول/);
      await fillToPayment(t, '0795100005');
      await shot(t, 'wu05-second-order');
      await clickConfirm(t);
      assert.equal(await outcome(t), 'success');
      const o2 = await t.evaluate(`location.hash.split('/').pop()`);
      assert.equal((await get(`orderLedger/${o2}`)).serverPricing.total, 14, '15 - 4 + 3');
      assert.equal((await spinDoc(uid, 1)).status, 'reserved');
      await openDashboardOrder(t, o2);
      await t.waitFor(`!!document.querySelector('[data-testid=admin-prize-detail]')`, 15_000, 'prize shown in the order details');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=admin-prize-detail]').innerText`), /خصم 4 د.أ محسوب في الإجمالي/);
      await shot(t, 'wu05-admin-prize');
      await clickButton(t, 'إلغاء الطلب');
      await statusIs(o2, 'cancelled');
      const sp = await spinDoc(uid, 1);
      assert.equal(sp.status, 'issued', 'cancelled order: the prize is not consumed');
      assert.equal(sp.orderId, null);
    }],
    ['WU06', 'ADMIN wheel tab: a customer gets "not an admin" from the SERVER; the admin sees the slots with their share, edits a weight + minimum, sees the loss warning, saves; visitors see the new wheel; setting the quantity to what is used makes the prize disappear', async (t) => {
      await ctx.setCampaign([{ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: 1, quantity: 3 }, ...NONES]);
      const email = 'wheel.notadmin@example.invalid';
      const pw = 'Test-pass-12345';
      await ctx.createGoogleCustomer({ email, password: pw, name: 'ليس مديرًا' });
      await viewport(t, 1366, 900, false);
      await signIn(t, email, pw);
      await t.evaluate(`location.hash = '#/admin'; true`);
      await sleep(3_000);
      const tab = await t.evaluate(`!!document.querySelector('[data-testid=admin-tab-wheel]')`);
      if (tab) {
        await t.evaluate(`document.querySelector('[data-testid=admin-tab-wheel]').click(); true`);
        await t.waitFor(`/ليس مديرًا/.test(document.querySelector('[data-testid=wheel-admin-error]')?.innerText || '')`, 20_000, 'server refuses a customer');
      }
      // the admin
      await signIn(t, ctx.admin.email, ctx.admin.password);
      await t.evaluate(`if (location.hash !== '#/admin') location.hash = '#/admin'; true`);
      await t.waitFor(`!!document.querySelector('[data-testid=admin-tab-wheel]')`, 30_000, 'wheel tab');
      await t.evaluate(`document.querySelector('[data-testid=admin-tab-wheel]').click(); true`);
      await t.waitFor(`document.querySelectorAll('[data-testid=wheel-admin-slot]').length === 4`, 20_000, 'slots listed');
      // the actual share PER LOYALTY TIER (same weights everywhere here: 25% each)
      for (const tier of ['new', 'returning', 'loyal']) assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-admin-slot][data-slot-id="disc-1"] [data-testid=wheel-admin-share-${tier}]').innerText`), /25%/, tier);
      // add a 5-JOD gift at a 5-JOD minimum -> loss warning (never blocks)
      await t.evaluate(`document.querySelector('[data-testid=wheel-admin-add-gift]').click(); true`);
      await t.evaluate(`(() => { ${SET_VAL}
        const row = [...document.querySelectorAll('[data-testid=wheel-admin-slot]')].pop();
        setVal(row.querySelector('[data-testid=wheel-admin-label]'), 'هدية 5 د.أ');
        setVal(row.querySelector('[data-testid=wheel-admin-value]'), '5');
        setVal(row.querySelector('[data-testid=wheel-admin-qty]'), '2');
        setVal(row.querySelector('[data-testid=wheel-admin-weight-new]'), '1');
        row.querySelector('input[type=checkbox]').click();
        const d = document.querySelector('[data-testid=wheel-admin-slot][data-slot-id="disc-1"]');
        // weights edited PER TIER, independently (new 3, loyal 5; returning unchanged)
        setVal(d.querySelector('[data-testid=wheel-admin-weight-new]'), '3');
        setVal(d.querySelector('[data-testid=wheel-admin-weight-loyal]'), '5');
        setVal(d.querySelector('[data-testid=wheel-admin-min]'), '6');
        return true; })()`);
      await t.waitFor(`/هدية 5 د.أ.*15/.test(document.querySelector('[data-testid=wheel-admin-warnings]')?.innerText.replace(/\\n/g, ' ') || '')`, 10_000, 'loss warning shown');
      await t.evaluate(`(() => { ${SET_VAL} const row = [...document.querySelectorAll('[data-testid=wheel-admin-slot]')].pop(); const inp = [...row.querySelectorAll('input')].find((i) => i.previousElementSibling?.textContent.includes('تكلفة الوحدة')); setVal(inp, '5'); return true; })()`);
      await shot(t, 'wu06-admin-wheel');
      await t.evaluate(`document.querySelector('[data-testid=wheel-admin-save]').click(); true`);
      await t.waitFor(`document.querySelector('[data-testid=wheel-admin-save-result]')?.dataset.tone === 'ok'`, 20_000, 'saved');
      const c = await get(`wheelCampaigns/${WHEEL_CAMPAIGN_ID}`);
      const d = c.prizes.find((p) => p.id === 'disc-1');
      assert.equal(d.weight, 3, 'weight saved');
      assert.deepEqual(d.weights, { new: 3, returning: 1, loyal: 5 }, 'each tier saved independently');
      assert.equal(d.minOrderJod, 6, 'minimum saved');
      assert.equal(c.prizes.length, 5, 'five prizes saved');
      assert.equal((await get(`wheelPool/${WHEEL_CAMPAIGN_ID}_gift-1`))?.remaining, 2, 'gift pool 2');
      // quantity 3 -> 0 (none used): the prize disappears for visitors
      await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('[data-testid=wheel-admin-slot][data-slot-id="disc-1"] [data-testid=wheel-admin-qty]'), '0'); return true; })()`);
      await t.evaluate(`document.querySelector('[data-testid=wheel-admin-save]').click(); true`);
      await until(async () => (await get(`wheelPool/${WHEEL_CAMPAIGN_ID}_disc-1`))?.remaining === 0, 20_000, 'saved again: pool emptied');
      assert.equal(await t.evaluate(`document.querySelector('[data-testid=wheel-admin-save-result]')?.dataset.tone`), 'ok', 'second save result ok');
      // suggested weights: filled into the draft for review, NOT saved
      const before = (await get(`wheelCampaigns/${WHEEL_CAMPAIGN_ID}`)).prizes.find((p) => p.id === 'none-1').weights;
      await t.evaluate(`document.querySelector('[data-testid=wheel-admin-suggest]').click(); true`);
      // the CONSERVATIVE budget suggestion: each "حظ أوفر" 10000; prizes with an UNCONFIRMED cost get 0
      await t.waitFor(`document.querySelector('[data-testid=wheel-admin-slot][data-slot-id="none-1"] [data-testid=wheel-admin-weight-new]')?.value === '10000'`, 10_000, 'suggestion filled in the draft');
      assert.equal(await t.evaluate(`document.querySelector('[data-testid=wheel-admin-slot][data-slot-id="none-1"] [data-testid=wheel-admin-weight-loyal]').value`), '10000');
      assert.equal(await t.evaluate(`document.querySelector('[data-testid=wheel-admin-slot][data-slot-id="gift-1"] [data-testid=wheel-admin-weight-new]').value`), '0', 'cost not confirmed -> not planned');
      // the budget, from the server, and the projection with these weights
      assert.ok(await t.evaluate(`!!document.querySelector('[data-testid=wheel-admin-budget-state]')`), 'budget state shown');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-admin-budget-state]').innerText`), /المسموح[\s\S]*محجوز[\s\S]*مصروف[\s\S]*المتاح/);
      assert.ok(Number(await t.evaluate(`document.querySelector('[data-testid=wheel-admin-projection]').dataset.per100`)) >= 0);
      assert.ok(await t.evaluate(`!!document.querySelector('[data-testid=wheel-admin-cost-confirmed]')`), 'cost-confirmed checkbox per prize');
      await shot(t, 'wu06-admin-tiers');
      assert.deepEqual((await get(`wheelCampaigns/${WHEEL_CAMPAIGN_ID}`)).prizes.find((p) => p.id === 'none-1').weights, before, 'not saved by itself');
      await fresh(t);
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/`);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-segment]')`, 25_000, 'visitor popup');
      const segs = await t.evaluate(`[...document.querySelectorAll('[data-testid=wheel-segment]')].map((s) => s.dataset.slotId)`);
      assert.ok(!segs.includes('disc-1'), `sold-out prize hidden: ${segs}`);
      assert.ok(segs.includes('gift-1'), `new prize shown: ${segs}`);
    }],
    ['WU07', 'PHONE (390x844, touch): first-visit popup fits (no horizontal scroll), close and spin buttons large enough to tap, wheel inside the screen; checkout prize box usable without horizontal scroll', async (t) => {
      await ctx.setCampaign([{ id: 'ship-1', type: 'free_delivery', label: 'توصيل مجاني', valueJod: 3, minOrderJod: 5, weight: BIG, quantity: 10 }, ...NONES]);
      const email = 'wheel.phone@example.invalid';
      const pw = 'Test-pass-12345';
      await ctx.createGoogleCustomer({ email, password: pw, name: 'زبون الهاتف' });
      await viewport(t, 390, 844, true);
      await t.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await signIn(t, email, pw);
      await t.evaluate(`localStorage.removeItem('anta_wheel_popup_campaign_v2'); true`);
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/`);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-spin]')`, 25_000, 'popup on the phone');
      assert.equal(await noHScroll(t), true, 'no horizontal scroll with the popup');
      const m = await t.evaluate(`(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), l: Math.round(b.left), r: Math.round(b.right) }; }; return { close: r('[data-testid=wheel-close]'), spin: r('[data-testid=wheel-spin]'), dial: r('[data-testid=wheel-dial]'), vw: innerWidth }; })()`);
      assert.ok(m.close.h >= 40 && m.close.w >= 40, `close button tappable ${JSON.stringify(m.close)}`);
      assert.ok(m.spin.h >= 44, `spin button tappable ${JSON.stringify(m.spin)}`);
      assert.ok(m.dial.l >= 0 && m.dial.r <= m.vw, `wheel inside the screen ${JSON.stringify(m.dial)}`);
      await shot(t, 'wu07-phone-popup', { full: false });
      await spinAndWait(t);
      assert.match(await waitResult(t), /توصيل مجاني/);
      // nothing (cookie bar, assistant button) lies over the popup: both ends of the result card are the popup itself
      await t.evaluate(`document.querySelector('[data-testid=wheel-won]').scrollIntoView({ block: 'center' }); true`);
      await sleep(400);
      const cover = await t.evaluate(`(() => { const pop = document.querySelector('[data-testid=wheel-popup]'); const r = document.querySelector('[data-testid=wheel-won]').getBoundingClientRect(); const y = r.top + r.height / 2; const at = (x) => { const e = document.elementFromPoint(x, y); return !!e && pop.contains(e); }; return { left: at(r.left + 12), right: at(r.right - 12), cookie: document.documentElement.hasAttribute('data-cookie-bar') }; })()`);
      assert.ok(cover.left && cover.right, `result card not covered on the phone ${JSON.stringify(cover)}`);
      await shot(t, 'wu07-phone-won', { full: false });
      await t.evaluate(`document.querySelector('[data-testid=wheel-close]').click(); true`);
      await openCheckoutWith(t, CART_OK, email);
      await fillToPayment(t, '0795100007');
      await t.waitFor(`document.querySelector('[data-testid=checkout-wheel-gift]')?.dataset.state === 'applies'`, 20_000, 'free delivery applies');
      assert.ok(await t.evaluate(`!!document.querySelector('[data-testid=summary-free-delivery]')`));
      assert.equal(await noHScroll(t), true, 'no horizontal scroll in checkout');
      await t.evaluate(`document.querySelector('[data-testid=checkout-wheel-gift]').scrollIntoView({ block: 'center' }); true`);
      await shot(t, 'wu07-phone-checkout', { full: false });
      await clickConfirm(t);
      assert.equal(await outcome(t), 'success');
      const o = await t.evaluate(`location.hash.split('/').pop()`);
      const L = await get(`orderLedger/${o}`);
      assert.equal(L.serverPricing.shipping, 0, 'delivery waived by the server');
      assert.equal(L.serverPricing.total, 6.75, '7.5 - 0.75 + 0');
    }],
    ['WU08', '60-MINUTE WINDOW: the time left is shown and counts down (popup + checkout); when it ends: "expired" message in the wheel and in checkout, the prize is NOT applied and the order goes WITHOUT it (server total); its unit goes back once; an order confirmed in time keeps its prize', async (t) => {
      await ctx.setCampaign([{ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: BIG, quantity: 5 }, ...NONES]);
      /** the stored window of a document moved into the past (time travel for the test only) */
      const age = async (path) => {
        const d = await get(path);
        const past = new Date(Date.now() - 61 * 60_000);
        for (const f of ['expiresAt', 'issuedExpiry', 'holdExpiry']) if (d[f] instanceof Date) d[f] = past;
        await ctx.put(path, d);
      };
      await viewport(t, 1366, 900, false);
      await fresh(t);
      // ---- guest: countdown, then expired
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/`);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-spin]')`, 25_000, 'popup');
      await spinAndWait(t);
      await waitResult(t);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-countdown]')`, 10_000, 'countdown shown');
      const c1 = await t.evaluate(`(() => { const c = document.querySelector('[data-testid=wheel-countdown]'); return { ms: Number(c.dataset.remainingMs), text: c.textContent }; })()`);
      assert.ok(c1.ms > 58 * 60_000 && c1.ms <= 60 * 60_000, `about 60 minutes left (${JSON.stringify(c1)})`);
      assert.ok(/الوقت المتبقي لاستخدام الجائزة/.test(c1.text) && /\b(59|60|1):\d\d\b/.test(c1.text), `countdown text ${JSON.stringify(c1)}`);
      await sleep(2_200);
      const c2 = Number(await t.evaluate(`document.querySelector('[data-testid=wheel-countdown]').dataset.remainingMs`));
      assert.ok(c2 < c1.ms - 1_000, `it counts down (${c1.ms} -> ${c2})`);
      await shot(t, 'wu08-countdown');
      const ticket = await t.evaluate(`localStorage.getItem('anta_wheel_guest_v1')`);
      const gPath = await guestPath(WHEEL_CAMPAIGN_ID, ticket);
      await age(gPath);
      await t.reload();
      await openPopupFromFab(t);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-expired]')`, 20_000, 'expired message in the wheel');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-expired]').innerText`), /انتهت صلاحية الجائزة[\s\S]*60 دقيقة/);
      assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=wheel-won]')`), false, 'not shown as a usable prize');
      await shot(t, 'wu08-expired-wheel');
      await t.evaluate(`document.querySelector('[data-testid=wheel-close]').click(); true`);
      await openCheckoutWith(t, CART_OK);
      await t.waitFor(`!!document.querySelector('[data-testid=checkout-wheel-expired]')`, 20_000, 'expired message in checkout');
      assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=checkout-wheel-gift]')`), false, 'not applied');
      // ---- signed in: an account prize applies with its countdown; past the window the order goes WITHOUT it
      const email = 'wheel.hold@example.invalid';
      const pw = 'Test-pass-12345';
      const uid = await ctx.createGoogleCustomer({ email, password: pw, name: 'زبون المهلة' });
      await signIn(t, email, pw);
      await openCheckoutWith(t, CART_OK, email);
      // the expired guest ticket still USES the welcome spin (recorded as expired): no fresh draw after signing in late
      const sp = await until(async () => spinDoc(uid, 1), 20_000, 'welcome spin recorded');
      assert.equal(sp.status, 'expired');
      assert.equal((await get(gPath)).status, 'expired');
      assert.equal((await get(`wheelPool/${WHEEL_CAMPAIGN_ID}_disc-1`)).remaining, 5, 'the unit came back once');
      await t.waitFor(`/انتهت صلاحية جائزة الدولاب \\(60 دقيقة/.test(document.querySelector('[data-testid=checkout-wheel-notice]')?.innerText || '')`, 20_000, 'told why the prize was not linked');
      assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=checkout-wheel-gift]')`), false, 'not applied');
      await shot(t, 'wu08-expired-at-sign-in');
      await fillToPayment(t, '0795100008');
      await clickConfirm(t);
      assert.equal(await outcome(t), 'success');
      const o1 = await t.evaluate(`location.hash.split('/').pop()`);
      assert.equal((await get(`orders/${o1}`)).wheelPrize, undefined, 'sent WITHOUT the expired prize');
      assert.equal((await get(`orderLedger/${o1}`)).serverPricing.total, 9.75, '7.5 - 0.75 volume + 3 delivery, no prize');
      // an ACCOUNT prize whose window passes while unused: the checkout shows it expired and does not apply it
      const email3 = 'wheel.late@example.invalid';
      const uid3 = await ctx.createGoogleCustomer({ email: email3, password: pw, name: 'زبون متأخر' });
      await signIn(t, email3, pw);
      await t.evaluate(`location.hash = '#/wheel'; true`);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-page] [data-testid=wheel-spin]')`, 25_000, 'wheel page');
      await spinAndWait(t);
      await waitResult(t);
      await age(`wheelSpins/${WHEEL_CAMPAIGN_ID}_${uid3}_1`);
      await openCheckoutWith(t, CART_OK, email3);
      await t.waitFor(`!!document.querySelector('[data-testid=checkout-wheel-expired]')`, 20_000, 'expired box in checkout');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=checkout-wheel-expired]').innerText`), /انتهت صلاحية جائزة الدولاب[\s\S]*60 دقيقة/);
      assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=summary-wheel-discount]')`), false, 'no prize line in the summary');
      await shot(t, 'wu08-expired-checkout');
      // a prize used IN TIME keeps it after the window: an account with a fresh prize orders, then its window passes
      const email2 = 'wheel.intime@example.invalid';
      const uid2 = await ctx.createGoogleCustomer({ email: email2, password: pw, name: 'زبون في الوقت' });
      await signIn(t, email2, pw);
      await t.evaluate(`location.hash = '#/wheel'; true`);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-page] [data-testid=wheel-spin]')`, 25_000, 'wheel page');
      await spinAndWait(t);
      await waitResult(t);
      await openCheckoutWith(t, CART_OK, email2);
      await t.waitFor(`document.querySelector('[data-testid=checkout-wheel-gift]')?.dataset.state === 'applies' && !!document.querySelector('[data-testid=checkout-wheel-countdown]')`, 20_000, 'prize applies with its countdown');
      await fillToPayment(t, '0795100009');
      await clickConfirm(t);
      assert.equal(await outcome(t), 'success');
      const o2 = await t.evaluate(`location.hash.split('/').pop()`);
      assert.equal((await spinDoc(uid2, 1)).status, 'reserved');
      await age(`wheelSpins/${WHEEL_CAMPAIGN_ID}_${uid2}_1`);
      await ctx.triggerCron();
      await sleep(1_500);
      assert.equal((await spinDoc(uid2, 1)).status, 'reserved', 'the window passing after the order changes nothing');
      assert.equal((await get(`orders/${o2}`)).wheelPrize.discountJod, 1);
    }],
    ['WU09', 'SITE TOUR (desktop 1366 + phone 390, Arabic RTL + English LTR): home, shop, search, product, cart, checkout, account, my orders, tracking, about, wheel, admin — no horizontal scroll, right direction, no uncaught JS error, content present; screenshots for review', async (t) => {
      await ctx.setCampaign([{ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: 1, quantity: 5 }, ...NONES]);
      const email = 'wheel.tour@example.invalid';
      const pw = 'Test-pass-12345';
      await ctx.createGoogleCustomer({ email, password: pw, name: 'زبون الجولة' });
      // every uncaught error / unhandled rejection of the page is recorded (the app's own console noise is not)
      await t.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__tourErrors = []; addEventListener('error', (e) => window.__tourErrors.push(String(e.message || e.type))); addEventListener('unhandledrejection', (e) => window.__tourErrors.push('rejection: ' + String(e.reason && (e.reason.message || e.reason))));` });
      const pages = [
        ['home', '#/'], ['shop', '#/shop'], ['search', '#/shop?search=%D8%AF%D9%81%D8%AA%D8%B1'], ['product', '#/product/p-simple'],
        ['cart', '#/cart'], ['checkout', '#/checkout'], ['account', '#/account'], ['my-orders', '#/my-orders'],
        ['tracking', '#/tracking'], ['about', '#/about'], ['wheel', '#/wheel'],
      ];
      const problems = [];
      const visit = async (label, hash, lang) => {
        await t.navigate(`${ctx.base}/?tour=${Date.now()}${hash}`);
        await t.waitFor(`document.readyState === 'complete' && (document.querySelector('main, #root')?.innerText || '').trim().length > 40`, 30_000, `${label} content`);
        await sleep(1_200);
        // the wheel opens by itself once per campaign on the home page: closed for the tour
        if (label === 'home') await t.waitFor(`!!document.querySelector('[data-testid=wheel-popup]') || localStorage.getItem('anta_wheel_popup_campaign_v2')`, 8_000, 'home popup (once per campaign)').catch(() => {});
        if (await t.evaluate(`!!document.querySelector('[data-testid=wheel-popup]')`)) { await t.evaluate(`document.querySelector('[data-testid=wheel-close]').click(); true`); await sleep(300); }
        const st = await t.evaluate(`({ w: document.documentElement.scrollWidth, vw: innerWidth, dir: document.documentElement.dir || getComputedStyle(document.body).direction, errs: (window.__tourErrors || []).slice(0, 3) })`);
        if (st.w > st.vw + 1) problems.push(`${lang} ${label}: horizontal scroll ${st.w} > ${st.vw}`);
        if (st.dir !== (lang === 'ar' ? 'rtl' : 'ltr')) problems.push(`${lang} ${label}: direction ${st.dir}`);
        if (st.errs.length) problems.push(`${lang} ${label}: JS errors ${JSON.stringify(st.errs)}`);
        // the floating wheel button never covers a price / quantity (product, cart)
        if (['product', 'cart'].includes(label) && (await t.evaluate(`!!document.querySelector('[data-testid=wheel-fab]')`))) problems.push(`${lang} ${label}: wheel button over the page`);
        if (label === 'product' && lang === 'ar' && /No media available/.test(await t.evaluate(`document.body.innerText`))) problems.push('ar product: English placeholder');
      };
      for (const [vw, vh, mobile, tag] of [[1366, 900, false, 'desk'], [390, 844, true, 'phone']]) {
        await viewport(t, vw, vh, mobile);
        await fresh(t);
        await openCheckoutWith(t, CART_OK); // a cart for the cart / checkout pages (and language = ar)
        await t.evaluate(`localStorage.setItem('anta_wheel_popup_seen_v1', '1'); true`);
        await signIn(t, email, pw);
        for (const [label, hash] of pages) {
          await visit(label, hash, 'ar');
          if (['home', 'product', 'checkout', 'wheel', 'shop'].includes(label)) await shot(t, `wu09-${tag}-${label}`, { full: false });
        }
        // English (where the site offers it)
        await t.evaluate(`localStorage.setItem('language', 'en'); true`);
        for (const [label, hash] of pages.filter(([l]) => ['home', 'shop', 'product', 'cart', 'checkout'].includes(l))) {
          await visit(label, hash, 'en');
          if (label === 'home') await shot(t, `wu09-${tag}-home-en`, { full: false });
        }
        await t.evaluate(`localStorage.setItem('language', 'ar'); true`);
        // the dashboard (admin)
        await signIn(t, ctx.admin.email, ctx.admin.password);
        await t.evaluate(`if (location.hash !== '#/admin') location.hash = '#/admin'; true`);
        await t.waitFor(`document.body.innerText.includes('لوحة التحكم')`, 30_000, 'dashboard');
        await sleep(1_000);
        const a = await t.evaluate(`({ w: document.documentElement.scrollWidth, vw: innerWidth, errs: (window.__tourErrors || []).slice(0, 3) })`);
        if (a.w > a.vw + 1) problems.push(`${tag} admin: horizontal scroll ${a.w} > ${a.vw}`);
        if (a.errs.length) problems.push(`${tag} admin: JS errors ${JSON.stringify(a.errs)}`);
        await shot(t, `wu09-${tag}-admin`, { full: false });
        await signIn(t, email, pw);
      }
      assert.deepEqual(problems, []);
    }],
    ['WU10', 'NO OPEN CAMPAIGN = NOTHING OF THE WHEEL: campaign switched off -> a first visit gets no popup, a RETURNING visitor (popup already seen) gets no floating button, #/wheel goes to the home page; never a "test version" text in a live build. Campaign open again -> the returning visitor gets the button back (no popup by itself), the badge only in a TEST build', async (t) => {
      const prizes = [{ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: 1, quantity: 5 }, ...NONES];
      const badge = `document.body.innerText.includes('نسخة تجريبية')`;
      const fab = `!!document.querySelector('[data-testid=wheel-fab]')`;
      const popup = `!!document.querySelector('[data-testid=wheel-popup]')`;
      await ctx.setCampaign(prizes, { active: false });
      for (const [vw, vh, mobile] of [[1366, 900, false], [390, 844, true]]) {
        await viewport(t, vw, vh, mobile);
        await fresh(t);
        // first visit: the check answers "closed" -> no popup, no button
        await t.navigate(`${ctx.base}/?r=${Date.now()}#/`);
        await t.waitFor(`document.readyState === 'complete' && document.body.innerText.trim().length > 40`, 30_000, 'home');
        await sleep(3_500);
        assert.equal(await t.evaluate(popup), false, 'no popup while closed');
        assert.equal(await t.evaluate(fab), false, 'no button while closed (first visit)');
        // returning visitor (the popup was seen on an earlier visit): still nothing
        await t.evaluate(`localStorage.setItem('anta_wheel_popup_seen_v1', '1'); true`);
        for (const hash of ['#/', '#/tracking', '#/about']) {
          await t.navigate(`${ctx.base}/?r=${Date.now()}${hash}`);
          await t.waitFor(`document.readyState === 'complete' && document.body.innerText.trim().length > 40`, 30_000, hash);
          await sleep(3_500);
          assert.equal(await t.evaluate(fab), false, `no button while closed (returning, ${hash})`);
          assert.equal(await t.evaluate(popup), false, `no popup while closed (returning, ${hash})`);
        }
        // the wheel page itself: leaves for the home page, the "closed" box and the badge are never left on screen
        await t.navigate(`${ctx.base}/?r=${Date.now()}#/wheel`);
        await t.waitFor(`location.hash === '#/' || location.hash === ''`, 30_000, '#/wheel -> home');
        await sleep(800);
        assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=wheel-closed]')`), false, 'no "campaign unavailable" box');
        assert.equal(await t.evaluate(badge), false, 'no "test version" text');
      }
      // open again: this campaign opens by itself once on the home page; after that (reload) only the button
      await ctx.setCampaign(prizes);
      await viewport(t, 1366, 900, false);
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/`);
      await t.waitFor(popup, 20_000, 'opens by itself once for this campaign');
      await t.evaluate(`document.querySelector('[data-testid=wheel-close]').click(); true`);
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/`);
      await t.waitFor(fab, 20_000, 'button back while open');
      await sleep(3_500);
      assert.equal(await t.evaluate(popup), false, 'no popup by itself a second time for the same campaign');
      await openPopupFromFab(t);
      assert.equal(await t.evaluate(badge), ctx.wheelMode !== 'live', `badge shown only in a TEST build (mode ${ctx.wheelMode})`);
      await shot(t, `wu10-open-${ctx.wheelMode}`, { full: false });
    }],
    ['WU11', 'AUTOMATIC POPUP, once per campaign, on the HOME page: a visitor landing on the shop gets the button only; reaching home -> the wheel opens by itself after a moment; moving between pages / reloading never reopens it; a NEW campaign opens it once again; the button opens the wheel AT ONCE (no second loading)', async (t) => {
      const prizes = [{ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: 1, quantity: 5 }, ...NONES];
      const fab = `!!document.querySelector('[data-testid=wheel-fab]')`;
      const popup = `!!document.querySelector('[data-testid=wheel-popup]')`;
      await ctx.setCampaign(prizes);
      await viewport(t, 390, 844, true);
      await fresh(t);
      // lands on the shop: button only
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/shop`);
      await t.waitFor(fab, 20_000, 'button on the shop');
      await sleep(3_500);
      assert.equal(await t.evaluate(popup), false, 'never by itself outside the home page');
      // the button: the wheel at once (the campaign answer is handed over: no loading state)
      await t.evaluate(`document.querySelector('[data-testid=wheel-fab]').click(); true`);
      await sleep(250);
      assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-dial]')`), true, 'the wheel is shown at once');
      assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=wheel-loading]')`), false, 'no loading state');
      await t.evaluate(`document.querySelector('[data-testid=wheel-close]').click(); true`);
      // to the home page (in-app navigation): opens by itself after a moment
      const t0 = Date.now();
      await t.evaluate(`location.hash = '#/'; true`);
      await t.waitFor(popup, 10_000, 'opens by itself on home');
      const ms = Date.now() - t0;
      assert.ok(ms >= 1_000, `not instantly (${ms} ms): the page shows first`);
      await shot(t, 'wu11-auto-open-phone', { full: false });
      await t.evaluate(`document.querySelector('[data-testid=wheel-close]').click(); true`);
      // moving around, reloading: never again for this campaign
      for (const h of ['#/shop', '#/', '#/about', '#/']) {
        await t.evaluate(`location.hash = '${h}'; true`);
        await sleep(2_500);
        assert.equal(await t.evaluate(popup), false, `not reopened on ${h}`);
      }
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/`);
      await t.waitFor(fab, 20_000, 'button after reload');
      await sleep(3_000);
      assert.equal(await t.evaluate(popup), false, 'not reopened after a reload');
      // a NEW campaign (other terms): once again
      await ctx.setCampaign(prizes, { terms: 'شروط حملة جديدة للاختبار' });
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/`);
      await t.waitFor(popup, 20_000, 'a new campaign opens it once');
    }],
  ];
}

export async function runWheelScenarios(ctx) {
  const results = [];
  ctx.state = {};
  for (const [id, name, fn] of buildWheelScenarios(ctx)) {
    if (ctx.only && !ctx.only.has(id)) continue;
    // every scenario starts from clean data (its own TEST campaign is set inside)
    await ctx.reseed();
    const t0 = Date.now();
    const t = await ctx.openTab();
    try {
      await fn(t);
      results.push({ id, name, ok: true, ms: Date.now() - t0 });
      console.log(`✔ ${id} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      const extra = ` | toasts: ${await t.evaluate(TOASTS).catch(() => '?')} | hash: ${await t.evaluate('location.hash').catch(() => '?')} | result: ${await t.evaluate(`(document.querySelector('[data-testid=submit-result]')?.innerText || document.querySelector('[data-testid=submit-blocked]')?.innerText || '')`).catch(() => '?')} | google: ${await t.evaluate(`window.__antaLastGoogleError || ''`).catch(() => '?')}`;
      results.push({ id, name, ok: false, ms: Date.now() - t0, error: `${String(e?.message || e).slice(0, 600)}${extra}`.slice(0, 1400) });
      console.log(`✖ ${id} ${name}\n    ${String(e?.message || e).split('\n')[0]}${extra}`);
      await shot(t, `${id}-FAILED`).catch(() => {});
    } finally {
      await ctx.closePopup().catch(() => {});
      await t.close();
    }
  }
  return results;
}

async function shot(t, name) {
  const r = await t.send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
  const dir = process.env.E2E_SHOTS_DIR;
  if (dir) writeFileSync(join(dir, `${name}.jpg`), Buffer.from(r.data, 'base64'));
}
