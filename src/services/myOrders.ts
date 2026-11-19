// «طلباتي» without an account + linking a guest order to the signed-in account.
//
// Rules
// - The device only keeps ORDER NUMBERS and their tracking keys (localStorage, per identity: 'guest' or the uid).
//   What an order looks like (status, items, totals) always comes from the order Worker, never from the browser.
// - A key is sent ONLY in the x-tracking-key header to the Worker — never in a URL, a link, analytics or a log.
// - The Worker summary has no personal data (no name, phone, address, e-mail, note, CliQ reference).
// - Linking (POST /orders/:id/claim) needs: a verified sign-in + the order's tracking key + the last 4 digits of the
//   order's phone (second factor for shared devices). The Worker links a guest order once and never moves an order
//   that already belongs to an account.
import { fetchOrderSummary, normalizeWorkerUrl, type OrderSummary, type SubmitDeps, type SubmitOptions } from './orderSubmit.ts';
import type { TrackingKeyStore } from './checkoutFlow.ts';

export const DEVICE_ORDERS_MAX = 30;
const CONCURRENCY = 4;

export type DeviceOrder =
  | { orderId: string; state: 'ok'; summary: OrderSummary }
  | { orderId: string; state: 'denied' } // key no longer valid / order gone: the Worker answers these the same way
  | { orderId: string; state: 'unavailable' }; // offline / Worker unreachable: nothing is shown as a status

/** The order numbers this device holds for `who` (newest first). */
export function deviceOrderIds(store: TrackingKeyStore, who: string): { orderId: string; key: string }[] {
  return (store.list?.(who) ?? []).slice(0, DEVICE_ORDERS_MAX);
}

/** Each saved order checked with the Worker (key in a header). Results keep the device's order. */
export async function loadDeviceOrders(
  entries: { orderId: string; key: string }[], opts: SubmitOptions, deps: SubmitDeps,
): Promise<DeviceOrder[]> {
  const out: DeviceOrder[] = new Array(entries.length);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      const { orderId, key } = entries[i];
      try {
        const r = await fetchOrderSummary(orderId, { key }, opts, deps);
        out[i] = r.kind === 'ok' ? { orderId, state: 'ok', summary: r.order } : { orderId, state: r.kind };
      } catch {
        out[i] = { orderId, state: 'unavailable' };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return out;
}

export type ClaimResult =
  | { kind: 'linked' } // linked now
  | { kind: 'already_yours' }
  | { kind: 'already_linked' } // belongs to another account: never moved
  | { kind: 'not_matching' } // wrong key / phone digits / unknown order (one answer for all)
  | { kind: 'sign_in_required' }
  | { kind: 'unavailable' };

export const PHONE_LAST4_RE = /^\d{4}$/;

export async function claimOrder(
  orderId: string, key: string, phoneLast4: string, idToken: string | null, opts: SubmitOptions, deps: SubmitDeps,
): Promise<ClaimResult> {
  const base = normalizeWorkerUrl(opts.workerUrl);
  if (!base) return { kind: 'unavailable' };
  if (!idToken) return { kind: 'sign_in_required' };
  if (!PHONE_LAST4_RE.test(phoneLast4)) return { kind: 'not_matching' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      deps.fetch(`${base}/orders/${encodeURIComponent(orderId)}/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}`, 'x-tracking-key': key },
        body: JSON.stringify({ phoneLast4 }),
      }),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), opts.timeoutMs ?? 12_000); }),
    ]);
    if (!r) return { kind: 'unavailable' };
    let body: { ok?: boolean; linked?: boolean; alreadyYours?: boolean; code?: string } | null = null;
    try { body = JSON.parse(await r.text()); } catch { body = null; }
    if (r.status === 200 && body?.ok) return body.alreadyYours ? { kind: 'already_yours' } : { kind: 'linked' };
    if (r.status === 409 && body?.code === 'ALREADY_LINKED') return { kind: 'already_linked' };
    if (r.status === 404) return { kind: 'not_matching' };
    if (r.status === 401) return { kind: 'sign_in_required' };
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
