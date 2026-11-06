// Vercel function: e-mail the customer when an ADMIN changes an order's status (AdminDashboard.tsx).
//
// Security (was an open relay: anyone could make the store's SendGrid send HTML to any address):
// - same-origin only (no CORS grant); POST only
// - caller must send "Authorization: Bearer <Firebase ID token>" of the PRODUCTION project, verified with Google's
//   public keys (workers/order-worker/src/auth.js — the same verifier as the order Worker)
// - the verified uid must be listed in NOTIFY_ADMIN_UIDS (comma-separated, not a secret). Unset/empty -> 503 for
//   everyone (fail-closed); SENDGRID_API_KEY unset -> 503
// - every value placed into the e-mail is validated and HTML-escaped; the tracking URL is URL-encoded
import { verifyFirebaseIdToken, bearerToken, AuthError, GOOGLE_SECURETOKEN_JWKS_URL } from '../workers/order-worker/src/auth.js';

export const PROJECT_ID = 'antastore1-82b50';
const ORDER_ID_RE = /^[A-Za-z0-9-]{4,64}$/;
const EMAIL_RE = /^[^\s@<>"'`]{1,64}@[^\s@<>"'`]{1,190}\.[A-Za-z]{2,24}$/;
const UID_RE = /^[A-Za-z0-9]{10,128}$/;
const esc = (s) => String(s).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]);

export function adminUids(env) {
  return new Set(String(env?.NOTIFY_ADMIN_UIDS || '').split(',').map((s) => s.trim()).filter((s) => UID_RE.test(s)));
}

const TEMPLATES = {
  accepted: { subject: 'تم تأكيد طلبك بنجاح! 🎉 - مكتبة دير شرف', title: 'تم تأكيد الطلب', color: '#0ea5e9',
    body: (n, id) => `مرحباً ${n}،<br><br>شكراً لتسوقك من مكتبة دير شرف العلمية. تم استلام طلبك رقم <strong>#${id}</strong> بنجاح وجاري تجهيزه حالياً بكل حب. 📦` },
  shipped: { subject: 'طلبك في الطريق إليك! 🚚 - مكتبة دير شرف', title: 'الطلب قيد الشحن', color: '#10b981',
    body: (n, id) => `مرحباً ${n}،<br><br>خبر سعيد! طلبك رقم <strong>#${id}</strong> تم تسليمه لشركة التوصيل وهو الآن في طريقه إليك. سيتواصل معك المندوب قريباً للتسليم. 🚀` },
};

export function buildEmail({ name, orderId, status }) {
  const t = TEMPLATES[status];
  const n = esc(String(name || 'عميلنا العزيز').slice(0, 120));
  const id = esc(orderId);
  const html = `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="background-color: ${t.color}; padding: 30px 20px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">${t.title}</h1>
        </div>
        <div style="padding: 30px 20px; background-color: #ffffff; color: #334155; line-height: 1.6; font-size: 16px;">
          <p>${t.body(n, id)}</p>
          <div style="text-align: center; margin-top: 30px;">
            <a href="https://dairsharaf.com/tracking?orderId=${encodeURIComponent(orderId)}" style="background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">تتبع حالة الطلب</a>
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 20px; text-align: center; color: #64748b; font-size: 14px; border-top: 1px solid #e2e8f0;">
          <p style="margin: 0;">مكتبة دير شرف العلمية - خيارك الأول للألعاب التعليمية والقرطاسية</p>
        </div>
      </div>
    `;
  return { subject: t.subject, html };
}

export async function handleNotify(req, res, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });

  const admins = adminUids(env);
  if (admins.size === 0 || !env.SENDGRID_API_KEY) return res.status(503).json({ ok: false, code: 'NOT_CONFIGURED' });

  let uid;
  try {
    const token = bearerToken(req.headers?.authorization);
    if (token === undefined) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED' });
    uid = (await verifyFirebaseIdToken(token, { projectId: PROJECT_ID, jwksUrl: GOOGLE_SECURETOKEN_JWKS_URL })).uid;
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.code === 'AUTH_UNAVAILABLE' ? 503 : 401).json({ ok: false, code: e.code });
    return res.status(500).json({ ok: false, code: 'INTERNAL' });
  }
  if (!admins.has(uid)) return res.status(403).json({ ok: false, code: 'FORBIDDEN' });

  const { email, name, orderId, status } = req.body || {};
  if (typeof email !== 'string' || !EMAIL_RE.test(email) || typeof orderId !== 'string' || !ORDER_ID_RE.test(orderId) || (name !== undefined && typeof name !== 'string')) {
    return res.status(400).json({ ok: false, code: 'INVALID_INPUT' });
  }
  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, status)) return res.status(200).json({ ok: true, message: 'No email needed for this status' });

  const { subject, html } = buildEmail({ name, orderId, status });
  try {
    const r = await fetchImpl('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: 'info@dairsharaf.com', name: 'مكتبة دير شرف العلمية' },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });
    if (!r.ok) return res.status(502).json({ ok: false, code: 'SEND_FAILED' });
    return res.status(200).json({ ok: true, message: 'Customer notified successfully' });
  } catch {
    return res.status(502).json({ ok: false, code: 'SEND_FAILED' });
  }
}

export default async function handler(req, res) {
  return handleNotify(req, res);
}
