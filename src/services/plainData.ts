// Is a value plain JSON data (strings, numbers, booleans, null, arrays, plain objects)? A Firestore special value
// (Timestamp, GeoPoint, DocumentReference, Bytes…) is an instance of a class. Used by the catalogue read (storage.ts):
// documents read with Firestore Lite are used only when they are plain, so an admin save through the full SDK never
// writes another SDK's object back.
export const hasSpecialValue = (v: unknown): boolean => {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.some(hasSpecialValue);
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return true;
  return Object.values(v as Record<string, unknown>).some(hasSpecialValue);
};
