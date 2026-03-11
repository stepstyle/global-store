// src/pages/Cart.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { ShoppingBag, ArrowRight, ShieldCheck, Tag, ArrowLeft, AlertTriangle } from 'lucide-react';
import { useCart } from '../App';
import SEO from '../components/SEO';
import CartItemCard from '../components/CartItemCard';
import { Product } from '../types';

const { useNavigate } = ReactRouterDOM as any;

const ORDER_NOTE_KEY = 'anta_order_note_v1';

const safeTrim = (v: any) => String(v ?? '').trim();

const Cart: React.FC = () => {
  const navigate = useNavigate();
  const {
    cart,
    products, // 🛡️ تم جلبه للتحقق من السعر الحقيقي والمخزون
    t,
    language,
    getProductTitle,
    removeFromCart,
    updateCartItemQuantity,
  } = useCart() as any;

  // 🌍 دالة الترجمة الفورية والآمنة (Corporate Voice)
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

  // ==========================================
  // 🛡️ حسابات التسعير والمخزون (Security & Validation Layer)
  // ==========================================
  
  // 1. دمج بيانات السلة مع السعر والمخزون الحقيقي من الباك إند
  const validatedCart = useMemo(() => {
    return safeCart.map((cartItem: any) => {
      const realProduct = products.find((p: Product) => p.id === cartItem.id);
      return {
        ...cartItem,
        // إذا كان المنتج موجوداً في قاعدة البيانات نأخذ سعره ومخزونه الحقيقي
        price: realProduct ? realProduct.price : cartItem.price,
        stock: realProduct ? realProduct.stock : cartItem.stock,
        isAvailable: realProduct !== undefined && (realProduct.stock === undefined || realProduct.stock > 0),
        hasStockIssue: realProduct && realProduct.stock !== undefined && cartItem.quantity > realProduct.stock,
      };
    });
  }, [safeCart, products]);

  const totalItems = useMemo(
    () => validatedCart.reduce((sum: number, it: any) => sum + Number(it.quantity || 0), 0),
    [validatedCart]
  );

  // 2. حساب المجموع بناءً على الأسعار الموثقة
  const subtotal = useMemo(
    () => validatedCart.reduce((sum: number, it: any) => sum + (Number(it.price || 0) * Number(it.quantity || 0)), 0),
    [validatedCart]
  );

  // 3. الخصم الديناميكي
  const discountAmount = useMemo(() => (totalItems > 2 ? subtotal * 0.1 : 0), [subtotal, totalItems]);
  const total = useMemo(() => Math.max(0, subtotal - discountAmount), [subtotal, discountAmount]);

  // 4. هل هناك مشكلة تمنع إتمام الطلب؟ (منتج غير متوفر أو كمية تتجاوز المخزون)
  const hasCartIssues = useMemo(() => validatedCart.some((it: any) => !it.isAvailable || it.hasStockIssue), [validatedCart]);

  const onSetQty = useCallback((id: string, nextQty: number) => {
    if (typeof updateCartItemQuantity !== 'function') return;
    updateCartItemQuantity(id, nextQty);
  }, [updateCartItemQuantity]);

  // ==========================================
  // 📭 حالة السلة الفارغة (Empty State)
  // ==========================================
  if (validatedCart.length === 0) {
    return (
      <div className="min-h-[80vh] bg-slate-50 flex items-center justify-center px-4 py-10">
        <SEO title={L('سلة المشتريات', 'Shopping Cart')} noIndex={true} />

        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center animate-in fade-in zoom-in duration-500">
          <div className="mx-auto w-20 h-20 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mb-6">
            <ShoppingBag size={40} strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-heading font-extrabold text-slate-900 mb-2">
            {L('سلة المشتريات فارغة', 'Your cart is empty')}
          </h1>
          <p className="text-slate-500 mb-8 text-sm leading-relaxed">
            {L('تصفح مجموعتنا المختارة وأضف المنتجات إلى سلتك للبدء.', 'Browse our curated selection and add items to your cart to begin.')}
          </p>
          <button 
            onClick={() => navigate('/shop')} 
            className="w-full rounded-full py-3.5 bg-black hover:bg-slate-800 text-white font-bold transition-all shadow-md"
          >
            {L('استعراض المنتجات', 'Browse Products')}
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // 🛍️ حالة السلة الممتلئة (Filled State)
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-50 pt-8 pb-16">
      <SEO title={L('سلة المشتريات', 'Shopping Cart')} noIndex={true} />

      <div className="container mx-auto px-4 lg:px-8">
        {/* رأس الصفحة */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div className="text-start">
            <h1 className="text-3xl font-heading font-extrabold text-slate-900">{L('سلة المشتريات', 'Shopping Cart')}</h1>
            <p className="text-slate-500 mt-1.5 font-medium text-sm">
              {totalItems} {L('عنصر', 'items')}
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate('/shop')}
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-sky-500 transition-colors"
          >
            <ArrowRight size={16} className="rtl:rotate-0 ltr:rotate-180" />
            {L('متابعة التسوق', 'Continue shopping')}
          </button>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* 📦 الجزء الأيسر: المنتجات والملاحظات */}
          <div className="flex-1 w-full space-y-4">
            
            {/* التنبيه بوجود مشكلة في المخزون */}
            {hasCartIssues && (
               <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3 text-amber-800 animate-in slide-in-from-top-2">
                 <AlertTriangle size={20} className="shrink-0 mt-0.5" />
                 <p className="text-sm font-bold leading-relaxed">
                   {L('بعض المنتجات في سلتك قد نفدت كميتها أو تم تجاوز المخزون المتاح. يرجى تعديل الكميات لمتابعة الطلب.', 'Some items in your cart are out of stock or exceed available quantity. Please adjust quantities to proceed.')}
                 </p>
               </div>
            )}

            {/* المنتجات الموثقة */}
            <div className="space-y-4">
              {validatedCart.map((item: any) => (
                <div key={item.id} className="relative">
                  <CartItemCard
                    item={item}
                    title={getProductTitle(item)}
                    t={t}
                    formatMoney={formatMoney}
                    onRemove={(id) => removeFromCart(id)}
                    onSetQty={onSetQty}
                  />
                  {/* شريط التحذير للمنتج المخصص */}
                  {item.hasStockIssue && (
                    <div className="absolute bottom-0 left-0 right-0 bg-red-50 text-red-600 text-[11px] font-bold px-4 py-1.5 rounded-b-2xl border-x border-b border-red-100 flex items-center justify-between">
                      <span>{L('تجاوز المخزون المتاح', 'Exceeds available stock')}</span>
                      <span>{L(`المتاح: ${item.stock}`, `Available: ${item.stock}`)}</span>
                    </div>
                  )}
                  {!item.isAvailable && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] rounded-2xl z-10 flex items-center justify-center">
                       <span className="bg-red-600 text-white text-xs font-black px-3 py-1.5 rounded-lg uppercase tracking-wider shadow-lg">
                         {L('نفدت الكمية', 'Out of stock')}
                       </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 📝 ملاحظات الطلب */}
            <div className="bg-white border border-slate-200/60 rounded-2xl p-5 sm:p-6 mt-6 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="font-bold text-slate-900">{L('ملاحظات الطلب (اختياري)', 'Order instructions (optional)')}</p>
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
                placeholder={L('أضف تعليمات خاصة بالتوصيل، أو تفاصيل تغليف الهدية...', 'Add special delivery instructions, or gift wrapping details...')}
                className="w-full min-h-[110px] resize-none p-3.5 rounded-xl bg-slate-50 border border-slate-200 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 text-sm text-slate-700 transition-all placeholder:text-slate-400"
              />

              {safeTrim(orderNote) && (
                <p className="text-[11px] font-medium text-slate-500 mt-2 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-slate-400" />
                  {L('سيتم مراجعة ملاحظتك بعناية من قبل فريق التجهيز.', 'Your note will be carefully reviewed by our fulfillment team.')}
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
                  {L('تم تطبيق خصم الكمية 10%', 'Volume discount 10% applied')}
                </div>
              )}

              <div className="space-y-3.5 text-sm font-medium">
                <div className="flex justify-between text-slate-500">
                  <span>{L('المجموع الفرعي', 'Subtotal')}</span>
                  <span className="font-bold text-slate-800" dir="ltr">{formatMoney(subtotal)}</span>
                </div>

                {discountAmount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>{L('الخصم المكتسب', 'Earned Discount')}</span>
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
                  <span>{L('دفع آمن 100%. يتم تشفير وحماية بياناتك وفق أعلى المعايير.', '100% Secure checkout. Your data is encrypted and protected to the highest standards.')}</span>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {/* زر إتمام الطلب (مُعطل إذا كان هناك مشكلة بالمخزون) */}
                <button
                  onClick={() => navigate('/checkout')}
                  disabled={hasCartIssues}
                  className={`w-full py-4 text-base font-extrabold rounded-xl flex justify-center items-center gap-2 group transition-all duration-300 ${
                    hasCartIssues 
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                      : 'bg-sky-400 hover:bg-sky-500 text-white shadow-lg shadow-sky-400/30'
                  }`}
                >
                  {hasCartIssues ? L('الرجاء تعديل السلة للمتابعة', 'Adjust cart to proceed') : L('إتمام الشراء', 'Proceed to Checkout')}
                  {!hasCartIssues && <ArrowLeft size={18} className="rtl:rotate-0 ltr:rotate-180 group-hover:-translate-x-1 rtl:group-hover:translate-x-1 transition-transform" />}
                </button>

                {/* زر متابعة التسوق */}
                <button 
                  onClick={() => navigate('/shop')} 
                  className="w-full py-3.5 text-base font-extrabold rounded-xl bg-black hover:bg-slate-800 text-white shadow-lg shadow-black/20 transition-all duration-300"
                >
                  {L('متابعة التسوق', 'Continue Shopping')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cart;