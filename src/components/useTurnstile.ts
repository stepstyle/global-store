// React binding of src/services/turnstile.ts for the checkout. Loads the official script only when a site key is
// configured AND the widget is shown (payment step); otherwise status 'disabled' and getToken() is never offered.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createTurnstileController, loadTurnstile, type TurnstileController, type TurnstileStatus } from '../services/turnstile';

export function useTurnstile(siteKey: string, active: boolean, language = 'ar') {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ctlRef = useRef<TurnstileController | null>(null);
  const [status, setStatus] = useState<TurnstileStatus>(siteKey ? 'idle' : 'disabled');

  useEffect(() => {
    if (!siteKey || !active || !containerRef.current) return undefined;
    let alive = true;
    setStatus('loading');
    loadTurnstile()
      .then((api) => {
        if (!alive || !containerRef.current) return;
        ctlRef.current = createTurnstileController({ api, container: containerRef.current, siteKey, language, onStatus: (s) => alive && setStatus(s) });
      })
      .catch(() => alive && setStatus('error'));
    return () => {
      alive = false;
      ctlRef.current?.destroy();
      ctlRef.current = null;
    };
  }, [siteKey, active, language]);

  /** a fresh single-use token, or null (not configured / not ready / failed) — asked before EVERY send */
  const getToken = useCallback(async () => (ctlRef.current ? ctlRef.current.getToken() : null), []);
  return { containerRef, status, getToken, enabled: !!siteKey };
}
