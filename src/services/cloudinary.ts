// src/services/cloudinary.ts

// ✅ الإعدادات الثابتة (يفضل مستقبلاً وضعها في ملف .env لحماية الكود)
const CLOUD_NAME = "dixhf2p3j";
const UPLOAD_PRESET = "anta_unsigned";
const MAX_FILE_SIZE_MB = 5; // الحد الأقصى لحجم الصورة (5 ميجابايت)

// ✅ تعريف دقيق لشكل الاستجابة (Type Safety)
interface CloudinaryResponse {
  secure_url: string;
  public_id: string;
  error?: {
    message: string;
  };
}

/**
 * ☁️ خدمة رفع الصور إلى Cloudinary (Unsigned Upload)
 * @param file ملف الصورة المراد رفعه
 * @returns الرابط الآمن (Secure URL) للصورة المرفوعة
 * @throws {Error} رسالة خطأ واضحة باللغة العربية في حال الفشل
 */
export const uploadToCloudinary = async (file: File): Promise<string> => {
  // 1. التحقق من وجود الملف
  if (!file) {
    throw new Error("لم يتم اختيار أي ملف للرفع.");
  }

  // 2. التحقق من نوع الملف (يجب أن يكون صورة فقط)
  if (!file.type.startsWith("image/")) {
    throw new Error("عذراً، يُسمح فقط برفع الصور (JPG, PNG, WebP, إلخ).");
  }

  // 3. التحقق من حجم الملف (حماية الكوتا وتجربة المستخدم)
  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > MAX_FILE_SIZE_MB) {
    throw new Error(`حجم الصورة كبير جداً. الحد الأقصى المسموح به هو ${MAX_FILE_SIZE_MB} ميجابايت.`);
  }

  // 4. تجهيز البيانات للرفع
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);
  
  // ❌ ملاحظة أمنية: لا نضيف eager أو eager_async مع unsigned upload 
  // لأن Cloudinary سترفض الطلب وتُرجع خطأ في الصلاحيات.

  try {
    // 5. إرسال الطلب
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      { 
        method: "POST", 
        body: formData 
      }
    );

    const data = (await response.json()) as CloudinaryResponse;

    // 6. معالجة أخطاء الرد من سيرفرات Cloudinary
    if (!response.ok) {
      console.error("Cloudinary Upload Error:", data.error);
      throw new Error(data.error?.message || "حدث خطأ في خادم الصور أثناء الرفع.");
    }

    // 7. إرجاع الرابط الآمن للواجهة
    return data.secure_url;

  } catch (error: any) {
    console.error("Upload Exception:", error);
    
    // التفرقة بين خطأ انقطاع الإنترنت والأخطاء الأخرى
    if (error.name === 'TypeError' || error.message === 'Failed to fetch') {
      throw new Error("فشل الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت والمحاولة مجدداً.");
    }
    
    // إعادة رمي الخطأ الخاص بنا (الذي رميناه في الأعلى) أو خطأ عام
    throw new Error(error.message || "حدث خطأ غير متوقع أثناء رفع الصورة.");
  }
};