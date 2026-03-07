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

const maskPhone = (phone?: string) => {
  const p = safeText(phone);
  if (!p) return '—';
  if (p.length < 6) return p;
  return `${p.slice(0, 3)}****${p.slice(-3)}`;
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

  const tr = useCallback(
    (ar: string, en: string) => (language === 'ar' ? ar : en),
    [language]
  );

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
      return new Intl.NumberFormat(language === 'ar' ? 'ar-JO' : 'en-JO', {
        style: 'currency',
        currency: 'JOD',
        maximumFractionDigits: 2,
      });
    } catch {
      return null;
    }
  }, [language]);

  const formatMoney = useCallback(
    (amount?: number) => {
      const value = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
      return fmt ? fmt.format(value) : `JOD ${value.toFixed(2)}`;
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
      setErrorMsg(tr('رقم الطلب غير موجود.', 'Order id is missing.'));
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
          'تعذر تحميل بيانات الطلب من الجلسة الحالية. إذا فتحت الرابط مباشرة من خارج عملية الشراء، استخدم صفحة التتبع.',
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SEO
        title={tt('orderSuccess', 'تأكيد الطلب', 'Order confirmed')}
        noIndex={true}
      />

      <div className="bg-white max-w-lg w-full rounded-3xl shadow-xl border border-slate-100 p-8 text-center animate-in zoom-in duration-300">
        {status === 'error' ? (
          <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle size={40} />
          </div>
        ) : (
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={40} />
          </div>
        )}

        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          {tt('thankYou', 'شكرًا لك!', 'Thank you!')}
        </h1>

        {status === 'loading' && (
          <div className="mt-4 mb-8">
            <p className="text-slate-500 mb-4">
              {tt('loading', 'جاري تحميل بيانات الطلب...', 'Loading your order...')}
            </p>

            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 text-left rtl:text-right space-y-3">
              <div className="h-4 w-2/3 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-1/2 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-3/4 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-1/3 bg-slate-200 rounded animate-pulse" />
            </div>
          </div>
        )}

        {status === 'error' && (
          <>
            <p className="text-red-600 font-semibold mb-6">{errorMsg}</p>

            <div className="flex flex-col gap-3">
              <Button className="w-full" onClick={retryLoad}>
                {tt('retry', 'إعادة المحاولة', 'Retry')}
              </Button>

              <Button className="w-full" onClick={goToTracking}>
                {tt('trackYourOrder', 'تتبع الطلب', 'Track your order')}
              </Button>

              <Link to="/">
                <Button variant="outline" className="w-full">
                  {tt('backToHome', 'العودة للرئيسية', 'Back to home')}
                </Button>
              </Link>
            </div>
          </>
        )}

        {status === 'success' && order && (
          <>
            <p className="text-slate-500 mb-8">
              {tt(
                'orderConfirmedMsg',
                'تم تأكيد طلبك بنجاح. سنقوم بالتواصل معك قريبًا.',
                'Your order is confirmed. We will contact you soon.'
              )}
            </p>

            <div className="bg-slate-50 rounded-2xl p-6 mb-8 text-left rtl:text-right border border-slate-100">
              <div className="flex justify-between items-center mb-4 border-b border-slate-200 pb-3 gap-3">
                <div className="min-w-0">
                  <span className="text-slate-500 text-sm block">
                    {tt('orderNumber', 'رقم الطلب', 'Order number')}
                  </span>
                  <span className="font-bold text-slate-900 text-lg break-all">
                    {safeId}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={copyOrderId}
                  className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition text-slate-700 font-bold text-sm"
                  aria-label={tt('copyOrderId', 'نسخ رقم الطلب', 'Copy order id')}
                >
                  <Copy size={16} />
                  {tt('copy', 'نسخ', 'Copy')}
                </button>
              </div>

              <div className="flex justify-between items-center mb-2 gap-3">
                <span className="text-slate-500 text-sm">
                  {tt('orderDate', 'تاريخ الطلب', 'Order date')}
                </span>
                <span className="font-medium text-slate-800 text-right">
                  {getDisplayDate(order)}
                </span>
              </div>

              <div className="flex justify-between items-center mb-2 gap-3">
                <span className="text-slate-500 text-sm">
                  {tt('total', 'الإجمالي', 'Total')}
                </span>
                <span className="font-bold text-secondary-dark text-lg">
                  {formatMoney((order as any)?.total)}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                <div className="rounded-2xl bg-white border border-slate-100 p-3 flex items-center gap-2">
                  <CreditCard className="text-secondary-DEFAULT" size={18} />
                  <div className="text-sm min-w-0">
                    <p className="text-slate-500">
                      {tt('paymentMethod', 'طريقة الدفع', 'Payment')}
                    </p>
                    <p className="font-bold text-slate-800 break-words">
                      {paymentLabel((order as any)?.paymentMethod)}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-100 p-3 flex items-center gap-2">
                  <Truck className="text-secondary-DEFAULT" size={18} />
                  <div className="text-sm min-w-0">
                    <p className="text-slate-500">
                      {tt('shipping', 'الشحن', 'Shipping')}
                    </p>
                    <p className="font-bold text-slate-800 break-words">
                      {safeText((order as any)?.shippingMethod) || '—'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <span className="text-slate-500 text-sm block mb-2">
                  {tt('deliveryAddress', 'عنوان التوصيل', 'Delivery address')}
                </span>

                <div className="text-sm font-medium text-slate-800 leading-relaxed break-words">
                  {safeText((order as any)?.address?.fullName) || '—'}
                  <br />
                  {safeText((order as any)?.address?.city) || '—'}
                  {safeText((order as any)?.address?.street)
                    ? `, ${safeText((order as any)?.address?.street)}`
                    : ''}
                  <br />
                  {maskPhone((order as any)?.address?.phone)}
                </div>
              </div>

              {safeText((order as any)?.note) && (
                <div className="mt-4 rounded-2xl bg-white border border-slate-100 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-slate-800 min-w-0">
                      <div className="w-9 h-9 rounded-2xl bg-secondary-light/20 flex items-center justify-center text-secondary-DEFAULT shrink-0">
                        <StickyNote size={18} />
                      </div>

                      <div className="min-w-0">
                        <p className="text-sm font-bold">
                          {tt('orderNote', 'ملاحظة الطلب', 'Order note')}
                        </p>
                        <p className="text-xs text-slate-500">
                          {tt(
                            'orderNoteHint',
                            'تم حفظها داخل الطلب.',
                            'Saved with the order.'
                          )}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={copyOrderNote}
                      className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 transition text-slate-700 font-bold text-xs"
                      aria-label={tt('copyOrderNote', 'نسخ ملاحظة الطلب', 'Copy order note')}
                    >
                      <Copy size={14} />
                      {tt('copy', 'نسخ', 'Copy')}
                    </button>
                  </div>

                  <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-100 p-3 max-h-44 overflow-auto">
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                      {safeText((order as any)?.note)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <Link
                to={safeId ? `/tracking?orderId=${encodeURIComponent(safeId)}` : '/tracking'}
              >
                <Button className="w-full" disabled={!safeId}>
                  <Package
                    className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2"
                    size={20}
                  />
                  {tt('trackYourOrder', 'تتبع الطلب', 'Track your order')}
                </Button>
              </Link>

              <Link to="/">
                <Button variant="outline" className="w-full">
                  {tt('backToHome', 'العودة للرئيسية', 'Back to home')}
                </Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default OrderSuccess;