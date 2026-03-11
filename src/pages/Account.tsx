// src/pages/Account.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { getFirestoreDb } from '../services/firebase';
import { 
  User, Package, LogOut, Settings, ChevronRight, 
  Mail, Phone, Lock, ShieldCheck, Edit2, Clock, 
  CheckCircle2, ShoppingBag, Loader2
} from 'lucide-react';
import { useCart } from '../App';
import { Link } from 'react-router-dom';

const toMillis = (v: any): number => {
  if (!v) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  return 0;
};

const Account: React.FC = () => {
  // 1. استدعاء أدوات الترجمة (t, language)
  const { user, logout, showToast, t, language } = useCart() as any; 
  const [activeTab, setActiveTab] = useState<'profile' | 'orders'>('profile');
  
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [phone, setPhone] = useState(user?.phoneNumber || '');

  const [realOrders, setRealOrders] = useState<any[]>([]);
  // تم ضبط حالة التحميل المبدئية بناءً على التبويب النشط لزيادة السلاسة
  const [isLoadingOrders, setIsLoadingOrders] = useState(false); 
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // 2. نظام الترجمة (Bilingual System)
  const isAR = language === 'ar';
  const tr = useCallback((ar: string, en: string) => (isAR ? ar : en), [isAR]);
  const tt = useCallback(
    (key: string, fallbackAr: string, fallbackEn: string) => {
      const v = t?.(key);
      if (!v || v === key) return tr(fallbackAr, fallbackEn);
      return String(v);
    },
    [t, tr]
  );

  // ترجمة حالة الطلب
  const getStatusLabel = (status: string) => {
    const s = String(status).toLowerCase();
    if (s === 'delivered') return tt('delivered', 'تم التسليم', 'Delivered');
    if (s === 'shipped') return tt('shipped', 'تم الشحن', 'Shipped');
    if (s === 'processing' || s === 'new') return tt('processing', 'قيد المعالجة', 'Processing');
    if (s === 'cancelled') return tt('cancelled', 'ملغي', 'Cancelled');
    return status;
  };

  useEffect(() => {
    if (!user?.email || activeTab !== 'orders') return;

    const fetchUserOrders = async () => {
      setIsLoadingOrders(true); // تفعيل التحميل بسلاسة عند فتح التبويب
      try {
        const db = await getFirestoreDb();
        const q = query(
          collection(db, 'orders'),
          where('customerEmail', '==', user.email)
        );
        
        const querySnapshot = await getDocs(q);
        const fetchedOrders = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...(doc.data() as any) 
        }));

        fetchedOrders.sort((a: any, b: any) => { 
          return toMillis(b.createdAt) - toMillis(a.createdAt);
        });

        setRealOrders(fetchedOrders);
      } catch (error) {
        console.error("Error fetching orders:", error);
        showToast(tt('errorFetching', 'حدث خطأ أثناء جلب الطلبات', 'Error fetching orders'), 'error');
      } finally {
        setIsLoadingOrders(false);
      }
    };

    fetchUserOrders();
  }, [user, activeTab, showToast, tt]);

  const handleResetPassword = async () => {
    if (!user?.email) return;
    setIsResettingPassword(true);
    try {
      const auth = getAuth();
      await sendPasswordResetEmail(auth, user.email);
      showToast(tt('resetSent', 'تم إرسال رابط تغيير كلمة المرور إلى بريدك بنجاح!', 'Password reset link sent to your email!'), 'success');
    } catch (error: any) {
      console.error(error);
      showToast(tt('errorReset', 'حدث خطأ أثناء إرسال الرابط، يرجى المحاولة لاحقاً', 'Error sending link, please try again later'), 'error');
    } finally {
      setIsResettingPassword(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center bg-slate-50">
        <ShieldCheck size={64} className="text-slate-300 mb-4" />
        <h2 className="text-2xl font-bold text-slate-800 mb-2">{tt('secureArea', 'منطقة آمنة', 'Secure Area')}</h2>
        <p className="text-slate-500 mb-6">{tt('loginRequired', 'يرجى تسجيل الدخول للوصول إلى لوحة التحكم الخاصة بك.', 'Please login to access your dashboard.')}</p>
      </div>
    );
  }

  return (
    // 3. التحكم باتجاه الصفحة بناءً على اللغة (rtl / ltr)
    <div className={`min-h-screen bg-[#f8fafc] py-12 font-sans ${isAR ? 'text-right' : 'text-left'}`} dir={isAR ? 'rtl' : 'ltr'}>
      <div className="container mx-auto px-4 lg:px-8 max-w-6xl">
        
        <div className="mb-8 flex items-center justify-between bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-5">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-yellow-400 to-blue-500 flex items-center justify-center text-white text-3xl font-extrabold shadow-md shrink-0">
              {user?.displayName?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || 'A'}
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900 mb-1">
                {tt('welcome', 'مرحباً بك،', 'Welcome,')} {user?.displayName || tt('guest', 'ضيفنا الكريم', 'Guest')}
              </h1>
              <p className="text-slate-500 text-sm flex items-center gap-2">
                <CheckCircle2 size={16} className="text-green-500" /> {tt('trustedMember', 'عضو موثوق', 'Trusted Member')}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          <div className="w-full lg:w-1/4">
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden sticky top-24">
              <div className="p-4">
                <button
                  onClick={() => setActiveTab('profile')}
                  className={`w-full flex items-center justify-between p-4 mb-2 rounded-2xl transition-all ${
                    activeTab === 'profile' ? 'bg-gradient-to-r from-blue-50 to-blue-100/50 text-blue-700 font-bold shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <User size={20} className={activeTab === 'profile' ? 'text-blue-600' : ''} />
                    <span>{tt('personalInfo', 'البيانات الشخصية', 'Personal Info')}</span>
                  </div>
                  <ChevronRight size={18} className="rtl:rotate-180 text-slate-400" />
                </button>

                <button
                  onClick={() => setActiveTab('orders')}
                  className={`w-full flex items-center justify-between p-4 mb-2 rounded-2xl transition-all ${
                    activeTab === 'orders' ? 'bg-gradient-to-r from-yellow-50 to-yellow-100/50 text-yellow-700 font-bold shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Package size={20} className={activeTab === 'orders' ? 'text-yellow-600' : ''} />
                    <span>{tt('myOrders', 'طلباتي السابقة', 'My Orders')}</span>
                  </div>
                  <ChevronRight size={18} className="rtl:rotate-180 text-slate-400" />
                </button>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50/50">
                <button onClick={logout} className="w-full flex items-center justify-center gap-2 p-3 text-red-600 hover:bg-red-50 rounded-xl transition-colors font-bold">
                  <LogOut size={18} />
                  <span>{tt('logout', 'تسجيل الخروج', 'Logout')}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="w-full lg:w-3/4">
            {activeTab === 'profile' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                
                <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
                  <div className="absolute top-0 ltr:left-0 rtl:right-0 w-2 h-full bg-blue-500"></div>
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-800">
                    <Settings size={22} className="text-blue-500" /> {tt('contactInfo', 'معلومات التواصل', 'Contact Info')}
                  </h2>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-sm font-bold text-slate-500 flex items-center gap-2">
                          <Mail size={16} /> {tt('email', 'البريد الإلكتروني', 'Email')}
                        </label>
                      </div>
                      <span className="font-bold text-slate-900 text-lg break-all">{user?.email || '—'}</span>
                    </div>

                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                      <label className="text-sm font-bold text-slate-500 mb-2 flex items-center gap-2">
                        <Phone size={16} /> {tt('phone', 'رقم الهاتف', 'Phone Number')}
                      </label>
                      <div className="flex items-center justify-between">
                        {isEditingPhone ? (
                          <div className="flex gap-2 w-full">
                            <input 
                              type="text" 
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              placeholder={tt('enterNewPhone', 'أدخل رقمك الجديد', 'Enter new phone')}
                              className="w-full px-3 py-1 border border-blue-300 rounded-lg outline-none text-left" 
                              dir="ltr"
                            />
                            <button onClick={() => setIsEditingPhone(false)} className="px-3 bg-blue-600 text-white rounded-lg text-sm font-bold">
                              {tt('save', 'حفظ', 'Save')}
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="font-bold text-slate-900 text-lg" dir="ltr">{phone || tt('notSpecified', 'غير محدد', 'Not specified')}</span>
                            <button onClick={() => setIsEditingPhone(true)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                              <Edit2 size={18} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
                  <div className="absolute top-0 ltr:left-0 rtl:right-0 w-2 h-full bg-yellow-500"></div>
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-800">
                    <ShieldCheck size={22} className="text-yellow-500" /> {tt('security', 'الأمان وكلمة المرور', 'Security & Password')}
                  </h2>
                  
                  <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <label className="text-sm font-bold text-slate-500 mb-1 flex items-center gap-2">
                        <Lock size={16} /> {tt('currentPassword', 'كلمة المرور الحالية', 'Current Password')}
                      </label>
                      <p className="text-2xl tracking-widest text-slate-800 font-mono mt-1">••••••••</p>
                    </div>
                    <button 
                      onClick={handleResetPassword}
                      disabled={isResettingPassword}
                      className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-100 hover:text-yellow-600 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isResettingPassword ? <Loader2 size={18} className="animate-spin" /> : null}
                      {isResettingPassword ? tt('sending', 'جاري الإرسال...', 'Sending...') : tt('changePassword', 'تغيير كلمة المرور', 'Change Password')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'orders' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-6 rounded-3xl text-white shadow-lg">
                    <ShoppingBag size={24} className="mb-3 text-yellow-400" />
                    <p className="text-slate-300 text-sm mb-1">{tt('totalOrders', 'إجمالي طلباتك الحقيقية', 'Total Real Orders')}</p>
                    <p className="text-3xl font-extrabold">{realOrders.length}</p>
                  </div>
                  <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <CheckCircle2 size={24} className="mb-3 text-green-500" />
                    <p className="text-slate-500 text-sm mb-1">{tt('completedOrders', 'الطلبات المكتملة', 'Completed Orders')}</p>
                    <p className="text-3xl font-extrabold text-slate-900">
                      {realOrders.filter(o => String(o.status).toLowerCase() === 'delivered').length}
                    </p>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 transition-all">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-800">
                    <Package size={22} className="text-slate-600" /> {tt('orderHistory', 'سجل الطلبات', 'Order History')}
                  </h2>
                  
                  {isLoadingOrders ? (
                    <div className="flex flex-col items-center justify-center py-12 animate-in fade-in duration-300">
                      <Loader2 size={40} className="animate-spin text-blue-500 mb-4" />
                      <p className="text-slate-500 font-bold">{tt('loadingOrders', 'جاري جلب طلباتك...', 'Loading your orders...')}</p>
                    </div>
                  ) : realOrders.length === 0 ? (
                    <div className="text-center py-12 text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200 animate-in fade-in">
                      {tt('noOrders', 'لا توجد طلبات سابقة حتى الآن. ابدأ تسوقك الآن!', 'No previous orders yet. Start shopping now!')}
                    </div>
                  ) : (
                    <div className="space-y-4 animate-in fade-in duration-500">
                      {realOrders.map((order: any) => {
                        const isDelivered = String(order.status).toLowerCase() === 'delivered';
                        const ms = toMillis(order.createdAt);
                        const orderDate = ms ? new Date(ms).toLocaleDateString(isAR ? 'ar-JO' : 'en-US') : '—';
                        
                        return (
                          <div key={order.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-5 rounded-2xl border border-slate-100 hover:border-blue-200 hover:shadow-md transition-all bg-slate-50 hover:bg-white">
                            
                            <div className="flex items-center gap-4 mb-4 sm:mb-0">
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                                isDelivered ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'
                              }`}>
                                {isDelivered ? <CheckCircle2 size={24} /> : <Clock size={24} />}
                              </div>
                              <div>
                                <p className="font-extrabold text-slate-900 break-all">{order.id}</p>
                                <p className="text-sm text-slate-500 mt-1">
                                  {orderDate} • {tt('status', 'الحالة:', 'Status:')} {getStatusLabel(order.status)}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto">
                              <div className="text-left">
                                <p className="text-sm text-slate-500 mb-1">{tt('total', 'الإجمالي', 'Total')}</p>
                                <p className="font-extrabold text-lg text-slate-900" dir="ltr">{Number(order.total || 0).toFixed(2)} JOD</p>
                              </div>
                              <Link to={`/tracking?orderId=${encodeURIComponent(order.id)}`}>
                                <button className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-900 hover:text-white transition-colors">
                                  {tt('details', 'التفاصيل', 'Details')}
                                </button>
                              </Link>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Account;