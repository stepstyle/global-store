#!/usr/bin/env node
// Product ages — review & approval (no Firebase access, no product changes).
//
//   1) node scripts/product-ages.mjs review [catalog.json]
//        -> docs/product-ages-review.csv  (open in Excel). One row per toy / baby product (+ any product whose text
//           mentions an age or small parts), with the evidence found in its description and a SUGGESTION.
//           The suggestion is never used by the site. Already-approved ages are pre-filled.
//   2) The store owner checks each product against the PACKAGING / manufacturer info and fills, per row:
//        اعتماد = نعم   ·   من_عمر (years; 0.5 = 6 months)   ·   الى_عمر (empty = "and up")
//        قطع_صغيرة = نعم / لا   (from the packaging warning; "لا" only if the packaging confirms it)
//        المصدر = العبوة / الشركة المصنعة / صاحب المتجر
//   3) node scripts/product-ages.mjs apply --by "<name of the reviewer>" [docs/product-ages-review.csv]
//        -> src/data/productAges.json (only rows with اعتماد = نعم). Any invalid approved row stops the whole apply.
//
// The site (assistant + gift finder) recommends a product for an age ONLY from src/data/productAges.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGES_JSON = join(ROOT, 'src/data/productAges.json');
const REVIEW_CSV = join(ROOT, 'docs/product-ages-review.csv');
const { ageFromText } = await import('../src/services/discovery/catalog.ts');
const { normalizeArabic } = await import('../src/services/discovery/arabicText.ts');
const { validateAgeRegistry, smallPartsWarningInText } = await import('../src/services/discovery/ageRegistry.ts');

const COLS = ['id', 'اسم_المنتج', 'القسم', 'متوفر', 'السعر', 'نوع_الدليل', 'الدليل_من_الوصف', 'مقترح_من_عمر', 'مقترح_الى_عمر', 'تحذير_قطع_صغيرة_بالوصف',
  'اعتماد', 'من_عمر', 'الى_عمر', 'قطع_صغيرة', 'المصدر', 'ملاحظة'];
const SOURCE_AR = { packaging: 'العبوة', manufacturer: 'الشركة المصنعة', owner: 'صاحب المتجر' };
const SOURCE_EN = Object.fromEntries(Object.entries(SOURCE_AR).map(([k, v]) => [v, k]));
const YES = new Set(['نعم', 'yes', 'y', '1', 'true']);
const NO = new Set(['لا', 'no', 'n', '0', 'false']);

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const AGE_WORDS = /(عمر|اعمار|سنوات|سنه|سنين|شهر|اشهر|\d\s*\+|\+\s*\d|ages?\s*\d|years|months)/u;
function evidence(p) {
  const text = `${p.description || ''} ${p.descriptionEn || ''}`;
  const n = normalizeArabic(text).toLowerCase();
  const sentences = text.split(/[.\n!؟?•✅🎁👶👧🧒✨]+/).map((s) => s.trim()).filter((s) => s && AGE_WORDS.test(normalizeArabic(s).toLowerCase()) && s.length < 220);
  const age = ageFromText(n, false);
  let kind = '';
  if (age || sentences.length) {
    if (/(عبوه|العبوه|التغليف|الكرتون|packag|box shows|on the box)/u.test(n)) kind = 'العبوة (حسب الوصف)';
    else if (/(مشابه|similar|غالبا|عاده|commonly|الشائع|تسوق|يسوق|marketed|البائعين|listings|في السوق)/u.test(n)) kind = 'منتجات مشابهة (تخمين)';
    else kind = 'وصف المتجر';
  }
  return { kind, quote: sentences.slice(0, 2).join(' | '), age, smallWarn: smallPartsWarningInText(n) };
}

