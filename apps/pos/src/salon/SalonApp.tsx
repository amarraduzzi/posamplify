// The salon on the till (caisse.amplifygrowthstudio.com), unlocked with each person's PIN.
// Comptoir: today's appointments, the Nouba chairs and queue, the clients still to be paid.
// Caisse: the tickets, what each person brought in, the closing with the blind cash count.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Banknote, CalendarPlus, CheckCircle2, Footprints, Gift, Lock, Plus, Receipt, Scissors, SkipForward, TrendingUp, UserCheck, UserX, Wallet, XCircle } from 'lucide-react';
import { MyNumbers } from './MyNumbers';
import { usePos } from '../store';
import { rpc } from '../lib/data';
import { supabase } from '../lib/supabase';
import { mad, time as hhmm } from '../lib/format';
import { LANGS, nextLang, t } from '../lib/i18n';
import { Btn, Field, Modal, inputCls } from '../components/ui';
import { PinPad } from '../components/PinPad';
import { PIN_ERRORS } from '../lib/errors';
import { Star8, initials } from '../components/Brand';
import { SalonCheckout, tillMessage } from './Checkout';
import { colorOf, fromUnpaid, instant, loadSalonStatic, loadToday, svcName, ymdIn, type Appt, type Board, type From, type Person, type Product, type Sale, type Svc, type TillDay, type Unpaid } from './data';

type Tab = 'desk' | 'till';
const STATUS: Record<string, [string, string]> = {
  requested: ['À confirmer', 'bg-warn/15 text-warn'], confirmed: ['Confirmé', 'bg-surface-2 text-muted'], arrived: ['Arrivé', 'bg-sky-500/15 text-sky-300'],
  done: ['Terminé', 'bg-ok/15 text-ok'], no_show: ['Pas venu', 'bg-danger/15 text-danger'],
};
const since = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);

