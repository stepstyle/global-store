// src/components/SmartFinder.tsx
import React, { useState, useMemo } from 'react';
import { Sparkles, ArrowRight, ArrowLeft, RefreshCcw, Search, Baby, User, Users, Heart, Gamepad2, BrainCircuit, PartyPopper, ArrowUpRight,Palette,X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
// The SAME discovery engine as the free-text search (src/services/discovery): store data only, deterministic order.
import { discoverWithIntent, giftFinderIntent } from '../services/discovery/index.ts';

interface Product {
  id: string;
  name: string;
  nameEn: string;
  category: string;
  price: number;
  image: string;
  age?: string; // إذا كان متوفر
}

interface SmartFinderProps {
  products: Product[];
  L: (ar: string, en: string) => string;
  isRtl: boolean;
}

type Step = 'intro' | 'who' | 'age' | 'ageDetail' | 'interest' | 'result';

// "0-3" is too wide to suggest something safe for a baby: the finder asks the exact range (same style, one tap).
const YOUNG_AGE_DETAIL: { value: string; ar: string; en: string }[] = [
  { value: '0-1', ar: 'أقل من سنة', en: 'Under 1 year' },
  { value: '1-2', ar: 'من سنة إلى سنتين', en: '1 to 2 years' },
  { value: '2-3', ar: 'من سنتين إلى 3 سنوات', en: '2 to 3 years' },
];

const SmartFinder: React.FC<SmartFinderProps> = ({ products, L, isRtl }) => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>('intro');

  const [answers, setAnswers] = useState({
    who: '',
    age: '',
    interest: ''
  });

  const handleOpen = () => {
    setIsOpen(true);
    setStep('who');
    setAnswers({ who: '', age: '', interest: '' });
  };

  const handleClose = () => {
    setIsOpen(false);
    setTimeout(() => setStep('intro'), 300);
  };

  const handleAnswer = (key: keyof typeof answers, value: string, nextStep: Step) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
    setStep(nextStep);
  };

  // The three answers -> a structured request for the discovery engine (only what the customer chose; no budget is
  // asked, so none is assumed). Same engine and rules as the free-text search: store data only, stable order,
  // out-of-stock never recommended, missing data said plainly.
  const discovery = useMemo(() => {
    if (step !== 'result') return null;
    return discoverWithIntent(giftFinderIntent(answers), products, { limit: 6 });
  }, [answers, products, step]);
  const recommendedProducts = discovery?.results ?? [];
  return (
    <>
      {/* 🌟 القسم البارز في الصفحة الرئيسية */}
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-indigo-600 via-purple-600 to-sky-500 p-8 sm:p-10 shadow-2xl group cursor-pointer" onClick={handleOpen}>
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-white/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700 pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-10 -ml-10 w-40 h-40 bg-sky-300/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700 pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-start">
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white text-xs font-bold uppercase tracking-widest mb-4">
              <Sparkles size={14} className="text-amber-300" />
              {L('مساعد الهدايا الذكي', 'Smart Gift Finder')}
            </div>
            <h3 className="text-2xl sm:text-3xl font-black text-white mb-2 leading-tight">
              {L('محتار شو تختار؟', 'Not sure what to choose?')}
            </h3>
            <p className="text-white/80 text-sm sm:text-base max-w-lg">
              {L('جاوب على 3 أسئلة سريعة، ونقترح عليك هدايا مناسبة من منتجات المتجر مع سبب كل اقتراح.', 'Answer 3 quick questions and get gift suggestions from our store, each with the reason why.')}
            </p>
          </div>
          
          <button className="shrink-0 bg-white text-indigo-600 font-black px-8 py-4 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-1 hover:scale-105 active:scale-95 transition-all duration-300 flex items-center gap-2">
            {L('ابدأ البحث السحري', 'Start Magic Search')}
            <ArrowUpRight size={20} className="rtl:-scale-x-100" />
          </button>
        </div>
      </div>

      {/* 🤖 النافذة المنبثقة (شاشة المكتشف) */}
      {isOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md transition-opacity" onClick={handleClose} />
          
          <div className="relative w-full max-w-xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
            <div className="p-6 pb-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h4 className="font-black text-slate-900 text-lg leading-none">{L('المكتشف الذكي', 'Smart Finder')}</h4>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">{step === 'result' ? L('النتائج', 'Results') : L('خطوة ' + (step === 'who' ? '1' : step === 'age' || step === 'ageDetail' ? '2' : '3') + ' من 3', 'Step ' + (step === 'who' ? '1' : step === 'age' || step === 'ageDetail' ? '2' : '3') + ' of 3')}</p>
                </div>
              </div>
              <button onClick={handleClose} className="p-2 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 sm:p-8 overflow-y-auto custom-scrollbar flex-1">
              
              {/* السؤال الأول */}
              {step === 'who' && (
                <div className="animate-in slide-in-from-bottom-4 duration-500">
                  <h2 className="text-2xl font-black text-slate-800 text-center mb-6">{L('لمن تبحث عن الهدية؟', 'Who are you shopping for?')}</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button onClick={() => handleAnswer('who', 'boy', 'age')} className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-slate-100 hover:border-indigo-400 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 transition-all font-bold group">
                      <User size={32} className="group-hover:scale-110 transition-transform" /> {L('ولد', 'Boy')}
                    </button>
                    <button onClick={() => handleAnswer('who', 'girl', 'age')} className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-slate-100 hover:border-pink-400 hover:bg-pink-50 text-slate-600 hover:text-pink-600 transition-all font-bold group">
                      <Heart size={32} className="group-hover:scale-110 transition-transform" /> {L('بنت', 'Girl')}
                    </button>
                    <button onClick={() => handleAnswer('who', 'baby', 'age')} className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-slate-100 hover:border-teal-400 hover:bg-teal-50 text-slate-600 hover:text-teal-600 transition-all font-bold group">
                      <Baby size={32} className="group-hover:scale-110 transition-transform" /> {L('بيبي', 'Baby')}
                    </button>
                  </div>
                </div>
              )}

              {/* السؤال الثاني */}
              {step === 'age' && (
                <div className="animate-in slide-in-from-right-8 duration-500">
                  <h2 className="text-2xl font-black text-slate-800 text-center mb-6">{L('كم العمر تقريباً؟', 'What is the approximate age?')}</h2>
                  <div className="grid grid-cols-2 gap-3">
                    {['0-3', '4-7', '8-12', '+13'].map((ageGrp) => (
                      <button key={ageGrp} onClick={() => handleAnswer('age', ageGrp, ageGrp === '0-3' ? 'ageDetail' : 'interest')} className="py-4 px-6 rounded-2xl border-2 border-slate-100 hover:border-indigo-500 hover:bg-indigo-500 hover:text-white hover:shadow-lg text-slate-700 transition-all font-black text-lg">
                        {ageGrp} {L('سنوات', 'Years')}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* السؤال الثاني (تكملة): "0-3" واسع جدًا لاقتراح آمن — نسأل عن العمر بدقة */}
              {step === 'ageDetail' && (
                <div className="animate-in slide-in-from-right-8 duration-500">
                  <h2 className="text-2xl font-black text-slate-800 text-center mb-2">{L('كم عمره بالتحديد؟', 'Exactly how old?')}</h2>
                  <p className="text-sm text-slate-500 font-bold text-center mb-6">{L('حتى نقترح منتجًا مناسبًا وآمنًا لعمره', 'So we only suggest age-appropriate products')}</p>
                  <div className="grid grid-cols-1 gap-3">
                    {YOUNG_AGE_DETAIL.map((a) => (
                      <button key={a.value} onClick={() => handleAnswer('age', a.value, 'interest')} className="py-4 px-6 rounded-2xl border-2 border-slate-100 hover:border-indigo-500 hover:bg-indigo-500 hover:text-white hover:shadow-lg text-slate-700 transition-all font-black text-lg">
                        {L(a.ar, a.en)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* السؤال الثالث */}
              {step === 'interest' && (
                <div className="animate-in slide-in-from-right-8 duration-500">
                  <h2 className="text-2xl font-black text-slate-800 text-center mb-6">{L('شو أكثر إشي بحبه؟', 'What are they interested in?')}</h2>
                  <div className="grid grid-cols-1 gap-3">
                    <button onClick={() => handleAnswer('interest', 'educational', 'result')} className="flex items-center gap-4 p-4 rounded-2xl border-2 border-slate-100 hover:border-amber-400 hover:bg-amber-50 text-slate-700 transition-all font-bold text-start group">
                      <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform"><BrainCircuit size={24} /></div>
                      <div>
                        <p className="text-base group-hover:text-amber-700">{L('تفكير وذكاء (تركيب، بازل، تعليمي)', 'Thinking & IQ (Blocks, Puzzles, Educational)')}</p>
                      </div>
                    </button>
                    <button onClick={() => handleAnswer('interest', 'fun', 'result')} className="flex items-center gap-4 p-4 rounded-2xl border-2 border-slate-100 hover:border-sky-400 hover:bg-sky-50 text-slate-700 transition-all font-bold text-start group">
                      <div className="w-12 h-12 bg-sky-100 text-sky-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform"><Gamepad2 size={24} /></div>
                      <div>
                        <p className="text-base group-hover:text-sky-700">{L('مرح وتسلية (سيارات، دمى، ألعاب جماعية)', 'Fun & Play (Cars, Dolls, Group Games)')}</p>
                      </div>
                    </button>
                    <button onClick={() => handleAnswer('interest', 'art', 'result')} className="flex items-center gap-4 p-4 rounded-2xl border-2 border-slate-100 hover:border-rose-400 hover:bg-rose-50 text-slate-700 transition-all font-bold text-start group">
                      <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform"><Palette size={24} /></div>
                      <div>
                        <p className="text-base group-hover:text-rose-700">{L('رسم وإبداع (تلوين، معجون، قرطاسية)', 'Art & Creativity (Colors, Clay, Stationery)')}</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* شاشة التحميل والنتائج */}
              {step === 'result' && (
                <div className="animate-in fade-in duration-500">
                    <div>
                      <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-100 text-emerald-500 rounded-full mb-4">
                          <PartyPopper size={32} />
                        </div>
                        <h2 className="text-2xl font-black text-slate-800">
                          {recommendedProducts.length
                            ? L('اقتراحات مناسبة من المتجر', 'Suggestions from our store')
                            : L('لم نجد هدية مناسبة الآن', 'No matching gift right now')}
                        </h2>
                        {!recommendedProducts.length && discovery && (
                          <p data-testid="finder-message" className="text-slate-500 font-bold mt-2 text-sm">{discovery.message}</p>
                        )}
                        {discovery?.clarification && (
                          <p data-testid="finder-clarification" className="text-indigo-700 font-bold mt-2 text-sm">{discovery.clarification.question}</p>
                        )}
                      </div>

                      <div className="space-y-3" data-testid="finder-results">
                        {recommendedProducts.map((p) => (
                          <div key={p.id} data-product-id={p.id} onClick={() => { handleClose(); navigate(`/product/${p.id}`); }} className="flex items-center gap-4 p-3 pr-4 rounded-2xl border border-slate-100 hover:border-indigo-300 hover:shadow-md bg-white cursor-pointer transition-all group">
                            <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-50 shrink-0">
                              <img src={p.image} alt={p.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-slate-900 text-sm sm:text-base line-clamp-2 group-hover:text-indigo-600 transition-colors">{isRtl ? p.name : p.nameEn || p.name}</h4>
                              <p className="font-black text-indigo-600 mt-1">{p.price} JOD</p>
                              {/* how it matches, in words (no percentage: the engine's score is not a measured accuracy) */}
                              <p className={`text-[11px] font-bold mt-0.5 ${p.matchLevel === 'alternative' || p.matchLevel === 'inferred' ? 'text-amber-700' : 'text-emerald-700'}`} data-role="match">{p.matchLabel}</p>
                              {/* why it is suggested — every line comes from the product's store data */}
                              <p className="text-[11px] text-slate-500 mt-1 line-clamp-2" data-role="reasons">{p.reasons.slice(0, 2).join(' · ')}</p>
                              {p.caveats.map((c) => <p key={c} className="text-[11px] text-amber-700 mt-0.5" data-role="caveat">{c}</p>)}
                              {p.missing.map((m) => <p key={m} className="text-[11px] text-slate-400 mt-0.5" data-role="missing">{m}</p>)}
                            </div>
                            <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors shrink-0">
                              <ArrowRight size={18} className="rtl:rotate-180" />
                            </div>
                          </div>
                        ))}
                      </div>

                      {discovery && discovery.unavailable.length > 0 && (
                        <p data-testid="finder-unavailable" className="mt-4 text-xs text-slate-500 font-bold">
                          {L('مناسب لكن غير متوفر حاليًا: ', 'Matching but out of stock: ')}{discovery.unavailable.map((u) => u.name).join('، ')}
                        </p>
                      )}
                      {discovery && discovery.unconfirmed.length > 0 && (
                        <p data-testid="finder-unconfirmed" className="mt-2 text-xs text-slate-400 font-bold">
                          {L('لم نقترحها لأن بيانات المتجر لا تؤكد مناسبتها (المعلومات غير كافية): ', 'Not suggested — the store data does not confirm they suit (insufficient information): ')}
                          {discovery.unconfirmed.map((u) => u.name).join('، ')}
                        </p>
                      )}

                      <button onClick={() => setStep('who')} className="mt-6 w-full py-4 text-slate-500 hover:bg-slate-100 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors">
                        <RefreshCcw size={18} /> {L('البحث مرة أخرى', 'Search Again')}
                      </button>
                    </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SmartFinder;