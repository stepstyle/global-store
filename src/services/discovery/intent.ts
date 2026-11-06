// Natural-language (Arabic incl. Jordanian dialect, some English) -> DiscoveryIntent. Rule based, deterministic, local.
import { normalizeArabic, numberWordsToDigits, tokenize, stripArabicPrefix, lightStem } from './arabicText.ts';
import { CATEGORY_TERMS, OCCASION_TERMS, RECIPIENT_TERMS, EDUCATIONAL_TERMS, STOPWORDS } from './lexicon.ts';
import type { AgeIntent, BudgetIntent, DiscoveryCategory, DiscoveryIntent, Need, Occasion, Recipient } from './types.ts';
import type { TermMatch } from './lexicon.ts';

export const MAX_QUERY_LENGTH = 300;
export const MAX_BUDGET_JOD = 10_000;
export const MAX_AGE_YEARS = 100;

export class DiscoveryInputError extends Error {
  code: 'not_text' | 'empty' | 'too_long' | 'no_letters';
  constructor(code: DiscoveryInputError['code'], message: string) {
    super(message);
    this.name = 'DiscoveryInputError';
    this.code = code;
  }
}

/** Validates the raw customer input. Throws DiscoveryInputError with an Arabic message. */
export function validateQuery(raw: unknown): string {
  if (typeof raw !== 'string') throw new DiscoveryInputError('not_text', 'الطلب يجب أن يكون نصًا.');
  const q = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (!q) throw new DiscoveryInputError('empty', 'اكتب ما تبحث عنه، مثلًا: "هدية تعليمية لطفل عمره 7 سنوات بحدود 12 دينار".');
  if (q.length > MAX_QUERY_LENGTH) throw new DiscoveryInputError('too_long', `الطلب طويل جدًا (الحد ${MAX_QUERY_LENGTH} حرفًا). اختصره من فضلك.`);
  if (!/[\p{L}\p{N}]/u.test(q)) throw new DiscoveryInputError('no_letters', 'لم أفهم الطلب. اكتب كلمات تصف المنتج أو المناسبة.');
  return q;
}

const NUM = '(\\d+(?:\\.\\d+)?)';
const CUR = '(?:دينار|دنانير|جد|jd|jod|د ا|dinar|dinars)';
const AGE_UNIT_Y = '(?:سنه|سنوات|سنين|عام|اعوام|سنتين|years?|yrs?|y)';
const AGE_UNIT_M = '(?:شهر|اشهر|شهور|months?)';
const END = '(?=\\s|$)';

/** School grade ordinals (normalized, MSA + Jordanian), with and without "ال". */
const GRADE_ORDINALS: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(
  ([
    [['اول', 'اولى', 'الاول', 'الاولى'], 1], [['ثاني', 'تاني', 'ثانيه', 'الثاني', 'التاني'], 2], [['ثالث', 'تالت', 'الثالث', 'التالت'], 3],
    [['رابع', 'الرابع'], 4], [['خامس', 'الخامس'], 5], [['سادس', 'السادس'], 6], [['سابع', 'السابع'], 7], [['ثامن', 'تامن', 'الثامن', 'التامن'], 8],
    [['تاسع', 'التاسع'], 9], [['عاشر', 'العاشر'], 10], [['حادي عشر', 'الحادي عشر'], 11], [['ثاني عشر', 'الثاني عشر', 'توجيهي'], 12],
  ] as [string[], number][]).flatMap(([ws, n]) => ws.map((w) => [w, n] as const))
    .sort((a, b) => b[0].length - a[0].length),
));

/**
 * The product types asked for. One need per distinct type; a whole-category word that only qualifies a specific
 * type of the same category ("بطاقات انجليزي", "شنطة ظهر") is merged into it.
 */
/** stems of whole-category words ("بطاقات", "شنطة", "لعبة"): never evidence of a specific type */
const BROAD_STEMS: ReadonlySet<string> = new Set(
  CATEGORY_TERMS.filter((t) => !t.specific).flatMap((t) => tokenize(t.phrase).map(lightStem)),
);

