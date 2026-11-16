// The app's ProductSource: the EXISTING store data layer (storage.ts db.products.getAll). No new data access path.
// In `vite` dev this is the Firebase Emulator (demo- project, enforced by firebaseTarget.ts / firebase-env-guard).
import { db } from '../storage';
import type { ProductSource } from './index.ts';

export const storeProductSource: ProductSource = {
  listProducts: () => db.products.getAll(),
};
