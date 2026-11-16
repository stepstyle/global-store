// Stock planning per product shape. Pure function: no I/O.
//
// Rules (Phase 1, compat):
//  - line has variant id that exists exactly once in product.variants -> deduct variants[i].stock ONLY
//    (top-level product.stock is left untouched for variant products)
//  - product without variants (field missing or empty array)          -> deduct top-level stock
//  - variant not found / duplicated / missing id on a variant product  -> warning, no deduction
//  - stock missing or non-numeric                                       -> warning, no deduction
//  - requested > available on ANY line                                   -> warning, NOTHING in the order is
//                                                                          deducted (no partial deduction)
//  - stock stored as numeric string                                     -> deduct and write back as number (warning)
// Raw Firestore values are cloned and only the `stock` value of the matched element is replaced,
// so every other field (colors, images, prices, types) is preserved exactly.

import { rawNumber, encodeNumber } from './firestore.js';

function variantId(rawVariant) {
  const f = rawVariant?.mapValue?.fields;
  return f?.id && 'stringValue' in f.id ? f.id.stringValue : null;
}

/**
 * @param lines   [{ index, productId, variantId, quantity }]
 * @param products Map<productId, {exists, fields, updateTime}>
 * @param stockMode 'off' | 'log' | 'apply'
 */
export function planInventory(lines, products, stockMode) {
  const warnings = [];
  const deductions = [];
  const lineInfo = [];
  const work = new Map(); // productId -> { doc, variants (cloned raw values), stock, dirty }

  const workFor = (pid, doc) => {
    if (!work.has(pid)) {
      const raw = doc.fields?.variants?.arrayValue?.values;
      work.set(pid, {
        doc,
        variants: Array.isArray(raw) ? structuredClone(raw) : [],
        stockRaw: doc.fields?.stock,
        stockOverride: undefined,
        dirty: null,
      });
    }
    return work.get(pid);
  };

  for (const line of lines) {
    const info = {
      index: line.index,
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
      serverUnitPrice: null,
      productName: null,
      variantLabel: null,
    };
    lineInfo.push(info);

    const doc = products.get(line.productId);
    if (!doc || !doc.exists) {
      warnings.push({ code: 'PRODUCT_NOT_FOUND', line: line.index });
      continue;
    }
    const w = workFor(line.productId, doc);
    const f = doc.fields || {};
    info.productName = f.name?.stringValue ?? null;
    const productPrice = rawNumber(f.price).value;
    const hasVariants = w.variants.length > 0;

    // ---------- variant line ----------
    if (line.variantId) {
      if (!hasVariants) {
        warnings.push({ code: 'VARIANT_NOT_FOUND', line: line.index });
        info.serverUnitPrice = productPrice;
        continue;
      }
      const matches = [];
      w.variants.forEach((v, i) => {
        if (variantId(v) === line.variantId) matches.push(i);
      });
      if (matches.length === 0) {
        warnings.push({ code: 'VARIANT_NOT_FOUND', line: line.index });
        info.serverUnitPrice = productPrice;
        continue;
      }
      const vi = matches[0];
      const vf = w.variants[vi].mapValue.fields || {};
      info.variantLabel = vf.label?.stringValue ?? null;
      info.serverUnitPrice = rawNumber(vf.price).value ?? productPrice;
      if (matches.length > 1) {
        warnings.push({ code: 'DUPLICATE_VARIANT_ID', line: line.index });
        continue; // ambiguous: never guess which one to deduct
      }
      if (stockMode === 'off') continue;

      const s = rawNumber(vf.stock);
      if (s.value === null) {
        warnings.push({ code: 'STOCK_UNTRACKED', line: line.index });
        continue;
      }
      if (s.fromString) warnings.push({ code: 'STOCK_STRING_NORMALIZED', line: line.index });
      if (line.quantity > s.value) {
        warnings.push({ code: 'STOCK_SHORTFALL', line: line.index, available: s.value, requested: line.quantity });
        continue;
      }
      const after = s.value - line.quantity;
      vf.stock = encodeNumber(after);
      w.variants[vi].mapValue.fields = vf;
      w.dirty = 'variants';
      deductions.push({
        productId: line.productId,
        variantId: line.variantId,
        qty: line.quantity,
        before: s.value,
        after,
        applied: stockMode === 'apply',
      });
      continue;
    }

    // ---------- non-variant line ----------
    info.serverUnitPrice = productPrice;
    if (hasVariants) {
      warnings.push({ code: 'AMBIGUOUS_VARIANT', line: line.index });
      continue;
    }
    if (stockMode === 'off') continue;

    const current = w.stockOverride !== undefined ? { value: w.stockOverride, fromString: false } : rawNumber(w.stockRaw);
    if (current.value === null) {
      warnings.push({ code: 'STOCK_UNTRACKED', line: line.index });
      continue;
    }
    if (current.fromString) warnings.push({ code: 'STOCK_STRING_NORMALIZED', line: line.index });
    if (line.quantity > current.value) {
      warnings.push({ code: 'STOCK_SHORTFALL', line: line.index, available: current.value, requested: line.quantity });
      continue;
    }
    const after = current.value - line.quantity;
    w.stockOverride = after;
    w.dirty = w.dirty === 'variants' ? 'variants' : 'stock';
    deductions.push({
      productId: line.productId,
      variantId: null,
      qty: line.quantity,
      before: current.value,
      after,
      applied: stockMode === 'apply',
    });
  }

  // No partial deduction: one short line => nothing in this order is deducted.
  const hasShortfall = warnings.some((w) => w.code === 'STOCK_SHORTFALL');
  if (hasShortfall && deductions.length > 0) {
    for (const d of deductions) {
      d.applied = false;
      d.skippedReason = 'ORDER_HAS_SHORTFALL';
    }
    warnings.push({ code: 'STOCK_NOT_DEDUCTED' });
  }

  const writes = [];
  if (stockMode === 'apply' && !hasShortfall) {
    for (const [productId, w] of work) {
      if (!w.dirty) continue;
      const fields = {};
      const mask = [];
      if (w.dirty === 'variants') {
        fields.variants = { arrayValue: { values: w.variants } };
        mask.push('variants');
      }
      if (w.stockOverride !== undefined) {
        fields.stock = encodeNumber(w.stockOverride);
        mask.push('stock');
      }
      writes.push({ productId, fields, mask, updateTime: w.doc.updateTime });
    }
  }

  return { lineInfo, deductions, warnings, writes };
}

/**
 * Stock restoration for a cancelled order: adds back EXACTLY the deductions recorded as applied for it (nothing
 * else). Same rules as the deduction: a variant line goes back to the one variant with that id; a product line to
 * the top-level stock. A line whose product / variant is gone, ambiguous, or whose stock is not a number is NOT
 * restored (warning RESTOCK_SKIPPED) — never guessed. Pure; writes carry the read updateTime (precondition).
 * @param applied  [{ productId, variantId, qty }]  (ledger.stockDeductions with applied === true)
 * @param products Map<productId, {exists, fields, updateTime}>
 */
export function planRestock(applied, products) {
  const warnings = [];
  const restored = [];
  const work = new Map();
  const workFor = (pid, doc) => {
    if (!work.has(pid)) {
      const raw = doc.fields?.variants?.arrayValue?.values;
      work.set(pid, { doc, variants: Array.isArray(raw) ? structuredClone(raw) : [], stock: undefined, dirtyVariants: false });
    }
    return work.get(pid);
  };
  for (const d of applied) {
    const doc = products.get(d.productId);
    const qty = Number(d.qty);
    if (!doc?.exists || !Number.isInteger(qty) || qty <= 0) { warnings.push({ code: 'RESTOCK_SKIPPED', productId: d.productId, reason: 'product_missing' }); continue; }
    const w = workFor(d.productId, doc);
    if (d.variantId) {
      const idx = w.variants.map((v, i) => (variantId(v) === d.variantId ? i : -1)).filter((i) => i >= 0);
      if (idx.length !== 1) { warnings.push({ code: 'RESTOCK_SKIPPED', productId: d.productId, variantId: d.variantId, reason: idx.length ? 'variant_ambiguous' : 'variant_missing' }); continue; }
      const vf = w.variants[idx[0]].mapValue.fields || {};
      const s = rawNumber(vf.stock);
      if (s.value === null) { warnings.push({ code: 'RESTOCK_SKIPPED', productId: d.productId, variantId: d.variantId, reason: 'stock_untracked' }); continue; }
      vf.stock = encodeNumber(s.value + qty);
      w.variants[idx[0]].mapValue.fields = vf;
      w.dirtyVariants = true;
      restored.push({ productId: d.productId, variantId: d.variantId, qty, before: s.value, after: s.value + qty });
      continue;
    }
    const cur = w.stock !== undefined ? { value: w.stock } : rawNumber(doc.fields?.stock);
    if (cur.value === null) { warnings.push({ code: 'RESTOCK_SKIPPED', productId: d.productId, reason: 'stock_untracked' }); continue; }
    w.stock = cur.value + qty;
    restored.push({ productId: d.productId, variantId: null, qty, before: cur.value, after: w.stock });
  }
  const writes = [];
  for (const [productId, w] of work) {
    const fields = {};
    const mask = [];
    if (w.dirtyVariants) { fields.variants = { arrayValue: { values: w.variants } }; mask.push('variants'); }
    if (w.stock !== undefined) { fields.stock = encodeNumber(w.stock); mask.push('stock'); }
    if (mask.length) writes.push({ productId, fields, mask, updateTime: w.doc.updateTime });
  }
  return { restored, warnings, writes };
}
