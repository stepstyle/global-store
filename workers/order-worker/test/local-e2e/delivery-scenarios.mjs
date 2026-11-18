// E2E_SUITE=delivery — STOCK_POLICY=on_delivery end-to-end, LOCAL ONLY (127.0.0.1): the real order Worker under
// `wrangler dev --local` (workerd), the notification sink, the Firestore + Auth EMULATORS (demo project, the
// transition rules firestore.rules.on-delivery), and the REAL web app (Vite, emulator mode) in headless Chrome.
//   DA*  — the Worker's HTTP API in the real runtime (concurrency, auth, refusals, the rollback sync via the real cron)
//   DU*  — the browser: checkout (guest), the admin dashboard (sign-in, status buttons, return, refusals, delete guard),
//          the product editor (stale stock) and the CSV import
// Synthetic products / accounts only. The admin account uses the dashboard's own configured admin e-mail, but only
// inside the local Auth emulator (read from the source file, never written anywhere else).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkoutOrder, line, makeOrderId, PRODUCTS } from '../fixtures.mjs';
import { encodeFields } from '../../src/firestore.js';

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
const TOASTS = `[...document.querySelectorAll('[data-testid=toast-message]')].map((t) => t.innerText).join('\\n---\\n')`;
/** test stub: every window.confirm() answers `answer` and is recorded (text) */
const STUB_CONFIRM = (answer = true) => `(() => { window.__confirms = []; window.confirm = (m) => { window.__confirms.push(String(m)); return ${answer}; }; return true; })()`;
const SIZES = { name: 'قميص', price: 4, stock: 0, variants: [{ id: 'size_s', label: 'S', type: 'size', price: 4, stock: 3 }, { id: 'size_m', label: 'M', type: 'size', price: 4, stock: 1 }] };

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

