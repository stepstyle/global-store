// src/components/CartDrawer.tsx
import React, { useEffect, useMemo, useRef, useState, memo, useCallback } from 'react';
import { X, Trash2, ShoppingBag, ArrowRight, ArrowLeft, Tag, Minus, Plus, StickyNote } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useCart } from '../App';
import Button from './Button';
import LazyImage from './LazyImage';
import type { CartItem as CartItemType, Product } from '../types';

const ORDER_NOTE_MAX_CHARS = 600;

const clampQty = (n: number) => {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(99, Math.round(n)));
};

// 🚀 Helper: Generate a unique ID for Cart Items based on variants
const getCartItemId = (item: CartItemType) => {
  const variant = (item as any).selectedVariant;
  if (variant && variant.id) {
    return `${item.id}_${variant.id}`;
  }
  return item.id;
};

type RowProps = {
  item: CartItemType;
  title: string;
  t: (k: any) => string;
  tr: (ar: string, en: string) => string;
  tt: (key: string, fallbackAr: string, fallbackEn: string) => string;
  formatMoney: (n: number) => string;
  onRemove: (id: string) => void;
  onSetQty: (id: string, qty: number) => void;
};

const CartRow = memo(function CartRow({ item, title, tt, formatMoney, onRemove, onSetQty }: RowProps) {
  const [confirm, setConfirm] = useState(false);

  const price = Number(item.price) || 0;
  const qty = clampQty(item.quantity ?? 1);
  const lineTotal = price * qty;
  
  // 🚀 استخراج الخيار المختار والمُعرّف الذكي
  const variant = (item as any).selectedVariant;
  const cartItemId = getCartItemId(item);

  // 🚀 الصورة الديناميكية (تأخذ صورة الخيار إذا وجدت)
  const displayImage = variant?.image || (item as any).image;

  return (
    <div className="relative group bg-white border border-slate-100 rounded-2xl p-3 flex gap-4 transition-all hover:shadow-md">
      {/* Confirm Overlay */}
      {confirm && (
        <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm z-10 rounded-2xl flex flex-col items-center justify-center text-white animate-in fade-in duration-200">
          <p className="font-bold mb-3 text-sm">{tt('confirmRemove', 'تأكيد إزالة المنتج؟', 'Confirm remove item?')}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(cartItemId);
                setConfirm(false);
              }}
              className="bg-red-500 hover:bg-red-600 px-4 py-1.5 rounded-xl text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
            >
              {tt('remove', 'إزالة', 'Remove')}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirm(false);
              }}
              className="bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded-xl text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              {tt('cancel', 'إلغاء', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Image */}
      <div className="w-20 h-20 bg-slate-50 rounded-2xl overflow-hidden shrink-0 border border-slate-100">
        <LazyImage
          src={displayImage}
          alt={title}
          className="w-full h-full object-cover mix-blend-multiply"
          containerClassName="w-full h-full"
          loading="lazy"
          eager={false}
        />
      </div>

      {/* Info */}
      <div className="flex-1 flex flex-col justify-between min-w-0">
        <div>
          <h3 className="font-bold text-slate-800 text-sm line-clamp-1">{title}</h3>
          
          {/* 🚀 عرض الخيار المختار بشكل أنيق ومدمج للزبون */}
          {variant && (
            <div className="mt-1 flex items-center gap-1.5 bg-slate-50 border border-slate-100 rounded-lg px-2 py-0.5 w-fit">
              {variant.type === 'color' && variant.colorCode && (
                <span 
                  className="w-3 h-3 rounded-full border border-black/10 shadow-inner block shrink-0" 
                  style={{ 
                    background: variant.colorCode2 
                      ? `linear-gradient(135deg, ${variant.colorCode} 50%, ${variant.colorCode2} 50%)`
                      : variant.colorCode 
                  }}
                />
              )}
              {variant.label && variant.label.trim() !== '.' && (
                <span className="text-[10px] font-bold text-slate-600">{variant.label}</span>
              )}
            </div>
          )}
          
          {!variant && (item as any).category && (
            <p className="text-xs text-slate-500 mt-1">{(item as any).category}</p>
          )}
        </div>

        <div className="flex items-end justify-between gap-3 mt-2">
          <div className="min-w-0">
            <p className="text-[10px] text-slate-400 mb-0.5">{tt('price', 'السعر', 'Price')}</p>
            <p className="font-bold text-slate-900 text-sm">{formatMoney(variant ? variant.price : price)}</p>
          </div>

          {/* Qty */}
          <div className="flex flex-col items-end gap-1.5">
            <div className="inline-flex items-center gap-1 bg-slate-50 rounded-xl border border-slate-200 p-0.5 shadow-inner">
              <button
                type="button"
                onClick={() => onSetQty(cartItemId, qty - 1)}
                disabled={qty <= 1}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white hover:shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:shadow-none text-slate-600"
                aria-label={tt('decreaseQty', 'تقليل الكمية', 'Decrease quantity')}
              >
                <Minus size={14} />
              </button>

              <span className="w-8 text-center text-xs font-black text-slate-800 select-none" aria-live="polite">
                {qty}
              </span>

              <button
                type="button"
                onClick={() => onSetQty(cartItemId, qty + 1)}
                disabled={(variant && qty >= variant.stock) || (!variant && qty >= item.stock)}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white hover:shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:shadow-none text-slate-600"
                aria-label={tt('increaseQty', 'زيادة الكمية', 'Increase quantity')}
              >
                <Plus size={14} />
              </button>
            </div>

            <div className="text-[10px] text-slate-500">
              {tt('lineTotal', 'الإجمالي', 'Total')}: <span className="font-black text-slate-800">{formatMoney((variant ? variant.price : price) * qty)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Remove */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setConfirm(true);
        }}
        className="p-1.5 text-slate-300 hover:text-red-500 self-start transition-colors rounded-xl hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 absolute top-2 rtl:left-2 ltr:right-2"
        title={tt('remove', 'إزالة', 'Remove')}
        aria-label={tt('remove', 'إزالة', 'Remove')}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
});

