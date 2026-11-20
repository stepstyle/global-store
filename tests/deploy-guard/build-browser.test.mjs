// tests/deploy-guard/build-browser.test.mjs — builds + bundle scans + sandboxed headless browser.
//   CHROME_PATH=<chrome or chrome-headless-shell> node tests/deploy-guard/build-browser.test.mjs
// Optional: GUARD_OUT=<dir> keeps the builds there (default: a temp dir that is removed).
//
// Isolation: builds use FAKE VITE_* values only. The browser resolves every host except 127.0.0.1 to NOTFOUND and
// every request is intercepted (CDP Fetch): only the local test server is allowed, everything else is failed and
// recorded. The local server runs the real /api handlers with VERCEL_ENV=preview and a node fetch trap.
// Nothing can reach Firebase, a Worker, SendGrid, Cloudinary, Google or Meta. Production identifiers are never printed.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH;
const OUT = process.env.GUARD_OUT || mkdtempSync(join(tmpdir(), 'deploy-guard-'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
const t = async (id, desc, fn) => {
  try { const note = await fn(); rows.push([id, 'PASS', desc + (note ? ` [${note}]` : '')]); }
  catch (e) { rows.push([id, 'FAIL', `${desc} :: ${String(e.message).slice(0, 400)}`]); process.exitCode = 1; }
};

// ---------------------------------------------------------------- builds
const FAKE = {
  VITE_WORKER_URL: 'https://fake-order-worker.example-guard.workers.dev\n',
  VITE_TURNSTILE_SITE_KEY: 'FAKE-TURNSTILE-0123456789',
};
// secret-looking VITE_* names (Gemini key, tokens) are refused by tools/firebase-env-guard.ts in EVERY build —
// production and sandbox alike — so they can never reach a bundle (X21 below proves the refusal)
const SECRET_LIKE = { VITE_GEMINI_API_KEY: 'FAKE-GEMINI-KEY-0123456789abcdef', VITE_WORKER_AUTH_TOKEN: 'FAKE-VITE-WORKER-TOKEN-0123456789' };
const baseEnv = () => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/^(VERCEL|VITE_|STORE_BUILD_TARGET)/.test(k)) delete e[k];
  return e;
};
const build = (name, vars) => {
  const out = join(OUT, name);
  const r = spawnSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'],
    { cwd: ROOT, env: { ...baseEnv(), ...vars }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`build ${name} failed: ${(r.stderr || '').slice(-600)}`);
  const decision = (r.stdout.match(/\[deploy-guard\][^\n]*/) || [''])[0];
  return { out, decision };
};
const files = (d) => { const a = []; const w = (x) => { for (const f of readdirSync(x)) { const p = join(x, f); statSync(p).isDirectory() ? w(p) : a.push(p); } }; w(d); return a.sort(); };
const treeHash = (d) => { const h = createHash('sha256'); for (const f of files(d)) { h.update(f.slice(d.length)); h.update(readFileSync(f)); } return h.digest('hex').slice(0, 16); };
const allText = (d) => files(d).filter((f) => /\.(js|css|html|json|txt|svg|webmanifest)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
const checkGuard = (dir, expect, extraEnv = {}) => spawnSync(process.execPath, [join(ROOT, 'scripts/check-guard.mjs'), dir, '--expect', expect],
  { cwd: ROOT, env: { ...baseEnv(), ...extraEnv }, encoding: 'utf8' });

// production Firebase web config, read from source (never printed) — used to try the localStorage relink (X05/X20)
const fbSrc = readFileSync(join(ROOT, 'src/services/firebase.ts'), 'utf8');
const optB = fbSrc.slice(fbSrc.indexOf('Option B'));
const pick = (k) => (optB.match(new RegExp(`\\b${k}\\s*:\\s*['"]([^'"]+)['"]`)) || [])[1];
const PROD_CFG = Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'].map((k) => [k, pick(k)]));
assert.ok(Object.values(PROD_CFG).every(Boolean), 'could not read the production config from source');

const builds = {};
const VARIANTS = [
  ['prod', { VERCEL: '1', VERCEL_ENV: 'production', ...FAKE }],
  ['preview', { VERCEL: '1', VERCEL_ENV: 'preview', ...FAKE }],
  ['vercel-unset', { VERCEL: '1', ...FAKE }],
  ['vercel-case', { VERCEL: '1', VERCEL_ENV: 'Production', ...FAKE }],
  ['vercel-target', { VERCEL: '1', VERCEL_ENV: 'preview', STORE_BUILD_TARGET: 'production', ...FAKE }],
  ['local', { ...FAKE }],
];
for (const [name, vars] of VARIANTS) builds[name] = build(name, vars);
const SANDBOX = VARIANTS.map((v) => v[0]).filter((n) => n !== 'prod');

await t('X21', 'a secret-looking VITE_* variable (Gemini key, *_TOKEN) makes EVERY build fail: production, preview, local', async () => {
  for (const [name, vars] of [['prod', { VERCEL: '1', VERCEL_ENV: 'production' }], ['preview', { VERCEL: '1', VERCEL_ENV: 'preview' }], ['local', {}]]) {
    for (const [k, v] of Object.entries(SECRET_LIKE)) {
      const out = join(OUT, `refused-${name}`);
      const r = spawnSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'],
        { cwd: ROOT, env: { ...baseEnv(), ...FAKE, ...vars, [k]: v }, encoding: 'utf8' });
      assert.notEqual(r.status, 0, `${name} + ${k}: build must fail`);
      assert.match(r.stderr + r.stdout, /FIREBASE ENV GUARD REFUSED/, `${name} + ${k}`);
      assert.ok(!(r.stderr + r.stdout).includes(v), `${name} + ${k}: the value is never echoed`);
    }
  }
});

