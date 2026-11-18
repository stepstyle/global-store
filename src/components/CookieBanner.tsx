// src/components/CookieBanner.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useCart } from '../App';
import { loadTracking } from '../services/tracking';

const { Link } = ReactRouterDOM as any;

const COOKIE_KEY = 'anta_cookie_consent_v1';
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

  const prefersReducedMotion = useMemo(() => {
    try {
      if (typeof window === 'undefined') return false;
      return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    } catch {
      return false;
    }
  }, []);

  const accept = useCallback(() => {
    safeStorage.set(COOKIE_KEY, 'accepted');
    setShow(false);
    loadTracking(); // analytics start only now, after consent
  }, []);

  const decline = useCallback(() => {
    safeStorage.set(COOKIE_KEY, 'declined');
    setShow(false);
  }, []);

  useEffect(() => {
    const choice = safeStorage.get(COOKIE_KEY) as CookieChoice | null;
    // Accepted on an earlier visit → load analytics. Declined or no choice yet → nothing is loaded.
    if (choice === 'accepted') loadTracking();
    if (choice === 'accepted' || choice === 'declined') return;

    // تأخير الظهور قليلاً ليعطي فرصة للمحتوى الأساسي بالتحميل
    const id = window.setTimeout(() => setShow(true), 2500);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') decline(); // تم التعديل هنا لحفظ القرار
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, decline]); // أضفنا decline للمصفوفة

  // lets other bottom-docked controls (the shopping assistant button) move above the bar while it is shown
  useEffect(() => {
    if (!show) return;
    document.documentElement.setAttribute('data-cookie-bar', '');
    return () => document.documentElement.removeAttribute('data-cookie-bar');
  }, [show]);

  if (!show) return null;

  // Compact bar docked to the bottom edge: one short line + two buttons, so it never covers the page content
  // (the previous card covered about half of a phone screen). Same storage key and same accept/decline behaviour.
  return (
    <div
      role="region"
      aria-label={language === 'ar' ? 'ملفات تعريف الارتباط' : 'Cookies'}
      aria-live="polite"
      className={[
        'fixed inset-x-0 bottom-0 z-[100] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none',
        'md:inset-x-auto md:start-6 md:bottom-6 md:px-0 md:pb-0 md:max-w-lg',
        prefersReducedMotion ? '' : 'animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out',
      ].join(' ')}
    >
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-2xl bg-ink/95 backdrop-blur-md text-white shadow-xl shadow-black/25 border border-white/10 ps-3.5 pe-2 py-2">
        <ShieldCheck size={18} strokeWidth={2.5} className="shrink-0 text-secondary-light" aria-hidden="true" />
        <p className="flex-1 min-w-0 text-[12.5px] leading-snug text-slate-200">
          {language === 'ar'
            ? 'نستخدم ملفات الارتباط لتحسين تجربتك وتحليل الزيارات والإعلانات.'
            : 'We use cookies to improve your experience, analyse traffic and personalise ads.'}{' '}
          <Link
            to="/privacy"
            onClick={scrollToTopInstant}
            className="text-secondary-light font-bold underline-offset-2 hover:underline"
          >
            {t('privacyPolicy')}
          </Link>
        </p>
        <button
          type="button"
          onClick={decline}
          className="shrink-0 h-10 px-3 rounded-xl text-[13px] font-bold text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
        >
          {t('decline')}
        </button>
        <button
          type="button"
          onClick={accept}
          className="shrink-0 h-10 px-4 rounded-xl text-[13px] font-extrabold bg-primary-DEFAULT text-ink hover:bg-primary-dark transition-colors"
        >
          {t('agree')}
        </button>
      </div>
    </div>
  );
};

export default CookieBanner;