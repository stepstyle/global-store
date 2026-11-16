# Telegram order approval: settings, deploy, rollback

Order Worker v2 with `APPROVAL_MODE=telegram`. Code: `src/approval.js` (decisions) and `src/telegram.js` (message + webhook). Tests: `test/telegram-approval.test.mjs` and `firebase/rules-test/app-paths.final.test.mjs` (APPROVAL).

## How it works

| Step | Firestore | Stock |
|---|---|---|
| Order created (`POST /orders`) | order `status:new`, `approval:{policy:'telegram',state:'pending'}`; ledger `stockPolicy:'on_approval'`, `decision:'pending'`, `approvalLines` (server prices) | unchanged |
| ✅ Accept | ONE commit: ledger `accepted` + order `processing` + every product write, each with an `updateTime` precondition | deducted once |
| ❌ Reject | ONE commit: ledger `rejected` + order `cancelled` | unchanged |
| 🚫 Cancel → confirm (accepted only) | ONE commit: ledger `cancelled` + order `cancelled` + restock of exactly what was deducted | restored once |

- Repeated presses, re-delivered updates and a second admin's press return `already_*` and write nothing.
- A concurrent change makes the commit fail its precondition; the Worker then re-reads and re-decides (up to 6 times).
- Orders without an `on_approval` ledger (browser / Worker v1 / stock taken at creation) are `legacy`: never deducted again from Telegram.
- Firestore rules (`firestore.rules.final`):
  - nobody can write `approval`;
  - the dashboard can't change a pending approval order's status;
  - an accepted order may only move within processing → shipped → delivered.

## Cloudflare settings (Worker v2, production), names only

| Name | Kind | Value |
|---|---|---|
| `APPROVAL_MODE` | var | `telegram` (`off` = previous behaviour: deduct at creation) |
| `STOCK_MODE` | var | must be `apply` (config refuses otherwise) |
| `TELEGRAM_CHAT_ID` | var | numeric id of the admin chat/group |
| `TELEGRAM_ADMIN_USER_IDS` | var | comma-separated numeric Telegram user ids allowed to decide |
| `CURRENCY` | var | ISO code, default `JOD` |
| `TELEGRAM_BOT_TOKEN` | **secret** | already exists, don't overwrite |
| `TELEGRAM_WEBHOOK_SECRET` | **secret** (new) | 32–256 chars `[A-Za-z0-9_-]`, random; `wrangler secret put TELEGRAM_WEBHOOK_SECRET --config wrangler.production.local.toml` |

`wrangler.production.toml` must also have:
- a public endpoint (`workers_dev = true` or a `routes`/custom domain);
- a non-empty `crons` (e.g. `["*/5 * * * *"]`), so messages that failed to send are retried.

`node production/check-config.mjs` currently reports both as **BLOCKED**.

## Telegram setting (needs approval: changes the live bot)

Once only, after the Worker is deployed:

```
POST https://api.telegram.org/bot<TOKEN>/setWebhook
  url             = https://<worker-host>/telegram/webhook
  secret_token    = <TELEGRAM_WEBHOOK_SECRET>
  allowed_updates = ["callback_query"]
  drop_pending_updates = true
```

Check with `getWebhookInfo`: `url` must match, `last_error_message` must be empty. A bot has ONE webhook, so this replaces any webhook that is set today. Run `getWebhookInfo` first and keep the old URL.

## Safe deploy order

1. Merge the PR after review. Don't deploy from an unmerged branch.
2. Set the vars and the new secret (above). Don't change existing secrets.
3. `npx wrangler deploy --dry-run --config wrangler.production.local.toml`, then `node production/check-config.mjs` must print no violations.
4. Deploy the Worker.
5. Deploy `firestore.rules.final` (needs approval). Without it the dashboard can still move pending orders. The UI guard alone is not enough.
6. `setWebhook` (above).
7. Place a small real test order:
   - the message arrives with buttons;
   - press ❌ (no stock change);
   - place another order and press ✅: stock drops once, and the dashboard shows "processing";
   - 🚫 + confirm: stock returns.

## Rollback (no data loss)

- **Quickest:** set `APPROVAL_MODE=off` and redeploy.
  - New orders go back to stock-at-creation.
  - Orders already pending stay pending. Their buttons still work if the webhook stays.
  - Otherwise decide them by hand: their stock was never taken.
