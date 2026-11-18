// src/config/sandboxNetGuard.ts
// Imported FIRST by main.tsx. In a sandbox build it installs a network allow-list before any other module runs:
// only same-origin requests (the preview's own pages and /api, which refuse in sandbox) may leave the page.
// Every other fetch / XHR / sendBeacon / WebSocket / window.open target is refused. This catches write paths
// that the per-call guards might have missed. In the production build this whole module is a no-op.
// local-test (Emulator / Staging runs, never on Vercel) additionally allows loopback (127.0.0.1 / localhost: the
// emulators, the local Worker and the staging proxy) and, for the Staging target only, Google's Firebase APIs.
import { IS_LIVE, IS_LOCAL_TEST } from './deployEnv';

const BLOCKED_MSG = '[sandbox] blocked outbound request';
const STAGING_TARGET = IS_LOCAL_TEST && import.meta.env.VITE_FIREBASE_TARGET === 'staging';
const STAGING_HOSTS = new Set(['firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com']);

const isSameOrigin = (raw: unknown): boolean => {
  try {
    const u = new URL(String(raw), window.location.href);
    if (u.origin === window.location.origin) return true;
    if (!IS_LOCAL_TEST) return false;
    if ((u.hostname === '127.0.0.1' || u.hostname === 'localhost') && (u.protocol === 'http:' || u.protocol === 'ws:')) return true;
    return STAGING_TARGET && u.protocol === 'https:' && STAGING_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
};

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

const showBanner = () => {
  const mount = () => {
    if (document.getElementById('sandbox-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'sandbox-banner';
    bar.setAttribute('role', 'status');
    bar.textContent = IS_LOCAL_TEST
      ? 'نسخة اختبار محلية (Emulator / Staging) — لا اتصال بالمتجر الحقيقي. Local test build: no production services.'
      : 'نسخة اختبار — لا تُنشأ طلبات حقيقية ولا تُرسل رسائل. Test build: no real orders or messages.';
    // A strip at the TOP, in the page flow (not fixed): it is seen on load but never covers the site's own bottom
    // controls (shopping assistant, checkout bar, cookie notice). Sandbox builds only — never in production.
    bar.style.cssText =
      'position:relative;z-index:2147483647;background:#A4262C;color:#fff;' +
      'font:600 12px/1.4 system-ui,sans-serif;text-align:center;padding:4px 12px;pointer-events:none';
    document.body.prepend(bar);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
};

export const installSandboxNetGuard = (): void => {
  if (IS_LIVE || typeof window === 'undefined') return;
  const w = window as any;
  if (w.__sandboxNetGuard) return;
  w.__sandboxNetGuard = true;
  document.documentElement.setAttribute('data-deploy-env', IS_LOCAL_TEST ? 'local-test' : 'sandbox');

  const origFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (!isSameOrigin(url)) {
      console.warn(BLOCKED_MSG, 'fetch', url);
      return Promise.reject(new TypeError(`${BLOCKED_MSG}: ${url}`));
    }
    return origFetch(input as any, init);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
    if (!isSameOrigin(url)) {
      console.warn(BLOCKED_MSG, 'xhr', String(url));
      throw new TypeError(`${BLOCKED_MSG}: ${String(url)}`);
    }
    return (origOpen as any).call(this, method, url, ...rest);
  } as any;

  if (navigator.sendBeacon) {
    const origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      if (!isSameOrigin(url)) {
        console.warn(BLOCKED_MSG, 'beacon', String(url));
        return false;
      }
      return origBeacon(url, data);
    };
  }

  if (typeof WebSocket !== 'undefined') {
    const OrigWS = WebSocket;
    // same host only (keeps the local Vite dev-server HMR socket working); local-test: loopback too
    w.WebSocket = function (url: string | URL, protocols?: string | string[]) {
      let sameHost = false;
      try {
        const u = new URL(String(url), window.location.href);
        sameHost = u.host === window.location.host || (IS_LOCAL_TEST && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'));
      } catch {}
      if (!sameHost) {
        console.warn(BLOCKED_MSG, 'websocket', String(url));
        throw new TypeError(`${BLOCKED_MSG}: ${String(url)}`);
      }
      return new OrigWS(url, protocols);
    } as any;
    w.WebSocket.prototype = OrigWS.prototype;
  }

  const origWinOpen = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => {
    if (url !== undefined && url !== '' && !isSameOrigin(url)) {
      console.warn(BLOCKED_MSG, 'window.open', String(url));
      window.alert('نسخة اختبار: لن يُفتح الرابط الخارجي.\n' + String(url).slice(0, 300));
      return null;
    }
    return origWinOpen(url as any, target, features);
  };

  // tracking stubs (index.html tags are stripped from sandbox builds; these keep stray calls harmless)
  w.gtag = () => {};
  w.fbq = () => {};

  showBanner();
};

installSandboxNetGuard();
