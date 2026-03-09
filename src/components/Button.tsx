import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  fullWidth?: boolean;
}

const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  fullWidth = false,
  className = '',
  type,
  disabled,
  ...props
}) => {
  const isDisabled = Boolean(disabled || isLoading);

  // ✅ قاعدة احترافية: زر داخل form لا يكون submit إلا إذا صرّحت بذلك
  const buttonType = type ?? 'button';

  const base =
    'inline-flex items-center justify-center font-extrabold select-none rounded-2xl ' +
    'transition-all duration-300 ' +
    'focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-400/30 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none ' +
    // ✅ لا تتحرك أزرار disabled/loading عند النقر
    (isDisabled ? 'transform-none ' : 'active:scale-[0.98] ');

  const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
    // ✅ Primary: أسود فخم مع ظل ناعم
    primary:
      'bg-black text-white shadow-lg shadow-black/20 hover:bg-slate-800 hover:shadow-xl hover:shadow-black/30',

    // ✅ Secondary: أزرق فاتح جذاب للإجراءات المهمة (CTA)
    secondary:
      'bg-sky-400 text-white shadow-lg shadow-sky-400/30 hover:bg-sky-500 hover:shadow-xl hover:shadow-sky-400/40',

    // ✅ Outline: إطار رمادي أنيق مع خلفية فاتحة عند التمرير
    outline:
      'border-2 border-slate-200 text-slate-700 bg-transparent hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900',

    // ✅ Ghost: شفاف بالكامل بدون إطار
    ghost:
      'text-slate-600 bg-transparent hover:bg-slate-100 hover:text-slate-900',
  };

  const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-6 py-3.5 text-base',
    lg: 'px-8 py-4 text-lg',
  };

  return (
    <button
      type={buttonType}
      className={[
        base,
        variants[variant],
        sizes[size],
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      {...props}
    >
      <span className="inline-flex items-center justify-center gap-2">
        {isLoading && (
          <svg
            className="animate-spin h-5 w-5 text-current shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        <span className={`truncate ${isLoading ? 'opacity-90' : ''}`}>
          {children}
        </span>
      </span>
    </button>
  );
};

export default Button;