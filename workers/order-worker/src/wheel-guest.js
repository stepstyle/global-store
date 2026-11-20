// Prize wheel — the spin BEFORE signing in (TEST ONLY, like the rest of the wheel: WHEEL_MODE=test).
//
// Owner's rule: a visitor spins WITHOUT an account; the Google sign-in comes only at "confirm order". The draw still
// happens HERE (CSPRNG) and the result is stored HERE; the browser only keeps a random TICKET that names it.
//
//   POST /wheel/guest/spin   { ticket }  no account. The browser makes the ticket (32 random bytes, base64url) and keeps
//                            it BEFORE asking, so a retry after a lost answer sends the same ticket and gets the SAME
//                            stored result (the document is created with exists:false: one result per ticket, ever).
//   POST /wheel/guest/state  { ticket }  the stored result again (refresh, popup reopened, checkout).
//   POST /wheel/guest/claim  { ticket } + verified ID token: the result becomes the account's WELCOME spin
//                            (wheelSpins/{cid}_{uid}_1) — only if the account has never spun. Once, atomically.
//
// Firestore (Worker only — the rules have no match for these collections: browsers are denied):
//   wheelGuestSpins/{cid}_{sha256(ticket)}  the stored result + FIXED prize terms. Only the HASH of the ticket is a
//                                           key: someone who reads the database cannot claim a result with it.
//   wheelGuestIps/{hmac(ip, day)}           guest spins per IP per day (WHEEL_GUEST_PER_IP_DAY). HMAC with the server
//                                           secret: the IP itself is never stored.
// A won prize takes its unit from the pool at the spin (it was shown as won: it must exist at checkout). It is valid
// WHEEL_PRIZE_HOLD_MINUTES (60) from the spin; unclaimed past that it goes back (releaseExpiredGuestHolds: cron + before
// every spin), or at once when a claim is refused / comes too late.
//
// LIMITS (honest): before signing in there is no identity. Clearing the browser's storage / a private window / another
// device gives a NEW spin; the per-IP limit only slows that down (and several homes can share one mobile IP). What is
// guaranteed: the prize of a ticket never changes, one result per ticket, at most ONE welcome result per account, a
// ticket is claimed by ONE account, and every order still re-checks the prize (owner, status, minimum, prices).

import { encodeFields, decodeFields, isConflict } from './firestore.js';
import { log } from './http.js';
import { NO_PRIZE, SPIN_ATTEMPTS, campaignOpen, drawPrize, entitlement, prizeHoldMs, secureRand, validCampaign, isSecondOrderPrize, secondOrderState, secondOrderTerms, secondOrderFields, secondOrderWindowMs } from './wheel.js';

const DAY_MS = 86_400_000;
export const TICKET_RE = /^[A-Za-z0-9_-]{43}$/;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
async function hmac(secret, s) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(s)));
}

export const guestPath = async (cid, ticket) => `wheelGuestSpins/${cid}_${await sha256(`wgt1:${ticket}`)}`;
const ipPath = async (secret, cid, ip, day) => `wheelGuestIps/${cid}_${day}_${(await hmac(secret, `gip1:${cid}:${day}:${ip}`)).slice(0, 40)}`;

const iso = (d) => (d instanceof Date ? d.toISOString() : null);
/** what the browser sees of a guest result (never the ticket hash, the IP key or any campaign figure) */
export const publicGuest = (g) => ({
  prizeId: g.prizeId, label: g.label, status: g.status,
  type: g.prizeType || 'none', valueJod: typeof g.valueJod === 'number' ? g.valueJod : 0,
  minOrderJod: typeof g.minOrderJod === 'number' ? g.minOrderJod : null, appliesTo: g.appliesTo === 'next_order' ? 'next_order' : 'this_order',
  description: g.description || '', expiresAt: iso(g.expiresAt), holdUntil: iso(g.holdExpiry),
});

async function readCampaign(fs, cid) {
  const doc = await fs.get(`wheelCampaigns/${cid}`);
  return { doc, campaign: doc.exists ? validCampaign(decodeFields(doc.fields)) : null };
}

