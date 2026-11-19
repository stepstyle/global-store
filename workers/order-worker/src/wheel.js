// Prize wheel — TEST ONLY (WHEEL_MODE=test; production refuses any mode but 'off', see config.js).
//
// Identity: a VERIFIED Firebase account (Google or e-mail). Never an IP, never an unverified phone number.
// The draw happens HERE with a CSPRNG; the browser only asks and shows. Every result (a prize or "no prize") is stored.
//
// Firestore (written by the Worker's service account only — the rules have NO match for these: browsers are denied):
//   wheelCampaigns/{cid}              campaign settings (dates, minimum, prizes, weights, quantities, costs, budget)
//   wheelPool/{cid}_{prizeId}         { remaining } — decremented in the SAME commit as the spin (never over-awarded)
//   wheelEntitlements/{cid}_{uid}     { granted, used } — 1 first chance + 1 per qualifying DELIVERED order
//   wheelSpins/{cid}_{uid}_{n}        the n-th result: created with exists:false -> one result per chance, ever
//   wheelGrants/{orderId}             created with exists:false when an order earns a chance -> at most once per order
//
// A spin is idempotent: the n-th spin document is created once; a retry after a lost answer, a second tab or a
// refresh finds `used == granted` and gets the STORED result back (never a new draw).
// A prize goes into an order through the normal order flow (orders.js): the gift line is reserved with the order,
// deducted once on delivery and released on cancellation by the same reservation code as any other line.

import { encodeFields, decodeFields, isConflict } from './firestore.js';
import { log } from './http.js';

export const NO_PRIZE = 'none';
const DAY_MS = 86_400_000;

/**
 * Per-campaign key of a delivery phone number: HMAC-SHA256 with a SERVER-ONLY secret (WHEEL_PHONE_SECRET, never sent
 * to a browser, never logged). A plain hash of a 9-digit Jordanian number could be reversed by trying every number;
 * without the secret the key reveals nothing. The phone is NOT proof of identity (unverified, can be shared): it only
 * limits how many gifts can be open at the same time for one delivery number.
 */
