
import React from 'react';

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse bg-slate-200 rounded-lg ${className}`} />
);

export const ProductCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm h-full flex flex-col">
    <Skeleton className="w-full aspect-square mb-4 rounded-xl" />
    <div className="space-y-3 flex-1">
      <div className="flex justify-between">
        <Skeleton className="w-20 h-5" />
        <Skeleton className="w-8 h-4" />
      </div>
      <Skeleton className="w-3/4 h-6" />
      <Skeleton className="w-1/2 h-4" />
    </div>
    <div className="mt-4 flex justify-between items-center pt-4 border-t border-slate-50">
      <Skeleton className="w-24 h-8" />
      <Skeleton className="w-10 h-9 rounded-lg" />
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
  <div className="container mx-auto px-4 lg:px-8 pt-12">
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden mb-12">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
        <div className="bg-slate-50 p-8 flex items-center justify-center h-[400px] lg:h-[600px]">
          <Skeleton className="w-full max-w-md aspect-square rounded-2xl bg-slate-200" />
        </div>
        <div className="p-8 lg:p-12 flex flex-col space-y-8">
          <div className="space-y-4">
             <Skeleton className="w-24 h-6 rounded-full" />
             <Skeleton className="w-3/4 h-10" />
             <Skeleton className="w-32 h-6" />
          </div>
          
          <Skeleton className="w-40 h-12" />
          
          <div className="space-y-3">
            <Skeleton className="w-full h-4" />
            <Skeleton className="w-full h-4" />
            <Skeleton className="w-2/3 h-4" />
          </div>
          
          <div className="mt-auto pt-8 flex gap-4">
            <Skeleton className="flex-1 h-14 rounded-xl" />
            <Skeleton className="w-16 h-14 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const OrderSkeleton: React.FC = () => (
    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm mb-4">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-50">
            <div className="space-y-2">
                <Skeleton className="w-32 h-6" />
                <Skeleton className="w-48 h-4" />
            </div>
            <Skeleton className="w-24 h-8 rounded-lg" />
        </div>
        <div className="flex gap-4">
             <Skeleton className="w-16 h-16 rounded-lg shrink-0" />
             <div className="flex-1 space-y-2">
                <Skeleton className="w-1/2 h-5" />
                <Skeleton className="w-1/4 h-4" />
             </div>
        </div>
    </div>
);
