// src/pages/AdminDashboard.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import Papa from 'papaparse';
import {
  BarChart,
  Users,
  DollarSign,
  Package,
  Upload,
  FileText,
  Trash2,
  Edit2,
  Search,
  AlertTriangle,
  FileCode,
  Settings,
  Database,
  Cloud,
  WifiOff,
  StickyNote,
  Copy,
  X,
  Image as ImageIcon,
  CreditCard,
} from 'lucide-react';

import { useCart } from '../App';
import Button from '../components/Button';
import EditProductModal from '../components/EditProductModal';
import { Product, Category, Order } from '../types';
import { db } from '../services/storage';
import SEO from '../components/SEO';
import LazyImage from '../components/LazyImage';
import { isFirebaseInitialized, setFirebaseConfig, removeFirebaseConfig } from '../services/firebase';
import { uploadToCloudinary } from '../services/cloudinary';

const PAGE_SIZE = 100;

/** ✅ Remove any undefined recursively (Firestore doesn't accept undefined) */
const cleanForFirestore = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((v) => cleanForFirestore(v)).filter((v) => v !== undefined) as any;
  }

  if (value && typeof value === 'object') {
    const out: any = {};
    Object.keys(value as any).forEach((k) => {
      const v = (value as any)[k];
      if (v === undefined) return;
      const cleaned = cleanForFirestore(v);
      if (cleaned === undefined) return;
      out[k] = cleaned;
    });
    return out;
  }

  return value;
};

/** ✅ Normalizes old/new subCategory to slug */
const normalizeSubCategory = (raw: any): string => {
  const s = String(raw ?? '').trim();
  if (!s) return '';

  const map: Record<string, string> = {
    // ---- Stationery ----
    Pencils: 'pencils',
    Pens: 'pens',
    Markers: 'markers',
    Erasers: 'erasers',
    Sharpeners: 'sharpeners',
    Notebooks: 'notebooks',
    Files: 'files',
    Colors: 'colors',

    'أقلام رصاص': 'pencils',
    'أقلام حبر': 'pens',
    'أقلام تخطيط': 'markers',
    محايات: 'erasers',
    برايات: 'sharpeners',
    دفاتر: 'notebooks',
    'ملفات/حافظات': 'files',
    ألوان: 'colors',

    // ---- Games ----
    Age_0_9m: '0-9m',
    Age_1_2: '1-2y',
    Age_2_3: '2-3y',
    Girls: 'girls',
    Boys: 'boys',
    Educational: 'edu',

    '0-9 Months': '0-9m',
    '1-2 Years': '1-2y',
    '2-3 Years': '2-3y',
    'Girls Toys': 'girls',
    'Boys Toys': 'boys',
    EducationalGames: 'edu',

    'ألعاب (من شهر إلى 9 أشهر)': '0-9m',
    'ألعاب (من سنة إلى سنتين)': '1-2y',
    'ألعاب (من سنتين إلى 3 سنوات)': '2-3y',
    'ألعاب بناتي': 'girls',
    'ألعاب ولادي': 'boys',
    'ألعاب تعليمية': 'edu',

    // ---- Offers / Gifts ----
    occasion: 'occasion',
    kids: 'kids',
    wrap: 'wrap',
    bouquets: 'bouquets',
    Bundle: 'bundle',
    Discount: 'discount',
    Clearance: 'clearance',

    'هدايا مناسبات': 'occasion',
    'هدايا للأطفال': 'kids',
    'تغليف وورق هدايا': 'wrap',
    'بوكيهات وورد': 'bouquets',
    'باكج/حزمة': 'bundle',
    خصم: 'discount',
    تصفية: 'clearance',
  };

  const looksLikeSlug = /^[a-z0-9-]+$/i.test(s);
  if (looksLikeSlug && s.length <= 40) return s.toLowerCase();

  return (map[s] || s).toLowerCase();
};

/** ✅ best-effort category normalization (prevents broken filters) */
const normalizeCategory = (raw: any): Category => {
  const s = String(raw ?? '').trim();
  return (s || 'Stationery') as Category;
};

