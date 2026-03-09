// src/pages/Login.tsx
import React, { useMemo, useState } from 'react';
import { Facebook, Eye, EyeOff, Mail, Lock, User as UserIcon, Loader2 } from 'lucide-react';
import * as ReactRouterDOM from 'react-router-dom';

import SEO from '../components/SEO';
import { useCart } from '../App';
import { db } from '../services/storage';
import { User } from '../types';

import { sendResetEmail } from '../services/passwordReset';
import { signInWithGoogle } from '../services/authProviders';

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

  const [formData, setFormData] = useState({ name: '', email: '', password: '' });

  const title = useMemo(() => (isLoginMode ? t('login') : t('createAccount')), [isLoginMode, t]);
  const desc = useMemo(() => (isLoginMode ? t('loginDesc') : t('registerDesc')), [isLoginMode, t]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: value }));
  };

  const getErrorMessage = (error: any) => {
    const code = error?.code;

    if (code === 'auth/email-already-in-use') return t('emailInUse') ?? 'Email is already registered.';
    if (
      code === 'auth/invalid-credential' ||
      code === 'auth/user-not-found' ||
      code === 'auth/wrong-password'
    ) {
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

  // ✅ Forgot password (real email via Firebase)
  const handleForgotPassword = async () => {
    const email = safeText(formData.email);

    if (!email || !isValidEmail(email)) {
      showToast(t('invalidEmail') ?? 'Please enter a valid email address first.', 'error');
      return;
    }

    if (isLoading) return;
    setIsLoading(true);

    try {
      await sendResetEmail(email);
      showToast(
        language === 'ar'
          ? 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني ✅'
          : 'Password reset link sent to your email ✅',
        'success'
      );
    } catch (error: any) {
      const code = error?.code;

      if (code === 'auth/user-not-found') {
        showToast(language === 'ar' ? 'هذا البريد غير مسجّل لدينا.' : 'This email is not registered.', 'error');
        return;
      }

      showToast(
        language === 'ar'
          ? 'صار خطأ أثناء إرسال الإيميل. جرّب مرة ثانية.'
          : 'Failed to send reset email. Please try again.',
        'error'
      );
      console.error('reset error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // ✅ Google login (real)
  const handleGoogleLogin = async () => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      const u = await signInWithGoogle();

      const user: User = {
        id: u.uid,
        name: u.displayName || (language === 'ar' ? 'مستخدم جوجل' : 'Google User'),
        email: u.email || '',
        password: '',
        role: 'customer',
        orders: [],
      };

      login(user);
      showToast(t('loginSuccess') ?? 'Logged in successfully.', 'success');
      navigate('/');
    } catch (err: any) {
      console.error('google login error:', err);
      showToast(err?.message || (t('genericError') ?? 'An error occurred.'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-80px)] bg-slate-50 flex items-center justify-center p-4 py-12">
      <SEO title={title} description={desc} />

      <div className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/50 w-full max-w-md overflow-hidden flex flex-col border border-slate-100 animate-in fade-in zoom-in-95 duration-500">
        <div className="w-full p-8 md:p-10">
          <div className="text-center mb-8">
            <h2 className="text-2xl lg:text-3xl font-heading font-black text-slate-900 mb-2 tracking-tight">
              {isLoginMode ? t('welcomeBack') : t('createAccount')}
            </h2>
            <p className="text-slate-500 text-sm font-medium">{desc}</p>
          </div>

          {/* Mode Switch Tabs */}
          <div className="flex gap-2 mb-8 bg-slate-100 p-1.5 rounded-2xl">
            <button
              type="button"
              onClick={() => setIsLoginMode(true)}
              className={`flex-1 py-2.5 text-sm rounded-xl transition-all duration-300 ${
                isLoginMode 
                  ? 'bg-white shadow-sm text-slate-900 font-extrabold' 
                  : 'text-slate-500 font-bold hover:text-slate-800 hover:bg-slate-200/50'
              }`}
              disabled={isLoading}
            >
              {t('login')}
            </button>
            <button
              type="button"
              onClick={() => setIsLoginMode(false)}
              className={`flex-1 py-2.5 text-sm rounded-xl transition-all duration-300 ${
                !isLoginMode 
                  ? 'bg-white shadow-sm text-slate-900 font-extrabold' 
                  : 'text-slate-500 font-bold hover:text-slate-800 hover:bg-slate-200/50'
              }`}
              disabled={isLoading}
            >
              {t('createAccount')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4.5">
            {!isLoginMode && (
              <div className="mb-4">
                <label className="block text-sm font-bold text-slate-700 mb-1.5">{t('fullName')}</label>
                <div className="relative">
                  <input
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    type="text"
                    className="w-full ltr:pl-12 ltr:pr-4 rtl:pr-12 rtl:pl-4 py-3.5 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400 outline-none transition-all font-medium text-slate-900"
                    placeholder={t('fullName')}
                    disabled={isLoading}
                    autoComplete="name"
                  />
                  <UserIcon className="absolute ltr:left-4 rtl:right-4 top-4 text-slate-400" size={20} />
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-bold text-slate-700 mb-1.5">{t('emailPlaceholder')}</label>
              <div className="relative">
                <input
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  type="email"
                  className="w-full ltr:pl-12 ltr:pr-4 rtl:pr-12 rtl:pl-4 py-3.5 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400 outline-none transition-all font-medium text-slate-900"
                  placeholder="example@email.com"
                  disabled={isLoading}
                  autoComplete="email"
                />
                <Mail className="absolute ltr:left-4 rtl:right-4 top-4 text-slate-400" size={20} />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-bold text-slate-700 mb-1.5">{t('password')}</label>
              <div className="relative">
                <input
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  type={showPass ? 'text' : 'password'}
                  className="w-full ltr:pl-12 rtl:pr-12 ltr:pr-12 rtl:pl-12 py-3.5 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400 outline-none transition-all font-medium text-slate-900 tracking-wide"
                  placeholder="••••••••"
                  disabled={isLoading}
                  autoComplete={isLoginMode ? 'current-password' : 'new-password'}
                />
                <Lock className="absolute ltr:left-4 rtl:right-4 top-4 text-slate-400" size={20} />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="absolute ltr:right-3 rtl:left-3 top-2.5 p-1.5 rounded-xl hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label="toggle password"
                  disabled={isLoading}
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {isLoginMode && (
              <div className="flex justify-end mb-6">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs font-extrabold text-sky-500 hover:text-sky-600 hover:underline transition-colors"
                  disabled={isLoading}
                >
                  {t('forgotPassword')}
                </button>
              </div>
            )}

            {/* Main Submit Button - Sky Blue */}
            <button 
              type="submit" 
              disabled={isLoading}
              className="mt-6 w-full py-4 text-base font-extrabold rounded-2xl bg-sky-400 hover:bg-sky-500 text-white shadow-lg shadow-sky-400/30 flex justify-center items-center gap-2 transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading && <Loader2 size={18} className="animate-spin" />}
              {isLoginMode ? t('login') : t('createAccount')}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-slate-400 font-medium">{t('orContinueWith')}</span>
            </div>
          </div>

          {/* Social Buttons - Elegant Black/Outline */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="flex items-center justify-center gap-2 py-3 border-2 border-slate-100 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition-all text-sm font-bold text-slate-700"
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
              className="flex items-center justify-center gap-2 py-3 border-2 border-slate-100 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition-all text-sm font-bold text-slate-700"
              disabled={isLoading}
            >
              <Facebook size={18} className="text-[#1877F2]" fill="currentColor" stroke="none" />
              Facebook
            </button>
          </div>

          <p className="text-[11px] text-slate-400 mt-8 text-center font-medium px-4">
            {t('privacyHint') ?? 'By continuing, you agree to our privacy policy and terms.'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;