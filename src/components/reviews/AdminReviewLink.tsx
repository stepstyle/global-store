// Admin, order details of a DELIVERED order: get the customer's private review link and send it BY HAND.
// Nothing is ever sent automatically: "copy" puts it on the clipboard, "WhatsApp" only opens WhatsApp with the text
// ready — the admin presses send. The Worker stores only a hash of the link, so a link is shown once; asking again
// makes a NEW link and the old one stops working (the admin confirms that first).
import React, { useState } from 'react';
import { Star, Copy, MessageCircle, Loader2, RefreshCw } from 'lucide-react';
import { verifiedReviewDeps } from '../../services/reviews';
import { createReviewLink, reviewInviteMessage, waPhone } from '../../services/verifiedReviews';

const CODES_AR: Record<string, string> = {
  NOT_DELIVERED: 'الرابط متاح بعد تعليم الطلب «تم التسليم» فقط.',
  NOTHING_TO_REVIEW: 'لا يوجد في هذا الطلب منتجات يمكن تقييمها (الهدايا لا تُقيَّم).',
  NOT_ADMIN: 'هذه الخاصية للأدمن فقط.',
  NOT_CONFIGURED: 'خادم الطلبات غير مضبوط في هذه النسخة.',
};

const AdminReviewLink: React.FC<{ orderId: string; phone?: string; fullName?: string }> = ({ orderId, phone, fullName }) => {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string; reviewed: number; items: number } | null>(null);
  const [exists, setExists] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const make = async (rotate: boolean) => {
    if (rotate && !window.confirm('سيتوقف الرابط السابق عن العمل إذا كان الزبون لم يستخدمه بعد. إنشاء رابط جديد؟')) return;
    setBusy(true);
    setError('');
    const r = await createReviewLink(verifiedReviewDeps(), orderId, rotate);
    setBusy(false);
    if ('code' in r) {
      if (r.code === 'LINK_EXISTS') { setExists(true); return; }
      setError(CODES_AR[r.code] || `تعذّر إنشاء الرابط (${r.code}).`);
      return;
    }
    setExists(false);
    setLink({ url: r.url, expiresAt: r.expiresAt, reviewed: r.reviewed, items: r.items });
  };

  const first = String(fullName || '').trim().split(/\s+/)[0] || '';
  const message = link ? reviewInviteMessage(link.url, first) : '';
  const wa = link ? waPhone(phone) : null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError('تعذّر النسخ، انسخ الرابط يدويًا.'); }
  };

  return (
    <section className="rounded-2xl border border-gold-200 bg-gold-50/50 p-4" data-testid="admin-review-link" dir="rtl">
      <h4 className="font-bold text-ink-900 flex items-center gap-2"><Star size={16} className="text-gold-600" aria-hidden="true" /> تقييم الزبون لمشترياته</h4>
      <p className="mt-1 text-[13px] text-ink-600">رابط خاص بهذا الطلب يقيّم به الزبون المنتجات التي استلمها (تقييم واحد لكل منتج). لا يُرسل شيء تلقائيًا: أنت من يرسله.</p>

      {!link && !exists && (
        <button type="button" onClick={() => make(false)} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5 text-[14px] font-bold text-white disabled:opacity-60" data-testid="admin-review-link-create">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Star size={16} />} إنشاء رابط التقييم
        </button>
      )}

      {exists && !link && (
        <div className="mt-3 rounded-xl bg-white ring-1 ring-paper-300 p-3 text-[13.5px] text-ink-700" data-testid="admin-review-link-exists">
          أُنشئ رابط لهذا الطلب من قبل. لا يمكن عرضه مرة أخرى (نحتفظ ببصمته فقط لحماية الزبون).
          <button type="button" onClick={() => make(true)} disabled={busy} className="mt-2 flex items-center gap-2 rounded-xl bg-white ring-1 ring-ink-300 px-3 py-2 font-bold text-ink-900">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} إنشاء رابط جديد (يُبطل السابق)
          </button>
        </div>
      )}

      {link && (
        <div className="mt-3 space-y-2.5" data-testid="admin-review-link-ready">
          <input readOnly value={link.url} dir="ltr" onFocus={(e) => e.currentTarget.select()} className="w-full rounded-xl border border-paper-300 bg-white p-2.5 text-[13px] font-mono text-ink-800" aria-label="رابط التقييم" data-testid="admin-review-link-url" />
          <p className="text-[12.5px] text-ink-500">صالح حتى <bdi dir="ltr">{link.expiresAt.slice(0, 10)}</bdi> · قُيّم {link.reviewed} من {link.items} منتج</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={copy} className="inline-flex items-center gap-2 rounded-xl bg-white ring-1 ring-ink-300 px-3.5 py-2 text-[14px] font-bold text-ink-900"><Copy size={15} /> {copied ? 'نُسخت الرسالة' : 'نسخ الرسالة مع الرابط'}</button>
            {wa && (
              <a href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3.5 py-2 text-[14px] font-bold text-white hover:bg-emerald-700"><MessageCircle size={15} /> فتح واتساب (أنت تضغط إرسال)</a>
            )}
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[13.5px] font-semibold text-rose-700">{error}</p>}
    </section>
  );
};

export default AdminReviewLink;
