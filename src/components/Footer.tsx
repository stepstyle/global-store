// src/components/Footer.tsx
import React, { useCallback, useMemo, useState } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { Facebook, Instagram, Twitter, Mail, MapPin, MessageCircle } from 'lucide-react';
import Button from './Button';
import { useCart } from '../App';
import { STORE_PHONE_LOCAL, STORE_TEL_URL, STORE_WHATSAPP_URL } from '../config/contact';

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
  const isRTL = language === 'ar';

  // 🌍 دالة مساعدة لتبسيط الترجمة داخل الـ JSX
  const L = useCallback((ar: string, en: string) => (language === 'ar' ? ar : en), [language]);

  // ✅ سنة ديناميكية لحقوق النشر
  const year = useMemo(() => new Date().getFullYear(), []);

  // ✅ Newsletter: سلوك احترافي للنموذج
  const [email, setEmail] = useState('');
  const [newsletterMsg, setNewsletterMsg] = useState<string>('');

  const onSubmitNewsletter = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const v = String(email || '').trim().slice(0, 120);
      setEmail(v);

      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(v);
      if (!ok) {
        setNewsletterMsg(language === 'ar' ? 'أدخل بريدًا صحيحًا.' : 'Please enter a valid email.');
        return;
      }
      setNewsletterMsg(language === 'ar' ? 'تم الاشتراك بنجاح ✅' : 'Subscribed successfully ✅');
    },
    [email, language]
  );

  // =========================================================
  // 🏢 بيانات المتجر المركزية (غيّرها من هنا فقط وتتغير في كل الموقع)
  // =========================================================
  const STORE_INFO = useMemo(() => ({
    nameAr: 'مكتبة دير شرف العلمية',
    nameEn: 'Dair Sharaf Scientific Library',
    sloganAr: 'تنوّع، جودة، وتوصيل سريع — كل احتياجاتك في مكان واحد.',
    sloganEn: 'Variety, quality, and fast delivery — everything you need in one place.',
    addressAr: 'عمّان - دوار النزهة - مقابل بنك الأردن',
    addressEn: 'Amman - Al Nozha Circle - Opposite Bank of Jordan',
    deliveryAr: 'من 12 ساعة إلى 48 ساعة لجميع محافظات الأردن',
    deliveryEn: '12 to 48 hours delivery across Jordan',
    freeShippingAr: 'الشحن المجاني للطلبات فوق 20 دينار',
    freeShippingEn: 'Free shipping for orders over 20 JOD',
    paymentAr: 'الدفع: كاش أو تحويل عن طريق كليك',
    paymentEn: 'Payment: Cash or CliQ transfer',
    phoneDisplay: STORE_PHONE_LOCAL,
    phoneTel: STORE_TEL_URL,
    email: 'support@deirsharaf.com',
    social: {
      whatsapp: STORE_WHATSAPP_URL,
      facebook: 'https://www.facebook.com/maktabatdayrsharafaleilmia/',
      instagram: 'https://www.instagram.com/deirsharaf/',
      maps: 'https://maps.app.goo.gl/JeK1tvF4jysnLgjM9?g_st=iw'
    }
  }), []);

  // روابط المتجر السريعة
  const internalLinks = useMemo(() => ({
    shop: '/shop',
    offers: '/shop?filter=Offers',
    games: '/shop?filter=Games',
    stationery: '/shop?filter=Stationery',
    about: '/about',
    contact: '/contact',
  }), []);

  return (
    <footer className="mt-0 bg-ink-950 text-ink-100 text-start font-sans relative overflow-hidden">
      {/* الشريط الملون في أعلى الفوتر */}
      <div className="w-full h-1 bg-gradient-to-r from-gold-600 via-gold-300 to-gold-600" />

      <div className="container mx-auto px-4 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          
          {/* 1️⃣ الشعار والنشرة البريدية (مدمجة هنا لتوفير المساحة وتشجيع الاشتراك) */}
          <div>
            <div className="flex items-center gap-3"><span className="w-12 h-12 rounded-2xl bg-white/5 ring-1 ring-gold-400/40 flex items-center justify-center font-heading font-bold text-2xl text-gold-300">{isRTL ? 'د' : 'D'}</span><h3 className="text-[22px] font-heading font-bold text-white leading-tight">{L(STORE_INFO.nameAr, STORE_INFO.nameEn)}</h3></div>
            <p className="mt-3 text-sm text-ink-200 leading-relaxed mb-6">
              {L(STORE_INFO.sloganAr, STORE_INFO.sloganEn)}
            </p>

            <h4 className="text-white font-bold mb-3 text-sm">{L('اشترك ليصلك كل جديد', 'Subscribe to our newsletter')}</h4>
            <form className="flex flex-col gap-2" onSubmit={onSubmitNewsletter}>
              <label className="sr-only" htmlFor="newsletter-email">Email</label>
              <div className="relative">
                <input
                  id="newsletter-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => { setNewsletterMsg(''); setEmail(e.target.value); }}
                  placeholder={L('بريدك الإلكتروني...', 'Your email address...')}
                  className="w-full bg-white/5 border border-white/10 rounded-xl ps-4 pe-24 py-2.5 text-sm focus:ring-2 focus:ring-secondary-DEFAULT outline-none text-white transition-all placeholder:text-slate-500"
                />
                <button 
                  type="submit"
                  className="absolute top-1 end-1 bottom-1 bg-gold-500 hover:bg-gold-600 text-white text-xs font-bold px-3 rounded-lg transition-colors"
                >
                  {L('اشترك', 'Subscribe')}
                </button>
              </div>
              {newsletterMsg && (
                <p className="text-xs font-semibold text-green-400 mt-1" dir={isRTL ? 'rtl' : 'ltr'}>
                  {newsletterMsg}
                </p>
              )}
            </form>
          </div>

          {/* 2️⃣ معلومات المتجر وطرق التواصل */}
          <div>
            <h4 className="text-gold-300 font-heading font-semibold mb-5 text-[15px]">{L('معلومات المتجر', 'Store Info')}</h4>
            <ul className="space-y-3 text-sm text-ink-200">
              <li className="flex items-start gap-2">
                <MapPin size={16} className="text-slate-500 mt-0.5 shrink-0" />
                <span>{L(STORE_INFO.addressAr, STORE_INFO.addressEn)}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-slate-500 shrink-0">🚚</span>
                <span>{L(STORE_INFO.deliveryAr, STORE_INFO.deliveryEn)}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-slate-500 shrink-0">💳</span>
                <span>{L(STORE_INFO.paymentAr, STORE_INFO.paymentEn)}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-slate-500 shrink-0">🎁</span>
                <span>{L(STORE_INFO.freeShippingAr, STORE_INFO.freeShippingEn)}</span>
              </li>
            </ul>

            {/* الأيقونات الاجتماعية */}
            <div className="mt-5 flex items-center gap-3">
              {[
                { href: STORE_INFO.social.whatsapp, icon: MessageCircle, color: '#25D366', label: 'WhatsApp' },
                { href: STORE_INFO.social.instagram, icon: Instagram, color: '#E1306C', label: 'Instagram' },
                { href: STORE_INFO.social.facebook, icon: Facebook, color: '#1877F2', label: 'Facebook' },
                { href: STORE_INFO.social.maps, icon: MapPin, color: '#EA4335', label: 'Maps' }
              ].map((item, idx) => (
                <a key={idx} href={item.href} target="_blank" rel="noreferrer" aria-label={item.label} className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/15 hover:scale-105 transition-all">
                  <item.icon size={16} style={{ color: item.color }} />
                </a>
              ))}
            </div>
          </div>

          {/* 3️⃣ روابط سريعة */}
          <div>
            <h4 className="text-gold-300 font-heading font-semibold mb-5 text-[15px]">{L('روابط سريعة', 'Quick Links')}</h4>
            <ul className="space-y-2.5 text-sm flex flex-col">
              {[
                { label: L('تسوق جميع المنتجات', 'Shop All Products'), to: internalLinks.shop },
                { label: L('شاهد العروض الخاصة', 'View Special Offers'), to: internalLinks.offers },
                { label: L('قسم الألعاب', 'Games Section'), to: internalLinks.games },
                { label: L('قسم القرطاسية', 'Stationery Section'), to: internalLinks.stationery },
                { label: L('عن المتجر', 'About Us'), to: internalLinks.about },
                { label: L('تواصل معنا', 'Contact Us'), to: internalLinks.contact },
              ].map((link, idx) => (
                <li key={idx}>
                  <Link to={link.to} onClick={scrollToTopInstant} className="inline-block text-ink-200 hover:text-gold-300 hover:translate-x-1 rtl:hover:-translate-x-1 transition-all">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* 4️⃣ السياسات (مدمجة كـ Accordion لتوفير المساحة) */}
          <div>
            <h4 className="text-gold-300 font-heading font-semibold mb-5 text-[15px]">{L('السياسات', 'Policies')}</h4>
            <div className="space-y-3">
              <details className="group rounded-xl bg-white/[0.04] border border-white/10 p-3.5 transition-all open:bg-slate-800/50">
                <summary className="cursor-pointer text-sm font-semibold text-slate-200 group-hover:text-white transition-colors flex items-center justify-between outline-none">
                  {L('سياسة الإرجاع والاستبدال', 'Returns Policy')}
                  <span className="text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="mt-3 text-sm text-slate-400 leading-relaxed border-t border-white/10 pt-3">
                  <p>إرجاع أو استبدال خلال 24 ساعة في حال وجود عطل مصنعي فقط، بشرط الحفاظ على حالة المنتج والتغليف الأصلي.</p>
                </div>
              </details>

              <details className="group rounded-xl bg-white/[0.04] border border-white/10 p-3.5 transition-all open:bg-slate-800/50">
                <summary className="cursor-pointer text-sm font-semibold text-slate-200 group-hover:text-white transition-colors flex items-center justify-between outline-none">
                  {L('سياسة الخصوصية', 'Privacy Policy')}
                  <span className="text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="mt-3 text-sm text-slate-400 leading-relaxed border-t border-white/10 pt-3">
                  <p>بياناتك محمية تماماً ونستخدمها فقط لإتمام الطلب وتوصيله. لا نقوم ببيع أو مشاركة بياناتك مع أي أطراف إعلانية خارجية.</p>
                </div>
              </details>
            </div>
          </div>

        </div>

        {/* =========================
            ✅ الشريط السفلي (حقوق النشر)
           ========================= */}
        <div className="mt-12 pt-6 border-t border-white/10 flex flex-col md:flex-row justify-between items-center text-xs text-slate-500 gap-4">
          <p className="text-center md:text-start order-2 md:order-1">
            © {year} {L(STORE_INFO.nameAr, STORE_INFO.nameEn)}. {L('جميع الحقوق محفوظة.', 'All rights reserved.')}
          </p>

          <div className="flex flex-wrap justify-center gap-4 sm:gap-6 items-center order-1 md:order-2">
            <a href={STORE_INFO.phoneTel} className="flex items-center gap-1.5 hover:text-ink-200 transition-colors" aria-label="Call support">
              <span>📞</span>
              <span dir="ltr" className="font-semibold tracking-wider">{STORE_INFO.phoneDisplay}</span>
            </a>

            <a href={`mailto:${STORE_INFO.email}`} className="flex items-center gap-1.5 hover:text-ink-200 transition-colors" aria-label="Email support">
              <Mail size={14} />
              <span>{STORE_INFO.email}</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;