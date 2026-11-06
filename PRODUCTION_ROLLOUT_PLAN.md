# خطة إطلاق نظام الطلبات — مكتبة دير شرف العلمية

> حالة هذا الملف: **خطة فقط**. لم يُنفَّذ منها شيء على الإنتاج. كل خطوة نشر تحتاج موافقة صريحة مستقلة.
> المراجع: Staging (`dairsharaf-staging` + `anta-order-notify-staging`) اجتاز رحلة شراء كاملة، وحماية
> `PRICE_CHECK_MODE=enforce` و`TURNSTILE_MODE=enforce` منشورة ومختبرة هناك.

---

## 0. الوضع الحالي في الإنتاج (من الكود، دون اتصال بالإنتاج)

| العنصر | الحقيقة | المصدر |
|---|---|---|
| واجهة الإنتاج (فرع `main`) | ترسل الطلب إلى `VITE_WORKER_URL/create-order` **بلا انتظار**، ثم تكتبه بنفسها في Firestore (`db.orders.create`) وتتجاهل أي خطأ | `git show main:src/pages/Checkout.tsx` الأسطر 477–488 |
| صفحة نجاح الطلب القديمة | تقرأ الطلب من Firestore (`getDoc`) | `main:src/pages/OrderSuccess.tsx:195` |
| Worker القديم v1 (`anta-order-notify` على حساب mohmmedmostakl) | يكتب الطلب بحساب الخدمة، ويخصم المخزون، ويرسل Telegram. **لا** مصادقة ولا فحص أسعار ولا Turnstile | `workers/order-worker/worker.v1.production.js` |
| v1 مقابل الواجهة الجديدة | الواجهة الجديدة تحتاج `/orders/:id/status` و`/orders/:id/summary` وعقد v2 (رمز Turnstile، 422 PRICE_CHANGED) — **غير موجودة في v1** | مقارنة المسارات |
| `WORKER_AUTH_TOKEN` في Vercel | يستخدمه فقط `api/create-order.js` (وكيل مفتوح غير مستخدم من الواجهة) — **أُغلق محليًا** (410) | `api/create-order.js` |
| `SENDGRID_API_KEY` في Vercel | يستخدمه `api/notify-customer.js` (رسائل الزبون عند تغيير الأدمن للحالة). **كان مرحِّل بريد مفتوحًا** — أُصلح محليًا (رمز أدمن موثّق + قائمة UIDs) | `api/notify-customer.js` |
| Cloud Functions | غير منشورة (لوحة التحكم). **لا تدخل في أي خطوة**؛ لا تُنشر `functions/` ولا `security/` | — |

**القرار:** Worker **v2 جديد باسم جديد** على حساب الإنتاج. Worker القديم يبقى كما هو (يخدم التبويبات المفتوحة
قبل التحديث) ثم يُتقاعد بموافقة منفصلة. لا يمكن الإبقاء على العنوان نفسه دون كسر التبويبات القديمة: v2 بـTurnstile
enforce يرفض طلباتها (لا رمز لديها)، وعندها يعتمد حفظ طلبها على كتابة المتصفح المباشرة التي يجب إغلاقها.

---

## 1. الإعدادات والأسرار الناقصة (أسماء فقط — لا تُكتب قيمها في المحادثة)

**Cloudflare (Worker الإنتاج v2، الملف `workers/order-worker/wrangler.production.toml`):**
- `name` — الاسم الجديد (مقترح: `anta-order-v2`) · `account_id` — حساب الإنتاج (32 hex)
- متغيرات: `TELEGRAM_CHAT_ID` · `ADMIN_EMAIL` · `EMAIL_FROM` (مرسل موثّق في SendGrid)
- أسرار (`wrangler secret put … --config wrangler.production.toml`): `FIREBASE_CLIENT_EMAIL` · `FIREBASE_PRIVATE_KEY`
  (حساب خدمة لمشروع `antastore1-82b50` بصلاحية Firestore فقط) · `TURNSTILE_SECRET` (الحقيقي) · `TELEGRAM_BOT_TOKEN`
  · `SENDGRID_API_KEY` · `WORKER_AUTH_TOKEN` (قيمة عشوائية جديدة)
- فحص الجاهزية: `node workers/order-worker/production/check-config.mjs` يجب أن يطبع `OK`.

