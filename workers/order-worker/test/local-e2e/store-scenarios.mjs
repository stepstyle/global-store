// E2E_SUITE=store — LOCAL ONLY: offers & discounts, similar products, "complete your order" in the cart and checkout,
// on the REAL web app (Vite) + the REAL order Worker (on_delivery, approval off, price check ENFORCED) + emulators.
// A synthetic SHOWCASE catalogue (the site's own category pictures, made-up products and prices, marked synthetic) is
// seeded next to the standard fixtures. Phone (390x844) and desktop (1366x900); screenshots for a design review.
// E2E_CATALOG_FILE: seed THAT catalogue instead of the showcase (screenshots only; the checks adapt to the data).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCTS as FIXTURES } from '../fixtures.mjs';

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
const OUTCOME = `(location.hash.startsWith('#/order-success/') ? 'success' : (document.querySelector('[data-testid=submit-result]')?.dataset.status || ''))`;
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, mobile: true, dpr: 2 },
  { name: 'desktop', width: 1366, height: 900, mobile: false, dpr: 1 },
];
const img = (n) => `/images/categories/${n}.png`;
const day = (n) => new Date(Date.UTC(2026, 10, 1 + n)).toISOString();
// synthetic showcase catalogue (local emulator only)
export const SHOWCASE = {
  'sc-notebook': { name: 'دفتر جامعي 100 ورقة', nameEn: 'College notebook 100 sheets', category: 'Stationery', subCategory: 'notebooks', price: 1.5, originalPrice: 2, stock: 40, image: img('notebooks'), createdAt: day(1) },
  'sc-pens': { name: 'طقم أقلام حبر جاف 10 ألوان', nameEn: 'Ballpoint pens, 10 colours', category: 'Stationery', subCategory: 'pens-ballpoint,colors-markers', price: 0.75, stock: 100, image: img('pens'), createdAt: day(2) },
  'sc-colors': { name: 'ألوان خشبية 24 لون', nameEn: 'Coloured pencils 24', category: 'Stationery', subCategory: 'colors-markers,pencils', price: 3, originalPrice: 4, stock: 25, image: img('colors'), createdAt: day(3) },
  'sc-geometry': { name: 'علبة أدوات هندسة', nameEn: 'Geometry set', category: 'Stationery', subCategory: 'geometry-rulers', price: 2.25, stock: 30, image: img('geometry'), createdAt: day(4) },
  'sc-bag': { name: 'حقيبة مدرسية ظهر', nameEn: 'School backpack', category: 'Stationery', subCategory: 'school-bags', price: 18, originalPrice: 24, stock: 8, image: img('bags'), createdAt: day(5) },
  'sc-bundle': { name: 'بكج العودة للمدارس', nameEn: 'Back-to-school bundle', category: 'Stationery', subCategory: 'school-bags,notebooks,pens-ballpoint', price: 9, originalPrice: 12, stock: 12, image: img('bundles'), createdAt: day(6) },
  'sc-blocks': { name: 'مكعبات تركيب 120 قطعة', nameEn: 'Building blocks 120 pcs', category: 'Games', subCategory: 'all-toys,building-blocks,boys-toys', price: 11, originalPrice: 15, stock: 6, image: img('blocks'), createdAt: day(7) },
  'sc-montessori': { name: 'لوحة منتسوري خشبية', nameEn: 'Wooden Montessori board', category: 'Games', subCategory: 'all-toys,montessori', price: 14, stock: 5, image: img('montessori'), createdAt: day(8) },
  'sc-group': { name: 'لعبة جماعية للعائلة', nameEn: 'Family group game', category: 'Games', subCategory: 'all-toys,group-games', price: 8, originalPrice: 10, stock: 9, image: img('group'), createdAt: day(9) },
  'sc-girls': { name: 'مطبخ ألعاب للبنات', nameEn: 'Toy kitchen', category: 'Games', subCategory: 'all-toys,girls-toys', price: 12, originalPrice: 16, stock: 0, image: img('girls'), createdAt: day(10) },
  'sc-boys': { name: 'سيارة تركيب للأولاد', nameEn: 'Build-a-car kit', category: 'Games', subCategory: 'all-toys,boys-toys,building-blocks', price: 10, stock: 7, image: img('boys'), createdAt: day(11) },
  'sc-playmat': {
    name: 'فرشة لعب للأطفال', nameEn: 'Baby play mat', category: 'Games', subCategory: 'all-toys,baby-toys', price: 16, stock: 0, image: img('playmats'), createdAt: day(12),
    variants: [
      { id: 'pm-blue', label: 'أزرق', type: 'color', price: 16, originalPrice: 20, stock: 4, colorCode: '#3b82f6' },
      { id: 'pm-pink', label: 'زهري', type: 'color', price: 18, stock: 3, colorCode: '#ec4899' },
    ],
  },
  'sc-bike': { name: 'بسكليت أطفال 16 إنش', nameEn: 'Kids bike 16"', category: 'BabyGear', subCategory: 'bicycles', price: 45, originalPrice: 55, stock: 3, image: img('bicycles'), createdAt: day(13) },
  'sc-scooter': { name: 'سكوتر ثلاث عجلات', nameEn: 'Three-wheel scooter', category: 'BabyGear', subCategory: 'scooters', price: 25, stock: 4, image: img('scooters'), createdAt: day(14) },
  'sc-car': { name: 'سيارة ركوب كهربائية', nameEn: 'Electric ride-on car', category: 'BabyGear', subCategory: 'ride-on-cars', price: 85, stock: 2, image: img('cars'), createdAt: day(15) },
  'sc-stroller': { name: 'عربة أطفال قابلة للطي', nameEn: 'Foldable stroller', category: 'BabyGear', subCategory: 'strollers,walkers', price: 60, originalPrice: 75, stock: 2, image: img('strollers'), createdAt: day(16) },
  'sc-giftbox': { name: 'صندوق هدية مزيّن', nameEn: 'Decorated gift box', category: 'Gifts', subCategory: 'gift-boxes', price: 4, originalPrice: 5, stock: 20, image: img('gift-boxes'), createdAt: day(17) },
  'sc-wrap': { name: 'ورق تغليف هدايا', nameEn: 'Gift wrapping paper', category: 'Gifts', subCategory: 'gift-boxes,wrapping', price: 0.5, stock: 60, image: img('wrap'), createdAt: day(18) },
  'sc-party': { name: 'طقم زينة حفلات', nameEn: 'Party decoration set', category: 'Gifts', subCategory: 'party', price: 3, stock: 15, image: img('party'), createdAt: day(19) },
};