export function buildDeliveryScenarios(ctx) {
  const { W, get } = ctx;
  const stock = async (pid, vid) => {
    const p = await get(`products/${pid}`);
    return vid ? (p?.variants || []).find((v) => v.id === vid)?.stock : p?.stock;
  };
  const reserved = async (pid, vid = null) => {
    const r = await get(`stockReservations/${pid}`);
    return r ? (vid ? r.variants?.[vid] : r.product) || 0 : 0;
  };
  const create = (order) => fetch(`${W}/create-order`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order, turnstileToken: ctx.turnstileToken }) });
  const newOrder = async (items) => {
    const o = checkoutOrder({ id: makeOrderId(), items });
    const r = await create(o);
    assert.equal(r.status, 200, `create: ${r.status} ${await r.text()}`);
    return o;
  };
  const adminStatus = async (id, status, { uid = ctx.ownerUid, confirmReturn, token } = {}) => {
    const headers = { 'content-type': 'application/json' };
    const t = token === undefined ? await ctx.idToken(uid) : token;
    if (t) headers.authorization = `Bearer ${t}`;
    const r = await fetch(`${W}/admin/orders/${encodeURIComponent(id)}/status`, { method: 'POST', headers, body: JSON.stringify({ status, ...(confirmReturn ? { confirmReturn: true } : {}) }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const telegramOf = async (id) => until(async () => (await ctx.sinkCalls()).find((c) => c.channel === 'telegram' && c.method === 'sendMessage' && c.orderId === id && c.ok), 30_000, `telegram message for ${id}`);

  // ------------------------------------------------------------------ browser helpers
  const seedCartAndOpen = async (tab, cart) => {
    // a GUEST checkout: tabs share one browser profile, so drop any Firebase session an admin scenario left behind
    await tab.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' });
    await tab.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `if (location.search.includes('seedcart=1')) { localStorage.setItem('anta_cart', ${JSON.stringify(JSON.stringify(cart))}); localStorage.setItem('language', 'ar'); }`,
    });
    await tab.navigate(`${ctx.base}/?seedcart=1&r=${Date.now()}#/checkout`);
    await tab.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 40_000, 'checkout form');
  };
  const fillAndConfirm = async (tab, phoneLocal) => {
    await tab.evaluate(`(() => { ${SET_VAL}
      setVal(document.querySelector('input[placeholder^="name@example.com"]'), 'buyer@example.com');
      setVal(document.querySelector('input[placeholder="الاسم الأول والأخير"]'), 'زبون اختبار التسليم');
      setVal(document.querySelector('input[placeholder="0791234567"]'), ${JSON.stringify(phoneLocal)});
      setVal([...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'zarqa')), 'zarqa');
      return true; })()`);
    await sleep(150);
    await tab.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('input[placeholder^="اسم الشارع"]'), 'شارع الاختبار 1'); return true; })()`);
    await tab.evaluate(`${STICKY}.click(); true`);
    await tab.waitFor(`document.body.innerText.includes('توصيل عادي')`, 10_000, 'step 2');
    await tab.evaluate(`${STICKY}.click(); true`);
    await tab.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('CliQ'))`, 10_000, 'step 3');
    await tab.evaluate(`${STICKY}.click(); true`);
    return tab.waitFor(OUTCOME, 40_000, 'order outcome');
  };
  const CART_SIMPLE = [{ id: 'p-simple', name: 'دفتر', price: 2.5, stock: 10, category: 'Stationery', image: '', quantity: 2 }];
  const CART_LAST = [{ id: 'p-last-one', name: 'آخر قطعة', price: 5, stock: 1, category: 'Stationery', image: '', quantity: 1 }];

  /** sign in as the admin through the app's Login page, then open the dashboard IN-APP (no reload: keeps the session state) */
  const openDashboard = async (tab) => {
    await tab.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' });
    await tab.navigate(`${ctx.base}/?r=${Date.now()}#/login`);
    await tab.waitFor(`(() => { const f = document.querySelector('input[type=password]')?.form; return !!f && !!f.querySelector('input[type=email]') && !f.querySelector('button[type=submit]')?.disabled; })()`, 30_000, 'login form');
    await tab.evaluate(`(() => { ${SET_VAL}
      setVal(document.querySelector('input[type=password]')?.form.querySelector('input[type=email]'), ${JSON.stringify(ctx.admin.email)});
      setVal(document.querySelector('input[type=password]'), ${JSON.stringify(ctx.admin.password)});
      return true; })()`);
    await sleep(150);
    await tab.evaluate(`document.querySelector('input[type=password]')?.form.requestSubmit(); true`);
    // the app sends an admin straight to the dashboard (#/admin); other accounts land on #/
    await tab.waitFor(`location.hash === '#/' || location.hash === '' || location.hash === '#/admin'`, 30_000, 'redirect after sign-in');
    await tab.evaluate(`if (location.hash !== '#/admin') location.hash = '#/admin'; true`);
    await tab.waitFor(`document.body.innerText.includes('إدارة الطلبات')`, 30_000, 'dashboard');
  };
  const tab = (i) => `[...document.querySelectorAll('h1 + div button')][${i}]`;
  const openOrders = async (t) => {
    await t.evaluate(`${tab(2)}.click(); true`);
    await t.waitFor(`!!document.querySelector('tbody tr')`, 20_000, 'orders table');
  };
  const openOrderDetails = async (t, orderId) => {
    await openOrders(t);
    await t.waitFor(`[...document.querySelectorAll('tbody tr')].some((r) => r.innerText.includes(${JSON.stringify(orderId)}))`, 30_000, `order ${orderId} listed`);
    await t.evaluate(`[...[...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(${JSON.stringify(orderId)})).querySelectorAll('button')].find((b) => b.textContent.trim() === 'تفاصيل').click(); true`);
    await t.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('حذف نهائي'))`, 15_000, 'order details');
  };
  const clickButton = async (t, text, { answer = true } = {}) => {
    await t.evaluate(STUB_CONFIRM(answer));
    const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);
    assert.ok(ok, `button "${text}" present and enabled`);
  };
  const statusIs = (id, s) => until(async () => (await get(`orders/${id}`))?.status === s, 20_000, `order ${id} -> ${s}`);
  const toastIncludes = (t, text) => t.waitFor(`(${TOASTS}).includes(${JSON.stringify(text)})`, 20_000, `toast "${text}"`);

  return [
    // ================================================================ Worker API, real runtime
    ['DA01', 'creation: accepted (new), stock untouched, reserved; Telegram message has NO buttons and says "accepted automatically"; webhook route absent', async () => {
      const o = await newOrder([line('p-simple', 3)]);
      assert.equal((await get(`orders/${o.id}`)).status, 'new');
      assert.deepEqual((await get(`orders/${o.id}`)).inventory, { policy: 'on_delivery', state: 'reserved' });
      assert.equal(await stock('p-simple'), 10);
      assert.equal(await reserved('p-simple'), 3);
      const m = await telegramOf(o.id);
      assert.deepEqual(m.buttons, [], 'no buttons');
      assert.equal(m.decision, 'auto');
      const wh = await fetch(`${W}/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'x'.repeat(40) }, body: '{"update_id":1}' });
      assert.equal(wh.status, 404);
    }],
    ['DA02', 'the last piece ordered twice AT THE SAME TIME (real runtime): one 200, one 422 OUT_OF_STOCK; stock never moves', async () => {
      const a = checkoutOrder({ id: makeOrderId(), items: [line('p-last-one', 1)] });
      const b = checkoutOrder({ id: makeOrderId(), items: [line('p-last-one', 1)], overrides: { address: { fullName: 'آخر', city: 'عمّان (العاصمة) - النزهة', street: 'شارع 2', phone: '+962791111112' } } });
      const rs = await Promise.all([create(a), create(b)]);
      assert.deepEqual(rs.map((r) => r.status).sort(), [200, 422]);
      assert.equal(await stock('p-last-one'), 1);
      assert.equal(await reserved('p-last-one'), 1);
    }],
    ['DA03', 'delivered pressed 3x concurrently: deducted ONCE; return needs confirmReturn, restocked once', async () => {
      const o = await newOrder([line('p-simple', 2), line('p-variants', 1, { variantId: 'var_red' })]);
      const rs = await Promise.all([adminStatus(o.id, 'delivered'), adminStatus(o.id, 'delivered'), adminStatus(o.id, 'delivered')]);
      assert.ok(rs.every((r) => r.status === 200), JSON.stringify(rs));
      assert.equal(await stock('p-simple'), 8);
      assert.equal(await stock('p-variants', 'var_red'), 4);
      assert.equal((await adminStatus(o.id, 'cancelled')).body.code, 'RETURN_CONFIRMATION_REQUIRED');
      await Promise.all([adminStatus(o.id, 'cancelled', { confirmReturn: true }), adminStatus(o.id, 'cancelled', { confirmReturn: true })]);
      assert.equal(await stock('p-simple'), 10);
      assert.equal(await stock('p-variants', 'var_red'), 5);
    }],
    ['DA04', 'refusals in the real runtime: colour removed (ITEMS_MISSING), size without a valid stock number (STOCK_UNTRACKED), stock below the quantity (INSUFFICIENT_STOCK) — nothing written', async () => {
      await ctx.put('products/p-sizes', SIZES);
      const o = await newOrder([line('p-variants', 1, { variantId: 'var_red' }), { productId: 'p-sizes', name: 'قميص', price: 4, quantity: 1, image: '', selectedVariant: { ...SIZES.variants[1] } }]);
      await ctx.put('products/p-variants', { ...PRODUCTS['p-variants'], variants: PRODUCTS['p-variants'].variants.filter((v) => v.id !== 'var_red') });
      assert.equal((await adminStatus(o.id, 'delivered')).body.code, 'ITEMS_MISSING');
      await ctx.put('products/p-variants', PRODUCTS['p-variants']);
      await ctx.put('products/p-sizes', { ...SIZES, variants: [SIZES.variants[0], { ...SIZES.variants[1], stock: 'غير معروف' }] });
      assert.equal((await adminStatus(o.id, 'delivered')).body.code, 'STOCK_UNTRACKED');
      await ctx.put('products/p-sizes', { ...SIZES, variants: [SIZES.variants[0], { ...SIZES.variants[1], stock: 0 }] });
      assert.equal((await adminStatus(o.id, 'delivered')).body.code, 'INSUFFICIENT_STOCK');
      assert.equal((await get(`orders/${o.id}`)).status, 'new');
      assert.equal(await stock('p-variants', 'var_red'), 5);
      await ctx.put('products/p-sizes', SIZES);
      assert.equal((await adminStatus(o.id, 'delivered')).status, 200);
      assert.equal(await stock('p-sizes', 'size_m'), 0);
      assert.equal(await stock('p-variants', 'var_red'), 4);
    }],
    ['DA05', 'admin route identity: no token 401, a customer 403, a forged token 401; nothing changes', async () => {
      const o = await newOrder([line('p-simple', 1)]);
      assert.equal((await adminStatus(o.id, 'delivered', { token: null })).status, 401);
      assert.equal((await adminStatus(o.id, 'delivered', { uid: 'customer-uid-x' })).status, 403);
      assert.equal((await adminStatus(o.id, 'delivered', { token: await ctx.forgedToken(ctx.ownerUid) })).status, 401);
      assert.equal((await get(`orders/${o.id}`)).status, 'new');
      assert.equal(await stock('p-simple'), 10);
    }],
    ['DA06', 'ROLLBACK sync through the REAL cron (SYNC_DIRECT_STATUS=true): statuses written directly by the old dashboard get their stock effect exactly once', async () => {
      const d = await newOrder([line('p-simple', 2)]);
      const c = await newOrder([line('p-hundred', 5)]);
      await ctx.directStatus(d.id, 'delivered');
      await ctx.directStatus(c.id, 'cancelled');
      for (let i = 0; i < 3; i++) await ctx.triggerCron();
      await until(async () => (await get(`orderLedger/${d.id}`))?.inventory === 'deducted' && (await get(`orderLedger/${c.id}`))?.inventory === 'released', 60_000, 'sync applied');
      await ctx.triggerCron();
      await sleep(1500);
      assert.equal(await stock('p-simple'), 8, 'deducted once');
      assert.equal(await stock('p-hundred'), 100);
      assert.equal(await reserved('p-simple'), 0);
      assert.equal(await reserved('p-hundred'), 0);
    }],

    // ================================================================ real browser
    ['DU01', 'BROWSER checkout (guest): success page; the order is accepted (new), nothing deducted, quantity reserved; Telegram without buttons', async (t) => {
      await seedCartAndOpen(t, CART_SIMPLE);
      assert.equal(await fillAndConfirm(t, '0792000001'), 'success');
      const id = await t.evaluate(`location.hash.split('/').pop()`);
      assert.equal((await get(`orders/${id}`)).status, 'new');
      assert.equal(await stock('p-simple'), 10);
      assert.equal(await reserved('p-simple'), 2);
      assert.equal(await t.evaluate(CART_LEN), 0);
      assert.deepEqual((await telegramOf(id)).buttons, []);
    }],
    ['DU02', 'BROWSER dashboard: accept -> ship -> delivered with the real buttons (Worker path), stock deducted ONCE; then the return with explicit confirmation restocks once', async (t) => {
      const o = await newOrder([line('p-simple', 3)]);
      await openDashboard(t);
      await openOrderDetails(t, o.id);
      await clickButton(t, 'قبول الطلب');
      await statusIs(o.id, 'processing');
      await clickButton(t, 'قيد الشحن');
      await statusIs(o.id, 'shipped');
      assert.equal(await stock('p-simple'), 10, 'nothing deducted before delivery');
      await clickButton(t, 'تم التسليم');
      await statusIs(o.id, 'delivered');
      assert.match((await t.evaluate(`window.__confirms.join('|')`)), /سيُخصم المخزون الآن/);
      assert.equal(await stock('p-simple'), 7);
      assert.equal(await reserved('p-simple'), 0);
      await t.waitFor(`document.querySelector('[data-testid=order-inventory-state]')?.innerText.includes('خُصمت')`, 15_000, 'inventory label');
      // a "no" on the return question changes nothing
      await clickButton(t, 'إلغاء الطلب (إرجاع المنتجات)', { answer: false });
      await sleep(1500);
      assert.equal((await get(`orders/${o.id}`)).status, 'delivered');
      await clickButton(t, 'إلغاء الطلب (إرجاع المنتجات)');
      await statusIs(o.id, 'cancelled');
      assert.match((await t.evaluate(`window.__confirms.join('|')`)), /هل استُرجعت المنتجات فعليًا/);
      assert.equal(await stock('p-simple'), 10, 'returned once');
      assert.equal((await get(`orderLedger/${o.id}`)).inventory, 'restocked');
    }],
    ['DU03', 'BROWSER dashboard refusal: a size without a valid stock number -> clear Arabic message, status and stock unchanged', async (t) => {
      await ctx.put('products/p-sizes', SIZES);
      const o = await newOrder([{ productId: 'p-sizes', name: 'قميص M', price: 4, quantity: 1, image: '', selectedVariant: { ...SIZES.variants[1] } }]);
      await adminStatus(o.id, 'shipped');
      await ctx.put('products/p-sizes', { ...SIZES, variants: [SIZES.variants[0], (({ stock: _s, ...rest }) => rest)(SIZES.variants[1])] });
      await openDashboard(t);
      await openOrderDetails(t, o.id);
      await clickButton(t, 'تم التسليم');
      await toastIncludes(t, 'ليس له رقم مخزون صالح');
      await toastIncludes(t, 'قميص M: لا يوجد رقم مخزون صالح');
      assert.equal((await get(`orders/${o.id}`)).status, 'shipped');
      assert.equal(await reserved('p-sizes', 'size_m'), 1);
    }],
    ['DU04', 'BROWSER checkout of the LAST piece already reserved by another order: "out of stock" message, no order created, cart kept', async (t) => {
      await newOrder([line('p-last-one', 1)]);
      await seedCartAndOpen(t, CART_LAST);
      const outcome = await fillAndConfirm(t, '0792000004');
      assert.equal(outcome, 'rejected');
      await t.waitFor(`document.body.innerText.includes('نفدت الكمية المتاحة')`, 10_000, 'out-of-stock message');
      assert.equal(await t.evaluate(CART_LEN), 1, 'cart kept');
      assert.equal(await ctx.countOrdersByPhone('+962792000004'), 0);
      assert.equal(await stock('p-last-one'), 1);
    }],
    ['DU05', 'BROWSER dashboard: deleting a still-reserved order is refused with a clear message (cancel first)', async (t) => {
      const o = await newOrder([line('p-simple', 1)]);
      await openDashboard(t);
      await openOrderDetails(t, o.id);
      await t.evaluate(STUB_CONFIRM(true));
      await t.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('حذف نهائي')).click(); true`);
      await toastIncludes(t, 'ما زالت كميته محجوزة');
      assert.ok(await get(`orders/${o.id}`), 'order still there');
      assert.equal(await reserved('p-simple'), 1);
    }],
    ['DU06', 'BROWSER product editor opened BEFORE a delivery and saved AFTER it (name only): the deduction is NOT undone', async (t) => {
      // like every real product, it has an image (the editor requires one before saving)
      await ctx.put('products/p-simple', { ...PRODUCTS['p-simple'], image: 'https://example.invalid/notebook.jpg', images: ['https://example.invalid/notebook.jpg'] });
      const o = await newOrder([line('p-simple', 3)]);
      await openDashboard(t);
      await t.evaluate(`${tab(1)}.click(); true`);
      await t.waitFor(`[...document.querySelectorAll('tbody tr')].some((r) => [...r.querySelectorAll('span.font-bold')].some((s) => s.textContent.trim() === 'دفتر'))`, 20_000, 'product row');
      await t.evaluate(`[...document.querySelectorAll('tbody tr')].find((r) => [...r.querySelectorAll('span.font-bold')].some((s) => s.textContent.trim() === 'دفتر')).querySelector('button[title="Edit Product & Inventory"]').click(); true`);
      await t.waitFor(`document.querySelector('input[name=name]')?.value === 'دفتر' && document.querySelector('input[name=stock]')?.value === '10'`, 20_000, 'editor opened with stock 10');
      assert.equal((await adminStatus(o.id, 'delivered')).status, 200); // delivered while the editor is open
      assert.equal(await stock('p-simple'), 7);
      await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('input[name=name]'), 'دفتر معدّل'); return true; })()`);
      await sleep(200);
      await t.evaluate(`document.querySelector('input[name=name]').form.requestSubmit(); true`);
      let seen = '';
      await until(async () => {
        seen = (await t.evaluate(TOASTS).catch(() => '')) || seen;
        return (await get('products/p-simple'))?.name === 'دفتر معدّل';
      }, 20_000, `product saved (toasts seen: ${seen})`).catch((e) => { throw new Error(`${e.message} | toasts seen: ${seen}`); });
      assert.equal(await stock('p-simple'), 7, 'stock kept at 7 (not the stale 10)');
    }],
    ['DU07', 'BROWSER CSV import: the row of an existing product is refused with its line number (stock / ratings untouched), the new product is added', async (t) => {
      await ctx.put('products/p-simple', { ...PRODUCTS['p-simple'], ratingAvg: 4.5, ratingCount: 3 });
      const before = JSON.stringify(await get('products/p-simple'));
      const file = join(ctx.tmpDir, `import-${Date.now()}.csv`);
      writeFileSync(file, 'id,name,price,stock,category\np-simple,دفتر من الملف,9,0,Stationery\ncsv-new-e2e,منتج جديد,3,4,Stationery\n', 'utf8');
      await openDashboard(t);
      await t.evaluate(`${tab(0)}.click(); true`); // the CSV upload lives in the overview tab
      await t.waitFor(`!!document.querySelector('#csvUpload')`, 20_000, 'csv input');
      const { root } = await t.send('DOM.getDocument', { depth: 1 });
      const { nodeId } = await t.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#csvUpload' });
      await t.send('DOM.setFileInputFiles', { nodeId, files: [file] });
      await toastIncludes(t, 'تمت إضافة 1 منتج جديد');
      await toastIncludes(t, 'السطر 2 (p-simple): المعرّف موجود مسبقًا');
      assert.equal(JSON.stringify(await get('products/p-simple')), before, 'existing product unchanged');
      assert.equal((await get('products/csv-new-e2e'))?.stock, 4);
    }],
  ];
}

