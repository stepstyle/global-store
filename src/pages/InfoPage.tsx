// src/pages/InfoPage.tsx — /about, /contact, /privacy (the footer and the cookie banner link here; before, these
// routes did not exist and silently fell back to the home page). Only facts already published on the site.
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MapPin, MessageCircle, Phone, Mail, ShieldCheck, RefreshCw, Truck, Wallet } from 'lucide-react';
import { useCart } from '../App';
import SEO from '../components/SEO';
import { STORE_PHONE_LOCAL, STORE_TEL_URL, STORE_WHATSAPP_URL } from '../config/contact';

const InfoPage: React.FC = () => {
  const { language } = useCart() as any;
  const L = (ar: string, en: string) => ((language ?? 'ar') === 'ar' ? ar : en);
  const page = useLocation().pathname.replace('/', '') as 'about' | 'contact' | 'privacy';
  const titles = { about: L('عن المكتبة', 'About us'), contact: L('تواصل معنا', 'Contact us'), privacy: L('السياسات والخصوصية', 'Policies & privacy') };
  const tabs: Array<['about' | 'contact' | 'privacy', string]> = [['about', titles.about], ['contact', titles.contact], ['privacy', titles.privacy]];

  return (
    <div className="bg-paper min-h-[70vh]">
      <SEO title={titles[page] || titles.about} />
      <section className="bg-ink-900 text-white">
        <div className="ds-container py-10 sm:py-14">
          <div className="ds-eyebrow !text-gold-300 mb-2"><span className="w-6 h-px bg-gold-300" />{L('مكتبة دير شرف العلمية', 'Dair Sharaf Library')}</div>
          <h1 className="font-heading font-bold text-3xl sm:text-4xl">{titles[page] || titles.about}</h1>
          <div className="flex gap-2 mt-6 overflow-x-auto scrollbar-hide">
            {tabs.map(([k, label]) => (
              <Link key={k} to={`/${k}`} className={`shrink-0 rounded-full px-4 py-2 text-[13.5px] font-bold transition ${page === k ? 'bg-gold-400 text-ink-900' : 'bg-white/10 text-white hover:bg-white/15'}`}>{label}</Link>
            ))}
          </div>
        </div>
      </section>

      <div className="ds-container py-10 sm:py-14 max-w-4xl">
        {page === 'contact' ? (
          <div className="grid sm:grid-cols-2 gap-4">
            <a href={STORE_WHATSAPP_URL} target="_blank" rel="noreferrer" className="rounded-3xl bg-emerald-600 text-white p-6 flex items-center gap-4 hover:bg-emerald-700 transition"><MessageCircle size={26} /><div><div className="font-heading font-bold text-lg">{L('واتساب', 'WhatsApp')}</div><div dir="ltr" className="text-white/85 text-sm">{STORE_PHONE_LOCAL}</div></div></a>
            <a href={STORE_TEL_URL} className="rounded-3xl bg-white ring-1 ring-ink-900/[0.07] p-6 flex items-center gap-4 hover:ring-gold-300 transition"><Phone size={24} className="text-gold-600" /><div><div className="font-heading font-bold text-lg text-ink-900">{L('اتصال', 'Call')}</div><div dir="ltr" className="text-ink-500 text-sm">{STORE_PHONE_LOCAL}</div></div></a>
            <div className="rounded-3xl bg-white ring-1 ring-ink-900/[0.07] p-6 flex items-center gap-4"><MapPin size={24} className="text-gold-600 shrink-0" /><div><div className="font-heading font-bold text-lg text-ink-900">{L('العنوان', 'Address')}</div><div className="text-ink-500 text-sm">{L('عمّان - دوار النزهة - مقابل بنك الأردن', 'Amman - Al Nozha Circle - opposite Bank of Jordan')}</div></div></div>
            <a href="mailto:support@deirsharaf.com" className="rounded-3xl bg-white ring-1 ring-ink-900/[0.07] p-6 flex items-center gap-4 hover:ring-gold-300 transition"><Mail size={24} className="text-gold-600" /><div><div className="font-heading font-bold text-lg text-ink-900">{L('البريد', 'Email')}</div><div className="text-ink-500 text-sm">support@deirsharaf.com</div></div></a>
          </div>
        ) : page === 'privacy' ? (
          <div className="space-y-4">
            {[
              { Icon: RefreshCw, t: L('الإرجاع والاستبدال', 'Returns'), d: L('إرجاع أو استبدال خلال 24 ساعة في حال وجود عطل مصنعي فقط، بشرط الحفاظ على حالة المنتج والتغليف الأصلي.', 'Return or exchange within 24 hours for manufacturing defects only, with the product and original packaging intact.') },
              { Icon: ShieldCheck, t: L('الخصوصية', 'Privacy'), d: L('بياناتك محمية ونستخدمها فقط لإتمام الطلب وتوصيله. لا نبيع بياناتك ولا نشاركها مع أطراف إعلانية. ملفات الارتباط التحليلية لا تعمل إلا بعد موافقتك.', 'Your data is used only to complete and deliver your order. We never sell or share it with advertisers. Analytics cookies run only after your consent.') },
              { Icon: Truck, t: L('التوصيل', 'Delivery'), d: L('توصيل لجميع محافظات الأردن: توصيل عادي خلال 48 ساعة، أو توصيل سريع خلال 12 ساعة حيث يتوفر — تظهر الخيارات وأسعارها عند إتمام الطلب.', 'Delivery across Jordan: standard within 48 hours, or express within 12 hours where available — options and prices are shown at checkout.') },
              { Icon: Wallet, t: L('الدفع', 'Payment'), d: L('الدفع نقدًا عند الاستلام أو بتحويل CliQ.', 'Cash on delivery or CliQ transfer.') },
            ].map(({ Icon, t, d }) => (
              <div key={t} className="rounded-3xl bg-white ring-1 ring-ink-900/[0.07] p-6 flex gap-4"><Icon size={22} className="text-gold-600 shrink-0 mt-1" /><div><h2 className="font-heading font-bold text-lg text-ink-900">{t}</h2><p className="text-ink-600 leading-8 mt-1">{d}</p></div></div>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl bg-white ring-1 ring-ink-900/[0.07] p-6 sm:p-10">
            <h2 className="font-heading font-bold text-2xl text-ink-900">{L('مكتبة الحي التي كبرت معكم', 'The neighbourhood library that grew with you')}</h2>
            <p className="text-ink-600 leading-8 mt-3">{L('منذ عام 2000 ونحن نجهّز الطلاب والعائلات بالقرطاسية والكتب والألعاب. اليوم نفس الاهتمام ونفس الأسعار العادلة — ومعها متجر إلكتروني يوصلك لكل ما تحتاجه في كل محافظات الأردن.', 'Since 2000 we have equipped students and families with stationery, books and toys — now online, delivering across Jordan.')}</p>
            <div className="flex flex-wrap gap-3 mt-6"><Link to="/shop" className="ds-btn-ink">{L('تصفّح المنتجات', 'Browse products')}</Link><Link to="/contact" className="ds-btn-ghost">{L('تواصل معنا', 'Contact us')}</Link></div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InfoPage;
