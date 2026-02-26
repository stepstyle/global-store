import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Package, Calendar, MapPin, DollarSign, Truck, ChevronRight, StickyNote } from 'lucide-react';
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

const maskPhone = (phone?: string) => {
  const p = safeText(phone);
  if (p.length < 6) return p;
  return `${p.slice(0, 3)}****${p.slice(-3)}`;
};

const statusBadge = (status?: string) => {
  const s = safeText(status);
  if (s === 'delivered') return 'bg-green-100 text-green-700';
  if (s === 'shipped') return 'bg-blue-100 text-blue-700';
  if (s === 'cancelled') return 'bg-red-100 text-red-700';
  return 'bg-yellow-100 text-yellow-700';
};

const NOTE_PREVIEW_CHARS = 140;

const MyOrders: React.FC = () => {
  const { user, t, language } = useCart() as any;

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // Toggle note "show more" per order id
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});

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

  // ✅ status label (don’t call t() with dynamic values)
  const statusLabel = useCallback(
    (status?: string) => {
      const s = safeText(status);
      if (s === 'processing') return tt('processing', 'قيد المعالجة', 'Processing');
      if (s === 'shipped') return tt('shipped', 'تم الشحن', 'Shipped');
      if (s === 'delivered') return tt('delivered', 'تم التسليم', 'Delivered');
      if (s === 'cancelled') return tt('cancelled', 'ملغي', 'Cancelled');
      return s || '—';
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

  const money = (n?: number) => {
    const x = typeof n === 'number' ? n : 0;
    return fmt ? fmt.format(x) : `JOD ${x.toFixed(2)}`;
  };

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
          (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );

        setOrders(sorted);
      } catch {
        if (cancelled) return;
        setErrorMsg(tt('loadFailed', 'فشل تحميل الطلبات. حاول مرة أخرى.', 'Failed to load your orders. Please try again.'));
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

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-50">
        <SEO title={tt('myOrders', 'طلباتي', 'My Orders')} noIndex={true} />
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-secondary-light/20 flex items-center justify-center text-secondary-DEFAULT mb-4">
            <Package />
          </div>
          <h2 className="text-2xl font-heading font-bold mb-2 text-slate-900">
            {tt('login', 'تسجيل الدخول', 'Login')} {tt('required', 'مطلوب', 'Required')}
          </h2>
          <p className="text-slate-500 mb-6">
            {tt('loginToSeeOrders', 'يرجى تسجيل الدخول لعرض طلباتك.', 'Please login to view your orders.')}
          </p>
          <Link to="/login">
            <Button className="w-full">{tt('login', 'تسجيل الدخول', 'Login')}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12">
      <SEO title={tt('myOrders', 'طلباتي', 'My Orders')} noIndex={true} />
      <div className="container mx-auto px-4 lg:px-8 max-w-4xl">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-heading font-bold text-slate-900">
              {tt('myOrders', 'طلباتي', 'My Orders')}
            </h1>
            <p className="text-slate-500 mt-1">
              {tt('myOrdersHint', 'تابع مشترياتك الأخيرة.', 'Track and review your recent purchases.')}
            </p>
          </div>
          <Link to="/shop" className="text-sm font-bold text-secondary-DEFAULT hover:opacity-80 transition">
            {tt('continueShopping', 'متابعة التسوق', 'Continue shopping')}
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <OrderSkeleton key={i} />
            ))}
          </div>
        ) : errorMsg ? (
          <div className="bg-white rounded-3xl p-10 text-center border border-slate-100 shadow-sm">
            <p className="text-red-600 font-bold mb-4">{errorMsg}</p>
            <Button onClick={() => window.location.reload()} variant="outline">
              {tt('retry', 'إعادة المحاولة', 'Retry')}
            </Button>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-slate-100 shadow-sm">
            <Package size={64} className="mx-auto text-slate-300 mb-4" />
            <h3 className="text-xl font-bold text-slate-700 mb-2">
              {tt('noOrders', 'لا توجد طلبات', 'No orders')}
            </h3>
            <p className="text-slate-500">
              {tt('noOrdersHint', 'لم تقم بعمل أي طلب بعد.', 'You have not placed any orders yet.')}
            </p>
            <Link to="/shop">
              <Button variant="outline" className="mt-5">
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
                  className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow"
                >
                  {/* Header */}
                  <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4 border-b border-slate-50 pb-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <span className="font-bold text-lg text-slate-900 break-all">#{safeText(order.id)}</span>

                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${statusBadge(order.status)}`}>
                          {statusLabel(order.status)}
                        </span>

                        <span className="text-xs bg-slate-100 text-slate-600 px-3 py-1 rounded-full font-bold">
                          {itemsCount} {tt('items', 'منتجات', 'items')}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar size={14} /> {safeText(order.date) || '—'}
                        </span>
                        <span className="flex items-center gap-1">
                          <DollarSign size={14} /> {money(order.total)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Truck size={14} /> {safeText(order.shippingMethod) || tt('shipping', 'الشحن', 'Shipping')}
                        </span>
                      </div>
                    </div>

                    {/* Track this order */}
                    <Link to={`/tracking?orderId=${encodeURIComponent(safeText(order.id))}`}>
                      <Button size="sm" variant="outline" className="flex items-center gap-2">
                        {tt('track', 'تتبع', 'Track')}
                        <ChevronRight size={16} className="rtl:rotate-180" />
                      </Button>
                    </Link>
                  </div>

                  {/* Order Note */}
                  {note && (
                    <div className="mb-5 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 text-slate-700">
                          <StickyNote size={16} className="text-secondary-DEFAULT" />
                          <p className="text-sm font-bold">{tt('orderNote', 'ملاحظة الطلب', 'Order note')}</p>
                        </div>

                        {noteNeedsToggle && (
                          <button
                            type="button"
                            onClick={() => toggleNote(safeText(order.id))}
                            className="text-xs font-bold text-secondary-DEFAULT hover:opacity-80 transition whitespace-nowrap"
                          >
                            {isExpanded
                              ? tt('showLess', 'عرض أقل', 'Show less')
                              : tt('showMore', 'عرض المزيد', 'Show more')}
                          </button>
                        )}
                      </div>

                      <p className="mt-2 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                        {isExpanded ? note : notePreview}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-6">
                    {/* Items preview */}
                    <div className="flex-1 space-y-3">
                      {firstItems.map((item: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-slate-50 rounded-xl overflow-hidden shrink-0 border border-slate-100">
                            <LazyImage
                              src={item.image}
                              alt={safeText(item.name)}
                              className="w-full h-full object-cover"
                              containerClassName="w-full h-full"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-slate-800 line-clamp-1">{safeText(item.name)}</p>
                            <p className="text-xs text-slate-500">
                              x{item.quantity} • {money(item.price)}
                            </p>
                          </div>
                        </div>
                      ))}

                      {(order.items || []).length > 3 && (
                        <p className="text-xs text-slate-400 font-bold">
                          +{(order.items || []).length - 3} {tt('moreItems', 'منتجات إضافية', 'more items')}
                        </p>
                      )}
                    </div>

                    {/* Address */}
                    <div className="sm:w-64 bg-slate-50 rounded-2xl p-4 text-sm h-fit border border-slate-100">
                      <p className="font-bold text-slate-700 mb-2 flex items-center gap-2">
                        <MapPin size={14} /> {tt('shipping', 'الشحن', 'Shipping')}
                      </p>
                      <p className="text-slate-600 leading-relaxed">
                        {safeText(order.address?.fullName) || '—'}
                        <br />
                        {safeText(order.address?.city) || '—'}, {safeText(order.address?.street) || '—'}
                        <br />
                        {maskPhone(order.address?.phone)}
                      </p>
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