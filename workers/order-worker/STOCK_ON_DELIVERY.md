# Stock on delivery (STOCK_POLICY=on_delivery)

Owner's decision (2026-11-17): orders are accepted automatically, Telegram only notifies (no buttons), the admin
follows the order in the dashboard, and the stock moves only when the order is **delivered**.

| Step | Physical stock | Reservation (`stockReservations/{productId}`) |
|---|---|---|
| Order created (status `new`) | unchanged | + quantity — refused `422 OUT_OF_STOCK` if `stock − reserved` is not enough |
| `processing` / `shipped` | unchanged | unchanged |
| → `delivered` | − quantity, **once** | − quantity |
| `cancelled` before delivery | unchanged | − quantity (released) |
| `cancelled` after delivery (return, `confirmReturn: true` only) | + quantity, **once** | unchanged |
| delivered → anything else, cancelled → anything | refused `TRANSITION_NOT_ALLOWED` | — |
| recorded stock lower than the delivered quantity | refused `INSUFFICIENT_STOCK`, nothing written | — |
| a product / colour / size of the order is gone (deleted, removed, duplicated, ambiguous) | refused `ITEMS_MISSING`, nothing written (restore it, or cancel the order) | — |
| a product / colour / size has no VALID stock number (missing, empty, text, null, NaN) | refused `STOCK_UNTRACKED`, nothing written (enter the stock number first) | — |

* Creation: `src/orders.js` + `src/reservations.js`. Status changes: `POST /admin/orders/:id/status`
  (`src/fulfilment.js`), Firebase ID token of the owner (`config/roles.ownerUid`) or an `admins/{uid}` whose `active` is
  not false (`src/admin.js`).
* Every change is ONE Firestore commit with an `updateTime` (or `exists:false`) precondition on every written document;
  `orderLedger/{id}.inventory` (`reserved | none | released | deducted | restocked`) makes each stock effect happen at
  most once. Concurrent clicks / tabs / orders re-read and re-decide.
* Legacy orders (no ledger = old site / Worker v1, or `stockPolicy` `on_creation` / `on_approval`) are refused with
  `LEGACY_ORDER` and never touch stock; the dashboard keeps changing their status directly, as before.
* Dashboard: `src/services/adminOrders.ts`. Product editor: `src/services/stockMerge.ts` (a stock number the admin did
  not touch keeps its current Firestore value — a delivery made while the editor was open is never undone; a number
  the admin changed while a delivery changed it too is refused). Reservations live outside the product document, so
  no product edit can remove them; a stock set below what is reserved only makes new orders / the delivery refuse.
* CSV import / "add product": `src/services/csvImport.ts` — create-only (checked and written in one transaction). A
  row whose id already exists is refused with its line number; existing products (stock, colours / sizes, ratings,
  price …) are never changed by a CSV.
* Rules: `firebase/firestore.rules.on-delivery` (= production snapshot + the orders block): no browser may change the
  status / inventory of an `on_delivery` order, nor delete one that still holds a reservation, nor create an order with
  `inventory` / `approval`; `stockReservations` and `orderLedger` have no browser access.

Tests: `test/unit/reservations.test.mjs`, `test/stock-on-delivery.test.mjs` (D1–D17, emulator),
`test/rules-on-delivery.test.mjs` (R1–R8, emulator), `test/product-editor.test.mjs` (E1–E6, emulator, the real browser
functions under the transition rules), `tests/unit/adminOrders.test.mjs`, `tests/unit/stockMerge.test.mjs`,
`tests/unit/csvImport.test.mjs`.

## Transition (each step needs its own approval; no interruption of orders)

0. Today: the site (main 505e7b1) sends orders to Worker v1 (stock taken at creation) and also writes them from the
   browser. Worker v2 is deployed but receives no traffic. The Telegram webhook is NOT set and is no longer needed.
1. Push this branch; check the Vercel previews (SANDBOX).
2. Local `wrangler.production.local.toml`: `STOCK_POLICY = "on_delivery"`, `APPROVAL_MODE = "off"`, remove
   `TELEGRAM_ADMIN_USER_IDS`; `node production/check-config.mjs` → OK; deploy Worker v2 (still no traffic).
   Probe: `GET /` → `v2.1.0-on-delivery`; `/telegram/webhook` → 404; `/admin/orders/…/status` without token → 401.
3. Deploy `firebase/firestore.rules.on-delivery` BEFORE the site switch (old dashboard tabs can then never change an
   `on_delivery` order directly). Nothing changes for current orders (none has `inventory`). Rollback: the snapshot.
4. Vercel `VITE_WORKER_URL` (Production) → Worker v2, then fast-forward `main` (one production build).
   Old tabs keep using v1 until reloaded (their orders: stock at creation, legacy — never deducted again).
   No migration: open v1 orders already took their stock; only new orders reserve.
5. One real test order: no Telegram buttons, stock unchanged + reserved; dashboard processing → shipped → delivered
   (stock −1 once); optionally the return.
6. After 24 h: retire Worker v1, close browser order creation in the rules, remove `WORKER_AUTH_TOKEN`,
   `TELEGRAM_WEBHOOK_SECRET`.

## Rollback (new orders stay manageable in every case)

Set `VITE_ORDER_ADMIN_URL` (Vercel, Production) = the Worker v2 URL at step 4: the dashboard then always manages the
v2 orders through v2, whatever `VITE_WORKER_URL` (order creation) points to.

| Problem after the switch | Rollback | v2 orders already placed |
|---|---|---|
| Worker v2 refuses / breaks order **creation** | `VITE_WORKER_URL` back to v1 + redeploy the SAME new commit (new dashboard kept) | managed as before (dashboard → v2 via `VITE_ORDER_ADMIN_URL`); new orders are v1 / legacy |
| A bug in a **new dashboard / site** change | Vercel instant rollback to the previous deployment of the NEW branch, if one exists | unaffected |
| The new site itself must go (back to 505e7b1) | 1. rules → snapshot  2. Worker v2: `SYNC_DIRECT_STATUS = "true"` (deploy)  3. Vercel rollback to 505e7b1 | the old dashboard changes their status directly; the cron (≤ 5 min) deducts on delivered / releases on cancelled or deleted, exactly once; refusals are recorded in `orderLedger.syncProblem` (stock untouched until fixed) |
| Worker v2 itself broken | redeploy the previous **on_delivery** version — never 274978a8 (Telegram-approval build: no admin route) | — |

Coming back after a full rollback: `SYNC_DIRECT_STATUS = "false"`, transition rules, new site (synced orders are
consistent; a return of a synced delivered order works once). Limits: the old dashboard has no "return" button; per
5-minute run the sync scans up to `SYNC_PAGES` × `SYNC_BATCH` (5 × 300) reserved orders and applies at most
`SYNC_APPLY_PER_RUN` (4) stock effects (new cases first, refused ones after — a refused order keeps its reservation and
its reason in `orderLedger.syncProblem`). State-based: if Worker v2 is down during the rollback nothing is lost — the
next run finds every direct change. While Worker v1 takes the orders again, it does NOT see v2's reservations.

Local end-to-end (real workerd + emulators + headless Chrome): `E2E_SUITE=delivery node test/local-e2e/run.mjs`
(DA01–DA06 Worker API, DU01–DU07 browser: checkout, dashboard buttons, return, refusals, delete guard, product
editor, CSV).
