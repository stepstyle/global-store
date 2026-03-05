// src/components/SEO.tsx
import React, { useEffect, useMemo } from 'react';
import { useCart } from '../App';

type PageType = 'website' | 'product' | 'article';

interface SEOProps {
  title: string;
  description?: string;
  image?: string;
  type?: PageType;

  /** JSON-LD Schema (object or array of objects) */
  schema?: Record<string, any> | Array<Record<string, any>>;

  keywords?: string;
  price?: number;
  currency?: string;
  noIndex?: boolean;

  /** Optional overrides */
  siteName?: string;
  canonicalUrl?: string;
  twitterHandle?: string; // e.g. @brand
}

/** Basic URL validation (safe for meta/canonical) */
const isValidUrl = (u?: string) => {
  if (!u) return false;
  const s = String(u).trim();
  return /^https?:\/\//i.test(s);
};

/**
 * ✅ Make absolute URL from:
 * - absolute: keep it
 * - root-relative "/images/x": convert to "https://origin/images/x"
 * - others: return empty (avoid broken OG images)
 */
const toAbsoluteUrl = (u?: string) => {
  try {
    const s = String(u ?? '').trim();
    if (!s) return '';
    if (isValidUrl(s)) return s;

    // root relative
    if (typeof window !== 'undefined' && s.startsWith('/')) {
      return new URL(s, window.location.origin).toString();
    }

    return '';
  } catch {
    return '';
  }
};

const clampText = (v: string, max = 300) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const setOrCreateMeta = (key: string, content: string, attr: 'name' | 'property' = 'name') => {
  if (typeof document === 'undefined') return;

  const safeContent = String(content ?? '');
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;

  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }

  el.setAttribute('content', safeContent);
};

const removeMeta = (key: string, attr: 'name' | 'property' = 'name') => {
  if (typeof document === 'undefined') return;
  const el = document.querySelector(`meta[${attr}="${key}"]`);
  if (el) el.remove();
};

const setOrCreateLink = (rel: string, href: string) => {
  if (typeof document === 'undefined') return;

  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;

  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }

  el.setAttribute('href', href);
};

const removeLink = (rel: string) => {
  if (typeof document === 'undefined') return;
  const el = document.querySelector(`link[rel="${rel}"]`);
  if (el) el.remove();
};

/**
 * ✅ HashRouter canonical builder
 * مثال:
 * - window.location.href = https://site.com/#/shop?filter=Games
 * - canonical => https://site.com/shop?filter=Games
 */
const canonicalFromHashRouter = () => {
  try {
    if (typeof window === 'undefined') return '';

    const { origin, hash, pathname, search } = window.location;

    // لو ما في hash-router أصلاً، استعمل المسار العادي
    if (!hash || !hash.startsWith('#/')) {
      return new URL(pathname + search, origin).toString();
    }

    // hash content without "#"
    const hashContent = hash.slice(1); // "/shop?filter=Games"
    // نحوله إلى URL "حقيقي"
    return new URL(hashContent, origin).toString();
  } catch {
    return '';
  }
};

/**
 * ✅ Company-grade SEO component
 * - SSR-safe (guards document/window)
 * - Robust meta/link creation & cleanup
 * - Correct canonical for HashRouter
 * - Absolute OG image support
 * - JSON-LD injection supports multiple schemas + cleanup
 */
