# النسخ الاحتياطي لـ Firestore — دليل المالك

> يُشغَّل على الإنتاج **فقط بعد موافقتك**، ومن نافذة PowerShell الخاصة بك. لا تُلصق المفتاح ولا عبارة المرور في أي محادثة.

## ما يضمنه

- **قراءة فقط:** مفتاح بصلاحية «Cloud Datastore Viewer» لا يملك صلاحية الكتابة، والسكربت يرفض في الكود أي طلب غير القراءة.
- **لحظة واحدة:** كل القراءات تتم «كما كانت عند لحظة البدء» (`readTime`)، فالطلبات والسجلات والحجوزات متسقة، ويُحفظ وقت تلك اللحظة في الملف.
  - **حدود:** المحاكي المحلي لا يدعم هذه الميزة، فلم تُختبر محليًا.
  - إن رفضها Firestore الحقيقي تفشل النسخة بوضوح، ولا يُكتب شيء.
  - النسخة يجب أن تنتهي خلال 55 دقيقة، وإلا تُلغى.
- **فحص اتساق مستقل:** مجموع حجوزات الطلبات المفتوحة يجب أن يساوي `stockReservations`. إن ظهر `consistent: false` تُعاد النسخة في وقت هادئ.
- **التشفير:** AES-256-GCM. عبارة خاطئة أو بايت واحد معدَّل يجعل الملف غير قابل للقراءة.
- **مكان الحفظ:** خارج أي مستودع git (السكربت يرفض غير ذلك)، ولا يكتب فوق نسخة سابقة، والصلاحية لمستخدم Windows الحالي فقط.
- **الاستعادة والتحقق:** في محاكٍ محلي فقط (مشروع `demo-`). لا يستطيع السكربت الكتابة في مشروع حقيقي.

## 1. تجهيز مفتاح قراءة فقط (مرة واحدة، من حسابك)

1. Google Cloud Console للمشروع → IAM & Admin → Service Accounts → Create.
   - الاسم مثلًا `firestore-backup-viewer`.
   - الدور **Cloud Datastore Viewer** فقط.
2. افتح الحساب → Keys → Add key → JSON. احفظ الملف في مجلد خاص **خارج** مجلدات المشروع، مثل `C:\Users\<أنت>\secure\fs-viewer.json`.
3. اجعل الملف لك وحدك:
   ```powershell
   icacls C:\Users\<أنت>\secure\fs-viewer.json /inheritance:r /grant:r "$env:USERNAME:(R)"
   ```
4. **بعد النسخ:** احذف المفتاح من Console (Keys → Delete) ومن جهازك. لا تُبقِ مفاتيح غير مستخدمة.

## 2. التشغيل

```powershell
cd C:\Users\GA\Downloads\anta-store-fixed-step1-patched\dev-review
powershell -ExecutionPolicy Bypass -File tools\firestore-backup\run-backup.ps1 -KeyFile C:\Users\<أنت>\secure\fs-viewer.json -Project <معرّف المشروع>
```

- يطلب عبارة المرور مرتين في حقل مخفي. لا تظهر في الأمر ولا في سجل PowerShell، وتُحذف من الجلسة في النهاية.
- يطبع **أسماء المجموعات وأعداد المستندات فقط**، ونتيجة فحص الاتساق.
- ثم يستعيد النسخة في محاكٍ محلي ويتحقق من كل مستند (`ok: true`، و`missing` و`extra` و`changed` كلها 0).
- **احفظ عبارة المرور في مدير كلمات مرور.** بدونها لا يمكن استعادة النسخة.

### التحقق من نسخة موجودة فقط (دون قراءة Firestore ودون مفتاح)

```powershell
cd C:\Users\GA\Downloads\anta-store-fixed-step1-patched\dev-review
powershell -ExecutionPolicy Bypass -File tools\firestore-backup\run-verify.ps1 -BackupFile "$env:USERPROFILE\dairsharaf-backups\<الملف>.fsbk"
```

- يطلب عبارة المرور مرة واحدة في حقل مخفي.
- يشغّل محاكيًا محليًا جديدًا على منافذ حرة (18500 فما فوق)، ثم يستعيد النسخة ويتحقق منها. بعد ذلك يوقف **المحاكي الذي شغّله فقط**.
- إن لم يبدأ المحاكي خلال 120 ثانية يتوقف برسالة `ERROR` واضحة، ولا يعلق.

## 3. حسابات الدخول (Firebase Authentication)، اختياري ومنفصل

ليست جزءًا من Firestore، وهذا الإصدار لا يغيّرها.

```powershell
npx firebase auth:export "$env:USERPROFILE\dairsharaf-backups\accounts.json" --format=json --project <معرّف المشروع>
node tools\firestore-backup\backup.mjs seal --in "$env:USERPROFILE\dairsharaf-backups\accounts.json" --out "$env:USERPROFILE\dairsharaf-backups\accounts.fsbk"
```

- `auth:export` قراءة فقط بحسابك في Firebase CLI.
- الملف يحتوي البريد وبصمات كلمات المرور. `seal` يشفّره ثم يكتب فوق النسخة المكشوفة ويحذفها، ويحتاج `BACKUP_PASSPHRASE` بالطريقة نفسها: `Read-Host -AsSecureString`، ثم `$env:BACKUP_PASSPHRASE`، ثم الحذف.
- الاستيراد لاحقًا إلى مشروع آخر يحتاج **معاملات بصمة كلمات المرور** من Firebase Console (Authentication → Users → ⋮ → Password hash parameters). احفظها مشفّرة مع النسخة.
- **لم يُختبر الاستيراد في المحاكي.**
