// Allergens: the 14 of the EU list + almonds apart (very common in Moroccan pâtisserie).
// 'nuts' means the OTHER tree nuts (walnut, hazelnut, pistachio, cashew...). The codes are the same in the
// database (supabase/migrations/20261209000100_allergens.sql), the back office and the guest menu.

export const ALLERGEN_CODES = [
  'gluten', 'eggs', 'milk', 'almonds', 'nuts', 'peanuts', 'sesame', 'soy', 'fish',
  'crustaceans', 'molluscs', 'sulphites', 'celery', 'mustard', 'lupin',
] as const;
export type AllergenCode = typeof ALLERGEN_CODES[number];

export const ALLERGEN_NAMES: Record<AllergenCode, { fr: string; en: string; ar: string }> = {
  gluten:      { fr: 'Gluten',                        en: 'Gluten',          ar: 'الغلوتين' },
  eggs:        { fr: 'Œufs',                          en: 'Eggs',            ar: 'البيض' },
  milk:        { fr: 'Lait',                          en: 'Milk',            ar: 'الحليب' },
  almonds:     { fr: 'Amandes',                       en: 'Almonds',         ar: 'اللوز' },
  nuts:        { fr: 'Autres fruits à coque',         en: 'Other tree nuts', ar: 'مكسرات أخرى' },
  peanuts:     { fr: 'Arachides',                     en: 'Peanuts',         ar: 'الفول السوداني' },
  sesame:      { fr: 'Sésame',                        en: 'Sesame',          ar: 'السمسم' },
  soy:         { fr: 'Soja',                          en: 'Soy',             ar: 'الصويا' },
  fish:        { fr: 'Poisson',                       en: 'Fish',            ar: 'السمك' },
  crustaceans: { fr: 'Crustacés',                     en: 'Crustaceans',     ar: 'القشريات' },
  molluscs:    { fr: 'Mollusques',                    en: 'Molluscs',        ar: 'الرخويات' },
  sulphites:   { fr: 'Sulfites',                      en: 'Sulphites',       ar: 'الكبريتيت' },
  celery:      { fr: 'Céleri',                        en: 'Celery',          ar: 'الكرفس' },
  mustard:     { fr: 'Moutarde',                      en: 'Mustard',         ar: 'الخردل' },
  lupin:       { fr: 'Lupin',                         en: 'Lupin',           ar: 'الترمس' },
};

export const ALLERGEN_ICON: Record<AllergenCode, string> = {
  gluten: '🌾', eggs: '🥚', milk: '🥛', almonds: '🌰', nuts: '🌰', peanuts: '🥜', sesame: '⚪', soy: '🫘',
  fish: '🐟', crustaceans: '🦐', molluscs: '🐚', sulphites: '🍷', celery: '🥬', mustard: '🟡', lupin: '🌼',
};

/** Name of an allergen in a language (fr, en, ar; anything else shows French). Unknown codes come back as they are. */
export function allergenName(code: string, lang: string): string {
  const n = (ALLERGEN_NAMES as Record<string, { fr: string; en: string; ar: string }>)[code];
  if (!n) return code;
  return lang === 'ar' ? n.ar : lang === 'en' ? n.en : n.fr;
}
export const allergenIcon = (code: string): string => (ALLERGEN_ICON as Record<string, string>)[code] ?? '';

/** What the guest menu gets from get_menu_allergens: per product, ok = fully checked; a = allergens; m = possible traces. */
export interface GuestAllergens { items: Record<string, { ok: boolean; a: string[]; m: string[] }> }

/** One product as the back office sees it (allergen_overview). */
export interface ItemAllergens {
  item_id: string; allergens: string[]; may_contain: string[]; has_recipe: boolean;
  state: 'complete' | 'incomplete'; confirmed: boolean; calculated: string[]; add: string[]; remove: string[];
}
export interface AllergenOverview {
  show_allergens: boolean;
  items: ItemAllergens[];
  preparations: { ingredient_id: string; allergens: string[]; may_contain: string[]; complete: boolean }[];
  missing: string[];
}
