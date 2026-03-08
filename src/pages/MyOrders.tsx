// src/pages/MyOrders.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Package, Calendar, MapPin, DollarSign, Truck, ChevronRight, StickyNote, ShoppingBag } from 'lucide-react';
import { useCart } from '../App';
import { db } from '../services/storage';
import { Order } from '../types';
import SEO from '../components/SEO';
import Button from '../components/Button';
import * as ReactRouterDOM from 'react-router-dom';
import LazyImage from '../components/LazyImage';
import { OrderSkeleton } from '../components/Skeleton';

const { Link } = ReactRouterDOM as any;

const safeText = (v: any) => String(v ?? '').trim();

// 🔒 إخفاء رقم الهاتف بشكل آمن
const maskPhone = (phone?: string) => {
  const p = safeText(phone);
  if (p.length < 6) return p;
  return `${p.slice(0, 4)} **** ${p.slice(-3)}`;
};

// 🎨 ألوان حالات الطلب (متوافقة مع التصميم الحديث)
const statusBadge = (status?: string) => {
  const s = safeText(status);
  if (s === 'delivered') return 'bg-green-50 text-green-700 border-green-200';
  if (s === 'shipped') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (s === 'cancelled') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-yellow-50 text-yellow-700 border-yellow-200'; // processing / new
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

  // ✅ t with safe bilingual fallback
  const tt = useCallback(
    (key: string, fallbackAr: string, fallbackEn: string) => {
      const v = t?.(key);
      if (!v || v === key) return tr(fallbackAr, fallbackEn);
      return String(v);
    },
    [t, tr]
  );

  // ✅ Status label translation
  const statusLabel = useCallback(
    (status?: string) => {
      const s = safeText(status);
      if (s === 'processing' || s === 'new') return tt('processing', 'قيد المعالجة', 'Processing');
      if (s === 'shipped') return tt('shipped', 'تم الشحن', 'Shipped');
      if (s === 'delivered') return tt('delivered', 'تم التسليم', 'Delivered');
      if (s === 'cancelled') return tt('cancelled', 'ملغي', 'Cancelled');
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
        setErrorMsg(tt('loadFailed', 'فشل تحميل الطلبات. الرجاء المحاولة مرة أخرى.', 'Failed to load your orders. Please try again.'));
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
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-4 bg-slate-50">
        <SEO title={tt('myOrders', 'طلباتي', 'My Orders')} noIndex={true} />
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center animate-in fade-in zoom-in duration-500">
          <div className="mx-auto w-20 h-20 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mb-6">
            <Package size={40} strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-heading font-extrabold mb-2 text-slate-900">
            {tt('loginRequired', 'تسجيل الدخول مطلوب', 'Login Required')}
          </h2>
          <p className="text-slate-500 mb-8 text-sm leading-relaxed">
            {tt('loginToSeeOrders', 'يرجى تسجيل الدخول لعرض وتتبع طلباتك السابقة.', 'Please login to view and track your previous orders.')}
          </p>
          <Link to="/login" className="block w-full">
            <Button className="w-full py-3.5 rounded-2xl shadow-md">{tt('login', 'تسجيل الدخول', 'Login')}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // ==========================================
  // 📦 صفحة الطلبات الأساسية
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-50 py-10 lg:py-14">
      <SEO title={tt('myOrders', 'طلباتي', 'My Orders')} noIndex={true} />
      <div className="container mx-auto px-4 lg:px-8 max-w-5xl">
        
        {/* رأس الصفحة */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
          <div>
            <h1 className="text-3xl font-heading font-extrabold text-slate-900">
              {tt('myOrders', 'طلباتي', 'My Orders')}
            </h1>
            <p className="text-slate-500 mt-2 text-sm font-medium">
              {tt('myOrdersHint', 'تابع وتصفح مشترياتك السابقة.', 'Track and review your recent purchases.')}
            </p>
          </div>
          <Link to="/shop" className="inline-flex items-center gap-1.5 text-sm font-bold text-secondary-DEFAULT hover:text-secondary-dark transition-colors">
            {tt('continueShopping', 'متابعة التسوق', 'Continue shopping')}
            <ChevronRight size={16} className="rtl:rotate-180 ltr:rotate-0 mt-0.5" />
          </Link>
        </div>

        {/* الحالات (Loading / Error / Empty / Data) */}
        {isLoading ? (
          <div className="space-y-5">
            {[...Array(3)].map((_, i) => <OrderSkeleton key={i} />)}
          </div>
        ) : errorMsg ? (
          <div className="bg-white rounded-3xl p-10 text-center border border-slate-100 shadow-sm animate-in fade-in">
            <p className="text-red-600 font-bold mb-5">{errorMsg}</p>
            <Button onClick={() => window.location.reload()} variant="outline" className="px-8">
              {tt('retry', 'إعادة المحاولة', 'Retry')}
            </Button>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-3xl p-14 text-center border border-slate-100 shadow-sm animate-in fade-in zoom-in">
            <ShoppingBag size={56} className="mx-auto text-slate-300 mb-5" strokeWidth={1.5} />
            <h3 className="text-xl font-extrabold text-slate-800 mb-2">
              {tt('noOrders', 'لا توجد طلبات', 'No orders found')}
            </h3>
            <p className="text-slate-500 text-sm mb-8">
              {tt('noOrdersHint', 'لم تقم بعمل أي طلب حتى الآن. اكتشف منتجاتنا الرائعة!', 'You have not placed any orders yet. Discover our amazing products!')}
            </p>
            <Link to="/shop">
              <Button className="px-8 rounded-full shadow-md">
                {tt('startShopping', 'ابدأ التسوق', 'Start shopping')}
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
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
                  className="bg-white rounded-3xl p-6 lg:p-7 border border-slate-200/60 shadow-sm hover:shadow-lg transition-all duration-300 animate-in fade-in slide-in-from-bottom-4"
                >
                  {/* === Header (Order ID & Status) === */}
                  <div className="flex flex-col md:flex-row justify-between md:items-start mb-6 gap-5 border-b border-slate-100 pb-5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 mb-3 flex-wrap">
                        {/* 🌍 استخدام dir="ltr" لضمان قراءة رقم الطلب بشكل صحيح */}
                        <span className="font-black text-xl text-slate-900 tracking-tight" dir="ltr">
                          #{safeText(order.id)}
                        </span>

                        <span className={`px-3 py-1 rounded-lg border text-xs font-extrabold uppercase tracking-wide ${statusBadge(order.status)}`}>
                          {statusLabel(order.status)}
                        </span>

                        <span className="text-xs bg-slate-100 border border-slate-200 text-slate-600 px-3 py-1 rounded-lg font-bold">
                          {itemsCount} {tt('items', 'منتجات', 'items')}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-sm font-medium text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1.5">
                          <Calendar size={16} className="text-slate-400" />
                          <span dir="ltr">{safeText(order.date) || '—'}</span>
                        </span>
                        <span className="hidden sm:inline-block w-1 h-1 bg-slate-300 rounded-full" />
                        <span className="flex items-center gap-1.5">
                          <DollarSign size={16} className="text-slate-400" /> 
                          {/* 🌍 استخدام dir="ltr" للسعر */}
                          <span className="font-bold text-slate-700" dir="ltr">{money(order.total)}</span>
                        </span>
                        <span className="hidden sm:inline-block w-1 h-1 bg-slate-300 rounded-full" />
                        <span className="flex items-center gap-1.5">
                          <Truck size={16} className="text-slate-400" /> {safeText(order.shippingMethod) || tt('shipping', 'الشحن', 'Shipping')}
                        </span>
                      </div>
                    </div>

                    {/* Track Button */}
                    <Link to={`/tracking?orderId=${encodeURIComponent(safeText(order.id))}`} className="shrink-0">
                      <Button size="sm" className="w-full md:w-auto flex items-center justify-center gap-2 rounded-xl shadow-md bg-slate-900 hover:bg-slate-800 text-white border-none">
                        {tt('track', 'تتبع الطلب', 'Track Order')}
                        <ChevronRight size={16} className="rtl:rotate-180 ltr:rotate-0" />
                      </Button>
                    </Link>
                  </div>

                  {/* === Order Note === */}
                  {note && (
                    <div className="mb-6 rounded-2xl border border-yellow-100 bg-yellow-50/50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 text-yellow-800">
                          <StickyNote size={18} className="text-yellow-600" />
                          <p className="text-sm font-extrabold">{tt('orderNote', 'ملاحظات الطلب', 'Order note')}</p>
                        </div>

                        {noteNeedsToggle && (
                          <button
                            type="button"
                            onClick={() => toggleNote(safeText(order.id))}
                            className="text-xs font-bold text-yellow-700 hover:text-yellow-900 transition whitespace-nowrap bg-yellow-100 px-2 py-1 rounded-md"
                          >
                            {isExpanded ? tt('showLess', 'عرض أقل', 'Show less') : tt('showMore', 'عرض المزيد', 'Show more')}
                          </button>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-yellow-900/80 leading-relaxed whitespace-pre-wrap break-words">
                        {isExpanded ? note : notePreview}
                      </p>
                    </div>
                  )}

                  {/* === Items & Address Grid === */}
                  <div className="flex flex-col lg:flex-row gap-6">
                    {/* Items List */}
                    <div className="flex-1 space-y-4">
                      {firstItems.map((item: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-4">
                          <LazyImage
                            src={item.image}
                            alt={safeText(item.name)}
                            className="w-14 h-14 rounded-xl object-cover border border-slate-100"
                            containerClassName="w-14 h-14 shrink-0 bg-slate-50 rounded-xl"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-extrabold text-sm text-slate-800 line-clamp-1">{safeText(item.name)}</p>
                            <div className="flex items-center justify-between mt-1 text-xs font-medium text-slate-500">
                              <span dir="ltr">x{item.quantity}</span>
                              <span className="font-bold text-slate-700" dir="ltr">{money(item.price)}</span>
                            </div>
                          </div>
                        </div>
                      ))}

                      {(order.items || []).length > 3 && (
                        <div className="pt-2">
                          <Link to={`/tracking?orderId=${encodeURIComponent(safeText(order.id))}`} className="text-xs font-extrabold text-secondary-DEFAULT hover:underline">
                            + {(order.items || []).length - 3} {tt('moreItems', 'منتجات أخرى (انقر للتفاصيل)', 'more items (click for details)')}
                          </Link>
                        </div>
                      )}
                    </div>

                    {/* Shipping Address Card */}
                    <div className="lg:w-72 bg-slate-50 rounded-2xl p-5 text-sm h-fit border border-slate-100">
                      <p className="font-extrabold text-slate-800 mb-3 flex items-center gap-2">
                        <MapPin size={16} className="text-slate-400" /> {tt('shippingAddress', 'عنوان الاستلام', 'Shipping Address')}
                      </p>
                      <div className="space-y-1 text-slate-600 font-medium leading-relaxed">
                        <p className="font-bold text-slate-900">{safeText(order.address?.fullName) || '—'}</p>
                        <p>{safeText(order.address?.city) || '—'}, {safeText(order.address?.street) || '—'}</p>
                        {/* 🌍 استخدام dir="ltr" لرقم الهاتف لضمان ظهور الـ + والمفاتيح بشكل سليم */}
                        <p className="mt-1 font-bold text-slate-700" dir="ltr">{maskPhone(order.address?.phone)}</p>
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