// Amplify Agenda: the salon's day. One column per person who takes appointments, the hours they work,
// days off greyed, the appointments with their time to prepare. Tap an empty time to put a client in
// (phone, WhatsApp, walk-in), tap an appointment to mark it arrived, done, no-show, to move or cancel it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Globe, Pencil, Phone, Plus, UserX, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, inputCls } from '../components/ui';
import { DAYS } from '../components/HoursEditor';
import { fmtDuration, svcName, type AgService } from './AgendaServicesPage';
import { ymdIn } from '../lib/whatsapp';

interface Person { id: string; name: string; agenda_color: string | null; agenda_hours: Record<string, [string, string][]>; agenda_services: string[]; agenda_sort: number }
interface Appt {
  id: string; staff_id: string | null; service_id: string | null; status: string; source: string; starts_at: string; duration_min: number; buffer_min: number;
  name: string; phone: string | null; note: string | null; service_name: Record<string, string>; price_cents: number; price_from: boolean;
  any_staff: boolean; client_confirmed_at: string | null; reminded_at: string | null;
}
interface Off { id: string; staff_id: string | null; starts_at: string; ends_at: string; reason: string | null }

const HEX = /^#[0-9a-f]{6}$/i;
const PX = 1.4; // pixels per minute
const colorOf = (p?: Person) => (p?.agenda_color && HEX.test(p.agenda_color) ? p.agenda_color : '#64748b');
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** offset of a time zone at an instant, in minutes */
function tzOffset(at: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(at).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - at.getTime()) / 60000;
}
/** the instant of a local date and minutes in a time zone */
function instant(day: string, min: number, tz: string) {
  const guess = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), 0, min));
  return new Date(guess.getTime() - tzOffset(guess, tz) * 60000);
}
/** minutes since local midnight of an instant */
const localMin = (iso: string, tz: string) => { const d = new Date(iso); return Math.round((d.getTime() + tzOffset(d, tz) * 60000) % 86400000 / 60000); };
const addDays = (day: string, n: number) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n)).toISOString().slice(0, 10);
const weekdayKey = (day: string) => DAYS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7];
const STATUS: Record<string, { label: () => string; cls: string }> = {
  requested: { label: () => t('À confirmer'), cls: 'bg-amber-500/20 text-amber-700' },
  confirmed: { label: () => t('Confirmé'), cls: '' },
  arrived: { label: () => t('Arrivé'), cls: 'bg-sky-500/20 text-sky-700' },
  done: { label: () => t('Terminé'), cls: 'bg-emerald-500/20 text-emerald-700' },
  no_show: { label: () => t('Pas venu'), cls: 'bg-red-500/20 text-red-700' },
};

