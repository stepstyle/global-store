// Reading the saved cart (localStorage 'anta_cart') safely.
//
// The cart state is initialised from storage synchronously (useState lazy initializer in App.tsx), so the first
// render already holds the saved cart and the "save cart on change" effect can never write an empty cart over it
// — including React.StrictMode's double effect run in development and a page reload.

export const CART_STORAGE_KEY = 'anta_cart';

type StorageLike = { getItem(key: string): string | null };

const isCartItem = (v: unknown): boolean => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const id = (v as { id?: unknown }).id;
  return (typeof id === 'string' && id.length > 0) || (typeof id === 'number' && Number.isFinite(id));
};

/**
 * The saved cart, or [] when nothing usable is stored. Never throws: storage that cannot be read (blocked /
 * private mode), invalid JSON, a non-array value, and entries that are not cart items (no id) are all handled.
 */
export function readStoredCart<T = any>(storage: StorageLike | null | undefined): T[] {
  let raw: string | null = null;
  try {
    raw = storage ? storage.getItem(CART_STORAGE_KEY) : null;
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isCartItem) as T[];
}

/** localStorage when it exists and can be touched, otherwise null (SSR / blocked storage). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}