function review(catalogPath) {
  const products = JSON.parse(readFileSync(catalogPath, 'utf8')).products;
  const approved = existsSync(AGES_JSON) ? validateAgeRegistry(JSON.parse(readFileSync(AGES_JSON, 'utf8'))) : {};
  const inStock = (p) => (Array.isArray(p.variants) && p.variants.length ? p.variants.some((v) => Number(v.stock) > 0) : Number(p.stock) > 0);
  const rows = [];
  for (const p of products) {
    const ev = evidence(p);
    if (!['Games', 'BabyGear'].includes(p.category) && !ev.kind && !ev.smallWarn) continue;
    const a = approved[p.id];
    rows.push([
      p.id, p.name, p.category, inStock(p) ? 'نعم' : 'لا', p.price, ev.kind || 'لا يوجد', ev.quote,
      ev.age ? ev.age[0] : '', ev.age ? (ev.age[1] >= 99 ? '' : ev.age[1]) : '', ev.smallWarn ? 'نعم' : '',
      a ? 'نعم' : '', a ? a.minYears : '', a && a.maxYears != null ? a.maxYears : '', a ? (a.smallParts === 'yes' ? 'نعم' : a.smallParts === 'no' ? 'لا' : '') : '', a ? SOURCE_AR[a.source] : '', a?.note ?? '',
    ]);
  }
  rows.sort((x, y) => (x[3] === y[3] ? String(x[2]).localeCompare(String(y[2])) : x[3] === 'نعم' ? -1 : 1));
  writeFileSync(REVIEW_CSV, '﻿' + [COLS, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n');
  const count = (k) => rows.filter((r) => r[5] === k).length;
  console.log(`review sheet: ${rows.length} products -> docs/product-ages-review.csv`);
  console.log(`  evidence: packaging-per-description ${count('العبوة (حسب الوصف)')}, similar-products guess ${count('منتجات مشابهة (تخمين)')}, store text ${count('وصف المتجر')}, none ${count('لا يوجد')}`);
  console.log(`  already approved: ${Object.keys(approved).length}`);
}

function apply(csvPath, by) {
  if (!by || !by.trim()) { console.error('apply needs --by "<reviewer name>"'); process.exit(2); }
  const [head, ...rows] = parseCsv(readFileSync(csvPath, 'utf8'));
  const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  for (const c of ['id', 'اعتماد', 'من_عمر', 'الى_عمر', 'قطع_صغيرة', 'المصدر']) if (!(c in col)) { console.error(`missing column: ${c}`); process.exit(2); }
  const out = {}; const errors = []; const today = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    const get = (c) => String(r[col[c]] ?? '').trim();
    if (!YES.has(get('اعتماد').toLowerCase())) continue;
    const id = get('id'); const where = `${id} (${get('اسم_المنتج') || '?'})`;
    const min = Number(get('من_عمر')); const maxS = get('الى_عمر'); const max = maxS === '' ? null : Number(maxS);
    const sp = get('قطع_صغيرة').toLowerCase(); const src = SOURCE_EN[get('المصدر')];
    if (!id) { errors.push('approved row without id'); continue; }
    if (get('من_عمر') === '' || !Number.isFinite(min) || min < 0 || min > 99) { errors.push(`${where}: من_عمر must be a number of years`); continue; }
    if (max !== null && (!Number.isFinite(max) || max < min || max > 99)) { errors.push(`${where}: الى_عمر must be empty or >= من_عمر`); continue; }
    if (!YES.has(sp) && !NO.has(sp) && sp !== '') { errors.push(`${where}: قطع_صغيرة must be نعم / لا / empty`); continue; }
    if (!src) { errors.push(`${where}: المصدر must be العبوة / الشركة المصنعة / صاحب المتجر`); continue; }
    out[id] = { minYears: min, maxYears: max, smallParts: YES.has(sp) ? 'yes' : NO.has(sp) ? 'no' : 'unknown', source: src, approvedBy: by.trim(), approvedAt: today, ...(get('ملاحظة') ? { note: get('ملاحظة') } : {}) };
  }
  if (errors.length) { console.error(`NOT applied — fix these rows first:\n  ${errors.join('\n  ')}`); process.exit(1); }
  const doc = { about: 'Product ages APPROVED by the store owner (from packaging / manufacturer). Generated by: node scripts/product-ages.mjs apply. Do not add entries by guessing.', products: out };
  if (Object.keys(validateAgeRegistry(doc)).length !== Object.keys(out).length) { console.error('internal validation failed'); process.exit(1); }
  writeFileSync(AGES_JSON, JSON.stringify(doc, null, 2) + '\n');
  const under3 = Object.values(out).filter((a) => a.minYears < 3 && a.smallParts === 'no').length;
  console.log(`approved ages written: ${Object.keys(out).length} products (suitable under 3 with no small parts: ${under3}) -> src/data/productAges.json`);
}

const [cmd, ...rest] = process.argv.slice(2);
const byAt = rest.indexOf('--by');
const by = byAt >= 0 ? rest[byAt + 1] : '';
const pos = rest.filter((x, i) => x !== '--by' && i !== byAt + 1);
if (cmd === 'review') review(pos[0] ? resolve(pos[0]) : join(ROOT, 'public/catalog-snapshot.json'));
else if (cmd === 'apply') apply(pos[0] ? resolve(pos[0]) : REVIEW_CSV, by);
else { console.log('usage: node scripts/product-ages.mjs review [catalog.json] | apply --by "<name>" [review.csv]'); process.exit(2); }
