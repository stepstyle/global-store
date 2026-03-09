// src/components/EditProductModal.tsx
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
  product: Product | null;
  onSave: (updatedProduct: Product) => Promise<void> | void;
}

/** ✅ معايير عالمية للتحقق من الروابط */
const isValidUrl = (u: string) => /^https?:\/\/.+/i.test(String(u || '').trim());

/** ✅ معالجة الروابط بدقة */
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

const SUBCATEGORIES: Record<Category, { value: string; labelAr: string; labelEn: string }[]> = {
  Games: [
    { value: '0-9m', labelAr: 'ألعاب (0–9 أشهر)', labelEn: 'Games (0–9 months)' },
    { value: '1-2y', labelAr: 'ألعاب (1–2 سنة)', labelEn: 'Games (1–2 years)' },
    { value: '2-3y', labelAr: 'ألعاب (2–3 سنوات)', labelEn: 'Games (2–3 years)' },
    { value: 'girls', labelAr: 'ألعاب بناتي', labelEn: 'Girls Games' },
    { value: 'boys', labelAr: 'ألعاب ولادي', labelEn: 'Boys Games' },
    { value: 'edu', labelAr: 'ألعاب تعليمية', labelEn: 'Educational Games' },
  ],
  Stationery: [
    { value: 'pencils', labelAr: 'أقلام رصاص', labelEn: 'Pencils' },
    { value: 'pens', labelAr: 'أقلام حبر', labelEn: 'Pens' },
    { value: 'notebooks', labelAr: 'دفاتر', labelEn: 'Notebooks' },
  ],
  ArtSupplies: [
    { value: 'colors', labelAr: 'ألوان', labelEn: 'Colors' },
    { value: 'brushes', labelAr: 'فُرش رسم', labelEn: 'Brushes' },
  ],
  Bags: [
    { value: 'school', labelAr: 'شنط مدرسية', labelEn: 'School Bags' },
  ],
  EducationalCards: [
    { value: 'arabic', labelAr: 'بطاقات عربية', labelEn: 'Arabic Cards' },
  ],
  Courses: [
    { value: 'kids', labelAr: 'دورات للأطفال', labelEn: 'Kids Courses' },
  ],
  Offers: [
    { value: 'discount', labelAr: 'خصم', labelEn: 'Discount' },
  ],
};

const CATEGORY_LABELS: Record<Category, { ar: string; en: string }> = {
  Stationery: { ar: 'القرطاسية', en: 'Stationery' },
  Bags: { ar: 'الشنط والحقائب', en: 'Bags' },
  Offers: { ar: 'العروض الترويجية', en: 'Offers' },
  ArtSupplies: { ar: 'المستلزمات الفنية', en: 'Art Supplies' },
  Courses: { ar: 'الدورات التدريبية', en: 'Courses' },
  EducationalCards: { ar: 'البطاقات التعليمية', en: 'Educational Cards' },
  Games: { ar: 'الألعاب والترفيه', en: 'Games' },
};

const cleanUndefinedDeep = <T,>(value: T): T => {
  if (Array.isArray(value)) return value.map(cleanUndefinedDeep).filter(v => v !== undefined) as any;
  if (value && typeof value === 'object') {
    const out: any = {};
    Object.keys(value).forEach(k => {
      const v = (value as any)[k];
      if (v !== undefined) out[k] = cleanUndefinedDeep(v);
    });
    return out;
  }
  return value;
};

