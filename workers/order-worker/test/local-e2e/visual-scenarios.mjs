// E2E_SUITE=visual — LOCAL ONLY: the same stack as the delivery suite (real order Worker with STOCK_POLICY=on_delivery,
// APPROVAL_MODE=off, Firestore + Auth emulators, the REAL web app in Vite, headless Chrome). For every page, on a PHONE
// (390x844) and a DESKTOP (1366x900) viewport: uncaught page errors, console errors, horizontal overflow, broken images,
// internal links to an unknown route, load time, and a full-page screenshot (E2E_SHOTS_DIR) for a human design review.
// One real GUEST order goes through the checkout on the phone, then appears in the admin dashboard.
// Synthetic products / accounts only; nothing leaves 127.0.0.1.
import { mkdirSync, writeFileSync } from 'node:fs';
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
// the app's routes (src/App.tsx) — an internal link to anything else is a dead link
const ROUTES = ['/', '/offers', '/product/', '/admin', '/account', '/shop', '/cart', '/wishlist', '/login', '/tracking', '/checkout', '/order-success/', '/my-orders', '/about', '/contact', '/privacy', '/admin-secure'];
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, mobile: true, dpr: 2 },
  { name: 'desktop', width: 1366, height: 900, mobile: false, dpr: 1 },
];
const CART = [
  { id: 'p-simple', name: 'دفتر', price: 2.5, stock: 10, category: 'Stationery', image: '', quantity: 2 },
  { id: 'p-last-one', name: 'آخر قطعة', price: 5, stock: 1, category: 'Stationery', image: '', quantity: 1 },
];
const PAGES = [
  { id: 'home', path: '/' },
  { id: 'shop', path: '/shop' },
  { id: 'product', path: '/product/p-simple' },
  { id: 'product-variants', path: '/product/p-variants' },
  { id: 'cart', path: '/cart', cart: true },
  { id: 'checkout', path: '/checkout', cart: true },
  { id: 'login', path: '/login' },
  { id: 'tracking', path: '/tracking' },
  { id: 'wishlist', path: '/wishlist' },
  { id: 'my-orders', path: '/my-orders' },
  { id: 'about', path: '/about' },
  { id: 'contact', path: '/contact' },
  { id: 'privacy', path: '/privacy' },
];

// collected inside the page: uncaught errors + console.error (codes / messages only, never form values)
const COLLECTOR = `window.__visErrs = []; window.addEventListener('error', (e) => window.__visErrs.push('uncaught: ' + String(e.message || e.error).slice(0, 200)));
window.addEventListener('unhandledrejection', (e) => window.__visErrs.push('unhandled rejection: ' + String((e.reason && (e.reason.code || e.reason.message)) || e.reason).slice(0, 200)));
{ const ce = console.error.bind(console); console.error = (...a) => { try { window.__visErrs.push('console.error: ' + a.map((x) => (x && (x.code || x.message)) || String(x)).join(' ').slice(0, 200)); } catch {} ce(...a); }; }`;
const INSPECT = `(() => {
  const de = document.documentElement;
  const overflowPx = Math.max(0, Math.max(de.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  const wide = overflowPx > 1 ? [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1); })
    .slice(0, 5).map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/).slice(0, 2).join('.') : '')) : [];
  const broken = [...document.images].filter((i) => i.getAttribute('src') && i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src').slice(0, 80));
  const links = [...document.querySelectorAll('a[href^="#/"]')].map((a) => a.getAttribute('href').slice(1).split('?')[0]);
  const nav = performance.getEntriesByType('navigation')[0];
  // a FIXED floating button (assistant / wheel / WhatsApp…) covering an interactive control on the FIRST screen
  window.scrollTo(0, 0);
  const vis = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  // floating = a small fixed button (not a full-width sticky bar such as the checkout's bottom action, which is intended)
  const floats = [...document.querySelectorAll('button, a')].filter((el) => { const cs = getComputedStyle(el); const p = el.closest('[style*="position: fixed"], .fixed') || (cs.position === 'fixed' ? el : null); const r = el.getBoundingClientRect(); return p && r.height < 90 && r.width < window.innerWidth * 0.6 && vis(r) && !el.closest('header, nav, [role=dialog]'); });
  const controls = [...document.querySelectorAll('button, a[href], input, select, textarea')].filter((el) => !floats.some((f) => f === el || f.contains(el) || el.contains(f)) && !el.closest('.fixed, header, nav, [role=dialog]') && vis(el.getBoundingClientRect()));
  const hit = (a, b) => a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2;
  const covered = []; const coveredLinks = [];
  for (const f of floats) {
    const fr = f.getBoundingClientRect();
    for (const c of controls) if (hit(fr, c.getBoundingClientRect())) {
      const what = (f.getAttribute('data-testid') || f.getAttribute('aria-label') || 'floating') + ' covers ' + (c.getAttribute('aria-label') || c.textContent.trim().slice(0, 20) || c.tagName.toLowerCase());
      (c.tagName === 'A' ? coveredLinks : covered).push(what); // a control (button / field) = failure; a link in scrolling content = warning
    }
  }
  return { overflowPx, wide, broken, links, covered: [...new Set(covered)].slice(0, 5), coveredLinks: [...new Set(coveredLinks)].slice(0, 5), errors: (window.__visErrs || []).slice(0, 10), dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null, load: nav ? Math.round(nav.loadEventEnd) : null, title: document.title, textLen: document.body.innerText.trim().length };
})()`;