export function SalonApp() {
  const pos = usePos();
  const r = pos.restaurant!;
  const tz = r.timezone || 'UTC';
  const [tab, setTab] = useState<Tab>('desk');
  const [people, setPeople] = useState<Person[]>([]);
  const [services, setServices] = useState<Svc[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [till, setTill] = useState<TillDay | null>(null);
  const [pay, setPay] = useState<From | null>(null);
  const [newAppt, setNewAppt] = useState(false);
  const [walkIn, setWalkIn] = useState(false);
  const [mine, setMine] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try { const x = await loadToday(r.id, tz); setAppts(x.appts); setBoard(x.board); setTill(x.till); } catch (e) { pos.fail(e); }
  }, [r.id, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadSalonStatic(r.id).then(x => { setPeople(x.people); setServices(x.services); setProducts(x.products); }).catch(pos.fail); }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const i = window.setInterval(() => { load(); setNow(Date.now()); }, 15000); return () => window.clearInterval(i); }, [load]);

  const person = (id: string | null) => people.find(p => p.id === id);
  const paid = new Set((till?.sales ?? []).filter(s => !s.cancelled && s.appointment_id).map(s => s.appointment_id!));
  // finished and not paid (the clients still in the chair are on the Nouba; the closing checks everyone)
  const unpaid = till?.closed ? [] : (till?.unpaid ?? []).filter(u => u.status === 'done');
  const queueOn = !!r.agenda?.queue;
  const team = people.filter(p => p.agenda);
  const act = async (fn: () => PromiseLike<unknown>) => { try { await fn(); await load(); } catch (e) { pos.fail(e); } };
  const setAppt = (id: string, status: string) => act(async () => { const { error } = await supabase.from('agenda_appointments').update({ status }).eq('id', id).select('id'); if (error) throw error; });
  const closed = !!till?.closed;

  return (
    <div className="ambient flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line/[0.07] bg-surface/90 px-4 py-2.5">
        <div className="me-1 flex min-w-0 items-center gap-3">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center"><Star8 className="absolute inset-0 h-full w-full text-brand" /><span className="relative text-xs font-bold text-brand-ink">{initials(r.name).slice(0, 2)}</span></span>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold leading-tight">{r.name}</p>
            <p className="text-xs text-muted tabular"><b className="font-semibold text-ink">{new Date(now).toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}</b> · {pos.staff?.name}</p>
          </div>
        </div>
        <nav className="flex gap-1 rounded-2xl border border-line/[0.06] bg-bg/70 p-1">
          {([['desk', t('Comptoir'), Scissors, unpaid.length], ['till', t('Caisse'), Receipt, 0]] as const).map(([id, l, I, badge]) => (
            <button key={id} onClick={() => setTab(id)} className={`relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold ${tab === id ? 'gold-fill text-brand-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
              <I className="h-4 w-4" />{l}
              {!!badge && <span className="absolute -end-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1 text-xs text-black ring-2 ring-surface">{badge}</span>}
            </button>
          ))}
        </nav>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {!closed && <>
            <Btn tone="ghost" onClick={() => setNewAppt(true)}><CalendarPlus className="h-4 w-4" /><span className="hidden lg:inline">{t('Rendez-vous')}</span></Btn>
            {queueOn && <Btn tone="ghost" onClick={() => setWalkIn(true)}><Footprints className="h-4 w-4" /><span className="hidden lg:inline">{t('Sans rendez-vous')}</span></Btn>}
            <Btn tone="brand" onClick={() => setPay({})}><Plus className="h-4 w-4" /> {t('Ticket')}</Btn>
          </>}
          <Btn tone="ghost" onClick={() => setMine(true)} title={t('Mes chiffres')}><TrendingUp className="h-4 w-4" /><span className="hidden lg:inline">{t('Mes chiffres')}</span></Btn>
          <button onClick={() => pos.setLang(nextLang(pos.lang))} aria-label={LANGS.find(x => x.id === nextLang(pos.lang))!.label} className="grid h-10 min-w-10 place-items-center rounded-xl bg-surface-2 px-2 text-sm font-bold text-muted">{LANGS.find(x => x.id === nextLang(pos.lang))!.short}</button>
          <button aria-label={t('Verrouiller')} onClick={() => pos.setStaff(null)} className="flex items-center gap-1.5 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm font-bold"><Lock className="h-4 w-4" /><span className="hidden xl:inline">{t('Verrouiller')}</span></button>
        </div>
      </header>
      {!pos.online && <p className="bg-warn/15 py-2 text-center text-sm font-semibold text-warn">{t('Hors ligne : la caisse du salon a besoin d’internet. Elle reprend dès le retour de la connexion.')}</p>}
      {closed && <p className="bg-warn/15 py-1.5 text-center text-sm font-semibold text-warn">{t('Journée clôturée : les ventes reprennent demain.')}</p>}

      <main className="scroll-thin flex-1 overflow-y-auto p-4 md:p-5">
        {tab === 'desk' ? (
          <div className="space-y-4">
            {unpaid.length > 0 && (
              <section className="panel rounded-3xl p-4 ring-2 ring-warn/40">
                <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold"><AlertTriangle className="h-5 w-5 text-warn" />{t('À encaisser')} <span className="text-muted">({unpaid.length})</span></h2>
                <div className="flex flex-wrap gap-2">
                  {unpaid.map(u => (
                    <button key={u.id} onClick={() => setPay(fromUnpaid(u))} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-start transition hover:bg-surface-3">
                      <span className="h-8 w-1.5 rounded-full" style={{ background: colorOf(person(u.staff_id)) }} />
                      <span><span className="block font-semibold">{u.name}</span><span className="block text-xs text-muted">{[svcName(u.service), person(u.staff_id)?.name].filter(Boolean).join(' · ')}</span></span>
                      {u.price_cents ? <span className="font-bold tabular">{mad(u.price_cents)}</span> : null}
                      <Banknote className="h-5 w-5 text-ok" />
                    </button>
                  ))}
                </div>
              </section>
            )}
            <div className={`grid gap-4 ${queueOn ? 'lg:grid-cols-[1.25fr_1fr]' : ''}`}>
              <section className="panel rounded-3xl p-4">
                <h2 className="mb-3 font-display text-xl font-semibold">{t('Rendez-vous du jour')} <span className="text-muted">({appts.filter(a => a.status !== 'no_show').length})</span></h2>
                {!appts.length ? <p className="rounded-2xl bg-surface-2 p-6 text-center text-muted">{t('Aucun rendez-vous aujourd’hui.')}</p> : (
                  <ul className="space-y-2">
                    {appts.map(a => {
                      const p = person(a.staff_id); const isPaid = paid.has(a.id); const st = STATUS[a.status];
                      const late = a.status !== 'done' && a.status !== 'no_show' && new Date(a.starts_at).getTime() < now;
                      return (
                        <li key={a.id} className={`flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 p-3 ${a.status === 'no_show' ? 'opacity-50' : ''}`}>
                          <span className="w-12 font-bold tabular">{hhmm(a.starts_at, tz)}</span>
                          <span className="h-10 w-1.5 rounded-full" style={{ background: colorOf(p) }} />
                          <div className="min-w-[150px] flex-1">
                            <p className="font-semibold">{a.name}</p>
                            <p className="text-sm text-muted">{[svcName(a.service_name), p?.name, a.price_cents ? mad(a.price_cents) : ''].filter(Boolean).join(' · ')}</p>
                          </div>
                          {isPaid ? <span className="flex items-center gap-1 rounded-full bg-ok/15 px-3 py-1 text-sm font-bold text-ok"><CheckCircle2 className="h-4 w-4" />{t('Payé')}</span>
                            : st && <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${late && a.status === 'confirmed' ? 'bg-warn/15 text-warn' : st[1]}`}>{t(st[0])}</span>}
                          {!isPaid && !closed && a.status !== 'no_show' && <div className="flex gap-1.5">
                            {(a.status === 'confirmed' || a.status === 'requested') && <Btn className="px-3" onClick={() => setAppt(a.id, 'arrived')} title={t('Arrivé')}><UserCheck className="h-4 w-4" /><span className="hidden xl:inline">{t('Arrivé')}</span></Btn>}
                            {a.status !== 'requested' && <Btn tone="ok" className="px-3" onClick={() => setPay({ appointment_id: a.id, name: a.name, phone: a.phone, staff_id: a.staff_id, service_id: a.service_id, price_cents: a.price_cents })}><Banknote className="h-4 w-4" />{t('Encaisser')}</Btn>}
                            {(a.status === 'confirmed' || a.status === 'requested') && late && <Btn className="px-3" onClick={() => setAppt(a.id, 'no_show')} title={t('Pas venu')}><UserX className="h-4 w-4" /></Btn>}
                          </div>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              {queueOn && <Nouba board={board} team={team} services={services} closed={closed} onPay={setPay} reload={load} />}
            </div>
          </div>
        ) : <TillView till={till} people={people} reload={load} />}
      </main>

      {pay && <SalonCheckout from={pay} people={people} services={services} products={products} onClose={() => setPay(null)} onPaid={() => { setPay(null); load(); loadSalonStatic(r.id).then(x => setProducts(x.products)).catch(() => {}); }} />}
      {newAppt && <NewAppointment services={services} team={team} onClose={() => setNewAppt(false)} onSaved={() => { setNewAppt(false); load(); }} />}
      {mine && <MyNumbers onClose={() => setMine(false)} />}
      {walkIn && <WalkIn services={services} team={team} onClose={() => setWalkIn(false)} onSaved={() => { setWalkIn(false); load(); }} />}
      <Toasts />
    </div>
  );
}

