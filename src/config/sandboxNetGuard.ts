// src/config/sandboxNetGuard.ts
// Imported FIRST by main.tsx. In a sandbox build it installs a network allow-list before any other module runs:
// only same-origin requests (the preview's own pages and /api, which refuse in sandbox) may leave the page.
// Every other fetch / XHR / sendBeacon / WebSocket / window.open target is refused. This catches write paths
// that the per-call guards might have missed. In the production build this whole module is a no-op.
import { IS_LIVE } from './deployEnv';

const BLOCKED_MSG = '[sandbox] blocked outbound request';

const isSameOrigin = (raw: unknown): boolean => {
  try {
    const u = new URL(String(raw), window.location.href);
    return u.origin === window.location.origin;
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
    bar.textContent = 'نسخة اختبار — لا تُنشأ طلبات حقيقية ولا تُرسل رسائل. Test build: no real orders or messages.';
    bar.style.cssText =
      'position:fixed;inset-inline:0;bottom:0;z-index:2147483647;background:#A4262C;color:#fff;' +
      'font:600 13px/1.4 system-ui,sans-serif;text-align:center;padding:6px 12px;pointer-events:none';
    document.body.appendChild(bar);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
};

export const installSandboxNetGuard = (): void => {
  if (IS_LIVE || typeof window === 'undefined') return;
  const w = window as any;
  if (w.__sandboxNetGuard) return;
  w.__sandboxNetGuard = true;
  document.documentElement.setAttribute('data-deploy-env', 'sandbox');

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
    // same host only (keeps the local Vite dev-server HMR socket working)
    w.WebSocket = function (url: string | URL, protocols?: string | string[]) {
      let sameHost = false;
      try { sameHost = new URL(String(url), window.location.href).host === window.location.host; } catch {}
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