**Vercel (مشروع global-store-oz2a، Production):**
- `VITE_WORKER_URL` ← عنوان v2 الجديد (يُغيَّر في خطوة النشر فقط)
- `VITE_TURNSTILE_SITE_KEY` ← موجود (حقيقي). تأكد أن hostnames الأداة في Cloudflare تشمل `dairsharaf.com` و`www.dairsharaf.com`
- `NOTIFY_ADMIN_UIDS` ← **جديد**: UIDs الأدمن مفصولة بفواصل (ليس سرًا). بدونه تتوقف رسائل الزبائن (فشل آمن 503)
- `SENDGRID_API_KEY` ← موجود · `WORKER_AUTH_TOKEN` ← يُحذف بعد تقاعد v1 (لم يعد مستخدمًا)
- ممنوع أي `VITE_*` يحمل سرًا: البناء يرفض الآن الأسماء المشبوهة (`…TOKEN/SECRET/PRIVATE/GEMINI/SENDGRID…`).

**Firebase (antastore1-82b50):** لا أسرار جديدة. تحقّق (قراءة فقط) من وجود `config/roles` (ownerUid) ومستندات `admins/*`.

---

## 2. التأكد من الحساب الصحيح لكل خدمة (قبل أي أمر كتابة)

| الخدمة | الأمر (قراءة) | المطلوب |
|---|---|---|
| Cloudflare | `wrangler whoami` (مع `CLOUDFLARE_ACCOUNT_ID` مثبّت) | حساب الإنتاج وحده، وليس حساب Staging (hopemohmmed) |
| Firebase | `firebase projects:list --account <حساب الإنتاج>` | يرى `antastore1-82b50`. كل أمر يحمل `--project antastore1-82b50 --account …` صراحة |
| Vercel | `vercel whoami` + `vercel env ls production` في مجلد مربوط بـglobal-store-oz2a | المشروع الصحيح، وأسماء المتغيرات المتوقعة |

⚠️ لا تشغّل `firebase deploy` من جذر المستودع: `firebase.json` الجذري يحوي **hosting + functions** و`.firebaserc`
الافتراضي هو **الإنتاج**. استخدم دائمًا مجلدًا مؤقتًا أو `--only firestore:rules` / `--only firestore:indexes` مع `--project` صريح.

---

## 3. خطوات الإطلاق بالترتيب (كل خطوة: موافقة → فحوص → تنفيذ → تحقق)

| # | الخطوة | فحوص قبلها | تحقق بعدها |
|---|---|---|---|
| P0 | **قراءة فقط:** القواعد المنشورة حاليًا = `firebase/firestore.rules.prod-snapshot`؟ الفهارس الموجودة؟ `config/roles` و`admins`؟ | حسابات §2 | تطابق حرفي للقواعد (هي خطة الرجوع)؛ وإلا حدّث النسخة المحلية أولًا |
| P1 | نشر الفهرسين (`firebase/firestore.indexes.json`) على الإنتاج | §2 | حالة **READY** (قد تستغرق 15+ دقيقة) |
| P2 | إنشاء Worker v2 بالاسم الجديد + الأسرار + النشر | `check-config.mjs` = OK · whoami | §4 (اختبارات بلا طلب) |
| P3 | Vercel: `VITE_WORKER_URL` ← v2، `NOTIFY_ADMIN_UIDS` ← القائمة؛ دمج الفرع ونشر الواجهة (**commit/push بموافقة**) | البناء ينجح محليًا معزولًا · لا أسرار في الحزمة | الصفحة تعمل، أداة Turnstile تظهر في الدفع، لا أخطاء |
| P4 | **أول طلب حقيقي مُعتمد** (طلب واحد من صاحب المتجر، منتج رخيص، عند الاستلام) مع مراقبة | P2–P3 ناجحة | §5 |
| P5 | قواعد Firestore: `prod-snapshot` → **`final` مباشرة** (بلا transition) | P4 ناجح · admin يعمل | الواجهة تقرأ المنتجات؛ الإنشاء المباشر مرفوض؛ لوحة الأدمن تعمل |
| P6 | بعد ≥ 24 ساعة بلا حركة على v1 (مراقبة قراءة): تقاعد v1 + حذف `WORKER_AUTH_TOKEN` من Vercel | لا طلبات حديثة عبر v1 | v1 لا يقبل `create-order` |
| P7 | تنظيف `userEmail` من التقييمات القديمة | نسخة احتياطية | العدّ = 0 |

