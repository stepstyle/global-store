import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';

type FetchPriority = 'high' | 'low' | 'auto';

interface LazyImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'loading' | 'src'> {
  /** مصدر الصورة */
  src?: string | null;

  /** كلاس للـ wrapper */
  containerClassName?: string;

  /** خلفية placeholder فقط */
  placeholderClassName?: string;

  /** مصدر بديل لو فشل التحميل */
  fallbackSrc?: string;

  /** أولوية تحميل المتصفح */
  fetchPriority?: FetchPriority;

  /** إذا true: يتجاوز الـ IntersectionObserver ويحمل فوراً */
  eager?: boolean;

  /** أحجام للـ srcSet (Cloudinary) */
  responsiveWidths?: number[];

  /** sizes attribute للـ srcSet */
  sizes?: string;

  /** Cloudinary thumb size (square) */
  cloudinarySize?: number;

  /** عرض متوقع للصورة (Cloudinary) */
  expectedDisplayWidth?: number;

  /** lazy | eager */
  loading?: 'lazy' | 'eager';

  /** rootMargin للتحكم بسرعة تشغيل IntersectionObserver */
  rootMargin?: string;
}

/** تحقق بسيط من URL */
const isValidUrl = (u?: string) => {
  if (!u) return false;
  const s = String(u).trim();
  return /^https?:\/\//i.test(s) || s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('/');
};

/** يتحقق إن أول جزء بعد /upload/ هو Transform فعلي (Cloudinary) */
const looksLikeCloudinaryTransform = (firstSegment: string) => {
  const s = String(firstSegment || '').trim();
  if (!s) return false;
  if (s.includes(',')) return true;
  return /^(c_|w_|h_|q_|f_|dpr_|ar_|g_|b_|e_)/.test(s);
};

/** Cloudinary transformer */
const cloudinaryTransform = (url: string, w?: number, h?: number, mode?: 'limit' | 'fill') => {
  try {
    if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;

    const [base, restRaw] = url.split('/upload/');
    if (!base || !restRaw) return url;

    const restParts = restRaw.split('/');
    const first = restParts[0] || '';

    // إذا URL فيه transformations أصلاً لا نكرر
    if (looksLikeCloudinaryTransform(first)) return url;

    const t: string[] = ['f_auto', 'q_auto:good', 'dpr_auto'];

    if (typeof w === 'number' && w > 0) t.push(`w_${Math.round(w)}`);
    if (typeof h === 'number' && h > 0) t.push(`h_${Math.round(h)}`);

    const isSmall = (w && w <= 220) || (h && h <= 220);

    if (mode === 'fill' || isSmall) t.push('c_fill');
    else if (w || h) t.push('c_limit');

    return `${base}/upload/${t.join(',')}/${restRaw}`;
  } catch {
    return url;
  }
};

/** Picsum: محاولة تحويل لـ webp (اختياري) */
const picsumWebp = (url: string) => {
  try {
    if (!url.includes('picsum.photos') || url.includes('.webp')) return url;
    const [baseUrl, query] = url.split('?');

    // إذا كان URL على شكل /400 أو /400/400
    if (/\/\d+$/.test(baseUrl) || /\/\d+\/\d+$/.test(baseUrl)) {
      return `${baseUrl}.webp${query ? `?${query}` : ''}`;
    }
    return url;
  } catch {
    return url;
  }
};

