# Telegram order approval — feature branch only (NOT LIVE)

This feature changes **when inventory is deducted**. Do not deploy only part of it.

## Semantics
- Checkout creates one `orders/{id}` and `orderLedger/{id}` entry with `status=new` and **no stock deduction** (`STOCK_MODE=log`).
- Telegram receives a single notification with Accept / Reject buttons (only when webhook credentials are configured).
- Only the configured Telegram user in the configured private chat can act. The incoming webhook must have Telegram's `X-Telegram-Bot-Api-Secret-Token` header matching the private `TELEGRAM_WEBHOOK_SECRET`.
- Accept requires the original Worker-v2 order still `new`, a ledger indicating `stockMode=log`, and valid available inventory. Atomic Firestore preconditions update stock, `status=processing`, and decision ledger once. Missing/ambiguous stock refuses the acceptance with no partial writes.
- Reject changes `status=cancelled`, and does not modify stock.
- Legacy v1 orders and older v2 orders that deducted at creation are **not eligible** for Telegram acceptance: no accidental second deduction.
- Direct Firestore accept/cancel from the AdminDashboard is blocked for `new` Worker-v2 orders to prevent bypassing inventory processing. Existing old order management remains unchanged.
- This is a best-effort notification (the Firestore ledger keeps send/retry state); duplicate Telegram notification messages can still occur after a crash between provider delivery and acknowledgment. Clicks remain idempotent.

## Inactive deployment requirements
1. Maintain all existing secrets; add a new cryptographically random `TELEGRAM_WEBHOOK_SECRET` (32+ chars, Telegram's allowed charset) as a **Cloudflare secret**, never source code or VITE_* env.
2. Configure `TELEGRAM_ADMIN_USER_ID` privately (Telegram numeric sender ID of the store owner) on the Worker, and verify it matches the intended private chat. The `TELEGRAM_CHAT_ID` is the target private chat ID.
3. Test with the Firestore Emulator or a completely isolated staging Firebase project and a test Telegram bot. Never enable the real Telegram bot webhook against an untested Preview deployment.
4. The Worker has `workers_dev=false` and no routes, so `/telegram/webhook` is not reachable until a **separately authorized** public HTTPS route/domain is configured. Telegram's `setWebhook` must use that exact URL and the secret_token. Configure `allowed_updates=["callback_query"]` to narrow updates.
5. Do not deploy the previously uploaded Worker v2 version: it still contains `STOCK_MODE=apply` and deducts at creation. A new, complete version must be uploaded and independently verified after this feature is tested.
6. Do not switch Vercel `VITE_WORKER_URL`, publish Firestore rules, enable routes, register Telegram webhook or touch the old v1 Worker before an explicit coordinated production rollout.
7. Add integration tests for two simultaneous Accept clicks, back-to-back orders of the last product, variant stock, old Worker v1 orders, and failure during Telegram acknowledgment. Exercise the AdminDashboard path and guest/mobile order flow. A build and local unit tests are necessary but not sufficient for production.

## Local verification
From the project root:
```powershell
node --test workers/order-worker/test/unit/telegram-actions.test.mjs
node --test workers/order-worker/test/unit/*.test.mjs
npx tsc --noEmit
npm run build
```
`node --test workers/order-worker/test/unit/*.test.mjs` may need a PowerShell array expansion and should be run inside the Worker directory when applicable.
