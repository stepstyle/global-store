// E2E_SUITE=preview + E2E_PREVIEW_CHECK=1 — LOCAL self-check of the preview's DEMO wheel (no real campaign, no real
// prize): on a PHONE (390x844) and a DESKTOP (1366x900), a first-time visitor sees the popup on the home page, the
// wheel shows the demo segments (three "حظ أوفر"), one spin returns a result stored on the server; the floating wheel
// button reopens it. Screenshots in E2E_SHOTS_DIR.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, mobile: true, dpr: 2 },
  { name: 'desktop', width: 1366, height: 900, mobile: false, dpr: 1 },
];
const ERRS = `window.__pwErrs = []; window.addEventListener('error', (e) => window.__pwErrs.push(String(e.message).slice(0, 160)));
{ const ce = console.error.bind(console); console.error = (...a) => { try { window.__pwErrs.push(a.map((x) => (x && (x.code || x.message)) || String(x)).join(' ').slice(0, 160)); } catch {} ce(...a); }; }`;

export async function runPreviewWheelCheck(ctx) {
  mkdirSync(ctx.shotsDir, { recursive: true });
  const results = [];
  const record = (id, name, ok, detail) => {
    results.push({ id, name, ok, ...(ok ? {} : { error: detail }) });
    console.log(`${ok ? '✔' : '✖'} ${id} ${name}${ok ? '' : `\n    ${detail}`}`);
  };
  const shot = async (t, name) => {
    await sleep(500);
    const r = await t.send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: false });
    writeFileSync(join(ctx.shotsDir, `${name}.jpg`), Buffer.from(r.data, 'base64'));
  };
  for (const vp of VIEWPORTS) {
    const t = await ctx.openTab();
    const id = `PW-${vp.name}`;
    try {
      await t.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
      await t.send('Page.addScriptToEvaluateOnNewDocument', { source: ERRS });
      await t.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'all' }); // a FIRST-TIME visitor
      await t.navigate(`${ctx.base}/?r=${Date.now()}#/`);
      await t.waitFor(`!!document.querySelector('[data-testid=wheel-popup] [data-testid=wheel-spin]')`, 30_000, 'first-visit wheel popup');
      const segs = await t.evaluate(`[...document.querySelectorAll('[data-testid=wheel-popup] [data-testid=wheel-segment]')].map((s) => s.dataset.slotType)`);
      const terms = await t.evaluate(`document.querySelector('[data-testid=wheel-popup]').innerText`);
      await shot(t, `${vp.name}-wheel-popup`);
      await t.waitFor(`!document.querySelector('[data-testid=wheel-spin]')?.disabled`, 20_000, 'spin button enabled');
      await t.send('Runtime.evaluate', { expression: `document.querySelector('[data-testid=wheel-spin]').click(); true`, userGesture: true, returnByValue: true });
      await t.waitFor(`(() => { const r = document.querySelector('[data-testid=wheel-result]'); return r && r.querySelector('[data-testid=wheel-won],[data-testid=wheel-no-prize],[data-testid=wheel-message]') ? r.innerText : ''; })()`, 30_000, 'spin result');
      await sleep(800);
      await shot(t, `${vp.name}-wheel-result`);
      const won = await t.evaluate(`!!document.querySelector('[data-testid=wheel-won]')`);
      const stored = (await ctx.guestSpins()).length;
      // close, then the floating wheel button (FAB) reopens it
      await t.evaluate(`document.querySelector('[data-testid=wheel-close]')?.click(); true`);
      await sleep(600);
      const fab = await t.evaluate(`!!document.querySelector('[data-testid=wheel-fab]')`);
      await shot(t, `${vp.name}-home-with-wheel-button`);
      const errs = await t.evaluate(`(window.__pwErrs || []).slice(0, 5)`);
      const ok = segs.length >= 4 && segs.filter((s) => s === 'none').length === 3 && /تجريبي/.test(terms) && stored >= 1 && fab && errs.length === 0;
      record(id, `${vp.name}: popup on the home page, ${segs.length} demo segments (3 "حظ أوفر"), spin -> ${won ? 'a DEMO prize' : 'no prize'} stored on the local server, wheel button visible, no page error`, ok,
        `segments=${segs.join(',')} demoTerms=${/تجريبي/.test(terms)} storedSpins=${stored} fab=${fab} errors=${errs.join(' | ')}`);
    } catch (e) {
      record(id, `${vp.name}: wheel popup + spin`, false, String(e?.message || e).split('\n')[0]);
    } finally {
      await t.close();
    }
  }
  return results;
}
