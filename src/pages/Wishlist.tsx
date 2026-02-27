import React, { useMemo } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { Heart } from 'lucide-react';
import { useCart } from '../App';
import ProductCard from '../components/ProductCard';
import Button from '../components/Button';
import SEO from '../components/SEO';

const { Link } = ReactRouterDOM as any;

const Wishlist: React.FC = () => {
  const { products, wishlist, addToCart, toggleWishlist, openQuickView, t } = useCart();

  const wishlistProducts = useMemo(() => {
    if (!wishlist || wishlist.size === 0) return [];
    return products.filter((p) => wishlist.has(p.id));
  }, [products, wishlist]);

  return (
    <div className="min-h-screen bg-slate-50 py-8 lg:py-12">
      <SEO title={t('wishlist')} />

      <div className="container mx-auto px-4 lg:px-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center">
            <Heart size={20} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{t('wishlist')}</h1>
          <span className="text-sm text-slate-500">({wishlistProducts.length})</span>
        </div>

        {wishlistProducts.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-100 p-8 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl mx-auto flex items-center justify-center text-slate-400 mb-4">
              <Heart size={24} />
            </div>
            <p className="text-slate-700 font-bold mb-2">ما في منتجات بالمفضلة</p>
            <p className="text-slate-500 text-sm mb-6">ارجع للمتجر واضف منتجات للقلب ❤️</p>
            <Link to="/shop">
              <Button className="px-6">{t('shop')}</Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {wishlistProducts.map((p) => (
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