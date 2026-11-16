// RETIRED Vercel function. It used to forward ANY request body to the old order Worker with the secret
// WORKER_AUTH_TOKEN header and an open CORS grant ("*"). The storefront never called it (Checkout talks to the order
// Worker directly), so it is closed: nothing is forwarded and no secret is used.
export default function handler(req, res) {
  // 🛡️ Deploy guard (fail-closed): outside Vercel production the answer stays 403 SANDBOX_DISABLED.
  if (process.env.VERCEL_ENV !== 'production') {
    res.setHeader('x-deploy-env', 'sandbox');
    res.setHeader('cache-control', 'no-store');
    return res.status(403).json({ ok: false, code: 'SANDBOX_DISABLED' });
  }
  res.setHeader('cache-control', 'no-store');
  return res.status(410).json({ ok: false, code: 'GONE', message: 'This endpoint is retired. Orders are sent to the order Worker.' });
}
