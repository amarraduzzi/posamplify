// Kitchen stations (Cuisine, Bar, and the restaurant's own: Grill, Pizza, Dessert...) and courses.
import { t } from './i18n';
import type { PosSettings } from './types';

export const stationName = (s: PosSettings | undefined, key: string) =>
  s?.stations?.find(x => x.key === key)?.name || (key === 'kitchen' ? t('Cuisine') : key === 'bar' ? t('Bar') : key);
/** All stations a screen can show: the configured ones and those the menu uses. */
export const allStations = (s: PosSettings | undefined, used: string[]) =>
  [...new Set(['kitchen', 'bar', ...(s?.stations ?? []).map(x => x.key), ...used])];
// i18n:values
const COURSES: Record<number, string> = { 1: 'Entrée', 2: 'Plat', 3: 'Dessert' };
// i18n:end
export const courseName = (c: number | null | undefined) => (c ? t(COURSES[c]) : '');
/** Ticket text (latin only for the printer). */
export const courseTicket = (c: number | null | undefined) => (c === 1 ? 'ENTREE' : c === 2 ? 'PLAT' : c === 3 ? 'DESSERT' : '');
