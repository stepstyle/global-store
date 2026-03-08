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
} from 'lucide-react';
import Button from '../components/Button';
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

// 🔒 إخفاء رقم الهاتف بشكل آمن
const maskPhone = (phone?: string) => {
  const p = safeText(phone);
  if (!p) return '—';
  if (p.length < 6) return p;
  return `${p.slice(0, 4)} **** ${p.slice(-3)}`;
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
      if (value === 'cliq') return tt('cliq', 'الدفع عبر كليك', 'CliQ transfer');
      if (value === 'card') return tt('creditCard', 'بطاقة', 'Card');
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

  const getDisplayDate = useCallback((currentOrder: any) => {
    return (
      safeText(currentOrder?.date) ||
      safeText(currentOrder?.createdAt) ||
      safeText(currentOrder?.updatedAt) ||
      '—'
    );
  }, []);

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

  const loadOrder = useCallback(() => {
    if (!safeId) {
      setOrder(null);
      setStatus('error');
      setErrorMsg(tr('رقم الطلب غير موجود.', 'Order ID is missing.'));
      return;
    }

    setStatus('loading');
    setErrorMsg('');

    try {
      const stateOrder = resolveOrderFromState();
      if (stateOrder) {
        setOrder(stateOrder);
        cacheOrder(stateOrder);
        setStatus('success');
        return;
      }

      const cachedOrder = getCachedOrder(safeId);
      if (cachedOrder) {
        setOrder(cachedOrder);
        setStatus('success');
        return;
      }

      setOrder(null);
      setStatus('error');
      setErrorMsg(
        tr(
          'تعذر تحميل بيانات الطلب من الجلسة الحالية. إذا فتحت الرابط مباشرة، استخدم صفحة التتبع.',
          'Unable to load the order from the current session. If you opened this link directly, please use the tracking page.'
        )
      );
    } catch (error) {
      console.error('OrderSuccess loadOrder failed:', error, { safeId });
      setOrder(null);
      setStatus('error');
      setErrorMsg(
        tr(
          'حدث خطأ أثناء تحميل بيانات الطلب. حاول مرة أخرى.',
          'An error occurred while loading the order. Please try again.'
        )
      );
    }
  }, [safeId, tr, resolveOrderFromState, getCachedOrder, cacheOrder]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const copyOrderId = async () => {
    try {
      if (!safeId) return;
      await navigator.clipboard.writeText(safeId);
      showToast?.(tt('copied', 'تم النسخ', 'Copied'), 'success');
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
      <SEO title={tt('orderSuccess', 'تأكيد الطلب', 'Order confirmed')} noIndex={true} />

      <div className="bg-white max-w-lg w-full rounded-3xl shadow-xl border border-slate-100 p-8 text-center animate-in zoom-in slide-in-from-bottom-4 duration-500">
        
        {/* Status Icon */}
        {status === 'error' ? (
          <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle size={40} />
          </div>
        ) : (
          <div className="w-20 h-20 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <CheckCircle size={40} strokeWidth={2.5} />
          </div>
        )}

        <h1 className="text-3xl font-black text-slate-900 mb-3 tracking-tight">
          {tt('thankYou', 'شكرًا لك!', 'Thank you!')}
        </h1>

        {/* Loading State */}
        {status === 'loading' && (
          <div className="mt-4 mb-8">
            <p className="text-slate-500 font-medium mb-6">
              {tt('loading', 'جاري تحميل بيانات الطلب...', 'Loading your order...')}
            </p>
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 text-start space-y-4">
              <div className="h-4 w-2/3 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-1/2 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-3/4 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-1/3 bg-slate-200 rounded animate-pulse" />
            </div>
          </div>
        )}

        {/* Error State */}
        {status === 'error' && (
          <div className="mt-4">
            <p className="text-red-600 font-bold mb-8 px-4 leading-relaxed">{errorMsg}</p>
            <div className="flex flex-col gap-3">
              <Button className="w-full py-3.5 shadow-md" onClick={retryLoad}>
                {tt('retry', 'إعادة المحاولة', 'Retry')}
              </Button>
              <Button className="w-full py-3.5 bg-slate-800 hover:bg-slate-900 shadow-md text-white" onClick={goToTracking}>
                {tt('trackYourOrder', 'تتبع الطلب', 'Track your order')}
              </Button>
              <Link to="/">
                <Button variant="outline" className="w-full py-3.5">
                  {tt('backToHome', 'العودة للرئيسية', 'Back to home')}
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* Success State */}
        {status === 'success' && order && (
          <div className="mt-2 animate-in fade-in duration-500">
            <p className="text-slate-500 mb-8 font-medium">
              {tt(
                'orderConfirmedMsg',
                'تم تأكيد طلبك بنجاح. سنقوم بالبدء في تجهيزه وتوصيله في أسرع وقت.',
                'Your order is confirmed. We will process and deliver it as soon as possible.'
              )}
            </p>

            <div className="bg-slate-50 rounded-3xl p-6 sm:p-7 mb-8 text-start border border-slate-200/60 shadow-sm">
              
              {/* Order ID & Date */}
              <div className="flex justify-between items-center mb-5 border-b border-slate-200 pb-4 gap-3">
                <div className="min-w-0">
                  <span className="text-slate-500 text-xs font-bold uppercase tracking-wider block mb-1">
                    {tt('orderNumber', 'رقم الطلب', 'Order number')}
                  </span>
                  {/* 🌍 استخدام dir="ltr" لضمان ظهور الـ # والترتيب بشكل سليم */}
                  <span className="font-black text-slate-900 text-lg break-all" dir="ltr">
                    #{safeId}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={copyOrderId}
                  className="shrink-0 inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 hover:border-slate-300 transition-colors text-slate-700 font-bold text-xs shadow-sm"
                  aria-label={tt('copyOrderId', 'نسخ رقم الطلب', 'Copy order id')}
                >
                  <Copy size={16} className="text-slate-400" />
                  {tt('copy', 'نسخ', 'Copy')}
                </button>
              </div>

              <div className="flex justify-between items-center mb-3 gap-3">
                <span className="text-slate-500 font-medium text-sm">
                  {tt('orderDate', 'تاريخ الطلب', 'Order date')}
                </span>
                <span className="font-bold text-slate-800 text-end" dir="ltr">
                  {getDisplayDate(order)}
                </span>
              </div>

              <div className="flex justify-between items-center mb-2 gap-3">
                <span className="text-slate-500 font-medium text-sm">
                  {tt('total', 'الإجمالي', 'Total')}
                </span>
                <span className="font-black text-slate-900 text-lg" dir="ltr">
                  {formatMoney((order as any)?.total)}
                </span>
              </div>

              {/* Payment & Shipping Methods Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
                <div className="rounded-2xl bg-white border border-slate-200/70 p-4 flex items-center gap-3 shadow-sm">
                  <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <CreditCard size={18} />
                  </div>
                  <div className="text-sm min-w-0">
                    <p className="text-slate-500 text-xs mb-0.5 font-bold">
                      {tt('paymentMethod', 'طريقة الدفع', 'Payment')}
                    </p>
                    <p className="font-extrabold text-slate-800 break-words line-clamp-1">
                      {paymentLabel((order as any)?.paymentMethod)}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200/70 p-4 flex items-center gap-3 shadow-sm">
                  <div className="w-10 h-10 rounded-full bg-secondary-light/20 text-secondary-DEFAULT flex items-center justify-center shrink-0">
                    <Truck size={18} />
                  </div>
                  <div className="text-sm min-w-0">
                    <p className="text-slate-500 text-xs mb-0.5 font-bold">
                      {tt('shipping', 'الشحن', 'Shipping')}
                    </p>
                    <p className="font-extrabold text-slate-800 break-words line-clamp-1">
                      {safeText((order as any)?.shippingMethod) || '—'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Delivery Address */}
              <div className="mt-6 pt-5 border-t border-slate-200">
                <span className="text-slate-500 text-xs font-bold uppercase tracking-wider block mb-2">
                  {tt('deliveryAddress', 'عنوان التوصيل', 'Delivery address')}
                </span>
                <div className="text-sm font-semibold text-slate-800 leading-relaxed break-words bg-white p-4 rounded-2xl border border-slate-200/70 shadow-sm">
                  {safeText((order as any)?.address?.fullName) || '—'}
                  <br />
                  <span className="text-slate-600">
                    {safeText((order as any)?.address?.city) || '—'}
                    {safeText((order as any)?.address?.street) ? `, ${safeText((order as any)?.address?.street)}` : ''}
                  </span>
                  <br />
                  <span dir="ltr" className="inline-block mt-1 font-extrabold text-slate-700">
                    {maskPhone((order as any)?.address?.phone)}
                  </span>
                </div>
              </div>

              {/* Order Note */}
              {safeText((order as any)?.note) && (
                <div className="mt-5 rounded-2xl bg-yellow-50/50 border border-yellow-100 p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 text-slate-800 min-w-0">
                      <StickyNote size={18} className="text-yellow-600 shrink-0" />
                      <p className="text-sm font-extrabold text-yellow-900">
                        {tt('orderNote', 'ملاحظة الطلب', 'Order note')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={copyOrderNote}
                      className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-yellow-100/50 hover:bg-yellow-200 transition-colors text-yellow-800 font-bold text-xs"
                      aria-label={tt('copyOrderNote', 'نسخ ملاحظة الطلب', 'Copy order note')}
                    >
                      <Copy size={14} />
                      {tt('copy', 'نسخ', 'Copy')}
                    </button>
                  </div>
                  <p className="text-sm text-yellow-800/80 leading-relaxed whitespace-pre-wrap break-words font-medium">
                    {safeText((order as any)?.note)}
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                to={safeId ? `/tracking?orderId=${encodeURIComponent(safeId)}` : '/tracking'}
                className="flex-1"
              >
                <Button className="w-full py-4 shadow-lg flex items-center justify-center gap-2" disabled={!safeId}>
                  <Package size={20} />
                  <span>{tt('trackYourOrder', 'تتبع الطلب', 'Track your order')}</span>
                </Button>
              </Link>

              <Link to="/" className="flex-1">
                <Button variant="outline" className="w-full py-4 border-slate-200 hover:bg-slate-50">
                  {tt('backToHome', 'العودة للرئيسية', 'Back to home')}
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderSuccess;