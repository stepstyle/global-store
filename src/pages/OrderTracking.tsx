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
  StickyNote,
  Home
} from 'lucide-react';
import { Order } from '../types';
import { useCart } from '../App';
import { db } from '../services/storage';
import SEO from '../components/SEO';

const { useLocation, useNavigate } = ReactRouterDOM as any;

type Status = 'idle' | 'loading' | 'success' | 'error';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const sanitizeOrderId = (raw: string) => {
  const s = String(raw ?? '').trim();
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
    <div className="min-h-screen bg-slate-50 py-12 lg:py-20 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-sky-200/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-slate-200/40 rounded-full blur-3xl pointer-events-none" />

      <SEO title={seoTitle} />
      
      <div className="container mx-auto px-4 max-w-2xl relative z-10">
        <h1 className="text-3xl md:text-4xl font-heading font-black text-center mb-8 text-slate-900 tracking-tight">
          {tt('trackYourOrder', 'تتبع طلبك', 'Track your order')}
        </h1>

        {/* Search Card */}
        <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-xl shadow-slate-200/40 border border-slate-100 mb-8 animate-in fade-in zoom-in-95 duration-500">
          <form onSubmit={handleTrack} className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1 group">
              <span className="absolute inset-y-0 start-4 flex items-center text-slate-400 group-focus-within:text-sky-500 transition-colors">
                <Search size={20} strokeWidth={2.5} />
              </span>

              <input
                type="text"
                inputMode="text"
                placeholder={tt('enterOrderId', 'أدخل رقم الطلب هنا...', 'Enter your order ID...')}
                value={orderId}
                onChange={(e) => setOrderId(sanitizeOrderId(e.target.value))}
                className="w-full py-4 ps-12 pe-4 bg-slate-50 rounded-2xl border border-slate-200 focus:bg-white focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400 outline-none transition-all font-bold text-slate-800 placeholder:font-medium placeholder:text-slate-400"
                aria-label={tt('enterOrderId', 'أدخل رقم الطلب', 'Enter order ID')}
                dir="ltr"
              />
            </div>

            <button 
              type="submit" 
              disabled={!sanitizeOrderId(orderId) || status === 'loading'} 
              className="px-8 py-4 bg-black hover:bg-slate-800 text-white font-extrabold rounded-2xl shadow-lg shadow-black/20 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {status === 'loading' && <RefreshCw size={18} className="animate-spin" />}
              {tt('track', 'تتبع', 'Track')}
            </button>
          </form>

          {status === 'error' && (
            <div className="mt-5 flex items-start gap-3 text-red-600 bg-red-50 border border-red-100 p-4 rounded-2xl animate-in slide-in-from-top-2">
              <AlertTriangle size={20} className="shrink-0 mt-0.5" />
              <p className="text-sm font-bold leading-relaxed">{error}</p>
            </div>
          )}

          {status === 'idle' && !queryOrderId && (
            <div className="mt-6 flex flex-col items-center justify-center text-center p-6 bg-slate-50 border border-slate-100 border-dashed rounded-2xl">
              <Package size={40} className="text-slate-300 mb-3" />
              <p className="text-sm font-bold text-slate-500 max-w-xs">
                {tt('trackHint', 'أدخل رقم الطلب في الحقل أعلاه ثم اضغط "تتبع" لمعرفة حالة طلبك وتاريخ الوصول المتوقع.', 'Enter your order ID above then press "Track" to see its status.')}
              </p>
            </div>
          )}
        </div>

        {/* Result */}
        {status === 'success' && order && (
          <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-xl shadow-slate-200/40 border border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-hidden relative">
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-10 pb-6 border-b border-slate-100">
              <div className="w-full">
                <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-1.5">{tt('orderNumber', 'رقم الطلب', 'Order number')}</p>
                <div className="flex items-center justify-between sm:justify-start gap-4">
                  <p className="font-black text-2xl text-slate-900 break-all" dir="ltr">#{(order as any).id}</p>

                  <button
                    onClick={() => copyText(String((order as any).id))}
                    className="inline-flex items-center gap-2 text-xs font-bold text-sky-600 hover:text-sky-700 bg-sky-50 border border-sky-100 hover:bg-sky-100 px-3 py-1.5 rounded-xl transition-colors shrink-0"
                    type="button"
                    title={tt('copy', 'نسخ', 'Copy')}
                  >
                    <Copy size={14} /> {tt('copy', 'نسخ', 'Copy')}
                  </button>
                </div>
              </div>

              <div className="text-start sm:text-end w-full sm:w-auto shrink-0 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">{tt('orderDate', 'تاريخ الطلب', 'Order date')}</p>
                <p className="font-extrabold text-slate-800 text-sm" dir="ltr">{safeText((order as any).date)}</p>
              </div>
            </div>

            {/* Progress */}
            <div className="relative flex justify-between px-2 sm:px-6 mb-12">
              <div className="absolute top-5 start-0 w-full h-2 bg-slate-100 -z-0 rounded-full" />

              {/* شريط التقدم باللون الأزرق الفاتح */}
              <div
                className="absolute top-5 h-2 bg-sky-400 transition-all duration-1000 ease-out -z-0 rounded-full start-0 shadow-[0_0_10px_rgba(56,189,248,0.5)]"
                style={{ width: `${progressPct}%` }}
              />

              {steps.map((step, idx) => {
                const currentIdx = getCurrentStepIndex((order as any).status);
                const isCompleted = idx <= currentIdx;
                const isCurrent = idx === currentIdx;
                const Icon = isCompleted ? CheckCircle : step.icon;

                return (
                  <div key={step.status} className="flex flex-col items-center relative z-10 group">
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500 border-4 border-white ${
                        isCompleted 
                          ? 'bg-sky-400 text-white shadow-lg shadow-sky-400/30 scale-110' 
                          : 'bg-slate-100 text-slate-300'
                      } ${isCurrent ? 'ring-4 ring-sky-100' : ''}`}
                    >
                      <Icon size={20} strokeWidth={isCompleted ? 2.5 : 2} className={isCurrent && !isCompleted ? 'animate-pulse text-sky-400' : ''} />
                    </div>
                    <span className={`mt-3 text-xs font-black transition-colors duration-500 text-center ${isCompleted ? 'text-sky-600' : 'text-slate-400'}`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Items Summary */}
            <div className="mt-8 bg-white p-6 rounded-3xl border border-slate-200/70 shadow-sm relative overflow-hidden">
              <div className="absolute left-0 top-0 w-1.5 h-full bg-slate-800" />
              <h3 className="font-black text-sm mb-5 text-slate-900 uppercase tracking-widest">{tt('orderSummary', 'ملخص الطلب', 'Order summary')}</h3>

              <div className="space-y-4">
                {(order as any).items.map((item: any, i: number) => {
                  const title = typeof getProductTitle === 'function' ? getProductTitle(item) || item.name : item.name;

                  return (
                    <div key={i} className="flex justify-between items-center text-sm text-slate-700 gap-4 group">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-extrabold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg text-xs" dir="ltr">
                          x{item.quantity}
                        </span>
                        <span className="font-bold line-clamp-1 group-hover:text-sky-600 transition-colors">{title}</span>
                      </div>
                      <span className="font-black text-slate-900 whitespace-nowrap bg-slate-50 px-2 py-1 rounded-lg" dir="ltr">
                        {formatMoney(item.price * item.quantity)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 pt-5 border-t border-slate-100 flex justify-between items-center">
                <span className="font-black text-slate-400 uppercase tracking-widest text-xs">{tt('total', 'الإجمالي', 'Total')}</span>
                <span className="font-black text-2xl text-sky-500" dir="ltr">{formatMoney((order as any).total)}</span>
              </div>
            </div>

            {/* Order Note */}
            {orderNote && (
              <div className="mt-5 rounded-3xl border border-slate-200/70 bg-white p-6 shadow-sm relative overflow-hidden">
                <div className="absolute left-0 top-0 w-1.5 h-full bg-yellow-400" />
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 text-slate-800">
                    <StickyNote size={18} className="text-yellow-500 shrink-0" />
                    <p className="text-sm font-black uppercase tracking-widest">{tt('orderNote', 'ملاحظة الطلب', 'Order note')}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => copyText(orderNote)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-100 px-3 py-1.5 rounded-xl transition-colors shrink-0"
                    title={tt('copy', 'نسخ', 'Copy')}
                  >
                    <Copy size={14} /> {tt('copy', 'نسخ', 'Copy')}
                  </button>
                </div>

                <p className="text-sm font-semibold text-slate-600 leading-relaxed whitespace-pre-wrap break-words bg-slate-50 p-4 rounded-2xl">
                  {orderNote}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <button
                className="flex-1 py-4 flex items-center justify-center gap-2 bg-black hover:bg-slate-800 text-white font-extrabold rounded-2xl transition-all shadow-md shadow-black/20 disabled:opacity-50"
                onClick={() => trackById((order as any).id)}
                disabled={status === 'loading'}
                type="button"
              >
                <RefreshCw size={18} className={status === 'loading' ? 'animate-spin' : ''} />
                {tt('refreshStatus', 'تحديث الحالة', 'Refresh status')}
              </button>

              <button 
                className="flex-1 py-4 bg-sky-400 hover:bg-sky-500 text-white font-extrabold rounded-2xl shadow-lg shadow-sky-400/30 transition-all flex items-center justify-center gap-2" 
                onClick={() => navigate('/')} 
                type="button"
              >
                <Home size={18} />
                {tt('backToHome', 'العودة للرئيسية', 'Back to home')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderTracking;