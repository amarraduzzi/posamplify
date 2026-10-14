// Till languages: French (default), Arabic (right to left) and English.
//
// The French text is the key: t('Encaisser') returns the Arabic translation
// when the till is in Arabic, otherwise the French text itself. A missing
// translation therefore shows French, never a blank. Variables: t('{n} min', { n: 5 }).
// Printed tickets stay in French: thermal printers print Latin characters only.

import { AR } from './i18n-ar';
import { EN } from './i18n-en';

export type Lang = 'fr' | 'ar' | 'en';
export const isLang = (x: unknown): x is Lang => x === 'fr' || x === 'ar' || x === 'en';
let current: Lang = 'fr';

export const getLang = () => current;

export function applyLang(l: Lang) {
  current = l;
  const root = document.documentElement;
  root.lang = l;
  root.dir = l === 'ar' ? 'rtl' : 'ltr';
}

export function t(fr: string, vars?: Record<string, string | number>): string {
  const dict = current === 'ar' ? AR : current === 'en' ? EN : null;
  let s = dict ? (dict[fr] ?? fr) : fr;
  if (import.meta.env.DEV && dict && !(fr in dict)) console.warn(`[i18n] missing ${current}:`, fr);
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  return s;
}

/** "3 commande(s)" style plurals are kept simple on purpose: one form per language. */
export const LANGS: { id: Lang; label: string; short: string }[] = [{ id: 'fr', label: 'Français', short: 'FR' }, { id: 'ar', label: 'العربية', short: 'ع' }, { id: 'en', label: 'English', short: 'EN' }];
/** The next language for the one-tap switch in the header (FR → ع → EN → FR). */
export const nextLang = (l: Lang): Lang => LANGS[(LANGS.findIndex(x => x.id === l) + 1) % LANGS.length].id;
