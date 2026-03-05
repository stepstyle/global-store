// src/components/CartItemCard.tsx
import React, { memo, useCallback, useMemo, useState, useEffect } from 'react';
import { Trash2, Minus, Plus } from 'lucide-react';
import LazyImage from './LazyImage';

type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  category?: string;
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

  const price = useMemo(() => Number(item.price) || 0, [item.price]);
  const qty = useMemo(() => clampQty(item.quantity ?? 1), [item.quantity]);
  const lineTotal = useMemo(() => price * qty, [price, qty]);

  // ✅ Labels (لا نترك نصوص ثابتة بالإنجليزي)
  const decreaseLabel = useMemo(() => t('decreaseQty') ?? (t('decrease') ?? 'إنقاص الكمية'), [t]);
  const increaseLabel = useMemo(() => t('increaseQty') ?? (t('increase') ?? 'زيادة الكمية'), [t]);
  const removeLabel = useMemo(() => t('remove') ?? 'إزالة', [t]);

  // ✅ Handlers (أداء أفضل + لا يعيد الإنشاء كل رندر)
  const closeConfirm = useCallback(() => setConfirmRemove(false), []);
  const openConfirm = useCallback(() => setConfirmRemove(true), []);

  const handleRemove = useCallback(() => {
    onRemove(item.id);
    setConfirmRemove(false);
  }, [onRemove, item.id]);

  const dec = useCallback(() => {
    // ✅ clamp (لا ننزل عن 1)
    const next = clampQty(qty - 1);
    if (next === qty) return;
    onSetQty(item.id, next);
  }, [onSetQty, item.id, qty]);

  const inc = useCallback(() => {
    // ✅ clamp (لا نطلع فوق 99)
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
    <div className="relative group bg-white border border-slate-100 rounded-2xl p-3 flex gap-4 transition-all hover:shadow-md">
      {/* ✅ Confirmation Overlay */}
      {confirmRemove && (
        <div
          className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm z-10 rounded-2xl flex flex-col items-center justify-center text-white animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-label={t('confirmRemove') ?? 'تأكيد الإزالة'}
          onClick={closeConfirm} // ✅ click outside closes
        >
          <div className="px-4" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold mb-3 text-sm text-center">{t('confirmRemove')}</p>

            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove();
                }}
                className="bg-red-500 hover:bg-red-600 px-4 py-1.5 rounded-xl text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
              >
                {removeLabel}
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeConfirm();
                }}
                className="bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded-xl text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {t('cancel') ?? 'إلغاء'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Image */}
      <div className="w-20 h-20 bg-slate-50 rounded-2xl overflow-hidden shrink-0">
        <LazyImage
          src={item.image}
          alt={title}
          className="w-full h-full object-cover"
          containerClassName="w-full h-full"
          loading="lazy"
          eager={false}
          expectedDisplayWidth={80} // ✅ يساعد LazyImage يختار حجم أفضل (خصوصًا Cloudinary)
        />
      </div>

      {/* ✅ Info */}
      <div className="flex-1 flex flex-col justify-between min-w-0">
        <div>
          <h3 className="font-bold text-slate-800 text-sm line-clamp-1">{title}</h3>
          {item.category ? <p className="text-xs text-slate-500 mb-2">{item.category}</p> : null}
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">{t('price') ?? 'السعر'}</p>
            <p className="font-bold text-slate-900">{formatMoney(price)}</p>
          </div>

          {/* ✅ Qty controls */}
          <div className="flex flex-col items-end gap-2">
            <div
              className="inline-flex items-center gap-1 bg-slate-50 rounded-2xl border border-slate-200 p-1"
              aria-label={t('quantity') ?? 'الكمية'}
            >
              <button
                type="button"
                onClick={dec}
                disabled={qty <= 1}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={decreaseLabel}
              >
                <Minus size={16} />
              </button>

              {/* ✅ aria-live: يعلن تغير الكمية لقارئات الشاشة */}
              <span
                className="w-10 text-center text-sm font-bold text-slate-700 select-none tabular-nums"
                aria-live="polite"
              >
                {qty}
              </span>

              <button
                type="button"
                onClick={inc}
                disabled={qty >= 99}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={increaseLabel}
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="text-xs text-slate-500">
              {t('lineTotal') ?? 'الإجمالي'}:{' '}
              <span className="font-bold text-slate-800 tabular-nums">{formatMoney(lineTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ✅ Remove */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          // ✅ toggle (لو مفتوحة بالفعل ما نعيد فتحها)
          setConfirmRemove((v) => !v);
        }}
        className="p-2 text-slate-400 hover:text-red-500 self-start transition-colors rounded-xl hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        title={removeLabel}
        aria-label={removeLabel}
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
};

export default memo(CartItemCard);