const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt = '',
  className = '',
  containerClassName = '',
  placeholderClassName = 'bg-slate-100',
  fallbackSrc,
  fetchPriority = 'auto',
  style,
  eager = false,
  responsiveWidths = [320, 480, 640, 800, 1000, 1200, 1600, 2000],
  sizes,
  cloudinarySize,
  expectedDisplayWidth,
  loading = 'lazy',
  rootMargin = '600px',
  onLoad,
  onError,
  decoding = 'async',
  ...imgProps
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ✅ normalize src safely
  const normalizedSrc = useMemo(() => (src ? String(src).trim() : ''), [src]);

  // ✅ derived eager rule
  const derivedEager = useMemo(() => eager || loading === 'eager' || fetchPriority === 'high', [
    eager,
    loading,
    fetchPriority,
  ]);

  const [inView, setInView] = useState<boolean>(derivedEager);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);

  // reset state on src / eager change
  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
    setInView(derivedEager);
  }, [normalizedSrc, derivedEager]);

  // IntersectionObserver (client-only)
  useEffect(() => {
    if (derivedEager) return;

    // SSR guard
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const el = containerRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { root: null, rootMargin, threshold: 0.01 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [derivedEager, rootMargin]);

  // ✅ Always compute these with hooks (NO early return before hooks)
  const finalSrc = useMemo(() => picsumWebp(normalizedSrc), [normalizedSrc]);

  const isCloudinary = useMemo(
    () => finalSrc.includes('res.cloudinary.com') && finalSrc.includes('/upload/'),
    [finalSrc]
  );

  const resolvedSizes = useMemo(() => {
    if (!isCloudinary) return undefined;
    if (sizes) return sizes;

    if (expectedDisplayWidth && expectedDisplayWidth > 0) {
      const mobile = Math.min(expectedDisplayWidth, 768);
      return `(max-width: 768px) ${mobile}px, ${expectedDisplayWidth}px`;
    }

    return '(max-width: 768px) 90vw, 900px';
  }, [isCloudinary, sizes, expectedDisplayWidth]);

  const srcSet = useMemo(() => {
    if (!isCloudinary) return undefined;

    const set = responsiveWidths
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((w) => `${cloudinaryTransform(finalSrc, w, undefined, 'limit')} ${w}w`)
      .join(', ');

    return set || undefined;
  }, [finalSrc, isCloudinary, responsiveWidths]);

  const resolvedSrc = useMemo(() => {
    if (!finalSrc) return '';

    if (!isCloudinary) return finalSrc;

    if (cloudinarySize && cloudinarySize > 0) {
      return cloudinaryTransform(finalSrc, cloudinarySize, cloudinarySize, 'fill');
    }

    if (expectedDisplayWidth && expectedDisplayWidth > 0) {
      const cap = Math.max(800, Math.min(expectedDisplayWidth * 2, 2200));
      return cloudinaryTransform(finalSrc, cap, undefined, 'limit');
    }

    return finalSrc;
  }, [finalSrc, isCloudinary, cloudinarySize, expectedDisplayWidth]);

  const showFallback = useMemo(() => hasError && isValidUrl(fallbackSrc), [hasError, fallbackSrc]);

  const finalLoading: 'lazy' | 'eager' = derivedEager ? 'eager' : 'lazy';

  // ✅ If no src -> render placeholder safely
  const noSrc = !normalizedSrc;

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${containerClassName}`}>
      {/* Placeholder */}
      {!hasError && !isLoaded && (
        <div className={`absolute inset-0 ${placeholderClassName} animate-pulse`} aria-hidden="true" />
      )}

      {/* No src */}
      {noSrc ? (
        <div className={`absolute inset-0 flex items-center justify-center text-slate-300 ${placeholderClassName}`}>
          <ImageOff size={24} />
        </div>
      ) : hasError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-300">
          {showFallback ? (
            <img
              src={String(fallbackSrc)}
              alt={alt}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <ImageOff size={24} strokeWidth={1.5} />
          )}
        </div>
      ) : inView ? (
        <img
          // src/srcSet
          src={resolvedSrc}
          srcSet={srcSet}
          sizes={srcSet ? resolvedSizes : undefined}
          alt={alt}
          // loading/priority
          loading={finalLoading}
          decoding={decoding}
          // fetchPriority is not fully typed in some TS lib versions
          {...({ fetchPriority } as any)}
          // events
          onLoad={(e) => {
            setIsLoaded(true);
            onLoad?.(e);
          }}
          onError={(e) => {
            setHasError(true);
            onError?.(e);
          }}
          // styles
          className={`max-w-full block transition-opacity duration-300 ease-out ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          } ${className}`}
          style={{ maxWidth: '100%', ...style }}
          {...imgProps}
        />
      ) : (
        // not in view yet -> keep layout (containerClassName should define height/aspect)
        <div className="w-full h-full" aria-hidden="true" />
      )}
    </div>
  );
};

export default LazyImage;