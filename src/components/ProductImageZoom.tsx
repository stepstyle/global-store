// src/components/ProductImageZoom.tsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { X, ZoomIn, ZoomOut, Search } from 'lucide-react';
import LazyImage from './LazyImage';
import { useCart } from '../App';

type Props = {
  src: string;
  alt?: string;
  containerClassName?: string;
  imageClassName?: string;
  priority?: boolean;
  hoverZoom?: number;
};

type Pt = { x: number; y: number };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const isValid = (u: string) => {
  const s = String(u || '').trim();
  if (!s) return false;
  return /^https?:\/\//i.test(s) || s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('/');
};

// 🧮 معادلة فيثاغورس لحساب المسافة بين إصبعين (Pinch Zoom)
const distance = (a: Pt, b: Pt) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * ✅ TS-proof: returns strictly typed tuple or null
 * - avoids pts[0] / destructuring from arrays (problematic with strict TS configs)
 */
const getTwoPoints = (m: Map<number, Pt>): [Pt, Pt] | null => {
  const it = m.values();
  const a = it.next().value as Pt | undefined;
  const b = it.next().value as Pt | undefined;
  if (!a || !b) return null;
  return [a, b];
};

const ProductImageZoom: React.FC<Props> = ({
  src,
  alt = '',
  containerClassName = '',
  imageClassName = '',
  priority = true,
  hoverZoom = 2.2,
}) => {
  // ✅ دعم اللغتين
  const { language } = useCart() as any;
  const L = useCallback((ar: string, en: string) => (language === 'ar' ? ar : en), [language]);

  const safeSrc = useMemo(() => String(src || '').trim(), [src]);
  const ok = useMemo(() => isValid(safeSrc), [safeSrc]);

  // Desktop hover zoom
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 50, y: 50 });

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    setPos({ x: clamp(x, 0, 100), y: clamp(y, 0, 100) });
  };

  // Modal zoom/pan
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const pointers = useRef<Map<number, Pt>>(new Map());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const resetModalView = () => {
    setScale(1);
    setTx(0);
    setTy(0);
    pinchStart.current = null;
    dragStart.current = null;
    pointers.current.clear();
  };

  const close = () => {
    setOpen(false);
    resetModalView();
  };

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // lock scroll on modal
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  const zoomIn = () => setScale((s) => clamp(Number(s) * 1.15, 1, 6));
  const zoomOut = () => setScale((s) => clamp(Number(s) / 1.15, 1, 6));

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY;
    setScale((s) => clamp(delta > 0 ? s / 1.08 : s * 1.08, 1, 6));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // drag start
    if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX, y: e.clientY, tx, ty };
    }

    // pinch start
    if (pointers.current.size === 2) {
      const pair = getTwoPoints(pointers.current);
      if (!pair) return;
      const [p1, p2] = pair;
      pinchStart.current = { dist: distance(p1, p2), scale };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // pinch
    if (pointers.current.size === 2 && pinchStart.current) {
      const pair = getTwoPoints(pointers.current);
      if (!pair) return;
      const [p1, p2] = pair;

      const d = distance(p1, p2);
      const ratio = d / (pinchStart.current.dist || d || 1);
      setScale(clamp(pinchStart.current.scale * ratio, 1, 6));
      return;
    }

    // drag
    if (pointers.current.size === 1 && dragStart.current) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setTx(dragStart.current.tx + dx);
      setTy(dragStart.current.ty + dy);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) dragStart.current = null;
  };

  if (!ok) {
    return (
      <div className={`w-full aspect-square rounded-[2rem] bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 ${containerClassName}`}>
        {alt || L('لا توجد صورة', 'No image')}
      </div>
    );
  }

  return (
    <>
      {/* Main image wrapper */}
      <div
        ref={wrapRef}
        className={[
          'relative w-full aspect-square rounded-[2rem] bg-white border border-slate-100 overflow-hidden shadow-sm group cursor-pointer',
          'select-none',
          containerClassName,
        ].join(' ')}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onMouseMove={onMove}
      >
        {/* Base image */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute inset-0 w-full h-full"
          aria-label={alt || L('فتح الصورة', 'Open image')}
        >
          <LazyImage
            src={safeSrc}
            alt={alt}
            containerClassName="w-full h-full"
            className={[
              'w-full h-full object-contain p-4 mix-blend-multiply',
              hover ? 'md:opacity-0' : 'opacity-100',
              'transition-opacity duration-300',
              imageClassName,
            ].join(' ')}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
          />
        </button>

        {/* Desktop hover zoom layer (md+) */}
        <div
          className={[
            'hidden md:block absolute inset-0 bg-white',
            hover ? 'opacity-100' : 'opacity-0 pointer-events-none',
            'transition-opacity duration-200 ease-out',
          ].join(' ')}
          aria-hidden="true"
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url("${safeSrc}")`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: `${hoverZoom * 100}% ${hoverZoom * 100}%`,
              backgroundPosition: `${pos.x}% ${pos.y}%`,
              filter: 'contrast(1.02) saturate(1.02)',
              mixBlendMode: 'multiply'
            }}
          />
        </div>

        {/* Floating Zoom Icon Hint (Desktop) */}
        <div className="absolute bottom-4 right-4 rtl:left-4 rtl:right-auto bg-white/90 backdrop-blur shadow-md p-2 rounded-xl text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none hidden md:block">
          <Search size={18} strokeWidth={2.5} />
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-[100] animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md" onClick={close} />
          
          <div className="absolute inset-0 p-4 sm:p-6 md:p-12 flex items-center justify-center pointer-events-none">
            <div className="relative w-full max-w-6xl h-full max-h-[90vh] bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/20 pointer-events-auto flex flex-col animate-in zoom-in-95 duration-500">
              
              {/* Top bar */}
              <div className="absolute top-0 left-0 w-full z-20 flex items-center justify-between gap-4 p-4 sm:p-5 bg-gradient-to-b from-white/90 to-white/0 backdrop-blur-sm pointer-events-none">
                <div className="min-w-0 bg-white/80 backdrop-blur-md px-4 py-2 rounded-2xl border border-slate-100 shadow-sm pointer-events-auto">
                  <div className="text-xs sm:text-sm font-bold text-slate-800 truncate max-w-[200px] sm:max-w-md">{alt || L('معاينة الصورة', 'Image preview')}</div>
                </div>

                <div className="flex items-center gap-2 bg-white/90 backdrop-blur-md p-1.5 rounded-2xl border border-slate-100 shadow-sm pointer-events-auto">
                  <div className="text-[11px] font-black text-slate-400 tabular-nums px-2 hidden sm:block" dir="ltr">{`×${Math.round(scale * 100)}%`}</div>
                  
                  <div className="w-px h-5 bg-slate-200 mx-1 hidden sm:block" />

                  <button
                    type="button"
                    onClick={zoomOut}
                    className="p-2 sm:p-2.5 rounded-xl text-slate-500 hover:text-sky-500 hover:bg-sky-50 transition-colors"
                    aria-label={L('تصغير', 'Zoom out')}
                  >
                    <ZoomOut size={18} strokeWidth={2.5} />
                  </button>

                  <button
                    type="button"
                    onClick={resetModalView}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                  >
                    {L('إعادة', 'RESET')}
                  </button>

                  <button
                    type="button"
                    onClick={zoomIn}
                    className="p-2 sm:p-2.5 rounded-xl text-slate-500 hover:text-sky-500 hover:bg-sky-50 transition-colors"
                    aria-label={L('تكبير', 'Zoom in')}
                  >
                    <ZoomIn size={18} strokeWidth={2.5} />
                  </button>

                  <div className="w-px h-5 bg-slate-200 mx-1" />

                  <button
                    type="button"
                    onClick={close}
                    className="p-2 sm:p-2.5 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all focus:outline-none focus:ring-2 focus:ring-red-100"
                    aria-label={L('إغلاق', 'Close')}
                  >
                    <X size={20} strokeWidth={2.5} />
                  </button>
                </div>
              </div>

              {/* Canvas area */}
              <div className="flex-1 w-full bg-slate-50/50 relative overflow-hidden" onWheel={onWheel}>
                <div
                  className="w-full h-full touch-none"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  <div className="w-full h-full flex items-center justify-center p-8">
                    <img
                      src={safeSrc}
                      alt={alt}
                      draggable={false}
                      className="max-w-none select-none mix-blend-multiply drop-shadow-sm"
                      style={{
                        transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
                        transformOrigin: 'center center',
                        willChange: 'transform',
                        userSelect: 'none',
                        pointerEvents: 'none',
                      }}
                    />
                  </div>
                </div>

                {/* Mobile Hint */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-black tracking-widest uppercase text-slate-500 bg-white/80 border border-slate-100 shadow-sm px-4 py-2 rounded-full backdrop-blur pointer-events-none md:hidden">
                  {L('اسحب للتنقل / كبّر', 'Pinch / Drag')}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ProductImageZoom;