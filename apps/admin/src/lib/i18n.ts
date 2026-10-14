// Back office languages: French (default), Arabic (right to left) and English.
//
// The French text is the key: t('Enregistrer') returns the Arabic translation
// when the back office is in Arabic, otherwise the French text itself. A missing
// translation therefore shows French, never a blank (the same for English). Variables: t('Table {n}', { n: 5 }).
// Restaurant data (menu content, names) and the accounting CSV stay as they are.

import { AR } from './i18n-ar';
import { EN } from './i18n-en';

export type Lang = 'fr' | 'ar' | 'en';
const isLang = (x: unknown): x is Lang => x === 'fr' || x === 'ar' || x === 'en';
const KEY = 'admin-lang';
let current: Lang = 'fr';

export const getLang = () => current;
/** Locale for dates on screen. Western digits in both languages. */
export const dateLocale = () => (current === 'ar' ? 'ar-MA-u-nu-latn' : current === 'en' ? 'en-GB' : 'fr-FR');

export function applyLang(l: Lang) {
  current = l;
  const root = document.documentElement;
  root.lang = l;
  root.dir = l === 'ar' ? 'rtl' : 'ltr';
}

export function readLang(): Lang {
  // ?lang=ar from the website wins (and is remembered)
  const q = new URLSearchParams(window.location.search).get('lang');
  if (isLang(q)) { saveLang(q); return q; }
  try { const s = localStorage.getItem(KEY); return isLang(s) ? s : 'fr'; } catch { return 'fr'; }
}
export function saveLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* private mode: keep it for this session only */ }
}

export function t(fr: string, vars?: Record<string, string | number>): string {
  const dict = current === 'ar' ? AR : current === 'en' ? EN : null;
  let s = dict ? (dict[fr] ?? fr) : fr;
  if (import.meta.env.DEV && dict && !(fr in dict)) console.warn(`[i18n] missing ${current}:`, fr);
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  return s;
}

export const LANGS: { id: Lang; label: string; short: string }[] = [{ id: 'fr', label: 'Français', short: 'FR' }, { id: 'ar', label: 'العربية', short: 'ع' }, { id: 'en', label: 'English', short: 'EN' }];
