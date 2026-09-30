// Menu engineering (Kasavana & Smith): every dish in one of four boxes, by
// popularity (sales at the till) and margin per plate, compared with the other
// dishes of the same category (a coffee against coffees, a tajine against tajines).
import { ArrowUpRight, Megaphone, Star, Trash2, TrendingUp } from 'lucide-react';
import { tr } from '@resto/shared';
import { mad } from '../lib/api';
import { t } from '../lib/i18n';
import type { ProfitDish } from '../lib/types';

type Box = 'star' | 'horse' | 'puzzle' | 'dog';
interface Placed { d: ProfitDish; box: Box }

/** Popular = at least 70 % of a fair share of the category's sales; profitable = margin at least the category's (sales-weighted) average. */
export function classify(dishes: ProfitDish[], lang: string): Placed[] {
  const usable = dishes.filter(d => d.margin_cents != null);
  const byCat = new Map<string, ProfitDish[]>();
  for (const d of usable) { const k = tr(d.category, lang); byCat.set(k, [...(byCat.get(k) ?? []), d]); }
  // categories too small to compare within are compared together
  const groups: ProfitDish[][] = []; const rest: ProfitDish[] = [];
  for (const g of byCat.values()) (g.length >= 3 ? groups.push(g) : rest.push(...g));
  if (rest.length) groups.push(rest);
  const out: Placed[] = [];
  for (const g of groups) {
    const qty = g.reduce((s, d) => s + d.sold_qty, 0);
    if (!qty) continue;
    const avgMargin = g.reduce((s, d) => s + d.margin_cents! * d.sold_qty, 0) / qty;
    const popLine = 0.7 / g.length;
    for (const d of g) {
      const pop = d.sold_qty / qty >= popLine, rich = d.margin_cents! >= avgMargin;
      out.push({ d, box: pop ? (rich ? 'star' : 'horse') : (rich ? 'puzzle' : 'dog') });
    }
  }
  return out;
}

export function MenuMatrix({ dishes, lang, usesPos, days, onOpen }: { dishes: ProfitDish[]; lang: string; usesPos: boolean; days: number; onOpen: (d: ProfitDish) => void }) {
  if (!usesPos) {
    return (
      <div className="night rounded-[2rem] p-6 md:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{t('Analyse du menu')}</p>
        <h2 className="mt-1 font-display text-2xl font-semibold">{t('Quels plats garder, pousser, augmenter ou retirer')}</h2>
        <p className="mt-3 max-w-2xl text-white/70">{t('Cette analyse croise la marge de chaque plat avec ce qu’il se vend vraiment. Les ventes viennent de la caisse Amplify POS : ajoutez-la pour voir vos stars et vos plats à retirer.')}</p>
      </div>
    );
  }
  const placed = classify(dishes, lang);
  if (!placed.length) {
    return <div className="card rounded-3xl p-10 text-center text-muted">{t('Pas encore assez de ventes avec des fiches techniques sur {d} jours. Revenez après quelques jours de caisse.', { d: days })}</div>;
  }
  const BOXES: { k: Box; title: string; text: string; Icon: typeof Star; tone: string }[] = [
    { k: 'star', title: t('Stars'), text: t('Populaires et rentables. Gardez la qualité, la portion et la meilleure place sur la carte.'), Icon: Star, tone: 'border-ok/40 bg-ok/5 text-ok' },
    { k: 'horse', title: t('Populaires, peu rentables'), text: t('Les clients les aiment : augmentez un peu le prix, ou baissez le coût (portion, ingrédient).'), Icon: TrendingUp, tone: 'border-warn/50 bg-warn/5 text-warn' },
    { k: 'puzzle', title: t('Rentables, peu vendus'), text: t('Faites-les connaître : conseil des serveurs, photo, meilleure place sur la carte, nom plus appétissant.'), Icon: Megaphone, tone: 'border-brand/40 bg-brand/5 text-brand' },
    { k: 'dog', title: t('Ni populaires ni rentables'), text: t('À retirer de la carte, ou à refaire entièrement. Moins de plats, c’est aussi moins de stock et de perte.'), Icon: Trash2, tone: 'border-danger/40 bg-danger/5 text-danger' },
  ];
  const name = (d: ProfitDish) => tr(d.name, lang) + (d.variant_name ? ` · ${tr(d.variant_name, lang)}` : '');
  return (
    <>
      <p className="mb-3 text-sm text-muted">{t('Sur les {d} derniers jours de caisse. Chaque plat est comparé aux plats de sa catégorie.', { d: days })}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {BOXES.map(({ k, title, text, Icon, tone }) => {
          const list = placed.filter(p => p.box === k).sort((x, y) => (y.d.profit_cents ?? 0) - (x.d.profit_cents ?? 0));
          return (
            <section key={k} className={`rounded-3xl border p-5 ${tone.split(' ').slice(0, 2).join(' ')}`}>
              <div className="flex items-center gap-2">
                <span className={`grid h-9 w-9 place-items-center rounded-xl bg-surface ${tone.split(' ')[2]}`}><Icon className="h-4 w-4" /></span>
                <h3 className="font-display text-lg font-semibold">{title}</h3>
                <span className="ms-auto rounded-full bg-surface px-2.5 py-0.5 text-sm font-bold tabular">{list.length}</span>
              </div>
              <p className="mt-2 text-sm text-muted">{text}</p>
              {list.length > 0 && (
                <ul className="mt-3 divide-y divide-line/10 rounded-2xl bg-surface">
                  {list.map(({ d }) => (
                    <li key={`${d.item_id}|${d.variant_id ?? ''}`}>
                      <button onClick={() => onOpen(d)} className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2/60">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold"><bdi>{name(d)}</bdi></span>
                          <span className="text-xs text-muted">{t('{n} vendus', { n: d.sold_qty })} · {t('{m} de marge / plat', { m: mad(d.margin_cents!) })}</span>
                        </span>
                        {k === 'horse' && d.suggested_price_cents != null && d.suggested_price_cents > d.price_cents
                          ? <span className="flex items-center gap-0.5 text-xs font-semibold text-warn"><ArrowUpRight className="h-3 w-3" />{mad(d.suggested_price_cents)}</span>
                          : <span className="text-end font-semibold tabular">{mad(d.profit_cents ?? 0)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">{t('Montant à droite : marge totale sur la période (hors TVA). Pour les plats populaires peu rentables : le prix conseillé pour atteindre votre objectif.')}</p>
    </>
  );
}
