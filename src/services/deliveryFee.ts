// Delivery fees shown at checkout — read from the order Worker's OWN pricing table (the reference the Worker enforces:
// PRICE_CHECK_MODE=enforce refuses any order whose delivery differs). No price is written here, so the page and the
// Worker cannot disagree again (2026-11-28: 7 Amman areas were refused PRICE_CHANGED because this page had its own
// copy). The owner approved the Worker's prices. Only the names live here; tests/unit/deliveryFee.test.mjs checks every
// area and method against the Worker's shippingFor().
import { AMMAN_AREA_PRICES, OUTSIDE_AMMAN_SHIPPING, FAST_DELIVERY_SURCHARGE } from '../../workers/order-worker/src/pricing-config.js';

export type AmmanArea = { id: string; nameAr: string; nameEn: string; price: number; isOutskirt: boolean };

const AREA_NAMES: Array<Omit<AmmanArea, 'price'>> = [
  { id: 'a1', nameAr: 'النزهة / طبربور / طارق / ضاحية الأمير حسن', nameEn: 'Nuzha / Tabarbour / Tariq / Dahiyet Al Amir Hassan', isOutskirt: false },
  { id: 'a2', nameAr: 'جبل الحسين / اللويبدة / العبدلي', nameEn: 'Jabal Hussein / Lweibdeh / Abdali', isOutskirt: false },
  { id: 'a3', nameAr: 'الهاشمي الشمالي والجنوبي / ماركا', nameEn: 'Hashimi / Marka', isOutskirt: false },
  { id: 'a4', nameAr: 'ضاحية الأقصى / الاستقلال', nameEn: 'Dahiyet Al Aqsa / Istiqlal', isOutskirt: false },
  { id: 'a5', nameAr: 'وسط البلد / الأشرفية / الوحدات', nameEn: 'Downtown / Ashrafieh / Wehdat', isOutskirt: false },
  { id: 'a6', nameAr: 'تلاع العلي / خلدا / أم السماق', nameEn: 'Tlaa Al Ali / Khalda / Um Al Summaq', isOutskirt: false },
  { id: 'a7', nameAr: 'الشميساني / عبدون / دير غبار / الصويفية', nameEn: 'Shmeisani / Abdoun / Sweifieh', isOutskirt: false },
  { id: 'a8', nameAr: 'الدوار السابع والثامن / البيادر', nameEn: '7th & 8th Circle / Bayader', isOutskirt: false },
  { id: 'a9', nameAr: 'الجبيهة / أبو نصير / شفا بدران', nameEn: 'Jubeiha / Abu Nuseir / Shafa Badran', isOutskirt: false },
  { id: 'a10', nameAr: 'دابوق / بدر الجديدة / الفحيص', nameEn: 'Dabouq / Badr Al Jadeedah', isOutskirt: false },
  { id: 'a11', nameAr: 'مرج الحمام / المقابلين / البنيات', nameEn: 'Marj Al Hamam / Muqabalain', isOutskirt: false },
  { id: 'a12', nameAr: 'سحاب / أبو علندا / اليادودة', nameEn: 'Sahab / Abu Alanda / Yadoudeh', isOutskirt: true },
  { id: 'a13', nameAr: 'الجيزة / خريبة السوق / القسطل', nameEn: 'Jizah / Khreibet Souq', isOutskirt: true },
  { id: 'a14', nameAr: 'ناعور / طريق المطار', nameEn: 'Naour / Airport Road', isOutskirt: true },
  // the fallback choice
  { id: 'other', nameAr: 'منطقة أخرى (غير مذكورة في القائمة)', nameEn: 'Other Area (Not Listed)', isOutskirt: true },
];

const PRICES = AMMAN_AREA_PRICES as Record<string, number>;

/** the Amman areas the customer can pick, each with the Worker's price (an area the Worker does not price is left out) */
export const AMMAN_AREAS: AmmanArea[] = AREA_NAMES.filter((a) => typeof PRICES[a.id] === 'number').map((a) => ({ ...a, price: PRICES[a.id] }));

export const OUTSIDE_AMMAN_FEE: number = OUTSIDE_AMMAN_SHIPPING;
export const FAST_SURCHARGE: number = FAST_DELIVERY_SURCHARGE;

/** the standard delivery fee, or null while it cannot be known yet (no governorate, or Amman without an area) */
export function baseDeliveryFee(citySlug: string | null | undefined, ammanAreaId: string | null | undefined): number | null {
  if (!citySlug) return null;
  if (citySlug === 'amman') return ammanAreaId && typeof PRICES[ammanAreaId] === 'number' ? PRICES[ammanAreaId] : null;
  return OUTSIDE_AMMAN_FEE;
}
