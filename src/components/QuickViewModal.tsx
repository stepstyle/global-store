import React, { useState, useEffect } from 'react';
import { X, ShoppingCart, Star, Eye, Bell, Check, Plus, Minus } from 'lucide-react';
import { Product } from '../types';
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6">
      {/* Background Overlay */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-md transition-opacity animate-in fade-in duration-300"
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div className="relative bg-white rounded-[2.5rem] shadow-2xl shadow-slate-900/20 w-full max-w-4xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-500 flex flex-col md:flex-row max-h-[90vh] sm:max-h-[85vh]">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-5 rtl:left-5 ltr:right-5 z-20 p-2.5 bg-white/90 backdrop-blur shadow-sm border border-slate-100 rounded-full hover:bg-slate-50 hover:scale-105 text-slate-400 hover:text-red-500 transition-all focus:outline-none focus:ring-2 focus:ring-slate-200"
          aria-label="Close modal"
        >
          <X size={20} strokeWidth={2.5} />
        </button>

        {/* Image Section */}
        <div className="w-full md:w-1/2 bg-slate-50/50 p-8 sm:p-12 flex items-center justify-center relative group">
          <div className="absolute inset-0 bg-gradient-to-br from-sky-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <LazyImage 
            src={(product.images && product.images[0]) || product.image} 
            alt={getProductTitle(product)} 
            containerClassName="w-full h-full max-h-[250px] md:max-h-[400px] relative z-10"
            className="w-full h-full object-contain mix-blend-multiply group-hover:scale-105 transition-transform duration-700 ease-out"
            loading="eager"
          />
        </div>

        {/* Content Section */}
        <div className="w-full md:w-1/2 p-8 flex flex-col overflow-y-auto bg-white">
          <div className="mb-3">
            <span className="inline-block text-sky-500 font-black text-[10px] tracking-widest uppercase bg-sky-50 border border-sky-100 px-2.5 py-1 rounded-lg">
              {product.category}
            </span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-heading font-black text-slate-900 mb-2 leading-tight">
            {getProductTitle(product)}
          </h2>
          <p className="text-slate-400 text-sm font-medium mb-5">{product.nameEn}</p>

          <div className="flex items-center gap-3 mb-6">
            <div className="flex text-yellow-400">
              {[...Array(5)].map((_, i) => (
                <Star 
                  key={i} 
                  size={18} 
                  fill={i < Math.floor(product.rating) ? "currentColor" : "none"} 
                  className={i < Math.floor(product.rating) ? "drop-shadow-sm" : "text-slate-200"} 
                />
              ))}
            </div>
            <span className="text-slate-500 text-sm font-bold bg-slate-50 px-2 py-0.5 rounded-md">
              {product.rating.toFixed(1)} ({product.reviews} {t('reviews')})
            </span>
          </div>

          <div className="flex items-end gap-3 mb-6 pb-6 border-b border-slate-100">
            <span className="text-3xl font-black text-sky-500 drop-shadow-sm" dir="ltr">
              {product.price} <span className="text-lg font-bold text-sky-600/60">JOD</span>
            </span>
            {product.originalPrice && (
              <span className="text-lg text-slate-400 font-bold line-through decoration-slate-300 decoration-2 mb-1" dir="ltr">
                {product.originalPrice}
              </span>
            )}
          </div>

          <p className="text-slate-600 leading-relaxed mb-8 text-sm font-medium line-clamp-4 bg-slate-50/50 p-4 rounded-2xl">
            {product.description}
          </p>

          <div className="mt-auto space-y-3 pt-2">
             {product.stock > 0 ? (
                <>
                  {/* Quantity Selector */}
                  <div className="flex items-center justify-between mb-6 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
                    <span className="text-sm font-black text-slate-400 uppercase tracking-widest rtl:mr-3 ltr:ml-3 shrink-0">
                      {t('quantity')}
                    </span>
                    
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-bold text-slate-400">
                        {t('availableStock')}: <span className="text-slate-700">{product.stock}</span>
                      </span>

                      <div className="flex items-center bg-slate-50 rounded-xl p-1 border border-slate-100">
                        <button 
                          onClick={decrementQuantity}
                          className="p-2 text-slate-500 hover:text-sky-500 hover:bg-white rounded-lg transition-all disabled:opacity-30 disabled:hover:bg-transparent shadow-sm"
                          disabled={quantity <= 1}
                        >
                          <Minus size={16} strokeWidth={3} />
                        </button>
                        <span className="w-10 text-center font-black text-slate-900 select-none">
                          {quantity}
                        </span>
                        <button 
                          onClick={incrementQuantity}
                          className="p-2 text-slate-500 hover:text-sky-500 hover:bg-white rounded-lg transition-all disabled:opacity-30 disabled:hover:bg-transparent shadow-sm"
                          disabled={quantity >= product.stock}
                        >
                          <Plus size={16} strokeWidth={3} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Add to Cart Button */}
                  <button 
                    onClick={() => {
                      addToCart(product, quantity);
                      onClose();
                    }}
                    className="w-full py-4 text-base font-extrabold rounded-2xl bg-sky-400 hover:bg-sky-500 text-white shadow-lg shadow-sky-400/30 flex justify-center items-center gap-2 transition-all duration-300 group"
                  >
                    <ShoppingCart className="rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2 group-hover:scale-110 transition-transform" size={20} />
                    {t('addQuantityToCart', { quantity })}
                  </button>
                </>
             ) : (
                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                  {!isNotified ? (
                    !showNotify ? (
                      <button 
                        onClick={() => setShowNotify(true)}
                        className="w-full py-3.5 bg-black hover:bg-slate-800 text-white font-extrabold rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
                      >
                        <Bell className="rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" size={18} />
                        {t('notifyMeDesc')}
                      </button>
                    ) : (
                      <form onSubmit={handleNotifySubmit} className="animate-in fade-in slide-in-from-bottom-2">
                        <label className="block text-xs font-black uppercase tracking-widest text-slate-500 mb-3">
                          {t('enterEmailAlert')}
                        </label>
                        <div className="flex flex-col sm:flex-row gap-3">
                          <input 
                            type="email" 
                            required
                            value={notifyEmail}
                            onChange={(e) => setNotifyEmail(e.target.value)}
                            placeholder="your@email.com"
                            className="flex-1 px-4 py-3.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 transition-all bg-white"
                            autoFocus
                          />
                          <button type="submit" className="px-6 py-3.5 bg-sky-400 hover:bg-sky-500 text-white font-extrabold rounded-xl shadow-md shadow-sky-400/20 transition-all">
                            {t('confirm')}
                          </button>
                        </div>
                      </form>
                    )
                  ) : (
                    <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 border border-emerald-100 font-bold justify-center py-4 rounded-xl animate-in zoom-in duration-300">
                      <Check size={20} strokeWidth={3} />
                      <span>{t('alertSet')}</span>
                    </div>
                  )}
                </div>
             )}
             
             {/* View Details Link */}
             <Link to={`/product/${product.id}`} onClick={onClose} className="block mt-3">
                <button className="w-full py-4 rounded-2xl border-2 border-slate-100 hover:border-slate-300 text-slate-600 hover:text-slate-900 font-bold bg-transparent hover:bg-slate-50 transition-all flex items-center justify-center gap-2">
                  <Eye className="rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2 text-slate-400" size={18} />
                  {t('viewFullDetails')}
                </button>
             </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickViewModal;