import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Save,
  Package,
  DollarSign,
  Tag,
  FileText,
  ClipboardPaste,
  Image as ImageIcon,
  Upload,
  Trash2,
  PlusCircle,
} from 'lucide-react';
import Button from './Button';
import { Product, Category } from '../types';
import { useCart } from '../App';
import { uploadToCloudinary } from '../services/cloudinary';

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null; // null = add new
  onSave: (updatedProduct: Product) => Promise<void> | void;
}

/** ✅ URL Validation */
const isValidUrl = (u: string) => /^https?:\/\/.+/i.test(String(u || '').trim());

/** ✅ Parse urls safely (max 10) */
const parseUrls = (input: string): string[] => {
  if (!input) return [];
  const parts = input
    .replace(/\r/g, '\n')
    .split(/[\n\s|,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(isValidUrl);

  return Array.from(new Set(parts)).slice(0, 10);
};

const makeId = () => `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/**
 * ✅ Subcategories Mapping (Slug-based)
 * value = اللي رح ينحفظ بالمنتج (subCategory)
 */
const SUBCATEGORIES: Record<Category, { value: string; labelAr: string; labelEn: string }[]> = {
  Games: [
    { value: '0-9m', labelAr: 'ألعاب (من شهر إلى 9 أشهر)', labelEn: 'Games (0–9 months)' },
    { value: '1-2y', labelAr: 'ألعاب (من سنة إلى سنتين)', labelEn: 'Games (1–2 years)' },
    { value: '2-3y', labelAr: 'ألعاب (من سنتين إلى 3 سنوات)', labelEn: 'Games (2–3 years)' },
    { value: 'girls', labelAr: 'ألعاب بناتي', labelEn: 'Girls Games' },
    { value: 'boys', labelAr: 'ألعاب ولادي', labelEn: 'Boys Games' },
    { value: 'edu', labelAr: 'ألعاب تعليمية', labelEn: 'Educational Games' },
  ],
  Stationery: [
    { value: 'pencils', labelAr: 'أقلام رصاص', labelEn: 'Pencils' },
    { value: 'pens', labelAr: 'أقلام حبر', labelEn: 'Pens' },
    { value: 'markers', labelAr: 'أقلام تخطيط', labelEn: 'Markers' },
    { value: 'erasers', labelAr: 'محايات', labelEn: 'Erasers' },
    { value: 'sharpeners', labelAr: 'برايات', labelEn: 'Sharpeners' },
    { value: 'notebooks', labelAr: 'دفاتر', labelEn: 'Notebooks' },
    { value: 'files', labelAr: 'ملفات/حافظات', labelEn: 'Files/Folders' },
  ],
  ArtSupplies: [
    { value: 'colors', labelAr: 'ألوان', labelEn: 'Colors' },
    { value: 'brushes', labelAr: 'فُرش رسم', labelEn: 'Brushes' },
    { value: 'canvas', labelAr: 'كانفاس', labelEn: 'Canvas' },
    { value: 'craft', labelAr: 'أشغال يدوية', labelEn: 'Craft' },
  ],
  Bags: [
    { value: 'school', labelAr: 'شنط مدرسية', labelEn: 'School Bags' },
    { value: 'backpack', labelAr: 'حقائب ظهر', labelEn: 'Backpacks' },
    { value: 'lunch', labelAr: 'شنط طعام', labelEn: 'Lunch Bags' },
  ],
  EducationalCards: [
    { value: 'arabic', labelAr: 'بطاقات عربية', labelEn: 'Arabic Cards' },
    { value: 'english', labelAr: 'بطاقات إنجليزي', labelEn: 'English Cards' },
    { value: 'math', labelAr: 'بطاقات رياضيات', labelEn: 'Math Cards' },
  ],
  Courses: [
    { value: 'kids', labelAr: 'دورات للأطفال', labelEn: 'Kids Courses' },
    { value: 'art', labelAr: 'دورات رسم', labelEn: 'Art Courses' },
    { value: 'programming', labelAr: 'دورات برمجة', labelEn: 'Programming Courses' },
  ],
  Offers: [
    { value: 'bundle', labelAr: 'باكج/حزمة', labelEn: 'Bundle' },
    { value: 'discount', labelAr: 'خصم', labelEn: 'Discount' },
    { value: 'clearance', labelAr: 'تصفية', labelEn: 'Clearance' },
  ],
};

const CATEGORY_LABELS: Record<Category, { ar: string; en: string }> = {
  Stationery: { ar: 'قرطاسية', en: 'Stationery' },
  Bags: { ar: 'شنط وحقائب', en: 'Bags' },
  Offers: { ar: 'عروض', en: 'Offers' },
  ArtSupplies: { ar: 'مستلزمات فنية', en: 'Art Supplies' },
  Courses: { ar: 'دورات', en: 'Courses' },
  EducationalCards: { ar: 'بطاقات تعليمية', en: 'Educational Cards' },
  Games: { ar: 'ألعاب', en: 'Games' },
};

/** ✅ Deep remove undefined (Firestore-safe) */
const cleanUndefinedDeep = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(cleanUndefinedDeep).filter((v) => v !== undefined) as any;
  }
  if (value && typeof value === 'object') {
    const out: any = {};
    Object.keys(value as any).forEach((k) => {
      const v = (value as any)[k];
      if (v === undefined) return;
      const cleaned = cleanUndefinedDeep(v);
      if (cleaned === undefined) return;
      out[k] = cleaned;
    });
    return out;
  }
  return value;
};

const EditProductModal: React.FC<EditProductModalProps> = ({ isOpen, onClose, product, onSave }) => {
  const { t, showToast, products, language } = useCart();
  const isCreate = !product;

  const initialData = useMemo<Partial<Product>>(() => {
    if (product) {
      const cloned: any = { ...product };

      const imgs =
        Array.isArray(cloned.images) && cloned.images.length > 0
          ? cloned.images
          : cloned.image
          ? [cloned.image]
          : [];

      return {
        ...cloned,
        image: cloned.image || imgs[0] || '',
        images: imgs.length > 0 ? imgs : undefined,
        // ✅ back-compat: نقرأ القديم والجديد ونحفظ الجديد
        subCategory: cloned.subCategory ?? cloned.subcategory ?? '',
      };
    }

    return {
      id: makeId(),
      name: '',
      nameEn: '',
      price: 0,
      originalPrice: undefined,
      category: 'Stationery' as Category,
      subCategory: '',
      stock: 0,
      description: '',
      details: '',
      brand: '',
      videoUrl: '',
      isNew: true,
      image: '',
      images: undefined,
      rating: 0,
      reviews: 0,
    };
  }, [product]);

  const [formData, setFormData] = useState<Partial<Product>>(initialData);
  const [imagesInput, setImagesInput] = useState<string>('');
  const [imgError, setImgError] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  /** ✅ memoized parsed urls (performance + avoids repeated parsing) */
  const parsedUrls = useMemo(() => parseUrls(imagesInput), [imagesInput]);

  useEffect(() => {
    if (!isOpen) return;

    setFormData(initialData);

    const imgs =
      (initialData as any).images && Array.isArray((initialData as any).images) && (initialData as any).images.length > 0
        ? ((initialData as any).images as string[])
        : (initialData as any).image
        ? [String((initialData as any).image)]
        : [];

    setImagesInput(imgs.filter(Boolean).join(' | '));
    setImgError('');
  }, [initialData, isOpen]);

  // ✅ لما تتغير الـ category، تأكد إن subCategory صالح
  useEffect(() => {
    if (!isOpen) return;

    const cat = ((formData as any).category || 'Stationery') as Category;
    const list = SUBCATEGORIES[cat] || [];
    const currentSub = String((formData as any).subCategory || '').trim();
    if (!currentSub) return;

    const ok = list.some((x) => x.value === currentSub);
    if (!ok) {
      setFormData((prev) => ({ ...prev, subCategory: '' }));
    }
  }, [(formData as any).category, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const { name, value, type } = e.target;

      setFormData((prev) => ({
        ...prev,
        [name]: type === 'number' ? (value === '' ? ('' as any) : parseFloat(value)) : value,
      }));
    },
    []
  );

  /** ✅ source of truth: imagesInput */
  const syncImagesFromInput = useCallback((val: string) => {
    setImagesInput(val);
    const urls = parseUrls(val);

    setFormData((prev) => ({
      ...prev,
      image: urls[0] || '',
      images: urls.length > 0 ? urls : undefined,
    }));
  }, []);

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const urls = parseUrls(text);

      if (urls.length === 0) {
        setImgError('ما في روابط صالحة بالحافظة. انسخ روابط صور Cloudinary وبعدين جرّب.');
        return;
      }

      const merged = Array.from(new Set([...parsedUrls, ...urls])).slice(0, 10);
      setImgError('');
      syncImagesFromInput(merged.join(' | '));
    } catch {
      setImgError('المتصفح منع قراءة الحافظة. جرّب لصق الروابط يدويًا داخل حقل الصور.');
    }
  };

  const handleUploadImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    setImgError('');

    try {
      const list = Array.from(files).slice(0, 10);
      const urls: string[] = [];

      for (const file of list) {
        const url = await uploadToCloudinary(file);
        urls.push(url);
      }

      const merged = Array.from(new Set([...parsedUrls, ...urls])).slice(0, 10);
      syncImagesFromInput(merged.join(' | '));
      showToast(`Uploaded ${urls.length} images`, 'success');
    } catch (err: any) {
      const msg = err?.message || 'Upload failed';
      setImgError(msg);
      showToast(msg, 'error');
    } finally {
      setUploading(false);
    }
  };

  const removeImageAt = (idx: number) => {
    const next = parsedUrls.filter((_, i) => i !== idx);
    syncImagesFromInput(next.join(' | '));
  };

  const validate = (): boolean => {
    const nameEn = String((formData as any).nameEn || '').trim();
    const nameAr = String((formData as any).name || '').trim();
    const price = Number((formData as any).price ?? 0);
    const stock = Number((formData as any).stock ?? 0);

    if (!nameEn && !nameAr) {
      showToast('اكتب اسم المنتج (عربي أو انجليزي)', 'error');
      return false;
    }
    if (!price || price <= 0) {
      showToast('اكتب سعر صحيح', 'error');
      return false;
    }
    if (stock < 0) {
      showToast('المخزون لا يمكن يكون سالب', 'error');
      return false;
    }
    if (parsedUrls.length === 0 && !String((formData as any).image || '').trim()) {
      showToast('ارفع صورة واحدة على الأقل أو ضع رابط صورة', 'error');
      return false;
    }
    if (!(formData as any).category) {
      showToast('اختار الصنف الرئيسي', 'error');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);

    try {
      let id = String((formData as any).id || product?.id || makeId());
      if (isCreate && products?.some((p) => p.id === id)) {
        id = makeId();
      }

      const mergedProduct: Product = cleanUndefinedDeep({
        ...(product ?? ({} as Product)),
        ...(formData as Product),
        id,

        category: (((formData as any).category || product?.category || 'Stationery') as Category),

        // ✅ store only new field (subCategory) + empty => undefined
        subCategory: String((formData as any).subCategory || '').trim() || undefined,

        name:
          String((formData as any).name || '').trim() ||
          String((formData as any).nameEn || '').trim(),
        nameEn:
          String((formData as any).nameEn || '').trim() ||
          String((formData as any).name || '').trim(),

        image: String(parsedUrls[0] || (formData as any).image || product?.image || ''),
        images: parsedUrls.length > 0 ? parsedUrls : undefined,

        price: Number((formData as any).price ?? product?.price) || 0,
        stock: Number((formData as any).stock ?? product?.stock) || 0,

        originalPrice:
          (formData as any).originalPrice === '' || (formData as any).originalPrice === undefined
            ? undefined
            : Number((formData as any).originalPrice),

        rating: product?.rating ?? (formData as any).rating ?? 0,
        reviews: product?.reviews ?? (formData as any).reviews ?? 0,
      });

      await onSave(mergedProduct);
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const selectedCategory = (((formData as any).category || 'Stationery') as Category);
  const subList = SUBCATEGORIES[selectedCategory] || [];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={() => !saving && onClose()}
      />

      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-300 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            {isCreate ? <PlusCircle className="text-secondary-DEFAULT" /> : <Package className="text-secondary-DEFAULT" />}
            {isCreate ? 'إضافة منتج جديد' : t('manageProductInventory')}
          </h2>

          <button
            onClick={() => !saving && onClose()}
            className="p-2 bg-white rounded-full hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors shadow-sm disabled:opacity-50"
            type="button"
            disabled={saving}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-8">
          <form id="edit-product-form" onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">{t('productNameEn')}</label>
                <input
                  type="text"
                  name="nameEn"
                  value={String((formData as any).nameEn || '')}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-secondary-DEFAULT outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">{t('productNameAr')}</label>
                <input
                  type="text"
                  name="name"
                  value={String((formData as any).name || '')}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-secondary-DEFAULT outline-none text-right"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">الصنف الرئيسي</label>
                <select
                  name="category"
                  value={String((formData as any).category || 'Stationery')}
                  onChange={(e) => {
                    const nextCat = e.target.value as Category;
                    setFormData((prev) => ({ ...prev, category: nextCat, subCategory: '' }));
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-secondary-DEFAULT outline-none"
                >
                  {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
                    <option key={cat} value={cat}>
                      {language === 'ar' ? CATEGORY_LABELS[cat].ar : CATEGORY_LABELS[cat].en}
                    </option>
                  ))}
                </select>
              </div>

              {/* SubCategory */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">الصنف الفرعي</label>
                <select
                  name="subCategory"
                  value={String((formData as any).subCategory || '')}
                  onChange={handleChange}
                  disabled={subList.length === 0}
                  className={`w-full px-4 py-3 rounded-xl border bg-white outline-none focus:ring-2 ${
                    subList.length === 0
                      ? 'border-slate-100 text-slate-400'
                      : 'border-slate-200 focus:ring-secondary-DEFAULT'
                  }`}
                >
                  <option value="">
                    {subList.length === 0 ? 'لا يوجد تصنيفات فرعية لهذا الصنف' : 'اختار (اختياري)'}
                  </option>

                  {subList.map((s) => (
                    <option key={s.value} value={s.value}>
                      {language === 'ar' ? s.labelAr : s.labelEn}
                    </option>
                  ))}
                </select>

                <p className="text-[11px] text-slate-500 mt-2">مثال: ألعاب (0-9m) / قرطاسية (pencils) … إلخ</p>
              </div>
            </div>

            {/* Images Section */}
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <ImageIcon size={16} /> صور المنتج
                </h3>

                <div className="flex gap-2">
                  <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary-DEFAULT text-white text-xs hover:bg-secondary-dark cursor-pointer">
                    <Upload size={16} />
                    {uploading ? 'جاري الرفع...' : 'رفع صور'}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => handleUploadImages(e.target.files)}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handlePasteFromClipboard}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs hover:bg-slate-800"
                  >
                    <ClipboardPaste size={16} />
                    لصق روابط
                  </button>
                </div>
              </div>

              <p className="text-xs text-slate-500 mb-3">
                ضع الروابط مفصولة بـ <b>|</b> أو سطر جديد. أول رابط سيكون الصورة الرئيسية. (حد أقصى 10)
              </p>

              <textarea
                value={imagesInput}
                onChange={(e) => syncImagesFromInput(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-secondary-DEFAULT outline-none text-xs"
                placeholder="https://... | https://... | https://..."
              />

              {imgError && <div className="mt-3 text-sm text-red-600">{imgError}</div>}

              {/* Thumbnails */}
              {parsedUrls.length > 0 && (
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {parsedUrls.map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      className="relative rounded-2xl overflow-hidden border border-slate-200 bg-white"
                    >
                      <img src={url} alt={`img-${idx}`} className="w-full h-24 object-cover" loading="lazy" />
                      <button
                        type="button"
                        onClick={() => removeImageAt(idx)}
                        className="absolute top-2 right-2 p-2 rounded-full bg-white/90 hover:bg-white text-red-600"
                        title="حذف"
                      >
                        <Trash2 size={14} />
                      </button>
                      {idx === 0 && (
                        <div className="absolute bottom-2 left-2 text-[10px] bg-black/70 text-white px-2 py-1 rounded-md">
                          رئيسية
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Preview main image */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">الصورة الرئيسية (image)</label>
                  <input
                    type="text"
                    name="image"
                    value={String((formData as any).image || '')}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFormData((prev) => ({ ...prev, image: v }));

                      // ✅ لو المستخدم حط رابط صالح، ضيفه (كأول صورة) عشان ما يصير out of sync
                      if (isValidUrl(v)) {
                        const merged = Array.from(new Set([v, ...parsedUrls])).slice(0, 10);
                        syncImagesFromInput(merged.join(' | '));
                      }
                    }}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-secondary-DEFAULT outline-none text-xs"
                    placeholder="https://..."
                  />
                </div>

                <div className="flex items-center justify-center">
                  {(formData as any).image ? (
                    <img
                      src={String((formData as any).image)}
                      alt="preview"
                      className="w-24 h-24 rounded-2xl object-cover border border-slate-200"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-2xl border border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-xs">
                      No Image
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Inventory & Price */}
            <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100">
              <h3 className="text-sm font-bold text-blue-800 mb-4 flex items-center gap-2">
                <Tag size={16} /> {t('inventoryPriceDetails')}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">{t('price')}</label>
                  <div className="relative">
                    <DollarSign size={16} className="absolute left-3 top-3.5 text-slate-400" />
                    <input
                      type="number"
                      name="price"
                      value={Number((formData as any).price ?? 0)}
                      onChange={handleChange}
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-secondary-DEFAULT outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">{t('originalPriceOptional')}</label>
                  <div className="relative">
                    <DollarSign size={16} className="absolute left-3 top-3.5 text-slate-400" />
                    <input
                      type="number"
                      name="originalPrice"
                      value={((formData as any).originalPrice ?? '') as any}
                      onChange={handleChange}
                      placeholder={t('optional')}
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-secondary-DEFAULT outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">{t('currentStock')}</label>
                  <div className="relative">
                    <Package size={16} className="absolute left-3 top-3.5 text-slate-400" />
                    <input
                      type="number"
                      name="stock"
                      value={Number((formData as any).stock ?? 0)}
                      onChange={handleChange}
                      className={`w-full pl-10 pr-4 py-3 rounded-xl border focus:ring-2 outline-none font-bold ${
                        Number((formData as any).stock ?? 0) < 10
                          ? 'border-red-300 text-red-600 bg-red-50 focus:ring-red-200'
                          : 'border-slate-200 focus:ring-secondary-DEFAULT'
                      }`}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                <FileText size={16} /> {t('description')}
              </label>
              <textarea
                name="description"
                value={String((formData as any).description || '')}
                onChange={handleChange}
                rows={4}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-secondary-DEFAULT outline-none resize-none"
              />
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <Button variant="outline" onClick={() => !saving && onClose()} type="button" disabled={saving}>
            {t('cancel')}
          </Button>

          <Button
            type="submit"
            form="edit-product-form"
            className="shadow-lg shadow-secondary-light/20"
            disabled={saving || uploading}
          >
            <Save size={18} className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" />
            {saving ? 'جاري الحفظ...' : isCreate ? 'إضافة المنتج' : t('saveChanges')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default EditProductModal;