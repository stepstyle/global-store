// src/pages/Checkout.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useCart } from '../App';
import Button from '../components/Button';
import {
  CheckCircle,
  Truck,
  MapPin,
  Shield,
  DollarSign,
  Smartphone,
  Upload,
  ShoppingBag,
  Mail,
  Phone,
  CalendarClock,
} from 'lucide-react';
import * as ReactRouterDOM from 'react-router-dom';
import { db } from '../services/storage';
import { Order, Product } from '../types';
import SEO from '../components/SEO';
import LazyImage from '../components/LazyImage';
import { uploadToCloudinary } from '../services/cloudinary';

const { useNavigate } = ReactRouterDOM as any;

type PaymentMethod = 'cod' | 'cliq';

const safeTrim = (s: any) => String(s ?? '').trim();

const clampQty = (n: any) => {
  const x = Math.round(Number(n) || 1);
  return Math.max(1, Math.min(99, x));
};

const JO_COUNTRY = { code: 'JO', nameAr: 'الأردن', nameEn: 'Jordan' };

const JO_GOVS: Array<{ slug: string; ar: string; en: string }> = [
  { slug: 'amman', ar: 'عمّان', en: 'Amman' },
  { slug: 'zarqa', ar: 'الزرقاء', en: 'Zarqa' },
  { slug: 'irbid', ar: 'إربد', en: 'Irbid' },
  { slug: 'ajloun', ar: 'عجلون', en: 'Ajloun' },
  { slug: 'jerash', ar: 'جرش', en: 'Jerash' },
  { slug: 'mafraq', ar: 'المفرق', en: 'Mafraq' },
  { slug: 'balqa', ar: 'البلقاء', en: 'Balqa' },
  { slug: 'madaba', ar: 'مادبا', en: 'Madaba' },
  { slug: 'karak', ar: 'الكرك', en: 'Karak' },
  { slug: 'tafilah', ar: 'الطفيلة', en: 'Tafilah' },
  { slug: 'maan', ar: 'معان', en: "Ma'an" },
  { slug: 'aqaba', ar: 'العقبة', en: 'Aqaba' },
];

type DialOption = { code: string; dial: string; flag: string; nameAr: string; nameEn: string };
const DIAL_OPTIONS: DialOption[] = [
  { code: 'JO', dial: '+962', flag: '🇯🇴', nameAr: 'الأردن', nameEn: 'Jordan' },
  { code: 'PS', dial: '+970', flag: '🇵🇸', nameAr: 'فلسطين', nameEn: 'Palestine' },
  { code: 'AE', dial: '+971', flag: '🇦🇪', nameAr: 'الإمارات', nameEn: 'UAE' },
  { code: 'SA', dial: '+966', flag: '🇸🇦', nameAr: 'السعودية', nameEn: 'Saudi Arabia' },
  { code: 'EG', dial: '+20', flag: '🇪🇬', nameAr: 'مصر', nameEn: 'Egypt' },
  { code: 'IQ', dial: '+964', flag: '🇮🇶', nameAr: 'العراق', nameEn: 'Iraq' },
  { code: 'KW', dial: '+965', flag: '🇰🇼', nameAr: 'الكويت', nameEn: 'Kuwait' },
  { code: 'QA', dial: '+974', flag: '🇶🇦', nameAr: 'قطر', nameEn: 'Qatar' },
  { code: 'BH', dial: '+973', flag: '🇧🇭', nameAr: 'البحرين', nameEn: 'Bahrain' },
  { code: 'TR', dial: '+90', flag: '🇹🇷', nameAr: 'تركيا', nameEn: 'Turkey' },
  { code: 'US', dial: '+1', flag: '🇺🇸', nameAr: 'أمريكا', nameEn: 'United States' },
  { code: 'GB', dial: '+44', flag: '🇬🇧', nameAr: 'بريطانيا', nameEn: 'United Kingdom' },
];

type ShippingMethod = {
  id: string;
  nameAr: string;
  nameEn: string;
  durationAr: string;
  durationEn: string;
  price: number;
  icon?: any;
};

const CHECKOUT_SHIPPING_METHODS: ShippingMethod[] = [
  {
    id: 'jo_fast_12_24',
    nameAr: 'توصيل سريع (محلي)',
    nameEn: 'Fast delivery (Local)',
    durationAr: 'خلال 12–24 ساعة',
    durationEn: 'Within 12–24 hours',
    price: 2.5,
    icon: Truck,
  },
  {
    id: 'jo_govs_24_48',
    nameAr: 'توصيل المحافظات',
    nameEn: 'Governorates delivery',
    durationAr: 'خلال 24–48 ساعة',
    durationEn: 'Within 24–48 hours',
    price: 3.5,
    icon: Truck,
  },
  {
    id: 'jo_schedule',
    nameAr: 'تحديد موعد التوصيل',
    nameEn: 'Schedule delivery',
    durationAr: 'اختر التاريخ والوقت المناسبين',
    durationEn: 'Choose your preferred date & time',
    price: 4.0,
    icon: CalendarClock,
  },
];

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeName = (name: string) => safeTrim(name).replace(/\s+/g, ' ');
const normalizeAddress = (addr: string) => safeTrim(addr).replace(/\s+/g, ' ');
const digitsOnly = (s: string) => String(s ?? '').replace(/[^\d]/g, '');

const normalizePhoneGlobal = (dial: string, local: string) => {
  const d = String(dial || '').trim();
  const num = digitsOnly(local);
  if (!d || !num) return '';
  return `${d}${num}`;
};

const makeOrderId = () => {
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  const uuid = (globalThis as any)?.crypto?.randomUUID?.();
  if (uuid) return `ORD-${uuid.split('-')[0].toUpperCase()}-${ts}`;
  return `ORD-${ts}-${rnd}`;
};

