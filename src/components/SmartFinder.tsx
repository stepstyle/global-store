// src/components/SmartFinder.tsx
import React, { useState, useMemo } from 'react';
import { Sparkles, ArrowRight, ArrowLeft, RefreshCcw, Search, Baby, User, Users, Heart, Gamepad2, BrainCircuit, PartyPopper, ArrowUpRight,Palette,X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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

type Step = 'intro' | 'who' | 'age' | 'interest' | 'result';

const SmartFinder: React.FC<SmartFinderProps> = ({ products, L, isRtl }) => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>('intro');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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
    if (nextStep === 'result') {
      setIsAnalyzing(true);
      setStep('result');
      // محاكاة تفكير الذكاء الاصطناعي لمدة ثانية
      setTimeout(() => setIsAnalyzing(false), 1200);
    } else {
      setStep(nextStep);
    }
  };

  // 🧠 خوارزمية الذكاء الاصطناعي البسيطة (Smart Filtering)
 // 🧠 خوارزمية المكتشف الذكي (المعدلة حسب أقسام متجرك الحقيقية)
  const recommendedProducts = useMemo(() => {
    if (step !== 'result' || isAnalyzing) return [];

    let filtered = [...products];

    // 1. الفلترة الأساسية بتعتمد على "السؤال الثالث" اللي بيطابق "الأقسام" عندك
    if (answers.interest === 'educational') {
      // إذا اختار تعليم وذكاء: بنجيبله ألعاب المنتسوري والتركيب
      filtered = filtered.filter(p => p.category === 'Games' && 
        (p.subCategory === 'montessori' || p.subCategory === 'building-blocks' || p.name.includes('تعليم') || p.name.includes('تركيب')));
    } 
    else if (answers.interest === 'fun') {
      // إذا اختار مرح وتسلية: بنجيبله ألعاب الأولاد، البنات، والجماعية (الترفيهية)
      filtered = filtered.filter(p => p.category === 'Games' && 
        (p.subCategory === 'boys-toys' || p.subCategory === 'girls-toys' || p.subCategory === 'group-games' || p.name.includes('لعبة')));
    } 
    else if (answers.interest === 'art') {
      // إذا اختار رسم وفن: بنحوله فوراً على قسم القرطاسية
      filtered = filtered.filter(p => p.category === 'Stationery');
    }

    // 2. فلتر إضافي قوي: إذا بالسؤال الأول اختار "بيبي"
    if (answers.who === 'baby') {
      // بنلغي كل إشي وبنعطيه منتجات قسم مستلزمات الأطفال والمركبات
      filtered = products.filter(p => p.category === 'BabyGear');
    }

    // 3. الحماية السحرية: إذا الفلتر ما لقى إشي (عشان ما تطلع الشاشة فاضية للزبون ويزعل)
    if (filtered.length === 0) {
       // بنسحب كل الألعاب كخيار بديل
       filtered = products.filter(p => p.category === 'Games');
    }

    // 4. خلط المنتجات: عشان كل مرة يكبس فيها الزبون يطلعله 3 هدايا مختلفة عن اللي قبلها
    return filtered.sort(() => 0.5 - Math.random()).slice(0, 3);
  }, [answers, products, step, isAnalyzing]);
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
              {L('جاوب على 3 أسئلة سريعة، وخلي الذكاء الاصطناعي يختارلك الهدية المثالية بلمح البصر.', 'Answer 3 quick questions, and let our AI pick the perfect gift in seconds.')}
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
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">{step === 'result' ? L('اكتمل التحليل', 'Analysis Complete') : L('خطوة ' + (step === 'who' ? '1' : step === 'age' ? '2' : '3') + ' من 3', 'Step ' + (step === 'who' ? '1' : step === 'age' ? '2' : '3') + ' of 3')}</p>
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
                      <button key={ageGrp} onClick={() => handleAnswer('age', ageGrp, 'interest')} className="py-4 px-6 rounded-2xl border-2 border-slate-100 hover:border-indigo-500 hover:bg-indigo-500 hover:text-white hover:shadow-lg text-slate-700 transition-all font-black text-lg">
                        {ageGrp} {L('سنوات', 'Years')}
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
                  {isAnalyzing ? (
                    <div className="flex flex-col items-center justify-center py-10">
                      <div className="relative">
                        <div className="w-20 h-20 border-4 border-indigo-100 rounded-full"></div>
                        <div className="w-20 h-20 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin absolute top-0 left-0"></div>
                        <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-600 animate-pulse" size={24} />
                      </div>
                      <h3 className="mt-6 text-xl font-black text-slate-800">{L('جاري تحليل طلبك...', 'Analyzing your request...')}</h3>
                      <p className="text-slate-500 font-bold mt-2">{L('نبحث في مئات المنتجات لنجد الأفضل', 'Searching hundreds of products to find the best')}</p>
                    </div>
                  ) : (
                    <div>
                      <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-100 text-emerald-500 rounded-full mb-4">
                          <PartyPopper size={32} />
                        </div>
                        <h2 className="text-2xl font-black text-slate-800">{L('وجدنا الخيارات المثالية لك!', 'We found the perfect matches!')}</h2>
                      </div>
                      
                      <div className="space-y-3">
                        {recommendedProducts.map((p, idx) => (
                          <div key={p.id} onClick={() => { handleClose(); navigate(`/product/${p.id}`); }} className="flex items-center gap-4 p-3 pr-4 rounded-2xl border border-slate-100 hover:border-indigo-300 hover:shadow-md bg-white cursor-pointer transition-all group">
                            <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-50 shrink-0">
                              <img src={p.image} alt={p.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-slate-900 text-sm sm:text-base line-clamp-2 group-hover:text-indigo-600 transition-colors">{isRtl ? p.name : p.nameEn || p.name}</h4>
                              <p className="font-black text-indigo-600 mt-1">{p.price} JOD</p>
                            </div>
                            <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors shrink-0">
                              <ArrowRight size={18} className="rtl:rotate-180" />
                            </div>
                          </div>
                        ))}
                      </div>

                      <button onClick={() => setStep('who')} className="mt-6 w-full py-4 text-slate-500 hover:bg-slate-100 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors">
                        <RefreshCcw size={18} /> {L('البحث مرة أخرى', 'Search Again')}
                      </button>
                    </div>
                  )}
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