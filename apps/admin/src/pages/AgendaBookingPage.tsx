// Amplify Agenda: online booking. The link and QR code to share (Instagram bio, WhatsApp, the mirror),
// the settings, and the next appointments until the agenda screen arrives.
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { AlertTriangle, BellRing, CalendarCheck2, CheckCircle2, Copy, Download, ExternalLink, MessageCircle, Save } from 'lucide-react';
import { waLink, ymdIn } from '../lib/whatsapp';
import { supabase, MENU_URL } from '../lib/supabase';
import { check } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Toggle, inputCls } from '../components/ui';
import { fmtDuration, svcName } from './AgendaServicesPage';

interface Appt {
  id: string; starts_at: string; duration_min: number; status: string; source: string; name: string; phone: string | null; note: string | null;
  service_name: Record<string, string>; any_staff: boolean; staff_id: string | null;
  token: string; reminded_at: string | null; client_confirmed_at: string | null;
}
const STEPS = [10, 15, 20, 30, 60];
const LEADS = [0, 30, 60, 120, 240, 720, 1440];
const DAYS = [7, 14, 30, 60, 90];
const CANCELS = [0, 1, 2, 3, 6, 12, 24, 48];
const leadLabel = (m: number) => (m === 0 ? t('Aucun') : m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : t('La veille'));

