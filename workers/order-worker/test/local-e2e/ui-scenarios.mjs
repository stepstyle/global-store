// U01–U12: the REAL web app (Vite dev server, emulator mode) in headless Chrome, driving Checkout and OrderSuccess
// end-to-end against the local order Worker v2 + Firestore emulator. 127.0.0.1 only.
//   Phase A — VITE_WORKER_URL = local Worker directly (real CORS preflight from http://127.0.0.1:3000)
//   Phase B — VITE_WORKER_URL = local test proxy /ui, whose behaviour is switched per scenario (drop / slow / 403 / 409 / 429 / 503)

import assert from 'node:assert/strict';
import { normalizeTrackingKey, hashTrackingKey } from '../../src/tracking.js';

const CART = [{ id: 'p-simple', name: 'دفتر', price: 2.5, stock: 10, category: 'Stationery', image: '', quantity: 2 }];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SET_VAL = `const setVal = (el, v) => {
  if (!el) throw new Error('field not found');
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};`;
const STICKY = `document.querySelector('div.fixed.bottom-0 button')`;
const OUTCOME = `(location.hash.startsWith('#/order-success/') ? 'success' : (document.querySelector('[data-testid=submit-result]')?.dataset.status || ''))`;
const CART_LEN = `JSON.parse(localStorage.getItem('anta_cart') || '[]').length`;

/**
 * Test-only request tracker, installed in every scenario tab before the app's scripts run.
 * - window.__e2eNet: Worker calls (create-order / order status) started, settled and in flight in this document.
 * - sessionStorage '__e2e_creates': every create-order the tab sent (order id + how it ended), kept across reloads of
 *   the tab, so the runner can check on the emulator that each one has settled before the next scenario reseeds.
 */
const TRACKER = `(() => {
  if (window.__e2eNet) return;
  const net = (window.__e2eNet = { started: 0, settled: 0, inflight: 0 });
  const KEY = '__e2e_creates';
  // never let the tracker break the app's own request: every storage access is guarded
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const save = (all) => { try { sessionStorage.setItem(KEY, JSON.stringify(all)); } catch {} };
  const mark = (seq, state) => { const all = load(); const c = all.find((x) => x.seq === seq); if (c) c.state = state; save(all); };
  const orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!/\\/(create-order|orders\\/[^/]+\\/status)(\\?|$)/.test(url)) return orig(input, init);
    net.started++; net.inflight++;
    let seq = 0;
    if (/\\/create-order/.test(url)) {
      let id = '';
      try { id = JSON.parse((init && init.body) || '{}').order.id || ''; } catch {}
      const all = load(); seq = all.length + 1; all.push({ seq, id, state: 'sent' }); save(all);
    }
    const done = (state) => { net.settled++; net.inflight--; if (seq) mark(seq, state); };
    return orig(input, init).then(
      (r) => { done('status:' + r.status); return r; },
      (e) => { done('error:' + ((e && e.name) || 'Error')); throw e; },
    );
  };
})();`;
const NET_IDLE = `(!window.__e2eNet || window.__e2eNet.inflight === 0)`;
/** A submission has finished: the success page is open, or nothing is in flight and the page is no longer processing. */
const SUBMIT_SETTLED = `(location.hash.startsWith('#/order-success/') || (${NET_IDLE} && !document.querySelector('[data-testid=submit-result] button[disabled]') && !(${STICKY} || {}).disabled))`;

/**
 * Seed the cart BEFORE the app's own scripts run on the next document (an already-open page would otherwise
 * rewrite localStorage with its own empty cart), then open Checkout.
 */
async function openCheckout(tab, base) {
  await tab.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `if (location.search.includes('seedcart=1')) { localStorage.setItem('anta_cart', ${JSON.stringify(JSON.stringify(CART))}); localStorage.setItem('language', 'ar'); }`,
  });
  await tab.navigate(`${base}/?seedcart=1&r=${Date.now()}#/checkout`);
  await tab.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 40_000, 'checkout form');
}

/** Fill step 1 (guest, Zarqa: standard shipping 3 JOD), go to step 3 (COD). */
async function fillToPayment(tab, phoneLocal, name = 'زبون اختبار محلي') {
  await tab.evaluate(`(() => { ${SET_VAL}
    setVal(document.querySelector('input[placeholder^="name@example.com"]'), 'buyer@example.com');
    setVal(document.querySelector('input[placeholder="الاسم الأول والأخير"]'), ${JSON.stringify(name)});
    setVal(document.querySelector('input[placeholder="0791234567"]'), ${JSON.stringify(phoneLocal)});
    setVal([...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'zarqa')), 'zarqa');
    return true; })()`);
  await sleep(150);
  await tab.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('input[placeholder^="اسم الشارع"]'), 'شارع الاختبار 1'); return true; })()`);
  await tab.evaluate(`${STICKY}.click(); true`);
  await tab.waitFor(`document.body.innerText.includes('توصيل عادي')`, 10_000, 'step 2');
  await tab.evaluate(`${STICKY}.click(); true`);
  await tab.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('CliQ'))`, 10_000, 'step 3');
}

const confirm = (tab) => tab.evaluate(`${STICKY}.click(); true`);

const ATTEMPTS = `JSON.parse(localStorage.getItem('anta_checkout_attempts_v2') || '{"attempts":[]}').attempts`;
const BANNER = (status) => `[...document.querySelectorAll('[data-testid=pending-attempt]')].some((b) => b.dataset.status === ${JSON.stringify(status)})`;
async function until(fn, ms, label) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await sleep(250);
  }
}


/** Real sign-in through the app's Login page (Firebase Auth EMULATOR, email/password). */
async function signIn(tab, base, email, password, { keepSession = false } = {}) {
  // tabs share one browser profile: drop any Firebase session another scenario left in IndexedDB
  // (keepSession: switch accounts the way a customer does — the app signs the new account in over the old session)
  if (!keepSession) await tab.send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'indexeddb' });
  // diagnosis only: keep console errors / uncaught errors of the page (codes + messages, no form values)
  await tab.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__e2eErrs = []; const ce = console.error.bind(console); console.error = (...a) => { try { window.__e2eErrs.push(a.map((x) => (x && (x.code || x.message)) || String(x)).join(' ').slice(0, 300)); } catch {} ce(...a); };
      addEventListener('error', (e) => window.__e2eErrs.push('error: ' + String(e.message).slice(0, 300)));
      addEventListener('unhandledrejection', (e) => window.__e2eErrs.push('rejection: ' + String((e.reason && (e.reason.code || e.reason.message)) || e.reason).slice(0, 300)));`,
  });
  await tab.navigate(`${base}/?r=${Date.now()}#/login`);
  await tab.waitFor(`(() => { const f = document.querySelector('input[type=password]')?.form; return !!f && !!f.querySelector('input[type=email]') && !f.querySelector('button[type=submit]')?.disabled; })()`, 30_000, 'login form');
  await tab.evaluate(`(() => { ${SET_VAL}
    setVal(document.querySelector('input[type=password]')?.form.querySelector('input[type=email]'), ${JSON.stringify(email)});
    setVal(document.querySelector('input[type=password]'), ${JSON.stringify(password)});
    return true; })()`);
  await sleep(150);
  await tab.evaluate(`document.querySelector('input[type=password]')?.form.requestSubmit(); true`);
  try {
    await tab.waitFor(`location.hash === '#/' || location.hash === ''`, 30_000, 'redirect after sign-in');
  } catch (e) {
    // what the login card says (alert text), for diagnosis — synthetic account only
    const card = await tab.evaluate(`(() => { const t = (document.querySelector('main') || document.body).innerText.replace(/\\s+/g, ' '); const i = t.indexOf('خصوصيتك'); return 'form=' + !!document.querySelector('form') + ' inputs=' + document.querySelectorAll('input').length + ' | ' + (i > 0 ? t.slice(0, i) : t).slice(-500); })()`).catch((x) => String(x));
    const errs = await tab.evaluate(`JSON.stringify((window.__e2eErrs || []).slice(-8))`).catch(() => '[]');
    throw new Error(`${e.message} | login card: ${card} | page errors: ${errs}`);
  }
}
/** Checkout for the signed-in customer: wait until the app restored the Firebase session (email prefilled from the profile). */
async function openCheckoutSignedIn(tab, base, email) {
  await openCheckout(tab, base);
  await tab.waitFor(`document.querySelector('input[placeholder^="name@example.com"]')?.value === ${JSON.stringify(email)}`, 30_000, 'signed-in profile in checkout');
}
const REVIEW_FORM = `!!document.querySelector('textarea[placeholder^="اكتب رأيك"]')`;
async function openReviews(tab, base, productId) {
  await tab.navigate(`${base}/?r=${Date.now()}#/product/${productId}`);
  await tab.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('التقييمات'))`, 30_000, 'product page');
  await tab.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('التقييمات')).click(); true`);
  await tab.waitFor(`${REVIEW_FORM} || document.body.innerText.includes('نحن نهتم برأيك')`, 15_000, 'reviews tab');
}
const waitOutcome = (tab, ms = 40_000) => tab.waitFor(OUTCOME, ms, 'order outcome');
const successStatus = (tab) =>
  tab.waitFor(`(() => { const s = document.querySelector('[data-testid=success-status]')?.dataset.status; return s && s !== 'idle' && s !== 'loading' ? s : ''; })()`, 30_000, 'success page status');

