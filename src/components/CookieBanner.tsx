// src/components/CookieBanner.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import Button from './Button';
import { ShieldCheck, X } from 'lucide-react';
import { useCart } from '../App';

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
  }, []);

  const decline = useCallback(() => {
    safeStorage.set(COOKIE_KEY, 'declined');
    setShow(false);
  }, []);

  useEffect(() => {
    const choice = safeStorage.get(COOKIE_KEY) as CookieChoice | null;
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

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-live="polite"
      className={[
        'fixed bottom-6 left-4 right-4 md:left-8 md:right-auto md:max-w-md z-[100]',
        'bg-slate-950/95 backdrop-blur-xl text-white shadow-2xl shadow-black/40 border border-white/10 rounded-[2rem] p-6',
        prefersReducedMotion ? '' : 'animate-in fade-in slide-in-from-bottom-10 duration-700 ease-out',
      ].join(' ')}
    >
      <div className="flex flex-col gap-5">
        {/* Header: Icon + Title + Close */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 flex items-center justify-center text-sky-400 shadow-inner">
              <ShieldCheck size={24} strokeWidth={2.5} />
            </div>
            <h3 className="font-heading font-black text-lg tracking-tight">
              {language === 'ar' ? 'خصوصيتك تهمنا' : 'Cookie Policy'}
            </h3>
          </div>
          <button
            type="button"
            onClick={decline} // تم التعديل هنا لحفظ القرار بدلاً من الإخفاء فقط
            className="p-2 rounded-xl hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
            aria-label="Close"
          >
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          <p className="text-sm font-medium text-slate-300 leading-relaxed">
            {t('cookieText')}{' '}
            <Link
              to="/privacy"
              onClick={scrollToTopInstant}
              className="text-sky-400 font-black hover:underline transition-all"
            >
              {t('privacyPolicy')}
            </Link>
            .
          </p>

          {/* Actions */}
          <div className="flex flex-row-reverse items-center gap-3">
            <Button 
              size="sm" 
              onClick={accept} 
              className="flex-1 bg-sky-500 hover:bg-sky-600 shadow-lg shadow-sky-500/20"
            >
              {t('agree')}
            </Button>
            
            <button
              onClick={decline}
              className="flex-1 px-4 py-2.5 rounded-2xl text-sm font-black text-slate-400 hover:text-white hover:bg-white/5 transition-all"
            >
              {t('decline')}
            </button>
          </div>
        </div>
      </div>

      {/* لمسة فنية: تدرج لوني خفيف خلف الأيقونة */}
      <div className="absolute -z-10 top-0 left-0 w-24 h-24 bg-sky-500/10 blur-[50px] rounded-full pointer-events-none" />
    </div>
  );
};

export default CookieBanner;