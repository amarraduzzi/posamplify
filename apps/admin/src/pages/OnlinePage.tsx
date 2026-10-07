// Own online ordering (no commission): the restaurant's menu link takes take-away and delivery
// orders. Here: open or paused, delivery rules, opening hours, and everything to share the link.
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Bike, Clock, Copy, Download, ExternalLink, Globe, MessageCircle, PauseCircle, PlayCircle, Plus, Save, ShoppingBag, Trash2 } from 'lucide-react';
import { supabase, MENU_URL } from '../lib/supabase';
import { check, fromCents, mad, rpc, toCents } from '../lib/api';
import { dateLocale, getLang, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Toggle, inputCls } from '../components/ui';

type Hours = Record<string, [string, string][]>;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
// i18n:values
const DAY_LABEL: Record<string, string> = { mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi', fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche' };
// i18n:end

/** Same rule as the server (app.open_at): ranges per day, a range past midnight runs into the next day. */
function openAt(hours: Hours, d: Date, tz: string): boolean {
  if (!hours || !Object.keys(hours).length) return true;
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (k: string) => f.find(x => x.type === k)?.value ?? '';
  const dow = get('weekday').toLowerCase().slice(0, 3), hm = `${get('hour').replace('24', '00')}:${get('minute')}`;
  const all = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const prev = all[(all.indexOf(dow) + 6) % 7];
  for (const [s, e] of hours[dow] ?? []) if ((e > s && hm >= s && hm < e) || (e <= s && hm >= s)) return true;
  for (const [s, e] of hours[prev] ?? []) if (e <= s && hm < e) return true;
  return false;
}

