// src/pages/OrderSuccess.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import {
  CheckCircle,
  Package,
  AlertTriangle,
  Copy,
  CreditCard,
  Truck,
  StickyNote,
  ArrowRight,
  Home,
  Clock,
  MessageCircle
} from 'lucide-react';
import { useCart } from '../App';
import { Order } from '../types';
import SEO from '../components/SEO';
import { checkSuccessPage, confirmedOrders, whatsappUrl, STORE_WHATSAPP, trackingKeys } from '../services/checkoutFlow';
import { formatTrackingKey } from '../services/orderSubmit';
import { currentIdentity } from '../services/firebase';

const { useParams, Link, useNavigate } = ReactRouterDOM as any;

// success  = confirmed by the Worker in this tab AND reported by the Worker's status endpoint now
// exists   = the Worker reports the order, but this device did not confirm it (no details shown)
// unknown  = the Worker could not be reached: nothing is claimed
type Status = 'idle' | 'loading' | 'success' | 'exists' | 'unknown' | 'error';

const ORDER_SUCCESS_CACHE_PREFIX = 'order_success_';

const safeText = (value: unknown): string => String(value ?? '').trim();

const safeJsonParse = <T,>(value: string | null): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

// 🔒 إخفاء رقم الهاتف بشكل آمن واحترافي
const maskPhone = (phone?: string) => {
  const p = safeText(phone);
  if (!p) return '—';
  if (p.length < 6) return p;
  return `${p.slice(0, 4)} •••• ${p.slice(-3)}`;
};

const getOrderCacheKey = (orderId: string) => `${ORDER_SUCCESS_CACHE_PREFIX}${orderId}`;