/** POST /wheel/guest/spin — one draw per ticket, stored; the same ticket again returns the stored result. */
export async function guestSpin(fs, cfg, ticket, ip, { now = () => Date.now(), rand = secureRand } = {}) {
  if (cfg.wheelMode === 'off') return { status: 404, body: { ok: false, code: 'WHEEL_OFF' } };
  if (typeof ticket !== 'string' || !TICKET_RE.test(ticket)) return { status: 400, body: { ok: false, code: 'WHEEL_TICKET_INVALID' } };
  if (!(cfg.wheelGuestPerIpDay > 0)) return { status: 403, body: { ok: false, code: 'WHEEL_GUEST_OFF' } };
  const cid = cfg.wheelCampaignId;
  const gPath = await guestPath(cid, ticket);
  for (let attempt = 0; attempt < SPIN_ATTEMPTS; attempt++) {
    const at = now();
    const { doc: campaignDoc, campaign } = await readCampaign(fs, cid);
    const day = Math.floor(at / DAY_MS);
    const iPath = await ipPath(cfg.wheelPhoneSecret, cid, ip || 'unknown', day);
    const pooled = (campaign?.prizes || []).filter((p) => p.type !== 'none');
    const poolPaths = pooled.map((p) => `wheelPool/${cid}_${p.id}`);
    const [gDoc, ipDoc, ...poolDocs] = await fs.batchGet([gPath, iPath, ...poolPaths]);
    // the same ticket: the stored result, whatever happened to the campaign since (never a second draw)
    if (gDoc.exists) return { status: 200, body: { ok: true, repeated: true, result: publicGuest(decodeFields(gDoc.fields)) } };
    const open = campaignOpen(campaign, at);
    if (!open.ok) return { status: 409, body: { ok: false, code: open.code } };
    // the guest spin IS the welcome spin: a campaign without one has nothing to give before an order
    if (!campaign.freeFirstChance) return { status: 409, body: { ok: false, code: 'WHEEL_NO_WELCOME_SPIN' } };
    const used = ipDoc.exists ? Number(decodeFields(ipDoc.fields).count) || 0 : 0;
    if (used >= cfg.wheelGuestPerIpDay) return { status: 429, body: { ok: false, code: 'WHEEL_GUEST_LIMIT' } };

    const remaining = new Map(pooled.map((p, i) => [p.id, poolDocs[i].exists ? Number(decodeFields(poolDocs[i].fields).remaining) || 0 : 0]));
    // no account = no trusted order history: ALWAYS the chances of a NEW customer (owner's rule). The result is fixed
    // here; signing in later links it as it is — never re-drawn with the account's tier.
    const drawnId = drawPrize(campaign, remaining, rand, at, 'new');
    const slot = campaign.prizes.find((p) => p.id === drawnId) || null;
    const prize = slot && slot.type !== 'none' ? slot : null;
    // second-order prize (owner's exception): no 60-minute use window — its 5 days start at the account's first
    // delivery (after the claim). Unclaimed, the ticket keeps it at most that long (anonymous holds stay bounded).
    const second = isSecondOrderPrize(prize);
    const expiresAt = prize && !second ? at + prizeHoldMs(cfg) : null;
    const holdUntil = prize ? (second ? at + secondOrderWindowMs(cfg) : expiresAt) : null;
    const g = {
      campaignId: cid, prizeId: slot ? slot.id : NO_PRIZE, label: slot ? slot.label : 'حظ أوفر',
      productId: prize?.productId ?? null, variantId: prize?.variantId ?? null,
      // the prize terms, FIXED now: the claim copies them as they are (an admin edit never changes a won prize)
      prizeType: prize ? prize.type : 'none', tier: 'new',
      ...(prize ? { valueJod: prize.valueJod, minOrderJod: prize.minOrderJod, appliesTo: prize.appliesTo, description: prize.description } : {}),
      status: prize ? 'held' : NO_PRIZE,
      // holdExpiry exists ONLY while a won unit is held for an unclaimed ticket (the cron query reads exactly those)
      ...(prize ? { expiresAt: expiresAt ? new Date(expiresAt) : null, holdExpiry: new Date(holdUntil) } : {}),
      createdAt: new Date(at),
    };
    const writes = [
      { update: { name: fs.name(gPath), fields: encodeFields(g) }, currentDocument: { exists: false } },
      ipDoc.exists
        ? { update: { name: fs.name(iPath), fields: encodeFields({ count: used + 1 }) }, updateMask: { fieldPaths: ['count'] }, currentDocument: { updateTime: ipDoc.updateTime } }
        : { update: { name: fs.name(iPath), fields: encodeFields({ campaignId: cid, day, count: 1 }) }, currentDocument: { exists: false } },
      { verify: fs.name(`wheelCampaigns/${cid}`), currentDocument: { updateTime: campaignDoc.updateTime } },
    ];
    if (prize) {
      const i = pooled.indexOf(prize);
      writes.push({ update: { name: fs.name(poolPaths[i]), fields: encodeFields({ remaining: remaining.get(prize.id) - 1 }) }, updateMask: { fieldPaths: ['remaining'] }, currentDocument: { updateTime: poolDocs[i].updateTime } });
    }
    const r = await fs.commit(writes);
    if (r.ok) {
      log('wheel.guest_spin', { campaignId: cid, prize: g.prizeId });
      return { status: 200, body: { ok: true, repeated: false, result: publicGuest(g) } };
    }
    if (!isConflict(r)) return { status: 503, body: { ok: false, code: 'UNAVAILABLE' } };
  }
  return { status: 409, body: { ok: false, code: 'BUSY' } };
}