export async function runVisualScenarios(ctx) {
  const shots = ctx.shotsDir;
  mkdirSync(shots, { recursive: true });
  const results = [];
  const report = [];
  const record = (id, name, ok, detail) => {
    results.push({ id, name, ok, ...(ok ? {} : { error: detail }) });
    console.log(`${ok ? '✔' : '✖'} ${id} ${name}${ok ? '' : `\n    ${detail}`}`);
  };
  const shot = async (t, name) => {
    await sleep(500);
    const r = await t.send('Page.captureScreenshot', { format: 'jpeg', quality: 65, captureBeyondViewport: true });
    writeFileSync(join(shots, `${name}.jpg`), Buffer.from(r.data, 'base64'));
  };
  const deadLinks = (links) => [...new Set(links)].filter((l) => !ROUTES.some((r) => (r.endsWith('/') && r !== '/' ? l.startsWith(r) : l === r)));

  for (const vp of VIEWPORTS) {
    const t = await ctx.openTab();
    try {
      await t.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
      if (vp.mobile) await t.send('Emulation.setTouchEmulationEnabled', { enabled: true }).catch(() => {});
      await t.send('Page.addScriptToEvaluateOnNewDocument', { source: COLLECTOR });
      await t.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `localStorage.setItem('language', 'ar'); if (location.search.includes('seedcart=1')) localStorage.setItem('anta_cart', ${JSON.stringify(JSON.stringify(CART))}); else if (location.search.includes('nocart=1')) localStorage.removeItem('anta_cart');`,
      });
      for (const pg of PAGES) {
        const id = `V-${vp.name}-${pg.id}`;
        try {
          await t.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' });
          await t.navigate(`${ctx.base}/?${pg.cart ? 'seedcart=1' : 'nocart=1'}&r=${Date.now()}#${pg.path}`);
          await t.waitFor(`document.body.innerText.trim().length > 40`, 30_000, `${pg.path} rendered`);
          await sleep(1500); // images, lazy chunks, data from the emulator
          const info = await t.evaluate(INSPECT);
          await shot(t, `${vp.name}-${pg.id}`);
          const dead = deadLinks(info.links);
          report.push({ id, viewport: vp.name, page: pg.path, ...info, dead });
          const problems = [
            ...(info.errors.length ? [`errors: ${info.errors.join(' | ')}`] : []),
            ...(info.overflowPx > 1 ? [`horizontal overflow ${info.overflowPx}px (${info.wide.join(', ')})`] : []),
            ...(info.broken.length ? [`broken images: ${info.broken.join(', ')}`] : []),
            ...(dead.length ? [`dead internal links: ${dead.join(', ')}`] : []),
            ...(info.covered.length ? [`floating button over a control on the first screen: ${info.covered.join(', ')}`] : []),
          ];
          if (info.coveredLinks.length) console.log(`    note ${id}: floating button over a link in scrolling content: ${info.coveredLinks.join(', ')}`);
          record(id, `${pg.path} on ${vp.name}: no error, no overflow, images and links OK, no floating button over a control (DCL ${info.dcl} ms)`, problems.length === 0, problems.join(' ; '));
        } catch (e) {
          record(id, `${pg.path} on ${vp.name}`, false, String(e?.message || e).split('\n')[0]);
        }
      }

      if (vp.mobile) {
        // a REAL guest order through the checkout on the phone (on_delivery: reserved, nothing deducted)
        const id = 'V-phone-guest-order';
        try {
          await t.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' });
          await t.navigate(`${ctx.base}/?seedcart=1&r=${Date.now()}#/checkout`);
          await t.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 40_000, 'checkout form');
          await t.evaluate(`(() => { ${SET_VAL}
            setVal(document.querySelector('input[placeholder^="name@example.com"]'), 'visual@example.com');
            setVal(document.querySelector('input[placeholder="الاسم الأول والأخير"]'), 'زبون فحص الواجهة');
            setVal(document.querySelector('input[placeholder="0791234567"]'), '0791230001');
            setVal([...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'zarqa')), 'zarqa');
            return true; })()`);
          await sleep(150);
          await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('input[placeholder^="اسم الشارع"]'), 'شارع الفحص 1'); return true; })()`);
          await shot(t, 'phone-checkout-step1-filled');
          await t.evaluate(`${STICKY}.click(); true`);
          await t.waitFor(`document.body.innerText.includes('توصيل عادي')`, 10_000, 'step 2');
          await shot(t, 'phone-checkout-step2');
          await t.evaluate(`${STICKY}.click(); true`);
          await t.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('CliQ'))`, 10_000, 'step 3');
          await shot(t, 'phone-checkout-step3');
          await t.evaluate(`${STICKY}.click(); true`);
          const out = await t.waitFor(OUTCOME, 40_000, 'order outcome');
          await sleep(1200);
          await shot(t, 'phone-order-success');
          const orderId = await t.evaluate(`decodeURIComponent(location.hash.split('/').pop() || '')`);
          ctx.lastOrderId = orderId;
          const errs = await t.evaluate(`(window.__visErrs || []).slice(0, 5)`);
          const L = orderId ? await ctx.get(`orderLedger/${orderId}`) : null;
          const stock = await ctx.get('products/p-simple');
          const res = await ctx.get('stockReservations/p-simple');
          const ok = out === 'success' && L?.stockPolicy === 'on_delivery' && L?.inventory === 'reserved' && stock?.stock === 10 && res?.product === 2 && !errs.length;
          record(id, 'guest order on the phone: success page, on_delivery, reserved 2, stock still 10, no page error', ok,
            `outcome=${out} policy=${L?.stockPolicy} inventory=${L?.inventory} stock=${stock?.stock} reserved=${res?.product} errors=${errs.join(' | ')}`);
        } catch (e) {
          record(id, 'guest order on the phone', false, String(e?.message || e).split('\n')[0]);
        }
      }

      // the admin dashboard (sign-in through the app's Login page, Auth emulator account)
      const aid = `V-${vp.name}-dashboard`;
      try {
        await t.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'indexeddb' });
        await t.navigate(`${ctx.base}/?nocart=1&r=${Date.now()}#/login`);
        await t.waitFor(`(() => { const f = document.querySelector('input[type=password]')?.form; return !!f && !!f.querySelector('input[type=email]') && !f.querySelector('button[type=submit]')?.disabled; })()`, 30_000, 'login form');
        await t.evaluate(`(() => { ${SET_VAL}
          setVal(document.querySelector('input[type=password]')?.form.querySelector('input[type=email]'), ${JSON.stringify(ctx.admin.email)});
          setVal(document.querySelector('input[type=password]'), ${JSON.stringify(ctx.admin.password)});
          return true; })()`);
        await sleep(150);
        await t.evaluate(`document.querySelector('input[type=password]')?.form.requestSubmit(); true`);
        await t.waitFor(`location.hash === '#/' || location.hash === '' || location.hash === '#/admin'`, 30_000, 'redirect after sign-in');
        await t.evaluate(`if (location.hash !== '#/admin') location.hash = '#/admin'; true`);
        await t.waitFor(`document.body.innerText.includes('إدارة الطلبات')`, 30_000, 'dashboard');
        await sleep(1200);
        await shot(t, `${vp.name}-dashboard-home`);
        await t.evaluate(`[...document.querySelectorAll('h1 + div button')][2].click(); true`);
        await t.waitFor(`!!document.querySelector('tbody tr') || document.body.innerText.includes('لا توجد')`, 20_000, 'orders table');
        await sleep(800);
        const hasOrder = ctx.lastOrderId ? await t.evaluate(`document.body.innerText.includes(${JSON.stringify(ctx.lastOrderId)})`) : true;
        const label = await t.evaluate(`document.body.innerText.includes('محجوزة') || document.body.innerText.includes('محجوز')`);
        await shot(t, `${vp.name}-dashboard-orders`);
        const info = await t.evaluate(INSPECT);
        const problems = [
          ...(info.errors.length ? [`errors: ${info.errors.join(' | ')}`] : []),
          ...(info.overflowPx > 1 ? [`horizontal overflow ${info.overflowPx}px (${info.wide.join(', ')})`] : []),
          ...(!hasOrder ? ['the guest order is not listed'] : []),
        ];
        report.push({ id: aid, viewport: vp.name, page: '#/admin (orders)', ...info, hasOrder, reservedLabel: label });
        record(aid, `dashboard on ${vp.name}: signs in, orders listed${ctx.lastOrderId ? ' (incl. the guest order)' : ''}, no error`, problems.length === 0, problems.join(' ; '));
      } catch (e) {
        record(aid, `dashboard on ${vp.name}`, false, String(e?.message || e).split('\n')[0]);
      }
    } finally {
      await t.close();
    }
  }
  writeFileSync(join(shots, 'visual-report.json'), JSON.stringify(report, null, 2));
  console.log(`[inner] visual: ${results.filter((r) => r.ok).length}/${results.length} checks passed; screenshots + visual-report.json in ${shots}`);
  return results;
}
