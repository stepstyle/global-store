// src/components/Footer.tsx
import React, { useCallback, useMemo, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { Facebook, Instagram, Twitter, Mail, MapPin } from 'lucide-react';
import Button from './Button';
import { useCart } from '../App';

const { Link } = ReactRouterDOM as any;

/** ✅ فتح أي صفحة من الأعلى (حل عالمي لسلوك الرواتر/الهاش) */
const scrollToTopInstant = () => {
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  } catch {
    // ignore
  }
};

const Footer: React.FC = () => {
  const { t, language } = useCart() as any;

  // ✅ سنة ديناميكية (بدل 2023 ثابت)
  const year = useMemo(() => new Date().getFullYear(), []);

  // ✅ Newsletter: سلوك احترافي (بدون reload + تحقق بسيط)
  const [email, setEmail] = useState('');
  const [newsletterMsg, setNewsletterMsg] = useState<string>('');

  const isRTL = language === 'ar';

  const onSubmitNewsletter = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const v = String(email || '').trim().slice(0, 120); // ✅ حد أقصى لتجنب إدخال مبالغ فيه
      setEmail(v);

      // ✅ تحقق بسيط (مش بديل عن التحقق بالسيرفر)
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(v);
      if (!ok) {
        setNewsletterMsg(language === 'ar' ? 'أدخل بريدًا صحيحًا.' : 'Please enter a valid email.');
        return;
      }

      // ✅ هنا لاحقًا تربطه بـ API (Mailchimp/Sendgrid/…)
      setNewsletterMsg(language === 'ar' ? 'تم الاشتراك بنجاح ✅' : 'Subscribed successfully ✅');
    },
    [email, language]
  );

  // ✅ روابط داخلية (React Router) — غيّر المسارات حسب صفحاتك الحقيقية
  const internalLinks = useMemo(
    () => ({
      about: '/about',
      blog: '/blog',
      careers: '/careers',
      privacy: '/privacy',
      terms: '/terms',
      shop: '/shop',
      offers: '/shop?filter=Offers',
      courses: '/shop?filter=Courses', // إذا عندك Courses فعلاً، غيرها
    }),
    []
  );

  // ✅ روابط خارجية (ضع روابطك الحقيقية)
  const externalLinks = useMemo(
    () => ({
      facebook: 'https://www.facebook.com/',
      instagram: 'https://www.instagram.com/',
      twitter: 'https://twitter.com/',
      email: 'mailto:support@antastore.com',
      maps: 'https://maps.google.com/?q=Riyadh',
    }),
    []
  );

  return (
    <footer className="bg-slate-900 text-slate-300 pt-0 pb-8 font-sans relative">
      {/* ✅ Theme Gradient Strip (هوية بصرية) */}
      <div className="w-full h-2 bg-gradient-to-r from-primary-DEFAULT to-secondary-DEFAULT" />

      <div className="pt-10 md:pt-16 container mx-auto px-4 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 mb-8 md:mb-12">
          {/* =========================
              ✅ Brand + Social
             ========================= */}
          <div className="col-span-1 sm:col-span-2 md:col-span-1">
            <Link
              to="/"
              onClick={scrollToTopInstant}
              className="flex items-center gap-2 mb-6"
              aria-label="Home"
              title="Home"
            >
              <div className="w-8 h-8 bg-gradient-to-tr from-primary-DEFAULT to-secondary-DEFAULT rounded-lg flex items-center justify-center text-white font-bold">
                A
              </div>
              <span className="text-2xl font-heading font-bold text-white">Anta Store</span>
            </Link>

            <p className="text-sm leading-relaxed mb-6 text-slate-400">{t('footerDesc')}</p>

            {/* ✅ Social: روابط خارجية فقط + أمان target */}
            <div className="flex gap-4">
              <a
                href={externalLinks.facebook}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook"
                className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-secondary-DEFAULT hover:text-white transition-all"
              >
                <Facebook size={18} />
              </a>

              <a
                href={externalLinks.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-pink-600 hover:text-white transition-all"
              >
                <Instagram size={18} />
              </a>

              <a
                href={externalLinks.twitter}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Twitter"
                className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-sky-500 hover:text-white transition-all"
              >
                <Twitter size={18} />
              </a>
            </div>
          </div>

          {/* =========================
              ✅ Quick Links (داخلية)
             ========================= */}
          <div>
            <h4 className="text-white font-bold mb-6 text-lg">{t('quickLinks')}</h4>

            {/* ✅ بدل href="#" => Link سريع + بدون reload */}
            <ul className="space-y-3 text-sm">
              <li>
                <Link to={internalLinks.about} onClick={scrollToTopInstant} className="hover:text-primary-DEFAULT transition-colors">
                  {t('aboutUs')}
                </Link>
              </li>
              <li>
                <Link to={internalLinks.blog} onClick={scrollToTopInstant} className="hover:text-primary-DEFAULT transition-colors">
                  {t('blog')}
                </Link>
              </li>
              <li>
                <Link to={internalLinks.careers} onClick={scrollToTopInstant} className="hover:text-primary-DEFAULT transition-colors">
                  {t('careers')}
                </Link>
              </li>
              <li>
                <Link to={internalLinks.privacy} onClick={scrollToTopInstant} className="hover:text-primary-DEFAULT transition-colors">
                  {t('privacyPolicy')}
                </Link>
              </li>
              <li>
                <Link to={internalLinks.terms} onClick={scrollToTopInstant} className="hover:text-primary-DEFAULT transition-colors">
                  {t('terms')}
                </Link>
              </li>
            </ul>
          </div>

          {/* =========================
              ✅ Categories (داخلية)
             ========================= */}
          <div>
            <h4 className="text-white font-bold mb-6 text-lg">{t('shopping')}</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link to={internalLinks.shop} onClick={scrollToTopInstant} className="hover:text-primary-DEFAULT transition-colors">
                  {t('shop')}
                </Link>
              </li>
              <li>
                <Link to={internalLinks.offers} onClick={scrollToTopInstant} className="hover:text-primary-DEFAULT transition-colors">
                  {t('offers')}
                </Link>
              </li>
              <li>
                <Link to={internalLinks.courses} onClick={scrollToTopInstant} className="hover:text-primary-DEFAULT transition-colors">
                  {t('courses')}
                </Link>
              </li>
            </ul>
          </div>

          {/* =========================
              ✅ Newsletter (بدون reload)
             ========================= */}
          <div className="col-span-1 sm:col-span-2 md:col-span-1">
            <h4 className="text-white font-bold mb-6 text-lg">{t('newsletter')}</h4>
            <p className="text-sm mb-4 text-slate-400">{t('newsletterDesc')}</p>

            <form className="flex flex-col gap-2" onSubmit={onSubmitNewsletter}>
              <label className="sr-only" htmlFor="newsletter-email">
                Email
              </label>

              <input
                id="newsletter-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setNewsletterMsg('');
                  setEmail(e.target.value);
                }}
                placeholder={t('emailPlaceholder')}
                className="bg-slate-800 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-secondary-DEFAULT outline-none text-white"
              />

              <Button variant="primary" type="submit">
                {t('subscribe')}
              </Button>

              {/* ✅ رسالة صغيرة للمستخدم */}
              {newsletterMsg ? (
                <p className="text-xs font-semibold text-slate-200 mt-1" dir={isRTL ? 'rtl' : 'ltr'}>
                  {newsletterMsg}
                </p>
              ) : null}
            </form>

            {/* ✅ تلميح قانوني بسيط (اختياري) */}
            <p className="text-[11px] text-slate-500 mt-3">
              {language === 'ar'
                ? 'لن نرسل رسائل مزعجة. يمكنك إلغاء الاشتراك بأي وقت.'
                : 'No spam. Unsubscribe anytime.'}
            </p>
          </div>
        </div>

        {/* =========================
            ✅ Bottom Bar
           ========================= */}
        <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center text-xs text-slate-500 gap-4 md:gap-0">
          <p className="text-center md:text-left">
            © {year} Anta Store. {t('rightsReserved')}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 items-center">
            <a
              href={externalLinks.maps}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:text-slate-200 transition-colors"
              aria-label="Open location in maps"
            >
              <MapPin size={14} />
              <span>Riyadh, Saudi Arabia</span>
            </a>

            <a
              href={externalLinks.email}
              className="flex items-center gap-2 hover:text-slate-200 transition-colors"
              aria-label="Email support"
            >
              <Mail size={14} />
              <span>support@antastore.com</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;