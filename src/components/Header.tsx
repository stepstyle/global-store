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
import LazyImage from './LazyImage';

// ✅ استدعاء البيانات من ملف nav الموحد
import { GAMES_SUBCATEGORIES, shopTo, SUBCATEGORIES_BY_CATEGORY } from '../config/nav';

type DesktopDropdownKey = 'games' | 'stationery' | 'gifts' | null;

const Header: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null); // ✅ حالة القائمة المنسدلة للموبايل
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

  // Desktop dropdown stable state
  const [openDropdown, setOpenDropdown] = useState<DesktopDropdownKey>(null);
  const dropdownCloseTimer = useRef<any>(null);
  const desktopNavRef = useRef<HTMLDivElement>(null);

  // User menu stable state
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuCloseTimer = useRef<any>(null);

  // Sticky premium behavior
  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTopInstant = useCallback(() => {
    if (location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.hash]);

  useEffect(() => {
    scrollToTopInstant();
  }, [location.pathname, location.search, scrollToTopInstant]);

  const closeAllOverlays = useCallback(() => {
    setShowSuggestions(false);
    setIsMenuOpen(false);
    setOpenDropdown(null);
    setIsUserMenuOpen(false);
    setMobileExpanded(null); // إغلاق قوائم الموبايل عند التنقل
  }, []);

  const openUserMenuSafe = () => {
    if (userMenuCloseTimer.current) clearTimeout(userMenuCloseTimer.current);
    setIsUserMenuOpen(true);
    setOpenDropdown(null);
  };

  const closeUserMenuDelayed = () => {
    if (userMenuCloseTimer.current) clearTimeout(userMenuCloseTimer.current);
    userMenuCloseTimer.current = setTimeout(() => setIsUserMenuOpen(false), 140);
  };

  // ----------------------------
  // ✅ بناء الروابط ديناميكياً للكمبيوتر والموبايل
  // ----------------------------
  const NAV = useMemo(() => {
    return {
      home: { labelAr: t('home'), labelEn: t('home'), path: '/' },
      games: {
        labelAr: 'ألعاب',
        labelEn: 'Games',
        icon: Gamepad2,
        items: SUBCATEGORIES_BY_CATEGORY.Games || [],
        to: (sub: string) => shopTo('Games', sub),
      },
      stationery: {
        labelAr: 'قرطاسية',
        labelEn: 'Stationery',
        icon: PencilRuler,
        items: SUBCATEGORIES_BY_CATEGORY.Stationery || [],
        to: (sub: string) => shopTo('Stationery', sub),
      },
      gifts: {
        labelAr: 'هدايا',
        labelEn: 'Gifts',
        icon: Gift,
        items: SUBCATEGORIES_BY_CATEGORY.Offers || [],
        to: (sub: string) => shopTo('Offers', sub),
      },
    };
  }, [t]);

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

  const openDropdownSafe = (key: DesktopDropdownKey) => {
    if (dropdownCloseTimer.current) clearTimeout(dropdownCloseTimer.current);
    setOpenDropdown(key);
    setIsUserMenuOpen(false);
  };

  const closeDropdownDelayed = () => {
    if (dropdownCloseTimer.current) clearTimeout(dropdownCloseTimer.current);
    dropdownCloseTimer.current = setTimeout(() => setOpenDropdown(null), 220);
  };

  const splitToColumns = (items: Array<any>, colCount: number) => {
    const perCol = Math.ceil(items.length / colCount);
    return Array.from({ length: colCount }, (_, i) => items.slice(i * perCol, (i + 1) * perCol));
  };

  // =========================================================
  // ✅ Dynamic Top Bar
  // =========================================================
  const topBarItems = useMemo(
    () => [
      { id: 'ship', icon: '🚚', ar: 'توصيل سريع خلال 24-48 ساعة', en: 'Fast delivery within 24–48 hours', to: '/tracking' },
      { id: 'deals', icon: '🎁', ar: 'عروض أسبوعية حصرية — اضغط للمشاهدة', en: 'Exclusive weekly deals — tap to view', to: '/shop?filter=Offers' },
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

  // التصميم الموحد للقوائم (Desktop)
  const megaMenuClass = `absolute top-full start-0 mt-3 w-[420px] lg:w-[720px] rounded-2xl overflow-hidden z-50 border border-slate-200/70 shadow-2xl bg-white animate-in fade-in slide-in-from-top-2`;
  const megaItemClass = `w-full text-start px-3 py-2.5 rounded-xl text-sm font-bold text-slate-800 hover:bg-slate-100 transition-colors`;

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

        {/* ✅ حل مشكلة الفليكس بوكس في الموبايل والكمبيوتر */}
        <div className={`w-full max-w-[1550px] mx-auto flex items-center justify-between px-5 sm:px-6 lg:px-14 transition-all duration-300 ${isScrolled ? 'h-[72px]' : 'h-20'}`}>
          
          {/* Logo Section */}
          <Link to="/" className="flex items-center group shrink-0 min-w-0" onClick={closeAllOverlays}>
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

          {/* Desktop Navigation (Centered) */}
          <nav ref={desktopNavRef} className="hidden lg:flex items-center justify-center flex-1 space-s-4 px-4">
            <Link to="/" onClick={closeAllOverlays} className={`text-sm font-bold transition-colors duration-300 relative py-2 px-3 rounded-lg group flex items-center gap-2 ${isActivePath('/') ? 'text-slate-900 bg-white/30 shadow-sm' : 'text-slate-900 hover:bg-white/20 hover:text-slate-950 hover:shadow-sm'}`}>
              <Home size={18} />
              <span>{t('home')}</span>
            </Link>

            {/* Desktop: Games */}
            <div className="relative" onMouseEnter={() => openDropdownSafe('games')} onMouseLeave={closeDropdownDelayed}>
              <button type="button" className="text-sm font-bold text-slate-900 hover:bg-white/20 hover:shadow-sm transition-all py-2 px-3 rounded-lg flex items-center gap-2">
                <NAV.games.icon size={18} />
                <span>{L(NAV.games.labelAr, NAV.games.labelEn)}</span>
                <ChevronDown size={16} className={`opacity-70 transition-transform ${openDropdown === 'games' ? 'rotate-180 opacity-100' : ''}`} />
              </button>
              {openDropdown === 'games' && (
                <div className={megaMenuClass}>
                  <div className="h-2 bg-transparent" />
                  <div className="p-4 lg:p-5">
                    <div className="flex justify-between items-center mb-4">
                      <div className="font-extrabold text-lg">{L('تصفّح الألعاب', 'Browse Games')}</div>
                      <button onClick={() => goTo(NAV.games.to('all'))} className="text-xs font-bold px-3 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800">{L('عرض الكل', 'View All')}</button>
                    </div>
                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                      {splitToColumns(NAV.games.items, 3).map((col, idx) => (
                        <div key={idx} className="flex flex-col">
                          {col.map((it) => (
                            <button key={it.sub} onClick={() => goTo(NAV.games.to(it.sub))} className={megaItemClass}>{L(it.labelAr, it.labelEn)}</button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Desktop: Stationery */}
            <div className="relative" onMouseEnter={() => openDropdownSafe('stationery')} onMouseLeave={closeDropdownDelayed}>
              <button type="button" className="text-sm font-bold text-slate-900 hover:bg-white/20 hover:shadow-sm transition-all py-2 px-3 rounded-lg flex items-center gap-2">
                <NAV.stationery.icon size={18} />
                <span>{L(NAV.stationery.labelAr, NAV.stationery.labelEn)}</span>
                <ChevronDown size={16} className={`opacity-70 transition-transform ${openDropdown === 'stationery' ? 'rotate-180 opacity-100' : ''}`} />
              </button>
              {openDropdown === 'stationery' && (
                <div className={megaMenuClass}>
                  <div className="h-2 bg-transparent" />
                  <div className="p-4 lg:p-5">
                    <div className="flex justify-between items-center mb-4">
                      <div className="font-extrabold text-lg">{L('تصفّح القرطاسية', 'Browse Stationery')}</div>
                      <button onClick={() => goTo(NAV.stationery.to('all'))} className="text-xs font-bold px-3 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800">{L('عرض الكل', 'View All')}</button>
                    </div>
                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                      {splitToColumns(NAV.stationery.items, 3).map((col, idx) => (
                        <div key={idx} className="flex flex-col">
                          {col.map((it) => (
                            <button key={it.sub} onClick={() => goTo(NAV.stationery.to(it.sub))} className={megaItemClass}>{L(it.labelAr, it.labelEn)}</button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Desktop: Gifts */}
            <div className="relative" onMouseEnter={() => openDropdownSafe('gifts')} onMouseLeave={closeDropdownDelayed}>
              <button type="button" className="text-sm font-bold text-slate-900 hover:bg-white/20 hover:shadow-sm transition-all py-2 px-3 rounded-lg flex items-center gap-2">
                <NAV.gifts.icon size={18} />
                <span>{L(NAV.gifts.labelAr, NAV.gifts.labelEn)}</span>
                <ChevronDown size={16} className={`opacity-70 transition-transform ${openDropdown === 'gifts' ? 'rotate-180 opacity-100' : ''}`} />
              </button>
              {openDropdown === 'gifts' && (
                <div className={`absolute top-full start-0 mt-3 w-64 rounded-2xl overflow-hidden z-50 border border-slate-200/70 shadow-2xl bg-white p-2 animate-in fade-in slide-in-from-top-2`}>
                  <button onClick={() => goTo(NAV.gifts.to('all'))} className="w-full text-start px-3 py-2.5 rounded-xl text-sm font-bold text-slate-900 bg-slate-100 mb-1">{L('عرض كل الهدايا', 'View All Gifts')}</button>
                  {NAV.gifts.items.map((it) => (
                    <button key={it.sub} onClick={() => goTo(NAV.gifts.to(it.sub))} className={megaItemClass}>{L(it.labelAr, it.labelEn)}</button>
                  ))}
                </div>
              )}
            </div>
          </nav>

          {/* Actions Section (Right Side on Desktop, Left on Mobile RTL) */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Search Bar (Desktop Only) */}
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
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full mt-2 w-full bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden text-start z-50">
                  {suggestions.map((item) => (
                    <Link key={item.id} to={`/product/${item.id}`} onClick={() => { setSearchQuery(''); closeAllOverlays(); }} className="flex items-center gap-3 p-3 hover:bg-slate-50 border-b border-slate-50">
                      <LazyImage src={item.image} alt={item.name} className="w-8 h-8 rounded-md object-cover" containerClassName="shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{getProductTitle(item)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="hidden lg:block w-px h-8 bg-slate-800/10 mx-1"></div>

            {/* Icons (Desktop & Mobile Unified Logic) */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Search Icon Mobile Only */}
              <button onClick={() => goTo('/shop')} className="lg:hidden p-2 text-slate-900 hover:bg-white/20 rounded-full transition-colors active:scale-95" title={t('search')}>
                <Search size={22} strokeWidth={2.5} />
              </button>

              {/* Wishlist */}
              <button onClick={openWishlist} className="relative p-2 text-slate-900 hover:bg-white/20 rounded-full transition-colors active:scale-95 hidden sm:block">
                <Heart size={22} strokeWidth={2.5} />
                {wishlistCount > 0 && <span className="absolute top-0 end-0 w-4 h-4 bg-red-600 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white">{wishlistCount}</span>}
              </button>

              {/* Cart */}
              <button onClick={() => { closeAllOverlays(); setIsCartOpen(true); }} className="relative p-2 text-slate-900 hover:bg-white/20 rounded-full transition-colors active:scale-95">
                <ShoppingBag size={22} strokeWidth={2.5} />
                {cartCount > 0 && <span className="absolute top-0 end-0 w-4 h-4 bg-slate-900 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white">{cartCount}</span>}
              </button>

              {/* Desktop User Menu */}
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

              {/* Hamburger Menu (Mobile Only) */}
              <button onClick={() => setIsMenuOpen(true)} className="lg:hidden p-2 text-slate-900 hover:bg-white/20 rounded-full transition-colors active:scale-95">
                <Menu size={28} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ✅ Mobile Drawer Menu (الاحترافية والأقسام المتعددة) */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-[9999] flex justify-end rtl:justify-start">
          <button type="button" onClick={() => setIsMenuOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" />
          
          <div className="relative w-[85%] max-w-sm bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-end-full rtl:slide-in-from-start-full duration-300">
            {/* Header Drawer */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
              <div className="font-black text-xl text-slate-900">{L('القائمة الرئيسية', 'Menu')}</div>
              <button onClick={() => setIsMenuOpen(false)} className="p-2 rounded-full bg-white border border-slate-200 hover:bg-slate-100 text-slate-900 shadow-sm active:scale-95">
                <X size={20} />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar pb-24 space-y-2">
              {/* Home */}
              <button onClick={() => goTo('/')} className="w-full flex items-center gap-3 p-4 rounded-2xl bg-slate-50 hover:bg-sky-50 text-slate-800 font-bold transition-colors">
                <Home size={20} className="text-sky-500" /> {t('home')}
              </button>

              {/* Dynamic Categories Accordion */}
              {['games', 'stationery', 'gifts'].map((key) => {
                const cat = NAV[key as keyof typeof NAV] as any;
                const isExpanded = mobileExpanded === key;

                return (
                  <div key={key} className="rounded-2xl border border-slate-100 overflow-hidden transition-all bg-white">
                    <button 
                      onClick={() => setMobileExpanded(isExpanded ? null : key)}
                      className={`w-full flex items-center justify-between p-4 font-bold transition-colors ${isExpanded ? 'bg-slate-50 text-sky-600' : 'text-slate-800 hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <cat.icon size={20} className={isExpanded ? 'text-sky-500' : 'text-slate-400'} /> 
                        {L(cat.labelAr, cat.labelEn)}
                      </div>
                      <ChevronDown size={18} className={`transition-transform duration-300 ${isExpanded ? 'rotate-180 text-sky-500' : 'text-slate-400'}`} />
                    </button>
                    
                    {/* Subcategories (Slide Down) */}
                    <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isExpanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
                      <div className="p-3 bg-slate-50 border-t border-slate-100 grid grid-cols-1 gap-1">
                        <button onClick={() => goTo(cat.to('all'))} className="text-start px-4 py-3 rounded-xl text-sm font-extrabold text-slate-900 bg-white border border-slate-200 shadow-sm">
                          {L('عرض كل المنتجات', 'View All')}
                        </button>
                        {cat.items.map((sub: any) => (
                          <button key={sub.sub} onClick={() => goTo(cat.to(sub.sub))} className="text-start px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:text-sky-600 hover:bg-sky-50 transition-colors flex items-center before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-slate-300 hover:before:bg-sky-500 before:me-3">
                            {L(sub.labelAr, sub.labelEn)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="h-px bg-slate-100 my-4" />

              {/* Bottom Actions */}
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

            {/* Footer Profile/Login */}
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