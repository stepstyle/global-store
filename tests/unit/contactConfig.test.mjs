// Official contact / payment details (owner-confirmed 2026-11-19) — one central place, no old number anywhere.
//   node --test tests/unit/contactConfig.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_PHONE_LOCAL, STORE_PHONE_INTL, STORE_WHATSAPP_URL, STORE_TEL_URL, ORDERS_WHATSAPP_INTL, CLIQ } from '../../src/config/contact.ts';
import { STORE_WHATSAPP, whatsappUrl, whatsappNewOrderUrl } from '../../src/services/checkoutFlow.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OLD = ['0796969081', '962796969081', 'Moien AbedAlAzizi'];
const walk = (d, out = []) => {
  for (const f of readdirSync(d)) {
    if (['node_modules', 'dist', '.wrangler', '.git'].includes(f)) continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs|html|json|md|toml)$/.test(f) && !p.endsWith('contactConfig.test.mjs')) out.push(p);
  }
  return out;
};

test('the official numbers: local, international, WhatsApp and phone links', () => {
  assert.equal(STORE_PHONE_LOCAL, '0796047637');
  assert.equal(STORE_PHONE_INTL, '962796047637');
  assert.equal(STORE_WHATSAPP_URL, 'https://wa.me/962796047637');
  assert.equal(STORE_TEL_URL, 'tel:+962796047637');
});

test('order-related WhatsApp uses the same official number (receipt, unconfirmed, conflict, order by WhatsApp)', () => {
  assert.equal(ORDERS_WHATSAPP_INTL, '962796047637');
  assert.equal(STORE_WHATSAPP, '962796047637');
  for (const kind of ['cliq_receipt', 'unconfirmed', 'conflict']) {
    assert.match(whatsappUrl(STORE_WHATSAPP, 'ORD-ABCD1234-EFGH5678', { kind, cliqReference: 'R1' }), /^https:\/\/wa\.me\/962796047637\?text=/, kind);
  }
  assert.match(whatsappNewOrderUrl(STORE_WHATSAPP, [{ title: 'دفتر', quantity: 2 }]), /^https:\/\/wa\.me\/962796047637\?text=/);
});

test('CliQ details shown at checkout: alias, beneficiary, wallet', () => {
  assert.deepEqual({ ...CLIQ }, { alias: '0796047637', beneficiary: 'Mohammed moien Antari', walletAr: 'زين كاش', walletEn: 'Zain Cash' });
  assert.ok(Object.isFrozen(CLIQ));
});

test('no old number or old beneficiary anywhere in the project (code, worker, docs, tests)', () => {
  const hits = [];
  for (const f of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'api')), ...walk(join(ROOT, 'workers')), ...walk(join(ROOT, 'tests')), join(ROOT, 'index.html')]) {
    const txt = readFileSync(f, 'utf8');
    for (const o of OLD) if (txt.includes(o)) hits.push(`${f.slice(ROOT.length + 1)}: ${o}`);
  }
  assert.deepEqual(hits, []);
});

test('the checkout page reads the CliQ details from the central settings (no hard-coded phone number)', () => {
  const src = readFileSync(join(ROOT, 'src/pages/Checkout.tsx'), 'utf8');
  // 0791234567 is only the phone field's example placeholder
  assert.deepEqual((src.match(/\b07\d{8}\b|\b9627\d{8}\b/g) || []).filter((n) => n !== '0791234567'), [], 'no literal store number in Checkout.tsx');
  assert.match(src, /CLIQ\.alias/); assert.match(src, /CLIQ\.beneficiary/); assert.match(src, /CLIQ\.walletAr/);
  // copy feedback only on a real copy
  assert.match(src, /const ok = await copyText\(CLIQ\.alias\)/);
  // a CliQ order is never created as paid by the browser
  assert.match(src, /cliqReference: safeTrim\(cliqRef\), isPaid: false/);
});
