// src/components/ShopAssistant.tsx — the customer's shopping assistant (floating button + chat panel).
//
// Built on the store's discovery engine (src/services/discovery): it understands Arabic requests (type, age, budget,
// recipient, occasion) and ranks ONLY the store's real products. Every name, price, image and availability shown here
// comes from the product data — the assistant never states a price, stock or specification of its own.
// It only suggests and links: it never creates orders, never changes the cart or stock.
//
// AI: only when this is a production build AND VITE_AI_INTENT_URL points to the store's AI intent Worker
// (workers/ai-discovery). Otherwise — including every preview build — the local Arabic search engine answers, and the
// panel says so: it never claims AI that is not connected.
//
// Ages: a product is suggested for an age ONLY when its age was approved by the store owner (src/data/productAges.json,
// see scripts/product-ages.mjs). Under 3 it must also be confirmed free of small parts. No guessing from names/photos.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Sparkles, X, Send, ArrowUpLeft, Loader2, MessageCircle } from 'lucide-react';
import { useCart } from '../App';
import { BACKEND_ENABLED } from '../config/deployEnv';
import { STORE_WHATSAPP_URL } from '../config/contact';
import { discoverProducts, createRemoteIntentProvider } from '../services/discovery/index.ts';
import type { DiscoveryResponse } from '../services/discovery/types.ts';
import { PRODUCT_AGES } from '../services/productAges';

type Turn = { id: number; role: 'user' | 'assistant'; text: string; response?: DiscoveryResponse; query?: string };

const AI_URL = BACKEND_ENABLED ? String(import.meta.env.VITE_AI_INTENT_URL || '').trim() : '';
let provider: ReturnType<typeof createRemoteIntentProvider> | null = null;
try { provider = AI_URL ? createRemoteIntentProvider({ endpoint: AI_URL }) : null; } catch { provider = null; }

const SUGGESTIONS = [
  'بدي لعبة لعمر سنة',
  'لعبة لبنت عمرها 3 سنين',
  'بدي هدية بخمس ليرات',
  'دفاتر وألوان للمدرسة',
];

const waAsk = (q: string) => `${STORE_WHATSAPP_URL}?text=${encodeURIComponent(`مرحبا، بدي أستفسر عن: ${q}`)}`;

// pages where a floating button would cover the page's own primary actions (checkout, cart, login, dashboard, the
// customer's orders / tracking, the contact page — which has its own channels)
const HIDDEN_ON = /^\/(checkout|cart|login|admin|order-success|my-orders|tracking|contact)/;
// product page on PHONES: the round button sat on the quantity (+) control of the first screen
const PHONE_HIDDEN_ON = /^\/product\//;

