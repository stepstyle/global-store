// RETIRED Vercel function. It used to forward ANY request body to the old order Worker with the secret
// WORKER_AUTH_TOKEN header and an open CORS grant ("*"). The storefront never called it (Checkout talks to the order
// Worker directly), so it is closed: nothing is forwarded and no secret is used.
export default function handler(req, res) {
  return res.status(410).json({ ok: false, code: 'GONE', message: 'This endpoint is retired. Orders are sent to the order Worker.' });
}
