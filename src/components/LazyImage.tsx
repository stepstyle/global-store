// src/components/LazyImage.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
// 🚀 تم استدعاء ImageIcon عشان شاشة التحميل (Skeleton)
import { ImageOff, ImageIcon } from 'lucide-react';

type FetchPriority = 'high' | 'low' | 'auto';

interface LazyImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'loading' | 'src'> {
  src?: string | null;

  // container / placeholder
  containerClassName?: string;
  placeholderClassName?: string;

  // fallback
  fallbackSrc?: string;

  // perf
  fetchPriority?: FetchPriority;
  eager?: boolean;
  responsiveWidths?: number[];
  sizes?: string;
  cloudinarySize?: number;
  expectedDisplayWidth?: number;
  loading?: 'lazy' | 'eager';
  rootMargin?: string;

  // ✅ CLS guard (اختياري)
  widthHint?: number;
  heightHint?: number;
  aspectRatioHint?: string; // مثال: "1 / 1" أو "3 / 2"
}

// ---------------------------
// ✅ Helpers
// ---------------------------
const isValidUrl = (u?: string) => {
  if (!u) return false;
  const s = String(u).trim();
  return /^https?:\/\//i.test(s) || s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('/');
};

const looksLikeCloudinaryTransform = (firstSegment: string) => {
  const s = String(firstSegment || '').trim();
  if (!s) return false;
  if (s.includes(',')) return true;
  return /^(c_|w_|h_|q_|f_|dpr_|ar_|g_|b_|e_)/.test(s);
};