- **Webhook:** `deleteWebhook` (or restore the previous URL kept from `getWebhookInfo`).
- **Worker:** `wrangler rollback` to the previous version.
- **Rules:** redeploy the previous rules file.
- Never edit `orderLedger` by hand. It is the record that prevents double deduction.

## Testing

| Level | Command | Needs |
|---|---|---|
| Unit + emulator (18 scenarios) | `npm run test:integration` (includes `test/telegram-approval.test.mjs`) | nothing external |
| Real Worker runtime (A01–A16) | `E2E_SUITE=approval E2E_RULES=final node test/local-e2e/run.mjs` | nothing external: workerd + notify sink + Firestore emulator on 127.0.0.1, network jail |
| Staging (A01–A16) | `node staging/run-tests.mjs --config staging/staging.config.json --suite approval` | **approval**: deploy the staging Workers (sink + order) with `APPROVAL_MODE=telegram` and TEST ids |
| Real TEST bot, by hand | `test/local-e2e/telegram-bridge.mjs --expect-bot-id <test bot id>` + `E2E_SUITE=approval-live` | **approval**: a new TEST bot and a TEST group; contacts api.telegram.org for that one allow-listed bot only |

- If port 9152 is held by another program, set `E2E_EMULATOR_WS_PORT=<free port>`.
- A01–A16 press the buttons exactly as Telegram does: `POST /telegram/webhook` with the secret header and a `callback_query` update. The sink plays Telegram and records the method, the message id, the callback data, the decision line and the answer, but no personal data.

### Real TEST bot (no webhook is set, changed or removed on any bot)

All commands run from `workers/order-worker`. Placeholders in `<…>` are yours to fill in; none of them is a secret except the token file, which is never passed on the command line.

1. **Bot and group.**
   - In BotFather, create a new bot whose username contains `test`.
   - Create a test group and add only that bot to it (never the store bot).
   - Save the token as one line in `.secrets/test-bot.token`. The folder is git-ignored (`workers/order-worker/.gitignore`).
2. **Ids** (none of these is secret):
   - Test bot id: the number before `:` in the test token. `getMe` returns the same id.
   - Test group id: a negative number. A basic group is like `-55…`, a supergroup `-100…`. It changes if Telegram converts the group, so don't change group settings during a test.
     - With privacy mode on, send `/start@<test bot username>` in the group.
     - Then read `chat.id` from `getUpdates` of the TEST bot, without `offset`, so nothing is acknowledged.
   - Your Telegram user id: from @userinfobot. This is the only user allowed to press the buttons.
3. **Read-only check:**
   ```
   node test/local-e2e/telegram-bridge.mjs --check --token-file .secrets/test-bot.token --expect-bot-id <test bot id>
   ```
   - `--expect-bot-id` is **required**. It is an allow-list of exactly one bot, compared with the id inside the token file **before any request**. A token of any other bot, the store bot included, is never sent anywhere.
   - The bridge also refuses a bot whose username lacks `test`, and a bot that has a webhook. It never sets, changes or removes a webhook.
   - `--forbid-bot-id <real store bot id>` is an optional extra block.
4. **Shared local secret:** one random value of 32–256 characters `[A-Za-z0-9_-]`, kept only for this run. It is NOT the bot token. For example:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
5. **Terminal 1, the bridge FIRST.** Order messages are sent as soon as the stack is up; with no bridge yet they would be lost, because the local cron is not triggered during this run.
   ```
   E2E_TG_LOCAL_SECRET=<secret> node test/local-e2e/telegram-bridge.mjs --run --token-file .secrets/test-bot.token \
     --chat-id <test group id> --confirm <test bot username without @> --expect-bot-id <test bot id> [--forbid-bot-id <real store bot id>]
   ```
   Wait for `bridge on 127.0.0.1:8790`.
6. **Terminal 2, the local stack:** order Worker under `wrangler dev --local`, notify sink, Firestore emulator with synthetic products; nothing deployed.
   ```
   E2E_SUITE=approval-live E2E_TG_LOCAL_SECRET=<same secret> E2E_TG_CHAT_ID=<test group id> E2E_TG_ADMIN_IDS=<your user id> \
     [E2E_TG_WAIT_MIN=20] [E2E_TG_REPEAT_SEC=120] [E2E_EMULATOR_WS_PORT=<free port if 9152 is taken>] node test/local-e2e/run.mjs
   ```
