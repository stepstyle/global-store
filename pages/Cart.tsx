// src/pages/Cart.tsx
import React, { useEffect, useMemo, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { ShoppingBag, ArrowRight, ShieldCheck, Tag } from 'lucide-react';
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

  const safeCart = Array.isArray(cart) ? cart : [];

  const [orderNote, setOrderNote] = useState<string>(() => {
    try {
      return localStorage.getItem(ORDER_NOTE_KEY) || '';
    } catch {
      return '';
    }
  });

  // Persist note
  useEffect(() => {
    try {
      localStorage.setItem(ORDER_NOTE_KEY, orderNote);
    } catch {
      // ignore
    }
  }, [orderNote]);

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

  const formatMoney = (n: number) => (fmt ? fmt.format(n) : `JOD ${Number(n || 0).toFixed(2)}`);

  const totalItems = useMemo(
    () => safeCart.reduce((sum: number, it: any) => sum + Number(it.quantity || 0), 0),
    [safeCart]
  );

  const subtotal = useMemo(
    () => safeCart.reduce((sum: number, it: any) => sum + Number(it.price || 0) * Number(it.quantity || 0), 0),
    [safeCart]
  );

  const discountAmount = useMemo(() => (totalItems > 2 ? subtotal * 0.1 : 0), [subtotal, totalItems]);
  const total = useMemo(() => Math.max(0, subtotal - discountAmount), [subtotal, discountAmount]);

  const onSetQty = (id: string, nextQty: number) => {
    if (typeof updateCartItemQuantity !== 'function') return;
    updateCartItemQuantity(id, nextQty);
  };

  if (safeCart.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
        <SEO title={t('cart') ?? 'Cart'} noIndex={true} />

        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-secondary-light/20 flex items-center justify-center text-secondary-DEFAULT mb-4">
            <ShoppingBag />
          </div>
          <h1 className="text-2xl font-heading font-bold text-slate-900 mb-2">
            {t('cartEmpty') ?? 'Your cart is empty'}
          </h1>
          <p className="text-slate-500 mb-6">
            {t('browseToAdd') ?? 'Browse products and add items to your cart.'}
          </p>
          <Button onClick={() => navigate('/shop')} className="w-full">
            {t('browseProducts') ?? 'Browse products'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pt-8 pb-16">
      <SEO title={t('cart') ?? 'Cart'} noIndex={true} />

      <div className="container mx-auto px-4 lg:px-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-heading font-bold text-slate-900">{t('cart') ?? 'Cart'}</h1>
            <p className="text-slate-500 mt-1">
              {totalItems} {t('items') ?? 'items'}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/shop')}
              className="text-sm font-bold text-slate-600 hover:opacity-80 transition"
            >
              {t('continueShopping') ?? 'Continue shopping'}
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left: Items */}
          <div className="flex-1 space-y-4">
            {safeCart.map((item: any) => (
              <CartItemCard
                key={item.id}
                item={item}
                title={getProductTitle(item)}
                t={t}
                formatMoney={formatMoney}
                onRemove={(id) => removeFromCart(id)}
                onSetQty={onSetQty}
              />
            ))}

            {/* Order Note */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 mt-2">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="font-bold text-slate-900">{t('orderNote') ?? 'Order note (optional)'}</p>
                <p className="text-xs text-slate-400">{t('noteSaved') ?? 'Saved automatically.'}</p>
              </div>

              <textarea
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                placeholder={t('orderNotePlaceholder') ?? 'Write a note for the seller (gift wrap, time, etc.)'}
                className="w-full min-h-[110px] resize-none p-3 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-secondary-DEFAULT focus:ring-2 focus:ring-secondary-DEFAULT/30 text-sm"
              />

              {safeTrim(orderNote) && (
                <p className="text-[11px] text-slate-500 mt-2">
                  {t('noteHint') ?? 'This note will appear in checkout and order details.'}
                </p>
              )}
            </div>
          </div>

          {/* Right: Summary */}
          <div className="lg:w-[420px]">
            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-6 sticky top-24">
              <h2 className="font-bold text-lg text-slate-900 mb-4">{t('orderSummary') ?? 'Order summary'}</h2>

              {/* Discount banner */}
              {totalItems > 2 && (
                <div className="mb-4 rounded-2xl bg-green-50 border border-green-100 p-3 text-green-800 text-sm font-bold flex items-center gap-2">
                  <Tag size={16} />
                  {t('discountApplied') ?? 'Discount applied'}
                </div>
              )}

              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>{t('subtotal') ?? 'Subtotal'}</span>
                  <span className="font-bold text-slate-800">{formatMoney(subtotal)}</span>
                </div>

                {discountAmount > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span className="font-bold">{t('discount') ?? 'Discount'}</span>
                    <span className="font-bold">-{formatMoney(discountAmount)}</span>
                  </div>
                )}

                <div className="h-px bg-slate-100 my-3" />

                <div className="flex justify-between text-slate-900 text-lg">
                  <span className="font-bold">{t('total') ?? 'Total'}</span>
                  <span className="font-bold">{formatMoney(total)}</span>
                </div>

                <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600 flex items-start gap-2">
                  <ShieldCheck size={16} className="text-green-600 mt-0.5" />
                  <span>{t('secureCheckoutNote') ?? 'Secure checkout. Your information is protected.'}</span>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <Button
                  onClick={() => navigate('/checkout')}
                  className="w-full py-4 text-lg shadow-xl shadow-secondary-light/20 flex justify-center items-center gap-2"
                >
                  {t('checkout') ?? 'Checkout'} <ArrowRight size={20} className="rtl:rotate-180 ltr:rotate-0" />
                </Button>

                <Button variant="outline" onClick={() => navigate('/shop')} className="w-full">
                  {t('continueShopping') ?? 'Continue shopping'}
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