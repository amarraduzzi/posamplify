// Amplify Profit: the team. Hours (clocked on the till or typed), labour cost
// as % of revenue, and with Amplify POS per person: sales, discounts,
// cancellations and lines removed after the kitchen got them.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Eye, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, fromCents, mad, rpc, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { pct } from '../lib/profit';
import { Btn, Field, Modal, inputCls } from '../components/ui';

interface Person {
  staff_id: string; name: string; role: 'staff' | 'manager'; active: boolean; hourly_cost_cents: number | null;
  hours: number; open_now: boolean; forgot: number; labour_cents: number | null;
  orders: number; sales_cents: number; avg_ticket_cents: number | null;
  discounts: number; discount_cents: number; discounts_approved: number; discounts_approved_cents: number;
  cancellations: number; cancelled_cents: number; cancellations_approved: number; cancellations_approved_cents: number;
  removed_lines: number; removed_cents: number; credit_notes: number; credit_note_cents: number;
  tips_cents: number; payouts: number; payout_cents: number; leak_cents: number; leak_bp: number | null; watch: boolean;
  closings: number; closings_counted: number; cash_diff_cents: number; cash_short_cents: number;
}
interface Report {
  from: string; to: string; uses_pos: boolean; revenue_ht_cents: number; revenue_source: 'pos' | 'manual' | null; labour_bp: number | null;
  team: { hours: number; labour_cents: number; unpriced_hours: number; sales_cents: number; leak_cents: number; open_now: number; forgot: number; cash_short_cents: number; cash_diff_cents: number; closings_counted: number };
  people: Person[];
}
interface Shift { id: string; staff_id: string; clock_in: string; clock_out: string | null; source: 'pos' | 'manual'; note: string | null }
type Range = 'week' | 'lastweek' | 'month' | 'lastmonth';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function period(k: Range): [string, string] {
  const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (k === 'week') return [iso(monday), iso(d)];
  if (k === 'lastweek') { const a = new Date(monday); a.setDate(a.getDate() - 7); const b = new Date(monday); b.setDate(b.getDate() - 1); return [iso(a), iso(b)]; }
  if (k === 'month') return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)];
  return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))];
}
const hrs = (h: number) => { const m = Math.round(Number(h) * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };

/** Wall-clock date + time in the restaurant's time zone -> ISO instant. */
function zoned(date: string, time: string, tz: string): string {
  const [y, mo, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const asTz = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asTz - guess)).toISOString();
}
const local = (isoTs: string, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(isoTs)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};