export function buildUiScenarios(ctx) {
  const { get, countOrdersByPhone, setUiMode } = ctx;
  const stock = async () => (await get('products/p-simple'))?.stock;
  return {
    A: [
      ['U01', 'success (direct Worker, real CORS): success page, cart emptied, stock once', async (tab) => {
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000001');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'success');
        assert.equal(await successStatus(tab), 'success');
        assert.equal(await tab.evaluate(CART_LEN), 0, 'cart emptied only after confirmation');
        assert.equal(await countOrdersByPhone('+962791000001'), 1);
        assert.equal(await stock(), 8);
      }],
      ['U02', 'success page REFRESH re-verifies with the Worker (still success)', async (tab) => {
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000002');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'success');
        assert.equal(await successStatus(tab), 'success');
        await tab.reload();
        assert.equal(await successStatus(tab), 'success');
      }],
      ['U03', 'same success URL in ANOTHER tab (no confirmation recorded there) -> "registered", no details', async (tab) => {
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000003');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'success');
        const id = await tab.evaluate(`location.hash.split('/').pop()`);
        const other = await ctx.openTab(); // fresh tab: its own sessionStorage, nothing confirmed there
        try {
          await other.navigate(`${ctx.base}/?r=${Date.now()}#/order-success/${id}`);
          assert.equal(await successStatus(other), 'exists');
          assert.equal(await other.evaluate(`document.body.innerText.includes('شارع الاختبار')`), false, 'no address shown');
        } finally {
          await other.close();
        }
      }],
      ['U04', 'success URL for an unknown / invalid order -> error, never success', async (tab) => {
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/order-success/ORD-NOPE1234-NOPE1234`);
        assert.equal(await successStatus(tab), 'error');
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/order-success/not-an-id`);
        assert.equal(await successStatus(tab), 'error');
      }],
      ['U05', 'DOUBLE CLICK on confirm -> one order, one stock deduction', async (tab) => {
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000005');
        await tab.evaluate(`(() => { const b = ${STICKY}; b.click(); b.click(); b.click(); return true; })()`);
        assert.equal(await waitOutcome(tab), 'success');
        await sleep(1500);
        assert.equal(await countOrdersByPhone('+962791000005'), 1);
        assert.equal(await stock(), 8);
      }],
      ['U17', 'GUEST tracking: code on the success page; details on this device, STATUS ONLY elsewhere, details with the typed code; key never in a URL; no personal data', async (tab) => {
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000017');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'success');
        assert.equal(await successStatus(tab), 'success');
        const orderId = await tab.evaluate(`location.hash.split('/').pop()`);
        const shown = await tab.waitFor(`document.querySelector('[data-testid=tracking-code-value]')?.textContent || ''`, 15_000, 'tracking code on the success page');
        assert.match(shown, /^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/);
        const key = normalizeTrackingKey(shown);
        assert.equal((await ctx.ledger(orderId)).trackingKeyHash, await hashTrackingKey(key), 'the Worker stores only the hash of the code shown');
        const DETAILS = `!document.querySelector('[data-testid=tracking-status-only]') && !!document.querySelector('[data-testid=tracking-details]')`;
        const STATUS_ONLY = `!!document.querySelector('[data-testid=tracking-status-only]') && !document.querySelector('[data-testid=tracking-details]')`;
        const noPii = async (where) => {
          const text = await tab.evaluate(`document.body.innerText`);
          for (const pii of ['زبون اختبار محلي', '791000017', 'شارع الاختبار', 'buyer@example.com']) assert.equal(text.includes(pii), false, `${where}: shows ${pii}`);
        };
        // same device: details (summary through the Worker with this device's key)
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/tracking?orderId=${orderId}`);
        await tab.waitFor(DETAILS, 20_000, 'details on the ordering device');
        await noPii('tracking (this device)');
        // "another device": no stored key -> status only
        await tab.evaluate(`localStorage.removeItem('anta_tracking_keys'); true`);
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/tracking?orderId=${orderId}`);
        await tab.waitFor(STATUS_ONLY, 20_000, 'status only without the code');
        await noPii('tracking (status only)');
        // wrong code -> still status only
        await tab.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('[data-testid=tracking-code]'), 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'); document.querySelector('[data-testid=tracking-code]').form.requestSubmit(); return true; })()`);
        await sleep(1_500);
        await tab.waitFor(STATUS_ONLY, 20_000, 'wrong code: status only');
        // the right code typed by the customer (any case / grouping) -> details
        await tab.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('[data-testid=tracking-code]'), ${JSON.stringify(shown.toLowerCase())}); document.querySelector('[data-testid=tracking-code]').form.requestSubmit(); return true; })()`);
        await tab.waitFor(DETAILS, 20_000, 'details with the typed code');
        await noPii('tracking (typed code)');
        // the key never appears in any URL this page loaded or navigated to
        const leaked = await tab.evaluate(`performance.getEntriesByType('resource').some((e) => e.name.toUpperCase().replace(/-/g, '').includes(${JSON.stringify(key)})) || location.href.toUpperCase().replace(/-/g, '').includes(${JSON.stringify(key)})`);
        assert.equal(leaked, false, 'tracking key found in a URL');
        assert.equal(await countOrdersByPhone('+962791000017'), 1);
        assert.equal(await stock(), 8);
      }],
      ['U13', 'saved cart survives app start (StrictMode dev) and REFRESH; corrupted saved cart -> empty cart view, no crash', async (tab) => {
        const QTY = `(JSON.parse(localStorage.getItem('anta_cart') || '[]')[0] || {}).quantity`;
        const FORM = `!!document.querySelector('input[placeholder="0791234567"]')`;
        await openCheckout(tab, ctx.base); // seeded once, before the app starts
        assert.equal(await tab.evaluate(CART_LEN), 1);
        assert.equal(await tab.evaluate(QTY), 2);
        // refresh = a new document WITHOUT the seed parameter: only what the app itself saved is there
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/checkout`);
        await tab.waitFor(FORM, 40_000, 'checkout form after refresh');
        assert.equal(await tab.evaluate(CART_LEN), 1, 'cart kept after refresh');
        assert.equal(await tab.evaluate(QTY), 2, 'quantity kept after refresh');
        await tab.reload();
        await tab.waitFor(FORM, 40_000, 'checkout form after second refresh');
        assert.equal(await tab.evaluate(CART_LEN), 1, 'cart kept after second refresh');
        // corrupted saved cart: the app starts, shows the empty-cart view, and replaces the bad value
        await tab.evaluate(`localStorage.setItem('anta_cart', '{broken'); true`);
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/checkout`);
        await tab.waitFor(`document.body.innerText.includes('سلة التسوق فارغة')`, 40_000, 'empty-cart view');
        assert.equal(await tab.evaluate(`localStorage.getItem('anta_cart')`), '[]');
      }],
    ],
    B: [
      ['U06', 'network drop -> not_confirmed panel with the order number, cart KEPT; retry with the same number -> success', async (tab) => {
        await setUiMode('drop');
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000006');
        await confirm(tab);
        assert.equal(await waitOutcome(tab, 60_000), 'not_confirmed');
        const shown = (await tab.evaluate(`document.querySelector('[data-testid=submit-order-id]')?.textContent || ''`)).replace('#', '');
        assert.match(shown, /^ORD-/);
        assert.equal(await tab.evaluate(CART_LEN), 1, 'cart kept');
        assert.equal(await countOrdersByPhone('+962791000006'), 0);
        await setUiMode('pass');
        // the earlier "not_confirmed" panel stays on screen while the retry runs: wait for the retry request to be
        // SENT and then for the submission to FINISH, and only then read the outcome (never the stale panel)
        const sentBefore = await tab.evaluate(`window.__e2eNet.started`);
        await tab.evaluate(`[...document.querySelectorAll('[data-testid=submit-result] button')].find((b) => /نفس رقم|same order number/.test(b.textContent)).click(); true`);
        await tab.waitFor(`window.__e2eNet.started > ${sentBefore}`, 10_000, 'retry request sent');
        await tab.waitFor(SUBMIT_SETTLED, 40_000, 'retry finished');
        assert.equal(await tab.evaluate(OUTCOME), 'success', 'retry outcome');
        assert.equal(await successStatus(tab), 'success', 'success page');
        assert.equal(await tab.evaluate(`location.hash.split('/').pop()`), shown, 'SAME order number');
        assert.equal(await tab.evaluate(CART_LEN), 0, 'cart emptied after confirmation');
        assert.equal(await countOrdersByPhone('+962791000006'), 1, 'exactly one order');
        assert.ok(await get(`orders/${shown}`), 'the order saved under the SAME number');
        assert.equal(await stock(), 8, 'stock deducted once');
      }],
      ['U07', 'timeout AFTER the Worker saved it -> verified -> success (no duplicate)', async (tab) => {
        // clean start: nothing from the previous scenario (U06) reached this freshly seeded emulator
        assert.equal(await stock(), 10, 'fresh stock before U07');
        assert.equal(await countOrdersByPhone('+962791000006'), 0, 'no U06 order in U07');
        await setUiMode('slow15');
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000007');
        await confirm(tab);
        assert.equal(await waitOutcome(tab, 60_000), 'success');
        assert.equal(await successStatus(tab), 'success');
        assert.equal(await countOrdersByPhone('+962791000007'), 1, 'exactly one order');
        assert.equal(await stock(), 8, 'deducted once');
        assert.equal(await countOrdersByPhone('+962791000006'), 0, 'still no U06 order');
      }],
      ['U08', '403 -> clear "security check" message, nothing created, cart KEPT', async (tab) => {
        await setUiMode('reject403');
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000008');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'rejected');
        assert.equal(await tab.evaluate(`document.querySelector('[data-testid=submit-result]').innerText.includes('التحقق الأمني')`), true);
        assert.equal(await tab.evaluate(CART_LEN), 1);
        assert.equal(await countOrdersByPhone('+962791000008'), 0);
      }],
      ['U09', '409 -> conflict message with the order number + WhatsApp, no replacement order, cart KEPT', async (tab) => {
        await setUiMode('conflict409');
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000009');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'conflict');
        assert.match(await tab.evaluate(`document.querySelector('[data-testid=submit-order-id]')?.textContent || ''`), /ORD-/);
        assert.equal(await tab.evaluate(`!!document.querySelector('[data-testid=submit-result] a[href^="https://wa.me/"]')`), true);
        assert.equal(await tab.evaluate(CART_LEN), 1);
      }],
      ['U10', '429 (Retry-After) -> waits, same number -> success', async (tab) => {
        await setUiMode('429once');
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000010');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'success');
        assert.equal(await countOrdersByPhone('+962791000010'), 1);
      }],
      ['U11', '503 every time -> not_confirmed (never success), cart KEPT, nothing created', async (tab) => {
        await setUiMode('503');
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000011');
        await confirm(tab);
        assert.equal(await waitOutcome(tab, 60_000), 'not_confirmed');
        assert.equal(await tab.evaluate(CART_LEN), 1);
        assert.equal(await countOrdersByPhone('+962791000011'), 0);
      }],
      ['U12', 'changed details after an unconfirmed attempt -> blocked (no second number), order number + WhatsApp shown', async (tab) => {
        await setUiMode('drop');
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000012');
        await confirm(tab);
        assert.equal(await waitOutcome(tab, 60_000), 'not_confirmed');
        const first = await tab.evaluate(`document.querySelector('[data-testid=submit-order-id]')?.textContent || ''`);
        await tab.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('textarea'), 'ملاحظة جديدة بعد المحاولة'); return true; })()`);
        await setUiMode('pass');
        await sleep(200);
        await confirm(tab);
        // the previous 'not_confirmed' panel stays until the new result replaces it: wait for THE NEW status
        await tab.waitFor(`${OUTCOME} === 'blocked_previous'`, 40_000, 'blocked_previous after the changed details');
        assert.equal(await tab.evaluate(`document.querySelector('[data-testid=submit-order-id]')?.textContent || ''`), first, 'the EARLIER number is shown');
        assert.equal(await countOrdersByPhone('+962791000012'), 0, 'no order created with the changed details');
      }],


      // ---------------- pending attempt survives closing the tab / browser (localStorage, no personal data) ----------------
      ['U20', 'CLOSED after the Worker SAVED the order but before the answer arrived -> reopened: recovered with the tracking key; the same order again is NOT created twice', async (tab) => {
        await setUiMode('savehold');
        const t1 = await ctx.openTab();
        let rec;
        try {
          await openCheckout(t1, ctx.base);
          await fillToPayment(t1, '0791000020');
          await confirm(t1);
          await until(async () => (await countOrdersByPhone('+962791000020')) === 1, 20_000, 'saved by the Worker');
          [rec] = await t1.evaluate(ATTEMPTS);
          assert.equal(typeof rec.lastSentAt, 'number', 'send time written BEFORE the answer');
          assert.notEqual(rec.state, 'confirmed', 'no answer reached the page');
          const raw = await t1.evaluate(`localStorage.getItem('anta_checkout_attempts_v2')`);
          for (const pii of ['زبون اختبار محلي', '791000020', 'شارع الاختبار', 'buyer@example.com']) assert.equal(raw.includes(pii), false, `localStorage holds ${pii}`);
        } finally {
          await t1.close(); // closed while the request is still unanswered
        }
        await setUiMode('pass');
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/checkout`); // reopened: new tab, new session, same localStorage
        await tab.waitFor(BANNER('recovered'), 20_000, 'recovered banner');
        assert.equal(await tab.evaluate(`document.querySelector('[data-testid=pending-attempt]').dataset.orderId`), rec.orderId);
        assert.equal((await tab.evaluate(ATTEMPTS)).find((a) => a.orderId === rec.orderId).state, 'confirmed');
        // the customer presses "confirm" again with the same cart and details: no second order
        await fillToPayment(tab, '0791000020');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'already_confirmed');
        assert.equal(await countOrdersByPhone('+962791000020'), 1, 'one order');
        assert.equal(await stock(), 8, 'stock once');
      }],
      ['U21', 'CLOSED while the create is still in flight -> reopened: 404 keeps it UNRESOLVED (no new number); the LATE save is then recovered', async (tab) => {
        await setUiMode('delaycreate'); // reaches the Worker only after 8 s
        const t1 = await ctx.openTab();
        let rec;
        try {
          await openCheckout(t1, ctx.base);
          await fillToPayment(t1, '0791000021');
          await confirm(t1);
          await sleep(1_000);
          [rec] = await t1.evaluate(ATTEMPTS);
          assert.equal(typeof rec.lastSentAt, 'number', 'send time written before the network call');
        } finally {
          await t1.close();
        }
        await setUiMode('pass');
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/checkout`);
        await tab.waitFor(BANNER('not_found_yet'), 20_000, 'unresolved banner (404 is not proof)');
        assert.equal(await countOrdersByPhone('+962791000021'), 0, 'not saved yet');
        assert.equal(await tab.evaluate(`!!document.querySelector('[data-testid=pending-whatsapp]')`), true, 'way to contact the shop');
        assert.equal((await tab.evaluate(ATTEMPTS)).find((a) => a.orderId === rec.orderId).state !== 'confirmed', true, 'kept, not removed');
        // the delayed create lands
        await until(async () => (await countOrdersByPhone('+962791000021')) === 1, 25_000, 'late save');
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/checkout`);
        await tab.waitFor(BANNER('recovered'), 20_000, 'recovered after the late save');
        assert.equal(await countOrdersByPhone('+962791000021'), 1);
        assert.equal(await stock(), 8, 'stock once');
      }],
      ['U22', 'CLOSED before the request reached the Worker -> reopened: unresolved; CHANGED details refused (no new number, nothing sent); the SAME details resend the SAME number', async (tab) => {
        await setUiMode('drop');
        const t1 = await ctx.openTab();
        let rec;
        try {
          await openCheckout(t1, ctx.base);
          await fillToPayment(t1, '0791000022');
          await confirm(t1);
          await sleep(1_500);
          [rec] = await t1.evaluate(ATTEMPTS);
        } finally {
          await t1.close();
        }
        await setUiMode('pass');
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/checkout`);
        await tab.waitFor(BANNER('not_found_yet'), 20_000, 'unresolved banner');
        // different details: refused locally, the earlier number is shown, nothing sent
        await fillToPayment(tab, '0791000099');
        const sent0 = await tab.evaluate(`window.__e2eNet.started`);
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'blocked_previous');
        assert.equal((await tab.evaluate(`document.querySelector('[data-testid=submit-order-id]')?.textContent || ''`)).replace('#', ''), rec.orderId);
        assert.equal(await tab.evaluate(`window.__e2eNet.started`), sent0, 'nothing sent');
        assert.equal(await countOrdersByPhone('+962791000099'), 0);
        // the same details (fresh page): same number, saved once
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/checkout`);
        await tab.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 20_000, 'form');
        await fillToPayment(tab, '0791000022');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'success');
        assert.equal(await tab.evaluate(`location.hash.split('/').pop()`), rec.orderId, 'SAME number');
        assert.equal(await countOrdersByPhone('+962791000022'), 1);
        assert.equal(await stock(), 8);
      }],
      ['U24', 'EMPTY CART with an unresolved attempt -> the earlier order number, its status and the way to the shop are still shown; nothing removed, nothing sent', async (tab) => {
        await setUiMode('drop');
        const t1 = await ctx.openTab();
        let rec;
        try {
          await openCheckout(t1, ctx.base);
          await fillToPayment(t1, '0791000024');
          await confirm(t1);
          await sleep(1_500);
          [rec] = await t1.evaluate(ATTEMPTS);
        } finally {
          await t1.close();
        }
        await setUiMode('pass');
        // the cart becomes empty (e.g. emptied in another tab) — the attempt record stays
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/`);
        await tab.evaluate(`localStorage.setItem('anta_cart', '[]'); true`);
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/checkout`);
        await tab.waitFor(`document.body.innerText.includes('سلة التسوق فارغة') || document.body.innerText.includes('سلتك فارغة')`, 20_000, 'empty-cart view');
        await tab.waitFor(BANNER('not_found_yet'), 20_000, 'pending banner on the empty-cart view');
        assert.equal(await tab.evaluate(`document.querySelector('[data-testid=pending-attempt]').dataset.orderId`), rec.orderId);
        assert.equal(await tab.evaluate(`document.body.innerText.includes(${JSON.stringify(rec.orderId)})`), true, 'number visible');
        assert.equal(await tab.evaluate(`!!document.querySelector('[data-testid=pending-whatsapp]')`), true);
        // recovery only READS (status / summary); no create-order request may leave this page
        assert.equal(await tab.evaluate(`JSON.parse(sessionStorage.getItem('__e2e_creates') || '[]').length`), 0, 'no order sent');
        assert.equal((await tab.evaluate(ATTEMPTS)).some((a) => a.orderId === rec.orderId && a.state !== 'confirmed'), true, 'record kept');
        assert.equal(await countOrdersByPhone('+962791000024'), 0);
      }],
      ['U27', 'NO Web Locks AND NO IndexedDB: the order is NOT sent (no create request leaves the browser); clear Arabic message + "order on WhatsApp"; cart kept', async (tab) => {
        await setUiMode('pass');
        await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true }); try { Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true }); } catch {} try { Object.defineProperty(Window.prototype, 'indexedDB', { get: () => undefined, configurable: true }); } catch {}" });
        await openCheckout(tab, ctx.base);
        assert.equal(await tab.evaluate(`navigator.locks === undefined && window.indexedDB === undefined`), true, 'both really absent');
        await fillToPayment(tab, '0791000027');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'lock_unavailable');
        const text = await tab.evaluate(`document.querySelector('[data-testid=submit-result]').innerText`);
        assert.match(text, /متصفحك لا يدعم حماية الطلب من التكرار/);
        assert.match(text, /لم نُرسل الطلب/);
        const wa = await tab.evaluate(`document.querySelector('[data-testid=order-whatsapp]')?.href || ''`);
        assert.match(wa, /^https:\/\/wa\.me\/962796969081\?text=/, 'WhatsApp ordering option shown');
        const waText = decodeURIComponent(wa.split('?text=')[1]);
        for (const pii of ['زبون اختبار محلي', '791000027', 'شارع الاختبار', 'buyer@example.com']) assert.equal(waText.includes(pii), false, `WhatsApp text holds ${pii}`);
        assert.equal(await tab.evaluate(`JSON.parse(sessionStorage.getItem('__e2e_creates') || '[]').length`), 0, 'no create request left the browser');
        assert.equal(await tab.evaluate(`window.__e2eNet.started`), 0, 'no Worker call at all');
        assert.deepEqual(await tab.evaluate(ATTEMPTS), [], 'no attempt record (no number used)');
        assert.equal(await tab.evaluate(CART_LEN), 1, 'cart kept');
        assert.equal(await countOrdersByPhone('+962791000027'), 0);
        assert.equal(await stock(), 10, 'stock untouched');
      }],
      ['U25', 'NO Web Locks (disabled in both tabs): the IndexedDB lock still serializes two tabs -> one order, one deduction', async (tab) => {
        await setUiMode('pass');
        const t2 = await ctx.openTab();
        try {
          for (const tb of [tab, t2]) await tb.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true });" });
          await openCheckout(tab, ctx.base);
          await fillToPayment(tab, '0791000025');
          await openCheckout(t2, ctx.base);
          await fillToPayment(t2, '0791000025');
          assert.equal(await tab.evaluate(`navigator.locks === undefined && !!window.indexedDB`), true, 'Web Locks really absent, IndexedDB present');
          assert.equal(await t2.evaluate(`navigator.locks === undefined`), true);
          await Promise.all([confirm(tab), confirm(t2)]);
          const outcomes = [await waitOutcome(tab), await waitOutcome(t2)].sort();
          assert.deepEqual(outcomes, ['already_confirmed', 'success']);
          assert.equal(await countOrdersByPhone('+962791000025'), 1, 'one order');
          assert.equal(await stock(), 8, 'stock once');
        } finally {
          await t2.close();
        }
      }],
      ['U26', 'a deliberate NEW order after the previous one completed (newly opened page, same cart and details) -> allowed, new number', async (tab) => {
        await setUiMode('pass');
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000026');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'success');
        const first = await tab.evaluate(`location.hash.split('/').pop()`);
        await openCheckout(tab, ctx.base); // a newly opened checkout page (cart seeded again)
        await fillToPayment(tab, '0791000026');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'success');
        const second = await tab.evaluate(`location.hash.split('/').pop()`);
        assert.notEqual(second, first, 'a new number');
        assert.equal(await countOrdersByPhone('+962791000026'), 2, 'two deliberate orders');
        assert.equal(await stock(), 6, 'each deducted once');
      }],
      ['U23', 'TWO TABS confirm the same order at the same moment (Web Locks) -> one order, one stock deduction; the other tab is told it is already confirmed', async (tab) => {
        await setUiMode('pass');
        const t2 = await ctx.openTab();
        try {
          await openCheckout(tab, ctx.base);
          await fillToPayment(tab, '0791000023');
          await openCheckout(t2, ctx.base);
          await fillToPayment(t2, '0791000023');
          assert.equal(await tab.evaluate(`!!(navigator.locks && navigator.locks.request)`), true, 'Web Locks available in this browser');
          await Promise.all([confirm(tab), confirm(t2)]);
          const outcomes = [await waitOutcome(tab), await waitOutcome(t2)].sort();
          assert.deepEqual(outcomes, ['already_confirmed', 'success'], `outcomes: ${JSON.stringify(outcomes)}`);
          assert.equal(await countOrdersByPhone('+962791000023'), 1, 'one order');
          assert.equal(await stock(), 8, 'stock once');
        } finally {
          await t2.close();
        }
      }],

      // ---------------- signed-in customer, end to end in the browser ----------------
      ['U14', 'SIGNED-IN: real sign-in -> ID token -> order saved under the verified uid -> "My Orders" -> review allowed only after delivery', async (tab) => {
        await setUiMode('pass');
        await ctx.setUiAuthMode('resign');
        await ctx.resetAuth();
        const email = 'u14.customer@example.invalid';
        const uid = await ctx.createCustomer({ email, password: 'Test-pass-12345', name: 'زبون مسجل اختبار' });
        await signIn(tab, ctx.base, email, 'Test-pass-12345');
        await openCheckoutSignedIn(tab, ctx.base, email);
        await fillToPayment(tab, '0791000014');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'success');
        assert.equal(await successStatus(tab), 'success');
        const orderId = await tab.evaluate(`location.hash.split('/').pop()`);
        const order = await get(`orders/${orderId}`);
        assert.equal(order.userId, uid, 'saved under the verified uid');
        assert.equal(order.userIdVerified, true);
        assert.equal('claimedUserId' in order, false);
        assert.equal((await ctx.ledger(orderId)).userIdSource, 'firebase-id-token');
        assert.equal(await countOrdersByPhone('+962791000014'), 1);
        assert.equal(await stock(), 8, 'stock once');
        assert.equal(await tab.evaluate(CART_LEN), 0);
        const creates = ctx.uiAuthLog().filter((l) => l.orderId === orderId && l.path === '/create-order');
        assert.ok(creates.length >= 1 && creates.every((l) => l.sub === uid && l.forwarded === 'valid'), 'the browser sent the Auth session token of this uid');
        // "My Orders" (real page, Firestore emulator + compat rules)
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/my-orders`);
        await tab.waitFor(`document.body.innerText.includes(${JSON.stringify('#' + orderId)})`, 30_000, 'order listed in My Orders');
        // review: not yet (status new) ...
        await openReviews(tab, ctx.base, 'p-simple');
        await sleep(2_500); // the purchase check is async: give it time to (wrongly) open the form
        assert.equal(await tab.evaluate(REVIEW_FORM), false, 'no review before delivery');
        // ... allowed after delivery
        await ctx.setOrderStatus(orderId, 'delivered');
        await openReviews(tab, ctx.base, 'p-simple');
        await tab.waitFor(REVIEW_FORM, 20_000, 'review form after delivery');
      }],
      ['U19', 'INPUT LIMITS: over-long name blocked at step 1, over-long note blocked before sending (nothing sent, cart kept); a pending attempt keeps its number; fixed data -> SAME number, one order', async (tab) => {
        await setUiMode('pass');
        await openCheckout(tab, ctx.base);
        // name one past the Worker limit (maxLength bypassed on purpose: autofill / info saved before the limit)
        await tab.evaluate(`(() => { ${SET_VAL}
          setVal(document.querySelector('input[placeholder^="name@example.com"]'), 'buyer@example.com');
          setVal(document.querySelector('input[placeholder="الاسم الأول والأخير"]'), ${JSON.stringify('ا'.repeat(121))});
          setVal(document.querySelector('input[placeholder="0791234567"]'), '0791000019');
          setVal([...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'zarqa')), 'zarqa');
          return true; })()`);
        await sleep(150);
        await tab.evaluate(`${STICKY}.click(); true`);
        await tab.waitFor(`document.body.innerText.includes('الاسم طويل جدًا')`, 10_000, 'name limit message');
        // the general pop-up message is VISIBLE (restored), shown ONCE (StrictMode), and can be closed
        const TOASTS = (text) => `[...document.querySelectorAll('[data-testid=toast]')].filter((n) => n.innerText.includes(${JSON.stringify(text)})).length`;
        await tab.waitFor(`${TOASTS('يرجى تصحيح')} === 1`, 10_000, 'one visible error toast');
        assert.equal(await tab.evaluate(`document.querySelector('[data-testid=toast]').getAttribute('role')`), 'alert');
        await tab.evaluate(`${STICKY}.click(); true`); // the same mistake again: still ONE message
        await sleep(400);
        assert.equal(await tab.evaluate(TOASTS('يرجى تصحيح')), 1, 'not repeated');
        await tab.evaluate(`document.querySelector('[data-testid=toast-close]').click(); true`);
        await tab.waitFor(`${TOASTS('يرجى تصحيح')} === 0`, 5_000, 'toast closed by the customer');
        assert.equal(await tab.evaluate(`document.body.innerText.includes('توصيل عادي')`), false, 'stayed on step 1');
        assert.equal(await tab.evaluate(`window.__e2eNet.started`), 0, 'nothing sent');
        // valid details -> payment step; then an over-long note (e.g. saved before the limit existed)
        await fillToPayment(tab, '0791000019');
        const NOTE = `document.querySelector('textarea')`;
        await tab.evaluate(`(() => { ${SET_VAL} setVal(${NOTE}, ${JSON.stringify('ن'.repeat(700))}); return true; })()`);
        await sleep(150);
        await confirm(tab);
        await tab.waitFor(`document.body.innerText.includes('الملاحظات طويلة جدًا')`, 10_000, 'note limit message').catch(async (e) => {
          const tail = await tab.evaluate(`JSON.stringify({
            textareas: [...document.querySelectorAll('textarea')].map((x) => x.value.length),
            started: window.__e2eNet && window.__e2eNet.started,
            cliqStep: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('CliQ')),
            alerts: [...document.querySelectorAll('[role=alert],[role=status],.toast,[class*=toast]')].map((n) => n.innerText).join(' / ').slice(0, 300),
            hasLong: document.body.innerText.includes('طويل'),
            fixFields: document.body.innerText.includes('يرجى تصحيح'),
          })`).catch((x) => String(x));
          throw new Error(`${e.message} | diag: ${String(tail).replace(/\n/g, ' ')}`);
        });
        assert.equal(await tab.evaluate(`window.__e2eNet.started`), 0, 'still nothing sent');
        assert.equal(await tab.evaluate(`document.querySelectorAll('[data-testid=submit-blocked]').length`), 1, 'inline message once');
        assert.equal(await tab.evaluate(TOASTS('الملاحظات')), 0, 'no second display (toast) of the same error');
        assert.equal(await tab.evaluate(CART_LEN), 1, 'cart kept');
        // a pending attempt: valid note, network drop -> not confirmed, number shown
        await tab.evaluate(`(() => { ${SET_VAL} setVal(${NOTE}, 'اتصل قبل الوصول'); return true; })()`);
        await sleep(150);
        await setUiMode('drop');
        await confirm(tab);
        assert.equal(await waitOutcome(tab, 60_000), 'not_confirmed');
        const shown = (await tab.evaluate(`document.querySelector('[data-testid=submit-order-id]')?.textContent || ''`)).replace('#', '');
        // the open attempt record (localStorage v2, shared by tabs): its order number
        const ATTEMPT = `(JSON.parse(localStorage.getItem('anta_checkout_attempts_v2') || '{"attempts":[]}').attempts.filter((a) => a.state !== 'confirmed').sort((a, b) => b.updatedAt - a.updatedAt)[0] || {}).orderId || ''`;
        assert.equal(await tab.evaluate(ATTEMPT), shown);
        // over-long note again -> refused locally; the pending attempt and its number are untouched
        const sentBefore = await tab.evaluate(`window.__e2eNet.started`);
        await tab.evaluate(`(() => { ${SET_VAL} setVal(${NOTE}, ${JSON.stringify('ن'.repeat(650))}); return true; })()`);
        await sleep(150);
        await confirm(tab);
        await sleep(1_500);
        assert.equal(await tab.evaluate(`window.__e2eNet.started`), sentBefore, 'refused before sending');
        assert.equal(await tab.evaluate(ATTEMPT), shown, 'pending attempt kept');
        assert.equal(await tab.evaluate(CART_LEN), 1, 'cart kept');
        // the same (valid) details again -> the SAME number, saved once
        await tab.evaluate(`(() => { ${SET_VAL} setVal(${NOTE}, 'اتصل قبل الوصول'); return true; })()`);
        await sleep(150);
        await setUiMode('pass');
        const sent2 = await tab.evaluate(`window.__e2eNet.started`);
        await confirm(tab);
        await tab.waitFor(`window.__e2eNet.started > ${sent2}`, 10_000, 'resend');
        await tab.waitFor(SUBMIT_SETTLED, 40_000, 'resend finished');
        assert.equal(await tab.evaluate(OUTCOME), 'success');
        assert.equal(await tab.evaluate(`location.hash.split('/').pop()`), shown, 'SAME order number');
        assert.equal(await countOrdersByPhone('+962791000019'), 1);
        await tab.waitFor(`${TOASTS('تم تأكيد طلبك')} === 1`, 5_000, 'one success toast after confirmation');
        assert.equal(await stock(), 8, 'stock once');
      }],
      ['U18', 'SIGNED-IN: Account lists the order by the verified uid; tracking on another device shows details to the OWNER (token), no code needed', async (tab) => {
        await setUiMode('pass');
        await ctx.setUiAuthMode('resign');
        await ctx.resetAuth();
        const email = 'u18.customer@example.invalid';
        await ctx.createCustomer({ email, password: 'Test-pass-12345', name: 'زبون حساب اختبار' });
        await signIn(tab, ctx.base, email, 'Test-pass-12345');
        await openCheckoutSignedIn(tab, ctx.base, email);
        await fillToPayment(tab, '0791000018');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'success');
        const orderId = await tab.evaluate(`location.hash.split('/').pop()`);
        // Account -> "My previous orders" (Firestore query userId == uid, allowed by the final rules)
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/account`);
        await tab.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('طلباتي'))`, 20_000, 'account page');
        await tab.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('طلباتي')).click(); true`);
        await tab.waitFor(`document.body.innerText.includes(${JSON.stringify(orderId)})`, 20_000, 'order listed in Account');
        // tracking without this device's code: the signed-in owner still sees the details (verified token)
        await tab.evaluate(`localStorage.removeItem('anta_tracking_keys'); true`);
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/tracking?orderId=${orderId}`);
        await tab.waitFor(`!document.querySelector('[data-testid=tracking-status-only]') && !!document.querySelector('[data-testid=tracking-details]')`, 20_000, 'owner sees details');
        const summaries = ctx.uiAuthLog().filter((l) => l.orderId === '' && l.path.endsWith('/summary'));
        assert.ok(summaries.length >= 1 && summaries.every((l) => l.forwarded === 'valid'), 'summary asked with the owner token');
      }],
      ['U15', 'SIGNED-IN: token EXPIRED during submit -> app refreshes it -> SAME order number, one order, stock once', async (tab) => {
        await setUiMode('pass');
        await ctx.setUiAuthMode('expireFirst');
        await ctx.resetAuth();
        const email = 'u15.customer@example.invalid';
        const uid = await ctx.createCustomer({ email, password: 'Test-pass-12345', name: 'زبون انتهاء الجلسة' });
        await signIn(tab, ctx.base, email, 'Test-pass-12345');
        await openCheckoutSignedIn(tab, ctx.base, email);
        await fillToPayment(tab, '0791000015');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'success');
        const orderId = await tab.evaluate(`location.hash.split('/').pop()`);
        const creates = ctx.uiAuthLog().filter((l) => l.orderId === orderId && l.path === '/create-order');
        assert.deepEqual(creates.map((l) => l.forwarded), ['expired', 'valid'], 'first send expired (401), the resend carried a valid token');
        assert.equal(await countOrdersByPhone('+962791000015'), 1, 'one order');
        assert.equal((await get(`orders/${orderId}`)).userId, uid);
        assert.equal(await stock(), 8, 'stock deducted once');
        await ctx.setUiAuthMode('resign');
      }],
      ['U16', 'SIGNED-IN: token refused even after refresh -> "sign in again" panel, cart + number KEPT, nothing saved; then retry same number -> success', async (tab) => {
        await setUiMode('pass');
        await ctx.setUiAuthMode('forge');
        await ctx.resetAuth();
        const email = 'u16.customer@example.invalid';
        const uid = await ctx.createCustomer({ email, password: 'Test-pass-12345', name: 'زبون توكن مرفوض' });
        await signIn(tab, ctx.base, email, 'Test-pass-12345');
        await openCheckoutSignedIn(tab, ctx.base, email);
        await fillToPayment(tab, '0791000016');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'auth_required');
        const shown = (await tab.evaluate(`document.querySelector('[data-testid=submit-order-id]')?.textContent || ''`)).replace('#', '');
        assert.match(shown, /^ORD-/);
        assert.equal(await tab.evaluate(CART_LEN), 1, 'cart kept');
        assert.equal(await countOrdersByPhone('+962791000016'), 0, 'nothing saved');
        assert.equal(await stock(), 10, 'stock untouched');
        const refused = ctx.uiAuthLog().filter((l) => l.orderId === shown && l.path === '/create-order');
        assert.deepEqual(refused.map((l) => l.forwarded), ['forged', 'forged'], 'one send + one refreshed resend, both refused');
        // the session is fine again -> "retry with the same number"
        await ctx.setUiAuthMode('resign');
        const sentBefore = await tab.evaluate(`window.__e2eNet.started`);
        await tab.evaluate(`[...document.querySelectorAll('[data-testid=submit-result] button')].find((b) => /نفس رقم|same order number/.test(b.textContent)).click(); true`);
        await tab.waitFor(`window.__e2eNet.started > ${sentBefore}`, 10_000, 'retry request sent');
        await tab.waitFor(SUBMIT_SETTLED, 40_000, 'retry finished');
        assert.equal(await tab.evaluate(OUTCOME), 'success');
        assert.equal(await tab.evaluate(`location.hash.split('/').pop()`), shown, 'SAME order number');
        assert.equal(await countOrdersByPhone('+962791000016'), 1);
        assert.equal((await get(`orders/${shown}`)).userId, uid);
        assert.equal(await stock(), 8, 'stock once');
      }],
      ['U28', 'SHARED DEVICE, account A -> account B: A\'s saved-but-unanswered order is NOT handed to B (no payload, no tracking code, no details, no ownership transfer); B orders under a NEW number', async (tab) => {
        try {
          await setUiMode('savehold');
          await ctx.setUiAuthMode('resign');
          await ctx.resetAuth();
          const pw = 'Test-pass-12345';
          const emailA = 'u28.a@example.invalid';
          const emailB = 'u28.b@example.invalid';
          const uidA = await ctx.createCustomer({ email: emailA, password: pw, name: 'زبون أ اختبار' });
          const uidB = await ctx.createCustomer({ email: emailB, password: pw, name: 'زبون ب اختبار' });
          const A_PII = ['صاحب الحساب أ', '791000028', 'شارع الاختبار'];
          await signIn(tab, ctx.base, emailA, pw);
          await openCheckoutSignedIn(tab, ctx.base, emailA);
          await fillToPayment(tab, '0791000028', 'صاحب الحساب أ');
          await confirm(tab);
          await until(async () => (await countOrdersByPhone('+962791000028')) === 1, 20_000, "A's order saved by the Worker");
          const [rec] = await tab.evaluate(ATTEMPTS);
          assert.equal(rec.who, uidA);
          assert.notEqual(rec.state, 'confirmed', 'no answer reached the page');
          assert.equal(await tab.evaluate(`!!sessionStorage.getItem('anta_checkout_pending_payload')`), true, "A's payload is in this tab");
          await setUiMode('pass');
          // B signs in in the SAME tab (Firebase session replaced; localStorage + this tab's sessionStorage stay)
          await signIn(tab, ctx.base, emailB, pw);
          await openCheckoutSignedIn(tab, ctx.base, emailB);
          await tab.waitFor(BANNER('exists_unverified'), 20_000, "A's order shown to B as existing only");
          assert.equal(await tab.evaluate(`document.querySelector('[data-testid=pending-attempt]').dataset.orderId`), rec.orderId);
          assert.equal(await tab.evaluate(`!!document.querySelector('[data-testid=pending-retry-same]')`), false, 'B cannot resend A\'s order');
          assert.equal(await tab.evaluate(`sessionStorage.getItem('anta_checkout_pending_payload')`), null, "A's payload dropped");
          const stored = await tab.evaluate(`JSON.parse(localStorage.getItem('anta_tracking_keys') || '[]').filter((e) => e.o === ${JSON.stringify(rec.orderId)}).map((e) => e.w)`);
          assert.deepEqual(stored, [uidA], "A's key stays on the device bound to A only (never to B)");
          const after = (await tab.evaluate(ATTEMPTS)).find((a) => a.orderId === rec.orderId);
          assert.equal(after.state, 'confirmed', 'no longer blocks this device');
          assert.equal(after.ownerNotice, true, 'A will be told when back');
          let body = await tab.evaluate(`document.body.innerText`);
          for (const p of A_PII) assert.equal(body.includes(p), false, `checkout shows A's ${p}`);
          // A's success URL and tracking page, as B: no code, no details
          await tab.navigate(`${ctx.base}/?r=${Date.now()}#/order-success/${rec.orderId}`);
          await successStatus(tab);
          await sleep(1_500); // the code lookup waits for the restored session
          assert.equal(await tab.evaluate(`document.querySelector('[data-testid=tracking-code-value]')?.textContent || ''`), '', 'no tracking code for B');
          body = await tab.evaluate(`document.body.innerText`);
          for (const p of A_PII) assert.equal(body.includes(p), false, `success page shows A's ${p}`);
          await tab.navigate(`${ctx.base}/?r=${Date.now()}#/tracking?orderId=${rec.orderId}`);
          await tab.waitFor(`!!document.querySelector('[data-testid=tracking-status-only]') && !document.querySelector('[data-testid=tracking-details]')`, 20_000, 'status only for B');
          body = await tab.evaluate(`document.body.innerText`);
          for (const p of A_PII) assert.equal(body.includes(p), false, `tracking shows A's ${p}`);
          // B's own order: a NEW number, owned by B; A's order still A's
          await openCheckoutSignedIn(tab, ctx.base, emailB);
          await fillToPayment(tab, '0791000128', 'صاحب الحساب ب');
          await confirm(tab);
          assert.equal(await waitOutcome(tab), 'success');
          const bId = await tab.evaluate(`location.hash.split('/').pop()`);
          assert.notEqual(bId, rec.orderId, 'a new number for B');
          assert.match(await tab.waitFor(`document.querySelector('[data-testid=tracking-code-value]')?.textContent || ''`, 15_000, "B's own code"), /^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/);
          assert.equal((await get(`orders/${rec.orderId}`)).userId, uidA, "A's order unchanged");
          assert.equal((await ctx.ledger(rec.orderId)).ownerUid, uidA, 'no ownership transfer');
          assert.equal((await get(`orders/${bId}`)).userId, uidB);
          assert.equal((await ctx.ledger(bId)).ownerUid, uidB);
          assert.equal(await countOrdersByPhone('+962791000028'), 1, 'A: one order');
          assert.equal(await countOrdersByPhone('+962791000128'), 1, 'B: one order');
          assert.equal(await stock(), 6, 'each deducted once');
          // A comes back to this device: told once (banner with the number), the code and details are A's again
          await signIn(tab, ctx.base, emailA, pw);
          await openCheckoutSignedIn(tab, ctx.base, emailA);
          await tab.waitFor(`[...document.querySelectorAll('[data-testid=pending-attempt]')].some((b) => b.dataset.status === 'recovered' && b.dataset.orderId === ${JSON.stringify(rec.orderId)})`, 20_000, "A is told about the saved order");
          assert.equal(await tab.evaluate(`[...document.querySelectorAll('[data-testid=pending-attempt]')].some((b) => b.dataset.orderId === ${JSON.stringify(bId)})`), false, "A never sees B's order");
          await tab.navigate(`${ctx.base}/?r=${Date.now()}#/order-success/${rec.orderId}`);
          await successStatus(tab);
          assert.match(await tab.waitFor(`document.querySelector('[data-testid=tracking-code-value]')?.textContent || ''`, 15_000, "A's code back for A"), /^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/);
          await openCheckoutSignedIn(tab, ctx.base, emailA);
          await sleep(1_500);
          assert.equal(await tab.evaluate(BANNER('recovered')), false, 'told only once');
          assert.equal(await countOrdersByPhone('+962791000028'), 1, 'still one order for A');
          assert.equal(await stock(), 6);
        } finally {
          await tab.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' }); // sign-out for the next scenario
        }
      }],
      ['U29', 'SHARED DEVICE, guest -> signs in: the guest\'s UNRESOLVED attempt is not handed to the account (no payload, no resend, no new number while it may be in flight; nothing sent)', async (tab) => {
        try {
          await setUiMode('drop');
          await ctx.setUiAuthMode('resign');
          await ctx.resetAuth();
          const pw = 'Test-pass-12345';
          const email = 'u29.c@example.invalid';
          await ctx.createCustomer({ email, password: pw, name: 'زبون ج اختبار' });
          await openCheckout(tab, ctx.base);
          await fillToPayment(tab, '0791000029');
          await confirm(tab);
          assert.equal(await waitOutcome(tab), 'not_confirmed');
          const [rec] = await tab.evaluate(ATTEMPTS);
          assert.equal(rec.who, 'guest');
          await setUiMode('pass');
          await signIn(tab, ctx.base, email, pw); // same tab
          await openCheckoutSignedIn(tab, ctx.base, email);
          await tab.waitFor(BANNER('not_found_yet'), 20_000, 'the guest attempt stays unresolved');
          assert.equal(await tab.evaluate(`!!document.querySelector('[data-testid=pending-retry-same]')`), false, 'no resend of the guest order under the account');
          assert.equal(await tab.evaluate(`sessionStorage.getItem('anta_checkout_pending_payload')`), null, 'guest payload dropped');
          const body = await tab.evaluate(`document.body.innerText`);
          for (const p of ['791000029', 'شارع الاختبار']) assert.equal(body.includes(p), false, `shows the guest's ${p}`);
          // the account's own order while the guest attempt may still be in flight: refused, nothing sent
          await fillToPayment(tab, '0791000129', 'صاحب الحساب ج');
          const sent0 = await tab.evaluate(`window.__e2eNet.started`);
          await confirm(tab);
          assert.equal(await waitOutcome(tab), 'blocked_previous');
          assert.equal(await tab.evaluate(`window.__e2eNet.started`), sent0, 'nothing sent');
          assert.equal(await countOrdersByPhone('+962791000029'), 0);
          assert.equal(await countOrdersByPhone('+962791000129'), 0);
          assert.equal(await stock(), 10);
        } finally {
          await tab.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' }); // sign-out for the next scenario
        }
      }],
      ['U30', 'SHARED DEVICE, guest order saved but unanswered -> account C signs in: existence only for C; C signs out -> the GUEST is told (number), gets the code and the details back; no second order', async (tab) => {
        try {
          await setUiMode('savehold');
          await ctx.setUiAuthMode('resign');
          await ctx.resetAuth();
          const pw = 'Test-pass-12345';
          const email = 'u30.c@example.invalid';
          await ctx.createCustomer({ email, password: pw, name: 'زبون ج اختبار' });
          await openCheckout(tab, ctx.base);
          await fillToPayment(tab, '0791000030');
          await confirm(tab);
          await until(async () => (await countOrdersByPhone('+962791000030')) === 1, 20_000, 'guest order saved by the Worker');
          const [rec] = await tab.evaluate(ATTEMPTS);
          assert.equal(rec.who, 'guest');
          await setUiMode('pass');
          await signIn(tab, ctx.base, email, pw); // same tab
          await openCheckoutSignedIn(tab, ctx.base, email);
          await tab.waitFor(BANNER('exists_unverified'), 20_000, 'existence only for C');
          await tab.navigate(`${ctx.base}/?r=${Date.now()}#/order-success/${rec.orderId}`);
          await successStatus(tab);
          await sleep(1_500);
          assert.equal(await tab.evaluate(`document.querySelector('[data-testid=tracking-code-value]')?.textContent || ''`), '', 'no code for C');
          await tab.navigate(`${ctx.base}/?r=${Date.now()}#/tracking?orderId=${rec.orderId}`);
          await tab.waitFor(`!!document.querySelector('[data-testid=tracking-status-only]') && !document.querySelector('[data-testid=tracking-details]')`, 20_000, 'status only for C');
          // C signs out (Firebase session removed): the device is the guest's again
          await tab.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' });
          await tab.navigate(`${ctx.base}/?r=${Date.now()}#/checkout`);
          await tab.waitFor(`[...document.querySelectorAll('[data-testid=pending-attempt]')].some((b) => b.dataset.status === 'recovered' && b.dataset.orderId === ${JSON.stringify(rec.orderId)})`, 20_000, 'the guest is told: saved, with the number');
          await tab.navigate(`${ctx.base}/?r=${Date.now()}#/order-success/${rec.orderId}`);
          await successStatus(tab);
          assert.match(await tab.waitFor(`document.querySelector('[data-testid=tracking-code-value]')?.textContent || ''`, 15_000, "the guest's code"), /^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/);
          await tab.navigate(`${ctx.base}/?r=${Date.now()}#/tracking?orderId=${rec.orderId}`);
          await tab.waitFor(`!!document.querySelector('[data-testid=tracking-details]')`, 20_000, 'details for the guest on this device');
          assert.equal(await countOrdersByPhone('+962791000030'), 1, 'one order');
          assert.equal(await stock(), 8, 'stock once');
        } finally {
          await tab.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' });
        }
      }],
      ['U31', 'Firebase session restore HANGS: checkout does not freeze; "account could not be confirmed" + retry; no earlier order data restored, no code shown (never assumed to be a guest)', async (tab) => {
        // an order CONFIRMED on this device first (its code is shown normally)
        await setUiMode('pass');
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000131');
        await confirm(tab);
        assert.equal(await waitOutcome(tab), 'success');
        const okId = await tab.evaluate(`location.hash.split('/').pop()`);
        await tab.waitFor(`document.querySelector('[data-testid=tracking-code-value]')?.textContent || ''`, 15_000, 'code shown normally');
        // then an unanswered one
        await setUiMode('savehold');
        await openCheckout(tab, ctx.base);
        await fillToPayment(tab, '0791000031');
        await confirm(tab);
        await until(async () => (await countOrdersByPhone('+962791000031')) === 1, 20_000, 'saved by the Worker');
        const [rec] = await tab.evaluate(ATTEMPTS);
        await setUiMode('pass');
        await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: "(() => { const open = IDBFactory.prototype.open; IDBFactory.prototype.open = function (name, ...rest) { if (String(name) === 'firebaseLocalStorageDb') { return { readyState: 'pending', result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, addEventListener() {}, removeEventListener() {} }; } return open.call(this, name, ...rest); }; })();" });
        const t0 = Date.now();
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/checkout`);
        await tab.waitFor(`!!document.querySelector('[data-testid=identity-unknown]')`, 20_000, 'identity unknown shown');
        assert.ok(Date.now() - t0 < 15_000, 'decided within the timeout, not stuck');
        assert.equal(await tab.evaluate(`!!document.querySelector('[data-testid=identity-retry]')`), true, 'retry offered');
        assert.equal(await tab.evaluate(BANNER('recovered')), false, 'nothing recovered/shown as confirmed');
        assert.equal(await tab.evaluate(`[...document.querySelectorAll('[data-testid=pending-attempt]')].map((b) => b.dataset.status).join()`), 'unknown');
        assert.equal(await tab.evaluate(`!!document.querySelector('[data-testid=pending-retry-same]')`), false, 'no payload restored');
        assert.equal(await tab.evaluate(`!!document.querySelector('input[placeholder="0791234567"]')`), true, 'checkout usable');
        assert.equal((await tab.evaluate(ATTEMPTS)).find((a) => a.orderId === rec.orderId).state === 'confirmed', false, 'the record is not touched');
        assert.equal(await tab.evaluate(`(localStorage.getItem('anta_tracking_keys') || '').includes(${JSON.stringify(rec.orderId)})`), false, 'no key stored');
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/order-success/${rec.orderId}`);
        // not confirmed on this device (nothing was recovered while the identity is unknown) -> the "registered" view
        const st = await successStatus(tab);
        assert.notEqual(st, 'success', 'not shown as confirmed here while the identity is unknown');
        await sleep(6_000); // longer than the identity timeout: the code lookup has finished
        assert.equal(await tab.evaluate(`!!document.querySelector('[data-testid=tracking-code-value]')`), false, 'no code while the identity is unknown');
        // the order confirmed on this device: while the identity is unknown its code is NOT shown, a retry is offered
        await tab.navigate(`${ctx.base}/?r=${Date.now()}#/order-success/${okId}`);
        assert.equal(await successStatus(tab), 'success');
        await tab.waitFor(`!!document.querySelector('[data-testid=tracking-code-identity-unknown]')`, 20_000, 'identity unknown on the success page');
        assert.equal(await tab.evaluate(`!!document.querySelector('[data-testid=tracking-code-value]')`), false, 'no code');
        assert.equal(await countOrdersByPhone('+962791000031'), 1);
        assert.equal(await countOrdersByPhone('+962791000131'), 1);
        assert.equal(await stock(), 6);
      }],
      ['U32', 'SIGNED-IN customer, session restore FAILS (hangs) and they confirm: NOT sent as a guest — "account could not be confirmed", nothing sent, no number, cart + details kept, retry offered', async (tab) => {
        try {
          await setUiMode('pass');
          await ctx.setUiAuthMode('resign');
          await ctx.resetAuth();
          const pw = 'Test-pass-12345';
          const email = 'u32.a@example.invalid';
          await ctx.createCustomer({ email, password: pw, name: 'زبون جلسة معلقة' });
          await signIn(tab, ctx.base, email, pw); // a saved session exists in this browser
          await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: "(() => { const open = IDBFactory.prototype.open; IDBFactory.prototype.open = function (name, ...rest) { if (String(name) === 'firebaseLocalStorageDb') { return { readyState: 'pending', result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, addEventListener() {}, removeEventListener() {} }; } return open.call(this, name, ...rest); }; })();" });
          await openCheckout(tab, ctx.base);
          await fillToPayment(tab, '0791000032');
          await confirm(tab);
          assert.equal(await waitOutcome(tab), 'identity_unknown');
          assert.equal(await tab.evaluate(`JSON.parse(sessionStorage.getItem('__e2e_creates') || '[]').length`), 0, 'no create request left the browser');
          assert.deepEqual(await tab.evaluate(ATTEMPTS), [], 'no attempt, no number');
          assert.equal(await tab.evaluate(CART_LEN), 1, 'cart kept');
          assert.equal(await tab.evaluate(`!!document.querySelector('[data-testid=identity-submit-retry]')`), true, 'retry offered');
          assert.match(await tab.evaluate(`document.querySelector('[data-testid=submit-result]').innerText`), /لم نُرسل الطلب/);
          // back to step 1 with the page's own buttons: the typed details are still there
          await tab.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('الرجوع لخيارات التوصيل')).click(); true`);
          await tab.waitFor(`document.body.innerText.includes('توصيل عادي')`, 10_000, 'step 2');
          // the step-2 "back" button (text from the shared translations: 'عودة')
          await tab.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'عودة').click(); true`);
          await tab.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 10_000, 'step 1');
          assert.equal(await tab.evaluate(`document.querySelector('input[placeholder="0791234567"]').value`), '0791000032', 'details kept');
          assert.equal(await tab.evaluate(`document.querySelector('input[placeholder^="اسم الشارع"]').value`), 'شارع الاختبار 1', 'address kept');
          assert.equal(await countOrdersByPhone('+962791000032'), 0);
          assert.equal(await stock(), 10);
        } finally {
          await tab.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' });
        }
      }],
      ['U33', 'SIGNED-IN customer, session restore only SLOW (1.5 s per open, within the 5 s check) and they confirm at once: the order waits for the account and is saved UNDER it (verified token), not as a guest', async (tab) => {
        try {
          await setUiMode('pass');
          await ctx.setUiAuthMode('resign');
          await ctx.resetAuth();
          const pw = 'Test-pass-12345';
          const email = 'u33.a@example.invalid';
          const uid = await ctx.createCustomer({ email, password: pw, name: 'زبون جلسة بطيئة' });
          await signIn(tab, ctx.base, email, pw);
          await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: "(() => { const open = IDBFactory.prototype.open; IDBFactory.prototype.open = function (name, ...rest) {\n  if (String(name) !== 'firebaseLocalStorageDb') return open.call(this, name, ...rest);\n  const self = this; const fake = new EventTarget(); let real = null;\n  for (const k of ['result', 'error', 'transaction', 'source']) Object.defineProperty(fake, k, { get: () => (real ? real[k] : (k === 'error' ? null : undefined)) });\n  Object.defineProperty(fake, 'readyState', { get: () => (real ? real.readyState : 'pending') });\n  for (const k of ['onsuccess', 'onerror', 'onupgradeneeded', 'onblocked']) fake[k] = null;\n  setTimeout(() => {\n    real = open.call(self, name, ...rest);\n    for (const type of ['success', 'error', 'upgradeneeded', 'blocked']) real.addEventListener(type, () => { const ev = new Event(type); fake.dispatchEvent(ev); const h = fake['on' + type]; if (h) h.call(fake, ev); });\n  }, 1500);\n  return fake;\n}; })();" });
          await openCheckout(tab, ctx.base);
          await fillToPayment(tab, '0791000033');
          await confirm(tab); // before the session is back
          assert.equal(await waitOutcome(tab), 'success');
          const orderId = await tab.evaluate(`location.hash.split('/').pop()`);
          const order = await get(`orders/${orderId}`);
          assert.equal(order.userId, uid, 'under the account, not guest');
          assert.equal((await ctx.ledger(orderId)).ownerUid, uid);
          assert.equal((await ctx.ledger(orderId)).userIdSource, 'firebase-id-token');
          assert.equal(await countOrdersByPhone('+962791000033'), 1);
          assert.equal(await stock(), 8);
        } finally {
          await tab.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' });
        }
      }],
      ['U35', 'SIGNED-IN customer, session restore SLOWER than the 5 s check: first confirm -> not sent (account unknown); once the session is back, Retry -> saved UNDER the account, one order', async (tab) => {
        try {
          await setUiMode('pass');
          await ctx.setUiAuthMode('resign');
          await ctx.resetAuth();
          const pw = 'Test-pass-12345';
          const email = 'u35.a@example.invalid';
          const uid = await ctx.createCustomer({ email, password: pw, name: 'زبون جلسة بطيئة' });
          await signIn(tab, ctx.base, email, pw);
          await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: "(() => { const open = IDBFactory.prototype.open; IDBFactory.prototype.open = function (name, ...rest) {\n  if (String(name) !== 'firebaseLocalStorageDb') return open.call(this, name, ...rest);\n  const self = this; const fake = new EventTarget(); let real = null;\n  for (const k of ['result', 'error', 'transaction', 'source']) Object.defineProperty(fake, k, { get: () => (real ? real[k] : (k === 'error' ? null : undefined)) });\n  Object.defineProperty(fake, 'readyState', { get: () => (real ? real.readyState : 'pending') });\n  for (const k of ['onsuccess', 'onerror', 'onupgradeneeded', 'onblocked']) fake[k] = null;\n  setTimeout(() => {\n    real = open.call(self, name, ...rest);\n    for (const type of ['success', 'error', 'upgradeneeded', 'blocked']) real.addEventListener(type, () => { const ev = new Event(type); fake.dispatchEvent(ev); const h = fake['on' + type]; if (h) h.call(fake, ev); });\n  }, 8000);\n  return fake;\n}; })();" });
          await openCheckout(tab, ctx.base);
          await fillToPayment(tab, '0791000035');
          await confirm(tab); // before the session is back
          assert.equal(await waitOutcome(tab), 'identity_unknown');
          assert.equal(await tab.evaluate(`JSON.parse(sessionStorage.getItem('__e2e_creates') || '[]').length`), 0, 'nothing sent while unknown');
          assert.deepEqual(await tab.evaluate(ATTEMPTS), [], 'no number while unknown');
          await sleep(9_000); // the session is restored now
          await tab.evaluate(`document.querySelector('[data-testid=identity-submit-retry]').click(); true`);
          await tab.waitFor(`location.hash.startsWith('#/order-success/')`, 40_000, 'retry succeeded');
          const orderId = await tab.evaluate(`location.hash.split('/').pop()`);
          const order = await get(`orders/${orderId}`);
          assert.equal(order.userId, uid, 'under the account, not guest');
          assert.equal((await ctx.ledger(orderId)).ownerUid, uid);
          assert.equal((await ctx.ledger(orderId)).userIdSource, 'firebase-id-token');
          assert.equal(await countOrdersByPhone('+962791000035'), 1);
          assert.equal(await stock(), 8);
        } finally {
          await tab.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' });
        }
      }],
      ['U34', 'ACCOUNT SWITCHED (in another tab) while checkout is open: confirm -> "account changed", nothing sent; confirm again -> saved under the CURRENT account only; one order, stock once', async (tab) => {
        const t2 = await ctx.openTab();
        try {
          await setUiMode('pass');
          await ctx.setUiAuthMode('resign');
          await ctx.resetAuth();
          const pw = 'Test-pass-12345';
          const emailA = 'u34.a@example.invalid';
          const emailB = 'u34.b@example.invalid';
          const uidA = await ctx.createCustomer({ email: emailA, password: pw, name: 'زبون أ تبديل' });
          const uidB = await ctx.createCustomer({ email: emailB, password: pw, name: 'زبون ب تبديل' });
          await signIn(tab, ctx.base, emailA, pw);
          await openCheckoutSignedIn(tab, ctx.base, emailA);
          await fillToPayment(tab, '0791000034');
          await signIn(t2, ctx.base, emailB, pw, { keepSession: true }); // B signs in over A's session (shared by the tabs)
          await sleep(4_000); // the open checkout tab picks up the new session
          await confirm(tab);
          const first = await waitOutcome(tab);
          if (first !== 'account_changed') {
            const sent = await tab.evaluate(`JSON.parse(sessionStorage.getItem('__e2e_creates') || '[]').map((c) => c.id)`);
            const owners = [];
            for (const id of sent) owners.push((await ctx.ledger(id))?.ownerUid === uidA ? 'A' : (await ctx.ledger(id))?.ownerUid === uidB ? 'B' : 'other');
            assert.fail(`first confirm: outcome=${first}, sent orders owned by ${owners.join(',') || 'none'}`);
          }
          assert.equal(await tab.evaluate(`JSON.parse(sessionStorage.getItem('__e2e_creates') || '[]').length`), 0, 'nothing sent');
          assert.deepEqual(await tab.evaluate(ATTEMPTS), [], 'no attempt');
          assert.equal(await tab.evaluate(CART_LEN), 1, 'cart kept');
          await confirm(tab); // reviewed, confirmed again: B's order
          // wait for THIS submission's result (the panel still shows the previous "account changed" until it ends)
          await tab.waitFor(`location.hash.startsWith('#/order-success/') || (${SUBMIT_SETTLED} && JSON.parse(sessionStorage.getItem('__e2e_creates') || '[]').length > 0)`, 40_000, 'second submission finished');
          assert.equal(await tab.evaluate(OUTCOME), 'success');
          const orderId = await tab.evaluate(`location.hash.split('/').pop()`);
          assert.equal((await get(`orders/${orderId}`)).userId, uidB);
          assert.equal((await ctx.ledger(orderId)).ownerUid, uidB);
          assert.notEqual(uidA, uidB);
          assert.equal(await countOrdersByPhone('+962791000034'), 1, 'one order');
          assert.equal(await stock(), 8, 'stock once');
        } finally {
          await t2.close();
          await tab.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' });
        }
      }],
    ],
  };
}

