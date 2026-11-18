// src/services/tracking.ts
// Google Analytics + Meta Pixel, loaded ONLY after the visitor accepts cookies (see CookieBanner).
// Nothing here runs at page load: no script tag and no request to Google or Facebook until loadTracking() is called.
// Same IDs and the same calls the inline snippets in index.html made before (one page view on load).

const GA_MEASUREMENT_ID = 'G-E4P313LDJ0';
const META_PIXEL_ID = '406363479141487';

let loaded = false;

export function loadTracking(): void {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  const w = window as any;

  // Google Analytics (gtag.js)
  w.dataLayer = w.dataLayer || [];
  w.gtag = w.gtag || function gtag() { w.dataLayer.push(arguments); };
  w.gtag('js', new Date());
  w.gtag('config', GA_MEASUREMENT_ID);
  const ga = document.createElement('script');
  ga.async = true;
  ga.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(ga);

  // Meta Pixel (same bootstrap as the official snippet)
  if (!w.fbq) {
    const n: any = (w.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    });
    if (!w._fbq) w._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    const fb = document.createElement('script');
    fb.async = true;
    fb.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(fb);
  }
  w.fbq('init', META_PIXEL_ID);
  w.fbq('track', 'PageView');
}
