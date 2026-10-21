import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PartyPopper, ShieldCheck, AlertTriangle, Cake, Crown, Heart, Printer, UserX, Users, X, Sparkles, Armchair } from 'lucide-react';
import { usePos } from '../store';
import * as db from '../lib/data';
import * as P from '../lib/print';
import { t } from '../lib/i18n';
import { Btn } from './ui';
import { isVip, type Guest } from './Guest';
import { DepositChip } from './Deposit';
import { occasionOf } from '../lib/occasion';
import { mad } from '../lib/format';

// Le Briefing: before service, the maître d' tells the team who is coming tonight. One screen
// (and one printed sheet): the covers per half hour, the allergies, the VIPs, the birthdays,
// the regulars and their habits, the guests who did not come before.

interface BBooking {
  id: string; starts_at: string; status: 'requested' | 'confirmed' | 'seated'; source: string;
  party_size: number; name: string; phone: string | null; note: string | null; table: string | null;
  guest: Guest | null; no_shows: number; birthday_in: number | null;
  occasion?: string | null; deposit_cents?: number | string | null; deposit_state?: string | null; deposit_left?: number | string;
}
interface Brief { day: string; files: boolean; bookings: BBooking[] }

const REGULAR = 5; // visits from which a guest is a regular

const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hm = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
/** 19:47 -> 19:30 */
const slotOf = (iso: string, tz: string) => { const [h, m] = hm(iso, tz).split(':'); return `${h}:${Number(m) < 30 ? '00' : '30'}`; };
const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function BriefingView({ onClose }: { onClose: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const tz = r.timezone;
  const today = ymd(new Date(), tz);
  const tomorrow = ymd(new Date(Date.now() + 86400_000), tz);
  const [day, setDay] = useState(today);
  const [b, setB] = useState<Brief | null>(null);

  useEffect(() => {
    if (!pos.requireOnline()) { onClose(); return; }
    setB(null);
    let gone = false;
    db.rpc<Brief>('pos_briefing', { p_restaurant_id: r.id, p_day: day }).then(x => { if (!gone) setB(x); }, e => { pos.fail(e); });
    return () => { gone = true; };
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = useMemo(() => {
    const list = b?.bookings ?? [];
    const covers = list.reduce((s, x) => s + x.party_size, 0);
    const slots = new Map<string, number>();
    list.forEach(x => slots.set(slotOf(x.starts_at, tz), (slots.get(slotOf(x.starts_at, tz)) ?? 0) + x.party_size));
    const peak = Math.max(1, ...slots.values());
    return {
      list, covers, slots: [...slots.entries()].sort(([a], [c]) => a.localeCompare(c)), peak,
      allergies: list.filter(x => x.guest?.allergies),
      vip: list.filter(x => isVip(x.guest)),
      birthdays: list.filter(x => x.birthday_in != null),
      risk: list.filter(x => x.no_shows > 0 && x.status !== 'seated'),
      regulars: list.filter(x => (x.guest?.visits ?? 0) >= REGULAR && !isVip(x.guest)),
      firsts: list.filter(x => b?.files && (!x.guest || x.guest.visits === 0)),
      toConfirm: list.filter(x => x.status === 'requested'),
      occasions: list.filter(x => occasionOf(x.occasion)),
      depositsDue: list.filter(x => x.deposit_state === 'due'),
    };
  }, [b, tz]);

  const when = (x: BBooking) => `${hm(x.starts_at, tz)}${x.table ? ` · ${t('table {n}', { n: x.table })}` : ''}`;
  const bday = (n: number) => (n === 0 ? t('aujourd’hui') : n === 1 ? t('demain') : t('dans {n} jours', { n }));
  const dayLabel = new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  // the sheet for the receipt printer: what the team keeps in the pocket during service
  const print = async () => {
    if (!b) return;
    const L: P.TicketLine[] = [];
    const rule = (c = '-') => L.push({ text: c.repeat(32) });
    const line = (s: string, bold = false) => L.push({ text: ascii(s), bold });
    L.push({ text: 'LE BRIEFING', bold: true, large: true, center: true });
    L.push({ text: ascii(`${r.name} - ${dayLabel}`), center: true });
    rule('=');
    line(`${v.list.length} reservations, ${v.covers} couverts`, true);
    const block = (title: string, xs: BBooking[], detail: (x: BBooking) => string) => {
      if (!xs.length) return;
      rule(); line(title, true);
      xs.forEach(x => { line(`${hm(x.starts_at, tz)} ${x.name} (${x.party_size})${x.table ? ' T' + x.table : ''}`); const d = detail(x); if (d) line(`  > ${d}`, true); });
    };
    block('!! ALLERGIES', v.allergies, x => x.guest!.allergies!);
    block('VIP', v.vip, x => x.guest?.note ?? '');
    block('ANNIVERSAIRES', v.birthdays, x => bday(x.birthday_in!));
    block('OCCASIONS', v.occasions, x => occasionOf(x.occasion)!.kitchen ?? ascii(occasionOf(x.occasion)!.label()));
    block('ACOMPTE A RECEVOIR', v.depositsDue, x => `${Number(x.deposit_cents ?? 0) / 100} DH`);
    block('DEJA PAS VENUS', v.risk, x => `${x.no_shows} fois`);
    block('HABITUES', v.regulars, x => [`${x.guest!.visits} visites`, x.guest?.note].filter(Boolean).join(', '));
    rule(); line('TOUTES LES RESERVATIONS', true);
    v.list.forEach(x => { line(`${hm(x.starts_at, tz)} ${x.name} (${x.party_size})${x.table ? ' T' + x.table : ''}`); if (x.note) line(`  ${x.note}`); });
    rule('=');
    try { await P.print(P.receiptPrinter(r.pos_settings ?? {}), 'Briefing', L); pos.toast(t('Briefing imprimé'), 'ok'); }
    catch (e) { pos.fail(e); }
  };

  return createPortal((
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-2 border-b border-line/[0.07] bg-surface px-5 py-3">
        <div className="me-3">
          <h2 className="font-display text-2xl font-semibold leading-tight">{t('Briefing du soir')}</h2>
          <p className="text-sm text-muted first-letter:uppercase">{dayLabel}</p>
        </div>
        <span className="flex rounded-full bg-surface-2 p-0.5">
          {([[today, t('Aujourd’hui')], [tomorrow, t('Demain')]] as const).map(([d, l]) => (
            <button key={d} onClick={() => setDay(d)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${day === d ? 'gold-fill text-brand-ink' : 'text-muted'}`}>{l}</button>
          ))}
        </span>
        <span className="flex-1" />
        <Btn disabled={!b || !v.list.length} onClick={print}><Printer className="h-4 w-4" /> {t('Imprimer')}</Btn>
        <Btn onClick={onClose}><X className="h-4 w-4" /> {t('Fermer')}</Btn>
      </header>

      <main className="scroll-thin flex-1 overflow-y-auto p-5">
        {!b ? <p className="text-muted">{t('Chargement…')}</p> : !v.list.length ? (
          <div className="panel mx-auto mt-10 max-w-md rounded-3xl p-10 text-center">
            <Sparkles className="mx-auto h-10 w-10 text-brand/60" />
            <p className="mt-3 font-display text-xl font-semibold">{t('Aucune réservation ce jour-là.')}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Figure label={t('Réservations')} value={v.list.length} />
              <Figure label={t('Couverts')} value={v.covers} />
              <Figure label={t('Allergies')} value={v.allergies.length} tone={v.allergies.length ? 'danger' : undefined} />
              <Figure label="VIP" value={v.vip.length} tone={v.vip.length ? 'gold' : undefined} />
              <Figure label={t('Anniversaires')} value={v.birthdays.length} />
              {b.files ? <Figure label={t('Première visite')} value={v.firsts.length} /> : <Figure label={t('À confirmer')} value={v.toConfirm.length} />}
            </div>

            <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
              <section className="panel rounded-3xl p-5">
                <h3 className="mb-4 font-display text-lg font-semibold">{t('Le rythme de la soirée')}</h3>
                <div className="space-y-2">
                  {v.slots.map(([s, n]) => (
                    <div key={s} className="flex items-center gap-3">
                      <span className="w-12 font-semibold tabular text-muted" dir="ltr">{s}</span>
                      <div className="h-7 flex-1 overflow-hidden rounded-lg bg-surface-2">
                        <div className={`flex h-full items-center rounded-lg px-2 text-xs font-bold ${n === v.peak ? 'gold-fill text-brand-ink' : 'bg-brand/25 text-ink'}`}
                          style={{ width: `${Math.max(12, (n / v.peak) * 100)}%` }}>{t('{n} couv.', { n })}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {v.slots.length > 1 && <p className="mt-4 text-sm text-muted">{t('Le coup de feu : {s}.', { s: v.slots.filter(([, n]) => n === v.peak).map(([s]) => s).join(', ') })}</p>}
              </section>

              <section className="space-y-3">
                <h3 className="font-display text-lg font-semibold">{t('À savoir ce soir')}</h3>
                {!b.files && <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{t('Activez le fichier clients pour voir ici les allergies, les VIP, les anniversaires et les habitués.')}</p>}
                <Know tone="danger" icon={<AlertTriangle className="h-4 w-4" />} title={t('Allergies')} xs={v.allergies} when={when} detail={x => x.guest!.allergies!} />
                <Know tone="gold" icon={<Crown className="h-4 w-4" />} title="VIP" xs={v.vip} when={when} detail={x => x.guest?.note ?? ''} />
                <Know tone="pink" icon={<Cake className="h-4 w-4" />} title={t('Anniversaires')} xs={v.birthdays} when={when} detail={x => t('Anniversaire {d}', { d: bday(x.birthday_in!) })} />
                <Know tone="pink" icon={<PartyPopper className="h-4 w-4" />} title={t('Occasions')} xs={v.occasions} when={when} detail={x => occasionOf(x.occasion)!.label()} />
                <Know tone="warn" icon={<ShieldCheck className="h-4 w-4" />} title={t('Acompte à recevoir')} xs={v.depositsDue} when={when} detail={x => mad(Number(x.deposit_cents ?? 0))} />
                <Know tone="warn" icon={<UserX className="h-4 w-4" />} title={t('Déjà pas venus')} xs={v.risk} when={when} detail={x => t('{n} fois pas venu', { n: x.no_shows })} />
                <Know tone="plain" icon={<Heart className="h-4 w-4" />} title={t('Habitués')} xs={v.regulars} when={when} detail={x => [t('{n} visites', { n: x.guest!.visits }), x.guest?.note].filter(Boolean).join(' · ')} />
                {b.files && !v.allergies.length && !v.vip.length && !v.birthdays.length && !v.risk.length && !v.regulars.length && !v.occasions.length && !v.depositsDue.length && (
                  <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{t('Rien de particulier ce soir.')}</p>
                )}
              </section>
            </div>

            <section className="panel overflow-hidden rounded-3xl">
              <h3 className="border-b border-line/[0.07] px-5 py-3 font-display text-lg font-semibold">{t('Toutes les réservations')}</h3>
              <ul className="divide-y divide-line/[0.06]">
                {v.list.map(x => (
                  <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <span className="w-14 font-display text-xl font-semibold tabular" dir="ltr">{hm(x.starts_at, tz)}</span>
                    <span className="min-w-[160px] flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-semibold">{x.name}
                        <span className="flex items-center gap-1 text-sm text-muted"><Users className="h-3.5 w-3.5" />{x.party_size}</span>
                        {x.table && <span className="flex items-center gap-1 text-sm text-muted"><Armchair className="h-3.5 w-3.5" />{x.table}</span>}
                        {x.status === 'requested' && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-bold text-warn">{t('À confirmer')}</span>}
                        {x.status === 'seated' && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">{t('Installé')}</span>}
                      </span>
                      {(x.note || x.guest?.note) && <span className="block text-sm text-muted">{[x.note, x.guest?.note].filter(Boolean).join(' · ')}</span>}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {x.guest?.allergies && <Chip cls="bg-danger text-white"><AlertTriangle className="h-3 w-3" />{x.guest.allergies}</Chip>}
                      {isVip(x.guest) && <Chip cls="bg-[#f5c542] text-[#3a2a00]"><Crown className="h-3 w-3" />VIP</Chip>}
                      {x.birthday_in != null && <Chip cls="bg-pink-500/20 text-pink-400"><Cake className="h-3 w-3" />{t('Anniversaire {d}', { d: bday(x.birthday_in) })}</Chip>}
                      {x.no_shows > 0 && <Chip cls="bg-warn/15 text-warn"><UserX className="h-3 w-3" />{x.no_shows}</Chip>}
                      {occasionOf(x.occasion) && <Chip cls="bg-pink-500/20 text-pink-400"><PartyPopper className="h-3 w-3" />{occasionOf(x.occasion)!.label()}</Chip>}
                      {x.deposit_state && <DepositChip x={{ deposit_cents: x.deposit_cents ?? null, deposit_state: x.deposit_state as 'due' }} />}
                      {b.files && (x.guest?.visits ? <Chip cls="bg-surface-2 text-muted">{t('{n} visites', { n: x.guest.visits })}</Chip> : <Chip cls="bg-qr/15 text-qr">{t('Première visite')}</Chip>)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </main>
    </div>
  ), document.body);
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'gold' }) {
  return (
    <div className={`rounded-2xl px-4 py-3 ${tone === 'danger' ? 'bg-danger/15 text-danger' : tone === 'gold' ? 'bg-[#f5c542]/15 text-[#f5c542]' : 'panel'}`}>
      <p className={`text-xs font-semibold ${tone ? '' : 'text-muted'}`}>{label}</p>
      <p className="font-display text-3xl font-semibold tabular">{value}</p>
    </div>
  );
}
function Chip({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}>{children}</span>;
}
const TONES = {
  danger: 'border-danger/40 bg-danger/10 text-danger', gold: 'border-[#f5c542]/40 bg-[#f5c542]/10 text-[#f5c542]',
  pink: 'border-pink-400/40 bg-pink-500/10 text-pink-400', warn: 'border-warn/40 bg-warn/10 text-warn', plain: 'border-line/10 bg-surface text-brand',
};
function Know({ tone, icon, title, xs, when, detail }: {
  tone: keyof typeof TONES; icon: ReactNode; title: string; xs: BBooking[]; when: (x: BBooking) => string; detail: (x: BBooking) => string;
}) {
  if (!xs.length) return null;
  return (
    <div className={`rounded-2xl border p-4 ${TONES[tone]}`}>
      <p className="mb-2 flex items-center gap-2 text-sm font-bold">{icon}{title} ({xs.length})</p>
      <ul className="space-y-1.5">
        {xs.map(x => (
          <li key={x.id} className="text-ink">
            <span className="font-semibold">{x.name}</span>
            <span className="text-sm text-muted"> · {when(x)} · {x.party_size} {t('pers.')}</span>
            {detail(x) && <span className="block text-sm font-semibold opacity-90">{detail(x)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