export function AgendaDayPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const tz = r.timezone || 'UTC';
  const today = ymdIn(new Date(), tz);
  const [day, setDay] = useState(today);
  const [people, setPeople] = useState<Person[]>([]);
  const [services, setServices] = useState<AgService[]>([]);
  const [appts, setAppts] = useState<Appt[] | null>(null);
  const [offs, setOffs] = useState<Off[]>([]);
  const [open, setOpen] = useState<Appt | null>(null);
  const [draft, setDraft] = useState<{ staff: string; min: number; appt?: Appt } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    supabase.from('staff').select('id, name, agenda_color, agenda_hours, agenda_services, agenda_sort').eq('restaurant_id', r.id).eq('active', true).eq('agenda', true)
      .order('agenda_sort').order('name').then(x => setPeople((x.data ?? []) as Person[]));
    supabase.from('agenda_services').select('*').eq('restaurant_id', r.id).eq('active', true).order('sort_order').then(x => setServices((x.data ?? []) as AgService[]));
  }, [r.id]);
  const load = useCallback(async () => {
    const from = instant(day, 0, tz).toISOString(), to = instant(addDays(day, 1), 0, tz).toISOString();
    const [ap, of] = await Promise.all([
      supabase.from('agenda_appointments').select('*').eq('restaurant_id', r.id).gte('starts_at', from).lt('starts_at', to).neq('status', 'cancelled').order('starts_at'),
      supabase.from('agenda_time_off').select('*').eq('restaurant_id', r.id).lt('starts_at', to).gt('ends_at', from),
    ]);
    if (ap.error) a.fail(ap.error);
    setAppts((ap.data ?? []) as Appt[]); setOffs((of.data ?? []) as Off[]);
  }, [r.id, day, tz, a]);
  useEffect(() => { setAppts(null); load(); const id = window.setInterval(() => { load(); setNow(Date.now()); }, 30000); return () => window.clearInterval(id); }, [load]);

  // the hours of each person this day (their own, or the salon's opening hours)
  const key = weekdayKey(day);
  const work = useMemo(() => Object.fromEntries(people.map(p => {
    const h = Object.keys(p.agenda_hours ?? {}).length ? p.agenda_hours : (r.opening_hours ?? {}) as Record<string, [string, string][]>;
    return [p.id, (h[key] ?? []).map(([s, e]) => [toMin(s), e === '24:00' ? 1440 : toMin(e) || 1440] as [number, number])];
  })), [people, key, r.opening_hours]);
  // the window shown: from the first start to the last end (at least 9:00-19:00), whole hours
  const [start, end] = useMemo(() => {
    const all = Object.values(work).flat();
    const ap = (appts ?? []).map(x => [localMin(x.starts_at, tz), localMin(x.starts_at, tz) + x.duration_min]);
    const s = Math.min(9 * 60, ...all.map(x => x[0]), ...ap.map(x => x[0]));
    const e = Math.max(19 * 60, ...all.map(x => x[1]), ...ap.map(x => x[1]));
    return [Math.floor(s / 60) * 60, Math.min(1440, Math.ceil(e / 60) * 60)];
  }, [work, appts, tz]);
  const hours = Array.from({ length: (end - start) / 60 }, (_, i) => start + i * 60);
  const nowMin = day === today ? localMin(new Date(now).toISOString(), tz) : null;
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  const count = (appts ?? []).filter(x => x.status !== 'no_show').length;

  const clickColumn = (e: React.MouseEvent<HTMLDivElement>, staff: string) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const min = start + Math.floor(y / PX / 15) * 15;
    setDraft({ staff, min });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold">{t('Agenda')}</h1>
        <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
          <button className="rounded-lg p-2 hover:bg-surface" onClick={() => setDay(addDays(day, -1))} aria-label={t('Jour précédent')}><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></button>
          <button className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${day === today ? 'bg-surface shadow-sm' : 'hover:bg-surface'}`} onClick={() => setDay(today)}>{t('Aujourd’hui')}</button>
          <button className="rounded-lg p-2 hover:bg-surface" onClick={() => setDay(addDays(day, 1))} aria-label={t('Jour suivant')}><ChevronRight className="h-4 w-4 rtl:rotate-180" /></button>
        </div>
        <label className="relative inline-flex items-center gap-2 font-semibold first-letter:uppercase">
          <CalendarDays className="h-4 w-4 text-brand" /><span className="first-letter:uppercase">{label}</span>
          <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        <span className="text-sm text-muted">{t('{n} rendez-vous', { n: count })}</span>
        <Btn tone="brand" className="ms-auto" disabled={!people.length} onClick={() => setDraft({ staff: people[0]?.id ?? '', min: Math.max(start, nowMin != null ? Math.ceil(nowMin / 15) * 15 : 10 * 60) })}>
          <Plus className="h-4 w-4" /> {t('Nouveau rendez-vous')}</Btn>
      </div>

      {!people.length ? <p className="card rounded-3xl p-8 text-center text-muted">{t('Personne ne prend de rendez-vous. Activez-le dans « Équipe et horaires ».')}</p> : (
        <div className="card overflow-x-auto rounded-3xl">
          <div className="flex min-w-max">
            {/* the hours */}
            <div className="sticky start-0 z-20 w-14 shrink-0 border-e border-line/10 bg-surface">
              <div className="h-14 border-b border-line/10" />
              <div className="relative" style={{ height: (end - start) * PX }}>
                {hours.map(h => <span key={h} className="absolute end-2 -translate-y-1/2 text-xs font-semibold tabular text-muted" style={{ top: (h - start) * PX }}>{h > start ? hm(h) : ''}</span>)}
              </div>
            </div>
            {people.map(p => {
              const c = colorOf(p);
              const mine = (appts ?? []).filter(x => x.staff_id === p.id);
              const off = offs.filter(o => o.staff_id === p.id || o.staff_id === null);
              const ranges = work[p.id] ?? [];
              // the parts of the day the person does not work
              const gaps: [number, number][] = [];
              let cur = start;
              for (const [s, e] of [...ranges].sort((x, y) => x[0] - y[0])) { if (s > cur) gaps.push([cur, Math.min(s, end)]); cur = Math.max(cur, e); }
              if (cur < end) gaps.push([cur, end]);
              return (
                <div key={p.id} className="w-56 shrink-0 border-e border-line/10 last:border-e-0">
                  <div className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-line/10 bg-surface px-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: c }}>{p.name.slice(0, 1)}</span>
                    <span className="truncate font-semibold">{p.name}</span>
                    <span className="ms-auto text-xs text-muted">{mine.filter(x => x.status !== 'no_show').length}</span>
                  </div>
                  <div className="relative cursor-copy" style={{ height: (end - start) * PX }} onClick={e => clickColumn(e, p.id)}>
                    {hours.map(h => <div key={h} className="absolute inset-x-0 border-t border-line/[0.07]" style={{ top: (h - start) * PX }} />)}
                    {gaps.map(([s, e]) => <div key={s} className="absolute inset-x-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(100_116_139/0.08)_6px_12px)]" style={{ top: (s - start) * PX, height: (e - s) * PX }} />)}
                    {off.map(o => {
                      const s = Math.max(start, o.starts_at < instant(day, 0, tz).toISOString() ? start : localMin(o.starts_at, tz));
                      const e = Math.min(end, o.ends_at > instant(addDays(day, 1), 0, tz).toISOString() ? end : localMin(o.ends_at, tz));
                      return e > s && <div key={o.id} className="absolute inset-x-1 grid place-items-center rounded-lg bg-slate-500/15 text-xs font-semibold text-muted" style={{ top: (s - start) * PX, height: (e - s) * PX }}>{o.reason || t('Congé')}</div>;
                    })}
                    {mine.map(x => {
                      const s = localMin(x.starts_at, tz);
                      const st = STATUS[x.status];
                      return (
                        <button key={x.id} onClick={e => { e.stopPropagation(); setOpen(x); }}
                          className={`absolute inset-x-1 overflow-hidden rounded-lg bg-surface text-start text-xs shadow-sm ring-1 ring-black/5 transition hover:z-10 hover:shadow-md ${x.status === 'no_show' ? 'opacity-50' : ''}`}
                          style={{ top: (s - start) * PX, height: (x.duration_min + x.buffer_min) * PX - 2 }}>
                          <div className="h-full" style={{ background: `linear-gradient(${c}26, ${c}26) 0 0 / 100% ${x.duration_min * PX}px no-repeat, linear-gradient(rgb(var(--surface)), rgb(var(--surface))) 0 0 / 100% ${x.duration_min * PX}px no-repeat, repeating-linear-gradient(135deg, ${c}1f 0 4px, transparent 4px 8px)` }}>
                            <div className="h-full border-s-4 px-2 py-1" style={{ borderColor: c }}>
                              {x.duration_min < 30 ? <p className="truncate"><b className="tabular">{hm(s)}</b> {x.name}</p> : <>
                              <p className="flex items-center gap-1 font-semibold tabular">{hm(s)}
                                {x.source === 'online' && <Globe className="h-3 w-3 text-muted" />}
                                {x.client_confirmed_at && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                                {st?.cls && <span className={`ms-auto rounded px-1 text-[10px] font-bold ${st.cls}`}>{st.label()}</span>}
                              </p>
                              {x.duration_min >= 45 ? <>
                                <p className="truncate font-semibold">{x.name}</p>
                                <p className="truncate text-muted">{svcName({ name: x.service_name })}</p>
                              </> : <p className="truncate"><b>{x.name}</b> <span className="text-muted">· {svcName({ name: x.service_name })}</span></p>}
                              </>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {nowMin != null && nowMin >= start && nowMin <= end && <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: (nowMin - start) * PX }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {open && <ApptSheet r={r} x={open} people={people} onClose={() => setOpen(null)} onEdit={() => { setDraft({ staff: open.staff_id ?? people[0]?.id ?? '', min: localMin(open.starts_at, tz), appt: open }); setOpen(null); }} onChanged={() => { setOpen(null); load(); }} />}
      {draft && <ApptEditor r={r} day={day} tz={tz} draft={draft} people={people} services={services} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); load(); }} />}
    </div>
  );
}

function ApptSheet({ r, x, people, onClose, onEdit, onChanged }: { r: Restaurant; x: Appt; people: Person[]; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const a = useAdminCtx();
  const tz = r.timezone || 'UTC';
  const [noShows, setNoShows] = useState<number | null>(null);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!x.phone) return;
    supabase.from('agenda_appointments').select('id', { count: 'exact', head: true }).eq('restaurant_id', r.id).eq('phone', x.phone).eq('status', 'no_show')
      .then(res => setNoShows(res.count ?? 0));
  }, [r.id, x.phone]);
  const set = async (status: string) => {
    const { error } = await supabase.from('agenda_appointments').update({ status }).eq('id', x.id).select('id');
    if (error) { a.fail(error); return; }
    a.toast(t('Enregistré')); onChanged();
  };
  const p = people.find(y => y.id === x.staff_id);
  const when = new Date(x.starts_at).toLocaleString('fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return (
    <Modal title={x.name} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-2xl bg-surface-2 p-4 text-sm">
          <p className="font-semibold first-letter:uppercase">{when}</p>
          <p className="mt-1">{svcName({ name: x.service_name })} · {fmtDuration(x.duration_min)}{p ? ` · ${p.name}` : ''}{x.any_staff ? ` (${t('peu importe')})` : ''}</p>
          {x.phone && <p className="mt-1 flex items-center gap-2"><Phone className="h-3.5 w-3.5" /><a className="underline" href={`tel:${x.phone}`}>{x.phone}</a>
            {noShows ? <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-600">{t('{n} absence(s) avant', { n: noShows })}</span> : null}</p>}
          {x.note && <p className="mt-2 text-muted">{x.note}</p>}
          <p className="mt-2 text-xs text-muted">{x.source === 'online' ? t('Réservé en ligne') : x.source === 'walk_in' ? t('Sans rendez-vous') : x.source === 'phone' ? t('Par téléphone') : t('Ajouté par le salon')}
            {x.client_confirmed_at ? ` · ${t('Confirmé par le client')}` : x.reminded_at ? ` · ${t('Rappel envoyé')}` : ''}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {x.status === 'requested' && <Btn tone="brand" className="col-span-2" onClick={() => set('confirmed')}><Check className="h-4 w-4" /> {t('Confirmer')}</Btn>}
          <Btn onClick={() => set('arrived')} disabled={x.status === 'arrived'}><CheckCircle2 className="h-4 w-4" /> {t('Arrivé')}</Btn>
          <Btn onClick={() => set('done')} disabled={x.status === 'done'}><Check className="h-4 w-4" /> {t('Terminé')}</Btn>
          <Btn onClick={() => set('no_show')} disabled={x.status === 'no_show'}><UserX className="h-4 w-4" /> {t('Pas venu')}</Btn>
          <Btn onClick={onEdit}><Pencil className="h-4 w-4" /> {t('Modifier ou déplacer')}</Btn>
        </div>
        {sure ? (
          <div className="flex gap-2"><Btn className="flex-1" onClick={() => setSure(false)}>{t('Garder')}</Btn><Btn tone="danger" className="flex-1" onClick={() => set('cancelled')}>{t('Oui, annuler')}</Btn></div>
        ) : <button onClick={() => setSure(true)} className="flex w-full items-center justify-center gap-2 py-2 text-sm font-semibold text-danger"><X className="h-4 w-4" />{t('Annuler le rendez-vous')}</button>}
      </div>
    </Modal>
  );
}

function ApptEditor({ r, day, tz, draft, people, services, onClose, onSaved }: {
  r: Restaurant; day: string; tz: string; draft: { staff: string; min: number; appt?: Appt }; people: Person[]; services: AgService[]; onClose: () => void; onSaved: () => void;
}) {
  const a = useAdminCtx();
  const x = draft.appt;
  const [f, setF] = useState(() => ({
    service: x?.service_id ?? '', staff: draft.staff, day: x ? ymdIn(new Date(x.starts_at), tz) : day, time: hm(draft.min),
    name: x?.name ?? '', phone: x?.phone ?? '', note: x?.note ?? '', source: x?.source ?? 'phone', dur: x ? String(x.duration_min) : '',
  }));
  const [warn, setWarn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const svc = services.find(s => s.id === f.service);
  const able = people.filter(p => !svc || !p.agenda_services?.length || p.agenda_services.includes(svc.id));
  const save = async (force: boolean) => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        ...(x ? { id: x.id } : { source: f.source }), staff_id: f.staff, starts_at: instant(f.day, toMin(f.time), tz).toISOString(),
        name: f.name.trim(), phone: f.phone.trim(), note: f.note.trim(),
        ...(f.service && f.service !== x?.service_id ? { service_id: f.service } : {}),
        ...(f.dur ? { duration_min: Number(f.dur) } : {}),
      };
      const { error } = await supabase.rpc('agenda_save', { p_restaurant_id: r.id, p_appt: body, p_force: force });
      if (error) {
        if (/overlap|outside_hours/.test(error.message)) { setWarn(error.message.includes('overlap') ? 'overlap' : 'outside_hours'); setBusy(false); return; }
        throw error;
      }
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const chip = (on: boolean) => `rounded-xl px-3 py-2 text-sm font-semibold ${on ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted'}`;
  return (
    <Modal wide title={x ? t('Modifier le rendez-vous') : t('Nouveau rendez-vous')} onClose={onClose}
      footer={<div className="flex flex-wrap items-center justify-end gap-3">
        {warn && <p className="me-auto text-sm font-semibold text-amber-600">{warn === 'overlap' ? t('Ce créneau chevauche un autre rendez-vous ou un congé.') : t('En dehors des horaires de cette personne.')}</p>}
        {warn ? <Btn tone="brand" disabled={busy} onClick={() => save(true)}>{t('Enregistrer quand même')}</Btn>
          : <Btn tone="brand" disabled={busy || !f.staff || !/^\d\d:\d\d$/.test(f.time)} onClick={() => save(false)}>{t('Enregistrer')}</Btn>}
      </div>}>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-semibold">{t('Prestation')}</p>
          <div className="flex flex-wrap gap-1.5">{services.map(s => <button key={s.id} type="button" className={chip(f.service === s.id)} onClick={() => { setF({ ...f, service: s.id, dur: '' }); setWarn(null); }}>{svcName(s)} <span className="opacity-70">· {fmtDuration(s.duration_min)}</span></button>)}</div>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">{t('Avec')}</p>
          <div className="flex flex-wrap gap-1.5">{able.map(p => <button key={p.id} type="button" className={`${chip(f.staff === p.id)} inline-flex items-center gap-2`} onClick={() => { setF({ ...f, staff: p.id }); setWarn(null); }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(p) }} />{p.name}</button>)}</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('Jour')}><input type="date" className={inputCls} value={f.day} onChange={e => { setF({ ...f, day: e.target.value }); setWarn(null); }} /></Field>
          <Field label={t('Heure')}><input type="time" step={300} className={inputCls} value={f.time} onChange={e => { setF({ ...f, time: e.target.value }); setWarn(null); }} /></Field>
          <Field label={t('Durée (min)')}><input className={inputCls} inputMode="numeric" value={f.dur} placeholder={svc ? String(svc.duration_min) : x ? String(x.duration_min) : '30'} onChange={e => { setF({ ...f, dur: e.target.value.replace(/\D/g, '') }); setWarn(null); }} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Prénom')}><input className={inputCls} maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('Téléphone (facultatif)')}><input className={inputCls} inputMode="tel" dir="ltr" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        {!x && <div className="flex flex-wrap gap-1.5">
          {[['phone', t('Par téléphone')], ['staff', t('WhatsApp ou autre')], ['walk_in', t('Sans rendez-vous')]].map(([k, l]) => <button key={k} type="button" className={chip(f.source === k)} onClick={() => setF({ ...f, source: k })}>{l}</button>)}
        </div>}
        <Field label={t('Note (facultatif)')}><input className={inputCls} maxLength={300} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
