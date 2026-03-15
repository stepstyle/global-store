// src/components/AnnouncementBanner.tsx
import React, { useState } from 'react';
import { X, Sparkles, Megaphone } from 'lucide-react';

interface AnnouncementBannerProps {
  isActive: boolean;
  messageAr: string;
  messageEn: string;
  isRtl: boolean;
}

const AnnouncementBanner: React.FC<AnnouncementBannerProps> = ({ isActive, messageAr, messageEn, isRtl }) => {
  const [isVisible, setIsVisible] = useState(true);

  if (!isActive || !isVisible) return null;

  return (
    <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 text-white z-[60]">
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-10 pointer-events-none"></div>
      
      <div className="container mx-auto px-4 py-2.5 flex items-center justify-between gap-3 relative z-10">
        
        {/* مساحة فارغة لعمل توازن بالشكل */}
        <div className="w-6 shrink-0 hidden sm:block"></div>

        {/* النص والأيقونة */}
        <div className="flex-1 flex items-center justify-center gap-2">
          <Megaphone size={16} className="text-amber-400 shrink-0 hidden sm:block animate-bounce" />
          <p className="text-[12px] sm:text-[13px] font-bold text-center leading-snug tracking-wide">
            {isRtl ? messageAr : messageEn}
          </p>
          <Sparkles size={14} className="text-amber-400 shrink-0 hidden sm:block" />
        </div>

        {/* زر الإغلاق */}
        <button 
          onClick={() => setIsVisible(false)}
          className="shrink-0 p-1 hover:bg-white/20 rounded-full transition-colors active:scale-95"
          aria-label="Close announcement"
        >
          <X size={16} />
        </button>

      </div>
    </div>
  );
};

// 🚀 هذا السطر اللي كان عامل المشكلة (مهم جداً)
export default AnnouncementBanner;