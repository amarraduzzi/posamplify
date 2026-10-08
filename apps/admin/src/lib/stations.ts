// Kitchen stations: Cuisine and Bar always exist, the restaurant adds its own (Grill, Pizza...).
import { t } from './i18n';
import type { Restaurant } from './types';

export interface Station { key: string; name: string; printer: string }
export function stationsOf(r: Restaurant): Station[] {
  const ps = r.pos_settings ?? {};
  const named = ps.stations ?? [];
  const keys = [...new Set(['kitchen', 'bar', ...named.map(s => s.key)])];
  return keys.map(key => ({
    key,
    name: named.find(s => s.key === key)?.name || (key === 'kitchen' ? t('Cuisine') : key === 'bar' ? t('Bar') : key),
    printer: ps.printers?.stations?.[key] ?? (key === 'bar' ? 'BAR' : 'CUISINE'),
  }));
}
export const stationKey = (name: string) =>
  name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'poste';
// i18n:values
export const COURSES: [number, string][] = [[1, 'Entrée'], [2, 'Plat'], [3, 'Dessert']];
// i18n:end
