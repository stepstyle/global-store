// src/services/cloudinary.ts

const CLOUD_NAME = "dixhf2p3j";
const UPLOAD_PRESET = "anta_unsigned";

// 🛡️ كوتا ذكية للحماية
const MAX_IMAGE_SIZE_MB = 5;  // 5 ميجا للصور
const MAX_VIDEO_SIZE_MB = 50; // 50 ميجا للفيديوهات

interface CloudinaryResponse {
  secure_url: string;
  public_id: string;
  error?: { message: string; };
}

export const uploadToCloudinary = async (file: File): Promise<string> => {
  if (!file) throw new Error("لم يتم اختيار أي ملف للرفع.");

  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");

  if (!isImage && !isVideo) {
    throw new Error("عذراً، يُسمح فقط برفع الصور أو الفيديوهات.");
  }

  const fileSizeMB = file.size / (1024 * 1024);
  const maxSize = isVideo ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB;

  if (fileSizeMB > maxSize) {
    throw new Error(`حجم الملف كبير جداً. الحد الأقصى هو ${maxSize} ميجابايت.`);
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);
  
  try {
    // 🔥 السطر السحري: استخدمنا auto ليتعرف على الفيديو والصور تلقائياً
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`,
      { method: "POST", body: formData }
    );

    const data = (await response.json()) as CloudinaryResponse;

    if (!response.ok) {
      console.error("Cloudinary Error:", data.error);
      throw new Error(data.error?.message || "فشل الرفع للسيرفر.");
    }

    return data.secure_url;
  } catch (error: any) {
    throw new Error(error.message || "حدث خطأ أثناء الاتصال.");
  }
};