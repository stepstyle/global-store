// The prize wheel's campaign check, started from index.html (a few hundred bytes of inline script) while the app's
// code still downloads: on a phone opening a product straight from an ad, the popup no longer waits for the 270 KB main
// script before even asking the Worker. The app (src/services/wheel.ts prefetchWheelPublic) takes this answer as its
// first one; a failed / missing early request is asked again by the app as before.
//   - a plain GET, no header, no cookie: exactly the request the app makes (a "simple" CORS request, no preflight)
//   - only when the build shows the wheel AND talks to a backend: production (https Worker), or local-test against a
//     LOCAL Worker (loopback). Never a sandbox build (its network guard must see every request).
export function wheelEarlyScript({ wheelMode, deployEnv, workerUrl }) {
  if (wheelMode !== 'live' && wheelMode !== 'test') return '';
  const base = String(workerUrl || '').trim().replace(/\/+$/, '');
  const httpsOk = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*$/i.test(base);
  const loopOk = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*$/i.test(base);
  if (deployEnv === 'production' ? !httpsOk : deployEnv === 'local-test' ? !loopOk : true) return '';
  const url = JSON.stringify(`${base}/wheel/public`);
  return `<script>try{window.__wheelPublicEarly=fetch(${url}).catch(function(){return null})}catch(e){}</script>`;
}
