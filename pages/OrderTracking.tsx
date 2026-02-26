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

  const isRTL = useMemo(() => (language ?? 'ar') === 'ar', [language]);

  const moneyFmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(isRTL ? 'ar-JO' : 'en-JO', {
        style: 'currency',
        currency: 'JOD',
        maximumFractionDigits: 2,
      });
    } catch {
      return null;
    }
  }, [isRTL]);

  const formatMoney = useCallback(
    (n?: number) => {
      const x = typeof n === 'number' && Number.isFinite(n) ? n : 0;
      return moneyFmt ? moneyFmt.format(x) : `JOD ${x.toFixed(2)}`;
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

  // ✅ خطوات الشحن (حالة الطلب)
  const steps = useMemo(
    () => [
      { status: 'processing', label: t('processing') ?? 'Processing', icon: Package },
      { status: 'shipped', label: t('shipped') ?? 'Shipped', icon: Truck },
      { status: 'delivered', label: t('delivered') ?? 'Delivered', icon: MapPin },
    ],
    [t]
  );

  const getCurrentStepIndex = useCallback(
    (s: string) => {
      const idx = steps.findIndex((x) => x.status === s);
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
        setError(t('orderIdError') ?? 'Please enter a valid order ID.');
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
          setError(t('orderIdError') ?? 'Order not found. Please check the order ID.');
        }
      } catch {
        setOrder(null);
        setStatus('error');
        setError(t('trackingFailed') ?? 'Failed to fetch order. Please try again.');
      }
    },
    [t]
  );

  // ✅ Auto-fill + Auto-track إذا جاي من OrderSuccess
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
      showToast?.(t('copied') ?? 'Copied', 'success');
    } catch {
      showToast?.(t('copyFailed') ?? 'Copy failed', 'error');
    }
  };

  // ✅ Title SEO
  const seoTitle = useMemo(() => t('trackOrder') ?? 'Track Order', [t]);

  const orderNote = useMemo(() => safeText((order as any)?.note), [order]);

  return (
    <div className="min-h-screen bg-slate-50 py-12">
      <SEO title={seoTitle} />
      <div className="container mx-auto px-4 max-w-2xl">
        <h1 className="text-3xl font-heading font-bold text-center mb-8 text-slate-900">
          {t('trackOrder') ?? 'Track your order'}
        </h1>

        {/* Search Card */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-100 mb-8">
          <form onSubmit={handleTrack} className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <span className={`absolute inset-y-0 flex items-center text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`}>
                <Search size={18} />
              </span>

              <input
                type="text"
                inputMode="text"
                placeholder={t('enterOrderId') ?? 'Enter order ID'}
                value={orderId}
                onChange={(e) => setOrderId(sanitizeOrderId(e.target.value))}
                className={`w-full py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-secondary-DEFAULT outline-none ${
                  isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'
                }`}
                aria-label="Order ID"
              />
            </div>

            <Button type="submit" isLoading={status === 'loading'} disabled={!sanitizeOrderId(orderId)}>
              {t('track') ?? 'Track'}
            </Button>
          </form>

          {status === 'error' && (
            <div className="mt-4 flex items-start gap-2 text-red-700 bg-red-50 border border-red-100 p-3 rounded-2xl">
              <AlertTriangle size={18} className="mt-0.5" />
              <p className="text-sm font-semibold">{error}</p>
            </div>
          )}

          {status === 'idle' && !queryOrderId && (
            <p className="mt-4 text-sm text-slate-500">
              {t('trackHint') ?? `Enter your order ID then press "${t('track') ?? 'Track'}".`}
            </p>
          )}
        </div>

        {/* Result */}
        {status === 'success' && order && (
          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-lg border border-slate-100 animate-in fade-in slide-in-from-bottom-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-8 pb-6 border-b border-slate-100">
              <div className="w-full">
                <p className="text-slate-500 text-sm">{t('orderNumber') ?? 'Order number'}</p>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-bold text-xl text-slate-900">{(order as any).id}</p>

                  <button
                    onClick={() => copyText(String((order as any).id))}
                    className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-50 border border-slate-200 px-3 py-2 rounded-2xl transition"
                    type="button"
                    aria-label="Copy order id"
                    title={t('copy') ?? 'Copy'}
                  >
                    <Copy size={14} /> {t('copy') ?? 'Copy'}
                  </button>
                </div>
              </div>

              <div className={`${isRTL ? 'text-right' : 'text-left'} w-full sm:w-auto`}>
                <p className="text-slate-500 text-sm">{t('orderDate') ?? 'Order date'}</p>
                <p className="font-bold text-slate-900">{safeText((order as any).date)}</p>
              </div>
            </div>

            {/* Progress */}
            <div className="relative flex justify-between">
              <div className="absolute top-5 left-0 w-full h-1 bg-slate-100 -z-0 rounded-full"></div>

              {/* ✅ RTL/LTR progress */}
              <div
                className={`absolute top-5 h-1 bg-green-500 transition-all duration-700 -z-0 rounded-full ${
                  isRTL ? 'right-0' : 'left-0'
                }`}
                style={{ width: `${progressPct}%` }}
              />

              {steps.map((step, idx) => {
                const currentIdx = getCurrentStepIndex((order as any).status);
                const isCompleted = idx <= currentIdx;
                const Icon = isCompleted ? CheckCircle : step.icon;

                return (
                  <div key={step.status} className="flex flex-col items-center relative z-10">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-500 border-4 border-white ${
                        isCompleted ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-400'
                      }`}
                    >
                      <Icon size={18} />
                    </div>
                    <span className={`mt-2 text-xs font-bold ${isCompleted ? 'text-green-700' : 'text-slate-400'}`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Items */}
            <div className="mt-8 bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <h3 className="font-bold text-sm mb-3 text-slate-900">{t('orderSummary') ?? 'Order summary'}</h3>

              <div className="space-y-2">
                {(order as any).items.map((item: any, i: number) => {
                  const title =
                    typeof getProductTitle === 'function'
                      ? getProductTitle(item) || item.name
                      : item.name;

                  return (
                    <div key={i} className="flex justify-between text-sm text-slate-700 gap-3">
                      <span className="line-clamp-1">
                        {item.quantity}× {title}
                      </span>
                      <span className="font-semibold whitespace-nowrap">{formatMoney(item.price * item.quantity)}</span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 pt-3 border-t border-slate-200 flex justify-between font-bold text-slate-900">
                <span>{t('total') ?? 'Total'}</span>
                <span>{formatMoney((order as any).total)}</span>
              </div>
            </div>

            {/* ✅ Order Note (رسمي) */}
            {orderNote && (
              <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-slate-800">
                    <StickyNote size={16} className="text-secondary-DEFAULT" />
                    <p className="text-sm font-bold">{t('orderNote') ?? 'Order note'}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => copyText(orderNote)}
                    className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-3 py-2 rounded-2xl transition"
                    aria-label="Copy order note"
                    title={t('copy') ?? 'Copy'}
                  >
                    <Copy size={14} /> {t('copy') ?? 'Copy'}
                  </button>
                </div>

                <div className="mt-3 rounded-2xl bg-white border border-slate-100 p-3 max-h-44 overflow-auto">
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                    {orderNote}
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                className="w-full flex items-center justify-center gap-2"
                onClick={() => trackById((order as any).id)}
                disabled={status === 'loading'}
                type="button"
              >
                <RefreshCw size={16} />
                {t('refreshStatus') ?? 'Refresh status'}
              </Button>

              <Button className="w-full" onClick={() => navigate('/')} type="button">
                {t('backToHome') ?? 'Back to home'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderTracking;