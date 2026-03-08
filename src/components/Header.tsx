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
  Package,
  Gift,
  Gamepad2,
  PencilRuler,
  ChevronDown,
  User as UserIcon,
} from 'lucide-react';
import { useCart } from '../App';
import Button from './Button';
import LazyImage from './LazyImage';

// ✅ Single Source of Truth (Games subcategories + routes)
import { GAMES_SUBCATEGORIES, gamesTo } from '../config/nav';

type DesktopDropdownKey = 'games' | 'stationery' | 'gifts' | null;

const Header: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
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

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // ✅ Desktop dropdown stable state
  const [openDropdown, setOpenDropdown] = useState<DesktopDropdownKey>(null);
  const dropdownCloseTimer = useRef<any>(null);
  const desktopNavRef = useRef<HTMLDivElement>(null);

  // ✅ User menu (account dropdown) - stable & clickable
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuCloseTimer = useRef<any>(null);

  // ✅ Sticky premium behavior
  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // =========================================================
  // ✅ World-Class Scroll Behavior
  // =========================================================
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

  const GAMES_MENU_ID = 'games-mega-menu';

  // ----------------------------
  // ✅ Styles (مركّزة ومصدر واحد - تم تحسين الخصائص المنطقية هنا)
  // ----------------------------
  const megaMenuClass = useMemo(
    () => `
      absolute top-full start-0 mt-3
      w-[420px] lg:w-[720px]
      rounded-2xl overflow-hidden z-50
      border border-slate-200/70
      shadow-[0_20px_60px_rgba(2,6,23,0.35)]
      bg-white
      animate-in fade-in slide-in-from-top-2
    `,
    []
  );

  const megaItemClass = useMemo(
    () => `
      w-full text-start
      px-3 py-2.5 rounded-xl
      text-sm font-bold text-slate-800
      hover:bg-slate-100 focus:bg-slate-100
      focus:outline-none
      transition-colors
    `,
    []
  );

  // ----------------------------
  // ✅ Dropdown Data
  // ----------------------------
  const NAV = useMemo(() => {
    const gamesSub = GAMES_SUBCATEGORIES;

    const stationerySub = [
      { labelAr: 'أقلام رصاص', labelEn: 'Pencils', sub: 'pencils' },
      { labelAr: 'أقلام حبر', labelEn: 'Pens', sub: 'pens' },
      { labelAr: 'محايات', labelEn: 'Erasers', sub: 'erasers' },
      { labelAr: 'برايات', labelEn: 'Sharpeners', sub: 'sharpeners' },
      { labelAr: 'دفاتر', labelEn: 'Notebooks', sub: 'notebooks' },
      { labelAr: 'ألوان', labelEn: 'Colors', sub: 'colors' },
      { labelAr: 'قرطاسية مدرسية', labelEn: 'School Supplies', sub: 'school' },
    ];

    const giftsSub = [
      { labelAr: 'هدايا مناسبات', labelEn: 'Occasion Gifts', sub: 'occasion' },
      { labelAr: 'هدايا للأطفال', labelEn: 'Kids Gifts', sub: 'kids' },
      { labelAr: 'تغليف وورق هدايا', labelEn: 'Gift Wrap', sub: 'wrap' },
      { labelAr: 'بوكيهات وورد', labelEn: 'Bouquets', sub: 'bouquets' },
    ];

    return {
      home: { labelAr: t('home'), labelEn: t('home'), path: '/' },
      games: {
        labelAr: 'ألعاب',
        labelEn: 'Games',
        icon: Gamepad2,
        items: gamesSub,
        to: (sub: string) => gamesTo(sub),
      },
      stationery: {
        labelAr: 'قرطاسية',
        labelEn: 'Stationery',
        icon: PencilRuler,
        items: stationerySub,
        to: (sub: string) => `/shop?filter=Stationery&sub=${encodeURIComponent(sub)}`,
      },
      gifts: {
        labelAr: 'هدايا',
        labelEn: 'Gifts',
        icon: Gift,
        items: giftsSub,
        to: (sub: string) => `/shop?filter=Offers&sub=${encodeURIComponent(sub)}`,
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

  const openWishlist = () => {
    goTo('/wishlist');
  };

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
      if (!desktopNavRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
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

  const L = (ar: string, en: string) => (language === 'ar' ? ar : en);
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

  const splitToColumns = (items: Array<{ labelAr: string; labelEn: string; sub: string }>, colCount: number) => {
    const perCol = Math.ceil(items.length / colCount);
    return Array.from({ length: colCount }, (_, i) => items.slice(i * perCol, (i + 1) * perCol));
  };

  const userPhone = (user as any)?.phone || (user as any)?.phoneNumber || '';

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
                title={L('اسحب للتبديل بين الرسائل', 'Swipe to switch messages')}
              >
                <button
                  type="button"
                  onClick={prevTopBar}
                  className="p-1.5 rounded-full hover:bg-white/10 transition-colors active:scale-95"
                  aria-label="Previous message"
                >
                  {isRtl ? <ChevronRight size={16} className="text-white drop-shadow" /> : <ChevronLeft size={16} className="text-white drop-shadow" />}
                </button>

                <button
                  type="button"
                  onClick={() => goTo(activeTop.to)}
                  className="flex-1 min-w-0 text-[13px] sm:text-[14px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)] truncate text-center hover:opacity-95 transition-opacity"
                  aria-label="Open top message"
                >
                  <span className="me-1">{activeTop.icon}</span>
                  {L(activeTop.ar, activeTop.en)}
                </button>

                <button
                  type="button"
                  onClick={nextTopBar}
                  className="p-1.5 rounded-full hover:bg-white/10 transition-colors active:scale-95"
                  aria-label="Next message"
                >
                  {isRtl ? <ChevronLeft size={16} className="text-white drop-shadow" /> : <ChevronRight size={16} className="text-white drop-shadow" />}
                </button>
              </div>

              <button
                onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 border border-white/25 hover:bg-white/25 transition-colors text-white font-extrabold text-[12px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)]"
                type="button"
                aria-label="Switch Language"
              >
                <Globe size={14} />
                <span className="uppercase">{language}</span>
              </button>
            </div>
          </div>
        </div>

        <div
          className={[
            'w-full max-w-[1550px] mx-auto grid grid-cols-[auto,1fr,auto] items-center',
            isScrolled ? 'h-[72px]' : 'h-20',
            'px-5 sm:px-6 lg:px-14 gap-3',
          ].join(' ')}
        >
          <Link
            to="/"
            className="flex items-center group shrink-0 min-w-0 ps-2 sm:ps-4"
            aria-label="Home"
            onClick={closeAllOverlays}
          >
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

          {/* Desktop Navigation */}
          <nav ref={desktopNavRef} className="hidden md:flex items-center space-s-3">
            <Link
              to="/"
              onClick={closeAllOverlays}
              className={`text-sm font-bold transition-colors duration-300 ease-in-out relative py-2 px-3 rounded-lg group flex items-center gap-2 ${
                isActivePath('/')
                  ? 'text-slate-900 bg-white/30 shadow-sm'
                  : 'text-slate-900 hover:bg-white/20 hover:text-slate-950 hover:shadow-sm'
              }`}
            >
              <Home size={18} />
              <span>{t('home')}</span>
            </Link>

            {/* Games */}
            <div className="relative" onMouseEnter={() => openDropdownSafe('games')} onMouseLeave={closeDropdownDelayed}>
              <button
                type="button"
                aria-expanded={openDropdown === 'games'}
                onClick={() => setOpenDropdown((p) => (p === 'games' ? null : 'games'))}
                className="text-sm font-bold text-slate-900 hover:bg-white/20 hover:shadow-sm transition-all py-2 px-3 rounded-lg flex items-center gap-2"
              >
                <Gamepad2 size={18} />
                <span>{L(NAV.games.labelAr, NAV.games.labelEn)}</span>
                <ChevronDown size={16} className={`opacity-70 transition-transform ${openDropdown === 'games' ? 'rotate-180 opacity-100' : ''}`} />
              </button>

              {openDropdown === 'games' && (
                <div id={GAMES_MENU_ID} role="menu" className={megaMenuClass}>
                  <div className="h-2 bg-transparent" />
                  <div className="p-4 lg:p-5">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-xl bg-secondary-DEFAULT text-white flex items-center justify-center shadow-sm" />
                        <div className="leading-tight">
                          <p className="text-lg font-extrabold text-slate-900 tracking-wide">{L('تصفّح الألعاب', 'Browse Games')}</p>
                          <p className="text-xs text-slate-500">{L('اختر القسم المناسب', 'Pick a category')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => goTo(gamesTo('all'))} className="text-xs font-bold px-3 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors">
                          {L('عرض كل الألعاب', 'View All')}
                        </button>
                        <button type="button" onClick={() => goTo('/shop?filter=Games&sort=new')} className="text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-800 hover:bg-slate-200 transition-colors">
                          {L('الجديد', 'New')}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                      {splitToColumns(NAV.games.items, 3).map((col, idx) => (
                        <div key={idx} className="max-h-[360px] overflow-auto pe-1">
                          {col.map((it) => (
                            <button key={it.sub} type="button" role="menuitem" onClick={() => goTo(NAV.games.to(it.sub))} className={megaItemClass}>
                              {L(it.labelAr, it.labelEn)}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Stationery */}
            <div className="relative" onMouseEnter={() => openDropdownSafe('stationery')} onMouseLeave={closeDropdownDelayed}>
              <button
                type="button"
                onClick={() => setOpenDropdown((p) => (p === 'stationery' ? null : 'stationery'))}
                className="text-sm font-bold text-slate-900 hover:bg-white/20 hover:shadow-sm transition-all py-2 px-3 rounded-lg flex items-center gap-2"
              >
                <PencilRuler size={18} />
                <span>{L(NAV.stationery.labelAr, NAV.stationery.labelEn)}</span>
                <ChevronDown size={16} className={`opacity-70 transition-transform ${openDropdown === 'stationery' ? 'rotate-180 opacity-100' : ''}`} />
              </button>

              {openDropdown === 'stationery' && (
                <div role="menu" className={megaMenuClass}>
                  <div className="h-2 bg-transparent" />
                  <div className="p-4 lg:p-5">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-xl bg-secondary-DEFAULT text-white flex items-center justify-center shadow-sm">
                          <PencilRuler size={18} />
                        </div>
                        <div className="leading-tight">
                          <p className="text-lg font-extrabold text-slate-900 tracking-wide">{L('تصفّح القرطاسية', 'Browse Stationery')}</p>
                          <p className="text-xs text-slate-600">{L('اختر القسم المناسب', 'Pick a category')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => goTo('/shop?filter=Stationery')} className="text-xs font-bold px-3 py-2 rounded-xl bg-white/15 text-white border border-white/20 hover:bg-white/20 transition-colors">
                          {L('عرض الكل', 'View All')}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                      {splitToColumns(NAV.stationery.items, 3).map((col, idx) => (
                        <div key={idx} className="max-h-[320px] overflow-auto pe-1">
                          {col.map((it) => (
                            <button key={it.sub} type="button" role="menuitem" onClick={() => goTo(NAV.stationery.to(it.sub))} className={megaItemClass}>
                              {L(it.labelAr, it.labelEn)}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Gifts */}
            <div className="relative" onMouseEnter={() => openDropdownSafe('gifts')} onMouseLeave={closeDropdownDelayed}>
              <button
                type="button"
                onClick={() => setOpenDropdown((p) => (p === 'gifts' ? null : 'gifts'))}
                className="text-sm font-bold text-slate-900 hover:bg-white/20 hover:shadow-sm transition-all py-2 px-3 rounded-lg flex items-center gap-2"
              >
                <Gift size={18} />
                <span>{L(NAV.gifts.labelAr, NAV.gifts.labelEn)}</span>
                <ChevronDown size={16} className={`opacity-70 transition-transform ${openDropdown === 'gifts' ? 'rotate-180 opacity-100' : ''}`} />
              </button>
              {openDropdown === 'gifts' && (
                <div className={megaMenuClass}>
                  {NAV.gifts.items.map((it) => (
                    <button key={it.sub} type="button" role="menuitem" onClick={() => goTo(NAV.gifts.to(it.sub))} className={megaItemClass}>
                      {L(it.labelAr, it.labelEn)}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                  />
                  <button type="submit" className="absolute end-3 top-2.5 text-slate-500 group-focus-within:text-slate-900 transition-colors duration-200" aria-label="Search">
                    <Search size={18} />
                  </button>
                </div>
              </form>

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full mt-2 w-full bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 text-start z-50">
                  {suggestions.map((item) => (
                    <Link
                      key={item.id}
                      to={`/product/${item.id}`}
                      onClick={() => {
                        setSearchQuery('');
                        closeAllOverlays();
                      }}
                      className="flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                    >
                      <LazyImage src={item.image} alt={item.name} className="w-8 h-8 rounded-md object-cover" containerClassName="w-8 h-8 bg-slate-100 rounded-md shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{getProductTitle(item)}</p>
                        <p className="text-xs text-slate-500">{item.category}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="hidden md:block w-px h-8 bg-slate-800/10 mx-1"></div>

            {/* Desktop Icons */}
            <div className="hidden md:flex items-center gap-2">
              <Link to="/tracking" onClick={closeAllOverlays} className="p-2 hover:bg-white/20 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 text-slate-900 hover:shadow-sm" title={t('tracking')}>
                <Truck size={20} />
              </Link>

              <button onClick={openWishlist} className="relative p-2 hover:bg-white/20 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 text-slate-900 hover:shadow-sm" title={t('wishlist')} type="button">
                <Heart size={20} />
                {wishlistCount > 0 && (
                  <span className="absolute top-0 end-0 w-4 h-4 bg-red-600 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white animate-pulse">
                    {wishlistCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => {
                  closeAllOverlays();
                  setIsCartOpen(true);
                }}
                className="relative p-2 hover:bg-white/20 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 text-slate-900 hover:shadow-sm"
                title={t('cart')}
                type="button"
              >
                <ShoppingBag size={20} />
                {cartCount > 0 && (
                  <span className="absolute top-0 end-0 w-4 h-4 bg-slate-900 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white animate-pulse">
                    {cartCount}
                  </span>
                )}
              </button>

              <div ref={userMenuRef} className="relative" onMouseEnter={user ? openUserMenuSafe : undefined} onMouseLeave={user ? closeUserMenuDelayed : undefined}>
                {user ? (
                  <>
                    <button
                      type="button"
                      aria-expanded={isUserMenuOpen}
                      onClick={() => setIsUserMenuOpen((v) => !v)}
                      className="flex items-center gap-2 ms-1 px-2 py-1.5 rounded-full bg-white/80 hover:bg-white border border-white/60 shadow-sm hover:shadow-md transition-all active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-white/30"
                    >
                      <div className="w-9 h-9 rounded-xl bg-secondary-DEFAULT text-white flex items-center justify-center shadow-sm">
                        {user.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div className="flex flex-col leading-tight text-start">
                        <span className="text-xs font-extrabold text-slate-900 truncate max-w-[120px]">{user.name?.split(' ')?.[0]}</span>
                        <span className="text-[10px] font-bold text-slate-500 truncate max-w-[120px]">{user.role === 'admin' ? L('مسؤول', 'Admin') : L('حسابي', 'My Account')}</span>
                      </div>
                      <ChevronDown size={16} className={`text-slate-700 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isUserMenuOpen && (
                      <div role="menu" className="absolute top-full end-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 z-50">
                        <div className="h-2 bg-transparent" />
                        <div className="px-4 py-3 border-b border-slate-100">
                          <p className="text-xs font-extrabold text-slate-900 truncate">{user.name}</p>
                          <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                        </div>
                        <Link to="/account" role="menuitem" className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 text-sm font-bold text-slate-700" onClick={() => setIsUserMenuOpen(false)}>
                          <UserIcon size={16} /> {L('حسابي', 'My Account')}
                        </Link>
                        {user.role === 'admin' && (
                          <Link to="/admin" role="menuitem" className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 text-sm font-bold text-slate-700" onClick={() => setIsUserMenuOpen(false)}>
                            <LayoutDashboard size={16} /> {t('dashboard')}
                          </Link>
                        )}
                        <button
                          onClick={() => { setIsUserMenuOpen(false); logout(); }}
                          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-red-50 text-sm font-bold text-red-600"
                          type="button"
                          role="menuitem"
                        >
                          <LogOut size={16} /> {t('logout')}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <button type="button" onClick={() => goTo('/login')} className="ms-1 p-2.5 rounded-full bg-white/85 hover:bg-white border border-white/60 shadow-sm hover:shadow-md transition-all duration-300 text-slate-900 active:scale-[0.98] focus:outline-none inline-flex items-center justify-center">
                    <LogIn size={20} />
                  </button>
                )}
              </div>
            </div>

            {/* Mobile Actions */}
            <div className="flex md:hidden items-center gap-2">
              <button onClick={openWishlist} className="relative p-2 text-slate-900" type="button">
                <Heart size={24} />
                {wishlistCount > 0 && <span className="absolute top-0 end-0 w-4 h-4 bg-red-600 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white">{wishlistCount}</span>}
              </button>
              <button onClick={() => { closeAllOverlays(); setIsCartOpen(true); }} className="relative p-2 text-slate-900" type="button">
                <ShoppingBag size={24} />
                {cartCount > 0 && <span className="absolute top-0 end-0 w-4 h-4 bg-slate-900 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white">{cartCount}</span>}
              </button>
              <button onClick={() => setIsMenuOpen((v) => !v)} className="p-2 text-slate-900 hover:bg-white/20 rounded-full transition-colors active:scale-90" type="button">
                <Menu size={28} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Menu */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-[9999]">
          <button type="button" onClick={() => setIsMenuOpen(false)} className="absolute inset-0 bg-black/40" />
          <div className="absolute top-0 bottom-0 end-0 w-[86%] max-w-sm bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <div className="font-extrabold text-slate-900">{L('القائمة', 'Menu')}</div>
              <button type="button" onClick={() => setIsMenuOpen(false)} className="p-2 rounded-full hover:bg-slate-100 text-slate-900">
                <X size={22} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              {[
                { label: t('home'), icon: Home, action: () => goTo('/') },
                { label: L('ألعاب', 'Games'), icon: Gamepad2, action: () => goTo(gamesTo('all')) },
                { label: L('قرطاسية', 'Stationery'), icon: PencilRuler, action: () => goTo('/shop?filter=Stationery') },
                { label: L('عروض', 'Offers'), icon: Gift, action: () => goTo('/shop?filter=Offers') },
              ].map((item, i) => (
                <button key={i} type="button" onClick={item.action} className="w-full text-start px-3 py-3 rounded-xl hover:bg-slate-50 font-bold text-slate-900 flex items-center gap-2">
                  <item.icon size={18} /> {item.label}
                </button>
              ))}
              <div className="my-3 h-px bg-slate-100" />
              <button type="button" onClick={() => goTo('/tracking')} className="w-full text-start px-3 py-3 rounded-xl hover:bg-slate-50 font-bold text-slate-900 flex items-center gap-2">
                <Truck size={18} /> {t('tracking')}
              </button>
              {!user ? (
                <button type="button" onClick={() => goTo('/login')} className="w-full text-start px-3 py-3 rounded-xl hover:bg-slate-50 font-bold text-slate-900 flex items-center gap-2">
                  <LogIn size={18} /> {t('login')}
                </button>
              ) : (
                <button type="button" onClick={() => { closeAllOverlays(); logout(); }} className="w-full text-start px-3 py-3 rounded-xl hover:bg-red-50 font-bold text-red-600 flex items-center gap-2">
                  <LogOut size={18} /> {t('logout')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;