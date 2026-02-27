// src/services/cloudinary.ts

type CloudinaryUploadResponse = {
  secure_url: string;
  error?: { message?: string };
};

export const uploadToCloudinary = async (file: File): Promise<string> => {
  const cloudName = "dixhf2p3j";
  const uploadPreset = "anta_unsigned";

  // ✅ حماية: نقبل صور فقط
  if (!file.type.startsWith("image/")) {
    throw new Error("الملف لازم يكون صورة");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  // ❌ لا تضيف eager / eager_async مع unsigned upload
  // Cloudinary رح يرفضهم ويطلع نفس الخطأ اللي عندك

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: "POST", body: formData }
  );

  const data = (await response.json()) as CloudinaryUploadResponse;

  if (!response.ok) {
    throw new Error(data.error?.message || "Upload failed");
  }

  return data.secure_url;
};