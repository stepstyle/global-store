# قواعد Firestore — التحليل وقواعد الاختبار

> ⚠️ **كل ما في هذا المجلد للاختبار على المحاكي المحلي فقط. لم يُنشر شيء.**
> - `firebase.json` و`.firebaserc` هنا مرتبطان بمشروع وهمي `demo-dairsharaf-rules` ← أي `firebase deploy`
>   من هذا المجلد يفشل ولا يصل للإنتاج.
> - `firebase.json` الرئيسي في جذر المستودع **لم يُعدَّل** ولا يحتوي قسم `firestore`.

| الملف | الوصف |
|---|---|
| [`../firestore.rules.prod-snapshot`](../firestore.rules.prod-snapshot) | نسخة حرفية من القواعد المنشورة في `antastore1-82b50` (زوّدها صاحب المتجر في 2026-11-03، نُسخت يدويًا من Console) |
| [`firestore.rules.compat`](firestore.rules.compat) | مرشّح المرحلة 1 — **لا يتطلب أي تغيير في كود الواجهة**؛ الطلبات للضيوف تبقى تعمل |
| [`firestore.rules.target`](firestore.rules.target) | المرحلة 3 — ⛔ يوقف طلبات الضيوف إن نُشر قبل الواجهة v2 ونقاط الـ Worker |
| [`rules.test.mjs`](rules.test.mjs) | جدول حالات واحد يُشغَّل على القواعد الثلاث مع النتيجة المتوقعة لكل منها |

---

## 1. تحليل المخاطر في القواعد الحالية

### أ) `orders` — الإنشاء مفتوح للجميع

```
allow create: if true && !exists(orders/$(id)) && request.resource.data.status == 'new';
```

| | |
|---|---|
| **ما يحمي فعلًا** | `status == 'new'` فقط. شرط `!exists` **زائد**: `create` لا ينطبق أصلًا على مستند موجود (الكتابة على موجود = `update` = أدمن فقط) |
| **مؤكد** | لا تحقق من أي حقل آخر: `userId` أي قيمة (يستطيع مستخدم إنشاء طلب يظهر في «طلباتي» لمستخدم آخر)، `total`/`items`/`price` أي قيمة وأي نوع، حقول إضافية (`isVerified`, `paymentDetails.isPaid: true`, `systemNote`)، `createdAt` أي تاريخ، حجم حتى 1MB، رقم المستند يمكن أن يختلف عن `order.id` |
| **مؤكد** | لا حد لعدد الطلبات (إغراق لوحة الأدمن) |
| **أثر على السباق** | إذا كتب الـ Worker المستند أولًا، فإن `setDoc` من المتصفح يصبح `update` ← **مرفوض** ← يُبتلع بصمت. إذا كتب المتصفح أولًا ← الـ Worker (حساب خدمة، يتجاوز القواعد) يستبدله بالكامل. **النتيجة: المستند النهائي هو دائمًا نسخة الـ Worker عندما ينجح** (و`createdAt` نص) |

### ب) `orders` — القراءة بالرقم للجميع

```
allow get: if true;
```

| | |
|---|---|
| **المكشوف** | الاسم، الهاتف، العنوان، الإيميل، مرجع CliQ، الملاحظات، المنتجات والمبالغ |
| **قابلية التخمين** | `ORD-` + 8 خانات hex من UUID (~32 بت) + طابع زمني بالمللي ثانية. التعداد الشامل غير عملي |
| **الخطر الحقيقي** | تسرّب الرقم: رسالة واتساب CliQ، رابط التتبع في إيميل العميل، لقطات الشاشة، رد الـ Worker. من يملك الرقم يرى كل البيانات |
| **`list`** | محمي جيدًا (أدمن أو `userId == uid`). لا يمكن سرد كل الطلبات |

### ج) `users` — تعديل حقل `role`

```
allow create, update: if isSelf(uid) || isAdmin();
```