**لماذا `final` مباشرة وليس `transition`؟** `transition` يُبقي إنشاء الطلبات للضيوف مفتوحًا (مع فحص الشكل) لأجل
التبويبات القديمة. لكن التبويبات القديمة تُحفظ طلباتها عبر **v1 بحساب الخدمة** (لا يتأثر بالقواعد)، وكتابتها المباشرة
يُتجاهل فشلها أصلًا في الكود القديم. إذن الإغلاق الفوري آمن **بشرط أن يبقى v1 حيًا** حتى P6. نتيجة: ثغرة الإنشاء المباشر
تُغلق في نفس يوم الإطلاق، لا بعد يومين. الأثر الوحيد على التبويبات القديمة: صفحة النجاح القديمة لا تقرأ تفاصيل الطلب
من Firestore (الطلب نفسه محفوظ).

**الطلبات والحسابات السابقة:** القواعد لا تعدّل البيانات. `final` يسمح للزبون بقائمة طلباته (`userId == uid`، والفهرس
موجود من P1) وللأدمن بكل الطلبات وتغيير الحالة؛ الأدمن مُعرّف بنفس آلية القواعد الحالية (`config/roles` + `admins`).
ما يتوقف عمدًا: قراءة الطلب برقمه للضيف (أصبحت عبر Worker)، والقراءة بمطابقة البريد.

---

## 4. اختبار الإنتاج دون طلب حقيقي غير مصرّح به (بعد P2)

- `GET /` → 200 `{service:"order-worker"}` (لو `CONFIG_ERROR` فهناك قيمة ناقصة/خاطئة — لا تكمل)
- `GET /orders/ORD-1/status` → 400 `INVALID_ID` (لا يلمس Firestore)
- `OPTIONS /create-order` من `Origin: https://dairsharaf.com` → يمنح CORS؛ ومن أي أصل آخر → لا يمنح
- `POST /create-order` بجسم `{}` بلا رمز Turnstile → **403 `TURNSTILE_FAILED`** (يُرفض قبل أي قراءة/كتابة)
- `wrangler versions view <id>` → `PRICE_CHECK_MODE=enforce` و`TURNSTILE_MODE=enforce` و`ENVIRONMENT=production`
- لا اختبار بطلب كامل إلا P4 المعتمد.

## 5. مراقبة أول طلب حقيقي (P4)

- `wrangler tail <worker v2> --format pretty` طوال التجربة (السجلات بلا بيانات شخصية: معرّفات ورموز فقط)
- توقّع: `order.committed` ← `notify telegram ok` ← `notify email ok`؛ أي `order.price_rejected` أو `TURNSTILE_FAILED` = توقف
- Firestore (قراءة): `orders/{id}` + `orderLedger/{id}` (priceMismatch=false، warnings=[])، المخزون −الكمية مرة واحدة
- استلام Telegram والبريد الحقيقيين للإدارة؛ صفحة النجاح تعرض الرقم
- ملاحظة: خطأ 404 في الإشعار الفوري ظهر في Staging فقط (Worker → Worker على نفس النطاق)؛ في الإنتاج الوجهات خارجية.

## 6. خطة الرجوع (لا حذف لأي طلب أبدًا)

| الفشل | الإجراء | حماية الطلبات |
|---|---|---|
| Worker v2 (P2/P4) | Vercel **Instant Rollback** إلى النشر السابق (يعيد الواجهة القديمة → v1) وإرجاع `VITE_WORKER_URL` إلى v1 | ما حفظه v2 يبقى (orders + ledger). لا تحذف v2، فقط أوقف إحالة الواجهة إليه |
| الواجهة (P3) | Instant Rollback في Vercel | الواجهة القديمة تعمل مع v1 والقواعد الحالية (P5 لم يُنفذ بعد) |
| القواعد (P5) | إعادة نشر `firebase/firestore.rules.prod-snapshot` (المطابقة المؤكدة في P0) | القواعد لا تمس البيانات |
| بعد P5 مع رجوع الواجهة | يجب إرجاع القواعد إلى prod-snapshot **قبل/مع** رجوع الواجهة (القديمة تكتب مباشرة) | v1 يحفظ الطلبات بحساب الخدمة في الحالتين |

