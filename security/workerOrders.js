// Same rule as functions/src/workerOrders.ts (separate codebase, CommonJS): an order of the order Worker v2 is
// source === 'worker-v2' AND orderLedger/{id} exists (only the Worker can write orderLedger; browsers cannot forge it).
// Any lookup error -> false (the legacy behaviour runs, as before).
async function isWorkerV2Order(order, ledgerExists) {
  if (!order || order.source !== 'worker-v2') return false;
  try {
    return (await ledgerExists()) === true;
  } catch {
    return false;
  }
}

module.exports = { isWorkerV2Order };
