import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, Save, Package, DollarSign, Tag, FileText,
  ClipboardPaste, Image as ImageIcon, Upload, Trash2, PlusCircle,
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

/** ✅ معايير عالمية للتحقق من الروابط لضمان أمان الـ CDN */
const isValidUrl = (u: string) => /^https?:\/\/.+/i.test(String(u || '').trim());

/** ✅ معالجة الروابط بدقة عالية (تصل لـ 10 صور) */
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

/** ✅ الخارطة الكاملة للأقسام الفرعية (Slug-based) */
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

/** ✅ تنظيف البيانات العميقة لضمان استقرار Firestore */
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
  const { t, showToast, products, language } = useCart() as any;
  const isCreate = !product;

  const initialData = useMemo<Partial<Product>>(() => {
    if (product) {
      const cloned: any = { ...product };
      const imgs = Array.isArray(cloned.images) && cloned.images.length > 0
          ? cloned.images
          : cloned.image ? [cloned.image] : [];

      return {
        ...cloned,
        image: cloned.image || imgs[0] || '',
        images: imgs.length > 0 ? imgs : undefined,
        subCategory: cloned.subCategory ?? cloned.subcategory ?? '',
      };
    }

    return {
      id: makeId(), name: '', nameEn: '', price: 0, category: 'Stationery' as Category,
      subCategory: '', stock: 0, description: '', details: '', brand: '',
      videoUrl: '', isNew: true, image: '', rating: 0, reviews: 0,
    };
  }, [product]);

  const [formData, setFormData] = useState<Partial<Product>>(initialData);
  const [imagesInput, setImagesInput] = useState<string>('');
  const [imgError, setImgError] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsedUrls = useMemo(() => parseUrls(imagesInput), [imagesInput]);

  useEffect(() => {
    if (!isOpen) return;
    setFormData(initialData);
    const imgs = (initialData as any).images || ((initialData as any).image ? [(initialData as any).image] : []);
    setImagesInput(imgs.filter(Boolean).join(' | '));
    setImgError('');
  }, [initialData, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const cat = (formData.category || 'Stationery') as Category;
    const list = SUBCATEGORIES[cat] || [];
    const currentSub = String(formData.subCategory || '').trim();
    if (currentSub && !list.some((x) => x.value === currentSub)) {
      setFormData((prev) => ({ ...prev, subCategory: '' }));
    }
  }, [formData.category, isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'number' ? (value === '' ? '' : parseFloat(value)) : value,
    }));
  };

  const syncImagesFromInput = (val: string) => {
    setImagesInput(val);
    const urls = parseUrls(val);
    setFormData((prev) => ({ ...prev, image: urls[0] || '', images: urls.length > 0 ? urls : undefined }));
  };
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
      setImgError('المتصفح منع قراءة الحافظة. جرّب لصق الروابط يدويًا.');
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
      setImgError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    // ✅ التحقق من البيانات (Validation)
    if (!formData.name && !formData.nameEn) return showToast('اكتب اسم المنتج', 'error');
    if (!formData.price || formData.price <= 0) return showToast('السعر غير صحيح', 'error');

    setSaving(true);
    try {
      const mergedProduct: Product = cleanUndefinedDeep({
        ...formData,
        id: formData.id || makeId(),
        image: parsedUrls[0] || '',
        images: parsedUrls,
        price: Number(formData.price),
        stock: Number(formData.stock || 0),
        subCategory: String(formData.subCategory || '').trim() || undefined,
      }) as Product;

      await onSave(mergedProduct);
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
        
        {/* Header */}
        <div className="flex items-center justify-between p-8 border-b bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-secondary-DEFAULT/10 text-secondary-DEFAULT flex items-center justify-center shadow-inner">
              {isCreate ? <PlusCircle size={28} /> : <Package size={28} />}
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-800">{isCreate ? 'إضافة منتج' : 'تعديل بيانات المنتج'}</h2>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">{formData.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-white rounded-2xl hover:bg-red-50 hover:text-red-500 transition-all shadow-sm">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <form id="edit-product-form" onSubmit={handleSubmit} className="space-y-8">
            
            {/* Names & Category */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-black text-slate-700">اسم المنتج (En)</label>
                <input name="nameEn" value={formData.nameEn || ''} onChange={handleChange} className="w-full px-5 py-4 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-secondary-DEFAULT/10 outline-none font-bold" />
              </div>
              <div className="space-y-2 text-right">
                <label className="text-sm font-black text-slate-700">الاسم (العربي)</label>
                <input name="name" value={formData.name || ''} onChange={handleChange} className="w-full px-5 py-4 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-secondary-DEFAULT/10 outline-none font-bold text-right" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-black text-slate-700">الصنف الرئيسي</label>
                <select name="category" value={formData.category} onChange={handleChange} className="w-full px-5 py-4 rounded-2xl border border-slate-200 bg-white font-bold outline-none">
                  {Object.keys(CATEGORY_LABELS).map(cat => (
                    <option key={cat} value={cat}>{language === 'ar' ? CATEGORY_LABELS[cat as Category].ar : CATEGORY_LABELS[cat as Category].en}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-black text-slate-700">الصنف الفرعي</label>
                <select name="subCategory" value={formData.subCategory || ''} onChange={handleChange} className="w-full px-5 py-4 rounded-2xl border border-slate-200 bg-white font-bold outline-none">
                  <option value="">اختار فرع (اختياري)</option>
                  {(SUBCATEGORIES[formData.category as Category] || []).map(s => (
                    <option key={s.value} value={s.value}>{language === 'ar' ? s.labelAr : s.labelEn}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Price & Stock */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 bg-blue-50/50 rounded-[2rem] border border-blue-100/50">
               <div className="space-y-2">
                 <label className="text-xs font-black text-blue-600 flex items-center gap-1"><DollarSign size={14}/> السعر</label>
                 <input type="number" name="price" value={formData.price ?? ''} onChange={handleChange} className="w-full px-5 py-4 rounded-xl border-none shadow-sm font-black text-secondary-DEFAULT" />
               </div>
               <div className="space-y-2">
                 <label className="text-xs font-black text-blue-600 flex items-center gap-1"><Package size={14}/> المخزون</label>
                 <input type="number" name="stock" value={formData.stock ?? ''} onChange={handleChange} className="w-full px-5 py-4 rounded-xl border-none shadow-sm font-black" />
               </div>
               <div className="space-y-2">
                 <label className="text-xs font-black text-blue-600 flex items-center gap-1"><Tag size={14}/> الماركة</label>
                 <input type="text" name="brand" value={formData.brand || ''} onChange={handleChange} className="w-full px-5 py-4 rounded-xl border-none shadow-sm font-bold" />
               </div>
            </div>

            {/* Images - تصميم الـ Gallery المطور */}
            <div className="space-y-4">
               <div className="flex justify-between items-center">
                 <label className="text-sm font-black text-slate-700 flex items-center gap-2"><ImageIcon size={18}/> صور المنتج (روابط Cloudinary)</label>
                 <div className="flex gap-2">
                    <label className="cursor-pointer bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-secondary-DEFAULT transition-all">
                      <Upload size={14} className="inline mr-2"/> رفع صور
                      <input type="file" multiple className="hidden" onChange={e => handleUploadImages(e.target.files)} disabled={uploading} />
                    </label>
                    <button type="button" onClick={handlePasteFromClipboard} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-200"><ClipboardPaste size={14} className="inline mr-2"/> لصق</button>
                 </div>
               </div>
               <textarea value={imagesInput} onChange={e => syncImagesFromInput(e.target.value)} rows={3} className="w-full px-5 py-4 rounded-2xl border border-slate-200 text-xs font-mono outline-none focus:ring-2 focus:ring-secondary-DEFAULT/20" placeholder="رابط 1 | رابط 2..." />
               
               <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
                 {parsedUrls.map((url, idx) => (
                   <div key={idx} className="relative aspect-square rounded-2xl overflow-hidden border-2 border-slate-100 group">
                     <img src={url} className="w-full h-full object-cover" />
                     <button type="button" onClick={() => {
                       const next = parsedUrls.filter((_, i) => i !== idx);
                       syncImagesFromInput(next.join(' | '));
                     }} className="absolute inset-0 bg-red-500/80 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><Trash2 size={16}/></button>
                   </div>
                 ))}
               </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
               <label className="text-sm font-black text-slate-700 flex items-center gap-2"><FileText size={18}/> وصف المنتج</label>
               <textarea name="description" value={formData.description || ''} onChange={handleChange} rows={5} className="w-full px-5 py-4 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-secondary-DEFAULT/5" />
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="p-8 border-t bg-slate-50/50 flex justify-end gap-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>إلغاء</Button>
          <Button type="submit" form="edit-product-form" disabled={saving || uploading} className="px-12 shadow-xl shadow-secondary-light/30">
            {saving ? 'جاري الحفظ...' : (isCreate ? 'إضافة للمتجر' : 'حفظ التعديلات')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default EditProductModal;