import React, { useMemo, useState } from 'react';
import { useCart } from '../App';
import Button from '../components/Button';
import { SHIPPING_METHODS } from '../constants';
import {
  CheckCircle,
  CreditCard,
  Truck,
  MapPin,
  Shield,
  DollarSign,
  Smartphone,
  Upload,
  Image as ImageIcon,
  ShoppingBag
} from 'lucide-react';
import * as ReactRouterDOM from 'react-router-dom';
import { db } from '../services/storage';
import { Order } from '../types';
import SEO from '../components/SEO';
import LazyImage from '../components/LazyImage';

const { useNavigate } = ReactRouterDOM as any;

type PaymentMethod = 'card' | 'paypal' | 'cod' | 'cliq';

const safeTrim = (s: any) => String(s ?? '').trim();

const clampQty = (n: any) => {
  const x = Math.round(Number(n) || 1);
  return Math.max(1, Math.min(99, x));
};

// ✅ Jordan governorates (slug ثابت + عرض حسب اللغة)
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
  { slug: 'aqaba', ar: 'العقبة', en: 'Aqaba' }
];

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

    // ✅ Order Note الرسمي من النظام (Context)
    orderNote,
    setOrderNote,
    clearOrderNote
  } = useCart() as any;

  const navigate = useNavigate();

  const tr = (ar: string, en: string) => (language === 'ar' ? ar : en);
  const tt = (key: string, fallbackAr: string, fallbackEn: string) => t(key) ?? tr(fallbackAr, fallbackEn);

  const [step, setStep] = useState(1);
  const [shippingMethodId, setShippingMethodId] = useState('local_std');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [isProcessing, setIsProcessing] = useState(false);

  // CliQ
  const [cliqRef, setCliqRef] = useState('');
  const [cliqReceiptDataUrl, setCliqReceiptDataUrl] = useState<string>('');

  // ✅ Address / Checkout Form
  const [formData, setFormData] = useState({
    fullName: '',
    country: 'Jordan', // ✅ ثابت
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
    billingPostalCode: ''
  });

  // ✅ Shipping preferences
  const [preferredDeliveryDate, setPreferredDeliveryDate] = useState(''); // yyyy-mm-dd
  const [preferredDeliveryTime, setPreferredDeliveryTime] = useState(''); // hh:mm

  // ✅ Policies / Terms acceptance
  const [acceptPolicies, setAcceptPolicies] = useState(true);

  // ✅ Field errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Money formatter حسب اللغة
  const fmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(language === 'ar' ? 'ar-JO' : 'en-JO', {
        style: 'currency',
        currency: 'JOD',
        maximumFractionDigits: 2
      });
    } catch {
      return null;
    }
  }, [language]);

  const formatMoney = (value: number) => (fmt ? fmt.format(value) : `JOD ${Number(value || 0).toFixed(2)}`);

  const selectedShipping = useMemo(
    () => SHIPPING_METHODS.find((m) => m.id === shippingMethodId),
    [shippingMethodId]
  );

  const subtotal = useMemo(
    () =>
      cart.reduce((sum: number, item: any) => {
        const price = Number(item.price || 0);
        const qty = clampQty(item.quantity);
        return sum + price * qty;
      }, 0),
    [cart]
  );

  const totalItems = useMemo(
    () => cart.reduce((sum: number, item: any) => sum + clampQty(item.quantity), 0),
    [cart]
  );

  const discountAmount = useMemo(() => (totalItems > 2 ? subtotal * 0.1 : 0), [subtotal, totalItems]);

  const shippingCost = selectedShipping ? Number(selectedShipping.price || 0) : 0;
  const total = Math.max(0, subtotal - discountAmount + shippingCost);

  const cityLabel = (slug: string) => {
    const c = JO_GOVS.find((x) => x.slug === slug);
    return c ? (language === 'ar' ? c.ar : c.en) : '';
  };

  const normalizeName = (name: string) => safeTrim(name).replace(/\s+/g, ' ');
  const normalizeAddress = (addr: string) => safeTrim(addr).replace(/\s+/g, ' ');

  // ✅ Jordan phone normalization:
  // - user types: 079xxxxxxx or 7xxxxxxxx or +9627xxxxxxxx
  // - we store: +9627xxxxxxxx (E.164-ish)
  const normalizeJordanPhone = (input: string) => {
    let digits = String(input ?? '').replace(/[^\d]/g, '');

    // remove leading country code if user typed it
    if (digits.startsWith('962')) digits = digits.slice(3);

    // remove leading 0 (common local format: 07xxxxxxxx)
    if (digits.startsWith('0')) digits = digits.slice(1);

    // now expect 9 digits (7xxxxxxxx) for mobile; allow 8-10 digits overall as fallback
    // we'll validate strictly: starts with 7 and length 9
    if (digits.startsWith('7') && digits.length === 9) {
      return `+962${digits}`;
    }

    // fallback keep best effort (still store with +962 if looks close)
    if (digits.length >= 8 && digits.length <= 10) {
      return `+962${digits}`;
    }

    return '';
  };

  const setField = (key: string, value: any) => {
    setFormData((p) => ({ ...p, [key]: value }));
    setErrors((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
  };

  const validateStep1 = () => {
    const nextErr: Record<string, string> = {};

    const name = normalizeName(formData.fullName);
    if (name.length < 5) {
      nextErr.fullName = tt('nameMin5', 'الاسم لازم يكون 5 أحرف على الأقل', 'Name must be at least 5 characters.');
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
        'اكتب العنوان بالتفصيل (على الأقل 8 أحرف)',
        'Write detailed address (at least 8 characters).'
      );
    }

    const phoneE164 = normalizeJordanPhone(formData.phoneLocal);
    if (!phoneE164) {
      nextErr.phoneLocal = tt('phoneInvalid', 'رقم الهاتف غير صحيح', 'Invalid phone number.');
    } else {
      // strict mobile check: +9627xxxxxxxx
      const digits = phoneE164.replace(/[^\d]/g, '');
      // digits now like 9627xxxxxxxx
      if (!(digits.length === 12 && digits.startsWith('9627'))) {
        nextErr.phoneLocal = tt(
          'phoneJordanMobile',
          'اكتب رقم أردني صحيح (07xxxxxxxx)',
          'Enter a valid Jordanian number (07xxxxxxxx).'
        );
      }
    }

    if (!acceptPolicies) {
      nextErr.acceptPolicies = tt(
        'acceptPoliciesRequired',
        'لازم توافق على السياسات لإتمام الطلب',
        'You must accept policies to place the order.'
      );
    }

    // Billing (إذا مش نفس الشحن)
    if (!formData.billingSameAsShipping) {
      const bn = normalizeName(formData.billingFullName);
      if (bn.length < 5) {
        nextErr.billingFullName = tt(
          'billingNameMin5',
          'اسم الفاتورة لازم يكون 5 أحرف على الأقل',
          'Billing name must be at least 5 characters.'
        );
      }
      if (!safeTrim(formData.billingCitySlug)) {
        nextErr.billingCitySlug = tt('billingCityRequired', 'مدينة الفاتورة مطلوبة', 'Billing city is required.');
      }
      const ba = normalizeAddress(formData.billingStreetAddress);
      if (ba.length < 8) {
        nextErr.billingStreetAddress = tt(
          'billingAddressMin8',
          'عنوان الفاتورة بالتفصيل (على الأقل 8 أحرف)',
          'Billing address must be detailed (at least 8 characters).'
        );
      }
      const bphone = normalizeJordanPhone(formData.billingPhoneLocal);
      if (!bphone) {
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
      showToast(t('invalidImage') ?? 'Please upload an image file.', 'error');
      return;
    }

    // حد بسيط لحجم الملف عشان الأداء (2.5MB)
    const maxBytes = 2.5 * 1024 * 1024;
    if (file.size > maxBytes) {
      showToast(t('imageTooLarge') ?? 'Image is too large. Please upload a smaller one.', 'error');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCliqReceiptDataUrl(dataUrl);
      showToast(t('uploaded') ?? 'Uploaded successfully.', 'success');
    } catch {
      showToast(t('uploadFailed') ?? 'Upload failed. Please try again.', 'error');
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

    // ✅ Final validation (Step 1 + policies)
    const ok = validateStep1();
    if (!ok) {
      showToast(tt('fixErrors', 'راجع الحقول المطلوبة', 'Please fix the required fields.'), 'error');
      setStep(1);
      return;
    }

    if (paymentMethod === 'cliq') {
      const ref = safeTrim(cliqRef);
      if (!ref) {
        showToast(t('enterCliqRef') ?? 'Please enter the CliQ reference number.', 'error');
        return;
      }
      if (ref.length < 4 || ref.length > 40) {
        showToast(t('invalidCliqRef') ?? 'Invalid CliQ reference number.', 'error');
        return;
      }
    }

    setIsProcessing(true);

    const shippingPhone = normalizeJordanPhone(formData.phoneLocal) || safeTrim(formData.phoneLocal);

    const shippingCityName = cityLabel(formData.citySlug) || safeTrim(formData.citySlug);
    const shippingStreet = normalizeAddress(formData.streetAddress);

    const billingPhone = normalizeJordanPhone(formData.billingPhoneLocal) || safeTrim(formData.billingPhoneLocal);
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
        image: item.image
      })),
      status: 'processing',
      date: new Date().toISOString().split('T')[0],
      total: total,
      shippingMethod: selectedShipping?.name || 'Standard',
      paymentMethod: paymentMethod,

      // ✅ نخزّن الملاحظة بشكل رسمي داخل الطلب
      note: safeTrim(orderNote) || undefined,

      // ✅ Shipping preferences (اختياري)
      deliveryPreference:
        safeTrim(preferredDeliveryDate) || safeTrim(preferredDeliveryTime)
          ? {
              date: safeTrim(preferredDeliveryDate) || undefined,
              time: safeTrim(preferredDeliveryTime) || undefined
            }
          : undefined,

      paymentDetails:
        paymentMethod === 'cliq'
          ? {
              cliqReference: safeTrim(cliqRef),
              receiptImage: cliqReceiptDataUrl || undefined,
              isPaid: false
            }
          : undefined,

      address: {
        fullName: normalizeName(formData.fullName) || 'Guest',
        city: shippingCityName,
        street: shippingStreet,
        phone: shippingPhone
      },

      // ✅ extras for bilingual & admin use (safe with "any")
      addressMeta: {
        country: 'Jordan',
        citySlug: formData.citySlug,
        postalCode: safeTrim(formData.postalCode) || undefined,
        saveInfo: !!formData.saveInfo
      },

      billingAddress: formData.billingSameAsShipping
        ? undefined
        : {
            fullName: normalizeName(formData.billingFullName),
            city: billingCityName,
            street: billingStreet,
            phone: billingPhone,
            meta: {
              citySlug: formData.billingCitySlug,
              postalCode: safeTrim(formData.billingPostalCode) || undefined
            }
          }
    };

    try {
      await db.orders.create(newOrder);

      await refreshProducts();

      clearCart();
      if (typeof clearOrderNote === 'function') clearOrderNote();

      showToast(t('alertSet') ?? 'Order placed successfully.', 'success');
      navigate(`/order-success/${newOrder.id}`);
    } catch {
      showToast(t('placeOrderFailed') ?? 'Failed to place order. Please try again.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!Array.isArray(cart) || cart.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <SEO title={t('checkout')} noIndex={true} />
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-secondary-light/20 flex items-center justify-center text-secondary-DEFAULT mb-4">
            <ShoppingBag />
          </div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 mb-2">{t('cartEmpty')}</h2>
          <p className="text-slate-500 mb-6">{t('browseToAdd') ?? 'Browse products and add items to your cart.'}</p>
          <Button onClick={() => navigate('/shop')} className="w-full">
            {t('browseProducts')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 lg:py-12">
      <SEO title={t('checkout')} noIndex={true} />
      <div className="container mx-auto px-4 lg:px-8">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-heading font-bold text-slate-900">{t('checkout')}</h1>
            <p className="text-slate-500 mt-1">{t('checkoutHint') ?? 'Complete your details to place the order.'}</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/cart')}
              className="text-sm font-bold text-secondary-DEFAULT hover:opacity-80 transition"
              type="button"
            >
              {t('editCart') ?? 'Edit cart'}
            </button>

            <button
              onClick={() => navigate('/shop')}
              className="text-sm font-bold text-slate-600 hover:opacity-80 transition"
              type="button"
            >
              {t('continueShopping') ?? 'Continue shopping'}
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Form Section */}
          <div className="flex-1 space-y-6">
            {/* Steps Indicator */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center justify-between gap-2">
                {[1, 2, 3].map((i) => {
                  const active = step === i;
                  const done = step > i;
                  return (
                    <div key={i} className="flex-1 flex items-center gap-3">
                      <div
                        className={[
                          'w-9 h-9 rounded-full flex items-center justify-center font-bold shrink-0 transition',
                          done || active ? 'bg-secondary-DEFAULT text-white' : 'bg-slate-200 text-slate-500'
                        ].join(' ')}
                        aria-label={`step-${i}`}
                      >
                        {done ? <CheckCircle size={18} /> : i}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-bold ${done || active ? 'text-slate-900' : 'text-slate-400'}`}>
                          {i === 1 ? t('address') : i === 2 ? t('shipping') : t('payment')}
                        </p>
                        <p className="text-xs text-slate-400 line-clamp-1">
                          {i === 1
                            ? t('stepAddressHint') ?? 'Delivery details'
                            : i === 2
                              ? t('stepShippingHint') ?? 'Choose shipping'
                              : t('stepPaymentHint') ?? 'Choose payment'}
                        </p>
                      </div>
                      {i < 3 && <div className="hidden sm:block h-0.5 bg-slate-200 flex-1 mx-2" />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 1: Address */}
            {step === 1 && (
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <MapPin className="text-secondary-DEFAULT" /> {t('deliveryAddress')}
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Full Name */}
                  <div className="md:col-span-2">
                    <input
                      name="fullName"
                      value={formData.fullName}
                      onChange={(e) => setField('fullName', e.target.value)}
                      type="text"
                      placeholder={tt('fullName', 'الاسم الكامل', 'Full name')}
                      className={[
                        'w-full p-3 border rounded-xl bg-slate-50 focus:ring-2 focus:ring-secondary-DEFAULT outline-none',
                        errors.fullName ? 'border-red-400' : 'border-slate-200'
                      ].join(' ')}
                      autoComplete="name"
                    />
                    {errors.fullName && <p className="mt-1 text-xs font-bold text-red-600">{errors.fullName}</p>}
                  </div>

                  {/* Country (Fixed: Jordan) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">{t('country') ?? 'Country'}</label>
                    <select
                      value="Jordan"
                      onChange={() => setField('country', 'Jordan')}
                      className={[
                        'w-full p-3 border rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-secondary-DEFAULT',
                        errors.country ? 'border-red-400' : 'border-slate-200'
                      ].join(' ')}
                    >
                      <option value="Jordan">{tr('الأردن', 'Jordan')}</option>
                    </select>
                    {errors.country && <p className="mt-1 text-xs font-bold text-red-600">{errors.country}</p>}
                  </div>

                  {/* City (Select governorate) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">{t('city') ?? 'City'}</label>
                    <select
                      value={formData.citySlug}
                      onChange={(e) => setField('citySlug', e.target.value)}
                      className={[
                        'w-full p-3 border rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-secondary-DEFAULT',
                        errors.citySlug ? 'border-red-400' : 'border-slate-200'
                      ].join(' ')}
                    >
                      <option value="">{tt('selectCity', 'اختر المحافظة', 'Select governorate')}</option>
                      {JO_GOVS.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {language === 'ar' ? c.ar : c.en}
                        </option>
                      ))}
                    </select>
                    {errors.citySlug && <p className="mt-1 text-xs font-bold text-red-600">{errors.citySlug}</p>}
                  </div>

                  {/* Detailed Address */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-600 mb-2">
                      {tt('detailedAddress', 'العنوان بالتفصيل', 'Detailed address')}
                    </label>
                    <input
                      name="streetAddress"
                      value={formData.streetAddress}
                      onChange={(e) => setField('streetAddress', e.target.value)}
                      type="text"
                      placeholder={tt(
                        'addressPlaceholder',
                        'مثال: الجبيهة - شارع الجامعة - بناية 12 - شقة 5',
                        'Example: Jubaiha - University St - Building 12 - Apt 5'
                      )}
                      className={[
                        'w-full p-3 border rounded-xl bg-slate-50 focus:ring-2 focus:ring-secondary-DEFAULT outline-none',
                        errors.streetAddress ? 'border-red-400' : 'border-slate-200'
                      ].join(' ')}
                      autoComplete="street-address"
                    />
                    {errors.streetAddress && (
                      <p className="mt-1 text-xs font-bold text-red-600">{errors.streetAddress}</p>
                    )}
                  </div>

                  {/* Postal code (optional) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">
                      {tt('postalCode', 'الرمز البريدي (اختياري)', 'Postal code (optional)')}
                    </label>
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

                  {/* Phone with country code */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">{t('phone') ?? 'Phone'}</label>
                    <div
                      className={[
                        'flex items-center gap-2 p-2 border rounded-xl bg-slate-50',
                        errors.phoneLocal ? 'border-red-400' : 'border-slate-200'
                      ].join(' ')}
                    >
                      <div className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-700">
                        +962
                      </div>
                      <input
                        name="phoneLocal"
                        value={formData.phoneLocal}
                        onChange={(e) => setField('phoneLocal', e.target.value)}
                        type="tel"
                        inputMode="tel"
                        placeholder={tt('phonePlaceholder', '07xxxxxxxx', '07xxxxxxxx')}
                        className="flex-1 bg-transparent outline-none px-2 py-2 text-slate-800"
                        autoComplete="tel-national"
                      />
                    </div>
                    {errors.phoneLocal && <p className="mt-1 text-xs font-bold text-red-600">{errors.phoneLocal}</p>}
                    <p className="mt-1 text-[11px] text-slate-400 font-bold">
                      {tt('phoneHint', 'اكتب رقمك بصيغة 07xxxxxxxx', 'Enter number as 07xxxxxxxx')}
                    </p>
                  </div>

                  {/* Save info */}
                  <div className="md:col-span-2 flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">
                        {tt('saveInfo', 'حفظ بياناتي للطلبات القادمة', 'Save my info for next time')}
                      </p>
                      <p className="text-xs text-slate-500">
                        {tt(
                          'saveInfoHint',
                          'لتسريع الطلب القادم (محلي فقط/حسب النظام)',
                          'Speeds up next checkout (local/system dependent).'
                        )}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={!!formData.saveInfo}
                      onChange={(e) => setField('saveInfo', e.target.checked)}
                      className="w-5 h-5 accent-secondary-DEFAULT"
                    />
                  </div>

                  {/* Billing address toggle */}
                  <div className="md:col-span-2 flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">
                        {tt('billingSame', 'عنوان الفاتورة نفس عنوان الشحن', 'Billing address same as shipping')}
                      </p>
                      <p className="text-xs text-slate-500">
                        {tt('billingHint', 'إذا بدك عنوان مختلف، ألغِ التحديد', 'Uncheck to use a different billing.')}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={!!formData.billingSameAsShipping}
                      onChange={(e) => setField('billingSameAsShipping', e.target.checked)}
                      className="w-5 h-5 accent-secondary-DEFAULT"
                    />
                  </div>

                  {/* Billing fields */}
                  {!formData.billingSameAsShipping && (
                    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2">
                        <input
                          value={formData.billingFullName}
                          onChange={(e) => setField('billingFullName', e.target.value)}
                          type="text"
                          placeholder={tt('billingFullName', 'اسم الفاتورة', 'Billing full name')}
                          className={[
                            'w-full p-3 border rounded-xl bg-slate-50 focus:ring-2 focus:ring-secondary-DEFAULT outline-none',
                            errors.billingFullName ? 'border-red-400' : 'border-slate-200'
                          ].join(' ')}
                        />
                        {errors.billingFullName && (
                          <p className="mt-1 text-xs font-bold text-red-600">{errors.billingFullName}</p>
                        )}
                      </div>

                      <div>
                        <select
                          value={formData.billingCitySlug}
                          onChange={(e) => setField('billingCitySlug', e.target.value)}
                          className={[
                            'w-full p-3 border rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-secondary-DEFAULT',
                            errors.billingCitySlug ? 'border-red-400' : 'border-slate-200'
                          ].join(' ')}
                        >
                          <option value="">{tt('selectBillingCity', 'اختر محافظة الفاتورة', 'Select billing city')}</option>
                          {JO_GOVS.map((c) => (
                            <option key={c.slug} value={c.slug}>
                              {language === 'ar' ? c.ar : c.en}
                            </option>
                          ))}
                        </select>
                        {errors.billingCitySlug && (
                          <p className="mt-1 text-xs font-bold text-red-600">{errors.billingCitySlug}</p>
                        )}
                      </div>

                      <div>
                        <div
                          className={[
                            'flex items-center gap-2 p-2 border rounded-xl bg-slate-50',
                            errors.billingPhoneLocal ? 'border-red-400' : 'border-slate-200'
                          ].join(' ')}
                        >
                          <div className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-700">
                            +962
                          </div>
                          <input
                            value={formData.billingPhoneLocal}
                            onChange={(e) => setField('billingPhoneLocal', e.target.value)}
                            type="tel"
                            placeholder={tt('phonePlaceholder', '07xxxxxxxx', '07xxxxxxxx')}
                            className="flex-1 bg-transparent outline-none px-2 py-2 text-slate-800"
                          />
                        </div>
                        {errors.billingPhoneLocal && (
                          <p className="mt-1 text-xs font-bold text-red-600">{errors.billingPhoneLocal}</p>
                        )}
                      </div>

                      <div className="md:col-span-2">
                        <input
                          value={formData.billingStreetAddress}
                          onChange={(e) => setField('billingStreetAddress', e.target.value)}
                          type="text"
                          placeholder={tt(
                            'billingAddressPlaceholder',
                            'عنوان الفاتورة بالتفصيل',
                            'Billing detailed address'
                          )}
                          className={[
                            'w-full p-3 border rounded-xl bg-slate-50 focus:ring-2 focus:ring-secondary-DEFAULT outline-none',
                            errors.billingStreetAddress ? 'border-red-400' : 'border-slate-200'
                          ].join(' ')}
                        />
                        {errors.billingStreetAddress && (
                          <p className="mt-1 text-xs font-bold text-red-600">{errors.billingStreetAddress}</p>
                        )}
                      </div>

                      <div className="md:col-span-2">
                        <input
                          value={formData.billingPostalCode}
                          onChange={(e) => setField('billingPostalCode', e.target.value)}
                          type="text"
                          placeholder={tt(
                            'billingPostalCode',
                            'الرمز البريدي للفاتورة (اختياري)',
                            'Billing postal code (optional)'
                          )}
                          className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-secondary-DEFAULT outline-none"
                        />
                      </div>
                    </div>
                  )}

                  {/* Policies checkbox */}
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
                          {tt(
                            'acceptPolicies',
                            'أوافق على سياسات الشحن والخصوصية وشروط الخدمة',
                            'I agree to Shipping Policy, Privacy Policy, and Terms of Service'
                          )}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {tt(
                            'policiesHint',
                            'تقدر تضيف روابط الصفحات لاحقاً من إعدادات الموقع',
                            'You can add policy pages links later from site settings.'
                          )}
                        </p>
                        {errors.acceptPolicies && (
                          <p className="mt-2 text-xs font-bold text-red-600">{errors.acceptPolicies}</p>
                        )}
                      </div>
                    </label>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <Button onClick={goToShipping} disabled={isProcessing}>
                    {t('continueToShipping')}
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Shipping */}
            {step === 2 && (
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <Truck className="text-secondary-DEFAULT" /> {t('shippingMethod')}
                </h2>

                <div className="space-y-4">
                  {SHIPPING_METHODS.map((method: any) => (
                    <label
                      key={method.id}
                      className={[
                        'flex items-center justify-between p-4 border rounded-2xl cursor-pointer transition-all',
                        shippingMethodId === method.id
                          ? 'border-secondary-DEFAULT bg-secondary-light/10'
                          : 'border-slate-200 hover:bg-slate-50'
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="shipping"
                          checked={shippingMethodId === method.id}
                          onChange={() => setShippingMethodId(method.id)}
                          className="w-5 h-5 accent-secondary-DEFAULT"
                        />
                        <div>
                          <p className="font-bold text-slate-800">{method.name}</p>
                          <p className="text-xs text-slate-500">{method.duration}</p>
                        </div>
                      </div>
                      <span className="font-bold text-slate-800">{formatMoney(Number(method.price || 0))}</span>
                    </label>
                  ))}
                </div>

                {/* ✅ Preferred delivery time (optional) */}
                <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-sm font-bold text-slate-800 mb-3">
                    {tt('preferredDelivery', 'وقت توصيل مفضل (اختياري)', 'Preferred delivery time (optional)')}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="date"
                      value={preferredDeliveryDate}
                      onChange={(e) => setPreferredDeliveryDate(e.target.value)}
                      className="p-3 border border-slate-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-secondary-DEFAULT"
                    />
                    <input
                      type="time"
                      value={preferredDeliveryTime}
                      onChange={(e) => setPreferredDeliveryTime(e.target.value)}
                      className="p-3 border border-slate-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-secondary-DEFAULT"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2 font-bold">
                    {tt(
                      'deliveryTimeHint',
                      'الوقت المفضل حسب توفر المندوب/المنطقة',
                      'Preferred time depends on availability.'
                    )}
                  </p>
                </div>

                <div className="mt-6 flex justify-between">
                  <Button variant="outline" onClick={() => setStep(1)} disabled={isProcessing}>
                    {t('back')}
                  </Button>
                  <Button onClick={() => setStep(3)} disabled={isProcessing}>
                    {t('continueToPayment')}
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Payment */}
            {step === 3 && (
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 animate-in fade-in slide-in-from-right">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <CreditCard className="text-secondary-DEFAULT" /> {t('paymentMethod')}
                </h2>

                <div className="flex flex-wrap gap-3 mb-6">
                  <button
                    onClick={() => setPaymentMethod('card')}
                    type="button"
                    className={[
                      'flex-1 min-w-[140px] py-3 rounded-2xl border font-bold transition-all',
                      paymentMethod === 'card'
                        ? 'border-secondary-DEFAULT bg-secondary-light/10 text-secondary-DEFAULT'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    ].join(' ')}
                  >
                    {t('creditCard')}
                  </button>

                  <button
                    onClick={() => setPaymentMethod('cliq')}
                    type="button"
                    className={[
                      'flex-1 min-w-[140px] py-3 rounded-2xl border font-bold transition-all',
                      paymentMethod === 'cliq'
                        ? 'border-blue-700 bg-blue-50 text-blue-900'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <Smartphone size={16} /> CliQ
                    </div>
                  </button>

                  <button
                    onClick={() => setPaymentMethod('cod')}
                    type="button"
                    className={[
                      'flex-1 min-w-[140px] py-3 rounded-2xl border font-bold transition-all',
                      paymentMethod === 'cod'
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <DollarSign size={16} /> {t('cod')}
                    </div>
                  </button>
                </div>

                {paymentMethod === 'card' && (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
                      {t('cardDemoHint') ??
                        'Demo UI only: connect a real payment gateway (CliQ / Cash / Stripe) for production.'}
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">{t('cardNumber')}</label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="0000 0000 0000 0000"
                          className="w-full pl-12 pr-4 py-3 bg-slate-50 border rounded-2xl outline-none focus:border-secondary-DEFAULT"
                        />
                        <CreditCard className="absolute left-4 top-3.5 text-slate-400" size={20} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <input
                        type="text"
                        placeholder="MM/YY"
                        className="p-3 bg-slate-50 border rounded-2xl outline-none focus:border-secondary-DEFAULT"
                      />
                      <input
                        type="text"
                        placeholder="CVC"
                        className="p-3 bg-slate-50 border rounded-2xl outline-none focus:border-secondary-DEFAULT"
                      />
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-2">
                      <Shield size={14} className="text-green-500" />
                      {t('secureData') ?? 'Your payment details are protected.'}
                    </div>

                    <Button onClick={handlePlaceOrder} className="w-full mt-4" isLoading={isProcessing}>
                      {t('pay')} {formatMoney(total)}
                    </Button>
                  </div>
                )}

                {paymentMethod === 'cliq' && (
                  <div className="space-y-6">
                    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
                      <p className="text-sm text-blue-800 mb-2 font-bold">
                        {t('cliqTransferHint') ?? 'Transfer the total amount to this CliQ ID:'}
                      </p>
                      <div className="text-3xl font-bold text-blue-900 tracking-wider mb-2 select-all cursor-pointer bg-white/60 p-2 rounded-xl inline-block">
                        ANTASTORE
                      </div>
                      <p className="text-xs text-blue-700">{t('cliqRecipient') ?? 'Recipient:'} مكتبة دير شرف العلمية Tech & Art</p>
                      <p className="text-xs text-blue-700 mt-1">
                        {t('amount') ?? 'Amount:'} <span className="font-bold">{formatMoney(total)}</span>
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">
                        {t('referenceOrReceipt') ?? 'Reference Number / Receipt'}
                      </label>

                      <input
                        type="text"
                        placeholder={t('enterCliqRef') ?? 'Enter CliQ Reference Number'}
                        value={cliqRef}
                        onChange={(e) => setCliqRef(e.target.value)}
                        className="w-full p-3 bg-slate-50 border rounded-2xl outline-none focus:border-secondary-DEFAULT mb-3"
                      />

                      <label className="block">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleCliqReceiptPick(e.target.files?.[0] ?? null)}
                        />
                        <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center hover:bg-slate-50 cursor-pointer transition-colors">
                          <Upload className="mx-auto text-slate-400 mb-2" />
                          <span className="text-sm text-slate-600 font-bold">
                            {t('uploadReceipt') ?? 'Upload transfer screenshot (optional)'}
                          </span>
                          <p className="text-xs text-slate-400 mt-1">{t('uploadHint') ?? 'PNG/JPG up to ~2.5MB'}</p>
                        </div>
                      </label>

                      {cliqReceiptDataUrl && (
                        <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-3">
                          <div className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                            <ImageIcon size={16} /> {t('receiptPreview') ?? 'Receipt preview'}
                          </div>
                          <img
                            src={cliqReceiptDataUrl}
                            alt="CliQ receipt preview"
                            className="w-full max-h-72 object-contain rounded-xl bg-slate-50"
                          />
                          <button
                            type="button"
                            onClick={() => setCliqReceiptDataUrl('')}
                            className="mt-3 text-xs font-bold text-red-600 hover:opacity-80"
                          >
                            {t('remove') ?? 'Remove'}
                          </button>
                        </div>
                      )}
                    </div>

                    <Button
                      onClick={handlePlaceOrder}
                      className="w-full bg-blue-900 hover:bg-blue-800 text-white"
                      isLoading={isProcessing}
                      disabled={isProcessing}
                    >
                      {t('confirmOrder') ?? 'Confirm Order'}
                    </Button>
                  </div>
                )}

                {paymentMethod === 'cod' && (
                  <div className="text-center py-8 space-y-4">
                    <div className="w-16 h-16 bg-green-100 text-green-700 rounded-2xl flex items-center justify-center mx-auto">
                      <DollarSign size={32} />
                    </div>
                    <p className="text-slate-600 font-medium">
                      {t('codHint') ?? 'You will pay cash upon delivery.'} —{' '}
                      <span className="font-bold">{formatMoney(total)}</span>
                    </p>
                    <Button
                      onClick={handlePlaceOrder}
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                      isLoading={isProcessing}
                      disabled={isProcessing}
                    >
                      {t('confirmOrder')}
                    </Button>
                  </div>
                )}

                <div className="mt-6">
                  <Button variant="outline" onClick={() => setStep(2)} disabled={isProcessing}>
                    {t('back')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Summary Section */}
          <div className="lg:w-96">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 sticky top-24">
              <h3 className="font-bold text-lg mb-4">{t('orderSummary')}</h3>

              <div className="space-y-4 max-h-72 overflow-y-auto pr-2 custom-scrollbar mb-4">
                {cart.map((item: any) => (
                  <div key={item.id} className="flex gap-3">
                    <LazyImage
                      src={item.image}
                      alt={item.name}
                      className="w-12 h-12 rounded-xl object-cover"
                      containerClassName="w-12 h-12 rounded-xl shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 line-clamp-1">{getProductTitle(item)}</p>
                      <div className="flex justify-between text-xs text-slate-500 mt-1">
                        <span>x{clampQty(item.quantity)}</span>
                        <span className="font-bold text-slate-700">
                          {formatMoney(Number(item.price || 0) * clampQty(item.quantity))}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-2 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>{t('subtotal')}</span>
                  <span className="font-bold">{formatMoney(subtotal)}</span>
                </div>

                <div className="flex justify-between text-green-700">
                  <span>{t('discount')}</span>
                  <span className="font-bold">-{formatMoney(discountAmount)}</span>
                </div>

                <div className="flex justify-between text-slate-600">
                  <span>
                    {t('shipping')} ({selectedShipping?.name})
                  </span>
                  <span className="font-bold">{formatMoney(shippingCost)}</span>
                </div>

                <div className="flex justify-between text-lg font-bold text-slate-900 border-t border-slate-100 pt-2 mt-2">
                  <span>{t('total')}</span>
                  <span>{formatMoney(total)}</span>
                </div>

                {safeTrim(orderNote) && (
                  <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600">
                    <span className="font-bold">{t('orderNote') ?? 'Order note'}:</span>{' '}
                    <span className="text-slate-700">{safeTrim(orderNote)}</span>
                  </div>
                )}

                <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <Shield size={14} className="text-green-600" />
                    <span>{t('secureCheckoutNote') ?? 'Secure checkout. Your information is protected.'}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate('/cart')}
                className="mt-5 w-full text-sm font-bold text-secondary-DEFAULT hover:opacity-80 transition"
              >
                {t('editCart') ?? 'Edit cart'}
              </button>

              {/* ✅ تعديل الملاحظة من هنا */}
              <div className="mt-4">
                <label className="block text-xs font-bold text-slate-600 mb-2">{t('orderNote') ?? 'Order note'}</label>
                <textarea
                  value={orderNote || ''}
                  onChange={(e) => setOrderNote(e.target.value)}
                  maxLength={600}
                  placeholder={t('orderNotePlaceholder') ?? 'Write a note for the seller...'}
                  className="w-full min-h-[70px] resize-none p-3 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-secondary-DEFAULT focus:ring-2 focus:ring-secondary-DEFAULT/30 text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Checkout;