// src/pages/MyOrders.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Package, Calendar, MapPin, DollarSign, Truck, ChevronRight, StickyNote, ShoppingBag } from 'lucide-react';
import { useCart } from '../App';
import { db } from '../services/storage';
import { Order } from '../types';
import SEO from '../components/SEO';
import * as ReactRouterDOM from 'react-router-dom';
import LazyImage from '../components/LazyImage';
import { OrderSkeleton } from '../components/Skeleton';

const { Link } = ReactRouterDOM as any;

const safeText = (v: any) => String(v ?? '').trim();

// 🔒 إخفاء رقم الهاتف بشكل آمن واحترافي (Enterprise Standard)
const maskPhone = (phone?: string) => {
  const p = safeText(phone);
  if (p.length < 6) return p;
  return `${p.slice(0, 4)} •••• ${p.slice(-3)}`;
};

// 🎨 ألوان حالات الطلب (متوافقة مع التصميم الحديث الراقي)
const statusBadge = (status?: string) => {
  const s = safeText(status);
  if (s === 'delivered') return 'bg-emerald-50 text-emerald-600 border-emerald-100';
  if (s === 'shipped') return 'bg-sky-50 text-sky-600 border-sky-100';
  if (s === 'cancelled') return 'bg-red-50 text-red-600 border-red-100';
  return 'bg-orange-50 text-orange-600 border-orange-100'; // processing / new
};

const NOTE_PREVIEW_CHARS = 140;

