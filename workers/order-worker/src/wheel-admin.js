// Prize wheel ADMINISTRATION (dashboard). Every route is checked HERE with requireAdmin (src/admin.js: verified Firebase
// ID token + config/roles.ownerUid or an active admins/{uid}). Hiding a button in the dashboard is not a protection;
// the Firestore rules also deny every wheel collection to browsers, so the Worker is the only writer.
//
//   GET  /admin/wheel            the campaign as stored, its check (errors / warnings), what is left in the pool
//   POST /admin/wheel/campaign   replace the campaign (checked by checkCampaign; refused with the errors when invalid).
//                                The pool follows the quantities: a new prize gets `quantity`, a changed quantity moves
//                                `remaining` by the difference (never below 0; prizes already won stay won).
//                                `baseUpdateTime` = the version the admin edited: a newer one (another admin / tab)
//                                answers 409 WHEEL_CAMPAIGN_CHANGED instead of overwriting it.
//                                The previous version is kept in wheelCampaignHistory (nothing is lost).
//   GET  /admin/wheel/spins      the latest results: prize, status, order number, account (uid + e-mail)
import { encodeFields, decodeFields, isConflict } from './firestore.js';
import { checkCampaign, validCampaign } from './wheel.js';
import { log } from './http.js';

const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

/** a stored campaign as JSON for the dashboard (dates as ISO strings) */
function campaignJson(raw) {
  if (!raw) return null;
  return {
    ...raw,
    startsAt: iso(raw.startsAt), endsAt: iso(raw.endsAt),
    prizes: (Array.isArray(raw.prizes) ? raw.prizes : []).map((p) => ({ ...p, startsAt: iso(p.startsAt), endsAt: iso(p.endsAt) })),
  };
}

/** what is written: ONLY the fields checkCampaign understood (normalised), dates as Firestore timestamps */
function storable(c, actorUid) {
  return {
    active: c.active, minOrderJod: c.minOrderJod, budgetJod: c.budgetJod, noPrizeWeight: c.noPrizeWeight,
    startsAt: new Date(c.startsAt), endsAt: new Date(c.endsAt), giftOnCancel: c.giftOnCancel,
    freeFirstChance: c.freeFirstChance, openGiftsPerPhone: c.openGiftsPerPhone, prizeValidDays: c.prizeValidDays, terms: c.terms,
    prizes: c.prizes.map((p) => ({
      id: p.id, type: p.type, label: p.label, description: p.description, icon: p.icon, color: p.color, imageUrl: p.imageUrl,
      weight: p.weight, active: p.active, startsAt: p.startsAt === null ? null : new Date(p.startsAt), endsAt: p.endsAt === null ? null : new Date(p.endsAt),
      ...(p.type === 'none' ? {} : {
        quantity: p.quantity, unitCostJod: p.unitCostJod, valueJod: p.valueJod, minOrderJod: p.minOrderJod, appliesTo: p.appliesTo,
        productId: p.productId, variantId: p.variantId, validDays: p.validDays,
      }),
    })),
    updatedBy: actorUid, updatedAt: new Date(),
  };
}

export async function adminWheelGet(fs, cfg) {
  const cid = cfg.wheelCampaignId;
  const doc = await fs.get(`wheelCampaigns/${cid}`);
  const raw = doc.exists ? decodeFields(doc.fields) : null;
  const check = raw ? checkCampaign(raw) : { campaign: null, errors: [], warnings: [] };
  const pooled = (check.campaign?.prizes || (Array.isArray(raw?.prizes) ? raw.prizes : [])).filter((p) => p && p.type !== 'none' && typeof p.id === 'string');
  const poolDocs = pooled.length ? await fs.batchGet(pooled.map((p) => `wheelPool/${cid}_${p.id}`)) : [];
  const pool = Object.fromEntries(pooled.map((p, i) => [p.id, poolDocs[i].exists ? Number(decodeFields(poolDocs[i].fields).remaining) || 0 : null]));
  return { status: 200, body: { ok: true, mode: cfg.wheelMode, campaignId: cid, exists: doc.exists, updateTime: doc.exists ? doc.updateTime : null, campaign: campaignJson(raw), errors: check.errors, warnings: check.warnings, pool } };
}

export async function adminWheelSave(fs, cfg, body, actorUid) {
  const cid = cfg.wheelCampaignId;
  const input = body?.campaign;
  if (!input || typeof input !== 'object') return { status: 400, body: { ok: false, code: 'INVALID_JSON' } };
  // dates arrive as strings from the dashboard; checkCampaign accepts strings, the stored version uses timestamps
  const check = checkCampaign({ ...input, prizes: Array.isArray(input.prizes) ? input.prizes : input.prizes });
  if (!check.campaign) return { status: 422, body: { ok: false, code: 'WHEEL_CAMPAIGN_INVALID', errors: check.errors, warnings: check.warnings } };
  const next = check.campaign;
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await fs.get(`wheelCampaigns/${cid}`);
    if (body.baseUpdateTime !== undefined && (doc.exists ? doc.updateTime : null) !== (body.baseUpdateTime || null)) {
      return { status: 409, body: { ok: false, code: 'WHEEL_CAMPAIGN_CHANGED' } };
    }
    const prev = doc.exists ? decodeFields(doc.fields) : null;
    const prevCampaign = prev ? validCampaign(prev) : null;
    const pooled = next.prizes.filter((p) => p.type !== 'none');
    const poolDocs = pooled.length ? await fs.batchGet(pooled.map((p) => `wheelPool/${cid}_${p.id}`)) : [];
    const writes = [
      { update: { name: fs.name(`wheelCampaigns/${cid}`), fields: encodeFields(storable(next, actorUid)) }, currentDocument: doc.exists ? { updateTime: doc.updateTime } : { exists: false } },
    ];
    if (prev) {
      writes.push({ update: { name: fs.name(`wheelCampaignHistory/${cid}_${Date.now()}`), fields: encodeFields({ campaignId: cid, savedBy: actorUid, savedAt: new Date(), previous: prev }) }, currentDocument: { exists: false } });
    }
    pooled.forEach((p, i) => {
      const d = poolDocs[i];
      const oldQty = prevCampaign?.prizes.find((x) => x.id === p.id && x.type !== 'none')?.quantity;
      if (!d.exists) {
        writes.push({ update: { name: fs.name(`wheelPool/${cid}_${p.id}`), fields: encodeFields({ remaining: p.quantity }) }, currentDocument: { exists: false } });
        return;
      }
      const rem = Math.max(0, Number(decodeFields(d.fields).remaining) || 0);
      const nextRem = oldQty === undefined ? p.quantity : Math.max(0, rem + (p.quantity - oldQty));
      if (nextRem !== rem) writes.push({ update: { name: fs.name(`wheelPool/${cid}_${p.id}`), fields: encodeFields({ remaining: nextRem }) }, updateMask: { fieldPaths: ['remaining'] }, currentDocument: { updateTime: d.updateTime } });
    });
    const r = await fs.commit(writes);
    if (r.ok) {
      log('wheel.admin_saved', { campaignId: cid, slots: next.prizes.length, active: next.active });
      return adminWheelGet(fs, cfg).then((g) => ({ status: 200, body: { ...g.body, saved: true } }));
    }
    if (!isConflict(r)) return { status: 503, body: { ok: false, code: 'UNAVAILABLE' } };
  }
  return { status: 409, body: { ok: false, code: 'WHEEL_CAMPAIGN_CHANGED' } };
}

const SPIN_STATUSES = new Set(['issued', 'reserved', 'consumed', 'expired', 'none']);
export async function adminWheelSpins(fs, cfg, { limit = 100, status = '' } = {}) {
  const n = Math.max(1, Math.min(300, Number(limit) || 100));
  // newest first (single-field index on createdAt, created automatically); filtered here by campaign and status
  const docs = await fs.runQuery({
    from: [{ collectionId: 'wheelSpins' }],
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    limit: n,
  });
  const rows = docs.map((d) => decodeFields(d.fields))
    .filter((s) => s.campaignId === cfg.wheelCampaignId && (!SPIN_STATUSES.has(status) || s.status === status))
    .map((s) => ({
      spinId: `${s.campaignId}_${s.uid}_${s.n}`, uid: s.uid, email: s.email || '', n: s.n, prizeId: s.prizeId, label: s.label,
      type: s.prizeType || (s.status === 'none' ? 'none' : 'gift'), valueJod: s.valueJod ?? null, minOrderJod: s.minOrderJod ?? null,
      appliesTo: s.appliesTo || 'this_order', status: s.status, orderId: s.orderId || null,
      createdAt: iso(s.createdAt), expiresAt: iso(s.expiresAt), reservedAt: iso(s.reservedAt), consumedAt: iso(s.consumedAt), releasedAt: iso(s.releasedAt), expiredAt: iso(s.expiredAt),
    }));
  const counts = rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
  return { status: 200, body: { ok: true, spins: rows, counts } };
}