/** ✅ Normalize product before save (images + subCategory + remove undefined) */
const normalizeProductForSave = (p: Product): Product => {
  const imagesArr = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
  const primary = (p.image && String(p.image).trim()) || (imagesArr[0] && String(imagesArr[0]).trim()) || '';

  const rawSub: any = (p as any).subCategory ?? (p as any).subcategory ?? (p as any).sub ?? '';

  const fixed: Product = {
    ...p,
    category: normalizeCategory((p as any).category),
    image: primary,
    images: imagesArr,
    ...(rawSub ? { subCategory: normalizeSubCategory(rawSub) } : {}),
  };

  return cleanForFirestore(fixed);
};

/** ✅ Safe checker: supports both boolean and function export */
const getFirebaseReady = (): boolean => {
  try {
    return typeof isFirebaseInitialized === 'function' ? !!(isFirebaseInitialized as any)() : !!isFirebaseInitialized;
  } catch {
    return false;
  }
};

const safeText = (v: any) => String(v ?? '').trim();

const statusBadge = (status?: string) => {
  const s = safeText(status).toLowerCase();
  if (s === 'delivered') return 'bg-green-100 text-green-700';
  if (s === 'shipped') return 'bg-blue-100 text-blue-700';
  if (s === 'cancelled') return 'bg-red-100 text-red-700';
  return 'bg-yellow-100 text-yellow-800';
};

