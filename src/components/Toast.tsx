import React, { useEffect } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { ToastMessage } from '../types';

interface ToastProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
}

// errors stay longer so the customer / admin can read them
const DURATION_MS: Record<ToastMessage['type'], number> = { success: 3500, info: 4000, error: 7000 };

const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
  useEffect(() => {
    const timer = window.setTimeout(() => onClose(toast.id), DURATION_MS[toast.type] ?? 4000);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.type, onClose]);

  const icons = {
    success: <CheckCircle className="text-emerald-500" size={20} strokeWidth={2.5} />,
    error: <XCircle className="text-red-500" size={20} strokeWidth={2.5} />,
    info: <Info className="text-sky-500" size={20} strokeWidth={2.5} />,
  };

  const iconBg = {
    success: 'bg-emerald-50',
    error: 'bg-red-50',
    info: 'bg-sky-50',
  };

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      data-toast-type={toast.type}
      className="group pointer-events-auto flex items-center gap-3.5 p-3 sm:p-4 rounded-2xl bg-white border border-slate-100 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] max-w-sm w-full animate-in slide-in-from-top-5 zoom-in-95 fade-in duration-300"
    >
      {/* أيقونة الحالة */}
      <div className={`shrink-0 flex items-center justify-center w-10 h-10 rounded-xl transition-colors ${iconBg[toast.type]}`}>
        {icons[toast.type]}
      </div>

      {/* نص الإشعار */}
      <p className="flex-1 text-sm font-bold text-slate-800 leading-relaxed">
        {toast.message}
      </p>

      {/* زر الإغلاق */}
      <button
        type="button"
        onClick={() => onClose(toast.id)}
        className="shrink-0 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-slate-100"
        aria-label="إغلاق"
      >
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
};

/** Fixed stack under the header; above page content and the mobile checkout bar. */
export const ToastContainer: React.FC<{ toasts: ToastMessage[]; onClose: (id: string) => void }> = ({ toasts, onClose }) => (
  <div
    aria-live="polite"
    data-toast-container=""
    className="pointer-events-none fixed inset-x-0 top-20 z-[1000] flex flex-col items-center gap-2 px-4"
  >
    {toasts.map((t) => (
      <Toast key={t.id} toast={t} onClose={onClose} />
    ))}
  </div>
);

export default Toast;