export function AgendaBookingPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const g = r.agenda ?? {};
  const owner = a.canEditProfile;
  const [f, setF] = useState({
    enabled: !!g.enabled, auto: g.auto_confirm ?? true, step: String(g.step ?? 15), lead: String(g.lead_minutes ?? 60),
    days: String(g.days_ahead ?? 30), cancel: String(g.cancel_hours ?? 3), any: g.any_staff ?? true, note: g.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const link = `${MENU_URL}/${r.slug}?rdv`;
  useEffect(() => { QRCode.toDataURL(link, { margin: 1, width: 600, color: { dark: '#001E3E', light: '#FFFFFF' } }).then(setQr).catch(() => {}); }, [link]);

  // what still blocks a booking: prestations online, people who take appointments
  const [ready, setReady] = useState<{ services: number; staff: number } | null>(null);
  const [list, setList] = useState<Appt[] | null>(null);
  const [staff, setStaff] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      const [sv, st, ap] = await Promise.all([
        supabase.from('agenda_services').select('id', { count: 'exact', head: true }).eq('restaurant_id', r.id).eq('active', true).eq('online', true),
        supabase.from('staff').select('id, name, agenda, active').eq('restaurant_id', r.id),
        supabase.from('agenda_appointments').select('id, starts_at, duration_min, status, source, name, phone, note, service_name, any_staff, staff_id, token, reminded_at, client_confirmed_at')
          .eq('restaurant_id', r.id).gte('starts_at', new Date(Date.now() - 3600_000).toISOString()).in('status', ['requested', 'confirmed']).order('starts_at').limit(200),
      ]);
      const people = (check(st) as { id: string; name: string; agenda: boolean; active: boolean }[]);
      setStaff(Object.fromEntries(people.map(p => [p.id, p.name])));
      setReady({ services: sv.count ?? 0, staff: people.filter(p => p.agenda && p.active).length });
      setList(check(ap) as Appt[]);
    } catch (e) { a.fail(e); setList([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const agenda = { enabled: f.enabled, auto_confirm: f.auto, step: Number(f.step), lead_minutes: Number(f.lead), days_ahead: Number(f.days),
        cancel_hours: Number(f.cancel), any_staff: f.any, note: f.note.trim() || null };
      check(await supabase.from('restaurants').update({ agenda }).eq('id', r.id).select('id'));
      a.toast(t('Enregistré')); await a.reload();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  const share = `https://wa.me/?text=${encodeURIComponent(t('Prenez rendez-vous chez {name} en ligne : {link}', { name: r.name, link }))}`;
  const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: r.timezone || 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const missing = ready && (!ready.services || !ready.staff);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl font-semibold">{t('Réservation en ligne')}</h1>
        <p className="text-muted">{t('Vos clients choisissent une prestation, une personne ou « peu importe », puis un horaire libre. Seuls les créneaux vraiment libres sont proposés.')}</p>
      </div>

      {missing && (
        <div className="flex items-start gap-3 rounded-2xl bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            {!ready!.services && <p>{t('Aucune prestation réservable en ligne. Ajoutez-en dans « Prestations ».')}</p>}
            {!ready!.staff && <p>{t('Personne ne prend de rendez-vous. Activez-le dans « Équipe et horaires ».')}</p>}
          </div>
        </div>
      )}

      <Reminders r={r} list={list} staff={staff} onSent={load} />

      <Card>
        <div className="flex flex-wrap items-center gap-5">
          {qr && <img src={qr} alt={t('QR de réservation')} className="h-28 w-28 rounded-xl bg-white p-1 ring-1 ring-line/20" />}
          <div className="min-w-[220px] flex-1 space-y-2">
            <p className="flex items-center gap-2 font-semibold"><CalendarCheck2 className="h-4 w-4 text-brand" />{t('Votre lien de réservation')}</p>
            <p className="break-all rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm">{link}</p>
            <p className="text-xs text-muted">{t('À mettre dans la bio Instagram, sur Google et dans vos messages WhatsApp. Le QR se colle au miroir ou à l’accueil.')}</p>
            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => copy(link)}><Copy className="h-4 w-4" /> {t('Copier')}</Btn>
              <a href={link} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm font-semibold"><ExternalLink className="h-4 w-4" /> {t('Voir')}</a>
              {qr && <a href={qr} download={`rdv-${r.slug}.png`} className="inline-flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm font-semibold"><Download className="h-4 w-4" /> QR</a>}
              <a href={share} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm font-semibold"><MessageCircle className="h-4 w-4" /> WhatsApp</a>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-display text-xl font-semibold">{t('Réglages')}</h2>
        <fieldset disabled={!owner} className="space-y-5">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <Toggle checked={f.enabled} onChange={v => setF({ ...f, enabled: v })} label={t('Réservation en ligne ouverte')} />
            <Toggle checked={f.auto} onChange={v => setF({ ...f, auto: v })} label={t('Confirmer automatiquement')} />
            <Toggle checked={f.any} onChange={v => setF({ ...f, any: v })} label={t('Proposer « peu importe »')} />
          </div>
          {!f.auto && <p className="text-xs text-muted">{t('Sans confirmation automatique, le client voit « demande envoyée » jusqu’à ce que le salon confirme.')}</p>}
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label={t('Un horaire toutes les')}>
              <select className={inputCls} value={f.step} onChange={e => setF({ ...f, step: e.target.value })}>{STEPS.map(s => <option key={s} value={s}>{s} min</option>)}</select>
            </Field>
            <Field label={t('Délai minimum')}>
              <select className={inputCls} value={f.lead} onChange={e => setF({ ...f, lead: e.target.value })}>{LEADS.map(s => <option key={s} value={s}>{leadLabel(s)}</option>)}</select>
            </Field>
            <Field label={t('Réservable jusqu’à')}>
              <select className={inputCls} value={f.days} onChange={e => setF({ ...f, days: e.target.value })}>{DAYS.map(s => <option key={s} value={s}>{t('{n} jours', { n: s })}</option>)}</select>
            </Field>
            <Field label={t('Annulation en ligne')}>
              <select className={inputCls} value={f.cancel} onChange={e => setF({ ...f, cancel: e.target.value })}>{CANCELS.map(s => <option key={s} value={s}>{s === 0 ? t('Jusqu’au début') : t('Jusqu’à {n} h avant', { n: s })}</option>)}</select>
            </Field>
          </div>
          <Field label={t('Message aux clients (facultatif)')}>
            <textarea className={`${inputCls} min-h-[70px]`} maxLength={300} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={t('Merci d’arriver 5 minutes avant. Paiement sur place.')} />
          </Field>
        </fieldset>
        {owner && <div className="mt-5 flex justify-end"><Btn tone="brand" disabled={busy} onClick={save}><Save className="h-4 w-4" /> {t('Enregistrer')}</Btn></div>}
      </Card>

      <Card>
        <h2 className="mb-3 font-display text-xl font-semibold">{t('Prochains rendez-vous')}</h2>
        {list === null ? <p className="text-muted">{t('Chargement…')}</p> : !list.length ? <p className="rounded-2xl bg-surface-2 p-5 text-sm text-muted">{t('Aucun rendez-vous à venir.')}</p> : (
          <ul className="divide-y divide-line/10">
            {list.slice(0, 20).map(x => (
              <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <p className="w-40 shrink-0 font-semibold capitalize tabular">{when(x.starts_at)}</p>
                <div className="min-w-[180px] flex-1">
                  <p className="font-semibold">{svcName({ name: x.service_name })} <span className="text-sm font-normal text-muted">· {fmtDuration(x.duration_min)}</span></p>
                  <p className="text-sm text-muted">{x.name}{x.phone ? ` · ${x.phone}` : ''}{x.note ? ` · ${x.note}` : ''}</p>
                </div>
                <p className="text-sm">{x.staff_id ? staff[x.staff_id] ?? '' : ''}{x.any_staff ? <span className="text-muted"> ({t('peu importe')})</span> : null}</p>
                {x.client_confirmed_at && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />{t('Vient')}</span>}
                {x.status === 'requested'
                  ? <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-600">{t('À confirmer')}</span>
                  : <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-bold text-brand"><CheckCircle2 className="h-3.5 w-3.5" />{x.source === 'online' ? t('En ligne') : t('Salon')}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// "Rappels de demain": one WhatsApp per client, ready to send; the salon sees who got it and who confirmed
function Reminders({ r, list, staff, onSent }: { r: Restaurant; list: Appt[] | null; staff: Record<string, string>; onSent: () => void }) {
  const a = useAdminCtx();
  const tz = r.timezone || 'UTC';
  const tomorrow = ymdIn(new Date(Date.now() + 86400_000), tz);
  const rows = (list ?? []).filter(x => ymdIn(new Date(x.starts_at), tz) === tomorrow && x.phone);
  const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const day = new Date(`${tomorrow}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  const send = async (x: Appt) => {
    const link = `${MENU_URL}/${r.slug}?rdv=${x.token}`;
    const text = t('Bonjour {name}, petit rappel de {salon} : votre rendez-vous {service} est demain à {time}. Merci de confirmer ou d’annuler ici : {link}',
      { name: x.name, salon: r.name, service: svcName({ name: x.service_name }), time: time(x.starts_at), link });
    window.open(waLink(x.phone!, text), '_blank', 'noopener');
    try { check(await supabase.from('agenda_appointments').update({ reminded_at: new Date().toISOString() }).eq('id', x.id).select('id')); onSent(); }
    catch (e) { a.fail(e); }
  };
  const left = rows.filter(x => !x.reminded_at).length;
  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h2 className="me-auto flex items-center gap-2 font-display text-xl font-semibold"><BellRing className="h-5 w-5 text-brand" />{t('Rappels de demain')}</h2>
        {rows.length > 0 && <span className="text-sm text-muted">{t('{a} sur {b} envoyés', { a: rows.length - left, b: rows.length })}</span>}
      </div>
      <p className="mb-4 text-sm text-muted first-letter:uppercase">{day}</p>
      {list === null ? <p className="text-muted">{t('Chargement…')}</p> : !rows.length ? <p className="rounded-2xl bg-surface-2 p-5 text-sm text-muted">{t('Aucun rendez-vous demain avec un numéro.')}</p> : (
        <ul className="divide-y divide-line/10">
          {rows.map(x => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 py-3">
              <p className="w-14 shrink-0 font-semibold tabular">{time(x.starts_at)}</p>
              <div className="min-w-[160px] flex-1">
                <p className="font-semibold">{x.name} <span className="text-sm font-normal text-muted">· {svcName({ name: x.service_name })}{x.staff_id && staff[x.staff_id] ? ` · ${staff[x.staff_id]}` : ''}</span></p>
                <p className="text-sm text-muted">{x.phone}</p>
              </div>
              {x.client_confirmed_at
                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />{t('Confirmé par le client')}</span>
                : x.reminded_at ? <span className="text-xs font-semibold text-muted">{t('Rappel envoyé')}</span> : null}
              <Btn tone={x.reminded_at ? undefined : 'brand'} onClick={() => send(x)}><MessageCircle className="h-4 w-4" /> {x.reminded_at ? t('Renvoyer') : t('Envoyer le rappel')}</Btn>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">{t('Chaque bouton ouvre WhatsApp avec le message prêt : appuyez sur envoyer. Le client confirme ou annule avec son lien.')}</p>
    </Card>
  );
}
