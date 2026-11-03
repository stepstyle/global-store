# Order Worker — `anta-order-notify`

> ⚠️ **مصدر النسخة (Provenance)**
>
> الملف `worker.v1.production.js` **نُسخ يدويًا** من محرر Cloudflare Dashboard بواسطة صاحب المتجر،
> وأُرسل في المحادثة بتاريخ **2026-11-03**، ثم حُفظ هنا **حرفيًا دون أي تعديل**.
>
> - **لم تتم مقارنته آليًا** بالإصدار المنشور فعليًا على Cloudflare (لا `wrangler` ولا API).
> - لا يُعرف رقم الإصدار (Version ID) ولا تاريخ آخر نشر له.
> - قبل الاعتماد عليه كمرجع للرجوع (rollback)، يجب مطابقته مع Cloudflare → Workers & Pages →
>   `anta-order-notify` → **Deployments** وتسجيل Version ID هنا.
> - الملف **لا يحتوي أسرارًا**؛ كل المفاتيح تُقرأ من `env`.
>
> هذه النسخة **مرجع توثيقي فقط** — لا يوجد `wrangler.toml` ولا أي إعداد نشر في هذا المجلد.

## المعلومات المعروفة

| البند | القيمة |
|---|---|
| اسم الـ Worker | `anta-order-notify` |
| الرابط | `https://anta-order-notify.<account>.workers.dev` (مضبوط في Vercel كـ `VITE_WORKER_URL`) |
| من يستدعيه | `src/pages/Checkout.tsx` مباشرة من المتصفح (بلا انتظار للنتيجة)، و`api/create-order.js` على Vercel (غير مستخدم من الواجهة) |
| Version ID المنشور | ❓ غير مسجّل بعد |

## المسارات (Routes)

| المسار | الطريقة | الحماية | الوظيفة |
|---|---|---|---|
| `/` | أي | لا | `Worker is running` |
| `/test` | GET | **لا** (رغم نص الرسالة) | يرسل رسالة اختبار إلى تيليجرام |
| `/create-order` | POST | **لا** | حفظ الطلب + خصم المخزون + تيليجرام + إيميل الإدارة |
| `/firestore-test` | POST | `x-worker-auth` | يكتب مستندًا في `worker_test` |
| `/notify-order` | POST | `x-worker-auth` | يرسل تيليجرام فقط |

## متغيرات البيئة المستخدمة (الأسماء فقط)

`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`SENDGRID_API_KEY`, `ADMIN_EMAIL`, `EMAIL_FROM`, `EMAIL_FROM_NAME`,
`ADMIN_BASE_URL`, `WORKER_AUTH_TOKEN`

## تسلسل `/create-order` في v1

1. `body.order ?? body` — الشرط الوحيد: وجود `order.id`.
2. `writeOrderToFirestore`: **PATCH** على `orders/{id}` بلا `updateMask` وبلا `currentDocument`
   ← إنشاء **أو استبدال كامل** للمستند بمحتوى المتصفح.
3. `updateOrderStocks`: لكل عنصر: GET للمنتج ← `stock - quantity` (بحد أدنى 0) ← PATCH على `stock` العام فقط.
   أي فشل ← `stockWarning` فقط، والرد يبقى `ok: true`.
4. تيليجرام ثم SendGrid (نص عادي)، كلاهما **قبل** الرد.
5. الرد يتضمن ردود Firestore/Telegram/SendGrid كاملة.

## المشاكل المؤكدة من الكود (C1–C15)

| # | المشكلة |
|---|---|
| C1 | PATCH بلا شرط ← الكتابة فوق أي طلب موجود (وحذف الحقول غير المرسلة) |
| C2 | كل الحقول تُقبل من المتصفح (`status`, `isPaid`, `isVerified`, …) |
| C3 | `/create-order` بلا مصادقة، و`CORS: *` |
| C4 | `quantity`/`productId` بلا حدود ← يمكن تصفير مخزون أي منتج |
| C5 | مخزون `variants[].stock` لا يُخصم؛ يُخصم `stock` العام بدلًا منه |
| C6 | قراءة ثم كتابة بلا `updateTime`/transaction ← ضياع تحديثات عند التزامن |
| C7 | لا رفض عند نفاد المخزون (تقييد عند 0 فقط) |
| C8 | الخصم غير ذري؛ فشل جزئي مع `ok: true` |
| C9 | إعادة الإرسال ← خصم وتيليجرام وإيميل مكرر |
| C10 | الأسعار والمجموع والتوصيل من المتصفح دون تحقق |
| C11 | `/test` مكشوف ← إغراق محادثة تيليجرام |
| C12 | الرد يسرّب ردود الخدمات الداخلية ورسائل أخطاء Google |
| C13 | الإشعارات قبل الرد ← بطء ومهلات وإعادة محاولات |
| C14 | المتصفح والـ Worker يكتبان المستند نفسه (استبدال كامل من الطرفين، `createdAt` نص مقابل timestamp) |
| C15 | CORS يسمح فقط بـ `content-type, x-worker-auth` (سبب فشل إرسال `Authorization` سابقًا) |

التفاصيل والخطة: [`docs/order-pipeline/README.md`](../../docs/order-pipeline/README.md).