/** POST /wheel/guest/state — the stored result of a ticket (no draw, nothing written). */
export async function guestState(fs, cfg, ticket) {
  if (cfg.wheelMode === 'off') return { status: 404, body: { ok: false, code: 'WHEEL_OFF' } };
  if (typeof ticket !== 'string' || !TICKET_RE.test(ticket)) return { status: 400, body: { ok: false, code: 'WHEEL_TICKET_INVALID' } };
  const d = await fs.get(await guestPath(cfg.wheelCampaignId, ticket));
  if (!d.exists) return { status: 404, body: { ok: false, code: 'WHEEL_GUEST_NOT_FOUND' } };
  return { status: 200, body: { ok: true, result: publicGuest(decodeFields(d.fields)) } };
}

const spinId = (cid, uid, n) => `${cid}_${uid}_${n}`;
const poolBack = (fs, g) => ({ update: { name: fs.name(`wheelPool/${g.campaignId}_${g.prizeId}`), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'remaining', increment: { integerValue: '1' } }], currentDocument: { exists: true } });

/**
 * POST /wheel/guest/claim — the ticket's result becomes the verified account's welcome result (n = 1).
 *   the account already spun (a welcome or any other result) -> refused (WHEEL_ACCOUNT_HAS_SPIN): the account keeps
 *       ITS result, the ticket is closed and its held unit goes back to the pool — never two welcome results
 *   the hold ran out -> WHEEL_GUEST_EXPIRED (unit back to the pool)
 *   claimed already: by this account -> the same answer again; by another one -> WHEEL_GUEST_CLAIMED
 * Every outcome is ONE commit with the versions it read (ticket, entitlement, spin n=1): two tabs, two accounts or a
 * spin racing the claim -> exactly one wins, the other re-reads.
 */
