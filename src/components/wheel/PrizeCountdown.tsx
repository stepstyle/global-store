// Time left to use a won prize (60 minutes from the spin; a second-order discount: 5 days from the first delivery). Display only — the Worker decides validity
// from its own stored end time. Ticks every second by itself (the page around it does not re-render); calls onExpire
// ONCE when the time is up, so the page can stop applying the prize and show the "expired" message.
import React, { useEffect, useRef, useState } from 'react';
import { fmtRemaining, remainingMs } from '../../services/wheel';

const DAY = 86_400_000;

export default function PrizeCountdown({ expiresAt, isAR, onExpire, testId = 'prize-countdown', className = '', urgentMs = 5 * 60_000 }: {
  expiresAt: string | null; isAR: boolean; onExpire?: () => void; testId?: string; className?: string; urgentMs?: number;
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
      {isAR ? `الوقت المتبقي لاستخدام الجائزة: ` : 'Time left to use the prize: '}
      {left >= DAY ? <span>{isAR ? `${Math.floor(left / DAY)} يوم و ` : `${Math.floor(left / DAY)}d `}<span dir="ltr">{fmtRemaining(left % DAY)}</span></span> : <span dir="ltr">{fmtRemaining(left)}</span>}
    </span>
  );
}
