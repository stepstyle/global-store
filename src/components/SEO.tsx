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

// 🌐 التحقق من صحة الرابط
const isValidUrl = (u?: string) => {
  if (!u) return false;
  const s = String(u).trim();
  return /^https?:\/\//i.test(s);
};

// 🌐 تحويل الروابط النسبية إلى روابط كاملة (مهم جداً لصور المشاركة Open Graph)
const toAbsoluteUrl = (u?: string) => {
  try {
    const s = String(u ?? '').trim();
    if (!s) return '';
    if (isValidUrl(s)) return s;

    if (typeof window !== 'undefined' && s.startsWith('/')) {
      return new URL(s, window.location.origin).toString();
    }
    return '';
  } catch {
    return '';
  }
};

// ✂️ قص النصوص الطويلة لتناسب محركات البحث (حد أقصى 160-300 حرف)
const clampText = (v: string, max = 300) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

// 🛠️ دالة مساعدة لإنشاء أو تحديث وسوم الـ Meta
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

// 🧹 دالة مساعدة لحذف وسوم الـ Meta
const removeMeta = (key: string, attr: 'name' | 'property' = 'name') => {
  if (typeof document === 'undefined') return;
  const el = document.querySelector(`meta[${attr}="${key}"]`);
  if (el) el.remove();
};

// 🔗 دالة مساعدة لإنشاء أو تحديث وسوم الـ Link (مثل Canonical و hreflang)
const setOrCreateLink = (rel: string, href: string, hreflang?: string) => {
  if (typeof document === 'undefined') return;

  // البحث عن الرابط بناءً على rel (و hreflang إن وجد حتى لا تتداخل اللغات)
  const selector = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]`;
  let el = document.querySelector(selector) as HTMLLinkElement | null;

  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    if (hreflang) el.setAttribute('hreflang', hreflang);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
};

// 🧹 دالة مساعدة لحذف وسوم الـ Link
const removeLink = (rel: string, hreflang?: string) => {
  if (typeof document === 'undefined') return;
  const selector = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]`;
  const el = document.querySelector(selector);
  if (el) el.remove();
};

