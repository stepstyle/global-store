// Arabic text helpers for AI Product Discovery. Pure functions: no imports, no I/O.
//
// normalizeArabic() folds the spelling variants customers actually type (hamza forms, taa marbuta, alef maqsura,
// diacritics, tatweel, Arabic-Indic digits) so "هدية" / "هديه" / "هَدِيّة" compare equal. Every lookup table in the
// discovery module is written in this normalized form.

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits -> 0-9; Arabic decimal/thousands separators -> '.' / ''. */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, '');
}

/** Lower-case, digit-folded, Arabic-folded text with single spaces. Punctuation becomes a space (except '.' between digits, '+', '-'). */
export function normalizeArabic(input: string): string {
  return toLatinDigits(String(input ?? ''))
    .normalize('NFKC')
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/(\d)[.,](\d)/g, '$1\u0000$2') // keep decimals
    .replace(/[^\p{L}\p{N}\s+\-\u0000]/gu, ' ')
    .replace(/\u0000/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Arabic prefixes stripped for matching (longest first): وال، بال، لل، ال، و، ب، ل، ف، ك. Keeps at least 2 letters. */
const PREFIXES = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال', 'و', 'ب', 'ل', 'ف', 'ك'];
export function stripArabicPrefix(token: string): string {
  for (const p of PREFIXES) {
    if (token.startsWith(p) && token.length - p.length >= 3) return token.slice(p.length);
  }
  return token;
}

/** Light stem for matching: prefix + common plural/feminine endings (ات، ين، ون، ه). */
export function lightStem(token: string): string {
  let t = stripArabicPrefix(token);
  for (const s of ['ات', 'ين', 'ون', 'يه', 'ه']) {
    if (t.endsWith(s) && t.length - s.length >= 3) {
      t = t.slice(0, -s.length);
      break;
    }
  }
  return t;
}

export function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

/**
 * Number words (normalized spelling), incl. Jordanian/Levantine forms (تلاته، تمنيه، حداعش، اطنعش…).
 * Covers what customers write for ages and small budgets.
 */
export const NUMBER_WORDS: Readonly<Record<string, number>> = Object.freeze({
  صفر: 0,
  واحد: 1, وحده: 1, واحده: 1,
  اثنين: 2, اتنين: 2, ثنتين: 2, تنتين: 2, اثنتين: 2,
  ثلاث: 3, ثلاثه: 3, تلات: 3, تلاته: 3,
  اربع: 4, اربعه: 4,
  خمس: 5, خمسه: 5,
  ست: 6, سته: 6,
  سبع: 7, سبعه: 7,
  ثمان: 8, ثماني: 8, ثمانيه: 8, تمن: 8, تمنيه: 8, تماني: 8,
  تسع: 9, تسعه: 9,
  عشر: 10, عشره: 10,
  احدعش: 11, حداعش: 11, احدعشر: 11,
  اثنعش: 12, اطنعش: 12, اثناعشر: 12, اثنا: 12,
  ثلاثطعش: 13, تلطعش: 13, تلتعش: 13,
  اربعطعش: 14, اربعتعش: 14,
  خمسطعش: 15, خمستعش: 15,
  ستطعش: 16, ستعش: 16,
  سبعطعش: 17, سبعتعش: 17,
  ثمنطعش: 18, تمنطعش: 18, تمنتعش: 18,
  تسعطعش: 19, تسعتعش: 19,
  عشرين: 20, ثلاثين: 30, تلاتين: 30, اربعين: 40, خمسين: 50, ستين: 60, سبعين: 70, ثمانين: 80, تمانين: 80, تسعين: 90,
  ميه: 100, مايه: 100, مئه: 100, مية: 100,
});

/** Replaces number words by digits ("سبع سنين" -> "7 سنين"); also "نص" -> 0.5 after a number ("5 ونص" -> "5.5"). */
export function numberWordsToDigits(normalized: string): string {
  const tokens = tokenize(normalized).map((t) => {
    if (t in NUMBER_WORDS) return String(NUMBER_WORDS[t]);
    // "بخمسه" / "لعشره" / "وعشرين"
    for (const p of ['ب', 'ل', 'و']) {
      if (t.startsWith(p) && t.slice(1) in NUMBER_WORDS) return `${p} ${NUMBER_WORDS[t.slice(1)]}`;
    }
    return t;
  });
  // note: \b is ASCII-only in JS regexes, so Arabic word ends use (?=\s|$)
  return tokens.join(' ').replace(/(\d+) و ?نص(?=\s|$)/g, (_, n) => String(Number(n) + 0.5)).replace(/\s+/g, ' ').trim();
}
