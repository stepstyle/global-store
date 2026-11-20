# إطلاق الدولاب + القبول عبر Telegram — خطوات يوم الإطلاق

لا شيء هنا يُنفَّذ قبل موافقتك النهائية. الفرع `dev/review-2026-11` يحتوي الإنتاج الحالي (`1ea8a1c`)، فالدمج fast-forward.

## ما سيعمل بعد الإطلاق

| البند | القيمة |
|---|---|
| الدولاب | ظاهر للزوار قبل أي تسجيل؛ Google عند «تأكيد الطلب»، ثم Turnstile |
| الحملة | 50 د.أ متاحة من البداية، سقف صارم، 30 يومًا من لحظة حفظها، بلا تجديد؛ الكميات = 50 د.أ بالضبط |
| فرص الفوز | جديد 19.7%، راجع 24.4%، دائم 33%؛ الساعة واللعبة والنثريات موقوفة |
| المخزون | حجز عند الطلب، خصم مرة واحدة عند ضغطك ✅ في Telegram، إرجاع مرة واحدة عند الإلغاء |
| المشرف | حسابك فقط (`6585888926`، موجود في `wrangler.production.local.toml`) |
| القبول التلقائي | OFF |
| الطلبات القديمة | تكمل بقواعدها: طلبات اليوم (خصم عند التسليم) وطلبات Worker v1 (للتبويبات القديمة) لا تتأثر |

## قبل البدء: سجّل نقاط الرجوع (قراءة فقط، دقيقتان)

1. **Cloudflare** ← Workers & Pages ← `anta-order-v2` ← Deployments: انسخ رقم النسخة الحالية (المتوقع `2ea16078…`).
2. **Vercel** ← المشروع `global-store-oz2a` ← Deployments: انسخ رقم النشر الحالي على dairsharaf.com (المتوقع `dpl_DNAuUwBjjLg3N968pHAvKq5pJqrk`).
3. **Firebase** ← Firestore ← Rules: القواعد الحالية (المتوقع ruleset `760798d0`).

## الخطوة 1 — توليد سرّين (على جهازك)

افتح PowerShell وشغّل السطر مرتين. احفظ الناتجين في مكان آمن ولا ترسلهما لأحد (ولا لي):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- الناتج الأول = **سر Telegram** (`TELEGRAM_WEBHOOK_SECRET`)
- الناتج الثاني = **سر الدولاب** (`WHEEL_PHONE_SECRET`)

## الخطوة 2 — Cloudflare: إضافة السرّين

Workers & Pages ← `anta-order-v2` ← Settings ← Variables and Secrets ← Add:

| Type | Name | Value |
|---|---|---|
| Secret | `TELEGRAM_WEBHOOK_SECRET` | الناتج الأول |
| Secret | `WHEEL_PHONE_SECRET` | الناتج الثاني |

إضافة سر تنشئ نسخة جديدة من الـ Worker **بنفس السلوك الحالي** (الكود الحالي لا يستخدمهما). لا تضف أي شيء آخر من اللوحة؛ باقي الإعدادات تأتي من الملف في الخطوة 4.

## الخطوة 3 — Vercel: متغير واحد

المشروع `global-store-oz2a` ← Settings ← Environment Variables ← Add:

| Key | Value | Environment |
|---|---|---|
| `VITE_WHEEL_MODE` | `live` | Production فقط |

وتأكد أن `VITE_ORDER_SIGN_IN` **غير موجود** (أو ليس `optional`)؛ غيابه = تسجيل Google عند تأكيد الطلب. لا تضغط Redeploy الآن.

## الخطوة 4 — القواعد ثم الـ Worker (أوامر؛ أنفّذها أنا بعد موافقتك إن كانت هذه الطرفية مسجّلة الدخول، وإلا تنفّذها أنت)

```bash
# تسجيل الدخول مرة واحدة (أنت، في المتصفح): npx wrangler login   و   firebase login

# 4أ) القواعد — ليس `firebase deploy` (firebase.json لا يحدد ملف قواعد). من مجلد
#     ../release-wheel-launch-2026-11 (ملفان + سكربت قراءة فقط):
node rules-compare-readonly.mjs firestore.rules.before-launch firestore.rules.launch
#     المتوقع: before-launch equal=true (الحي = نسخة 1ea8a1c)، launch يختلف في سطر workerManaged فقط
node ../release-rollback-2026-11-19/fb-rules-deploy.mjs firestore.rules.launch
#     المتوقع في آخر سطر: live == file: true
#     التراجع: node ../release-rollback-2026-11-19/fb-rules-deploy.mjs firestore.rules.before-launch

# 4ب) في workers/order-worker/wrangler.production.local.toml غيّر/أضف داخل [vars]:
#   STOCK_POLICY = "on_acceptance"
#   APPROVAL_MODE = "telegram"
#   WHEEL_MODE = "live"
#   WHEEL_CAMPAIGN = "opening-1"
#   ORDER_SIGN_IN = "google"
#   (TELEGRAM_ADMIN_USER_IDS موجود بالفعل)
cd workers/order-worker
npx wrangler deploy --config wrangler.production.local.toml
```

