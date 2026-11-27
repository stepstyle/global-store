// E2E_SUITE=wheel — the automatic popup and the result window (part of the wheel suite, same local stack).
//   WU11  any page opens it by itself for a new visitor (home, shop, product, about) — desktop + phone; at once (the
//         campaign answer is used, ONE /wheel/public request); large X; the button reopens it at once; moving around /
//         reloading never reopens it; a NEW campaign opens it again; a STOPPED or ENDED campaign shows nothing
//   WU12  never over the order flow: a visitor landing on checkout gets no popup (it opens later, once, on a normal
//         page); open popup + going to checkout closes it; another open window (aria-modal) makes it wait
//   WU13  slow / failing Worker: no popup before the answer, then it opens; a failed check is asked again in the
//         background and the popup opens when it answers; the wheel page shows a clear error + "try again" that works
//   WU14  WIN -> result window in the middle of the screen (iPhone SE 375x667 + desktop): the server's prize, on the
//         segment the wheel stopped on, no scroll, not covered, 48 px X, confetti only when motion is allowed; shown ONCE
//         (reopened popup: the result box only), the prize kept (checkout); animation frames measured
//   WU15  "حظ أوفر" -> a kind window, no word of a prize, "متابعة التسوق" (phone + desktop)
//   WU16  the visitor of an AD: straight onto a product (utm / fbclid, Facebook / Instagram in-app browser), empty
//         storage -> the popup by itself, READY to spin, from the early check of the page (ONE request); a visitor who
//         saw the previous campaign gets the NEW one (same prizes, new start) once; the same campaign paused and
//         resumed does not reopen it; web storage REFUSED -> the page works and the popup opens once, not on every page
import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the page's /wheel/public answers can be delayed (?wdelay=ms) or failed (?wfail=n, or window.__wheelFail later) —
// in the page only (the Worker itself is untouched); counts the requests
export const NET_HOOK = `(() => {
  const q = new URLSearchParams(location.search);
  const delay = Number(q.get('wdelay') || 0);
  window.__wheelFail = Number(q.get('wfail') || 0);
  window.__wheelPublicCalls = 0;
  window.__wheelPublicLog = [];
  const of = window.fetch.bind(window);
  window.fetch = async (u, i) => {
    const s = String((u && u.url) || u);
    if (/\\/wheel\\/public/.test(s)) {
      window.__wheelPublicCalls++;
      window.__wheelPublicLog.push(Math.round(performance.now()));
      if (window.__wheelFail > 0) { window.__wheelFail--; throw new TypeError('Failed to fetch (e2e)'); }
      if (delay) await new Promise((r) => setTimeout(r, delay));
    }
    return of(u, i);
  };
  // when did the popup / the result window appear (page clock)
  const seen = (window.__wheelSeen = {});
  const tick = () => {
    if (seen.popup == null && document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-dial]')) seen.popup = Math.round(performance.now());
    if (seen.result == null && document.querySelector('[data-testid=wheel-result-dialog]')) seen.result = Math.round(performance.now());
    if (seen.loading == null && document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-loading]')) seen.loading = Math.round(performance.now());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

export function buildPopupScenarios(h) {
  const { ctx, viewport, fresh, shot, spinAndWait, waitResult, openCheckoutWith, NONES, BIG, CART_OK, LANDING, noHScroll } = h;
  const popup = `!!document.querySelector('[data-testid=wheel-popup]')`;
  const fab = `!!document.querySelector('[data-testid=wheel-fab]')`;
  const dial = `!!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-dial]')`;
  const go = async (t, hash, q = '') => { await t.navigate(`${ctx.base}/?r=${Date.now()}${q}${hash}`); };
  let hooked = new WeakSet();
  const hook = async (t) => { if (!hooked.has(t)) { hooked.add(t); await t.send('Page.addScriptToEvaluateOnNewDocument', { source: NET_HOOK }); } };
  const box = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height), vw: innerWidth, vh: innerHeight }; })()`;
  const closePopup = async (t) => { await t.evaluate(`document.querySelector('[data-testid=wheel-close]').click(); true`); await t.waitFor(`!document.querySelector('[data-testid=wheel-popup]')`, 5_000, 'popup closed'); };
  const PRIZES = [{ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: 1, quantity: 5 }, ...NONES];
  /** a phone (375x667 = iPhone SE, touch) or a desktop */
  const SIZES = [[1366, 900, false, 'desk'], [375, 667, true, 'se']];

  /** a result window that is fully on screen, not covered, its close + main button tappable, no scroll needed */
  const checkResultWindow = async (t, tag) => {
    const card = await t.evaluate(box('[data-testid=wheel-result-card]'));
    assert.ok(card, 'the result window is shown');
    assert.ok(card.t >= 0 && card.l >= 0 && card.r <= card.vw && card.b <= card.vh, `inside the screen ${JSON.stringify(card)}`);
    const centre = Math.abs((card.t + card.b) / 2 - card.vh / 2);
    assert.ok(centre <= Math.max(24, card.vh * 0.06), `in the middle of the screen (${centre}px off) ${JSON.stringify(card)}`);
    const sc = await t.evaluate(`(() => { const c = document.querySelector('[data-testid=wheel-result-card]'); return { sh: c.scrollHeight, ch: c.clientHeight }; })()`);
    assert.ok(sc.sh <= sc.ch + 1, `no scroll needed inside the window ${JSON.stringify(sc)}`);
    // nothing of the site lies over it: the window itself is hit at its corners and centre
    const hit = await t.evaluate(`(() => { const d = document.querySelector('[data-testid=wheel-result-dialog]'); const b = document.querySelector('[data-testid=wheel-result-card]').getBoundingClientRect(); const at = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && d.contains(e); }; return [at(b.left + 14, b.top + 14), at(b.right - 14, b.top + 14), at(b.left + 14, b.bottom - 14), at(b.right - 14, b.bottom - 14), at((b.left + b.right) / 2, (b.top + b.bottom) / 2)]; })()`);
    assert.deepEqual(hit, [true, true, true, true, true], `not covered (${tag})`);
    const x = await t.evaluate(box('[data-testid=wheel-result-close]'));
    assert.ok(x.w >= 44 && x.h >= 44, `X large enough ${JSON.stringify(x)}`);
    const main = await t.evaluate(box('[data-testid=wheel-result-continue]'));
    assert.ok(main.h >= 44, `"continue" tappable ${JSON.stringify(main)}`);
    assert.equal(await noHScroll(t), true, 'no horizontal scroll');
  };
  /** frame times while the wheel turns and the window appears (rAF gaps) */
  const startFrames = (t) => t.evaluate(`(() => { const f = (window.__frames = []); let last = performance.now(); const loop = (n) => { f.push(n - last); last = n; if (f.length < 4000) requestAnimationFrame(loop); }; requestAnimationFrame(loop); return true; })()`);
  const frames = (t) => t.evaluate(`(() => { const f = (window.__frames || []).slice(1).sort((a, b) => a - b); const p = (q) => Math.round(f[Math.min(f.length - 1, Math.floor(f.length * q))] || 0); return { n: f.length, p50: p(0.5), p95: p(0.95), max: Math.round(f[f.length - 1] || 0), over50: f.filter((x) => x > 50).length }; })()`);

  return [
    ['WU11', 'AUTOMATIC POPUP on ANY page for a new visitor (home, shop, product, about; desktop + iPhone SE): opens right after the campaign answer with the wheel (no loading, ONE /wheel/public request); large X; the button reopens it at once; moving around / reloading never reopens it; a NEW campaign opens it once again; STOPPED or ENDED campaign = nothing', async (t) => {
      await hook(t);
      await ctx.setCampaign(PRIZES);
      const times = [];
      for (const [vw, vh, mobile, tag] of SIZES) {
        await viewport(t, vw, vh, mobile);
        for (const [label, hash] of [['home', '#/'], ['shop', '#/shop'], ['product', '#/product/p-simple'], ['about', '#/about']]) {
          await fresh(t);
          await go(t, hash);
          await t.waitFor(dial, 15_000, `opens by itself on ${label} (${tag})`);
          const s = await t.evaluate(`({ seen: window.__wheelSeen, calls: window.__wheelPublicCalls, log: window.__wheelPublicLog, hash: location.hash })`);
          assert.equal(s.calls, 1, `ONE campaign request (${label}): ${s.calls} at ${JSON.stringify(s.log)}`);
          assert.equal(s.seen.loading ?? null, null, `no "loading" state in the popup (${label})`);
          assert.ok(s.hash.startsWith(hash.replace(/\/$/, '')), `still on ${label}`);
          times.push(`${tag}/${label}: popup at ${s.seen.popup} ms (request at ${s.log[0]} ms)`);
          const x = await t.evaluate(box('[data-testid=wheel-close]'));
          assert.ok(x.w >= 44 && x.h >= 44 && x.t >= 0 && x.r <= x.vw, `large X inside the screen ${JSON.stringify(x)}`);
          assert.equal(await noHScroll(t), true, 'no horizontal scroll');
          if (label === 'product' || label === 'shop') await shot(t, `wu11-${tag}-auto-${label}`, { full: false });
          await closePopup(t);
        }
        // the floating button reopens it AT ONCE (no second request, no loading); X closes; shopping goes on
        await go(t, '#/shop');
        await t.waitFor(fab, 15_000, 'button');
        await sleep(1_500);
        assert.equal(await t.evaluate(popup), false, 'not again after a reload');
        await t.evaluate(`document.querySelector('[data-testid=wheel-fab]').click(); true`);
        await sleep(200);
        assert.equal(await t.evaluate(dial), true, 'the button shows the wheel at once');
        assert.equal(await t.evaluate(`window.__wheelPublicCalls`), 1, 'no second request for the button');
        await closePopup(t);
        for (const hh of ['#/', '#/about', '#/shop', '#/product/p-simple', '#/']) {
          await t.evaluate(`location.hash = '${hh}'; true`);
          await sleep(1_200);
          assert.equal(await t.evaluate(popup), false, `not reopened on ${hh}`);
        }
        await t.reload();
        await sleep(2_500);
        assert.equal(await t.evaluate(popup), false, 'not reopened after a refresh');
        // a NEW campaign (other terms): once again, on any page
        await ctx.setCampaign(PRIZES, { terms: `شروط حملة جديدة للاختبار ${tag}` });
        await go(t, '#/about');
        await t.waitFor(dial, 15_000, 'a new campaign opens it once');
        await closePopup(t);
        await ctx.setCampaign(PRIZES);
      }
      // STOPPED / ENDED: nothing at all (no popup, no button), for a new visitor on any page
      for (const [extra, what] of [[{ active: false }, 'stopped'], [{ endsAt: '2026-01-02T00:00:00Z' }, 'ended']]) {
        await ctx.setCampaign(PRIZES, extra);
        for (const hash of ['#/', '#/shop']) {
          await fresh(t);
          await go(t, hash);
          await t.waitFor(`document.readyState === 'complete' && document.body.innerText.trim().length > 40`, 30_000, 'page');
          await sleep(3_000);
          assert.equal(await t.evaluate(popup), false, `no popup (${what} campaign, ${hash})`);
          assert.equal(await t.evaluate(fab), false, `no button (${what} campaign, ${hash})`);
        }
      }
      console.log(`    [WU11 times] ${times.join(' | ')}`);
    }],

    ['WU12', 'NEVER OVER THE ORDER FLOW: a new visitor landing on CHECKOUT gets no popup and no button (the form works); the popup opens later, once, on a normal page; an open popup closes when the visitor goes to checkout; another open window (aria-modal) makes it wait, then it opens', async (t) => {
      await hook(t);
      await ctx.setCampaign(PRIZES);
      await viewport(t, 390, 844, true);
      await fresh(t);
      await openCheckoutWith(t, CART_OK);
      await sleep(3_000);
      assert.equal(await t.evaluate(popup), false, 'no popup over checkout');
      assert.equal(await t.evaluate(fab), false, 'no button over checkout');
      assert.equal(await t.evaluate(`!!document.querySelector('input[placeholder="0791234567"]')`), true, 'checkout form usable');
      assert.equal(await t.evaluate(`localStorage.getItem('anta_wheel_popup_campaign_v2')`), null, 'not counted as shown');
      await t.evaluate(`location.hash = '#/shop'; true`);
      await t.waitFor(dial, 10_000, 'opens once the visitor is on a normal page');
      // the visitor goes to checkout (a link while it is open): it closes, the order flow is not covered
      await t.evaluate(`location.hash = '#/checkout'; true`);
      await t.waitFor(`!document.querySelector('[data-testid=wheel-popup]')`, 5_000, 'closed on checkout');
      await t.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 15_000, 'checkout form');
      await t.evaluate(`location.hash = '#/'; true`);
      await sleep(2_000);
      assert.equal(await t.evaluate(popup), false, 'not again for this campaign');
      // another window open (cart drawer, quick view… = aria-modal) while the answer arrives: the popup waits for it
      await fresh(t);
      await go(t, '#/shop', '&wdelay=2500');
      await t.evaluate(`(() => { const d = document.createElement('div'); d.id = 'e2e-other-modal'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.textContent = 'another window'; document.body.appendChild(d); return true; })()`);
      await sleep(5_000);
      assert.equal(await t.evaluate(popup), false, 'waits while another window is open');
      await t.evaluate(`document.getElementById('e2e-other-modal').remove(); true`);
      await t.waitFor(dial, 5_000, 'opens once the other window is closed');
    }],

    ['WU13', 'SLOW / FAILING WORKER: a 4-second answer -> no popup before it, the popup right after it, the page usable meanwhile; two failed checks -> asked again in the background, the popup opens on the third; the wheel PAGE with the Worker unreachable shows a clear error + "try again", which works', async (t) => {
      await hook(t);
      await ctx.setCampaign(PRIZES);
      const out = [];
      for (const [vw, vh, mobile, tag] of [[1366, 900, false, 'desk'], [390, 844, true, 'phone']]) {
        await viewport(t, vw, vh, mobile);
        await fresh(t);
        await go(t, '#/', '&wdelay=4000');
        await t.waitFor(`document.querySelectorAll('[data-product-id]').length > 0`, 20_000, 'products shown while the Worker is slow');
        assert.equal(await t.evaluate(popup), false, 'no popup before the answer');
        await t.waitFor(dial, 15_000, 'popup after the slow answer');
        const s = await t.evaluate(`({ seen: window.__wheelSeen, log: window.__wheelPublicLog })`);
        const after = s.seen.popup - s.log[0] - 4000;
        assert.ok(after >= 0 && after < 1_500, `opens right after the answer (+${after} ms)`);
        assert.equal(s.seen.loading ?? null, null, 'never a loading state in the popup');
        out.push(`${tag} slow: request ${s.log[0]} ms, popup ${s.seen.popup} ms (+${after} ms after the 4 s answer)`);
        await closePopup(t);
        // two failures, then it answers
        await fresh(t);
        await go(t, '#/shop', '&wfail=2');
        await t.waitFor(dial, 25_000, 'popup after the background retries');
        const f = await t.evaluate(`({ calls: window.__wheelPublicCalls, log: window.__wheelPublicLog, seen: window.__wheelSeen })`);
        assert.equal(f.calls, 3, `asked three times (${f.calls} at ${JSON.stringify(f.log)})`);
        out.push(`${tag} 2 failures: requests at ${f.log.join('/')} ms, popup ${f.seen.popup} ms`);
        await closePopup(t);
      }
      // the wheel page with the Worker unreachable: a clear message + "try again" (never an endless loading)
      await fresh(t);
      await go(t, '#/wheel', '&wfail=99');
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-load-failed]')`, 20_000, 'clear error on the wheel page');
      assert.match(await t.evaluate(`document.querySelector('[data-testid=wheel-load-failed]').innerText`), /إعادة المحاولة/);
      await shot(t, 'wu13-wheel-page-error', { full: false });
      await t.evaluate(`window.__wheelFail = 0; document.querySelector('[data-testid=wheel-retry]').click(); true`);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-page] [data-testid=wheel-dial]')`, 15_000, '"try again" loads the wheel');
      console.log(`    [WU13 times] ${out.join(' | ')}`);
    }],

    ['WU14', 'WIN -> RESULT WINDOW in the middle of the screen (iPhone SE 375x667 + desktop): only after the wheel stopped, the SERVER\'s prize = the segment under the pointer, "مبروك! ربحت خصم دينار", no scroll, not covered, 48 px X, confetti (not with reduce-motion); X -> back to shopping, the prize kept (reopened popup: result box only, no second window; checkout applies it); frames measured', async (t) => {
      await hook(t);
      await ctx.setCampaign([{ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: BIG, quantity: 50 }, ...NONES]);
      const perf = [];
      let visitors = 0; // every round is a NEW visitor (cleared site data) = one more stored guest result
      for (const [vw, vh, mobile, tag] of SIZES) {
        for (const reduce of [false, true]) {
          await viewport(t, vw, vh, mobile);
          await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
          await fresh(t);
          await go(t, '#/');
          await t.waitFor(`!!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-spin]')`, 20_000, 'popup');
          await startFrames(t);
          visitors++;
          await spinAndWait(t);
          // while it turns: no result, no window (never a guess)
          await sleep(reduce ? 50 : 1_200);
          if (!reduce) {
            assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=wheel-result-dialog]')`), false, 'no window while the wheel turns');
            assert.equal(await t.evaluate(`document.querySelector('[data-testid=wheel-result]').dataset.prizeId`), '', 'no result while the wheel turns');
          }
          await t.waitFor(`!!document.querySelector('[data-testid=wheel-result-dialog]')`, 20_000, 'result window');
          await sleep(reduce ? 100 : 700);
          const fr = await frames(t);
          const land = await t.evaluate(LANDING);
          const d = await t.evaluate(`(() => { const d = document.querySelector('[data-testid=wheel-result-dialog]'); return { kind: d.dataset.kind, prize: d.dataset.prizeId, title: d.querySelector('[data-testid=wheel-result-title]').innerText, all: d.innerText, confetti: !!d.querySelector('[data-testid=wheel-result-confetti]') && getComputedStyle(d.querySelector('[data-testid=wheel-result-confetti]')).display !== 'none', count: document.querySelectorAll('[data-testid=wheel-result-dialog]').length }; })()`);
          const gs = await ctx.guestSpins();
          assert.equal(gs.length, visitors, 'one stored result per visitor');
          assert.equal(d.kind, 'win');
          assert.ok(gs.every((g) => g.prizeId === d.prize), 'the window shows the SERVER\'s stored prize');
          assert.equal(land.landed, d.prize, `the wheel stopped on that segment ${JSON.stringify(land)}`);
          assert.equal(d.title, 'ربحت خصم دينار');
          assert.match(d.all, /مبروك!/);
          assert.match(d.all, /خصم 1 د\.أ على هذا الطلب/);
          assert.equal(d.count, 1, 'one window');
          assert.equal(d.confetti, !reduce, `confetti ${reduce ? 'hidden with reduce-motion' : 'shown'}`);
          await checkResultWindow(t, tag);
          const ws = await t.evaluate(`window.__wheelSeen`);
          perf.push(`${tag}${reduce ? '/reduce' : ''}: frames n=${fr.n} p50=${fr.p50}ms p95=${fr.p95}ms max=${fr.max}ms >50ms:${fr.over50}`);
          if (!reduce) await shot(t, `wu14-${tag}-win`, { full: false });
          // X: closed, back to shopping, the prize is kept
          await t.evaluate(`document.querySelector('[data-testid=wheel-result-close]').click(); true`);
          await t.waitFor(`!document.querySelector('[data-testid=wheel-result-dialog]') && !document.querySelector('[data-testid=wheel-popup]')`, 5_000, 'window + popup closed');
          assert.notEqual(await t.evaluate(`getComputedStyle(document.body).overflowY`), 'hidden', 'page scrolls again');
          // reopened: the stored result in the box below the wheel, NOT a second window
          await t.waitFor(fab, 10_000, 'button');
          await t.evaluate(`document.querySelector('[data-testid=wheel-fab]').click(); true`);
          await t.waitFor(`document.querySelector('[data-testid=wheel-result]')?.dataset.prizeId === 'disc-1'`, 15_000, 'same result shown again');
          await sleep(800);
          assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=wheel-result-dialog]')`), false, 'no second window for the same result');
          assert.equal((await ctx.guestSpins()).length, visitors, 'no new result when reopened');
          await closePopup(t);
          void ws;
        }
      }
      await t.send('Emulation.setEmulatedMedia', { features: [] });
      // the prize survives the window: checkout shows it (guest, linked at sign-in)
      await openCheckoutWith(t, CART_OK);
      await t.waitFor(`document.querySelector('[data-testid=checkout-wheel-gift]')?.dataset.state === 'applies'`, 20_000, 'prize kept for checkout');
      console.log(`    [WU14 frames] ${perf.join(' | ')}`);
    }],

    ['WU15', '"حظ أوفر" -> a KIND window in the middle (iPhone SE + desktop): no "مبروك"/"ربحت"/prize, no confetti, "متابعة التسوق" closes it and the popup; the result matches the segment; not shown again on reopening', async (t) => {
      await hook(t);
      // the prize can be drawn only once in ~a million: the spin lands on "حظ أوفر"
      await ctx.setCampaign([{ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: 1, quantity: 5 }, ...NONES.map((n) => ({ ...n, weight: BIG }))]);
      for (const [vw, vh, mobile, tag] of SIZES) {
        await viewport(t, vw, vh, mobile);
        await fresh(t);
        await go(t, '#/shop');
        await t.waitFor(`!!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-spin]')`, 20_000, 'popup');
        await spinAndWait(t);
        await t.waitFor(`!!document.querySelector('[data-testid=wheel-result-dialog]')`, 20_000, 'result window');
        await sleep(500);
        const d = await t.evaluate(`(() => { const d = document.querySelector('[data-testid=wheel-result-dialog]'); return { kind: d.dataset.kind, prize: d.dataset.prizeId, all: d.innerText, confetti: !!d.querySelector('[data-testid=wheel-result-confetti]') }; })()`);
        const land = await t.evaluate(LANDING);
        assert.equal(d.kind, 'none');
        assert.match(d.prize, /^none-/);
        assert.equal(land.landed, d.prize, `the wheel stopped on that "حظ أوفر" segment ${JSON.stringify(land)}`);
        assert.match(d.all, /حظ أوفر هذه المرة/);
        assert.doesNotMatch(d.all, /مبروك|ربحت|جائزة|خصم/, 'nothing suggests a prize');
        assert.equal(d.confetti, false, 'no confetti');
        assert.match(d.all, /متابعة التسوق/);
        await checkResultWindow(t, tag);
        await shot(t, `wu15-${tag}-no-prize`, { full: false });
        await t.evaluate(`document.querySelector('[data-testid=wheel-result-continue]').click(); true`);
        await t.waitFor(`!document.querySelector('[data-testid=wheel-result-dialog]') && !document.querySelector('[data-testid=wheel-popup]')`, 5_000, 'closed: back to shopping');
        assert.ok((await t.evaluate(`location.hash`)).startsWith('#/shop'), 'still on the shop');
        await t.evaluate(`document.querySelector('[data-testid=wheel-fab]').click(); true`);
        await t.waitFor(`!!document.querySelector('[data-testid=wheel-no-prize]')`, 15_000, 'stored "حظ أوفر" shown in the box');
        await sleep(600);
        assert.equal(await t.evaluate(`!!document.querySelector('[data-testid=wheel-result-dialog]')`), false, 'no second window');
        await closePopup(t);
      }
    }],

    ['WU16', 'AD VISITOR: a product link with utm/fbclid opened in a Facebook / Instagram in-app browser (iPhone SE), empty storage -> the popup by itself, READY to spin (button enabled, no loading), ONE request; a visitor who saw the PREVIOUS campaign gets a NEW one with the same prizes (new start) once; the same campaign paused then resumed: not again; web storage REFUSED -> the page works, the popup opens once, not on the next pages', async (t) => {
      await hook(t);
      await ctx.setCampaign(PRIZES);
      const ready = `(() => { const b = document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-spin]'); return !!b && !b.disabled && !!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-dial]'); })()`;
      const AD = '&utm_source=facebook&utm_medium=paid&fbclid=IwAR0e2e';
      const UAS = [
        ['fb-ios', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 [FBAN/FBIOS;FBAV/512.0.0.41.106;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBLC/ar_AR]'],
        ['ig-android', 'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.0.0 Mobile Safari/537.36 Instagram 400.0.0.27.80 Android'],
      ];
      await viewport(t, 375, 667, true);
      const times = [];
      for (const [tag, ua] of UAS) {
        await t.send('Emulation.setUserAgentOverride', { userAgent: ua });
        await fresh(t);
        await go(t, '#/product/p-simple', AD);
        await t.waitFor(ready, 15_000, `ready to spin on the ad's product page (${tag})`);
        const s = await t.evaluate(`({ seen: window.__wheelSeen, calls: window.__wheelPublicCalls, early: typeof window.__wheelPublicEarly !== 'undefined', hash: location.hash, product: !!document.querySelector('[data-testid=product-price-block]') || document.body.innerText.length > 100 })`);
        assert.equal(s.calls, 1, `ONE campaign request (${tag}): ${s.calls}`);
        assert.equal(s.early, true, 'the check started from the page itself (index.html), not after the app code');
        assert.equal(s.seen.loading ?? null, null, 'no "loading" state');
        assert.ok(s.hash.startsWith('#/product/p-simple'), `still on the product (${s.hash})`);
        assert.ok(s.product, 'the product page is there under the popup');
        times.push(`${tag}: ready at ${s.seen.popup} ms`);
        await shot(t, `wu16-${tag}-ad-product`, { full: false });
        await closePopup(t);
      }
      await t.send('Emulation.setUserAgentOverride', { userAgent: '' }).catch(() => {});
      // a visitor of the previous campaign (flag kept): the same campaign paused then resumed -> NOT again
      await ctx.setCampaign(PRIZES, { active: false });
      await go(t, '#/shop');
      await sleep(2_500);
      assert.equal(await t.evaluate(popup), false, 'paused: nothing');
      await ctx.setCampaign(PRIZES);
      await go(t, '#/product/p-simple');
      await sleep(3_000);
      assert.equal(await t.evaluate(popup), false, 'the same campaign resumed: not again');
      // …and a NEW campaign with the SAME prizes (a new start date) -> once
      await ctx.setCampaign(PRIZES, { startsAt: '2026-02-01T00:00:00Z' });
      await go(t, '#/product/p-simple', AD);
      await t.waitFor(ready, 15_000, 'a new campaign with the same prizes opens it once');
      await closePopup(t);
      await go(t, '#/');
      await sleep(2_500);
      assert.equal(await t.evaluate(popup), false, 'and only once');
      // web storage refused (cookies / site data blocked): the page works, the popup opens ONCE in this visit
      const t2 = await ctx.openTab();
      try {
        await hook(t2);
        await t2.send('Page.addScriptToEvaluateOnNewDocument', { source: "(() => { const boom = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); }; for (const k of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[k] = boom; })();" });
        await viewport(t2, 375, 667, true);
        await go(t2, '#/product/p-simple', AD);
        await t2.waitFor(ready, 20_000, 'storage refused: the popup still opens');
        assert.ok(await t2.evaluate(`document.body.innerText.length > 200`), 'the page is not blank');
        await shot(t2, 'wu16-storage-refused', { full: false });
        await closePopup(t2);
        for (const hh of ['#/', '#/shop', '#/product/p-simple']) {
          await t2.evaluate(`location.hash = '${hh}'; true`);
          await sleep(1_200);
          assert.equal(await t2.evaluate(popup), false, `storage refused: not reopened on ${hh}`);
        }
      } finally { await t2.close(); }
      console.log(`    [WU16 times] ${times.join(' | ')}`);
    }],
  ];
}