الطلبات المعلّقة في متصفح الزبون (نتيجة غير مؤكدة) محفوظة محليًا برقمها ويُعاد التحقق منها بنفس الرقم — لا تكرار.

## 7. ما يحتاج موافقة مستقلة

P1 فهارس الإنتاج · P2 إنشاء Worker v2 ورفع أسراره · P3 تعديل متغيرات Vercel + commit/push/merge · P4 الطلب الحقيقي الأول
· P5 قواعد الإنتاج · P6 تقاعد v1 وحذف متغير Vercel · P7 تنظيف بيانات التقييمات · أي تغيير في خطة Firebase (Blaze).

## 8. ممنوع تشغيله أو حذفه

- لا حذف لـWorker v1 قبل P6، ولا حذف لـ`orders` أو `orderLedger` أو بيانات زبائن.
- لا `firebase deploy` من الجذر، ولا نشر `functions/` أو `security/`.
- لا `staging/seed.mjs` ولا `--reset` ولا أدوات Staging (`proxy.mjs`, `--test-turnstile`) مع الإنتاج — هي محمية بحارس Staging.
- لا مفاتيح Turnstile اختبارية ولا `STAGING_ACCESS_TOKEN` في الإنتاج (الكود يرفضها).
- لا `PRICE_CHECK_MODE`/`TURNSTILE_MODE` غير `enforce` (الكود يرفض).
- لا commit/push دون موافقة (Vercel ينشر تلقائيًا).

## 9. معايير Go / No-Go

**Go** فقط إذا تحقق كل ما يلي:
1. `check-config.mjs` = OK، و`wrangler whoami` = حساب الإنتاج، و§4 كلها كما هو متوقع.
2. الفهرسان READY على الإنتاج.
3. P0: القواعد الحية مطابقة لـprod-snapshot (أو حُدّثت)، و`config/roles` + `admins` موجودة.
4. بناء الواجهة المعزول بلا أسرار، وأداة Turnstile تظهر بالمفتاح الحقيقي على `dairsharaf.com`.
5. `NOTIFY_ADMIN_UIDS` مضبوط (وإلا تتوقف رسائل الزبائن — مقبول مؤقتًا لكن يجب أن يكون قرارًا).
6. P4: الطلب الحقيقي الأول = نجاح كامل (طلب + سجل + مخزون مرة واحدة + Telegram + بريد).

**No-Go** عند أي من: `CONFIG_ERROR`، حساب غير مؤكد، فهرس غير READY، أي `price_rejected`/`TURNSTILE_FAILED` غير متوقع
في P4، تكرار طلب أو خصم، ظهور سر في الحزمة، أو تعذّر الرجوع (لا نسخة مطابقة من القواعد الحالية).

---

## ملحق: خطة تنظيف `userEmail` من التقييمات القديمة (P7)

1. سكربت Admin SDK بحساب خدمة الإنتاج، **وضع تجريبي افتراضي**: يعدّ التقييمات التي تحوي `userEmail` ويطبع الأرقام فقط.
2. نسخة احتياطية: تصدير مجموعة `reviews` (Firestore export أو سكربت قراءة إلى ملف محمي خارج المستودع).
3. تنفيذ على Staging أولًا (بيانات اصطناعية)، ثم الإنتاج بموافقة: `update(userEmail: delete)` على دفعات ≤ 400.
4. تحقق: العدّ = 0؛ عرض التقييمات لم يتغير. القواعد الجديدة تمنع إعادة إدخال الحقل.

## ملحق: بعد الإطلاق (غير مانع للطلبات)

- متوسط التقييم: لا يتحدث من المتصفح تحت `final` (يبقى آخر رقم). الحل: إعادة حساب في Cron الـWorker (بلا Blaze).
- شرط الشراء قبل التقييم: فحص في المتصفح فقط — يُنقل للخادم لاحقًا. لا يمس الطلبات أو الأموال.
- `likesBy` (معرّفات Firebase عامة): نقل الإعجابات لمجموعة فرعية خاصة.
