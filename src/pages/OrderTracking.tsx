// src/pages/OrderTracking.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import {
  Search,
  Package,
  CheckCircle,
  Truck,
  MapPin,
  AlertTriangle,
  Copy,
  RefreshCw,
  StickyNote
} from 'lucide-react';
import Button from '../components/Button';
import { Order } from '../types';
import { useCart } from '../App';
import { db } from '../services/storage';
import SEO from '../components/SEO';

const { useLocation, useNavigate } = ReactRouterDOM as any;

type Status = 'idle' | 'loading' | 'success' | 'error';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const sanitizeOrderId = (raw: string) => {
  const s = String(raw ?? '').trim();
  // حماية بسيطة: لا تسمح بسلسلة طويلة جدًا
  return s.slice(0, 64);
};

const safeText = (v: any) => String(v ?? '').trim();

const OrderTracking: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const { t, getProductTitle, language, showToast } = useCart() as any;

  const [orderId, setOrderId] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  // 🌍 دعم اللغتين
  const isAR = language === 'ar';
  const tr = useCallback((ar: string, en: string) => (isAR ? ar : en), [isAR]);
  const tt = useCallback(
    (key: string, fallbackAr: string, fallbackEn: string) => {
      try {
        const v = t?.(key);
        if (!v || String(v) === key) return tr(fallbackAr, fallbackEn);
        return String(v);
      } catch {
        return tr(fallbackAr, fallbackEn);
      }
    },
    [t, tr]
  );

  const moneyFmt = useMemo(() => {
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
    (n?: number) => {
      const x = typeof n === 'number' && Number.isFinite(n) ? n : 0;
      return moneyFmt ? moneyFmt.format(x) : `${x.toFixed(2)} JOD`;
    },
    [moneyFmt]
  );

  // ✅ اقرأ orderId من query
  const queryOrderId = useMemo(() => {
    try {
      const sp = new URLSearchParams(location.search);
      return sanitizeOrderId(sp.get('orderId') ?? '');
    } catch {
      return '';
    }
  }, [location.search]);

  // ✅ خطوات الشحن (حالة الطلب) - مترجمة
  const steps = useMemo(
    () => [
      { status: 'processing', label: tt('processing', 'قيد المعالجة', 'Processing'), icon: Package },
      { status: 'shipped', label: tt('shipped', 'تم الشحن', 'Shipped'), icon: Truck },
      { status: 'delivered', label: tt('delivered', 'تم التسليم', 'Delivered'), icon: MapPin },
    ],
    [tt]
  );

  const getCurrentStepIndex = useCallback(
    (s: string) => {
      // إذا كان "new" نعتبره "processing"
      const statusToFind = s === 'new' ? 'processing' : s;
      const idx = steps.findIndex((x) => x.status === statusToFind);
      return idx === -1 ? 0 : idx;
    },
    [steps]
  );

  const progressPct = useMemo(() => {
    if (!order) return 0;
    const idx = getCurrentStepIndex((order as any).status);
    const denom = Math.max(1, steps.length - 1);
    return clamp((idx / denom) * 100, 0, 100);
  }, [order, steps.length, getCurrentStepIndex]);

  const trackById = useCallback(
    async (rawId: string) => {
      const id = sanitizeOrderId(rawId);

      if (!id) {
        setOrder(null);
        setStatus('error');
        setError(tt('orderIdError', 'الرجاء إدخال رقم طلب صحيح.', 'Please enter a valid order ID.'));
        return;
      }

      setStatus('loading');
      setError('');
      setOrder(null);

      try {
        const found = await db.orders.getById(id);

        if (found) {
          setOrder(found);
          setStatus('success');
          setError('');
        } else {
          setOrder(null);
          setStatus('error');
          setError(tt('orderNotFound', 'لم يتم العثور على الطلب. يرجى التأكد من الرقم.', 'Order not found. Please check the order ID.'));
        }
      } catch {
        setOrder(null);
        setStatus('error');
        setError(tt('trackingFailed', 'فشل تتبع الطلب. حاول مرة أخرى.', 'Failed to fetch order tracking. Please try again.'));
      }
    },
    [tt]
  );

  // ✅ Auto-fill + Auto-track إذا جاي من رابط
  useEffect(() => {
    if (!queryOrderId) return;
    setOrderId(queryOrderId);
    trackById(queryOrderId);
  }, [queryOrderId, trackById]);

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    await trackById(orderId);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast?.(tt('copied', 'تم النسخ', 'Copied'), 'success');
    } catch {
      showToast?.(tt('copyFailed', 'تعذر النسخ', 'Copy failed'), 'error');
    }
  };

  const seoTitle = useMemo(() => tt('trackOrder', 'تتبع الطلب', 'Track Order'), [tt]);
  const orderNote = useMemo(() => safeText((order as any)?.note), [order]);

  return (
    <div className="min-h-screen bg-slate-50 py-12 lg:py-16">
      <SEO title={seoTitle} />
      <div className="container mx-auto px-4 max-w-2xl">
        <h1 className="text-3xl font-heading font-extrabold text-center mb-8 text-slate-900">
          {tt('trackYourOrder', 'تتبع طلبك', 'Track your order')}
        </h1>

        {/* Search Card */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-200/60 mb-8 animate-in fade-in zoom-in duration-300">
          <form onSubmit={handleTrack} className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1 group">
              {/* 🌍 استخدام start-4 بدلاً من isRTL ? right : left */}
              <span className="absolute inset-y-0 start-4 flex items-center text-slate-400 group-focus-within:text-secondary-DEFAULT transition-colors">
                <Search size={18} strokeWidth={2.5} />
              </span>

              {/* 🌍 استخدام ps-12 pe-4 للـ Padding المتجاوب مع الاتجاه */}
              <input
                type="text"
                inputMode="text"
                placeholder={tt('enterOrderId', 'أدخل رقم الطلب هنا...', 'Enter your order ID...')}
                value={orderId}
                onChange={(e) => setOrderId(sanitizeOrderId(e.target.value))}
                className="w-full py-3.5 ps-11 pe-4 bg-slate-50 rounded-2xl border border-slate-200 focus:bg-white focus:ring-2 focus:ring-secondary-DEFAULT/50 outline-none transition-all font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-400"
                aria-label={tt('enterOrderId', 'أدخل رقم الطلب', 'Enter order ID')}
                dir="ltr" // يفضل إدخال رقم الطلب من اليسار لليمين دائماً
              />
            </div>

            <Button type="submit" isLoading={status === 'loading'} disabled={!sanitizeOrderId(orderId)} className="px-8 shadow-md">
              {tt('track', 'تتبع', 'Track')}
            </Button>
          </form>

          {status === 'error' && (
            <div className="mt-5 flex items-start gap-2.5 text-red-700 bg-red-50 border border-red-100 p-4 rounded-2xl animate-in slide-in-from-top-2">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <p className="text-sm font-bold leading-relaxed">{error}</p>
            </div>
          )}

          {status === 'idle' && !queryOrderId && (
            <p className="mt-5 text-sm font-medium text-slate-500 text-center">
              {tt('trackHint', 'أدخل رقم الطلب في الحقل أعلاه ثم اضغط "تتبع" لمعرفة حالة طلبك.', 'Enter your order ID above then press "Track" to see its status.')}
            </p>
          )}
        </div>

        {/* Result */}
        {status === 'success' && order && (
          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-lg border border-slate-200/60 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-10 pb-6 border-b border-slate-100">
              <div className="w-full">
                <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{tt('orderNumber', 'رقم الطلب', 'Order number')}</p>
                <div className="flex items-center justify-between sm:justify-start gap-4">
                  <p className="font-black text-xl text-slate-900 break-all" dir="ltr">{(order as any).id}</p>

                  <button
                    onClick={() => copyText(String((order as any).id))}
                    className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-50 border border-slate-200 hover:bg-slate-100 px-3 py-1.5 rounded-xl transition-colors shrink-0"
                    type="button"
                    title={tt('copy', 'نسخ', 'Copy')}
                  >
                    <Copy size={14} /> {tt('copy', 'نسخ', 'Copy')}
                  </button>
                </div>
              </div>

              <div className="text-start sm:text-end w-full sm:w-auto shrink-0">
                <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{tt('orderDate', 'تاريخ الطلب', 'Order date')}</p>
                <p className="font-bold text-slate-800" dir="ltr">{safeText((order as any).date)}</p>
              </div>
            </div>

            {/* Progress */}
            <div className="relative flex justify-between px-2 sm:px-4 mb-12">
              <div className="absolute top-5 start-0 w-full h-1.5 bg-slate-100 -z-0 rounded-full" />

              {/* 🌍 استخدام start-0 لشريط التقدم لكي يملأ من الجهة الصحيحة بناءً على اللغة */}
              <div
                className="absolute top-5 h-1.5 bg-green-500 transition-all duration-1000 ease-out -z-0 rounded-full start-0"
                style={{ width: `${progressPct}%` }}
              />

              {steps.map((step, idx) => {
                const currentIdx = getCurrentStepIndex((order as any).status);
                const isCompleted = idx <= currentIdx;
                const Icon = isCompleted ? CheckCircle : step.icon;

                return (
                  <div key={step.status} className="flex flex-col items-center relative z-10">
                    <div
                      className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-500 border-4 border-white shadow-sm ${
                        isCompleted ? 'bg-green-500 text-white scale-110' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      <Icon size={18} strokeWidth={isCompleted ? 2.5 : 2} />
                    </div>
                    <span className={`mt-3 text-xs font-extrabold transition-colors duration-500 ${isCompleted ? 'text-green-700' : 'text-slate-400'}`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Items Summary */}
            <div className="mt-8 bg-slate-50 p-5 rounded-2xl border border-slate-100 shadow-inner">
              <h3 className="font-extrabold text-sm mb-4 text-slate-900">{tt('orderSummary', 'ملخص الطلب', 'Order summary')}</h3>

              <div className="space-y-3">
                {(order as any).items.map((item: any, i: number) => {
                  const title = typeof getProductTitle === 'function' ? getProductTitle(item) || item.name : item.name;

                  return (
                    <div key={i} className="flex justify-between items-center text-sm text-slate-700 gap-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-md text-xs" dir="ltr">
                          x{item.quantity}
                        </span>
                        <span className="font-semibold line-clamp-1">{title}</span>
                      </div>
                      <span className="font-bold text-slate-900 whitespace-nowrap" dir="ltr">
                        {formatMoney(item.price * item.quantity)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-200/80 flex justify-between items-center">
                <span className="font-extrabold text-slate-600">{tt('total', 'الإجمالي', 'Total')}</span>
                <span className="font-black text-lg text-slate-900" dir="ltr">{formatMoney((order as any).total)}</span>
              </div>
            </div>

            {/* Order Note */}
            {orderNote && (
              <div className="mt-5 rounded-2xl border border-yellow-200/60 bg-yellow-50/50 p-5">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 text-yellow-800">
                    <StickyNote size={18} className="text-yellow-600 shrink-0" />
                    <p className="text-sm font-extrabold">{tt('orderNote', 'ملاحظة الطلب', 'Order note')}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => copyText(orderNote)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-yellow-700 hover:text-yellow-900 bg-yellow-100/50 hover:bg-yellow-200 px-2.5 py-1.5 rounded-lg transition-colors shrink-0"
                    title={tt('copy', 'نسخ', 'Copy')}
                  >
                    <Copy size={14} /> {tt('copy', 'نسخ', 'Copy')}
                  </button>
                </div>

                <p className="text-sm font-medium text-yellow-900/80 leading-relaxed whitespace-pre-wrap break-words">
                  {orderNote}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <Button
                variant="outline"
                className="flex-1 py-3.5 flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 border-slate-200"
                onClick={() => trackById((order as any).id)}
                disabled={status === 'loading'}
                type="button"
              >
                <RefreshCw size={18} className={status === 'loading' ? 'animate-spin' : ''} />
                {tt('refreshStatus', 'تحديث الحالة', 'Refresh status')}
              </Button>

              <Button className="flex-1 py-3.5 shadow-md" onClick={() => navigate('/')} type="button">
                {tt('backToHome', 'العودة للرئيسية', 'Back to home')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderTracking;