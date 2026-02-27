import React, { useEffect } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { ToastMessage } from '../types';

interface ToastProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(toast.id);
    }, 4000);

    return () => clearTimeout(timer);
  }, [toast, onClose]);

  const icons = {
    success: <CheckCircle className="text-green-500" size={20} />,
    error: <XCircle className="text-red-500" size={20} />,
    info: <Info className="text-blue-500" size={20} />,
  };

  const bgColors = {
    success: 'bg-green-50 border-green-200',
    error: 'bg-red-50 border-red-200',
    info: 'bg-blue-50 border-blue-200',
  };

  return (
    <div className={`flex items-center gap-3 p-4 rounded-xl border shadow-lg max-w-sm w-full animate-in slide-in-from-bottom-5 fade-in duration-300 ${bgColors[toast.type]}`}>
      <div className="shrink-0">{icons[toast.type]}</div>
      <p className="flex-1 text-sm font-medium text-slate-800">{toast.message}</p>
      <button 
        onClick={() => onClose(toast.id)}
        className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
};

export default Toast;