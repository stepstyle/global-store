// src/components/Skeleton.tsx
import React from 'react';

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse bg-slate-200/70 rounded-xl ${className}`} />
);

export const ProductCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-100 shadow-sm h-full flex flex-col">
    {/* صورة المنتج */}
    <Skeleton className="w-full aspect-square mb-5 rounded-2xl" />
    
    <div className="space-y-3.5 flex-1">
      {/* التصنيف والتقييم */}
      <div className="flex justify-between items-center">
        <Skeleton className="w-16 h-5 rounded-full" />
        <Skeleton className="w-10 h-4 rounded-md" />
      </div>
      
      {/* اسم المنتج */}
      <div className="space-y-2">
        <Skeleton className="w-full h-5 rounded-lg" />
        <Skeleton className="w-2/3 h-5 rounded-lg" />
      </div>
    </div>
    
    {/* السعر وزر الإضافة */}
    <div className="mt-6 flex justify-between items-end pt-5 border-t border-slate-50">
      <Skeleton className="w-20 h-7 rounded-lg" />
      <Skeleton className="w-10 h-10 rounded-xl" />
    </div>
  </div>
);

export const ProductSkeletonGrid: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
    {[...Array(count)].map((_, i) => (
      <ProductCardSkeleton key={i} />
    ))}
  </div>
);

export const ProductDetailSkeleton: React.FC = () => (
  <div className="container mx-auto px-4 lg:px-8 py-6 lg:py-12">
    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden mb-12">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:gap-4">
        {/* قسم معرض الصور */}
        <div className="p-6 lg:p-10 flex flex-col lg:flex-row gap-4 h-[400px] lg:h-[600px]">
          <Skeleton className="w-full h-full rounded-3xl" />
        </div>
        
        {/* قسم تفاصيل المنتج */}
        <div className="p-6 lg:p-10 flex flex-col justify-center space-y-8">
          <div className="space-y-5">
             <Skeleton className="w-24 h-7 rounded-full" />
             <Skeleton className="w-3/4 h-12 rounded-2xl" />
             <Skeleton className="w-32 h-6 rounded-lg" />
          </div>
          
          {/* السعر */}
          <Skeleton className="w-40 h-10 rounded-xl" />
          
          {/* الوصف */}
          <div className="space-y-3">
            <Skeleton className="w-full h-4 rounded-md" />
            <Skeleton className="w-full h-4 rounded-md" />
            <Skeleton className="w-5/6 h-4 rounded-md" />
            <Skeleton className="w-2/3 h-4 rounded-md" />
          </div>

          {/* المميزات */}
          <div className="grid grid-cols-3 gap-3">
             <Skeleton className="h-12 rounded-2xl" />
             <Skeleton className="h-12 rounded-2xl" />
             <Skeleton className="h-12 rounded-2xl" />
          </div>
          
          {/* أزرار السلة والكمية */}
          <div className="mt-4 pt-6 flex flex-col sm:flex-row gap-4">
            <Skeleton className="w-full sm:w-32 h-14 rounded-2xl" />
            <Skeleton className="flex-1 h-14 rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const OrderSkeleton: React.FC = () => (
    <div className="bg-white rounded-[2rem] p-6 sm:p-8 border border-slate-100 shadow-sm mb-6 animate-in fade-in">
        <div className="flex flex-col md:flex-row justify-between md:items-start mb-6 gap-5 border-b border-slate-50 pb-6">
            <div className="space-y-4 w-full">
                {/* رقم الطلب والحالة */}
                <div className="flex items-center gap-3">
                  <Skeleton className="w-32 h-8 rounded-xl" />
                  <Skeleton className="w-24 h-7 rounded-lg" />
                </div>
                {/* التاريخ والمبلغ */}
                <div className="flex items-center gap-4">
                  <Skeleton className="w-24 h-5 rounded-md" />
                  <Skeleton className="w-20 h-5 rounded-md" />
                  <Skeleton className="w-24 h-5 rounded-md" />
                </div>
            </div>
            {/* زر التتبع */}
            <Skeleton className="w-full md:w-32 h-12 rounded-xl shrink-0" />
        </div>
        
        {/* المنتجات داخل الطلب */}
        <div className="flex flex-col lg:flex-row gap-8">
             <div className="flex-1 space-y-4">
                 <div className="flex gap-4 items-center">
                    <Skeleton className="w-16 h-16 rounded-2xl shrink-0" />
                    <div className="flex-1 space-y-2.5">
                       <Skeleton className="w-2/3 h-5 rounded-lg" />
                       <Skeleton className="w-1/3 h-4 rounded-md" />
                    </div>
                 </div>
                 <div className="flex gap-4 items-center">
                    <Skeleton className="w-16 h-16 rounded-2xl shrink-0" />
                    <div className="flex-1 space-y-2.5">
                       <Skeleton className="w-1/2 h-5 rounded-lg" />
                       <Skeleton className="w-1/4 h-4 rounded-md" />
                    </div>
                 </div>
             </div>
             {/* عنوان التوصيل */}
             <Skeleton className="w-full lg:w-80 h-32 rounded-3xl shrink-0" />
        </div>
    </div>
);