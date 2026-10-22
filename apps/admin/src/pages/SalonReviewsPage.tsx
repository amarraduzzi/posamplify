// Avis clients: the salon's Google review link, the clients to ask (paid in the last 3 days, asked
// with one WhatsApp tap), what clients said (stars and a word), and the stars per person. Every
// client is invited to Google whatever the stars: asking only happy clients is against Google's rules.
import { useCallback, useEffect, useState } from 'react';
import { Info, MessageCircle, Star } from 'lucide-react';
import { supabase, MENU_URL } from '../lib/supabase';
import { check, rpc } from '../lib/api';
import { waLink } from '../lib/whatsapp';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, inputCls } from '../components/ui';

interface Todo { id: string; at: string; name: string | null; phone: string; token: string; lang: string | null; services: string[] | null; staff: string[] | null }
interface Fb { id: string; at: string; rating: number; comment: string | null; name: string | null; phone: string | null; staff: string[]; google: boolean }
interface Data {
  review_url: string | null; todo: Todo[]; feedback: Fb[];
  stats: { count: number; avg: number | null; google: number; asked: number }; staff: { staff_id: string; count: number; avg: number }[];
}

export const reviewAsk = (r: Restaurant, x: { name: string | null; token: string; lang: string | null }, staff?: string) => {
  const link = `${MENU_URL}/${r.slug}?avis=${x.token}`;
  const nm = x.name?.trim() ? ` ${x.name.trim()}` : '';
  return x.lang === 'ar'
    ? `السلام${nm}، شكرا على الزيارة ديالك عند ${r.name}${staff ? ` مع ${staff}` : ''}! كيف كانت؟ عطينا رأيك ف10 ثواني: ${link}`
    : x.lang === 'en'
      ? `Hello${nm}, thank you for your visit to ${r.name}${staff ? ` with ${staff}` : ''}! How was it? Tell us in 10 seconds: ${link}`
      : `Bonjour${nm}, merci pour votre visite chez ${r.name}${staff ? ` avec ${staff}` : ''} ! Comment c’était ? Dites-le-nous en 10 secondes : ${link}`;
};

const Stars = ({ n, size = 'h-4 w-4' }: { n: number; size?: string }) => (
  <span className="inline-flex gap-0.5" dir="ltr" aria-label={t('{n} sur 5', { n })}>{[1, 2, 3, 4, 5].map(i => <Star key={i} className={`${size} ${i <= Math.round(n) ? 'fill-amber-400 text-amber-400' : 'text-line/30'}`} />)}</span>
);

