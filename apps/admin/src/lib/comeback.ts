// The message that brings back a customer who no longer comes (Customers > "Ne reviennent plus").
// Two kinds: an invitation only, or an invitation with an offer (a line of text, and optionally bonus points
// that the database adds to the card when the message is sent). The owner can also write the whole text.
import { t } from './i18n';
import type { Restaurant } from './types';

export type Comeback = NonNullable<NonNullable<Restaurant['loyalty']>['comeback']>;
export interface ComebackCfg { days: number; mode: 'invite' | 'offer'; offer: string; bonus: number; message: string }

export const COMEBACK_DAYS = { min: 7, max: 180, def: 30 };
export const COMEBACK_BONUS_MAX = 1000;

/** The saved settings with their defaults (the same limits as the database check). */
export function comebackCfg(l: Restaurant['loyalty'] | null | undefined): ComebackCfg {
  const c = l?.comeback ?? {};
  const days = Math.round(Number(c.days));
  const bonus = Math.round(Number(c.bonus_points));
  return {
    days: Number.isFinite(days) ? Math.min(COMEBACK_DAYS.max, Math.max(COMEBACK_DAYS.min, days)) : COMEBACK_DAYS.def,
    mode: c.mode === 'offer' ? 'offer' : 'invite',
    offer: (c.offer ?? '').trim(),
    bonus: Number.isFinite(bonus) ? Math.min(COMEBACK_BONUS_MAX, Math.max(0, bonus)) : 0,
    message: (c.message ?? '').trim(),
  };
}

/** Not contacted yet for this absence: never contacted, or he came back since the last message (same rule as the database). */
export const comebackFresh = (c: { comeback_at: string | null; last_visit_at: string | null }) =>
  !c.comeback_at || (!!c.last_visit_at && Date.parse(c.last_visit_at) > Date.parse(c.comeback_at));

/** Contacted for this absence and not back since: shown as "Contacté le …". */
export const comebackPending = (c: { comeback_at: string | null; last_visit_at: string | null }) => !!c.comeback_at && !comebackFresh(c);

/** Whether sending now gives the bonus points: an offer message, points on, a bonus set, and a fresh absence. */
export const comebackGivesBonus = (cfg: ComebackCfg, pointsOn: boolean, c: { comeback_at: string | null; last_visit_at: string | null }) =>
  cfg.mode === 'offer' && pointsOn && cfg.bonus > 0 && comebackFresh(c);

/**
 * The text of the WhatsApp message. The owner's own text wins; it can use {name}, {restaurant}, {offer} and {points}.
 * bonus = the points this message adds to the card (0 when none).
 */
export function comebackMessage(cfg: ComebackCfg, who: { first: string; restaurant: string; bonus: number }): string {
  const offer = cfg.mode === 'offer' ? cfg.offer : '';
  if (cfg.message) {
    return cfg.message
      .replace(/\{name\}/g, who.first).replace(/\{restaurant\}/g, who.restaurant)
      .replace(/\{offer\}/g, offer).replace(/\{points\}/g, who.bonus ? String(who.bonus) : '')
      .replace(/[ \t]+([,.])/g, '$1').replace(/ {2,}/g, ' ').trim();
  }
  const n = who.first ? ` ${who.first}` : '';
  const base = t('Bonjour{n}, ça fait un moment qu’on ne vous a pas vu chez {r}.', { n, r: who.restaurant });
  if (cfg.mode !== 'offer' || (!offer && !who.bonus)) return `${base} ${t('Votre table vous attend, à bientôt !')}`;
  const parts = [base];
  if (offer) parts.push(t('Pour votre retour : {o}.', { o: offer }));
  if (who.bonus) parts.push(offer ? t('Nous avons aussi ajouté {b} points sur votre carte.', { b: who.bonus }) : t('Pour votre retour, nous avons ajouté {b} points sur votre carte.', { b: who.bonus }));
  parts.push(t('À bientôt !'));
  return parts.join(' ');
}
