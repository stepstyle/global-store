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
  Image as ImageIcon,
  ShoppingBag,
  Mail,
  Phone,
  CalendarClock,
} from 'lucide-react';
import * as ReactRouterDOM from 'react-router-dom';
import { db } from '../services/storage';
import { Order } from '../types';
import SEO from '../components/SEO';
import LazyImage from '../components/LazyImage';

const { useNavigate } = ReactRouterDOM as any;

// ✅ فقط CliQ أو COD (تم حذف الفيزا)
type PaymentMethod = 'cod' | 'cliq';

const safeTrim = (s: any) => String(s ?? '').trim();

const clampQty = (n: any) => {
  const x = Math.round(Number(n) || 1);
  return Math.max(1, Math.min(99, x));
};

// ✅ الأردن فقط للشحن
const JO_COUNTRY = { code: 'JO', nameAr: 'الأردن', nameEn: 'Jordan' };

// ✅ محافظات الأردن
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

// ✅ Phone dial codes (قائمة مختصرة + ممكن توسّعها لاحقاً)
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

// ✅ خيارات شحن جديدة (بدون تعديل constants)
type ShippingMethod = { id: string; nameAr: string; nameEn: string; durationAr: string; durationEn: string; price: number; icon?: any };
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
  // ✅ لا نعمل قواعد خاصة لكل دولة (حتى يقبل أي رقم)
  return `${d}${num}`;
};

