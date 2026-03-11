// src/pages/Login.tsx
import React, { useMemo, useState } from 'react';
import {
  Facebook,
  Eye,
  EyeOff,
  Mail,
  Lock,
  User as UserIcon,
  Loader2,
  Gamepad2,
  Gift,
  PencilRuler,
  Rocket,
  Laptop,
  Palette,
  X,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
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

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim().toLowerCase());

const safeText = (v: any) => String(v ?? '').trim();

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { t, login, language } = useCart() as any;

  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [isResendingEmail, setIsResendingEmail] = useState(false);

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const [formData, setFormData] = useState({ name: '', email: '', password: '' });

  const [fieldErrors, setFieldErrors] = useState({
    name: '',
    email: '',
    password: '',
    resetEmail: '',
  });

  // نوع مخصص للأخطاء لدعم الأزرار التفاعلية داخل رسالة الخطأ (مثل إعادة الإرسال)
  const [formAlert, setFormAlert] = useState<{
    type: 'error' | 'success' | 'verify' | '';
    message: string;
  }>({
    type: '',
    message: '',
  });

  const [resetAlert, setResetAlert] = useState<{
    type: 'error' | 'success' | '';
    message: string;
  }>({
    type: '',
    message: '',
  });

  const isRtl = language === 'ar';
  
  // نصوص الشركات (Corporate Terminology)
  const tt = (ar: string, en: string) => (isRtl ? ar : en);
  const title = useMemo(() => (isLoginMode ? tt('تسجيل الدخول', 'Sign In') : tt('إنشاء حساب جديد', 'Create Account')), [isLoginMode, isRtl]);
  const desc = useMemo(() => (isLoginMode ? tt('أهلاً بك مجدداً في متجر دير شرف', 'Welcome back to Dair Sharaf') : tt('انضم إلينا واكتشف منتجاتنا', 'Join us and discover our products')), [isLoginMode, isRtl]);

  const clearMainFeedback = () => {
    setFormAlert({ type: '', message: '' });
    setFieldErrors((prev) => ({
      ...prev,
      name: '',
      email: '',
      password: '',
    }));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: value }));

    if (name in fieldErrors) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }

    if (formAlert.message) {
      setFormAlert({ type: '', message: '' });
    }
  };

  const getErrorMessage = (error: any) => {
    const code = error?.code;
    if (code === 'auth/email-already-in-use') return tt('يبدو أنك تملك حساباً مسبقاً. يرجى تسجيل الدخول بدلاً من ذلك.', 'An account with this email already exists. Please log in.');
    if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
      return tt('بيانات الاعتماد غير صحيحة. يرجى التحقق من البريد وكلمة المرور.', 'Invalid credentials. Please check your email and password.');
    }
    if (code === 'auth/weak-password') return tt('يرجى اختيار كلمة مرور قوية (6 رموز على الأقل).', 'Please choose a stronger password (at least 6 characters).');
    if (code === 'auth/unverified-email') return tt('عذراً، لم تقم بتفعيل حسابك بعد. يرجى مراجعة بريدك الإلكتروني.', 'Please verify your email address to proceed.');
    return tt('حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى لاحقاً.', 'An unexpected error occurred. Please try again.');
  };

  const validate = () => {
    const email = safeText(formData.email);
    const password = safeText(formData.password);
    const name = safeText(formData.name);

    const nextErrors = {
      name: '',
      email: '',
      password: '',
      resetEmail: fieldErrors.resetEmail,
    };

    if (!email || !isValidEmail(email)) {
      nextErrors.email = tt('يرجى إدخال عنوان بريد إلكتروني صالح.', 'Please enter a valid email address.');
    }

    if (!password || password.length < 6) {
      nextErrors.password = tt('كلمة المرور يجب أن تكون 6 رموز على الأقل.', 'Password must be at least 6 characters.');
    }

    if (!isLoginMode && !name) {
      nextErrors.name = tt('يرجى إدخال اسمك الكامل للمتابعة.', 'Please enter your full name to proceed.');
    }

    setFieldErrors(nextErrors);
    return !nextErrors.name && !nextErrors.email && !nextErrors.password;
  };

  // 🔄 دالة إعادة إرسال رابط التفعيل
  const handleResendVerification = async () => {
    setIsResendingEmail(true);
    try {
      const auth = getAuth();
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser);
        setFormAlert({ type: 'success', message: tt('تم إرسال الرابط مجدداً! تفقد بريدك الوارد (ومجلد الرسائل غير المرغوب فيها).', 'Verification link resent! Please check your inbox (and spam folder).') });
        await signOut(auth); // طرده ليعود للدخول
      }
    } catch (error: any) {
      if (error.code === 'auth/too-many-requests') {
        setFormAlert({ type: 'error', message: tt('تم تجاوز الحد المسموح. يرجى الانتظار قليلاً.', 'Too many requests. Please wait a moment.') });
      } else {
        setFormAlert({ type: 'error', message: tt('تعذر إرسال الرابط. حاول مرة أخرى.', 'Failed to send link. Try again.') });
      }
    } finally {
      setIsResendingEmail(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setFormAlert({ type: '', message: '' });

    if (!validate()) return;
    setIsLoading(true);

    try {
      const auth = getAuth();

      if (isLoginMode) {
        // --- مسار تسجيل الدخول ---
        const user = await db.users.login(formData.email, formData.password);
        
        // فحص التفعيل
        if (auth.currentUser && !auth.currentUser.emailVerified) {
          throw { code: 'auth/unverified-email' }; 
        }

        if (user) {
          login(user);
          navigate(user.role === 'admin' ? '/admin' : '/');
        } else {
          setFormAlert({
            type: 'error',
            message: tt('بيانات الاعتماد غير صحيحة. يرجى التحقق والمحاولة مجدداً.', 'Invalid credentials. Please verify and try again.'),
          });
        }
      } else {
        // --- مسار إنشاء الحساب الجديد ---
        const newUser: User = {
          id: '',
          name: formData.name,
          email: formData.email,
          password: formData.password,
          role: 'customer',
          orders: [],
        };
        
        await db.users.register(newUser);
        
        if (auth.currentUser) {
          await signOut(auth); // إخراجه فوراً لضمان عدم الدخول بدون تفعيل
        }

        setFormAlert({
          type: 'success',
          message: tt('تم إنشاء حسابك بنجاح! يرجى مراجعة بريدك الإلكتروني والنقر على رابط التفعيل للمتابعة.', 'Account created successfully! Please check your email and click the verification link to proceed.')
        });
        
        setIsLoginMode(true);
        setFormData((prev) => ({ ...prev, password: '' })); 
      }
    } catch (error: any) {
      // إذا كان الخطأ هو عدم تفعيل الإيميل، نظهر رسالة من نوع verify لزر إعادة الإرسال
      if (error?.code === 'auth/unverified-email') {
         setFormAlert({
           type: 'verify',
           message: getErrorMessage(error),
         });
      } else {
         setFormAlert({
           type: 'error',
           message: getErrorMessage(error),
         });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendResetEmail = async () => {
    const email = safeText(resetEmail);

    setResetAlert({ type: '', message: '' });
    setFieldErrors((prev) => ({ ...prev, resetEmail: '' }));

    if (!email || !isValidEmail(email)) {
      setFieldErrors((prev) => ({
        ...prev,
        resetEmail: tt('يرجى إدخال عنوان بريد إلكتروني صالح.', 'Please enter a valid email address.'),
      }));
      return;
    }

    setIsResetting(true);
    try {
      await sendResetEmail(email);

      setResetAlert({
        type: 'success',
        message: tt('تم إرسال تعليمات استعادة الحساب إلى بريدك الإلكتروني.', 'Account recovery instructions sent to your email.'),
      });

      window.setTimeout(() => {
        setShowResetModal(false);
        setResetEmail('');
        setResetAlert({ type: '', message: '' });
        setFieldErrors((prev) => ({ ...prev, resetEmail: '' }));
      }, 2500);
    } catch (error: any) {
      const code = error?.code;
      setResetAlert({
        type: 'error',
        message:
          code === 'auth/user-not-found'
            ? tt('لم نتمكن من العثور على حساب مسجل بهذا البريد.', 'We could not find an account with this email.')
            : tt('تعذر إرسال الطلب. يرجى المحاولة لاحقاً.', 'Unable to send request. Please try again later.'),
      });
    } finally {
      setIsResetting(false);
    }
  };

  const handleSocialAuth = async (provider: 'google' | 'facebook') => {
    if (isLoading) return;
    setIsLoading(true);
    setFormAlert({ type: '', message: '' });

    try {
      const u = provider === 'google' ? await signInWithGoogle() : await signInWithFacebook();
      const user: User = {
        id: u.uid,
        name: u.displayName || (isRtl ? 'عضو جديد' : 'New Member'),
        email: u.email || '',
        password: '',
        role: 'customer',
        orders: [],
      };
      login(user);
      navigate('/');
    } catch (err: any) {
      setFormAlert({
        type: 'error',
        message: err?.message || tt('تم إلغاء أو فشل عملية تسجيل الدخول.', 'Authentication failed or was cancelled.'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className={`relative min-h-screen w-full flex items-center justify-center p-6 overflow-hidden bg-slate-50 ${
        isRtl ? 'font-sans text-right' : 'font-sans text-left'
      }`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="absolute inset-0 z-0">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#EAB308]/20 via-white/50 to-[#3B82F6]/20" />

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

      <div className="relative z-10 w-full max-w-[480px] animate-in fade-in zoom-in-95 duration-1000">
        <div className="bg-white/95 backdrop-blur-md rounded-[3rem] shadow-[0_40px_100px_rgba(15,23,42,0.12)] border border-white overflow-hidden">
          <div className="p-8 md:p-12">
            <div className="flex flex-col items-center mb-10">
              <div className="w-16 h-16 bg-gradient-to-br from-[#EAB308] to-[#3B82F6] rounded-[1.6rem] flex items-center justify-center text-white font-black text-3xl shadow-xl shadow-blue-500/20 mb-4 transform hover:rotate-12 transition-transform duration-500">
                A
              </div>
              <div className="text-center">
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">Dair Sharaf</h1>
                <p className="text-[11px] font-bold tracking-[0.4em] uppercase text-slate-400">TECH & ART</p>
              </div>
            </div>

            <div className="flex gap-1 mb-8 bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/50">
              <button
                type="button"
                onClick={() => {
                  setIsLoginMode(true);
                  clearMainFeedback();
                }}
                className={`flex-1 py-3 text-xs rounded-xl transition-all duration-500 ${
                  isLoginMode ? 'bg-white shadow-md text-slate-900 font-black scale-100' : 'text-slate-500 font-bold opacity-60'
                }`}
                disabled={isLoading}
              >
                {tt('تسجيل الدخول', 'Sign In')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsLoginMode(false);
                  clearMainFeedback();
                }}
                className={`flex-1 py-3 text-xs rounded-xl transition-all duration-500 ${
                  !isLoginMode ? 'bg-white shadow-md text-slate-900 font-black scale-100' : 'text-slate-500 font-bold opacity-60'
                }`}
                disabled={isLoading}
              >
                {tt('حساب جديد', 'New Account')}
              </button>
            </div>

            {formAlert.message && (
              <div
                className={`mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold ${
                  formAlert.type === 'error' || formAlert.type === 'verify'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  {formAlert.type === 'success' ? (
                    <CheckCircle2 size={20} className="shrink-0 text-emerald-500" />
                  ) : (
                    <AlertCircle size={20} className="shrink-0 text-amber-500" />
                  )}
                  <span className="leading-snug">{formAlert.message}</span>
                </div>
                {/* 🚀 الزر الذكي لإعادة إرسال الإيميل */}
                {formAlert.type === 'verify' && (
                  <button 
                    onClick={handleResendVerification}
                    disabled={isResendingEmail}
                    className="shrink-0 sm:ml-auto bg-amber-200/50 hover:bg-amber-200 text-amber-900 px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1.5"
                  >
                    {isResendingEmail ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {tt('إعادة إرسال الرابط', 'Resend Link')}
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              {!isLoginMode && (
                <div>
                  <div className="relative group">
                    <input
                      name="name"
                      type="text"
                      className={`w-full h-16 sm:h-20 ltr:pl-12 rtl:pr-12 rounded-2xl bg-slate-50 border focus:bg-white focus:border-[#EAB308] focus:ring-4 focus:ring-[#EAB308]/5 outline-none transition-all font-bold text-slate-700 shadow-sm text-lg ${
                        fieldErrors.name ? 'border-red-300' : 'border-slate-100'
                      }`}
                      placeholder={tt('الاسم الكامل', 'Full Name')}
                      value={formData.name}
                      onChange={handleInputChange}
                      autoComplete="name"
                    />
                    <UserIcon
                      className={`absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 transition-colors ${
                        fieldErrors.name ? 'text-red-400' : 'text-slate-400 group-focus-within:text-[#EAB308]'
                      }`}
                      size={20}
                    />
                  </div>
                  {fieldErrors.name && <p className="mt-2 px-2 text-xs font-bold text-red-600">{fieldErrors.name}</p>}
                </div>
              )}

              <div>
                <div className="relative group">
                  <input
                    name="email"
                    type="email"
                    className={`w-full ltr:pl-12 rtl:pr-12 ltr:pr-12 rtl:pl-12 h-16 sm:h-20 rounded-2xl bg-slate-50 border focus:bg-white focus:border-[#3B82F6] focus:ring-4 focus:ring-[#3B82F6]/5 outline-none transition-all font-bold text-slate-700 tracking-wider shadow-sm text-lg ${
                      fieldErrors.email ? 'border-red-300' : 'border-slate-100'
                    }`}
                    placeholder={tt('البريد الإلكتروني', 'Email Address')}
                    value={formData.email}
                    onChange={handleInputChange}
                    autoComplete="email"
                  />
                  <Mail
                    className={`absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 transition-colors ${
                      fieldErrors.email ? 'text-red-400' : 'text-slate-400 group-focus-within:text-[#3B82F6]'
                    }`}
                    size={20}
                  />
                </div>
                {fieldErrors.email && <p className="mt-2 px-2 text-xs font-bold text-red-600">{fieldErrors.email}</p>}
              </div>

              <div>
                <div className="relative group">
                  <input
                    name="password"
                    type={showPass ? 'text' : 'password'}
                    className={`w-full ltr:pl-12 rtl:pr-12 ltr:pr-12 rtl:pl-12 h-16 sm:h-20 rounded-2xl bg-slate-50 border focus:bg-white focus:border-[#3B82F6] focus:ring-4 focus:ring-[#3B82F6]/5 outline-none transition-all font-bold text-slate-700 tracking-widest shadow-sm text-xl ${
                      fieldErrors.password ? 'border-red-300' : 'border-slate-100'
                    }`}
                    placeholder={tt('كلمة المرور', 'Password')}
                    value={formData.password}
                    onChange={handleInputChange}
                    autoComplete={isLoginMode ? "current-password" : "new-password"}
                  />
                  <Lock
                    className={`absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 transition-colors ${
                      fieldErrors.password ? 'text-red-400' : 'text-slate-400 group-focus-within:text-[#3B82F6]'
                    }`}
                    size={20}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute ltr:right-4 rtl:left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                  >
                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p className="mt-2 px-2 text-xs font-bold text-red-600">{fieldErrors.password}</p>
                )}
              </div>

              {isLoginMode && (
                <div className="flex justify-end px-2">
                  <button
                    type="button"
                    onClick={() => {
                      setResetEmail(formData.email);
                      setShowResetModal(true);
                      setResetAlert({ type: '', message: '' });
                      setFieldErrors((prev) => ({ ...prev, resetEmail: '' }));
                    }}
                    className="text-xs font-black text-slate-400 hover:text-[#3B82F6] transition-colors"
                  >
                    {tt('نسيت كلمة المرور؟', 'Forgot Password?')}
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-16 sm:h-20 rounded-2xl bg-gradient-to-r from-[#EAB308] to-[#3B82F6] text-white font-black text-xl shadow-lg shadow-blue-500/20 hover:shadow-orange-500/20 hover:scale-[1.02] active:scale-95 transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100 mt-2"
              >
                {isLoading ? (
                  <Loader2 className="animate-spin mx-auto" size={28} />
                ) : isLoginMode ? (
                  tt('متابعة الدخول', 'Sign In')
                ) : (
                  tt('تأكيد وإنشاء الحساب', 'Create Account')
                )}
              </button>
            </form>

            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-100"></div>
              </div>
              <div className="relative flex justify-center text-[10px] font-black uppercase tracking-[0.2em]">
                <span className="px-4 bg-white text-slate-300">{tt('أو المتابعة عبر', 'OR CONTINUE WITH')}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => handleSocialAuth('google')}
                className="flex items-center justify-center gap-2 py-3.5 border border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all text-xs font-black text-slate-700 shadow-sm"
                disabled={isLoading}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Google
              </button>

              <button
                type="button"
                onClick={() => handleSocialAuth('facebook')}
                className="flex items-center justify-center gap-2 py-3.5 border border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all text-xs font-black text-slate-700 shadow-sm"
                disabled={isLoading}
              >
                <Facebook size={18} className="text-[#1877F2]" fill="currentColor" stroke="none" />
                Facebook
              </button>
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-[10px] font-bold text-slate-400 uppercase tracking-[0.4em]">
          Dair Sharaf Experience • Tech & Art 2026
        </p>
      </div>

      {/* Modal - Reset Password */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-100">
            <div className="p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-black text-slate-900">
                  {tt('استعادة الحساب', 'Account Recovery')}
                </h3>
                <button
                  onClick={() => {
                    setShowResetModal(false);
                    setResetAlert({ type: '', message: '' });
                    setFieldErrors((prev) => ({ ...prev, resetEmail: '' }));
                  }}
                  className="p-2 text-slate-400 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <p className="text-slate-500 text-sm font-medium mb-6 leading-relaxed">
                {tt('أدخل عنوان بريدك الإلكتروني المسجل لدينا وسنقوم بإرسال رابط آمن لإعادة تعيين كلمة المرور الخاصة بك.', 'Enter your registered email address and we will send you a secure link to reset your password.')}
              </p>

              {resetAlert.message && (
                <div
                  className={`mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-bold ${
                    resetAlert.type === 'error'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {resetAlert.type === 'error' ? (
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
                  )}
                  <span>{resetAlert.message}</span>
                </div>
              )}

              <div className="mb-6">
                <div className="relative group">
                  <input
                    type="email"
                    className={`w-full ltr:pl-12 rtl:pr-12 h-16 rounded-2xl bg-slate-50 border focus:bg-white focus:border-[#3B82F6] focus:ring-4 focus:ring-[#3B82F6]/10 outline-none transition-all font-bold text-slate-700 tracking-wider text-lg ${
                      fieldErrors.resetEmail ? 'border-red-300' : 'border-slate-200'
                    }`}
                    placeholder={tt('البريد الإلكتروني', 'Email Address')}
                    value={resetEmail}
                    onChange={(e) => {
                      setResetEmail(e.target.value);
                      setFieldErrors((prev) => ({ ...prev, resetEmail: '' }));
                      if (resetAlert.message) {
                        setResetAlert({ type: '', message: '' });
                      }
                    }}
                    dir="ltr"
                    autoComplete="email"
                  />
                  <Mail
                    className={`absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 transition-colors ${
                      fieldErrors.resetEmail ? 'text-red-400' : 'text-slate-400 group-focus-within:text-[#3B82F6]'
                    }`}
                    size={20}
                  />
                </div>
                {fieldErrors.resetEmail && (
                  <p className="mt-2 px-2 text-xs font-bold text-red-600">{fieldErrors.resetEmail}</p>
                )}
              </div>

              <button
                onClick={handleSendResetEmail}
                disabled={isResetting || !resetEmail}
                className="w-full py-4 rounded-2xl bg-black text-white font-black shadow-lg shadow-black/20 hover:bg-slate-800 transition-all disabled:opacity-50 flex justify-center items-center text-lg"
              >
                {isResetting ? <Loader2 className="animate-spin" size={24} /> : tt('إرسال التعليمات', 'Send Instructions')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;