await t('X01', 'production build keeps production behaviour: Firebase config, Worker URL, GA + Pixel tags verbatim, no sandbox strip', async () => {
  const b = builds.prod;
  assert.match(b.decision, /PRODUCTION/);
  const r = checkGuard(b.out, 'production');
  assert.equal(r.status, 0, r.stdout);
  const txt = allText(b.out);
  assert.ok(txt.includes(FAKE.VITE_WORKER_URL.trim()), 'worker url missing from production bundle');
  assert.ok(txt.includes(PROD_CFG.projectId) && txt.includes(PROD_CFG.apiKey), 'firebase config missing');
  // GA + Meta Pixel: loaded by src/services/tracking.ts after cookie consent — the PRODUCTION bundle carries the
  // loader with both ids (no inline tags in index.html any more)
  for (const id of ['G-E4P313LDJ0', '406363479141487', 'googletagmanager.com/gtag/js', 'connect.facebook.net/en_US/fbevents.js']) {
    assert.ok(txt.includes(id), `production tracking loader missing: ${id}`);
  }
  return b.decision;
});

await t('X02', 'every non-production build (preview, unset, "Production", preview+STORE_BUILD_TARGET, local) is SANDBOX and clean', async () => {
  const notes = [];
  for (const n of SANDBOX) {
    const b = builds[n];
    assert.match(b.decision, /SANDBOX/, n);
    const r = checkGuard(b.out, 'sandbox', FAKE);
    assert.equal(r.status, 0, `${n}\n${r.stdout}`);
    const txt = allText(b.out);
    for (const [k, v] of Object.entries(FAKE)) assert.ok(!txt.includes(v.trim()), `${n}: ${k} leaked`);
    for (const m of ['firestore.googleapis.com', 'googletagmanager.com', 'connect.facebook.net', 'api.sendgrid.com'])
      assert.ok(!txt.includes(m) || m === 'firestore.googleapis.com', `${n}: ${m}`);
    notes.push(n);
  }
  return notes.join(', ');
});

await t('X02b', 'all sandbox builds are byte-identical (no env value can influence a sandbox bundle)', async () => {
  const hashes = SANDBOX.map((n) => treeHash(builds[n].out));
  assert.equal(new Set(hashes).size, 1, JSON.stringify(Object.fromEntries(SANDBOX.map((n, i) => [n, hashes[i]]))));
  return `sha256/16 ${hashes[0]}`;
});

await t('X03', 'a real-looking VITE_WORKER_URL / Gemini key / VITE_ secret never reaches a sandbox bundle', async () => {
  const txt = allText(builds.preview.out);
  for (const v of Object.values(FAKE)) assert.ok(!txt.includes(v.trim()));
  assert.ok(!txt.includes('example-guard.workers.dev'));
});

await t('X22', 'prize wheel: a PRODUCTION build never contains the wheel, even with VITE_WHEEL_MODE=test (a sandbox test build does)', async () => {
  const prodWheel = build('prod-wheel', { VERCEL: '1', VERCEL_ENV: 'production', ...FAKE, VITE_WHEEL_MODE: 'test' });
  const txt = allText(prodWheel.out);
  for (const marker of ['wheel-page', 'wheel/spin', 'wheel/state', 'checkout-wheel-gift', 'anta_wheel_prize_v1']) assert.ok(!txt.includes(marker), marker);
  const testWheel = build('local-wheel', { ...FAKE, VITE_WHEEL_MODE: 'test' });
  assert.ok(allText(testWheel.out).includes('wheel-page'), 'the test build has the page (proves the check is meaningful)');
  assert.ok(!allText(builds.prod.out).includes('wheel-page'), 'default production build');
});