export async function phoneKey(secret, campaignId, phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-9);
  if (!secret || digits.length < 7) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`wph1:${campaignId}:${digits}`));
  return `${campaignId}_${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
export const SPIN_ATTEMPTS = 5;
const ID_RE = /^[a-z0-9-]{1,40}$/;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const ms = (v) => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN);

/** Normalised campaign or null (any invalid part makes the whole campaign unusable — never a partial guess). */
export function validCampaign(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const minOrderJod = num(raw.minOrderJod);
  const budgetJod = num(raw.budgetJod);
  const noPrizeWeight = int(raw.noPrizeWeight);
  const startsAt = ms(raw.startsAt);
  const endsAt = ms(raw.endsAt);
  if (minOrderJod === null || minOrderJod < 0 || budgetJod === null || budgetJod < 0 || noPrizeWeight === null) return null;
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return null;
  if (!['return', 'expire'].includes(raw.giftOnCancel)) return null;
  if (!Array.isArray(raw.prizes) || raw.prizes.length > 20) return null;
  const prizes = [];
  let worstCaseCost = 0;
  for (const p of raw.prizes) {
    const ok = p && ID_RE.test(String(p.id || '')) && p.id !== NO_PRIZE && typeof p.label === 'string' && p.label.trim()
      && /^[A-Za-z0-9_-]{1,120}$/.test(String(p.productId || '')) && int(p.weight) !== null && int(p.quantity) !== null
      && num(p.unitCostJod) !== null && p.unitCostJod >= 0;
    if (!ok) return null;
    worstCaseCost += p.quantity * p.unitCostJod;
    prizes.push({ id: p.id, label: p.label.trim().slice(0, 80), productId: p.productId, variantId: p.variantId ? String(p.variantId) : null, weight: p.weight, quantity: p.quantity, unitCostJod: p.unitCostJod });
  }
  if (new Set(prizes.map((p) => p.id)).size !== prizes.length) return null;
  // the budget can never be exceeded: every prize quantity at its cost must fit in it
  if (worstCaseCost > budgetJod + 1e-9) return null;
  // freeFirstChance (default TRUE = the welcome spin of every new account; false only with the owner's approval)
  // openGiftsPerPhone: gifts reserved-but-not-yet-delivered at the same time for one delivery number (default 1).
  //   Delivery or cancellation frees the slot, so a real customer keeps winning on later delivered orders.
  // prizeValidDays: an unclaimed prize expires (default 30); the cron returns it to the pool ONLY while unclaimed.
  const openGiftsPerPhone = raw.openGiftsPerPhone === undefined ? 1 : int(raw.openGiftsPerPhone);
  const prizeValidDays = raw.prizeValidDays === undefined ? 30 : int(raw.prizeValidDays);
  if (openGiftsPerPhone === null || openGiftsPerPhone < 1 || prizeValidDays === null || prizeValidDays < 1 || prizeValidDays > 365) return null;
  return { freeFirstChance: raw.freeFirstChance !== false, openGiftsPerPhone, prizeValidDays, active: raw.active === true, minOrderJod, budgetJod, noPrizeWeight, startsAt, endsAt, giftOnCancel: raw.giftOnCancel, prizes, terms: typeof raw.terms === 'string' ? raw.terms.slice(0, 2000) : '' };
}

export function campaignOpen(c, now) {
  if (!c) return { ok: false, code: 'CAMPAIGN_INVALID' };
  if (!c.active) return { ok: false, code: 'CAMPAIGN_CLOSED' };
  if (now < c.startsAt) return { ok: false, code: 'CAMPAIGN_NOT_STARTED' };
  if (now >= c.endsAt) return { ok: false, code: 'CAMPAIGN_ENDED' };
  return { ok: true };
}

/** Weighted draw among prizes that still have stock in the pool, plus "no prize". `rand(n)` -> integer in [0, n). */
export function drawPrize(campaign, remainingById, rand) {
  const options = campaign.prizes.filter((p) => p.weight > 0 && (remainingById.get(p.id) ?? 0) > 0).map((p) => ({ id: p.id, w: p.weight }));
  if (campaign.noPrizeWeight > 0) options.push({ id: NO_PRIZE, w: campaign.noPrizeWeight });
  const total = options.reduce((s, o) => s + o.w, 0);
  if (total <= 0) return NO_PRIZE;
  let r = rand(total);
  for (const o of options) { if (r < o.w) return o.id; r -= o.w; }
  return NO_PRIZE;
}

/** Unbiased integer in [0, n) from the platform CSPRNG. */
export function secureRand(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

const spinPath = (cid, uid, n) => `wheelSpins/${cid}_${uid}_${n}`;
const publicSpin = (s) => (s ? { spinId: `${s.campaignId}_${s.uid}_${s.n}`, n: s.n, prizeId: s.prizeId, label: s.label, status: s.status, orderId: s.orderId || null } : null);

/** A missing document = the welcome chance (`base` 1), or none when the campaign has freeFirstChance=false. */
export function entitlement(doc, base = 1) {
  const d = doc?.exists ? decodeFields(doc.fields) : {};
  return { granted: Number.isInteger(d.granted) ? d.granted : base, used: Number.isInteger(d.used) ? d.used : 0 };
}

async function readCampaign(fs, cfg) {
  const doc = await fs.get(`wheelCampaigns/${cfg.wheelCampaignId}`);
  return { doc, campaign: doc.exists ? validCampaign(decodeFields(doc.fields)) : null };
}

/** GET /wheel/state — what this account has: chances, stored results (labels + status), campaign open or not. */
export async function wheelState(fs, cfg, uid, { now = Date.now() } = {}) {
  if (cfg.wheelMode === 'off') return { status: 404, body: { ok: false, code: 'WHEEL_OFF' } };
  const { campaign } = await readCampaign(fs, cfg);
  const open = campaignOpen(campaign, now);
  const ent = await fs.get(`wheelEntitlements/${cfg.wheelCampaignId}_${uid}`);
  const e = entitlement(ent, campaign?.freeFirstChance === false ? 0 : 1);
  const spins = [];
  for (let n = 1; n <= Math.min(e.used, 20); n++) {
    const d = await fs.get(spinPath(cfg.wheelCampaignId, uid, n));
    if (d.exists) spins.push(publicSpin(decodeFields(d.fields)));
  }
  return {
    status: 200,
    body: {
      ok: true, mode: cfg.wheelMode, campaign: open.ok ? 'open' : open.code,
      minOrderJod: campaign?.minOrderJod ?? null, terms: campaign?.terms ?? '',
      chancesLeft: open.ok ? Math.max(0, e.granted - e.used) : 0, spins,
    },
  };
}

/** POST /wheel/spin — one draw per chance, stored; a repeated call returns the stored result. */
export async function spinWheel(fs, cfg, uid, { now = () => Date.now(), rand = secureRand } = {}) {
  if (cfg.wheelMode === 'off') return { status: 404, body: { ok: false, code: 'WHEEL_OFF' } };
  const cid = cfg.wheelCampaignId;
  for (let attempt = 0; attempt < SPIN_ATTEMPTS; attempt++) {
    const { doc: campaignDoc, campaign } = await readCampaign(fs, cfg);
    const open = campaignOpen(campaign, now());
    if (!open.ok) return { status: 409, body: { ok: false, code: open.code } };
    const entPath = `wheelEntitlements/${cid}_${uid}`;
    const poolPaths = campaign.prizes.map((p) => `wheelPool/${cid}_${p.id}`);
    const [entDoc, ...poolDocs] = await fs.batchGet([entPath, ...poolPaths]);
    const e = entitlement(entDoc, campaign.freeFirstChance ? 1 : 0);
    if (e.used >= e.granted) {
      // no chance left: the LAST stored result again (a retry / refresh / second tab never draws twice)
      const last = e.used > 0 ? await fs.get(spinPath(cid, uid, e.used)) : { exists: false };
      return { status: 200, body: { ok: true, repeated: true, chancesLeft: 0, result: last.exists ? publicSpin(decodeFields(last.fields)) : null } };
    }
    const remaining = new Map(campaign.prizes.map((p, i) => [p.id, poolDocs[i].exists ? Number(decodeFields(poolDocs[i].fields).remaining) || 0 : 0]));
    const prizeId = drawPrize(campaign, remaining, rand);
    const prize = campaign.prizes.find((p) => p.id === prizeId) || null;
    const n = e.used + 1;
    const spin = {
      campaignId: cid, uid, n, prizeId,
      label: prize ? prize.label : 'حظ أوفر',
      productId: prize?.productId ?? null, variantId: prize?.variantId ?? null,
      status: prize ? 'issued' : NO_PRIZE,
      // issuedExpiry exists ONLY while the prize is unclaimed ('issued'): the cron's query (expireUnclaimedPrizes) reads
      // exactly the expired unclaimed prizes, oldest first, and nothing else
      ...(prize ? { expiresAt: new Date(now() + campaign.prizeValidDays * DAY_MS), issuedExpiry: new Date(now() + campaign.prizeValidDays * DAY_MS) } : {}),
      createdAt: new Date(now()),
    };
    const writes = [
      entDoc.exists
        ? { update: { name: fs.name(entPath), fields: encodeFields({ used: n }) }, updateMask: { fieldPaths: ['used'] }, currentDocument: { updateTime: entDoc.updateTime } }
        : { update: { name: fs.name(entPath), fields: encodeFields({ campaignId: cid, uid, granted: 1, used: 1 }) }, currentDocument: { exists: false } },
      { update: { name: fs.name(spinPath(cid, uid, n)), fields: encodeFields(spin) }, currentDocument: { exists: false } },
      // the campaign must not change between the read and the commit (closed / edited meanwhile -> re-read)
      { verify: fs.name(`wheelCampaigns/${cid}`), currentDocument: { updateTime: campaignDoc.updateTime } },
    ];
    if (prize) {
      const i = campaign.prizes.indexOf(prize);
      writes.push({ update: { name: fs.name(poolPaths[i]), fields: encodeFields({ remaining: remaining.get(prize.id) - 1 }) }, updateMask: { fieldPaths: ['remaining'] }, currentDocument: { updateTime: poolDocs[i].updateTime } });
    }
    const r = await fs.commit(writes);
    if (r.ok) {
      log('wheel.spin', { campaignId: cid, n, prize: prize ? prize.id : NO_PRIZE });
      return { status: 200, body: { ok: true, repeated: false, chancesLeft: e.granted - n, result: publicSpin(spin) } };
    }
    if (!isConflict(r)) return { status: 503, body: { ok: false, code: 'UNAVAILABLE' } };
  }
  return { status: 409, body: { ok: false, code: 'BUSY' } };
}

// ------------------------------------------------------------------ order integration (orders.js / fulfilment.js)

/**
 * Validates a prize the customer wants to receive with THIS order. Never trusts the browser: the spin is read from
 * Firestore; it must belong to the verified account, be 'issued', and its campaign must be open.
 * Returns { ok: true, gift } or { ok: false, code }.
 */
export async function loadGiftForOrder(fs, cfg, { spinId, uid, now = Date.now() }) {
  if (cfg.wheelMode === 'off') return { ok: false, code: 'WHEEL_OFF' };
  if (!uid) return { ok: false, code: 'WHEEL_SIGN_IN_REQUIRED' };
  if (typeof spinId !== 'string' || !/^[a-z0-9-]{1,40}_[A-Za-z0-9_-]{1,128}_\d{1,4}$/.test(spinId)) return { ok: false, code: 'WHEEL_PRIZE_INVALID' };
  const [spinDoc, campaignDoc] = await fs.batchGet([`wheelSpins/${spinId}`, `wheelCampaigns/${cfg.wheelCampaignId}`]);
  if (!spinDoc.exists) return { ok: false, code: 'WHEEL_PRIZE_INVALID' };
  const s = decodeFields(spinDoc.fields);
  if (s.uid !== uid || s.campaignId !== cfg.wheelCampaignId) return { ok: false, code: 'WHEEL_PRIZE_INVALID' };
  if (s.status === 'expired' || (s.status === 'issued' && s.expiresAt instanceof Date && s.expiresAt.getTime() <= now)) return { ok: false, code: 'WHEEL_PRIZE_EXPIRED' };
  if (s.status !== 'issued') return { ok: false, code: 'WHEEL_PRIZE_USED' };
  const campaign = campaignDoc.exists ? validCampaign(decodeFields(campaignDoc.fields)) : null;
  const open = campaignOpen(campaign, now);
  if (!open.ok) return { ok: false, code: open.code };
  return { ok: true, gift: { spinId, spinDoc, productId: s.productId, variantId: s.variantId ?? null, label: s.label, prizeId: s.prizeId }, campaign };
}

/** The open campaign (for "does this order earn a new chance on delivery?"), or null. */
export async function openCampaign(fs, cfg, now = Date.now()) {
  if (cfg.wheelMode === 'off') return null;
  const { campaign } = await readCampaign(fs, cfg);
  return campaignOpen(campaign, now).ok ? campaign : null;
}

/**
 * Status change of an order that carries ledger.wheel (fulfilment.js): extra writes in the SAME commit.
 *   delivered -> the prize (if any) becomes 'consumed'; a qualifying order earns ONE new chance
 *                (wheelGrants/{orderId} exists:false + increment, so a repeated delivery never grants twice)
 *   cancelled before delivery -> the prize goes back to 'issued' (or 'expired', per campaign policy)
 *   returned (delivered -> cancelled) -> the chance earned by this order is taken back (granted - 1)
 */
export async function wheelStatusWrites(fs, L, orderId, from, to, at) {
  const w = L?.wheel;
  if (!w || !w.campaignId) return [];
  const writes = [];
  const spin = w.spinId ? await fs.get(`wheelSpins/${w.spinId}`) : null;
  // the delivery number's open-gift slot is freed exactly once: on delivery, or on cancellation before delivery
  // (this runs inside the status-change commit, which carries the ledger's version: a transition is applied once)
  if (w.phoneKey && w.spinId && from !== 'delivered' && (to === 'delivered' || to === 'cancelled')) {
    writes.push({ update: { name: fs.name(`wheelPhoneGifts/${w.phoneKey}`), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'open', increment: { integerValue: '-1' } }], currentDocument: { exists: true } });
  }
  if (to === 'delivered') {
    if (spin?.exists && decodeFields(spin.fields).status === 'reserved') {
      writes.push({ update: { name: fs.name(`wheelSpins/${w.spinId}`), fields: encodeFields({ status: 'consumed', consumedAt: at }) }, updateMask: { fieldPaths: ['status', 'consumedAt'] }, currentDocument: { updateTime: spin.updateTime } });
    }
    if (w.chanceEligible && w.uid) {
      const grant = await fs.get(`wheelGrants/${orderId}`);
      if (!grant.exists) {
        writes.push({ update: { name: fs.name(`wheelGrants/${orderId}`), fields: encodeFields({ campaignId: w.campaignId, at }) }, currentDocument: { exists: false } });
        const entPath = `wheelEntitlements/${w.campaignId}_${w.uid}`;
        const ent = await fs.get(entPath);
        writes.push(ent.exists
          ? { update: { name: fs.name(entPath), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'granted', increment: { integerValue: '1' } }], currentDocument: { exists: true } }
          // never spun yet: the first free chance + this one (exists:false -> a concurrent first spin makes the commit retry)
          : { update: { name: fs.name(entPath), fields: encodeFields({ campaignId: w.campaignId, uid: w.uid, granted: (w.freeFirstChance === false ? 0 : 1) + 1, used: 0 }) }, currentDocument: { exists: false } });
      }
    }
  } else if (to === 'cancelled') {
    if (from !== 'delivered' && spin?.exists && decodeFields(spin.fields).status === 'reserved') {
      const back = w.giftOnCancel === 'expire' ? 'expired' : 'issued';
      const sp = decodeFields(spin.fields);
      const issuedExpiry = back === 'issued' && sp.expiresAt instanceof Date ? sp.expiresAt : null;
      writes.push({ update: { name: fs.name(`wheelSpins/${w.spinId}`), fields: encodeFields({ status: back, orderId: null, releasedAt: at, issuedExpiry }) }, updateMask: { fieldPaths: ['status', 'orderId', 'releasedAt', 'issuedExpiry'] }, currentDocument: { updateTime: spin.updateTime } });
    }
    if (from === 'delivered' && w.chanceEligible && w.uid) {
      const grant = await fs.get(`wheelGrants/${orderId}`);
      if (grant.exists && !decodeFields(grant.fields).revoked) {
        writes.push({ update: { name: fs.name(`wheelGrants/${orderId}`), fields: encodeFields({ revoked: true, revokedAt: at }) }, updateMask: { fieldPaths: ['revoked', 'revokedAt'] }, currentDocument: { updateTime: grant.updateTime } });
        writes.push({ update: { name: fs.name(`wheelEntitlements/${w.campaignId}_${w.uid}`), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'granted', increment: { integerValue: '-1' } }], currentDocument: { exists: true } });
      }
    }
  }
  return writes;
}

/**
 * Cron (WHEEL_MODE=test only): unclaimed prizes past their date -> 'expired', and their pool unit is returned.
 * The query reads ONLY expired unclaimed prizes (issuedExpiry < now; the field exists only while 'issued'), oldest
 * first, every campaign, in pages — valid prizes can never hide expired ones. Never a 'reserved' prize (open order) or
 * a 'consumed' one. Every commit carries the spin's read version: an order reserving it meanwhile, or a second /
 * overlapping cron run, makes the commit fail and nothing is returned twice.
 */
export async function expireUnclaimedPrizes(fs, cfg, { now = Date.now(), pageSize = 50, maxPages = 4 } = {}) {
  if (cfg.wheelMode === 'off') return { enabled: false, expired: 0 };
  const nowTs = new Date(now).toISOString();
  let expired = 0;
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const docs = await fs.runQuery({
      from: [{ collectionId: 'wheelSpins' }],
      where: { fieldFilter: { field: { fieldPath: 'issuedExpiry' }, op: 'LESS_THAN', value: { timestampValue: nowTs } } },
      orderBy: [{ field: { fieldPath: 'issuedExpiry' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      ...(cursor ? { startAt: { values: cursor, before: false } } : {}),
      limit: pageSize,
    });
    for (const d of docs) {
      const sp = decodeFields(d.fields);
      const valid = sp.status === 'issued' && sp.prizeId && sp.prizeId !== NO_PRIZE;
      const r = await fs.commit([
        // not 'issued' any more (should not happen): only the stale marker is cleared, nothing is returned
        { update: { name: d.name, fields: encodeFields(valid ? { status: 'expired', expiredAt: new Date(now), issuedExpiry: null } : { issuedExpiry: null }) }, updateMask: { fieldPaths: valid ? ['status', 'expiredAt', 'issuedExpiry'] : ['issuedExpiry'] }, currentDocument: { updateTime: d.updateTime } },
        ...(valid ? [{ update: { name: fs.name(`wheelPool/${sp.campaignId}_${sp.prizeId}`), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'remaining', increment: { integerValue: '1' } }], currentDocument: { exists: true } }] : []),
      ]);
      if (r.ok && valid) expired += 1;
    }
    if (docs.length < pageSize) break;
    const last = docs[docs.length - 1];
    cursor = [last.fields.issuedExpiry, { referenceValue: last.name }];
  }
  if (expired) log('wheel.expired', { count: expired });
  return { enabled: true, expired };
}
