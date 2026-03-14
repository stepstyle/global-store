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
  Video as VideoIcon,
  Play,
  Loader2,
  CheckSquare
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

const isValidUrl = (u: string) => /^https?:\/\/.+/i.test(String(u || '').trim());

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
const sanitizeText = (value: string) =>
  String(value ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const clampNumber = (value: unknown, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
};

const compressImage = async (file: File): Promise<File> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1000; 
        const MAX_HEIGHT = 1000; 

        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".webp"), {
                type: 'image/webp',
                lastModified: Date.now(),
              });
              resolve(newFile);
            } else {
              resolve(file); 
            }
          },
          'image/webp',
          0.8
        );
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
};

const SUBCATEGORIES: Record<string, { value: string; labelAr: string; labelEn: string }[]> = {
  Games: [
    { value: 'all-toys', labelAr: 'جميع الألعاب', labelEn: 'All Toys' },
    { value: 'baby-toys', labelAr: 'ألعاب البيبي', labelEn: 'Baby Toys' },
    { value: 'girls-toys', labelAr: 'ألعاب للبنات', labelEn: 'Girls Toys' },
    { value: 'boys-toys', labelAr: 'ألعاب للأولاد', labelEn: 'Boys Toys' },
    { value: 'montessori', labelAr: 'ألعاب منتسوري', labelEn: 'Montessori' },
    { value: 'memory-focus', labelAr: 'الذاكرة والتركيز', labelEn: 'Memory & Focus' },
    { value: 'challenge-iq', labelAr: 'التحدي والذكاء', labelEn: 'Challenge & IQ' },
    { value: 'letters-words', labelAr: 'الحروف والكلمات', labelEn: 'Letters & Words' },
    { value: 'math-numbers', labelAr: 'الرياضيات والحساب', labelEn: 'Math & Numbers' },
    { value: 'science-experiments', labelAr: 'التجارب العلمية', labelEn: 'Science Experiments' },
    { value: 'drawing-coloring', labelAr: 'الرسم والتلوين', labelEn: 'Drawing & Coloring' },
    { value: 'kitchen-toys', labelAr: 'العاب مطابخ', labelEn: 'Kitchen Toys' },
    { value: 'kids-tents', labelAr: 'خيم الاطفال', labelEn: 'Kids Tents' },
    { value: 'audio-books', labelAr: 'الكتب الصوتية', labelEn: 'Audio Books' },
    { value: 'activity-books', labelAr: 'الكتب والانشطة', labelEn: 'Activity Books' },
    { value: 'sensory-toys', labelAr: 'ألعاب حسية', labelEn: 'Sensory Toys' },
    { value: 'building-blocks', labelAr: 'العاب التركيب', labelEn: 'Building Blocks' },
    { value: 'wooden-toys', labelAr: 'ألعاب خشبية', labelEn: 'Wooden Toys' },
    { value: 'magnetic-toys', labelAr: 'الالعاب المغناطيسية', labelEn: 'Magnetic Toys' },
    { value: 'group-games', labelAr: 'العاب جماعية', labelEn: 'Group Games' },
    { value: 'premium-toys', labelAr: 'الالعاب المميزة', labelEn: 'Premium Toys' },
    { value: 'matching-games', labelAr: 'ألعاب التطابق', labelEn: 'Matching Games' },
  ],
  BabyGear: [
    { value: 'bicycles', labelAr: 'بسكليتات', labelEn: 'Bicycles' },
    { value: 'ride-on-cars', labelAr: 'سيارات ركوب', labelEn: 'Ride-on Cars' },
    { value: 'kids-trucks', labelAr: 'شاحنات أطفال', labelEn: 'Kids Trucks' },
    { value: 'scooters', labelAr: 'سكوترات', labelEn: 'Scooters' },
    { value: 'rc-cars', labelAr: 'سيارات التحكم', labelEn: 'RC Cars' },
    { value: 'strollers', labelAr: 'عربيات الأطفال', labelEn: 'Strollers' },
    { value: 'bouncers-rockers', labelAr: 'كراسي هزازة / جلاسات', labelEn: 'Bouncers & Rockers' },
    { value: 'walkers', labelAr: 'مشايات أطفال', labelEn: 'Baby Walkers' },
    { value: 'playmats', labelAr: 'سجاد وفرشات لعب', labelEn: 'Playmats & Gyms' },
  ],
  Stationery: [
    { value: 'school-bags', labelAr: 'حقائب مدرسية', labelEn: 'School Bags' },
    { value: 'pencil-cases', labelAr: 'مقالم / حافظات أقلام', labelEn: 'Pencil Cases' },
    { value: 'lunch-bags', labelAr: 'حقائب طعام / لانش بوكس', labelEn: 'Lunch Bags' },
    { value: 'pens-ballpoint', labelAr: 'أقلام حبر وجاف', labelEn: 'Pens & Ballpoints' },
    { value: 'pencils', labelAr: 'أقلام رصاص', labelEn: 'Pencils' },
    { value: 'colors-markers', labelAr: 'أقلام تلوين وماركرز', labelEn: 'Colors & Markers' },
    { value: 'erasers-sharpeners', labelAr: 'محايات وبرايات', labelEn: 'Erasers & Sharpeners' },
    { value: 'notebooks', labelAr: 'دفاتر مدرسية بجميع الأحجام', labelEn: 'Notebooks' },
    { value: 'drawing-books', labelAr: 'دفاتر رسم وتلوين', labelEn: 'Drawing Books' },
    { value: 'covers-notes', labelAr: 'تجليد وورق ملاحظات', labelEn: 'Covers & Sticky Notes' },
    { value: 'geometry-rulers', labelAr: 'أدوات هندسة ومساطر', labelEn: 'Geometry & Rulers' },
    { value: 'glue-tape', labelAr: 'صمغ ولاصق', labelEn: 'Glue & Tape' },
    { value: 'clay-dough', labelAr: 'صلصال ومعجون', labelEn: 'Clay & Dough' },
    { value: 'safe-scissors', labelAr: 'مقصات آمنة', labelEn: 'Safe Scissors' },
  ],
  Gifts: [
    { value: 'gift-boxes', labelAr: 'صناديق وباكجات هدايا', labelEn: 'Gift Boxes & Bundles' },
    { value: 'wrapping-paper', labelAr: 'ورق تغليف وأكياس', labelEn: 'Wrapping Paper & Bags' },
    { value: 'greeting-cards', labelAr: 'بطاقات تهنئة', labelEn: 'Greeting Cards' },
    { value: 'party-supplies', labelAr: 'مستلزمات حفلات', labelEn: 'Party Supplies' },
  ],
  Offers: [
    { value: 'bundle', labelAr: 'باكج/حزمة', labelEn: 'Bundle' },
    { value: 'discount', labelAr: 'خصم', labelEn: 'Discount' },
    { value: 'clearance', labelAr: 'تصفية', labelEn: 'Clearance' },
  ],
};

