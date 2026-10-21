import { Briefcase, Cake, Heart, PartyPopper, Sparkles, Wine } from 'lucide-react';
import { t } from './i18n';

// Why the guests come: chosen at booking, shown on the reservation, the briefing and the bill,
// printed on the kitchen bon (the candle on the dessert is not forgotten).
export type Occasion = 'birthday' | 'anniversary' | 'business' | 'date' | 'celebration' | 'other';
export const OCCASIONS: { id: Occasion; label: () => string; Icon: typeof Cake; kitchen: string | null }[] = [
  { id: 'birthday', label: () => t('Anniversaire'), Icon: Cake, kitchen: 'ANNIVERSAIRE' },
  { id: 'anniversary', label: () => t('Anniversaire de mariage'), Icon: Heart, kitchen: 'ANNIVERSAIRE DE MARIAGE' },
  { id: 'date', label: () => t('Dîner en amoureux'), Icon: Wine, kitchen: 'DINER EN AMOUREUX' },
  { id: 'business', label: () => t('Repas d’affaires'), Icon: Briefcase, kitchen: null },
  { id: 'celebration', label: () => t('Fête'), Icon: PartyPopper, kitchen: 'FETE' },
  { id: 'other', label: () => t('Autre occasion'), Icon: Sparkles, kitchen: null },
];
/** Amplify Maître, the fine dining package: guest profile, briefing, deposits and occasions, rhythm of the evening */
export const hasMaitre = (r: { products?: string[] } | null | undefined) => !!r?.products?.includes('pos') && !!r?.products?.includes('maitre');
export const occasionOf = (id?: string | null) => OCCASIONS.find(o => o.id === id) ?? null;
