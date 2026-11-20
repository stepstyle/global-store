// Time left to use a won prize (60 minutes from the spin; a second-order discount: 5 days from the first delivery). Display only — the Worker decides validity
// from its own stored end time. Ticks every second by itself (the page around it does not re-render); calls onExpire
// ONCE when the time is up, so the page can stop applying the prize and show the "expired" message.
import React, { useEffect, useRef, useState } from 'react';
import { fmtRemaining, remainingMs } from '../../services/wheel';

export default function PrizeCountdown({ expiresAt, isAR, onExpire, testId = 'prize-countdown', className = '', urgentMs = 5 * 60_000, label }: {
  expiresAt: string | null; isAR: boolean; onExpire?: () => void; testId?: string; className?: string; urgentMs?: number; label?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  const left = remainingMs(expiresAt, now);
  useEffect(() => { fired.current = false; }, [expiresAt]);
  useEffect(() => {
    if (left === null) return undefined;
    if (left <= 0) {
      if (!fired.current) { fired.current = true; onExpire?.(); }
      return undefined;
    }
    const t = window.setTimeout(() => setNow(Date.now()), Math.min(1000, left));
    return () => window.clearTimeout(t);
  }, [left, onExpire]);
  if (left === null || left <= 0) return null;
  // shown in red near the end (5 minutes of a 60-minute prize; the caller passes 12 hours for a 5-day one)
  const urgent = left < urgentMs;
  return (
    <span className={`inline-flex items-center gap-1 font-black tabular-nums ${urgent ? 'text-red-700' : 'text-ink-800'} ${className}`} role="timer" aria-live="off" data-testid={testId} data-remaining-ms={left}>
      <span aria-hidden="true">⏳</span>
      {label ?? (isAR ? `الوقت المتبقي لاستخدام الجائزة: ` : 'Time left to use the prize: ')}
      {(() => {
        // round UP to the second FIRST, then split into days (never "6 days 24:00:00")
        const secs = Math.ceil(left / 1000);
        const days = Math.floor(secs / 86_400);
        const r = secs % 86_400;
        const p = (n: number) => String(n).padStart(2, '0');
        // with days, always hh:mm:ss (never "7 days 00:00", which reads like minutes)
        const hms = `${p(Math.floor(r / 3600))}:${p(Math.floor((r % 3600) / 60))}:${p(r % 60)}`;
        return days > 0
          ? <span>{isAR ? `${days} يوم و ` : `${days}d `}<span dir="ltr">{hms}</span></span>
          : <span dir="ltr">{fmtRemaining(left)}</span>;
      })()}
    </span>
  );
}