export async function claimGuest(fs, cfg, uid, ticket, { now = () => Date.now(), email = '' } = {}) {
  if (cfg.wheelMode === 'off') return { status: 404, body: { ok: false, code: 'WHEEL_OFF' } };
  if (typeof ticket !== 'string' || !TICKET_RE.test(ticket)) return { status: 400, body: { ok: false, code: 'WHEEL_TICKET_INVALID' } };
  const cid = cfg.wheelCampaignId;
  const gPath = await guestPath(cid, ticket);
  const entPath = `wheelEntitlements/${cid}_${uid}`;
  const sPath = `wheelSpins/${spinId(cid, uid, 1)}`;
  for (let attempt = 0; attempt < SPIN_ATTEMPTS; attempt++) {
    const at = now();
    const [gDoc, entDoc, campaignDoc] = await fs.batchGet([gPath, entPath, `wheelCampaigns/${cid}`]);
    if (!gDoc.exists) return { status: 404, body: { ok: false, code: 'WHEEL_GUEST_NOT_FOUND' } };
    const g = decodeFields(gDoc.fields);
    if (g.status === 'claimed') {
      if (g.claimedBy === uid) return { status: 200, body: { ok: true, repeated: true, spinId: g.claimedSpin, result: publicGuest(g) } };
      return { status: 409, body: { ok: false, code: 'WHEEL_GUEST_CLAIMED' } };
    }
    // already released by the cron / a spin before anyone claimed it: still counts as the welcome spin (below), no unit
    const releasedUnclaimed = g.status === 'expired' && !g.claimedBy;
    if (g.status !== 'held' && g.status !== NO_PRIZE && !releasedUnclaimed) return { status: 409, body: { ok: false, code: g.status === 'refused' ? 'WHEEL_ACCOUNT_HAS_SPIN' : 'WHEEL_GUEST_EXPIRED' } };
    const held = g.status === 'held';
    const guard = { currentDocument: { updateTime: gDoc.updateTime } };
    const close = (status, extra = {}) => ({ update: { name: fs.name(gPath), fields: encodeFields({ status, holdExpiry: null, closedAt: new Date(at), ...extra }) }, updateMask: { fieldPaths: ['status', 'holdExpiry', 'closedAt', ...Object.keys(extra)] }, ...guard });

    const campaign = campaignDoc.exists ? validCampaign(decodeFields(campaignDoc.fields)) : null;
    const e = entitlement(entDoc, campaign?.freeFirstChance === false ? 0 : 1);
    const lapsedHeld = held && ((g.holdExpiry instanceof Date && g.holdExpiry.getTime() <= at) || (g.expiresAt instanceof Date && g.expiresAt.getTime() <= at));
    if (lapsedHeld || releasedUnclaimed) {
      // too late (the 60-minute window passed): the unit goes back (once: if still held), and — when the account has
      // never spun — this spin still IS its welcome spin, recorded as expired (signing in late never gives a fresh draw)
      const fresh = e.used === 0 && e.granted >= 1;
      if (releasedUnclaimed && !fresh) return { status: 409, body: { ok: false, code: 'WHEEL_GUEST_EXPIRED' } };
      const writes = [close('expired', fresh ? { claimedBy: uid, claimedSpin: spinId(cid, uid, 1) } : {}), ...(lapsedHeld ? [poolBack(fs, g)] : [])];
      if (fresh) {
        writes.push(
          { update: { name: fs.name(sPath), fields: encodeFields({ campaignId: cid, uid, n: 1, prizeId: g.prizeId, label: g.label, prizeType: g.prizeType || 'none', valueJod: g.valueJod, minOrderJod: g.minOrderJod, appliesTo: g.appliesTo, ...(email ? { email: String(email).slice(0, 200) } : {}), status: 'expired', expiresAt: g.expiresAt ?? null, expiredAt: new Date(at), fromGuest: true, createdAt: g.createdAt instanceof Date ? g.createdAt : new Date(at), claimedAt: new Date(at) }) }, currentDocument: { exists: false } },
          entDoc.exists
            ? { update: { name: fs.name(entPath), fields: encodeFields({ used: 1 }) }, updateMask: { fieldPaths: ['used'] }, currentDocument: { updateTime: entDoc.updateTime } }
            : { update: { name: fs.name(entPath), fields: encodeFields({ campaignId: cid, uid, granted: 1, used: 1 }) }, currentDocument: { exists: false } },
        );
      }
      const r = await fs.commit(writes);
      if (r.ok) return { status: 409, body: { ok: false, code: 'WHEEL_GUEST_EXPIRED' } };
      if (!isConflict(r)) return { status: 503, body: { ok: false, code: 'UNAVAILABLE' } };
      continue;
    }
    if (e.used > 0 || e.granted < 1) {
      const r = await fs.commit([close('refused', { refusedFor: uid }), ...(held ? [poolBack(fs, g)] : [])]);
      if (r.ok) {
        log('wheel.guest_refused', { campaignId: cid });
        return { status: 409, body: { ok: false, code: 'WHEEL_ACCOUNT_HAS_SPIN' } };
      }
      if (!isConflict(r)) return { status: 503, body: { ok: false, code: 'UNAVAILABLE' } };
      continue;
    }
    // second-order prize: its window depends on the ACCOUNT now (waiting for a first delivery / 120 h after it / never)
    let second = null;
    if (held && g.appliesTo === 'next_order') {
      const sst = await secondOrderState(fs, uid);
      // the 5 days to create the first order count from the WIN (the guest spin), not from the sign-in
      const winAt = g.createdAt instanceof Date ? g.createdAt.getTime() : at;
      second = (campaign && secondOrderTerms(cfg, campaign, sst, at, winAt)) || 'never';
    }
    if (second === 'never') {
      // this account's actual second order is behind it: the prize cannot be used. It still is the welcome spin.
      const fresh = { campaignId: cid, uid, n: 1, prizeId: g.prizeId, label: g.label, prizeType: g.prizeType, valueJod: g.valueJod, minOrderJod: g.minOrderJod, appliesTo: g.appliesTo, ...(email ? { email: String(email).slice(0, 200) } : {}), status: 'expired', expiresAt: null, expiredAt: new Date(at), expiredReason: 'not_second_order', fromGuest: true, createdAt: g.createdAt instanceof Date ? g.createdAt : new Date(at), claimedAt: new Date(at) };
      const r = await fs.commit([
        close('expired', { claimedBy: uid, claimedSpin: spinId(cid, uid, 1) }), poolBack(fs, g),
        { update: { name: fs.name(sPath), fields: encodeFields(fresh) }, currentDocument: { exists: false } },
        entDoc.exists
          ? { update: { name: fs.name(entPath), fields: encodeFields({ used: 1 }) }, updateMask: { fieldPaths: ['used'] }, currentDocument: { updateTime: entDoc.updateTime } }
          : { update: { name: fs.name(entPath), fields: encodeFields({ campaignId: cid, uid, granted: 1, used: 1 }) }, currentDocument: { exists: false } },
      ]);
      if (r.ok) return { status: 409, body: { ok: false, code: 'WHEEL_NOT_SECOND_ORDER' } };
      if (!isConflict(r)) return { status: 503, body: { ok: false, code: 'UNAVAILABLE' } };
      continue;
    }
    const issued = held;
    const spin = {
      campaignId: cid, uid, n: 1, prizeId: g.prizeId, label: g.label, productId: g.productId ?? null, variantId: g.variantId ?? null,
      prizeType: g.prizeType || 'none',
      ...(issued ? { valueJod: g.valueJod, minOrderJod: g.minOrderJod, appliesTo: g.appliesTo, description: g.description || '' } : {}),
      ...(email ? { email: String(email).slice(0, 200) } : {}),
      status: issued ? (second ? second.status : 'issued') : NO_PRIZE,
      // validity counts from the SPIN (shown to the customer then), not from the claim — except the second-order prize
      ...(second ? (({ status: _s, ...rest }) => rest)(secondOrderFields(second))
        : issued && g.expiresAt instanceof Date ? { expiresAt: g.expiresAt, issuedExpiry: g.expiresAt } : {}),
      // drawn with the NEW-customer chances before signing in — kept as it is (never re-drawn after the tier is known)
      tier: g.tier || 'new',
      fromGuest: true, createdAt: g.createdAt instanceof Date ? g.createdAt : new Date(at), claimedAt: new Date(at),
    };
    const writes = [
      close('claimed', { claimedBy: uid, claimedSpin: spinId(cid, uid, 1) }),
      { update: { name: fs.name(sPath), fields: encodeFields(spin) }, currentDocument: { exists: false } },
      entDoc.exists
        ? { update: { name: fs.name(entPath), fields: encodeFields({ used: 1 }) }, updateMask: { fieldPaths: ['used'] }, currentDocument: { updateTime: entDoc.updateTime } }
        : { update: { name: fs.name(entPath), fields: encodeFields({ campaignId: cid, uid, granted: 1, used: 1 }) }, currentDocument: { exists: false } },
    ];
    const r = await fs.commit(writes);
    if (r.ok) {
      log('wheel.guest_claimed', { campaignId: cid, prize: g.prizeId });
      return { status: 200, body: { ok: true, repeated: false, spinId: spinId(cid, uid, 1), result: { ...publicGuest({ ...g, status: spin.status, holdExpiry: null, expiresAt: spin.expiresAt ?? null }) } } };
    }
    if (!isConflict(r)) return { status: 503, body: { ok: false, code: 'UNAVAILABLE' } };
  }
  return { status: 409, body: { ok: false, code: 'BUSY' } };
}

