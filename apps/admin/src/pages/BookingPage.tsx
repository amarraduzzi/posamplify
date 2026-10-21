// Reservations and waitlist: settings, the links and QR codes to share, and the coming bookings.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { CalendarDays, Copy, Download, ExternalLink, Hourglass, Save } from 'lucide-react';
import { supabase, MENU_URL } from '../lib/supabase';
import { check } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Toggle, inputCls } from '../components/ui';
import { BookingList, useBookings } from '../components/BookingInbox';
import { HoursEditor, cleanHours, type Hours } from '../components/HoursEditor';
import { OffersCard } from '../components/Offers';


export function BookingPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const b = r.booking ?? {};
  const owner = a.canEditProfile;
  // without the till nobody watches a screen all day: bookings are confirmed automatically unless the owner changes it
  const hasPos = (r.products ?? ['pos']).includes('pos');
  const maitre = hasPos && (r.products ?? []).includes('maitre');
  // restaurants without the till set their opening hours right here (the same hours as online ordering)
  const hoursHere = !hasPos;
  const noHours = !Object.keys(r.opening_hours ?? {}).length;
  const [hours, setHours] = useState<Hours>(() => (Object.keys(r.opening_hours ?? {}).length ? r.opening_hours : {}));
  const [useHours, setUseHours] = useState(() => Object.keys(r.opening_hours ?? {}).length > 0);
  const [f, setF] = useState({
    enabled: !!b.enabled, waitlist: !!b.waitlist, auto: b.auto_confirm ?? !hasPos, capacity: String(b.capacity ?? 40), duration: String(b.duration_min ?? 90),
    slot: String(b.slot_minutes ?? 30), lead: String(b.lead_minutes ?? 60), days: String(b.days_ahead ?? 30), max: String(b.max_party ?? 8), note: b.note ?? '',
    // the deposit (acompte): from N guests, X DH per guest; how to pay it (RIB, on site)
    dep: Number(b.deposit_party ?? 0) > 0 && Number(b.deposit_cents ?? 0) > 0, depParty: String(b.deposit_party || 6),
    depAmount: b.deposit_cents ? String(Number(b.deposit_cents) / 100) : '100', depNote: b.deposit_note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [qrs, setQrs] = useState<{ book: string; wait: string }>({ book: '', wait: '' });
  const bookLink = `${MENU_URL}/${r.slug}?reserver`, waitLink = `${MENU_URL}/${r.slug}?file`;
  useEffect(() => {
    Promise.all([bookLink, waitLink].map(l => QRCode.toDataURL(l, { margin: 1, width: 600, color: { dark: '#001E3E', light: '#FFFFFF' } })))
      .then(([book, wait]) => setQrs({ book, wait })).catch(() => {});
  }, [bookLink, waitLink]);
  const { rows, set } = useBookings(r, 8);

  const save = async () => {
    setBusy(true);
    const n = (v: string, d: number) => Math.round(Number(v) || d);
    try {
      const booking = { enabled: f.enabled, waitlist: f.waitlist, auto_confirm: f.auto, capacity: n(f.capacity, 40), duration_min: n(f.duration, 90),
        slot_minutes: n(f.slot, 30), lead_minutes: n(f.lead, 60), days_ahead: n(f.days, 30), max_party: n(f.max, 8), note: f.note.trim() || null,
        ...(f.dep ? { deposit_party: Math.max(1, n(f.depParty, 6)), deposit_cents: Math.max(100, Math.round((Number(f.depAmount.replace(',', '.')) || 0) * 100)) } : {}),
        deposit_note: f.depNote.trim() || null };
      check(await supabase.from('restaurants').update({ booking, ...(hoursHere ? { opening_hours: cleanHours(hours, useHours) } : {}) }).eq('id', r.id).select('id'));
      a.toast(t('Enregistré')); await a.reload();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };

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
        <h1 className="font-display text-3xl font-semibold">{t('Réservations')}</h1>
        <p className="text-muted">{hasPos
          ? t('Les clients réservent depuis votre lien, uniquement aux heures où il reste de la place. L’accueil gère tout depuis la caisse, onglet « Réservations ».')
          : t('Les clients réservent depuis votre site ou votre lien, uniquement aux heures où il reste de la place. Vous les voyez ici et sur l’écran des commandes, avec un son pour chaque nouvelle demande.')}</p>
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
          {!f.auto && <p className="text-sm text-warn">{t('Chaque demande attend votre réponse : confirmez ou refusez vite, le client attend.')}</p>}
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Field label={t('Places en même temps')}><input className={inputCls} inputMode="numeric" value={f.capacity} onChange={e => setF({ ...f, capacity: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('Durée d’un repas (min)')}><input className={inputCls} inputMode="numeric" value={f.duration} onChange={e => setF({ ...f, duration: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('Créneaux')}><select className={inputCls} value={f.slot} onChange={e => setF({ ...f, slot: e.target.value })}><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 h</option></select></Field>
            <Field label={t('Au plus tôt (min avant)')}><input className={inputCls} inputMode="numeric" value={f.lead} onChange={e => setF({ ...f, lead: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('Jusqu’à (jours)')}><input className={inputCls} inputMode="numeric" value={f.days} onChange={e => setF({ ...f, days: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('Groupe max. en ligne')}><input className={inputCls} inputMode="numeric" value={f.max} onChange={e => setF({ ...f, max: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <Field label={t('Message aux clients')}><input className={inputCls} maxLength={200} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={t('Table gardée 15 minutes. Pour plus de 8 personnes, appelez-nous.')} /></Field>
          {maitre ? <div className="space-y-3 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <Toggle checked={f.dep} onChange={v => setF({ ...f, dep: v })} label={t('Acompte pour garantir la table')} />
            <p className="text-sm text-muted">{t('Contre les tables réservées où personne ne vient. L’acompte se déduit de l’addition le soir même ; en cas d’absence, vous pouvez le conserver.')}</p>
            {f.dep && <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('À partir de (personnes)')}><input className={inputCls} inputMode="numeric" value={f.depParty} onChange={e => setF({ ...f, depParty: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label={t('Par personne (MAD)')}><input className={inputCls} inputMode="decimal" value={f.depAmount} onChange={e => setF({ ...f, depAmount: e.target.value })} /></Field>
            </div>}
            <Field label={t('Comment payer l’acompte (envoyé au client)')}><input className={inputCls} maxLength={200} value={f.depNote} onChange={e => setF({ ...f, depNote: e.target.value })} placeholder={t('Virement : RIB 000 000 000, ou sur place')} /></Field>
          </div> : <p className="rounded-2xl bg-white/5 p-4 text-sm text-muted ring-1 ring-white/10">{t('Acompte pour garantir la table, avant-service et fiche client : inclus dans Amplify Maître. Demandez-le à votre conseiller Amplify.')}</p>}
          {hoursHere
            ? <>
                <HoursEditor hours={hours} setHours={setHours} useHours={useHours} setUseHours={setUseHours} />
                {f.enabled && !useHours && <p className="text-sm font-semibold text-warn">{t('Indiquez vos horaires : sans horaires, les clients peuvent réserver à toute heure, même la nuit.')}</p>}
                <p className="text-sm text-muted">{t('Les heures proposées suivent ces horaires. « Places en même temps » : le nombre de couverts que vous acceptez par réservation sur une même période.')}</p>
              </>
            : <>
                {f.enabled && noHours && <p className="text-sm font-semibold text-warn">{t('Indiquez vos horaires dans Commande en ligne : sans horaires, les clients peuvent réserver à toute heure, même la nuit.')}</p>}
                <p className="text-sm text-muted">{t('Les heures proposées suivent vos horaires d’ouverture (page Commande en ligne). « Places en même temps » : le nombre de couverts que vous acceptez par réservation sur une même période.')}</p>
              </>}
        </fieldset>
        {owner && <div className="mt-5 flex justify-end"><Btn tone="brand" disabled={busy} onClick={save}><Save className="h-4 w-4" /> {t('Enregistrer')}</Btn></div>}
      </Card>

      {maitre && <OffersCard r={r} />}

      <Card>
        <h2 className="mb-4 font-display text-xl font-semibold">{t('Les 7 prochains jours')}</h2>
        {rows === null ? <p className="text-muted">{t('Chargement…')}</p> : <BookingList r={r} rows={rows} set={set} />}
      </Card>
    </div>
  );
}
