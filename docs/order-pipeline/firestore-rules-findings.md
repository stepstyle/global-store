# ثغرات قواعد Firestore الحالية — توثيق وعلاج مقترح (بدون تغيير القواعد الآن)

- **المصدر:** نسخة القواعد المحلية [`firebase/firestore.rules.prod-snapshot`](../../firebase/firestore.rules.prod-snapshot)
  (commit `b1e3368`، لم تُسحب من Firebase مجددًا).
- **الإثبات:** [`tools/dev-emulator.rules.test.mjs`](../../tools/dev-emulator.rules.test.mjs) — Firebase JS SDK حقيقي،
  مستخدمون وهميون من Auth Emulator، مشروع `demo-dairsharaf-dev`، `127.0.0.1` فقط. الحالات المعلّمة
  **CURRENT WEAKNESS** تنجح لأن القواعد تسمح بها اليوم (توثيق، لا موافقة).
- **الحالة:** لم تُعدَّل القواعد، ولا Checkout، ولا OrderSuccess، ولا AdminGuard، ولا Worker v2.

| # | الثغرة | الخطورة | الحالة في الاختبار |
|---|---|---|---|
| W1 | أي عميل (حتى الضيف) ينشئ طلبًا بـ`userId` لعميل آخر | متوسطة | حالة 5 |
| W2 | أي شخص يعرف رقم الطلب يقرأه كاملًا (الاسم، الهاتف، العنوان، الإيميل، مرجع CliQ) | **عالية (بيانات شخصية)** | حالة 6 |
| W3 | المستخدم يكتب حقل `role` في `users/{uid}` لنفسه، و`AdminGuard.tsx` يثق به | منخفضة على البيانات / متوسطة على الواجهة | حالة 13 |

---

## W1 — انتحال `userId` عند إنشاء الطلب

**القاعدة:** `allow create: if true && !exists(...) && request.resource.data.status == 'new'` — لا تتحقق من `userId`.

**الأثر:** طلب مزيّف يظهر في «طلباتي» لدى الضحية (الاستعلام `where('userId','==',uid)` يعيده)، وقد يربك الإدارة.
لا يمنح وصولًا لبيانات (القراءة/القائمة/التعديل محمية — مُختبَر)، ولا يفتح التقييم (`hasPurchasedProduct` يشترط
حالات `processing/shipped/delivered` والإنشاء مقيّد بـ`new`).

**علاج محلي دون تغيير القواعد:**
1. **موجود الآن في Worker v2:** الطلب الذي ينشئه الـ Worker يُخزَّن بـ`userId: 'guest'` و`claimedUserId` + تحذير
   `USERID_UNVERIFIED` (سيناريو S04). الإدارة تميّز الطلبات غير الموثّقة.
2. **Phase 2 (الواجهة):** إرسال Firebase ID token في `Authorization` مع الطلب، والـ Worker يتحقق منه (مفاتيح Google
   العامة لـ`securetoken`) ثم يضع `userId` الحقيقي. وإيقاف الكتابة المباشرة من المتصفح إلى `orders`.
3. **Phase 3 (قواعد — مقترح فقط):** بعد توقف الكتابة المباشرة: `allow create: if false` للعملاء (الـ Worker وحده
   يكتب عبر حساب الخدمة). مرحلة انتقالية إن لزم:
   ```
   allow create: if !exists(/databases/$(database)/documents/orders/$(id))
     && request.resource.data.status == 'new'
     && request.resource.data.userId == (request.auth == null ? 'guest' : request.auth.uid);
   ```

## W2 — قراءة أي طلب برقمه (`allow get: if true`)

**الأثر:** كشف بيانات شخصية لأي شخص يحصل على رقم الطلب. الرقم = 32 بت عشوائية + طابع زمني — صعب التخمين
بالعدّ، لكنه **يتسرّب** بسهولة: رسالة واتساب CliQ، لقطة شاشة، رابط صفحة النجاح، سجل المتصفح.

**علاج محلي دون تغيير القواعد:**
1. **Phase 2 (OrderSuccess):** عرض حالة الطلب من `GET /orders/{id}/status` في الـ Worker — يعيد
   `{ok, exists, status}` فقط بلا أي بيانات شخصية (مُختبَر S08) — بدل `getDoc` المباشر. تفاصيل الطلب تُعرض من
   `sessionStorage` على نفس الجهاز فقط.
2. **وحدة `orderSubmit.ts`:** تعتمد على endpoint الحالة فقط ولا تقرأ مستند الطلب أبدًا.
3. **Phase 3 (قواعد — مقترح فقط)، بعد أن تتوقف الواجهة عن `getDoc`:**
   ```
   allow get: if isAdmin() || (signedIn() && resource.data.userId == request.auth.uid);
   ```
   (طلبات الضيوف تُقرأ عبر الـ Worker فقط.) واختياريًا لاحقًا: رقم طلب أطول عشوائيًا (Worker يقبل حتى 16 حرفًا لكل جزء).

## W3 — حقل `role` قابل للكتابة ذاتيًا + `AdminGuard` يثق به

**القاعدة:** `match /users/{uid} { allow create, update: if isSelf(uid) || isAdmin(); }` — بلا قيود على الحقول.
**الكود:** [`src/components/AdminGuard.tsx:9`](../../src/components/AdminGuard.tsx#L9) — `role === 'admin'` يكفي لفتح صفحات الإدارة.

**الأثر (مُختبَر):** عميل يضع `role: 'admin'` لنفسه ← تُفتح له **واجهة** الإدارة، لكن **كل** عمليات البيانات تُرفض
(قائمة كل الطلبات، تعديل طلب، تعديل سعر) لأن القواعد تعتمد `config/roles` و`admins/{uid}` فقط. يبقى خطر واجهة:
صفحات الإدارة تظهر، وإعداد «Firebase config» في لوحة الإدارة يكتب في `localStorage` لمتصفح المستخدم نفسه.

**علاج محلي دون تغيير القواعد:**
1. **AdminGuard (مرحلة لاحقة، بموافقة):** تجاهل `user.role` كليًا والاعتماد على `config/roles.ownerUid` و`admins/{uid}`
   — نفس مصدر الحقيقة الذي تستخدمه القواعد. (`App.tsx` يقرأ `role` من مستند المستخدم — يُراجَع معه.)
2. **Phase 3 (قواعد — مقترح فقط):**
   ```
   allow create: if isAdmin() || (isSelf(uid) && (!('role' in request.resource.data) || request.resource.data.role == 'customer'));
   allow update: if isAdmin() || (isSelf(uid) && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role']));
   ```

---

## خطة التحقق قبل أي تغيير على الإنتاج

1. كل علاج يُكتب أولًا كنسخة قواعد مقترحة منفصلة وتُختبر في **المحاكي فقط** (نفس `tools/dev-emulator.rules.test.mjs`
   بعد قلب توقعات حالات **CURRENT WEAKNESS** إلى «مرفوض») + اختبارات `firebase/rules-test` (الـ 228).
2. الترتيب: **الواجهة أولًا** (Checkout يتوقف عن الكتابة المباشرة، OrderSuccess يتوقف عن `getDoc`، AdminGuard يتجاهل
   `role`) ← ثم القواعد. تغيير القواعد قبل الواجهة يكسر Checkout الحالي.
3. نشر القواعد خطوة إنتاج مستقلة بموافقة صريحة، مع سجل النسخ في Firebase Console للرجوع.