/**
 * Scenario isolation: before the tab is closed and the emulator is reseeded for the next scenario, every Worker call
 * of this scenario must be finished, checked explicitly (no fixed sleeps):
 *  1. browser: no Worker request in flight in the tab;
 *  2. emulator: every create-order the tab sent has settled —
 *     - answered 2xx            -> the order exists and its background notifications are done (notifyPending false);
 *     - answered with an error  -> the Worker/proxy already finished it;
 *     - network error (TypeError, e.g. the test proxy dropped the socket) -> it never reached the Worker;
 *     - aborted by the app (AbortError) or cut by a page navigation -> its fate is unknown, so it must appear on
 *       the emulator and finish its notifications; until then the next scenario does not start.
 * Throws when this cannot be confirmed; the runner then stops the suite (no contaminated scenario runs).
 */
async function settleScenario(ctx, tab, timeoutMs = 60_000) {
  await tab.waitFor(NET_IDLE, timeoutMs, 'Worker requests still in flight in the tab');
  const creates = (await tab.evaluate(`JSON.parse(sessionStorage.getItem('__e2e_creates') || '[]')`)) || [];
  const end = Date.now() + timeoutMs;
  const ids = new Set();
  for (const c of creates) {
    if (!c.id) continue;
    const ok2xx = /^status:2\d\d$/.test(c.state);
    const unknown = c.state === 'sent' || c.state === 'error:AbortError';
    if (ok2xx || unknown) ids.add(c.id);
  }
  for (const id of ids) {
    for (;;) {
      const order = await ctx.get(`orders/${id}`);
      const ledger = order ? await ctx.get(`orderLedger/${id}`) : null;
      if (order && ledger && ledger.notifyPending !== true) break;
      if (Date.now() > end) throw new Error(`isolation: order ${id} not settled on the emulator (order=${!!order}, notifyPending=${ledger?.notifyPending})`);
      await sleep(100);
    }
  }
  return { creates: creates.length, checked: ids.size };
}

