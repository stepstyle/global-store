// E2E_SUITE=reviews — LOCAL ONLY: verified-purchase reviews on the REAL web app (Vite) + the REAL order Worker
// (on_delivery, price check enforced) + the Firestore / Auth emulators under the FINAL rules. Synthetic showcase
// products; synthetic customers. Phone (390x844) and desktop (1366x900); screenshots for the design review.
//
//   admin: delivered order -> "create review link" (manual sending only: copy / open WhatsApp, nothing sent)
//   guest: opens the private link -> token leaves the address bar -> reviews the order's products once each
//   product page: verified badge, average + count, card stars; how-it-works box for a product without reviews
//   signed-in customer: «طلباتي» -> review a delivered order without a link
//   admin: flag / hide with a reason (no delete for a verified review) -> visitors and figures follow
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeOrderId } from '../fixtures.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SET_VAL = `const setVal = (el, v) => {
  if (!el) throw new Error('field not found');
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};`;
const STUB_CONFIRM = `(() => { window.confirm = () => true; return true; })()`;
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, mobile: true, dpr: 2 },
  { name: 'desktop', width: 1366, height: 900, mobile: false, dpr: 1 },
];
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** a guest order of the showcase products, through the real Worker (price check enforced) */
function showcaseOrder({ id = makeOrderId(), userId = 'guest', name = 'ريم الخطيب', phone = '+962791112233' } = {}) {
  const items = [
    { productId: 'sc-notebook', name: 'دفتر جامعي 100 ورقة', price: 1.5, quantity: 1, image: '/images/categories/notebooks.png', selectedVariant: null },
    { productId: 'sc-playmat', name: 'فرشة لعب للأطفال - أزرق', price: 16, quantity: 1, image: '/images/categories/playmats.png', selectedVariant: { id: 'pm-blue', label: 'أزرق', type: 'color', price: 16, originalPrice: 20, stock: 4, colorCode: '#3b82f6' } },
  ];
  const subtotal = 17.5;
  return {
    id, userId, status: 'new', seenByAdmin: false, date: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString(), createdAtMs: Date.now(), updatedAt: new Date().toISOString(),
    items, subtotal, discountAmount: 0, shippingCost: 1, total: subtotal + 1, shippingMethodId: 'standard', shippingMethod: 'توصيل عادي (خلال 48 ساعة)', paymentMethod: 'cod',
    customerEmail: 'reem@example.invalid', consents: { acceptedStorePolicies: true, acceptedDeliveryPolicy: false, saveInfo: false, billingSameAsShipping: true }, note: '',
    address: { fullName: name, city: 'عمّان (العاصمة) - النزهة', street: 'شارع الاختبار 7', phone },
    addressMeta: { country: 'Jordan', countryCode: 'JO', citySlug: 'amman', ammanAreaId: 'a1', saveInfo: false, phoneDial: '+962', phoneLocal: '0' + phone.slice(4) },
  };
}

export async function runReviewScenarios(ctx) {
  const shots = ctx.shotsDir;
  mkdirSync(shots, { recursive: true });
  const results = [];
  const record = (id, name, ok, detail = '') => {
    results.push({ id, name, ok, ...(ok ? {} : { error: detail }) });
    console.log(`${ok ? '✔' : '✖'} ${id} ${name}${ok ? '' : `\n    ${detail}`}`);
  };
  const check = async (id, name, fn) => {
    try { await fn(); record(id, name, true); } catch (e) { record(id, name, false, String(e?.message || e).split('\n')[0]); }
  };
  const must = (c, msg) => { if (!c) throw new Error(msg); };
  const shot = async (t, name, full = false) => {
    await sleep(700);
    const r = await t.send('Page.captureScreenshot', { format: 'jpeg', quality: 78, captureBeyondViewport: full });
    writeFileSync(join(shots, `${name}.jpg`), Buffer.from(r.data, 'base64'));
  };
  const W = ctx.W;
  const authH = async (uid) => ({ authorization: `Bearer ${await ctx.idToken(uid)}` });
  const api = async (path, body, headers = {}) => {
    const r = await fetch(`${W}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const createOrder = async (order, uid = null) => {
    const r = await api('/create-order', { order, turnstileToken: ctx.turnstileToken }, uid ? await authH(uid) : {});
    must(r.status === 200, `create ${r.status} ${JSON.stringify(r.body)}`);
    return order.id;
  };
  const deliver = async (id) => {
    for (const s of ['processing', 'shipped', 'delivered']) {
      const r = await api(`/admin/orders/${encodeURIComponent(id)}/status`, { status: s }, await authH(ctx.ownerUid));
      must(r.status === 200, `status ${s}: ${r.status} ${JSON.stringify(r.body)}`);
    }
  };
  const ERRS = `(window.__rvErrs || []).slice(0, 4)`;
  const overflow = `Math.max(0, Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)`;
  const prepTab = async (t, vp) => {
    await t.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
    if (vp.mobile) await t.send('Emulation.setTouchEmulationEnabled', { enabled: true }).catch(() => {});
    await t.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__rvErrs = []; addEventListener('error', (e) => window.__rvErrs.push(String(e.message).slice(0, 160))); addEventListener('unhandledrejection', (e) => window.__rvErrs.push('rejection ' + String(e.reason && (e.reason.message || e.reason)).slice(0, 160))); try { localStorage.setItem('language', 'ar'); localStorage.setItem('cookie_consent', 'declined'); } catch {}` });
  };
  const signIn = async (t, email, password) => {
    await t.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb,local_storage' });
    await t.navigate(`${ctx.base}/?r=${Date.now()}#/login`);
    await t.waitFor(`(() => { const f = document.querySelector('input[type=password]')?.form; return !!f && !!f.querySelector('input[type=email]') && !f.querySelector('button[type=submit]')?.disabled; })()`, 30_000, 'login form');
    await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('input[type=password]')?.form.querySelector('input[type=email]'), ${JSON.stringify(email)}); setVal(document.querySelector('input[type=password]'), ${JSON.stringify(password)}); return true; })()`);
    await sleep(150);
    await t.evaluate(`document.querySelector('input[type=password]')?.form.requestSubmit(); true`);
    await t.waitFor(`location.hash === '#/' || location.hash === '' || location.hash === '#/admin'`, 30_000, 'redirect after sign-in');
  };
  const sinkCount = async () => (await ctx.sinkCalls()).length;
  const sinkHas = async (s) => JSON.stringify(await ctx.sinkCalls()).includes(s);

  // ---------------------------------------------------------------- data: two delivered guest orders + one not delivered
  await ctx.reseed();
  const ORDER_A = await createOrder(showcaseOrder({ name: 'ريم الخطيب', phone: '+962791112233' }));
  const ORDER_B = await createOrder(showcaseOrder({ name: 'سامر يوسف', phone: '+962781234000' }));
  const ORDER_NEW = await createOrder(showcaseOrder({ name: 'لم يُسلَّم', phone: '+962771000111' }));
  await deliver(ORDER_A);
  await deliver(ORDER_B);
  let linkA = '';

  // ================================================================ admin: the review link
  for (const vp of VIEWPORTS) {
    const t = await ctx.openTab();
    try {
      await prepTab(t, vp);
      await check(`RE01-${vp.name}`, `admin (${vp.name}): delivered order -> "create review link"; copy + WhatsApp (manual), nothing sent`, async () => {
        await signIn(t, ctx.admin.email, ctx.admin.password);
        await t.evaluate(`if (location.hash !== '#/admin') location.hash = '#/admin'; true`);
        await t.waitFor(`document.body.innerText.includes('إدارة الطلبات')`, 30_000, 'dashboard');
        await t.evaluate(`[...document.querySelectorAll('h1 + div button')][2].click(); true`);
        const id = vp.name === 'phone' ? ORDER_A : ORDER_B;
        await t.waitFor(`[...document.querySelectorAll('tbody tr')].some((r) => r.innerText.includes(${JSON.stringify(id)}))`, 30_000, 'order listed');
        await t.evaluate(`[...[...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(${JSON.stringify(id)})).querySelectorAll('button')].find((b) => b.textContent.trim() === 'تفاصيل').click(); true`);
        await t.waitFor(`!!document.querySelector('[data-testid=admin-review-link-create]')`, 15_000, 'review link panel');
        await t.evaluate(`document.querySelector('[data-testid=admin-review-link]').scrollIntoView({ block: 'center' }); true`);
        await shot(t, `01-admin-order-review-link-before-${vp.name}`);
        await sleep(1500); // the orders' own notices (creation / status) are done
        const sinkBefore = await sinkCount();
        await t.evaluate(`document.querySelector('[data-testid=admin-review-link-create]').click(); true`);
        await t.waitFor(`!!document.querySelector('[data-testid=admin-review-link-url]')?.value`, 20_000, 'link shown');
        const url = await t.evaluate(`document.querySelector('[data-testid=admin-review-link-url]').value`);
        must(new RegExp(`#/review/${id}/[${B32}]{24}$`).test(url), `link format ${url}`);
        const wa = await t.evaluate(`[...document.querySelectorAll('[data-testid=admin-review-link] a')].map((a) => a.href)[0] || ''`);
        must(wa.startsWith(`https://wa.me/962${vp.name === 'phone' ? '791112233' : '781234000'}?text=`), `WhatsApp link ${wa.slice(0, 40)}`);
        must(decodeURIComponent(wa).includes(url), 'the message carries the link');
        await t.evaluate(`document.querySelector('[data-testid=admin-review-link]').scrollIntoView({ block: 'center' }); true`);
        await shot(t, `02-admin-order-review-link-ready-${vp.name}`);
        if (vp.name === 'phone') linkA = url;
        await sleep(800);
        must((await sinkCount()) === sinkBefore, 'no Telegram / e-mail sent by the link');
        must((await t.evaluate(ERRS)).length === 0, `JS errors ${JSON.stringify(await t.evaluate(ERRS))}`);
      });
      if (vp.name === 'phone') {
        await check('RE02', 'admin: not-delivered order has no review-link panel; the Worker refuses one (NOT_DELIVERED)', async () => {
          await t.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'إغلاق')?.click(); true`);
          await t.waitFor(`[...document.querySelectorAll('tbody tr')].some((r) => r.innerText.includes(${JSON.stringify(ORDER_NEW)}))`, 20_000, 'order listed');
          await t.evaluate(`[...[...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(${JSON.stringify(ORDER_NEW)})).querySelectorAll('button')].find((b) => b.textContent.trim() === 'تفاصيل').click(); true`);
          await t.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('حذف نهائي'))`, 15_000, 'details');
          must(!(await t.evaluate(`!!document.querySelector('[data-testid=admin-review-link]')`)), 'panel hidden');
          const r = await api(`/admin/orders/${ORDER_NEW}/review-link`, {}, await authH(ctx.ownerUid));
          must(r.status === 409 && r.body?.code === 'NOT_DELIVERED', JSON.stringify(r));
        });
      }
    } finally { await t.close(); }
  }
  // ORDER_A's link for the customer; the desktop pass made ORDER_B's
  must(linkA, 'link for order A');
  const local = (url) => `${ctx.base}/${url.slice(url.indexOf('#'))}`;
  const tokenA = linkA.split('/').pop();

  // ================================================================ guest: the private link
  {
    const vp = VIEWPORTS[0];
    const t = await ctx.openTab();
    try {
      await prepTab(t, vp);
      await t.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb,local_storage' });
      await check('RE03', 'guest opens the link: token leaves the address bar at once; the products of THIS order only; no personal data', async () => {
        await t.navigate(local(linkA));
        await t.waitFor(`document.querySelectorAll('[data-testid=review-order-item]').length === 2`, 30_000, 'items');
        const href = await t.evaluate('location.href');
        must(href.endsWith(`#/review/${ORDER_A}`) && !href.includes(tokenA), `address ${href}`);
        const text = await t.evaluate(`document.querySelector('[data-testid=review-order-page]').innerText`);
        for (const s of ['0791112233', '791112233', 'الخطيب', 'شارع الاختبار', 'reem@']) must(!text.includes(s), `page shows ${s}`);
        must(await t.evaluate(`document.querySelector('[data-testid=review-name]').value === 'ريم'`), 'first name suggested');
        must(text.includes('أزرق'), 'the colour bought');
        must((await t.evaluate(overflow)) === 0, 'no horizontal scroll');
        await shot(t, '03-guest-review-page-phone', true);
      });
      await check('RE04', 'guest: stars missing -> told; 4 stars + comment -> published; second product stars only -> published; "all done"', async () => {
        await t.evaluate(`document.querySelectorAll('[data-testid=review-submit]')[0].click(); true`);
        await t.waitFor(`document.querySelector('[data-testid=review-order-item] [role=alert]')?.innerText.includes('نجمة')`, 5000, 'stars required');
        await t.evaluate(`document.querySelector('[data-testid=review-order-item] input[data-star="4"]').click(); true`);
        await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('[data-testid=review-order-item] textarea'), 'دفتر ممتاز وورقه سميك، لكن الغلاف ينثني بسرعة.'); return true; })()`);
        await shot(t, '04-guest-review-filled-phone');
        await t.evaluate(`document.querySelectorAll('[data-testid=review-submit]')[0].click(); true`);
        await t.waitFor(`document.querySelectorAll('[data-testid=review-done]').length === 1`, 20_000, 'first published');
        await t.evaluate(`document.querySelectorAll('[data-testid=review-order-item]')[1].querySelector('input[data-star="5"]').click(); true`);
        await t.evaluate(`document.querySelectorAll('[data-testid=review-submit]')[0].click(); true`);
        await t.waitFor(`!!document.querySelector('[data-testid=review-all-done]')`, 20_000, 'all done');
        await shot(t, '05-guest-review-done-phone', true);
        must((await t.evaluate(ERRS)).length === 0, `JS errors ${JSON.stringify(await t.evaluate(ERRS))}`);
      });
      await check('RE05', 'guest reloads the page: still recognised (this tab), both products shown as reviewed; a repeat is refused', async () => {
        await t.reload();
        await t.waitFor(`document.querySelectorAll('[data-testid=review-done]').length === 2`, 30_000, 'reviewed after reload');
        const dup = await api('/reviews/submit', { orderId: ORDER_A, token: tokenA, productId: 'sc-notebook', rating: 1, name: 'ريم' });
        must(dup.status === 409 && dup.body?.code === 'ALREADY_REVIEWED', JSON.stringify(dup));
        const other = await api('/reviews/submit', { orderId: ORDER_A, token: tokenA, productId: 'sc-bike', rating: 5, name: 'ريم' });
        must(other.status === 422 && other.body?.code === 'PRODUCT_NOT_IN_ORDER', JSON.stringify(other));
        const wrong = await api('/reviews/state', { orderId: ORDER_A, token: tokenA.slice(0, 23) + (tokenA.endsWith('0') ? '1' : '0') });
        must(wrong.status === 404, `wrong token ${wrong.status}`);
      });
      await check('RE06', 'a link with a wrong token: a clear message, nothing else', async () => {
        const bad = local(linkA).replace(tokenA, 'ZZZZZZZZZZZZZZZZZZZZZZZZ');
        await t.evaluate(`(() => { try { sessionStorage.clear(); } catch {} return true; })()`);
        await t.navigate(bad.replace(ORDER_A, ORDER_NEW));
        await t.waitFor(`!!document.querySelector('[data-testid=review-failure]')`, 20_000, 'failure');
        must((await t.evaluate(`document.querySelector('[data-testid=review-failure]').innerText`)).includes('غير صالح'), 'message');
        await shot(t, '06-guest-review-bad-link-phone');
      });
    } finally { await t.close(); }
  }

  // ================================================================ product page + card (visitors)
  for (const vp of VIEWPORTS) {
    const t = await ctx.openTab();
    try {
      await prepTab(t, vp);
      await t.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb,local_storage' });
      await check(`RE07-${vp.name}`, `visitor (${vp.name}): verified badge + colour, average and count on the product page and its card`, async () => {
        await t.navigate(`${ctx.base}/?r=${Date.now()}#/product/sc-playmat?tab=reviews`);
        await t.waitFor(`document.querySelectorAll('[data-testid=review-item]').length === 1`, 40_000, 'review listed');
        const item = await t.evaluate(`document.querySelector('[data-testid=review-item]').innerText`);
        must(item.includes('شراء موثّق') && item.includes('أزرق') && item.includes('ريم'), `item ${item.slice(0, 120)}`);
        const sum = await t.evaluate(`document.querySelector('[data-testid=product-rating-summary]').innerText`);
        must(sum.includes('5.0') && sum.includes('تقييم موثّق'), `summary ${sum}`);
        await t.evaluate(`document.querySelector('[data-testid=product-reviews]').scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); true`);
        await shot(t, `07-product-reviews-tab-${vp.name}`);
        await t.evaluate(`window.scrollTo(0, 0); true`);
        await shot(t, `08-product-top-rating-${vp.name}`);
        must((await t.evaluate(overflow)) === 0, 'no horizontal scroll');
      });
      await check(`RE08-${vp.name}`, `visitor (${vp.name}): the card in the shop shows the stars (figures written by the Worker)`, async () => {
        await t.navigate(`${ctx.base}/?r=${Date.now()}#/shop?search=${encodeURIComponent('دفتر جامعي')}`);
        await t.waitFor(`!!document.querySelector('[data-product-id="sc-notebook"]')`, 40_000, 'card');
        const txt = await t.evaluate(`document.querySelector('[data-product-id="sc-notebook"]').innerText`);
        must(txt.includes('4.0') && txt.includes('(1)'), `card ${txt.slice(0, 80)}`);
        await t.evaluate(`document.querySelector('[data-product-id="sc-notebook"]').scrollIntoView({ block: 'center' }); true`);
        await shot(t, `09-shop-card-stars-${vp.name}`);
      });
      if (vp.name === 'phone') {
        await check('RE09', 'visitor: a product without reviews explains how reviewing works (buyers after delivery); no form', async () => {
          await t.navigate(`${ctx.base}/?r=${Date.now()}#/product/sc-bike?tab=reviews`);
          await t.waitFor(`!!document.querySelector('[data-testid=review-how]')`, 40_000, 'how box');
          must(!(await t.evaluate(`!!document.querySelector('[data-testid=review-form]')`)), 'no form for a visitor');
          await t.evaluate(`document.querySelector('[data-testid=product-reviews]').scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); true`);
          await shot(t, '10-product-no-reviews-guest-phone');
          must((await t.evaluate(ERRS)).length === 0, `JS errors ${JSON.stringify(await t.evaluate(ERRS))}`);
        });
      }
    } finally { await t.close(); }
  }

  // ================================================================ signed-in customer: «طلباتي» -> review
  await check('RE10', 'signed-in customer: «طلباتي» shows "قيّم مشترياتك" for the delivered order; reviews it without a link; product page form', async () => {
    const cust = await ctx.newCustomer('هالة');
    const id = await createOrder(showcaseOrder({ userId: cust.uid, name: 'هالة منصور', phone: '+962799990001' }), cust.uid);
    await deliver(id);
    const vp = VIEWPORTS[0];
    const t = await ctx.openTab();
    try {
      await prepTab(t, vp);
      await signIn(t, cust.email, cust.password);
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/product/sc-playmat?tab=reviews`);
      await t.waitFor(`!!document.querySelector('[data-testid=review-form]')`, 40_000, 'form for the buyer');
      await t.evaluate(`document.querySelector('[data-testid=review-form]').scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); true`);
      await t.evaluate(`document.querySelector('[data-testid=review-form] input[data-star="3"]').click(); true`);
      await shot(t, '11-product-form-signed-in-buyer-phone');
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/my-orders`);
      await t.waitFor(`!!document.querySelector('[data-testid=myorders-review]')`, 40_000, 'review button');
      await t.evaluate(`document.querySelector('[data-testid=myorders-review]').scrollIntoView({ block: 'center' }); true`);
      await shot(t, '12-my-orders-review-button-phone');
      await t.evaluate(`document.querySelector('[data-testid=myorders-review]').click(); true`);
      await t.waitFor(`document.querySelectorAll('[data-testid=review-order-item]').length === 2`, 30_000, 'account review page');
      await t.evaluate(`document.querySelectorAll('[data-testid=review-order-item]')[0].querySelector('input[data-star="5"]').click(); true`);
      await t.evaluate(`document.querySelectorAll('[data-testid=review-submit]')[0].click(); true`);
      await t.waitFor(`document.querySelectorAll('[data-testid=review-done]').length === 1`, 20_000, 'published');
      const key = await ctx.get(`reviewKeys/${id}__sc-notebook`);
      must(key?.via === 'account' && key.uid === cust.uid, JSON.stringify(key));
      must((await t.evaluate(ERRS)).length === 0, `JS errors ${JSON.stringify(await t.evaluate(ERRS))}`);
    } finally { await t.close(); }
  });

  // ================================================================ admin moderation
  await check('RE11', 'admin: flag (reason) keeps it visible; hide (reason) removes it for visitors and from the figures; no delete for a verified review', async () => {
    const t = await ctx.openTab();
    try {
      await prepTab(t, VIEWPORTS[1]);
      await signIn(t, ctx.admin.email, ctx.admin.password);
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/product/sc-notebook?tab=reviews`);
      await t.waitFor(`document.querySelectorAll('[data-testid=review-admin]').length >= 2`, 40_000, 'admin tools');
      must(!(await t.evaluate(`[...document.querySelectorAll('[data-testid=review-item][data-verified="1"] button')].some((b) => b.textContent.includes('حذف'))`)), 'no delete on verified');
      await t.evaluate(`[...document.querySelector('[data-testid=review-item]').querySelectorAll('button')].find((b) => b.textContent.includes('إبلاغ للمراجعة')).click(); true`);
      await t.waitFor(`!!document.querySelector('[data-testid=moderation-panel]')`, 5000, 'panel');
      must(!(await t.evaluate(`[...document.querySelectorAll('[data-testid=moderation-panel] option')].some((o) => /سلب|negative/i.test(o.textContent + o.value))`)), 'no "negative" reason');
      await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('[data-testid=moderation-panel] select'), 'personal_data'); return true; })()`);
      await t.evaluate(`document.querySelector('[data-testid=moderation-panel]').scrollIntoView({ block: 'center' }); true`);
      await shot(t, '13-admin-moderation-panel-desktop');
      await t.evaluate(`[...document.querySelectorAll('[data-testid=moderation-panel] button')].find((b) => b.textContent.trim() === 'إبلاغ').click(); true`);
      await t.waitFor(`document.querySelector('[data-testid=review-item]')?.innerText.includes('مُعلَّم للمراجعة')`, 20_000, 'flagged');
      const before = await ctx.get('products/sc-notebook');
      must(before.ratingCount === 2, `count with both reviews ${before.ratingCount}`);
      await t.evaluate(`[...document.querySelector('[data-testid=review-item]').querySelectorAll('button')].find((b) => b.textContent.includes('إخفاء لمخالفة')).click(); true`);
      await t.waitFor(`!!document.querySelector('[data-testid=moderation-panel]')`, 5000, 'panel');
      await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('[data-testid=moderation-panel] select'), 'personal_data'); return true; })()`);
      await t.evaluate(`[...document.querySelectorAll('[data-testid=moderation-panel] button')].find((b) => b.textContent.trim() === 'إخفاء').click(); true`);
      await t.waitFor(`document.querySelector('[data-testid=review-item]')?.innerText.includes('مخفي')`, 20_000, 'hidden');
      await shot(t, '14-admin-review-hidden-desktop');
      const after = await ctx.get('products/sc-notebook');
      must(after.ratingCount === 1, `figures after hide ${after.ratingCount}`);
      // the dashboard's reviews tab
      // in-app navigation (as the other suites do): a full reload of #/admin sends the visitor home before the sign-in is restored
      await t.evaluate("location.hash = '#/admin'; true");
      await t.waitFor(`document.body.innerText.includes('إدارة الطلبات') && !!document.querySelector('[data-testid=admin-tab-reviews]')`, 30_000, 'dashboard ready');
      // the dashboard may re-render once the admin profile arrives: click until the panel is there
      await t.waitFor(`(() => { if (!document.querySelector('[data-testid=admin-reviews-panel]')) document.querySelector('[data-testid=admin-tab-reviews]')?.click(); return !!document.querySelector('[data-testid=admin-reviews-panel]'); })()`, 20_000, 'reviews tab').catch(async (e) => { await shot(t, 'debug-admin-tab'); throw new Error(e.message + ' | hash ' + await t.evaluate('location.hash') + ' | errs ' + JSON.stringify(await t.evaluate(ERRS)) + ' | tabs ' + await t.evaluate('[...document.querySelectorAll("[data-testid=admin-tab-reviews]")].length') + ' | body ' + String(await t.evaluate('document.querySelector("main")?.innerText || ""')).slice(0, 300).replace(/s+/g, ' ')); });
      await t.waitFor(`document.querySelectorAll('[data-testid=admin-review-row]').length >= 3`, 20_000, 'rows').catch(async (e) => { throw new Error(e.message + ' | panel: ' + String(await t.evaluate(`document.querySelector('[data-testid=admin-reviews-panel]')?.innerText || 'NO PANEL'`)).slice(0, 200) + ' | hash ' + await t.evaluate('location.hash') + ' | errs ' + JSON.stringify(await t.evaluate(ERRS)) + ' | body ' + String(await t.evaluate('document.querySelector("main")?.innerText || ""')).slice(0, 300).replace(/s+/g, ' ')); });
      await shot(t, '15-admin-reviews-tab-desktop');
      must((await t.evaluate(ERRS)).length === 0, `JS errors ${JSON.stringify(await t.evaluate(ERRS))}`);
    } finally { await t.close(); }
    // a visitor no longer sees the hidden review
    const v = await ctx.openTab();
    try {
      await prepTab(v, VIEWPORTS[0]);
      await v.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb,local_storage' });
      await v.navigate(`${ctx.base}/?r=${Date.now()}#/product/sc-notebook?tab=reviews`);
      await v.waitFor(`document.querySelectorAll('[data-testid=review-item]').length === 1`, 40_000, 'visitor sees 1');
    } finally { await v.close(); }
  });

  await check('RE12', 'nothing about orders / stock changed by reviewing; no message sent to anybody', async () => {
    const o = await ctx.get(`orders/${ORDER_A}`);
    must(o.status === 'delivered', `order ${o.status}`);
    const l = await ctx.get(`orderLedger/${ORDER_A}`);
    must(l.inventory === 'deducted', `ledger ${l.inventory}`);
    must(!(await sinkHas('/review/')) && !(await sinkHas(tokenA)), 'no review link sent to anybody by the system');
  });

  // ================================================================ owner's decision 2026-11-28: Worker orders only
  await check('RE13', 'old order (browser-written, no Worker record) marked delivered: admin sees the owner\'s message, no link; Worker refuses; «طلباتي» and the product page offer no review', async () => {
    const cust = await ctx.newCustomer('زبون قديم');
    const legacy = showcaseOrder({ userId: cust.uid, name: 'طلب قديم', phone: '+962790000777' });
    await ctx.put(`orders/${legacy.id}`, { ...legacy, status: 'delivered' }); // as the old site wrote orders: from the browser, no ledger
    const state = async () => JSON.stringify([await ctx.get(`orders/${legacy.id}`), await ctx.get(`orderLedger/${legacy.id}`), await ctx.get(`reviewInvites/${legacy.id}`), await ctx.get('products/sc-notebook'), await ctx.get('products/sc-playmat')]);
    const before = await state();
    const r = await api(`/admin/orders/${legacy.id}/review-link`, {}, await authH(ctx.ownerUid));
    must(r.status === 409 && r.body?.code === 'UNVERIFIED_ORDER', `Worker: ${JSON.stringify(r)}`);
    const t = await ctx.openTab();
    try {
      await prepTab(t, VIEWPORTS[0]);
      await signIn(t, ctx.admin.email, ctx.admin.password);
      await t.evaluate(`if (location.hash !== '#/admin') location.hash = '#/admin'; true`);
      await t.waitFor(`document.body.innerText.includes('إدارة الطلبات')`, 30_000, 'dashboard');
      await t.evaluate(`[...document.querySelectorAll('h1 + div button')][2].click(); true`);
      await t.waitFor(`[...document.querySelectorAll('tbody tr')].some((r) => r.innerText.includes(${JSON.stringify(legacy.id)}))`, 30_000, 'old order listed');
      await t.evaluate(`[...[...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(${JSON.stringify(legacy.id)})).querySelectorAll('button')].find((b) => b.textContent.trim() === 'تفاصيل').click(); true`);
      await t.waitFor(`!!document.querySelector('[data-testid=admin-review-link-ineligible]')`, 15_000, 'the owner\'s message');
      const txt = await t.evaluate(`document.querySelector('[data-testid=admin-review-link-ineligible]').innerText`);
      must(txt.includes('طلب قديم غير موثّق بالنظام، لا يمكن إنشاء رابط تقييم له'), `message: ${txt}`);
      must(!(await t.evaluate(`!!document.querySelector('[data-testid=admin-review-link-create]')`)), 'no "create review link" button');
      await t.evaluate(`document.querySelector('[data-testid=admin-review-link-ineligible]').scrollIntoView({ block: 'center' }); true`);
      await shot(t, '20-admin-old-order-no-link-phone');
      must((await t.evaluate(ERRS)).length === 0, `JS errors (admin) ${JSON.stringify(await t.evaluate(ERRS))}`);
      // the customer whose account the old order names: no review offered anywhere
      await signIn(t, cust.email, cust.password);
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/my-orders`);
      await t.waitFor(`document.body.innerText.includes(${JSON.stringify(legacy.id)})`, 40_000, 'old order in «طلباتي»');
      await sleep(1500);
      must(!(await t.evaluate(`!!document.querySelector('[data-testid=myorders-review]')`)), 'no "قيّم مشترياتك" for the old order');
      await shot(t, '21-my-orders-old-order-no-review-phone');
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/product/sc-playmat?tab=reviews`);
      await t.waitFor(`!!document.querySelector('[data-testid=review-how]')`, 40_000, 'reviews tab');
      await sleep(2500);
      must(!(await t.evaluate(`!!document.querySelector('[data-testid=review-form]')`)), 'no review form from the old order');
      // the review page reached by hand (#/review/<old order>) answers the Worker's refusal, never a form
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/review/${legacy.id}`);
      await t.waitFor(`!!document.querySelector('[data-testid=review-failure]') || !!document.querySelector('[data-testid=review-need-link]')`, 30_000, 'review page refusal');
      must(!(await t.evaluate(`!!document.querySelector('[data-testid=review-items]')`)), 'no items to review');
      must((await t.evaluate(ERRS)).length === 0, `JS errors (customer) ${JSON.stringify(await t.evaluate(ERRS))}`);
    } finally { await t.close(); }
    must((await state()) === before, 'old order, ledger, invite and products unchanged');
  });

  writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok);
  console.log(`[reviews] ${results.length - failed.length}/${results.length} passed; screenshots in ${shots}`);
  return results;
}
