// src/pages/AdminAddProduct.tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  CheckSquare,
  Layers,
  Palette,
  Settings2,
  ArrowRight
} from 'lucide-react';
import Button from '../components/Button';
import { Product, Category, ProductVariant } from '../types';
import { useCart } from '../App';
import { uploadToCloudinary } from '../services/cloudinary';
import SEO from '../components/SEO';

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

const VARIANT_TYPES = [
  { value: 'size', ar: 'حجم / مقاس', en: 'Size' },
  { value: 'color', ar: 'لون', en: 'Color' },
  { value: 'weight', ar: 'وزن / جرام', en: 'Weight' },
  { value: 'pages', ar: 'عدد الأوراق', en: 'Pages' },
  { value: 'other', ar: 'أخرى (خيارات عامة)', en: 'Other' },
];

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

// =========================================================
// ✅ Main Component: AdminAddProduct
// =========================================================
const AdminAddProduct: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, showToast, products, addProducts, updateProduct, language, user } = useCart() as any;
  const isAR = language === 'ar';
  
  // التحقق من الأمان (إذا تم الدخول المباشر للرابط)
  const MY_ADMIN_EMAIL = "mohmmedmostakl@gmail.com".toLowerCase();
  useEffect(() => {
    if (!user || user.email?.toLowerCase() !== MY_ADMIN_EMAIL) {
      showToast('أنت غير مصرح لك بدخول هذه الصفحة.', 'error');
      navigate('/');
    }
  }, [user, navigate, showToast]);

  // التحقق إذا كنا في وضع التعديل بناءً على الـ State الممرر بالـ Router
  const editingProductData = location.state?.product as Product | undefined;
  const isCreate = !editingProductData;

  const initialData = useMemo<Partial<Product>>(() => {
    if (editingProductData) {
      const cloned: any = { ...editingProductData };

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
        parsedSubs = existingSub.split(',').map((s: string) => s.trim()).filter(Boolean);
      }

      return {
        ...cloned,
        image: cloned.image || imgs[0] || '',
        images: imgs.length > 0 ? imgs : undefined,
        subCategory: parsedSubs,
        categories: cloned.categories || [cloned.category || 'Games'],
        variants: cloned.variants || [],
        descriptionEn: cloned.descriptionEn || '',
        imagePosition: cloned.imagePosition || { x: 50, y: 50, zoom: 1 }
      };
    }

    return {
      id: makeId(),
      name: '',
      nameEn: '',
      price: 0,
      originalPrice: undefined,
      category: 'Games' as Category,
      categories: ['Games'],
      subCategory: [],
      variants: [],
      stock: 0,
      description: '',
      descriptionEn: '',
      details: '',
      brand: '',
      videoUrl: '',
      isNew: true,
      image: '',
      images: undefined,
      rating: 0,
      reviews: 0,
      imagePosition: { x: 50, y: 50, zoom: 1 }
    };
  }, [editingProductData]);

  const [formData, setFormData] = useState<Partial<Product>>(initialData);
  const [imagesInput, setImagesInput] = useState<string>('');
  const [imgError, setImgError] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsedUrls = useMemo(() => parseUrls(imagesInput), [imagesInput]);

  useEffect(() => {
    const imgs =
      (initialData as any).images && Array.isArray((initialData as any).images) && (initialData as any).images.length > 0
        ? ((initialData as any).images as string[])
        : (initialData as any).image
        ? [String((initialData as any).image)]
        : [];

    setImagesInput(imgs.filter(Boolean).join(' | '));
    setImgError('');
  }, [initialData]);

  useEffect(() => {
    const cat = String((formData as any).category || 'Games');
    const list = SUBCATEGORIES[cat] || [];
    const currentSubs = ((formData as any).subCategory as string[]) || [];

    const validSubs = currentSubs.filter(sub => list.some(x => x.value === sub));

    if (validSubs.length !== currentSubs.length) {
      setFormData((prev) => ({ ...prev, subCategory: validSubs }));
    }
  }, [(formData as any).category]);

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

  const handleExtraCategoryToggle = (catValue: Category) => {
    const currentCats = (formData.categories as Category[]) || [formData.category as Category];
    let nextCats = [...currentCats];

    if (catValue === formData.category) return;

    if (nextCats.includes(catValue)) {
      nextCats = nextCats.filter(c => c !== catValue);
    } else {
      nextCats.push(catValue);
    }
    setFormData((prev) => ({ ...prev, categories: nextCats }));
  };

  const addVariant = () => {
    const currentVariants = formData.variants || [];
    const newVariant: ProductVariant = {
      id: `var_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      label: '',
      type: currentVariants.length > 0 ? currentVariants[0].type : 'color',
      price: formData.price || 0,
      stock: 10,
      colorCode: '#000000',
      colorCode2: '',
      image: '',
    };
    setFormData(prev => ({ ...prev, variants: [...currentVariants, newVariant] }));
  };

  const updateVariant = (index: number, field: keyof ProductVariant, value: any) => {
    const currentVariants = [...(formData.variants || [])];
    currentVariants[index] = { ...currentVariants[index], [field]: value };
    setFormData(prev => ({ ...prev, variants: currentVariants }));
  };

  const removeVariant = (index: number) => {
    const currentVariants = [...(formData.variants || [])];
    currentVariants.splice(index, 1);
    setFormData(prev => ({ ...prev, variants: currentVariants }));
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

    if (!nameEn && !nameAr) return triggerError('اكتب اسم المنتج (عربي أو انجليزي)');
    if (!Number.isFinite(price) || price < 0) return triggerError('يرجى إضافة سعر صالح للمنتج');
    if (!Number.isFinite(stock) || stock < 0) return triggerError('المخزون لا يمكن يكون سالب');
    if (originalPrice !== undefined && (!Number.isFinite(originalPrice) || originalPrice < price)) {
      return triggerError('السعر قبل الخصم يجب أن يكون أكبر أو يساوي السعر الحالي');
    }
    if (
      videoUrl &&
      !(
        isValidUrl(videoUrl) &&
        (videoUrl.includes('.mp4') || videoUrl.includes('/video/upload/') || videoUrl.includes('cloudinary'))
      )
    ) {
      return triggerError('رابط الفيديو يجب أن يكون رابط فيديو مباشر أو من Cloudinary');
    }

    if (parsedUrls.length === 0 && !String((formData as any).image || '').trim()) {
      return triggerError('يرجى إضافة صورة واحدة على الأقل للمنتج');
    }

    if (!(formData as any).category) return triggerError('اختار الصنف الرئيسي للمنتج');

    const currentVariants = formData.variants || [];
    for (let i = 0; i < currentVariants.length; i++) {
      const v = currentVariants[i];
      if (!v.label.trim() && v.type !== 'color') return triggerError(`يرجى كتابة اسم للخيار رقم ${i + 1}`);
      if (Number(v.price) < 0) return triggerError(`سعر الخيار غير صالح`);
    }

    return true;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!validate()) return;

    setSaving(true);

    try {
      let id = String((formData as any).id || editingProductData?.id || makeId());
      if (isCreate && products?.some((p: any) => p.id === id)) {
        id = makeId();
      }

      const subsArray = ((formData as any).subCategory as string[]) || [];
      const finalSubCategory = subsArray.length > 0 ? subsArray.join(',') : undefined;

      const finalCategories = Array.from(new Set([...(formData.categories || []), formData.category as Category]));

      const mergedProduct: Product = cleanUndefinedDeep({
        ...(editingProductData ?? ({} as Product)),
        ...(formData as Product),
        id,

        category: (((formData as any).category || editingProductData?.category || 'Games') as Category),
        categories: finalCategories,
        variants: formData.variants || [],

        subCategory: finalSubCategory,

        name:
          sanitizeText(String((formData as any).name || '')) ||
          sanitizeText(String((formData as any).nameEn || '')),
        nameEn:
          sanitizeText(String((formData as any).nameEn || '')) ||
          sanitizeText(String((formData as any).name || '')),

        description: sanitizeText(String((formData as any).description || editingProductData?.description || '')),
        descriptionEn: sanitizeText(String((formData as any).descriptionEn || (editingProductData as any)?.descriptionEn || '')),

        details: sanitizeText(String((formData as any).details || editingProductData?.details || '')) || undefined,
        brand: sanitizeText(String((formData as any).brand || editingProductData?.brand || '')) || undefined,
        videoUrl: String((formData as any).videoUrl || editingProductData?.videoUrl || '').trim() || undefined,

        image: String(parsedUrls[0] || (formData as any).image || editingProductData?.image || ''),
        images: parsedUrls.length > 0 ? parsedUrls : undefined,

        imagePosition: formData.imagePosition || { x: 50, y: 50, zoom: 1 },

        price: clampNumber((formData as any).price ?? editingProductData?.price, 0, 999999),
        stock: Math.round(clampNumber((formData as any).stock ?? editingProductData?.stock, 0, 999999)),

        originalPrice:
          (formData as any).originalPrice === '' || (formData as any).originalPrice === undefined
            ? undefined
            : clampNumber((formData as any).originalPrice, 0, 999999),

        rating: editingProductData?.rating ?? (formData as any).rating ?? 0,
        reviews: editingProductData?.reviews ?? (formData as any).reviews ?? 0,
      });

      if (isCreate) {
        await addProducts([mergedProduct]);
        showToast(t('created') ?? 'تم إضافة المنتج', 'success');
      } else {
        await updateProduct(mergedProduct);
        showToast(t('updated') ?? 'تم تحديث المنتج', 'success');
      }
      
      // التوجيه للوحة التحكم بعد الحفظ الناجح
      navigate('/admin');

    } catch (err: any) {
      showToast(err?.message || 'فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const selectedCategory = String((formData as any).category || 'Games');
  const subList = SUBCATEGORIES[selectedCategory] || [];
  const currentCategories = formData.categories || [formData.category];
  const currentVariants = formData.variants || [];

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO title={isCreate ? "إضافة منتج جديد" : "تعديل المنتج"} noIndex={true} />

      {/* شريط علوي (Header) مخصص للصفحة */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-4 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => navigate('/admin')} 
              className="p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
              title="العودة للوحة التحكم"
            >
              <ArrowRight size={20} className={isAR ? "" : "rotate-180"} />
            </button>
            <h1 className="text-xl md:text-2xl font-bold text-slate-800 flex items-center gap-2">
              {isCreate ? <PlusCircle className="text-secondary-DEFAULT" /> : <Package className="text-secondary-DEFAULT" />}
              {isCreate ? 'إضافة منتج جديد' : 'تعديل بيانات المنتج'}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => navigate('/admin')} type="button" disabled={saving} className="hidden md:flex px-6 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900">
              إلغاء
            </Button>
            <Button
              onClick={handleSave}
              className="px-6 md:px-8 bg-secondary-DEFAULT hover:bg-secondary-dark text-white rounded-xl shadow-lg shadow-secondary-light/30 transition-all active:scale-95"
              disabled={saving || uploading || uploadingVideo}
            >
              {saving ? (
                <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> جاري الحفظ...</span>
              ) : (
                <span className="flex items-center gap-2"><Save size={18} /> {isCreate ? 'حفظ وإضافة للمتجر' : 'حفظ التعديلات'}</span>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 lg:px-8 mt-8">
        <form onSubmit={handleSave} className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          
          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-100">
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
          </div>

          {/* التصنيفات */}
          <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
              <Layers size={20} className="text-secondary-DEFAULT" /> التصنيفات والأقسام
            </h3>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-slate-50 p-6 rounded-2xl border border-slate-100">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">الصنف الرئيسي (يحدد الأقسام الفرعية)</label>
                <select
                  name="category"
                  value={selectedCategory}
                  onChange={(e) => {
                    const nextCat = e.target.value as Category;
                    setFormData((prev) => ({ 
                      ...prev, 
                      category: nextCat, 
                      categories: Array.from(new Set([...(prev.categories || []), nextCat])),
                      subCategory: [] 
                    })); 
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-secondary-DEFAULT outline-none font-bold text-slate-800"
                >
                  {Object.keys(CATEGORY_LABELS).map((cat) => (
                    <option key={cat} value={cat}>
                      {language === 'ar' ? CATEGORY_LABELS[cat].ar : CATEGORY_LABELS[cat].en}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">أقسام إضافية (أين يظهر أيضاً؟)</label>
                <div className="flex flex-wrap gap-2 mt-3">
                  {Object.keys(CATEGORY_LABELS).map((cat) => {
                    const isMain = cat === selectedCategory;
                    const isSelected = currentCategories.includes(cat as Category);
                    return (
                      <label 
                        key={`extra-${cat}`} 
                        className={`
                          px-4 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer border
                          ${isMain ? 'bg-secondary-DEFAULT text-white border-secondary-DEFAULT cursor-not-allowed opacity-70' : 
                            isSelected ? 'bg-sky-100 text-sky-800 border-sky-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}
                        `}
                        title={isMain ? "هذا هو الصنف الرئيسي" : "اضغط لاختيار/إلغاء"}
                      >
                        <input 
                          type="checkbox" 
                          className="hidden" 
                          disabled={isMain}
                          checked={isSelected}
                          onChange={() => handleExtraCategoryToggle(cat as Category)}
                        />
                        {language === 'ar' ? CATEGORY_LABELS[cat].ar : CATEGORY_LABELS[cat].en}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Subcategories Checkboxes */}
            {subList.length > 0 && (
              <div className="mt-6">
                <label className="block text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                  <CheckSquare size={16} className="text-secondary-DEFAULT" />
                  الأقسام الفرعية التابعة لـ ({language === 'ar' ? CATEGORY_LABELS[selectedCategory]?.ar : CATEGORY_LABELS[selectedCategory]?.en})
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {subList.map((s) => {
                    const isChecked = (((formData as any).subCategory as string[]) || []).includes(s.value);
                    return (
                      <label 
                        key={s.value} 
                        className={`flex items-center gap-3 cursor-pointer p-3 rounded-xl border transition-all duration-200 ${
                          isChecked ? 'border-secondary-DEFAULT bg-secondary-light/10 shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleSubCategoryToggle(s.value)}
                          className="w-5 h-5 text-secondary-DEFAULT rounded border-slate-300 focus:ring-secondary-DEFAULT"
                        />
                        <span className={`text-sm font-bold line-clamp-1 ${isChecked ? 'text-secondary-dark' : 'text-slate-600'}`}>
                          {language === 'ar' ? s.labelAr : s.labelEn}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* السعر والمخزون الأساسي */}
          <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
              <Tag size={20} className="text-sky-500" /> السعر الأساسي والمخزون
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-sky-50/30 p-6 rounded-2xl border border-sky-100">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">{t('price')} (مطلوب)</label>
                <div className="relative">
                  <DollarSign size={18} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    type="number"
                    name="price"
                    value={Number((formData as any).price ?? 0)}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-sky-500 outline-none text-lg font-bold text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">{t('originalPriceOptional')}</label>
                <div className="relative">
                  <DollarSign size={18} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    type="number"
                    name="originalPrice"
                    value={((formData as any).originalPrice ?? '') as any}
                    onChange={handleChange}
                    placeholder={t('optional')}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-sky-500 outline-none text-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">{t('currentStock')}</label>
                <div className="relative">
                  <Package size={18} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    type="number"
                    name="stock"
                    value={Number((formData as any).stock ?? 0)}
                    onChange={handleChange}
                    className={`w-full pl-10 pr-4 py-3 rounded-xl border focus:ring-2 outline-none text-lg font-bold ${
                      Number((formData as any).stock ?? 0) < 10
                        ? 'border-red-300 text-red-600 bg-red-50 focus:ring-red-200'
                        : 'border-slate-200 focus:ring-sky-500 bg-white'
                    }`}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* محرك الخيارات */}
          <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Palette size={20} className="text-amber-500" /> الخيارات (ألوان مدمجة، أحجام، إلخ...)
                </h3>
                <p className="text-sm text-slate-500 mt-1">يمكنك ترك حقل "اسم الخيار" فارغاً للألوان لتظهر الدائرة الملونة فقط.</p>
              </div>
              <Button 
                type="button" 
                onClick={addVariant} 
                className="bg-amber-100 text-amber-800 hover:bg-amber-200 hover:text-amber-900 border border-amber-200 shadow-none px-5 py-2 whitespace-nowrap"
              >
                <PlusCircle size={18} className="mr-2 rtl:mr-0 rtl:ml-2" /> إضافة خيار جديد
              </Button>
            </div>

            <div className="bg-amber-50/30 p-6 rounded-2xl border border-amber-100">
              {currentVariants.length > 0 ? (
                <div className="space-y-4">
                  {currentVariants.map((variant, idx) => (
                    <div key={variant.id} className="bg-white p-6 rounded-2xl border border-slate-200 animate-in slide-in-from-top-2 relative shadow-sm hover:shadow-md transition-all">
                      <button type="button" onClick={() => removeVariant(idx)} className="absolute top-4 right-4 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors z-10">
                        <Trash2 size={18} />
                      </button>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 pr-10">
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-600">النوع</label>
                          <select value={variant.type} onChange={(e) => updateVariant(idx, 'type', e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 outline-none text-sm bg-slate-50">
                            {VARIANT_TYPES.map(t => ( <option key={t.value} value={t.value}>{isAR ? t.ar : t.en}</option> ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-600">اسم الخيار {variant.type === 'color' && '(اختياري)'}</label>
                          <input type="text" value={variant.label} onChange={(e) => updateVariant(idx, 'label', e.target.value)} placeholder="مثال: كبير، 10 سم..." className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-amber-400 outline-none text-sm bg-slate-50 focus:bg-white" />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-600">السعر الدقيق (JOD)</label>
                          <input type="number" value={variant.price} onChange={(e) => updateVariant(idx, 'price', Number(e.target.value))} className="w-full px-4 py-3 rounded-xl border border-slate-200 outline-none text-sm font-bold bg-slate-50" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-600">المخزون المتوفر</label>
                          <input type="number" value={variant.stock} onChange={(e) => updateVariant(idx, 'stock', Number(e.target.value))} className="w-full px-4 py-3 rounded-xl border border-slate-200 outline-none text-sm font-bold bg-slate-50" />
                        </div>
                      </div>

                      {variant.type === 'color' && (
                        <div className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-5">
                          <div className="flex items-center gap-5 bg-slate-50 p-4 rounded-xl border border-slate-200">
                            <div>
                              <p className="text-sm font-bold text-slate-600 mb-2">لون 1 (أساسي)</p>
                              <input type="color" value={variant.colorCode || '#000000'} onChange={(e) => updateVariant(idx, 'colorCode', e.target.value)} className="w-12 h-12 rounded-lg cursor-pointer p-0 border-0 shadow-sm" />
                            </div>
                            <div className="w-px h-12 bg-slate-200 mx-2"></div>
                            <div>
                              <p className="text-sm font-bold text-slate-600 mb-2">لون 2 (دمج / اختياري)</p>
                              <div className="flex gap-2 items-center">
                                <input type="color" value={variant.colorCode2 || '#ffffff'} onChange={(e) => updateVariant(idx, 'colorCode2', e.target.value)} className="w-12 h-12 rounded-lg cursor-pointer p-0 border-0 shadow-sm" />
                                {variant.colorCode2 && (
                                  <button type="button" onClick={() => updateVariant(idx, 'colorCode2', undefined)} className="text-xs text-red-500 font-bold px-3 py-2 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">إزالة</button>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-center">
                            <p className="text-sm font-bold text-slate-600 mb-2">صورة مخصصة لهذا الخيار (اختياري)</p>
                            <input type="text" value={variant.image || ''} onChange={(e) => updateVariant(idx, 'image', e.target.value)} placeholder="رابط الصورة التي ستظهر عند اختيار هذا اللون..." className="w-full px-4 py-3 rounded-xl border border-slate-200 outline-none text-sm bg-white" />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 bg-white/60 rounded-2xl border-2 border-dashed border-amber-200">
                  <p className="text-sm text-amber-700 font-bold">هذا المنتج يعتمد على السعر الأساسي والمخزون الأساسي فقط.</p>
                  <p className="text-xs text-amber-600 mt-2">أضف خيارات إذا كان للمنتج أحجام أو ألوان مختلفة.</p>
                </div>
              )}
            </div>
          </div>

          {/* الصور */}
          <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <ImageIcon size={20} className="text-indigo-500" /> صور المنتج والفيديو
              </h3>

              <div className="flex gap-2">
                <label className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 cursor-pointer shadow-sm transition-all">
                  <Upload size={16} />
                  {uploading ? 'جاري الرفع...' : 'رفع من الجهاز'}
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
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-200 shadow-sm transition-all"
                >
                  <ClipboardPaste size={16} />
                  لصق روابط
                </button>
              </div>
            </div>

            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
              <textarea
                value={imagesInput}
                onChange={(e) => syncImagesFromInput(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-400 outline-none text-sm mb-4"
                placeholder="روابط الصور مفصولة بـ | (أول رابط هو الصورة الرئيسية للمنتج)"
                dir="ltr"
              />
              {imgError && <div className="mb-4 text-sm font-bold text-red-600">{imgError}</div>}

              {/* تحكم بإحداثيات الصورة الرئيسية */}
              {(formData.image || parsedUrls.length > 0) && (
                <div className="mb-8 bg-white p-6 rounded-2xl border border-indigo-100 flex flex-col lg:flex-row gap-8 items-center shadow-inner">
                  <div className="flex-1 w-full space-y-6">
                    <h4 className="text-base font-black text-indigo-900 flex items-center gap-2">
                      <Settings2 size={18} className="text-indigo-500"/> ضبط إطار الصورة الرئيسية
                    </h4>
                    
                    <div className="space-y-5 bg-slate-50 p-5 rounded-xl border border-slate-100">
                      <div>
                        <div className="flex justify-between text-sm font-bold text-slate-700 mb-2">
                          <span>التقريب (Zoom)</span>
                          <span className="bg-white px-2 py-0.5 rounded border border-slate-200">{formData.imagePosition?.zoom || 1}x</span>
                        </div>
                        <input type="range" min="0.5" max="3" step="0.1" value={formData.imagePosition?.zoom || 1} onChange={(e) => setFormData(p => ({...p, imagePosition: {...(p.imagePosition || {x:50,y:50,zoom:1}), zoom: parseFloat(e.target.value)}}))} className="w-full accent-indigo-500 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                      </div>

                      <div>
                        <div className="flex justify-between text-sm font-bold text-slate-700 mb-2">
                          <span>المحور الأفقي (X)</span>
                          <span className="bg-white px-2 py-0.5 rounded border border-slate-200">{formData.imagePosition?.x || 50}%</span>
                        </div>
                        <input type="range" min="0" max="100" step="1" value={formData.imagePosition?.x || 50} onChange={(e) => setFormData(p => ({...p, imagePosition: {...(p.imagePosition || {x:50,y:50,zoom:1}), x: parseInt(e.target.value)}}))} className="w-full accent-indigo-500 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                      </div>

                      <div>
                        <div className="flex justify-between text-sm font-bold text-slate-700 mb-2">
                          <span>المحور العمودي (Y)</span>
                          <span className="bg-white px-2 py-0.5 rounded border border-slate-200">{formData.imagePosition?.y || 50}%</span>
                        </div>
                        <input type="range" min="0" max="100" step="1" value={formData.imagePosition?.y || 50} onChange={(e) => setFormData(p => ({...p, imagePosition: {...(p.imagePosition || {x:50,y:50,zoom:1}), y: parseInt(e.target.value)}}))} className="w-full accent-indigo-500 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                      </div>
                    </div>
                  </div>

                  <div className="w-48 h-48 shrink-0 rounded-2xl border-4 border-white ring-1 ring-slate-200 overflow-hidden relative shadow-lg bg-white">
                    <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] -z-10" />
                    <img 
                      src={formData.image || parsedUrls[0]} 
                      alt="Preview" 
                      className="absolute inset-0 w-full h-full"
                      style={{
                        objectFit: 'cover',
                        objectPosition: `${formData.imagePosition?.x || 50}% ${formData.imagePosition?.y || 50}%`,
                        transform: `scale(${formData.imagePosition?.zoom || 1})`,
                        transformOrigin: 'center'
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Thumbnails */}
              {parsedUrls.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
                  {parsedUrls.map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      className="relative rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm aspect-square group"
                    >
                      <img src={url} alt={`img-${idx}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                      <button
                        type="button"
                        onClick={() => removeImageAt(idx)}
                        className="absolute top-2 right-2 p-2 rounded-xl bg-white/90 hover:bg-red-50 text-red-500 shadow-sm opacity-0 group-hover:opacity-100 transition-all"
                        title="حذف الصورة"
                      >
                        <Trash2 size={16} />
                      </button>
                      {idx === 0 && (
                        <div className="absolute bottom-0 left-0 w-full bg-indigo-600/90 backdrop-blur-sm text-white text-[11px] font-bold text-center py-1.5">
                          الرئيسية
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Video Section */}
            <div className="mt-8 bg-slate-900 p-6 md:p-8 rounded-3xl text-white shadow-xl relative overflow-hidden group/video">
              <div className="absolute top-0 right-0 p-8 opacity-10 rotate-12 group-hover/video:rotate-45 transition-transform duration-700 pointer-events-none">
                <VideoIcon size={150} />
              </div>
              
              <div className="relative z-10">
                <div className="mb-6">
                  <h3 className="text-lg font-black flex items-center gap-2">
                    <VideoIcon size={24} className="text-sky-400" /> فيديو العرض الترويجي
                  </h3>
                  <p className="text-slate-400 text-sm mt-1 font-medium">ارفع فيديو قصير للمنتج، أو الصق رابط مباشر لجذب المزيد من المبيعات.</p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4 mb-6">
                  <label className="cursor-pointer bg-white/10 hover:bg-white/20 border border-white/20 px-6 py-4 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2 shrink-0">
                    {uploadingVideo ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} className="fill-current" />}
                    {uploadingVideo ? 'جاري الرفع...' : 'رفع فيديو من الجهاز'}
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
                    className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-4 text-sm text-white outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 placeholder:text-white/40"
                    dir="ltr"
                  />
                </div>

                {(formData as any).videoUrl && (
                  <div className="relative rounded-2xl overflow-hidden border border-white/20 bg-black/60 aspect-video z-10 max-w-2xl mx-auto shadow-2xl">
                    <video src={(formData as any).videoUrl} className="w-full h-full object-contain" controls muted />
                    <button 
                      type="button" 
                      onClick={() => setFormData(p => ({ ...p, videoUrl: '' }))} 
                      className="absolute top-4 right-4 p-2 bg-red-500 hover:bg-red-600 rounded-full text-white shadow-lg transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-100">
            <div className="mb-6">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-1">
                <FileText size={20} className="text-emerald-500" /> تفاصيل ووصف المنتج
              </h3>
              <p className="text-sm text-slate-500">اكتب النقاط مفصولة بعلامة الناقص (-) أو النجمة (*) لتظهر كقائمة منسقة للزبون.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-6 rounded-2xl border border-slate-100">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">الوصف (عربي)</label>
                <textarea
                  name="description"
                  value={String((formData as any).description || '')}
                  onChange={handleChange}
                  rows={8}
                  placeholder="مثال:&#10;- منتج عالي الجودة ومناسب للأطفال&#10;- ألوان ثابتة لا تتغير مع الوقت"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none resize-none text-right"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">الوصف (إنجليزي)</label>
                <textarea
                  name="descriptionEn"
                  value={String((formData as any).descriptionEn || '')}
                  onChange={handleChange}
                  rows={8}
                  placeholder="Example:&#10;- High quality product for kids&#10;- Vivid and durable colors"
                  dir="ltr"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none resize-none text-left"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 pb-8">
            <Button
              type="submit"
              className="px-10 py-4 text-lg bg-secondary-DEFAULT hover:bg-secondary-dark text-white rounded-2xl shadow-xl shadow-secondary-light/30 transition-all active:scale-95 w-full md:w-auto"
              disabled={saving || uploading || uploadingVideo}
            >
              {saving ? (
                <span className="flex items-center gap-2"><Loader2 size={24} className="animate-spin" /> جاري الحفظ والتطبيق...</span>
              ) : (
                <span className="flex items-center gap-2"><Save size={24} /> {isCreate ? 'حفظ ونشر المنتج' : 'حفظ جميع التعديلات'}</span>
              )}
            </Button>
          </div>

        </form>
      </div>
    </div>
  );
};

export default AdminAddProduct;