const ShopAssistant: React.FC = () => {
  const { products, language, isCartOpen } = useCart() as any;
  const { pathname } = useLocation();
  const isAr = (language ?? 'ar') === 'ar';
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const seq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const list = useMemo(() => (Array.isArray(products) ? products : []), [products]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns, busy, open]);
  // Escape closes the panel (keyboard / accessibility)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const ask = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    setTurns((t) => [...t, { id: ++seq.current, role: 'user', text: q }]);
    setBusy(true);
    try {
      const response = await discoverProducts(q, list, { provider, limit: 6, ages: PRODUCT_AGES });
      setTurns((t) => [...t, { id: ++seq.current, role: 'assistant', text: response.message, response, query: q }]);
    } catch {
      setTurns((t) => [...t, { id: ++seq.current, role: 'assistant', text: 'صار خلل بسيط بالبحث. جرّب مرة ثانية أو احكي معنا على واتساب.' }]);
    } finally {
      setBusy(false);
    }
  }, [busy, list]);

  if (isCartOpen || HIDDEN_ON.test(pathname)) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          data-testid="assistant-open"
          onClick={() => setOpen(true)}
          // phones: a compact round button (it used to cover the price / add button of the product cards while scrolling)
          className={`fixed z-[90] bottom-5 end-4 sm:end-6 ${PHONE_HIDDEN_ON.test(pathname) ? 'hidden sm:inline-flex' : 'inline-flex'} items-center gap-2 rounded-full bg-ink-900 text-white p-2.5 sm:ps-3.5 sm:pe-4 sm:py-3 shadow-lift ring-1 ring-gold-300/40 hover:bg-ink-800 transition`}
          aria-label={isAr ? 'مساعد التسوق' : 'Shopping assistant'}
        >
          <span className="w-7 h-7 rounded-full bg-gold-400 text-ink-900 flex items-center justify-center"><Sparkles size={15} /></span>
          <span className="hidden sm:inline text-[13.5px] font-bold">{isAr ? 'مساعد التسوق' : 'Assistant'}</span>
        </button>
      )}

      {open && (
        <div className="fixed z-[105] inset-x-0 bottom-0 sm:inset-x-auto sm:end-6 sm:bottom-6 sm:w-[400px]" role="dialog" aria-label={isAr ? 'مساعد التسوق' : 'Shopping assistant'} data-testid="assistant-panel">
          <div className="flex flex-col h-[78vh] sm:h-[620px] bg-paper rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-lift ring-1 ring-ink-900/10 overflow-hidden">
            <div className="flex items-center gap-3 bg-ink-900 text-white px-4 py-3.5">
              <span className="w-9 h-9 rounded-2xl bg-gold-400 text-ink-900 flex items-center justify-center shrink-0"><Sparkles size={18} /></span>
              <div className="flex-1 min-w-0">
                <div className="font-heading font-bold text-[15.5px]">{isAr ? 'مساعد التسوق' : 'Shopping assistant'}</div>
                <div className="text-[11.5px] text-ink-100/80 truncate" data-testid="assistant-engine">{provider ? (isAr ? 'بمساعدة الذكاء الاصطناعي — من منتجات المكتبة فقط' : 'AI-assisted — store products only') : (isAr ? 'بحث في منتجات المكتبة المتوفرة' : 'Search over the store’s products')}</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center" aria-label={isAr ? 'إغلاق' : 'Close'}><X size={19} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-3.5 py-4 space-y-3">
              <div className="rounded-2xl bg-white ring-1 ring-ink-900/[0.06] px-4 py-3 text-[14px] leading-7 text-ink-800">
                {isAr ? 'أهلا وسهلا! احكيلي شو بدك — العمر أو الميزانية أو نوع الهدية — وبقترح عليك من المتوفر عنا.' : 'Hi! Tell me what you need — age, budget, type — and I will suggest products the store actually has.'}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => ask(s)} className="rounded-full bg-paper-100 ring-1 ring-ink-900/[0.08] px-3 py-1.5 text-[12.5px] font-semibold text-ink-800 hover:bg-gold-50">{s}</button>
                  ))}
                </div>
              </div>

              {turns.map((t) => t.role === 'user' ? (
                <div key={t.id} className="flex justify-start"><div className="max-w-[85%] rounded-2xl rounded-ss-md bg-ink-900 text-white px-3.5 py-2.5 text-[14px]">{t.text}</div></div>
              ) : (
                <div key={t.id} className="space-y-2" data-testid="assistant-answer">
                  <div className="rounded-2xl bg-white ring-1 ring-ink-900/[0.06] px-3.5 py-2.5 text-[14px] leading-7 text-ink-800">{t.text}</div>
                  {t.response?.results?.length ? (
                    <div className="grid gap-2">
                      {t.response.results.map((r) => (
                        <Link key={r.id} to={`/product/${r.id}`} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-2xl bg-white ring-1 ring-ink-900/[0.06] p-2 pe-3 hover:ring-gold-300 transition" data-testid="assistant-result">
                          <span className="w-16 h-16 rounded-xl bg-paper-100 shrink-0 overflow-hidden flex items-center justify-center">{r.image ? <img src={r.image} alt="" className="w-full h-full object-contain mix-blend-multiply" loading="lazy" /> : null}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13.5px] font-semibold text-ink-900 line-clamp-2 leading-snug">{isAr ? r.name : r.nameEn || r.name}</span>
                            {r.ageLabel && <span className="block text-[11.5px] text-gold-700 font-semibold mt-0.5" data-testid="assistant-result-age">{isAr ? `العمر: ${r.ageLabel}` : `Age: ${r.ageLabel}`}</span>}
                          </span>
                          <span className="text-end shrink-0">
                            <span className="block font-heading font-bold text-ink-900 text-[15px] tabular-nums">{r.price} <span className="text-[10.5px] text-gold-600">د.أ</span></span>
                            <ArrowUpLeft size={15} className="text-ink-300 ms-auto mt-1 rtl:rotate-0 ltr:rotate-90" />
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {t.response?.clarification && (
                    <div className="rounded-2xl bg-gold-50 ring-1 ring-gold-200 px-3.5 py-2.5">
                      <div className="text-[13.5px] font-semibold text-ink-900 mb-2">{t.response.clarification.question}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {t.response.clarification.options.map((o) => (
                          <button key={o} type="button" onClick={() => ask(`${t.query ?? ''} ${o}`)} className="rounded-full bg-white ring-1 ring-gold-200 px-3 py-1.5 text-[12.5px] font-semibold text-ink-800 hover:bg-gold-100">{o}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {t.response?.suggestWhatsApp && (
                    <a href={waAsk(t.query ?? '')} target="_blank" rel="noopener noreferrer" data-testid="assistant-whatsapp" className="inline-flex items-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 text-[13.5px] font-bold transition">
                      <MessageCircle size={17} /> {isAr ? 'اسألنا على واتساب' : 'Ask us on WhatsApp'}
                    </a>
                  )}
                </div>
              ))}
              {busy && <div className="flex items-center gap-2 text-[13px] text-ink-500 px-1"><Loader2 size={15} className="animate-spin" /> {isAr ? 'أبحث في منتجات المكتبة…' : 'Searching…'}</div>}
              <div ref={endRef} />
            </div>

            <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="border-t border-ink-900/[0.08] bg-white p-2.5 flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={300}
                placeholder={isAr ? 'مثلًا: لعبة لعمر 4 سنين بحدود 10 دنانير' : 'e.g. a toy for age 4 around 10 JOD'}
                className="flex-1 min-w-0 rounded-full bg-paper-100 px-4 py-3 text-[14px] text-ink-900 placeholder:text-ink-300 !border-0"
                aria-label={isAr ? 'اكتب طلبك' : 'Your request'}
                data-testid="assistant-input"
              />
              <button type="submit" disabled={busy || !input.trim()} className="w-11 h-11 rounded-full bg-gold-500 text-white flex items-center justify-center disabled:opacity-40 hover:bg-gold-600" aria-label={isAr ? 'إرسال' : 'Send'}>
                <Send size={17} className="rtl:rotate-180" />
              </button>
            </form>
            <div className="bg-white text-[10.5px] text-ink-400 text-center pb-2 -mt-1">{isAr ? 'الاقتراحات من منتجات المكتبة المتوفرة فقط. المساعد ما بينشئ طلبات.' : 'Suggestions use in-stock store products only. The assistant never places orders.'}</div>
          </div>
        </div>
      )}
    </>
  );
};

export default ShopAssistant;
