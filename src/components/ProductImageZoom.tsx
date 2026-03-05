// src/components/ProductImageZoom.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import LazyImage from './LazyImage';

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
      <div
        className={`w-full aspect-square rounded-3xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 ${containerClassName}`}
      >
        {alt || 'No image'}
      </div>
    );
  }

  return (
    <>
      {/* Main image wrapper */}
      <div
        ref={wrapRef}
        className={[
          'relative w-full aspect-square rounded-3xl bg-white border border-slate-200 overflow-hidden',
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
          aria-label={alt || 'Open image'}
        >
          <LazyImage
            src={safeSrc}
            alt={alt}
            containerClassName="w-full h-full"
            className={[
              'w-full h-full object-contain',
              hover ? 'md:opacity-0' : 'opacity-100',
              'transition-opacity duration-200',
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
            'hidden md:block absolute inset-0',
            hover ? 'opacity-100' : 'opacity-0 pointer-events-none',
            'transition-opacity duration-150',
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
              filter: 'contrast(1.03) saturate(1.02)',
            }}
          />
          <div className="absolute bottom-3 left-3 rtl:left-auto rtl:right-3 bg-slate-900/70 text-white text-[11px] font-bold px-3 py-1.5 rounded-full backdrop-blur">
            Zoom
          </div>
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-[100]">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={close} />
          <div className="absolute inset-0 p-3 sm:p-6 flex items-center justify-center">
            <div className="relative w-full max-w-5xl h-[88vh] bg-white rounded-3xl shadow-2xl overflow-hidden border border-white/10">
              {/* Top bar */}
              <div className="absolute top-0 left-0 w-full z-10 flex items-center justify-between gap-2 p-3 sm:p-4 bg-white/85 backdrop-blur border-b border-slate-100">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">{alt || 'Image preview'}</div>
                  <div className="text-[11px] text-slate-400 tabular-nums">{`×${Math.round(scale * 100)}%`}</div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetModalView}
                    className="hidden sm:inline-flex px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-bold"
                  >
                    Reset
                  </button>

                  <button
                    type="button"
                    onClick={zoomOut}
                    className="p-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50"
                    aria-label="Zoom out"
                  >
                    <ZoomOut size={18} />
                  </button>

                  <button
                    type="button"
                    onClick={zoomIn}
                    className="p-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50"
                    aria-label="Zoom in"
                  >
                    <ZoomIn size={18} />
                  </button>

                  <button
                    type="button"
                    onClick={close}
                    className="p-2 rounded-xl hover:bg-slate-100 text-slate-700"
                    aria-label="Close"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Canvas area */}
              <div className="absolute inset-0 pt-14 sm:pt-16 bg-slate-50" onWheel={onWheel}>
                <div
                  className="w-full h-full touch-none"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  <div className="w-full h-full flex items-center justify-center">
                    <img
                      src={safeSrc}
                      alt={alt}
                      draggable={false}
                      className="max-w-none select-none"
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

                <div className="absolute bottom-3 left-3 rtl:left-auto rtl:right-3 text-[11px] font-bold text-white bg-slate-900/60 px-3 py-1.5 rounded-full backdrop-blur">
                  Pinch / Drag
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