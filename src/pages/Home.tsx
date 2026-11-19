// src/pages/Home.tsx — "Scholar" redesign: ink navy hero with real products, departments, curated rails.
import React, { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, ArrowLeft, ArrowRight, Truck, ShieldCheck, Wallet, Headset, Sparkles, MessageCircle, Facebook, Instagram, MapPin,
  GraduationCap, Gift, Blocks, Bike, Star,
} from 'lucide-react';

import ProductCard from '../components/ProductCard';
import { useCart } from '../App';
import SEO from '../components/SEO';
import { ProductSkeletonGrid } from '../components/Skeleton';
import { shopTo } from '../config/nav';
import { STORE_WHATSAPP_URL } from '../config/contact';
import SmartFinder from '../components/SmartFinder';

const FB_URL = 'https://www.facebook.com/maktabatdayrsharafaleilmia/';
const IG_URL = 'https://www.instagram.com/deirsharaf/';
const MAPS_URL = 'https://maps.app.goo.gl/JeK1tvF4jysnLgjM9?g_st=iw';

const DEPARTMENTS = [
  { category: 'Stationery', ar: 'القرطاسية', en: 'Stationery', subAr: 'دفاتر، أقلام، ألوان وأدوات هندسة', subEn: 'Notebooks, pens, colours & geometry', image: '/images/categories/notebooks.png', Icon: GraduationCap, tone: 'from-royal-50 to-paper-100' },
  { category: 'Games', ar: 'الألعاب', en: 'Toys', subAr: 'تعليمية، تركيب، منتسوري وألعاب جماعية', subEn: 'Educational, building, Montessori', image: '/images/categories/blocks.png', Icon: Blocks, tone: 'from-gold-50 to-paper-100' },
  { category: 'BabyGear', ar: 'مستلزمات وركوب', en: 'Ride-ons & Baby', subAr: 'بسكليتات، سيارات ركوب وعربيات', subEn: 'Bikes, ride-on cars & strollers', image: '/images/categories/bicycles.png', Icon: Bike, tone: 'from-emerald-50 to-paper-100' },
  { category: 'Gifts', ar: 'الهدايا', en: 'Gifts', subAr: 'صناديق هدايا وتغليف وحفلات', subEn: 'Gift boxes, wrapping & parties', image: '/images/categories/gift-boxes.png', Icon: Gift, tone: 'from-rose-50 to-paper-100' },
];

const TOY_CHIPS = [
  { sub: 'montessori', ar: 'منتسوري', en: 'Montessori' },
  { sub: 'building-blocks', ar: 'ألعاب التركيب', en: 'Building blocks' },
  { sub: 'boys-toys', ar: 'للأولاد', en: 'Boys' },
  { sub: 'girls-toys', ar: 'للبنات', en: 'Girls' },
  { sub: 'baby-toys', ar: 'ألعاب البيبي', en: 'Baby' },
  { sub: 'group-games', ar: 'ألعاب جماعية', en: 'Group games' },
  { sub: 'premium-toys', ar: 'ألعاب مميزة', en: 'Premium' },
];

const toMillis = (v: any): number => {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Date.parse(v) || 0;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  return 0;
};
const firstImage = (p: any) => (Array.isArray(p?.images) && p.images[0]) || p?.image || '';

