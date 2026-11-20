# خطة النشر — الجولة الثانية (فرع `dev/review-2026-11`) — للمراجعة فقط

> **لم يُنفَّذ أي أمر من هذه الخطة.** كل خطوة إنتاج تحتاج موافقة صريحة منفصلة من المالك.
> هذه الخطة تكمّل `docs/RELEASE-PLAN.md` (النسخ الاحتياطي، والتحقق بعد النشر، وقواعد التراجع الذهبية فيها ما زالت سارية).

## 1. ما يدخل الإنتاج في هذا الإصدار، وما يبقى مغلقًا

| يدخل | يبقى مغلقًا |
|---|---|
| تسجيل Google عند «تأكيد الطلب» في الموقع، ثم Turnstile، ثم «تأكيد الطلب النهائي» (إرسال واحد) | **دولاب الحظ بالكامل**: الـ Worker في الإنتاج يرفض `WHEEL_MODE` غير `off` (في الكود)، وبناء الموقع للإنتاج لا يحتوي كود الدولاب |
| مسارات الـ Worker الجديدة (لف الزائر، الربط، الميزانية…) — كلها ترجع 404 ما دام `WHEEL_MODE=off` | `ORDER_SIGN_IN=google` على الـ Worker: يُفعَّل **بعد** نشر الموقع والتحقق من دخول Google الحقيقي |
| إصلاحات العرض (نص «لا توجد صورة»، «متوسط قيمة الطلب») | `APPROVAL_MODE=telegram`: **ممنوع في الإنتاج بالكود**، وغير متوافق مع `STOCK_POLICY=on_delivery` (البند 5) |

## 2. شروط قبل البدء

1. موافقة المالك على هذه الخطة ونافذة زمنية هادئة.
2. التحقق (قراءة فقط) في Firebase Console: Google provider مفعّل، و`dairsharaf.com` و`www.dairsharaf.com` ضمن Authorized domains.
3. التحقق أن مفتاح Turnstile العام للموقع (`VITE_TURNSTILE_SITE_KEY`) هو المستخدم حاليًا، وأن السر في الـ Worker دون تغيير (`TURNSTILE_MODE=enforce` في الإنتاج).
4. اختبار Google وTurnstile الحقيقي على **نسخة معاينة** أولًا (البند 4) — المحاكاة المحلية لا تثبت التكامل الحقيقي.

## 3. أوامر النشر (للمراجعة فقط — لا تُنفَّذ دون موافقة)

```bash
# 0) قراءة فقط: نقاط التراجع الحالية
cd workers/order-worker
npx wrangler deployments list --name anta-order-v2          # سجّل الإصدار الحالي (2ea16078 حسب السجل)
vercel ls dairsharaf --prod                                  # سجّل رقم نشر الموقع الحالي
node ../../tools/firestore-backup/...                        # النسخة الاحتياطية المشفّرة الموجودة (run-verify.ps1 للتحقق)

# 1) الدمج (بعد الموافقة فقط)
git checkout main
git merge --ff-only dev/review-2026-11
git push origin main

# 2) الـ Worker أولًا (WHEEL_MODE غير معرّف = off؛ ORDER_SIGN_IN غير معرّف = off)
cd workers/order-worker
npx wrangler deploy --config wrangler.production.local.toml
curl -s https://<worker-host>/            # الإصدار الجديد
curl -s -o /dev/null -w "%{http_code}" https://<worker-host>/wheel/public   # 404 متوقع

# 3) الموقع (Vercel، كما في النشر السابق)
npm run build:hosting && npm run check:guard
vercel deploy --prebuilt --prod

# 4) القواعد النهائية (إن لم تُنشر في الجولة السابقة) — كما في RELEASE-PLAN.md البند 4

# 5) بعد التحقق من دخول Google الحقيقي وطلب حقيقي صغير:
npx wrangler secret list --config wrangler.production.local.toml   # قراءة فقط
# تعديل ORDER_SIGN_IN=google في wrangler.production.local.toml ثم:
npx wrangler deploy --config wrangler.production.local.toml
```

## 4. اختبار Google وTurnstile الحقيقي (يحتاج موافقتك — خارجي لكنه آمن)

| الخطوة | ما يلزم | لماذا آمن |
|---|---|---|
| نشر **معاينة** للموقع (Vercel Preview أو Cloudflare Pages المشروع التجريبي) ببناء غير إنتاجي يشير إلى Staging Worker | موافقتك، وإضافة نطاق المعاينة إلى Authorized domains في Firebase **مؤقتًا** | لا يمس الموقع الحقيقي ولا الطلبات الحقيقية؛ Staging Worker محمي بـ `x-staging-access` |
| دخول Google حقيقي من الهاتف والكمبيوتر: نجاح، إغلاق النافذة، منع النوافذ المنبثقة، الرجوع عبر صفحة Google | حساب Google تجريبي | لا يُنشئ طلبًا: الضغطة الأولى لا ترسل |
| Turnstile حقيقي: ظهور الودجت بعد الدخول، رمز واحد لكل إرسال | مفتاح Turnstile تجريبي (يمكن استخدام مفاتيح Cloudflare الاختبارية `1x000…` أولًا ثم الحقيقية) | التحقق على Staging Worker |
| بعد النشر: طلب حقيقي صغير واحد بالدفع عند الاستلام من حساب المالك، ثم إلغاؤه من اللوحة | — | كما في RELEASE-PLAN.md البند 5.3 |