const cloudinaryTransform = (url: string, w?: number, h?: number, mode?: 'limit' | 'fill') => {
  try {
    if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;

    const [base, restRaw] = url.split('/upload/');
    if (!base || !restRaw) return url;

    const restParts = restRaw.split('/');
    const first = restParts[0] || '';

    // إذا فيه transformations مسبقاً، لا نلمس الرابط
    if (looksLikeCloudinaryTransform(first)) return url;

    /**
     * ✅ iOS-safe:
     * 🚀 تم التعديل لتسريع الصور: استخدام f_auto و q_auto:eco لتقليل الحجم بشكل هائل
     */
    const t: string[] = ['f_auto', 'q_auto:eco', 'dpr_auto'];

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

const picsumWebp = (url: string) => {
  try {
    if (!url.includes('picsum.photos') || url.includes('.webp')) return url;
    const [baseUrl, query] = url.split('?');

    if (/\/\d+$/.test(baseUrl) || /\/\d+\/\d+$/.test(baseUrl)) {
      return `${baseUrl}.webp${query ? `?${query}` : ''}`;
    }
    return url;
  } catch {
    return url;
  }
};

// ---------------------------
// ✅ WebP support (cached globally)
// ---------------------------
let WEBP_SUPPORT_CACHE: boolean | null = null;

const detectWebPSupport = (): boolean => {
  if (typeof document === 'undefined') return false;
  if (WEBP_SUPPORT_CACHE !== null) return WEBP_SUPPORT_CACHE;

  try {
    const canvas = document.createElement('canvas');
    if (!canvas.getContext) {
      WEBP_SUPPORT_CACHE = false;
      return WEBP_SUPPORT_CACHE;
    }
    WEBP_SUPPORT_CACHE = canvas.toDataURL('image/webp').startsWith('data:image/webp');
    return WEBP_SUPPORT_CACHE;
  } catch {
    WEBP_SUPPORT_CACHE = false;
    return WEBP_SUPPORT_CACHE;
  }
};

// ---------------------------
// ✅ One-time preconnect/dns-prefetch (speeds up first image / LCP)
// ---------------------------
const PRECONNECT_DONE = new Set<string>();

const preconnectOnce = (origin: string) => {
  try {
    if (typeof document === 'undefined') return;
    if (!origin) return;
    if (PRECONNECT_DONE.has(origin)) return;

    // dns-prefetch
    const dns = document.createElement('link');
    dns.rel = 'dns-prefetch';
    dns.href = origin;
    document.head.appendChild(dns);

    // preconnect
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = origin;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);

    PRECONNECT_DONE.add(origin);
  } catch {
    // ignore
  }
};

const getOrigin = (url: string) => {
  try {
    if (!/^https?:\/\//i.test(url)) return '';
    return new URL(url).origin;
  } catch {
    return '';
  }
};

const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt = '',
  className = '',
  containerClassName = '',
  placeholderClassName = 'bg-slate-100/80', // 🚀 تم تفتيح لون شاشة التحميل ليكون أنيق
  fallbackSrc,
  fetchPriority = 'auto',
  style,
  eager = false,
  responsiveWidths = [240, 320, 480, 640, 800, 1000, 1200, 1600, 2000],
  sizes,
  cloudinarySize,
  expectedDisplayWidth,
  loading = 'lazy',
  rootMargin = '700px',
  onLoad,
  onError,
  decoding = 'async',
  widthHint,
  heightHint,
  aspectRatioHint,
  ...imgProps
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const normalizedSrc = useMemo(() => (src ? String(src).trim() : ''), [src]);

  // ✅ derived eager: إذا الصورة مهمة (LCP) نعرضها مباشرة
  const derivedEager = useMemo(() => eager || loading === 'eager' || fetchPriority === 'high', [
    eager,
    loading,
    fetchPriority,
  ]);

  const [inView, setInView] = useState<boolean>(derivedEager);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);

  // ✅ webp supported (cached globally)
  const [webpSupported, setWebpSupported] = useState(false);
  useEffect(() => {
    setWebpSupported(detectWebPSupport());
  }, []);

  // 🚀 تم حل مشكلة (لازم أروح لصفحة ثانية عشان تظهر الصورة) هنا
  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
    // تم إزالة setInView من هنا عشان ما تطفي الصورة وهي قدامك
  }, [normalizedSrc]);

  // 🚀 تحديث المراقب عشان يضل شغال
  useEffect(() => {
    if (derivedEager || inView) return;

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
  }, [derivedEager, rootMargin, inView]);

  // ✅ Only convert Picsum -> webp if supported
  const finalSrc = useMemo(() => {
    if (!normalizedSrc) return '';
    if (!webpSupported) return normalizedSrc;
    return picsumWebp(normalizedSrc);
  }, [normalizedSrc, webpSupported]);

  const isCloudinary = useMemo(
    () => finalSrc.includes('res.cloudinary.com') && finalSrc.includes('/upload/'),
    [finalSrc]
  );

  // ✅ preconnect for LCP/eager images (only once)
  useEffect(() => {
    if (!finalSrc) return;
    // نعمل preconnect دائماً للصورة الأولى (حتى لو مش eager) لأنك حكيت أول فتح بطيء
    // لكنه still one-time + safe
    const origin = getOrigin(finalSrc);
    if (origin) preconnectOnce(origin);
  }, [finalSrc]);

  const resolvedSizes = useMemo(() => {
    if (!isCloudinary) return sizes;
    if (sizes) return sizes;

    if (expectedDisplayWidth && expectedDisplayWidth > 0) {
      const mobile = Math.min(expectedDisplayWidth, 768);
      return `(max-width: 768px) ${mobile}px, ${expectedDisplayWidth}px`;
    }

    // default: responsive
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
      // cap at 2x display width for quality (LCP friendly)
      const cap = Math.max(700, Math.min(expectedDisplayWidth * 2, 2200));
      return cloudinaryTransform(finalSrc, cap, undefined, 'limit');
    }

    return finalSrc;
  }, [finalSrc, isCloudinary, cloudinarySize, expectedDisplayWidth]);

  const showFallback = useMemo(() => hasError && isValidUrl(fallbackSrc), [hasError, fallbackSrc]);

  const finalLoading: 'lazy' | 'eager' = derivedEager ? 'eager' : 'lazy';
  const noSrc = !normalizedSrc;

  // ✅ CLS guard style (اختياري)
  const clsStyle = useMemo<React.CSSProperties>(() => {
    const s: React.CSSProperties = {};
    if (typeof widthHint === 'number' && widthHint > 0) s.width = widthHint;
    if (typeof heightHint === 'number' && heightHint > 0) s.height = heightHint;
    if (aspectRatioHint) (s as any).aspectRatio = aspectRatioHint;
    return s;
  }, [widthHint, heightHint, aspectRatioHint]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${containerClassName}`}
      style={{ ...clsStyle }}
    >
      {/* 🚀 إضافة الأيقونة لشاشة التحميل */}
      {!hasError && !isLoaded && (
        <div className={`absolute inset-0 flex items-center justify-center ${placeholderClassName} animate-pulse`} aria-hidden="true">
          <ImageIcon size={32} className="text-slate-300 opacity-50" strokeWidth={1.5} />
        </div>
      )}

      {noSrc ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 backdrop-blur-sm text-slate-300">
          <ImageOff size={28} strokeWidth={1.5} className="opacity-60" />
        </div>
      ) : hasError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 backdrop-blur-sm text-slate-300">
          {showFallback ? (
            <img
              src={String(fallbackSrc)}
              alt={alt}
              className="w-full h-full object-cover block"
              style={{ width: '100%', height: '100%', display: 'block' }}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <ImageOff size={28} strokeWidth={1.5} className="opacity-60" />
          )}
        </div>
      ) : inView ? (
        <img
          src={resolvedSrc}
          srcSet={srcSet}
          sizes={srcSet ? resolvedSizes : undefined}
          alt={alt}
          loading={finalLoading}
          decoding={decoding}
          {...({ fetchPriority } as any)}
          onLoad={(e) => {
            setIsLoaded(true);
            onLoad?.(e);
          }}
          onError={(e) => {
            setHasError(true);
            onError?.(e);
          }}
          className={`w-full h-full block transition-opacity duration-500 ease-out ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          } ${className}`}
          style={{ width: '100%', height: '100%', display: 'block', ...style }}
          {...imgProps}
        />
      ) : (
        <div className="w-full h-full" aria-hidden="true" />
      )}
    </div>
  );
};

export default LazyImage;