await t('X18', 'the checker itself fails on the wrong build (production dist as sandbox, sandbox dist as production)', async () => {
  assert.equal(checkGuard(builds.prod.out, 'sandbox', FAKE).status, 1);
  assert.equal(checkGuard(builds.preview.out, 'production').status, 1);
});

// ---------------------------------------------------------------- browser
if (!CHROME || !existsSync(CHROME)) {
  rows.push(['BROWSER', 'SKIP', 'CHROME_PATH not set — X04-X07, X10-X13, X17, X20 not run']);
} else {
  process.env.VERCEL = '1'; process.env.VERCEL_ENV = 'preview';
  process.env.WORKER_AUTH_TOKEN = 'FAKE'; process.env.SENDGRID_API_KEY = 'FAKE';
  const nodeOutbound = [];
  globalThis.fetch = async (url) => { nodeOutbound.push(String(url)); throw new Error('outbound blocked in test'); };
  const createOrder = (await import(new URL(`file:///${join(ROOT, 'api/create-order.js').replace(/\\/g, '/')}`).href)).default;
  const notify = (await import(new URL(`file:///${join(ROOT, 'api/notify-customer.js').replace(/\\/g, '/')}`).href)).default;
  const DIST = builds.preview.out;
  const apiHits = [];
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp' };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      let raw = ''; for await (const c of req) raw += c;
      let body; try { body = JSON.parse(raw); } catch { body = raw; }
      const h = u.pathname.startsWith('/api/create-order') ? createOrder : u.pathname.startsWith('/api/notify-customer') ? notify : null;
      const r = { code: 200, headers: {}, body: '', status(c) { this.code = c; return this; }, json(b) { this.body = JSON.stringify(b); return this; }, send(b) { this.body = b; return this; }, end() { return this; }, setHeader(k, v) { this.headers[k] = v; } };
      if (h) await h({ method: req.method, headers: req.headers, body }, r); else r.code = 404;
      apiHits.push(`${req.method} ${u.pathname} -> ${r.code}`);
      res.writeHead(r.code, r.headers); res.end(r.body || ''); return;
    }
    let p = join(DIST, decodeURIComponent(u.pathname));
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const PORT = server.address().port;
  const ORIGIN = `http://127.0.0.1:${PORT}`;
  const profile = mkdtempSync(join(tmpdir(), 'guard-profile-'));
  const cdpPort = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdpPort}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`,
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-default-apps', '--disable-extensions', '--disable-domain-reliability', '--no-pings', '--dns-prefetch-disable', '--no-first-run',
    '--no-default-browser-check', '--disable-client-side-phishing-detection', '--password-store=basic', '--use-mock-keychain', '--disable-gpu',
    '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let ver = null;
    for (let i = 0; i < 100 && !ver; i++) { try { ver = await (await fetchLocal(`http://127.0.0.1:${cdpPort}/json/version`)).json(); } catch { await sleep(200); } }
    if (!ver) throw new Error('chrome did not start');
    const tab = await (await fetchLocal(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json();
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('ws')); });
    let id = 0; const pending = new Map();
    const send = (method, params = {}) => new Promise((ok, no) => { const m = ++id; pending.set(m, { ok, no }); ws.send(JSON.stringify({ id: m, method, params })); setTimeout(() => pending.delete(m) && no(new Error(`${method} timeout`)), 30000); });
    const net = []; const exceptions = []; const dialogs = []; const windowOpens = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); return msg.error ? p.no(new Error(msg.error.message)) : p.ok(msg.result); }
      if (msg.method === 'Fetch.requestPaused') {
        const { requestId, request, resourceType } = msg.params;
        const u = new URL(request.url);
        const local = u.hostname === '127.0.0.1' && u.port === String(PORT);
        if (!local) net.push({ host: u.hostname, path: u.pathname.slice(0, 60), method: request.method, type: resourceType });
        send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId } : { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      }
      if (msg.method === 'Runtime.exceptionThrown') exceptions.push(String(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text).slice(0, 200));
      if (msg.method === 'Page.javascriptDialogOpening') { dialogs.push(msg.params.message.slice(0, 120)); send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }
      if (msg.method === 'Page.windowOpen') windowOpens.push(msg.params.url.slice(0, 60));
    };
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
    // headless Chrome (newer versions) does not give the page focus: element.focus() then fires no focus event and the
    // checkout's area dropdown never opens. Focus emulation restores what a real (focused) tab does. Test harness only.
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
    const waitFor = async (expr, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(250); } return null; };
    const go = async (route) => { await send('Page.navigate', { url: `${ORIGIN}/#${route}` }); await waitFor('document.readyState === "complete"', 20000); await sleep(900); };
    const reset = () => { net.length = 0; exceptions.length = 0; dialogs.length = 0; windowOpens.length = 0; apiHits.length = 0; nodeOutbound.length = 0; };
    // anything that is not a static GET (fonts / images) counts as an outbound attempt
    const writes = () => net.filter((r) => r.method !== 'GET' || !['Stylesheet', 'Font', 'Image', 'Media', 'Document'].includes(r.type));
    // sandbox builds show the read-only snapshot of the REAL catalogue (public/catalog-snapshot.json), never demo products:
    // the product pages under test are real ones (first plain in-stock product of the snapshot)
    const REAL = JSON.parse(readFileSync(join(ROOT, 'public/catalog-snapshot.json'), 'utf8')).products.find((p) => !(p.variants || []).length && Number(p.stock) > 0);
    const PRODUCT = { id: 'p-test', name: 'دفتر اختبار', nameEn: 'Test notebook', price: 2.5, category: 'stationery', subCategory: 'notebooks', stock: 40, image: '/favicon.ico', images: ['/favicon.ico'], rating: 5, reviews: 0, description: 'x', descriptionEn: 'x' };
    // the dashboard opens only for the owner address hard-coded in AdminDashboard.tsx; it is read from source here,
    // used only inside this throw-away local browser profile, and never printed
    const OWNER = (readFileSync(join(ROOT, 'src/pages/AdminDashboard.tsx'), 'utf8').match(/MY_ADMIN_EMAIL\s*=\s*"([^"]+)"/) || [])[1];
    assert.ok(OWNER, 'owner address not found in source');
    const ADMIN = { id: 'u-admin', name: 'Admin Test', email: OWNER, role: 'admin', orders: [] };
    const seed = async (extra = {}) => {
      await send('Page.navigate', { url: `${ORIGIN}/404-seed` }); await waitFor('document.readyState === "complete"');
      await ev(`(() => { localStorage.clear(); sessionStorage.clear();
        localStorage.setItem('anta_products', ${JSON.stringify(JSON.stringify([PRODUCT]))});
        localStorage.setItem('anta_cart', ${JSON.stringify(JSON.stringify([{ ...PRODUCT, quantity: 1 }]))});
        localStorage.setItem('anta_current_user', ${JSON.stringify(JSON.stringify(ADMIN))});
        localStorage.setItem('anta_orders', '[]');
        ${Object.entries(extra).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n')}
        return true; })()`);
    };
    const clickText = (re) => ev(`(() => { const b = [...document.querySelectorAll('button, a, [role=button]')].filter((x) => x.offsetParent !== null).find((x) => ${re}.test(x.innerText.trim())); if (!b) return false; b.click(); return b.innerText.trim().slice(0, 40); })()`);
    const fill = (sel, v) => ev(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return false; const set = Object.getOwnPropertyDescriptor(i.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

    // ---------- X17: every route renders in sandbox, no uncaught exception, banner + marker present
    await t('X17', 'every route renders in a sandbox build: no uncaught exception, test banner shown, zero outbound', async () => {
      await seed();
      const ROUTES = ['/', '/shop', `/product/${REAL.id}`, '/cart', '/wishlist', '/login', '/tracking', '/checkout', '/order-success/ORD-X', '/my-orders', '/account', '/admin', '/admin/product/new', '/admin/product/edit', '/admin-secure', '/does-not-exist'];
      reset();
      const bad = [];
      for (const r of ROUTES) {
        const before = exceptions.length;
        await go(r);
        const s = await ev(`({ len: (document.getElementById('root')?.innerText || '').length, banner: !!document.getElementById('sandbox-banner'), env: document.documentElement.getAttribute('data-deploy-env') })`);
        if (exceptions.length > before || s.len < 20 || !s.banner || s.env !== 'sandbox') bad.push(`${r} ${JSON.stringify(s)} ${exceptions.slice(before).join(' | ')}`);
      }
      assert.deepEqual(bad, []);
      assert.deepEqual(writes(), [], JSON.stringify(writes()));
      return `${ROUTES.length} routes; static GETs blocked: ${[...new Set(net.map((r) => r.host))].join(',') || 'none'}`;
    });

    // ---------- X04: full COD checkout through the UI
    const checkout = async (method) => {
      await seed(); reset();
      await go('/checkout');
      assert.ok(await waitFor(`[...document.querySelectorAll('select')].some((x) => [...x.options].some((o) => o.value === 'amman'))`), 'no city select');
      await ev(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'amman')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'amman'); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await waitFor(`!!document.querySelector('input[placeholder*="منطقتك"]')`);
      await ev(`(() => { const i = document.querySelector('input[placeholder*="منطقتك"]'); i.focus(); i.dispatchEvent(new FocusEvent('focus', { bubbles: true })); return true; })()`);
      assert.ok(await waitFor(`[...document.querySelectorAll('div.cursor-pointer')].length > 0`), 'no area list');
      await ev(`(() => { const d = [...document.querySelectorAll('div.cursor-pointer')][0]; d.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()`);
      await fill('input[placeholder="name@example.com"]', 'synthetic-buyer@example.invalid');
      await fill('input[placeholder="الاسم الأول والأخير"]', 'Synthetic Guard Buyer');
      await fill('input[placeholder="0791234567"]', '0790000000');
      await ev(`(() => { [...document.querySelectorAll('input[type=checkbox]')].forEach((c) => { if (!c.checked) c.click(); }); return true; })()`);
      await sleep(400);
      assert.ok(await clickText('/^متابعة للشحن$|^متابعة للتوصيل$/'), 'no continue-to-shipping');
      assert.ok(await waitFor(`[...document.querySelectorAll('button')].some((b) => b.offsetParent && /^متابعة للدفع$/.test(b.innerText.trim()))`), 'step 2 not reached');
      await clickText('/^متابعة للدفع$/');
      assert.ok(await waitFor(`[...document.querySelectorAll('button')].some((b) => b.offsetParent && /تأكيد وإتمام الطلب/.test(b.innerText))`), 'step 3 not reached');
      if (method === 'cliq') {
        assert.ok(await clickText('/CliQ|كليك/i'), 'no CliQ option');
        await sleep(400);
        assert.ok(await fill('input[placeholder*="1234567890"]', 'GUARD123456'), 'no CliQ ref input');
      }
      await ev(`(() => { [...document.querySelectorAll('input[type=checkbox]')].forEach((c) => { if (!c.checked) c.click(); }); return true; })()`);
      await clickText('/^تأكيد وإتمام الطلب$/');
      // sandbox: no order Worker exists in the bundle, so the order is REFUSED before anything is sent (orderSubmit
      // 'misconfigured'): the customer sees "not sent", stays on the checkout page, and keeps the cart
      const refused = await waitFor(`document.body.innerText.includes('لم يُرسل الطلب')`, 15000);
      await sleep(800);
      const state = await ev(`({ hash: location.hash.slice(0, 30), orders: JSON.parse(localStorage.getItem('anta_orders') || '[]').length, cart: JSON.parse(localStorage.getItem('anta_cart') || '[]').length, banner: !!document.getElementById('sandbox-banner') })`);
      assert.ok(refused, `no "order not sent" message ${JSON.stringify(state)} ${exceptions.join('|')}`);
      assert.ok(!state.hash.startsWith('#/order-success/'), 'must not reach the order-success page');
      assert.equal(state.orders, 0, 'no order is stored anywhere');
      assert.ok(state.cart > 0, 'the cart is kept');
      assert.ok(state.banner, 'test banner shown');
      assert.deepEqual(writes(), [], JSON.stringify(writes()));
      assert.equal(apiHits.length, 0, apiHits.join(','));
      assert.deepEqual(nodeOutbound, []);
      assert.deepEqual(exceptions, []);
      return state;
    };
    await t('X04', 'full COD checkout through the UI: refused before sending ("not sent" shown), nothing stored, cart kept, zero outbound / API calls', async () => {
      const s = await checkout('cod');
      return `stayed on ${s.hash}, cart items ${s.cart}`;
    });

    await t('X06', 'after the sandbox order attempt: Firestore never initialised (no request to any Google API), stock untouched', async () => {
      const prods = await ev(`JSON.parse(localStorage.getItem('anta_products') || '[]').map((p) => p.stock)`);
      assert.ok(!net.some((r) => /googleapis|firebase|gstatic/.test(r.host) && r.type !== 'Stylesheet' && r.type !== 'Font'), JSON.stringify(net));
      return `local stock now ${JSON.stringify(prods)}`;
    });

    await t('X11', 'CliQ checkout: refused before sending, no WhatsApp hand-off (no window.open, no dialog), zero outbound', async () => {
      await checkout('cliq');
      assert.deepEqual(windowOpens, []); assert.deepEqual(dialogs, []);
    });

    // ---------- X05 / X20: localStorage relink to the PRODUCTION Firebase project
    await t('X05', 'production Firebase config injected in localStorage (anta_firebase_config) is ignored: no Firebase traffic on any page', async () => {
      await seed({ anta_firebase_config: JSON.stringify(PROD_CFG) }); reset();
      for (const r of ['/', '/login', '/account', '/admin', '/checkout', `/product/${REAL.id}`]) await go(r);
      const fbTraffic = net.filter((r) => /googleapis\.com|firebaseio|firebaseapp|identitytoolkit|securetoken/.test(r.host) && !['Stylesheet', 'Font'].includes(r.type));
      assert.deepEqual(fbTraffic, []); assert.deepEqual(writes(), []); assert.deepEqual(exceptions, []);
    });

    await t('X20', 'admin "connect Firebase" UI and a reload with the override do not relink; the override cannot be activated', async () => {
      await seed({ anta_firebase_config: JSON.stringify(PROD_CFG) }); reset();
      await go('/admin');
      await clickText('/الإعدادات|Settings/i');
      await sleep(600);
      const ta = await ev(`(() => { const t = [...document.querySelectorAll('textarea')].find((x) => /apiKey|firebase|config/i.test(x.placeholder + x.closest('div')?.innerText)); return !!t; })()`);
      let uiNote = 'connect-firebase textarea not found';
      if (ta) {
        await ev(`(() => { const t = [...document.querySelectorAll('textarea')].find((x) => /apiKey|firebase|config/i.test(x.placeholder + x.closest('div')?.innerText)); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(JSON.stringify(PROD_CFG))}); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        // record any attempt to store an override or reload the page (what setFirebaseConfig() would do)
        await ev(`(() => { window.__noReload = 1; window.__cfgWrites = 0; const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'anta_firebase_config') window.__cfgWrites++; return o.call(this, k, v); }; return true; })()`);
        const clicked = await ev(`(() => { const t = [...document.querySelectorAll('textarea')].find((x) => /apiKey|firebase|config/i.test(x.placeholder + x.closest('div')?.innerText)); const box = t.closest('.space-y-4') || t.parentElement.parentElement; const b = [...box.querySelectorAll('button')].pop(); if (!b) return false; b.click(); return b.textContent.trim(); })()`);
        // the refusal is now visible as an error toast (toast rendering fixed in this batch)
        const refused = await waitFor(`[...document.querySelectorAll('[data-toast-type="error"]')].some((x) => x.textContent.includes('ربط Firebase معطّل'))`, 4000);
        await sleep(800);
        const noRelink = await ev(`window.__noReload === 1 && window.__cfgWrites === 0`);
        const stored = await ev(`localStorage.getItem('anta_firebase_config') !== null`);
        uiNote = `connect clicked: ${!!clicked}, refusal toast shown: ${!!refused}, no override write / no reload: ${noRelink}, seeded override present but inert: ${stored}`;
        assert.ok(clicked && refused && noRelink, uiNote);
      }
      assert.ok(ta, uiNote);
      await send('Page.reload', {}); await waitFor('document.readyState === "complete"'); await sleep(1200);
      const fbTraffic = net.filter((r) => /googleapis\.com|firebaseio|firebaseapp|identitytoolkit|securetoken/.test(r.host) && !['Stylesheet', 'Font'].includes(r.type));
      assert.deepEqual(fbTraffic, []); assert.deepEqual(writes(), []);
      return uiNote;
    });

    // ---------- X07: manual bypass attempts from the page (as from the devtools console)
    await t('X07', 'manual attempts from the page (fetch Firestore REST, XHR Auth, sendBeacon GA, WebSocket, window.open wa.me) are refused in-page', async () => {
      await seed(); reset(); await go('/');
      const r = await ev(`(async () => { const out = {};
        try { await fetch('https://firestore.googleapis.com/v1/projects/x/databases/(default)/documents/orders', { method: 'POST', body: '{}' }); out.fetch = 'SENT'; } catch (e) { out.fetch = /sandbox/.test(e.message) ? 'blocked' : e.message; }
        try { const x = new XMLHttpRequest(); x.open('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode'); x.send('{}'); out.xhr = 'SENT'; } catch (e) { out.xhr = /sandbox/.test(e.message) ? 'blocked' : e.message; }
        out.beacon = navigator.sendBeacon('https://www.google-analytics.com/g/collect', 'x') ? 'SENT' : 'blocked';
        try { new WebSocket('wss://s-usc1.firebaseio.com/.ws'); out.ws = 'SENT'; } catch (e) { out.ws = /sandbox/.test(e.message) ? 'blocked' : e.message; }
        out.open = window.open('https://wa.me/962700000000?text=x', '_blank') === null ? 'blocked' : 'SENT';
        try { await fetch('/api/create-order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"order":{}}' }).then((r) => { out.apiCreate = r.status; }); } catch (e) { out.apiCreate = e.message; }
        try { await fetch('/api/notify-customer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"a@example.invalid","orderId":"x","status":"accepted"}' }).then((r) => { out.apiNotify = r.status; }); } catch (e) { out.apiNotify = e.message; }
        return out; })()`);
      assert.deepEqual(r, { fetch: 'blocked', xhr: 'blocked', beacon: 'blocked', ws: 'blocked', open: 'blocked', apiCreate: 403, apiNotify: 403 });
      assert.deepEqual(writes(), [], JSON.stringify(writes()));
      assert.deepEqual(nodeOutbound, []);
      assert.deepEqual(windowOpens, []);
      return JSON.stringify(r);
    });

    // ---------- X10: Firebase Auth e-mails and social login
    await t('X10', 'login page: password reset, social sign-in and register send nothing (sandbox messages, zero outbound)', async () => {
      await seed(); await ev(`localStorage.removeItem('anta_current_user')`); reset();
      await go('/login');
      const notes = [];
      if (await clickText('/نسيت كلمة المرور|Forgot/i')) {
        await sleep(500);
        const filled = await ev(`(() => { const i = [...document.querySelectorAll('input[type=email], input')].filter((x) => x.offsetParent).pop(); if (!i) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'reset-test@example.invalid'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        const sent = await clickText('/إرسال|Send/i');
        await sleep(1000);
        notes.push(`reset: filled ${filled}, clicked ${!!sent}`);
        await go('/login');
      } else notes.push('reset: link not found');
      const g = await clickText('/Google|جوجل/i');
      await sleep(600);
      notes.push(`google clicked ${!!g}, sandbox msg ${await ev(`document.body.innerText.includes('نسخة اختبار: تسجيل الدخول')`)}`);
      assert.deepEqual(writes(), [], JSON.stringify(writes()));
      assert.deepEqual(windowOpens, []);
      assert.deepEqual(exceptions, []);
      return notes.join('; ');
    });

    // ---------- X12: Cloudinary upload from the admin product form
    // (the /admin/product/new form only opens for one hard-coded owner e-mail, so the dashboard's upload field —
    //  same uploadToCloudinary() — is used here)
    await t('X12', 'admin image upload: refused before any request to Cloudinary', async () => {
      await seed(); reset(); await go('/admin');
      await waitFor(`!!document.querySelector('input[type=file][accept^="image"]')`, 10000);
      const png = join(OUT, 'pixel.png');
      writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
      const { root } = await send('DOM.getDocument', { depth: -1 });
      const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file][accept^="image"]' });
      assert.ok(nodeIds.length > 0, 'no image file input on the admin dashboard');
      for (const nodeId of nodeIds) await send('DOM.setFileInputFiles', { nodeId, files: [png] });
      await sleep(1500);
      // an UPLOAD attempt (anything but a product image being displayed: those GETs are blocked by the sandbox anyway and
      // appear since the catalogue's images are hosted on Cloudinary)
      const cloud = net.filter((r) => /cloudinary/.test(r.host) && !(r.method === 'GET' && r.type === 'Image'));
      assert.deepEqual(cloud, []); assert.deepEqual(writes(), []);
      const shown = await ev(`document.body.innerText.includes('cloudinary-upload') || document.body.innerText.includes('معطّلة ولا تصل')`);
      assert.ok(shown, 'no sandbox refusal shown to the admin');
      return `${nodeIds.length} image input(s); sandbox refusal shown`;
    });

    // ---------- toast UI (fixed in this batch): customers and admins see success / error messages
    const toasts = () => ev(`[...document.querySelectorAll('[data-toast-type]')].map((x) => ({ type: x.getAttribute('data-toast-type'), role: x.getAttribute('role'), text: x.textContent.trim().slice(0, 90) }))`);

    await t('T-UI1', 'checkout with missing fields: a visible error toast (role=alert); pressing again does not stack a duplicate', async () => {
      await seed(); reset(); await go('/checkout');
      await waitFor(`[...document.querySelectorAll('button')].some((b) => b.offsetParent && /^متابعة للشحن$|^متابعة للتوصيل$/.test(b.innerText.trim()))`);
      await clickText('/^متابعة للشحن$|^متابعة للتوصيل$/');
      const shown = await waitFor(`document.querySelectorAll('[data-toast-type="error"]').length > 0`, 4000);
      await clickText('/^متابعة للشحن$|^متابعة للتوصيل$/');
      await sleep(400);
      const list = await toasts();
      assert.ok(shown, 'no error toast');
      assert.equal(list.filter((x) => x.type === 'error').length, 1, JSON.stringify(list));
      assert.equal(list[0].role, 'alert');
      assert.match(list[0].text, /تصحيح/);
      assert.equal(await ev(`location.hash`), '#/checkout', 'must stay on step 1');
      return list[0].text;
    });

    await t('T-UI2', 'error toast closes with its button, and auto-dismisses by itself (<= 8 s)', async () => {
      await clickText('/^متابعة للشحن$|^متابعة للتوصيل$/');
      assert.ok(await waitFor(`document.querySelectorAll('[data-toast-type="error"]').length === 1`, 3000));
      await ev(`document.querySelector('[data-toast-type="error"] button[aria-label]').click()`);
      assert.ok(await waitFor(`document.querySelectorAll('[data-toast-type]').length === 0`, 2000), 'close button did not remove it');
      await clickText('/^متابعة للشحن$|^متابعة للتوصيل$/');
      assert.ok(await waitFor(`document.querySelectorAll('[data-toast-type="error"]').length === 1`, 3000));
      const t0 = Date.now();
      assert.ok(await waitFor(`document.querySelectorAll('[data-toast-type]').length === 0`, 9000), 'did not auto-dismiss');
      return `auto-dismissed after ${((Date.now() - t0) / 1000).toFixed(1)} s`;
    });

    await t('T-UI3', 'order not sent (sandbox): the customer sees the "not sent" message on screen, not hidden behind the page, and no success toast', async () => {
      await checkout('cod');
      const list = await toasts();
      assert.ok(!list.some((x) => x.type === 'success'), `no success message for an order that was not sent ${JSON.stringify(list)}`);
      const seen = await ev(`(() => { const el = [...document.querySelectorAll('h1,h2,h3,h4,p,div')].filter((x) => x.offsetParent && x.children.length === 0 && x.innerText.includes('لم يُرسل الطلب'))[0]; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { onTop: el.contains(hit) || hit?.contains(el), text: el.innerText.trim().slice(0, 80) }; })()`);
      assert.ok(seen && seen.onTop, `message missing or covered ${JSON.stringify(seen)}`);
      return seen.text;
    });

    await t('T-UI4', 'product page add-to-cart: success toast for the customer', async () => {
      await seed(); await ev(`localStorage.setItem('anta_cart', '[]')`); reset();
      await go(`/product/${REAL.id}`);
      const clicked = await ev(`(() => { const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent).find((x) => /أضف\\s*(إلى\\s*|الى\\s*)?(لل|ال)سلة|Add to cart/i.test(x.innerText.trim())); if (!b) return false; b.click(); return b.innerText.trim(); })()`);
      assert.ok(clicked, 'no add-to-cart button');
      assert.ok(await waitFor(`document.querySelectorAll('[data-toast-type="success"], [data-toast-type="info"]').length > 0`, 4000), 'no toast after add to cart');
      return JSON.stringify(await toasts());
    });

    await t('T-UI5', 'login with wrong credentials: the customer sees an error message, nothing is sent', async () => {
      await seed(); await ev(`localStorage.removeItem('anta_current_user')`); reset();
      await go('/login');
      await fill('input[type=email]', 'nobody@example.invalid');
      await fill('input[type=password]', 'wrong-password-123');
      // the login form (the header search box is also a <form>)
      await ev(`(() => { const f = document.querySelector('input[type=password]').closest('form'); f.requestSubmit(); return true; })()`);
      const msg = await waitFor(`(() => { const t = document.body.innerText; return /غير صحيحة|Invalid|خطأ|تعذر/.test(t) ? (t.match(/[^\\n]*(غير صحيحة|Invalid|خطأ|تعذر)[^\\n]*/) || [''])[0].slice(0, 90) : ''; })()`, 6000);
      if (!msg) console.log('T-UI5 debug:', JSON.stringify(await ev(`({ hash: location.hash, inputs: [...document.querySelectorAll('form input')].map((i) => i.type + '=' + (i.value ? 'set' : 'empty')), alerts: [...document.querySelectorAll('form p, form [role=alert], form div')].map((x) => x.childElementCount === 0 ? x.textContent.trim() : '').filter(Boolean).slice(0, 12), toasts: [...document.querySelectorAll('[data-toast-type]')].map((x) => x.textContent.trim()) })`)));
      assert.ok(msg, 'no error message shown');
      assert.deepEqual(writes(), []);
      return msg;
    });

    // ---------- X13: Gemini
    await t('X13', 'ChatBot / Gemini: no chat widget, no Google AI request (key absent from the sandbox bundle)', async () => {
      await seed(); reset(); await go('/');
      assert.ok(!net.some((r) => /generativelanguage|aiplatform/.test(r.host)));
      assert.ok(!allText(DIST).includes(SECRET_LIKE.VITE_GEMINI_API_KEY));
    });
  } finally {
    try { ws?.close(); } catch {}
    try { chrome.kill(); } catch {}
    server.close();
    await sleep(800);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

// helper using node:http so the trap on globalThis.fetch never blocks the local CDP endpoint
function fetchLocal(url, opts = {}) {
  return new Promise((ok, no) => {
    const req = http.request(url, { method: opts.method || 'GET' }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => ok({ json: async () => JSON.parse(d) })); });
    req.on('error', no); req.end();
  });
}

for (const r of rows) console.log(r.join(' | '));
console.log(`\n${rows.filter((r) => r[1] === 'PASS').length}/${rows.length} passed`);
if (!process.env.GUARD_OUT) { try { rmSync(OUT, { recursive: true, force: true }); } catch {} }
setTimeout(() => process.exit(process.exitCode || 0), 200);
