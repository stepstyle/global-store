const functions = require('firebase-functions');
const admin = require('firebase-admin');

// تفعيل الصلاحيات الكاملة للسيرفر
admin.initializeApp();
const db = admin.firestore();

// 🚀 المراقب الآلي: يعمل تلقائياً فور إنشاء أي طلب جديد
exports.secureOrderPrices = functions.firestore
  .document('orders/{orderId}')
  .onCreate(async (snap, context) => {
    const orderData = snap.data();
    const items = orderData.items || [];
    const orderId = context.params.orderId;

    let isFraud = false;
    let fraudDetails = '';

    console.log(`بدأ فحص الطلب رقم: ${orderId}`);

    // 🔍 فحص كل منتج في السلة ومقارنته بقاعدة البيانات
    for (const item of items) {
      const productRef = db.collection('products').doc(item.productId);
      const productSnap = await productRef.get();

      // 1. إذا كان المنتج غير موجود (محاولة اختراق بمنتج وهمي)
      if (!productSnap.exists) {
        isFraud = true;
        fraudDetails = `المنتج غير موجود في قاعدة البيانات: ${item.name}`;
        break; 
      }

      const realProduct = productSnap.data();
      const realPrice = Number(realProduct.price || 0);
      const clientPrice = Number(item.price || 0);

      // 2. مقارنة السعر (المرسل من العميل vs السعر الحقيقي) 🚨
      if (Math.abs(clientPrice - realPrice) > 0.01) {
        isFraud = true;
        fraudDetails = `تلاعب بسعر (${item.name}). العميل أرسل: ${clientPrice} JD، السعر الحقيقي: ${realPrice} JD`;
        break; 
      }
    }

    // 🛑 إذا تم اكتشاف تلاعب
    if (isFraud) {
      console.error(`🚨 محاولة احتيال في الطلب ${orderId}: ${fraudDetails}`);
      
      // تحويل حالة الطلب إلى (fraud) لفضحه في لوحة التحكم
      return snap.ref.update({
        status: 'fraud',
        fraudReason: fraudDetails,
        systemNote: 'تم تجميد هذا الطلب آلياً لاكتشاف تلاعب بالأسعار من قبل العميل.',
        updatedAt: new Date().toISOString()
      });
    }

    // ✅ إذا الطلب سليم 100%
    console.log(`✅ الطلب ${orderId} سليم ومطابق للأسعار.`);
    return snap.ref.update({
      isVerified: true,
      systemNote: 'تم التحقق من الأسعار آلياً بنجاح.'
    });
  });