export function needsFromHits(hits: readonly (TermMatch & { at?: number })[]): Need[] {
  const out = new Map<string, Need>();
  // in the order the customer wrote them
  for (const h of [...hits].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))) {
    if (h.category === 'Offers') continue;
    const key = `${h.category}/${h.sub ?? (h.specific ? `type:${h.label}` : '*')}`;
    const typeWords = h.specific ? tokenize(h.phrase).map(lightStem).filter((w) => w.length >= 2 && !BROAD_STEMS.has(w)) : [];
    const prev = out.get(key);
    if (prev) { prev.typeWords = [...new Set([...prev.typeWords, ...typeWords])]; continue; }
    out.set(key, { key, label: h.label, category: h.category, subs: h.sub ? h.sub.split('|') : [], typeWords, specific: h.specific });
  }
  const list = [...out.values()];
  return list.filter((n) => n.specific || !list.some((m) => m.specific && m.category === n.category));
}

/** Removes matched spans so later rules (budget) never re-read an age number. */
function cut(text: string, start: number, len: number): string {
  return `${text.slice(0, start)} ${' '.repeat(len)} ${text.slice(start + len)}`;
}

/** `grade`: the number is a school grade, not an age ("صف 3" -> 8-9 years) */
const AGE_RULES: readonly { re: RegExp; f: (m: RegExpExecArray) => [number, number] | null; grade?: true }[] = [
    // "من 6 ل 8 سنين" / "6-8 سنوات" / "بين 6 و 8 سنين"
    { re: new RegExp(`(?:من|بين)?\\s*${NUM}\\s*(?:-|ل|الى|الي|و|to)\\s*${NUM}\\s*${AGE_UNIT_Y}${END}`, 'u'), f: (m) => [Number(m[1]), Number(m[2])] },
    // "7 سنوات" / "سبع سنين" (digits already)
    { re: new RegExp(`${NUM}\\s*${AGE_UNIT_Y}${END}`, 'u'), f: (m) => [Number(m[1]), Number(m[1])] },
    // "عمره سنتين" / "سنتين"
    { re: new RegExp(`(?:^|\\s)سنتين${END}`, 'u'), f: () => [2, 2] },
    // "عمره سنه" (= 1)
    { re: new RegExp(`(?:عمره|عمرها|عمر|بعمر)\\s+سنه${END}`, 'u'), f: () => [1, 1] },
    // months: "9 شهور"
    { re: new RegExp(`${NUM}\\s*${AGE_UNIT_M}${END}`, 'u'), f: (m) => { const y = Number(m[1]) / 12; return [y, y]; } },
    // "عمره 7" / "بعمر 7" / "عمر 7" (no unit)
    { re: new RegExp(`(?:عمره|عمرها|عمر|بعمر|بسن|سن)\\s+${NUM}${END}`, 'u'), f: (m) => [Number(m[1]), Number(m[1])] },
    // "7+" / "+7"
    { re: new RegExp(`(?:^|\\s)(?:${NUM}\\s*\\+|\\+\\s*${NUM})${END}`, 'u'), f: (m) => { const n = Number(m[1] ?? m[2]); return [n, n]; } },
    // grade: "صف 3" / "الصف 3" / "صف اول"
    { re: new RegExp(`(?:الصف|صف)\\s+${NUM}${END}`, 'u'), f: (m) => { const g = Number(m[1]); return g >= 1 && g <= 12 ? [g + 5, g + 6] : null; }, grade: true },
    // grade as an ordinal word: "صف تالت" / "الصف الاول" / "صف سادس"
    { re: new RegExp(`(?:الصف|صف)\\s+(${Object.keys(GRADE_ORDINALS).join('|')})${END}`, 'u'), f: (m) => { const g = GRADE_ORDINALS[m[1]]; return [g + 5, g + 6]; } },
    { re: /(?:روضه|بستان|تمهيدي|kg)(?=\s|$)/u, f: () => [4, 6] },
];

