// Personal data never reaches a model, a cache key or a log.
// Removes e-mails, URLs, phone numbers (Jordanian and international) and long digit runs (card / ID numbers) BEFORE
// the text is used. Budgets ("12 دينار") and ages ("7 سنين") are short numbers and stay.
import { toLatinDigits } from '../../../src/services/discovery/arabicText.ts';

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
// 7+ digits, allowing spaces / dashes / dots / parentheses inside and a leading + (phones, cards, national IDs)
const LONG_NUMBER = /\+?\d[\d\s().-]{5,}\d/g;

/** @returns {{ text: string, redactions: number }} */
export function redactPersonalData(input) {
  let redactions = 0;
  const count = (label) => () => { redactions++; return ` ${label} `; };
  let t = toLatinDigits(String(input ?? ''));
  t = t.replace(EMAIL, count('[email]'));
  t = t.replace(URL_RE, count('[link]'));
  t = t.replace(LONG_NUMBER, (m) => (m.replace(/\D/g, '').length >= 7 ? count('[number]')() : m));
  return { text: t.replace(/\s+/g, ' ').trim(), redactions };
}
