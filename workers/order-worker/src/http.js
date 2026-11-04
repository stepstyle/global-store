// HTTP helpers: CORS allow-list, JSON responses, bounded body reading, constant-time compare.

export function corsHeaders(request, cfg) {
  const origin = request.headers.get('origin');
  const h = { vary: 'Origin' };
  if (origin && cfg.allowedOrigins.includes(origin)) {
    h['access-control-allow-origin'] = origin;
    h['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    // authorization = Firebase ID token for signed-in customers. CORS only lets the allow-listed site SEND it;
    // it is never what authenticates: the token itself is verified (src/auth.js) on every request.
    // x-tracking-key: the customer's order tracking key (GET /orders/:id/summary) — a header, never a URL part
    h['access-control-allow-headers'] = 'content-type, authorization, x-tracking-key, x-worker-auth';
    h['access-control-max-age'] = '600';
  }
  return h;
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

export async function readJsonBody(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) return { error: 413 };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return { error: 413 };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: 400 };
  }
}

export function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a ?? ''));
  const y = new TextEncoder().encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function hasValidWorkerAuth(request, cfg) {
  if (!cfg.workerAuthToken || cfg.workerAuthToken.length < 16) return false;
  return timingSafeEqual(request.headers.get('x-worker-auth') || '', cfg.workerAuthToken);
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

export function log(event, data = {}) {
  // Never log personal data: callers pass ids / codes only.
  console.log(JSON.stringify({ event, ...data }));
}