## 5. القبول عبر Telegram أو تلقائيًا (`STOCK_POLICY=on_acceptance`) — جاهز محليًا، غير مفعّل

**ما تغيّر:** أُضيفت سياسة مخزون جديدة `on_acceptance` تجمع بين القبول (فرع `feat/telegram-order-approval`، موجود كاملًا في هذا الفرع) والقبول التلقائي (3 commits من `feat/auto-approval` نُقلت بـ cherry-pick) والدولاب:

| المرحلة | أثر المخزون |
|---|---|
| إنشاء الطلب | **حجز** الكمية (كما في `on_delivery`)؛ آخر قطعة لا تُباع مرتين |
| قبول من Telegram أو تلقائي | **خصم مرة واحدة** وفكّ الحجز، الحالة `processing` |
| رفض من Telegram، أو إلغاء من اللوحة قبل القبول | فكّ الحجز فقط |
| إلغاء بعد القبول وقبل التسليم | **إرجاع مرة واحدة** (`deducted` → `restocked`) |
| تسليم | لا خصم إضافي؛ يُسجَّل وقت التسليم فقط (لخصم الطلب الثاني والدولاب) |
| إرجاع بعد التسليم | فقط بـ «تأكيد الإرجاع» كما هو اليوم |

اللوحة لا تستطيع نقل طلب «بانتظار القبول» إلى أي حالة غير الإلغاء (رسالة `APPROVAL_PENDING`). القواعد (`workerManaged`) تحمي هذه الطلبات من الكتابة المباشرة كما تحمي طلبات `on_delivery`.

**الإنتاج الحالي لم يتغيّر:** القالب ما زال `STOCK_POLICY=on_delivery` و`APPROVAL_MODE=off`. قفل الإنتاج في `config.js` يقبل الآن تركيبتين فقط: `on_delivery + off` أو `on_acceptance + telegram`، وأي تركيبة أخرى تمنع تشغيل الـ Worker.

**للتفعيل لاحقًا (يحتاج موافقتك، لا يُنفَّذ الآن):**
1. نشر القواعد المحدَّثة أولًا (`workerManaged` تشمل `on_acceptance`)؛ بدونها تستطيع اللوحة كتابة الحالة مباشرة.
2. في `wrangler.production.local.toml`: `STOCK_POLICY=on_acceptance`، `APPROVAL_MODE=telegram`، `TELEGRAM_ADMIN_USER_IDS`، وأسرار `TELEGRAM_WEBHOOK_SECRET` و`AUTO_APPROVAL_HASH_SECRET` عبر `wrangler secret put`؛ ثم ضبط webhook البوت الحقيقي (`setWebhook` مع `secret_token`).
3. القبول التلقائي يبقى مغلقًا حتى يُفتح القفل في الخادم (`AUTO_APPROVAL_MODE`) **و**المفتاح في اللوحة (`config/autoApproval.enabled`) — راجع `workers/order-worker/AUTO_APPROVAL.md`.
4. الطلبات القديمة (`on_delivery`) تكمل بقواعدها القديمة؛ لا ترحيل للبيانات.
5. التراجع: إعادة `STOCK_POLICY=on_delivery` و`APPROVAL_MODE=off` ثم `wrangler deploy`؛ الطلبات المنشأة بـ `on_acceptance` تبقى تُدار بسياستها المسجّلة في سجل الطلب.

**لم يُختبر:** بوت Telegram حقيقي (المحاكاة المحلية لا تثبت التكامل الحقيقي؛ اختبار `approval-live` يحتاج بوتًا تجريبيًا وموافقتك)، ولا Google/Turnstile الحقيقيان.

## 6. التراجع

| ما يُرجَع | الأمر | الأثر |
|---|---|---|
| `ORDER_SIGN_IN` | إزالة السطر (أو `off`) ثم `wrangler deploy` | الضيوف يعودون للطلب؛ لا أثر على الطلبات المحفوظة |
| الموقع | Vercel → Promote للنشر السابق | لا أثر؛ الطلبات عبر الـ Worker نفسه |
| الـ Worker | `npx wrangler rollback <المعرّف الكامل للإصدار السابق>` — **ليس** `274978a8` | السجل بالشكل نفسه؛ الحقول الجديدة (`wheel`…) لا تُكتب أصلًا ما دام الدولاب مغلقًا. يُرجَع الموقع **قبل** الـ Worker |

## 7. قبل أي تشغيل للدولاب في الإنتاج (مرحلة لاحقة منفصلة)

1. قرار المالك: الجوائز، **التكاليف الفعلية المؤكدة** (الساعة، اللعبة، النثريات، قيم الهدايا)، الأوزان لكل فئة، الكميات، الميزانية القصوى، الرصيد الافتتاحي.
2. تعديل الكود الذي يرفض `WHEEL_MODE` في الإنتاج (بمراجعة منفصلة)، وإضافة `WHEEL_CAMPAIGN` و`WHEEL_PHONE_SECRET` (سر عشوائي عبر `wrangler secret put`) و`VITE_WHEEL_MODE`.
3. تجربة على Staging مع طلبات تجريبية، ومراقبة لوحة الميزانية.