export function OnlinePage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const on = r.online ?? {};
  const owner = a.canEditProfile;
  const [f, setF] = useState({
    takeaway: r.accept_takeaway, delivery: r.accept_delivery,
    prep: String(on.prep_minutes ?? 20), schedule: on.schedule !== false,
    fee: fromCents(on.delivery_fee_cents ?? 0), min: fromCents(on.delivery_min_cents ?? 0),
    free: on.delivery_free_from_cents != null ? fromCents(on.delivery_free_from_cents) : '', area: on.delivery_area ?? '',
  });
  const [hours, setHours] = useState<Hours>(() => (Object.keys(r.opening_hours ?? {}).length ? r.opening_hours : {}));
  const [useHours, setUseHours] = useState(() => Object.keys(r.opening_hours ?? {}).length > 0);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(id); }, []);

  const link = `${MENU_URL}/${r.slug}`;
  useEffect(() => { QRCode.toDataURL(link, { margin: 1, width: 600, color: { dark: '#001E3E', light: '#FFFFFF' } }).then(setQr).catch(() => setQr('')); }, [link]);
  const pausedUntil = on.paused_until && Date.parse(on.paused_until) > now ? new Date(on.paused_until) : null;
  const openNow = openAt(useHours ? hours : {}, new Date(now), r.timezone);
  const live = (r.accept_takeaway || r.accept_delivery) && r.products?.includes('pos') && r.pos_plan !== 'essentiel';
  const state = !live ? 'off' : pausedUntil ? 'paused' : !openNow ? 'closed' : 'open';

  const pause = async (minutes: number) => {
    try {
      await rpc('online_pause', { p_restaurant_id: r.id, p_minutes: minutes });
      a.toast(minutes ? t('Commandes en ligne en pause') : t('Commandes en ligne reprises')); await a.reload();
    } catch (e) { a.fail(e); }
  };
  // "until the end of service": until 04:00 tomorrow, restaurant time
  const endOfService = () => {
    const local = new Date(new Date().toLocaleString('en-US', { timeZone: r.timezone }));
    const end = new Date(local); end.setHours(4, 0, 0, 0); if (end <= local) end.setDate(end.getDate() + 1);
    return Math.max(15, Math.round((end.getTime() - local.getTime()) / 60000));
  };

  const save = async () => {
    setBusy(true);
    try {
      const online = {
        ...(r.online ?? {}),
        prep_minutes: Math.max(5, Math.min(240, Math.round(Number(f.prep) || 20))), schedule: f.schedule,
        delivery_fee_cents: toCents(f.fee), delivery_min_cents: toCents(f.min),
        delivery_free_from_cents: f.free.trim() ? toCents(f.free) : null, delivery_area: f.area.trim() || null,
      };
      const clean: Hours = {};
      if (useHours) for (const d of DAYS) { const rs = (hours[d] ?? []).filter(([s, e]) => /^\d\d:\d\d$/.test(s) && /^\d\d:\d\d$/.test(e) && s !== e); clean[d] = rs; }
      check(await supabase.from('restaurants').update({ online, opening_hours: clean, accept_takeaway: f.takeaway, accept_delivery: f.delivery }).eq('id', r.id).select('id'));
      a.toast(t('Enregistré')); await a.reload();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };

  const share = useMemo(() => [
    t('Commandez chez {r} directement ici, sans application :', { r: r.name }),
    link,
    f.delivery && f.takeaway ? t('À emporter ou en livraison.') : f.delivery ? t('En livraison.') : t('À emporter.'),
  ].join('\n'), [r.name, link, f.delivery, f.takeaway]);
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };

  const setRange = (d: string, i: number, k: 0 | 1, v: string) => setHours(h => ({ ...h, [d]: (h[d] ?? []).map((x, j) => (j === i ? (k === 0 ? [v, x[1]] : [x[0], v]) as [string, string] : x)) }));
  const copyToAll = (d: string) => setHours(h => Object.fromEntries(DAYS.map(x => [x, (h[d] ?? []).map(y => [...y] as [string, string])])));

  const STATE = {
    open: { tone: 'bg-ok', label: t('Ouvert aux commandes'), text: t('Les clients peuvent commander maintenant. Prêt en environ {m} min.', { m: on.prep_minutes ?? 20 }) },
    paused: { tone: 'bg-warn', label: t('En pause'), text: pausedUntil ? t('Jusqu’à {h}. Les clients voient le menu mais ne peuvent pas commander.', { h: pausedUntil.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) }) : '' },
    closed: { tone: 'bg-white/40', label: t('Fermé (horaires)'), text: on.schedule === false ? t('Les commandes reprennent à l’ouverture.') : t('Les clients peuvent commander pour plus tard, quand vous êtes ouvert.') },
    off: { tone: 'bg-danger', label: t('Désactivé'), text: r.pos_plan === 'essentiel' ? t('La formule Essentiel ne prend pas de commandes en ligne. Passez à la formule Restaurant.') : t('Activez « À emporter » ou « Livraison » ci-dessous.') },
  }[state];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand">Amplify POS</p>
        <h1 className="font-display text-3xl font-semibold">{t('Commande en ligne')}</h1>
        <p className="text-muted">{t('Votre propre lien de commande : à emporter et livraison, sans commission. Les commandes arrivent directement sur la caisse.')}</p>
      </div>

      <div className="night relative overflow-hidden rounded-[2rem] p-6 md:p-8">
        <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold"><span className={`h-2.5 w-2.5 rounded-full ${STATE.tone} ${state === 'open' ? 'animate-pulse' : ''}`} />{STATE.label}</p>
            <p className="mt-2 max-w-xl text-white/70">{STATE.text}</p>
            {live && (
              <div className="mt-5 flex flex-wrap gap-2">
                {pausedUntil
                  ? <Btn tone="brand" onClick={() => pause(0)}><PlayCircle className="h-4 w-4" /> {t('Reprendre les commandes')}</Btn>
                  : <>
                    <Btn onClick={() => pause(30)}><PauseCircle className="h-4 w-4" /> {t('Pause 30 min')}</Btn>
                    <Btn onClick={() => pause(60)}>{t('1 heure')}</Btn>
                    <Btn onClick={() => pause(endOfService())}>{t('Jusqu’à la fin du service')}</Btn>
                  </>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 rounded-3xl bg-white/5 p-4 ring-1 ring-white/10">
            {qr && <img src={qr} alt={t('QR code de commande')} className="h-28 w-28 rounded-xl bg-white p-1" />}
            <div className="min-w-0 space-y-2">
              <p className="text-xs text-white/60">{t('Votre lien')}</p>
              <p dir="ltr" className="max-w-[16rem] truncate font-semibold">{link.replace('https://', '')}</p>
              <div className="flex flex-wrap gap-1.5">
                <Btn className="px-2.5 py-1.5 text-sm" onClick={() => copy(link)}><Copy className="h-4 w-4" /> {t('Copier')}</Btn>
                <a href={link} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-2.5 py-1.5 text-sm font-semibold hover:bg-white/15"><ExternalLink className="h-4 w-4" /> {t('Voir')}</a>
                {qr && <a href={qr} download={`commande-${r.slug}.png`} className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-2.5 py-1.5 text-sm font-semibold hover:bg-white/15"><Download className="h-4 w-4" /> QR</a>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Card>
        <h2 className="font-display text-xl font-semibold">{t('Faites-le savoir')}</h2>
        <p className="mb-4 text-sm text-muted">{t('Chaque commande par ce lien, c’est 0 % de commission. Mettez-le partout où vos clients vous trouvent.')}</p>
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div>
            <textarea readOnly dir={getLang() === 'ar' ? 'rtl' : 'ltr'} className={`${inputCls} h-28 resize-none`} value={share} />
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 font-semibold text-[#06301A]"><MessageCircle className="h-4 w-4" /> {t('Partager sur WhatsApp')}</a>
              <Btn onClick={() => copy(share)}><Copy className="h-4 w-4" /> {t('Copier le message')}</Btn>
            </div>
          </div>
          <ul className="space-y-2 text-sm">
            {[[t('Statut WhatsApp et liste de diffusion'), t('Envoyez le message à vos clients habitués, une fois par semaine au maximum.')],
              [t('Fiche Google'), t('Dans Google Business Profile, ajoutez le lien comme lien de commande ou comme site web.')],
              [t('Instagram et Facebook'), t('Mettez le lien dans votre bio et dans le bouton « Commander ».')],
              [t('Dans le restaurant'), t('Imprimez le QR pour les sacs à emporter et la vitrine.')]].map(([h, x]) => (
              <li key={h} className="rounded-2xl bg-surface-2 p-3"><p className="font-semibold">{h}</p><p className="text-muted">{x}</p></li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-display text-xl font-semibold">{t('Réglages')}</h2>
        <fieldset disabled={!owner} className="space-y-5">
          <div className="flex flex-wrap gap-6">
            <Toggle checked={f.takeaway} onChange={v => setF({ ...f, takeaway: v })} label={t('À emporter')} />
            <Toggle checked={f.delivery} onChange={v => setF({ ...f, delivery: v })} label={t('Livraison')} />
            <Toggle checked={f.schedule} onChange={v => setF({ ...f, schedule: v })} label={t('Commander pour plus tard')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('Temps de préparation (min)')}><div className="relative"><Clock className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input className={`${inputCls} ps-9`} inputMode="numeric" value={f.prep} onChange={e => setF({ ...f, prep: e.target.value.replace(/\D/g, '') })} /></div></Field>
          </div>
          {f.delivery && (
            <div className="rounded-2xl border border-line/10 p-4">
              <p className="mb-3 flex items-center gap-2 font-semibold"><Bike className="h-4 w-4 text-brand" /> {t('Livraison')}</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('Frais de livraison (DH)')}><input className={inputCls} inputMode="decimal" value={f.fee} onChange={e => setF({ ...f, fee: e.target.value })} placeholder="0" /></Field>
                <Field label={t('Commande minimum (DH)')}><input className={inputCls} inputMode="decimal" value={f.min} onChange={e => setF({ ...f, min: e.target.value })} placeholder="0" /></Field>
                <Field label={t('Livraison offerte dès (DH)')}><input className={inputCls} inputMode="decimal" value={f.free} onChange={e => setF({ ...f, free: e.target.value })} placeholder={t('jamais')} /></Field>
              </div>
              <Field label={t('Zone de livraison')}><input className={`${inputCls} mt-1`} maxLength={200} value={f.area} onChange={e => setF({ ...f, area: e.target.value })} placeholder={t('Agdal, Hay Riad, Souissi…')} /></Field>
              {(toCents(f.fee) > 0 || toCents(f.min) > 0) && <p className="mt-3 text-sm text-muted">{t('Le client voit : livraison {f}{m}{x}.', { f: mad(toCents(f.fee)), m: toCents(f.min) > 0 ? t(', minimum {m}', { m: mad(toCents(f.min)) }) : '', x: f.free.trim() ? t(', offerte dès {m}', { m: mad(toCents(f.free)) }) : '' })}</p>}
            </div>
          )}
          <div className="rounded-2xl border border-line/10 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <p className="me-auto flex items-center gap-2 font-semibold"><Clock className="h-4 w-4 text-brand" /> {t('Horaires d’ouverture')}</p>
              <Toggle checked={useHours} onChange={v => { setUseHours(v); if (v && !Object.keys(hours).length) setHours(Object.fromEntries(DAYS.map(d => [d, [['12:00', '23:00']]]))); }} label={useHours ? t('Selon les horaires') : t('Toujours ouvert')} />
            </div>
            {useHours && (
              <ul className="divide-y divide-line/10">
                {DAYS.map(d => (
                  <li key={d} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="w-24 font-semibold">{t(DAY_LABEL[d])}</span>
                    {!(hours[d] ?? []).length && <span className="text-sm text-muted">{t('Fermé')}</span>}
                    {(hours[d] ?? []).map(([s, e], i) => (
                      <span key={i} className="flex items-center gap-1">
                        <input type="time" aria-label={t('Ouverture')} className={`${inputCls} w-28 py-1.5`} value={s} onChange={x => setRange(d, i, 0, x.target.value)} />
                        <span className="text-muted">–</span>
                        <input type="time" aria-label={t('Fermeture')} className={`${inputCls} w-28 py-1.5`} value={e} onChange={x => setRange(d, i, 1, x.target.value)} />
                        <button aria-label={t('Supprimer')} onClick={() => setHours(h => ({ ...h, [d]: (h[d] ?? []).filter((_, j) => j !== i) }))} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                      </span>
                    ))}
                    <span className="ms-auto flex gap-1">
                      {(hours[d] ?? []).length < 2 && <button onClick={() => setHours(h => ({ ...h, [d]: [...(h[d] ?? []), (h[d] ?? []).length ? ['19:00', '23:30'] : ['12:00', '15:00']] }))} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand hover:bg-surface-2"><Plus className="h-3.5 w-3.5" /> {t('Plage')}</button>}
                      <button onClick={() => copyToAll(d)} className="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-2">{t('Copier à tous les jours')}</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted">{t('Une plage qui finit après minuit (par exemple 19:00 – 01:00) continue sur la nuit.')}</p>
          </div>
        </fieldset>
        <div className="mt-5 flex items-center justify-end gap-3">
          {!owner && <span className="me-auto text-sm text-muted">{t('Seul le propriétaire peut modifier ces réglages. La pause reste possible.')}</span>}
          {owner && <Btn tone="brand" disabled={busy} onClick={save}><Save className="h-4 w-4" /> {t('Enregistrer')}</Btn>}
        </div>
      </Card>
      <p className="flex items-center gap-2 text-sm text-muted"><Globe className="h-4 w-4" /><ShoppingBag className="h-4 w-4" /> {t('Le client paie à la livraison ou au retrait.')}</p>
    </div>
  );
}
