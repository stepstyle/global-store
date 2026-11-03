# بيئة Staging — المرحلة S0 (محلي فقط)

> ⛔ **لم يُنشأ أي مورد سحابي ولم يُنشر شيء.** هذه الملفات تُستخدم في المراحل S1–S3 بعد موافقة صريحة.
> لا توجد إعدادات إنتاج في المستودع؛ لا يوجد سكربت deploy للإنتاج.

## طبقات الحماية

| الطبقة | المكان | ما تمنعه |
|---|---|---|
| **هدف البناء مثبّت وقت البناء** | `[define] __DEPLOY_TARGET__` في `wrangler*.toml` + `src/config.js` | تغيير `ENVIRONMENT` وحده لا يحوّل نسخة local/staging إلى production (مختبَر) |
| حواجز الإعداد في الـ Worker | `src/config.js` | staging: مشروع `*-staging` فقط، حساب خدمة **من نفس المشروع**، عناوين Google الرسمية، الإشعارات للمستقبِل الوهمي فقط، مفاتيح Turnstile التجريبية فقط، ممنوع أصل `dairsharaf.com`. production: `antastore1-82b50` فقط، حساب خدمة منه، عناوين رسمية، لا مستقبِل وهمي، لا مفتاح Turnstile تجريبي |
| حارس السكربتات | `staging/guard.mjs` | يرفض قبل أي طلب: معرّفات الإنتاج في أي حقل (المشروع، apiKey/appId المقروءة من `src/services/firebase.ts` محليًا، `dairsharaf.com`)، عناوين Worker/مستقبِل غير مطابقة أو مشابهة، مفتاح خدمة داخل المستودع أو لمشروع آخر، `GOOGLE_APPLICATION_CREDENTIALS`/`GCLOUD_PROJECT`… لمشروع آخر |
| fetch محروس | `guardedFetch()` | يسمح فقط بـ: Worker Staging، المستقبِل، `oauth2.googleapis.com`، ومسارات Firestore **لمشروع Staging فقط** |
| ملفات wrangler | `assertWranglerFile()` | الاسم `-staging`، هدف البناء `staging`، مشروع Staging، لا `REPLACE_WITH_`، لا `[env.*]`، لا معرّف إنتاج |
| النشر | `deploy-*.mjs` | خطة فقط افتراضيًا؛ dry-run دائمًا أولًا؛ التنفيذ يتطلب `--execute --confirm <الاسم الحرفي>` |
| علامة المشروع | `seed.mjs` → `stagingMarker/marker` | `run-tests.mjs` يتوقف إن لم يجد العلامة في المشروع المستهدف |
| المستقبِل الوهمي | `workers/notify-sink` | لا يرسل لأي جهة؛ الكتابة بتوكن، القراءة بتوكن؛ يخزّن **ملخصًا فقط** (رقم الطلب، الطول، sha256، علامة الفرق، رموز التحذير، المجاميع) — لا أسماء/هواتف/عناوين/إيميلات/توكنات؛ ينتهي بعد 7 أيام |

## الملفات

| الملف | الغرض |
|---|---|
| `../wrangler.staging.toml` | Worker الطلبات للـ Staging (فيه `REPLACE_WITH_WORKERS_SUBDOMAIN`) |
| `../../notify-sink/` | المستقبِل الوهمي + `wrangler.toml` (فيه `REPLACE_WITH_KV_NAMESPACE_ID`) + اختباراته |
| `guard.mjs`, `common.mjs` | الحارس والمساعدات |
| `seed.mjs` | منتجات وهمية + علامة Staging (`--reset` يحذف طلبات/سجلات Staging) |
| `run-tests.mjs` | S01–S12 على خدمات حقيقية لمشروع Staging |
| `deploy-rules.mjs` | قواعد compat → مشروع Staging فقط |
| `deploy-workers.mjs` | نشر المستقبِل / Worker Staging |
| `staging.config.example.json` | قالب؛ النسخة المعبّأة `staging.config.json` مستثناة من git |

## اختبارات S0 (2026-11-03) — كلها محلية

| المجموعة | النتيجة |
|---|---|
| وحدات Worker (منها 33 لأهداف البناء وحواجز staging/production) | **100/100** |
| حواجز سكربتات Staging | **30/30** |
| المستقبِل الوهمي | **10/10** |
| تكامل (محاكي) | **84/84** |
| workerd (`wrangler dev` محلي) | **3/3** |
| قواعد Firestore | **228/228** |
| `wrangler deploy --dry-run` لـ local وstaging والمستقبِل | ✅ بلا رفع وبلا بيانات اعتماد؛ الحزمة تحتوي `String("staging")` / `String("local")` |

## المراحل التالية (تحتاج موافقة لكل منها)

- **S1 (أنت):** مشروع `dairsharaf-staging` (Spark)، Firestore، Web App، حساب خدمة بدور *Cloud Datastore User* على Staging فقط، مفتاح JSON خارج المستودع.
- **S2:** `wrangler login` (أنت) ← KV ← تعبئة `REPLACE_WITH_*` ← `deploy-workers.mjs --which sink` ← أسرار المستقبِل ← `--which order` ← أسرار Worker (أنت تُدخل المفتاح) ← `deploy-rules.mjs`.
- **S3:** `seed.mjs --reset` ← `run-tests.mjs`.