| | |
|---|---|
| **مؤكد** | المستخدم يكتب أي حقل في مستنده، بما فيه `role: 'admin'` (عند التسجيل أو لاحقًا) |
| **الأثر اليوم** | **القواعد لا تعتمد على `role`** (تعتمد على `config/roles.ownerUid` و`admins/`) ← لا وصول فعلي للبيانات. لكن الواجهة تثق به: `App.tsx` يقرأ `role` ← `Header` يُظهر روابط الإدارة، `Login` يحوّل إلى `/admin`، `AdminGuard` يقبل `role === 'admin'` ← `/admin-secure` يفتح (ثم يردّه فحص الإيميل في `AdminDashboard`)، `reviews.ts`/`ProductDetails` تُظهر أزرار إدارة التقييمات (والقواعد ترفض تنفيذها) |
| **التقييم** | تصعيد صلاحيات **في الواجهة فقط** حاليًا، لكنه فخ: أي كود مستقبلي يثق بـ `role` يصبح ثغرة حقيقية |

### د) `products` — تعديل حقول التقييم من المستخدمين

```
allow update: if isAdmin() || (signedIn() && diff.affectedKeys().hasOnly(['ratingAvg','ratingCount','rating','reviews','updatedAt']));
```

| | |
|---|---|
| **مؤكد** | أي مستخدم مسجّل يضع أي قيمة وأي نوع لأي منتج: `ratingAvg: 5, ratingCount: 9999` أو `ratingAvg: 50` أو نص |
| **الأثر** | تقييمات مزيفة، التلاعب بترتيب «الأعلى تقييمًا»، الإضرار بمنتجات معيّنة |
| **لماذا موجود** | `reviews.ts:syncProductAggregate()` يعيد حساب المتوسط في المتصفح ويكتبه بعد كل تقييم |
| **السعر/المخزون/الاسم** | محمية — `hasOnly` يمنعها ✓ |

### هـ) مشاكل إضافية اكتُشفت أثناء المراجعة

| # | المشكلة | النوع |
|---|---|---|
| E1 | `reviews` create: أي مستخدم ينشئ تقييمًا **باسم مستخدم آخر** (`userId` غير مقيّد)، بأي `rating` (10، سالب)، و`adminReply` مزوّر. شرط «الشراء قبل التقييم» في المتصفح فقط | أمني مؤكد |
| E2 | `reviews` update: صاحب التقييم يعدّل **أي حقل**، بما فيه `status` ← يعيد نشر تقييم أخفاه الأدمن، ويزوّر `adminReply` | أمني مؤكد |
| E3 | `reviews` likes: أي مستخدم يضع `likesBy`/`likesCount` بأي قيمة ← يمسح إعجابات الآخرين أو يضع 9999 | أمني مؤكد |
| E4 | `admins/{uid}` read للمالك فقط ← `AdminGuard.tsx` يقرأ `admins/{uid}` لأدمن غير المالك ← مرفوض ← **الأدمن غير المالك لا يجتاز AdminGuard** | خلل وظيفي مؤكد |
| E5 | `Account.tsx` يستعلم `where('customerEmail', '==', user.email)` لكن `list` يشترط `userId == uid` ← **الاستعلام مرفوض دائمًا** لغير الأدمن ← تبويب الطلبات في الحساب لا يعمل | خلل وظيفي مؤكد |
| E6 | `config/sendgrid` (مفتاح API) مقروء لأي أدمن، ليس المالك فقط | أمني (أثر محدود) |
| E7 | `orderLedger` / `worker_test` بلا `match` ← مرفوضة للمتصفح افتراضيًا ✓ | سليم |

---

## 2. اعتماد الواجهة الحالية على الصلاحيات