/** the same "real discount" rule as the site (independent copy: the test must not borrow the code it checks) */
const money = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : null);
function expectedOffer(p) {
  const vs = Array.isArray(p.variants) ? p.variants.filter((v) => money(v.price) !== null) : [];
  let price; let orig;
  if (vs.length) {
    const inStock = vs.filter((v) => Number(v.stock) > 0);
    if (!inStock.length) return null;
    const best = inStock.reduce((a, b) => (a.price <= b.price ? a : b));
    price = money(best.price); orig = money(best.originalPrice) ?? (price === money(p.price) ? money(p.originalPrice) : null);
  } else {
    if (!(Number(p.stock) > 0)) return null;
    price = money(p.price); orig = money(p.originalPrice);
  }
  if (price === null || orig === null || orig <= price) return null;
  const percent = Math.round((1 - price / orig) * 100);
  return percent >= 1 && percent <= 95 ? { percent, save: Math.round((orig - price) * 1000) / 1000 } : null;
}

export function storeCatalogue() {
  if (process.env.E2E_CATALOG_FILE) {
    const list = JSON.parse(readFileSync(process.env.E2E_CATALOG_FILE, 'utf8'));
    return Object.fromEntries(list.map((p) => [p.id, (({ id, ...rest }) => rest)(p)]));
  }
  return SHOWCASE;
}

