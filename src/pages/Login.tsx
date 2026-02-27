import React, { useMemo, useState } from 'react';
import { Facebook, Eye, EyeOff, Mail, Lock, User as UserIcon } from 'lucide-react';
import Button from '../components/Button';
import * as ReactRouterDOM from 'react-router-dom';
import { useCart } from '../App';
import { db } from '../services/storage';
import { User } from '../types';
import SEO from '../components/SEO';

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

  const title = useMemo(
    () => (isLoginMode ? t('login') : t('createAccount')),
    [isLoginMode, t]
  );

  const desc = useMemo(
    () => (isLoginMode ? t('loginDesc') : t('registerDesc')),
    [isLoginMode, t]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: value }));
  };

  const getErrorMessage = (error: any) => {
    const code = error?.code;

    if (code === 'auth/email-already-in-use') return t('emailInUse') ?? 'Email is already registered.';
    if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password')
      return t('invalidCredentials') ?? 'Invalid email or password.';
    if (code === 'auth/weak-password') return t('weakPassword') ?? 'Password should be at least 6 characters.';

    // fallback (لا تعرض رسالة تقنية طويلة)
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
          orders: []
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

  const handleForgotPassword = () => {
    // Placeholder محترم بدل # (توصله لاحقًا بـ Firebase resetPassword)
    showToast(t('forgotPasswordHint') ?? 'Please contact support or use password reset (coming soon).', 'info');
  };

  return (
    <div className="min-h-[calc(100vh-80px)] bg-slate-50 flex items-center justify-center p-4">
      <SEO title={title} description={desc} />

      <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-slate-100">
        <div className="w-full p-8 md:p-10">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-heading font-bold text-slate-900 mb-2">{isLoginMode ? t('welcomeBack') : t('createAccount')}</h2>
            <p className="text-slate-500 text-sm">{desc}</p>
          </div>

          {/* Mode Switch */}
          <div className="flex gap-2 mb-8 bg-slate-100 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => setIsLoginMode(true)}
              className={`flex-1 py-2 text-sm font-bold rounded-xl transition-all ${
                isLoginMode ? 'bg-white shadow-sm text-secondary-DEFAULT' : 'text-slate-500 hover:text-slate-700'
              }`}
              disabled={isLoading}
            >
              {t('login')}
            </button>
            <button
              type="button"
              onClick={() => setIsLoginMode(false)}
              className={`flex-1 py-2 text-sm font-bold rounded-xl transition-all ${
                !isLoginMode ? 'bg-white shadow-sm text-secondary-DEFAULT' : 'text-slate-500 hover:text-slate-700'
              }`}
              disabled={isLoading}
            >
              {t('createAccount')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLoginMode && (
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">{t('fullName')}</label>
                <div className="relative">
                  <input
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    type="text"
                    className="w-full pl-12 pr-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-secondary-light outline-none"
                    placeholder={t('fullName')}
                    disabled={isLoading}
                    autoComplete="name"
                  />
                  <UserIcon className="absolute left-4 top-3.5 text-slate-400" size={20} />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">{t('emailPlaceholder')}</label>
              <div className="relative">
                <input
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  type="email"
                  className="w-full pl-12 pr-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-secondary-light outline-none"
                  placeholder="example@email.com"
                  disabled={isLoading}
                  autoComplete="email"
                />
                <Mail className="absolute left-4 top-3.5 text-slate-400" size={20} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">{t('password')}</label>
              <div className="relative">
                <input
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  type={showPass ? 'text' : 'password'}
                  className="w-full pl-12 pr-12 py-3 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-secondary-light outline-none"
                  placeholder="••••••••"
                  disabled={isLoading}
                  autoComplete={isLoginMode ? 'current-password' : 'new-password'}
                />
                <Lock className="absolute left-4 top-3.5 text-slate-400" size={20} />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="absolute right-3 top-2.5 p-2 rounded-xl hover:bg-slate-100 text-slate-500"
                  aria-label="toggle password"
                  disabled={isLoading}
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {isLoginMode && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs font-bold text-secondary-DEFAULT hover:underline"
                  disabled={isLoading}
                >
                  {t('forgotPassword')}
                </button>
              </div>
            )}

            <Button type="submit" className="w-full shadow-lg shadow-secondary-light/30" isLoading={isLoading}>
              {isLoginMode ? t('login') : t('createAccount')}
            </Button>
          </form>

          {/* Divider */}
          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-slate-500">{t('orContinueWith')}</span>
            </div>
          </div>

          {/* Social Buttons (UI ready) */}
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              className="flex items-center justify-center gap-2 py-2.5 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors text-sm font-bold text-slate-700"
              disabled={isLoading}
            >
              Google
            </button>

            <button
              type="button"
              className="flex items-center justify-center gap-2 py-2.5 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors text-sm font-bold text-slate-700"
              disabled={isLoading}
            >
              <Facebook size={20} className="text-blue-600" />
              Facebook
            </button>
          </div>

          <p className="text-xs text-slate-400 mt-6 text-center">
            {t('privacyHint') ?? 'By continuing, you agree to our privacy policy and terms.'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;