// The product of an ad / shared link (#/product/<id>), asked for by index.html itself, while the app's script is still
// downloading (measured on a slow phone: the app's own request could only start ~3 s after the click and then queued
// behind the fonts; the document is ~3–7 KB). The app takes this answer over ONCE (src/services/productEarly.ts), checks
// it the same way, and falls back to its own request when it is missing, failed, or for another project.
//
// Production builds only (the store's public Firebase project + its public web API key, the same values the published
// script carries); never in a sandbox / local-test build. A plain GET, no credentials = no CORS preflight.
// Exactly the same id rule and address as productEarly.ts (unit-tested together: tests/unit/productEarly.test.mjs).

const ID_SRC = '[A-Za-z0-9_-]{1,128}';

/** the public identifiers in src/services/firebase.ts ("Option B" inline config), read like scripts/check-guard.mjs */
export function publicFirebaseIds(firebaseSource) {
  const src = String(firebaseSource || '');
  const at = src.indexOf('Option B');
  if (at < 0) return null;
  const block = src.slice(at);
  const pick = (k) => (block.match(new RegExp(`\\b${k}\\s*:\\s*['"]([^'"]+)['"]`)) || [])[1] || '';
  const apiKey = pick('apiKey');
  const projectId = pick('projectId');
  return /^[A-Za-z0-9_-]{10,100}$/.test(apiKey) && /^[a-z0-9-]{1,64}$/.test(projectId) ? { apiKey, projectId } : null;
}

export function productEarlyScript({ deployEnv, ids }) {
  if (deployEnv !== 'production' || !ids) return '';
  const { apiKey, projectId } = ids;
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(apiKey) || !/^[a-z0-9-]{1,64}$/.test(projectId)) return '';
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/products/`;
  return '<script>try{(function(){'
    + `var m=/^#\\/product\\/([^/?#]+)(?:[/?].*)?$/.exec(location.hash||'');if(!m)return;var id;try{id=decodeURIComponent(m[1])}catch(e){return}`
    + `if(!/^${ID_SRC}$/.test(id))return;`
    + `window.__productEarly={id:id,projectId:${JSON.stringify(projectId)},r:fetch(${JSON.stringify(base)}+id+${JSON.stringify(`?key=${apiKey}`)},{credentials:'omit',cache:'no-store'})`
    + `.then(function(r){return r.status===200?r.json():null}).catch(function(){return null})}`
    + '})()}catch(e){}</script>';
}
