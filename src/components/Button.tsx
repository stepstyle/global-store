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

  // ✅ قاعدة احترافية: زر داخل form لا يكون submit إلا إذا صرّحت
  const buttonType = type ?? 'button';

  const base =
    'inline-flex items-center justify-center rounded-xl font-bold select-none ' +
    'transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-200 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary-DEFAULT focus-visible:ring-offset-2 ' +
    'disabled:opacity-60 disabled:cursor-not-allowed ' +
    // ✅ لا تتحرك أزرار disabled/loading
    (isDisabled ? 'transform-none ' : 'active:scale-[0.98] ');

  const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
    // ✅ Primary: تدرّج مطابق لثيمك + hover أنعم (بدون أزرق عشوائي)
    primary:
      'bg-gradient-to-r from-primary-DEFAULT to-secondary-DEFAULT text-slate-900 ' +
      'shadow-lg hover:shadow-xl ' +
      'hover:brightness-[1.03] ',

    // ✅ Secondary: لون واحد + hover أغمق بسيط
    secondary:
      'bg-primary-DEFAULT text-slate-900 shadow-md hover:shadow-lg ' +
      'hover:brightness-95 ',

    // ✅ Outline: إطار + hover خلفية خفيفة بنفس لون الثيم
    outline:
      'border-2 border-secondary-DEFAULT text-secondary-DEFAULT bg-transparent ' +
      'hover:bg-secondary-light/30 hover:border-secondary-dark hover:text-secondary-dark ',

    // ✅ Ghost: شفاف + hover خفيف
    ghost:
      'text-slate-700 bg-transparent hover:bg-slate-100 hover:text-slate-900 ',
  };

  const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
    sm: 'px-3.5 py-2 text-sm',
    md: 'px-6 py-3 text-base',
    lg: 'px-8 py-4 text-lg',
  };

  // ✅ يمنع تغيّر عرض الزر أثناء التحميل
  const content = (
    <span className="inline-flex items-center justify-center gap-2">
      {isLoading && (
        <svg
          className="animate-spin h-5 w-5"
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

      <span className={isLoading ? 'opacity-90' : ''}>
        {isLoading ? 'جاري التحميل...' : children}
      </span>
    </span>
  );

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
      {content}
    </button>
  );
};

export default Button;