إن نقص أي إعداد أو سر، **يرفض الـ Worker التشغيل** ويطبع السبب (لا يعمل بإعدادات ناقصة).

## الخطوة 5 — Telegram: ربط الأزرار بالـ Worker (أنت)

عنوان الـ Worker = نفس قيمة `VITE_WORKER_URL` في Vercel. في PowerShell (يطلب التوكن والسر دون إظهارهما):

```powershell
$t = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR((Read-Host "Bot token" -AsSecureString)))
$s = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR((Read-Host "TELEGRAM_WEBHOOK_SECRET" -AsSecureString)))
$w = Read-Host "Worker URL (https://...workers.dev)"
Invoke-RestMethod "https://api.telegram.org/bot$t/getWebhookInfo" | ConvertTo-Json      # سجّل الـ url الحالي إن وُجد
Invoke-RestMethod -Method Post "https://api.telegram.org/bot$t/setWebhook" -ContentType 'application/json' -Body (@{ url = "$w/telegram/webhook"; secret_token = $s; allowed_updates = @('callback_query'); drop_pending_updates = $true } | ConvertTo-Json)
Invoke-RestMethod "https://api.telegram.org/bot$t/getWebhookInfo" | ConvertTo-Json      # url صحيح و last_error_message فارغ
```

## الخطوة 6 — الموقع

```bash
git checkout main && git merge --ff-only dev/review-2026-11 && git push origin main   # Vercel يبني وينشر تلقائيًا
```

قبل حفظ الحملة: لا تظهر نافذة الدولاب، وصفحته تعرض «مغلق» (لا حملة = لا لف ولا جوائز).

## الخطوة 7 — الحملة (أنت، في لوحة الإدارة)

لوحة الإدارة ← الدولاب ← «تعبئة الحملة الافتتاحية (50 د.أ، 30 يومًا من الآن)» ← راجع النسب والتكلفة ← **حفظ**. من هذه اللحظة تبدأ الـ 30 يومًا.

## الاختبار الحقيقي (من حسابك، لا طلبات زبائن)

1. نافذة خاصة، بلا حساب: يظهر الدولاب، اللف يعمل، العداد 60 دقيقة.
2. «تأكيد الطلب» ← Google ← Turnstile ← «تأكيد الطلب النهائي»: طلب صغير بالدفع عند الاستلام.
3. تصل رسالة Telegram بزرّي ✅ ❌. اضغط ❌: لا خصم، الحجز يُفك.
4. طلب ثانٍ ← ✅: المخزون ينقص مرة واحدة واللوحة «قيد التجهيز». اضغط ✅ مرة أخرى: لا تغيير. ثم 🚫 وتأكيد: يعود مرة واحدة.
5. لوحة الميزانية: المتاح 50 ناقص المحجوز فقط.

## التراجع (لا يُحذف أي طلب)

| المشكلة | الإجراء |
|---|---|
| الحملة فقط | لوحة الإدارة ← إيقاف الحملة ← حفظ (فوري) |
| واجهة الموقع | Vercel ← Instant Rollback إلى `dpl_DNAuUwBjjLg3N968pHAvKq5pJqrk` |
| الـ Worker | أعد في الملف `STOCK_POLICY="on_delivery"`، `APPROVAL_MODE="off"`، `WHEEL_MODE="off"`، احذف `ORDER_SIGN_IN`، ثم `wrangler deploy` — أو Cloudflare ← Deployments ← Rollback إلى `2ea16078…` (**ليس** `274978a8`) |
| أزرار Telegram | `deleteWebhook` (أو أعد الـ url المسجّل) |
| القواعد | تبقى كما هي (تقبل السياستين)؛ عند الحاجة: Firebase ← Rules ← ruleset `760798d0` |

بعد أي تراجع: الطلبات التي قُبلت بالسياسة الجديدة تكمل بها (الإلغاء يعيد المخزون مرة واحدة)، والقديمة بقواعدها — مختبر (P14).

## قرارات مفتوحة لا تمنع الإطلاق

- هدية 4 وهدية 5 حدّهما الأدنى 5 د.أ (النظام ينبّه ويقترح 15).
- الهدايا مُحتسبة بقيمتها الكاملة في الميزانية.
- خصم الكمية 10% يُجمع مع جائزة الدولاب.
- Worker v1 ما زال يعمل للتبويبات القديمة؛ إيقافه قرار منفصل.