const SectionHead: React.FC<{ eyebrow: string; title: string; to?: string; cta?: string; isRtl: boolean }> = ({ eyebrow, title, to, cta, isRtl }) => (
  <div className="flex items-end justify-between gap-4 mb-6 sm:mb-8">
    <div>
      <div className="ds-eyebrow mb-2"><span className="w-6 h-px bg-gold-400" />{eyebrow}</div>
      <h2 className="ds-title">{title}</h2>
    </div>
    {to && cta && (
      <Link to={to} className="hidden sm:inline-flex items-center gap-2 text-[14px] font-bold text-ink-900 hover:text-gold-600 transition-colors shrink-0">
        {cta} {isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
      </Link>
    )}
  </div>
);

const Home: React.FC = () => {
  const { products, addToCart, toggleWishlist, wishlist, openQuickView, t, language, isLoading } = useCart() as any;
  const isRtl = (language ?? 'ar') === 'ar';
  const L = useCallback((ar: string, en: string) => (isRtl ? ar : en), [isRtl]);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const list: any[] = useMemo(() => (Array.isArray(products) ? products : []), [products]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const s = q.trim();
    navigate(s ? `/shop?search=${encodeURIComponent(s)}` : '/shop');
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of list) c[p.category] = (c[p.category] || 0) + 1;
    return c;
  }, [list]);

  const latest = useMemo(() => [...list].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)), [list]);
  const newArrivals = useMemo(() => {
    const flagged = latest.filter((p) => p.isNew);
    return (flagged.length >= 4 ? flagged : latest).slice(0, 8);
  }, [latest]);
  const stationery = useMemo(() => latest.filter((p) => p.category === 'Stationery').slice(0, 8), [latest]);
  const toys = useMemo(() => latest.filter((p) => p.category === 'Games').slice(0, 4), [latest]);
  const heroPicks = useMemo(() => {
    const byCat = (c: string) => latest.find((p) => p.category === c && firstImage(p));
    const picks = [byCat('Games'), byCat('Stationery'), byCat('BabyGear')].filter(Boolean);
    for (const p of latest) if (picks.length < 3 && firstImage(p) && !picks.includes(p)) picks.push(p);
    return picks.slice(0, 3);
  }, [latest]);

  const card = (p: any, i: number) => (
    <ProductCard key={p.id} product={p} onAddToCart={addToCart} onToggleWishlist={toggleWishlist} onQuickView={openQuickView} isLiked={wishlist.has(p.id)} priority={i < 2} />
  );

  return (
    <div className="bg-paper">
      <SEO title={String(t('home') ?? 'Home')} description={L('مكتبة دير شرف العلمية: قرطاسية، ألعاب تعليمية، مستلزمات مدرسية وهدايا مع توصيل لكل المحافظات.', 'Dair Sharaf Library: stationery, educational toys, school supplies and gifts.')} type="website" />

      {/* ============================ HERO ============================ */}
      <section className="relative overflow-hidden bg-ink-900 text-white">
        <div className="absolute inset-0 bg-ink-glow" aria-hidden />
        <div className="absolute inset-0 opacity-[0.07] bg-paper-grain [background-size:18px_18px]" aria-hidden />
        <div className="ds-container relative grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-6 sm:gap-10 lg:gap-12 xl:gap-14 items-center py-6 sm:py-14 lg:py-16 xl:py-20">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 ring-1 ring-white/15 px-3.5 py-1.5 text-[12px] font-semibold text-gold-200 mb-3 sm:mb-5">
              <Sparkles size={14} /> {L('مكتبة عريقة منذ عام 2000', 'A trusted library since 2000')}
            </div>
            {/* sizes per width: phone 28px · tablet 48px · 1024-1279 (two columns, narrow) 2.75rem · desktop 3.6rem */}
            <h1 className="font-heading font-bold text-[28px] leading-[1.2] sm:text-5xl sm:leading-[1.15] lg:text-[2.75rem] lg:leading-[1.12] xl:text-[3.6rem] xl:leading-[1.08] [overflow-wrap:anywhere]">
              {L('كل ما يحتاجه الطالب والطفل', 'Everything students and kids need,')}
              <span className="block text-gold-300 mt-1">{L('بعناية مكتبة دير شرف', 'chosen with care')}</span>
            </h1>
            <p className="hidden sm:block mt-5 text-[17px] leading-8 text-ink-100/85 max-w-xl">
              {L('قرطاسية، ألعاب تعليمية، مستلزمات مدرسية وهدايا — نختارها بأنفسنا ونوصلها لباب بيتك في كل المحافظات.', 'Genuine stationery, safe educational toys, school supplies and gifts — hand-picked and delivered to your door.')}
            </p>

            <form onSubmit={onSearch} className="mt-5 sm:mt-7 flex items-center gap-2 bg-white rounded-full p-1.5 ps-5 max-w-xl shadow-lift">
              <Search size={19} className="text-ink-400 shrink-0" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                type="search"
                placeholder={L('ابحث عن قلم، دفتر، لعبة…', 'Search pens, notebooks, toys…')}
                className="flex-1 min-w-0 bg-transparent text-ink-900 placeholder:text-ink-300 text-[15px] py-2 !border-0 !shadow-none focus:outline-none"
                aria-label={L('بحث', 'Search')}
              />
              <button type="submit" className="ds-btn-gold !py-2.5 !px-5 text-[14px]">{L('بحث', 'Search')}</button>
            </form>

            <div className="mt-4 sm:mt-6 flex flex-wrap gap-3">
              <Link to="/shop" className="ds-btn-gold">{L('تسوّق كل المنتجات', 'Shop all products')} {isRtl ? <ArrowLeft size={18} /> : <ArrowRight size={18} />}</Link>
              <Link to={shopTo('Stationery')} className="inline-flex items-center gap-2 rounded-full ring-1 ring-white/25 text-white font-bold px-6 py-3.5 hover:bg-white/10 transition">{L('العودة للمدارس', 'Back to school')}</Link>
            </div>

            <dl className="mt-5 sm:mt-9 grid grid-cols-3 gap-2 sm:gap-3 max-w-lg">
              {[
                { v: list.length ? `${list.length}+` : '100+', l: L('منتج متوفر', 'products') },
                { v: L('كل المحافظات', 'Nationwide'), l: L('توصيل', 'delivery') },
                { v: L('عند الاستلام', 'On delivery'), l: L('ادفع براحتك', 'pay when it arrives') },
              ].map((s) => (
                <div key={s.l} className="min-w-0 rounded-2xl bg-white/[0.06] ring-1 ring-white/10 px-2.5 sm:px-3 py-3">
                  <dt className="font-heading font-bold text-[13.5px] sm:text-[19px] leading-snug text-white">{s.v}</dt>
                  <dd className="text-[11.5px] sm:text-[12.5px] text-ink-200 mt-0.5">{s.l}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* real products: one large card + two stacked — a grid, so no card covers another card's photo or price */}
          <div className="relative min-w-0 grid grid-cols-[1.35fr_1fr] grid-rows-2 gap-3 sm:gap-4 h-[210px] sm:h-[400px] lg:h-[440px] xl:h-[480px]">
            {heroPicks.map((p, i) => {
              const pos = ['row-span-2', '', ''][i];
              return (
                <Link key={p.id} to={`/product/${p.id}`} className={`relative min-w-0 min-h-0 ${pos} rounded-[1.5rem] sm:rounded-[1.75rem] bg-paper-100 shadow-lift ring-1 ring-white/20 overflow-hidden group transition-transform duration-500 hover:scale-[1.02]`}>
                  <img src={firstImage(p)} alt={p.name} className="w-full h-full object-contain p-3 sm:p-4 pb-11 sm:pb-12 mix-blend-multiply" loading={i === 0 ? 'eager' : 'lazy'} />
                  <div className="absolute bottom-2 sm:bottom-2.5 inset-x-2 sm:inset-x-2.5 rounded-xl bg-white/90 backdrop-blur px-2.5 sm:px-3 py-1.5 flex items-center justify-between gap-2 text-ink-900">
                    <span className="text-[11.5px] font-semibold truncate">{isRtl ? p.name : p.nameEn || p.name}</span>
                    <span className="text-[12px] font-bold text-gold-600 shrink-0">{p.price} {L('د.أ', 'JOD')}</span>
                  </div>
                </Link>
              );
            })}
            <div className="absolute top-3 start-3 hidden sm:flex items-center gap-2 rounded-2xl bg-white text-ink-900 px-3.5 py-2.5 shadow-lift z-10">
              <Star size={16} className="text-gold-500" fill="currentColor" />
              <span className="text-[12.5px] font-bold">{L('مختارة بعناية لكل الأعمار', 'Curated for every age')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ============================ VALUE STRIP ============================ */}
      <section className="border-b border-ink-900/[0.06] bg-white">
        <div className="ds-container grid grid-cols-2 lg:grid-cols-4 gap-y-5 gap-x-4 py-6">
          {[
            { Icon: Truck, t: L('توصيل لكل المحافظات', 'Nationwide delivery'), d: L('عادي أو سريع حسب المنطقة', 'standard or express') },
            { Icon: Wallet, t: L('الدفع عند الاستلام', 'Cash on delivery'), d: L('أو تحويل CliQ', 'or CliQ transfer') },
            { Icon: ShieldCheck, t: L('مختارة بعناية', 'Carefully chosen'), d: L('من مكتبة الحي منذ 2000', 'since 2000') },
            { Icon: Headset, t: L('دعم مباشر', 'Real support'), d: L('عبر واتساب', 'on WhatsApp') },
          ].map(({ Icon, t: tt, d }) => (
            <div key={tt} className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-2xl bg-paper-200 text-ink-900 flex items-center justify-center shrink-0"><Icon size={20} /></span>
              <div className="min-w-0">
                <div className="text-[13.5px] font-bold text-ink-900 truncate">{tt}</div>
                <div className="text-[12px] text-ink-400 truncate">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ============================ DEPARTMENTS ============================ */}
      <section className="ds-container py-12 sm:py-16">
        <SectionHead eyebrow={L('الأقسام', 'Departments')} title={L('تسوّق حسب القسم', 'Shop by department')} to="/shop" cta={L('كل المنتجات', 'All products')} isRtl={isRtl} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
          {DEPARTMENTS.map((d) => (
            // text on top, image in its own area below it: the title never sits on the picture (it did on phone,
            // tablet and desktop), and the cards are shorter on phones
            <Link key={d.category} to={shopTo(d.category)} data-testid="department-card" className={`group relative overflow-hidden rounded-3xl bg-gradient-to-b ${d.tone} ring-1 ring-ink-900/[0.06] p-4 sm:p-5 min-h-[168px] sm:min-h-[216px] flex flex-col transition-all duration-500 hover:shadow-lift hover:-translate-y-1`}>
              <div className="flex items-center justify-between gap-2">
                <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white/80 text-ink-900 flex items-center justify-center shrink-0"><d.Icon size={18} /></span>
                {counts[d.category] ? <span className="text-[11px] sm:text-[11.5px] font-bold text-ink-500 bg-white/70 rounded-full px-2.5 py-1 whitespace-nowrap">{counts[d.category]} {L('منتج', 'items')}</span> : null}
              </div>
              <div className="relative z-10 mt-3">
                <h3 className="font-heading font-bold text-ink-900 text-[16px] sm:text-[20px] leading-snug">{L(d.ar, d.en)}</h3>
                <p className="hidden sm:block text-[12.5px] leading-6 text-ink-500 mt-1 line-clamp-2">{L(d.subAr, d.subEn)}</p>
              </div>
              <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                <span className="inline-flex items-center gap-1 text-[12.5px] font-bold text-gold-600 shrink-0">{L('تصفّح', 'Browse')} {isRtl ? <ArrowLeft size={14} /> : <ArrowRight size={14} />}</span>
                {/* one fixed image area for every card (even heights); white photo backgrounds blend into the card tint */}
                <img src={d.image} alt="" className="h-16 sm:h-20 lg:h-[88px] w-[48%] object-contain object-bottom mix-blend-multiply transition-transform duration-500 group-hover:scale-105" loading="lazy" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ============================ NEW ARRIVALS ============================ */}
      <section className="ds-container pb-12 sm:pb-16">
        <SectionHead eyebrow={L('وصل حديثًا', 'Just in')} title={L('أحدث ما أضفناه للمكتبة', 'Newest in the library')} to="/shop" cta={L('عرض الكل', 'View all')} isRtl={isRtl} />
        {isLoading && !list.length ? (
          <ProductSkeletonGrid count={8} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">{newArrivals.map(card)}</div>
        )}
      </section>

      {/* ============================ BACK TO SCHOOL BANNER ============================ */}
      <section className="ds-container pb-12 sm:pb-16">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-l from-gold-500 via-gold-400 to-gold-300 text-ink-900 px-6 sm:px-12 py-10 sm:py-14">
          <div className="absolute inset-0 opacity-20 bg-paper-grain [background-size:16px_16px]" aria-hidden />
          <img src="/images/categories/bags.png" alt="" className="absolute -bottom-6 end-2 sm:end-10 w-40 sm:w-72 drop-shadow-2xl" loading="lazy" />
          <div className="relative max-w-xl">
            <div className="text-[12.5px] font-bold uppercase tracking-wider text-ink-900/70 mb-2">{L('موسم العودة للمدارس', 'Back to school')}</div>
            <h2 className="font-heading font-bold text-[26px] sm:text-[38px] leading-tight">{L('جهّز الحقيبة كاملة من مكان واحد', 'Pack the whole school bag in one place')}</h2>
            <p className="mt-3 text-[14.5px] sm:text-[16px] leading-7 text-ink-900/80">{L('دفاتر، أقلام، ألوان، أدوات هندسة وحقائب — بأسعار مكتبة الحي وجودة تدوم طول السنة.', 'Notebooks, pens, colours, geometry sets and bags — neighbourhood prices, all-year quality.')}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to={shopTo('Stationery')} className="ds-btn-ink">{L('تسوّق القرطاسية', 'Shop stationery')}</Link>
              <a href={STORE_WHATSAPP_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-white/70 hover:bg-white text-ink-900 font-bold px-6 py-3.5 transition"><MessageCircle size={18} /> {L('أرسل قائمة المدرسة', 'Send the school list')}</a>
            </div>
          </div>
        </div>
      </section>

      {/* ============================ STATIONERY ============================ */}
      {stationery.length > 0 && (
        <section className="ds-container pb-12 sm:pb-16">
          <SectionHead eyebrow={L('القرطاسية', 'Stationery')} title={L('أساسيات كل طالب', 'Every student’s essentials')} to={shopTo('Stationery')} cta={L('كل القرطاسية', 'All stationery')} isRtl={isRtl} />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">{stationery.map(card)}</div>
        </section>
      )}

      {/* ============================ TOYS ============================ */}
      <section className="bg-white border-y border-ink-900/[0.06]">
        <div className="ds-container py-12 sm:py-16">
          <SectionHead eyebrow={L('الألعاب', 'Toys')} title={L('ألعاب تُعلّم وتُسعد', 'Toys that teach and delight')} to={shopTo('Games')} cta={L('كل الألعاب', 'All toys')} isRtl={isRtl} />
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 mb-6">
            {TOY_CHIPS.map((c) => (
              <Link key={c.sub} to={shopTo('Games', c.sub)} className="shrink-0 rounded-full bg-paper-100 ring-1 ring-ink-900/[0.07] px-4 py-2 text-[13px] font-bold text-ink-800 hover:bg-ink-900 hover:text-white transition">{L(c.ar, c.en)}</Link>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">{toys.map(card)}</div>
        </div>
      </section>

      {/* ============================ SMART FINDER ============================ */}
      <section className="ds-container py-12 sm:py-16">
        <div className="rounded-[2rem] bg-white ring-1 ring-ink-900/[0.06] shadow-soft p-4 sm:p-8">
          <div className="ds-eyebrow mb-2"><span className="w-6 h-px bg-gold-400" />{L('مساعد الاختيار', 'Gift finder')}</div>
          <h2 className="ds-title mb-5">{L('مش متأكد شو تختار؟ خلّينا نساعدك', 'Not sure what to pick? Let us help')}</h2>
          <SmartFinder products={products} L={L} isRtl={isRtl} />
        </div>
      </section>

      {/* ============================ STORY / CONTACT ============================ */}
      <section className="ds-container pb-14 sm:pb-20">
        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4 sm:gap-6">
          <div className="rounded-[2rem] bg-ink-900 text-white p-7 sm:p-10 relative overflow-hidden">
            <div className="absolute inset-0 bg-ink-glow opacity-80" aria-hidden />
            <div className="relative">
              <div className="ds-eyebrow !text-gold-300 mb-3"><span className="w-6 h-px bg-gold-300" />{L('قصتنا', 'Our story')}</div>
              <h2 className="font-heading font-bold text-[26px] sm:text-[34px] leading-tight">{L('مكتبة الحي التي كبرت معكم', 'The neighbourhood library that grew with you')}</h2>
              <p className="mt-4 text-[15px] leading-8 text-ink-100/85 max-w-xl">{L('منذ عام 2000 ونحن نجهّز الطلاب والعائلات بالقرطاسية والكتب والألعاب. اليوم نفس الاهتمام، ونفس الأسعار العادلة — ومعها متجر إلكتروني يوصلك لكل ما تحتاجه.', 'Since 2000 we have equipped students and families with stationery, books and toys. The same care and fair prices — now online too.')}</p>
            </div>
          </div>
          <div className="rounded-[2rem] bg-white ring-1 ring-ink-900/[0.06] p-7 sm:p-8 flex flex-col">
            <h3 className="font-heading font-bold text-ink-900 text-[20px]">{L('تواصل معنا', 'Get in touch')}</h3>
            <p className="text-[14px] text-ink-500 mt-1 mb-5">{L('اسأل عن أي منتج أو أرسل قائمة مدرسة كاملة.', 'Ask about any product or send a full school list.')}</p>
            <div className="grid gap-2.5">
              <a href={STORE_WHATSAPP_URL} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl bg-emerald-600 text-white px-4 py-3.5 font-bold hover:bg-emerald-700 transition"><MessageCircle size={20} /> {L('واتساب المكتبة', 'WhatsApp')}</a>
              <div className="grid grid-cols-3 gap-2.5">
                <a href={FB_URL} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1.5 rounded-2xl bg-paper-100 py-3.5 text-ink-800 text-[12px] font-bold hover:bg-paper-200 transition"><Facebook size={19} /> Facebook</a>
                <a href={IG_URL} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1.5 rounded-2xl bg-paper-100 py-3.5 text-ink-800 text-[12px] font-bold hover:bg-paper-200 transition"><Instagram size={19} /> Instagram</a>
                <a href={MAPS_URL} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1.5 rounded-2xl bg-paper-100 py-3.5 text-ink-800 text-[12px] font-bold hover:bg-paper-200 transition"><MapPin size={19} /> {L('الموقع', 'Map')}</a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