7. **Press the buttons in the test group.** When terminal 1 shows `→ sendMessage 200` three times, three messages are in the group. Each one says in its `📝 ملاحظة` line what to do:

   | Order | Action | Expected stock afterwards |
   |---|---|---|
   | 1 (notebook ×2) | accept | notebook 10 → 8 |
   | 2 (red pen + notebook) | reject | unchanged |
   | 3 (last piece) | accept, then cancel, then confirm | 1 → 0 → 1 |

   - The run waits up to `E2E_TG_WAIT_MIN` minutes and does not stop at a different decision.
   - After the planned decisions it watches `E2E_TG_REPEAT_SEC` more seconds. Press old or remaining buttons again in that window to test repeats.
8. **Result.** The run prints PASS / FAIL for:
   - status and admin of each order;
   - one deduction for #1, no deduction for #2;
   - #3 taken then restored once;
   - final stock 8 / 5 / 1;
   - nothing changed during the repeat window;
   - stock equal to the decisions actually taken.

   The emulator is stopped and erased at the end. Stop the bridge with Ctrl+C, and don't press the old messages' buttons afterwards.
- The bridge forwards only `sendMessage`, `editMessageText`, `editMessageReplyMarkup` and `answerCallbackQuery`, all forced to `--chat-id`. It receives presses with `getUpdates` (long polling).
- Its first `getUpdates` acknowledges pending updates of the TEST bot, and sets `allowed_updates` to `callback_query` for that bot only.

## Duplicate Telegram messages (3 per order): what the code shows

- Today the live site runs the `main` Checkout and Worker v1 `anta-order-notify`. In the repository, the **only** sender of the order message is Worker v1 `/create-order`: one `sendMessage` per HTTP call. It has no idempotency and no retry. The Cloud Functions `sendOrderEmail` and `secureOrderPrices` send no Telegram.
- Three messages therefore mean three calls to `/create-order`, or a sender outside this repository. Checkout on `main` makes a new order id for each submit. Its guard is React state (`isProcessing`), and taps before the re-render each pass it. Each such call writes an order, deducts stock without a transaction, and sends a message.
- How to tell, read-only and without changing anything:
  - **Same order id three times:** three calls with the same body. Check the v1 Worker's request logs (Cloudflare dashboard, Workers → anta-order-notify → Logs) for three `POST /create-order`.
  - **Three different ids with the same items:** multiple submits. Look in the Firestore console for orders with the same phone or items a few seconds apart.
  - **Neither:** another sender. List the deployed Cloud Functions and Workers that use the same bot token.
- Worker v2 (this PR) sends one message per order, enforced by the ledger, the notification claim and `replay` for a resent order (A12 / S02). After a crash between "sent" and "marked sent" one duplicate is possible; a duplicate can never deduct twice (A03).

## User guide (Arabic)

1. يصل لكل طلب جديد رسالة في مجموعة الإدارة على تيليجرام فيها تفاصيل الطلب وزرّان: «✅ قبول الطلب» و«❌ رفض الطلب».
2. **القبول**: يُخصم المخزون فورًا وتصبح حالة الطلب «قيد التجهيز» في لوحة الإدارة. إذا لم يكفِ المخزون يظهر تنبيه ويبقى الطلب بانتظار القرار دون أي خصم.
3. **الرفض**: يُلغى الطلب ولا يُخصم أي شيء من المخزون.
4. **الإلغاء بعد القبول**: اضغط «🚫 إلغاء الطلب» ثم «⚠️ تأكيد الإلغاء». يُعاد المخزون مرة واحدة فقط.
5. الضغط المتكرر أو ضغط مشرفَين معًا آمن، فالقرار يُنفَّذ مرة واحدة فقط.
6. من لوحة الإدارة: لا يمكن قبول أو رفض طلب ينتظر الموافقة. بعد القبول يمكن نقله إلى «تم الشحن» ثم «تم التوصيل» فقط، والإلغاء يتم من تيليجرام.
7. الطلبات القديمة (قبل هذا النظام) تُدار من لوحة الإدارة كما كانت.
