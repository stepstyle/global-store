// Reviewed product ages — the ONLY source that can make a product "suitable for age X" in the assistant.
//
// Product descriptions mention ages, but many of those sentences are marketing guesses ("similar products are usually
// sold for 3+"). They are never used to RECOMMEND a product; at most they can EXCLUDE one (a "3+" text keeps a toy
// away from a 1-year-old). A product becomes age-suitable only after the store owner approves its age from the
// packaging / manufacturer information — see scripts/product-ages.mjs (review CSV -> src/data/productAges.json).
// The file lives in the repo, so approving ages never writes to Firebase or changes the product documents.

export type SmallParts = 'yes' | 'no' | 'unknown';
export type AgeSource = 'packaging' | 'manufacturer' | 'owner';

export interface ApprovedAge {
  /** youngest suitable age, in years (0.5 = 6 months) */
  minYears: number;
  /** oldest suitable age in years; null = "and up" */
  maxYears: number | null;
  /** small parts / choking hazard per the packaging: anything but 'no' keeps the product away from under-3s */
  smallParts: SmallParts;
  source: AgeSource;
  approvedBy: string;
  approvedAt: string;
  note?: string;
}

export type AgeRegistry = Readonly<Record<string, ApprovedAge>>;

const SOURCES: readonly AgeSource[] = ['packaging', 'manufacturer', 'owner'];
const SMALL: readonly SmallParts[] = ['yes', 'no', 'unknown'];
const years = (v: unknown, lo: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= 99 ? v : null);

/** Keeps only complete, consistent approvals; anything malformed is dropped (= the product stays unconfirmed). */
export function validateAgeRegistry(raw: unknown): AgeRegistry {
  const src = raw && typeof raw === 'object' ? (raw as { products?: unknown }).products ?? raw : null;
  const out: Record<string, ApprovedAge> = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return Object.freeze(out);
  for (const [id, v] of Object.entries(src as Record<string, unknown>)) {
    if (!id || !v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    const min = years(e.minYears, 0);
    const max = e.maxYears == null ? null : years(e.maxYears, 0);
    if (min === null || (e.maxYears != null && (max === null || max < min))) continue;
    if (!SOURCES.includes(e.source as AgeSource) || !SMALL.includes(e.smallParts as SmallParts)) continue;
    if (typeof e.approvedBy !== 'string' || !e.approvedBy.trim() || typeof e.approvedAt !== 'string' || !e.approvedAt.trim()) continue;
    out[id] = Object.freeze({
      minYears: min, maxYears: max, smallParts: e.smallParts as SmallParts, source: e.source as AgeSource,
      approvedBy: e.approvedBy.trim(), approvedAt: e.approvedAt.trim(), ...(typeof e.note === 'string' && e.note ? { note: e.note } : {}),
    });
  }
  return Object.freeze(out);
}

/** Small parts / choking warning written in the store text: enough to EXCLUDE (never to include). */
export function smallPartsWarningInText(normalizedText: string): boolean {
  return /(قطع صغيره|اجزاء صغيره|خطر الاختناق|small parts|choking)/u.test(normalizedText);
}
