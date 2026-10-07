// Reservations and waitlist: settings, the links and QR codes to share, and the coming bookings.
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { CalendarDays, Copy, Download, ExternalLink, Hourglass, Save, Users } from 'lucide-react';
import { supabase, MENU_URL } from '../lib/supabase';
import { check } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Toggle, inputCls } from '../components/ui';

interface Row { id: string; kind: string; status: string; starts_at: string | null; party_size: number; name: string; phone: string | null; source: string; note: string | null }
// i18n:values
const ST: Record<string, string> = { requested: 'À confirmer', confirmed: 'Confirmée', called: 'Appelé', seated: 'Installé', cancelled: 'Annulée', no_show: 'Pas venu' };
// i18n:end

export function BookingPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const b = r.booking ?? {};
  const owner = a.canEditProfile;
  const [f, setF] = useState({
    enabled: !!b.enabled, waitlist: !!b.waitlist, auto: !!b.auto_confirm, capacity: String(b.capacity ?? 40), duration: String(b.duration_min ?? 90),
    slot: String(b.slot_minutes ?? 30), lead: String(b.lead_minutes ?? 60), days: String(b.days_ahead ?? 30), max: String(b.max_party ?? 8), note: b.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [qrs, setQrs] = useState<{ book: string; wait: string }>({ book: '', wait: '' });
  const [rows, setRows] = useState<Row[] | null>(null);
  const bookLink = `${MENU_URL}/${r.slug}?reserver`, waitLink = `${MENU_URL}/${r.slug}?file`;
  useEffect(() => {
    Promise.all([bookLink, waitLink].map(l => QRCode.toDataURL(l, { margin: 1, width: 600, color: { dark: '#001E3E', light: '#FFFFFF' } })))
      .then(([book, wait]) => setQrs({ book, wait })).catch(() => {});
  }, [bookLink, waitLink]);
  const load = useCallback(async () => {
    try {
      setRows(check(await supabase.from('reservations').select('id,kind,status,starts_at,party_size,name,phone,source,note').eq('restaurant_id', r.id).eq('kind', 'booking')
        .gte('starts_at', new Date(Date.now() - 3 * 3600_000).toISOString()).lt('starts_at', new Date(Date.now() + 8 * 86400_000).toISOString()).order('starts_at')) as Row[]);
    } catch (e) { a.fail(e); setRows([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    const n = (v: string, d: number) => Math.round(Number(v) || d);
    try {
      const booking = { enabled: f.enabled, waitlist: f.waitlist, auto_confirm: f.auto, capacity: n(f.capacity, 40), duration_min: n(f.duration, 90),
        slot_minutes: n(f.slot, 30), lead_minutes: n(f.lead, 60), days_ahead: n(f.days, 30), max_party: n(f.max, 8), note: f.note.trim() || null };
      check(await supabase.from('restaurants').update({ booking }).eq('id', r.id).select('id'));
      a.toast(t('Enregistré')); await a.reload();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  const byDay = (rows ?? []).filter(x => x.status !== 'cancelled').reduce<Record<string, Row[]>>((m, x) => {
    const d = new Date(x.starts_at!).toLocaleDateString(dateLocale(), { timeZone: r.timezone, weekday: 'long', day: 'numeric', month: 'long' });
    (m[d] ??= []).push(x); return m;
  }, {});
  const hm = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { timeZone: r.timezone, hour: '2-digit', minute: '2-digit' });

  const LinkCard = ({ title, text, link, qr, Icon, file }: { title: string; text: string; link: string; qr: string; Icon: typeof CalendarDays; file: string }) => (
    <div className="flex items-center gap-4 rounded-3xl bg-white/5 p-4 ring-1 ring-white/10">
      {qr && <img src={qr} alt={title} className="h-24 w-24 rounded-xl bg-white p-1" />}
      <div className="min-w-0 space-y-1.5">
        <p className="flex items-center gap-2 font-semibold"><Icon className="h-4 w-4 text-brand" />{title}</p>
        <p className="text-xs text-white/60">{text}</p>
        <div className="flex flex-wrap gap-1.5">
          <Btn className="px-2.5 py-1 text-sm" onClick={() => copy(link)}><Copy className="h-3.5 w-3.5" /> {t('Copier')}</Btn>
          <a href={link} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-2.5 py-1 text-sm font-semibold hover:bg-white/15"><ExternalLink className="h-3.5 w-3.5" /> {t('Voir')}</a>
          {qr && <a href={qr} download={file} className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-2.5 py-1 text-sm font-semibold hover:bg-white/15"><Download className="h-3.5 w-3.5" /> QR</a>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand">Amplify POS</p>
        <h1 className="font-display text-3xl font-semibold">{t('Réservations')}</h1>
        <p className="text-muted">{t('Les clients réservent depuis votre lien, uniquement aux heures où il reste de la place. L’accueil gère tout depuis la caisse, onglet « Réservations ».')}</p>
      </div>
      <div className="night grid gap-4 rounded-[2rem] p-6 md:grid-cols-2 md:p-7">
        <LinkCard title={t('Lien de réservation')} text={t('Pour Instagram, Google, WhatsApp et votre site.')} link={bookLink} qr={qrs.book} Icon={CalendarDays} file={`reserver-${r.slug}.png`} />
        <LinkCard title={t('QR de la file d’attente')} text={t('À coller à l’entrée : les clients s’inscrivent et voient leur place.')} link={waitLink} qr={qrs.wait} Icon={Hourglass} file={`file-${r.slug}.png`} />
        {!r.booking?.enabled && !r.booking?.waitlist && <p className="text-sm text-warn md:col-span-2">{t('Activez les réservations ou la file d’attente ci-dessous pour que ces liens fonctionnent.')}</p>}
      </div>

      <Card>
        <h2 className="mb-4 font-display text-xl font-semibold">{t('Réglages')}</h2>
        <fieldset disabled={!owner} className="space-y-5">
          <div className="flex flex-wrap gap-6">
            <Toggle checked={f.enabled} onChange={v => setF({ ...f, enabled: v })} label={t('Réservations en ligne')} />
            <Toggle checked={f.waitlist} onChange={v => setF({ ...f, waitlist: v })} label={t('File d’attente')} />
            <Toggle checked={f.auto} onChange={v => setF({ ...f, auto: v })} label={t('Confirmer automatiquement')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Field label={t('Places en même temps')}><input className={inputCls} inputMode="numeric" value={f.capacity} onChange={e => setF({ ...f, capacity: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('Durée d’un repas (min)')}><input className={inputCls} inputMode="numeric" value={f.duration} onChange={e => setF({ ...f, duration: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('Créneaux')}><select className={inputCls} value={f.slot} onChange={e => setF({ ...f, slot: e.target.value })}><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 h</option></select></Field>
            <Field label={t('Au plus tôt (min avant)')}><input className={inputCls} inputMode="numeric" value={f.lead} onChange={e => setF({ ...f, lead: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('Jusqu’à (jours)')}><input className={inputCls} inputMode="numeric" value={f.days} onChange={e => setF({ ...f, days: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('Groupe max. en ligne')}><input className={inputCls} inputMode="numeric" value={f.max} onChange={e => setF({ ...f, max: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <Field label={t('Message aux clients')}><input className={inputCls} maxLength={200} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={t('Table gardée 15 minutes. Pour plus de 8 personnes, appelez-nous.')} /></Field>
          <p className="text-sm text-muted">{t('Les heures proposées suivent vos horaires d’ouverture (page Commande en ligne). « Places en même temps » : le nombre de couverts que vous acceptez par réservation sur une même période.')}</p>
        </fieldset>
        {owner && <div className="mt-5 flex justify-end"><Btn tone="brand" disabled={busy} onClick={save}><Save className="h-4 w-4" /> {t('Enregistrer')}</Btn></div>}
      </Card>

      <Card>
        <h2 className="mb-4 font-display text-xl font-semibold">{t('Les 7 prochains jours')}</h2>
        {rows === null ? <p className="text-muted">{t('Chargement…')}</p> : !Object.keys(byDay).length ? <p className="text-muted">{t('Aucune réservation à venir.')}</p> : (
          <div className="space-y-4">
            {Object.entries(byDay).map(([d, xs]) => (
              <div key={d}>
                <p className="mb-1 flex items-center gap-2 font-semibold capitalize">{d}<span className="text-sm font-normal text-muted">· {t('{n} couverts', { n: xs.filter(x => x.status !== 'no_show').reduce((s, x) => s + x.party_size, 0) })}</span></p>
                <ul className="divide-y divide-line/10 rounded-2xl bg-surface-2 px-3">
                  {xs.map(x => (
                    <li key={x.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                      <span className="w-12 font-semibold tabular" dir="ltr">{hm(x.starts_at!)}</span>
                      <span className="min-w-0 flex-1 truncate">{x.name} <span className="text-muted">· <Users className="inline h-3.5 w-3.5" /> {x.party_size}{x.note ? ` · ${x.note}` : ''}</span></span>
                      <span className="text-xs text-muted">{x.source === 'online' ? t('En ligne') : t('Téléphone')}</span>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-bold">{t(ST[x.status] ?? x.status)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