const SEO: React.FC<SEOProps> = ({
  title,
  description,
  image,
  type = 'website',
  schema,
  keywords,
  price,
  currency,
  noIndex = false,
  siteName = 'مكتبة دير شرف العلمية',
  canonicalUrl,
  twitterHandle,
}) => {
  const { language } = useCart();

  const defaultDesc = useMemo(
    () =>
      language === 'ar'
        ? 'متجر شامل للقرطاسية والألعاب والهدايا في الأردن — تجربة تسوّق سريعة وآمنة.'
        : 'A fast, secure store for stationery, toys, and gifts in Jordan.',
    [language]
  );

  const fullTitle = useMemo(() => {
    const base = String(title ?? '').trim();
    if (!base) return siteName || '';
    return siteName ? `${base} | ${siteName}` : base;
  }, [title, siteName]);

  const metaDesc = useMemo(() => clampText(description || defaultDesc, 320), [description, defaultDesc]);

  /**
   * ✅ OG image must be absolute
   * - لو مرّرت /images/... نحولها لـ absolute
   * - لو ما مرّرت image: نستخدم fallback من موقعك (غيّره لصورة شعار/غلاف رسمي)
   */
  const metaImage = useMemo(() => {
    // 1) from props
    const abs = toAbsoluteUrl(image);
    if (abs) return abs;

    // 2) fallback "رسمي" من موقعك (غيّره إذا عندك ملف ثابت)
    if (typeof window !== 'undefined') {
      return new URL('/images/og-default.webp', window.location.origin).toString();
    }

    // SSR fallback
    return '';
  }, [image]);

  const resolvedCurrency = useMemo(() => (currency ? String(currency).trim() : 'JOD'), [currency]);

  const ogLocale = useMemo(() => (language === 'ar' ? 'ar_JO' : 'en_US'), [language]);

  const canonical = useMemo(() => {
    if (typeof window === 'undefined') return '';

    // ✅ 1) لو أعطيت canonicalUrl صريح: استخدمه إذا صالح، وإلا تجاهله
    if (canonicalUrl) {
      const candidate = String(canonicalUrl).trim();
      if (isValidUrl(candidate)) return candidate;
    }

    // ✅ 2) auto from HashRouter (أفضل من window.location.href)
    const auto = canonicalFromHashRouter();
    return isValidUrl(auto) ? auto : '';
  }, [canonicalUrl]);

  const isValidPrice = useMemo(
    () => typeof price === 'number' && Number.isFinite(price) && price >= 0,
    [price]
  );

  useEffect(() => {
    // SSR guard
    if (typeof document === 'undefined') return;

    // Title
    if (fullTitle) document.title = fullTitle;

    // HTML attrs (مهم للـ accessibility و SEO)
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';

    // Canonical: إذا noIndex ممكن تتركه موجود (مفيد للمشاركة)، لكن أنا بخليه موجود طالما عندنا قيمة صحيحة
    if (canonical) setOrCreateLink('canonical', canonical);
    else removeLink('canonical');

    // Standard meta
    // ملاحظة: viewport غالبًا الأفضل يكون في public/index.html (ثابت)، لكن إبقاءه هنا لا يضر
    setOrCreateMeta('viewport', 'width=device-width, initial-scale=1.0');
    setOrCreateMeta('theme-color', '#f9e032');
    setOrCreateMeta('referrer', 'strict-origin-when-cross-origin');

    // Description
    setOrCreateMeta('description', metaDesc);

    // Keywords (اختياري)
    if (keywords && !noIndex) setOrCreateMeta('keywords', String(keywords).trim());
    else removeMeta('keywords');

    // Robots (تنظيف من قيم قديمة)
    if (noIndex) {
      setOrCreateMeta('robots', 'noindex, nofollow');
      setOrCreateMeta('googlebot', 'noindex, nofollow');
      setOrCreateMeta('bingbot', 'noindex, nofollow');
    } else {
      setOrCreateMeta('robots', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
      setOrCreateMeta('googlebot', 'index, follow');
      removeMeta('bingbot');
    }

    // Open Graph
    setOrCreateMeta('og:site_name', siteName, 'property');
    setOrCreateMeta('og:title', fullTitle, 'property');
    setOrCreateMeta('og:description', metaDesc, 'property');
    setOrCreateMeta('og:type', type, 'property');
    if (metaImage) setOrCreateMeta('og:image', metaImage, 'property');
    else removeMeta('og:image', 'property');

    setOrCreateMeta('og:locale', ogLocale, 'property');
    if (canonical) setOrCreateMeta('og:url', canonical, 'property');
    else removeMeta('og:url', 'property');

    // Product OG
    if (type === 'product' && isValidPrice) {
      setOrCreateMeta('product:price:amount', String(price), 'property');
      setOrCreateMeta('product:price:currency', resolvedCurrency, 'property');
    } else {
      removeMeta('product:price:amount', 'property');
      removeMeta('product:price:currency', 'property');
    }

    // Twitter
    setOrCreateMeta('twitter:card', 'summary_large_image');
    setOrCreateMeta('twitter:title', fullTitle);
    setOrCreateMeta('twitter:description', metaDesc);
    if (metaImage) setOrCreateMeta('twitter:image', metaImage);
    else removeMeta('twitter:image');

    // twitter handle (اختياري)
    if (twitterHandle) setOrCreateMeta('twitter:site', twitterHandle.trim());
    else removeMeta('twitter:site');

    // ✅ JSON-LD Schema
    // نزيل أي سكربتات قديمة أنشأها هذا المكوّن فقط
    const existing = Array.from(document.querySelectorAll('script[data-seo-schema="1"]'));
    existing.forEach((n) => n.remove());

    // نحقن schema فقط إذا الصفحة indexable
    if (schema && !noIndex) {
      const payload = Array.isArray(schema) ? schema : [schema];

      payload.forEach((obj, idx) => {
        try {
          const script = document.createElement('script');
          script.type = 'application/ld+json';
          script.setAttribute('data-seo-schema', '1');
          script.setAttribute('data-seo-schema-idx', String(idx));

          // ✅ safer stringify
          script.text = JSON.stringify(obj);
          document.head.appendChild(script);
        } catch {
          // ignore broken schema
        }
      });
    }
  }, [
    fullTitle,
    metaDesc,
    metaImage,
    type,
    canonical,
    language,
    schema,
    keywords,
    price,
    resolvedCurrency,
    noIndex,
    siteName,
    ogLocale,
    twitterHandle,
    isValidPrice,
  ]);

  return null;
};

export default SEO;