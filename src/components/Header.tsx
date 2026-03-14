import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ShoppingBag,
  Search,
  Menu,
  X,
  Heart,
  LogIn,
  LayoutDashboard,
  Truck,
  Globe,
  Home,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Gift,
  Gamepad2,
  PencilRuler,
  ChevronDown,
  User as UserIcon,
} from 'lucide-react';
import { useCart } from '../App';
import { shopTo } from '../config/nav';

const Header: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const {
    cartCount,
    wishlistCount,
    setIsCartOpen,
    language,
    setLanguage,
    products,
    t,
    getProductTitle,
    user,
    logout,
  } = useCart();

  const isRtl = language === 'ar';
  const L = useCallback((ar: string, en: string) => (language === 'ar' ? ar : en), [language]);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownCloseTimer = useRef<any>(null);
  const desktopNavRef = useRef<HTMLDivElement>(null);

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuCloseTimer = useRef<any>(null);

  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeAllOverlays = useCallback(() => {
    setShowSuggestions(false);
    setIsMenuOpen(false);
    setOpenDropdown(null);
    setIsUserMenuOpen(false);
    setMobileExpanded(null);
  }, []);

  // 🚀 دالة العودة للرئيسية باحترافية (Smooth Scroll)
  const handleHomeClick = (e: React.MouseEvent) => {
    closeAllOverlays();
    if (location.pathname === '/') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const openUserMenuSafe = () => {
    if (userMenuCloseTimer.current) clearTimeout(userMenuCloseTimer.current);
    setIsUserMenuOpen(true);
    setOpenDropdown(null);
  };

  const closeUserMenuDelayed = () => {
    if (userMenuCloseTimer.current) clearTimeout(userMenuCloseTimer.current);
    userMenuCloseTimer.current = setTimeout(() => setIsUserMenuOpen(false), 140);
  };

  const MEGA_MENU_DATA = useMemo(() => [
    {
      id: 'games',
      labelAr: 'الألعاب', labelEn: 'Toys & Games',
      icon: Gamepad2,
      categoryUrl: 'Games',
      promo: { ar: 'خصم إضافي 10% على كل الألعاب!', en: 'Extra 10% off all toys!', code: 'TOYS10' },
      groups: [
        {
          titleAr: 'حسب الفئة', titleEn: 'By Category',
          links: [
            { id: 'all-toys', ar: 'جميع الألعاب', en: 'All Toys' },
            { id: 'baby-toys', ar: 'ألعاب البيبي', en: 'Baby Toys' },
            { id: 'girls-toys', ar: 'ألعاب للبنات', en: 'Girls Toys' },
            { id: 'boys-toys', ar: 'ألعاب للأولاد', en: 'Boys Toys' },
          ]
        },
        {
          titleAr: 'تنمية مهارات', titleEn: 'Skills & IQ',
          links: [
            { id: 'montessori', ar: 'ألعاب منتسوري', en: 'Montessori' },
            { id: 'memory-focus', ar: 'الذاكرة والتركيز', en: 'Memory & Focus' },
            { id: 'challenge-iq', ar: 'التحدي والذكاء', en: 'Challenge & IQ' },
            { id: 'letters-words', ar: 'الحروف والكلمات', en: 'Letters & Words' },
            { id: 'math-numbers', ar: 'الرياضيات والحساب', en: 'Math & Numbers' },
            { id: 'science-experiments', ar: 'التجارب العلمية', en: 'Science Experiments' },
          ]
        },
        {
          titleAr: 'أنشطة وهوايات', titleEn: 'Activities',
          links: [
            { id: 'drawing-coloring', ar: 'الرسم والتلوين', en: 'Drawing & Coloring' },
            { id: 'kitchen-toys', ar: 'العاب مطابخ', en: 'Kitchen Toys' },
            { id: 'kids-tents', ar: 'خيم الاطفال', en: 'Kids Tents' },
            { id: 'audio-books', ar: 'الكتب الصوتية', en: 'Audio Books' },
            { id: 'sensory-toys', ar: 'ألعاب حسية', en: 'Sensory Toys' },
          ]
        },
        {
          titleAr: 'تركيب وجماعي', titleEn: 'Blocks & Group',
          links: [
            { id: 'building-blocks', ar: 'العاب التركيب', en: 'Building Blocks' },
            { id: 'wooden-toys', ar: 'ألعاب خشبية', en: 'Wooden Toys' },
            { id: 'magnetic-toys', ar: 'الالعاب المغناطيسية', en: 'Magnetic Toys' },
            { id: 'group-games', ar: 'العاب جماعية', en: 'Group Games' },
            { id: 'premium-toys', ar: 'الالعاب المميزة', en: 'Premium Toys' },
          ]
        }
      ]
    },
    {
      id: 'babygear',
      labelAr: 'مستلزمات وركوب', labelEn: 'Baby Gear & Ride-ons',
      icon: Truck, 
      categoryUrl: 'BabyGear',
      promo: { ar: 'توصيل مجاني للسيارات والبسكليتات', en: 'Free delivery on cars & bikes', code: 'FREERIDE' },
      groups: [
        {
          titleAr: 'مركبات الأطفال', titleEn: 'Kids Ride-ons',
          links: [
            { id: 'bicycles', ar: 'بسكليتات', en: 'Bicycles' },
            { id: 'ride-on-cars', ar: 'سيارات ركوب', en: 'Ride-on Cars' },
            { id: 'kids-trucks', ar: 'شاحنات أطفال', en: 'Kids Trucks' },
            { id: 'scooters', ar: 'سكوترات', en: 'Scooters' },
            { id: 'rc-cars', ar: 'سيارات التحكم', en: 'RC Cars' },
          ]
        },
        {
          titleAr: 'مستلزمات وحركة', titleEn: 'Gear & Movement',
          links: [
            { id: 'strollers', ar: 'عربيات الأطفال', en: 'Strollers' },
            { id: 'bouncers-rockers', ar: 'كراسي هزازة / جلاسات', en: 'Bouncers & Rockers' },
            { id: 'walkers', ar: 'مشايات أطفال', en: 'Baby Walkers' },
            { id: 'playmats', ar: 'سجاد وفرشات لعب', en: 'Playmats & Gyms' },
          ]
        }
      ]
    },
    {
      id: 'stationery',
      labelAr: 'القرطاسية', labelEn: 'Stationery',
      icon: PencilRuler,
      categoryUrl: 'Stationery',
      groups: [
        {
          titleAr: 'حقائب وتنظيم', titleEn: 'Bags & Organizers',
          links: [
            { id: 'school-bags', ar: 'حقائب مدرسية', en: 'School Bags' },
            { id: 'pencil-cases', ar: 'مقالم / حافظات', en: 'Pencil Cases' },
            { id: 'lunch-bags', ar: 'حقائب طعام', en: 'Lunch Bags' },
          ]
        },
        {
          titleAr: 'أدوات الكتابة', titleEn: 'Writing Tools',
          links: [
            { id: 'pens-ballpoint', ar: 'أقلام حبر وجاف', en: 'Pens & Ballpoints' },
            { id: 'pencils', ar: 'أقلام رصاص', en: 'Pencils' },
            { id: 'colors-markers', ar: 'أقلام تلوين وماركرز', en: 'Colors & Markers' },
            { id: 'erasers-sharpeners', ar: 'محايات وبرايات', en: 'Erasers & Sharpeners' },
          ]
        },
        {
          titleAr: 'دفاتر وورق', titleEn: 'Notebooks',
          links: [
            { id: 'notebooks', ar: 'دفاتر مدرسية', en: 'Notebooks' },
            { id: 'drawing-books', ar: 'دفاتر رسم وتلوين', en: 'Drawing Books' },
            { id: 'covers-notes', ar: 'تجليد وورق ملاحظات', en: 'Covers & Notes' },
          ]
        },
        {
          titleAr: 'مستلزمات فنية', titleEn: 'Art Supplies',
          links: [
            { id: 'geometry-rulers', ar: 'أدوات هندسة', en: 'Geometry Sets' },
            { id: 'glue-tape', ar: 'صمغ ولاصق', en: 'Glue & Tape' },
            { id: 'clay-dough', ar: 'صلصال ومعجون', en: 'Clay & Dough' },
          ]
        }
      ]
    },
    {
      id: 'gifts',
      labelAr: 'هدايا وعروض', labelEn: 'Gifts & Offers',
      icon: Gift,
      categoryUrl: 'Gifts',
      groups: [
        {
          titleAr: 'الهدايا والمناسبات', titleEn: 'Gifts & Occasions',
          categoryOverride: 'Gifts',
          links: [
            { id: 'gift-boxes', ar: 'صناديق وباكجات هدايا', en: 'Gift Boxes' },
            { id: 'wrapping-paper', ar: 'ورق تغليف وأكياس', en: 'Wrapping Paper' },
            { id: 'greeting-cards', ar: 'بطاقات تهنئة', en: 'Greeting Cards' },
            { id: 'party-supplies', ar: 'مستلزمات حفلات', en: 'Party Supplies' },
          ]
        },
        {
          titleAr: 'العروض والتصفيات', titleEn: 'Offers & Clearance',
          categoryOverride: 'Offers',
          links: [
            { id: 'bundle', ar: 'باكج/حزمة التوفير', en: 'Bundles' },
            { id: 'discount', ar: 'خصومات حصرية', en: 'Discounts' },
            { id: 'clearance', ar: 'تصفية المخزون', en: 'Clearance' },
          ]
        }
      ]
    }
  ], []);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedQuery(searchQuery), 500);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    if (isMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = prev || 'unset';
    }
    return () => {
      document.body.style.overflow = prev || 'unset';
    }
  }, [isMenuOpen]);

  const goTo = useCallback(
    (path: string) => {
      closeAllOverlays();
      navigate(path);
    },
    [closeAllOverlays, navigate]
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      goTo(`/shop?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const openWishlist = () => goTo('/wishlist');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!desktopNavRef.current) return;
      if (!desktopNavRef.current.contains(e.target as Node)) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(e.target as Node)) setIsUserMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsUserMenuOpen(false);
    };

    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const suggestions = useMemo(() => {
    if (debouncedQuery.length <= 1) return [];
    const q = debouncedQuery.toLowerCase();
    return products
      .filter((p) => (p.name || '').toLowerCase().includes(q) || (p.nameEn || '').toLowerCase().includes(q))
      .slice(0, 5);
  }, [debouncedQuery, products]);

  const isActivePath = (path: string) => location.pathname === path;

  const openDropdownSafe = (key: string) => {
    if (dropdownCloseTimer.current) clearTimeout(dropdownCloseTimer.current);
    setOpenDropdown(key);
    setIsUserMenuOpen(false);
  };

  const closeDropdownDelayed = () => {
    if (dropdownCloseTimer.current) clearTimeout(dropdownCloseTimer.current);
    dropdownCloseTimer.current = setTimeout(() => setOpenDropdown(null), 220);
  };

  const topBarItems = useMemo(
    () => [
      { id: 'ship', icon: '🚚', ar: 'توصيل سريع خلال 24-48 ساعة', en: 'Fast delivery within 24–48 hours', to: '/tracking' },
      { id: 'deals', icon: '🎁', ar: 'عروض أسبوعية حصرية — اضغط للمشاهدة', en: 'Exclusive weekly deals — tap to view', to: '/shop?category=Offers' },
      { id: 'support', icon: '📞', ar: 'الدعم: 06-0000000', en: 'Support: +962 6 000 0000', to: '/contact' },
    ],
    []
  );

  const [topBarIndex, setTopBarIndex] = useState(0);
  const topBarCount = topBarItems.length;

  const prevTopBar = () => setTopBarIndex((i) => (i - 1 + topBarCount) % topBarCount);
  const nextTopBar = () => setTopBarIndex((i) => (i + 1) % topBarCount);

  useEffect(() => {
    const id = setInterval(() => setTopBarIndex((i) => (i + 1) % topBarCount), 5500);
    return () => clearInterval(id);
  }, [topBarCount]);

  const dragRef = useRef<{ startX: number; active: boolean } | null>(null);

  const onTopBarPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, active: true };
  };

  const onTopBarPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current?.active) return;
    const delta = e.clientX - dragRef.current.startX;
    dragRef.current = null;

    const effectiveDelta = isRtl ? -delta : delta;
    if (effectiveDelta > 35) prevTopBar();
    if (effectiveDelta < -35) nextTopBar();
  };

  const onTopBarPointerCancel = () => {
    dragRef.current = null;
  };

  const activeTop = topBarItems[topBarIndex];

  return (
    <>
      <header
        className={[
          'sticky top-0 z-50 w-full font-sans transition-all duration-300',
          'bg-gradient-to-r from-primary-dark via-white/10 to-secondary-dark',
          'backdrop-blur-md border-b border-white/20',
          isScrolled ? 'shadow-xl' : 'shadow-lg',
        ].join(' ')}
      >
        <div className="border-b border-white/15 bg-black/15">
          <div className="w-full max-w-[1550px] mx-auto px-5 sm:px-6 lg:px-14">
            <div className="h-10 flex items-center justify-between gap-3">
              <div
                className="flex-1 min-w-0 inline-flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-full bg-white/15 border border-white/25 backdrop-blur-sm select-none"
                onPointerDown={onTopBarPointerDown}
                onPointerUp={onTopBarPointerUp}
                onPointerCancel={onTopBarPointerCancel}
              >
                <button type="button" onClick={prevTopBar} className="p-1.5 rounded-full hover:bg-white/10 transition-colors active:scale-95">
                  {isRtl ? <ChevronRight size={16} className="text-white drop-shadow" /> : <ChevronLeft size={16} className="text-white drop-shadow" />}
                </button>

                <button type="button" onClick={() => goTo(activeTop.to)} className="flex-1 min-w-0 text-[13px] sm:text-[14px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)] truncate text-center hover:opacity-95 transition-opacity">
                  <span className="me-1">{activeTop.icon}</span>
                  {L(activeTop.ar, activeTop.en)}
                </button>

                <button type="button" onClick={nextTopBar} className="p-1.5 rounded-full hover:bg-white/10 transition-colors active:scale-95">
                  {isRtl ? <ChevronLeft size={16} className="text-white drop-shadow" /> : <ChevronRight size={16} className="text-white drop-shadow" />}
                </button>
              </div>

              <button onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 border border-white/25 hover:bg-white/25 transition-colors text-white font-extrabold text-[12px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)]">
                <Globe size={14} />
                <span className="uppercase">{language}</span>
              </button>
            </div>
          </div>
        </div>

        <div className={`w-full max-w-[1550px] mx-auto flex items-center justify-between px-5 sm:px-6 lg:px-14 transition-all duration-300 ${isScrolled ? 'h-[72px]' : 'h-20'}`}>
          
          {/* Logo Section - 🚀 تم ربطه بدالة Smooth Scroll */}
          <Link to="/" className="flex items-center group shrink-0 min-w-0" onClick={handleHomeClick}>
            <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center text-white font-extrabold text-xl shadow-lg group-hover:rotate-12 transition-transform duration-300 backdrop-blur-sm border border-white/30 shrink-0">
              A
            </div>
            <div className="flex flex-col ms-3 min-w-0">
              <span className="text-[18px] sm:text-[20px] font-heading font-extrabold tracking-tight text-slate-900 group-hover:text-white transition-colors duration-300 truncate">
                Dair Sharaf
              </span>
              <span className="text-[10px] sm:text-[11px] font-semibold tracking-[0.18em] uppercase text-slate-800/90 group-hover:text-slate-100 transition-colors duration-300 truncate">
                TECH & ART
              </span>
            </div>
          </Link>

          {/* Desktop Navigation (Mega Menu) */}
          <nav ref={desktopNavRef} className="hidden lg:flex items-center justify-center flex-1 space-s-2 px-4">
            
            {/* 🚀 زر الرئيسية - تم ربطه بدالة Smooth Scroll */}
            <Link to="/" onClick={handleHomeClick} className={`text-sm font-bold transition-colors duration-300 relative py-2 px-3 rounded-lg group flex items-center gap-2 ${isActivePath('/') ? 'text-slate-900 bg-white/30 shadow-sm' : 'text-slate-900 hover:bg-white/20 hover:text-slate-950 hover:shadow-sm'}`}>
              <Home size={18} />
              <span>{t('home')}</span>
            </Link>

            {MEGA_MENU_DATA.map((menu) => (
              <div key={menu.id} className="relative" onMouseEnter={() => openDropdownSafe(menu.id)} onMouseLeave={closeDropdownDelayed}>
                <button type="button" className="text-sm font-bold text-slate-900 hover:bg-white/20 hover:shadow-sm transition-all py-2 px-3 rounded-lg flex items-center gap-2">
                  <menu.icon size={18} />
                  <span>{L(menu.labelAr, menu.labelEn)}</span>
                  <ChevronDown size={16} className={`opacity-70 transition-transform ${openDropdown === menu.id ? 'rotate-180 opacity-100' : ''}`} />
                </button>

                {openDropdown === menu.id && (
                  <div className={`absolute top-full start-0 mt-3 ${menu.groups.length > 2 ? 'w-[750px] xl:w-[900px]' : 'w-[450px] xl:w-[500px]'} rounded-3xl overflow-hidden z-50 border border-slate-200/70 shadow-2xl bg-white animate-in fade-in slide-in-from-top-2`}>
                    <div className="h-3 bg-transparent" />
                    <div className="p-6">
                      <div className="flex justify-between items-center mb-5 border-b border-slate-100 pb-4">
                        <div className="font-black text-xl text-slate-900 flex items-center gap-3">
                           <div className="w-10 h-10 bg-sky-50 text-sky-500 rounded-xl flex items-center justify-center"><menu.icon size={20} /></div>
                           {L(`تصفح ${menu.labelAr}`, `Explore ${menu.labelEn}`)}
                        </div>
                        <button onClick={() => goTo(shopTo(menu.categoryUrl, 'all'))} className="text-xs font-bold px-4 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors shadow-md shadow-slate-900/10">
                          {L('عرض كل المنتجات', 'View All')}
                        </button>
                      </div>

                      <div className={`grid gap-6 ${menu.groups.length > 2 ? 'grid-cols-3 xl:grid-cols-4' : 'grid-cols-2'}`}>
                        {menu.groups.map((group, idx) => (
                          <div key={idx} className="flex flex-col">
                            <h4 className="font-extrabold text-sky-600 mb-3 text-[13px] uppercase tracking-wider">{L(group.titleAr, group.titleEn)}</h4>
                            <div className="flex flex-col gap-1.5">
                              {group.links.map((link) => (
                                <button key={link.id} onClick={() => goTo(shopTo(group.categoryOverride || menu.categoryUrl, link.id))} className="text-start text-[13px] font-bold text-slate-600 hover:text-sky-600 hover:bg-sky-50 py-2 px-3 rounded-xl transition-all w-full relative group/link">
                                  {L(link.ar, link.en)}
                                  <span className="absolute end-3 top-1/2 -translate-y-1/2 opacity-0 group-hover/link:opacity-100 transition-opacity text-sky-400">
                                    {isRtl ? <ChevronLeft size={14}/> : <ChevronRight size={14}/>}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {menu.promo && (
                      <div className="bg-gradient-to-r from-sky-50 to-indigo-50 border-t border-sky-100/50 p-4 px-6 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-indigo-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-sky-400/30">
                            <Gift size={18} />
                          </div>
                          <div>
                            <p className="font-black text-slate-800 text-sm">{L(menu.promo.ar, menu.promo.en)}</p>
                            <p className="font-bold text-slate-500 text-[11px] mt-0.5 uppercase tracking-widest">{L('استخدم الكود:', 'Use Code:')} <span className="text-sky-600 font-black">{menu.promo.code}</span></p>
                          </div>
                        </div>
                        <button onClick={() => goTo(shopTo(menu.categoryUrl, 'all'))} className="px-5 py-2.5 bg-white text-sky-600 text-xs font-black rounded-xl shadow-sm border border-sky-100 hover:shadow-md transition-all hover:scale-105 active:scale-95">
                          {L('تسوق الآن', 'Shop Now')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </nav>

          {/* Actions Section */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Search Bar */}
            <div ref={searchRef} className="relative group hidden xl:block">
              <form onSubmit={handleSearch}>
                <div className="relative">
                  <input
                    type="search"
                    placeholder={t('search')}
                    className="w-72 2xl:w-80 ps-4 pe-10 py-2.5 bg-white/90 border border-white/40 rounded-full text-sm text-slate-800 placeholder:text-slate-400 shadow-sm outline-none transition-all duration-300 focus:bg-white focus:border-white/70 focus:ring-4 focus:ring-white/25"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                  />
                  <button type="submit" className="absolute end-3 top-2.5 text-slate-500 hover:text-slate-900">
                    <Search size={18} />
                  </button>
                </div>
              </form>

              {/* 🚀 التعديل الجراحي السحري لصور البحث (محمية ومحبوسة في إطار) */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full mt-2 w-full bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden text-start z-50 max-h-[400px] overflow-y-auto custom-scrollbar">
                  {suggestions.map((item) => (
                    <Link 
                      key={item.id} 
                      to={`/product/${item.id}`} 
                      onClick={() => { setSearchQuery(''); closeAllOverlays(); }} 
                      className="flex items-center gap-3 p-3 hover:bg-sky-50 border-b border-slate-50 transition-colors"
                    >
                      {/* 🔥 إطار محمي ومربع ثابت يمنع خروج الصورة 🔥 */}
                      <div className="w-12 h-12 shrink-0 rounded-xl overflow-hidden bg-white border border-slate-200 shadow-sm flex items-center justify-center">
                        <img 
                          src={item.image} 
                          alt={item.name} 
                          className="w-full h-full object-cover" 
                          draggable={false}
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      </div>
                      
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <p className="text-[13px] font-bold text-slate-800 truncate">{getProductTitle(item)}</p>
                        <p className="text-[11px] font-black text-sky-600 mt-0.5">{item.price} JOD</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="hidden lg:block w-px h-8 bg-slate-800/10 mx-1"></div>

            <div className="flex items-center gap-2 sm:gap-3">
              <button onClick={() => goTo('/shop')} className="lg:hidden p-2 text-slate-900 hover:bg-white/20 rounded-full transition-colors active:scale-95" title={t('search')}>
                <Search size={22} strokeWidth={2.5} />
              </button>

              <button onClick={openWishlist} className="relative p-2 text-slate-900 hover:bg-white/20 rounded-full transition-colors active:scale-95 hidden sm:block">
                <Heart size={22} strokeWidth={2.5} />
                {wishlistCount > 0 && <span className="absolute top-0 end-0 w-4 h-4 bg-red-600 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white">{wishlistCount}</span>}
              </button>

              <button onClick={() => { closeAllOverlays(); setIsCartOpen(true); }} className="relative p-2 text-slate-900 hover:bg-white/20 rounded-full transition-colors active:scale-95">
                <ShoppingBag size={22} strokeWidth={2.5} />
                {cartCount > 0 && <span className="absolute top-0 end-0 w-4 h-4 bg-slate-900 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white">{cartCount}</span>}
              </button>

              <div ref={userMenuRef} className="relative hidden lg:block" onMouseEnter={user ? openUserMenuSafe : undefined} onMouseLeave={user ? closeUserMenuDelayed : undefined}>
                {user ? (
                  <>
                    <button onClick={() => setIsUserMenuOpen((v) => !v)} className="flex items-center gap-2 ms-1 px-2 py-1.5 rounded-full bg-white/80 hover:bg-white border border-white/60 shadow-sm transition-all">
                      <div className="w-9 h-9 rounded-xl bg-secondary-DEFAULT text-white flex items-center justify-center font-bold">
                        {user.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <ChevronDown size={16} className={`text-slate-700 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isUserMenuOpen && (
                      <div className="absolute top-full end-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-50 p-2">
                        <div className="px-3 py-2 border-b border-slate-100 mb-2">
                          <p className="text-sm font-extrabold text-slate-900 truncate">{user.name}</p>
                          <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                        </div>
                        <Link to="/account" onClick={() => setIsUserMenuOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-slate-50 text-sm font-bold text-slate-700">
                          <UserIcon size={16} /> {L('حسابي', 'My Account')}
                        </Link>
                        {user.role === 'admin' && (
                          <Link to="/admin" onClick={() => setIsUserMenuOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-slate-50 text-sm font-bold text-slate-700">
                            <LayoutDashboard size={16} /> {t('dashboard')}
                          </Link>
                        )}
                        <button onClick={() => { setIsUserMenuOpen(false); logout(); }} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-red-50 text-sm font-bold text-red-600 mt-1">
                          <LogOut size={16} /> {t('logout')}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <button onClick={() => goTo('/login')} className="ms-1 p-2.5 rounded-full bg-white/80 hover:bg-white shadow-sm transition-all text-slate-900">
                    <LogIn size={20} />
                  </button>
                )}
              </div>

              <button onClick={() => setIsMenuOpen(true)} className="lg:hidden p-2 text-slate-900 hover:bg-white/20 rounded-full transition-colors active:scale-95">
                <Menu size={28} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Menu */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-[9999] flex justify-end rtl:justify-start">
          <button type="button" onClick={() => setIsMenuOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" />
          
          <div className="relative w-[85%] max-w-sm bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-end-full rtl:slide-in-from-start-full duration-300">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
              <div className="font-black text-xl text-slate-900">{L('القائمة الرئيسية', 'Menu')}</div>
              <button onClick={() => setIsMenuOpen(false)} className="p-2 rounded-full bg-white border border-slate-200 hover:bg-slate-100 text-slate-900 shadow-sm active:scale-95">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar pb-24 space-y-2">
              {/* 🚀 زر الرئيسية في الموبايل - تم ربطه بـ Smooth Scroll */}
              <button onClick={(e) => { setIsMenuOpen(false); handleHomeClick(e); }} className="w-full flex items-center gap-3 p-4 rounded-2xl bg-slate-50 hover:bg-sky-50 text-slate-800 font-bold transition-colors">
                <Home size={20} className="text-sky-500" /> {t('home')}
              </button>

              {MEGA_MENU_DATA.map((menu) => {
                const isExpanded = mobileExpanded === menu.id;

                return (
                  <div key={menu.id} className="rounded-2xl border border-slate-100 overflow-hidden transition-all bg-white">
                    <button 
                      onClick={() => setMobileExpanded(isExpanded ? null : menu.id)}
                      className={`w-full flex items-center justify-between p-4 font-bold transition-colors ${isExpanded ? 'bg-slate-50 text-sky-600' : 'text-slate-800 hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <menu.icon size={20} className={isExpanded ? 'text-sky-500' : 'text-slate-400'} /> 
                        {L(menu.labelAr, menu.labelEn)}
                      </div>
                      <ChevronDown size={18} className={`transition-transform duration-300 ${isExpanded ? 'rotate-180 text-sky-500' : 'text-slate-400'}`} />
                    </button>
                    
                    <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                      <div className="p-3 bg-slate-50 border-t border-slate-100 flex flex-col gap-3">
                        <button onClick={() => goTo(shopTo(menu.categoryUrl, 'all'))} className="text-start px-4 py-3 rounded-xl text-sm font-extrabold text-white bg-slate-900 shadow-sm flex items-center justify-between">
                          {L('عرض كل المنتجات', 'View All')}
                          {isRtl ? <ChevronLeft size={16}/> : <ChevronRight size={16}/>}
                        </button>
                        
                        {menu.groups.map((group, gIdx) => (
                          <div key={gIdx} className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
                             <h4 className="text-[11px] font-black text-sky-500 mb-2 px-1 uppercase tracking-widest">{L(group.titleAr, group.titleEn)}</h4>
                             <div className="flex flex-col gap-1">
                               {group.links.map(link => (
                                 <button key={link.id} onClick={() => goTo(shopTo(group.categoryOverride || menu.categoryUrl, link.id))} className="text-start px-3 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:text-sky-600 hover:bg-sky-50 transition-colors flex items-center before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-slate-300 hover:before:bg-sky-500 before:me-3">
                                   {L(link.ar, link.en)}
                                 </button>
                               ))}
                             </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="h-px bg-slate-100 my-4" />

              <button onClick={openWishlist} className="w-full flex items-center justify-between p-4 rounded-2xl hover:bg-rose-50 text-slate-800 font-bold transition-colors group">
                <div className="flex items-center gap-3"><Heart size={20} className="text-rose-400 group-hover:fill-rose-400" /> {t('wishlist')}</div>
                {wishlistCount > 0 && <span className="bg-rose-500 text-white text-xs px-2 py-0.5 rounded-full">{wishlistCount}</span>}
              </button>

              <button onClick={() => goTo('/tracking')} className="w-full flex items-center gap-3 p-4 rounded-2xl hover:bg-slate-50 text-slate-800 font-bold transition-colors">
                <Truck size={20} className="text-slate-400" /> {t('tracking')}
              </button>

              {user && user.role === 'admin' && (
                <button onClick={() => goTo('/admin')} className="w-full flex items-center gap-3 p-4 rounded-2xl hover:bg-slate-50 text-slate-800 font-bold transition-colors border border-dashed border-slate-300 mt-2">
                  <LayoutDashboard size={20} className="text-slate-600" /> {t('dashboard')}
                </button>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-white">
              {!user ? (
                <button onClick={() => goTo('/login')} className="w-full py-3.5 rounded-xl bg-slate-900 text-white font-extrabold flex items-center justify-center gap-2 hover:bg-slate-800 shadow-lg shadow-slate-900/20">
                  <LogIn size={18} /> {t('login')}
                </button>
              ) : (
                <div className="flex items-center justify-between bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-lg shrink-0">
                      {user.name?.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-slate-900 truncate">{user.name}</p>
                      <Link to="/account" onClick={() => setIsMenuOpen(false)} className="text-xs text-sky-600 font-bold hover:underline">{L('إدارة الحساب', 'Manage Account')}</Link>
                    </div>
                  </div>
                  <button onClick={() => { closeAllOverlays(); logout(); }} className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors" title={t('logout')}>
                    <LogOut size={20} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;