export async function runStoreScenarios(ctx) {
  const shots = ctx.shotsDir;
  mkdirSync(shots, { recursive: true });
  const results = [];
  const record = (id, name, ok, detail = '') => {
    results.push({ id, name, ok, ...(ok ? {} : { error: detail }) });
    console.log(`${ok ? '✔' : '✖'} ${id} ${name}${ok ? '' : `\n    ${detail}`}`);
  };
  const check = async (id, name, fn) => {
    try { const d = await fn(); record(id, name, true, d); } catch (e) { record(id, name, false, String(e?.message || e).split('\n')[0]); }
  };
  const must = (c, msg) => { if (!c) throw new Error(msg); };
  const shot = async (t, name, full = false) => {
    await sleep(600);
    const r = await t.send('Page.captureScreenshot', { format: 'jpeg', quality: 72, captureBeyondViewport: full });
    writeFileSync(join(shots, `${name}.jpg`), Buffer.from(r.data, 'base64'));
  };
  // what the site shows = the standard fixtures + the seeded catalogue (expectations computed over both)
  const catalogue = { ...FIXTURES, ...storeCatalogue() };
  const ids = Object.keys(catalogue);
  const offersExpected = ids.map((id) => ({ id, o: expectedOffer(catalogue[id]) })).filter((x) => x.o);
  const firstOffer = offersExpected.sort((a, b) => b.o.percent - a.o.percent)[0];
  const plainId = ids.find((id) => !expectedOffer(catalogue[id]) && Number(catalogue[id].stock) > 0 && !catalogue[id].variants?.length);
  const simpleOfferId = offersExpected.find((x) => !catalogue[x.id].variants?.length)?.id;
  const overflow = `Math.max(0, Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)`;
  const errs = `(window.__stErrs || []).slice(0, 4)`;

  for (const vp of VIEWPORTS) {
    const t = await ctx.openTab();
    const tag = vp.name;
    try {
      await t.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
      if (vp.mobile) await t.send('Emulation.setTouchEmulationEnabled', { enabled: true }).catch(() => {});
      await t.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__stErrs = []; addEventListener('error', (e) => window.__stErrs.push(String(e.message).slice(0, 160))); addEventListener('unhandledrejection', (e) => window.__stErrs.push('rejection ' + String(e.reason && (e.reason.message || e.reason)).slice(0, 160))); localStorage.setItem('language', 'ar');` });
      const go = async (hash, cart = null) => {
        await t.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'local_storage' });
        // a new visit: no checkout draft of an earlier scenario in this tab (sessionStorage)
        await t.evaluate(`(() => { try { sessionStorage.clear(); } catch {} return true; })()`).catch(() => {});
        if (cart) await t.send('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.search.includes('seed=${cart.key}')) localStorage.setItem('anta_cart', ${JSON.stringify(JSON.stringify(cart.items))});` });
        await t.navigate(`${ctx.base}/?keepdraft=1&${cart ? `seed=${cart.key}&` : ''}r=${Date.now()}#${hash}`);
        await t.waitFor(`document.readyState === 'complete' && document.querySelectorAll('[data-product-id]').length > 0 || document.body.innerText.includes('سلة')`, 40_000, `${hash} rendered`);
        await sleep(1500);
      };

      // ---------------------------------------------------------------- offers page
      await check(`ST-${tag}-offers`, `offers page on ${tag}: ONLY real, buyable discounts (${offersExpected.length}), each card badge + struck price + saving; biggest discount first; filter + sort work; no overflow / error`, async () => {
        await go('/offers');
        await t.waitFor(`!!document.querySelector('[data-testid=offers-grid]')`, 20_000, 'offers grid');
        const cards = await t.evaluate(`[...document.querySelectorAll('[data-testid=offers-grid] [data-product-id]')].map((c) => ({ id: c.dataset.productId, badge: c.querySelector('[data-testid=card-sale-badge]')?.textContent || '', orig: !!c.querySelector('[data-testid=card-original-price]'), save: c.querySelector('[data-testid=card-save]')?.textContent || '' }))`);
        must(cards.length === offersExpected.length, `cards ${cards.length} != expected ${offersExpected.length}`);
        const want = new Map(offersExpected.map((x) => [x.id, x.o]));
        for (const c of cards) {
          must(want.has(c.id), `${c.id} is not a real discount`);
          must(c.badge.includes(`${want.get(c.id).percent}%`) && c.orig && c.save.includes('وفّر'), `${c.id}: badge "${c.badge}", original ${c.orig}, save "${c.save}"`);
        }
        const pcts = cards.map((c) => want.get(c.id).percent);
        must(pcts.every((p, i) => i === 0 || pcts[i - 1] >= p), `not sorted by discount: ${pcts.join(',')}`);
        await shot(t, `after-${tag}-offers`);
        await shot(t, `after-${tag}-offers-full`, true);
        // sort by price ascending
        await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('[data-testid=offers-sort]'), 'price-asc'); return true; })()`);
        await sleep(500);
        const prices = await t.evaluate(`[...document.querySelectorAll('[data-testid=offers-grid] [data-testid=card-price]')].map((e) => parseFloat(e.textContent.replace(/[^0-9.]/g, '')))`);
        must(prices.every((p, i) => i === 0 || prices[i - 1] <= p), `price sort: ${prices.join(',')}`);
        // a department filter: every card of that department
        const catBtn = await t.evaluate(`(() => { const b = [...document.querySelectorAll('[data-testid=offers-cat]')][1]; if (!b) return null; b.click(); return b.textContent; })()`);
        if (catBtn) {
          await sleep(500);
          const shownIds = await t.evaluate(`[...document.querySelectorAll('[data-testid=offers-grid] [data-product-id]')].map((c) => c.dataset.productId)`);
          const cats = new Set(shownIds.map((id) => catalogue[id]?.category));
          must(shownIds.length > 0 && cats.size === 1, `filter "${catBtn}" shows ${[...cats].join(',')}`);
        }
        must((await t.evaluate(overflow)) <= 1, 'horizontal overflow');
        const e = await t.evaluate(errs); must(!e.length, `page errors: ${e.join(' | ')}`);
        return '';
      });

      // ---------------------------------------------------------------- navigation entry
      await check(`ST-${tag}-nav`, `"العروض" in the navigation on ${tag} (desktop bar / phone menu) and it opens the offers page`, async () => {
        await go('/');
        if (vp.mobile) {
          await t.evaluate(`(() => { const b = [...document.querySelectorAll('header button')].find((x) => /القائمة|Menu/.test(x.getAttribute('aria-label') || '') || x.querySelector('svg.lucide-menu')); (b || document.querySelector('header button.xl\\\\:hidden'))?.click(); return true; })()`);
          await t.waitFor(`!!document.querySelector('[data-testid=mobile-nav-offers]')`, 8_000, 'phone menu with offers');
          await shot(t, `after-${tag}-menu`);
          await t.evaluate(`document.querySelector('[data-testid=mobile-nav-offers]').click(); true`);
        } else {
          await t.waitFor(`!!document.querySelector('[data-testid=nav-offers]')`, 8_000, 'nav link');
          await t.evaluate(`document.querySelector('[data-testid=nav-offers]').click(); true`);
        }
        await t.waitFor(`location.hash === '#/offers' && !!document.querySelector('[data-testid=offers-page]')`, 10_000, 'offers page');
        return '';
      });

      // ---------------------------------------------------------------- home section
      await check(`ST-${tag}-home`, `home "عروض مميزة" on ${tag}: up to 8 real offers, biggest first, link to all offers; no overflow / error`, async () => {
        await go('/');
        await t.waitFor(`!!document.querySelector('[data-testid=home-offers]')`, 20_000, 'home offers');
        const shownIds = await t.evaluate(`[...document.querySelectorAll('[data-testid=home-offers] [data-product-id]')].map((c) => c.dataset.productId)`);
        must(shownIds.length === Math.min(8, offersExpected.length), `home shows ${shownIds.length}`);
        must(shownIds.every((id) => expectedOffer(catalogue[id])), 'a non-offer on the home offers');
        await t.evaluate(`document.querySelector('[data-testid=home-offers]').scrollIntoView({ block: 'start' }); true`);
        await shot(t, `after-${tag}-home-offers`);
        await t.evaluate(`window.scrollTo(0, 0); true`);
        await shot(t, `after-${tag}-home-top`);
        must((await t.evaluate(overflow)) <= 1, 'horizontal overflow');
        const e = await t.evaluate(errs); must(!e.length, `page errors: ${e.join(' | ')}`);
        return '';
      });

      // ---------------------------------------------------------------- product page
      await check(`ST-${tag}-product`, `product page on ${tag}: a discounted product shows old price struck + "خصم %" + "وفّر"; a normal one shows NO badge; "قد يعجبك أيضًا" lists buyable related products, never itself`, async () => {
        must(simpleOfferId && plainId, 'catalogue needs one offer and one normal product');
        await go(`/product/${simpleOfferId}`);
        await t.waitFor(`!!document.querySelector('[data-testid=product-price-block]')`, 20_000, 'price block');
        const o = expectedOffer(catalogue[simpleOfferId]);
        const pb = await t.evaluate(`({ badge: document.querySelector('[data-testid=product-sale-badge]')?.textContent || '', save: document.querySelector('[data-testid=product-save]')?.textContent || '', orig: !!document.querySelector('[data-testid=product-original-price]') })`);
        must(pb.badge.includes(`${o.percent}%`) && pb.orig && pb.save.includes('وفّر'), `offer block ${JSON.stringify(pb)}`);
        await shot(t, `after-${tag}-product-offer`);
        await t.waitFor(`!!document.querySelector('[data-testid=similar-products]')`, 15_000, 'similar products');
        const sim = await t.evaluate(`[...document.querySelectorAll('[data-testid=similar-products] [data-product-id]')].map((c) => c.dataset.productId)`);
        must(sim.length > 0 && !sim.includes(simpleOfferId), `similar: ${sim.join(',')}`);
        for (const id of sim) {
          const p = catalogue[id];
          if (!p) continue; // a standard fixture
          const buyable = p.variants?.length ? p.variants.some((v) => v.stock > 0) : Number(p.stock) > 0;
          must(buyable, `${id} is not buyable`);
        }
        await t.evaluate(`document.querySelector('[data-testid=similar-products]').scrollIntoView({ block: 'start' }); true`);
        await shot(t, `after-${tag}-product-similar`);
        await go(`/product/${plainId}`);
        await t.waitFor(`!!document.querySelector('[data-testid=product-price-block]')`, 20_000, 'price block');
        must(!(await t.evaluate(`!!document.querySelector('[data-testid=product-sale-badge], [data-testid=product-original-price], [data-testid=product-save]')`)), 'a normal product shows a discount');
        must((await t.evaluate(overflow)) <= 1, 'horizontal overflow');
        return '';
      });

      // ---------------------------------------------------------------- cart
      const cartItems = [
        { id: 'sc-notebook', name: 'دفتر', price: 1.5, stock: 40, category: 'Stationery', image: '', quantity: 1 },
        // stored with an OLD variant price: the cart must show the live one
        { id: 'sc-playmat', name: 'فرشة', price: 16, stock: 0, category: 'Games', image: '', quantity: 1, selectedVariant: { id: 'pm-blue', label: 'أزرق', type: 'color', price: 19, stock: 4 } },
      ];
      if (!process.env.E2E_CATALOG_FILE) await check(`ST-${tag}-cart`, `cart on ${tag}: live prices (a stale variant price is NOT used), real discounts per line + saving note; "كمّل طلبك" = related, buyable, not in the cart; nothing added until "أضف"; adding updates the total`, async () => {
        await go('/cart', { key: `c${tag}`, items: cartItems });
        await t.waitFor(`!!document.querySelector('[data-testid=cart-suggestions]')`, 20_000, 'cart suggestions');
        const linePrices = await t.evaluate(`[...document.querySelectorAll('[data-testid=cart-line-price]')].map((e) => Number(e.dataset.price))`);
        must(linePrices.includes(16) && !linePrices.includes(19), `line prices ${linePrices.join(',')} (live 16 expected, never the stored 19)`);
        must(await t.evaluate(`!!document.querySelector('[data-testid=cart-sale-savings]')`), 'no saving note');
        const sugg = await t.evaluate(`[...document.querySelectorAll('[data-testid=cart-suggestions] [data-testid=suggestion-card]')].map((c) => c.dataset.productId)`);
        must(sugg.length > 0, 'no suggestions');
        must(!sugg.includes('sc-notebook') && !sugg.includes('sc-playmat') && !sugg.includes('sc-girls'), `bad suggestions ${sugg.join(',')}`);
        const before = await t.evaluate(`JSON.parse(localStorage.getItem('anta_cart') || '[]').length`);
        must(before === 2, `cart changed by itself (${before})`);
        await shot(t, `after-${tag}-cart`);
        await t.evaluate(`document.querySelector('[data-testid=cart-suggestions]').scrollIntoView({ block: 'center' }); true`);
        await shot(t, `after-${tag}-cart-suggestions`);
        const addId = await t.evaluate(`(() => { const b = document.querySelector('[data-testid=cart-suggestions] [data-testid=suggestion-add]'); if (!b) return null; const id = b.closest('[data-product-id]').dataset.productId; b.click(); return id; })()`);
        must(addId, 'no addable suggestion');
        await t.waitFor(`JSON.parse(localStorage.getItem('anta_cart') || '[]').some((i) => i.id === ${JSON.stringify(addId)})`, 8_000, 'added to the cart');
        await sleep(600);
        const after = await t.evaluate(`[...document.querySelectorAll('[data-testid=cart-suggestions] [data-testid=suggestion-card]')].map((c) => c.dataset.productId)`);
        must(!after.includes(addId), 'the added product is still suggested');
        must((await t.evaluate(overflow)) <= 1, 'horizontal overflow');
        const e = await t.evaluate(errs); must(!e.length, `page errors: ${e.join(' | ')}`);
        return '';
      });

      // ---------------------------------------------------------------- checkout (+ a real local guest order on the phone)
      if (!process.env.E2E_CATALOG_FILE) await check(`ST-${tag}-checkout`, `checkout on ${tag}: "قد تحتاج أيضًا" (max 3) on the first step only; adding one updates the summary${vp.mobile ? '; a guest order WITH the added product is accepted by the server (live prices = server prices), stock reserved, not deducted' : ''}`, async () => {
        await go('/checkout', { key: `k${tag}`, items: cartItems });
        await t.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 40_000, 'checkout form');
        await t.waitFor(`!!document.querySelector('[data-testid=checkout-suggestions]')`, 15_000, 'checkout suggestions');
        const n = await t.evaluate(`document.querySelectorAll('[data-testid=checkout-suggestions] [data-testid=suggestion-card]').length`);
        must(n >= 1 && n <= 3, `${n} suggestions`);
        await shot(t, `after-${tag}-checkout`);
        const addId = await t.evaluate(`(() => { const b = document.querySelector('[data-testid=checkout-suggestions] [data-testid=suggestion-add]'); if (!b) return null; const id = b.closest('[data-product-id]').dataset.productId; b.click(); return id; })()`);
        must(addId, 'no addable suggestion');
        await t.waitFor(`JSON.parse(localStorage.getItem('anta_cart') || '[]').length === 3`, 8_000, 'added');
        if (!vp.mobile) return '';
        await t.evaluate(`(() => { ${SET_VAL}
          setVal(document.querySelector('input[placeholder^="name@example.com"]'), 'store@example.com');
          setVal(document.querySelector('input[placeholder="الاسم الأول والأخير"]'), 'زبون فحص العروض');
          setVal(document.querySelector('input[placeholder="0791234567"]'), '0791230002');
          setVal([...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'zarqa')), 'zarqa');
          return true; })()`);
        await sleep(150);
        await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('input[placeholder^="اسم الشارع"]'), 'شارع العروض 1'); return true; })()`);
        await t.evaluate(`${AGREE} ${STICKY}.click(); true`);
        await t.waitFor(`document.body.innerText.includes('توصيل عادي')`, 10_000, 'step 2');
        must(!(await t.evaluate(`!!document.querySelector('[data-testid=checkout-suggestions]')`)), 'suggestions still shown after the first step');
        await t.evaluate(`${AGREE} ${STICKY}.click(); true`);
        await t.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('CliQ'))`, 10_000, 'step 3');
        await t.evaluate(`${AGREE} ${STICKY}.click(); true`);
        const out = await t.waitFor(OUTCOME, 40_000, 'order outcome');
        must(out === 'success', `order outcome ${out} (the server refused the prices?)`);
        const orderId = await t.evaluate(`decodeURIComponent(location.hash.split('/').pop() || '')`);
        const L = await ctx.get(`orderLedger/${orderId}`);
        const o = await ctx.get(`orders/${orderId}`);
        must(L?.stockPolicy === 'on_delivery' && L?.inventory === 'reserved', `ledger ${L?.stockPolicy}/${L?.inventory}`);
        must(o?.items?.length === 3 && o.items.some((i) => i.productId === addId || i.id === addId), 'the added product is not in the order');
        const pm = await ctx.get('products/sc-playmat');
        must(pm.variants.find((v) => v.id === 'pm-blue').stock === 4, 'variant stock deducted before delivery');
        const line = o.items.find((i) => (i.productId || i.id) === 'sc-playmat');
        must(Math.abs(Number(line.price) - 16) < 1e-9, `play mat charged ${line.price} (live price 16)`);
        await shot(t, `after-${tag}-order-success`);
        return `order ${orderId}`;
      });

      // ---------------------------------------------------------------- Amman delivery fees (owner's decision 2026-11-28: the
      // Worker's prices). Every other scenario uses Zarqa, which is how 7 Amman areas being refused PRICE_CHANGED went
      // unseen. Real page, real Worker (PRICE_CHECK_MODE=enforce): no fee before the area; each area / method / governorate
      // change updates the delivery AND the total; a real local order from a formerly refused area is accepted.
      if (!process.env.E2E_CATALOG_FILE) await check(`ST-${tag}-amman-delivery`, `Amman delivery on ${tag}: no "0.00" before the area; a1 1.00 / a5 1.50 / a9 2.50 / Irbid 3.00 shown and added to the total; ${vp.mobile ? 'a2 FAST 2.00 + cash on delivery' : 'a6 standard 1.50 + CliQ'}: the order is ACCEPTED by the Worker (enforce), delivery and total saved as shown`, async () => {
        await go('/checkout', { key: `m${tag}`, items: cartItems.slice(0, 1) });
        await t.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 40_000, 'checkout form');
        // the page's own figures, Arabic digits read as numbers
        // "‏١٫٠٠ د.أ.‏" -> 1 (the first number only: the currency's own dots are not part of it)
        const NUM = `const num = (s) => { const m = String(s || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').match(/\\d+(?:\\.\\d+)?/); return m ? Number(m[0]) : -1; };`;
        const fig = () => t.evaluate(`(() => { ${NUM} const s = document.querySelector('[data-testid=summary-shipping]'); const tot = document.querySelector('[data-testid=checkout-sticky-total]') || [...document.querySelectorAll('span,div')].find((e) => e.children.length === 0 && /^الإجمالي$/.test(e.textContent.trim()))?.parentElement?.lastElementChild; return { known: s?.dataset.known, ship: s?.dataset.known === 'yes' ? num(s.textContent) : null, shipText: s?.textContent.trim(), total: num(tot?.textContent) }; })()`);
        const pickArea = async (needle) => {
          // as a customer does: clear the field (it holds the previous area's name, which filters the list), then look
          await t.evaluate(`(() => { ${SET_VAL} const i = document.querySelector('input[placeholder^="اكتب اسم منطقتك"]'); if (i.value) setVal(i, ''); i.focus(); i.dispatchEvent(new FocusEvent('focus', { bubbles: true })); return true; })()`);
          await sleep(300);
          const got = await t.evaluate(`(() => { const c = [...document.querySelectorAll('div.cursor-pointer')].find((x) => x.innerText.includes(${JSON.stringify(needle)})); if (!c) return null; c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return c.innerText.trim(); })()`);
          must(got, `area "${needle}" not offered`);
          await sleep(300);
        };
        const city = (slug) => t.evaluate(`(() => { ${SET_VAL} setVal([...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'zarqa')), ${JSON.stringify(slug)}); return true; })()`);
        const sub = 1.5; // one notebook (cartItems[0]); no volume discount for one piece
        const f0 = await fig();
        must(f0.known === 'no' && f0.shipText.includes('يُحدَّد بعد اختيار المنطقة') && !/٠٫٠٠|0\.00/.test(f0.shipText), `before any governorate: "${f0.shipText}"`);
        const phone = vp.mobile ? '0791230031' : '0791230032';
        await t.evaluate(`(() => { ${SET_VAL}
          setVal(document.querySelector('input[placeholder^="name@example.com"]'), 'amman-${tag}@example.com');
          setVal(document.querySelector('input[placeholder="الاسم الأول والأخير"]'), 'زبون توصيل عمان');
          setVal(document.querySelector('input[placeholder="0791234567"]'), '${phone}');
          return true; })()`);
        await city('amman'); await sleep(300);
        const f1 = await fig();
        must(f1.known === 'no' && !/٠٫٠٠|0\.00/.test(f1.shipText), `Amman without an area: "${f1.shipText}"`);
        for (const [needle, fee] of [['النزهة', 1], ['وسط البلد', 1.5], ['الجبيهة', 2.5]]) {
          await pickArea(needle);
          const f = await fig();
          must(f.known === 'yes' && Math.abs(f.ship - fee) < 1e-9, `${needle}: delivery ${f.ship} ("${f.shipText}"), expected ${fee}`);
          if (vp.mobile) must(Math.abs(f.total - (sub + fee)) < 1e-9, `${needle}: total ${f.total}, expected ${sub + fee}`);
        }
        await city('irbid'); await sleep(300);
        const fi = await fig();
        must(fi.known === 'yes' && Math.abs(fi.ship - 3) < 1e-9, `Irbid: delivery ${fi.ship}`);
        if (vp.mobile) must(Math.abs(fi.total - (sub + 3)) < 1e-9, `Irbid: total ${fi.total}`);
        // the order: phone = a2 (was 2.00 on the page, refused) FAST; desktop = a6 (was 2.00, refused) standard
        const [needle, fee, method, payment] = vp.mobile ? ['جبل الحسين', 2, 'fast', 'cod'] : ['تلاع العلي', 1.5, 'standard', 'cliq'];
        await city('amman'); await sleep(300);
        await pickArea(needle);
        await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('input[placeholder^="اسم الشارع"]'), 'شارع التوصيل 7'); return true; })()`);
        await t.evaluate(`${STICKY}.click(); true`);
        await t.waitFor(`document.body.innerText.includes('توصيل عادي')`, 10_000, 'step 2');
        must(await t.evaluate(`document.body.innerText.includes('توصيل سريع')`), 'no fast option in Amman');
        if (method === 'fast') {
          await t.evaluate(`(() => { const c = [...document.querySelectorAll('button,label,div[role=radio],div.cursor-pointer')].find((x) => x.innerText && x.innerText.trim().startsWith('توصيل سريع')); c?.click(); return !!c; })()`);
          await sleep(500);
        }
        const f2 = await fig();
        must(Math.abs(f2.ship - fee) < 1e-9, `${method}: delivery ${f2.ship}, expected ${fee}`);
        await t.evaluate(`${STICKY}.click(); true`);
        await t.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('CliQ'))`, 10_000, 'step 3');
        if (payment === 'cliq') {
          await t.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('CliQ')).click(); true`);
          await t.waitFor(`!!document.querySelector('[data-testid=cliq-details]')`, 8_000, 'CliQ details');
          await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('input[placeholder^="رقم مكون من أرقام"]'), 'REF5551234'); return true; })()`);
        }
        must(!(await t.evaluate(`document.body.innerText.includes('يوجد اختلاف في الأسعار')`)), 'the price-difference warning is shown');
        await shot(t, `after-${tag}-amman-${method}-${payment}`);
        await t.evaluate(`${AGREE} ${STICKY}.click(); true`);
        const out = await t.waitFor(OUTCOME, 40_000, 'order outcome');
        must(out === 'success', `order outcome "${out}" (refused by the Worker?)`);
        const orderId = await t.evaluate(`decodeURIComponent(location.hash.split('/').pop() || '')`);
        const o = await ctx.get(`orders/${orderId}`);
        const L = await ctx.get(`orderLedger/${orderId}`);
        must(o.addressMeta?.citySlug === 'amman' && o.shippingMethodId === method && o.paymentMethod === payment, `saved ${o.addressMeta?.citySlug}/${o.addressMeta?.ammanAreaId} ${o.shippingMethodId} ${o.paymentMethod}`);
        must(Math.abs(o.shippingCost - fee) < 1e-9 && Math.abs(o.total - (sub + fee)) < 1e-9, `saved delivery ${o.shippingCost} total ${o.total}`);
        must(L.priceMismatch === false && Math.abs(L.serverPricing.shipping - fee) < 1e-9 && Math.abs(L.serverPricing.total - o.total) < 1e-9, `Worker: mismatch ${L.priceMismatch}, shipping ${L.serverPricing?.shipping}, total ${L.serverPricing?.total}`);
        if (payment === 'cliq') must(o.paymentDetails?.cliqReference === 'REF5551234', 'CliQ reference not saved');
        await shot(t, `after-${tag}-amman-order-success`);
        must((await t.evaluate(errs)).length === 0, `JS errors ${JSON.stringify(await t.evaluate(errs))}`);
        return `order ${orderId} ${o.addressMeta.ammanAreaId} ${method} ${payment} delivery ${o.shippingCost}`;
      });

      // ---------------------------------------------------------------- the REQUIRED agreement box (no pre-tick, no send without it)
      if (!process.env.E2E_CATALOG_FILE) await check(`ST-${tag}-agreement`, `agreement on ${tag}: ONE box only (the required agreement), UNticked; confirm without the required one -> NOTHING sent, a clear message, the box focused; the link is the real policies page (new tab); ticked -> the order goes through`, async () => {
        await go('/checkout', { key: `a${tag}`, items: cartItems.slice(0, 1) });
        await t.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 40_000, 'checkout form');
        // count create-order requests leaving THIS page
        await t.evaluate(`(() => { window.__creates = 0; const f = window.fetch.bind(window); window.fetch = (u, i) => { if (/create-order/.test(String(u && u.url || u))) window.__creates++; return f(u, i); }; return true; })()`);
        const phone = vp.mobile ? '0791230011' : '0791230012';
        await t.evaluate(`(() => { ${SET_VAL}
          setVal(document.querySelector('input[placeholder^="name@example.com"]'), 'agree@example.com');
          setVal(document.querySelector('input[placeholder="الاسم الأول والأخير"]'), 'زبون فحص الموافقة');
          setVal(document.querySelector('input[placeholder="0791234567"]'), '${phone}');
          setVal([...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'zarqa')), 'zarqa');
          return true; })()`);
        await sleep(150);
        await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('input[placeholder^="اسم الشارع"]'), 'شارع الموافقة 1'); return true; })()`);
        await t.evaluate(`${STICKY}.click(); true`); // step 1 -> 2 WITHOUT the box (it is not on this step)
        await t.waitFor(`document.body.innerText.includes('توصيل عادي')`, 10_000, 'step 2 reached without any agreement');
        await t.evaluate(`${STICKY}.click(); true`);
        await t.waitFor(`!!document.querySelector('[data-testid=checkout-agreement-box]')`, 10_000, 'step 3 with the box');
        const boxes = await t.evaluate(`[...document.querySelectorAll('input[type=checkbox]')].filter((c) => c.offsetParent !== null).map((c) => ({ id: c.dataset.testid || c.closest('label')?.innerText.slice(0, 30), on: c.checked }))`);
        must(boxes.length === 1 && boxes[0].id === 'checkout-agreement-box' && !boxes[0].on, `exactly one UNticked box (the agreement) expected: ${JSON.stringify(boxes)}`);
        // the link: the site's real policies page, in a new tab (the checkout stays)
        const link = await t.evaluate(`(() => { const a = document.querySelector('[data-testid=checkout-policies-link]'); return a ? { href: a.getAttribute('href'), target: a.target } : null; })()`);
        must(link && link.href === '#/privacy' && link.target === '_blank', `policies link ${JSON.stringify(link)}`);
        // phones: the only primary action is the bar; desktop: the in-page button
        const btn = vp.mobile ? STICKY : `document.querySelector('[data-testid=checkout-confirm]')`;
        must(await t.evaluate(`${btn}.offsetParent !== null`), 'the confirm button for this screen is not visible');
        if (vp.mobile) must(await t.evaluate(`document.querySelector('[data-testid=checkout-confirm]').offsetParent === null`), 'two primary buttons on the phone');
        // confirm WITHOUT the box: nothing sent
        await t.evaluate(`${btn}.click(); true`);
        await t.waitFor(`!!document.querySelector('[data-testid=checkout-agreement-error]')`, 5_000, 'agreement message');
        await sleep(1_500);
        must((await t.evaluate(`window.__creates`)) === 0, 'an order was sent without the agreement');
        must(await t.evaluate(`location.hash === '#/checkout'`), 'left the checkout');
        must(await t.evaluate(`document.activeElement?.dataset?.testid === 'checkout-agreement-box'`), 'the box is not focused');
        must(/فعّل مربع الموافقة/.test(await t.evaluate(`document.querySelector('[data-testid=checkout-agreement-error]').innerText`)), 'message text');
        must((await t.evaluate(overflow)) <= 1, 'horizontal overflow');
        await shot(t, `after-${tag}-agreement-required`);
        // tick it (as the customer) -> the message goes, the order goes through ONCE
        await t.evaluate(`document.querySelector('[data-testid=checkout-agreement-box]').click(); true`);
        must(!(await t.evaluate(`!!document.querySelector('[data-testid=checkout-agreement-error]')`)), 'message stays after ticking');
        await shot(t, `after-${tag}-agreement-ticked`);
        await t.evaluate(`${btn}.click(); true`);
        const out = await t.waitFor(OUTCOME, 40_000, 'order outcome');
        must(out === 'success', `order outcome ${out}`);
        must((await t.evaluate(`window.__creates`)) === 1, 'not exactly one create request');
        const orderId = await t.evaluate(`decodeURIComponent(location.hash.split('/').pop() || '')`);
        const o = await ctx.get(`orders/${orderId}`);
        must(o?.consents?.acceptedStorePolicies === true, `agreement not recorded: ${JSON.stringify(o?.consents)}`);
        must(o?.consents?.saveInfo === false && o?.consents?.acceptedDeliveryPolicy === false, `a consent without a box recorded as given: ${JSON.stringify(o?.consents)}`);
        // the policies page itself exists and has content
        await t.evaluate(`location.hash = '#/privacy'; true`);
        await t.waitFor(`/السياسات والخصوصية/.test(document.body.innerText) && /الإرجاع والاستبدال/.test(document.body.innerText)`, 15_000, 'policies page');
        return `order ${orderId}`;
      });

      // ---------------------------------------------------------------- checkout draft: typed details survive a visit to a product
      if (!process.env.E2E_CATALOG_FILE) await check(`ST-${tag}-draft`, `checkout draft on ${tag}: details typed -> a SUGGESTED product opened ("back to checkout" shown) -> a product added there -> back: name / phone / e-mail / governorate / street restored, total RECOMPUTED; steps 1->2->3 keep it; a refresh at step 3 keeps step + details, the agreement is NOT restored; confirmed -> ONE order, the draft is gone, consents honest, stock untouched at creation`, async () => {
        await go('/checkout', { key: `d${tag}`, items: cartItems.slice(0, 1) });
        await t.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 40_000, 'checkout form');
        const phone = vp.mobile ? '0791230021' : '0791230022';
        const typed = { name: `زبون المسودة ${tag}`, phone, email: `draft-${tag}@example.com`, street: `شارع المسودة ${tag} 7` };
        const fields = () => t.evaluate(`({ name: document.querySelector('input[placeholder="الاسم الأول والأخير"]')?.value, phone: document.querySelector('input[placeholder="0791234567"]')?.value, email: document.querySelector('input[placeholder^="name@example.com"]')?.value, street: document.querySelector('input[placeholder^="اسم الشارع"]')?.value, city: [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'zarqa'))?.value })`);
        const sameAsTyped = (f) => f.name === typed.name && f.phone === typed.phone && f.email === typed.email && f.street === typed.street && f.city === 'zarqa';
        await t.evaluate(`(() => { ${SET_VAL}
          setVal(document.querySelector('input[placeholder^="name@example.com"]'), ${JSON.stringify(typed.email)});
          setVal(document.querySelector('input[placeholder="الاسم الأول والأخير"]'), ${JSON.stringify(typed.name)});
          setVal(document.querySelector('input[placeholder="0791234567"]'), ${JSON.stringify(typed.phone)});
          setVal([...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'zarqa')), 'zarqa');
          return true; })()`);
        await sleep(150);
        await t.evaluate(`(() => { ${SET_VAL} setVal(document.querySelector('input[placeholder^="اسم الشارع"]'), ${JSON.stringify(typed.street)}); return true; })()`);
        await sleep(300);
        await shot(t, `draft-${tag}-1-typed`);
        const totalBefore = await t.evaluate(`document.querySelector('[data-testid=checkout-sticky-total]').textContent`);
        const stored = await t.evaluate(`sessionStorage.getItem('anta_checkout_draft_v1') || ''`);
        must(stored.includes(typed.phone) && stored.includes('zarqa'), `draft not saved while typing: ${stored.slice(0, 160)}`);
        must(!/accept|consent|turnstile|token|cliqRef/i.test(stored), `the draft holds more than the details: ${stored}`);
        // a suggested product (in-app link from the checkout's "قد تحتاج أيضًا", shown on step 1)
        await t.waitFor(`!!document.querySelector('[data-testid=checkout-suggestions] a[href*="/product/"]')`, 15_000, 'checkout suggestions');
        const sugId = await t.evaluate(`(() => { const a = document.querySelector('[data-testid=checkout-suggestions] a[href*="/product/"]'); const id = a.getAttribute('href').split('/').pop(); a.click(); return id; })()`);
        await t.waitFor(`!!document.querySelector('[data-testid=product-price-block]')`, 20_000, 'product page');
        must(await t.evaluate(`!!document.querySelector('[data-testid=back-to-checkout]')`), 'no "back to checkout" on the product page');
        await shot(t, `draft-${tag}-2-product`);
        const added = await t.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /أضف للسلة/.test(x.textContent) && !x.disabled && !x.closest('[data-testid=similar-products]')); if (!b) return false; b.click(); return true; })()`);
        await sleep(1200);
        await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await sleep(400);
        await t.evaluate(`document.querySelector('[data-testid=back-to-checkout]').click(); true`);
        await t.waitFor(`!!document.querySelector('input[placeholder="0791234567"]')`, 20_000, 'back on checkout');
        await sleep(800);
        const back = await fields();
        must(sameAsTyped(back), `details lost after the product page: ${JSON.stringify(back)}`);
        const after = await t.evaluate(`({ total: document.querySelector('[data-testid=checkout-sticky-total]').textContent, items: JSON.parse(localStorage.getItem('anta_cart') || '[]').length })`);
        must(!added || (after.items === 2 && after.total !== totalBefore), `total not recomputed with the new item: ${totalBefore} -> ${after.total} (${after.items} items)`);
        await shot(t, `draft-${tag}-3-back-restored`);
        // the three steps: nothing lost
        await t.evaluate(`${STICKY}.click(); true`);
        await t.waitFor(`document.body.innerText.includes('توصيل عادي')`, 10_000, 'step 2');
        await t.evaluate(`${STICKY}.click(); true`);
        await t.waitFor(`!!document.querySelector('[data-testid=checkout-agreement-box]')`, 10_000, 'step 3');
        await t.evaluate(`document.querySelector('[data-testid=checkout-agreement-box]').click(); true`); // ticked, then a refresh
        // a refresh at step 3: same step, details kept, the agreement NOT restored (ticked again by the customer)
        await t.reload();
        await t.waitFor(`!!document.querySelector('[data-testid=checkout-sticky-total]')`, 30_000, 'checkout after refresh');
        await sleep(1000);
        const r = await t.evaluate(`({ step: document.querySelector('[data-testid=checkout-sticky-action]')?.dataset.step, box: document.querySelector('[data-testid=checkout-agreement-box]')?.checked ?? null })`);
        must(r.step === '3' && r.box === false, `after refresh: ${JSON.stringify(r)} (step 3, agreement unticked expected)`);
        await shot(t, `draft-${tag}-4-refresh-step3`);
        // confirm: ONE order with the typed details, the draft is gone
        await t.evaluate(`(() => { window.__creates = 0; const f = window.fetch.bind(window); window.fetch = (u, i) => { if (/create-order/.test(String(u && u.url || u))) window.__creates++; return f(u, i); }; return true; })()`);
        const stockBefore = (await ctx.get('products/sc-notebook'))?.stock;
        const btn = vp.mobile ? STICKY : `document.querySelector('[data-testid=checkout-confirm]')`;
        await t.evaluate(`${AGREE} ${btn}.click(); true`);
        const out = await t.waitFor(OUTCOME, 40_000, 'order outcome');
        must(out === 'success', `order outcome ${out}`);
        must((await t.evaluate(`window.__creates`)) === 1, 'not exactly one create request');
        const orderId = await t.evaluate(`decodeURIComponent(location.hash.split('/').pop() || '')`);
        must(await t.evaluate(`sessionStorage.getItem('anta_checkout_draft_v1') === null`), 'the draft was kept after the order');
        const o = await ctx.get(`orders/${orderId}`);
        must(JSON.stringify(o || {}).includes(typed.street), 'order without the typed address');
        must(o?.consents?.acceptedStorePolicies === true && o?.consents?.saveInfo === false && o?.consents?.acceptedDeliveryPolicy === false, `consents ${JSON.stringify(o?.consents)}`);
        must((await ctx.get('products/sc-notebook'))?.stock === stockBefore, 'stock changed at order creation (policy: on delivery)');
        return `order ${orderId}${added ? ` (+${sugId})` : ''}`;
      });

      // ---------------------------------------------------------------- desktop widths: the bar with the new link fits
      // the header items must not OVERLAP each other (an overlap is not an overflow: it was missed once)
      const HEADER_OVERLAP = `(() => {
        const nav = document.querySelector('[data-testid=desktop-nav]');
        if (!nav) return ['no nav'];
        const logo = document.querySelector('header a[aria-label*="الرئيسية"]');
        const search = document.querySelector('header input[type=search], header form input');
        const items = [...nav.children].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
        const box = (el) => el ? el.getBoundingClientRect() : null;
        const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const out = [];
        const lr = box(logo); const sr = box(search?.closest('form') || search);
        items.forEach((r, i) => { if (hit(r, lr)) out.push('nav item ' + i + ' over the logo'); if (hit(r, sr)) out.push('nav item ' + i + ' under the search'); });
        // the logo text must not be cut
        const name = logo?.querySelector('span.truncate');
        if (name && name.scrollWidth > name.clientWidth + 1) out.push('logo name truncated');
        return out;
      })()`;
      if (!vp.mobile) for (const w of [1280, 1366, 1536]) await check(`ST-desktop-${w}`, `header at ${w} px with "العروض": visible, nothing overlaps (logo / menus / search), no overflow`, async () => {
        await t.send('Emulation.setDeviceMetricsOverride', { width: w, height: 860, deviceScaleFactor: 1, mobile: false });
        await go('/');
        must(await t.evaluate(`!!document.querySelector('[data-testid=nav-offers]') && document.querySelector('[data-testid=nav-offers]').getBoundingClientRect().width > 0`), 'link hidden');
        const ov = await t.evaluate(HEADER_OVERLAP);
        must(!ov.length, ov.join('; '));
        must((await t.evaluate(overflow)) <= 1, `horizontal overflow at ${w}`);
        await t.send('Page.captureScreenshot', { format: 'jpeg', quality: 72, clip: { x: 0, y: 0, width: w, height: 160, scale: 1 } }).then((r) => writeFileSync(join(shots, `after-desktop-${w}-header.jpg`), Buffer.from(r.data, 'base64')));
        return '';
      });
    } finally {
      await t.close();
    }
  }
  // ---------------------------------------------------------------- an ad link straight to a product page
  // The product is read on its own (services/productEarly.ts) and shown BEFORE the catalogue: here the catalogue read
  // (:runQuery) is HELD in the page on purpose. The product must be complete and buyable meanwhile; what the visitor
  // chose (colour, quantity) must survive the catalogue's arrival; an unknown id must not say "not found" too early.
  {
    const t = await ctx.openTab();
    const HOLD = `(() => { const of = window.fetch; window.__held = []; window.__heldCount = 0;
      window.fetch = function (u, o) { const url = String((u && u.url) || u);
        if (url.includes(':runQuery') && !window.__released) { window.__heldCount++; return new Promise((res, rej) => window.__held.push(() => of.call(window, u, o).then((r) => { r.clone().text().then(() => { window.__catalogueDone = (window.__catalogueDone || 0) + 1; }, () => {}); res(r); }, rej))); }
        return of.apply(window, arguments); };
      window.__releaseCatalogue = () => { window.__released = true; window.__held.splice(0).forEach((f) => f()); return true; }; })();`;
    let hookId = null;
    try {
      await t.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      hookId = (await t.send('Page.addScriptToEvaluateOnNewDocument', { source: HOLD + ` window.__stErrs = []; addEventListener('error', (e) => window.__stErrs.push(String(e.message).slice(0, 160))); localStorage.setItem('language', 'ar');` })).identifier;
      const open = async (hash) => {
        await t.send('Storage.clearDataForOrigin', { origin: ctx.base, storageTypes: 'local_storage' });
        await t.evaluate(`(() => { try { sessionStorage.clear(); } catch {} return true; })()`).catch(() => {});
        await t.navigate(`${ctx.base}/?keepdraft=1&r=${Date.now()}#${hash}`);
      };
      const AREA = `document.querySelector('[data-testid=product-price-block]')?.parentElement`;
      const BUY = `[...(${AREA}?.querySelectorAll('button') || [])].find((b) => b.querySelector('svg.lucide-shopping-cart, svg.lucide-bell'))`;
      const QTY = `(${AREA}?.querySelector('input')?.value || '')`;

      await check('ST-early-product', 'ad link straight to a product (catalogue read HELD): name, price, colours and "add to cart" shown without the catalogue; the chosen colour + quantity survive its arrival; added to the cart correctly', async () => {
        await open('/product/p-variants');
        await t.waitFor(`!!document.querySelector('[data-testid=product-price]') && window.__heldCount > 0 && !window.__released`, 30_000, 'product shown while the catalogue is held');
        const v = await t.evaluate(`({ name: document.querySelector('main h1')?.textContent?.trim(), price: document.querySelector('[data-testid=product-price]')?.textContent || '', buy: (() => { const b = ${BUY}; return b ? (b.disabled ? 'disabled' : b.querySelector('svg.lucide-bell') ? 'notify' : 'add') : 'none'; })(), similar: document.querySelectorAll('[data-testid=similar-products] [data-product-id]').length, held: window.__heldCount })`);
        must(v.name === 'قلم', `name ${v.name}`);
        must(/[3٣]/.test(v.price), `price ${v.price}`);
        must(v.buy === 'add', `buy button: ${v.buy} (the first colour has stock 5)`);
        must(v.similar === 0, 'similar products need the catalogue (still held)');
        // the visitor chooses: quantity 3 (the first colour, red, has 5)
        for (let i = 0; i < 2; i++) await t.evaluate(`[...(${AREA}.querySelectorAll('button'))].find((b) => b.querySelector('svg.lucide-plus')).click(); true`);
        await t.waitFor(`${QTY} === '3'`, 5_000, 'quantity 3');
        await shot(t, 'early-product-before-catalogue');
        // the catalogue arrives: nothing the visitor chose is reset
        await t.evaluate(`window.__releaseCatalogue()`);
        await t.waitFor(`window.__catalogueDone > 0`, 30_000, 'catalogue answer arrived');
        await sleep(1500); // the app renders with the catalogue
        must((await t.evaluate(QTY)) === '3', `quantity reset to ${await t.evaluate(QTY)} when the catalogue arrived`);
        await t.evaluate(`${BUY}.click(); true`);
        await t.waitFor(`(JSON.parse(localStorage.getItem('anta_cart') || '[]')).length > 0`, 10_000, 'added to the cart');
        const cart = await t.evaluate(`JSON.parse(localStorage.getItem('anta_cart') || '[]').map((i) => ({ id: i.id, q: i.quantity, v: i.selectedVariant && i.selectedVariant.id, price: i.selectedVariant ? i.selectedVariant.price : i.price }))`);
        must(cart.length === 1 && cart[0].id === 'p-variants' && cart[0].q === 3 && cart[0].v === 'var_red' && Number(cart[0].price) === 3, `cart ${JSON.stringify(cart)}`);
        const e = await t.evaluate(errs);
        must(!e.length, `errors: ${e.join(' | ')}`);
        return '';
      });

      await check('ST-early-unknown', 'ad link to a product that does not exist (catalogue HELD): a loading view, never "not found" too early; "not found" once the catalogue arrived', async () => {
        await open('/product/p-does-not-exist-123');
        await t.waitFor(`window.__heldCount > 0`, 30_000, 'catalogue requested');
        await sleep(2500);
        must(!(await t.evaluate(`document.body.innerText.includes('المنتج غير موجود')`)), '"not found" shown before the catalogue arrived');
        must(!(await t.evaluate(`!!document.querySelector('[data-testid=product-price]')`)), 'a product shown for an unknown id');
        await t.evaluate(`window.__releaseCatalogue()`);
        await t.waitFor(`document.body.innerText.includes('المنتج غير موجود')`, 30_000, '"not found" after the catalogue');
        return '';
      });

      await check('ST-early-other-product', 'after the ad product, the visitor opens ANOTHER product while the catalogue is still held: a loading view (no wrong product); both right once it arrives', async () => {
        await open('/product/p-simple');
        await t.waitFor(`document.querySelector('main h1')?.textContent?.trim() === 'دفتر' && !window.__released`, 30_000, 'ad product shown early');
        await t.evaluate(`location.hash = '#/product/p-empty-variants'; true`);
        await sleep(1500);
        const h = await t.evaluate(`document.querySelector('main h1')?.textContent?.trim() || ''`);
        must(h !== 'دفتر', 'the previous product is still shown for another link');
        must(!(await t.evaluate(`document.body.innerText.includes('المنتج غير موجود')`)), '"not found" before the catalogue');
        await t.evaluate(`window.__releaseCatalogue()`);
        await t.waitFor(`document.querySelector('main h1')?.textContent?.trim() === 'مسطرة'`, 30_000, 'the second product after the catalogue');
        await t.evaluate(`history.back(); true`);
        await t.waitFor(`document.querySelector('main h1')?.textContent?.trim() === 'دفتر'`, 15_000, 'back to the first one');
        return '';
      });
    } finally {
      if (hookId) await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hookId }).catch(() => {});
      await t.close();
    }
  }

  console.log(`[inner] store: ${results.filter((r) => r.ok).length}/${results.length} checks passed; screenshots in ${shots}`);
  return results;
}
