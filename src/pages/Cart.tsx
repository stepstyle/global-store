// src/pages/Cart.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { ShoppingBag, ArrowRight, ShieldCheck, Tag, ArrowLeft } from 'lucide-react';
import { useCart } from '../App';
import SEO from '../components/SEO';
import Button from '../components/Button';
import CartItemCard from '../components/CartItemCard';

const { useNavigate } = ReactRouterDOM as any;

const ORDER_NOTE_KEY = 'anta_order_note_v1';

const safeTrim = (v: any) => String(v ?? '').trim();

const Cart: React.FC = () => {
  const navigate = useNavigate();
  const {
    cart,
    t,
    language,
    getProductTitle,
    removeFromCart,
    updateCartItemQuantity,
  } = useCart() as any;

  // 🌍 دالة الترجمة الفورية والآمنة
  const L = useCallback((ar: string, en: string) => (language === 'ar' ? ar : en), [language]);

  const safeCart = Array.isArray(cart) ? cart : [];

  // 📝 استرجاع الملاحظة من التخزين المحلي
  const [orderNote, setOrderNote] = useState<string>(() => {
    try {
      return localStorage.getItem(ORDER_NOTE_KEY) || '';
    } catch {
      return '';
    }
  });

  // 💾 حفظ الملاحظة تلقائياً عند التغيير
  useEffect(() => {
    try {
      localStorage.setItem(ORDER_NOTE_KEY, orderNote);
    } catch {
      // ignore
    }
  }, [orderNote]);

  // 💰 تنسيق العملة
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

  const formatMoney = useCallback((n: number) => {
    return fmt ? fmt.format(n) : `${Number(n || 0).toFixed(2)} JOD`;
  }, [fmt]);

  // 🛒 الحسابات
  const totalItems = useMemo(
    () => safeCart.reduce((sum: number, it: any) => sum + Number(it.quantity || 0), 0),
    [safeCart]
  );

  const subtotal = useMemo(
    () => safeCart.reduce((sum: number, it: any) => sum + Number(it.price || 0) * Number(it.quantity || 0), 0),
    [safeCart]
  );

  // خصم 10% إذا كانت المنتجات أكثر من 2
  const discountAmount = useMemo(() => (totalItems > 2 ? subtotal * 0.1 : 0), [subtotal, totalItems]);
  const total = useMemo(() => Math.max(0, subtotal - discountAmount), [subtotal, discountAmount]);

  const onSetQty = useCallback((id: string, nextQty: number) => {
    if (typeof updateCartItemQuantity !== 'function') return;
    updateCartItemQuantity(id, nextQty);
  }, [updateCartItemQuantity]);

  // ==========================================
  // 📭 حالة السلة الفارغة (Empty State)
  // ==========================================
  if (safeCart.length === 0) {
    return (
      <div className="min-h-[80vh] bg-slate-50 flex items-center justify-center px-4 py-10">
        <SEO title={L('سلة المشتريات', 'Cart')} noIndex={true} />

        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center animate-in fade-in zoom-in duration-500">
          <div className="mx-auto w-20 h-20 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mb-6">
            <ShoppingBag size={40} strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-heading font-extrabold text-slate-900 mb-2">
            {L('سلة المشتريات فارغة', 'Your cart is empty')}
          </h1>
          <p className="text-slate-500 mb-8 text-sm leading-relaxed">
            {L('تصفح منتجاتنا وأضف ما يعجبك إلى السلة للبدء بالتسوق.', 'Browse products and add items to your cart to get started.')}
          </p>
          <Button onClick={() => navigate('/shop')} className="w-full rounded-full py-3.5 shadow-md">
            {L('تصفح المنتجات', 'Browse products')}
          </Button>
        </div>
      </div>
    );
  }

  // ==========================================
  // 🛍️ حالة السلة الممتلئة (Filled State)
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-50 pt-8 pb-16">
      <SEO title={L('سلة المشتريات', 'Cart')} noIndex={true} />

      <div className="container mx-auto px-4 lg:px-8">
        {/* رأس الصفحة */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div className="text-start">
            <h1 className="text-3xl font-heading font-extrabold text-slate-900">{L('سلة المشتريات', 'Cart')}</h1>
            <p className="text-slate-500 mt-1.5 font-medium text-sm">
              {totalItems} {L('عنصر', 'items')}
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate('/shop')}
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-secondary-DEFAULT transition-colors"
          >
            <ArrowRight size={16} className="rtl:rotate-0 ltr:rotate-180" />
            {L('متابعة التسوق', 'Continue shopping')}
          </button>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* 📦 الجزء الأيسر: المنتجات والملاحظات */}
          <div className="flex-1 w-full space-y-4">
            
            {/* المنتجات */}
            <div className="space-y-4">
              {safeCart.map((item: any) => (
                <CartItemCard
                  key={item.id}
                  item={item}
                  title={getProductTitle(item)}
                  t={t} // نمرر t لضمان عدم كسر أي شيء بالداخل إن كانت تُستخدم
                  formatMoney={formatMoney}
                  onRemove={(id) => removeFromCart(id)}
                  onSetQty={onSetQty}
                />
              ))}
            </div>

            {/* 📝 ملاحظات الطلب */}
            <div className="bg-white border border-slate-200/60 rounded-2xl p-5 sm:p-6 mt-6 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="font-bold text-slate-900">{L('ملاحظات الطلب (اختياري)', 'Order note (optional)')}</p>
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-md">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    {L('تُحفظ تلقائياً', 'Auto-saved')}
                  </p>
                </div>
              </div>

              <textarea
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                placeholder={L('اكتب ملاحظة للبائع (تغليف هدية، وقت التوصيل المفضل، إلخ)...', 'Write a note for the seller (gift wrap, time, etc.)')}
                className="w-full min-h-[110px] resize-none p-3.5 rounded-xl bg-slate-50 border border-slate-200 outline-none focus:border-secondary-DEFAULT focus:ring-2 focus:ring-secondary-DEFAULT/20 text-sm text-slate-700 transition-all placeholder:text-slate-400"
              />

              {safeTrim(orderNote) && (
                <p className="text-[11px] font-medium text-slate-500 mt-2 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-slate-400" />
                  {L('ستظهر هذه الملاحظة لفريقنا عند تجهيز الطلب.', 'This note will appear to our team during fulfillment.')}
                </p>
              )}
            </div>
          </div>

          {/* 🧾 الجزء الأيمن: ملخص الطلب (Sticky) */}
          <div className="w-full lg:w-[400px] xl:w-[420px] shrink-0">
            <div className="bg-white border border-slate-200/60 rounded-3xl shadow-lg shadow-slate-200/40 p-6 sm:p-7 sticky top-24">
              <h2 className="font-extrabold text-xl text-slate-900 mb-6">{L('ملخص الطلب', 'Order Summary')}</h2>

              {/* لافتة الخصم */}
              {totalItems > 2 && (
                <div className="mb-5 rounded-xl bg-green-50 border border-green-100 p-3 text-green-700 text-sm font-bold flex items-center gap-2">
                  <Tag size={18} className="text-green-600" />
                  {L('تم تطبيق خصم 10%', '10% discount applied')}
                </div>
              )}

              <div className="space-y-3.5 text-sm font-medium">
                <div className="flex justify-between text-slate-500">
                  <span>{L('المجموع الفرعي', 'Subtotal')}</span>
                  <span className="font-bold text-slate-800" dir="ltr">{formatMoney(subtotal)}</span>
                </div>

                {discountAmount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>{L('الخصم', 'Discount')}</span>
                    <span className="font-bold" dir="ltr">-{formatMoney(discountAmount)}</span>
                  </div>
                )}

                <div className="h-px bg-slate-100 my-4" />

                <div className="flex justify-between items-end text-slate-900">
                  <span className="font-extrabold text-lg">{L('الإجمالي', 'Total')}</span>
                  <span className="font-black text-2xl" dir="ltr">{formatMoney(total)}</span>
                </div>

                <div className="mt-5 rounded-xl bg-slate-50 border border-slate-100 p-3.5 text-xs text-slate-500 flex items-start gap-2.5 leading-relaxed">
                  <ShieldCheck size={18} className="text-green-500 shrink-0 mt-0.5" />
                  <span>{L('عملية دفع آمنة. معلوماتك مشفرة ومحمية بالكامل.', 'Secure checkout. Your information is fully encrypted and protected.')}</span>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <Button
                  onClick={() => navigate('/checkout')}
                  className="w-full py-4 text-base rounded-2xl shadow-xl shadow-secondary-DEFAULT/25 flex justify-center items-center gap-2 group hover:-translate-y-0.5 transition-all"
                >
                  {L('إتمام الطلب', 'Proceed to Checkout')}
                  <ArrowLeft size={18} className="rtl:rotate-0 ltr:rotate-180 group-hover:-translate-x-1 rtl:group-hover:translate-x-1 transition-transform" />
                </Button>

                <Button variant="outline" onClick={() => navigate('/shop')} className="w-full py-3.5 rounded-2xl border-slate-200 text-slate-600 hover:bg-slate-50">
                  {L('متابعة التسوق', 'Continue Shopping')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cart;