export function SalonReviewsPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const tz = r.timezone || 'UTC';
  const [x, setX] = useState<Data | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [url, setUrl] = useState(r.branding.review_url ?? '');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setX(await rpc<Data>('agenda_reviews', { p_restaurant_id: r.id, p_days: 90 })); } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { supabase.from('staff').select('id,name').eq('restaurant_id', r.id).then(y => setNames(Object.fromEntries((y.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name])))); }, [r.id]);
  const urlOk = !url.trim() || /^https:\/\/\S{4,}$/.test(url.trim());
  const saveUrl = async () => {
    setBusy(true);
    try { check(await supabase.from('restaurants').update({ branding: { ...r.branding, review_url: url.trim() || undefined } }).eq('id', r.id).select('id')); a.toast(t('Enregistré')); await a.reload(); load(); }
    catch (e) { a.fail(e); }
    setBusy(false);
  };
  const ask = async (y: Todo) => {
    const who = (y.staff ?? []).map(id => names[id]).filter(Boolean).join(', ');
    window.open(waLink(y.phone, reviewAsk(r, y, who || undefined)), '_blank', 'noopener');
    try { await rpc('agenda_review_asked', { p_restaurant_id: r.id, p_sale: y.id }); load(); } catch (e) { a.fail(e); }
  };
  const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const s = x?.stats;

  return (
    <div className="space-y-5">
      <h1 className="font-display text-3xl font-semibold">{t('Avis clients')}</h1>
      <p className="max-w-2xl text-sm text-muted">{t('Après la visite, la cliente donne des étoiles et un mot. Vous lisez tout ici. Ensuite, chaque cliente est invitée à laisser aussi un avis sur Google.')}</p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card rounded-3xl p-4"><p className="text-sm text-muted">{t('Note moyenne (90 jours)')}</p>
          <p className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold tabular">{s?.avg != null ? Number(s.avg).toLocaleString('fr-FR') : '–'}{s?.avg != null && <Stars n={Number(s.avg)} />}</p></div>
        <div className="card rounded-3xl p-4"><p className="text-sm text-muted">{t('Avis reçus')}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{s?.count ?? 0}</p></div>
        <div className="card rounded-3xl p-4"><p className="text-sm text-muted">{t('Demandés')}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{s?.asked ?? 0}</p></div>
        <div className="card rounded-3xl p-4"><p className="text-sm text-muted">{t('Partis vers Google')}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{s?.google ?? 0}</p></div>
      </div>

      <Card className="space-y-3">
        <Field label={t('Votre lien d’avis Google')} hint={urlOk ? t('Dans Google Business Profile : « Demander des avis », puis copiez le lien.') : t('Le lien doit commencer par https://')}>
          <div className="flex gap-2">
            <input className={inputCls} dir="ltr" maxLength={500} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://g.page/r/…/review" />
            <Btn tone="brand" disabled={busy || !urlOk || url.trim() === (r.branding.review_url ?? '')} onClick={saveUrl}>{t('Enregistrer')}</Btn>
          </div>
        </Field>
        {!x?.review_url && <p className="flex gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800"><Info className="mt-0.5 h-4 w-4 shrink-0" />{t('Sans lien Google, les clientes donnent leur avis au salon seulement.')}</p>}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-display text-xl font-semibold">{t('À demander')} <span className="text-base font-normal text-muted">{x?.todo.length ?? 0}</span></h2>
        <p className="text-sm text-muted">{t('Les clientes payées ces 3 derniers jours, avec un numéro. Une seule demande par cliente tous les 60 jours.')}</p>
        {x && !x.todo.length ? <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{t('Personne à demander pour le moment.')}</p> : (
          <ul className="divide-y divide-line/10">
            {(x?.todo ?? []).map(y => (
              <li key={y.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{y.name || y.phone}</p>
                  <p className="text-sm text-muted first-letter:uppercase">{when(y.at)} · {(y.services ?? []).join(', ')}{(y.staff ?? []).length ? ` · ${(y.staff ?? []).map(id => names[id]).filter(Boolean).join(', ')}` : ''}</p>
                </div>
                <Btn onClick={() => ask(y)} className="bg-[#25D366] text-white"><MessageCircle className="h-4 w-4" /> {t('Demander un avis')}</Btn>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {x && x.staff.length > 0 && (
        <Card className="space-y-3">
          <h2 className="font-display text-xl font-semibold">{t('Par personne')}</h2>
          <ul className="divide-y divide-line/10">
            {x.staff.map(p => (
              <li key={p.staff_id} className="flex items-center gap-3 py-2.5">
                <span className="flex-1 font-semibold">{names[p.staff_id] ?? '?'}</span>
                <Stars n={Number(p.avg)} /><span className="w-10 text-end font-semibold tabular">{Number(p.avg).toLocaleString('fr-FR')}</span>
                <span className="w-20 text-end text-sm text-muted">{t('{n} avis', { n: p.count })}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="font-display text-xl font-semibold">{t('Ce que disent les clientes')}</h2>
        {x && !x.feedback.length ? <p className="text-sm text-muted">{t('Aucun avis pour le moment. Le lien part aussi avec le ticket WhatsApp.')}</p> : (
          <ul className="divide-y divide-line/10">
            {(x?.feedback ?? []).map(f => (
              <li key={f.id} className={`py-3 ${f.rating <= 2 ? 'rounded-xl bg-red-500/5 px-3' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Stars n={f.rating} />
                  <span className="font-semibold">{f.name || f.phone}</span>
                  {f.staff.length > 0 && <span className="text-sm text-muted">· {f.staff.map(id => names[id]).filter(Boolean).join(', ')}</span>}
                  {f.google && <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-semibold text-sky-700">{t('Google')}</span>}
                  <span className="ms-auto text-xs text-muted first-letter:uppercase">{when(f.at)}</span>
                </div>
                {f.comment && <p className="mt-1 text-sm">{f.comment}</p>}
                {f.rating <= 2 && f.phone && <a className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand" href={waLink(f.phone, '')} target="_blank" rel="noopener"><MessageCircle className="h-4 w-4" />{t('Rappeler la cliente')}</a>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