function parseAge(text: string, warnings: string[]): { age: AgeIntent | null; rest: string } {
  for (const { re, f } of AGE_RULES) {
    const m = re.exec(text);
    if (!m) continue;
    const r = f(m);
    if (!r) continue;
    let [a, b] = r;
    if (a > b) [a, b] = [b, a];
    if (!(a >= 0 && b <= MAX_AGE_YEARS)) {
      warnings.push('تم تجاهل العمر لأنه غير منطقي.');
      return { age: null, rest: cut(text, m.index, m[0].length) };
    }
    return { age: { min: a, max: b, phrase: m[0].trim() }, rest: cut(text, m.index, m[0].length) };
  }
  // life stage words without a number
  const stage: [RegExp, number, number, string][] = [
    [/(?:^|\s)(?:رضيع|رضيعه|مولود|مولوده|بيبي|baby)(?=\s|$)/u, 0, 1, 'رضيع'],
    [/(?:^|\s)(?:مراهق|مراهقه|teen)(?=\s|$)/u, 13, 17, 'مراهق'],
    [/(?:^|\s)توجيهي(?=\s|$)/u, 17, 18, 'توجيهي'],
  ];
  for (const [re, a, b, phrase] of stage) if (re.test(text)) return { age: { min: a, max: b, phrase }, rest: text };
  return { age: null, rest: text };
}

// Budget markers, written in NORMALIZED form (ى->ي, ة->ه, أ->ا): the text they run on is normalized, so "ما يتعدى"
// must be spelled "ما يتعدي" here. Every marker starts at a word boundary.
/** "مش اقل من 10" / "ما يقل عن 10": a MINIMUM (inclusive), not a maximum */
const BUDGET_MIN_NEG = ['مش اقل من', 'مو اقل من', 'ما يقل عن', 'ما بيقل عن', 'لا يقل عن', 'ما يقل علي', 'لا يقل علي'];
/** "اقل من 10" / "تحت 10": strictly below (10 itself is out) */
const BUDGET_MAX_STRICT = ['اقل من', 'اقل م', 'تحت', 'دون', 'under', 'below', 'less than'];
/** "حتى 10" / "ما يتعدى 10" / "ما يزيد عن 10": at most, 10 included */
const BUDGET_MAX_INCL = [
  'حتي', 'لحد', 'لغايه', 'اقصي', 'اقصاه', 'بحد اقصي', 'كحد اقصي',
  'ما يزيد عن', 'ما يزيد علي', 'ما بيزيد عن', 'ما بزيد عن', 'لا يزيد عن', 'لا يزيد علي', 'مش اكثر من', 'مش اكتر من', 'مو اكثر من',
  'ما يتعدي', 'ما بيتعدي', 'ما يتجاوز', 'ما بيتجاوز', 'لا يتجاوز', 'لا يتعدي', 'ما بدي اكثر من', 'ما بدي اكتر من',
  'ما تتعدي', 'ما بتتعدي', 'ما تزيد عن', 'ما تزيد علي', 'ما بتزيد عن', 'ما تتجاوز', 'ما بتتجاوز', 'لا تتجاوز', 'لا تزيد عن',
  'max', 'up to', 'at most', 'no more than', 'not more than',
];
const alt = (ws: readonly string[]) => [...ws].sort((a, b) => b.length - a.length).join('|');
const AT = '(?:^|\\s)';

