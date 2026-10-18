import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { tr } from '@resto/shared';
import { rpc, errorMessage } from '../lib/api';
import type { Item, ProfitData, ProfitDish, Restaurant } from '../lib/types';
import { Btn, Modal } from './ui';
import { t } from '../lib/i18n';

const DAYS = 14;
interface Idea { item: Item; badge: string; reason: string }

/** "Idées de stories": the system picks the dishes worth posting this week, from the till and margin data, and says why. */
export function StoryIdeas({ r, items, onPick, onClose }: { r: Restaurant; items: Item[]; onPick: (item: Item, badge: string, reason: string) => void; onClose: () => void }) {
  const lang = r.languages[0] ?? 'fr';
  const [data, setData] = useState<ProfitData | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { rpc<ProfitData>('profit_dishes', { p_restaurant_id: r.id, p_days: DAYS }).then(setData).catch(e => setErr(errorMessage(e))); }, [r.id]);

  const ideas = useMemo<Idea[]>(() => {
    if (!data) return [];
    const byId = new Map(items.map(i => [i.id, i]));
    const seen = new Set<string>(), list: { d: ProfitDish; item: Item }[] = [];
    for (const d of data.dishes) { const item = byId.get(d.item_id); if (!item || !item.active || !item.image_url || seen.has(d.item_id)) continue; seen.add(d.item_id); list.push({ d, item }); }
    if (!list.length) return [];
    const avg = list.reduce((s, x) => s + x.d.sold_qty, 0) / list.length;
    const marginPct = (d: ProfitDish) => (d.margin_cents != null && d.price_ht_cents > 0 ? d.margin_cents / d.price_ht_cents : null);
    const out: Idea[] = [], used = new Set<string>();
    const add = (x: { d: ProfitDish; item: Item }, badge: string, reason: string) => { if (out.length < 5 && !used.has(x.item.id)) { used.add(x.item.id); out.push({ item: x.item, badge, reason }); } };
    const best = [...list].sort((a, b) => b.d.sold_qty - a.d.sold_qty)[0];
    if (best && best.d.sold_qty > 0) add(best, 'best', t('Votre best-seller : {n} ventes en {days} jours. Un bon moyen de faire venir de nouveaux clients.', { n: best.d.sold_qty, days: DAYS }));
    // hidden gems: a high margin that nobody orders (the most profitable thing to push)
    const gems = list.filter(x => (marginPct(x.d) ?? 0) >= 0.6 && x.d.sold_qty <= avg * 0.7).sort((a, b) => (marginPct(b.d)! * 100 + (avg - b.d.sold_qty)) - (marginPct(a.d)! * 100 + (avg - a.d.sold_qty)));
    gems.slice(0, 3).forEach(x => add(x, 'heart', t('Marge {m} % mais commandé seulement {n} fois en {days} jours : chaque vente de plus rapporte gros.', { m: Math.round(marginPct(x.d)! * 100), n: x.d.sold_qty, days: DAYS })));
    // then dishes that rarely sell, whatever their margin is (so the owner still gets ideas without recipe costs)
    [...list].sort((a, b) => a.d.sold_qty - b.d.sold_qty).forEach(x => add(x, 'heart', t('Peu commandé ({n} ventes en {days} jours) : une mise en avant peut le relancer.', { n: x.d.sold_qty, days: DAYS })));
    return out;
  }, [data, items]);

  return (
    <Modal title={t('Idées de stories')} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">{t("Les plats à poster cette semaine, choisis d'après vos ventes et vos marges.")}</p>
      {!data && !err && <p className="text-sm text-muted">{t('Chargement…')}</p>}
      {err && <p className="text-sm text-danger">{err}</p>}
      {data && !ideas.length && <p className="text-sm text-muted">{t("Ajoutez des photos à vos plats : les idées apparaissent dès qu'un plat a une photo.")}</p>}
      <ul className="space-y-2">
        {ideas.map(x => (
          <li key={x.item.id} className="flex items-center gap-3 rounded-2xl border border-line/10 p-2.5">
            <img src={x.item.image_url!} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
            <div className="min-w-0 flex-1"><div className="truncate font-semibold"><bdi>{tr(x.item.name, lang, r.languages)}</bdi></div><div className="text-xs text-muted">{x.reason}</div></div>
            <Btn tone="brand" className="shrink-0 px-3 py-1.5" onClick={() => onPick(x.item, x.badge, x.reason)}><Sparkles className="h-4 w-4" /> {t('Créer la story')}</Btn>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
