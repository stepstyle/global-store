// Time left to use a won prize (owner's rule: 60 minutes from the spin). Display only — the Worker decides validity
// from its own stored end time. Ticks every second by itself (the page around it does not re-render); calls onExpire
// ONCE when the time is up, so the page can stop applying the prize and show the "expired" message.
import React, { useEffect, useRef, useState } from 'react';
import { fmtRemaining, remainingMs } from '../../services/wheel';

export default function PrizeCountdown({ expiresAt, isAR, onExpire, testId = 'prize-countdown', className = '' }: {
  expiresAt: string | null; isAR: boolean; onExpire?: () => void; testId?: string; className?: string;
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
  const urgent = left < 5 * 60_000;
  return (
    <span className={`inline-flex items-center gap-1 font-black tabular-nums ${urgent ? 'text-red-700' : 'text-ink-800'} ${className}`} role="timer" aria-live="off" data-testid={testId} data-remaining-ms={left}>
      <span aria-hidden="true">⏳</span>
      {isAR ? `الوقت المتبقي لاستخدام الجائزة: ` : 'Time left to use the prize: '}
      <span dir="ltr">{fmtRemaining(left)}</span>
    </span>
  );
}