function Nouba({ board, team, services, closed, onPay, reload }: { board: Board | null; team: Person[]; services: Svc[]; closed: boolean; onPay: (f: From) => void; reload: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const [busy, setBusy] = useState<string | null>(null);
  const queue = board?.queue ?? [];
  const waiting = queue.filter(q => q.status === 'waiting');
  const chairs = team.filter(p => (board?.staff ?? []).includes(p.id) || queue.some(q => q.status === 'serving' && q.served_by === p.id));
  const svc = (id: string | null) => svcName(services.find(s => s.id === id)?.name);
  const next = async (staff: string) => {
    setBusy(staff);
    try { const x = await rpc<{ next: unknown }>('nouba_next', { p_restaurant_id: r.id, p_staff: staff, p_entry: null }); if (!x.next) pos.toast(t('Personne en attente.'), 'info'); reload(); } catch (e) { pos.fail(e); }
    setBusy(null);
  };
  return (
    <section className="panel rounded-3xl p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold"><Footprints className="h-5 w-5 text-brand" />{t('La Nouba')}
        <span className="ms-auto text-sm font-semibold text-muted">{board?.wait_min != null ? t('≈ {n} min d’attente', { n: board.wait_min }) : ''}</span></h2>
      {!chairs.length ? <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{t('Personne ne travaille en ce moment selon les horaires.')}</p> : (
        <ul className="space-y-2">
          {chairs.map(p => {
            const chair = queue.find(q => q.status === 'serving' && q.served_by === p.id);
            return (
              <li key={p.id} className="rounded-2xl bg-surface-2 p-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full font-bold text-white" style={{ background: colorOf(p) }}>{p.name.slice(0, 1)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{p.name}</p>
                    <p className="truncate text-sm text-muted">{chair ? `${chair.name}${svc(chair.service_id) ? ` · ${svc(chair.service_id)}` : ''} · ${t('depuis {n} min', { n: since(chair.started_at) })}` : t('Fauteuil libre')}</p>
                  </div>
                  {chair && !closed && <Btn tone="ok" className="px-3" onClick={() => onPay({ queue_id: chair.id, name: chair.name, phone: chair.phone, staff_id: p.id, service_id: chair.service_id })}><Banknote className="h-4 w-4" />{t('Encaisser')}</Btn>}
                  <Btn tone="brand" className="px-3" disabled={busy === p.id || closed} onClick={() => next(p.id)}><SkipForward className="h-4 w-4" />{t('Suivant')}</Btn>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mb-2 mt-4 text-sm font-semibold text-muted">{t('En attente')} ({waiting.length})</p>
      {waiting.length ? <ol className="space-y-1">{waiting.map((q, i) => (
        <li key={q.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-xs font-bold">{i + 1}</span><span className="font-semibold">{q.name}</span><span className="text-muted">{svc(q.service_id)}</span>{q.remote && <span className="rounded-full bg-sky-500/15 px-2 text-xs font-bold text-sky-300">{q.coming ? t('arrive') : t('à distance')}</span>}</li>
      ))}</ol> : <p className="text-sm text-muted">{t('Personne n’attend.')}</p>}
    </section>
  );
}

function TillView({ till, people, reload }: { till: TillDay | null; people: Person[]; reload: () => void }) {
  const pos = usePos();
  const tz = pos.restaurant!.timezone;
  const [cancel, setCancel] = useState<Sale | null>(null);
  const [closing, setClosing] = useState(false);
  if (!till) return <p className="text-muted">{t('Chargement…')}</p>;
  const name = (id: string | null) => people.find(p => p.id === id)?.name ?? '';
  const tot = till.totals;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {till.closed && (
        <div className={`flex flex-wrap items-center gap-4 rounded-3xl p-5 ${till.closed.cash_diff_cents === 0 ? 'bg-ok/10' : 'bg-danger/10'}`}>
          <Lock className="h-6 w-6" />
          <div className="me-auto"><p className="font-semibold">{t('Journée clôturée à {h}', { h: hhmm(till.closed.at, tz) })}{till.closed.staff_id ? ` · ${name(till.closed.staff_id)}` : ''}</p>
            <p className="text-sm text-muted">{t('Espèces attendues {a} · comptées {b}', { a: mad(till.closed.expected_cash_cents), b: mad(till.closed.counted_cash_cents) })}</p></div>
          <Diff c={till.closed.cash_diff_cents} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('Chiffre du jour')} value={mad(tot.total_cents)} sub={t('{n} ticket(s)', { n: tot.tickets })} />
        <Stat label={t('Espèces')} value={tot.cash_cents == null ? '•••' : mad(tot.cash_cents)} sub={tot.cash_cents == null ? t('Visible après la clôture') : undefined} />
        <Stat label={t('Carte')} value={mad(tot.card_cents)} />
        <Stat label={t('Pourboires')} value={mad(tot.tip_cents)} />
      </div>
      {till.staff.length > 0 && (
        <section className="panel rounded-3xl p-4">
          <h2 className="mb-3 font-display text-xl font-semibold">{t('Par personne')}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {till.staff.map(s => { const p = people.find(x => x.id === s.staff_id); return (
              <li key={s.staff_id} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                <span className="grid h-9 w-9 place-items-center rounded-full font-bold text-white" style={{ background: colorOf(p) }}>{(p?.name ?? '?').slice(0, 1)}</span>
                <div className="me-auto"><p className="font-semibold">{p?.name ?? '?'}</p><p className="text-xs text-muted">{t('{n} client(s)', { n: s.clients })}{s.tip_cents ? ` · ${t('pourboires {m}', { m: mad(s.tip_cents) })}` : ''}</p></div>
                <span className="font-bold tabular">{mad(s.total_cents)}</span>
              </li>); })}
          </ul>
        </section>
      )}
      <section className="panel rounded-3xl p-4">
        <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold"><Receipt className="h-5 w-5 text-brand" />{t('Tickets')}</h2>
        {!till.sales.length ? <p className="rounded-2xl bg-surface-2 p-5 text-sm text-muted">{t('Aucun ticket ce jour-là.')}</p> : (
          <ul className="divide-y divide-line/10">
            {till.sales.map(s => (
              <li key={s.id} className={`flex flex-wrap items-start gap-3 py-3 ${s.cancelled ? 'opacity-60' : ''}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-bold tabular">{s.number}</span>
                <div className="min-w-[180px] flex-1">
                  <p className={`font-semibold ${s.cancelled ? 'line-through' : ''}`}>{s.name || t('Client de passage')} <span className="text-sm font-normal text-muted">· {hhmm(s.at, tz)}{s.cashier_id ? ` · ${t('encaissé par {name}', { name: name(s.cashier_id) })}` : ''}</span></p>
                  <p className="text-sm text-muted">{(s.lines ?? []).map(l => `${l.quantity > 1 ? `${l.quantity}× ` : ''}${l.name}${l.staff_id ? ` (${name(l.staff_id)})` : ''}`).join(', ')}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold">
                    {s.card_cents > 0 && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-300">{t('Carte')} {mad(s.card_cents)}</span>}
                    {s.cash_cents != null && s.cash_cents > 0 && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-ok">{t('Espèces')} {mad(s.cash_cents)}</span>}
                    {s.tip_cents > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5">{t('Pourboire')} {mad(s.tip_cents)}</span>}
                    {s.discount_cents > 0 && s.total_cents > 0 && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-warn">{t('Remise')} {mad(s.discount_cents)}{s.discount_reason ? ` · ${s.discount_reason}` : ''}</span>}
                    {s.free_reason && <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-violet-300"><Gift className="h-3 w-3" />{t('Offert')} · {s.free_reason}</span>}
                    {s.cancelled && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-danger">{t('Annulé')}{s.cancel_reason ? ` · ${s.cancel_reason}` : ''}</span>}
                  </div>
                </div>
                <span className={`font-bold tabular ${s.cancelled ? 'line-through' : ''}`}>{mad(s.total_cents)}</span>
                {!s.cancelled && !till.closed && <button onClick={() => setCancel(s)} className="text-muted hover:text-danger" title={t('Annuler le ticket')} aria-label={t('Annuler le ticket')}><XCircle className="h-5 w-5" /></button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {till.closed && till.closed.unpaid.length > 0 && (
        <section className="panel rounded-3xl p-4">
          <h2 className="mb-3 font-display text-xl font-semibold">{t('Clients non payés à la clôture')}</h2>
          <ul className="space-y-1.5">{till.closed.unpaid.map(u => <li key={u.id} className="flex flex-wrap items-center gap-2 text-sm"><b>{u.name}</b><span className="text-muted">{name(u.staff_id)}</span><span className="rounded-full bg-warn/15 px-2 py-0.5 font-semibold text-warn">{u.reason}</span></li>)}</ul>
        </section>
      )}
      {!till.closed && (
        <div className="flex flex-wrap items-center gap-4 rounded-3xl bg-surface-2 p-5">
          <Wallet className="h-7 w-7 text-brand" />
          <div className="me-auto"><p className="font-semibold">{t('Clôturer la journée')}</p><p className="text-sm text-muted">{t('Expliquez les clients non payés, puis comptez l’argent de la caisse.')}</p></div>
          <Btn tone="brand" className="px-6 py-3" onClick={() => setClosing(true)}><Lock className="h-4 w-4" /> {t('Clôturer')}</Btn>
        </div>
      )}
      {cancel && <CancelSale s={cancel} people={people} onClose={() => setCancel(null)} onDone={() => { setCancel(null); reload(); }} />}
      {closing && <CloseDay till={till} people={people} onClose={() => setClosing(false)} onDone={() => { setClosing(false); reload(); }} />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="panel rounded-3xl p-4"><p className="text-sm text-muted">{label}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{value}</p>{sub && <p className="text-xs text-muted">{sub}</p>}</div>;
}
function Diff({ c }: { c: number }) {
  return <div className="text-end"><p className="text-xs text-muted">{t('Écart')}</p>
    <p className={`font-display text-2xl font-semibold tabular ${c === 0 ? 'text-ok' : c < 0 ? 'text-danger' : 'text-warn'}`}>{c === 0 ? t('Juste') : `${c > 0 ? '+' : '-'}${mad(Math.abs(c))}`}</p></div>;
}

const REASONS = ['Paiera plus tard', 'Pas venu(e) en fait', 'Offert', 'Erreur dans l’agenda'];
function CloseDay({ till, people, onClose, onDone }: { till: TillDay; people: Person[]; onClose: () => void; onDone: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const [why, setWhy] = useState<Record<string, string>>({});
  const [count, setCount] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ expected_cash_cents: number; counted_cash_cents: number; cash_diff_cents: number } | null>(null);
  const missing = till.unpaid.filter(u => !why[u.id]?.trim()).length;
  const name = (id: string | null) => people.find(p => p.id === id)?.name ?? '';
  const go = async () => {
    setBusy(true);
    try {
      setRes(await rpc('agenda_close_day', { p_restaurant_id: r.id, p_date: till.date, p_counted_cash_cents: Math.round(Number(count.replace(',', '.')) * 100),
        p_unpaid: till.unpaid.map(u => ({ kind: u.kind, id: u.id, reason: why[u.id].trim() })), p_note: null, p_staff_id: pos.staff?.id ?? null }));
    } catch (e) { pos.toast(String((e as Error).message).includes('unpaid') ? t('Un client vient d’être ajouté : rechargez et expliquez-le.') : tillMessage(e) ?? String((e as Error).message), 'error'); }
    setBusy(false);
  };
  if (res) return (
    <Modal title={t('Journée clôturée')} onClose={onDone}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface-2 p-4"><p className="text-sm text-muted">{t('Espèces attendues')}</p><p className="font-display text-2xl font-semibold tabular">{mad(res.expected_cash_cents)}</p></div>
          <div className="rounded-2xl bg-surface-2 p-4"><p className="text-sm text-muted">{t('Espèces comptées')}</p><p className="font-display text-2xl font-semibold tabular">{mad(res.counted_cash_cents)}</p></div>
        </div>
        <div className={`flex items-center justify-between rounded-2xl p-4 ${res.cash_diff_cents === 0 ? 'bg-ok/10' : 'bg-danger/10'}`}>
          <p className="font-semibold">{res.cash_diff_cents === 0 ? t('La caisse est juste.') : res.cash_diff_cents < 0 ? t('Il manque de l’argent dans la caisse.') : t('Il y a plus d’argent que prévu.')}</p>
          <Diff c={res.cash_diff_cents} />
        </div>
        <Btn className="w-full" onClick={onDone}>{t('Fermer')}</Btn>
      </div>
    </Modal>
  );
  return (
    <Modal title={t('Clôturer la journée')} onClose={onClose} wide
>
      <div className="space-y-6">
        {till.unpaid.length > 0 && (
          <div>
            <h3 className="font-semibold">{t('1. Les clients non payés')}</h3>
            <p className="mb-3 text-sm text-muted">{t('Pour chaque client passé et non encaissé, dites pourquoi. Le propriétaire le verra.')}</p>
            <ul className="space-y-3">
              {till.unpaid.map((u: Unpaid) => (
                <li key={u.id} className="rounded-2xl bg-surface-2 p-3">
                  <p className="font-semibold">{u.name} <span className="font-normal text-muted">{[svcName(u.service), name(u.staff_id), u.price_cents ? mad(u.price_cents) : ''].filter(Boolean).join(' · ')}</span></p>
                  <div className="mt-2 flex flex-wrap gap-1.5">{REASONS.map(x => <button key={x} onClick={() => setWhy(w => ({ ...w, [u.id]: t(x) }))} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${why[u.id] === t(x) ? 'gold-fill text-brand-ink' : 'bg-bg/70'}`}>{t(x)}</button>)}</div>
                  <input className={`${inputCls} mt-2`} maxLength={100} value={why[u.id] ?? ''} onChange={e => setWhy(w => ({ ...w, [u.id]: e.target.value }))} placeholder={t('Autre raison')} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <h3 className="font-semibold">{till.unpaid.length ? t('2. Comptez la caisse') : t('Comptez la caisse')}</h3>
          <p className="mb-3 text-sm text-muted">{t('Comptez tout l’argent liquide de la caisse et tapez le total. Le montant attendu s’affiche seulement après : c’est ce qui rend le comptage honnête.')}</p>
          <div className={`mx-auto max-w-xs ${missing > 0 || busy ? 'pointer-events-none opacity-40' : ''}`}>
            <PinPad masked={false} allowDecimal maxLen={8} value={count} onChange={setCount} onSubmit={() => /^\d+([.,]\d{0,2})?$/.test(count.trim()) && go()} submitLabel={t('Clôturer')} /></div>
          {missing > 0 && <p className="mt-2 text-center text-sm text-warn">{t('Expliquez d’abord chaque client non payé.')}</p>}
        </div>
      </div>
    </Modal>
  );
}

function CancelSale({ s, people, onClose, onDone }: { s: Sale; people: Person[]; onClose: () => void; onDone: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const managers = people.filter(p => p.role === 'manager');
  const [why, setWhy] = useState('');
  const [who, setWho] = useState<string | null>(pos.staff?.role === 'manager' ? pos.staff.id : managers[0]?.id ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (pin: string) => {
    if (!why.trim() || !who) return;
    setBusy(true); setErr(null);
    try {
      const x = await rpc<{ ok: boolean; error?: string }>('agenda_sale_cancel', { p_restaurant_id: r.id, p_sale: s.id, p_reason: why.trim(), p_staff_id: who, p_pin: pin });
      if (x.ok) { pos.toast(t('Ticket annulé'), 'ok'); onDone(); } else setErr(PIN_ERRORS[x.error ?? 'invalid'] ?? t('Code incorrect.'));
    } catch (e) { setErr(tillMessage(e) ?? String((e as Error).message)); }
    setBusy(false);
  };
  return (
    <Modal title={t('Annuler le ticket n° {n}', { n: s.number })} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('Le ticket reste visible comme annulé. Si le client est venu, il revient dans « À encaisser ».')}</p>
        <Field label={t('Raison')}><input className={inputCls} maxLength={200} autoFocus value={why} onChange={e => setWhy(e.target.value)} placeholder={t('Erreur de prix, mauvais client…')} /></Field>
        {!managers.length ? <p className="text-sm text-danger">{t('Aucun manager : le propriétaire peut annuler depuis l’espace de gestion.')}</p> : <>
          <div className="flex flex-wrap gap-1.5">{managers.map(m => <button key={m.id} onClick={() => setWho(m.id)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${who === m.id ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`}>{m.name}</button>)}</div>
          <p className="text-center text-sm font-semibold text-muted">{t('Code du manager')}</p>
          <div className={why.trim() ? '' : 'pointer-events-none opacity-40'}><PinPad onSubmit={go} busy={busy} error={err} submitLabel={t('Annuler le ticket')} /></div>
        </>}
      </div>
    </Modal>
  );
}

function NewAppointment({ services, team, onClose, onSaved }: { services: Svc[]; team: Person[]; onClose: () => void; onSaved: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const tz = r.timezone || 'UTC';
  const [f, setF] = useState(() => {
    const hm = new Date().toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const m = Math.min(23 * 60 + 45, Math.ceil((Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) + 5) / 15) * 15);
    return { service: '', staff: team[0]?.id ?? '', day: ymdIn(new Date(), tz), time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, name: '', phone: '' };
  });
  const [warn, setWarn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const svc = services.find(s => s.id === f.service);
  const able = team.filter(p => !svc || !p.agenda_services?.length || p.agenda_services.includes(svc.id));
  const save = async (force: boolean) => {
    setBusy(true);
    try {
      await rpc('agenda_save', { p_restaurant_id: r.id, p_force: force, p_appt: { source: 'phone', staff_id: f.staff, service_id: f.service || undefined,
        starts_at: instant(f.day, f.time, tz).toISOString(), name: f.name.trim(), phone: f.phone.trim() } });
      pos.toast(t('Rendez-vous enregistré'), 'ok'); onSaved();
    } catch (e) {
      const m = String((e as Error).message);
      const w = m.includes('cannot_do') ? t('Cette personne ne fait pas cette prestation.') : m.includes('overlap') ? t('Ce créneau chevauche un autre rendez-vous ou un congé.') : m.includes('outside_hours') ? t('En dehors des horaires de cette personne.') : null;
      if (w && !force) setWarn(w); else pos.fail(e);
    }
    setBusy(false);
  };
  const chip = (on: boolean) => `rounded-xl px-3 py-2 text-sm font-semibold ${on ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`;
  return (
    <Modal title={t('Nouveau rendez-vous')} onClose={onClose} wide
      footer={<div className="flex items-center justify-end gap-2">{warn && <p className="me-auto text-sm text-warn">{warn}</p>}
        {warn ? <Btn tone="brand" disabled={busy} onClick={() => save(true)}>{t('Enregistrer quand même')}</Btn> : <Btn tone="brand" disabled={busy || !f.name.trim() || !f.staff || !f.service} onClick={() => save(false)}>{t('Enregistrer')}</Btn>}</div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">{services.map(s => <button key={s.id} className={chip(f.service === s.id)} onClick={() => { setF({ ...f, service: s.id }); setWarn(null); }}>{svcName(s.name)}</button>)}</div>
        <div className="flex flex-wrap gap-1.5">{able.map(p => <button key={p.id} className={chip(f.staff === p.id)} onClick={() => { setF({ ...f, staff: p.id }); setWarn(null); }}><span className="me-1.5 inline-block h-2 w-2 rounded-full" style={{ background: colorOf(p) }} />{p.name}</button>)}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Jour')}><input type="date" className={inputCls} value={f.day} onChange={e => { setF({ ...f, day: e.target.value }); setWarn(null); }} /></Field>
          <Field label={t('Heure')}><input type="time" step={900} className={inputCls} value={f.time} onChange={e => { setF({ ...f, time: e.target.value }); setWarn(null); }} /></Field>
          <Field label={t('Client')}><input className={inputCls} maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('Téléphone')}><input className={inputCls} dir="ltr" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="06 12 34 56 78" /></Field>
        </div>
      </div>
    </Modal>
  );
}

function WalkIn({ services, team, onClose, onSaved }: { services: Svc[]; team: Person[]; onClose: () => void; onSaved: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [svc, setSvc] = useState<string | null>(null); const [who, setWho] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chip = (on: boolean) => `rounded-xl px-3 py-2 text-sm font-semibold ${on ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`;
  const save = async () => {
    setBusy(true);
    try { await rpc('nouba_add', { p_restaurant_id: r.id, p_entry: { name, phone, service_id: svc, staff_id: who } }); pos.toast(t('Ajouté à la file'), 'ok'); onSaved(); } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={t('Client sans rendez-vous')} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy} onClick={save}><Footprints className="h-4 w-4" /> {t('Ajouter à la file')}</Btn></div>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Prénom (facultatif)')}><input className={inputCls} value={name} maxLength={60} onChange={e => setName(e.target.value)} autoFocus /></Field>
          <Field label={t('Téléphone (facultatif)')}><input className={inputCls} value={phone} inputMode="tel" dir="ltr" onChange={e => setPhone(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-1.5">{services.map(s => <button key={s.id} className={chip(svc === s.id)} onClick={() => setSvc(svc === s.id ? null : s.id)}>{svcName(s.name)}</button>)}</div>
        {team.length > 1 && <div className="flex flex-wrap gap-1.5"><button className={chip(who === null)} onClick={() => setWho(null)}>{t('Le premier libre')}</button>{team.map(p => <button key={p.id} className={chip(who === p.id)} onClick={() => setWho(p.id)}>{p.name}</button>)}</div>}
      </div>
    </Modal>
  );
}

function Toasts() {
  const { toasts } = usePos();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map(x => <div key={x.id} className={`pop rounded-2xl px-5 py-3 font-semibold shadow-2xl ${x.tone === 'error' ? 'bg-danger text-white' : x.tone === 'ok' ? 'bg-ok text-[#032A2A]' : 'panel text-ink'}`}>{x.text}</div>)}
    </div>
  );
}