let isolationHalted = false; // set once isolation could not be confirmed: later phases do not run either

export async function runUiScenarios(ctx, phase, list) {
  const results = [];
  for (const [id, name, fn] of list) {
    if (ctx.only && !ctx.only.has(id)) continue;
    if (isolationHalted) {
      results.push({ id, name, ok: false, ms: 0, error: 'not run: an earlier scenario left unfinished work (isolation)' });
      continue;
    }
    await ctx.reseed();
    const tab = await ctx.openTab();
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: TRACKER });
    await tab.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'local_storage' });
    const t0 = Date.now();
    let isolationBroken = null;
    try {
      await fn(tab);
      results.push({ id, name, ok: true, ms: Date.now() - t0 });
      console.log(`✔ ${id} [${phase}] ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      // what the page actually showed (route + first visible text), for diagnosis — no personal data is seeded
      let snap = '';
      try {
        snap = await tab.evaluate(`location.hash + ' | ' + document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300)`);
      } catch {}
      results.push({ id, name, ok: false, ms: Date.now() - t0, error: `${String(e?.message || e).slice(0, 500)} || page: ${snap}` });
      console.log(`✖ ${id} [${phase}] ${name}\n    ${String(e?.message || e).split('\n')[0]}\n    page: ${snap}`);
    } finally {
      try {
        const s = await settleScenario(ctx, tab);
        console.log(`    isolation ${id}: requests drained; ${s.creates} create(s) sent, ${s.checked} confirmed settled on the emulator`);
      } catch (e) {
        isolationBroken = String(e?.message || e);
      }
      await tab.close();
    }
    if (isolationBroken) {
      results.push({ id: `${id}-isolation`, name: 'scenario isolation before the next reseed', ok: false, ms: 0, error: isolationBroken });
      console.log(`✖ ${id} isolation: ${isolationBroken}\n    remaining scenarios NOT run (they would share unfinished work)`);
      isolationHalted = true;
    }
  }
  return results;
}
