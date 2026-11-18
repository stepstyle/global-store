// Run: node --test tests/unit/arabicSearch.test.mjs   (Node 22.6+ strips the TypeScript types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeArabic, parseQuery, wordVariants, matchProduct, productSearchEntry, departmentsNamedBy,
} from '../../src/utils/arabicSearch.ts';

// Products shaped like the live catalogue, including its real over-tagging (sub-categories that do not describe the
// product). Sub-categories are kept on purpose: the search must ignore them.
const P = {
  pencils: { name: 'أقلام رصاص STAEDTLER Noris 120 HB – علبة 12 قلم', category: 'Stationery',
    subcategory: 'school-bags,pencils,pencil-cases,lunch-bags,erasers-sharpeners,notebooks' },
  schoolBag: { name: 'حقيبة ظهر مدرسية بتصميم فضاء', category: 'Stationery', subcategory: 'school-bags' },
  pencilCase: { name: 'حافظة أقلام بسحاب مزدوج', category: 'Stationery', subcategory: 'pencil-cases' },
  squishy: { name: 'سكويشي دب جيلي سوبر سوليد – وردي', category: 'Games',
    subcategory: 'all-toys,drawing-coloring,girls-toys,sensory-toys' },
  tricycle: { name: 'بسكليت دراجة أطفال ثلاثية العجلات بمقعدين وسلة أمامية', category: 'BabyGear', subcategory: 'bicycles' },
  slide: { name: 'سحسيله أطفال بلاستيكية مع سلم 3 درجات', category: 'BabyGear',
    subcategory: 'bicycles,scooters,strollers,ride-on-cars' },
  watch: { name: 'ساعة SKMEI عصرية فائقة الرقة', category: 'Gifts', subcategory: 'gift-boxes,wrapping-paper' },
  colors: { name: 'ألوان خشبية 24 لون', category: 'Stationery', subcategory: 'colors-markers' },
  animalPuzzle: { name: 'بازل حيوانات خشبي', category: 'Games', subcategory: 'wooden-toys' },
  pelikan: { name: 'أقلام رصاص بيليكان HB مع ممحاة', nameEn: 'Pelikan HB pencils with eraser', brand: 'Pelikan',
    category: 'Stationery', subcategory: 'pencils' },
};
const entries = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, productSearchEntry(p)]));
const find = (q) => {
  const query = parseQuery(q);
  return Object.entries(entries).filter(([, e]) => matchProduct(e, query)).map(([k]) => k).sort();
};
const how = (q, key) => matchProduct(entries[key], parseQuery(q));

test('normalization folds hamza, ta marbuta, alef maqsura, diacritics, tatweel and Arabic digits', () => {
  assert.equal(normalizeArabic('ألعاب'), 'العاب');
  assert.equal(normalizeArabic('إبرة آمنة'), 'ابره امنه');
  assert.equal(normalizeArabic('لعبة'), normalizeArabic('لعبه'));
  assert.equal(normalizeArabic('هدى'), 'هدي');
  assert.equal(normalizeArabic('مَكْتَبَة'), 'مكتبه');
  assert.equal(normalizeArabic('قـــلم'), 'قلم');
  assert.equal(normalizeArabic('٠٧٩٦٠٤٧٦٣٧'), '0796047637');
  assert.equal(normalizeArabic('STAEDTLER  Noris'), 'staedtler noris');
});

test('Arabic spellings and dialect words find the right products by name', () => {
  assert.deepEqual(find('شنطة'), ['schoolBag']);
  assert.deepEqual(find('شنط'), ['schoolBag']);
  assert.deepEqual(find('شنطه مدرسه'), ['schoolBag']);
  assert.deepEqual(find('مقلمة'), ['pencilCase']);
  assert.deepEqual(find('مقالم'), ['pencilCase']);
  assert.deepEqual(find('بسكليت'), ['tricycle']);
  assert.deepEqual(find('دراجه'), ['tricycle']);
  assert.deepEqual(find('ساعه'), ['watch']);
  assert.deepEqual(find('الوان'), ['colors']);
  assert.ok(find('اقلام').includes('pencils'));
  assert.equal(how('شنطة', 'schoolBag'), 'name');
});

test('a category or sub-category label alone never makes a match (over-tagged products)', () => {
  // live: «bag» listed watches through the sub-category «Wrapping Paper & Bags»
  assert.ok(!find('bag').includes('watch'));
  // live: STAEDTLER pencils are tagged school-bags / pencil-cases / lunch-bags
  assert.ok(!find('شنطة').includes('pencils'));
  assert.ok(!find('مقلمة').includes('pencils'));
  assert.ok(!find('لانش بوكس').includes('pencils'));
  // live: a plastic slide is tagged scooters / bicycles
  assert.deepEqual(find('سكوتر'), []);
  assert.ok(!find('بسكليت').includes('slide'));
  // live: squishies are tagged drawing-coloring
  assert.ok(!find('الوان').includes('squishy'));
  assert.ok(!find('تلوين').includes('squishy'));
});

test('searching a department name lists that department (Arabic and English)', () => {
  assert.deepEqual(find('العاب'), ['animalPuzzle', 'squishy']);
  assert.deepEqual(find('ألعاب'), find('العاب'));
  assert.deepEqual(find('لعبه'), find('العاب'));
  assert.deepEqual(find('toys'), find('العاب'));
  assert.deepEqual(find('هدايا'), ['watch']);
  assert.deepEqual(find('gifts'), ['watch']);
  assert.deepEqual(find('قرطاسية'), ['colors', 'pelikan', 'pencilCase', 'pencils', 'schoolBag']);
  assert.equal(how('العاب', 'squishy'), 'department');
  assert.deepEqual([...departmentsNamedBy(parseQuery('العروض'))], ['Offers']);
  // a department word inside a longer query is an ordinary word, not a department listing
  assert.equal(departmentsNamedBy(parseQuery('العاب خشبية')).size, 0);
  assert.equal(departmentsNamedBy(parseQuery('bag')).size, 0);
});

test('no false positives from over-eager stripping or short tokens', () => {
  assert.ok(!find('الوان').includes('animalPuzzle')); // «الوان» must not shrink to «وان» and match «حيوانات»
  assert.ok(!wordVariants('الوان').includes('وان'));
  assert.ok(!wordVariants('العاب').includes('عاب'));
  assert.ok(wordVariants('الدفاتر').includes('دفاتر'));
  assert.ok(wordVariants('القلم').includes('قلم'));
  assert.equal(parseQuery('ا').groups.length, 0);
  assert.deepEqual(find('حقيبه بسكليت'), []); // every word must match (AND)
});

test('English and brand search keep working', () => {
  assert.deepEqual(find('staedtler'), ['pencils']);
  assert.deepEqual(find('SKMEI'), ['watch']);
  assert.deepEqual(find('pelikan'), ['pelikan']);
  assert.deepEqual(find('pencils'), ['pelikan']);
  assert.deepEqual(find('12 قلم'), ['pencils']);
  assert.deepEqual(find('lego'), []);
});

test('empty query matches everything (no filter)', () => {
  assert.equal(find('').length, Object.keys(P).length);
  assert.equal(find('   ').length, Object.keys(P).length);
});
