// La caisse du salon: the clients to be paid, the tickets of the day, what each person brought in,
// and the closing. At the closing every client seen and not paid is explained, then the drawer is
// counted without seeing first what should be there; the difference is kept with the day.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Banknote, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Gift, Lock, Plus, Receipt, Wallet, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Modal, inputCls } from '../components/ui';
import { CheckoutModal, mad, tillError, type CheckoutFrom, type TillPerson } from '../components/Checkout';
import { svcName, type AgService } from './AgendaServicesPage';
import { ymdIn } from '../lib/whatsapp';

interface Sale {
  id: string; number: number; at: string; name: string | null; phone: string | null; staff_id: string | null; total_cents: number; tip_cents: number;
  discount_cents: number; discount_reason: string | null; free_reason: string | null; cash_cents: number | null; card_cents: number;
  cancelled: boolean; cancel_reason: string | null; lines: { kind: string; name: string; quantity: number; line_cents: number; staff_id: string | null }[];
}
export interface Unpaid { kind: 'appointment' | 'queue'; id: string; name: string; phone: string | null; at: string; status: string; staff_id: string | null; service_id: string | null; service: Record<string, string> | null; price_cents: number | null; reason?: string }
interface Day {
  date: string; today: string; manager: boolean; sales: Sale[]; unpaid: Unpaid[];
  totals: { tickets: number; total_cents: number; card_cents: number; cash_cents: number | null; tip_cents: number; discount_cents: number; free: number; cancelled: number; cancelled_cents: number };
  staff: { staff_id: string; total_cents: number; clients: number; tip_cents: number }[];
  closed: null | { at: string; counted_cash_cents: number; expected_cash_cents: number; cash_diff_cents: number; unpaid: Unpaid[]; note: string | null };
}
const addDays = (day: string, n: number) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n)).toISOString().slice(0, 10);
const cents = (s: string) => { const n = Number(s.replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN; };
export const unpaidFrom = (u: Unpaid): CheckoutFrom => ({
  appointment_id: u.kind === 'appointment' ? u.id : undefined, queue_id: u.kind === 'queue' ? u.id : undefined,
  name: u.name, phone: u.phone, staff_id: u.staff_id, service_id: u.service_id, price_cents: u.price_cents,
});
const REASONS = () => [t('Paiera plus tard'), t('Pas venu(e) en fait'), t('Offert'), t('Erreur dans l’agenda')];

export function SalonTillPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const tz = r.timezone || 'UTC';
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<Day | null>(null);
  const [people, setPeople] = useState<TillPerson[]>([]);
  const [services, setServices] = useState<AgService[]>([]);
  const [pay, setPay] = useState<CheckoutFrom | null>(null);
  const [closing, setClosing] = useState(false);
  const [cancel, setCancel] = useState<Sale | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('agenda_day_till', { p_restaurant_id: r.id, p_date: date });
    if (error) { a.fail(error); return; }
    setDay(data as Day);
  }, [r.id, date, a]);
  useEffect(() => { load(); const id = window.setInterval(load, 30000); return () => window.clearInterval(id); }, [load]);
  useEffect(() => {
    supabase.from('staff').select('id, name, agenda_color').eq('restaurant_id', r.id).eq('active', true).eq('agenda', true).order('agenda_sort').order('name').then(x => setPeople((x.data ?? []) as TillPerson[]));
    supabase.from('agenda_services').select('*').eq('restaurant_id', r.id).eq('active', true).order('sort_order').then(x => setServices((x.data ?? []) as AgService[]));
  }, [r.id]);

  const who = (id: string | null) => people.find(p => p.id === id)?.name ?? '';
  const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const d = day?.date ?? ymdIn(new Date(), tz);
  const isToday = day ? day.date === day.today : true;
  const label = new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  const tot = day?.totals;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold">{t('Caisse')}</h1>
        <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
          <button className="rounded-lg p-2 hover:bg-surface" onClick={() => setDate(addDays(d, -1))} aria-label={t('Jour précédent')}><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></button>
          <button className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${isToday ? 'bg-surface shadow-sm' : 'hover:bg-surface'}`} onClick={() => setDate(null)}>{t('Aujourd’hui')}</button>
          <button className="rounded-lg p-2 hover:bg-surface disabled:opacity-30" disabled={isToday} onClick={() => setDate(addDays(d, 1) >= (day?.today ?? d) ? null : addDays(d, 1))} aria-label={t('Jour suivant')}><ChevronRight className="h-4 w-4 rtl:rotate-180" /></button>
        </div>
        <span className="inline-flex items-center gap-2 font-semibold first-letter:uppercase"><CalendarDays className="h-4 w-4 text-brand" /><span className="first-letter:uppercase">{label}</span></span>
        {day && !day.closed && isToday && <Btn tone="brand" className="ms-auto" onClick={() => setPay({})}><Plus className="h-4 w-4" /> {t('Nouveau ticket')}</Btn>}
      </div>

      {day?.closed && (
        <div className={`flex flex-wrap items-center gap-4 rounded-3xl p-5 ${day.closed.cash_diff_cents === 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
          <Lock className="h-6 w-6" />
          <div className="me-auto">
            <p className="font-semibold">{t('Journée clôturée à {h}', { h: time(day.closed.at) })}</p>
            <p className="text-sm text-muted">{t('Espèces attendues {a} · comptées {b}', { a: mad(day.closed.expected_cash_cents), b: mad(day.closed.counted_cash_cents) })}{day.closed.note ? ` · ${day.closed.note}` : ''}</p>
          </div>
          <Diff c={day.closed.cash_diff_cents} />
        </div>
      )}

      {day?.closed && day.closed.unpaid.length > 0 && (
        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><AlertTriangle className="h-5 w-5 text-amber-600" />{t('Clients non payés à la clôture')} <span className="text-muted">({day.closed.unpaid.length})</span></h2>
          <p className="mb-3 text-sm text-muted">{t('Passés ce jour-là sans être encaissés, avec la raison donnée.')}</p>
          <ul className="divide-y divide-line/10">
            {day.closed.unpaid.map(u => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="w-12 font-semibold tabular text-muted">{time(u.at)}</span>
                <p className="min-w-[150px] flex-1 font-semibold">{u.name} <span className="text-sm font-normal text-muted">{who(u.staff_id)}</span></p>
                {u.price_cents ? <span className="tabular text-muted">{mad(u.price_cents)}</span> : null}
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-sm font-semibold text-amber-800">{u.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {day && !day.closed && day.unpaid.length > 0 && (
        <Card className="ring-2 ring-amber-500/40">
          <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><AlertTriangle className="h-5 w-5 text-amber-600" />{t('À encaisser')} <span className="text-muted">({day.unpaid.length})</span></h2>
          <p className="mb-3 text-sm text-muted">{t('Les clients passés aujourd’hui qui ne sont pas encore payés. À la clôture, chacun doit être encaissé ou expliqué.')}</p>
          <ul className="divide-y divide-line/10">
            {day.unpaid.map(u => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="w-12 font-semibold tabular text-muted">{time(u.at)}</span>
                <div className="min-w-[150px] flex-1">
                  <p className="font-semibold">{u.name}</p>
                  <p className="text-sm text-muted">{[u.service ? svcName({ name: u.service }) : '', who(u.staff_id), u.kind === 'queue' ? t('La Nouba') : u.status === 'done' ? t('Terminé') : u.status === 'arrived' ? t('Arrivé') : t('Pas marqué')].filter(Boolean).join(' · ')}</p>
                </div>
                {u.price_cents ? <span className="font-semibold tabular">{mad(u.price_cents)}</span> : null}
                {isToday && <Btn tone="brand" onClick={() => setPay(unpaidFrom(u))}><Banknote className="h-4 w-4" /> {t('Encaisser')}</Btn>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tot && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t('Chiffre du jour')} value={mad(tot.total_cents)} sub={t('{n} ticket(s)', { n: tot.tickets })} />
          <Stat label={t('Espèces')} value={tot.cash_cents == null ? '•••' : mad(tot.cash_cents)} sub={tot.cash_cents == null ? t('Visible après la clôture') : undefined} />
          <Stat label={t('Carte')} value={mad(tot.card_cents)} />
          <Stat label={t('Pourboires')} value={mad(tot.tip_cents)} sub={tot.discount_cents ? t('Remises : {m}', { m: mad(tot.discount_cents) }) : undefined} />
        </div>
      )}

      {day && day.staff.length > 0 && (
        <Card>
          <h2 className="mb-3 font-display text-xl font-semibold">{t('Par personne')}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {day.staff.map(s => {
              const p = people.find(x => x.id === s.staff_id);
              return (
                <li key={s.staff_id} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full font-semibold text-white" style={{ background: p?.agenda_color || '#64748b' }}>{(p?.name ?? '?').slice(0, 1)}</span>
                  <div className="me-auto"><p className="font-semibold">{p?.name ?? t('Ancien membre')}</p><p className="text-xs text-muted">{t('{n} client(s)', { n: s.clients })}{s.tip_cents ? ` · ${t('pourboires {m}', { m: mad(s.tip_cents) })}` : ''}</p></div>
                  <span className="font-semibold tabular">{mad(s.total_cents)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold"><Receipt className="h-5 w-5 text-brand" />{t('Tickets')}</h2>
        {!day ? <p className="text-muted">…</p> : !day.sales.length ? <p className="rounded-2xl bg-surface-2 p-5 text-sm text-muted">{t('Aucun ticket ce jour-là.')}</p> : (
          <ul className="divide-y divide-line/10">
            {day.sales.map(s => (
              <li key={s.id} className={`flex flex-wrap items-start gap-3 py-3 ${s.cancelled ? 'opacity-60' : ''}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-bold tabular">{s.number}</span>
                <div className="min-w-[180px] flex-1">
                  <p className={`font-semibold ${s.cancelled ? 'line-through' : ''}`}>{s.name || t('Client de passage')} <span className="text-sm font-normal text-muted">· {time(s.at)}</span></p>
                  <p className="text-sm text-muted">{(s.lines ?? []).map(l => `${l.quantity > 1 ? `${l.quantity}× ` : ''}${l.name}${l.staff_id ? ` (${who(l.staff_id)})` : ''}`).join(', ')}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold">
                    {s.card_cents > 0 && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-700">{t('Carte')} {mad(s.card_cents)}</span>}
                    {s.cash_cents != null && s.cash_cents > 0 && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700">{t('Espèces')} {mad(s.cash_cents)}</span>}
                    {s.tip_cents > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5">{t('Pourboire')} {mad(s.tip_cents)}</span>}
                    {s.discount_cents > 0 && s.total_cents > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700">{t('Remise')} {mad(s.discount_cents)}{s.discount_reason ? ` · ${s.discount_reason}` : ''}</span>}
                    {s.free_reason && <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-violet-700"><Gift className="h-3 w-3" />{t('Offert')} · {s.free_reason}</span>}
                    {s.cancelled && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-700">{t('Annulé')}{s.cancel_reason ? ` · ${s.cancel_reason}` : ''}</span>}
                  </div>
                </div>
                <span className={`font-semibold tabular ${s.cancelled ? 'line-through' : ''}`}>{mad(s.total_cents)}</span>
                {day.manager && !s.cancelled && !day.closed && <button onClick={() => setCancel(s)} className="text-muted hover:text-danger" title={t('Annuler le ticket')} aria-label={t('Annuler le ticket')}><XCircle className="h-5 w-5" /></button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {day && !day.closed && day.date <= day.today && (
        <div className="night flex flex-wrap items-center gap-4 rounded-[2rem] p-6">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/20 text-brand"><Wallet className="h-6 w-6" /></span>
          <div className="me-auto"><p className="font-semibold text-white">{t('Clôturer la journée')}</p><p className="text-sm text-white/60">{t('Expliquez les clients non payés, puis comptez l’argent de la caisse.')}</p></div>
          <Btn tone="brand" onClick={() => setClosing(true)}><Lock className="h-4 w-4" /> {t('Clôturer')}</Btn>
        </div>
      )}

      {pay && <CheckoutModal r={r} people={people} services={services} from={pay} onClose={() => setPay(null)} onPaid={() => { setPay(null); load(); }} />}
      {closing && day && <CloseDay r={r} day={day} time={time} who={who} onClose={() => setClosing(false)} onDone={() => { setClosing(false); load(); }} />}
      {cancel && <CancelSale r={r} s={cancel} onClose={() => setCancel(null)} onDone={() => { setCancel(null); load(); }} />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="card rounded-3xl p-4"><p className="text-sm text-muted">{label}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{value}</p>{sub && <p className="text-xs text-muted">{sub}</p>}</div>;
}
function Diff({ c }: { c: number }) {
  return <div className="text-end"><p className="text-xs text-muted">{t('Écart')}</p>
    <p className={`font-display text-2xl font-semibold tabular ${c === 0 ? 'text-emerald-700' : c < 0 ? 'text-red-600' : 'text-amber-700'}`}>{c === 0 ? t('Juste') : `${c > 0 ? '+' : '-'}${mad(Math.abs(c))}`}</p></div>;
}

function CloseDay({ r, day, time, who, onClose, onDone }: { r: Restaurant; day: Day; time: (s: string) => string; who: (id: string | null) => string; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [why, setWhy] = useState<Record<string, string>>({});
  const [count, setCount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ expected_cash_cents: number; counted_cash_cents: number; cash_diff_cents: number } | null>(null);
  const missing = day.unpaid.filter(u => !why[u.id]?.trim()).length;
  const c = count ? cents(count) : NaN;
  const go = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('agenda_close_day', { p_restaurant_id: r.id, p_date: day.date, p_counted_cash_cents: c,
        p_unpaid: day.unpaid.map(u => ({ kind: u.kind, id: u.id, reason: why[u.id].trim() })), p_note: note.trim() || null });
      if (error) throw error;
      setRes(data as typeof res);
    } catch (e) { a.fail(String((e as Error).message).includes('unpaid') ? new Error(t('Un client vient d’être ajouté : rechargez et expliquez-le.')) : tillError(e)); }
    setBusy(false);
  };
  if (res) return (
    <Modal title={t('Journée clôturée')} onClose={onDone}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface-2 p-4"><p className="text-sm text-muted">{t('Espèces attendues')}</p><p className="font-display text-2xl font-semibold tabular">{mad(res.expected_cash_cents)}</p></div>
          <div className="rounded-2xl bg-surface-2 p-4"><p className="text-sm text-muted">{t('Espèces comptées')}</p><p className="font-display text-2xl font-semibold tabular">{mad(res.counted_cash_cents)}</p></div>
        </div>
        <div className={`flex items-center justify-between rounded-2xl p-4 ${res.cash_diff_cents === 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
          <p className="font-semibold">{res.cash_diff_cents === 0 ? t('La caisse est juste.') : res.cash_diff_cents < 0 ? t('Il manque de l’argent dans la caisse.') : t('Il y a plus d’argent que prévu.')}</p>
          <Diff c={res.cash_diff_cents} />
        </div>
        <Btn className="w-full" onClick={onDone}>{t('Fermer')}</Btn>
      </div>
    </Modal>
  );
  return (
    <Modal title={t('Clôturer la journée')} onClose={onClose} wide
      footer={<div className="flex justify-end gap-2"><Btn onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy || missing > 0 || Number.isNaN(c)} onClick={go}><Lock className="h-4 w-4" /> {t('Clôturer')}</Btn></div>}>
      <div className="space-y-6">
        {day.unpaid.length > 0 && (
          <div>
            <h3 className="font-semibold">{t('1. Les clients non payés')}</h3>
            <p className="mb-3 text-sm text-muted">{t('Pour chaque client passé et non encaissé, dites pourquoi. Le propriétaire le verra.')}</p>
            <ul className="space-y-3">
              {day.unpaid.map(u => (
                <li key={u.id} className="rounded-2xl bg-surface-2 p-3">
                  <p className="font-semibold">{time(u.at)} · {u.name} <span className="font-normal text-muted">{[u.service ? svcName({ name: u.service }) : '', who(u.staff_id), u.price_cents ? mad(u.price_cents) : ''].filter(Boolean).join(' · ')}</span></p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {REASONS().map(x => <button key={x} onClick={() => setWhy(w => ({ ...w, [u.id]: x }))} className={`rounded-full px-3 py-1 text-xs font-semibold ${why[u.id] === x ? 'bg-brand text-brand-ink' : 'bg-surface'}`}>{x}</button>)}
                  </div>
                  <input className={`${inputCls} mt-2`} maxLength={100} value={why[u.id] ?? ''} onChange={e => setWhy(w => ({ ...w, [u.id]: e.target.value }))} placeholder={t('Autre raison')} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">{t('Un client finalement payé ? Fermez et encaissez-le d’abord.')}</p>
          </div>
        )}
        <div>
          <h3 className="font-semibold">{day.unpaid.length ? t('2. Comptez la caisse') : t('Comptez la caisse')}</h3>
          <p className="mb-3 text-sm text-muted">{t('Comptez tout l’argent liquide de la caisse et tapez le total. Le montant attendu s’affiche seulement après : c’est ce qui rend le comptage honnête.')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Espèces comptées (DH)')}><input className={`${inputCls} text-lg font-semibold`} inputMode="decimal" autoFocus value={count} onChange={e => setCount(e.target.value)} /></Field>
            <Field label={t('Note (facultatif)')}><input className={inputCls} maxLength={300} value={note} onChange={e => setNote(e.target.value)} /></Field>
          </div>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted"><CheckCircle2 className="h-4 w-4" />{t('Après la clôture, plus aucun ticket ne peut être ajouté ou annulé pour ce jour.')}</p>
      </div>
    </Modal>
  );
}

function CancelSale({ r, s, onClose, onDone }: { r: Restaurant; s: Sale; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [why, setWhy] = useState('');
  const go = async () => {
    const { error } = await supabase.rpc('agenda_sale_cancel', { p_restaurant_id: r.id, p_sale: s.id, p_reason: why.trim() });
    if (error) { a.fail(tillError(error)); return; }
    a.toast(t('Ticket annulé')); onDone();
  };
  return (
    <Modal title={t('Annuler le ticket n° {n}', { n: s.number })} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Btn onClick={onClose}>{t('Garder')}</Btn><Btn tone="danger" disabled={!why.trim()} onClick={go}>{t('Annuler le ticket')}</Btn></div>}>
      <p className="mb-3 text-sm text-muted">{t('Le ticket reste visible comme annulé. Si le client est venu, il revient dans « À encaisser ».')}</p>
      <Field label={t('Raison')}><input className={inputCls} maxLength={200} autoFocus value={why} onChange={e => setWhy(e.target.value)} placeholder={t('Erreur de prix, mauvais client…')} /></Field>
    </Modal>
  );
}