const Checkout: React.FC = () => {
  const {
    cart,
    products, // 🛡️ تم الاستدعاء للمقارنة الأمنية
    t,
    showToast,
    getProductTitle,
    clearCart,
    user,
    refreshProducts,
    language,
    orderNote,
    setOrderNote,
    clearOrderNote,
  } = useCart() as any;

  const navigate = useNavigate();
  const isAR = language === 'ar';

  const tr = (ar: string, en: string) => (isAR ? ar : en);

  const tt = (key: string, fallbackAr: string, fallbackEn: string) => {
    try {
      const out = t(key as any);
      if (!out || String(out) === key) return tr(fallbackAr, fallbackEn);
      return String(out);
    } catch {
      return tr(fallbackAr, fallbackEn);
    }
  };

  const [step, setStep] = useState(1);
  const [shippingMethodId, setShippingMethodId] = useState<string>(CHECKOUT_SHIPPING_METHODS[0]!.id);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [isProcessing, setIsProcessing] = useState(false);

  const [email, setEmail] = useState<string>(() => safeTrim(user?.email || ''));
  useEffect(() => {
    const uEmail = safeTrim(user?.email || '');
    if (uEmail && !safeTrim(email)) setEmail(uEmail);
  }, [user?.email]);

  const [dialCode, setDialCode] = useState<string>(() => '+962');

  const [cliqRef, setCliqRef] = useState('');
  const [cliqReceiptPreview, setCliqReceiptPreview] = useState<string>('');
  const [cliqReceiptUrl, setCliqReceiptUrl] = useState<string>('');

  const [formData, setFormData] = useState({
    fullName: '',
    country: JO_COUNTRY.nameEn,
    citySlug: '',
    streetAddress: '',
    postalCode: '',
    phoneLocal: '',
    saveInfo: true,
    billingSameAsShipping: true,
    billingFullName: '',
    billingCitySlug: '',
    billingStreetAddress: '',
    billingPhoneLocal: '',
    billingPostalCode: '',
  });

  const [preferredDeliveryDate, setPreferredDeliveryDate] = useState('');
  const [preferredDeliveryTime, setPreferredDeliveryTime] = useState('');
  const [acceptPolicies, setAcceptPolicies] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const changeStep = (newStep: number) => {
    setStep(newStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(isAR ? 'ar-JO' : 'en-JO', {
        style: 'currency',
        currency: 'JOD',
        maximumFractionDigits: 2,
      });
    } catch {
      return null;
    }
  }, [isAR]);

  const formatMoney = (value: number) =>
    fmt ? fmt.format(value) : `JOD ${Number(value || 0).toFixed(2)}`;

  const selectedShipping = useMemo(
    () => CHECKOUT_SHIPPING_METHODS.find((m) => m.id === shippingMethodId),
    [shippingMethodId]
  );

  // ==========================================
  // 🛡️ حسابات التسعير والأمان الموثوقة (Security Layer)
  // ==========================================
  const validatedCart = useMemo(() => {
    const safeCart = Array.isArray(cart) ? cart : [];
    return safeCart.map((cartItem: any) => {
      const realProduct = products.find((p: Product) => p.id === cartItem.id);
      return {
        ...cartItem,
        // نعتمد السعر الأصلي من الداتا بيز لمنع التلاعب
        price: realProduct ? realProduct.price : cartItem.price,
        stock: realProduct ? realProduct.stock : cartItem.stock,
      };
    });
  }, [cart, products]);

  const subtotal = useMemo(
    () =>
      validatedCart.reduce((sum: number, item: any) => {
        const price = Number(item.price || 0);
        const qty = clampQty(item.quantity);
        return sum + price * qty;
      }, 0),
    [validatedCart]
  );

  const totalItems = useMemo(
    () => validatedCart.reduce((sum: number, item: any) => sum + clampQty(item.quantity), 0),
    [validatedCart]
  );

  const discountAmount = useMemo(
    () => (totalItems > 2 ? subtotal * 0.1 : 0),
    [subtotal, totalItems]
  );

  const shippingCost = selectedShipping ? Number(selectedShipping.price || 0) : 0;
  const total = Math.max(0, subtotal - discountAmount + shippingCost);

  const cityLabel = (slug: string) => {
    const c = JO_GOVS.find((x) => x.slug === slug);
    return c ? (isAR ? c.ar : c.en) : '';
  };

  const setField = (key: string, value: any) => {
    setFormData((p) => ({ ...p, [key]: value }));
    setErrors((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
  };

  const setEmailField = (value: string) => {
    setEmail(value);
    setErrors((p) => {
      const next = { ...p };
      delete next.email;
      return next;
    });
  };

  const validateStep1 = () => {
    const nextErr: Record<string, string> = {};
    const needEmail = !user?.id;
    const e = safeTrim(email);

    if (needEmail && !e) {
      nextErr.email = tt('emailRequired', 'البريد الإلكتروني مطلوب', 'Email is required.');
    } else if (e && !emailRegex.test(e)) {
      nextErr.email = tt('emailInvalid', 'البريد الإلكتروني غير صحيح', 'Invalid email address.');
    }

    const name = normalizeName(formData.fullName);
    if (name.length < 5) {
      nextErr.fullName = tt('nameMin5', 'الاسم يجب أن يكون 5 أحرف على الأقل', 'Name must be at least 5 characters.');
    }

    if (!safeTrim(formData.country)) {
      nextErr.country = tt('countryRequired', 'الدولة مطلوبة', 'Country is required.');
    }

    if (!safeTrim(formData.citySlug)) {
      nextErr.citySlug = tt('cityRequired', 'المدينة مطلوبة', 'City is required.');
    }

    const addr = normalizeAddress(formData.streetAddress);
    if (addr.length < 8) {
      nextErr.streetAddress = tt(
        'addressMin8',
        'يرجى كتابة العنوان بالتفصيل (8 أحرف على الأقل)',
        'Please write a detailed address (at least 8 characters).'
      );
    }

    const e164 = normalizePhoneGlobal(dialCode, formData.phoneLocal);
    if (!e164) {
      nextErr.phoneLocal = tt('phoneInvalid', 'رقم الهاتف غير صحيح', 'Invalid phone number.');
    } else if (digitsOnly(formData.phoneLocal).length < 6) {
      nextErr.phoneLocal = tt('phoneTooShort', 'رقم الهاتف قصير جداً', 'Phone number is too short.');
    }

    if (shippingMethodId === 'jo_schedule') {
      if (!safeTrim(preferredDeliveryDate)) {
        nextErr.preferredDeliveryDate = tt('dateRequired', 'التاريخ مطلوب', 'Date is required.');
      }
      if (!safeTrim(preferredDeliveryTime)) {
        nextErr.preferredDeliveryTime = tt('timeRequired', 'الوقت مطلوب', 'Time is required.');
      }
    }

    if (!acceptPolicies) {
      nextErr.acceptPolicies = tt(
        'acceptPoliciesRequired',
        'يجب الموافقة على سياسات المتجر لإتمام الطلب',
        'You must accept the store policies to place the order.'
      );
    }

    if (!formData.billingSameAsShipping) {
      const bn = normalizeName(formData.billingFullName);
      if (bn.length < 5) {
        nextErr.billingFullName = tt(
          'billingNameMin5',
          'اسم الفاتورة يجب أن يكون 5 أحرف على الأقل',
          'Billing name must be at least 5 characters.'
        );
      }

      if (!safeTrim(formData.billingCitySlug)) {
        nextErr.billingCitySlug = tt(
          'billingCityRequired',
          'مدينة الفاتورة مطلوبة',
          'Billing city is required.'
        );
      }

      const ba = normalizeAddress(formData.billingStreetAddress);
      if (ba.length < 8) {
        nextErr.billingStreetAddress = tt(
          'billingAddressMin8',
          'عنوان الفاتورة بالتفصيل (8 أحرف على الأقل)',
          'Billing address must be detailed (at least 8 characters).'
        );
      }

      const bE164 = normalizePhoneGlobal(dialCode, formData.billingPhoneLocal);
      if (!bE164) {
        nextErr.billingPhoneLocal = tt(
          'billingPhoneInvalid',
          'رقم هاتف الفاتورة غير صحيح',
          'Invalid billing phone.'
        );
      }
    }

    setErrors(nextErr);
    return Object.keys(nextErr).length === 0;
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleCliqReceiptPick = async (file: File | null) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast(tt('invalidImage', 'الرجاء رفع صورة صالحة', 'Please upload a valid image file.'), 'error');
      return;
    }

    const maxBytes = 2.5 * 1024 * 1024;
    if (file.size > maxBytes) {
      showToast(
        tt('imageTooLarge', 'حجم الصورة كبير جداً. الحد الأقصى 2.5MB', 'Image is too large. Maximum size is 2.5MB.'),
        'error'
      );
      return;
    }

    try {
      const preview = await readFileAsDataUrl(file);
      setCliqReceiptPreview(preview);

      const url = await uploadToCloudinary(file);
      setCliqReceiptUrl(url);

      showToast(tt('uploaded', 'تم رفع الإيصال بنجاح', 'Receipt uploaded successfully.'), 'success');
    } catch {
      setCliqReceiptUrl('');
      showToast(tt('uploadFailed', 'فشل الرفع، يرجى المحاولة مرة أخرى', 'Upload failed. Please try again.'), 'error');
    }
  };

  const goToShipping = () => {
    const ok = validateStep1();
    if (!ok) {
      showToast(tt('fixErrors', 'يرجى تصحيح الحقول المطلوبة', 'Please fix the required fields.'), 'error');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    changeStep(2);
  };

  const handlePlaceOrder = async () => {
    if (isProcessing) return;

    if (!Array.isArray(validatedCart) || validatedCart.length === 0) {
      showToast(tt('cartEmpty', 'سلتك فارغة', 'Your cart is empty'), 'error');
      return;
    }

    // 🛡️ فحص نهائي للمخزون قبل إرسال الطلب (Final Stock Check)
    const outOfStockItems = validatedCart.filter(item => item.stock !== undefined && item.quantity > item.stock);
    if (outOfStockItems.length > 0) {
      showToast(
        tr('عذراً، لقد نفدت كمية بعض المنتجات من المخزون للتو. يرجى مراجعة السلة.', 'Sorry, some items just went out of stock. Please check your cart.'),
        'error'
      );
      navigate('/cart');
      return;
    }

    const ok = validateStep1();
    if (!ok) {
      showToast(tt('fixErrors', 'يرجى تصحيح الحقول المطلوبة', 'Please fix the required fields.'), 'error');
      changeStep(1);
      return;
    }

    if (!selectedShipping) {
      showToast(
        tt('shippingRequired', 'يرجى اختيار طريقة التوصيل أولاً', 'Please select a shipping method first.'),
        'error'
      );
      changeStep(2);
      return;
    }

    if (paymentMethod === 'cliq') {
      const ref = safeTrim(cliqRef);

      if (!ref) {
        showToast(
          tt('enterCliqRef', 'يرجى إدخال الرقم المرجعي لحوالة CliQ', 'Please enter the CliQ reference number.'),
          'error'
        );
        return;
      }

      if (ref.length < 4 || ref.length > 40) {
        showToast(
          tt('invalidCliqRef', 'الرقم المرجعي غير صالح', 'Invalid CliQ reference number.'),
          'error'
        );
        return;
      }
    }

    setIsProcessing(true);

    try {
      const shippingPhoneE164 = normalizePhoneGlobal(dialCode, formData.phoneLocal) || safeTrim(formData.phoneLocal);
      const shippingCityName = cityLabel(formData.citySlug) || safeTrim(formData.citySlug);
      const shippingStreet = normalizeAddress(formData.streetAddress);
      
      const billingPhoneE164 = normalizePhoneGlobal(dialCode, formData.billingPhoneLocal) || safeTrim(formData.billingPhoneLocal);
      const billingCityName = cityLabel(formData.billingCitySlug) || safeTrim(formData.billingCitySlug);
      const billingStreet = normalizeAddress(formData.billingStreetAddress);

      const now = new Date();
      const nowIso = now.toISOString();
      const nowDate = nowIso.split('T')[0];
      const nowMs = now.getTime();
      const orderId = makeOrderId();

      // إنشاء كائن الطلب باستخدام الأسعار الموثقة
      const newOrder: Order & any = {
        id: orderId,
        userId: user ? user.id : 'guest',
        status: 'new',
        seenByAdmin: false,
        date: nowDate,
        createdAt: nowIso,
        createdAtMs: nowMs,
        updatedAt: nowIso,
        items: validatedCart.map((item: any) => ({
          productId: item.id,
          name: item.name,
          price: Number(item.price || 0), // السعر الحقيقي
          quantity: clampQty(item.quantity),
          image: item.image,
        })),
        subtotal,
        discountAmount,
        shippingCost,
        total,
        shippingMethodId,
        shippingMethod: isAR ? selectedShipping.nameAr : selectedShipping.nameEn,
        paymentMethod,
        customerEmail: safeTrim(email) || safeTrim(user?.email || ''),
        note: safeTrim(orderNote) || undefined,
        deliveryPreference: safeTrim(preferredDeliveryDate) || safeTrim(preferredDeliveryTime)
          ? { date: safeTrim(preferredDeliveryDate) || undefined, time: safeTrim(preferredDeliveryTime) || undefined }
          : undefined,
        paymentDetails: paymentMethod === 'cliq'
          ? { cliqReference: safeTrim(cliqRef), receiptImage: cliqReceiptUrl || undefined, isPaid: false }
          : undefined,
        address: { fullName: normalizeName(formData.fullName) || 'Guest', city: shippingCityName, street: shippingStreet, phone: shippingPhoneE164 },
        addressMeta: { country: JO_COUNTRY.nameEn, countryCode: JO_COUNTRY.code, citySlug: formData.citySlug, postalCode: safeTrim(formData.postalCode) || undefined, saveInfo: !!formData.saveInfo, phoneDial: dialCode, phoneLocal: safeTrim(formData.phoneLocal) },
        billingAddress: formData.billingSameAsShipping
          ? undefined
          : { fullName: normalizeName(formData.billingFullName), city: billingCityName, street: billingStreet, phone: billingPhoneE164, meta: { citySlug: formData.billingCitySlug, postalCode: safeTrim(formData.billingPostalCode) || undefined, phoneDial: dialCode, phoneLocal: safeTrim(formData.billingPhoneLocal) } },
      };

      const workerUrl = import.meta.env.VITE_WORKER_URL;
      if (workerUrl && workerUrl.trim() !== '') {
        try {
          await fetch(`${workerUrl}/create-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order: newOrder }),
          });
        } catch (workerError) {
          console.warn('Backend sync skipped or failed. Order will proceed locally.', workerError);
        }
      }

      try {
        if (db?.orders?.create) {
          await db.orders.create(newOrder);
        }
      } catch (dbError) {
        console.error('Failed to save order locally:', dbError);
      }

      try {
        sessionStorage.setItem(`order_success_${newOrder.id}`, JSON.stringify(newOrder));
      } catch (storageError) {
        console.error('Failed to cache order success payload:', storageError);
      }

      clearCart();
      if (typeof clearOrderNote === 'function') clearOrderNote();
      
      try {
        await refreshProducts();
      } catch (refreshError) {
        console.error('refreshProducts failed:', refreshError);
      }

      showToast(tt('alertSet', 'تم استلام طلبك بنجاح', 'Order placed successfully.'), 'success');

      navigate(`/order-success/${newOrder.id}`, { state: { order: newOrder }, replace: true });
    } catch (error: any) {
      console.error('Checkout submit failed:', error);
      showToast(tt('placeOrderFailed', 'فشل إنشاء الطلب، يرجى المحاولة مرة أخرى', 'Failed to place order. Please try again.'), 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const dialLabel = useMemo(() => {
    const d = DIAL_OPTIONS.find((x) => x.dial === dialCode) || DIAL_OPTIONS[0]!;
    return isAR ? `${d.flag} ${d.nameAr} ${d.dial}` : `${d.flag} ${d.nameEn} ${d.dial}`;
  }, [dialCode, isAR]);

  const needEmail = !user?.id;

  const shippingLabel = useMemo(() => {
    if (!selectedShipping) return '';
    return isAR ? selectedShipping.nameAr : selectedShipping.nameEn;
  }, [selectedShipping, isAR]);

  const inputClass = (hasError: boolean) => [
    'w-full p-4 bg-slate-50 border rounded-2xl outline-none transition-all duration-300 font-medium text-slate-800',
    hasError 
      ? 'border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-500/10' 
      : 'border-slate-200 focus:border-sky-400 focus:ring-4 focus:ring-sky-400/20 hover:border-slate-300'
  ].join(' ');

  if (!Array.isArray(validatedCart) || validatedCart.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <SEO title={tt('checkout', 'إتمام الطلب', 'Checkout')} noIndex={true} />
        <div className="w-full max-w-md bg-white rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/40 p-10 text-center animate-in zoom-in-95 duration-500">
          <div className="mx-auto w-20 h-20 rounded-full bg-sky-50 flex items-center justify-center text-sky-500 mb-6 shadow-inner">
            <ShoppingBag size={32} strokeWidth={2.5} />
          </div>
          <h2 className="text-3xl font-heading font-black text-slate-900 mb-3">
            {tt('cartEmpty', 'سلتك فارغة', 'Your cart is empty')}
          </h2>
          <p className="text-slate-500 font-medium mb-8 leading-relaxed">
            {tt('browseToAdd', 'تصفّح منتجاتنا المميزة وأضف ما يعجبك لإتمام عملية الشراء.', 'Browse products and add items to your cart to checkout.')}
          </p>
          <Button onClick={() => navigate('/shop')} className="w-full py-4 text-lg">
            {tt('browseProducts', 'تصفح المنتجات', 'Browse products')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 lg:py-12 pb-32 lg:pb-12">
      <SEO title={tt('checkout', 'إتمام الطلب', 'Checkout')} noIndex={true} />

      <div className="container mx-auto px-4 lg:px-8 max-w-7xl">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-10">
          <div className="min-w-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h1 className="text-4xl font-heading font-black text-slate-900 flex items-center gap-3">
              {tt('checkout', 'إتمام الدفع', 'Secure Checkout')}
            </h1>
            <p className="text-slate-500 font-medium mt-2">
              {tt('checkoutHint', 'نضمن لك تجربة تسوق آمنة وسريعة', 'Simple, fast, and secure checkout process.')}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/cart')}
              className="flex items-center gap-2 text-sm font-bold bg-white text-slate-700 border-2 border-slate-200 hover:bg-slate-900 hover:text-white hover:border-slate-900 px-5 py-2.5 rounded-xl transition-all shadow-sm active:scale-95"
              type="button"
            >
              <ShoppingBag size={16} strokeWidth={2.5} />
              <span className="hidden sm:inline-block">{tt('editCart', 'تعديل السلة', 'Edit cart')}</span>
            </button>
            <button
              onClick={() => navigate('/shop')}
              className="text-sm font-bold text-slate-500 hover:text-sky-500 transition-colors px-3 py-2"
              type="button"
            >
              {tt('continueShopping', 'العودة للتسوق', 'Back to shopping')}
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 xl:gap-12">
          {/* Form Steps Container */}
          <div className="flex-1 space-y-6 lg:max-w-3xl">
            
            {/* Step Indicator */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4 sm:p-6 sticky top-20 z-20">
              <div className="flex items-center justify-between gap-2">
                {[1, 2, 3].map((i) => {
                  const active = step === i;
                  const done = step > i;
                  const title = i === 1 ? tt('address', 'عنوان الاستلام', 'Shipping Address') : i === 2 ? tt('shipping', 'خيارات التوصيل', 'Delivery Method') : tt('payment', 'طريقة الدفع', 'Payment Method');
                  const hint = i === 1 ? tt('stepAddressHint', 'بيانات الوجهة', 'Delivery details') : i === 2 ? tt('stepShippingHint', 'تحديد الموعد', 'Schedule delivery') : tt('stepPaymentHint', 'تأكيد الطلب', 'Confirm order');

                  return (
                    <div key={i} className={`flex-1 flex flex-col sm:flex-row items-center sm:items-start gap-3 text-center sm:text-start transition-opacity duration-300 ${!active && !done ? 'opacity-50' : 'opacity-100'}`}>
                      <div
                        className={[
                          'w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0 transition-all duration-500',
                          active ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30 scale-110' : done ? 'bg-black text-white shadow-md' : 'bg-slate-100 text-slate-400',
                        ].join(' ')}
                      >
                        {done ? <CheckCircle size={20} strokeWidth={3} /> : i}
                      </div>

                      <div className="min-w-0 hidden sm:block mt-1">
                        <p className={`text-sm font-black ${done || active ? 'text-slate-900' : 'text-slate-500'}`}>
                          {title}
                        </p>
                        <p className="text-[11px] font-bold text-slate-400 line-clamp-1 mt-0.5">{hint}</p>
                      </div>

                      {i < 3 && <div className="hidden sm:block h-[3px] rounded-full bg-slate-100 flex-1 mx-4 mt-4" >
                        <div className={`h-full bg-black rounded-full transition-all duration-700 ${done ? 'w-full' : 'w-0'}`} />
                      </div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* STEP 1: Address */}
            {step === 1 && (
              <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-8 pb-4 border-b border-slate-100">
                  <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3">
                    <MapPin className="text-sky-500" size={28} strokeWidth={2.5} />
                    {tt('deliveryAddress', 'معلومات الاستلام', 'Shipping Information')}
                  </h2>
                  <div className="text-xs font-bold text-sky-600 bg-sky-50 px-3 py-1.5 rounded-lg border border-sky-100">
                    {tt('deliverOnlyJordan', 'التوصيل متاح داخل الأردن فقط 🇯🇴', 'Delivery within Jordan only 🇯🇴')}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('email', 'البريد الإلكتروني', 'Email Address')}
                      {needEmail && <span className="text-red-500 ms-1">*</span>}
                    </label>
                    <div className={inputClass(!!errors.email) + ' flex items-center gap-3 p-0 overflow-hidden'}>
                      <div className="pl-4 rtl:pr-4 rtl:pl-0">
                        <Mail size={20} className="text-slate-400" strokeWidth={2.5} />
                      </div>
                      <input
                        value={email}
                        onChange={(e) => setEmailField(e.target.value)}
                        type="email"
                        placeholder={tt('emailPlaceholder', 'example@email.com', 'name@example.com')}
                        className="flex-1 bg-transparent border-none outline-none py-4 pr-4 rtl:pl-4 rtl:pr-0 w-full font-bold placeholder:font-medium placeholder:text-slate-300"
                        autoComplete="email"
                        dir="ltr"
                      />
                    </div>
                    {errors.email && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.email}</p>}
                    {!needEmail && <p className="mt-1.5 ms-1 text-[11px] font-bold text-slate-400">{tt('emailOptional', 'يستخدم لإرسال تأكيد وتحديثات الطلب', 'Used for order confirmation and updates')}</p>}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('fullName', 'الاسم الكامل', 'Full Name')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      name="fullName"
                      value={formData.fullName}
                      onChange={(e) => setField('fullName', e.target.value)}
                      type="text"
                      placeholder={tt('fullNamePh', 'الاسم الأول والأخير', 'First and last name')}
                      className={inputClass(!!errors.fullName)}
                      autoComplete="name"
                    />
                    {errors.fullName && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.fullName}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('country', 'الدولة', 'Country')}
                    </label>
                    <select
                      value={JO_COUNTRY.nameEn}
                      onChange={() => setField('country', JO_COUNTRY.nameEn)}
                      className={inputClass(false) + ' appearance-none cursor-pointer text-slate-500'}
                      disabled
                    >
                      <option value={JO_COUNTRY.nameEn}>{isAR ? JO_COUNTRY.nameAr : JO_COUNTRY.nameEn}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('city', 'المحافظة', 'Governorate')} <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.citySlug}
                      onChange={(e) => setField('citySlug', e.target.value)}
                      className={inputClass(!!errors.citySlug) + ' appearance-none cursor-pointer'}
                    >
                      <option value="" disabled>{tt('selectCity', '— اختر المحافظة —', '— Select a region —')}</option>
                      {JO_GOVS.map((c) => (
                        <option key={c.slug} value={c.slug}>{isAR ? c.ar : c.en}</option>
                      ))}
                    </select>
                    {errors.citySlug && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.citySlug}</p>}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('detailedAddress', 'العنوان التفصيلي', 'Detailed Address')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      name="streetAddress"
                      value={formData.streetAddress}
                      onChange={(e) => setField('streetAddress', e.target.value)}
                      type="text"
                      placeholder={tt(
                        'addressPlaceholder',
                        'اسم المنطقة - الشارع - رقم البناية - رقم الشقة',
                        'Area - Street - Building No - Apt'
                      )}
                      className={inputClass(!!errors.streetAddress)}
                      autoComplete="street-address"
                    />
                    {errors.streetAddress && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.streetAddress}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('postalCodeOpt', 'الرمز البريدي', 'Postal Code')} <span className="text-slate-400 font-bold normal-case">({tt('optional', 'اختياري', 'Optional')})</span>
                    </label>
                    <input
                      name="postalCode"
                      value={formData.postalCode}
                      onChange={(e) => setField('postalCode', e.target.value)}
                      type="text"
                      placeholder="00000"
                      className={inputClass(false)}
                      autoComplete="postal-code"
                      dir="ltr"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('phone', 'رقم الجوال', 'Mobile Number')} <span className="text-red-500">*</span>
                    </label>
                    <div className={inputClass(!!errors.phoneLocal) + ' flex items-center gap-2 p-1.5'}>
                      <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white border border-slate-200 shadow-sm shrink-0">
                        <Phone size={16} className="text-slate-400 hidden sm:block" strokeWidth={2.5} />
                        <select
                          value={dialCode}
                          onChange={(e) => setDialCode(e.target.value)}
                          className="bg-transparent outline-none text-sm font-black text-slate-700 cursor-pointer appearance-none"
                          dir="ltr"
                        >
                          {DIAL_OPTIONS.map((d) => (
                            <option key={d.code} value={d.dial}>{d.flag} {d.dial}</option>
                          ))}
                        </select>
                      </div>
                      <input
                        name="phoneLocal"
                        value={formData.phoneLocal}
                        onChange={(e) => setField('phoneLocal', e.target.value)}
                        type="tel"
                        inputMode="tel"
                        placeholder="79 000 0000"
                        className="flex-1 min-w-0 bg-transparent border-none outline-none px-3 font-bold text-lg tabular-nums placeholder:text-slate-300 placeholder:font-medium"
                        autoComplete="tel"
                        dir="ltr"
                      />
                    </div>
                    {errors.phoneLocal && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.phoneLocal}</p>}
                  </div>

                  <div className="md:col-span-2 space-y-3 mt-4">
                    <label className="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 cursor-pointer transition-colors group">
                      <input
                        type="checkbox"
                        checked={!!formData.saveInfo}
                        onChange={(e) => setField('saveInfo', e.target.checked)}
                        className="w-5 h-5 rounded border-slate-300 text-sky-500 focus:ring-sky-500/30 transition-all"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 group-hover:text-sky-600 transition-colors">
                          {tt('saveInfo', 'حفظ بياناتي لتسريع عملية الدفع مستقبلاً', 'Save my information for faster checkout next time')}
                        </p>
                      </div>
                    </label>

                    <label className="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 cursor-pointer transition-colors group">
                      <input
                        type="checkbox"
                        checked={!!formData.billingSameAsShipping}
                        onChange={(e) => setField('billingSameAsShipping', e.target.checked)}
                        className="w-5 h-5 rounded border-slate-300 text-sky-500 focus:ring-sky-500/30 transition-all"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 group-hover:text-sky-600 transition-colors">
                          {tt('billingSame', 'عنوان الدفع (الفاتورة) مطابق لعنوان الاستلام', 'Billing address matches shipping address')}
                        </p>
                      </div>
                    </label>

                    <label className={`flex items-start gap-4 p-4 rounded-2xl border transition-colors cursor-pointer group ${errors.acceptPolicies ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-slate-50/50 hover:bg-slate-50'}`}>
                      <input
                        type="checkbox"
                        checked={acceptPolicies}
                        onChange={(e) => {
                          setAcceptPolicies(e.target.checked);
                          setErrors((p) => { const n = { ...p }; delete n.acceptPolicies; return n; });
                        }}
                        className="mt-0.5 w-5 h-5 rounded border-slate-300 text-sky-500 focus:ring-sky-500/30 transition-all"
                      />
                      <div className="min-w-0">
                        <p className={`text-sm font-bold transition-colors ${errors.acceptPolicies ? 'text-red-700' : 'text-slate-800 group-hover:text-sky-600'}`}>
                          {tt('acceptPolicies', 'أوافق على سياسات المتجر وأحكام الخدمة', 'I accept the store policies and terms of service')}
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100 flex justify-end">
                  <Button onClick={goToShipping} disabled={isProcessing} className="w-full sm:w-auto px-10 py-4 text-lg">
                    {tt('continueToShipping', 'متابعة لاختيار التوصيل', 'Continue to delivery options')}
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 2: Shipping */}
            {step === 2 && (
              <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right-4 duration-500">
                <h2 className="text-2xl font-black text-slate-900 mb-8 pb-4 border-b border-slate-100 flex items-center gap-3">
                  <Truck className="text-sky-500" size={28} strokeWidth={2.5} />
                  {tt('shippingMethod', 'خيارات التوصيل', 'Delivery Options')}
                </h2>

                <div className="space-y-4">
                  {CHECKOUT_SHIPPING_METHODS.map((method) => {
                    const active = shippingMethodId === method.id;
                    const Icon = method.icon || Truck;

                    return (
                      <label
                        key={method.id}
                        className={[
                          'flex items-center justify-between p-5 rounded-2xl cursor-pointer transition-all duration-300 border-2',
                          active 
                            ? 'border-sky-500 bg-sky-50 shadow-md shadow-sky-500/10' 
                            : 'border-slate-100 bg-white hover:border-slate-300 hover:bg-slate-50',
                        ].join(' ')}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${active ? 'border-sky-500' : 'border-slate-300'}`}>
                            {active && <div className="w-3 h-3 rounded-full bg-sky-500" />}
                          </div>
                          
                          <div className="min-w-0">
                            <p className={`font-black flex items-center gap-2 ${active ? 'text-sky-700' : 'text-slate-800'}`}>
                              <Icon size={18} strokeWidth={2.5} className={active ? 'text-sky-500' : 'text-slate-400'} />
                              {isAR ? method.nameAr : method.nameEn}
                            </p>
                            <p className={`text-xs font-bold mt-1.5 ${active ? 'text-sky-600/80' : 'text-slate-500'}`}>
                              {isAR ? method.durationAr : method.durationEn}
                            </p>
                          </div>
                        </div>

                        <span className={`font-black text-lg tabular-nums shrink-0 ml-4 rtl:ml-0 rtl:mr-4 ${active ? 'text-sky-700' : 'text-slate-900'}`}>
                          {formatMoney(Number(method.price || 0))}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="mt-8 pt-8 border-t border-slate-100">
                  <p className="text-sm font-black uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
                    <CalendarClock size={18} strokeWidth={2.5} />
                    {tt('preferredDelivery', 'تحديد موعد الاستلام', 'Schedule Delivery Time')}
                    <span className="text-slate-400 font-bold text-[10px] bg-slate-100 px-2 py-0.5 rounded-md normal-case">
                      {shippingMethodId === 'jo_schedule' ? tt('required', 'إجباري', 'Required') : tt('optional', 'اختياري', 'Optional')}
                    </span>
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <input
                        type="date"
                        value={preferredDeliveryDate}
                        onChange={(e) => {
                          setPreferredDeliveryDate(e.target.value);
                          setErrors((p) => { const n = { ...p }; delete n.preferredDeliveryDate; return n; });
                        }}
                        className={inputClass(!!errors.preferredDeliveryDate)}
                      />
                      {errors.preferredDeliveryDate && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.preferredDeliveryDate}</p>}
                    </div>
                    <div>
                      <input
                        type="time"
                        value={preferredDeliveryTime}
                        onChange={(e) => {
                          setPreferredDeliveryTime(e.target.value);
                          setErrors((p) => { const n = { ...p }; delete n.preferredDeliveryTime; return n; });
                        }}
                        className={inputClass(!!errors.preferredDeliveryTime)}
                      />
                      {errors.preferredDeliveryTime && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.preferredDeliveryTime}</p>}
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-between gap-4">
                  <Button variant="outline" onClick={() => changeStep(1)} disabled={isProcessing} className="w-full sm:w-auto px-8 py-4">
                    {tt('back', 'العودة للعنوان', 'Back to address')}
                  </Button>
                  <Button onClick={() => changeStep(3)} disabled={isProcessing} className="w-full sm:w-auto px-10 py-4 text-lg">
                    {tt('continueToPayment', 'متابعة للدفع', 'Proceed to Payment')}
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 3: Payment */}
            {step === 3 && (
              <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right-4 duration-500">
                <h2 className="text-2xl font-black text-slate-900 mb-8 pb-4 border-b border-slate-100 flex items-center gap-3">
                  <Shield className="text-emerald-500" size={28} strokeWidth={2.5} />
                  {tt('paymentMethod', 'طريقة الدفع', 'Payment Method')}
                </h2>

                <div className="flex flex-col sm:flex-row gap-4 mb-8">
                  <button
                    onClick={() => setPaymentMethod('cliq')}
                    type="button"
                    className={[
                      'flex-1 py-5 px-4 rounded-2xl border-2 font-black transition-all duration-300 relative overflow-hidden',
                      paymentMethod === 'cliq'
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-md shadow-indigo-500/10'
                        : 'border-slate-100 text-slate-500 hover:bg-slate-50 hover:border-slate-300',
                    ].join(' ')}
                  >
                    {paymentMethod === 'cliq' && <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-indigo-200 to-transparent opacity-50 rounded-bl-full pointer-events-none" />}
                    <div className="flex flex-col items-center justify-center gap-2 relative z-10">
                      <Smartphone size={28} strokeWidth={2} className={paymentMethod === 'cliq' ? 'text-indigo-500' : 'text-slate-400'} /> 
                      <span className="text-lg">CliQ</span>
                    </div>
                  </button>

                  <button
                    onClick={() => setPaymentMethod('cod')}
                    type="button"
                    className={[
                      'flex-1 py-5 px-4 rounded-2xl border-2 font-black transition-all duration-300 relative overflow-hidden',
                      paymentMethod === 'cod'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-md shadow-emerald-500/10'
                        : 'border-slate-100 text-slate-500 hover:bg-slate-50 hover:border-slate-300',
                    ].join(' ')}
                  >
                    {paymentMethod === 'cod' && <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-emerald-200 to-transparent opacity-50 rounded-bl-full pointer-events-none" />}
                    <div className="flex flex-col items-center justify-center gap-2 relative z-10">
                      <DollarSign size={28} strokeWidth={2} className={paymentMethod === 'cod' ? 'text-emerald-500' : 'text-slate-400'} />
                      <span className="text-lg">{tt('cod', 'الدفع عند الاستلام', 'Cash on Delivery')}</span>
                    </div>
                  </button>
                </div>

                {paymentMethod === 'cliq' && (
                  <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 rounded-3xl p-6 text-center shadow-inner">
                      <p className="text-sm text-indigo-800 mb-3 font-bold uppercase tracking-widest">
                        {tt('cliqTransferHint', 'يرجى تحويل القيمة إلى حساب CliQ التالي:', 'Please transfer the amount to this CliQ ID:')}
                      </p>
                      <div className="text-3xl sm:text-4xl font-black text-indigo-900 tracking-widest mb-4 select-all cursor-pointer bg-white px-6 py-3 rounded-2xl inline-block shadow-sm border border-indigo-50 hover:scale-105 transition-transform">
                        ANTASTORE
                      </div>
                      <div className="flex flex-col gap-1 text-sm font-bold text-indigo-700/80 bg-white/50 py-3 rounded-xl max-w-xs mx-auto">
                        <p>{tt('cliqRecipient', 'الجهة المستفيدة:', 'Recipient:')} <span className="text-indigo-900">مكتبة دير شرف Tech & Art</span></p>
                        <p>{tt('amount', 'إجمالي المبلغ:', 'Total Amount:')} <span className="text-indigo-900 font-black text-base">{formatMoney(total)}</span></p>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100">
                      <label className="block text-sm font-black text-slate-800 mb-3">
                        {tt('referenceOrReceipt', 'الرقم المرجعي للعملية (Reference Number)', 'Transaction Reference Number')} <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder={tt('enterCliqRef', 'رقم مكون من أرقام أو أحرف', 'e.g. 1234567890')}
                        value={cliqRef}
                        onChange={(e) => setCliqRef(e.target.value)}
                        className={inputClass(false) + ' bg-white mb-5 text-center tracking-wider'}
                      />

                      <label className="block text-sm font-black text-slate-800 mb-3">
                        {tt('uploadReceipt', 'صورة أو لقطة شاشة للإيصال', 'Screenshot of Receipt')} <span className="text-slate-400 text-xs normal-case">({tt('optional', 'مستحسن لتسريع التأكيد', 'Recommended for faster processing')})</span>
                      </label>
                      <label className="block group">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleCliqReceiptPick(e.target.files?.[0] ?? null)}
                        />
                        <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center bg-white group-hover:bg-sky-50 group-hover:border-sky-300 cursor-pointer transition-all duration-300">
                          <div className="w-14 h-14 bg-slate-50 group-hover:bg-white rounded-full flex items-center justify-center mx-auto mb-3 transition-colors">
                            <Upload className="text-slate-400 group-hover:text-sky-500" strokeWidth={2.5} />
                          </div>
                          <span className="text-sm text-slate-700 font-black block mb-1">
                            {tt('clickToUpload', 'اضغط هنا لرفع الصورة', 'Click here to upload')}
                          </span>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                            {tt('uploadHint', 'صيغة JPG أو PNG. بحد أقصى 2.5 ميجابايت', 'JPG or PNG. Max 2.5MB')}
                          </p>
                        </div>
                      </label>

                      {(cliqReceiptPreview || cliqReceiptUrl) && (
                        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-2 animate-in zoom-in-95 duration-300 relative group">
                          <img
                            src={cliqReceiptPreview || cliqReceiptUrl}
                            alt="Receipt preview"
                            className="w-full h-48 object-cover rounded-xl"
                          />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 rounded-xl transition-opacity flex items-center justify-center">
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); setCliqReceiptPreview(''); setCliqReceiptUrl(''); }}
                              className="bg-white text-red-500 font-black px-4 py-2 rounded-xl hover:scale-105 transition-transform shadow-lg"
                            >
                              {tt('remove', 'إزالة الصورة', 'Remove Image')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {paymentMethod === 'cod' && (
                  <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-8 text-center animate-in fade-in duration-300">
                    <div className="w-20 h-20 bg-white shadow-sm text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-5">
                      <DollarSign size={40} strokeWidth={2.5} />
                    </div>
                    <h3 className="text-xl font-black text-emerald-900 mb-2">
                      {tt('payOnDelivery', 'الدفع الآمن عند الاستلام', 'Secure Pay on Delivery')}
                    </h3>
                    <p className="text-emerald-700/80 font-bold mb-5 max-w-sm mx-auto">
                      {tt('codDesc', 'لن يتم خصم أي مبلغ إلكترونياً. يرجى تجهيز المبلغ المطلوب نقداً لمندوب التوصيل.', 'No electronic charges will be made. Please prepare the exact cash amount for the courier.')}
                    </p>
                    <div className="bg-white rounded-2xl py-4 px-6 inline-block shadow-sm border border-emerald-50">
                      <span className="text-sm font-bold text-slate-500 uppercase tracking-widest block mb-1">{tt('totalToPay', 'المبلغ المطلوب دفعه', 'Amount to Pay')}</span>
                      <span className="text-3xl font-black text-emerald-600 tabular-nums">{formatMoney(total)}</span>
                    </div>
                  </div>
                )}

                <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-between items-center gap-4">
                  <button onClick={() => changeStep(2)} disabled={isProcessing} className="text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors w-full sm:w-auto py-3">
                    {tt('backToShipping', 'الرجوع لخيارات التوصيل', 'Back to Delivery')}
                  </button>
                  <Button
                    onClick={handlePlaceOrder}
                    className="w-full sm:w-auto px-12 py-5 text-lg shadow-xl shadow-sky-500/20"
                    isLoading={isProcessing}
                    disabled={isProcessing}
                  >
                    {tt('placeOrder', 'تأكيد وإتمام الطلب', 'Confirm & Place Order')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Order Summary Sidebar */}
          <div className="lg:w-[400px] shrink-0">
            <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/40 border border-slate-100 lg:sticky lg:top-24">
              <h3 className="font-heading font-black text-2xl mb-6 text-slate-900">
                {tt('orderSummary', 'ملخص الفاتورة', 'Order Summary')}
              </h3>

              <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2 rtl:pr-0 rtl:pl-2 custom-scrollbar mb-6">
                {validatedCart.map((item: any) => (
                  <div key={item.id} className="flex gap-4 group">
                    <div className="relative">
                      <LazyImage
                        src={item.image}
                        alt={item.name}
                        className="w-16 h-16 rounded-2xl object-cover border border-slate-100 group-hover:border-sky-200 transition-colors"
                        containerClassName="w-16 h-16 shrink-0"
                      />
                      <span className="absolute -top-2 -right-2 rtl:-left-2 rtl:right-auto bg-slate-900 text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shadow-sm">
                        {clampQty(item.quantity)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0 pt-1">
                      <p className="text-sm font-black text-slate-800 line-clamp-2 leading-snug group-hover:text-sky-600 transition-colors">
                        {getProductTitle(item)}
                      </p>
                      <p className="font-black text-slate-500 tabular-nums mt-1 text-xs">
                        {formatMoney(Number(item.price || 0) * clampQty(item.quantity))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-slate-50 rounded-3xl p-5 space-y-3">
                <div className="flex justify-between text-sm font-bold text-slate-500">
                  <span>{tt('subtotal', 'الإجمالي الفرعي', 'Subtotal')}</span>
                  <span className="tabular-nums text-slate-700">{formatMoney(subtotal)}</span>
                </div>

                {discountAmount > 0 && (
                  <div className="flex justify-between text-sm font-black text-emerald-600 bg-emerald-50/50 p-2 -mx-2 rounded-xl">
                    <span>{tt('discount', 'الخصم المكتسب', 'Earned Discount')}</span>
                    <span className="tabular-nums">-{formatMoney(discountAmount)}</span>
                  </div>
                )}

                <div className="flex justify-between text-sm font-bold text-slate-500">
                  <span>{tt('shipping', 'رسوم التوصيل', 'Shipping Fee')} <span className="text-[10px] font-medium block text-slate-400">{shippingLabel}</span></span>
                  <span className="tabular-nums text-slate-700">{formatMoney(shippingCost)}</span>
                </div>

                <div className="border-t border-slate-200/60 pt-4 mt-2 flex justify-between items-end">
                  <span className="text-base font-black text-slate-900 uppercase tracking-widest">{tt('total', 'المجموع النهائي', 'Final Total')}</span>
                  <span className="text-3xl font-black text-sky-500 tabular-nums drop-shadow-sm leading-none">{formatMoney(total)}</span>
                </div>
              </div>

              <div className="mt-6">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ms-1">
                  {tt('orderNote', 'ملاحظات إضافية', 'Additional Notes')} <span className="normal-case">({tt('optional', 'اختياري', 'Optional')})</span>
                </label>
                <textarea
                  value={orderNote || ''}
                  onChange={(e) => setOrderNote(e.target.value)}
                  maxLength={600}
                  placeholder={tt('orderNotePlaceholder', 'تعليمات لمندوب التوصيل أو تفاصيل تغليف الهدية...', 'Instructions for courier or gift wrapping details...')}
                  className="w-full min-h-[80px] resize-none p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-400/10 text-sm font-bold placeholder:font-medium placeholder:text-slate-400 transition-all"
                />
              </div>

              <div className="mt-6 flex items-center justify-center gap-2 text-xs font-bold text-slate-400 bg-white border border-slate-100 py-3 rounded-2xl">
                <Shield size={16} className="text-emerald-500" />
                <span>{tt('secureCheckoutNote', 'بياناتك مشفرة ومحمية بالكامل 100%', 'Your data is 100% encrypted and secure')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sticky Checkout Button */}
      <div className="lg:hidden fixed bottom-0 left-0 w-full bg-white/90 backdrop-blur-md border-t border-slate-200 p-4 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] z-50 animate-in slide-in-from-bottom-full">
        <div className="flex items-center justify-between gap-4 max-w-md mx-auto">
          <div className="min-w-0 flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{tt('total', 'المطلوب للدفع', 'Total to pay')}</span>
            <span className="text-xl font-black text-slate-900 tabular-nums leading-none mt-0.5">{formatMoney(total)}</span>
          </div>

          <Button
            onClick={() => {
              if (step === 1) goToShipping();
              else if (step === 2) changeStep(3);
              else handlePlaceOrder();
            }}
            className="flex-1 py-4 text-base shadow-xl shadow-sky-500/20"
            isLoading={isProcessing}
          >
            {step === 1
              ? tt('continueToShipping', 'متابعة للتوصيل', 'Continue to Delivery')
              : step === 2
              ? tt('continueToPayment', 'متابعة للدفع', 'Continue to Payment')
              : tt('confirmOrder', 'تأكيد الطلب', 'Confirm Order')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Checkout;