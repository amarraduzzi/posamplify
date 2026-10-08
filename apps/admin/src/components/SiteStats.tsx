// What the website brings: visits and what visitors did (call, directions, WhatsApp order, online
// order, booking). Counted per day without cookies. For a restaurant with the website only, once
// WhatsApp orders come in: what Amplify POS would change.
import { useEffect, useState } from 'react';
import { Eye, MapPin, MessageCircle, Phone, ShoppingBag, CalendarDays, TrendingUp } from 'lucide-react';
import { rpc } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { isSiteOnly, type Restaurant } from '../lib/types';
import { Card } from './ui';
import { AMPLIFY_WA } from '../pages/UpgradePage';

type Stats = { days: number; totals: Record<string, number>; previous: Record<string, number>; daily: { day: string; views: number }[] };
const n = (x: unknown) => Number(x ?? 0);

export function SiteStats({ r }: { r: Restaurant }) {
  const [days, setDays] = useState(30);
  const [s, setS] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    rpc<Stats>('site_stats', { p_restaurant_id: r.id, p_days: days }).then(x => live && setS(x)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [r.id, days]);
  if (failed) return null;
  const tot = (k: string) => n(s?.totals[k]), prev = (k: string) => n(s?.previous[k]);
  const visits = tot('view'), before = prev('view');
  const delta = before ? Math.round(((visits - before) / before) * 100) : null;
  const max = Math.max(1, ...(s?.daily ?? []).map(d => n(d.views)));
  const siteOnly = isSiteOnly(r);
  const tiles = [
    { k: 'call', label: t('Appels'), Icon: Phone },
    { k: 'directions', label: t('Itinéraires'), Icon: MapPin },
    ...(siteOnly || tot('wa_order') ? [{ k: 'wa_order', label: t('Commandes WhatsApp'), Icon: MessageCircle }] : []),
    ...(!siteOnly ? [{ k: 'order', label: t('Commandes en ligne'), Icon: ShoppingBag }] : []),
    ...(r.booking?.enabled ? [{ k: 'book', label: t('Réservations'), Icon: CalendarDays }] : []),
    { k: 'menu', label: t('Cartes consultées'), Icon: Eye },
  ];
  const wa = tot('wa_order');
  const upsell = `${t('Bonjour Amplify, mon site reçoit des commandes WhatsApp. Je veux qu’elles arrivent en caisse.')}\n${r.name}`;
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="me-auto font-display text-xl font-semibold">{t('Ce que votre site vous apporte')}</h2>
        <div className="flex gap-1 rounded-full bg-surface-2 p-1 text-sm font-semibold">
          {[7, 30, 90].map(d => <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-full px-3 py-1 ${days === d ? 'bg-night text-white' : 'text-muted'}`}>{t('{n} j', { n: d })}</button>)}
        </div>
      </div>
      {!s ? <p className="text-muted">{t('Chargement…')}</p> : (
        <>
          <div className="grid gap-5 md:grid-cols-[auto_1fr] md:items-end">
            <div>
              <p className="text-sm font-semibold text-muted">{t('Visites')}</p>
              <p className="font-display text-5xl font-semibold tabular">{visits.toLocaleString(dateLocale())}</p>
              {delta != null && <p className={`mt-1 inline-flex items-center gap-1 text-sm font-semibold ${delta >= 0 ? 'text-ok' : 'text-danger'}`}><TrendingUp className={`h-4 w-4 ${delta < 0 ? 'rotate-180' : ''}`} />{delta >= 0 ? '+' : ''}{delta} % {t('par rapport aux {n} jours d’avant', { n: days })}</p>}
            </div>
            {/* pages seen per day */}
            <div className="flex h-24 items-end gap-[2px]" aria-label={t('Pages vues par jour')}>
              {s.daily.map(d => <div key={d.day} title={`${new Date(d.day).toLocaleDateString(dateLocale())} : ${n(d.views)}`} className="min-w-0 flex-1 rounded-t-sm bg-brand/70 transition-all hover:bg-brand" style={{ height: `${Math.max(3, (n(d.views) / max) * 100)}%`, opacity: n(d.views) ? 1 : 0.25 }} />)}
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map(x => (
              <div key={x.k} className="rounded-2xl bg-surface-2 p-3">
                <x.Icon className="h-4 w-4 text-brand" />
                <p className="mt-2 font-display text-2xl font-semibold tabular">{tot(x.k)}</p>
                <p className="text-xs text-muted">{x.label}</p>
              </div>
            ))}
          </div>
          {!visits && <p className="mt-4 text-sm text-muted">{t('Partagez le lien de votre site sur Instagram, Google Maps et WhatsApp : chaque visite apparaît ici.')}</p>}
          {siteOnly && wa >= 5 && (
            <div className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-brand/30 bg-brand/10 p-4">
              <p className="min-w-0 flex-1 text-sm"><b>{t('{n} commandes WhatsApp en {d} jours.', { n: wa, d: days })}</b> {t('Avec Amplify POS, elles arrivent directement en caisse et en cuisine, sans rien recopier.')}</p>
              <a href={`https://wa.me/${AMPLIFY_WA}?text=${encodeURIComponent(upsell)}`} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-ink"><MessageCircle className="h-4 w-4" /> {t('Essayer Amplify POS')}</a>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">{t('Compté sans cookies : nous ne gardons rien sur vos visiteurs, seulement le nombre par jour.')}</p>
        </>
      )}
    </Card>
  );
}
