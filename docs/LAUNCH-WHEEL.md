# إطلاق الدولاب + القبول عبر Telegram — خطة التنفيذ (لا تُنفَّذ قبل موافقتك الصريحة)

الفرع `dev/review-2026-11` يحتوي `origin/main` (`1ea8a1c`، الإنتاج الحالي)، فالدمج **fast-forward**.

## ما سيُفعَّل

| البند | القيمة |
|---|---|
| الدولاب | `WHEEL_MODE=live` (Worker) و`VITE_WHEEL_MODE=live` (الموقع)، الحملة `WHEEL_CAMPAIGN=opening-1` |
| الحملة | زر «تعبئة الحملة الافتتاحية» في اللوحة ← مراجعة ← حفظ. **50 د.أ** متاحة من البداية، سقف صارم، **30 يومًا** من لحظة الحفظ، بلا نمو وبلا تجديد |
| الجوائز | خصم 1 ×10، توصيل مجاني ×3، هدية 2 ×3، هدية 3 ×1، خصم الطلب الثاني 4 ×1، خصم 4 ×1، هدية 4 ×1، هدية 5 ×1، خصم 5 ×1 = **50 د.أ بالضبط**؛ الساعة واللعبة والنثريات موقوفة (تكلفة غير مؤكدة) وتبقى في اللوحة |
| فرص الفوز | جديد 19.7%، راجع 24.4%، دائم (3+ مُسلَّمة) 33%؛ تكلفة اللفة المتوقعة 0.39 / 0.52 / 0.76 د.أ |
| المخزون | `STOCK_POLICY=on_acceptance` + `APPROVAL_MODE=telegram`: حجز عند الطلب، خصم مرة واحدة عند القبول، إرجاع مرة واحدة عند الإلغاء |
| القبول التلقائي | **OFF** (`AUTO_APPROVAL_MODE` غير معرّف، ومفتاح اللوحة غير موجود = OFF) |
| تسجيل الدخول | `ORDER_SIGN_IN=google`: اللف بلا حساب، وGoogle عند «تأكيد الطلب» (الجائزة تُربط بطلب مسجّل الدخول) |

## ما تحتاج إدخاله أنت (لا أطّلع عليه)

- `TELEGRAM_ADMIN_USER_IDS`: رقم حساب Telegram لكل من يحق له القبول (أرقام، ليست أسرارًا).
- أسرار جديدة عبر `wrangler secret put` (قيم عشوائية بـ `openssl rand -hex 32` — **ليس base64**: سر الـ webhook يقبل A-Z a-z 0-9 _ - فقط، وإلا يرفض الـ Worker التشغيل): `TELEGRAM_WEBHOOK_SECRET`، `WHEEL_PHONE_SECRET`.
- Vercel: متغير `VITE_WHEEL_MODE=live` لبيئة Production.

## الخطوات

```bash
# 0) قراءة فقط — نقاط التراجع (سجّلها)
cd workers/order-worker
npx wrangler deployments list --name anta-order-v2      # الحالي 2ea16078 (لا ترجع أبدًا إلى 274978a8)
vercel ls --prod                                         # رقم نشر الموقع الحالي
# قواعد Firestore الحالية: ruleset 760798d0 (firebase/firestore.rules.on-delivery قبل التعديل)
# Telegram: getWebhookInfo للبوت — سجّل الـ URL الحالي (إن وُجد)

# 1) القواعد أولًا (الفرق الوحيد: workerManaged تشمل on_acceptance)
firebase deploy --only firestore:rules   # بملف firebase/firestore.rules.on-delivery المحدَّث، المشروع الإنتاجي

# 2) أسرار الـ Worker
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config wrangler.production.local.toml
npx wrangler secret put WHEEL_PHONE_SECRET     --config wrangler.production.local.toml

# 3) في wrangler.production.local.toml (git-ignored):
#    STOCK_POLICY = "on_acceptance"
#    APPROVAL_MODE = "telegram"
#    TELEGRAM_ADMIN_USER_IDS = "<أرقامك مفصولة بفواصل>"
#    WHEEL_MODE = "live"
#    WHEEL_CAMPAIGN = "opening-1"
#    ORDER_SIGN_IN = "google"
npx wrangler deploy --config wrangler.production.local.toml   # الـ Worker يرفض التشغيل إن نقص أي إعداد
curl -s https://<worker-host>/                                # الإصدار الجديد

# 4) Telegram webhook (يستبدل أي webhook حالي للبوت)
#    setWebhook: url=https://<worker-host>/telegram/webhook, secret_token=<TELEGRAM_WEBHOOK_SECRET>,
#    allowed_updates=["callback_query"], drop_pending_updates=true — ثم getWebhookInfo: last_error_message فارغ

# 5) الدمج والموقع
git checkout main && git merge --ff-only dev/review-2026-11 && git push origin main
npm run build:hosting && npm run check:guard     # مع VITE_WHEEL_MODE=live
vercel deploy --prebuilt --prod

# 6) الحملة: لوحة الإدارة ← الدولاب ← «تعبئة الحملة الافتتاحية» ← راجع النسب والتكلفة ← حفظ
```

## التحقق بعد النشر (من حسابك، لا طلبات زبائن)

1. زائر بلا حساب: يظهر الدولاب، اللف يعمل، الجائزة محفوظة 60 دقيقة مع العداد.
2. «تأكيد الطلب» ← Google ← Turnstile ← «تأكيد الطلب النهائي»: طلب صغير بالدفع عند الاستلام.
3. تصل رسالة Telegram بالأزرار: ❌ رفض ← الحجز يُفك، لا خصم. طلب ثانٍ: ✅ قبول ← المخزون ينقص مرة واحدة، اللوحة «قيد التجهيز». إلغاء من اللوحة ← يعود مرة واحدة.
4. لوحة الميزانية: المحجوز يعود بعد الرفض / الإلغاء؛ المتاح لا يتجاوز 50.

## التراجع (بالترتيب، بلا فقد بيانات)

1. الحملة: إيقافها من اللوحة (active=false) — فوري.
2. الموقع: Vercel ← Promote للنشر السابق (أو `VITE_WHEEL_MODE` فارغ وإعادة البناء).
3. الـ Worker: `WHEEL_MODE="off"`، `STOCK_POLICY="on_delivery"`، `APPROVAL_MODE="off"`، `ORDER_SIGN_IN` محذوف، ثم `wrangler deploy`؛ أو `npx wrangler rollback 2ea16078…` (المعرّف الكامل). الطلبات المنشأة بـ `on_acceptance` تبقى تُدار بسياستها المسجّلة.
4. Telegram: `deleteWebhook` (أو إعادة الـ URL السابق).
5. القواعد: تبقى (تقبل السياستين)؛ أو إعادة ruleset 760798d0 من Firebase Console.

## قرارات مفتوحة (لا تمنع الإطلاق)

- هدية 4 وهدية 5 حدّهما الأدنى 5 د.أ كما اتُّفق؛ النظام ينبّه ويقترح 15 د.أ.
- الهدايا مُحتسبة في الميزانية **بقيمتها الكاملة** (التكلفة الفعلية أقل أو مساوية).
- خصم الكمية 10% يُجمع مع جائزة الدولاب.
