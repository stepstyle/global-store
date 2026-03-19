// src/pages/OrderSuccess.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { getFirestoreDb } from '../services/firebase';
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
  Clock
} from 'lucide-react';
import { useCart } from '../App';
import { Order } from '../types';
import SEO from '../components/SEO';

const { useParams, Link, useLocation, useNavigate } = ReactRouterDOM as any;

type Status = 'idle' | 'loading' | 'success' | 'error';

type OrderSuccessLocationState = {
  order?: Order | null;
};

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
  const location = useLocation();
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

  const cacheOrder = useCallback((value: Order | null | undefined) => {
    if (!value || typeof window === 'undefined') return;

    const orderId = safeText((value as any)?.id);
    if (!orderId) return;

    try {
      sessionStorage.setItem(getOrderCacheKey(orderId), JSON.stringify(value));
    } catch (error) {
      console.error('Failed to cache order success payload:', error);
    }
  }, []);

  const resolveOrderFromState = useCallback((): Order | null => {
    const state = (location?.state || {}) as OrderSuccessLocationState;
    const stateOrder = state?.order ?? null;

    if (!stateOrder) return null;

    const stateOrderId = safeText((stateOrder as any)?.id);
    if (!stateOrderId || stateOrderId !== safeId) return null;

    return stateOrder;
  }, [location, safeId]);

  const loadOrder = useCallback(async () => {
    if (!safeId) {
      setOrder(null);
      setStatus('error');
      setErrorMsg(tr('رقم الطلب مفقود.', 'Order ID is missing.'));
      return;
    }

    setStatus('loading');
    setErrorMsg('');

    try {
      const stateOrder = resolveOrderFromState();
      const cachedOrder = getCachedOrder(safeId);
      const initialOrder = stateOrder || cachedOrder;

      if (initialOrder) {
        setOrder(initialOrder);
        setStatus('success');
      }

      const firestoreDb = await getFirestoreDb();
      const docRef = doc(firestoreDb, 'orders', safeId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const freshOrder = { id: docSnap.id, ...docSnap.data() } as Order;
        setOrder(freshOrder);
        cacheOrder(freshOrder);
        setStatus('success');
      } else {
        if (!initialOrder) {
          setOrder(null);
          setStatus('error');
          setErrorMsg(
            tr(
              'لم نتمكن من العثور على هذا الطلب في نظامنا. قد يكون رقم الطلب غير صحيح.',
              'We could not find this order in our system. The order ID might be incorrect.'
            )
          );
        }
      }
    } catch (error) {
      console.error('OrderSuccess loadOrder failed:', error, { safeId });
      setOrder((prev) => {
        if (!prev) {
          setStatus('error');
          setErrorMsg(
            tr(
              'حدث خطأ غير متوقع أثناء استرداد بيانات الطلب. يرجى المحاولة لاحقاً.',
              'An unexpected error occurred while retrieving order details. Please try again later.'
            )
          );
        }
        return prev;
      });
    }
  }, [safeId, tr, resolveOrderFromState, getCachedOrder, cacheOrder]);

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
        {status === 'error' ? (
          <div className="w-24 h-24 bg-red-50 text-red-500 rounded-3xl flex items-center justify-center mx-auto mb-6 rotate-12 transition-transform">
            <AlertTriangle size={48} strokeWidth={2} />
          </div>
        ) : (
          <div className="w-24 h-24 bg-emerald-50 text-emerald-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner border border-emerald-100">
            <CheckCircle size={48} strokeWidth={2.5} />
          </div>
        )}

        <h1 className="text-3xl sm:text-4xl font-black text-slate-900 mb-3 tracking-tight">
          {status === 'error' ? tt('error', 'عذراً، حدث خطأ!', 'Oops, an error occurred!') : tt('thankYou', 'شكراً لتسوقك معنا!', 'Thank You for Shopping!')}
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