const EditProductModal: React.FC<EditProductModalProps> = ({ isOpen, onClose, product, onSave }) => {
  const { t, showToast, language } = useCart() as any;
  const isCreate = !product;

  const initialData = useMemo<Partial<Product>>(() => {
    if (product) {
      const imgs = Array.isArray(product.images) && product.images.length > 0 ? product.images : (product.image ? [product.image] : []);
      return { ...product, image: product.image || imgs[0] || '', images: imgs, subCategory: product.subCategory ?? (product as any).subcategory ?? '' };
    }
    return { id: makeId(), name: '', nameEn: '', price: 0, category: 'Stationery', subCategory: '', stock: 0, description: '', isNew: true };
  }, [product]);

  const [formData, setFormData] = useState<Partial<Product>>(initialData);
  const [imagesInput, setImagesInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormData(initialData);
      const imgs = (initialData as any).images || ((initialData as any).image ? [(initialData as any).image] : []);
      setImagesInput(imgs.join(' | '));
    }
  }, [initialData, isOpen]);

  const parsedUrls = useMemo(() => parseUrls(imagesInput), [imagesInput]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'number' ? (value === '' ? '' : parseFloat(value)) : value }));
  };

  const handleUploadImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files).slice(0, 10)) {
        urls.push(await uploadToCloudinary(file));
      }
      setImagesInput(prev => Array.from(new Set([...parseUrls(prev), ...urls])).join(' | '));
      showToast('تم رفع الصور بنجاح', 'success');
    } catch { showToast('فشل الرفع', 'error'); }
    finally { setUploading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name && !formData.nameEn) return showToast('يرجى إدخال اسم المنتج', 'error');
    setSaving(true);
    try {
      await onSave(cleanUndefinedDeep({ ...formData, image: parsedUrls[0] || '', images: parsedUrls }) as Product);
      onClose();
    } catch { showToast('فشل الحفظ', 'error'); }
    finally { setSaving(false); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md">
      {/* Container المطور بلمسة عالمية */}
      <div className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300 border border-white/20">
        
        {/* Header: خط عريض وواضح جداً */}
        <div className="flex items-center justify-between p-8 border-b bg-slate-50/80">
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-secondary-DEFAULT/10 text-secondary-DEFAULT flex items-center justify-center shadow-sm">
              {isCreate ? <PlusCircle size={32} /> : <Package size={32} />}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">
                {isCreate ? 'إضافة منتج عالمي جديد' : 'تعديل بيانات المتجر'}
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-1 font-bold">SERIAL: {formData.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-white hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-2xl transition-all shadow-sm border border-slate-100">
            <X size={20} />
          </button>
        </div>

        {/* Body: توزيع مريح للعين مع تحسين الخطوط */}
        <div className="flex-1 overflow-y-auto p-10 custom-scrollbar space-y-10">
          <form id="edit-product-form" onSubmit={handleSubmit} className="space-y-10">
            
            {/* الأقسام والأسماء */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-600 px-1">Product Name (EN)</label>
                <input name="nameEn" value={formData.nameEn || ''} onChange={handleChange} placeholder="Global product title..." className="w-full px-6 py-4 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-secondary-DEFAULT/10 focus:border-secondary-DEFAULT outline-none font-semibold text-slate-800 transition-all" />
              </div>
              <div className="space-y-3 text-right">
                <label className="text-sm font-bold text-slate-600 px-1">اسم المنتج (عربي)</label>
                <input name="name" value={formData.name || ''} onChange={handleChange} placeholder="عنوان المنتج باللغة العربية..." className="w-full px-6 py-4 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-secondary-DEFAULT/10 focus:border-secondary-DEFAULT outline-none font-bold text-slate-800 text-right transition-all" />
              </div>

              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-600 px-1">التصنيف الرئيسي</label>
                <select name="category" value={formData.category} onChange={handleChange} className="w-full px-6 py-4 rounded-2xl border border-slate-200 bg-white font-bold text-slate-700 outline-none cursor-pointer hover:border-secondary-DEFAULT/50 transition-all">
                  {Object.keys(CATEGORY_LABELS).map(cat => (
                    <option key={cat} value={cat}>{language === 'ar' ? CATEGORY_LABELS[cat as Category].ar : CATEGORY_LABELS[cat as Category].en}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-600 px-1">التصنيف الفرعي</label>
                <select name="subCategory" value={formData.subCategory || ''} onChange={handleChange} className="w-full px-6 py-4 rounded-2xl border border-slate-200 bg-white font-bold text-slate-700 outline-none">
                  <option value="">— اختيار قسم فرعي —</option>
                  {(SUBCATEGORIES[formData.category as Category] || []).map(s => (
                    <option key={s.value} value={s.value}>{language === 'ar' ? s.labelAr : s.labelEn}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* المالية والمخزون - تصميم Box مريح */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-8 bg-blue-50/30 rounded-[2.5rem] border border-blue-100/50 shadow-inner">
               <div className="space-y-2">
                 <label className="text-xs font-black text-blue-500 uppercase flex items-center gap-2"><DollarSign size={14}/> السعر (JOD)</label>
                 <input type="number" name="price" value={formData.price ?? ''} onChange={handleChange} className="w-full px-6 py-4 rounded-2xl border-none shadow-sm font-black text-xl text-secondary-DEFAULT focus:ring-2 focus:ring-secondary-DEFAULT/20" />
               </div>
               <div className="space-y-2">
                 <label className="text-xs font-black text-blue-500 uppercase flex items-center gap-2"><Package size={14}/> المخزون المتاح</label>
                 <input type="number" name="stock" value={formData.stock ?? ''} onChange={handleChange} className="w-full px-6 py-4 rounded-2xl border-none shadow-sm font-black text-xl text-slate-800" />
               </div>
               <div className="space-y-2">
                 <label className="text-xs font-black text-blue-500 uppercase flex items-center gap-2"><Tag size={14}/> العلامة التجارية</label>
                 <input type="text" name="brand" value={formData.brand || ''} onChange={handleChange} className="w-full px-6 py-4 rounded-2xl border-none shadow-sm font-bold text-slate-700" />
               </div>
            </div>

            {/* الصور: تصميم معرض عالمي */}
            <div className="space-y-5">
               <div className="flex justify-between items-center px-1">
                 <label className="text-sm font-bold text-slate-700 flex items-center gap-3">
                   <ImageIcon size={20} className="text-secondary-DEFAULT" /> 
                   معرض صور المنتج (CDN Ready)
                 </label>
                 <div className="flex gap-3">
                    <label className="cursor-pointer bg-slate-900 text-white px-5 py-2.5 rounded-2xl text-xs font-bold hover:bg-secondary-DEFAULT transition-all shadow-md">
                      <Upload size={14} className="inline mr-2"/> رفع ملفات
                      <input type="file" multiple className="hidden" onChange={e => handleUploadImages(e.target.files)} disabled={uploading} />
                    </label>
                    <button type="button" onClick={async () => {
                      const text = await navigator.clipboard.readText();
                      setImagesInput(prev => Array.from(new Set([...parseUrls(prev), ...parseUrls(text)])).join(' | '));
                    }} className="bg-slate-100 text-slate-500 px-5 py-2.5 rounded-2xl text-xs font-bold hover:bg-slate-200"><ClipboardPaste size={14} className="inline mr-2"/> لصق</button>
                 </div>
               </div>
               <textarea value={imagesInput} onChange={e => setImagesInput(e.target.value)} rows={2} className="w-full px-6 py-4 rounded-2xl border border-slate-200 text-xs font-mono text-slate-500 outline-none focus:border-secondary-DEFAULT/50 transition-all" placeholder="https://image-link-1.jpg | https://image-link-2.jpg" />
               
               <div className="grid grid-cols-4 sm:grid-cols-6 gap-4 animate-in fade-in duration-500">
                 {parsedUrls.map((url, idx) => (
                   <div key={idx} className="relative aspect-square rounded-[1.25rem] overflow-hidden border-2 border-slate-100 group shadow-sm">
                     <img src={url} className="w-full h-full object-cover" loading="lazy" />
                     <button type="button" onClick={() => setImagesInput(parsedUrls.filter((_, i) => i !== idx).join(' | '))} className="absolute inset-0 bg-red-600/90 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-200"><Trash2 size={20}/></button>
                     {idx === 0 && <div className="absolute top-0 left-0 bg-secondary-DEFAULT text-white text-[8px] px-2 py-1 font-black rounded-br-lg uppercase">Cover</div>}
                   </div>
                 ))}
               </div>
            </div>

            {/* الوصف: مساحة كتابة واسعة وخط مريح */}
            <div className="space-y-3">
               <label className="text-sm font-bold text-slate-700 flex items-center gap-2"><FileText size={20} className="text-secondary-DEFAULT" /> تفاصيل المنتج والوصف</label>
               <textarea name="description" value={formData.description || ''} onChange={handleChange} rows={6} className="w-full px-6 py-5 rounded-[2rem] border border-slate-200 outline-none focus:ring-4 focus:ring-secondary-DEFAULT/5 font-medium text-slate-700 leading-relaxed" placeholder="اكتب تفاصيل المنتج هنا بشكل جذاب..." />
            </div>
          </form>
        </div>

        {/* Footer: أزرار كبيرة وسهلة الضغط */}
        <div className="p-8 border-t bg-slate-50/80 flex justify-end gap-5">
          <Button variant="outline" onClick={onClose} disabled={saving} className="px-8 rounded-2xl font-bold">إلغاء</Button>
          <Button type="submit" form="edit-product-form" disabled={saving || uploading} className="px-14 py-4 rounded-2xl shadow-2xl shadow-secondary-DEFAULT/30 text-base font-black tracking-wide">
            {saving ? 'جاري المزامنة...' : (isCreate ? 'نشر المنتج للمتجر' : 'تحديث البيانات')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default EditProductModal;