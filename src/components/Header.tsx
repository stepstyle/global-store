import React, { useState, useEffect, useRef, useMemo } from 'react';
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

  const openUserMenuSafe = () => {
    if (userMenuCloseTimer.current) clearTimeout(userMenuCloseTimer.current);
    setIsUserMenuOpen(true);
    setOpenDropdown(null);
  };

  const closeUserMenuDelayed = () => {
    if (userMenuCloseTimer.current) clearTimeout(userMenuCloseTimer.current);
    userMenuCloseTimer.current = setTimeout(() => setIsUserMenuOpen(false), 140);
  };

  // ✅ Games MegaMenu constants
  const GAMES_MENU_ID = 'games-mega-menu';

  // ----------------------------
  // ✅ Dropdown Data
  // ----------------------------
  const NAV = useMemo(() => {
    // ✅ SINGLE SOURCE: from config/nav.ts
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
        // ✅ exact same routing function everywhere
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

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedQuery(searchQuery), 500);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Lock Body Scroll on mobile menu
  useEffect(() => {
    if (isMenuOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    } else {
      document.body.style.overflow = 'unset';
      document.body.style.touchAction = 'auto';
    }
    return () => {
      document.body.style.overflow = 'unset';
      document.body.style.touchAction = 'auto';
    };
  }, [isMenuOpen]);

  const goTo = (path: string) => {
    setShowSuggestions(false);
    setIsMenuOpen(false);
    setOpenDropdown(null);
    setIsUserMenuOpen(false);

    navigate(path);

    setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    }, 0);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      goTo(`/shop?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const openWishlist = () => {
    setShowSuggestions(false);
    setIsMenuOpen(false);
    setOpenDropdown(null);
    setIsUserMenuOpen(false);
    goTo('/wishlist');
  };

  // Close suggestions on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close desktop dropdown on click outside
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

  // Close user menu on click outside + ESC
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

  const suggestions =
    debouncedQuery.length > 1
      ? products
          .filter(
            (p) =>
              (p.name || '').toLowerCase().includes(debouncedQuery.toLowerCase()) ||
              (p.nameEn || '').toLowerCase().includes(debouncedQuery.toLowerCase())
          )
          .slice(0, 5)
      : [];

  const L = (ar: string, en: string) => (language === 'ar' ? ar : en);
  const isActivePath = (path: string) => location.pathname === path;

  const openDropdownSafe = (key: DesktopDropdownKey) => {
    if (dropdownCloseTimer.current) clearTimeout(dropdownCloseTimer.current);
    setOpenDropdown(key);
    setIsUserMenuOpen(false);
  };

  const closeDropdownDelayed = () => {
    if (dropdownCloseTimer.current) clearTimeout(dropdownCloseTimer.current);
    dropdownCloseTimer.current = setTimeout(() => setOpenDropdown(null), 140);
  };

  const splitToColumns = (items: Array<{ labelAr: string; labelEn: string; sub: string }>, colCount: number) => {
    const perCol = Math.ceil(items.length / colCount);
    return Array.from({ length: colCount }, (_, i) => items.slice(i * perCol, (i + 1) * perCol));
  };

  // ✅ الهاتف (غيّر اسم الحقل إذا عندك مختلف)
  const userPhone = (user as any)?.phone || (user as any)?.phoneNumber || '';

  return (
    <>
      <header className="sticky top-0 z-20 w-full bg-gradient-to-r from-primary-dark via-white/5 to-secondary-dark backdrop-blur-md border-b border-white/20 shadow-lg font-sans transition-all duration-300">
      <div className="w-full max-w-[1550
      px] mx-auto grid grid-cols-[auto,1fr,auto] items-center h-20 px-6 lg:px-14 gap-3">          <Link
            to="/"
            className="flex items-center group shrink-0 min-w-0 ps-2 sm:ps-4"
            aria-label="Home"
            title="Home"
            onClick={() => {
              setOpenDropdown(null);
              setIsUserMenuOpen(false);
              setShowSuggestions(false);
              window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            }}
          >

            
            <div className="w-7 h-10 bg-white/20 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg group-hover:rotate-12 transition-transform duration-300 backdrop-blur-sm border border-white/30 shrink-0">
              A
            </div>
<div
                className="
                  text-xl font-heading font-bold text-slate-900 tracking-tight
                  group-hover:text-white transition-colors duration-300
                  truncate
                  max-w-[160px] sm:max-w-[220px] lg:max-w-[260px]
                "
              >
                
            <div className="flex flex-col ms-5 min-w--50 max-w-[300px]">
                 Dair  Sharaf
                 </div>
              <span
                className="
                  text-[10px] text-slate-800 font-medium tracking-widest uppercase
                  group-hover:text-slate-100 transition-colors duration-300
                  truncate
                  max-w-[220px] sm:max-w-[220px] lg:max-w-[260px]
                "
              >
                Tech & Art
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav ref={desktopNavRef} className="hidden md:flex items-center space-x-reverse space-x-3 rtl:space-x-reverse">
            <Link
              to="/"
              onClick={() => {
                setOpenDropdown(null);
                setIsUserMenuOpen(false);
                window.scrollTo({ top: 0, left: 2, behavior: 'smooth' });
              }}
              className={`text-sm font-bold transition-colors duration-300 ease-in-out relative py-2 px-3 rounded-lg group flex items-center gap-2 ${
                isActivePath('/')
                  ? 'text-slate-900 bg-white/30 shadow-sm'
                  : 'text-slate-900 hover:bg-white/20 hover:text-slate-950 hover:shadow-sm'
              }`}
            >
              <Home size={18} />
              <span>{t('home')}</span>
            </Link>

            {/* ✅ Games Mega Menu */}
            <div className="relative" onMouseEnter={() => openDropdownSafe('games')} onMouseLeave={closeDropdownDelayed}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-controls="games-mega-menu"
                aria-expanded={openDropdown === 'games'}
                onClick={() => setOpenDropdown((p) => (p === 'games' ? null : 'games'))}
                className="text-sm font-bold text-slate-900 hover:bg-white/20 hover:shadow-sm transition-all py-2 px-3 rounded-lg flex items-center gap-2"
              >
                <Gamepad2 size={18} />
                <span>{L(NAV.games.labelAr, NAV.games.labelEn)}</span>
                <ChevronDown
                  size={16}
                  className={`opacity-70 transition-transform ${openDropdown === 'games' ? 'rotate-180 opacity-100' : ''}`}
                />
              </button>

              {openDropdown === 'games' && (
                <div
                  id={GAMES_MENU_ID}
                  role="menu"
                  className="
                    absolute top-full left-0 rtl:left-auto rtl:right-0
                    w-[400px] lg:w-[680px]
                    bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden
                    animate-in fade-in slide-in-from-top-2 z-50
                  "
                >
                  <div className="h-2 bg-transparent" />

                  <div className="p-4 lg:p-5">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-sm">
                          <Gamepad2 size={18} />
                        </div>
                        <div className="leading-tight">
                          <p className="text-sm font-extrabold text-slate-900">{L('تصفّح الألعاب', 'Browse Games')}</p>
                          <p className="text-xs text-slate-500">{L('اختر القسم المناسب', 'Pick a category')}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => goTo(gamesTo('all'))}
                          className="text-xs font-bold px-3 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                        >
                          {L('عرض كل الألعاب', 'View All')}
                        </button>
                        <button
                          type="button"
                          onClick={() => goTo('/shop?filter=Games&sort=new')}
                          className="text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-800 hover:bg-slate-200 transition-colors"
                        >
                          {L('الجديد', 'New')}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                      {(() => {
                        const items = NAV.games.items;
                        const colCount = 3;
                        const cols = splitToColumns(items, colCount);
                        return cols.map((col, idx) => (
                          <div key={idx} className="max-h-[360px] overflow-auto pr-1 rtl:pr-0 rtl:pl-1">
                            {col.map((it) => (
                              <button
                                key={it.sub}
                                type="button"
                                role="menuitem"
                                onClick={() => goTo(NAV.games.to(it.sub))}
                                className="
                                  w-full text-right rtl:text-right ltr:text-left
                                  px-3 py-2.5 rounded-xl
                                  text-sm font-bold text-slate-700
                                  hover:bg-slate-50 focus:bg-slate-50
                                  focus:outline-none
                                "
                              >
                                {L(it.labelAr, it.labelEn)}
                              </button>
                            ))}
                          </div>
                        ));
                      })()}
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                      <span>{L('نصيحة: استخدم البحث للوصول للمنتج بسرعة', 'Tip: Use search to find products faster')}</span>
                      <button
                        type="button"
                        onClick={() => setOpenDropdown(null)}
                        className="font-bold text-slate-700 hover:text-slate-900"
                      >
                        {L('إغلاق', 'Close')}
                      </button>
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
                <ChevronDown
                  size={16}
                  className={`opacity-70 transition-transform ${openDropdown === 'stationery' ? 'rotate-180 opacity-100' : ''}`}
                />
              </button>

              {openDropdown === 'stationery' && (
                <div className="absolute top-full left-0 rtl:left-auto rtl:right-0 min-w-[260px] bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 z-50">
                  {NAV.stationery.items.map((it) => (
                    <button
                      key={it.sub}
                      type="button"
                      onClick={() => goTo(NAV.stationery.to(it.sub))}
                      className="w-full text-right rtl:text-right ltr:text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                    >
                      {L(it.labelAr, it.labelEn)}
                    </button>
                  ))}
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
                <ChevronDown
                  size={16}
                  className={`opacity-70 transition-transform ${openDropdown === 'gifts' ? 'rotate-180 opacity-100' : ''}`}
                />
              </button>

              {openDropdown === 'gifts' && (
                <div className="absolute top-full left-0 rtl:left-auto rtl:right-0 min-w-[260px] bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 z-50">
                  {NAV.gifts.items.map((it) => (
                    <button
                      key={it.sub}
                      type="button"
                      onClick={() => goTo(NAV.gifts.to(it.sub))}
                      className="w-full text-right rtl:text-right ltr:text-left px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                    >
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
             <div ref={searchRef} className="relative group hidden xl:block">              <form onSubmit={handleSearch}>
                <div className="relative">
                  <input
                    type="search"
                    placeholder={t('search')}
                    className="w-64 pl-4 pr-10 rtl:pl-10 rtl:pr-4 py-2.5 bg-white/90 border-transparent focus:border-white rounded-full text-sm focus:ring-4 focus:ring-white/30 outline-none shadow-sm text-slate-800 placeholder:text-slate-400 transition-shadow duration-300"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                  />
                  <button
                    type="submit"
                    className="absolute right-3 rtl:left-3 rtl:right-auto top-2.5 text-slate-400 group-focus-within:text-slate-900 transition-colors duration-200"
                  >
                    <Search size={18} />
                  </button>
                </div>
              </form>

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full mt-2 w-full bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 text-right rtl:text-right ltr:text-left z-50">
                  {suggestions.map((item) => (
                    <Link
                      key={item.id}
                      to={`/product/${item.id}`}
                      onClick={() => {
                        setSearchQuery('');
                        setShowSuggestions(false);
                        setOpenDropdown(null);
                        setIsUserMenuOpen(false);
                        setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }), 0);
                      }}
                      className="flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                    >
                      <LazyImage
                        src={item.image}
                        alt={item.name}
                        className="w-8 h-8 rounded-md object-cover"
                        containerClassName="w-8 h-8 bg-slate-100 rounded-md shrink-0"
                      />
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
              <button
                onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                className="p-2 hover:bg-white/20 rounded-full text-slate-900 transition-all duration-300 hover:scale-110 active:scale-95 hover:shadow-sm flex items-center gap-1"
                title="Switch Language"
                type="button"
              >
                <Globe size={18} />
                <span className="text-xs font-bold">{language.toUpperCase()}</span>
              </button>

              <Link
                to="/tracking"
                onClick={() => {
                  setOpenDropdown(null);
                  setIsUserMenuOpen(false);
                  setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }), 0);
                }}
                className="p-2 hover:bg-white/20 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 text-slate-900 hover:shadow-sm"
                title={t('tracking')}
              >
                <Truck size={20} />
              </Link>

              <button
                onClick={() => openWishlist()}
                className="relative p-2 hover:bg-white/20 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 text-slate-900 hover:shadow-sm"
                title={t('wishlist')}
                type="button"
              >
                <Heart size={20} />
                {wishlistCount > 0 && (
                  <span className="absolute top-0 right-0 w-4 h-4 bg-red-600 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white animate-bounce">
                    {wishlistCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setIsCartOpen(true)}
                className="relative p-2 hover:bg-white/20 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 text-slate-900 hover:shadow-sm"
                title={t('cart')}
                type="button"
              >
                <ShoppingBag size={20} />
                {cartCount > 0 && (
                  <span className="absolute top-0 right-0 w-4 h-4 bg-slate-900 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white animate-bounce">
                    {cartCount}
                  </span>
                )}
              </button>

              <div
                ref={userMenuRef}
                className="relative"
                onMouseEnter={user ? openUserMenuSafe : undefined}
                onMouseLeave={user ? closeUserMenuDelayed : undefined}
              >
                {user ? (
                  <>
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={isUserMenuOpen}
                      onClick={() => setIsUserMenuOpen((v) => !v)}
                      className="
                        flex items-center gap-2 ms-1
                        px-2 py-1.5 rounded-full
                        bg-white/80 hover:bg-white
                        border border-white/60
                        shadow-sm hover:shadow-md
                        transition-all
                        active:scale-[0.98]
                      "
                    >
                      <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center font-extrabold text-sm">
                        {user.name?.charAt(0)?.toUpperCase()}
                      </div>

                      <div className="flex flex-col leading-tight text-right rtl:text-right ltr:text-left">
                        <span className="text-xs font-extrabold text-slate-900 truncate max-w-[120px]">
                          {user.name?.split(' ')?.[0]}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500 truncate max-w-[120px]">
                          {user.role === 'admin' ? L('مسؤول', 'Admin') : L('حسابي', 'My Account')}
                        </span>
                      </div>

                      <ChevronDown
                        size={16}
                        className={`text-slate-700 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {isUserMenuOpen && (
                      <div
                        role="menu"
                        className="
                          absolute top-full right-0 rtl:right-auto rtl:left-0 mt-2
                          w-64 bg-white rounded-2xl shadow-2xl
                          border border-slate-100 overflow-hidden
                          animate-in fade-in slide-in-from-top-2 z-50
                        "
                      >
                        <div className="h-2 bg-transparent" />

                        <div className="px-4 py-3 border-b border-slate-100">
                          <p className="text-xs font-extrabold text-slate-900 truncate">{user.name}</p>
                          <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {L('الهاتف: ', 'Phone: ')}
                            <span className="font-bold text-slate-700">{userPhone || L('غير متوفر', 'N/A')}</span>
                          </p>
                        </div>

                        <Link
                          to="/account"
                          role="menuitem"
                          className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 text-sm font-bold text-slate-700"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }), 0);
                          }}
                        >
                          <UserIcon size={16} /> {L('حسابي', 'My Account')}
                        </Link>

                        {user.role === 'admin' && (
                          <Link
                            to="/admin"
                            role="menuitem"
                            className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 text-sm font-bold text-slate-700"
                            onClick={() => {
                              setIsUserMenuOpen(false);
                              setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }), 0);
                            }}
                          >
                            <LayoutDashboard size={16} /> {t('dashboard')}
                          </Link>
                        )}

                        <Link
                          to="/my-orders"
                          role="menuitem"
                          className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 text-sm font-bold text-slate-700"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }), 0);
                          }}
                        >
                          <Package size={16} /> {t('myOrders')}
                        </Link>

                        <button
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            logout();
                          }}
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
                  <button
                    type="button"
                    onClick={() => goTo('/login')}
                    className="
                      ms-1 px-3 py-2 rounded-full
                      bg-white/70 hover:bg-white
                      border border-white/60
                      shadow-sm hover:shadow-md
                      transition-all duration-300
                      flex items-center gap-2
                      text-slate-900
                      active:scale-[0.98]
                    "
                    title={t('login')}
                  >
                    <LogIn size={18} />
                    <span className="text-xs font-extrabold">{L('تسجيل الدخول', 'Login')}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Mobile */}
            <div className="flex md:hidden items-center gap-2">
              <button onClick={openWishlist} className="relative p-2 text-slate-900" aria-label="Open Wishlist" type="button">
                <Heart size={24} />
                {wishlistCount > 0 && (
                  <span className="absolute top-0 right-0 w-4 h-4 bg-red-600 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white">
                    {wishlistCount}
                  </span>
                )}
              </button>

              <button onClick={() => setIsCartOpen(true)} className="relative p-2 text-slate-900" aria-label="Open Cart" type="button">
                <ShoppingBag size={24} />
                {cartCount > 0 && (
                  <span className="absolute top-0 right-0 w-4 h-4 bg-slate-900 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white">
                    {cartCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setIsMenuOpen(true)}
                className="p-2 text-slate-900 hover:bg-white/20 rounded-full transition-colors active:scale-90"
                aria-label="Open Menu"
                type="button"
              >
                <Menu size={28} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-[9999] bg-white flex flex-col animate-in fade-in duration-200 overflow-hidden">
          <div className="flex items-center justify-between p-4 h-20 border-b border-slate-100 shrink-0 bg-white">
            <Link
              to="/"
              onClick={() => {
                setIsMenuOpen(false);
                window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
              }}
              className="flex items-center min-w-0"
            >
              <div className="w-10 h-10 bg-primary-DEFAULT rounded-xl flex items-center justify-center text-slate-900 font-bold text-xl shadow-sm shrink-0">
                A
              </div>
              <span className="text-xl font-heading font-bold text-slate-900 ms-3 truncate max-w-[220px]">
                Dair sharaf
              </span>
            </Link>

            <div className="flex gap-2">
              <button
                onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                className="p-2 bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200 transition-colors flex items-center gap-1"
                type="button"
              >
                <Globe size={18} />
                <span className="text-xs font-bold">{language.toUpperCase()}</span>
              </button>
              <button
                onClick={() => setIsMenuOpen(false)}
                className="p-2 bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200 hover:text-red-500 transition-colors"
                aria-label="Close Menu"
                type="button"
              >
                <X size={24} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24 touch-pan-y">
            <form onSubmit={handleSearch} className="relative">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search')}
                className="w-full pl-4 pr-12 rtl:pl-12 rtl:pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-secondary-light outline-none"
              />
              <button type="submit" className="absolute left-4 rtl:left-auto rtl:right-4 top-3.5 text-slate-400">
                <Search size={20} />
              </button>
            </form>

            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">{t('menu_main')}</h3>

              <Link
                to="/"
                onClick={() => {
                  setIsMenuOpen(false);
                  window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                }}
                className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 text-slate-800 font-bold transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 rounded-lg text-slate-600">
                    <Home size={20} />
                  </div>
                  {t('home')}
                </div>
                <ChevronLeft size={16} className="text-slate-300 rtl:rotate-180 ltr:rotate-0" />
              </Link>

              <div className="bg-slate-50 rounded-2xl p-3">
                <div className="flex items-center gap-2 font-bold text-slate-800 mb-2">
                  <Gamepad2 size={18} /> {language === 'ar' ? 'ألعاب' : 'Games'}
                </div>
                <div className="space-y-1">
                  {NAV.games.items.map((it) => (
                    <button
                      key={it.sub}
                      type="button"
                      onClick={() => goTo(NAV.games.to(it.sub))}
                      className="w-full text-right px-3 py-2 rounded-xl hover:bg-white text-sm font-bold text-slate-700"
                    >
                      {language === 'ar' ? it.labelAr : it.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-50 rounded-2xl p-3">
                <div className="flex items-center gap-2 font-bold text-slate-800 mb-2">
                  <PencilRuler size={18} /> {language === 'ar' ? 'قرطاسية' : 'Stationery'}
                </div>
                <div className="space-y-1">
                  {NAV.stationery.items.map((it) => (
                    <button
                      key={it.sub}
                      type="button"
                      onClick={() => goTo(NAV.stationery.to(it.sub))}
                      className="w-full text-right px-3 py-2 rounded-xl hover:bg-white text-sm font-bold text-slate-700"
                    >
                      {language === 'ar' ? it.labelAr : it.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-50 rounded-2xl p-3">
                <div className="flex items-center gap-2 font-bold text-slate-800 mb-2">
                  <Gift size={18} /> {language === 'ar' ? 'هدايا' : 'Gifts'}
                </div>
                <div className="space-y-1">
                  {NAV.gifts.items.map((it) => (
                    <button
                      key={it.sub}
                      type="button"
                      onClick={() => goTo(NAV.gifts.to(it.sub))}
                      className="w-full text-right px-3 py-2 rounded-xl hover:bg-white text-sm font-bold text-slate-700"
                    >
                      {language === 'ar' ? it.labelAr : it.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              <Link
                to="/tracking"
                onClick={() => {
                  setIsMenuOpen(false);
                  setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }), 0);
                }}
                className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 text-slate-800 font-bold transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 rounded-lg text-slate-600">
                    <Truck size={20} />
                  </div>
                  {t('tracking')}
                </div>
                <ChevronLeft size={16} className="text-slate-300 rtl:rotate-180 ltr:rotate-0" />
              </Link>
            </div>

            <div className="border-t border-slate-100 pt-6">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-2">{t('menu_account')}</h3>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <Button
                  variant="ghost"
                  onClick={openWishlist}
                  className="bg-slate-50 hover:bg-blue-400 hover:text-white text-slate-800 justify-start h-auto py-3 px-4"
                  type="button"
                >
                  <Heart size={18} className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2 text-red-500" />
                  {t('wishlist')} ({wishlistCount})
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => {
                    setIsCartOpen(true);
                    setIsMenuOpen(false);
                  }}
                  className="bg-slate-50 hover:bg-blue-400 hover:text-white text-slate-800 justify-start h-auto py-3 px-4"
                  type="button"
                >
                  <ShoppingBag size={18} className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2 text-slate-900" />
                  {t('cart')} ({cartCount})
                </Button>
              </div>

              {user ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 px-2 mb-2">
                    <div className="w-10 h-10 bg-primary-DEFAULT rounded-full flex items-center justify-center font-bold">
                      {user.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate">{user.name}</p>
                      <p className="text-xs text-slate-500 truncate">{user.email}</p>
                    </div>
                  </div>

                  {user.role === 'admin' && (
                    <Link
                      to="/admin"
                      onClick={() => {
                        setIsMenuOpen(false);
                        setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }), 0);
                      }}
                      className="flex items-center gap-2 p-3 rounded-xl hover:bg-slate-50 font-bold text-slate-700"
                    >
                      <LayoutDashboard size={20} /> {t('dashboard')}
                    </Link>
                  )}

                  <Link
                    to="/my-orders"
                    onClick={() => {
                      setIsMenuOpen(false);
                      setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }), 0);
                    }}
                    className="flex items-center gap-2 p-3 rounded-xl hover:bg-slate-50 font-bold text-slate-700"
                  >
                    <Package size={20} /> {t('myOrders')}
                  </Link>

                  <button
                    onClick={() => {
                      logout();
                      setIsMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-4 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 transition-colors"
                    type="button"
                  >
                    <LogOut size={20} /> {t('logout')}
                  </button>
                </div>
              ) : (
                <Link
                  to="/login"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }), 0);
                  }}
                  className="flex justify-center items-center gap-2 w-full py-4 bg-slate-900 rounded-xl font-bold text-white hover:bg-slate-800 transition-colors shadow-lg shadow-slate-200"
                >
                  <LogIn size={20} /> {t('login')}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;