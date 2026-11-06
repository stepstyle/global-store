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

## User guide (Arabic)

1. يصل لكل طلب جديد رسالة في مجموعة الإدارة على تيليجرام فيها تفاصيل الطلب وزرّان: «✅ قبول الطلب» و«❌ رفض الطلب».
2. **القبول**: يُخصم المخزون فورًا وتصبح حالة الطلب «قيد التجهيز» في لوحة الإدارة. إذا لم يكفِ المخزون يظهر تنبيه ويبقى الطلب بانتظار القرار دون أي خصم.
3. **الرفض**: يُلغى الطلب ولا يُخصم أي شيء من المخزون.
4. **الإلغاء بعد القبول**: اضغط «🚫 إلغاء الطلب» ثم «⚠️ تأكيد الإلغاء». يُعاد المخزون مرة واحدة فقط.
5. الضغط المتكرر أو ضغط مشرفَين معًا آمن، فالقرار يُنفَّذ مرة واحدة فقط.
6. من لوحة الإدارة: لا يمكن قبول أو رفض طلب ينتظر الموافقة. بعد القبول يمكن نقله إلى «تم الشحن» ثم «تم التوصيل» فقط، والإلغاء يتم من تيليجرام.
7. الطلبات القديمة (قبل هذا النظام) تُدار من لوحة الإدارة كما كانت.
