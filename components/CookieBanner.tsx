import React, { useState, useEffect } from 'react';
import Button from './Button';
import { ShieldCheck } from 'lucide-react';
import { useCart } from '../App';

const CookieBanner: React.FC = () => {
  const [show, setShow] = useState(false);
  const { t } = useCart();

  useEffect(() => {
    const accepted = localStorage.getItem('cookiesAccepted');
    if (!accepted) {
      setTimeout(() => setShow(true), 2000);
    }
  }, []);

  const accept = () => {
    localStorage.setItem('cookiesAccepted', 'true');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-0 left-0 w-full bg-slate-900 text-white z-[90] p-4 shadow-up animate-in slide-in-from-bottom-full duration-500">
      <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck size={32} className="text-secondary-DEFAULT shrink-0" />
          <p className="text-sm md:text-base leading-snug">
            {t('cookieText')} <a href="#" className="underline text-secondary-light">{t('privacyPolicy')}</a>.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" onClick={accept}>{t('agree')}</Button>
          <Button size="sm" variant="outline" onClick={() => setShow(false)} className="border-white text-white hover:bg-white/10">{t('decline')}</Button>
        </div>
      </div>
    </div>
  );
};

export default CookieBanner;