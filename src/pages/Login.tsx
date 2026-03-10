// src/pages/Login.tsx
import React, { useMemo, useState } from 'react';
import {
  Facebook, Eye, EyeOff, Mail, Lock, User as UserIcon,
  Loader2, PencilRuler, Rocket, Palette, Gift, Gamepad2, Laptop,
  Inbox, ArrowRight, RefreshCw, AlertCircle, X
} from 'lucide-react';
import * as ReactRouterDOM from 'react-router-dom';
import { getAuth, sendEmailVerification, signOut } from "firebase/auth";

import SEO from '../components/SEO';
import { useCart } from '../App';
import { db } from '../services/storage';
import { User } from '../types';
import { sendResetEmail } from '../services/passwordReset';
import { signInWithGoogle, signInWithFacebook } from '../services/authProviders';

const { useNavigate } = ReactRouterDOM as any;

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim().toLowerCase());
const safeText = (v: any) => String(v ?? '').trim();

// 🚀 السر الاحترافي: تقسيم الصفحة إلى 3 حالات رئيسية
type ViewState = 'login' | 'register' | 'verify_email';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { t, login, language } = useCart() as any;
  const isRtl = language === 'ar';

  // --- States ---
  const [view, setView] = useState<ViewState>('login');
  const [isLoading, setIsLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [formError, setFormError] = useState('');
  
  // حالة شاشة إعادة تعيين كلمة المرور
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetAlert, setResetAlert] = useState<{ type: 'error' | 'success', msg: string }>({ type: 'success', msg: '' });

  // دالة مسح الأخطاء عند الكتابة
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (formError) setFormError('');
  };

  // المترجم العالمي للأخطاء
  const getGlobalError = (code: string) => {
    const errors: Record<string, string> = {
      'auth/email-already-in-use': isRtl ? 'هذا البريد مسجل مسبقاً، يرجى تسجيل الدخول.' : 'Email is already registered. Please log in.',
      'auth/invalid-credential': isRtl ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' : 'Invalid email or password.',
      'auth/wrong-password': isRtl ? 'كلمة المرور غير صحيحة.' : 'Incorrect password.',
      'auth/user-not-found': isRtl ? 'هذا الحساب غير موجود.' : 'Account not found.',
      'auth/weak-password': isRtl ? 'كلمة المرور ضعيفة، استخدم 6 أحرف على الأقل.' : 'Password must be at least 6 characters.',
    };
    return errors[code] || (isRtl ? 'حدث خطأ غير متوقع، يرجى المحاولة ثانية.' : 'An unexpected error occurred.');
  };

  // 📧 دالة إرسال رابط التفعيل
  const handleResendVerification = async () => {
    const auth = getAuth();
    if (!auth.currentUser) return;
    
    setIsLoading(true);
    try {
      await sendEmailVerification(auth.currentUser);
      setFormError(isRtl ? 'تم إعادة إرسال الرابط بنجاح! تفقد بريدك ✅' : 'Link resent successfully! Check your inbox ✅');
    } catch (err: any) {
      if (err.code === 'auth/too-many-requests') {
         setFormError(isRtl ? 'يرجى الانتظار قليلاً قبل طلب رابط جديد.' : 'Please wait a moment before requesting a new link.');
      } else {
         setFormError(isRtl ? 'فشل إرسال الرابط، يرجى المحاولة لاحقاً.' : 'Failed to send link. Try again later.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 🚪 دالة الخروج من شاشة التفعيل
  const handleSignOutFromVerify = async () => {
    await signOut(getAuth());
    setView('login');
    setFormData({ ...formData, password: '' }); // تنظيف كلمة المرور كإجراء أمني
    setFormError('');
  };

  // 🛡️ دالة المعالجة الرئيسية (Core Logic)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setFormError('');

    const email = safeText(formData.email);
    const password = safeText(formData.password);
    const name = safeText(formData.name);

    if (!isValidEmail(email)) return setFormError(isRtl ? 'يرجى إدخال بريد إلكتروني صحيح.' : 'Please enter a valid email.');
    if (password.length < 6) return setFormError(isRtl ? 'كلمة المرور يجب أن لا تقل عن 6 أحرف.' : 'Password must be at least 6 characters.');
    if (view === 'register' && !name) return setFormError(isRtl ? 'يرجى إدخال اسمك الكامل.' : 'Full name is required.');

    setIsLoading(true);
    const auth = getAuth();

    try {
      if (view === 'login') {
        const user = await db.users.login(email, password);
        
        // 🚨 هنا الاحتراف: إذا لم يفعّل بريده، نعرض له شاشة التفعيل ولا نطرده فوراً
        if (auth.currentUser && !auth.currentUser.emailVerified) {
          setView('verify_email');
          setIsLoading(false);
          return;
        }

        if (user) {
          login(user);
          navigate(user.role === 'admin' ? '/admin' : '/');
        } else {
          setFormError(getGlobalError('auth/invalid-credential'));
        }
      } 
     else if (view === 'register') {
        const newUser: User = { id: '', name, email, password, role: 'customer', orders: [] };
        
        // 1. هذه الدالة الآن (بعد التعديل أعلاه) تنشئ الحساب وترسل الإيميل وتحفظ في الداتا بيز
        await db.users.register(newUser);
        
        // 2. تسجيل الخروج لمنع الدخول التلقائي
        await signOut(auth);
        
        // 3. تحويله لشاشة التفعيل الأنيقة
        setView('verify_email');
      }
    } catch (error: any) {
      setFormError(getGlobalError(error.code));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialAuth = async (provider: 'google' | 'facebook') => {
    if (isLoading) return;
    setIsLoading(true);
    setFormError('');
    try {
      const u = provider === 'google' ? await signInWithGoogle() : await signInWithFacebook();
      const user: User = { id: u.uid, name: u.displayName || 'User', email: u.email || '', password: '', role: 'customer', orders: [] };
      login(user);
      navigate('/');
    } catch (err: any) {
      setFormError(getGlobalError(err.code));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!isValidEmail(resetEmail)) return;
    setIsResetting(true);
    try {
      await sendResetEmail(resetEmail);
      setResetAlert({ type: 'success', msg: isRtl ? 'تم إرسال رابط الاستعادة إلى بريدك.' : 'Reset link sent to your email.' });
      setTimeout(() => { setShowResetModal(false); setResetAlert({type: 'success', msg: ''}) }, 2000);
    } catch (error: any) {
      setResetAlert({ type: 'error', msg: getGlobalError(error.code) });
    } finally {
      setIsResetting(false);
    }
  };

  // ==========================================
  // 🎨 واجهة رقم 1: شاشة التحقق من البريد الإلكتروني (المعيار العالمي)
  // ==========================================
  if (view === 'verify_email') {
    return (
      <div className={`min-h-screen flex items-center justify-center p-6 bg-[#F8FAFC] ${isRtl ? 'font-sans text-right' : 'font-sans text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
        <SEO title={isRtl ? 'تأكيد البريد' : 'Verify Email'} description="Verify your Dair Sharaf account" />
        
        <div className="bg-white max-w-[440px] w-full rounded-[2.5rem] shadow-[0_40px_100px_rgba(15,23,42,0.06)] border border-white p-10 text-center animate-in zoom-in-95 duration-500">
          <div className="w-24 h-24 bg-blue-50 text-[#3B82F6] rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner relative overflow-hidden">
            <Inbox size={44} strokeWidth={1.5} className="relative z-10" />
            <div className="absolute inset-0 bg-blue-100/50 animate-pulse"></div>
          </div>
          
          <h2 className="text-2xl font-black text-slate-900 mb-4">{isRtl ? 'راجع بريدك الإلكتروني' : 'Check your inbox'}</h2>
          
          <p className="text-sm font-bold text-slate-500 mb-8 leading-relaxed">
            {isRtl ? 'لقد أرسلنا رابط تفعيل آمن إلى البريد التالي:' : 'We sent a secure verification link to:'} <br/>
            <span className="inline-block mt-3 px-4 py-2 bg-slate-100 text-slate-900 rounded-xl tracking-wider">{formData.email}</span>
          </p>

          {formError && (
            <div className={`mb-6 p-3 rounded-xl text-xs font-bold ${formError.includes('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {formError}
            </div>
          )}
          
          <div className="space-y-3">
            <button 
              onClick={handleResendVerification} disabled={isLoading}
              className="w-full h-14 rounded-2xl bg-[#3B82F6] text-white font-black hover:bg-blue-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : (
                <><RefreshCw size={18} /> {isRtl ? 'إعادة إرسال الرابط' : 'Resend Verification Link'}</>
              )}
            </button>
            
            <button 
              onClick={handleSignOutFromVerify}
              className="w-full h-14 rounded-2xl bg-slate-50 text-slate-600 font-bold hover:bg-slate-100 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {isRtl ? 'العودة لتسجيل الدخول' : 'Back to login'} <ArrowRight size={16} className={isRtl ? 'rotate-180' : ''} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // 🎨 واجهة رقم 2: شاشة تسجيل الدخول / إنشاء الحساب
  // ==========================================
  return (
    <div className={`relative min-h-screen w-full flex items-center justify-center p-6 overflow-hidden bg-slate-50 ${isRtl ? 'font-sans text-right' : 'font-sans text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <SEO title={view === 'login' ? t('login') : t('createAccount')} description="Authentication" />
      
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none select-none">
        <PencilRuler size={280} className="absolute -top-10 -left-10 rotate-12" />
        <Rocket size={180} className="absolute top-20 right-20 rotate-45" />
      </div>

      <div className="relative z-10 w-full max-w-[460px] animate-in fade-in zoom-in-95 duration-500">
        <div className="bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-[0_20px_60px_rgba(0,0,0,0.05)] border border-white p-8 md:p-10">
          
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-black rounded-2xl flex items-center justify-center text-white font-black text-2xl mb-4 shadow-xl">A</div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Dair Sharaf</h1>
          </div>

          {/* تبديل حالة الواجهة */}
          <div className="flex bg-slate-100/60 p-1.5 rounded-2xl mb-6">
            <button type="button" onClick={() => { setView('login'); setFormError(''); }} className={`flex-1 py-3 text-xs rounded-xl transition-all ${view === 'login' ? 'bg-white shadow-sm text-slate-900 font-black' : 'text-slate-500 font-bold'}`}>{t('login')}</button>
            <button type="button" onClick={() => { setView('register'); setFormError(''); }} className={`flex-1 py-3 text-xs rounded-xl transition-all ${view === 'register' ? 'bg-white shadow-sm text-slate-900 font-black' : 'text-slate-500 font-bold'}`}>{t('createAccount')}</button>
          </div>

          {formError && (
            <div className="mb-5 p-4 rounded-2xl bg-red-50 border border-red-100 flex items-start gap-3 text-red-700 animate-in slide-in-from-top-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span className="text-xs font-bold leading-relaxed">{formError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {view === 'register' && (
              <div className="relative">
                <input name="name" type="text" required className="w-full h-16 ltr:pl-12 rtl:pr-12 rounded-2xl bg-slate-50 border border-transparent focus:bg-white focus:border-black outline-none font-bold text-slate-700 transition-all" placeholder={isRtl ? 'الاسم الكامل' : 'Full Name'} value={formData.name} onChange={handleInputChange} />
                <UserIcon className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              </div>
            )}
            <div className="relative">
              <input name="email" type="email" required className="w-full h-16 ltr:pl-12 rtl:pr-12 rounded-2xl bg-slate-50 border border-transparent focus:bg-white focus:border-black outline-none font-bold text-slate-700 transition-all" placeholder={isRtl ? 'البريد الإلكتروني' : 'Email Address'} value={formData.email} onChange={handleInputChange} />
              <Mail className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            </div>
            <div className="relative">
              <input name="password" type={showPass ? 'text' : 'password'} required className="w-full h-16 ltr:pl-12 rtl:pr-12 rounded-2xl bg-slate-50 border border-transparent focus:bg-white focus:border-black outline-none font-bold text-slate-700 tracking-widest transition-all" placeholder={isRtl ? 'كلمة المرور' : 'Password'} value={formData.password} onChange={handleInputChange} />
              <Lock className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <button type="button" onClick={() => setShowPass(!showPass)} className="absolute ltr:right-4 rtl:left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-black">
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {view === 'login' && (
              <div className="flex justify-end px-1">
                <button type="button" onClick={() => setShowResetModal(true)} className="text-[11px] font-black text-[#3B82F6] hover:text-black uppercase tracking-tight">{isRtl ? 'نسيت كلمة المرور؟' : 'Forgot Password?'}</button>
              </div>
            )}

            <button type="submit" disabled={isLoading} className="w-full h-16 rounded-2xl bg-black text-white font-black text-lg hover:bg-slate-900 active:scale-[0.98] transition-all flex items-center justify-center shadow-lg">
              {isLoading ? <Loader2 className="animate-spin" size={24} /> : (view === 'login' ? t('login') : t('createAccount'))}
            </button>
          </form>

          <div className="relative my-8 text-center">
            <span className="bg-white px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest relative z-10">{t('orContinueWith')}</span>
            <div className="absolute inset-0 border-t border-slate-100 top-1/2"></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => handleSocialAuth('google')} disabled={isLoading} className="flex items-center justify-center gap-2 py-3.5 border border-slate-200 rounded-2xl hover:bg-slate-50 font-black text-xs text-slate-700 transition-all">Google</button>
            <button onClick={() => handleSocialAuth('facebook')} disabled={isLoading} className="flex items-center justify-center gap-2 py-3.5 border border-slate-200 rounded-2xl hover:bg-slate-50 font-black text-xs text-slate-700 transition-all">Facebook</button>
          </div>
        </div>
      </div>

      {/* نافذة نسيان كلمة المرور */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black text-slate-900">{isRtl ? 'استعادة الحساب' : 'Reset Password'}</h3>
              <button onClick={() => setShowResetModal(false)} className="text-slate-400 hover:text-black bg-slate-100 p-2 rounded-full"><X size={18} /></button>
            </div>
            {resetAlert.msg && <p className={`text-xs font-bold mb-4 ${resetAlert.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>{resetAlert.msg}</p>}
            <input type="email" placeholder="Email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} className="w-full h-14 bg-slate-50 rounded-xl px-4 outline-none border focus:border-black font-bold mb-6" dir="ltr" />
            <button onClick={handleResetPassword} disabled={isResetting || !resetEmail} className="w-full h-14 bg-[#3B82F6] text-white rounded-xl font-black flex items-center justify-center hover:bg-blue-600 active:scale-[0.98] transition-all shadow-lg shadow-blue-500/30">
              {isResetting ? <Loader2 className="animate-spin" size={20} /> : (isRtl ? 'إرسال الرابط' : 'Send Link')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;