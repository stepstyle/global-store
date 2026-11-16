// Cloudflare Turnstile client (src/services/turnstile.ts) — LOCAL ONLY: fake Turnstile API, fake clock, fake document.
//   node --test tests/unit/turnstile.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnstileController, loadTurnstile, siteKeyFrom, TOKEN_MAX_AGE_MS, TURNSTILE_SCRIPT_URL, _resetTurnstileLoaderForTests } from '../../src/services/turnstile.ts';
import { submitOrder } from '../../src/services/orderSubmit.ts';

/** fake widget: issue(token) simulates Cloudflare solving the challenge */
function fakeApi() {
  const api = {
    opts: null, resets: 0, removed: 0,
    render(el, opts) { api.opts = opts; return 'w1'; },
    reset() { api.resets++; },
    remove() { api.removed++; },
    issue(t) { api.opts.callback(t); },
  };
  return api;
}
let clock;
const now = () => clock;
beforeEach(() => { clock = 1_000_000; _resetTurnstileLoaderForTests(); });

test('site key: public keys only (real 0x… / test 1x…); anything else = Turnstile not used', () => {
  assert.equal(siteKeyFrom('1x00000000000000000000AA'), '1x00000000000000000000AA');
  assert.equal(siteKeyFrom(' 0x4AAAAAAABkMYinukE8nzYS '), '0x4AAAAAAABkMYinukE8nzYS');
  for (const bad of ['', undefined, null, 'secret', '1x0000000000000000000000000000000AA x', 'https://evil', 'x'.repeat(80)]) assert.equal(siteKeyFrom(bad), '', String(bad));
});

test('each send gets a FRESH token; a token is never handed out twice; the widget is reset after each use', async () => {
  const api = fakeApi();
  const c = createTurnstileController({ api, container: {}, siteKey: '1x00000000000000000000AA', now, waitMs: 1000 });
  assert.equal(api.opts.sitekey, '1x00000000000000000000AA');
  api.issue('tok-1');
  assert.equal(await c.getToken(), 'tok-1');
  assert.equal(api.resets, 1, 'reset after use -> the widget produces the next token');
  const second = c.getToken(); // nothing ready yet: waits for the widget
  api.issue('tok-2');
  assert.equal(await second, 'tok-2');
  assert.equal(c.status(), 'ready');
});

test('expired / old tokens are never returned; a new one is awaited instead', async () => {
  const api = fakeApi();
  const c = createTurnstileController({ api, container: {}, siteKey: '1x00000000000000000000AA', now, waitMs: 1000 });
  api.issue('old');
  clock += TOKEN_MAX_AGE_MS + 1;
  const p = c.getToken();
  api.issue('new');
  assert.equal(await p, 'new');
  api.issue('x');
  api.opts['expired-callback']();
  assert.equal(c.status(), 'expired');
  const q = c.getToken();
  api.issue('after-expiry');
  assert.equal(await q, 'after-expiry');
});

test('fail-safe: widget error -> null (nothing to send with); no token in time -> null', async () => {
  const api = fakeApi();
  const c = createTurnstileController({ api, container: {}, siteKey: '1x00000000000000000000AA', now, waitMs: 30 });
  assert.equal(await c.getToken(), null, 'timeout');
  const p = c.getToken();
  api.opts['error-callback']('300030');
  assert.equal(await p, null);
  assert.equal(c.status(), 'error');
  const broken = createTurnstileController({ api: { render() { throw new Error('boom'); }, reset() {} }, container: {}, siteKey: '1x00000000000000000000AA' });
  assert.equal(await broken.getToken(), null);
  assert.equal(broken.status(), 'error');
});

test('script loader: official explicit-render URL, loaded once; load failure rejects (and can be retried)', async () => {
  const appended = [];
  const win = { document: { createElement: () => ({}), head: { appendChild: (s) => appended.push(s) } } };
  const p = loadTurnstile(win, 1000);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, TURNSTILE_SCRIPT_URL);
  assert.equal(TURNSTILE_SCRIPT_URL, 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  win.turnstile = fakeApi();
  appended[0].onload();
  assert.equal(await p, win.turnstile);
  _resetTurnstileLoaderForTests();
  const win2 = { document: { createElement: () => ({}), head: { appendChild: (s) => setTimeout(() => s.onerror(), 0) } } };
  await assert.rejects(loadTurnstile(win2, 1000), /failed to load/);
  await assert.rejects(loadTurnstile({ document: { createElement: () => ({}), head: { appendChild() {} } } }, 20), /timeout/);
});

test('with orderSubmit: the token comes from the widget per attempt and is sent in the body (never the secret)', async () => {
  const api = fakeApi();
  const c = createTurnstileController({ api, container: {}, siteKey: '1x00000000000000000000AA', now, waitMs: 1000 });
  api.issue('XXXX.DUMMY.TOKEN.XXXX');
  const bodies = [];
  const fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ok: true, orderId: bodies[0].order.id, replay: false }) };
  };
  const order = { id: 'ORD-ABCD1234-XYZ1', userId: 'guest', items: [{ productId: 'p', quantity: 1, price: 1 }], total: 2, address: { fullName: 'x', phone: '+962790000000' }, paymentMethod: 'cod' };
  const r = await submitOrder(order, { workerUrl: 'http://127.0.0.1:8789', getTurnstileToken: c.getToken }, { fetch, sleep: async () => {} });
  assert.equal(r.kind, 'confirmed');
  assert.equal(bodies[0].turnstileToken, 'XXXX.DUMMY.TOKEN.XXXX');
  assert.equal(api.resets, 1, 'used token discarded');
});
