// Till languages: French (default) and Arabic (right to left).
//
// The French text is the key: t('Encaisser') returns the Arabic translation
// when the till is in Arabic, otherwise the French text itself. A missing
// translation therefore shows French, never a blank. Variables: t('{n} min', { n: 5 }).
// Printed tickets stay in French: thermal printers print Latin characters only.

import { AR } from './i18n-ar';

export type Lang = 'fr' | 'ar';
let current: Lang = 'fr';

export const getLang = () => current;

export function applyLang(l: Lang) {
  current = l;
  const root = document.documentElement;
  root.lang = l;
  root.dir = l === 'ar' ? 'rtl' : 'ltr';
}

export function t(fr: string, vars?: Record<string, string | number>): string {
  let s = current === 'ar' ? (AR[fr] ?? fr) : fr;
  if (import.meta.env.DEV && current === 'ar' && !(fr in AR)) console.warn('[i18n] missing ar:', fr);
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  return s;
}

/** "3 commande(s)" style plurals are kept simple on purpose: one form per language. */
export const LANGS: { id: Lang; label: string }[] = [{ id: 'fr', label: 'Français' }, { id: 'ar', label: 'العربية' }];
