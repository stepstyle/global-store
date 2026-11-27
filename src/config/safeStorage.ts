// src/config/safeStorage.ts
// Imported by main.tsx right after the network guard, before the app. When the browser refuses web storage (cookies /
// site data blocked: Safari "Block All Cookies", Chrome "Block third-party and first-party", some managed / in-app
// browsers), every localStorage / sessionStorage call throws a SecurityError — and the app, which reads them while
// starting (language, cart, wishlist, catalogue cache…), stopped with a BLANK page.
// Here, ONLY in that case, each refused storage is replaced by an in-memory one for this page: the store works (the cart
// and the checkout draft live until the page is closed / reloaded). A browser whose storage works is not touched.
// Nothing here is a protection or a limit: it is comfort only (the Worker decides orders, prices and spins).

export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  const s = {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(String(k)) ? (m.get(String(k)) as string) : null),
    setItem: (k: string, v: string) => { m.set(String(k), String(v)); },
    removeItem: (k: string) => { m.delete(String(k)); },
    clear: () => { m.clear(); },
  };
  return s as Storage;
}

/** true when this storage can be read AND written (a refused one throws on access or on use) */
export function storageWorks(get: () => Storage | null | undefined): boolean {
  try {
    const s = get();
    if (!s) return false;
    const k = '__anta_storage_probe__';
    s.setItem(k, '1');
    const ok = s.getItem(k) === '1';
    s.removeItem(k);
    return ok;
  } catch {
    return false;
  }
}

/** which storages had to be replaced on this page (for tests / diagnostics) */
export const replacedStorages: string[] = [];

export function installSafeStorage(w: (Window & typeof globalThis) | undefined = typeof window !== 'undefined' ? window : undefined): void {
  if (!w) return;
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (storageWorks(() => w[name])) continue;
    try {
      Object.defineProperty(w, name, { value: memoryStorage(), configurable: true, enumerable: true, writable: false });
      replacedStorages.push(name);
    } catch { /* the browser refused the replacement: nothing more can be done */ }
  }
}

installSafeStorage();