const BUDGET_RULES: readonly { re: RegExp; f: (m: RegExpExecArray) => BudgetIntent }[] = [
    { re: new RegExp(`(?:بين|من)\\s*${NUM}\\s*(?:${CUR}\\s*)?(?:و|ل|الى|الي|-|to)\\s*${NUM}\\s*(?:${CUR})?`, 'u'), f: (m) => ({ min: Number(m[1]), max: Number(m[2]), approximate: false }) },
    { re: new RegExp(`${NUM}\\s*-\\s*${NUM}\\s*${CUR}`, 'u'), f: (m) => ({ min: Number(m[1]), max: Number(m[2]), approximate: false }) },
    // before the max rules: "مش اقل من 10" contains "اقل من 10"
    { re: new RegExp(`${AT}(?:${alt(BUDGET_MIN_NEG)})\\s*${NUM}\\s*(?:${CUR})?`, 'u'), f: (m) => ({ min: Number(m[1]), max: null, approximate: false }) },
    // before the strict rule: "ما بدي اكثر من" / "مش اكثر من" never fall to a shorter marker
    { re: new RegExp(`${AT}(?:${alt(BUDGET_MAX_INCL)})\\s*${NUM}\\s*(?:${CUR})?`, 'u'), f: (m) => ({ min: null, max: Number(m[1]), approximate: false }) },
    { re: new RegExp(`${AT}(?:${alt(BUDGET_MAX_STRICT)})\\s*${NUM}\\s*(?:${CUR})?`, 'u'), f: (m) => ({ min: null, max: Number(m[1]), approximate: false, maxExclusive: true }) },
    { re: new RegExp(`(?:اكثر من|اكتر من|فوق|من اول|ابتداء من|over|above|min)\\s*${NUM}\\s*(?:${CUR})`, 'u'), f: (m) => ({ min: Number(m[1]), max: null, approximate: false }) },
    // "بحدود 12" / "ب 12" (from "بـ12" / "باتنعش") — anchored at a word start so "كتب 12" is not read as "ب 12"
    { re: new RegExp(`${AT}(?:بحدود|حدود|حوالي|تقريبا|around|about|budget|ميزانيه|ميزانيتي|ب)\\s*${NUM}\\s*(?:${CUR})?`, 'u'), f: (m) => ({ min: null, max: Number(m[1]), approximate: true }) },
    { re: new RegExp(`${NUM}\\s*${CUR}`, 'u'), f: (m) => ({ min: null, max: Number(m[1]), approximate: true }) },
];

function parseBudget(text: string, warnings: string[]): { budget: BudgetIntent | null; rest: string } {
  for (const { re, f } of BUDGET_RULES) {
    const m = re.exec(text);
    if (!m) continue;
    let b = f(m);
    const vals = [b.min, b.max].filter((v): v is number => v !== null);
    if (vals.some((v) => !Number.isFinite(v) || v <= 0 || v > MAX_BUDGET_JOD)) {
      warnings.push('تم تجاهل الميزانية لأنها غير صالحة.');
      return { budget: null, rest: cut(text, m.index, m[0].length) };
    }
    if (b.min !== null && b.max !== null && b.min > b.max) b = { ...b, min: b.max, max: b.min };
    return { budget: b, rest: cut(text, m.index, m[0].length) };
  }
  return { budget: null, rest: text };
}

const pad = (s: string) => ` ${s} `;

/** Negation markers (normalized, MSA + Jordanian): one word before the phrase, or a two-word form ("ما بدي"). */
const NEGATION_1 = new Set(['مش', 'بدون', 'بلا', 'بلاش', 'غير', 'مو', 'مب', 'ولا', 'لا', 'عدا', 'الا', 'not', 'no', 'without', 'except']);
const NEGATION_2 = new Set(['ما بدي', 'ما بدنا', 'ما بده', 'ما بدها', 'ما بدك', 'مش بدي', 'لا بدي', 'ما اريد', 'لا اريد', 'لا نريد', 'dont want', 'do not', 'not a', 'not an']);

/** true when the token(s) right before position `start` negate what follows ("مش لعبه", "بدون الوان", "ما بدي شنطه"). */
function negatedAt(tokens: string[], start: number): boolean {
  const prev = tokens[start - 1] ?? '';
  const prev2 = tokens[start - 2] ?? '';
  return NEGATION_1.has(prev) || NEGATION_1.has(stripArabicPrefix(prev)) || NEGATION_2.has(`${prev2} ${prev}`);
}

