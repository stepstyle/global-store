/**
 * An order created by the order Worker v2 — which validates prices (PRICE_CHECK_MODE=enforce) and sends its own
 * notifications. True ONLY when BOTH hold:
 *  - order.source === 'worker-v2', and
 *  - orderLedger/{id} exists. Only the Worker (service account) can write orderLedger — browsers are denied by every
 *    rules set — so a browser-written order that merely claims source:'worker-v2' is NOT treated as one.
 * Any lookup error -> false (the legacy behaviour runs, as before).
 */
export async function isWorkerV2Order(
  order: { source?: unknown } | undefined | null,
  ledgerExists: () => Promise<boolean>,
): Promise<boolean> {
  if (!order || order.source !== "worker-v2") return false;
  try {
    return (await ledgerExists()) === true;
  } catch {
    return false;
  }
}