const OrderSuccess: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, showToast, language } = useCart() as any;

  const [order, setOrder] = useState<Order | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const safeId = useMemo(() => safeText(id), [id]);
  const isAR = language === 'ar';

  const tr = useCallback((ar: string, en: string) => (isAR ? ar : en), [isAR]);

  const tt = useCallback(
    (key: string, fallbackAr: string, fallbackEn: string) => {
      try {
        const value = t?.(key);
        if (!value || value === key) return tr(fallbackAr, fallbackEn);
        return String(value);
      } catch {
        return tr(fallbackAr, fallbackEn);
      }
    },
    [t, tr]
  );

  const paymentLabel = useCallback(
    (paymentMethod?: string) => {
      const value = safeText(paymentMethod).toLowerCase();
      if (!value) return '—';

      if (value === 'cod') return tt('cod', 'الدفع عند الاستلام', 'Cash on delivery');
      if (value === 'cliq') return tt('cliq', 'حوالة بنكية (CliQ)', 'CliQ Transfer');
      if (value === 'card') return tt('creditCard', 'بطاقة ائتمانية', 'Credit Card');
      if (value === 'paypal') return 'PayPal';

      return safeText(paymentMethod);
    },
    [tt]
  );

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

  const formatMoney = useCallback(
    (amount?: number) => {
      const value = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
      return fmt ? fmt.format(value) : `${value.toFixed(2)} JOD`;
    },
    [fmt]
  );

  // 📅 تنسيق ذكي ومحلي للتاريخ
  const getDisplayDate = useCallback((currentOrder: any) => {
    const rawDate = safeText(currentOrder?.date) || safeText(currentOrder?.createdAt) || safeText(currentOrder?.updatedAt);
    if (!rawDate) return '—';

    try {
      const d = new Date(rawDate);
      if (isNaN(d.getTime())) return rawDate;
      return new Intl.DateTimeFormat(isAR ? 'ar-JO' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(d);
    } catch {
      return rawDate;
    }
  }, [isAR]);

  const getCachedOrder = useCallback((orderId: string): Order | null => {
    if (!orderId || typeof window === 'undefined') return null;
    const parsed = safeJsonParse<Order>(sessionStorage.getItem(getOrderCacheKey(orderId)));
    if (!parsed) return null;

    const parsedId = safeText((parsed as any)?.id);
    if (!parsedId || parsedId !== orderId) return null;

    return parsed;
  }, []);

  /**
   * No success from navigation state or cached data alone, and no Firestore read of the order:
   * the order Worker's status endpoint decides together with the confirmation recorded in this tab.
   */
  const loadOrder = useCallback(async () => {
    setOrder(null);
    setErrorMsg('');
    if (!safeId) {
      setStatus('error');
      setErrorMsg(tr('رقم الطلب مفقود.', 'Order ID is missing.'));
      return;
    }
    setStatus('loading');
    try {
      const verdict = await checkSuccessPage(
        safeId,
        confirmedOrders(),
        { workerUrl: String(import.meta.env.VITE_WORKER_URL || ''), timeoutMs: 10_000 },
        { fetch: (url: string, init?: Record<string, unknown>) => window.fetch(url, init as RequestInit) as any }
      );
      if (verdict === 'confirmed') {
        setOrder(getCachedOrder(safeId)); // details for THIS device only; may be null
        setStatus('success');
      } else if (verdict === 'exists_unverified') {
        setStatus('exists');
      } else if (verdict === 'unknown') {
        setStatus('unknown');
      } else {
        setStatus('error');
        setErrorMsg(
          verdict === 'invalid'
            ? tr('رقم الطلب غير صحيح.', 'The order number is invalid.')
            : tr('لم نتمكن من العثور على هذا الطلب في نظامنا. قد يكون رقم الطلب غير صحيح.', 'We could not find this order in our system. The order ID might be incorrect.')
        );
      }
    } catch (error) {
      console.error('OrderSuccess loadOrder failed:', error, { safeId });
      setStatus('unknown');
    }
  }, [safeId, tr, getCachedOrder]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const copyOrderId = async () => {
    try {
      if (!safeId) return;
      await navigator.clipboard.writeText(safeId);
      showToast?.(tt('copied', 'تم نسخ رقم الطلب', 'Order ID Copied'), 'success');
    } catch {
      showToast?.(tt('copyFailed', 'تعذر النسخ', 'Copy failed'), 'error');
    }
  };

  // tracking code of THIS device's order (kept in localStorage at confirmation). Shown here only; never in a URL.
  // only for the identity that placed the order (shared device: another account never sees it)
  const [trackingCode, setTrackingCode] = useState('');
  // null identity = the account could not be confirmed in time: no code is shown (never "assume a guest")
  const [codeIdentityUnknown, setCodeIdentityUnknown] = useState(false);
  const [codeCheck, setCodeCheck] = useState(0);
  useEffect(() => {
    let alive = true;
    currentIdentity().then((who) => {
      if (!alive) return;
      setCodeIdentityUnknown(who === null);
      setTrackingCode(who === null ? '' : formatTrackingKey(trackingKeys().get(safeId, who) || ''));
    });
    return () => {
      alive = false;
    };
  }, [safeId, codeCheck]);
  const copyTrackingCode = async () => {
    try {
      if (!trackingCode) return;
      await navigator.clipboard.writeText(trackingCode);
      showToast?.(tt('copied', 'تم النسخ بنجاح', 'Copied successfully'), 'success');
    } catch {
      showToast?.(tt('copyFailed', 'تعذر النسخ', 'Copy failed'), 'error');
    }
  };

  const copyOrderNote = async () => {
    try {
      const note = safeText((order as any)?.note);
      if (!note) return;
      await navigator.clipboard.writeText(note);
      showToast?.(tt('copied', 'تم النسخ', 'Copied'), 'success');
    } catch {
      showToast?.(tt('copyFailed', 'تعذر النسخ', 'Copy failed'), 'error');
    }
  };

  const retryLoad = () => {
    setStatus('idle');
    setErrorMsg('');
    setOrder(null);
    loadOrder();
  };

  const goToTracking = () => {
    navigate(safeId ? `/tracking?orderId=${encodeURIComponent(safeId)}` : '/tracking');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 py-12">
      <SEO title={tt('orderSuccess', 'تأكيد الطلب', 'Order Confirmed')} noIndex={true} />

      <div className="bg-white max-w-xl w-full rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100 p-8 sm:p-10 text-center animate-in zoom-in-95 duration-500">
        
        {/* Status Icon */}
        {status === 'success' ? (
          <div className="w-24 h-24 bg-emerald-50 text-emerald-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner border border-emerald-100">
            <CheckCircle size={48} strokeWidth={2.5} />
          </div>
        ) : status === 'error' ? (
          <div className="w-24 h-24 bg-red-50 text-red-500 rounded-3xl flex items-center justify-center mx-auto mb-6 rotate-12 transition-transform">
            <AlertTriangle size={48} strokeWidth={2} />
          </div>
        ) : status === 'exists' || status === 'unknown' ? (
          <div className="w-24 h-24 bg-amber-50 text-amber-500 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-amber-100">
            <AlertTriangle size={48} strokeWidth={2} />
          </div>
        ) : (
          <div className="w-24 h-24 bg-slate-50 text-slate-400 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-slate-100">
            <Clock size={48} strokeWidth={2} />
          </div>
        )}

        <h1 className="text-3xl sm:text-4xl font-black text-slate-900 mb-3 tracking-tight" data-testid="success-status" data-status={status}>
          {status === 'success'
            ? tt('thankYou', 'شكراً لتسوقك معنا!', 'Thank You for Shopping!')
            : status === 'error'
            ? tt('error', 'عذراً، حدث خطأ!', 'Oops, an error occurred!')
            : status === 'exists'
            ? tr('طلبك مسجّل لدينا', 'Your order is registered')
            : status === 'unknown'
            ? tr('تعذّر التحقق من الطلب الآن', 'We could not verify the order right now')
            : tr('جاري التحقق من الطلب...', 'Checking your order...')}
        </h1>

        {/* Loading State */}
        {status === 'loading' && (
          <div className="mt-4 mb-8">
            <p className="text-slate-500 font-medium mb-6">
              {tt('loading', 'جاري تجهيز تأكيد الطلب...', 'Preparing your order confirmation...')}
            </p>
            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 text-start space-y-4">
              <div className="h-4 w-2/3 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-1/2 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-3/4 bg-slate-200 rounded animate-pulse" />
            </div>
          </div>
        )}

        {/* Error State */}
        {status === 'error' && (
          <div className="mt-4">
            <p className="text-slate-600 font-bold mb-8 px-4 leading-relaxed">{errorMsg}</p>
            <div className="flex flex-col gap-3">
              <button 
                className="w-full py-4 rounded-2xl bg-sky-400 hover:bg-sky-500 text-white font-extrabold shadow-lg shadow-sky-400/30 transition-all" 
                onClick={retryLoad}
              >
                {tt('retry', 'تحديث الصفحة', 'Refresh Page')}
              </button>
              <button 
                className="w-full py-4 rounded-2xl bg-black hover:bg-slate-800 text-white font-extrabold shadow-md shadow-black/20 transition-all" 
                onClick={goToTracking}
              >
                {tt('trackYourOrder', 'تتبع حالة الطلب', 'Track Order Status')}
              </button>
              <Link to="/" className="block">
                <button className="w-full py-4 rounded-2xl border-2 border-slate-100 text-slate-700 font-bold hover:bg-slate-50 transition-all">
                  {tt('backToHome', 'العودة للرئيسية', 'Return Home')}
                </button>
              </Link>
            </div>
          </div>
        )}

        {/* Registered, but not confirmed on this device: no details shown */}
        {status === 'exists' && (
          <div className="mt-4">
            <p className="text-slate-600 font-bold mb-6 px-4 leading-relaxed">
              {tr('الطلب رقم', 'Order')} <span dir="ltr" className="font-black">#{safeId}</span>{' '}
              {tr('مسجّل في نظامنا. لحماية بياناتك لا نعرض تفاصيله هنا. للاستفسار تواصل معنا برقم الطلب.', 'is registered in our system. To protect your data its details are not shown here. Contact us with the order number for any question.')}
            </p>
            <div className="flex flex-col gap-3">
              <a href={whatsappUrl(STORE_WHATSAPP, safeId, { kind: 'unconfirmed' })} target="_blank" rel="noopener noreferrer" className="w-full py-4 rounded-2xl bg-[#25D366] text-white font-extrabold flex items-center justify-center gap-2">
                <MessageCircle size={20} /> {tr('تواصل مع المكتبة عبر واتساب', 'Contact the shop on WhatsApp')}
              </a>
              <Link to="/" className="block">
                <button className="w-full py-4 rounded-2xl border-2 border-slate-100 text-slate-700 font-bold hover:bg-slate-50 transition-all">
                  {tt('backToHome', 'العودة للرئيسية', 'Return Home')}
                </button>
              </Link>
            </div>
          </div>
        )}

        {/* The order Worker could not be reached: nothing is claimed */}
        {status === 'unknown' && (
          <div className="mt-4">
            <p className="text-slate-600 font-bold mb-6 px-4 leading-relaxed">
              {tr('لا نستطيع الآن التأكد من حالة الطلب رقم', 'We cannot check the status of order')} <span dir="ltr" className="font-black">#{safeId}</span>.{' '}
              {tr('أعد المحاولة بعد قليل، ولا تنشئ طلبًا جديدًا قبل التأكد.', 'Please try again shortly, and do not place a new order before it is confirmed.')}
            </p>
            <div className="flex flex-col gap-3">
              <button className="w-full py-4 rounded-2xl bg-sky-400 hover:bg-sky-500 text-white font-extrabold" onClick={retryLoad}>
                {tr('إعادة التحقق', 'Check again')}
              </button>
              <a href={whatsappUrl(STORE_WHATSAPP, safeId, { kind: 'unconfirmed' })} target="_blank" rel="noopener noreferrer" className="w-full py-4 rounded-2xl bg-[#25D366] text-white font-extrabold flex items-center justify-center gap-2">
                <MessageCircle size={20} /> {tr('تواصل مع المكتبة عبر واتساب', 'Contact the shop on WhatsApp')}
              </a>
            </div>
          </div>
        )}

        {status === 'success' && codeIdentityUnknown && (
          <div className="mt-2 mb-6 rounded-2xl border border-slate-200 bg-white p-4 text-start" data-testid="tracking-code-identity-unknown">
            <p className="text-sm font-bold text-slate-600 leading-relaxed">
              {tr('تعذّر التحقق من حسابك الآن، لذلك لا نعرض رمز التتبع.', 'We could not confirm your account right now, so the tracking code is not shown.')}
            </p>
            <button type="button" onClick={() => setCodeCheck((n) => n + 1)} className="mt-2 text-xs font-black text-sky-700 underline">
              {tr('إعادة التحقق', 'Check again')}
            </button>
          </div>
        )}

        {/* Tracking code: only on the device that placed the order (never in a link: pixels/analytics may record URLs) */}
        {status === 'success' && trackingCode && (
          <div className="mt-2 mb-6 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-start" data-testid="tracking-code-box">
            <p className="text-xs font-black text-sky-700 uppercase tracking-widest mb-1">{tr('رمز تتبع الطلب', 'Order tracking code')}</p>
            <div className="flex items-center justify-between gap-3">
              <span dir="ltr" className="font-black text-slate-900 tracking-wider break-all" data-testid="tracking-code-value">{trackingCode}</span>
              <button type="button" onClick={copyTrackingCode} className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-xl">
                <Copy size={14} /> {tr('نسخ', 'Copy')}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
              {tr('احتفظ بهذا الرمز لعرض تفاصيل طلبك من جهاز آخر في صفحة التتبع. لا تشاركه مع أحد؛ رقم الطلب وحده يعرض الحالة فقط.', 'Keep this code to see your order details from another device on the tracking page. Do not share it; the order number alone shows only the status.')}
            </p>
          </div>
        )}

        {/* Confirmed, but this device has no stored details (e.g. storage cleared) */}
        {status === 'success' && !order && (
          <div className="mt-2">
            <p className="text-slate-500 mb-6 font-medium leading-relaxed">
              {tr('تم تأكيد طلبك رقم', 'Your order')} <span dir="ltr" className="font-black text-slate-900">#{safeId}</span>{' '}
              {tr('بنجاح.', 'is confirmed.')}
            </p>
            <Link to="/" className="block">
              <button className="w-full py-4 rounded-2xl bg-black text-white font-extrabold">{tt('backToHome', 'الاستمرار بالتسوق', 'Continue Shopping')}</button>
            </Link>
          </div>
        )}

        {/* Success State */}
        {status === 'success' && order && (
          <div className="mt-2 animate-in fade-in duration-500">
            <p className="text-slate-500 mb-8 font-medium leading-relaxed">
              {tt(
                'orderConfirmedMsg',
                'لقد استلمنا طلبك بنجاح. سنقوم بإرسال إشعارات لتتبع الشحنة حتى تصل لباب منزلك.',
                'We have successfully received your order. You will receive updates until it reaches your door.'
              )}
            </p>

            {safeText((order as any)?.paymentMethod).toLowerCase() === 'cliq' && (
              <a
                href={whatsappUrl(STORE_WHATSAPP, safeId, { kind: 'cliq_receipt', cliqReference: safeText((order as any)?.paymentDetails?.cliqReference), customerName: safeText((order as any)?.address?.fullName) })}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="cliq-whatsapp"
                className="mb-4 w-full py-4 rounded-2xl bg-[#25D366] text-white font-extrabold flex items-center justify-center gap-2 shadow-lg shadow-[#25D366]/30"
              >
                <MessageCircle size={20} /> {tr('أرسل صورة إيصال CliQ عبر واتساب', 'Send the CliQ receipt on WhatsApp')}
              </a>
            )}

            {/* 💳 تنبيه إذا كان الدفع عبر CliQ */}
            {safeText((order as any)?.paymentMethod).toLowerCase() === 'cliq' && (
               <div className="mb-6 bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-start gap-3 text-indigo-800 text-start animate-in slide-in-from-bottom-2">
                 <Clock className="shrink-0 mt-0.5 text-indigo-500" size={20} />
                 <div>
                   <p className="font-bold text-sm mb-1">{tt('cliqPending', 'بانتظار تأكيد الحوالة', 'Awaiting Transfer Confirmation')}</p>
                   <p className="text-xs font-medium text-indigo-700/80">
                     {tt('cliqReview', 'سيقوم فريقنا بمراجعة الحوالة وتأكيد الطلب خلال وقت قصير. شكراً لتفهمك.', 'Our team will review your transfer and confirm the order shortly. Thank you.')}
                   </p>
                 </div>
               </div>
            )}

            <div className="bg-slate-50/50 rounded-3xl p-6 sm:p-8 mb-8 text-start border border-slate-200/60 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-emerald-400 opacity-80" />
              
              {/* Order ID & Date */}
              <div className="flex justify-between items-center mb-5 border-b border-slate-200/80 pb-5 gap-3">
                <div className="min-w-0">
                  <span className="text-slate-500 text-xs font-bold uppercase tracking-wider block mb-1">
                    {tt('orderNumber', 'رقم التتبع (Order ID)', 'Tracking Number (Order ID)')}
                  </span>
                  <span className="font-black text-slate-900 text-xl break-all" dir="ltr">
                    #{safeId}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={copyOrderId}
                  className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 hover:border-sky-400 hover:text-sky-500 transition-colors text-slate-700 font-bold text-xs shadow-sm group"
                  aria-label={tt('copyOrderId', 'نسخ رقم الطلب', 'Copy order id')}
                >
                  <Copy size={16} className="text-slate-400 group-hover:text-sky-500 transition-colors" />
                  <span className="hidden sm:inline-block">{tt('copy', 'نسخ', 'Copy')}</span>
                </button>
              </div>

              <div className="flex justify-between items-center mb-4 gap-3">
                <span className="text-slate-500 font-bold text-sm">
                  {tt('orderDate', 'تاريخ ووقت الطلب', 'Order Date & Time')}
                </span>
                <span className="font-extrabold text-slate-800 text-end" dir="ltr">
                  {getDisplayDate(order)}
                </span>
              </div>

              <div className="flex justify-between items-center mb-4 gap-3">
                <span className="text-slate-500 font-bold text-sm">
                  {tt('total', 'المبلغ الإجمالي', 'Total Amount')}
                </span>
                <span className="font-black text-sky-600 text-xl drop-shadow-sm" dir="ltr">
                  {formatMoney((order as any)?.total)}
                </span>
              </div>

              {/* Payment & Shipping Methods Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
                <div className="rounded-2xl bg-white border border-slate-200/70 p-4 flex items-center gap-3 shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-500 flex items-center justify-center shrink-0">
                    <CreditCard size={20} />
                  </div>
                  <div className="text-sm min-w-0">
                    <p className="text-slate-400 text-[11px] mb-0.5 font-bold uppercase tracking-widest">
                      {tt('paymentMethod', 'طريقة الدفع', 'Payment Method')}
                    </p>
                    <p className="font-extrabold text-slate-800 break-words line-clamp-1">
                      {paymentLabel((order as any)?.paymentMethod)}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200/70 p-4 flex items-center gap-3 shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                    <Truck size={20} />
                  </div>
                  <div className="text-sm min-w-0">
                    <p className="text-slate-400 text-[11px] mb-0.5 font-bold uppercase tracking-widest">
                      {tt('shipping', 'طريقة التوصيل', 'Shipping Method')}
                    </p>
                    <p className="font-extrabold text-slate-800 break-words line-clamp-1">
                      {safeText((order as any)?.shippingMethod) || '—'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Delivery Address */}
              <div className="mt-6 pt-5 border-t border-slate-200/80">
                <span className="text-slate-400 text-xs font-extrabold uppercase tracking-widest block mb-3">
                  {tt('deliveryAddress', 'سيتم التوصيل إلى', 'Delivering To')}
                </span>
                <div className="text-sm font-semibold text-slate-800 leading-relaxed break-words bg-white p-5 rounded-2xl border border-slate-200/70 shadow-sm relative overflow-hidden group">
                  <div className="absolute left-0 top-0 w-1 h-full bg-slate-300 group-hover:bg-slate-800 transition-colors" />
                  <p className="font-black text-slate-900 mb-1">{safeText((order as any)?.address?.fullName) || '—'}</p>
                  <p className="text-slate-600">
                    {safeText((order as any)?.address?.city) || '—'}
                    {safeText((order as any)?.address?.street) ? `, ${safeText((order as any)?.address?.street)}` : ''}
                  </p>
                  <p dir="ltr" className="inline-block mt-2 font-extrabold text-slate-500 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-lg">
                    {maskPhone((order as any)?.address?.phone)}
                  </p>
                </div>
              </div>

              {/* Order Note */}
              {safeText((order as any)?.note) && (
                <div className="mt-5 rounded-2xl bg-white border border-slate-200/70 p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 text-slate-800 min-w-0">
                      <StickyNote size={18} className="text-slate-400 shrink-0" />
                      <p className="text-sm font-extrabold text-slate-900">
                        {tt('orderNote', 'ملاحظات وتفاصيل إضافية', 'Additional Details')}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap break-words font-medium bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                    {safeText((order as any)?.note)}
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button 
                onClick={goToTracking}
                disabled={!safeId}
                className="flex-1 py-4 text-base font-extrabold rounded-2xl bg-sky-400 hover:bg-sky-500 text-white shadow-lg shadow-sky-400/30 flex justify-center items-center gap-2 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <Package size={20} className="group-hover:scale-110 transition-transform" />
                <span>{tt('trackYourOrder', 'تتبع حالة الشحنة', 'Track Shipment Status')}</span>
              </button>

              <Link to="/" className="flex-1">
                <button className="w-full py-4 text-base font-extrabold rounded-2xl bg-black hover:bg-slate-800 text-white shadow-md shadow-black/20 flex justify-center items-center gap-2 transition-all duration-300 group">
                  <Home size={20} className="text-slate-400 group-hover:text-white transition-colors" />
                  {tt('backToHome', 'الاستمرار بالتسوق', 'Continue Shopping')}
                </button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderSuccess;