# تقدّم التطوير — فرع `dev/review-2026-11`

> فرع محلي فقط. **لا Push ولا Merge ولا Deploy.** الإنتاج = `origin/main` 1ea8a1c.
> فروع الطوارئ المستقلة: `hotfix/cliq-details` (8f92911)، و`hotfix/cliq-and-cookie` (80f095f).

## أوامر الاختبار (كلها محلية: Emulators، Worker محلي، Chrome headless)

| الاختبار | الأمر |
|---|---|
| وحدات الموقع | `node --test tests/unit/*.test.mjs` |
| وحدات الـ Worker | `cd workers/order-worker && node --test test/unit/*.test.mjs` |
| تكامل العجلة (W01–W16) | `cd workers/order-worker && firebase emulators:exec --only firestore --project demo-dairsharaf-orders "node --test --test-concurrency=1 test/wheel.test.mjs"` (منفذ حر) |
| تكامل الربط والتقييمات | `cd workers/order-worker && firebase emulators:exec --only firestore --project demo-dairsharaf-orders "node --test --test-concurrency=1 test/claims-ratings.test.mjs"` (منفذ حر) |
| قواعد Firestore (الحالية مقابل النهائية) | `cd firebase/rules-test && firebase emulators:exec --only firestore --project demo-dairsharaf-rules "node --test orders-final.test.mjs"` (منفذ حر، مشروع لكل مجموعة قواعد) |
| E2E | `cd workers/order-worker && E2E_SUITE=ui\|delivery E2E_RULES=on-delivery-final node test/local-e2e/run.mjs` (إذا كان المنفذ 9152 مشغولًا: `E2E_EMULATOR_WS_PORT=9352`) |
| الحماية والبناء | `node tests/deploy-guard/guard.test.mjs`، `CHROME_PATH=… node tests/deploy-guard/build-browser.test.mjs` |

## المراحل

| # | المرحلة | الحالة | Commit |
|---|---|---|---|
| 0 | التواصل وCliQ، الكوكيز وزر التأكيد (U12/U34)، قواعد الطلبات النهائية، الوضع الفاتح | ✅ | 82e56af … a9acf01 |
| A | الأمان: التقييمات يحسبها الـ Worker، مراجعة واحدة لكل زبون ومنتج، منع منح الدور ذاتيًا، AdminGuard لا يثق بـ role، مسار ربط الطلب في الـ Worker | ✅ | انظر git log |
| B | «طلباتي» للضيف عبر مفاتيح التتبع، والبحث برقم الطلب والرمز، وربط الطلب بالحساب (مفتاح التتبع + آخر 4 أرقام من الهاتف) | ✅ | d202069 |
| C | الأسعار والخصومات الحقيقية فقط، والنفاد حسب مخزون الخيارات، وصور WebP/JPG، وبطاقات الأقسام بلا تداخل، وزر المساعد على الجوال، وقائمة بيانات الأسعار للمالك | ✅ | ae5d352 |
| D | عجلة الجوائز: تجريبية، مغلقة افتراضيًا، ممنوعة في الإنتاج (انظر docs/wheel-test.md) | ✅ (تجريبي) | انظر git log |

## نتائج آخر تشغيل كامل للإصدار (HEAD ea986e5، وبعده إصلاح صفحة العجلة)

| المجموعة | النتيجة |
|---|---|
| وحدات الموقع / الـ Worker / الـ Sink | 309 / 178 / 13 — PASS |
| تكامل العجلة، والطلبات، والتسليم، والربط والتقييمات، وTelegram | 29 / 135 / 23 / 12 / 18 — PASS |
| قواعد Firestore (الحالية والنهائية) | 78 — PASS |
| guard / build-browser | 11/11، و22/22 (X12 فشل مرة واحدة بالتزامن مع Chrome آخر، ونجح منفردًا مرتين) |
| E2E الواجهة تحت القواعد النهائية / الحالية | 36/36 / 36/36 — PASS، والعزل 0 |
| E2E التسليم تحت القواعد النهائية / الحالية | 13/13 / 13/13 — PASS، والعزل 0 |
| E2E العجلة (WU01–WU04 في تشغيل واحد) | 4/4 — PASS، والعزل 0 |

## ما بقي (بالترتيب) — ابدأ من البند 1

1. قرارات المالك: موافقة على `docs/RELEASE-PLAN.md`، وتحويل CliQ تجريبي، ونافذة النشر.
2. التحقق بعد النشر، كما في الخطة، بما فيه **دخول Google الحقيقي** (لم يُختبر محليًا).
3. عجلة الجوائز: القرارات القانونية والمالية (`docs/wheel-test.md`)، ثم Staging.

## ملاحظات تشغيل

- قد يحجز محاكي Firestore آخر (ليس من هذه الجلسة) المنفذ 9152: استخدم `E2E_EMULATOR_WS_PORT=9352`.
- رصد مراقب العزل مرة واحدة محاولة اتصال من Chrome headless إلى عنوان Microsoft (SynSent، دون اتصال فعلي)، ولم تتكرر في 3 تشغيلات لاحقة. التفسير الأرجح، **وهو غير مؤكَّد**: خدمة تحديث شهادات Windows (CryptoAPI) داخل عملية Chrome، فهي لا تمر بقواعد DNS والبروكسي الخاصة بـ Chrome. المراقب لم يُعطَّل.