/**
 * Phrase matches on whole tokens, also with Arabic prefixes stripped ("بالرسم" -> "رسم"). Returns the text without them.
 * Each hit says whether it was negated ("مش لعبة" -> the Games hit is negated, i.e. an exclusion).
 */
function takePhrases<T>(text: string, terms: readonly ({ phrase: string } & T)[]): { hits: (T & { negated: boolean; at: number })[]; rest: string } {
  const hits: (T & { negated: boolean; at: number })[] = [];
  const original = tokenize(text);
  let raw = pad(text);
  let stripped = pad(tokenize(text).map(stripArabicPrefix).join(' '));
  for (const t of terms) {
    const needle = pad(t.phrase);
    for (const which of ['raw', 'stripped'] as const) {
      const hay = which === 'raw' ? raw : stripped;
      const i = hay.indexOf(needle);
      if (i < 0) continue;
      // blank the matched tokens in both views (token positions are aligned)
      const startTok = hay.slice(0, i + 1).trim() ? hay.slice(0, i + 1).trim().split(' ').length : 0;
      hits.push({ ...t, negated: negatedAt(original, startTok), at: startTok });
      const n = t.phrase.split(' ').length;
      const blank = (s: string) => { const tk = s.trim().split(' '); for (let k = startTok; k < startTok + n && k < tk.length; k++) tk[k] = '_'; return pad(tk.join(' ')); };
      raw = blank(raw);
      stripped = blank(stripped);
      break;
    }
  }
  return { hits, rest: raw.replace(/(?:^|\s)_(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim() };
}

/** Parses a customer request. Throws DiscoveryInputError for unusable input. */
export function parseDiscoveryQuery(raw: unknown): DiscoveryIntent {
  const query = validateQuery(raw);
  const warnings: string[] = [];
  const normalized = normalizeArabic(query);
  let text = numberWordsToDigits(normalized);

  const a = parseAge(text, warnings);
  text = a.rest;
  const b = parseBudget(text, warnings);
  text = b.rest.replace(/\s+/g, ' ').trim();

  const cat = takePhrases(text, CATEGORY_TERMS);
  text = cat.rest;
  const occ = takePhrases(text, OCCASION_TERMS);
  text = occ.rest;
  const rec = takePhrases(text, RECIPIENT_TERMS);
  text = rec.rest;

  const tokens = tokenize(text);
  const wanted = cat.hits.filter((h) => !h.negated);
  const negated = cat.hits.filter((h) => h.negated);
  const eduTokenAt = tokens.findIndex((t) => EDUCATIONAL_TERMS.includes(t) || EDUCATIONAL_TERMS.includes(stripArabicPrefix(t)));
  const educational = (eduTokenAt >= 0 && !negatedAt(tokens, eduTokenAt))
    || wanted.some((h) => h.category === 'EducationalCards' || (h.sub ?? '').split('|').includes('edu'));
  const wantsOffers = wanted.some((h) => h.category === 'Offers');

  const categories = [...new Set(wanted.map((h) => h.category))].filter((c) => c !== 'Offers') as DiscoveryCategory[];
  // a term may stand for several store types ("قلم" -> pencils|pens|markers)
  const subsOf = (h: { category: string; sub: string | null }) => (h.sub ? h.sub.split('|').map((s) => `${h.category}/${s}`) : []);
  const subCategories = [...new Set(wanted.flatMap(subsOf))];
  // "مش لعبة" excludes the whole category; "بدون الوان" excludes only that type
  const excludeCategories = [...new Set(negated.filter((h) => !h.sub).map((h) => h.category))]
    .filter((c) => c !== 'Offers' && !categories.includes(c)) as DiscoveryCategory[];
  const excludeSubCategories = [...new Set(negated.flatMap(subsOf))]
    .filter((s) => !subCategories.includes(s));
  if (negated.length) warnings.push(`استبعدت: ${negated.map((h) => h.phrase).join('، ')}`);
  const occasions = [...new Set(occ.hits.filter((h) => !h.negated).map((h) => h.occasion))] as Occasion[];
  // most specific recipient wins: baby > boy/girl > child
  const recs = rec.hits.filter((h) => !h.negated).map((h) => h.recipient);
  const recipient: Recipient | null = (['baby', 'teen', 'boy', 'girl', 'adult', 'child'] as Recipient[]).find((r) => recs.includes(r)) ?? null;

  const keywords = cleanKeywordTokens(tokens);
  // matched category words ("مقلمة" -> Stationery): kept separately as a NAME bonus, so they rank a product named that
  // way first without lowering the match percentage of the rest of the category
  const termWords = cleanKeywordTokens(wanted.flatMap((h) => tokenize((h as unknown as { phrase: string }).phrase))).filter((w) => !keywords.includes(w));

  // a recipient word implies a child age range when no age was given
  let age = a.age;
  let ageFrom: 'stated' | 'local_inferred' | null = age ? 'stated' : null;
  if (!age && recipient === 'baby') { age = { min: 0, max: 1, phrase: 'رضيع' }; ageFrom = 'local_inferred'; }

  // every field the local parser filled came from the customer's words (except the inferred baby age)
  const provenance: DiscoveryIntent['provenance'] = {};
  if (b.budget) provenance.budget = 'stated';
  if (ageFrom) provenance.age = ageFrom;
  if (recipient) provenance.recipient = 'stated';
  if (occasions.length) provenance.occasions = 'stated';
  if (categories.length) provenance.categories = 'stated';
  if (subCategories.length) provenance.subCategories = 'stated';
  if (educational) provenance.educational = 'stated';
  if (wantsOffers) provenance.wantsOffers = 'stated';
  if (keywords.length) provenance.keywords = 'stated';
  if (excludeCategories.length) provenance.excludeCategories = 'stated';

  return {
    provenance,
    query,
    normalized,
    budget: b.budget,
    age,
    recipient,
    occasions,
    categories,
    subCategories,
    educational,
    wantsOffers,
    keywords,
    termWords,
    excludeCategories,
    excludeSubCategories,
    needs: needsFromHits(wanted),
    warnings,
  };
}

// ---------------------------------------------------------------- keyword hygiene (local AND AI keywords)
/** units that make a number a PRODUCT SPEC ("100 ورقة", "24 لون", "A4") — kept; any other lone number is dropped */
const SPEC_UNITS: ReadonlySet<string> = new Set(
  ['ورقة', 'ورقه', 'ورق', 'اوراق', 'لون', 'الوان', 'قطعة', 'قطعه', 'قطع', 'صفحة', 'صفحه', 'صفحات', 'سم', 'مم', 'ملم', 'مل', 'لتر', 'غرام', 'جرام',
    'cm', 'mm', 'ml', 'pcs', 'pieces', 'sheets', 'pages', 'colors', 'colours'].map((w) => lightStem(normalizeArabic(w))),
);
const CURRENCY_WORDS: ReadonlySet<string> = new Set(['دينار', 'دنانير', 'jd', 'jod', 'قرش', 'قروش', 'فلس', 'ليرة', 'ليره', 'dinar', 'dinars'].map(normalizeArabic));
const PAPER_SIZE = /^a[3-6]$/;
/** concept words handled by other fields (category, occasion, recipient, educational) — not keywords */
const CONCEPT_WORDS: ReadonlySet<string> = new Set([
  ...CATEGORY_TERMS.flatMap((t) => tokenize(t.phrase)),
  ...OCCASION_TERMS.flatMap((t) => tokenize(t.phrase)),
  ...RECIPIENT_TERMS.flatMap((t) => tokenize(t.phrase)),
  ...EDUCATIONAL_TERMS,
]);

/**
 * Meaningful search words from normalized tokens: no stopwords, negations, currency or lone numbers ("دينار 12"),
 * but a number next to a spec unit ("100 ورقة", "24 لون") and paper sizes ("A4") are kept. Light-stemmed, unique.
 */
export function cleanKeywordTokens(tokens: readonly string[], opts: { dropConcepts?: boolean } = {}): string[] {
  const unitAt = (i: number) => i >= 0 && i < tokens.length && SPEC_UNITS.has(lightStem(tokens[i]));
  const out: string[] = [];
  tokens.forEach((t, i) => {
    if (/^\d+(?:\.\d+)?$/.test(t)) { if (unitAt(i - 1) || unitAt(i + 1)) out.push(t); return; }
    if (PAPER_SIZE.test(t)) { out.push(t); return; }
    const s = stripArabicPrefix(t);
    if (STOPWORDS.has(t) || STOPWORDS.has(s) || NEGATION_1.has(t) || NEGATION_1.has(s) || CURRENCY_WORDS.has(t) || CURRENCY_WORDS.has(s)) return;
    if (EDUCATIONAL_TERMS.includes(t) || EDUCATIONAL_TERMS.includes(s)) return;
    if (opts.dropConcepts && (CONCEPT_WORDS.has(t) || CONCEPT_WORDS.has(s))) return;
    if (/\d/.test(t)) return; // "12jd", "7سنين" glued forms
    const st = lightStem(t);
    if (st.length >= 2) out.push(st);
  });
  return [...new Set(out)];
}

/** every number written in the request (digits or number words) */
export function numbersInQuery(normalized: string): number[] {
  return tokenize(numberWordsToDigits(normalized)).filter((t) => /^\d+(?:\.\d+)?$/.test(t)).map(Number);
}

/** all numbers captured by `rules` anywhere in `text` (every occurrence), plus the text with those spans blanked */
function scanNumbers(text: string, rules: readonly { re: RegExp; grade?: true }[]): { nums: Set<number>; rest: string } {
  const nums = new Set<number>();
  let rest = text;
  for (const { re, grade } of rules) {
    const g = new RegExp(re.source, 'gu');
    for (const m of text.matchAll(g)) {
      if (!grade) m.slice(1).forEach((v) => { if (v !== undefined && /^\d+(?:\.\d+)?$/.test(v)) nums.add(Number(v)); });
      // same-length blanking keeps the positions of later matches valid
      rest = `${rest.slice(0, m.index!)}${' '.repeat(m[0].length)}${rest.slice(m.index! + m[0].length)}`;
    }
  }
  return { nums, rest };
}

/**
 * The numbers the request writes AS an age ("عمره 7", "7 سنين", "بين 6 و 8 سنين") and AS a price ("12 دينار",
 * "بحدود 12", "اقل من 10"), using the same rules as the local parser. A number in any other role — a product spec
 * ("دفتر 100 ورقة", "الوان 24 لون"), a grade, a count — is in neither set. An age number is never a price.
 * Used to check an AI value: being written somewhere in the text is not enough.
 */
export function numbersInContext(normalized: string): { age: Set<number>; budget: Set<number> } {
  const text = numberWordsToDigits(normalized);
  const age = scanNumbers(text, AGE_RULES);
  const budget = scanNumbers(age.rest, BUDGET_RULES);
  // forms the local rules do not read ("سعرها 8 او اقل"): a price word right before the number (<= 2 tokens) and no
  // product-spec unit right after it. Age spans are already blanked, so an age number never qualifies.
  const tk = tokenize(age.rest);
  tk.forEach((t, i) => {
    if (!/^\d+(?:\.\d+)?$/.test(t) || SPEC_UNITS.has(lightStem(tk[i + 1] ?? ''))) return;
    if ([tk[i - 1], tk[i - 2]].some((w) => w !== undefined && (PRICE_CUES.has(w) || PRICE_CUES.has(stripArabicPrefix(w))))) budget.nums.add(Number(t));
  });
  return { age: age.nums, budget: budget.nums };
}

/** words that make the next number a price (normalized) */
const PRICE_CUES: ReadonlySet<string> = new Set([
  'سعر', 'سعره', 'سعرها', 'السعر', 'بسعر', 'ثمن', 'ثمنه', 'ثمنها', 'ميزانيه', 'ميزانيتي', 'الميزانيه', 'يكلف', 'تكلف', 'تكلفه',
  'يتعدي', 'تتعدي', 'يزيد', 'تزيد', 'يتجاوز', 'تتجاوز', 'اقل', 'اكثر', 'اكتر', 'حدود', 'بحدود', 'حوالي', 'حتي', 'لحد',
  'price', 'budget', 'cost', 'under', 'below', 'max',
]);

/**
 * AI is a COMPLEMENT: worth calling only when the local understanding is really unclear — nothing understood, or
 * unknown words left with no product type. A clear request ("هدية تعليمية لطفل 7 سنوات بحدود 12") never needs it.
 */
export function needsAiHelp(i: DiscoveryIntent): boolean {
  if (!hasSignal(i)) return true;
  const topic = (i.needs?.length ?? 0) > 0 || i.categories.length > 0 || i.subCategories.length > 0 || i.educational || i.wantsOffers;
  if (topic) return false;
  return i.keywords.length > 0;
}

/** true when the intent carries at least one usable signal */
export function hasSignal(i: DiscoveryIntent): boolean {
  return Boolean(i.budget || i.age || i.recipient || i.occasions.length || i.categories.length || i.subCategories.length || i.educational || i.wantsOffers || i.keywords.length
    || i.excludeCategories?.length || i.excludeSubCategories?.length);
}

/**
 * Builds an intent from STRUCTURED answers (e.g. the gift finder's buttons) — no text parsing, nothing added that
 * the customer did not choose. `label` is a readable summary used as the intent's query text.
 */
export function buildIntent(fields: {
  label: string;
  budget?: BudgetIntent | null;
  age?: { min: number; max: number } | null;
  recipient?: Recipient | null;
  occasions?: Occasion[];
  categories?: DiscoveryCategory[];
  subCategories?: string[];
  educational?: boolean;
  wantsOffers?: boolean;
}): DiscoveryIntent {
  const label = String(fields.label ?? '').slice(0, MAX_QUERY_LENGTH);
  const age = fields.age && Number.isFinite(fields.age.min) && Number.isFinite(fields.age.max) && fields.age.min <= fields.age.max
    ? { min: fields.age.min, max: fields.age.max, phrase: label } : null;
  // every structured answer is the customer's own choice
  const provenance: DiscoveryIntent['provenance'] = {};
  if (fields.budget) provenance.budget = 'stated';
  if (age) provenance.age = 'stated';
  if (fields.recipient) provenance.recipient = 'stated';
  if (fields.occasions?.length) provenance.occasions = 'stated';
  if (fields.categories?.length) provenance.categories = 'stated';
  if (fields.subCategories?.length) provenance.subCategories = 'stated';
  if (fields.educational) provenance.educational = 'stated';
  if (fields.wantsOffers) provenance.wantsOffers = 'stated';
  return {
    provenance,
    query: label,
    normalized: normalizeArabic(label),
    budget: fields.budget ?? null,
    age,
    recipient: fields.recipient ?? null,
    occasions: [...(fields.occasions ?? [])],
    categories: [...(fields.categories ?? [])],
    subCategories: [...(fields.subCategories ?? [])],
    educational: fields.educational === true,
    wantsOffers: fields.wantsOffers === true,
    keywords: [],
    termWords: [],
    excludeCategories: [],
    excludeSubCategories: [],
    warnings: [],
  };
}
