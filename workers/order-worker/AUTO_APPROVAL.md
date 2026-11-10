# Smart auto-approval: design (phase 1 done: rules + unit tests only)

Status: `src/autoapproval.js` (`assessOrder`) and `test/unit/autoapproval.test.mjs` exist. **Nothing calls them yet.** No order is assessed and nothing is deployed.

## Decisions (store owner, 2026-11)

| Setting | Value |
|---|---|
| Max quantity per line | 5 |
| Max total pieces | 15 |
| Max order value | 50 JOD (server total) |
| CliQ | never automatic (the transfer is not verified by the Worker) |
| Same phone, other pending/accepted order within 24 h | manual review (never rejected) |
| Dashboard switch | OFF by default |

## Rules (`assessOrder`)

- **Outcomes:**
  - `auto_accept`: every check passed.
  - `manual_review`: one or more reasons; the order stays `new` with no stock change.
  - `disabled`: a lock is closed or the settings are invalid.
- **It never rejects an order.**
- **Locks.** All three must be open:
  - `AUTO_APPROVAL_MODE=on`, a Worker var with default `off` (the server ceiling);
  - `APPROVAL_MODE=telegram`;
  - `config/autoApproval.enabled`, the dashboard switch.

  A malformed setting disables auto-approval rather than loosening a limit.
- **Checks:**
  - **Data:** name, valid phone, real street (not the storefront placeholder), city, and area in Amman.
  - **Server pricing and inventory:** no delivery, price or stock warnings.
  - **Turnstile:** verified.
  - **Duplicates:** same-phone check via an HMAC fingerprint, so the phone is not stored again. If the check is unavailable, the order goes to review.
  - **Limits:** quantity and value.
  - **Payment:** CliQ, or an unknown method, goes to review.
  - **Review list:** phone fingerprint is not on it.
- **Free only:** server checks plus Cloudflare Turnstile. No paid AI, OTP, SMS or WhatsApp.
- **Scope:** auto-acceptance is not proof of the phone owner's identity. It sets `processing` only; shipped and delivered stay manual. It sends no customer e-mail.

## Guarantee (b): the final stock check is inside the atomic acceptance

- `assessOrder`'s stock check is a **pre-check only**.
- An `auto_accept` result calls the existing `decideOrder(fs, cfg, { action: 'accept', actor: { source: 'auto' } })` (src/approval.js). It:
  1. re-reads the order, the ledger and **every product**;
  2. plans the deduction again;
  3. commits ledger + order + products in **one** commit with `updateTime` preconditions on each.
- A shortfall at that moment returns `cannot_accept`, and the order goes to manual review with nothing deducted. A concurrent change makes the commit fail, and it re-reads and re-decides.
- There is no second deduction path. Auto and manual decisions use the same function, so `already_accepted` blocks any double deduction (proved for manual presses by A03 / A06 / A07).

## Guarantee (a): the Worker stops after the order is saved but before auto-approval finishes

**Phase 2, not built yet.** Design:

1. When the three locks are open, the **creation commit** also writes `orderLedger.autoReview = { state: 'queued', queuedAt }`, in the same commit as the order. So a saved order always carries this marker; it can never be "saved but forgotten".
2. The same request then:
   - runs `assessOrder`;
   - on `auto_accept`, runs `decideOrder('accept')`;
   - finishes with `autoReview = { state: 'done', decision, reasons, version, doneAt }`, preconditioned on the ledger's `updateTime` / `state == 'queued'`.
3. **Notification waits for the review.**
   - `processNotifications` does not send while `autoReview.state == 'queued'` and the marker is younger than 90 s.
   - So the Telegram message shows the real state: 🤖 accepted, or ⚠️ needs review with the reasons.
4. **Recovery by the cron** (every 5 min) for ledgers with `autoReview.state == 'queued'` older than 60 s:
   - It re-runs the review with the settings **at recovery time**. If the switch is now OFF, it marks `done` as manual review.
   - On `auto_accept` it calls `decideOrder('accept')`. If the request had already accepted before stopping, this returns `already_accepted`: **no second deduction**.
   - It marks `done` (preconditioned), then lets the notification go.
   - A marker older than 30 min is marked `done` as manual review, and the message is sent, so the order is never stuck.
5. **The customer's retry** (same order, `replay`) does not start a second review. The marker is already there, and the cron owns recovery.

**Tests to add in phase 3:**

- **B13:** the Worker stops between creation and decision (test hook). The cron recovers it, the stock is deducted once, and one message is sent.
- **B14:** the Worker stops after `decideOrder` but before `done`. The cron's re-run gets `already_accepted` and the stock stays deducted once.
- **B15:** the switch is turned off before recovery, so the order goes to manual review with nothing deducted.

## Phases

| # | Content | Where |
|---|---|---|
| 1 ✅ | `assessOrder` + unit tests (17) | local |
| 2 | `config/autoApproval` + Firestore rules (admin-only write); ledger marker + phone fingerprint + index; integration in `orders.js` after the creation commit; recovery in the cron; Telegram text (🤖 / ⚠️ + reasons); dashboard switch | local + emulator |
| 3 | B01–B15 in the real Worker runtime (local), then the TEST bot | local |
| 4 | Staging (`--suite auto`) | staging, needs approval |
| 5 | Production | separate decision; `AUTO_APPROVAL_MODE=off` first |
