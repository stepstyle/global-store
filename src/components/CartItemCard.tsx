// src/components/CartItemCard.tsx
import React, { memo, useCallback, useMemo, useState, useEffect } from 'react';
import { Trash2, Minus, Plus } from 'lucide-react';
import LazyImage from './LazyImage';
import { ProductVariant } from '../types';

type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  category?: string;
  selectedVariant?: ProductVariant; // 🚀 إضافة دعم الخيار المختار
};

const clampQty = (n: number) => {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(99, Math.round(n)));
};

type Props = {
  item: CartItem;
  title: string;
  formatMoney: (n: number) => string;
  onRemove: (id: string) => void;
  onSetQty: (id: string, nextQty: number) => void;
  t: (k: any) => string;
};

const CartItemCard: React.FC<Props> = ({ item, title, formatMoney, onRemove, onSetQty, t }) => {
  const [confirmRemove, setConfirmRemove] = useState(false);

  // 🚀 أخذ سعر الخيار المختار إن وجد، وإلا السعر العادي
  const price = useMemo(() => {
    const p = item.selectedVariant ? item.selectedVariant.price : item.price;
    return Number(p) || 0;
  }, [item.price, item.selectedVariant]);

  const qty = useMemo(() => clampQty(item.quantity ?? 1), [item.quantity]);
  const lineTotal = useMemo(() => price * qty, [price, qty]);

  // 🚀 أخذ صورة الخيار المختار إن وجدت، وإلا الصورة العادية
  const displayImage = useMemo(() => {
    return item.selectedVariant?.image || item.image;
  }, [item.image, item.selectedVariant]);

  // ✅ Labels
  const decreaseLabel = useMemo(() => t('decreaseQty') ?? (t('decrease') ?? 'إنقاص الكمية'), [t]);
  const increaseLabel = useMemo(() => t('increaseQty') ?? (t('increase') ?? 'زيادة الكمية'), [t]);
  const removeLabel = useMemo(() => t('remove') ?? 'إزالة', [t]);

  // ✅ Handlers
  const closeConfirm = useCallback(() => setConfirmRemove(false), []);
  const openConfirm = useCallback(() => setConfirmRemove(true), []);

  const handleRemove = useCallback(() => {
    onRemove(item.id);
    setConfirmRemove(false);
  }, [onRemove, item.id]);

  const dec = useCallback(() => {
    const next = clampQty(qty - 1);
    if (next === qty) return;
    onSetQty(item.id, next);
  }, [onSetQty, item.id, qty]);

  const inc = useCallback(() => {
    const next = clampQty(qty + 1);
    if (next === qty) return;
    onSetQty(item.id, next);
  }, [onSetQty, item.id, qty]);

  // ✅ ESC لإغلاق نافذة التأكيد (A11y)
  useEffect(() => {
    if (!confirmRemove) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmRemove(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmRemove]);

  return (
    <div className="relative group bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 flex gap-4 sm:gap-5 transition-all hover:shadow-md">
      {/* ✅ Confirmation Overlay */}
      {confirmRemove && (
        <div
          className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm z-10 rounded-2xl flex flex-col items-center justify-center text-white animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-label={t('confirmRemove') ?? 'تأكيد الإزالة'}
          onClick={closeConfirm}
        >
          <div className="px-4" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold mb-4 text-sm text-center">{t('confirmRemove') ?? 'تأكيد إزالة المنتج؟'}</p>

            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove();
                }}
                className="bg-red-500 hover:bg-red-600 px-5 py-2 rounded-xl text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
              >
                {removeLabel}
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeConfirm();
                }}
                className="bg-white/10 hover:bg-white/20 px-5 py-2 rounded-xl text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {t('cancel') ?? 'إلغاء'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Image */}
      <div className="w-24 h-24 sm:w-28 sm:h-28 bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden shrink-0 flex items-center justify-center p-2">
        <LazyImage
          src={displayImage}
          alt={title}
          className="w-full h-full object-contain mix-blend-multiply"
          containerClassName="w-full h-full"
          loading="lazy"
          eager={false}
          expectedDisplayWidth={112}
        />
      </div>

      {/* ✅ Info */}
      <div className="flex-1 flex flex-col justify-between min-w-0">
        <div>
          <h3 className="font-black text-slate-900 text-base line-clamp-2 leading-snug">{title}</h3>
          
          {/* 🚀 عرض الخيار المختار (الألوان المدمجة والأحجام) */}
          {item.selectedVariant ? (
            <div className="mt-2 flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1 w-fit">
              {item.selectedVariant.type === 'color' && item.selectedVariant.colorCode && (
                <span 
                  className="w-3.5 h-3.5 rounded-full border border-black/10 shadow-inner block shrink-0" 
                  style={{ 
                    background: item.selectedVariant.colorCode2 
                      ? `linear-gradient(135deg, ${item.selectedVariant.colorCode} 50%, ${item.selectedVariant.colorCode2} 50%)`
                      : item.selectedVariant.colorCode 
                  }}
                />
              )}
              {item.selectedVariant.label && item.selectedVariant.label.trim() !== '.' && (
                <span className="text-[11px] font-bold text-slate-600 tracking-wide">{item.selectedVariant.label}</span>
              )}
            </div>
          ) : (
            item.category ? <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5">{item.category}</p> : null
          )}
        </div>

        <div className="flex items-end justify-between gap-3 mt-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">{t('price') ?? 'السعر'}</p>
            <p className="font-black text-sky-600 text-base">{formatMoney(price)}</p>
          </div>

          {/* ✅ Qty controls */}
          <div className="flex flex-col items-end gap-1.5">
            <div
              className="inline-flex items-center gap-1 bg-slate-50 rounded-xl border border-slate-200 p-0.5 shadow-inner"
              aria-label={t('quantity') ?? 'الكمية'}
            >
              <button
                type="button"
                onClick={dec}
                disabled={qty <= 1}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-white hover:shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:shadow-none"
                aria-label={decreaseLabel}
              >
                <Minus size={16} strokeWidth={3} />
              </button>

              <span
                className="w-10 text-center text-sm font-black text-slate-900 select-none tabular-nums"
                aria-live="polite"
              >
                {qty}
              </span>

              <button
                type="button"
                onClick={inc}
                disabled={item.selectedVariant ? qty >= item.selectedVariant.stock : qty >= 99} // 🚀 الحد الأقصى مرتبط بالمخزون
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-white hover:shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:shadow-none"
                aria-label={increaseLabel}
              >
                <Plus size={16} strokeWidth={3} />
              </button>
            </div>

            <div className="text-[10px] font-bold text-slate-500">
              {t('lineTotal') ?? 'الإجمالي'}:{' '}
              <span className="font-black text-slate-900 tabular-nums ml-1 rtl:ml-0 rtl:mr-1">{formatMoney(lineTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ✅ Remove */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setConfirmRemove((v) => !v);
        }}
        className="p-2 text-slate-300 hover:text-red-500 self-start transition-colors rounded-xl hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 absolute top-3 rtl:left-3 ltr:right-3"
        title={removeLabel}
        aria-label={removeLabel}
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
};

export default memo(CartItemCard);