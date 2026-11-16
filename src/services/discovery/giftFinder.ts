// SmartFinder (gift finder) answers -> DiscoveryIntent. Only what the customer chose; nothing is added or guessed
// (no budget is asked, so none is set; "who" never implies an age because age is its own question).
import { buildIntent } from './intent.ts';
import type { DiscoveryCategory, DiscoveryIntent, Recipient } from './types.ts';

export type GiftWho = 'boy' | 'girl' | 'baby';
export type GiftAge = '0-3' | '0-1' | '1-2' | '2-3' | '4-7' | '8-12' | '+13';
export type GiftInterest = 'educational' | 'fun' | 'art';
export interface GiftFinderAnswers { who?: string; age?: string; interest?: string }

/**
 * The age buttons, exactly as labelled in the finder. "0-3" is too wide to recommend safely, so the finder asks the
 * follow-up "0-1 / 1-2 / 2-3"; if "0-3" still reaches the engine it answers with a clarification, not products.
 */
export const GIFT_AGE_RANGES: Readonly<Record<GiftAge, { min: number; max: number }>> = Object.freeze({
  '0-3': { min: 0, max: 3 },
  '0-1': { min: 0, max: 1 },
  '1-2': { min: 1, max: 2 },
  '2-3': { min: 2, max: 3 },
  '4-7': { min: 4, max: 7 },
  '8-12': { min: 8, max: 12 },
  '+13': { min: 13, max: 99 },
});

const WHO: Readonly<Record<GiftWho, { recipient: Recipient; ar: string }>> = Object.freeze({
  boy: { recipient: 'boy', ar: 'ولد' },
  girl: { recipient: 'girl', ar: 'بنت' },
  baby: { recipient: 'baby', ar: 'بيبي' },
});

/** The three interest buttons and what their own labels promise (store categories only). */
const INTEREST: Readonly<Record<GiftInterest, { categories: DiscoveryCategory[]; educational: boolean; ar: string }>> = Object.freeze({
  // "تفكير وذكاء (تركيب، بازل، تعليمي)"
  educational: { categories: [], educational: true, ar: 'تفكير وذكاء' },
  // "مرح وتسلية (سيارات، دمى، ألعاب جماعية)"
  fun: { categories: ['Games'], educational: false, ar: 'مرح وتسلية' },
  // "رسم وإبداع (تلوين، معجون، قرطاسية)"
  art: { categories: ['ArtSupplies', 'Stationery'], educational: false, ar: 'رسم وإبداع' },
});

/** Unknown / missing answers are simply left out (the finder may be extended later). */
export function giftFinderIntent(answers: GiftFinderAnswers): DiscoveryIntent {
  const who = WHO[answers.who as GiftWho];
  const age = GIFT_AGE_RANGES[answers.age as GiftAge];
  const interest = INTEREST[answers.interest as GiftInterest];
  const label = ['هدية', who && `لـ${who.ar}`, age && `عمر ${answers.age}`, interest && interest.ar].filter(Boolean).join(' · ');
  return buildIntent({
    label,
    occasions: ['gift'], // the finder asks "لمن تبحث عن الهدية؟"
    recipient: who?.recipient ?? null,
    age: age ?? null,
    categories: interest?.categories ?? [],
    educational: interest?.educational ?? false,
  });
}
