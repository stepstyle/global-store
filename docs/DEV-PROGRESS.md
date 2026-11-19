# تقدّم التطوير — فرع `dev/review-2026-11`

> فرع محلي فقط. **لا Push ولا Merge ولا Deploy.** الإنتاج = `origin/main` 1ea8a1c.
> فروع الطوارئ المستقلة: `hotfix/cliq-details` (8f92911)، و`hotfix/cliq-and-cookie` (80f095f).

## أوامر الاختبار (كلها محلية: Emulators، Worker محلي، Chrome headless)

| الاختبار | الأمر |
|---|---|
| وحدات الموقع | `node --test tests/unit/*.test.mjs` |
| وحدات الـ Worker | `cd workers/order-worker && node --test test/unit/*.test.mjs` |
| تكامل الربط والتقييمات | `cd workers/order-worker && firebase emulators:exec --only firestore --project demo-dairsharaf-orders "node --test --test-concurrency=1 test/claims-ratings.test.mjs"` (منفذ حر) |
| قواعد Firestore (الحالية مقابل النهائية) | `cd firebase/rules-test && firebase emulators:exec --only firestore --project demo-dairsharaf-rules "node --test orders-final.test.mjs"` (منفذ حر، مشروع لكل مجموعة قواعد) |
| E2E | `cd workers/order-worker && E2E_SUITE=ui\|delivery E2E_RULES=on-delivery-final node test/local-e2e/run.mjs` |
| الحماية والبناء | `node tests/deploy-guard/guard.test.mjs`، `CHROME_PATH=… node tests/deploy-guard/build-browser.test.mjs` |

## المراحل

| # | المرحلة | الحالة | Commit |
|---|---|---|---|
| 0 | التواصل وCliQ، الكوكيز وزر التأكيد (U12/U34)، قواعد الطلبات النهائية، الوضع الفاتح | ✅ | 82e56af … a9acf01 |
| A | الأمان: التقييمات يحسبها الـ Worker، مراجعة واحدة لكل زبون ومنتج، منع منح الدور ذاتيًا، AdminGuard لا يثق بـ role، مسار ربط الطلب في الـ Worker | ✅ | انظر git log |
| B | «طلباتي» للضيف + ربط الطلب بحساب Google (واجهة) | ⏳ | |
| C | التصميم: الصور، الأقسام، المساعد، الخصومات، السلة | ⏳ | |
| D | دولاب الحظ (OFF، محلي) | ⏳ | |
