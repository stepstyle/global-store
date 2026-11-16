// DEV ONLY — AI Product Discovery lab (route /#/dev/ai-discovery, registered in App.tsx only when import.meta.env.DEV).
// Uses the store's existing product data layer (in `vite` dev: the Firebase Emulator, demo- project) and the LOCAL
// discovery engine. No AI provider is configured here: nothing leaves the machine.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Search, AlertTriangle, Info, PackageX } from 'lucide-react';
import { discoverProducts, createRemoteIntentProvider } from '../../services/discovery/index.ts';
import type { DiscoveryResponse, IntentProvider } from '../../services/discovery/index.ts';
import { storeProductSource } from '../../services/discovery/storeSource.ts';
import { formatAge } from '../../services/discovery/ranking.ts';
import { CATEGORY_LABEL_AR } from '../../services/discovery/lexicon.ts';

const EXAMPLES = [
  'بدي هدية تعليمية لطفل عمره 7 سنوات بحدود 12 دينار',
  'شنطة مدرسة لبنتي صف تالت تحت 20 دينار',
  'ألوان لابني ٥ سنين بخمسة دنانير',
  'بدي لعبة لبنت عمرها سنتين بين 5 و 10 دنانير',
  'عندكم عروض على الدفاتر؟',
];

const OCCASION_AR: Record<string, string> = { gift: 'هدية', birthday: 'عيد ميلاد', back_to_school: 'رجعة المدارس', success: 'نجاح', eid: 'عيد' };
const RECIPIENT_AR: Record<string, string> = { boy: 'ولد', girl: 'بنت', child: 'طفل', baby: 'رضيع', teen: 'مراهق', adult: 'بالغ' };

type LoadState = { status: 'loading' } | { status: 'ready'; products: readonly unknown[] } | { status: 'error'; message: string };

// Optional (dev only): the LOCAL/staging AI intent helper (workers/ai-discovery). Unset = local search only.
// Any failure of that service falls back to the local result (shown on the page).
const AI_URL = String(import.meta.env.VITE_AI_INTENT_URL || '').trim();
let aiProvider: IntentProvider | null = null;
let aiConfigError: string | null = null;
if (AI_URL) {
  try { aiProvider = createRemoteIntentProvider({ endpoint: AI_URL }); } catch (e) { aiConfigError = e instanceof Error ? e.message : 'invalid AI URL'; }
}

