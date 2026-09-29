// Back office languages: French (default) and Arabic (right to left).
//
// The French text is the key: t('Enregistrer') returns the Arabic translation
// when the back office is in Arabic, otherwise the French text itself. A missing
// translation therefore shows French, never a blank. Variables: t('Table {n}', { n: 5 }).
// Restaurant data (menu content, names) and the accounting CSV stay as they are.

import { AR } from './i18n-ar';

export type Lang = 'fr' | 'ar';
const KEY = 'admin-lang';
let current: Lang = 'fr';

export const getLang = () => current;
/** Locale for dates on screen. Western digits in both languages. */
export const dateLocale = () => (current === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-FR');

export function applyLang(l: Lang) {
  current = l;
  const root = document.documentElement;
  root.lang = l;
  root.dir = l === 'ar' ? 'rtl' : 'ltr';
}

export function readLang(): Lang {
  // ?lang=ar from the website wins (and is remembered)
  const q = new URLSearchParams(window.location.search).get('lang');
  if (q === 'ar' || q === 'fr') { saveLang(q); return q; }
  try { return localStorage.getItem(KEY) === 'ar' ? 'ar' : 'fr'; } catch { return 'fr'; }
}
export function saveLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* private mode: keep it for this session only */ }
}

export function t(fr: string, vars?: Record<string, string | number>): string {
  let s = current === 'ar' ? (AR[fr] ?? fr) : fr;
  if (import.meta.env.DEV && current === 'ar' && !(fr in AR)) console.warn('[i18n] missing ar:', fr);
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  return s;
}

export const LANGS: { id: Lang; label: string }[] = [{ id: 'fr', label: 'Français' }, { id: 'ar', label: 'العربية' }];