/**
 * Cron: units held for tickets nobody claimed in time go back to the pool. Reads ONLY held tickets past their hold
 * (holdExpiry exists only while 'held'), oldest first, in pages; each commit carries the ticket's version, so a claim
 * meanwhile or an overlapping run makes it fail and nothing is returned twice.
 */
export async function releaseExpiredGuestHolds(fs, cfg, { now = Date.now(), pageSize = 50, maxPages = 4 } = {}) {
  if (cfg.wheelMode === 'off') return { enabled: false, released: 0 };
  const nowTs = new Date(now).toISOString();
  let released = 0;
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const docs = await fs.runQuery({
      from: [{ collectionId: 'wheelGuestSpins' }],
      where: { fieldFilter: { field: { fieldPath: 'holdExpiry' }, op: 'LESS_THAN_OR_EQUAL', value: { timestampValue: nowTs } } },
      orderBy: [{ field: { fieldPath: 'holdExpiry' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      ...(cursor ? { startAt: { values: cursor, before: false } } : {}),
      limit: pageSize,
    });
    for (const d of docs) {
      const g = decodeFields(d.fields);
      const valid = g.status === 'held' && g.prizeId && g.prizeId !== NO_PRIZE;
      const r = await fs.commit([
        { update: { name: d.name, fields: encodeFields(valid ? { status: 'expired', holdExpiry: null, closedAt: new Date(now) } : { holdExpiry: null }) }, updateMask: { fieldPaths: valid ? ['status', 'holdExpiry', 'closedAt'] : ['holdExpiry'] }, currentDocument: { updateTime: d.updateTime } },
        ...(valid ? [poolBack(fs, g)] : []),
      ]);
      if (r.ok && valid) released += 1;
    }
    if (docs.length < pageSize) break;
    const last = docs[docs.length - 1];
    cursor = [last.fields.holdExpiry, { referenceValue: last.name }];
  }
  if (released) log('wheel.guest_released', { count: released });
  return { enabled: true, released };
}
