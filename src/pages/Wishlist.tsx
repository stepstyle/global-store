// src/pages/Wishlist.tsx
import React, { useMemo } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { Heart, ShoppingBag } from 'lucide-react';
import { useCart } from '../App';
import ProductCard from '../components/ProductCard';
import Button from '../components/Button';
import SEO from '../components/SEO';

const { Link } = ReactRouterDOM as any;

const Wishlist: React.FC = () => {
  const { products, wishlist, addToCart, toggleWishlist, openQuickView, t, language } = useCart() as any;

  const isAR = language === 'ar';

  const wishlistProducts = useMemo(() => {
    if (!wishlist || wishlist.size === 0) return [];
    return products.filter((p: any) => wishlist.has(p.id));
  }, [products, wishlist]);

  return (
    <div className="min-h-screen bg-slate-50 py-8 lg:py-12">
      <SEO title={t('wishlist')} />

      <div className="container mx-auto px-4 lg:px-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center shadow-sm">
              <Heart size={24} fill="currentColor" />
            </div>
            <div>
              <h1 className="text-3xl font-heading font-bold text-slate-900">{t('wishlist')}</h1>
              <p className="text-sm text-slate-500 font-medium">
                {wishlistProducts.length} {isAR ? 'منتجات تحبها' : 'items you love'}
              </p>
            </div>
          </div>
          
          {wishlistProducts.length > 0 && (
            <Link to="/shop">
              <Button variant="outline" size="sm" className="hidden md:flex">
                {isAR ? 'استمر بالتسوق' : 'Continue Shopping'}
              </Button>
            </Link>
          )}
        </div>

        {/* Content Section */}
        {wishlistProducts.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-100 p-12 text-center shadow-sm max-w-2xl mx-auto animate-in fade-in zoom-in duration-300">
            <div className="w-20 h-20 bg-slate-50 rounded-full mx-auto flex items-center justify-center text-slate-300 mb-6">
              <Heart size={40} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-3">
              {isAR ? 'قائمة الأمنيات فارغة' : 'Your wishlist is empty'}
            </h2>
            <p className="text-slate-500 mb-8 max-w-xs mx-auto">
              {isAR 
                ? 'لم تقم بإضافة أي منتج للمفضلة بعد. تصفح المنتجات وأضف ما يعجبك!' 
                : "You haven't added any products to your wishlist yet. Start exploring now!"}
            </p>
            <Link to="/shop">
              <Button className="px-10 h-12 shadow-lg shadow-secondary-light/30">
                <ShoppingBag className="me-2" size={20} />
                {t('shop')}
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {wishlistProducts.map((p: any) => (
              <ProductCard
                key={p.id}
                product={p}
                onAddToCart={addToCart}
                onToggleWishlist={toggleWishlist}
                onQuickView={openQuickView}
                isLiked={true}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Wishlist;