const AiDiscoveryLab: React.FC = () => {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [query, setQuery] = useState(EXAMPLES[0]);
  const [submitted, setSubmitted] = useState(EXAMPLES[0]);

  useEffect(() => {
    let alive = true;
    storeProductSource.listProducts()
      .then((products) => { if (alive) setLoad({ status: 'ready', products }); })
      .catch((e: unknown) => { if (alive) setLoad({ status: 'error', message: e instanceof Error ? e.message : 'تعذر تحميل المنتجات' }); });
    return () => { alive = false; };
  }, []);

  const [response, setResponse] = useState<DiscoveryResponse | null>(null);
  // which query (and which run) the shown response belongs to — for tests and to avoid showing a stale answer
  const [answered, setAnswered] = useState<{ query: string; run: number }>({ query: '', run: 0 });
  const [runNo, setRunNo] = useState(0);
  useEffect(() => {
    if (load.status !== 'ready') return;
    let alive = true;
    discoverProducts(submitted, load.products, { provider: aiProvider })
      .then((r) => { if (alive) { setResponse(r); setAnswered({ query: submitted, run: runNo }); } });
    return () => { alive = false; };
  }, [load, submitted, runNo]);

  const run = (q: string) => { setQuery(q); setSubmitted(q); setRunNo((n) => n + 1); };
  const intent = response?.intent ?? null;
  const chips: string[] = [];
  if (intent) {
    if (intent.budget) chips.push(`الميزانية: ${intent.budget.min != null ? `من ${intent.budget.min} ` : ''}${intent.budget.max != null ? `${intent.budget.approximate ? 'بحدود' : intent.budget.maxExclusive ? 'أقل من' : 'حتى'} ${intent.budget.max}` : ''} دينار`);
    if (intent.age) chips.push(`العمر: ${formatAge(intent.age.min, intent.age.max)}`);
    if (intent.recipient) chips.push(`لمن: ${RECIPIENT_AR[intent.recipient]}`);
    intent.occasions.forEach((o) => chips.push(`المناسبة: ${OCCASION_AR[o]}`));
    intent.categories.forEach((c) => chips.push(`القسم: ${CATEGORY_LABEL_AR[c]}`));
    if (intent.educational) chips.push('تعليمي');
    if (intent.wantsOffers) chips.push('عروض/خصم');
    if (intent.keywords.length) chips.push(`كلمات: ${intent.keywords.join('، ')}`);
  }

  return (
    <div dir="rtl" className="max-w-5xl mx-auto px-4 py-8 text-slate-800">
      <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 flex items-center gap-2">
        <AlertTriangle size={16} /> وضع التطوير فقط — هذه الصفحة غير موجودة في الموقع المنشور. لا يوجد نموذج AI حقيقي؛ خدمة AI (إن ضُبطت) تعمل بمزود وهمي محلي.
      </div>

      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1"><Sparkles className="text-indigo-600" /> اكتشاف المنتجات الذكي</h1>
      <p className="text-sm text-slate-500 mb-4">اكتب طلب الزبون بالعربية أو باللهجة الأردنية، وستظهر المنتجات المطابقة من بيانات المتجر مع سبب الاقتراح.</p>

      <form className="flex gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); setSubmitted(query); setRunNo((n) => n + 1); }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={300}
          className="flex-1 rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="مثلًا: بدي هدية تعليمية لطفل عمره 7 سنوات بحدود 12 دينار"
          aria-label="طلب الزبون"
        />
        <button type="submit" className="rounded-xl bg-indigo-600 px-5 text-white font-semibold flex items-center gap-2 hover:bg-indigo-700">
          <Search size={18} /> ابحث
        </button>
      </form>
      <div className="flex flex-wrap gap-2 mb-6">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => run(ex)} className="text-xs rounded-full border border-slate-300 px-3 py-1 hover:bg-slate-100">{ex}</button>
        ))}
      </div>

      {load.status === 'loading' && <p className="text-slate-500">جاري تحميل المنتجات من مصدر بيانات المتجر…</p>}
      {load.status === 'error' && <p className="text-red-700">تعذر تحميل المنتجات: {load.message}</p>}
      {load.status === 'ready' && (
        <p className="text-xs text-slate-400 mb-3">
          عدد المنتجات في مصدر البيانات الحالي: {load.products.length}{load.products.length === 0 ? ' — شغّل محاكي Firebase المحلي وأضف منتجات تجريبية لرؤية نتائج.' : ''}
        </p>
      )}

      {response && (
        <section data-query={answered.query} data-run={answered.run}>
          <div className={`rounded-xl px-4 py-3 mb-4 flex items-start gap-2 ${response.status === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-100 text-slate-700'}`}>
            <Info size={18} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">{response.message}</div>
              <div className="text-xs opacity-70" data-testid="engine">
                المحرك: {response.engine === 'local' ? 'بحث محلي' : 'فهم بمساعدة خدمة AI التجريبية + ترتيب محلي'}
                {aiProvider ? ` · خدمة AI: ${AI_URL}` : ' · بدون خدمة AI'}
                {response.aiFallbackReason ? ` · رجوع للبحث المحلي: ${response.aiFallbackReason}` : ''}
                {aiConfigError ? ` · إعداد AI غير صالح: ${aiConfigError}` : ''}
              </div>
              {response.ai && (
                <div className="text-xs opacity-70" data-testid="ai-info">
                  {response.ai.called ? 'تم استدعاء AI' : `لم يُستدعَ AI (${response.ai.skippedReason})`}
                  {response.ai.verified.length ? ` · شروط مؤكدة من نص الطلب: ${response.ai.verified.join('، ')}` : ''}
                  {response.ai.hints.length ? ` · تلميحات للترتيب فقط: ${response.ai.hints.join('، ')}` : ''}
                  {response.ai.ignored.length ? ` · تم تجاهل: ${response.ai.ignored.join('، ')}` : ''}
                </div>
              )}
            </div>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {chips.map((c) => <span key={c} className="text-xs rounded-full bg-indigo-50 text-indigo-800 px-3 py-1">{c}</span>)}
            </div>
          )}
          {intent?.warnings.map((w) => <p key={w} className="text-xs text-amber-700 mb-2">⚠ {w}</p>)}
          {response.clarification && (
            <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900" data-testid="clarification">
              <div className="font-semibold">{response.clarification.question}</div>
              <div className="flex flex-wrap gap-2 mt-2">
                {response.clarification.options.map((o) => <span key={o} className="text-xs rounded-full bg-white border border-indigo-200 px-3 py-1">{o}</span>)}
              </div>
            </div>
          )}

          <ul className="grid gap-3 sm:grid-cols-2">
            {response.results.map((r) => (
              <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  {r.image ? <img src={r.image} alt="" className="w-16 h-16 object-contain rounded-lg bg-slate-50" /> : null}
                  <div className="flex-1 min-w-0">
                    <Link to={`/product/${encodeURIComponent(r.id)}`} className="font-semibold hover:underline">{r.name}</Link>
                    <div className="text-sm">
                      <span className="font-bold">{r.price} دينار</span>
                      {r.originalPrice !== null && <span className="text-slate-400 line-through mr-2">{r.originalPrice}</span>}
                      <span className={`text-xs mr-2 ${r.matchLevel === 'alternative' || r.matchLevel === 'inferred' ? 'text-amber-700' : 'text-emerald-700'}`} data-role="match">{r.matchLabel}</span>
                      {response.needs.length > 1 && r.forNeed && <span className="text-xs text-slate-500 mr-2" data-role="need">لـ«{r.forNeed}»</span>}
                    </div>
                  </div>
                </div>
                <ul className="mt-2 text-xs text-slate-600 list-disc pr-5 space-y-0.5">
                  {r.reasons.map((x) => <li key={x}>{x}</li>)}
                </ul>
                {r.caveats.map((x) => <p key={x} className="mt-1 text-xs text-amber-700">تنبيه: {x}</p>)}
                {r.missing.map((x) => <p key={x} className="mt-1 text-xs text-slate-400">معلومة ناقصة: {x}</p>)}
              </li>
            ))}
          </ul>

          {response.unavailable.length > 0 && (
            <div className="mt-4 text-sm text-slate-500 flex items-start gap-2">
              <PackageX size={16} className="mt-0.5" />
              <span>مناسب لكن غير متوفر حاليًا: {response.unavailable.map((u) => u.name).join('، ')}</span>
            </div>
          )}
          {response.unconfirmed.length > 0 && (
            <div className="mt-2 text-sm text-slate-400" data-testid="unconfirmed">
              لم نقترحها لأن بيانات المتجر لا تؤكد مناسبتها:
              <ul className="list-disc pr-5">{response.unconfirmed.map((u) => <li key={u.id}>{u.name} — {u.reason}</li>)}</ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default AiDiscoveryLab;
