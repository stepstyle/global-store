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

const normalizeImageUrl = (u?: string) => {
  const s = String(u ?? '').trim();
  return isValidUrl(s) ? s : '';
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
 * ✅ Company-grade SEO component
 * - SSR-safe (guards document/window)
 * - Robust meta/link creation & cleanup
 * - Correct robots behavior (+ cleanup of stale tags)
 * - Product OG tags added only when valid
 * - JSON-LD injection only when indexable
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
        ? 'متجرك الأول لكل ما هو حديث وتقني. نوفر لك أفضل المستلزمات القرطاسية، التعليمية، والفنية بأسلوب عصري.'
        : 'Your #1 store for modern stationery and art supplies in Jordan.',
    [language]
  );

  const fullTitle = useMemo(() => {
    const base = String(title ?? '').trim();
    if (!base) return siteName || '';
    return siteName ? `${base} | ${siteName}` : base;
  }, [title, siteName]);

  const metaDesc = useMemo(() => clampText(description || defaultDesc, 320), [description, defaultDesc]);

  const metaImage = useMemo(() => {
    const u = normalizeImageUrl(image);
    return u || 'https://picsum.photos/1200/630?random=default';
  }, [image]);

  const resolvedCurrency = useMemo(() => (currency ? String(currency).trim() : 'JOD'), [currency]);

  const ogLocale = useMemo(() => (language === 'ar' ? 'ar_JO' : 'en_US'), [language]);

  const canonical = useMemo(() => {
    if (typeof window === 'undefined') return '';

    const fallback = window.location.href;
    const candidate = canonicalUrl ? String(canonicalUrl).trim() : fallback;

    // If invalid, use fallback (still should be valid in browsers)
    return isValidUrl(candidate) ? candidate : fallback;
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

    // HTML attrs
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';

    // Canonical
    if (canonical) setOrCreateLink('canonical', canonical);
    else removeLink('canonical');

    // Standard meta
    setOrCreateMeta('viewport', 'width=device-width, initial-scale=1.0');
    setOrCreateMeta('theme-color', '#f9e032');
    setOrCreateMeta('referrer', 'strict-origin-when-cross-origin');

    // Description should exist even on noindex pages (good for sharing + previews)
    setOrCreateMeta('description', metaDesc);

    // Keywords (optional; remove when not provided or noindex)
    if (keywords && !noIndex) setOrCreateMeta('keywords', String(keywords).trim());
    else removeMeta('keywords');

    // Robots (and clean up stale variations)
    if (noIndex) {
      setOrCreateMeta('robots', 'noindex, nofollow');
      setOrCreateMeta('googlebot', 'noindex, nofollow');
      setOrCreateMeta('bingbot', 'noindex, nofollow');
    } else {
      setOrCreateMeta('robots', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
      setOrCreateMeta('googlebot', 'index, follow');
      removeMeta('bingbot');
    }

    // Open Graph (we still set for social sharing even if noindex)
    setOrCreateMeta('og:site_name', siteName, 'property');
    setOrCreateMeta('og:title', fullTitle, 'property');
    setOrCreateMeta('og:description', metaDesc, 'property');
    setOrCreateMeta('og:type', type, 'property');
    setOrCreateMeta('og:image', metaImage, 'property');
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
    setOrCreateMeta('twitter:image', metaImage);

    if (twitterHandle) setOrCreateMeta('twitter:site', twitterHandle.trim());
    else removeMeta('twitter:site');

    // JSON-LD Schema (ONLY when indexable to avoid accidental indexing hints)
    const existing = document.getElementById('seo-schema');
    if (existing) existing.remove();

    if (schema && !noIndex) {
      const script = document.createElement('script');
      script.id = 'seo-schema';
      script.type = 'application/ld+json';

      // Safer stringify (avoid crashes on circular refs)
      try {
        script.text = JSON.stringify(schema);
        document.head.appendChild(script);
      } catch {
        // If schema cannot be stringified, don't inject broken JSON-LD
      }
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