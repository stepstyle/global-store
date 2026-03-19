// src/pages/Checkout.tsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useCart } from '../App';
import Button from '../components/Button';
import {
  CheckCircle,
  Truck,
  MapPin,
  Shield,
  DollarSign,
  Smartphone,
  ShoppingBag,
  Mail,
  Phone,
  MessageCircle,
  Copy,
  Search,
  Zap,
  Clock
} from 'lucide-react';
import * as ReactRouterDOM from 'react-router-dom';
import { db } from '../services/storage';
import { Order, Product } from '../types';
import SEO from '../components/SEO';
import LazyImage from '../components/LazyImage';

const { useNavigate } = ReactRouterDOM as any;

type PaymentMethod = 'cod' | 'cliq';

const safeTrim = (s: any) => String(s ?? '').trim();

const clampQty = (n: any) => {
  const x = Math.round(Number(n) || 1);
  return Math.max(1, Math.min(99, x));
};

// 🚨 رقم واتساب المتجر
const STORE_WHATSAPP = '962796969081';

const JO_COUNTRY = { code: 'JO', nameAr: 'الأردن', nameEn: 'Jordan' };

const REGIONS = [
  {
    labelAr: 'محافظات الوسط',
    labelEn: 'Central Region',
    govs: [
      { slug: 'amman', ar: 'عمّان (العاصمة)', en: 'Amman' },
      { slug: 'zarqa', ar: 'الزرقاء', en: 'Zarqa' },
      { slug: 'balqa', ar: 'البلقاء (السلط)', en: 'Balqa' },
      { slug: 'madaba', ar: 'مادبا', en: 'Madaba' },
    ]
  },
  {
    labelAr: 'محافظات الشمال',
    labelEn: 'Northern Region',
    govs: [
      { slug: 'irbid', ar: 'إربد', en: 'Irbid' },
      { slug: 'jerash', ar: 'جرش', en: 'Jerash' },
      { slug: 'ajloun', ar: 'عجلون', en: 'Ajloun' },
      { slug: 'mafraq', ar: 'المفرق', en: 'Mafraq' },
    ]
  },
  {
    labelAr: 'محافظات الجنوب',
    labelEn: 'Southern Region',
    govs: [
      { slug: 'karak', ar: 'الكرك', en: 'Karak' },
      { slug: 'tafilah', ar: 'الطفيلة', en: 'Tafilah' },
      { slug: 'maan', ar: 'معان', en: "Ma'an" },
      { slug: 'aqaba', ar: 'العقبة', en: 'Aqaba' },
    ]
  }
];

const JO_GOVS = REGIONS.flatMap(r => r.govs);

// 🚀 قائمة مناطق عمان الذكية (مضاف إليها خيار المنطقة الأخرى للحماية)
const AMMAN_AREAS = [
  { id: 'a1', nameAr: 'النزهة / طبربور / طارق/ ضاحية الامير حسنن', nameEn: 'Nuzha / Tabarbour / Tariq', price: 1.0, isOutskirt: false },
  { id: 'a2', nameAr: 'جبل الحسين / اللويبدة / العبدلي', nameEn: 'Jabal Hussein / Lweibdeh / Abdali', price: 1.0, isOutskirt: false },
  { id: 'a3', nameAr: 'الهاشمي الشمالي والجنوبي / ماركا', nameEn: 'Hashimi / Marka', price: 1.0, isOutskirt: false },
  { id: 'a4', nameAr: 'ضاحية الأقصى / الاستقلال', nameEn: 'Dahiyet Al Aqsa / Istiqlal', price: 1.0, isOutskirt: false },
  { id: 'a5', nameAr: 'وسط البلد / الأشرفية / الوحدات', nameEn: 'Downtown / Ashrafieh / Wehdat', price: 1.5, isOutskirt: false },
  { id: 'a6', nameAr: 'تلاع العلي / خلدا / أم السماق', nameEn: 'Tlaa Al Ali / Khalda / Um Al Summaq', price: 1.5, isOutskirt: false },
  { id: 'a7', nameAr: 'الشميساني / عبدون / دير غبار / الصويفية', nameEn: 'Shmeisani / Abdoun / Sweifieh', price: 2.0, isOutskirt: false },
  { id: 'a8', nameAr: 'الدوار السابع والثامن / البيادر', nameEn: '7th & 8th Circle / Bayader', price: 1.5, isOutskirt: false },
  { id: 'a9', nameAr: 'الجبيهة / أبو نصير / شفا بدران', nameEn: 'Jubeiha / Abu Nuseir / Shafa Badran', price: 2.5, isOutskirt: false },
  { id: 'a10', nameAr: 'دابوق / بدر الجديدة / الفحيص', nameEn: 'Dabouq / Badr Al Jadeedah', price: 2.5, isOutskirt: false },
  { id: 'a11', nameAr: 'مرج الحمام / المقابلين / البنيات', nameEn: 'Marj Al Hamam / Muqabalain', price: 2.5, isOutskirt: false },
  { id: 'a12', nameAr: 'سحاب / أبو علندا / اليادودة', nameEn: 'Sahab / Abu Alanda / Yadoudeh', price:2.5, isOutskirt: true },
  { id: 'a13', nameAr: 'الجيزة / خريبة السوق / القسطل', nameEn: 'Jizah / Khreibet Souq', price: 2.5, isOutskirt: true },
  { id: 'a14', nameAr: 'ناعور / طريق المطار', nameEn: 'Naour / Airport Road', price: 2.5, isOutskirt: true },
  // 🛡️ الخيار البديل (Fallback)
  { id: 'other', nameAr: 'منطقة أخرى (غير مذكورة في القائمة)', nameEn: 'Other Area (Not Listed)', price: 2.0, isOutskirt: true },
];