export function TeamPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [range, setRange] = useState<Range>('week');
  const [rep, setRep] = useState<Report | null>(null);
  const [open, setOpen] = useState<Person | null>(null);
  const [adding, setAdding] = useState(false);
  const [from, to] = useMemo(() => period(range), [range]);

  const load = useCallback(async () => {
    try { setRep(await rpc<Report>('staff_report', { p_restaurant_id: r.id, p_from: from, p_to: to })); } catch (e) { a.fail(e); }
  }, [r.id, from, to, a]);
  useEffect(() => { load(); }, [load]);

  const RANGES: [Range, string][] = [['week', t('Cette semaine')], ['lastweek', t('Semaine dernière')], ['month', t('Ce mois')], ['lastmonth', t('Mois dernier')]];
  const pos = !!rep?.uses_pos;
  const watch = rep?.people.filter(p => p.watch) ?? [];
  const forgot = rep?.people.filter(p => p.forgot > 0) ?? [];
  const short = rep?.people.filter(p => Number(p.cash_short_cents) <= -5000) ?? [];
  const noRate = rep?.people.filter(p => p.hours > 0 && p.hourly_cost_cents == null) ?? [];
  const lb = rep?.labour_bp ?? null;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand">Amplify Profit</p>
          <h1 className="font-display text-3xl font-semibold">{t('Équipe')}</h1>
          <p className="text-muted">{t('Les heures, ce que coûte l’équipe, et qui laisse filer de l’argent.')}</p>
        </div>
        {!r.products?.includes('pos') && <Btn onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> {t('Ajouter un employé')}</Btn>}
        <div role="tablist" className="flex gap-1 overflow-x-auto rounded-2xl border border-line/[0.1] bg-surface p-1">
          {RANGES.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={range === k} onClick={() => setRange(k)}
              className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-semibold ${range === k ? 'bg-night text-white' : 'text-muted hover:bg-surface-2'}`}>{label}</button>
          ))}
        </div>
      </div>

      {!rep ? <p className="text-muted">{t('Chargement…')}</p> : (<>
        <div className="night mb-5 grid gap-6 rounded-[2rem] p-6 sm:grid-cols-2 lg:grid-cols-4 md:p-8">
          <Kpi label={t('Heures travaillées')} value={hrs(rep.team.hours)} hint={t('{n} présent(s) maintenant', { n: rep.team.open_now })} />
          <Kpi label={t('Coût du personnel')} value={mad(rep.team.labour_cents)} hint={rep.team.unpriced_hours > 0 ? t('{h} sans coût horaire', { h: hrs(rep.team.unpriced_hours) }) : t('heures × coût horaire')} />
          <Kpi label={t('% du chiffre d’affaires')} value={pct(lb)} tone={lb == null ? undefined : lb > 3500 ? 'bad' : 'ok'}
            hint={rep.revenue_source ? t('Repère restaurant : 25 à 35 %') : t('Indiquez le chiffre d’affaires dans Charges')} />
          {pos
            ? <Kpi label={t('Sorti de l’addition')} value={mad(rep.team.leak_cents)} tone={rep.team.leak_cents > 0 ? 'bad' : undefined} hint={t('remises, annulations, articles retirés')} />
            : <Kpi label={t('Chiffre d’affaires HT')} value={mad(rep.revenue_ht_cents)} hint={rep.revenue_source === 'manual' ? t('saisi dans Charges') : t('pas encore indiqué')} />}
        </div>

        {(watch.length > 0 || short.length > 0 || forgot.length > 0 || noRate.length > 0) && (
          <div className="mb-5 space-y-2">
            {watch.map(p => (
              <button key={p.staff_id} onClick={() => setOpen(p)} className="flex w-full items-start gap-2 rounded-2xl border border-danger/40 bg-danger/5 px-4 py-3 text-start text-sm hover:bg-danger/10">
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <span><b>{p.name}</b> : {t('{v} sortis de ses additions ({p} de ses ventes), bien plus que le reste de l’équipe.', { v: mad(p.leak_cents), p: pct(p.leak_bp) })} <span className="text-muted">{t('Voir le détail')}</span></span>
              </button>
            ))}
            {short.map(p => (
              <button key={'c' + p.staff_id} onClick={() => setOpen(p)} className="flex w-full items-start gap-2 rounded-2xl border border-danger/40 bg-danger/5 px-4 py-3 text-start text-sm hover:bg-danger/10">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <span><b>{p.name}</b> : {t('il manquait {v} en caisse aux clôtures qu’il a faites ({n}).', { v: mad(Math.abs(p.cash_short_cents)), n: p.closings_counted })}</span>
              </button>
            ))}
            {forgot.map(p => (
              <button key={p.staff_id} onClick={() => setOpen(p)} className="flex w-full items-start gap-2 rounded-2xl border border-warn/40 bg-warn/5 px-4 py-3 text-start text-sm hover:bg-warn/10">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                <span><b>{p.name}</b> : {t('{n} départ(s) non pointé(s). Corrigez les heures.', { n: p.forgot })}</span>
              </button>
            ))}
            {noRate.length > 0 && (
              <p className="flex items-start gap-2 rounded-2xl border border-line/15 bg-surface px-4 py-3 text-sm">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                {t('Ajoutez le coût horaire de {names} pour calculer le coût du personnel.', { names: noRate.map(p => p.name).join(', ') })}
              </p>
            )}
          </div>
        )}

        <div className="card overflow-x-auto rounded-3xl">
          <table className={`w-full text-sm ${pos ? 'min-w-[960px]' : 'min-w-[520px]'}`}>
            <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 text-start">{t('Employé')}</th>
                <th className="px-3 py-3 text-end">{t('Heures')}</th>
                <th className="px-3 py-3 text-end">{t('Coût')}</th>
                {pos && <>
                  <th className="px-3 py-3 text-end">{t('Ventes')}</th>
                  <th className="px-3 py-3 text-end">{t('Ticket moyen')}</th>
                  <th className="px-3 py-3 text-end">{t('Remises')}</th>
                  <th className="px-3 py-3 text-end">{t('Annulations')}</th>
                  <th className="px-3 py-3 text-end">{t('Retirés après cuisine')}</th>
                  <th className="px-3 py-3 text-end">{t('Écart de caisse')}</th>
                </>}
                <th className="w-10 px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/10">
              {rep.people.map(p => (
                <tr key={p.staff_id} onClick={() => setOpen(p)} className={`cursor-pointer hover:bg-surface-2/60 ${p.active ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-2.5">
                    <p className="flex items-center gap-2 font-semibold">{p.name}
                      {p.open_now && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-bold text-ok">{t('présent')}</span>}
                      {p.watch && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-bold text-danger">{t('à surveiller')}</span>}</p>
                    <p className="text-xs text-muted">{p.role === 'manager' ? t('Manager') : t('Employé')}{p.hourly_cost_cents != null ? ` · ${t('{v} / heure', { v: mad(p.hourly_cost_cents) })}` : ''}</p>
                  </td>
                  <td className="px-3 py-2.5 text-end tabular">{p.hours > 0 ? hrs(p.hours) : '—'}</td>
                  <td className="px-3 py-2.5 text-end tabular">{p.labour_cents != null ? mad(p.labour_cents) : '—'}</td>
                  {pos && <>
                    <td className="px-3 py-2.5 text-end tabular">{p.orders ? <>{mad(p.sales_cents)}<span className="block text-xs text-muted">{t('{n} tickets', { n: p.orders })}</span></> : '—'}</td>
                    <td className="px-3 py-2.5 text-end tabular">{p.avg_ticket_cents != null ? mad(p.avg_ticket_cents) : '—'}</td>
                    <Cell n={p.discounts} v={p.discount_cents} />
                    <Cell n={p.cancellations} v={p.cancelled_cents} />
                    <Cell n={p.removed_lines} v={p.removed_cents} strong />
                    <td className="px-3 py-2.5 text-end tabular">{p.closings_counted ? <><span className={Number(p.cash_diff_cents) < -1000 ? 'font-semibold text-danger' : ''}>{Number(p.cash_diff_cents) > 0 ? '+' : ''}{mad(p.cash_diff_cents)}</span><span className="block text-xs text-muted">{t('{n} clôtures', { n: p.closings_counted })}</span></> : '—'}</td>
                  </>}
                  <td className="px-3 py-2.5 text-end"><Pencil className="inline h-4 w-4 text-muted" /></td>
                </tr>
              ))}
              {!rep.people.length && <tr><td colSpan={10} className="px-4 py-10 text-center text-muted">{t('Aucun employé.')}</td></tr>}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-muted">
          {pos ? t('Pointage : chaque employé pointe avec son code sur l’écran de connexion de la caisse. ') : ''}
          {t('Loi 09-08 : informez votre équipe par écrit que les heures et les actions sur la caisse sont enregistrées, et dans quel but.')}
        </p>
      </>)}

      {open && rep && <PersonModal r={r} p={open} from={from} to={to} uses_pos={pos} onClose={() => setOpen(null)} onChanged={load} />}
      {adding && <AddStaff r={r} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function Cell({ n, v, strong }: { n: number; v: number; strong?: boolean }) {
  return <td className="px-3 py-2.5 text-end tabular">{n ? <><span className={strong ? 'font-semibold text-danger' : ''}>{mad(v)}</span><span className="block text-xs text-muted">× {n}</span></> : '—'}</td>;
}
function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'ok' | 'bad' }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-white/50">{label}</p>
      <p className={`mt-1 font-display text-3xl font-semibold tabular ${tone === 'bad' ? 'text-[#F47171]' : tone === 'ok' ? 'text-brand' : ''}`}>{value}</p>
      <p className="text-xs text-white/50">{hint}</p>
    </div>
  );
}

