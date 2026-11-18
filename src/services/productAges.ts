// The owner-approved product ages bundled with the site (src/data/productAges.json, written by
// scripts/product-ages.mjs apply). Read-only; never written to Firebase.
import approvedAges from '../data/productAges.json';
import { validateAgeRegistry } from './discovery/ageRegistry.ts';

export const PRODUCT_AGES = validateAgeRegistry(approvedAges);