const MyOrders: React.FC = () => {
  const { user, t, language } = useCart() as any;

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // Toggle note "show more" per order id
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});

  const isAR = language === 'ar';
  const tr = useCallback((ar: string, en: string) => (isAR ? ar : en), [isAR]);

  // ✅ t with safe bilingual fallback (Corporate Tone)
  const tt = useCallback(
    (key: string, fallbackAr: string, fallbackEn: string) => {
      const v = t?.(key);
      if (!v || v === key) return tr(fallbackAr, fallbackEn);
      return String(v);
    },
    [t, tr]
  );

  // 📅 تنسيق ذكي ومحلي للتاريخ (Smart Date Formatting)
  const formatDate = useCallback((dateStr?: string) => {
    const raw = safeText(dateStr);
    if (!raw) return '—';
    try {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return raw; // Fallback إذا كان النص غير صالح كـ تاريخ
      return new Intl.DateTimeFormat(isAR ? 'ar-JO' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }).format(d);
    } catch {
      return raw;
    }
  }, [isAR]);

  // ✅ Status label translation (Refined Terminology)
  const statusLabel = useCallback(
    (status?: string) => {
      const s = safeText(status);
      if (s === 'processing' || s === 'new') return tt('processing', 'جاري التجهيز', 'Preparing');
      if (s === 'shipped') return tt('shipped', 'في الطريق إليك', 'On the way');
      if (s === 'delivered') return tt('delivered', 'تم التوصيل', 'Delivered');
      if (s === 'cancelled') return tt('cancelled', 'أُلغي الطلب', 'Cancelled');
      return s || '—';
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

  const money = useCallback((n?: number) => {
    const x = typeof n === 'number' ? n : 0;
    return fmt ? fmt.format(x) : `${x.toFixed(2)} JOD`;
  }, [fmt]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setIsLoading(true);
      setErrorMsg('');

      try {
        if (!user?.id) {
          setOrders([]);
          setIsLoading(false);
          return;
        }

        const data = await db.orders.getByUserId(user.id);
        if (cancelled) return;

        const sorted = (data || []).sort(
          (a: any, b: any) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime()
        );

        setOrders(sorted);
      } catch {
        if (cancelled) return;
        setErrorMsg(tt('loadFailed', 'تعذر استرداد سجل الطلبات. يرجى المحاولة لاحقاً.', 'Unable to retrieve order history. Please try again later.'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [user, tt]);

  const toggleNote = (orderId: string) => {
    setExpandedNotes((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  };

  // ==========================================
  // 🔒 حالة عدم تسجيل الدخول (Unauthenticated)
  // ==========================================
  if (!user) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-4 bg-slate-50 py-12">
        <SEO title={tt('myOrders', 'سجل الطلبات', 'Order History')} noIndex={true} />
        <div className="w-full max-w-md bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/40 p-8 sm:p-10 text-center animate-in fade-in zoom-in-95 duration-500">
          <div className="mx-auto w-20 h-20 rounded-full bg-sky-50 flex items-center justify-center text-sky-500 mb-6 shadow-inner">
            <Package size={40} strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-heading font-black mb-3 text-slate-900 tracking-tight">
            {tt('loginRequired', 'يتطلب تسجيل الدخول', 'Sign In Required')}
          </h2>
          <p className="text-slate-500 mb-8 text-sm font-medium leading-relaxed">
            {tt('loginToSeeOrders', 'يرجى تسجيل الدخول للوصول إلى سجل طلباتك وتتبع شحناتك بأمان.', 'Please sign in to access your order history and track your shipments securely.')}
          </p>
          <Link to="/login" className="block w-full">
            <button className="w-full py-4 rounded-2xl bg-sky-400 hover:bg-sky-500 text-white font-extrabold shadow-lg shadow-sky-400/30 transition-all duration-300">
              {tt('login', 'تسجيل الدخول', 'Sign In')}
            </button>
          </Link>
        </div>
      </div>
    );
  }

  // ==========================================
  // 📦 صفحة الطلبات الأساسية
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-50 py-10 lg:py-16">
      <SEO title={tt('myOrders', 'سجل الطلبات', 'Order History')} noIndex={true} />
      <div className="container mx-auto px-4 lg:px-8 max-w-5xl">
        
        {/* رأس الصفحة */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
          <div>
            <h1 className="text-3xl md:text-4xl font-heading font-black text-slate-900 tracking-tight">
              {tt('myOrders', 'سجل الطلبات', 'Order History')}
            </h1>
            <p className="text-slate-500 mt-2 text-sm font-medium">
              {tt('myOrdersHint', 'تتبع حالة طلباتك الحالية وراجع مشترياتك السابقة.', 'Track current orders and review your past purchases.')}
            </p>
          </div>
          <Link to="/shop" className="inline-flex items-center gap-1.5 text-sm font-extrabold text-sky-500 hover:text-sky-600 transition-colors group bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md">
            {tt('continueShopping', 'متابعة التسوق', 'Continue shopping')}
            <ChevronRight size={16} className="rtl:rotate-180 ltr:rotate-0 mt-0.5 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
          </Link>
        </div>

        {/* الحالات (Loading / Error / Empty / Data) */}
        {isLoading ? (
          <div className="space-y-6">
            {[...Array(3)].map((_, i) => <OrderSkeleton key={i} />)}
          </div>
        ) : errorMsg ? (
          <div className="bg-white rounded-[2rem] p-10 text-center border border-slate-100 shadow-sm animate-in fade-in">
            <p className="text-red-600 font-bold mb-6">{errorMsg}</p>
            <button onClick={() => window.location.reload()} className="px-8 py-3.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-all">
              {tt('retry', 'إعادة المحاولة', 'Retry')}
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-[2rem] p-12 sm:p-16 text-center border border-slate-100 shadow-xl shadow-slate-200/40 animate-in fade-in zoom-in-95">
            <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <ShoppingBag size={48} className="text-slate-300" strokeWidth={1.5} />
            </div>
            <h3 className="text-2xl font-black text-slate-900 mb-3 tracking-tight">
              {tt('noOrders', 'لا توجد طلبات سابقة', 'No order history')}
            </h3>
            <p className="text-slate-500 text-sm font-medium mb-8 max-w-sm mx-auto leading-relaxed">
              {tt('noOrdersHint', 'لم تقم بإجراء أي عمليات شراء بعد. تصفح تشكيلتنا وابدأ بتسوق ما يناسبك.', "You haven't made any purchases yet. Browse our collections and find what you love.")}
            </p>
            <Link to="/shop">
              <button className="px-10 py-4 rounded-2xl bg-black hover:bg-slate-800 text-white font-extrabold shadow-lg shadow-black/20 transition-all duration-300">
                {tt('startShopping', 'استكشف المتجر', 'Explore Store')}
              </button>
            </Link>
          </div>
        ) : (
          <div className="space-y-6 md:space-y-8">
            {orders.map((order: any) => {
              const itemsCount = (order.items || []).reduce((sum: number, it: any) => sum + (it.quantity || 0), 0);
              const firstItems = (order.items || []).slice(0, 3);
              const note = safeText(order.note);
              const isExpanded = !!expandedNotes[safeText(order.id)];
              const noteNeedsToggle = note.length > NOTE_PREVIEW_CHARS;
              const notePreview = noteNeedsToggle ? `${note.slice(0, NOTE_PREVIEW_CHARS)}…` : note;

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-[2rem] p-6 sm:p-8 border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-500 animate-in fade-in slide-in-from-bottom-4 group/card relative overflow-hidden"
                >
                  {/* شريط زينة جانبي مخفي يظهر عند التمرير */}
                  <div className="absolute ltr:left-0 rtl:right-0 top-0 w-1.5 h-0 bg-sky-400 group-hover/card:h-full transition-all duration-500 ease-out" />

                  {/* === Header (Order ID & Status) === */}
                  <div className="flex flex-col md:flex-row justify-between md:items-start mb-6 gap-5 border-b border-slate-100 pb-6">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 mb-3.5 flex-wrap">
                        {/* 🌍 استخدام dir="ltr" لضمان قراءة رقم الطلب بشكل صحيح */}
                        <span className="font-black text-2xl text-slate-900 tracking-tight" dir="ltr">
                          #{safeText(order.id)}
                        </span>

                        <span className={`px-3 py-1.5 rounded-lg border text-xs font-black uppercase tracking-widest ${statusBadge(order.status)}`}>
                          {statusLabel(order.status)}
                        </span>

                        <span className="text-xs bg-slate-50 border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg font-bold">
                          {itemsCount} {tt('items', 'منتجات', 'items')}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-sm font-semibold text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1.5">
                          <Calendar size={16} className="text-slate-400" />
                          <span dir="ltr">{formatDate(order.createdAt || order.date)}</span>
                        </span>
                        <span className="hidden sm:inline-block w-1.5 h-1.5 bg-slate-200 rounded-full" />
                        <span className="flex items-center gap-1.5">
                          <DollarSign size={16} className="text-slate-400" /> 
                          {/* 🌍 استخدام dir="ltr" للسعر */}
                          <span className="font-extrabold text-slate-800" dir="ltr">{money(order.total)}</span>
                        </span>
                        <span className="hidden sm:inline-block w-1.5 h-1.5 bg-slate-200 rounded-full" />
                        <span className="flex items-center gap-1.5">
                          <Truck size={16} className="text-slate-400" /> {safeText(order.shippingMethod) || tt('shipping', 'الشحن', 'Shipping')}
                        </span>
                      </div>
                    </div>

                    {/* Track Button */}
                    <Link to={`/tracking?orderId=${encodeURIComponent(safeText(order.id))}`} className="shrink-0 w-full md:w-auto">
                      <button className="w-full md:w-auto flex items-center justify-center gap-2 rounded-xl shadow-md shadow-black/10 bg-black hover:bg-slate-800 text-white font-extrabold px-6 py-3.5 transition-all">
                        {tt('track', 'تتبع مسار الطلب', 'Track Shipment')}
                        <ChevronRight size={18} className="rtl:rotate-180 ltr:rotate-0" />
                      </button>
                    </Link>
                  </div>

                  {/* === Order Note === */}
                  {note && (
                    <div className="mb-8 rounded-2xl bg-slate-50 border border-slate-100 p-5 relative overflow-hidden">
                      <div className="absolute ltr:left-0 rtl:right-0 top-0 w-1.5 h-full bg-sky-400" />
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 text-slate-800">
                          <StickyNote size={18} className="text-slate-400" />
                          <p className="text-sm font-black uppercase tracking-widest">{tt('orderNote', 'ملاحظات إضافية', 'Additional notes')}</p>
                        </div>

                        {noteNeedsToggle && (
                          <button
                            type="button"
                            onClick={() => toggleNote(safeText(order.id))}
                            className="text-xs font-bold text-sky-600 hover:text-sky-700 transition whitespace-nowrap bg-sky-50 px-3 py-1.5 rounded-lg border border-sky-100"
                          >
                            {isExpanded ? tt('showLess', 'عرض أقل', 'Show less') : tt('showMore', 'قراءة المزيد', 'Read more')}
                          </button>
                        )}
                      </div>
                      <p className="mt-3 text-sm text-slate-600 font-medium leading-relaxed whitespace-pre-wrap break-words">
                        {isExpanded ? note : notePreview}
                      </p>
                    </div>
                  )}

                  {/* === Items & Address Grid === */}
                  <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
                    {/* Items List */}
                    <div className="flex-1 space-y-4">
                      {firstItems.map((item: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-4 group">
                          <LazyImage
                            src={item.image}
                            alt={safeText(item.name)}
                            className="w-16 h-16 rounded-2xl object-cover border border-slate-100 group-hover:border-sky-200 transition-colors"
                            containerClassName="w-16 h-16 shrink-0 bg-slate-50 rounded-2xl"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-sm text-slate-800 line-clamp-1 group-hover:text-sky-600 transition-colors">{safeText(item.name)}</p>
                            <div className="flex items-center justify-between mt-1.5 text-xs font-semibold text-slate-500">
                              <span dir="ltr" className="bg-slate-100 px-2 py-0.5 rounded-md text-slate-600">x{item.quantity}</span>
                              <span className="font-black text-slate-900" dir="ltr">{money(item.price)}</span>
                            </div>
                          </div>
                        </div>
                      ))}

                      {(order.items || []).length > 3 && (
                        <div className="pt-3 border-t border-slate-100">
                          <Link to={`/tracking?orderId=${encodeURIComponent(safeText(order.id))}`} className="text-xs font-black text-sky-500 hover:text-sky-600 hover:underline transition-colors">
                            + {(order.items || []).length - 3} {tt('moreItems', 'عناصر أخرى (انقر للتفاصيل)', 'more items (click for details)')}
                          </Link>
                        </div>
                      )}
                    </div>

                    {/* Shipping Address Card */}
                    <div className="lg:w-80 bg-white rounded-3xl p-6 text-sm h-fit border border-slate-200/80 shadow-sm relative overflow-hidden group">
                      <div className="absolute left-0 top-0 w-full h-1 bg-slate-200 group-hover:bg-slate-800 transition-colors" />
                      <p className="font-black text-slate-400 text-xs uppercase tracking-widest mb-4 flex items-center gap-2">
                        <MapPin size={16} className="text-sky-500" /> {tt('shippingAddress', 'عنوان التوصيل', 'Delivery Address')}
                      </p>
                      <div className="space-y-1.5 text-slate-600 font-medium leading-relaxed">
                        <p className="font-black text-slate-900 text-base">{safeText(order.address?.fullName) || '—'}</p>
                        <p>{safeText(order.address?.city) || '—'}, {safeText(order.address?.street) || '—'}</p>
                        {/* 🌍 استخدام dir="ltr" لرقم الهاتف لضمان ظهور الـ + والمفاتيح بشكل سليم */}
                        <p className="mt-3 font-extrabold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl inline-block" dir="ltr">{maskPhone(order.address?.phone)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyOrders;