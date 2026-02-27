
import React, { useState, useEffect } from 'react';
import { X, ShoppingCart, Star, Eye, Bell, Check, Plus, Minus } from 'lucide-react';
import { Product } from '../types';
import Button from './Button';
import * as ReactRouterDOM from 'react-router-dom';
import { useCart } from '../App';
import LazyImage from './LazyImage';

const { Link } = ReactRouterDOM as any;

interface QuickViewModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
}

const QuickViewModal: React.FC<QuickViewModalProps> = ({ product, isOpen, onClose }) => {
  const { addToCart, t, getProductTitle } = useCart();
  const [showNotify, setShowNotify] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [isNotified, setIsNotified] = useState(false);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (isOpen) {
        setShowNotify(false);
        setNotifyEmail('');
        setIsNotified(false);
        setQuantity(1);
    }
  }, [isOpen, product]);

  const handleNotifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (notifyEmail) {
        setIsNotified(true);
        // Simulate API call
        setTimeout(() => {
            onClose();
        }, 2000);
    }
  };

  const incrementQuantity = () => {
    if (product && quantity < product.stock) {
        setQuantity(q => q + 1);
    }
  };

  const decrementQuantity = () => {
    if (quantity > 1) {
        setQuantity(q => q - 1);
    }
  };

  if (!isOpen || !product) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in-95 fade-in duration-300 flex flex-col md:flex-row max-h-[90vh]">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-white/80 rounded-full hover:bg-slate-100 text-slate-500 hover:text-red-500 transition-colors"
        >
          <X size={20} />
        </button>

        {/* Image Section */}
        <div className="w-full md:w-1/2 bg-slate-50 p-8 flex items-center justify-center">
          <LazyImage 
            src={(product.images && product.images[0]) || product.image} 
            alt={product.name} 
            containerClassName="w-full h-full max-h-[300px] md:max-h-[400px]"
            className="w-full h-full object-contain mix-blend-multiply hover:scale-105 transition-transform duration-500"
            loading="eager" // User initiated action, load eagerly
          />
        </div>

        {/* Content Section */}
        <div className="w-full md:w-1/2 p-8 flex flex-col overflow-y-auto">
          <div className="mb-2">
            <span className="text-secondary-DEFAULT font-bold text-xs tracking-wider uppercase bg-secondary-light/10 px-2 py-1 rounded-md">
              {product.category}
            </span>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-2">{getProductTitle(product)}</h2>
          <p className="text-slate-400 text-sm mb-4">{product.nameEn}</p>

          <div className="flex items-center gap-2 mb-6">
            <div className="flex text-yellow-400">
              {[...Array(5)].map((_, i) => (
                <Star 
                  key={i} 
                  size={16} 
                  fill={i < Math.floor(product.rating) ? "currentColor" : "none"} 
                  className={i < Math.floor(product.rating) ? "" : "text-slate-200"} 
                />
              ))}
            </div>
            <span className="text-slate-500 text-sm">({product.reviews} {t('reviews')})</span>
          </div>

          <div className="flex items-baseline gap-3 mb-6">
            <span className="text-3xl font-bold text-slate-900">{product.price} <span className="text-base font-normal"></span></span>
            {product.originalPrice && (
              <span className="text-lg text-slate-400 line-through">{product.originalPrice}</span>
            )}
          </div>

          <p className="text-slate-600 leading-relaxed mb-8 text-sm line-clamp-4">
            {product.description}
          </p>

          <div className="mt-auto space-y-3">
             {product.stock > 0 ? (
                <>
                    {/* Quantity Selector */}
                    <div className="flex items-center gap-4 mb-6 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <span className="text-sm font-bold text-slate-700">{t('quantity')}:</span>
                        <div className="flex items-center bg-white border border-slate-200 rounded-xl shadow-sm">
                            <button 
                                onClick={decrementQuantity}
                                className="p-2.5 text-slate-500 hover:text-secondary-DEFAULT hover:bg-slate-50 rounded-r-xl rtl:rounded-r-xl ltr:rounded-l-xl rtl:rounded-l-none ltr:rounded-r-none transition-colors disabled:opacity-30"
                                disabled={quantity <= 1}
                            >
                                <Minus size={16} />
                            </button>
                            <span className="w-12 text-center font-bold text-slate-900 select-none">{quantity}</span>
                            <button 
                                onClick={incrementQuantity}
                                className="p-2.5 text-slate-500 hover:text-secondary-DEFAULT hover:bg-slate-50 rounded-l-xl rtl:rounded-l-xl ltr:rounded-r-xl rtl:rounded-r-none ltr:rounded-l-none transition-colors disabled:opacity-30"
                                disabled={quantity >= product.stock}
                            >
                                <Plus size={16} />
                            </button>
                        </div>
                        <span className="text-xs text-slate-400 mr-auto rtl:mr-auto ltr:ml-auto">
                            ({t('availableStock')}: {product.stock})
                        </span>
                    </div>

                    <Button 
                        onClick={() => {
                            addToCart(product, quantity);
                            onClose();
                        }}
                        className="w-full shadow-xl shadow-secondary-light/20 py-3 text-lg"
                    >
                        <ShoppingCart className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" size={20} />
                        {t('addQuantityToCart', { quantity })}
                    </Button>
                </>
             ) : (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    {!isNotified ? (
                        !showNotify ? (
                            <Button 
                                onClick={() => setShowNotify(true)}
                                className="w-full"
                                variant="secondary"
                            >
                                <Bell className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" size={18} />
                                {t('notifyMeDesc')}
                            </Button>
                        ) : (
                            <form onSubmit={handleNotifySubmit} className="animate-in fade-in slide-in-from-bottom-2">
                                <label className="block text-xs font-bold text-slate-700 mb-2">{t('enterEmailAlert')}</label>
                                <div className="flex gap-2">
                                    <input 
                                        type="email" 
                                        required
                                        value={notifyEmail}
                                        onChange={(e) => setNotifyEmail(e.target.value)}
                                        placeholder="your@email.com"
                                        className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-secondary-DEFAULT"
                                        autoFocus
                                    />
                                    <Button type="submit" size="sm">{t('confirm')}</Button>
                                </div>
                            </form>
                        )
                    ) : (
                        <div className="flex items-center gap-2 text-green-600 font-bold justify-center py-2 animate-in zoom-in">
                            <Check size={20} />
                            <span>{t('alertSet')}</span>
                        </div>
                    )}
                </div>
             )}
             
             <Link to={`/product/${product.id}`} onClick={onClose} className="block">
                <Button variant="outline" className="w-full hover:bg-slate-50 border-slate-200 text-slate-600">
                    <Eye className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" size={18} />
                    {t('viewFullDetails')}
                </Button>
             </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickViewModal;
