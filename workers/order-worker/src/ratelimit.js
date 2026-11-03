// Rate limiting. Uses a Cloudflare Rate Limiting binding when one is configured
// (CREATE_RATE_LIMITER / STATUS_RATE_LIMITER); otherwise a best-effort per-isolate
// fixed window (good enough for local tests; NOT a global limit in production).

const buckets = new Map();

export async function allowRequest(env, cfg, kind, key) {
  const binding = kind === 'create' ? env?.CREATE_RATE_LIMITER : env?.STATUS_RATE_LIMITER;
  if (binding && typeof binding.limit === 'function') {
    const { success } = await binding.limit({ key: `${kind}:${key}` });
    return success;
  }

  const limit = kind === 'create' ? cfg.rateLimitCreatePerMin : cfg.rateLimitStatusPerMin;
  if (!limit) return true;

  const now = Date.now();
  const k = `${kind}:${key}`;
  let b = buckets.get(k);
  if (!b || now - b.start >= 60_000) {
    b = { start: now, count: 0 };
    buckets.set(k, b);
  }
  b.count += 1;

  if (buckets.size > 10_000) {
    for (const [bk, bv] of buckets) if (now - bv.start >= 60_000) buckets.delete(bk);
  }
  return b.count <= limit;
}

export function _resetRateLimitsForTests() {
  buckets.clear();
}
