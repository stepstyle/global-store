import React, { memo, useMemo, useState } from 'react';
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

  return (
    <div className="relative group bg-white border border-slate-100 rounded-2xl p-3 flex gap-4 transition-all hover:shadow-md">
      {/* Confirmation Overlay */}
      {confirmRemove && (
        <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm z-10 rounded-2xl flex flex-col items-center justify-center text-white animate-in fade-in duration-200">
          <p className="font-bold mb-3 text-sm">{t('confirmRemove')}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.id);
                setConfirmRemove(false);
              }}
              className="bg-red-500 hover:bg-red-600 px-4 py-1.5 rounded-xl text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
            >
              {t('remove')}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmRemove(false);
              }}
              className="bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded-xl text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Image */}
      <div className="w-20 h-20 bg-slate-50 rounded-2xl overflow-hidden shrink-0">
        <LazyImage
          src={item.image}
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
          {item.category && <p className="text-xs text-slate-500 mb-2">{item.category}</p>}
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">{t('price') ?? 'Price'}</p>
            <p className="font-bold text-slate-900">{formatMoney(price)}</p>
          </div>

          {/* Qty controls */}
          <div className="flex flex-col items-end gap-2">
            <div className="inline-flex items-center gap-1 bg-slate-50 rounded-2xl border border-slate-200 p-1">
              <button
                type="button"
                onClick={() => onSetQty(item.id, qty - 1)}
                disabled={qty <= 1}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Decrease quantity"
              >
                <Minus size={16} />
              </button>

              <span className="w-10 text-center text-sm font-bold text-slate-700 select-none">{qty}</span>

              <button
                type="button"
                onClick={() => onSetQty(item.id, qty + 1)}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white transition"
                aria-label="Increase quantity"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="text-xs text-slate-500">
              {t('lineTotal') ?? 'Total'}:{' '}
              <span className="font-bold text-slate-800">{formatMoney(lineTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Remove */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setConfirmRemove(true);
        }}
        className="p-2 text-slate-400 hover:text-red-500 self-start transition-colors rounded-xl hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        title={t('remove')}
        aria-label={t('remove') ?? 'إزالة'}
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
};

export default memo(CartItemCard);