const AdminDashboard: React.FC = () => {
  const { addProducts, deleteProduct, updateProduct, showToast, t, products, language } = useCart() as any;

  const [activeTab, setActiveTab] = useState<'overview' | 'products' | 'orders' | 'settings'>('overview');

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState({ sales: 0, orders: 0, users: 0, avg: 0 });

  // Search (debounced)
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Pagination
  const [page, setPage] = useState(1);

  // Settings State
  const [firebaseConfigInput, setFirebaseConfigInput] = useState('');

  // Edit State (Used for edit + create)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Cloudinary Upload State
  const [uploading, setUploading] = useState(false);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string>('');

  // ✅ Orders: Receipt preview modal (CliQ)
  const [receiptModal, setReceiptModal] = useState<{ open: boolean; orderId?: string; url?: string }>({
    open: false,
    orderId: undefined,
    url: undefined,
  });

  const firebaseReady = useMemo(() => getFirebaseReady(), []);

  const moneyFmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(language === 'ar' ? 'ar-JO' : 'en-JO', {
        style: 'currency',
        currency: 'JOD',
        maximumFractionDigits: 2,
      });
    } catch {
      return null;
    }
  }, [language]);

  const money = useCallback(
    (n?: number) => {
      const x = typeof n === 'number' && Number.isFinite(n) ? n : 0;
      return moneyFmt ? moneyFmt.format(x) : `JOD ${x.toFixed(2)}`;
    },
    [moneyFmt]
  );

  const copyToClipboard = useCallback(
    async (text: string, okMsg?: string) => {
      try {
        await navigator.clipboard.writeText(String(text ?? ''));
        showToast(okMsg || (t('copied') ?? 'تم النسخ'), 'success');
      } catch {
        showToast(t('copyFailed') ?? 'تعذر النسخ', 'error');
      }
    },
    [showToast, t]
  );

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset page on search change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  // Load Orders + Stats
  useEffect(() => {
    const fetchOrders = async () => {
      const allOrders = await db.orders.getAll();
      setOrders(allOrders);

      const totalSales = allOrders.reduce((sum, o: any) => sum + (Number(o.total) || 0), 0);
      const totalUsers = JSON.parse(localStorage.getItem('anta_users') || '[]').length;

      setStats({
        sales: totalSales,
        orders: allOrders.length,
        users: totalUsers,
        avg: allOrders.length > 0 ? Math.round(totalSales / allOrders.length) : 0,
      });
    };

    fetchOrders();
  }, [products]);

  const handleDeleteProduct = async (id: string) => {
    if (window.confirm(t('confirmDelete') ?? 'Are you sure you want to delete this product?')) {
      await deleteProduct(id);
    }
  };

  const handleEditClick = (product: Product) => {
    const normalized = normalizeProductForSave(product);
    setEditingProduct(normalized);
    setIsEditModalOpen(true);
  };

  const handleAddNewProduct = () => {
    const now = Date.now();

    const newProduct: Product = {
      id: `p-${now}-${Math.floor(Math.random() * 1000)}`,
      name: '',
      nameEn: '',
      price: 0,
      originalPrice: undefined,
      category: 'Stationery' as Category,
      subCategory: undefined,
      subcategory: undefined,
      stock: 0,
      description: '',
      details: undefined,
      brand: undefined,
      videoUrl: undefined,
      isNew: true,
      image: '',
      images: [],
      rating: 0,
      reviews: 0,
      ratingAvg: 0,
      ratingCount: 0,
    };

    setEditingProduct(newProduct);
    setIsEditModalOpen(true);
  };

  const handleSaveProduct = async (updatedProduct: Product) => {
    try {
      const safeProduct = normalizeProductForSave(updatedProduct);
      const exists = products.some((p: any) => p.id === safeProduct.id);

      if (exists) {
        await updateProduct(safeProduct);
        showToast(t('updated') ?? 'تم تحديث المنتج', 'success');
      } else {
        await addProducts([safeProduct]);
        showToast(t('created') ?? 'تم إضافة المنتج', 'success');
      }

      setEditingProduct(null);
      setIsEditModalOpen(false);
      setActiveTab('products');
    } catch (e: any) {
      showToast(e?.message || t('saveError') || 'حدث خطأ أثناء الحفظ', 'error');
    }
  };

  const handleUpdateOrderStatus = async (id: string, newStatus: any) => {
    const updated = await db.orders.updateStatus(id, newStatus);
    setOrders(updated);
    showToast(`${t('updated') ?? 'Updated'}: ${id} → ${newStatus}`, 'success');
  };

  // --- Sitemap Generation (HashRouter compatible) ---
  const generateSitemap = () => {
    const baseUrl = window.location.origin;
    const date = new Date().toISOString().split('T')[0];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}#/shop</loc>
    <lastmod>${date}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`;

    products.forEach((p: any) => {
      xml += `
  <url>
    <loc>${baseUrl}#/product/${p.id}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
    });

    xml += `\n</urlset>`;

    const blob = new Blob([xml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sitemap.xml';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(t('generateSuccess'), 'success');
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const processFile = async (file: File) => {
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      showToast('CSV files only', 'error');
      return;
    }

    setIsProcessing(true);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = (e.target?.result as string) || '';
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        transformHeader: (h) => h.trim(),
      });

      if (parsed.errors?.length) {
        console.error(parsed.errors);
        showToast('CSV format error (check headers / quotes)', 'error');
        setIsProcessing(false);
        return;
      }

      const rows = parsed.data || [];
      const newProducts: Product[] = [];

      rows.forEach((row, idx) => {
        const name = (row.name || (row as any).Name || (row as any).productName || '').toString().trim();

        const nameAr = (row as any).nameAr ? String((row as any).nameAr).trim() : String((row as any).nameAR || '').trim();
        const nameEn = (row as any).nameEn ? String((row as any).nameEn).trim() : String((row as any).nameEN || '').trim();

        const priceStr = (row.price || (row as any).Price || '').toString().trim();
        const stockStr = (row.stock || (row as any).Stock || '0').toString().trim();

        const categoryRaw = (row.category || (row as any).Category || 'Stationery').toString().trim();
        const rawSub = (row as any).subCategory || (row as any).subcategory || (row as any).sub || '';

        if (!name && !nameAr && !nameEn) return;
        if (!priceStr) return;

        const id = (row.id || (row as any).ID || '').toString().trim() || `p-${Date.now()}-${idx}`;

        // Images
        const images: string[] = [];
        const image1 = (row.image || (row as any).Image || '').toString().trim();
        if (image1) images.push(image1);

        const imagesPipe = (row.images || (row as any).Images || '').toString().trim();
        if (imagesPipe) {
          imagesPipe
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((u) => images.push(u));
        }

        for (let i = 2; i <= 10; i++) {
          const key = `image${i}`;
          const altKey = `Image${i}`;
          const val = ((row as any)[key] || (row as any)[altKey] || '').toString().trim();
          if (val) images.push(val);
        }

        const primaryImage = images[0] || `https://picsum.photos/400/400?random=${idx + 1}`;

        const product: Product = {
          id,
          name: nameAr || name || nameEn || '',
          nameEn: nameEn || name || nameAr || '',
          price: Number(priceStr) || 0,
          originalPrice: (row as any).originalPrice ? Number((row as any).originalPrice) : undefined,
          category: normalizeCategory(categoryRaw),
          ...(rawSub ? { subCategory: normalizeSubCategory(rawSub) } : {}),
          stock: Number(stockStr) || 0,
          description: (row.description || (row as any).Description || 'No description').toString(),
          details: (row as any).details ? String((row as any).details) : undefined,
          brand: (row as any).brand ? String((row as any).brand) : undefined,
          videoUrl: (row as any).videoUrl ? String((row as any).videoUrl) : undefined,
          isNew: (row as any).isNew ? ['true', '1', 'yes', 'y'].includes(String((row as any).isNew).toLowerCase()) : undefined,
          image: primaryImage,
          images: images.length > 0 ? images : [],
          rating: 0,
          reviews: 0,
          ratingAvg: 0,
          ratingCount: 0,
        };

        newProducts.push(normalizeProductForSave(product));
      });

      try {
        if (newProducts.length > 0) {
          await addProducts(newProducts);
          showToast(`Imported ${newProducts.length} products`, 'success');
        } else {
          showToast('No valid products found', 'info');
        }
      } catch (err: any) {
        showToast(err?.message || 'Import failed', 'error');
      } finally {
        setIsProcessing(false);
      }
    };

    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) processFile(files[0]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) processFile(e.target.files[0]);
  };

  const handleConnectFirebase = () => {
    try {
      const config = JSON.parse(firebaseConfigInput);
      setFirebaseConfig(config);
      showToast(t('firebaseConnected') ?? 'Firebase connected', 'success');
    } catch {
      showToast('Invalid JSON format', 'error');
    }
  };

  const handleUploadImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setUploadError('');
    setUploading(true);

    try {
      const list = Array.from(files).slice(0, 10);
      const urls: string[] = [];

      for (const file of list) {
        const url = await uploadToCloudinary(file);
        urls.push(url);
      }

      setUploadedUrls(urls);
      showToast(`Uploaded ${urls.length} images`, 'success');
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed');
      showToast('Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  // -------- PERFORMANCE: filter + paginate --------
  const filteredProducts = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return products;

    return products.filter((p: any) => {
      const n = (p.nameEn || p.name || '').toLowerCase();
      const c = String(p.category || '').toLowerCase();
      const sub = String(p.subCategory || p.subcategory || '').toLowerCase();
      return n.includes(term) || c.includes(term) || sub.includes(term);
    });
  }, [products, debouncedSearch]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE)), [filteredProducts.length]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pagedProducts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [filteredProducts, page]);

  const lowStockCount = products.filter((p: any) => p.stock > 0 && p.stock < 10).length;
  const outOfStockCount = products.filter((p: any) => p.stock === 0).length;

  const toThumb = (url?: string) => {
    if (!url) return url;
    if (url.includes('res.cloudinary.com') && url.includes('/upload/')) {
      return url.replace('/upload/', '/upload/w_80,h_80,c_fill,f_auto,q_auto/');
    }
    return url;
  };

  const fromIdx = Math.min((page - 1) * PAGE_SIZE + 1, filteredProducts.length || 0);
  const toIdx = Math.min(page * PAGE_SIZE, filteredProducts.length || 0);

  return (
    <div className="min-h-screen bg-slate-50 py-12">
      <SEO title={t('dashboard')} noIndex={true} />
      <div className="container mx-auto px-4 lg:px-8">
        <h1 className="text-3xl font-bold mb-8 text-slate-900">{t('dashboard')}</h1>

        {/* Tabs */}
        <div className="flex gap-4 mb-8 border-b border-slate-200 overflow-x-auto">
          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-4 px-2 font-bold transition-colors whitespace-nowrap ${
              activeTab === 'overview' ? 'text-secondary-DEFAULT border-b-2 border-secondary-DEFAULT' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t('overview')}
          </button>

          <button
            onClick={() => setActiveTab('products')}
            className={`pb-4 px-2 font-bold transition-colors whitespace-nowrap ${
              activeTab === 'products' ? 'text-secondary-DEFAULT border-b-2 border-secondary-DEFAULT' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t('productInventory')}
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`pb-4 px-2 font-bold transition-colors whitespace-nowrap ${
              activeTab === 'orders' ? 'text-secondary-DEFAULT border-b-2 border-secondary-DEFAULT' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t('orderManagement')}
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`pb-4 px-2 font-bold transition-colors whitespace-nowrap flex items-center gap-2 ${
              activeTab === 'settings' ? 'text-secondary-DEFAULT border-b-2 border-secondary-DEFAULT' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Settings size={18} /> {t('settings')}
          </button>
        </div>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="animate-in fade-in">
            <div
              className={`mb-8 p-4 rounded-2xl flex items-center gap-3 border ${
                firebaseReady ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-100 border-slate-200 text-slate-500'
              }`}
            >
              {firebaseReady ? <Cloud size={24} /> : <WifiOff size={24} />}
              <span className="font-bold">{firebaseReady ? t('firebaseConnected') : t('firebaseNotConnected')}</span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {[
                { title: t('totalSales'), value: money(stats.sales), icon: DollarSign, color: 'bg-green-100 text-green-600' },
                { title: t('newOrders'), value: stats.orders.toLocaleString(), icon: Package, color: 'bg-blue-100 text-blue-600' },
                { title: t('users'), value: stats.users.toLocaleString(), icon: Users, color: 'bg-purple-100 text-purple-600' },
                { title: 'Avg Order Value', value: money(stats.avg), icon: BarChart, color: 'bg-orange-100 text-orange-600' },
              ].map((stat, idx) => (
                <div key={idx} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${stat.color}`}>
                    <stat.icon size={24} />
                  </div>
                  <div>
                    <p className="text-slate-500 text-sm">{stat.title}</p>
                    <p className="text-xl font-bold text-slate-900">{stat.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {(lowStockCount > 0 || outOfStockCount > 0) && (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-6 mb-12 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center shrink-0">
                    <AlertTriangle size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-red-900 text-lg">{t('inventoryAlertsTitle')}</h3>
                    <p className="text-red-700 text-sm">{t('inventoryAlertsMsg', { out: outOfStockCount, low: lowStockCount })}</p>
                  </div>
                </div>
                <Button onClick={() => setActiveTab('products')} className="bg-red-600 hover:bg-red-700 text-white shadow-none border-none whitespace-nowrap">
                  {t('manageInventory')}
                </Button>
              </div>
            )}

            {/* Upload & Tools */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
              {/* Cloudinary Upload */}
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                  <Upload size={20} className="text-secondary-DEFAULT" />
                  رفع صور المنتج (Cloudinary)
                </h3>

                <div className="bg-slate-50 p-6 rounded-2xl">
                  <p className="text-slate-600 mb-4 text-sm">اختر من 3 إلى 10 صور، سيتم رفعها وستظهر روابطها تحت.</p>

                  <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                    <input type="file" accept="image/*" multiple onChange={(e) => handleUploadImages(e.target.files)} className="block w-full text-sm" disabled={uploading} />

                    <button
                      type="button"
                      onClick={() => setUploadedUrls([])}
                      className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100"
                      disabled={uploading}
                    >
                      مسح الروابط
                    </button>
                  </div>

                  {uploading && <div className="mt-3 text-sm text-slate-600">جاري رفع الصور…</div>}
                  {uploadError && <div className="mt-3 text-sm text-red-600">خطأ: {uploadError}</div>}

                  {uploadedUrls.length > 0 && (
                    <div className="mt-4">
                      <div className="text-sm font-bold text-slate-800 mb-2">روابط الصور:</div>

                      <div className="grid grid-cols-1 gap-2">
                        {uploadedUrls.map((url, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input value={url} readOnly className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs" />
                            <button type="button" className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs" onClick={() => copyToClipboard(url, 'تم نسخ الرابط')}>
                              نسخ
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 text-xs text-slate-500">
                        إذا بدك تحطهم في CSV: انسخهم وافصل بينهم بـ <span className="font-bold">|</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* CSV Upload */}
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                  <Upload size={20} className="text-secondary-DEFAULT" />
                  {t('uploadProducts')} (Bulk Upload)
                </h3>

                <div
                  className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 ${
                    isDragging ? 'border-secondary-DEFAULT bg-secondary-light/10' : 'border-slate-200 hover:border-secondary-DEFAULT hover:bg-slate-50'
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {isProcessing ? (
                    <div className="flex flex-col items-center">
                      <div className="w-12 h-12 border-4 border-slate-200 border-t-secondary-DEFAULT rounded-full animate-spin mb-4"></div>
                      <p className="text-slate-500 font-bold">{t('processingFile')}</p>
                    </div>
                  ) : (
                    <>
                      <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4">
                        <FileText size={32} />
                      </div>
                      <p className="text-lg font-bold text-slate-700 mb-2">{t('dragDropCsv')}</p>
                      <p className="text-slate-400 text-sm mb-6">{t('chooseFile')} (Max 5MB)</p>

                      <input type="file" id="csvUpload" accept=".csv" className="hidden" onChange={handleFileInput} />

                      <label htmlFor="csvUpload">
                        <Button variant="outline" className="cursor-pointer" onClick={() => document.getElementById('csvUpload')?.click()}>
                          {t('chooseFile')}
                        </Button>
                      </label>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* SEO Tools */}
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                <FileCode size={20} className="text-secondary-DEFAULT" />
                {t('seoTools')}
              </h3>
              <div className="bg-slate-50 p-6 rounded-2xl text-center">
                <p className="text-slate-600 mb-4 text-sm">{t('sitemapDesc')}</p>
                <Button onClick={generateSitemap} className="w-full">
                  {t('generateSitemap')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* PRODUCTS */}
        {activeTab === 'products' && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 animate-in fade-in">
            <div className="flex flex-col lg:flex-row justify-between lg:items-center mb-6 gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <h3 className="font-bold text-lg">
                  {t('productManagement')} ({filteredProducts.length})
                </h3>

                <Button onClick={handleAddNewProduct} className="whitespace-nowrap">
                  ➕ إضافة منتج جديد
                </Button>
              </div>

              <div className="relative w-full md:w-auto">
                <input
                  type="text"
                  placeholder={t('searchProducts')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full md:w-64 pl-10 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-secondary-DEFAULT"
                />
                <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
              </div>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-slate-500">
                {filteredProducts.length === 0 ? 'لا يوجد نتائج' : `عرض ${fromIdx} - ${toIdx} من ${filteredProducts.length}`}
              </div>

              <div className="flex gap-2">
                <button className="px-3 py-2 rounded-lg border border-slate-200 disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  السابق
                </button>
                <div className="px-3 py-2 text-sm text-slate-600">
                  {page} / {totalPages}
                </div>
                <button className="px-3 py-2 rounded-lg border border-slate-200 disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  التالي
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px] rounded-xl border border-slate-100">
              <table className="w-full text-sm text-left rtl:text-right">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3">{t('image')}</th>
                    <th className="px-4 py-3">{t('name')}</th>
                    <th className="px-4 py-3">{t('categories')}</th>
                    <th className="px-4 py-3">الفرع</th>
                    <th className="px-4 py-3">{t('price')}</th>
                    <th className="px-4 py-3">{t('stockLevel')}</th>
                    <th className="px-4 py-3 text-center">{t('actions')}</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {pagedProducts.map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <LazyImage
                          src={toThumb(p.image)}
                          alt={p.nameEn || p.name}
                          className="w-10 h-10 rounded-md object-cover border border-slate-200"
                          containerClassName="w-10 h-10 rounded-md shrink-0"
                          cloudinarySize={80}
                        />
                      </td>

                      <td className="px-4 py-3 font-bold text-slate-700">{p.nameEn || p.name}</td>

                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-slate-100 rounded-md text-xs">{p.category}</span>
                      </td>

                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-slate-100 rounded-md text-xs">{String(p.subCategory || p.subcategory || '') || '—'}</span>
                      </td>

                      <td className="px-4 py-3 font-medium">{p.price}</td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${p.stock > 10 ? 'bg-green-500' : p.stock > 0 ? 'bg-yellow-500' : 'bg-red-500'}`} />
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-bold ${
                              p.stock > 10 ? 'bg-green-100 text-green-700' : p.stock > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {p.stock === 0 ? t('outOfStock') : p.stock}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => handleEditClick(p)} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Edit Product & Inventory">
                            <Edit2 size={16} />
                          </button>

                          <button onClick={() => handleDeleteProduct(p.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete Product">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ORDERS */}
        {activeTab === 'orders' && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 animate-in fade-in">
            <h3 className="font-bold text-lg mb-6">{t('orderManagement')}</h3>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left rtl:text-right">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                  <tr>
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">{t('customer')}</th>
                    <th className="px-4 py-3">{t('status')}</th>
                    <th className="px-4 py-3">{t('payment')}</th>
                    <th className="px-4 py-3">ملاحظة</th>
                    <th className="px-4 py-3">{t('total')}</th>
                    <th className="px-4 py-3">{t('actions')}</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {orders.map((order: any) => {
                    const note = safeText(order.note);
                    const pm = safeText(order.paymentMethod).toLowerCase();
                    const cliqRef = safeText(order.paymentDetails?.cliqReference);
                    const receipt = safeText(order.paymentDetails?.receiptImage);

                    return (
                      <tr key={order.id} className="hover:bg-slate-50 transition-colors align-top">
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-2">
                            <div className="font-medium text-secondary-dark break-all">{order.id}</div>
                            <button
                              type="button"
                              className="p-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
                              title={t('copy') ?? 'Copy'}
                              onClick={() => copyToClipboard(order.id, 'تم نسخ رقم الطلب')}
                            >
                              <Copy size={14} className="text-slate-600" />
                            </button>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <div>
                            <p className="font-bold">{safeText(order.address?.fullName) || '—'}</p>
                            <p className="text-xs text-slate-400">{safeText(order.address?.city) || '—'}</p>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${statusBadge(order.status)}`}>
                       {t(order.status ?? '') ?? safeText(order.status) ?? '—'}                         </span>
                        </td>

                        <td className="px-4 py-3 text-slate-600 text-xs">
                          <div className="flex items-start gap-2">
                            <div>
                              <div className="uppercase font-bold flex items-center gap-1">
                                <CreditCard size={14} /> {pm || '—'}
                              </div>

                              {pm === 'cliq' && (
                                <div className="mt-1 space-y-1">
                                  {cliqRef && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-[11px] text-blue-700 font-bold">Ref:</span>
                                      <span className="text-[11px] text-blue-700 break-all">{cliqRef}</span>
                                      <button
                                        type="button"
                                        className="p-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
                                        title="Copy CliQ ref"
                                        onClick={() => copyToClipboard(cliqRef, 'تم نسخ رقم مرجع CliQ')}
                                      >
                                        <Copy size={13} className="text-slate-600" />
                                      </button>
                                    </div>
                                  )}

                                  {receipt && (
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-700 mt-1"
                                      onClick={() => setReceiptModal({ open: true, orderId: order.id, url: receipt })}
                                    >
                                      <ImageIcon size={14} /> معاينة الإيصال
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          {note ? (
                            <div className="max-w-[280px]">
                              <div className="flex items-center gap-2 mb-1">
                                <StickyNote size={14} className="text-secondary-DEFAULT" />
                                <span className="text-[11px] font-bold text-slate-600">{t('orderNote') ?? 'ملاحظة'}</span>
                                <button
                                  type="button"
                                  className="p-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
                                  title="Copy note"
                                  onClick={() => copyToClipboard(note, 'تم نسخ الملاحظة')}
                                >
                                  <Copy size={13} className="text-slate-600" />
                                </button>
                              </div>
                              <div className="text-xs text-slate-700 bg-slate-50 border border-slate-100 rounded-xl p-2 whitespace-pre-wrap break-words line-clamp-3">
                                {note}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3 font-bold whitespace-nowrap">{money(Number(order.total || 0))}</td>

                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {order.status === 'processing' && (
                              <button
                                onClick={() => handleUpdateOrderStatus(order.id, 'shipped')}
                                className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-xl text-xs font-bold hover:bg-blue-100 border border-blue-100"
                              >
                                {t('ship') ?? 'Ship'}
                              </button>
                            )}

                            {order.status === 'shipped' && (
                              <button
                                onClick={() => handleUpdateOrderStatus(order.id, 'delivered')}
                                className="px-3 py-1.5 bg-green-50 text-green-700 rounded-xl text-xs font-bold hover:bg-green-100 border border-green-100"
                              >
                                {t('deliver') ?? 'Deliver'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {orders.length === 0 && <div className="text-center py-10 text-slate-500">لا توجد طلبات بعد.</div>}
            </div>
          </div>
        )}

        {/* SETTINGS */}
        {activeTab === 'settings' && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 animate-in fade-in max-w-2xl mx-auto">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-secondary-light/20 text-secondary-DEFAULT rounded-full flex items-center justify-center">
                <Database size={24} />
              </div>
              <div>
                <h3 className="font-bold text-lg">{t('databaseSettings')}</h3>
                <p className={`text-sm ${firebaseReady ? 'text-green-600' : 'text-slate-500'}`}>{firebaseReady ? t('firebaseConnected') : t('firebaseNotConnected')}</p>
              </div>
            </div>

            {!firebaseReady ? (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">{t('databaseDesc')}</div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Firebase Configuration JSON</label>
                  <textarea
                    value={firebaseConfigInput}
                    onChange={(e) => setFirebaseConfigInput(e.target.value)}
                    placeholder={t('pasteConfigPlaceholder')}
                    rows={8}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 font-mono text-xs focus:ring-2 focus:ring-secondary-DEFAULT outline-none"
                  />
                </div>

                <Button onClick={handleConnectFirebase} className="w-full">
                  {t('connectFirebase')}
                </Button>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                  <Cloud size={40} />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">{t('firebaseConnected')}</h3>
                <p className="text-slate-500 mb-8">All your data (products, orders, users) is now syncing with Firestore.</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    removeFirebaseConfig();
                    showToast(t('disconnected') ?? 'Disconnected', 'success');
                    window.location.reload();
                  }}
                  className="border-red-200 text-red-500 hover:bg-red-50"
                >
                  {t('disconnectFirebase')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ✅ Receipt Modal */}
      {receiptModal.open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setReceiptModal({ open: false })} />
          <div className="relative z-[81] w-full max-w-2xl bg-white rounded-3xl border border-slate-100 shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm text-slate-500">إيصال CliQ</p>
                <p className="font-bold text-slate-900 break-all">{safeText(receiptModal.orderId)}</p>
              </div>
              <button
                type="button"
                className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50"
                onClick={() => setReceiptModal({ open: false })}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 bg-slate-50">
              {receiptModal.url ? (
                <img
                  src={receiptModal.url}
                  alt="CliQ receipt"
                  className="w-full max-h-[70vh] object-contain rounded-2xl bg-white border border-slate-100"
                />
              ) : (
                <div className="text-center text-slate-500 py-10">لا يوجد صورة إيصال.</div>
              )}

              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <Button variant="outline" className="w-full" onClick={() => copyToClipboard(receiptModal.url || '', 'تم نسخ رابط الإيصال')}>
                  <Copy size={16} className="ml-2 rtl:ml-2 rtl:mr-0 ltr:ml-0 ltr:mr-2" />
                  نسخ رابط الإيصال
                </Button>

                <Button className="w-full" onClick={() => setReceiptModal({ open: false })}>
                  إغلاق
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <EditProductModal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} product={editingProduct} onSave={handleSaveProduct} />
    </div>
  );
};

export default AdminDashboard;