| الميزة | الملف | العملية | prod | compat | target |
|---|---|---|---|---|---|
| إنشاء طلب (ضيف/مستخدم) | `Checkout.tsx` → `storage.ts:476` | `orders` create | ✅ | ✅ بتحقق | ⛔ (الـ Worker فقط) |
| صفحة نجاح الطلب | `OrderSuccess.tsx:195` | `orders` get (ضيف) | ✅ | ✅ | ⛔ ← Worker status |
| تتبع الطلب | `OrderTracking.tsx:152` | `orders` get (ضيف) | ✅ | ✅ | ⛔ ← Worker status |
| طلباتي | `MyOrders.tsx:118` | `orders` list `userId==uid` | ✅ | ✅ | ✅ |
| طلبات الحساب | `Account.tsx:66` | `orders` list `customerEmail` | ❌ (E5) | ✅ | ✅ |
| شرط الشراء للتقييم | `storage.ts:437` | `orders` list `userId==uid` | ✅ | ✅ | ✅ |
| لوحة الأدمن — الطلبات | `storage.ts:383`, `AdminOrders.tsx` | `orders` list | ✅ | ✅ | ✅ |
| تغيير حالة الطلب | `storage.ts:508` | `orders` update (status, seenByAdmin, updatedAt) | ✅ | ✅ | ✅ |
| حذف طلب | `AdminDashboard.tsx:511` | `orders` delete | مالك فقط | مالك فقط | مالك فقط |
| إدارة المنتجات / CSV | `storage.ts:332/345/360` | `products` create/update/delete | ✅ أدمن | ✅ أدمن | ✅ أدمن |
| AdminGuard | `AdminGuard.tsx:13/21` | `config/roles` get, `admins/{uid}` get | ⚠️ E4 | ✅ | ✅ |
| تسجيل حساب | `storage.ts:606` | `users` create (`role:'customer'`) | ✅ | ✅ | ✅ |
| تحميل الملف الشخصي | `App.tsx:295` | `users/{uid}` get | ✅ | ✅ | ✅ |
| إضافة/تعديل تقييم | `reviews.ts:234/251` | `reviews` create/update | ✅ | ✅ بتحقق | ✅ بتحقق |
| مزامنة متوسط التقييم | `reviews.ts:110` | `products` update (rating keys) | ✅ | ✅ بحدود | ⛔ ← Worker |
| إعجاب | `reviews.ts:323` | `reviews` update (likes) | ✅ | ✅ مفتاحك فقط | ✅ مفتاحك فقط |
| إخفاء/رد/حذف تقييم | `reviews.ts:369/406/439` | `reviews` update/delete | ✅ أدمن | ✅ أدمن | ✅ أدمن |
| Worker (كل العمليات) | `worker.v1.production.js` | حساب خدمة | يتجاوز القواعد | يتجاوز | يتجاوز |

**ملاحظة:** تسجيل الدخول عبر Google/Facebook (`Login.tsx:333-365`) **لا يكتب** مستند `users` — لا يتأثر.

---

## 3. لماذا `compat` لا يوقف طلبات الزبائن

1. `create` يبقى مفتوحًا للضيوف؛ الشروط مبنية على **الحقول الفعلية** التي يكتبها `Checkout.tsx` + `storage.ts`
   (مختبَرة بحمولة مطابقة: COD وCliQ، ضيف ومسجّل، ومسجّل قبل تحميل ملفه `userId:'guest'`).
2. `get` بالرقم يبقى مفتوحًا ← صفحتا النجاح والتتبع تعملان.
3. **شبكة أمان مزدوجة:** حتى لو رفضت القواعد كتابة المتصفح في حالة غير متوقعة، الـ Worker v1 يحفظ الطلب
   بحساب خدمة (يتجاوز القواعد) — كما يحدث اليوم في ترتيب «الـ Worker أولًا».
   ⚠️ هذا يفترض أن الـ Worker يعمل؛ لذلك **لا تُنشر compat دون مراقبة سجلات الـ Worker**.

### المقايضات المعروفة (`[INFO]` في الاختبارات)

| الحالة | السلوك في compat |
|---|---|
| مستخدم وهمي قديم في `localStorage` (`anta_current_user`) بلا مصادقة Firebase، `userId` مثل `admin-1` | كتابة المتصفح مرفوضة؛ الـ Worker يحفظ |
| منتج قديم بأرقام تقييم وهمية (`reviews: 57` بلا `ratingCount`) وفرق > 1 | مزامنة المتوسط مرفوضة (يُسجَّل خطأ في الكونسول فقط)؛ التقييم نفسه يُحفظ |
| حقل جديد يضيفه أحد في `Checkout.tsx` مستقبلًا | يُرفض حتى يُضاف إلى `orderKeys()` ← **يجب تحديث القواعد مع أي تغيير في شكل الطلب** |

### المخاطر المتبقية في compat (تُغلق في target)