const CATEGORY_LABELS: Record<string, { ar: string; en: string }> = {
  Games: { ar: 'الألعاب', en: 'Toys' },
  BabyGear: { ar: 'مستلزمات بيبي وركوب', en: 'Baby Gear & Ride-ons' },
  Stationery: { ar: 'قرطاسية ومدرسية', en: 'Stationery & School' },
  Gifts: { ar: 'الهدايا والمناسبات', en: 'Gifts & Occasions' },
  Offers: { ar: 'العروض والتصفيات', en: 'Offers & Clearance' },
};

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

      const existingSub = cloned.subCategory ?? cloned.subcategory ?? '';
      let parsedSubs: string[] = [];
      if (Array.isArray(existingSub)) {
        parsedSubs = existingSub;
      } else if (typeof existingSub === 'string' && existingSub.trim() !== '') {
        parsedSubs = existingSub.split(',').map(s => s.trim()).filter(Boolean);
      }

      return {
        ...cloned,
        image: cloned.image || imgs[0] || '',
        images: imgs.length > 0 ? imgs : undefined,
        subCategory: parsedSubs, 
        // 🚀 إضافة الحقل الإنجليزي في الداتا المبدئية
        descriptionEn: cloned.descriptionEn || '',
      };
    }

    return {
      id: makeId(),
      name: '',
      nameEn: '',
      price: 0,
      originalPrice: undefined,
      category: 'Games' as Category, 
      subCategory: [], 
      stock: 0,
      description: '',
      descriptionEn: '', // 🚀 تهيئة الحقل الجديد
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
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    if (!isOpen) return;

    const cat = String((formData as any).category || 'Games');
    const list = SUBCATEGORIES[cat] || [];
    const currentSubs = ((formData as any).subCategory as string[]) || [];
    
    const validSubs = currentSubs.filter(sub => list.some(x => x.value === sub));

    if (validSubs.length !== currentSubs.length) {
      setFormData((prev) => ({ ...prev, subCategory: validSubs }));
    }
  }, [(formData as any).category, isOpen]);

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

  const handleSubCategoryToggle = (val: string) => {
    const currentSubs = ((formData as any).subCategory as string[]) || [];
    if (currentSubs.includes(val)) {
      setFormData((prev) => ({ ...prev, subCategory: currentSubs.filter(x => x !== val) }));
    } else {
      setFormData((prev) => ({ ...prev, subCategory: [...currentSubs, val] }));
    }
  };

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
        setImgError('ما في روابط صالحة بالحافظة.');
        return;
      }

      const merged = Array.from(new Set([...parsedUrls, ...urls])).slice(0, 10);
      setImgError('');
      syncImagesFromInput(merged.join(' | '));
    } catch {
      setImgError('المتصفح منع قراءة الحافظة.');
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
        const compressedFile = await compressImage(file);
        const url = await uploadToCloudinary(compressedFile);
        urls.push(url);
      }

      const merged = Array.from(new Set([...parsedUrls, ...urls])).slice(0, 10);
      syncImagesFromInput(merged.join(' | '));
      showToast(`تم رفع ${urls.length} صور بنجاح`, 'success');
    } catch (err: any) {
      const msg = err?.message || 'فشل الرفع';
      setImgError(msg);
      showToast(msg, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleUploadVideo = async (file: File | null) => {
    if (!file) return;
    setUploadingVideo(true);
    try {
      const url = await uploadToCloudinary(file);
      setFormData(prev => ({ ...prev, videoUrl: url }));
      showToast('تم رفع فيديو المنتج بنجاح', 'success');
    } catch (err: any) {
      showToast(err?.message || 'فشل رفع الفيديو', 'error');
    } finally {
      setUploadingVideo(false);
    }
  };

  const removeImageAt = (idx: number) => {
    const next = parsedUrls.filter((_, i) => i !== idx);
    syncImagesFromInput(next.join(' | '));
  };

  const validate = (): boolean => {
    const triggerError = (msg: string) => {
      console.error("Validation Error:", msg);
      if (typeof showToast === 'function') {
        showToast(msg, 'error');
      } else {
        alert(msg); 
      }
      return false;
    };

    const nameEn = sanitizeText(String((formData as any).nameEn || ''));
    const nameAr = sanitizeText(String((formData as any).name || ''));
    const price = Number((formData as any).price ?? 0);
    const originalPrice =
      (formData as any).originalPrice === '' || (formData as any).originalPrice === undefined
        ? undefined
        : Number((formData as any).originalPrice);
    const stock = Number((formData as any).stock ?? 0);
    const videoUrl = String((formData as any).videoUrl || '').trim();

    if (!nameEn && !nameAr) {
      return triggerError('اكتب اسم المنتج (عربي أو انجليزي)');
    }

    if (!Number.isFinite(price) || price <= 0) {
      return triggerError('يرجى إضافة سعر صالح للمنتج (أكبر من صفر)');
    }

    if (!Number.isFinite(stock) || stock < 0) {
      return triggerError('المخزون لا يمكن يكون سالب');
    }

    if (originalPrice !== undefined && (!Number.isFinite(originalPrice) || originalPrice < price)) {
      return triggerError('السعر قبل الخصم يجب أن يكون أكبر أو يساوي السعر الحالي');
    }

    if (
      videoUrl &&
      !(
        isValidUrl(videoUrl) &&
        (
          videoUrl.includes('.mp4') ||
          videoUrl.includes('/video/upload/') ||
          videoUrl.includes('cloudinary')
        )
      )
    ) {
      return triggerError('رابط الفيديو يجب أن يكون رابط فيديو مباشر أو من Cloudinary');
    }

    if (parsedUrls.length === 0 && !String((formData as any).image || '').trim()) {
      return triggerError('يرجى إضافة صورة واحدة على الأقل للمنتج');
    }

    if (!(formData as any).category) {
      return triggerError('اختار الصنف الرئيسي للمنتج');
    }

    return true;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (!validate()) return; 

    setSaving(true);

    try {
      let id = String((formData as any).id || product?.id || makeId());
      if (isCreate && products?.some((p: any) => p.id === id)) {
        id = makeId();
      }

      const subsArray = ((formData as any).subCategory as string[]) || [];
      const finalSubCategory = subsArray.length > 0 ? subsArray.join(',') : undefined;

      const mergedProduct: Product = cleanUndefinedDeep({
        ...(product ?? ({} as Product)),
        ...(formData as Product),
        id,

        category: (((formData as any).category || product?.category || 'Games') as Category),

        subCategory: finalSubCategory,

        name:
          sanitizeText(String((formData as any).name || '')) ||
          sanitizeText(String((formData as any).nameEn || '')),
        nameEn:
          sanitizeText(String((formData as any).nameEn || '')) ||
          sanitizeText(String((formData as any).name || '')),

        description: sanitizeText(String((formData as any).description || product?.description || '')),
        // 🚀 حفظ الوصف الإنجليزي في الداتا
        descriptionEn: sanitizeText(String((formData as any).descriptionEn || (product as any)?.descriptionEn || '')),
        
        details: sanitizeText(String((formData as any).details || product?.details || '')) || undefined,
        brand: sanitizeText(String((formData as any).brand || product?.brand || '')) || undefined,
        videoUrl: String((formData as any).videoUrl || product?.videoUrl || '').trim() || undefined,

        image: String(parsedUrls[0] || (formData as any).image || product?.image || ''),
        images: parsedUrls.length > 0 ? parsedUrls : undefined,

        price: clampNumber((formData as any).price ?? product?.price, 0, 999999),
        stock: Math.round(clampNumber((formData as any).stock ?? product?.stock, 0, 999999)),

        originalPrice:
          (formData as any).originalPrice === '' || (formData as any).originalPrice === undefined
            ? undefined
            : clampNumber((formData as any).originalPrice, 0, 999999),

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

  const selectedCategory = String((formData as any).category || 'Games');
  const subList = SUBCATEGORIES[selectedCategory] || [];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={() => !saving && onClose()}
      />

      <form 
        onSubmit={handleSubmit} 
        className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-300 flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50 shrink-0">
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
          <div className="space-y-6">
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
                  value={String((formData as any).category || 'Games')}
                  onChange={(e) => {
                    const nextCat = e.target.value as Category;
                    setFormData((prev) => ({ ...prev, category: nextCat, subCategory: [] })); 
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-secondary-DEFAULT outline-none"
                >
                  {Object.keys(CATEGORY_LABELS).map((cat) => (
                    <option key={cat} value={cat}>
                      {language === 'ar' ? CATEGORY_LABELS[cat].ar : CATEGORY_LABELS[cat].en}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Checkboxes للفئات الفرعية */}
            <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100">
              <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <CheckSquare size={16} className="text-secondary-DEFAULT" />
                الأصناف الفرعية <span className="text-xs font-normal text-slate-400">(يمكنك اختيار أكثر من صنف)</span>
              </label>
              
              {subList.length === 0 ? (
                <div className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-400 text-sm text-center italic">
                  لا يوجد تصنيفات فرعية متاحة للصنف الرئيسي المختار
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  {subList.map((s) => {
                    const isChecked = (((formData as any).subCategory as string[]) || []).includes(s.value);
                    return (
                      <label 
                        key={s.value} 
                        className={`flex items-center gap-3 cursor-pointer p-3 rounded-xl border transition-all duration-200 ${
                          isChecked ? 'border-secondary-DEFAULT bg-secondary-light/10' : 'border-slate-100 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleSubCategoryToggle(s.value)}
                          className="w-4 h-4 text-secondary-DEFAULT rounded border-slate-300 focus:ring-secondary-DEFAULT focus:ring-offset-0"
                        />
                        <span className={`text-sm font-bold ${isChecked ? 'text-secondary-dark' : 'text-slate-600'}`}>
                          {language === 'ar' ? s.labelAr : s.labelEn}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
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

            {/* Video Section */}
            <div className="bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl relative overflow-hidden group/video mt-6">
              <div className="absolute top-0 right-0 p-8 opacity-10 rotate-12 group-hover/video:rotate-45 transition-transform duration-700">
                <VideoIcon size={120} />
              </div>
              
              <div className="flex flex-col gap-4 mb-6 relative z-10">
                <div>
                  <h3 className="text-base font-black flex items-center gap-2">
                    <VideoIcon size={20} className="text-sky-400" /> فيديو العرض الترويجي
                  </h3>
                  <p className="text-slate-400 text-xs mt-1 font-medium">ارفع فيديو قصير للمنتج، أو الصق رابط MP4 مباشر.</p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3">
                  <label className="cursor-pointer bg-white/10 hover:bg-white/20 border border-white/20 px-5 py-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shrink-0">
                    {uploadingVideo ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} className="fill-current" />}
                    {uploadingVideo ? 'جاري الرفع...' : 'رفع من الجهاز'}
                    <input 
                      type="file" 
                      accept="video/*" 
                      className="hidden" 
                      disabled={uploadingVideo} 
                      onChange={(e) => handleUploadVideo(e.target.files?.[0] || null)} 
                    />
                  </label>

                  <input 
                    type="text" 
                    placeholder="أو الصق رابط الفيديو هنا (https://...mp4)"
                    value={String((formData as any).videoUrl || '')}
                    onChange={(e) => setFormData(prev => ({ ...prev, videoUrl: e.target.value }))}
                    className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 placeholder:text-white/30"
                  />
                </div>
              </div>

              {(formData as any).videoUrl ? (
                <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/40 aspect-video z-10">
                  <video src={formData.videoUrl} className="w-full h-full object-contain" controls muted />
                  <button 
                    type="button" 
                    onClick={() => setFormData(p => ({ ...p, videoUrl: '' }))} 
                    className="absolute top-3 right-3 p-2 bg-red-500 hover:bg-red-600 rounded-full text-white shadow-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ) : (
                <div className="py-10 border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center text-white/30 italic relative z-10">
                  <VideoIcon size={32} strokeWidth={1} className="mb-2" />
                  <span className="text-xs font-bold uppercase tracking-widest">لم يتم إضافة فيديو</span>
                </div>
              )}
            </div>

            {/* Inventory & Price */}
            <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100">
              <h3 className="text-sm font-bold text-blue-800 mb-4 flex items-center gap-2">
                <Tag size={16} /> {t('inventoryPriceDetails')}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">{t('price')} (مطلوب)</label>
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

            {/* Description (Arabic & English) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 🚀 الوصف العربي */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                  <FileText size={16} className="text-secondary-DEFAULT" /> الوصف (عربي)
                </label>
                <textarea
                  name="description"
                  value={String((formData as any).description || '')}
                  onChange={handleChange}
                  rows={6}
                  placeholder="اكتب وصف المنتج باللغة العربية هنا..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-secondary-DEFAULT outline-none resize-none text-right"
                />
              </div>

              {/* 🚀 الوصف الإنجليزي الجديد */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                  <FileText size={16} className="text-sky-500" /> الوصف (إنجليزي)
                </label>
                <textarea
                  name="descriptionEn"
                  value={String((formData as any).descriptionEn || '')}
                  onChange={handleChange}
                  rows={6}
                  placeholder="Write the English description here..."
                  dir="ltr"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-sky-500 outline-none resize-none text-left"
                />
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0">
          <Button variant="outline" onClick={() => !saving && onClose()} type="button" disabled={saving}>
            {t('cancel')}
          </Button>

          <Button
            type="submit"
            className="shadow-lg shadow-secondary-light/20"
            disabled={saving || uploading || uploadingVideo}
          >
            <Save size={18} className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" />
            {saving ? 'جاري الحفظ...' : isCreate ? 'إضافة المنتج' : t('saveChanges')}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default EditProductModal;