type DialOption = { code: string; dial: string; flag: string; nameAr: string; nameEn: string };
const DIAL_OPTIONS: DialOption[] = [
  { code: 'JO', dial: '+962', flag: '🇯🇴', nameAr: 'الأردن', nameEn: 'Jordan' },
];

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 🚀 التحقق الصارم من رقم الهاتف الأردني
const isValidJordanPhone = (phone: string) => {
  const cleanPhone = digitsOnly(phone);
  return /^(079|078|077)\d{7}$/.test(cleanPhone);
};

const digitsOnly = (s: string) => String(s ?? '').replace(/[^\d]/g, '');

const normalizeName = (name: string) => safeTrim(name).replace(/\s+/g, ' ');
const normalizeAddress = (addr: string) => safeTrim(addr).replace(/\s+/g, ' ');

const normalizePhoneGlobal = (dial: string, local: string) => {
  const d = String(dial || '').trim();
  const num = digitsOnly(local);
  if (!d || !num) return '';
  const cleanLocal = num.startsWith('0') ? num.substring(1) : num;
  return `${d}${cleanLocal}`;
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
    products,
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
  const isLoggedIn = !!user?.id;

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
  const [shippingMethodId, setShippingMethodId] = useState<string>('standard');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [isProcessing, setIsProcessing] = useState(false);

  const [email, setEmail] = useState<string>(() => safeTrim(user?.email || ''));
  useEffect(() => {
    const uEmail = safeTrim(user?.email || '');
    if (uEmail && !safeTrim(email)) setEmail(uEmail);
  }, [user?.email]);

  const [dialCode, setDialCode] = useState<string>(() => '+962');
  const [cliqRef, setCliqRef] = useState('');

  // 🚀 حالات البحث الذكي
  const [areaSearchQuery, setAreaSearchQuery] = useState('');
  const [isAreaDropdownOpen, setIsAreaDropdownOpen] = useState(false);

  const [formData, setFormData] = useState({
    fullName: '',
    country: JO_COUNTRY.nameEn,
    citySlug: '',
    ammanAreaId: '', 
    streetAddress: '', // اختياري الآن
    postalCode: '',
    phoneLocal: '',
    saveInfo: true,
    billingSameAsShipping: true,
  });

  const [acceptPolicies, setAcceptPolicies] = useState(true);
  const [acceptDeliveryPolicy, setAcceptDeliveryPolicy] = useState(false);
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

  // فلترة المناطق بناءً على البحث
  const filteredAreas = useMemo(() => {
    if (!areaSearchQuery) return AMMAN_AREAS;
    const q = areaSearchQuery.toLowerCase();
    return AMMAN_AREAS.filter(a =>
      a.nameAr.toLowerCase().includes(q) || a.nameEn.toLowerCase().includes(q)
    );
  }, [areaSearchQuery]);

  const selectedAmmanArea = useMemo(() => {
    return AMMAN_AREAS.find(a => a.id === formData.ammanAreaId);
  }, [formData.ammanAreaId]);

  // تسعيرة التوصيل الأساسية بناءً على المنطقة
  const baseShippingCost = useMemo(() => {
    const slug = formData.citySlug;
    if (!slug) return 0;

    if (slug === 'amman') {
      const area = AMMAN_AREAS.find(a => a.id === formData.ammanAreaId);
      if (!area) return 0;
      return area.price;
    }
    // باقي المحافظات
    return 3.0;
  }, [formData.citySlug, formData.ammanAreaId]);

  // 🚀 خيارات التوصيل الذكية (عادي وسريع)
  const dynamicShippingMethods = useMemo(() => {
    return [
      {
        id: 'standard',
        nameAr: 'توصيل عادي (خلال 48 ساعة)',
        nameEn: 'Standard Delivery (48 Hours)',
        durationAr: 'نفس التسعيرة الأساسية لمنطقتك',
        durationEn: 'Base price for your area',
        price: baseShippingCost,
        icon: Truck,
      },
      {
        id: 'fast',
        nameAr: 'توصيل سريع (خلال 12 ساعة)',
        nameEn: 'Fast Delivery (12 Hours)',
        durationAr: 'أولوية التجهيز (+ 1 دينار)',
        durationEn: 'Priority fulfillment (+ 1 JD)',
        price: baseShippingCost + 1.0, // زيادة دينار واحد
        icon: Zap,
      }
    ];
  }, [baseShippingCost]);

  const selectedShipping = useMemo(
    () => dynamicShippingMethods.find((m) => m.id === shippingMethodId) || dynamicShippingMethods[0],
    [shippingMethodId, dynamicShippingMethods]
  );

  // 🚀 التعديل الجوهري: ربط السلة بالمنتجات الأصلية والأسعار الخاصة بالخيارات
  const validatedCart = useMemo(() => {
    const safeCart = Array.isArray(cart) ? cart : [];
    return safeCart.map((cartItem: any) => {
      const realProduct = products.find((p: Product) => p.id === cartItem.id);
      const variant = cartItem.selectedVariant;
      
      // إذا كان الزبون قد اختار Variant (حجم/لون)، نأخذ سعره، وإلا نأخذ سعر المنتج الأساسي
      const finalPrice = variant ? variant.price : (realProduct ? realProduct.price : cartItem.price);
      
      return {
        ...cartItem,
        price: finalPrice,
        stock: variant ? variant.stock : (realProduct ? realProduct.stock : cartItem.stock),
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
    const currentEmail = safeTrim(email || user?.email || '');

    if (!isLoggedIn && !currentEmail) {
      nextErr.email = tr('البريد الإلكتروني مطلوب للضيوف', 'Email is required for guests');
    } else if (currentEmail && !emailRegex.test(currentEmail)) {
      nextErr.email = tr('البريد الإلكتروني غير صحيح', 'Invalid email');
    }

    const name = normalizeName(formData.fullName);
    if (name.length < 5) {
      nextErr.fullName = tt('nameMin5', 'الاسم يجب أن يكون 5 أحرف على الأقل', 'Name must be at least 5 characters.');
    }

    if (!safeTrim(formData.citySlug)) {
      nextErr.citySlug = tt('cityRequired', 'المحافظة مطلوبة', 'City is required.');
    } else if (formData.citySlug === 'amman' && !safeTrim(formData.ammanAreaId)) {
      nextErr.ammanAreaId = tt('areaRequired', 'يرجى تحديد منطقتك السكنية', 'Please select your residential area.');
    }

    // 🚀 تمت إزالة الفحص الإجباري لحقل (العنوان التفصيلي) بناءً على طلبك

    if (!isValidJordanPhone(formData.phoneLocal)) {
      nextErr.phoneLocal = tt('phoneInvalid', 'يرجى إدخال رقم أردني صحيح (يبدأ بـ 079, 078, 077)', 'Please enter a valid Jordanian number (079, 078, 077).');
    }

    if (!acceptPolicies) {
      nextErr.acceptPolicies = tt('acceptPoliciesRequired', 'يجب الموافقة على سياسات المتجر لإتمام الطلب', 'You must accept the store policies to place the order.');
    }

    setErrors(nextErr);
    return Object.keys(nextErr).length === 0;
  };

  const goToShipping = () => {
    const ok = validateStep1();
    if (!ok) {
      showToast(tt('fixErrors', 'يرجى تصحيح الحقول المحددة باللون الأحمر', 'Please fix the required fields.'), 'error');
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

    const ok = validateStep1();
    if (!ok) {
      showToast(tt('fixErrors', 'يرجى تصحيح الحقول المطلوبة', 'Please fix the required fields.'), 'error');
      changeStep(1);
      return;
    }

    if (!selectedShipping) {
      showToast(tt('shippingRequired', 'يرجى اختيار طريقة التوصيل', 'Please select a shipping method.'), 'error');
      changeStep(2);
      return;
    }

    if (paymentMethod === 'cliq') {
      const ref = safeTrim(cliqRef);
      if (!ref) {
        showToast(tt('enterCliqRef', 'يرجى إدخال الرقم المرجعي لحوالة CliQ', 'Please enter the CliQ reference number.'), 'error');
        return;
      }
    }

    setIsProcessing(true);

    try {
      const shippingPhoneE164 = normalizePhoneGlobal(dialCode, formData.phoneLocal) || safeTrim(formData.phoneLocal);
      
      let shippingCityName = '';
      REGIONS.forEach(r => {
        const gov = r.govs.find(g => g.slug === formData.citySlug);
        if (gov) shippingCityName = isAR ? gov.ar : gov.en;
      });

      if (formData.citySlug === 'amman' && selectedAmmanArea) {
        shippingCityName = `${shippingCityName} - ${isAR ? selectedAmmanArea.nameAr : selectedAmmanArea.nameEn}`;
      }

      const shippingStreet = normalizeAddress(formData.streetAddress) || 'لم يتم إدخال عنوان تفصيلي';
      
      const now = new Date();
      const nowIso = now.toISOString();
      const nowDate = nowIso.split('T')[0];
      const orderId = makeOrderId();

      // 🚀 التعديل الجوهري: إضافة selectedVariant إلى كائن الطلب (Order)
      const newOrder: Order & any = {
        id: orderId,
        userId: user ? user.id : 'guest',
        status: 'new',
        seenByAdmin: false,
        date: nowDate,
        createdAt: nowIso,
        createdAtMs: now.getTime(),
        updatedAt: nowIso,
        items: validatedCart.map((item: any) => ({
          productId: item.id,
          name: item.name,
          price: Number(item.price || 0),
          quantity: clampQty(item.quantity),
          image: item.image,
          selectedVariant: item.selectedVariant || null, // 🚀 هنا سحر وصول الألوان للأدمن
        })),
        subtotal,
        discountAmount,
        shippingCost,
        total,
        shippingMethodId,
        shippingMethod: isAR ? selectedShipping.nameAr : selectedShipping.nameEn,
        paymentMethod,
        customerEmail: safeTrim(email) || safeTrim(user?.email || ''),
        consents: {
          acceptedStorePolicies: !!acceptPolicies,
          acceptedDeliveryPolicy: !!acceptDeliveryPolicy,
          saveInfo: !!formData.saveInfo,
          billingSameAsShipping: !!formData.billingSameAsShipping,
        },
        note: safeTrim(orderNote) || undefined,
        paymentDetails: paymentMethod === 'cliq' ? { cliqReference: safeTrim(cliqRef), isPaid: false } : undefined,
        address: { fullName: normalizeName(formData.fullName) || 'Guest', city: shippingCityName, street: shippingStreet, phone: shippingPhoneE164 },
        addressMeta: { country: JO_COUNTRY.nameEn, countryCode: JO_COUNTRY.code, citySlug: formData.citySlug, ammanAreaId: formData.ammanAreaId, saveInfo: !!formData.saveInfo, phoneDial: dialCode, phoneLocal: safeTrim(formData.phoneLocal) },
      };

      const workerUrl = import.meta.env.VITE_WORKER_URL;
      if (workerUrl && workerUrl.trim() !== '') {
        fetch(`${workerUrl}/create-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: newOrder }),
        }).catch(e => console.warn('Background sync error', e));
      }

      try {
        if (db?.orders?.create) await db.orders.create(newOrder);
      } catch (dbError) {}

      try {
        sessionStorage.setItem(`order_success_${newOrder.id}`, JSON.stringify(newOrder));
      } catch (storageError) {}

      clearCart();
      if (typeof clearOrderNote === 'function') clearOrderNote();
      
      showToast(tt('alertSet', 'تم استلام طلبك بنجاح', 'Order placed successfully.'), 'success');

      if (paymentMethod === 'cliq') {
        const waMsg = `مرحباً متجر دير شرف 👋\nتم الدفع عبر CliQ، وهذا طلبي الجديد.\n\n*الاسم:* ${normalizeName(formData.fullName)}\n*رقم الطلب:* #${orderId}\n*الرقم المرجعي للتحويل:* ${safeTrim(cliqRef)}\n\n(يرجى إرفاق صورة إيصال التحويل مع هذه الرسالة لتأكيد طلبك ✅)`;
        const waUrl = `https://wa.me/${STORE_WHATSAPP}?text=${encodeURIComponent(waMsg)}`;
        window.open(waUrl, '_blank');
      }

      navigate(`/order-success/${newOrder.id}`, { state: { order: newOrder }, replace: true });
    } catch (error: any) {
      console.error('Checkout submit failed:', error);
      showToast(tt('placeOrderFailed', 'فشل إنشاء الطلب، يرجى المحاولة مرة أخرى', 'Failed to place order. Please try again.'), 'error');
      setIsProcessing(false);
    }
  };

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
          <Button onClick={() => navigate('/shop')} className="w-full py-4 text-lg mt-8">
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
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-10">
          <div className="min-w-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h1 className="text-4xl font-heading font-black text-slate-900 flex items-center gap-3">
              {tt('checkout', 'إتمام الدفع', 'Secure Checkout')}
            </h1>
            <p className="text-slate-500 font-medium mt-2">
              {tt('checkoutHint', 'نضمن لك تجربة تسوق آمنة وسريعة', 'Simple, fast, and secure checkout process.')}
            </p>
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
                  const hint = i === 1 ? tt('stepAddressHint', 'بيانات الوجهة', 'Delivery details') : i === 2 ? tt('stepShippingHint', 'تأكيد التسعيرة', 'Confirm shipping') : tt('stepPaymentHint', 'تأكيد الطلب', 'Confirm order');

                  return (
                    <div key={i} className={`flex-1 flex flex-col sm:flex-row items-center sm:items-start gap-3 text-center sm:text-start transition-opacity duration-300 ${!active && !done ? 'opacity-50' : 'opacity-100'}`}>
                      <div className={['w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0 transition-all duration-500', active ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30 scale-110' : done ? 'bg-black text-white shadow-md' : 'bg-slate-100 text-slate-400'].join(' ')}>
                        {done ? <CheckCircle size={20} strokeWidth={3} /> : i}
                      </div>
                      <div className="min-w-0 hidden sm:block mt-1">
                        <p className={`text-sm font-black ${done || active ? 'text-slate-900' : 'text-slate-500'}`}>{title}</p>
                        <p className="text-[11px] font-bold text-slate-400 line-clamp-1 mt-0.5">{hint}</p>
                      </div>
                      {i < 3 && <div className="hidden sm:block h-[3px] rounded-full bg-slate-100 flex-1 mx-4 mt-4" ><div className={`h-full bg-black rounded-full transition-all duration-700 ${done ? 'w-full' : 'w-0'}`} /></div>}
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
                    متاح داخل الأردن فقط 🇯🇴
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('emailAddress', 'البريد الإلكتروني', 'Email Address')}
                      {!isLoggedIn && <span className="text-red-500">*</span>}
                    </label>

                    <div className="relative">
                      <Mail size={18} className="absolute left-4 rtl:left-auto rtl:right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={email}
                        onChange={(e) => setEmailField(e.target.value)}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder={isLoggedIn ? 'name@example.com (اختياري)' : 'name@example.com'}
                        className={inputClass(!!errors.email) + ' pl-12 pr-4 rtl:pl-4 rtl:pr-12'}
                        dir="ltr"
                      />
                    </div>

                    <p className="mt-1.5 ms-1 text-[11px] font-bold text-slate-400">
                      {isLoggedIn
                        ? 'إذا تركته فارغًا سيتم استخدام بريد الحساب المسجل.'
                        : 'مطلوب لإرسال تأكيد الطلب ومتابعة الحالة.'}
                    </p>

                    {errors.email && (
                      <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.email}</p>
                    )}
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
                      placeholder="الاسم الأول والأخير"
                      className={inputClass(!!errors.fullName)}
                    />
                    {errors.fullName && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.fullName}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('phone', 'رقم الجوال', 'Mobile Number')} <span className="text-red-500">*</span>
                    </label>
                    <div className={inputClass(!!errors.phoneLocal) + ' flex items-center gap-2 p-1.5'}>
                      <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white border border-slate-200 shadow-sm shrink-0">
                        <Phone size={16} className="text-slate-400 hidden sm:block" />
                        <span className="text-sm font-black text-slate-700" dir="ltr">+962</span>
                      </div>
                      <input
                        value={formData.phoneLocal}
                        onChange={(e) => setField('phoneLocal', e.target.value)}
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="0791234567"
                        className="flex-1 min-w-0 bg-transparent border-none outline-none px-3 font-bold text-lg tabular-nums placeholder:text-slate-300"
                        dir="ltr"
                      />
                    </div>
                    {errors.phoneLocal && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.phoneLocal}</p>}
                  </div>

                  {/* اختيار المحافظة */}
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      المحافظة <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.citySlug}
                      onChange={(e) => {
                        setField('citySlug', e.target.value);
                        setField('ammanAreaId', ''); // مسح المنطقة إذا غير المحافظة
                        setAreaSearchQuery('');
                      }}
                      className={inputClass(!!errors.citySlug) + ' appearance-none cursor-pointer'}
                    >
                      <option value="" disabled>— اختر المحافظة —</option>
                      {REGIONS.map((region, idx) => (
                        <optgroup key={idx} label={isAR ? region.labelAr : region.labelEn} className="font-black text-slate-900 bg-slate-50">
                          {region.govs.map((gov) => (
                            <option key={gov.slug} value={gov.slug} className="font-bold text-slate-700 bg-white">
                              {isAR ? gov.ar : gov.en}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {errors.citySlug && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.citySlug}</p>}
                  </div>

                  {/* 🚀 نظام البحث الذكي لمناطق عمان */}
                  {formData.citySlug === 'amman' && (
                    <div className="md:col-span-2 animate-in fade-in slide-in-from-top-4 duration-300 relative">
                      <label className="block text-xs font-black uppercase tracking-widest text-sky-600 mb-2 ms-1">
                        تحديد المنطقة (أو القريبة منها إذا لم تكن منطقتك موجودة) <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={formData.ammanAreaId ? (AMMAN_AREAS.find(a => a.id === formData.ammanAreaId)?.nameAr || areaSearchQuery) : areaSearchQuery}
                          onChange={(e) => {
                            setAreaSearchQuery(e.target.value);
                            setField('ammanAreaId', ''); 
                            setIsAreaDropdownOpen(true);
                          }}
                          onFocus={() => setIsAreaDropdownOpen(true)}
                          onBlur={() => setTimeout(() => setIsAreaDropdownOpen(false), 200)}
                          placeholder="اكتب اسم منطقتك للبحث السريع..."
                          className={inputClass(!!errors.ammanAreaId) + ' w-full pr-12 rtl:pr-12 rtl:pl-4 bg-sky-50/30 border-sky-200'}
                        />
                        <Search size={20} className="absolute left-4 rtl:left-auto rtl:right-4 top-1/2 -translate-y-1/2 text-sky-400 pointer-events-none" />
                      </div>
                      
                      {isAreaDropdownOpen && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 shadow-2xl rounded-2xl max-h-60 overflow-y-auto z-50 p-2 animate-in fade-in zoom-in-95 duration-200">
                          {filteredAreas.length > 0 ? (
                            filteredAreas.map(area => (
                              <div
                                key={area.id}
                                className={`p-3 cursor-pointer rounded-xl transition-colors flex justify-between items-center ${area.id === 'other' ? 'bg-orange-50 hover:bg-orange-100 border border-orange-100 mt-2' : 'hover:bg-sky-50'}`}
                                onMouseDown={(e) => {
                                  e.preventDefault(); 
                                  setField('ammanAreaId', area.id);
                                  setAreaSearchQuery(area.nameAr);
                                  setIsAreaDropdownOpen(false);
                                }}
                              >
                                <span className={`font-bold ${area.id === 'other' ? 'text-orange-700' : 'text-slate-800'}`}>
                                  {area.nameAr}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="p-4 text-center text-slate-500 font-bold text-sm">
                              لا توجد منطقة مطابقة. يرجى اختيار "منطقة أخرى"
                            </div>
                          )}
                        </div>
                      )}
                      {errors.ammanAreaId && <p className="mt-1.5 ms-1 text-xs font-bold text-red-500">{errors.ammanAreaId}</p>}
                    </div>
                  )}

                  {/* 🚀 العنوان التفصيلي (اختياري) */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2 ms-1">
                      {tt('detailedAddress', 'العنوان التفصيلي', 'Detailed Address')} <span className="text-slate-400 normal-case">(اختياري)</span>
                    </label>
                    <input
                      name="streetAddress"
                      value={formData.streetAddress}
                      onChange={(e) => setField('streetAddress', e.target.value)}
                      type="text"
                      placeholder="اسم الشارع - رقم البناية - الشقة (اختياري)"
                      className={inputClass(false)} // أزلنا فحص الخطأ لأنه اختياري
                    />
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100 flex justify-end">
                  <Button onClick={goToShipping} disabled={isProcessing} className="w-full sm:w-auto px-10 py-4 text-lg">
                    {tt('continueToShipping', 'متابعة لاختيار التوصيل', 'Continue to delivery options')}
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 2: Shipping Confirmation */}
            {step === 2 && (
              <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right-4 duration-500">
                <h2 className="text-2xl font-black text-slate-900 mb-8 pb-4 border-b border-slate-100 flex items-center gap-3">
                  <Truck className="text-sky-500" size={28} strokeWidth={2.5} />
                  تأكيد تسعيرة وسرعة التوصيل
                </h2>

                <div className="space-y-4">
                  {dynamicShippingMethods.map((method) => {
                    const active = shippingMethodId === method.id;
                    const Icon = method.icon;

                    return (
                      <label 
                        key={method.id} 
                        className={`flex items-center justify-between p-5 rounded-2xl border-2 cursor-pointer transition-all duration-300 ${active ? 'border-sky-500 bg-sky-50 shadow-md shadow-sky-500/10' : 'border-slate-200 hover:border-sky-300 hover:bg-slate-50'}`}
                      >
                        <div className="flex items-center gap-4">
                          <input 
                            type="radio" 
                            name="shippingMethod" 
                            value={method.id} 
                            checked={active} 
                            onChange={() => setShippingMethodId(method.id)} 
                            className="w-5 h-5 accent-sky-500" 
                          />
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
                        <span className={`font-black text-lg tabular-nums shrink-0 ml-4 rtl:ml-0 rtl:mr-4 ${active ? 'text-sky-700' : 'text-slate-700'}`}>
                          {formatMoney(Number(method.price || 0))}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-between gap-4">
                  <Button variant="outline" onClick={() => changeStep(1)} disabled={isProcessing} className="w-full sm:w-auto px-8 py-4">
                    {tt('back', 'تعديل العنوان', 'Edit Address')}
                  </Button>
                  <Button onClick={() => changeStep(3)} disabled={isProcessing} className="w-full sm:w-auto px-10 py-4 text-lg shadow-xl shadow-sky-500/20">
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
                    className={['flex-1 py-5 px-4 rounded-2xl border-2 font-black transition-all duration-300 relative overflow-hidden', paymentMethod === 'cliq' ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-md shadow-indigo-500/10' : 'border-slate-100 text-slate-500 hover:bg-slate-50 hover:border-slate-300'].join(' ')}
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
                    className={['flex-1 py-5 px-4 rounded-2xl border-2 font-black transition-all duration-300 relative overflow-hidden', paymentMethod === 'cod' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-md shadow-emerald-500/10' : 'border-slate-100 text-slate-500 hover:bg-slate-50 hover:border-slate-300'].join(' ')}
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
                      <p className="text-sm text-indigo-800 mb-4 font-bold uppercase tracking-widest">
                        معلومات حساب CliQ الخاص بالمتجر:
                      </p>
                      
                      <div className="flex flex-col gap-3 max-w-sm mx-auto mb-6">
                        <div className="bg-white px-5 py-4 rounded-xl shadow-sm border border-indigo-50 flex justify-between items-center">
                          <span className="text-slate-400 text-sm font-bold">الاسم (Name):</span>
                          <span className="font-black text-indigo-900 text-[13px] text-left uppercase leading-tight max-w-[180px]">
                            Moien AbedAlAzizi Mahmoud Antari
                          </span>
                        </div>
                        
                        <div 
                          onClick={() => {
                            navigator.clipboard.writeText('0796969081');
                            showToast('تم نسخ الرقم بنجاح', 'success');
                          }}
                          className="bg-white px-5 py-4 rounded-xl shadow-sm border border-indigo-200 flex justify-between items-center cursor-pointer hover:bg-indigo-50/80 transition-all group"
                        >
                          <span className="text-slate-400 text-sm font-bold flex items-center gap-2">
                            <Copy size={14} className="group-hover:text-indigo-500 transition-colors" />
                            الرقم / Alias:
                          </span>
                          <span className="font-black text-xl text-indigo-600 tracking-widest">0796969081</span>
                        </div>

                        <div className="bg-white px-5 py-4 rounded-xl shadow-sm border border-indigo-50 flex justify-between items-center">
                          <span className="text-slate-400 text-sm font-bold">البنك (Bank):</span>
                          <span className="font-black text-indigo-900 text-sm">بنك الأردن (Bank of Jordan)</span>
                        </div>
                      </div>

                      <div className="bg-indigo-900 text-white rounded-2xl py-5 flex flex-col items-center justify-center shadow-md">
                        <span className="text-indigo-200 text-sm mb-1 font-bold">المبلغ الإجمالي المطلوب تحويله:</span>
                        <span className="text-3xl font-black tabular-nums">{formatMoney(total)}</span>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 text-center">
                      <label className="block text-sm font-black text-slate-800 mb-3 text-start">
                        {tt('referenceOrReceipt', 'الرقم المرجعي للعملية (Reference Number)', 'Transaction Reference Number')} <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="رقم مكون من أرقام أو أحرف (e.g. 1234567890)"
                        value={cliqRef}
                        onChange={(e) => setCliqRef(e.target.value)}
                        className={inputClass(false) + ' bg-white mb-5 text-center tracking-wider text-xl font-black'}
                      />

                      <div className="bg-[#25D366]/10 border border-[#25D366]/20 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4 text-start">
                        <div className="w-12 h-12 shrink-0 bg-[#25D366]/20 text-[#25D366] rounded-full flex items-center justify-center">
                           <MessageCircle size={24} strokeWidth={2.5} />
                        </div>
                        <p className="text-sm font-bold text-slate-700 leading-relaxed">
                          لتسريع العملية، سيتم <span className="text-[#25D366] font-black">تحويلك إلى الواتساب</span> لإرسال صورة الإيصال بمجرد النقر على زر تأكيد الطلب بالأسفل.
                        </p>
                      </div>
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
                      لن يتم خصم أي مبلغ إلكترونياً. يرجى تجهيز المبلغ المطلوب نقداً لمندوب التوصيل.
                    </p>
                    <div className="bg-white rounded-2xl py-4 px-6 inline-block shadow-sm border border-emerald-50">
                      <span className="text-sm font-bold text-slate-500 uppercase tracking-widest block mb-1">المبلغ المطلوب دفعه</span>
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
                    {isProcessing ? 'جاري تأكيد الطلب...' : tt('placeOrder', 'تأكيد وإتمام الطلب', 'Confirm & Place Order')}
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
                {validatedCart.map((item: any, idx: number) => {
                  const variant = item.selectedVariant;
                  return (
                    <div key={`${item.id}-${idx}`} className="flex gap-4 group">
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
                        <p className="text-sm font-black text-slate-800 line-clamp-1 leading-snug group-hover:text-sky-600 transition-colors">
                          {getProductTitle(item)}
                        </p>
                        {/* 🚀 إظهار الخيار للزبون في فاتورة الدفع */}
                        {variant && (
                          <div className="mt-1 flex items-center gap-1.5 w-fit">
                            {variant.type === 'color' && variant.colorCode && (
                              <span 
                                className="w-2.5 h-2.5 rounded-full border border-black/10 shadow-inner block shrink-0" 
                                style={{ backgroundColor: variant.colorCode }}
                              />
                            )}
                            {variant.label && variant.label.trim() !== '.' && (
                              <span className="text-[10px] font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">{variant.label}</span>
                            )}
                          </div>
                        )}
                        <p className="font-black text-slate-500 tabular-nums mt-1 text-xs">
                          {formatMoney(Number(item.price || 0) * clampQty(item.quantity))}
                        </p>
                      </div>
                    </div>
                  );
                })}
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
                  <span>{tt('shipping', 'رسوم التوصيل', 'Shipping Fee')}</span>
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
                  placeholder="تعليمات لمندوب التوصيل أو تفاصيل تغليف الهدية..."
                  className="w-full min-h-[80px] resize-none p-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-400/10 text-sm font-bold placeholder:font-medium placeholder:text-slate-400 transition-all"
                />
              </div>

              <div className="mt-6 rounded-[2rem] border border-slate-100 bg-slate-50/70 p-4 sm:p-5">
                <div className="mb-4">
                  <h4 className="text-sm font-black text-slate-900">خيارات الطلب والموافقات</h4>
                  <p className="mt-1 text-xs font-bold text-slate-400">
                    إعدادات إضافية لتسريع الطلب وتجهيز بياناته بشكل أفضل
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:bg-slate-50 transition-all cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.saveInfo}
                      onChange={(e) => setField('saveInfo', e.target.checked)}
                      className="mt-1 h-5 w-5 shrink-0 accent-sky-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-slate-800">حفظ بياناتي لتسريع الدفع مستقبلاً</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">اختياري</span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-400">
                        يحفظ بيانات الاستلام لتعبئة أسرع في الطلبات القادمة
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:bg-slate-50 transition-all cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acceptDeliveryPolicy}
                      onChange={(e) => setAcceptDeliveryPolicy(e.target.checked)}
                      className="mt-1 h-5 w-5 shrink-0 accent-sky-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-slate-800">اطلعت على سياسة التوصيل</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">اختياري</span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-400">
                        يساعد في توضيح مواعيد وآلية التوصيل قبل تأكيد الطلب
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 rounded-2xl border p-4 transition-all cursor-pointer ${
                      errors.acceptPolicies
                        ? 'border-red-300 bg-red-50'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={acceptPolicies}
                      onChange={(e) => {
                        setAcceptPolicies(e.target.checked);
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.acceptPolicies;
                          return next;
                        });
                      }}
                      className="mt-1 h-5 w-5 shrink-0 accent-sky-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-slate-800">أوافق على سياسات المتجر وأحكام الخدمة</span>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-600">مطلوب</span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-400">
                        لا يمكن إتمام الطلب بدون الموافقة على سياسات المتجر
                      </p>
                    </div>
                  </label>
                </div>

                {errors.acceptPolicies && (
                  <p className="mt-3 ms-1 text-xs font-black text-red-500">{errors.acceptPolicies}</p>
                )}
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