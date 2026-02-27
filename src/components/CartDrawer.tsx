import React, { useEffect, useMemo, useRef, useState, memo, useCallback } from 'react';
import { X, Trash2, ShoppingBag, ArrowRight, Tag, Minus, Plus, StickyNote } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useCart } from '../App';
import Button from './Button';
import LazyImage from './LazyImage';
import type { CartItem as CartItemType } from '../types';

const ORDER_NOTE_MAX_CHARS = 600;

const clampQty = (n: number) => {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(99, Math.round(n)));
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
                onRemove(item.id);
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
      <div className="w-20 h-20 bg-slate-50 rounded-2xl overflow-hidden shrink-0">
        <LazyImage
          src={(item as any).image}
          alt={title}
          className="w-full h-full object-cover"
          containerClassName="w-full h-full"
          loading="lazy"
          eager={false}
        />
      </div>

      {/* Info */}
      <div className="flex-1 flex flex-col justify-between min-w-0">
        <div>
          <h3 className="font-bold text-slate-800 text-sm line-clamp-1">{title}</h3>
          {(item as any).category && <p className="text-xs text-slate-500 mb-2">{(item as any).category}</p>}
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">{tt('price', 'السعر', 'Price')}</p>
            <p className="font-bold text-slate-900">{formatMoney(price)}</p>
          </div>

          {/* Qty */}
          <div className="flex flex-col items-end gap-2">
            <div className="inline-flex items-center gap-1 bg-slate-50 rounded-2xl border border-slate-200 p-1">
              <button
                type="button"
                onClick={() => onSetQty(item.id, qty - 1)}
                disabled={qty <= 1}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={tt('decreaseQty', 'تقليل الكمية', 'Decrease quantity')}
              >
                <Minus size={16} />
              </button>

              <span className="w-10 text-center text-sm font-bold text-slate-700 select-none" aria-live="polite">
                {qty}
              </span>

              <button
                type="button"
                onClick={() => onSetQty(item.id, qty + 1)}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white transition"
                aria-label={tt('increaseQty', 'زيادة الكمية', 'Increase quantity')}
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="text-xs text-slate-500">
              {tt('lineTotal', 'الإجمالي', 'Total')}: <span className="font-bold text-slate-800">{formatMoney(lineTotal)}</span>
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
        className="p-2 text-slate-400 hover:text-red-500 self-start transition-colors rounded-xl hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        title={tt('remove', 'إزالة', 'Remove')}
        aria-label={tt('remove', 'إزالة', 'Remove')}
      >
        <Trash2 size={18} />
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

    // ✅ رسمياً من النظام
    orderNote,
    setOrderNote
  } = useCart() as any;

  const navigate = useNavigate();

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const safeCart: CartItemType[] = Array.isArray(cart) ? cart : [];

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

  const totalItems = useMemo(() => {
    return safeCart.reduce((sum, item) => sum + clampQty(item.quantity ?? 1), 0);
  }, [safeCart]);

  const subtotal = useMemo(() => {
    return safeCart.reduce((sum, item) => {
      const price = Number(item.price) || 0;
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
    (id: string, nextQty: number) => {
      if (typeof updateCartItemQuantity !== 'function') return;
      updateCartItemQuantity(id, clampQty(nextQty));
    },
    [updateCartItemQuantity]
  );

  // lock scroll behind drawer
  useEffect(() => {
    if (!isCartOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [isCartOpen]);

  // ESC + focus on open
  useEffect(() => {
    if (!isCartOpen) return;

    closeBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsCartOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCartOpen, setIsCartOpen]);

  // simple focus trap
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
    <div
      className="fixed inset-0 z-[60] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cart-drawer-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/35 backdrop-blur-[2px]"
        onClick={() => setIsCartOpen(false)}
        aria-hidden="true"
      />

      {/* Panel */}
      <div ref={panelRef} className={`relative w-screen max-w-md bg-white shadow-2xl h-full flex flex-col ${drawerAnim}`}>
        {/* Header */}
        <div className="p-6 border-b border-slate-100 bg-gradient-to-l from-secondary-light/25 to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900">
              <div className="w-10 h-10 rounded-2xl bg-secondary-light/25 flex items-center justify-center text-secondary-DEFAULT">
                <ShoppingBag />
              </div>
              <div>
                <h2 id="cart-drawer-title" className="text-xl font-bold font-heading leading-tight">
                  {tt('cart', 'السلة', 'Cart')}
                </h2>
                <p className="text-xs text-slate-500">
                  {tt('cartHint', 'راجع المنتجات قبل الدفع', 'Review items before checkout')}
                </p>
              </div>
              <span
                className="text-xs bg-slate-200 text-slate-700 px-2 py-1 rounded-full"
                aria-label={tt('items', 'عدد المنتجات', 'Items count')}
              >
                {totalItems}
              </span>
            </div>

            <button
              ref={closeBtnRef}
              onClick={(e) => {
                e.stopPropagation();
                setIsCartOpen(false);
              }}
              className="p-2 text-slate-400 hover:text-red-500 transition-colors rounded-full hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
              aria-label={tt('close', 'إغلاق', 'Close')}
              type="button"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4" aria-live="polite">
          {safeCart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 text-slate-400">
              <ShoppingBag size={64} strokeWidth={1} />
              <p className="text-lg">{tt('cartEmpty', 'السلة فارغة', 'Your cart is empty')}</p>

              <Button
                onClick={() => {
                  setIsCartOpen(false);
                  navigate('/shop');
                }}
                variant="outline"
              >
                {tt('browseProducts', 'تصفح المنتجات', 'Browse products')}
              </Button>
            </div>
          ) : (
            <>
              {safeCart.map((item) => (
                <CartRow
                  key={item.id}
                  item={item}
                  title={getProductTitle(item)}
                  t={t}
                  tr={tr}
                  tt={tt}
                  formatMoney={formatMoney}
                  onRemove={(id) => removeFromCart(id)}
                  onSetQty={setQty}
                />
              ))}

              {/* Order Note (رسمي) */}
              <div className="mt-2 bg-white border border-slate-100 rounded-2xl p-4">
                <div className="flex items-center justify-between gap-3 mb-2 text-slate-900">
                  <div className="flex items-center gap-2">
                    <StickyNote className="text-secondary-DEFAULT" size={18} />
                    <p className="font-bold text-sm">
                      {tt('orderNote', 'ملاحظة على الطلب (اختياري)', 'Order note (optional)')}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400">
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
                  className="w-full min-h-[92px] resize-none p-3 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-secondary-DEFAULT focus:ring-2 focus:ring-secondary-DEFAULT/30 text-sm"
                />
                <p className="text-xs text-slate-400 mt-2">{tt('noteSaved', 'محفوظ تلقائياً.', 'Saved automatically.')}</p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {safeCart.length > 0 && (
          <div className="p-6 bg-white border-t border-slate-100 shadow-upper">
            {/* Discount Banner */}
            {totalItems > 2 && (
              <div className="bg-green-50 text-green-700 text-xs font-bold p-2 rounded-xl mb-4 flex items-center gap-2">
                <Tag size={14} /> {tt('discountApplied', 'تم تطبيق خصم', 'Discount applied')}
              </div>
            )}

            <div className="space-y-2 mb-4">
              <div className="flex justify-between items-center text-sm text-slate-600">
                <span>{tt('subtotal', 'المجموع الفرعي', 'Subtotal')}</span>
                <span className="font-bold">{formatMoney(subtotal)}</span>
              </div>

              {discountAmount > 0 && (
                <div className="flex justify-between items-center text-sm text-green-700 font-bold">
                  <span>{tt('discount', 'الخصم', 'Discount')}</span>
                  <span>-{formatMoney(discountAmount)}</span>
                </div>
              )}

              <div className="flex justify-between items-center text-lg font-bold text-slate-900 border-t border-slate-100 pt-2">
                <span>{tt('total', 'الإجمالي', 'Total')}</span>
                <span>{formatMoney(total)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                onClick={() => {
                  setIsCartOpen(false);
                  navigate('/checkout');
                }}
                className="w-full py-4 text-lg shadow-xl shadow-secondary-light/20 flex justify-center items-center gap-2"
              >
                {tt('checkout', 'إتمام الشراء', 'Checkout')}{' '}
                <ArrowRight size={20} className="rtl:rotate-180 ltr:rotate-0" />
              </Button>

              <Button variant="ghost" onClick={() => setIsCartOpen(false)} className="w-full text-slate-600">
                {tt('continueShopping', 'متابعة التسوق', 'Continue shopping')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CartDrawer;