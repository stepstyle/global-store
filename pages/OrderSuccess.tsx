import React, { useEffect, useMemo, useState, useCallback } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { CheckCircle, Package, AlertTriangle, Copy, CreditCard, Truck, StickyNote } from 'lucide-react';
import Button from '../components/Button';
import { useCart } from '../App';
import { db } from '../services/storage';
import { Order } from '../types';
import SEO from '../components/SEO';

const { useParams, Link } = ReactRouterDOM as any;

type Status = 'idle' | 'loading' | 'success' | 'error';

const maskPhone = (phone?: string) => {
  const p = String(phone ?? '').trim();
  if (p.length < 6) return p;
  return `${p.slice(0, 3)}****${p.slice(-3)}`;
};

const safeText = (v: any) => String(v ?? '').trim();

const OrderSuccess: React.FC = () => {
  const { id } = useParams();
  const { t, showToast, language } = useCart() as any;

  const [order, setOrder] = useState<Order | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const safeId = useMemo(() => (id ? String(id).trim() : ''), [id]);

  const tr = useCallback((ar: string, en: string) => (language === 'ar' ? ar : en), [language]);

  // ✅ t with safe bilingual fallback
  const tt = useCallback(
    (key: string, fallbackAr: string, fallbackEn: string) => {
      const v = t?.(key);
      if (!v || v === key) return tr(fallbackAr, fallbackEn);
      return v;
    },
    [t, tr]
  );

  const paymentLabel = useCallback(
    (pm?: string) => {
      const v = safeText(pm);
      if (!v) return '—';

      // normalize
      const s = v.toLowerCase();

      if (s === 'cod') return tt('cod', 'الدفع عند الاستلام', 'Cash on delivery');
      if (s === 'cliq') return tt('cliq', 'الدفع عبر كليك', 'CliQ transfer');
      if (s === 'card') return tt('creditCard', 'بطاقة', 'Card');
      if (s === 'paypal') return 'PayPal';

      // fallback: show raw value
      return v;
    },
    [tt]
  );

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

  const formatMoney = (n?: number) => {
    const x = typeof n === 'number' ? n : 0;
    return fmt ? fmt.format(x) : `JOD ${x.toFixed(2)}`;
  };

  const fetchOrder = useCallback(async () => {
    if (!safeId) {
      setStatus('error');
      setErrorMsg(tr('رقم الطلب غير موجود.', 'Order id is missing.'));
      return;
    }

    try {
      setStatus('loading');
      setErrorMsg('');

      const res = await db.orders.getById(safeId);

      if (!res) {
        setOrder(null);
        setStatus('error');
        setErrorMsg(
          tr('لم نتمكّن من العثور على الطلب. تأكد من رقم الطلب.', 'We could not find this order. Please check the order id.')
        );
        return;
      }

      setOrder(res);
      setStatus('success');
    } catch {
      setStatus('error');
      setErrorMsg(tr('حدث خطأ أثناء تحميل بيانات الطلب. حاول مرة أخرى.', 'An error occurred while loading the order. Please try again.'));
    }
  }, [safeId, tr]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await fetchOrder();
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [fetchOrder]);

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

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SEO title={tt('orderSuccess', 'تأكيد الطلب', 'Order confirmed')} noIndex={true} />

      <div className="bg-white max-w-lg w-full rounded-3xl shadow-xl border border-slate-100 p-8 text-center animate-in zoom-in duration-300">
        {/* Icon */}
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

        {/* Loading */}
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

        {/* Error */}
        {status === 'error' && (
          <>
            <p className="text-red-600 font-semibold mb-6">{errorMsg}</p>
            <Button
              className="w-full"
              onClick={() => {
                setStatus('idle');
                setErrorMsg('');
                setOrder(null);
                fetchOrder();
              }}
            >
              {tt('retry', 'إعادة المحاولة', 'Retry')}
            </Button>
          </>
        )}

        {/* Success */}
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
              {/* Order ID + Copy */}
              <div className="flex justify-between items-center mb-4 border-b border-slate-200 pb-3 gap-3">
                <div className="min-w-0">
                  <span className="text-slate-500 text-sm block">{tt('orderNumber', 'رقم الطلب', 'Order number')}</span>
                  <span className="font-bold text-slate-900 text-lg break-all">{safeId}</span>
                </div>
                <button
                  type="button"
                  onClick={copyOrderId}
                  className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition text-slate-700 font-bold text-sm"
                  aria-label="Copy order id"
                >
                  <Copy size={16} />
                  {tt('copy', 'نسخ', 'Copy')}
                </button>
              </div>

              <div className="flex justify-between items-center mb-2">
                <span className="text-slate-500 text-sm">{tt('orderDate', 'تاريخ الطلب', 'Order date')}</span>
                <span className="font-medium text-slate-800">{safeText((order as any).date) || '—'}</span>
              </div>

              <div className="flex justify-between items-center mb-2">
                <span className="text-slate-500 text-sm">{tt('total', 'الإجمالي', 'Total')}</span>
                <span className="font-bold text-secondary-dark text-lg">{formatMoney((order as any).total)}</span>
              </div>

              {/* Payment + Shipping Method */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                <div className="rounded-2xl bg-white border border-slate-100 p-3 flex items-center gap-2">
                  <CreditCard className="text-secondary-DEFAULT" size={18} />
                  <div className="text-sm">
                    <p className="text-slate-500">{tt('paymentMethod', 'طريقة الدفع', 'Payment')}</p>
                    <p className="font-bold text-slate-800">{paymentLabel((order as any).paymentMethod)}</p>
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-100 p-3 flex items-center gap-2">
                  <Truck className="text-secondary-DEFAULT" size={18} />
                  <div className="text-sm">
                    <p className="text-slate-500">{tt('shipping', 'الشحن', 'Shipping')}</p>
                    <p className="font-bold text-slate-800">{safeText((order as any).shippingMethod) || '—'}</p>
                  </div>
                </div>
              </div>

              {/* Address */}
              <div className="mt-4">
                <span className="text-slate-500 text-sm block mb-2">
                  {tt('deliveryAddress', 'عنوان التوصيل', 'Delivery address')}
                </span>
                <div className="text-sm font-medium text-slate-800 leading-relaxed">
                  {safeText((order as any).address?.fullName) || '—'}
                  <br />
                  {safeText((order as any).address?.city) || '—'}, {safeText((order as any).address?.street) || '—'}
                  <br />
                  {maskPhone((order as any).address?.phone)}
                </div>
              </div>

              {/* ✅ Order Note */}
              {safeText((order as any).note) && (
                <div className="mt-4 rounded-2xl bg-white border border-slate-100 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-slate-800">
                      <div className="w-9 h-9 rounded-2xl bg-secondary-light/20 flex items-center justify-center text-secondary-DEFAULT">
                        <StickyNote size={18} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold">{tt('orderNote', 'ملاحظة الطلب', 'Order note')}</p>
                        <p className="text-xs text-slate-500">{tt('orderNoteHint', 'تم حفظها داخل الطلب.', 'Saved with the order.')}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={copyOrderNote}
                      className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 transition text-slate-700 font-bold text-xs"
                      aria-label="Copy order note"
                    >
                      <Copy size={14} />
                      {tt('copy', 'نسخ', 'Copy')}
                    </button>
                  </div>

                  <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-100 p-3 max-h-44 overflow-auto">
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                      {safeText((order as any).note)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {/* Track */}
              <Link to={safeId ? `/tracking?orderId=${encodeURIComponent(safeId)}` : '/tracking'}>
                <Button className="w-full" disabled={!safeId}>
                  <Package className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" size={20} />
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