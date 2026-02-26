
import React from 'react';
import { Facebook, Instagram, Twitter, Mail, Phone, MapPin } from 'lucide-react';
import Button from './Button';
import { useCart } from '../App';

const Footer: React.FC = () => {
  const { t } = useCart();
  return (
    <footer className="bg-slate-900 text-slate-300 pt-0 pb-8 font-sans relative">
      {/* Theme Gradient Strip */}
      <div className="w-full h-2 bg-gradient-to-r from-primary-DEFAULT to-secondary-DEFAULT"></div>
      
      <div className="pt-10 md:pt-16 container mx-auto px-4 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 mb-8 md:mb-12">
          
          {/* Brand */}
          <div className="col-span-1 sm:col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 bg-gradient-to-tr from-primary-DEFAULT to-secondary-DEFAULT rounded-lg flex items-center justify-center text-white font-bold">
                    A
                </div>
                <span className="text-2xl font-heading font-bold text-white">Anta Store</span>
            </div>
            <p className="text-sm leading-relaxed mb-6 text-slate-400">
              {t('footerDesc')}
            </p>
            <div className="flex gap-4">
                <a href="#" className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-secondary-DEFAULT hover:text-white transition-all"><Facebook size={18} /></a>
                <a href="#" className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-pink-600 hover:text-white transition-all"><Instagram size={18} /></a>
                <a href="#" className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-sky-500 hover:text-white transition-all"><Twitter size={18} /></a>
            </div>
          </div>

          {/* Links */}
          <div>
            <h4 className="text-white font-bold mb-6 text-lg">{t('quickLinks')}</h4>
            <ul className="space-y-3 text-sm">
                <li><a href="#" className="hover:text-primary-DEFAULT transition-colors">{t('aboutUs')}</a></li>
                <li><a href="#" className="hover:text-primary-DEFAULT transition-colors">{t('blog')}</a></li>
                <li><a href="#" className="hover:text-primary-DEFAULT transition-colors">{t('careers')}</a></li>
                <li><a href="#" className="hover:text-primary-DEFAULT transition-colors">{t('privacyPolicy')}</a></li>
                <li><a href="#" className="hover:text-primary-DEFAULT transition-colors">{t('terms')}</a></li>
            </ul>
          </div>

          {/* Categories */}
          <div>
            <h4 className="text-white font-bold mb-6 text-lg">{t('shopping')}</h4>
            <ul className="space-y-3 text-sm">
                <li><a href="#" className="hover:text-primary-DEFAULT transition-colors">{t('shop')}</a></li>
                <li><a href="#" className="hover:text-primary-DEFAULT transition-colors">{t('offers')}</a></li>
                <li><a href="#" className="hover:text-primary-DEFAULT transition-colors">{t('courses')}</a></li>
            </ul>
          </div>

          {/* Newsletter */}
          <div className="col-span-1 sm:col-span-2 md:col-span-1">
            <h4 className="text-white font-bold mb-6 text-lg">{t('newsletter')}</h4>
            <p className="text-sm mb-4 text-slate-400">{t('newsletterDesc')}</p>
            <form className="flex flex-col gap-2">
                <input 
                    type="email" 
                    placeholder={t('emailPlaceholder')} 
                    className="bg-slate-800 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-secondary-DEFAULT outline-none text-white"
                />
                <Button variant="primary">
                    {t('subscribe')}
                </Button>
            </form>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center text-xs text-slate-500 gap-4 md:gap-0">
            <p className="text-center md:text-left">© 2023 Anta Store. {t('rightsReserved')}</p>
            <div className="flex gap-6">
                <div className="flex items-center gap-2">
                    <MapPin size={14} />
                    <span>Riyadh, Saudi Arabia</span>
                </div>
                <div className="flex items-center gap-2">
                    <Mail size={14} />
                    <span>support@antastore.com</span>
                </div>
            </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
