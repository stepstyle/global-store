// src/pages/Login.tsx
import React, { useMemo, useState } from 'react';
import { 
  Facebook, Eye, EyeOff, Mail, Lock, User as UserIcon, 
  Loader2, Gamepad2, Gift, PencilRuler, Rocket, Laptop, Palette, X
} from 'lucide-react';
import * as ReactRouterDOM from 'react-router-dom';

import SEO from '../components/SEO';
import { useCart } from '../App';
import { db } from '../services/storage';
import { User } from '../types';

import { sendResetEmail } from '../services/passwordReset';
// استدعاء دوال جوجل وفيسبوك النظيفة من ملف الخدمات
import { signInWithGoogle, signInWithFacebook } from '../services/authProviders';

const { useNavigate } = ReactRouterDOM as any;

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim().toLowerCase());

const safeText = (v: any) => String(v ?? '').trim();

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { showToast, t, login, language } = useCart() as any;

  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  
  // حالة التحكم بظهور نافذة "نسيت كلمة المرور"
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const [formData, setFormData] = useState({ name: '', email: '', password: '' });

  const isRtl = language === 'ar';
  const title = useMemo(() => (isLoginMode ? t('login') : t('createAccount')), [isLoginMode, t]);
  const desc = useMemo(() => (isLoginMode ? t('loginDesc') : t('registerDesc')), [isLoginMode, t]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: value }));
  };

  const getErrorMessage = (error: any) => {
    const code = error?.code;
    if (code === 'auth/email-already-in-use') return t('emailInUse') ?? 'Email is already registered.';
    if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
      return t('invalidCredentials') ?? 'Invalid email or password.';
    }
    if (code === 'auth/weak-password') return t('weakPassword') ?? 'Password should be at least 6 characters.';
    return t('genericError') ?? 'An error occurred. Please try again.';
  };

  const validate = () => {
    const email = safeText(formData.email);
    const password = safeText(formData.password);
    const name = safeText(formData.name);

    if (!email || !isValidEmail(email)) {
      showToast(t('invalidEmail') ?? 'Please enter a valid email address.', 'error');
      return false;
    }
    if (!password || password.length < 6) {
      showToast(t('weakPassword') ?? 'Password should be at least 6 characters.', 'error');
      return false;
    }
    if (!isLoginMode && !name) {
      showToast(t('fillName') ?? 'Please enter your full name.', 'error');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    if (!validate()) return;
    setIsLoading(true);

    try {
      if (isLoginMode) {
        const user = await db.users.login(formData.email, formData.password);
        if (user) {
          login(user);
          showToast(t('loginSuccess') ?? 'Logged in successfully.', 'success');
          navigate(user.role === 'admin' ? '/admin' : '/');
        } else {
          showToast(t('invalidCredentials') ?? 'Invalid email or password.', 'error');
        }
      } else {
        const newUser: User = {
          id: '',
          name: formData.name,
          email: formData.email,
          password: formData.password,
          role: 'customer',
          orders: [],
        };
        const createdUser = await db.users.register(newUser);
        login(createdUser);
        showToast(t('accountCreated') ?? 'Account created successfully!', 'success');
        navigate('/');
      }
    } catch (error: any) {
      showToast(getErrorMessage(error), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // دالة الإرسال من النافذة المنبثقة
  const handleSendResetEmail = async () => {
    const email = safeText(resetEmail);
    if (!email || !isValidEmail(email)) {
      showToast(t('invalidEmail') ?? 'Please enter a valid email address.', 'error');
      return;
    }
    
    setIsResetting(true);
    try {
      await sendResetEmail(email);
      showToast(
        isRtl ? 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني ✅' : 'Password reset link sent to your email ✅',
        'success'
      );
      setShowResetModal(false); // إغلاق النافذة بعد النجاح
    } catch (error: any) {
      const code = error?.code;
      if (code === 'auth/user-not-found') {
        showToast(isRtl ? 'هذا البريد غير مسجّل لدينا.' : 'This email is not registered.', 'error');
      } else {
        showToast(isRtl ? 'فشل إرسال الإيميل. جرّب مرة ثانية.' : 'Failed to send reset email.', 'error');
      }
    } finally {
      setIsResetting(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const u = await signInWithGoogle();
      const user: User = {
        id: u.uid,
        name: u.displayName || (isRtl ? 'مستخدم جوجل' : 'Google User'),
        email: u.email || '',
        password: '',
        role: 'customer',
        orders: [],
      };
      login(user);
      showToast(t('loginSuccess') ?? 'Logged in successfully.', 'success');
      navigate('/');
    } catch (err: any) {
      showToast(err?.message || (t('genericError') ?? 'An error occurred.'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // دالة تسجيل الدخول بفيسبوك النظيفة
  const handleFacebookLogin = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const u = await signInWithFacebook();
      const user: User = {
        id: u.uid,
        name: u.displayName || (isRtl ? 'مستخدم فيسبوك' : 'Facebook User'),
        email: u.email || '', 
        password: '',
        role: 'customer',
        orders: [],
      };
      login(user);
      showToast(t('loginSuccess') ?? 'Logged in successfully.', 'success');
      navigate('/');
    } catch (err: any) {
      showToast(err?.message || (t('genericError') ?? 'An error occurred.'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`relative min-h-screen w-full flex items-center justify-center p-6 overflow-hidden bg-slate-50 ${isRtl ? 'font-sans text-right' : 'font-sans text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      
      {/* 🎨 Background Layer - Thematic Gradients */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#EAB308]/20 via-white/50 to-[#3B82F6]/20" />
        
        {/* Floating Icons Background (Art & Tech) */}
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none select-none">
          <PencilRuler size={280} className="absolute -top-10 -left-10 rotate-12 text-[#EAB308]" />
          <Palette size={200} className="absolute top-1/4 left-1/4 -rotate-12 text-[#EAB308]" />
          <Gift size={220} className="absolute bottom-20 left-10 rotate-12 text-[#EAB308]" />
          
          <Gamepad2 size={320} className="absolute -bottom-20 -right-10 -rotate-12 text-[#3B82F6]" />
          <Rocket size={180} className="absolute top-20 right-20 rotate-45 text-[#3B82F6]" />
          <Laptop size={240} className="absolute bottom-1/3 right-1/4 opacity-60 text-[#3B82F6]" />
        </div>
      </div>

      <SEO title={title} description={desc} />

      {/* 💳 Login Card Container */}
      <div className="relative z-10 w-full max-w-[480px] animate-in fade-in zoom-in-95 duration-1000">
        <div className="bg-white/95 backdrop-blur-md rounded-[3rem] shadow-[0_40px_100px_rgba(15,23,42,0.12)] border border-white overflow-hidden">
          
          <div className="p-8 md:p-12">
            {/* Store Branding */}
            <div className="flex flex-col items-center mb-10">
              <div className="w-16 h-16 bg-gradient-to-br from-[#EAB308] to-[#3B82F6] rounded-[1.6rem] flex items-center justify-center text-white font-black text-3xl shadow-xl shadow-blue-500/20 mb-4 transform hover:rotate-12 transition-transform duration-500">
                A
              </div>
              <div className="text-center">
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">Dair Sharaf</h1>
                <p className="text-[11px] font-bold tracking-[0.4em] uppercase text-slate-400">TECH & ART</p>
              </div>
            </div>

            {/* Mode Switcher */}
            <div className="flex gap-1 mb-8 bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/50">
              <button
                type="button"
                onClick={() => setIsLoginMode(true)}
                className={`flex-1 py-3 text-xs rounded-xl transition-all duration-500 ${
                  isLoginMode ? 'bg-white shadow-md text-slate-900 font-black scale-100' : 'text-slate-500 font-bold opacity-60'
                }`}
                disabled={isLoading}
              >
                {t('login')}
              </button>
              <button
                type="button"
                onClick={() => setIsLoginMode(false)}
                className={`flex-1 py-3 text-xs rounded-xl transition-all duration-500 ${
                  !isLoginMode ? 'bg-white shadow-md text-slate-900 font-black scale-100' : 'text-slate-500 font-bold opacity-60'
                }`}
                disabled={isLoading}
              >
                {t('createAccount')}
              </button>
            </div>

            {/* Main Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {!isLoginMode && (
                <div className="relative group">
                  <input
                    name="name"
                    type="text"
                    required
                    className="w-full h-20 ltr:pl-12 rtl:pr-12  rounded-2xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#EAB308] focus:ring-4 focus:ring-[#EAB308]/5 outline-none transition-all font-bold text-slate-700 shadow-xl text-1xl"
                    placeholder={isRtl ? 'الاسم الكامل' : 'Full Name'}
                    value={formData.name}
                    onChange={handleInputChange}
                  />
                  <UserIcon className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-[#EAB308] transition-colors" size={20} />
                </div>
              )}

              <div className="relative group">
                <input
                  name="email"
                  type="email"
                  required
                className="w-full ltr:pl-12 rtl:pr-12 ltr:pr-12 rtl:pl-12 h-20 rounded-2xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#3B82F6] focus:ring-4 focus:ring-[#3B82F6]/5 outline-none transition-all font-bold text-slate-700 tracking-widest shadow-xl text-1xl"                 placeholder={isRtl ? 'البريد الإلكتروني' : 'Email Address'}
                  value={formData.email}
                  onChange={handleInputChange}
                />
                <Mail className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-[#3B82F6] transition-colors" size={20} />
              </div>

              <div className="relative group">
                <input
                  name="password"
                  type={showPass ? 'text' : 'password'}
                  required
              className="w-full ltr:pl-12 rtl:pr-12 ltr:pr-12 rtl:pl-12 h-20 rounded-2xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-[#3B82F6] focus:ring-4 focus:ring-[#3B82F6]/5 outline-none transition-all font-bold text-slate-700 tracking-widest shadow-xl text-2xl"                 placeholder={isRtl ? 'كلمة المرور' : 'Password'}
                  value={formData.password}
                  onChange={handleInputChange}
                />
                <Lock className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-[#3B82F6] transition-colors" size={20} />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute ltr:right-4 rtl:left-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600 transition-colors drop-shadow-md"
                >
                  {showPass ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>

              {isLoginMode && (
                <div className="flex justify-end px-2">
                  <button 
                    type="button" 
                    onClick={() => {
                      setResetEmail(formData.email); 
                      setShowResetModal(true);
                    }}
                    className="text-[12px] font-black text-[#3B82F6] hover:text-[#EAB308] lowercase tracking-wider transition-colors drop-shadow-md"
                  >
                    {isRtl ? 'نسيت كلمة المرور؟' : 'Forgot Password?'}
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-20 rounded-2xl bg-gradient-to-r from-[#EAB308] to-[#3B82F6] text-white font-black text-2xl lowercase tracking-widest shadow-2xl shadow-blue-500/30 hover:shadow-orange-500/30 hover:scale-[1.02] active:scale-95 transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed drop-shadow-md"
              >
                {isLoading ? <Loader2 className="animate-spin mx-auto" size={28} /> : (isLoginMode ? t('login') : t('createAccount'))}
              </button>
            </form>

            {/* Social Authentication */}
            <div className="relative my-10">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
              <div className="relative flex justify-center text-[10px] font-black uppercase tracking-[0.2em]"><span className="px-4 bg-white text-slate-400">{t('orContinueWith')}</span></div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="flex items-center justify-center gap-2 py-3.5 border border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all text-xs font-black text-slate-700"
                disabled={isLoading}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google
              </button>
              <button
                type="button"
                onClick={handleFacebookLogin}
                className="flex items-center justify-center gap-2 py-3.5 border border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all text-xs font-black text-slate-700"
                disabled={isLoading}
              >
                <Facebook size={18} className="text-[#1877F2]" fill="currentColor" stroke="none" />
                Facebook
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Footer */}
        <p className="mt-8 text-center text-[10px] font-bold text-slate-400 uppercase tracking-[0.4em]">
          Dair Sharaf Experience • Tech & Art 2024
        </p>
      </div>

      {/* 🛑 نافذة إعادة تعيين كلمة المرور (Modal) */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black text-slate-800">
                  {isRtl ? 'إعادة تعيين كلمة المرور' : 'Reset Password'}
                </h3>
                <button 
                  onClick={() => setShowResetModal(false)}
                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="text-slate-500 text-sm font-bold mb-6">
                {isRtl 
                  ? 'أدخل بريدك الإلكتروني المسجل لدينا وسنقوم بإرسال رابط لتغيير كلمة المرور الخاصة بك.' 
                  : 'Enter your registered email address and we will send you a link to reset your password.'}
              </p>
              
              <div className="relative group mb-6">
                <input
                  type="email"
                  className="w-full ltr:pl-12 rtl:pr-12 h-16 rounded-2xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/20 outline-none transition-all font-bold text-slate-700 tracking-wider text-lg"
                  placeholder={isRtl ? 'البريد الإلكتروني' : 'Email Address'}
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  dir="ltr"
                />
                <Mail className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#3B82F6] transition-colors" size={20} />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowResetModal(false)}
                  className="flex-1 py-4 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition-colors"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  onClick={handleSendResetEmail}
                  disabled={isResetting || !resetEmail}
                  className="flex-1 py-4 rounded-xl bg-[#3B82F6] text-white font-black shadow-lg shadow-blue-500/30 hover:bg-blue-600 transition-colors disabled:opacity-50 flex justify-center items-center"
                >
                  {isResetting ? <Loader2 className="animate-spin" size={20} /> : (isRtl ? 'إرسال الرابط' : 'Send Link')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;