const CartDrawer: React.FC = () => {
  const {
    isCartOpen,
    setIsCartOpen,
    cart,
    removeFromCart,
    t,
    getProductTitle,
    language,
    updateCartItemQuantity,

    orderNote,
    setOrderNote
  } = useCart() as any;

  const navigate = useNavigate();

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const safeCart: CartItemType[] = Array.isArray(cart) ? cart : [];

  const tr = useCallback((ar: string, en: string) => (language === 'ar' ? ar : en), [language]);

  const tt = useCallback(
    (key: string, fallbackAr: string, fallbackEn: string) => {
      const v = t?.(key);
      if (!v || v === key) return tr(fallbackAr, fallbackEn);
      return v;
    },
    [t, tr]
  );

  const totalItems = useMemo(() => {
    return safeCart.reduce((sum, item) => sum + clampQty(item.quantity ?? 1), 0);
  }, [safeCart]);

  const subtotal = useMemo(() => {
    return safeCart.reduce((sum, item) => {
      const variant = (item as any).selectedVariant;
      const price = Number(variant ? variant.price : item.price) || 0;
      const qty = clampQty(item.quantity ?? 1);
      return sum + price * qty;
    }, 0);
  }, [safeCart]);

  const discountAmount = useMemo(() => (totalItems > 2 ? subtotal * 0.1 : 0), [subtotal, totalItems]);
  const total = useMemo(() => Math.max(0, subtotal - discountAmount), [subtotal, discountAmount]);

  const formatMoney = useCallback(
    (n: number) => {
      try {
        return new Intl.NumberFormat(language === 'ar' ? 'ar-JO' : 'en-JO', {
          style: 'currency',
          currency: 'JOD',
          maximumFractionDigits: 2
        }).format(n);
      } catch {
        return `JOD ${Number(n || 0).toFixed(2)}`;
      }
    },
    [language]
  );

  const setQty = useCallback(
    (cartItemId: string, nextQty: number) => {
      if (typeof updateCartItemQuantity !== 'function') return;
      updateCartItemQuantity(cartItemId, clampQty(nextQty));
    },
    [updateCartItemQuantity]
  );

  useEffect(() => {
    if (!isCartOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [isCartOpen]);

  useEffect(() => {
    if (!isCartOpen) return;
    closeBtnRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsCartOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCartOpen, setIsCartOpen]);

  useEffect(() => {
    if (!isCartOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = panelRef.current;
      if (!root) return;

      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isCartOpen]);

  if (!isCartOpen) return null;

  const drawerAnim =
    language === 'ar'
      ? 'animate-in slide-in-from-left motion-reduce:animate-none'
      : 'animate-in slide-in-from-right motion-reduce:animate-none';

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="cart-drawer-title">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-slate-900/35 backdrop-blur-[2px]" onClick={() => setIsCartOpen(false)} aria-hidden="true" />

      {/* Panel */}
      <div ref={panelRef} className={`relative w-screen max-w-md bg-white shadow-2xl h-full flex flex-col ${drawerAnim}`}>
        {/* Header */}
        <div className="p-6 border-b border-slate-100 bg-gradient-to-l from-slate-50 to-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-slate-900">
              <div className="w-10 h-10 rounded-2xl bg-sky-50 flex items-center justify-center text-sky-500">
                <ShoppingBag size={22} />
              </div>
              <div>
                <h2 id="cart-drawer-title" className="text-xl font-bold font-heading leading-tight">
                  {tt('cart', 'السلة', 'Cart')}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {tt('cartHint', 'راجع المنتجات قبل الدفع', 'Review items before checkout')}
                </p>
              </div>
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-bold ml-2 rtl:mr-2 rtl:ml-0">
                {totalItems}
              </span>
            </div>

            <button
              ref={closeBtnRef}
              onClick={(e) => {
                e.stopPropagation();
                setIsCartOpen(false);
              }}
              className="p-2 border border-slate-200 text-slate-400 hover:text-red-500 transition-colors rounded-full hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
              aria-label={tt('close', 'إغلاق', 'Close')}
              type="button"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar" aria-live="polite">
          {safeCart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 text-slate-400">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-2">
                <ShoppingBag size={32} className="text-slate-300" />
              </div>
              <p className="text-lg font-bold text-slate-600">{tt('cartEmpty', 'السلة فارغة', 'Your cart is empty')}</p>

              <button
                onClick={() => {
                  setIsCartOpen(false);
                  navigate('/shop');
                }}
                className="mt-4 w-full py-3.5 rounded-xl bg-black hover:bg-slate-800 text-white font-extrabold transition-all duration-300"
              >
                {tt('browseProducts', 'تصفح المنتجات', 'Browse products')}
              </button>
            </div>
          ) : (
            <>
              {safeCart.map((item, index) => (
                <CartRow
                  key={`${getCartItemId(item)}-${index}`}
                  item={item}
                  title={getProductTitle(item)}
                  t={t}
                  tr={tr}
                  tt={tt}
                  formatMoney={formatMoney}
                  onRemove={(cartItemId) => removeFromCart(cartItemId)}
                  onSetQty={setQty}
                />
              ))}

              {/* Order Note */}
              <div className="mt-4 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-3 text-slate-900">
                  <div className="flex items-center gap-2">
                    <StickyNote className="text-slate-700" size={18} />
                    <p className="font-bold text-sm">
                      {tt('orderNote', 'ملاحظة الطلب', 'Order note')}
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-slate-400">
                    {(orderNote || '').length}/{ORDER_NOTE_MAX_CHARS}
                  </span>
                </div>

                <textarea
                  value={orderNote || ''}
                  onChange={(e) => setOrderNote(e.target.value)}
                  maxLength={ORDER_NOTE_MAX_CHARS}
                  placeholder={tt(
                    'orderNotePlaceholder',
                    'اكتب ملاحظة للبائع (مثال: تغليف هدية / وقت توصيل)...',
                    'Write a note for the seller (e.g., gift wrap, delivery time)...'
                  )}
                  className="w-full min-h-[92px] resize-none p-3.5 rounded-xl bg-slate-50 border border-slate-200 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 text-sm text-slate-700 transition-all placeholder:text-slate-400"
                />
                <p className="text-[10px] text-slate-400 mt-2 font-medium">{tt('noteSaved', 'تم الحفظ تلقائياً.', 'Saved automatically.')}</p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {safeCart.length > 0 && (
          <div className="p-6 bg-white border-t border-slate-100 shadow-[0_-10px_40px_rgba(0,0,0,0.03)] z-10">
            {/* Discount Banner */}
            {totalItems > 2 && (
              <div className="bg-emerald-50 text-emerald-700 text-xs font-bold p-3 rounded-xl mb-4 flex items-center gap-2 border border-emerald-100">
                <Tag size={16} className="text-emerald-500" /> {tt('discountApplied', 'تم تطبيق خصم 10%', '10% discount applied')}
              </div>
            )}

            <div className="space-y-3 mb-6">
              <div className="flex justify-between items-center text-sm text-slate-500 font-medium">
                <span>{tt('subtotal', 'المجموع الفرعي', 'Subtotal')}</span>
                <span className="font-bold text-slate-700">{formatMoney(subtotal)}</span>
              </div>

              {discountAmount > 0 && (
                <div className="flex justify-between items-center text-sm text-emerald-600 font-bold">
                  <span>{tt('discount', 'الخصم', 'Discount')}</span>
                  <span>-{formatMoney(discountAmount)}</span>
                </div>
              )}

              <div className="flex justify-between items-end text-lg font-black text-slate-900 border-t border-slate-100 pt-3 mt-1">
                <span>{tt('total', 'الإجمالي', 'Total')}</span>
                <span>{formatMoney(total)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => {
                  setIsCartOpen(false);
                  navigate('/checkout');
                }}
                className="w-full py-3.5 text-base font-extrabold rounded-xl bg-sky-400 hover:bg-sky-500 text-white shadow-lg shadow-sky-400/30 flex justify-center items-center gap-2 group transition-all duration-300 active:scale-95"
              >
                {tt('checkout', 'إتمام الطلب', 'Checkout')}
                <ArrowLeft size={18} className="rtl:rotate-0 ltr:rotate-180 group-hover:-translate-x-1 rtl:group-hover:translate-x-1 transition-transform" />
              </button>

              <button 
                onClick={() => setIsCartOpen(false)} 
                className="w-full py-3 text-sm font-extrabold rounded-xl bg-slate-900 hover:bg-black text-white shadow-md shadow-black/20 transition-all duration-300 active:scale-95"
              >
                {tt('continueShopping', 'متابعة التسوق', 'Continue shopping')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CartDrawer;