// 📍 معالجة الرابط الأساسي (Canonical) في حال استخدام HashRouter
const canonicalFromHashRouter = () => {
  try {
    if (typeof window === 'undefined') return '';
    const { origin, hash, pathname, search } = window.location;

    if (!hash || !hash.startsWith('#/')) {
      return new URL(pathname + search, origin).toString();
    }
    const hashContent = hash.slice(1);
    return new URL(hashContent, origin).toString();
  } catch {
    return '';
  }
};

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

  // 📝 الوصف الافتراضي متجاوب مع اللغتين
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

  const metaDesc = useMemo(() => clampText(description || defaultDesc, 160), [description, defaultDesc]); // ✅ جوجل يفضل 160 حرف للوصف

  const metaImage = useMemo(() => {
    const abs = toAbsoluteUrl(image);
    if (abs) return abs;
    if (typeof window !== 'undefined') {
      return new URL('/images/og-default.webp', window.location.origin).toString();
    }
    return '';
  }, [image]);

  const resolvedCurrency = useMemo(() => (currency ? String(currency).trim() : 'JOD'), [currency]);
  const ogLocale = useMemo(() => (language === 'ar' ? 'ar_JO' : 'en_US'), [language]);

  const canonical = useMemo(() => {
    if (typeof window === 'undefined') return '';
    if (canonicalUrl) {
      const candidate = String(canonicalUrl).trim();
      if (isValidUrl(candidate)) return candidate;
    }
    const auto = canonicalFromHashRouter();
    return isValidUrl(auto) ? auto : '';
  }, [canonicalUrl]);

  const isValidPrice = useMemo(() => typeof price === 'number' && Number.isFinite(price) && price >= 0, [price]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // 1️⃣ إعدادات الصفحة الأساسية
    if (fullTitle) document.title = fullTitle;
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';

    // 2️⃣ الروابط الأساسية (Canonical & Hreflang)
    if (canonical) {
      setOrCreateLink('canonical', canonical);
      // إخبار جوجل بلغة الصفحة الحالية لتجنب مشكلة المحتوى المكرر
      setOrCreateLink('alternate', canonical, language); 
    } else {
      removeLink('canonical');
      removeLink('alternate', language);
    }

    // 3️⃣ وسوم Meta القياسية
    setOrCreateMeta('viewport', 'width=device-width, initial-scale=1.0');
    setOrCreateMeta('theme-color', '#f9e032');
    setOrCreateMeta('referrer', 'strict-origin-when-cross-origin');
    setOrCreateMeta('description', metaDesc);

    if (keywords && !noIndex) setOrCreateMeta('keywords', String(keywords).trim());
    else removeMeta('keywords');

    // 4️⃣ التحكم بعناكب البحث (Robots)
    if (noIndex) {
      setOrCreateMeta('robots', 'noindex, nofollow');
      setOrCreateMeta('googlebot', 'noindex, nofollow');
      setOrCreateMeta('bingbot', 'noindex, nofollow');
    } else {
      setOrCreateMeta('robots', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
      setOrCreateMeta('googlebot', 'index, follow');
      removeMeta('bingbot');
    }

    // 5️⃣ وسوم المشاركة (Open Graph)
    setOrCreateMeta('og:site_name', siteName, 'property');
    setOrCreateMeta('og:title', fullTitle, 'property');
    setOrCreateMeta('og:description', metaDesc, 'property');
    setOrCreateMeta('og:type', type, 'property');
    setOrCreateMeta('og:locale', ogLocale, 'property');
    
    if (metaImage) setOrCreateMeta('og:image', metaImage, 'property');
    else removeMeta('og:image', 'property');

    if (canonical) setOrCreateMeta('og:url', canonical, 'property');
    else removeMeta('og:url', 'property');

    // بيانات المنتجات للمشاركة
    if (type === 'product' && isValidPrice) {
      setOrCreateMeta('product:price:amount', String(price), 'property');
      setOrCreateMeta('product:price:currency', resolvedCurrency, 'property');
    } else {
      removeMeta('product:price:amount', 'property');
      removeMeta('product:price:currency', 'property');
    }

    // 6️⃣ وسوم منصة X (تويتر سابقاً)
    setOrCreateMeta('twitter:card', 'summary_large_image');
    setOrCreateMeta('twitter:title', fullTitle);
    setOrCreateMeta('twitter:description', metaDesc);
    if (metaImage) setOrCreateMeta('twitter:image', metaImage);
    else removeMeta('twitter:image');
    if (twitterHandle) setOrCreateMeta('twitter:site', twitterHandle.trim());
    else removeMeta('twitter:site');

    // 7️⃣ البيانات المهيكلة (JSON-LD Schema)
    // مسح السكربتات القديمة لتجنب تكرارها
    const clearSchemas = () => {
      const existing = Array.from(document.querySelectorAll('script[data-seo-schema="1"]'));
      existing.forEach((n) => n.remove());
    };
    
    clearSchemas();

    if (schema && !noIndex) {
      const payload = Array.isArray(schema) ? schema : [schema];
      payload.forEach((obj, idx) => {
        try {
          const script = document.createElement('script');
          script.type = 'application/ld+json';
          script.setAttribute('data-seo-schema', '1');
          script.setAttribute('data-seo-schema-idx', String(idx));
          script.text = JSON.stringify(obj);
          document.head.appendChild(script);
        } catch {
          // تجاهل الأخطاء الصامتة للسكربت
        }
      });
    }

    // 🧹 التنظيف عند الخروج من الصفحة (Cleanup Function) - مهم جداً للأداء والـ SEO!
    return () => {
      clearSchemas(); // يمنع تسرب بيانات المنتجات لصفحات أخرى
    };
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