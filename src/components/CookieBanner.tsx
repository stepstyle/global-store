// src/components/CookieBanner.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import Button from './Button';
import { ShieldCheck, X } from 'lucide-react';
import { useCart } from '../App';

const { Link } = ReactRouterDOM as any;

/**
 * ✅ World-Class Cookie Banner
 * - لا يستخدم href="#"
 * - يسجّل "accepted" و "declined"
 * - قابل للتحديث بإصدار (versioned key)
 * - A11y: dialog + aria + ESC close
 * - SSR safe
 */

const COOKIE_KEY = 'anta_cookie_consent_v1'; // ✅ غيّر v1 إلى v2 إذا عدّلت سياسة الخصوصية (ليظهر البانر مجددًا)
type CookieChoice = 'accepted' | 'declined';

const safeStorage = {
  get(key: string) {
    try {
      if (typeof window === 'undefined') return null;
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
};

const scrollToTopInstant = () => {
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  } catch {
    // ignore
  }
};

const CookieBanner: React.FC = () => {
  const { t, language } = useCart() as any;

  const [show, setShow] = useState(false);

  // ✅ احترام تقليل الحركة (Accessibility)
  const prefersReducedMotion = useMemo(() => {
    try {
      if (typeof window === 'undefined') return false;
      return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const choice = safeStorage.get(COOKIE_KEY) as CookieChoice | null;

    // ✅ إذا تم اتخاذ قرار مسبقًا، لا نعرض البانر
    if (choice === 'accepted' || choice === 'declined') return;

    // ✅ تأخير بسيط (لكن بدون مبالغة)
    const id = window.setTimeout(() => setShow(true), 1200);
    return () => window.clearTimeout(id);
  }, []);

  // ✅ إغلاق بـ ESC (احترافي)
  useEffect(() => {
    if (!show) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShow(false);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);

  const accept = useCallback(() => {
    safeStorage.set(COOKIE_KEY, 'accepted');
    setShow(false);
  }, []);

  const decline = useCallback(() => {
    // ✅ مهم: نسجّل الرفض حتى ما يرجع يظهر كل مرة
    safeStorage.set(COOKIE_KEY, 'declined');
    setShow(false);
  }, []);

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-live="polite"
      className={[
        'fixed bottom-0 left-0 w-full z-[90] p-4',
        'bg-slate-900 text-white shadow-up',
        prefersReducedMotion ? '' : 'animate-in slide-in-from-bottom-full duration-500',
      ].join(' ')}
    >
      <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left: Icon + Text */}
        <div className="flex items-start md:items-center gap-3">
          <ShieldCheck size={30} className="text-secondary-DEFAULT shrink-0 mt-0.5 md:mt-0" />

          <p className="text-sm md:text-base leading-snug">
            {t('cookieText')}{' '}
            {/* ✅ بدل href="#" */}
            <Link
              to="/privacy"
              onClick={scrollToTopInstant}
              className="underline text-secondary-light hover:text-white transition-colors"
              aria-label={String(t('privacyPolicy'))}
            >
              {t('privacyPolicy')}
            </Link>
            .
          </p>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={accept}>
            {t('agree')}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={decline}
            className="border-white text-white hover:bg-white/10"
          >
            {t('decline')}
          </Button>

          {/* ✅ زر إغلاق سريع (اختياري) */}
          <button
            type="button"
            onClick={() => setShow(false)}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
            aria-label={language === 'ar' ? 'إغلاق' : 'Close'}
            title={language === 'ar' ? 'إغلاق' : 'Close'}
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CookieBanner;