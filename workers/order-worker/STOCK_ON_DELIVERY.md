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

* Creation: `src/orders.js` + `src/reservations.js`. Status changes: `POST /admin/orders/:id/status`
  (`src/fulfilment.js`), Firebase ID token of the owner (`config/roles.ownerUid`) or an `admins/{uid}` whose `active` is
  not false (`src/admin.js`).
* Every change is ONE Firestore commit with an `updateTime` (or `exists:false`) precondition on every written document;
  `orderLedger/{id}.inventory` (`reserved | none | released | deducted | restocked`) makes each stock effect happen at
  most once. Concurrent clicks / tabs / orders re-read and re-decide.
* Legacy orders (no ledger = old site / Worker v1, or `stockPolicy` `on_creation` / `on_approval`) are refused with
  `LEGACY_ORDER` and never touch stock; the dashboard keeps changing their status directly, as before.
* Dashboard: `src/services/adminOrders.ts`. Product editor: `src/services/stockMerge.ts` (a stock number the admin did
  not touch keeps its current Firestore value — a delivery made while the editor was open is never undone).
* Rules: `firebase/firestore.rules.on-delivery` (= production snapshot + the orders block): no browser may change the
  status / inventory of an `on_delivery` order, nor delete one that still holds a reservation, nor create an order with
  `inventory` / `approval`; `stockReservations` and `orderLedger` have no browser access.

Tests: `test/unit/reservations.test.mjs`, `test/stock-on-delivery.test.mjs` (D1–D15, emulator),
`test/rules-on-delivery.test.mjs` (R1–R8, emulator), `tests/unit/adminOrders.test.mjs`, `tests/unit/stockMerge.test.mjs`.

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

Rollback after step 4: Vercel instant rollback of main **and** the snapshot rules; orders created by v2 meanwhile
(listed by `orderLedger.stockPolicy == on_delivery`) then need their stock handled by hand when delivered.