- قراءة أي طلب بالرقم (ب).
- أي مستخدم مسجّل يحرّك متوسط تقييم أي منتج ضمن 0–5 وبفارق عدد ±1 لكل كتابة.
- لا تحقق من الأسعار في القواعد (مستحيل دون حلقات) — مهمة الـ Worker v2.
- لا حد لعدد الطلبات — Turnstile + Rate limit في الـ Worker.

---

## 4. متطلبات `target` قبل أي نشر

| المتطلب | لماذا |
|---|---|
| الواجهة v2 لا تكتب `orders` (الـ Worker فقط) | `create: if false` |
| `OrderSuccess`/`OrderTracking` للضيوف عبر `GET /v2/orders/{id}/status` | `get` مقفل لغير المالك |
| إعادة حساب متوسط التقييم في الـ Worker | `products` update للأدمن فقط |
| الأدمن يعدّل `status`/`seenByAdmin`/`updatedAt` فقط | أي تعديل آخر للطلب من اللوحة سيُرفض |

---

## 5. تشغيل الاختبارات (المحاكي فقط)

### نتيجة آخر تشغيل — 2026-11-03

| البند | القيمة |
|---|---|
| النتيجة | **228 ناجح / 0 فاشل** (76 حالة × 3 قواعد) |
| prod-snapshot | 76/76 — منها 25 حالة `[SEC]` متوقع نجاحها = **ثغرات مؤكدة في الإنتاج** |
| compat | 76/76 — يغلق 20 من 25 ثغرة، كل حالات `[FUNC]` تعمل، ويصلح E4 وE5 |
| target | 76/76 — يغلق الـ 25 كلها (ويرفض طلبات الضيوف من المتصفح كما هو متوقع) |
| البيئة | Firestore Emulator v1.20.2، `firebase-tools` 15.7.0، Node 24، `@firebase/rules-unit-testing` 4.0.1، `firebase` 11.10.0 |
| المشروع | `demo-dairsharaf-rules` — لا اتصال بـ `antastore1-82b50`، لا بيانات اعتماد |

**رسائل `evaluation error` في السجل:** تظهر في حالات الرفض فقط، وفي `prod-snapshot` أيضًا.
تجربة معزولة أثبتت أن المحاكي يطبعها عند رفض طلب يتضمن `exists()`/`get()` لمستخدم غير مخوّل،
والنتيجة النهائية `false`. لا تؤثر على الموثوقية: `error || true` = سماح في Firestore، فلو سمحت قاعدة
بمرور مهاجم لفشل اختبار الرفض.

**⚠️ Windows:** بعد `emulators:exec` قد يبقى المحاكي (java) يعمل على المنفذ 8085، فيفشل التشغيل التالي
بـ `port taken`. للتحقق والإيقاف (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 8085 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

### طريقة التشغيل

المتطلبات موجودة على الجهاز: `firebase-tools` 15.7.0، Java 25، Node 24.

```bash
cd firebase/rules-test
npm install            # يحتاج موافقة — يثبّت في هذا المجلد فقط (node_modules مُستثنى من git)
npm test               # firebase emulators:exec --project demo-dairsharaf-rules … node --test
```

حواجز داخل `rules.test.mjs`:
- يرفض العمل دون `FIRESTORE_EMULATOR_HOST`، أو إذا لم يكن عنوانًا محليًا.
- معرّف المشروع يجب أن يبدأ بـ `demo-` ولا يساوي `antastore1-82b50`.

قراءة النتائج:
- `[prod] ALLOW [SEC] …` ناجح = **الثغرة مؤكدة في الإنتاج** (ليس إصلاحًا).
- `[compat]`/`[target]` `DENY [SEC]` ناجح = الثغرة مغلقة.
- أي `[FUNC]` فاشل في compat = **القواعد ستكسر ميزة حالية** ← لا نشر.

> ملاحظة إصدارات: `@firebase/rules-unit-testing@^4` مع `firebase@^11` (حزمة معزولة عن تطبيق المتجر).
> يُتحقق من التوافق عند `npm install`.

## 6. النشر (ليس الآن)

لا يُنشر أي ملف من هنا قبل: نجاح كل الاختبارات + موافقة صريحة + خطة رجوع
(Firebase Console → Firestore → Rules → سجل النسخ يتيح الرجوع الفوري لنسخة `prod-snapshot`).