const Checkout: React.FC = () => {
  const {
    cart,
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

  // ✅ ترجمة ذكية: إذا المفتاح غير موجود t() ترجع نفس المفتاح
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

  // ✅ Email field (يظهر دائماً)
  const [email, setEmail] = useState<string>(() => safeTrim(user?.email || ''));

  useEffect(() => {
    // إذا المستخدم سجّل دخول بعد ما فتح الصفحة
    const uEmail = safeTrim(user?.email || '');
    if (uEmail && !safeTrim(email)) setEmail(uEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  // ✅ Phone dial picker
  const [dialCode, setDialCode] = useState<string>(() => {
    // افتراضي: الأردن
    return '+962';
  });

  // CliQ
  const [cliqRef, setCliqRef] = useState('');
  const [cliqReceiptDataUrl, setCliqReceiptDataUrl] = useState<string>('');

  // ✅ Address / Checkout Form
  const [formData, setFormData] = useState({
    fullName: '',
    country: JO_COUNTRY.nameEn, // ثابت الأردن
    citySlug: '',
    streetAddress: '',
    postalCode: '',
    phoneLocal: '',
    saveInfo: true,
    billingSameAsShipping: true,

    // Billing (اختياري)
    billingFullName: '',
    billingCitySlug: '',
    billingStreetAddress: '',
    billingPhoneLocal: '',
    billingPostalCode: '',
  });

  // ✅ Shipping preferences (تاريخ/وقت)
  const [preferredDeliveryDate, setPreferredDeliveryDate] = useState(''); // yyyy-mm-dd
  const [preferredDeliveryTime, setPreferredDeliveryTime] = useState(''); // hh:mm

  // ✅ Policies acceptance
  const [acceptPolicies, setAcceptPolicies] = useState(true);

  // ✅ Field errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Money formatter
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

  const formatMoney = (value: number) => (fmt ? fmt.format(value) : `JOD ${Number(value || 0).toFixed(2)}`);

  const selectedShipping = useMemo(() => CHECKOUT_SHIPPING_METHODS.find((m) => m.id === shippingMethodId), [shippingMethodId]);

  const subtotal = useMemo(
    () =>
      cart.reduce((sum: number, item: any) => {
        const price = Number(item.price || 0);
        const qty = clampQty(item.quantity);
        return sum + price * qty;
      }, 0),
    [cart]
  );

  const totalItems = useMemo(() => cart.reduce((sum: number, item: any) => sum + clampQty(item.quantity), 0), [cart]);

  const discountAmount = useMemo(() => (totalItems > 2 ? subtotal * 0.1 : 0), [subtotal, totalItems]);

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

    // ✅ Email required فقط للضيف
    const needEmail = !user?.id;
    const e = safeTrim(email);
    if (needEmail && !e) {
      nextErr.email = tt('emailRequired', 'البريد الإلكتروني مطلوب', 'Email is required.');
    } else if (e && !emailRegex.test(e)) {
      nextErr.email = tt('emailInvalid', 'البريد الإلكتروني غير صحيح', 'Invalid email address.');
    }

    const name = normalizeName(formData.fullName);
    if (name.length < 5) {
      nextErr.fullName = tt('nameMin5', 'الاسم لازم يكون 5 أحرف على الأقل', 'Name must be at least 5 characters.');
    }

    // ✅ الأردن فقط
    if (!safeTrim(formData.country)) {
      nextErr.country = tt('countryRequired', 'الدولة مطلوبة', 'Country is required.');
    }

    if (!safeTrim(formData.citySlug)) {
      nextErr.citySlug = tt('cityRequired', 'المدينة مطلوبة', 'City is required.');
    }

    const addr = normalizeAddress(formData.streetAddress);
    if (addr.length < 8) {
      nextErr.streetAddress = tt('addressMin8', 'اكتب العنوان بالتفصيل (على الأقل 8 أحرف)', 'Write detailed address (at least 8 characters).');
    }

    // ✅ Phone global with dial
    const e164 = normalizePhoneGlobal(dialCode, formData.phoneLocal);
    if (!e164) {
      nextErr.phoneLocal = tt('phoneInvalid', 'رقم الهاتف غير صحيح', 'Invalid phone number.');
    } else if (digitsOnly(formData.phoneLocal).length < 6) {
      nextErr.phoneLocal = tt('phoneTooShort', 'رقم الهاتف قصير جداً', 'Phone number is too short.');
    }

    // ✅ إذا خيار "تحديد موعد" لازم تاريخ + وقت
    if (shippingMethodId === 'jo_schedule') {
      if (!safeTrim(preferredDeliveryDate)) {
        nextErr.preferredDeliveryDate = tt('dateRequired', 'التاريخ مطلوب', 'Date is required.');
      }
      if (!safeTrim(preferredDeliveryTime)) {
        nextErr.preferredDeliveryTime = tt('timeRequired', 'الوقت مطلوب', 'Time is required.');
      }
    }

    if (!acceptPolicies) {
      nextErr.acceptPolicies = tt('acceptPoliciesRequired', 'لازم توافق على السياسات لإتمام الطلب', 'You must accept policies to place the order.');
    }

    // Billing (إذا مش نفس الشحن)
    if (!formData.billingSameAsShipping) {
      const bn = normalizeName(formData.billingFullName);
      if (bn.length < 5) {
        nextErr.billingFullName = tt('billingNameMin5', 'اسم الفاتورة لازم يكون 5 أحرف على الأقل', 'Billing name must be at least 5 characters.');
      }
      if (!safeTrim(formData.billingCitySlug)) {
        nextErr.billingCitySlug = tt('billingCityRequired', 'مدينة الفاتورة مطلوبة', 'Billing city is required.');
      }
      const ba = normalizeAddress(formData.billingStreetAddress);
      if (ba.length < 8) {
        nextErr.billingStreetAddress = tt('billingAddressMin8', 'عنوان الفاتورة بالتفصيل (على الأقل 8 أحرف)', 'Billing address must be detailed (at least 8 characters).');
      }

      // ✅ Billing phone: نستخدم نفس dial + رقم
      const bE164 = normalizePhoneGlobal(dialCode, formData.billingPhoneLocal);
      if (!bE164) {
        nextErr.billingPhoneLocal = tt('billingPhoneInvalid', 'رقم هاتف الفاتورة غير صحيح', 'Invalid billing phone.');
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
      showToast(tt('invalidImage', 'الرجاء رفع صورة صحيحة', 'Please upload an image file.'), 'error');
      return;
    }

    const maxBytes = 2.5 * 1024 * 1024;
    if (file.size > maxBytes) {
      showToast(tt('imageTooLarge', 'حجم الصورة كبير جداً، ارفع صورة أصغر', 'Image is too large. Please upload a smaller one.'), 'error');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCliqReceiptDataUrl(dataUrl);
      showToast(tt('uploaded', 'تم الرفع بنجاح', 'Uploaded successfully.'), 'success');
    } catch {
      showToast(tt('uploadFailed', 'فشل الرفع، حاول مرة أخرى', 'Upload failed. Please try again.'), 'error');
    }
  };

  const goToShipping = () => {
    const ok = validateStep1();
    if (!ok) {
      showToast(tt('fixErrors', 'راجع الحقول المطلوبة', 'Please fix the required fields.'), 'error');
      return;
    }
    setStep(2);
  };

  const handlePlaceOrder = async () => {
    if (isProcessing) return;

    const ok = validateStep1();
    if (!ok) {
      showToast(tt('fixErrors', 'راجع الحقول المطلوبة', 'Please fix the required fields.'), 'error');
      setStep(1);
      return;
    }

    if (paymentMethod === 'cliq') {
      const ref = safeTrim(cliqRef);
      if (!ref) {
        showToast(tt('enterCliqRef', 'الرجاء إدخال رقم مرجع CliQ', 'Please enter the CliQ reference number.'), 'error');
        return;
      }
      if (ref.length < 4 || ref.length > 40) {
        showToast(tt('invalidCliqRef', 'رقم مرجع CliQ غير صحيح', 'Invalid CliQ reference number.'), 'error');
        return;
      }
    }

    setIsProcessing(true);

    const shippingPhoneE164 = normalizePhoneGlobal(dialCode, formData.phoneLocal) || safeTrim(formData.phoneLocal);
    const shippingCityName = cityLabel(formData.citySlug) || safeTrim(formData.citySlug);
    const shippingStreet = normalizeAddress(formData.streetAddress);

    const billingPhoneE164 = normalizePhoneGlobal(dialCode, formData.billingPhoneLocal) || safeTrim(formData.billingPhoneLocal);
    const billingCityName = cityLabel(formData.billingCitySlug) || safeTrim(formData.billingCitySlug);
    const billingStreet = normalizeAddress(formData.billingStreetAddress);

    const newOrder: Order & any = {
      id: `ORD-${Date.now().toString().slice(-6)}`,
      userId: user ? user.id : 'guest',
      items: cart.map((item: any) => ({
        productId: item.id,
        name: item.name,
        price: Number(item.price || 0),
        quantity: clampQty(item.quantity),
        image: item.image,
      })),
      status: 'processing',
      date: new Date().toISOString().split('T')[0],
      total: total,
      shippingMethod: selectedShipping ? (isAR ? selectedShipping.nameAr : selectedShipping.nameEn) : 'Standard',
      paymentMethod: paymentMethod,

      // ✅ Email saved on order
      customerEmail: safeTrim(email) || (user?.email || ''),

      note: safeTrim(orderNote) || undefined,

      deliveryPreference:
        safeTrim(preferredDeliveryDate) || safeTrim(preferredDeliveryTime)
          ? {
              date: safeTrim(preferredDeliveryDate) || undefined,
              time: safeTrim(preferredDeliveryTime) || undefined,
            }
          : undefined,

      paymentDetails:
        paymentMethod === 'cliq'
          ? {
              cliqReference: safeTrim(cliqRef),
              receiptImage: cliqReceiptDataUrl || undefined,
              isPaid: false,
            }
          : undefined,

      address: {
        fullName: normalizeName(formData.fullName) || 'Guest',
        city: shippingCityName,
        street: shippingStreet,
        phone: shippingPhoneE164,
      },

      addressMeta: {
        country: JO_COUNTRY.nameEn,
        countryCode: JO_COUNTRY.code,
        citySlug: formData.citySlug,
        postalCode: safeTrim(formData.postalCode) || undefined,
        saveInfo: !!formData.saveInfo,

        // ✅ phone meta
        phoneDial: dialCode,
        phoneLocal: safeTrim(formData.phoneLocal),
      },

      billingAddress: formData.billingSameAsShipping
        ? undefined
        : {
            fullName: normalizeName(formData.billingFullName),
            city: billingCityName,
            street: billingStreet,
            phone: billingPhoneE164,
            meta: {
              citySlug: formData.billingCitySlug,
              postalCode: safeTrim(formData.billingPostalCode) || undefined,
              phoneDial: dialCode,
              phoneLocal: safeTrim(formData.billingPhoneLocal),
            },
          },
    };

    try {
      await db.orders.create(newOrder);
      await refreshProducts();

      clearCart();
      if (typeof clearOrderNote === 'function') clearOrderNote();

      showToast(tt('alertSet', 'تم إنشاء الطلب بنجاح', 'Order placed successfully.'), 'success');
      navigate(`/order-success/${newOrder.id}`);
    } catch {
      showToast(tt('placeOrderFailed', 'فشل إنشاء الطلب، حاول مرة أخرى', 'Failed to place order. Please try again.'), 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // ✅ Selected dial label
  const dialLabel = useMemo(() => {
    const d = DIAL_OPTIONS.find((x) => x.dial === dialCode) || DIAL_OPTIONS[0]!;
    return isAR ? `${d.flag} ${d.nameAr} ${d.dial}` : `${d.flag} ${d.nameEn} ${d.dial}`;
  }, [dialCode, isAR]);

  const needEmail = !user?.id;

  // ✅ Selected shipping label
  const shippingLabel = useMemo(() => {
    if (!selectedShipping) return '';
    return isAR ? selectedShipping.nameAr : selectedShipping.nameEn;
  }, [selectedShipping, isAR]);

  // ---------------- Empty cart ----------------
  if (!Array.isArray(cart) || cart.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <SEO title={tt('checkout', 'إتمام الطلب', 'Checkout')} noIndex={true} />
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-secondary-light/20 flex items-center justify-center text-secondary-DEFAULT mb-4">
            <ShoppingBag />
          </div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 mb-2">{tt('cartEmpty', 'سلتك فارغة', 'Your cart is empty')}</h2>
          <p className="text-slate-500 mb-6">{tt('browseToAdd', 'تصفّح المنتجات وأضف للسلة', 'Browse products and add items to your cart.')}</p>
          <Button onClick={() => navigate('/shop')} className="w-full">
            {tt('browseProducts', 'تصفح المنتجات', 'Browse products')}
          </Button>
        </div>
      </div>
    );
  }

  // ---------------- UI ----------------
  return (
    <div className="min-h-screen bg-slate-50 py-8 lg:py-12">
      <SEO title={tt('checkout', 'إتمام الطلب', 'Checkout')} noIndex={true} />

      <div className="container mx-auto px-4 lg:px-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div className="min-w-0">
            <h1 className="text-3xl font-heading font-bold text-slate-900">{tt('checkout', 'إتمام الطلب', 'Checkout')}</h1>
            <p className="text-slate-500 mt-1">{tt('checkoutHint', 'أكمل بياناتك لتأكيد الطلب', 'Complete your details to place the order.')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => navigate('/cart')}
              className="text-sm font-bold text-secondary-DEFAULT hover:opacity-80 transition"
              type="button"
            >
              {tt('editCart', 'تعديل السلة', 'Edit cart')}
            </button>

            <button
              onClick={() => navigate('/shop')}
              className="text-sm font-bold text-slate-600 hover:opacity-80 transition"
              type="button"
            >
              {tt('continueShopping', 'متابعة التسوق', 'Continue shopping')}
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Form */}
          <div className="flex-1 space-y-6">
            {/* Steps */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center justify-between gap-2">
                {[1, 2, 3].map((i) => {
                  const active = step === i;
                  const done = step > i;
                  const title =
                    i === 1 ? tt('address', 'العنوان', 'Address') : i === 2 ? tt('shipping', 'الشحن', 'Shipping') : tt('payment', 'الدفع', 'Payment');

                  const hint =
                    i === 1
                      ? tt('stepAddressHint', 'بيانات الاستلام', 'Delivery details')
                      : i === 2
                        ? tt('stepShippingHint', 'اختر نوع الشحن', 'Choose shipping')
                        : tt('stepPaymentHint', 'اختر طريقة الدفع', 'Choose payment');

                  return (
                    <div key={i} className="flex-1 flex items-center gap-3">
                      <div
                        className={[
                          'w-9 h-9 rounded-full flex items-center justify-center font-bold shrink-0 transition',
                          done || active ? 'bg-secondary-DEFAULT text-white' : 'bg-slate-200 text-slate-500',
                        ].join(' ')}
                        aria-label={`step-${i}`}
                      >
                        {done ? <CheckCircle size={18} /> : i}
                      </div>

                      <div className="min-w-0">
                        <p className={`text-sm font-bold ${done || active ? 'text-slate-900' : 'text-slate-400'}`}>{title}</p>
                        <p className="text-xs text-slate-400 line-clamp-1">{hint}</p>
                      </div>

                      {i < 3 && <div className="hidden sm:block h-0.5 bg-slate-200 flex-1 mx-2" />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 1 */}
            {step === 1 && (
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <MapPin className="text-secondary-DEFAULT" /> {tt('deliveryAddress', 'عنوان الاستلام', 'Delivery address')}
                  </h2>

                  <div className="text-xs font-bold text-slate-500">
                    {tt('deliverOnlyJordan', 'الشحن داخل الأردن فقط', 'Shipping within Jordan only')}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* ✅ Email (always visible) */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-600 mb-2">
                      {tt('email', 'البريد الإلكتروني', 'Email')}
                      {needEmail ? <span className="text-red-500 ms-1">*</span> : null}
                    </label>

                    <div
                      className={[
                        'flex items-center gap-2 p-3 border rounded-xl bg-slate-50',
                        errors.email ? 'border-red-400' : 'border-slate-200',
                      ].join(' ')}
                    >
                      <Mail size={18} className="text-slate-400 shrink-0" />
                      <input
                        value={email}
                        onChange={(e) => setEmailField(e.target.value)}
                        type="email"
                        placeholder={tt('emailPlaceholder', 'example@email.com', 'example@email.com')}
                        className="flex-1 bg-transparent outline-none text-slate-800"
                        autoComplete="email"
                      />
                    </div>

                    {errors.email && <p className="mt-1 text-xs font-bold text-red-600">{errors.email}</p>}
                    {!needEmail ? (
                      <p className="mt-1 text-[11px] text-slate-400 font-bold">
                        {tt('emailOptional', 'اختياري (مفيد لإرسال تفاصيل الطلب)', 'Optional (used to send order details)')}
                      </p>
                    ) : null}
                  </div>

                  {/* Full Name */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-600 mb-2">{tt('fullName', 'الاسم الكامل', 'Full name')}</label>
                    <input
                      name="fullName"
                      value={formData.fullName}
                      onChange={(e) => setField('fullName', e.target.value)}
                      type="text"
                      placeholder={tt('fullNamePh', 'مثال: محمد أحمد', 'Example: John Smith')}
                      className={[
                        'w-full p-3 border rounded-xl bg-slate-50 focus:ring-2 focus:ring-secondary-DEFAULT outline-none',
                        errors.fullName ? 'border-red-400' : 'border-slate-200',
                      ].join(' ')}
                      autoComplete="name"
                    />
                    {errors.fullName && <p className="mt-1 text-xs font-bold text-red-600">{errors.fullName}</p>}
                  </div>

                  {/* Country (Jordan only) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">{tt('country', 'الدولة', 'Country')}</label>
                    <select
                      value={JO_COUNTRY.nameEn}
                      onChange={() => setField('country', JO_COUNTRY.nameEn)}
                      className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-secondary-DEFAULT"
                    >
                      <option value={JO_COUNTRY.nameEn}>{isAR ? JO_COUNTRY.nameAr : JO_COUNTRY.nameEn}</option>
                    </select>
                  </div>

                  {/* City */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">{tt('city', 'المحافظة', 'Governorate')}</label>
                    <select
                      value={formData.citySlug}
                      onChange={(e) => setField('citySlug', e.target.value)}
                      className={[
                        'w-full p-3 border rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-secondary-DEFAULT',
                        errors.citySlug ? 'border-red-400' : 'border-slate-200',
                      ].join(' ')}
                    >
                      <option value="">{tt('selectCity', 'اختر المحافظة', 'Select governorate')}</option>
                      {JO_GOVS.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {isAR ? c.ar : c.en}
                        </option>
                      ))}
                    </select>
                    {errors.citySlug && <p className="mt-1 text-xs font-bold text-red-600">{errors.citySlug}</p>}
                  </div>

                  {/* Address */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-600 mb-2">{tt('detailedAddress', 'العنوان بالتفصيل', 'Detailed address')}</label>
                    <input
                      name="streetAddress"
                      value={formData.streetAddress}
                      onChange={(e) => setField('streetAddress', e.target.value)}
                      type="text"
                      placeholder={tt('addressPlaceholder', 'مثال: الجبيهة - شارع الجامعة - بناية 12 - شقة 5', 'Example: Jubaiha - University St - Building 12 - Apt 5')}
                      className={[
                        'w-full p-3 border rounded-xl bg-slate-50 focus:ring-2 focus:ring-secondary-DEFAULT outline-none',
                        errors.streetAddress ? 'border-red-400' : 'border-slate-200',
                      ].join(' ')}
                      autoComplete="street-address"
                    />
                    {errors.streetAddress && <p className="mt-1 text-xs font-bold text-red-600">{errors.streetAddress}</p>}
                  </div>

                  {/* Postal code */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">{tt('postalCodeOpt', 'الرمز البريدي (اختياري)', 'Postal code (optional)')}</label>
                    <input
                      name="postalCode"
                      value={formData.postalCode}
                      onChange={(e) => setField('postalCode', e.target.value)}
                      type="text"
                      placeholder={tt('postalCode', 'الرمز البريدي', 'Postal code')}
                      className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-secondary-DEFAULT outline-none"
                      autoComplete="postal-code"
                    />
                  </div>

                  {/* ✅ Phone global (dial + number) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">
                      {tt('phone', 'رقم الهاتف', 'Phone')}
                      <span className="text-red-500 ms-1">*</span>
                    </label>

                    <div
                      className={[
                        'flex items-center gap-2 p-2 border rounded-xl bg-slate-50',
                        errors.phoneLocal ? 'border-red-400' : 'border-slate-200',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white border border-slate-200">
                        <Phone size={16} className="text-slate-400" />
                        <select
                          value={dialCode}
                          onChange={(e) => setDialCode(e.target.value)}
                          className="bg-transparent outline-none text-sm font-bold text-slate-700"
                          aria-label="dial-code"
                        >
                          {DIAL_OPTIONS.map((d) => (
                            <option key={d.code} value={d.dial}>
                              {isAR ? `${d.flag} ${d.nameAr} ${d.dial}` : `${d.flag} ${d.nameEn} ${d.dial}`}
                            </option>
                          ))}
                        </select>
                      </div>

                      <input
                        name="phoneLocal"
                        value={formData.phoneLocal}
                        onChange={(e) => setField('phoneLocal', e.target.value)}
                        type="tel"
                        inputMode="tel"
                        placeholder={tt('phonePlaceholder', 'اكتب رقمك بدون رمز الدولة', 'Type number without country code')}
                        className="flex-1 bg-transparent outline-none px-2 py-2 text-slate-800"
                        autoComplete="tel"
                      />
                    </div>

                    {errors.phoneLocal && <p className="mt-1 text-xs font-bold text-red-600">{errors.phoneLocal}</p>}
                    <p className="mt-1 text-[11px] text-slate-400 font-bold">
                      {tt('phoneHintGlobal', 'اختر رمز الدولة ثم اكتب رقمك', 'Choose country code then type your number')}
                      <span className="mx-2 text-slate-300">•</span>
                      <span className="text-slate-500 tabular-nums">{dialLabel}</span>
                    </p>
                  </div>

                  {/* Save info */}
                  <div className="md:col-span-2 flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">{tt('saveInfo', 'حفظ بياناتي للطلبات القادمة', 'Save my info for next time')}</p>
                      <p className="text-xs text-slate-500">{tt('saveInfoHint', 'لتسريع الطلب القادم (حسب النظام)', 'Speeds up next checkout (system dependent).')}</p>
                    </div>
                    <input type="checkbox" checked={!!formData.saveInfo} onChange={(e) => setField('saveInfo', e.target.checked)} className="w-5 h-5 accent-secondary-DEFAULT" />
                  </div>

                  {/* Billing toggle */}
                  <div className="md:col-span-2 flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">{tt('billingSame', 'عنوان الفاتورة نفس عنوان الشحن', 'Billing address same as shipping')}</p>
                      <p className="text-xs text-slate-500">{tt('billingHint', 'ألغِ التحديد إذا تريد عنوان مختلف', 'Uncheck to use a different billing address')}</p>
                    </div>
                    <input type="checkbox" checked={!!formData.billingSameAsShipping} onChange={(e) => setField('billingSameAsShipping', e.target.checked)} className="w-5 h-5 accent-secondary-DEFAULT" />
                  </div>

                  {/* Billing fields */}
                  

                  {/* Policies */}
                  <div className="md:col-span-2 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1 w-5 h-5 accent-secondary-DEFAULT"
                        checked={acceptPolicies}
                        onChange={(e) => {
                          setAcceptPolicies(e.target.checked);
                          setErrors((p) => {
                            const n = { ...p };
                            delete n.acceptPolicies;
                            return n;
                          });
                        }}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800">
                          {tt('acceptPolicies', 'أوافق على سياسات الشحن والخصوصية وشروط الخدمة', 'I agree to Shipping Policy, Privacy Policy, and Terms of Service')}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {tt('policiesHint', 'يمكن إضافة روابط الصفحات لاحقاً', 'You can add policy pages links later')}
                        </p>
                        {errors.acceptPolicies && <p className="mt-2 text-xs font-bold text-red-600">{errors.acceptPolicies}</p>}
                      </div>
                    </label>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <Button onClick={goToShipping} disabled={isProcessing}>
                    {tt('continueToShipping', 'متابعة للشحن', 'Continue to shipping')}
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2 */}
            {step === 2 && (
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <Truck className="text-secondary-DEFAULT" /> {tt('shippingMethod', 'طريقة الشحن', 'Shipping method')}
                </h2>

                <div className="space-y-3">
                  {CHECKOUT_SHIPPING_METHODS.map((method) => {
                    const active = shippingMethodId === method.id;
                    const Icon = method.icon || Truck;

                    return (
                      <label
                        key={method.id}
                        className={[
                          'flex items-center justify-between p-4 border rounded-2xl cursor-pointer transition-all',
                          active ? 'border-secondary-DEFAULT bg-secondary-light/10' : 'border-slate-200 hover:bg-slate-50',
                        ].join(' ')}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="shipping"
                            checked={active}
                            onChange={() => setShippingMethodId(method.id)}
                            className="w-5 h-5 accent-secondary-DEFAULT"
                          />
                          <div className="min-w-0">
                            <p className="font-extrabold text-slate-800 flex items-center gap-2">
                              <Icon size={16} className="text-secondary-DEFAULT" />
                              {isAR ? method.nameAr : method.nameEn}
                            </p>
                            <p className="text-xs text-slate-500">{isAR ? method.durationAr : method.durationEn}</p>
                          </div>
                        </div>

                        <span className="font-extrabold text-slate-800 tabular-nums">{formatMoney(Number(method.price || 0))}</span>
                      </label>
                    );
                  })}
                </div>

                {/* موعد التوصيل (يظهر + يصير إلزامي فقط مع schedule) */}
                <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                    <CalendarClock size={18} className="text-secondary-DEFAULT" />
                    {tt('preferredDelivery', 'موعد توصيل مفضل', 'Preferred delivery time')}
                    <span className="text-slate-400 font-medium text-xs">
                      {shippingMethodId === 'jo_schedule' ? tt('required', '(مطلوب)', '(required)') : tt('optional', '(اختياري)', '(optional)')}
                    </span>
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <input
                        type="date"
                        value={preferredDeliveryDate}
                        onChange={(e) => {
                          setPreferredDeliveryDate(e.target.value);
                          setErrors((p) => {
                            const n = { ...p };
                            delete n.preferredDeliveryDate;
                            return n;
                          });
                        }}
                        className={[
                          'w-full p-3 border rounded-xl bg-white outline-none focus:ring-2 focus:ring-secondary-DEFAULT',
                          errors.preferredDeliveryDate ? 'border-red-400' : 'border-slate-200',
                        ].join(' ')}
                      />
                      {errors.preferredDeliveryDate && <p className="mt-1 text-xs font-bold text-red-600">{errors.preferredDeliveryDate}</p>}
                    </div>

                    <div>
                      <input
                        type="time"
                        value={preferredDeliveryTime}
                        onChange={(e) => {
                          setPreferredDeliveryTime(e.target.value);
                          setErrors((p) => {
                            const n = { ...p };
                            delete n.preferredDeliveryTime;
                            return n;
                          });
                        }}
                        className={[
                          'w-full p-3 border rounded-xl bg-white outline-none focus:ring-2 focus:ring-secondary-DEFAULT',
                          errors.preferredDeliveryTime ? 'border-red-400' : 'border-slate-200',
                        ].join(' ')}
                      />
                      {errors.preferredDeliveryTime && <p className="mt-1 text-xs font-bold text-red-600">{errors.preferredDeliveryTime}</p>}
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 mt-2 font-bold">
                    {tt('deliveryTimeHint', 'قد يتغير حسب توفر المندوب والمنطقة', 'May vary based on courier and area availability.')}
                  </p>
                </div>

                <div className="mt-6 flex justify-between">
                  <Button variant="outline" onClick={() => setStep(1)} disabled={isProcessing}>
                    {tt('back', 'رجوع', 'Back')}
                  </Button>
                  <Button onClick={() => setStep(3)} disabled={isProcessing}>
                    {tt('continueToPayment', 'متابعة للدفع', 'Continue to payment')}
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3 */}
            {step === 3 && (
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <DollarSign className="text-secondary-DEFAULT" /> {tt('paymentMethod', 'طريقة الدفع', 'Payment method')}
                </h2>

                <div className="flex flex-wrap gap-3 mb-6">
                  <button
                    onClick={() => setPaymentMethod('cliq')}
                    type="button"
                    className={[
                      'flex-1 min-w-[160px] py-3 rounded-2xl border font-extrabold transition-all',
                      paymentMethod === 'cliq' ? 'border-blue-700 bg-blue-50 text-blue-900' : 'border-slate-200 text-slate-500 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <Smartphone size={18} /> CliQ
                    </div>
                  </button>

                  <button
                    onClick={() => setPaymentMethod('cod')}
                    type="button"
                    className={[
                      'flex-1 min-w-[160px] py-3 rounded-2xl border font-extrabold transition-all',
                      paymentMethod === 'cod' ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <DollarSign size={18} /> {tt('cod', 'الدفع عند الاستلام', 'Cash on delivery')}
                    </div>
                  </button>
                </div>

                {paymentMethod === 'cliq' && (
                  <div className="space-y-6">
                    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
                      <p className="text-sm text-blue-800 mb-2 font-extrabold">{tt('cliqTransferHint', 'حوّل المبلغ إلى معرف CliQ التالي:', 'Transfer the total amount to this CliQ ID:')}</p>
                      <div className="text-3xl font-extrabold text-blue-900 tracking-wider mb-2 select-all cursor-pointer bg-white/60 p-2 rounded-xl inline-block">
                        ANTASTORE
                      </div>
                      <p className="text-xs text-blue-700">
                        {tt('cliqRecipient', 'المستفيد:', 'Recipient:')} {tt('recipientName', 'مكتبة دير شرف العلمية Tech & Art', 'Dair Sharaf Library Tech & Art')}
                      </p>
                      <p className="text-xs text-blue-700 mt-1">
                        {tt('amount', 'المبلغ:', 'Amount:')} <span className="font-extrabold">{formatMoney(total)}</span>
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-extrabold text-slate-700 mb-2">{tt('referenceOrReceipt', 'رقم المرجع / صورة التحويل', 'Reference Number / Receipt')}</label>

                      <input
                        type="text"
                        placeholder={tt('enterCliqRef', 'أدخل رقم مرجع CliQ', 'Enter CliQ reference number')}
                        value={cliqRef}
                        onChange={(e) => setCliqRef(e.target.value)}
                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-secondary-DEFAULT mb-3"
                      />

                      <label className="block">
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleCliqReceiptPick(e.target.files?.[0] ?? null)} />
                        <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center hover:bg-slate-50 cursor-pointer transition-colors">
                          <Upload className="mx-auto text-slate-400 mb-2" />
                          <span className="text-sm text-slate-600 font-extrabold">{tt('uploadReceipt', 'ارفع صورة التحويل (اختياري)', 'Upload transfer screenshot (optional)')}</span>
                          <p className="text-xs text-slate-400 mt-1">{tt('uploadHint', 'PNG/JPG حتى ~2.5MB', 'PNG/JPG up to ~2.5MB')}</p>
                        </div>
                      </label>

                      {cliqReceiptDataUrl && (
                        <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-3">
                          <div className="flex items-center gap-2 text-sm font-extrabold text-slate-700 mb-2">
                            <ImageIcon size={16} /> {tt('receiptPreview', 'معاينة الصورة', 'Receipt preview')}
                          </div>
                          <img src={cliqReceiptDataUrl} alt="CliQ receipt preview" className="w-full max-h-72 object-contain rounded-xl bg-slate-50" />
                          <button type="button" onClick={() => setCliqReceiptDataUrl('')} className="mt-3 text-xs font-extrabold text-red-600 hover:opacity-80">
                            {tt('remove', 'حذف', 'Remove')}
                          </button>
                        </div>
                      )}
                    </div>

                    <Button onClick={handlePlaceOrder} className="w-full bg-blue-900 hover:bg-blue-800 text-white" isLoading={isProcessing} disabled={isProcessing}>
                      {tt('confirmOrder', 'تأكيد الطلب', 'Confirm order')}
                    </Button>
                  </div>
                )}

                {paymentMethod === 'cod' && (
                  <div className="text-center py-8 space-y-4">
                    <div className="w-16 h-16 bg-green-100 text-green-700 rounded-2xl flex items-center justify-center mx-auto">
                      <DollarSign size={32} />
                    </div>
                    <p className="text-slate-600 font-medium">
                      {tt('codHint', 'ستدفع عند الاستلام', 'You will pay cash upon delivery.')} — <span className="font-extrabold">{formatMoney(total)}</span>
                    </p>
                    <Button onClick={handlePlaceOrder} className="w-full bg-green-600 hover:bg-green-700 text-white" isLoading={isProcessing} disabled={isProcessing}>
                      {tt('confirmOrder', 'تأكيد الطلب', 'Confirm order')}
                    </Button>
                  </div>
                )}

                <div className="mt-6">
                  <Button variant="outline" onClick={() => setStep(2)} disabled={isProcessing}>
                    {tt('back', 'رجوع', 'Back')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="lg:w-96">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 sticky top-24">
              <h3 className="font-extrabold text-lg mb-4">{tt('orderSummary', 'ملخص الطلب', 'Order summary')}</h3>

              <div className="space-y-4 max-h-72 overflow-y-auto pr-2 custom-scrollbar mb-4">
                {cart.map((item: any) => (
                  <div key={item.id} className="flex gap-3">
                    <LazyImage src={item.image} alt={item.name} className="w-12 h-12 rounded-xl object-cover" containerClassName="w-12 h-12 rounded-xl shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-extrabold text-slate-800 line-clamp-1">{getProductTitle(item)}</p>
                      <div className="flex justify-between text-xs text-slate-500 mt-1">
                        <span className="tabular-nums">x{clampQty(item.quantity)}</span>
                        <span className="font-extrabold text-slate-700 tabular-nums">{formatMoney(Number(item.price || 0) * clampQty(item.quantity))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-2 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>{tt('subtotal', 'المجموع الفرعي', 'Subtotal')}</span>
                  <span className="font-extrabold tabular-nums">{formatMoney(subtotal)}</span>
                </div>

                <div className="flex justify-between text-green-700">
                  <span>{tt('discount', 'خصم', 'Discount')}</span>
                  <span className="font-extrabold tabular-nums">-{formatMoney(discountAmount)}</span>
                </div>

                <div className="flex justify-between text-slate-600">
                  <span>
                    {tt('shipping', 'الشحن', 'Shipping')} ({shippingLabel})
                  </span>
                  <span className="font-extrabold tabular-nums">{formatMoney(shippingCost)}</span>
                </div>

                <div className="flex justify-between text-lg font-extrabold text-slate-900 border-t border-slate-100 pt-2 mt-2">
                  <span>{tt('total', 'الإجمالي', 'Total')}</span>
                  <span className="tabular-nums">{formatMoney(total)}</span>
                </div>

                {safeTrim(orderNote) && (
                  <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600">
                    <span className="font-extrabold">{tt('orderNote', 'ملاحظة الطلب', 'Order note')}:</span>{' '}
                    <span className="text-slate-700">{safeTrim(orderNote)}</span>
                  </div>
                )}

                <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <Shield size={14} className="text-green-600" />
                    <span>{tt('secureCheckoutNote', 'عملية دفع آمنة. معلوماتك محمية.', 'Secure checkout. Your information is protected.')}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate('/cart')}
                className="mt-5 w-full text-sm font-extrabold text-secondary-DEFAULT hover:opacity-80 transition"
              >
                {tt('editCart', 'تعديل السلة', 'Edit cart')}
              </button>

              {/* Order note editor */}
              <div className="mt-4">
                <label className="block text-xs font-extrabold text-slate-600 mb-2">{tt('orderNote', 'ملاحظة الطلب', 'Order note')}</label>
                <textarea
                  value={orderNote || ''}
                  onChange={(e) => setOrderNote(e.target.value)}
                  maxLength={600}
                  placeholder={tt('orderNotePlaceholder', 'اكتب ملاحظة للبائع…', 'Write a note for the seller...')}
                  className="w-full min-h-[70px] resize-none p-3 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-secondary-DEFAULT focus:ring-2 focus:ring-secondary-DEFAULT/30 text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom mobile action (اختياري/احترافي) */}
        <div className="lg:hidden mt-8">
          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-slate-500">{tt('total', 'الإجمالي', 'Total')}</div>
              <div className="text-lg font-extrabold text-slate-900 tabular-nums">{formatMoney(total)}</div>
            </div>

            <Button
              onClick={() => {
                if (step === 1) goToShipping();
                else if (step === 2) setStep(3);
                else handlePlaceOrder();
              }}
              className="px-5"
              isLoading={isProcessing}
            >
              {step === 1 ? tt('continueToShipping', 'متابعة', 'Continue') : step === 2 ? tt('continueToPayment', 'متابعة', 'Continue') : tt('confirmOrder', 'تأكيد', 'Confirm')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Checkout;