export async function runDeliveryScenarios(ctx) {
  const results = [];
  for (const [id, name, fn] of buildDeliveryScenarios(ctx)) {
    if (ctx.only && !ctx.only.has(id)) continue;
    await ctx.reseed();
    await ctx.resetSink();
    const t0 = Date.now();
    const browser = id.startsWith('DU');
    const t = browser ? await ctx.openTab() : null;
    try {
      await fn(t);
      results.push({ id, name, ok: true, ms: Date.now() - t0 });
      console.log(`✔ ${id} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      let extra = '';
      if (t) extra = ` | toasts: ${await t.evaluate(TOASTS).catch(() => '?')} | hash: ${await t.evaluate('location.hash').catch(() => '?')}`;
      results.push({ id, name, ok: false, ms: Date.now() - t0, error: `${String(e?.message || e).slice(0, 600)}${extra}`.slice(0, 1200) });
      console.log(`✖ ${id} ${name}\n    ${String(e?.message || e).split('\n')[0]}${extra}`);
    } finally {
      if (t) await t.close();
    }
  }
  return results;
}

/** the dashboard's configured admin e-mail (AdminDashboard.tsx), used ONLY for the local Auth emulator account */
export function dashboardAdminEmail(repoRoot) {
  const src = readFileSync(join(repoRoot, 'src/pages/AdminDashboard.tsx'), 'utf8');
  const m = src.match(/MY_ADMIN_EMAIL = "([^"]+)"/);
  if (!m) throw new Error('admin e-mail constant not found in AdminDashboard.tsx');
  return m[1].toLowerCase();
}
export { encodeFields };