// ------------------------------------------------------------ one person: cost per hour, hours, details
function PersonModal({ r, p, from, to, uses_pos, onClose, onChanged }: { r: Restaurant; p: Person; from: string; to: string; uses_pos: boolean; onClose: () => void; onChanged: () => void }) {
  const a = useAdminCtx();
  const [rate, setRate] = useState(fromCents(p.hourly_cost_cents));
  const [salary, setSalary] = useState('');
  const [weekly, setWeekly] = useState('48');
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [edit, setEdit] = useState<Shift | 'new' | null>(null);
  const tz = r.timezone || 'Africa/Casablanca';

  const loadShifts = useCallback(async () => {
    try {
      const rows = check(await supabase.from('staff_shifts').select('*').eq('restaurant_id', r.id).eq('staff_id', p.staff_id)
        .gte('clock_in', zoned(from, '00:00', tz)).lt('clock_in', zoned(to, '23:59', tz)).order('clock_in', { ascending: false })) as Shift[];
      setShifts(rows);
    } catch (e) { a.fail(e); }
  }, [r.id, p.staff_id, from, to, tz, a]);
  useEffect(() => { loadShifts(); }, [loadShifts]);

  // monthly salary + hours a week -> cost of one hour, with employer charges (CNSS, AMO ~21 %)
  const fromSalary = () => {
    const s = Number(salary.replace(',', '.')), h = Number(weekly.replace(',', '.'));
    if (s > 0 && h > 0) setRate(String(Math.round(s * 1.21 / (h * 52 / 12) * 100) / 100).replace('.', ','));
  };
  const saveRate = async () => {
    try {
      if (!rate.trim()) check(await supabase.from('staff_rates').delete().eq('staff_id', p.staff_id).select('staff_id'));
      else check(await supabase.from('staff_rates').upsert({ restaurant_id: r.id, staff_id: p.staff_id, hourly_cost_cents: toCents(rate) }, { onConflict: 'staff_id' }).select('staff_id'));
      a.toast(t('Coût horaire enregistré')); onChanged();
    } catch (e) { a.fail(e); }
  };
  const remove = async (s: Shift) => {
    try { check(await supabase.from('staff_shifts').delete().eq('id', s.id).select('id')); a.toast(t('Heures supprimées')); loadShifts(); onChanged(); } catch (e) { a.fail(e); }
  };
  const fmt = (ts: string) => new Date(ts).toLocaleString(dateLocale(), { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const time = (ts: string) => new Date(ts).toLocaleTimeString(dateLocale(), { timeZone: tz, hour: '2-digit', minute: '2-digit' });

  return (
    <Modal wide title={p.name} onClose={onClose}>
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 font-semibold">{t('Coût horaire')}</h3>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('Coût d’une heure (DH)')} hint={t('Salaire + charges patronales.')}>
              <input className={`${inputCls} w-36`} inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} placeholder="25" />
            </Field>
            <Btn tone="brand" onClick={saveRate}>{t('Enregistrer')}</Btn>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl bg-surface-2 p-3 text-sm">
            <span className="w-full text-xs text-muted">{t('Pas sûr ? Calculez depuis le salaire mensuel :')}</span>
            <input aria-label={t('Salaire mensuel (DH)')} className={`${inputCls} w-32`} inputMode="decimal" value={salary} onChange={e => setSalary(e.target.value)} placeholder={t('Salaire / mois')} />
            <input aria-label={t('Heures par semaine')} className={`${inputCls} w-24`} inputMode="numeric" value={weekly} onChange={e => setWeekly(e.target.value)} />
            <span className="self-center text-muted">{t('h / semaine')}</span>
            <Btn onClick={fromSalary}>{t('Calculer')}</Btn>
          </div>
        </section>

        {uses_pos && (
          <section>
            <h3 className="mb-2 font-semibold">{t('Sur la caisse')}</h3>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {([
                [t('Ventes'), p.orders ? `${mad(p.sales_cents)} · ${t('{n} tickets', { n: p.orders })}` : '—'],
                [t('Remises sur ses tickets'), p.discounts ? `${mad(p.discount_cents)} × ${p.discounts}` : '—'],
                [t('Annulations de ses commandes'), p.cancellations ? `${mad(p.cancelled_cents)} × ${p.cancellations}` : '—'],
                [t('Articles retirés après envoi en cuisine'), p.removed_lines ? `${mad(p.removed_cents)} × ${p.removed_lines}` : '—'],
                [t('Remises validées (manager)'), p.discounts_approved ? `${mad(p.discounts_approved_cents)} × ${p.discounts_approved}` : '—'],
                [t('Annulations validées (manager)'), p.cancellations_approved ? `${mad(p.cancellations_approved_cents)} × ${p.cancellations_approved}` : '—'],
                [t('Avoirs'), p.credit_notes ? `${mad(p.credit_note_cents)} × ${p.credit_notes}` : '—'],
                [t('Sorties de caisse'), p.payouts ? `${mad(p.payout_cents)} × ${p.payouts}` : '—'],
                [t('Pourboires'), p.tips_cents ? mad(p.tips_cents) : '—'],
                [t('Écart de caisse (ses clôtures)'), p.closings_counted ? `${Number(p.cash_diff_cents) > 0 ? '+' : ''}${mad(p.cash_diff_cents)} · ${t('{n} clôtures', { n: p.closings_counted })}` : '—'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-line/10 py-1.5"><dt className="text-muted">{k}</dt><dd className="font-semibold tabular">{v}</dd></div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-muted">{t('Un article retiré après l’envoi en cuisine a été préparé mais n’est pas payé : c’est le signe le plus fréquent de vol. Demandez toujours pourquoi.')}</p>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">{t('Heures')} · {hrs(p.hours)}</h3>
            <Btn className="px-3 py-1.5" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> {t('Ajouter des heures')}</Btn>
          </div>
          {shifts === null ? <p className="text-sm text-muted">{t('Chargement…')}</p> : !shifts.length ? <p className="text-sm text-muted">{t('Aucune heure sur cette période.')}</p> : (
            <ul className="divide-y divide-line/10 text-sm">
              {shifts.map(s => {
                const bad = s.note === 'départ oublié' || !s.clock_out;
                return (
                  <li key={s.id} className={`flex items-center gap-3 py-2 ${bad ? 'text-warn' : ''}`}>
                    <span className="flex-1">{fmt(s.clock_in)} → {s.clock_out && s.note !== 'départ oublié' ? time(s.clock_out) : <b>{s.clock_out ? t('départ oublié') : t('en cours')}</b>}</span>
                    <span className="tabular">{s.clock_out && s.note !== 'départ oublié' ? hrs((new Date(s.clock_out).getTime() - new Date(s.clock_in).getTime()) / 36e5) : ''}</span>
                    <span className="text-xs text-muted">{s.source === 'pos' ? t('caisse') : t('saisi')}</span>
                    <button aria-label={t('Modifier')} onClick={() => setEdit(s)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2"><Pencil className="h-4 w-4" /></button>
                    <button aria-label={t('Supprimer')} onClick={() => remove(s)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      {edit && <ShiftEditor r={r} tz={tz} staffId={p.staff_id} shift={edit === 'new' ? null : edit} defaultDate={to} onClose={() => setEdit(null)}
        onSaved={() => { setEdit(null); loadShifts(); onChanged(); }} />}
    </Modal>
  );
}

function ShiftEditor({ r, tz, staffId, shift, defaultDate, onClose, onSaved }: { r: Restaurant; tz: string; staffId: string; shift: Shift | null; defaultDate: string; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const start = shift ? local(shift.clock_in, tz) : { date: defaultDate, time: '09:00' };
  const [date, setDate] = useState(start.date);
  const [tin, setTin] = useState(start.time);
  const [tout, setTout] = useState(shift?.clock_out && shift.note !== 'départ oublié' ? local(shift.clock_out, tz).time : '17:00');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const cin = zoned(date, tin, tz);
    let cout = zoned(date, tout, tz);
    if (new Date(cout) <= new Date(cin)) cout = new Date(new Date(cout).getTime() + 864e5).toISOString(); // ends after midnight
    setBusy(true);
    try {
      const row = { clock_in: cin, clock_out: cout, note: null };
      if (shift) check(await supabase.from('staff_shifts').update(row).eq('id', shift.id).select('id'));
      else check(await supabase.from('staff_shifts').insert({ ...row, restaurant_id: r.id, staff_id: staffId, source: 'manual' }).select('id'));
      a.toast(t('Heures enregistrées')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={shift ? t('Corriger les heures') : t('Ajouter des heures')} onClose={onClose}
      footer={<div className="flex justify-end gap-3"><Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('Date')}><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label={t('Arrivée')}><input type="time" className={inputCls} value={tin} onChange={e => setTin(e.target.value)} /></Field>
        <Field label={t('Départ')} hint={t('Après minuit : le lendemain.')}><input type="time" className={inputCls} value={tout} onChange={e => setTout(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function AddStaff({ r, onClose, onSaved }: { r: Restaurant; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [name, setName] = useState('');
  const [role, setRole] = useState<'staff' | 'manager'>('staff');
  const save = async () => {
    try { check(await supabase.from('staff').insert({ restaurant_id: r.id, name: name.trim(), role }).select('id')); a.toast(t('Enregistré')); onSaved(); } catch (e) { a.fail(e); }
  };
  return (
    <Modal title={t('Nouvel employé')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={!name.trim()} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <Field label={t('Prénom')}><input autoFocus className={inputCls} maxLength={40} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field group label={t('Rôle')}>
          <div className="flex gap-2">{(['staff', 'manager'] as const).map(x => <button key={x} type="button" onClick={() => setRole(x)} className={`flex-1 rounded-xl py-2.5 font-semibold ${role === x ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{x === 'manager' ? t('Manager') : t('Employé')}</button>)}</div>
        </Field>
      </div>
    </Modal>
  );
}
