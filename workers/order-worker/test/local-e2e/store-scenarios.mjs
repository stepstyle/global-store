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
        if (cart) await t.send('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.search.includes('seed=${cart.key}')) localStorage.setItem('anta_cart', ${JSON.stringify(JSON.stringify(cart.items))});` });
        await t.navigate(`${ctx.base}/?${cart ? `seed=${cart.key}&` : ''}r=${Date.now()}#${hash}`);
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

      // ---------------------------------------------------------------- the REQUIRED agreement box (no pre-tick, no send without it)
      if (!process.env.E2E_CATALOG_FILE) await check(`ST-${tag}-agreement`, `agreement on ${tag}: both boxes start UNticked; confirm without the required one -> NOTHING sent, a clear message, the box focused; the link is the real policies page (new tab); ticked -> the order goes through`, async () => {
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
        must(boxes.length >= 2 && boxes.every((b) => !b.on), `a box is pre-ticked: ${JSON.stringify(boxes)}`);
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
        must(o?.consents?.saveInfo === false, 'optional consent recorded as given');
        // the policies page itself exists and has content
        await t.evaluate(`location.hash = '#/privacy'; true`);
        await t.waitFor(`/السياسات والخصوصية/.test(document.body.innerText) && /الإرجاع والاستبدال/.test(document.body.innerText)`, 15_000, 'policies page');
        return `order ${orderId}`;
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
  console.log(`[inner] store: ${results.filter((r) => r.ok).length}/${results.length} checks passed; screenshots in ${shots}`);
  return results;
}
