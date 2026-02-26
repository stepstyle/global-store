// src/config/catalog.ts
import type { Category } from "../types";

export const CATEGORY_LABELS: Record<Category, { ar: string; en: string }> = {
  Stationery: { ar: "قرطاسية", en: "Stationery" },
  Bags: { ar: "شنط وحقائب", en: "Bags" },
  Offers: { ar: "عروض", en: "Offers" },
  ArtSupplies: { ar: "مستلزمات فنية", en: "Art Supplies" },
  Courses: { ar: "دورات", en: "Courses" },
  EducationalCards: { ar: "بطاقات تعليمية", en: "Educational Cards" },
  Games: { ar: "ألعاب", en: "Games" },
};

export const SUBCATEGORIES: Record<Category, { value: string; labelAr: string; labelEn: string }[]> = {
  Games: [
    { value: "0-9m", labelAr: "ألعاب (من شهر إلى 9 أشهر)", labelEn: "Games (0–9 months)" },
    { value: "1-2y", labelAr: "ألعاب (من سنة إلى سنتين)", labelEn: "Games (1–2 years)" },
    { value: "2-3y", labelAr: "ألعاب (من سنتين إلى 3 سنوات)", labelEn: "Games (2–3 years)" },
    { value: "girls", labelAr: "ألعاب بناتي", labelEn: "Girls Games" },
    { value: "boys", labelAr: "ألعاب ولادي", labelEn: "Boys Games" },
    { value: "edu", labelAr: "ألعاب تعليمية", labelEn: "Educational Games" },
  ],
  Stationery: [
    { value: "pencils", labelAr: "أقلام رصاص", labelEn: "Pencils" },
    { value: "pens", labelAr: "أقلام حبر", labelEn: "Pens" },
    { value: "markers", labelAr: "أقلام تخطيط", labelEn: "Markers" },
    { value: "erasers", labelAr: "محايات", labelEn: "Erasers" },
    { value: "sharpeners", labelAr: "برايات", labelEn: "Sharpeners" },
    { value: "notebooks", labelAr: "دفاتر", labelEn: "Notebooks" },
    { value: "files", labelAr: "ملفات/حافظات", labelEn: "Files/Folders" },
  ],
  ArtSupplies: [
    { value: "colors", labelAr: "ألوان", labelEn: "Colors" },
    { value: "brushes", labelAr: "فُرش رسم", labelEn: "Brushes" },
    { value: "canvas", labelAr: "كانفاس", labelEn: "Canvas" },
    { value: "craft", labelAr: "أشغال يدوية", labelEn: "Craft" },
  ],
  Bags: [
    { value: "school", labelAr: "شنط مدرسية", labelEn: "School Bags" },
    { value: "backpack", labelAr: "حقائب ظهر", labelEn: "Backpacks" },
    { value: "lunch", labelAr: "شنط طعام", labelEn: "Lunch Bags" },
  ],
  EducationalCards: [
    { value: "arabic", labelAr: "بطاقات عربية", labelEn: "Arabic Cards" },
    { value: "english", labelAr: "بطاقات إنجليزي", labelEn: "English Cards" },
    { value: "math", labelAr: "بطاقات رياضيات", labelEn: "Math Cards" },
  ],
  Courses: [
    { value: "kids", labelAr: "دورات للأطفال", labelEn: "Kids Courses" },
    { value: "art", labelAr: "دورات رسم", labelEn: "Art Courses" },
    { value: "programming", labelAr: "دورات برمجة", labelEn: "Programming Courses" },
  ],
  Offers: [
    { value: "bundle", labelAr: "باكج/حزمة", labelEn: "Bundle" },
    { value: "discount", labelAr: "خصم", labelEn: "Discount" },
    { value: "clearance", labelAr: "تصفية", labelEn: "Clearance" },
  ],
};

export const normalizeSubCategory = (raw: any): string => {
  const s = String(raw ?? "").trim();
  if (!s) return "";

  const map: Record<string, string> = {
    Pencils: "pencils",
    Pens: "pens",
    Markers: "markers",
    Erasers: "erasers",
    Sharpeners: "sharpeners",
    Notebooks: "notebooks",
    Files: "files",
    Colors: "colors",

    "أقلام رصاص": "pencils",
    "أقلام حبر": "pens",
    "أقلام تخطيط": "markers",
    "محايات": "erasers",
    "برايات": "sharpeners",
    "دفاتر": "notebooks",
    "ملفات/حافظات": "files",
    "ألوان": "colors",

    Age_0_9m: "0-9m",
    Age_1_2: "1-2y",
    Age_2_3: "2-3y",
    Girls: "girls",
    Boys: "boys",
    Educational: "edu",

    "0-9 Months": "0-9m",
    "1-2 Years": "1-2y",
    "2-3 Years": "2-3y",
    "Girls Toys": "girls",
    "Boys Toys": "boys",
    EducationalGames: "edu",

    "ألعاب (من شهر إلى 9 أشهر)": "0-9m",
    "ألعاب (من سنة إلى سنتين)": "1-2y",
    "ألعاب (من سنتين إلى 3 سنوات)": "2-3y",
    "ألعاب بناتي": "girls",
    "ألعاب ولادي": "boys",
    "ألعاب تعليمية": "edu",

    Bundle: "bundle",
    Discount: "discount",
    Clearance: "clearance",
    "باكج/حزمة": "bundle",
    "خصم": "discount",
    "تصفية": "clearance",
  };

  const looksLikeSlug = /^[a-z0-9-]+$/i.test(s);
  if (looksLikeSlug && s.length <= 30) return s.toLowerCase();

  return (map[s] || s).toLowerCase();
};