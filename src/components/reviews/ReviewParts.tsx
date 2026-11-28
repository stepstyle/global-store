// Small shared pieces of the verified-review UI: the star picker (a real radio group: keyboard + screen readers,
// 44 px touch targets), the read-only star row and the "شراء موثّق" badge.
import React, { useId } from 'react';
import { Star, BadgeCheck } from 'lucide-react';

const STAR_WORDS_AR = ['', 'سيئ', 'مقبول', 'جيد', 'جيد جدًا', 'ممتاز'];

export function StarPicker({ value, onChange, size = 34, label = 'تقييمك بالنجوم', disabled = false, testId }: {
  value: number; onChange: (n: number) => void; size?: number; label?: string; disabled?: boolean; testId?: string;
}) {
  const name = useId();
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div role="radiogroup" aria-label={label} className="flex items-center" dir="ltr" data-testid={testId}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={`relative inline-flex items-center justify-center w-11 h-11 rounded-xl ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-gold-50'} focus-within:ring-2 focus-within:ring-ink-900`}>
            <input type="radio" name={name} value={n} checked={value === n} disabled={disabled} onChange={() => onChange(n)} className="sr-only" aria-label={`${n} من 5 — ${STAR_WORDS_AR[n]}`} data-star={n} />
            <Star size={size} strokeWidth={1.6} className={`transition-transform ${n <= value ? 'fill-gold-400 text-gold-500' : 'text-paper-300'} ${!disabled && 'active:scale-90'}`} aria-hidden="true" />
          </label>
        ))}
      </div>
      <span className="text-[14px] font-bold text-ink-700 min-w-[4.5rem]" aria-live="polite">{value ? STAR_WORDS_AR[value] : 'اختر النجوم'}</span>
    </div>
  );
}

export function StarsRow({ value, size = 14, label }: { value: number; size?: number; label?: string }) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  return (
    <span className="inline-flex items-center" dir="ltr" role="img" aria-label={label ?? `${v.toFixed(1)} من 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} aria-hidden="true" className={n <= Math.round(v) ? 'fill-gold-400 text-gold-500' : 'text-paper-300'} />
      ))}
    </span>
  );
}

export function VerifiedBadge({ variant, compact = false }: { variant?: string; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 px-2 py-0.5 text-[12px] font-bold" data-testid="verified-badge">
      <BadgeCheck size={14} aria-hidden="true" className="text-emerald-600" />
      شراء موثّق
      {!compact && variant ? <span className="font-semibold text-emerald-700/90">· {variant}</span> : null}
    </span>
  );
}
