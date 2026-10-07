// Staff planning (who works when, cost against expected revenue, late arrivals) and tips.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlarmClock, ChevronLeft, ChevronRight, Coins, Copy, MessageCircle, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad, rpc } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant, Staff } from '../lib/types';
import { Btn, Card, Field, Modal, inputCls } from '../components/ui';

interface Shift { id: string; staff_id: string; day: string; start: string; end: string; note: string | null }
interface Day { day: string; planned_hours: number; planned_cost_cents: number; missing_rates: number; expected_cents: number | null; revenue_cents: number | null; worked_hours: number }
interface Week { shifts: Shift[]; days: Day[]; late: { staff_id: string; day: string; planned: string; clock_in: string; minutes: number }[] }
interface TipLine { staff_id: string; name: string; hours: number; amount_cents: number }
interface Payout { id: string; period_from: string; period_to: string; rule: string; total_cents: number; lines: TipLine[]; created_at: string }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s: string, n: number) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const mondayOf = (d: Date) => { const x = new Date(d); x.setHours(12); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); };
const dayLabel = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s}T12:00:00`).toLocaleDateString(dateLocale(), o);
const hrs = (h: number) => `${Math.floor(h)} h${Math.round((h % 1) * 60) ? String(Math.round((h % 1) * 60)).padStart(2, '0') : ''}`;
const shiftH = (a: string, b: string) => { const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); let d = h2 * 60 + m2 - h1 * 60 - m1; if (d <= 0) d += 1440; return d / 60; };

export function PlanningPage({ r }: { r: Restaurant }) {
  const [tab, setTab] = useState<'plan' | 'tips'>('plan');
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand">Amplify</p>
        <h1 className="font-display text-3xl font-semibold">{t('Planning & pourboires')}</h1>
        <p className="text-muted">{t('Le planning de la semaine avec son coût face au chiffre attendu, les retards, et le partage des pourboires.')}</p>
      </div>
      <div role="tablist" className="flex w-fit gap-1 rounded-2xl border border-line/[0.1] bg-surface p-1">
        {([['plan', t('Planning')], ['tips', t('Pourboires')]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === k ? 'bg-night text-white' : 'text-muted'}`}>{l}</button>
        ))}
      </div>
      {tab === 'plan' ? <PlanView r={r} /> : <TipsView r={r} />}
    </div>
  );
}

function useStaff(r: Restaurant) {
  const [staff, setStaff] = useState<Staff[]>([]);
  useEffect(() => { supabase.from('staff').select('id,name,role,active').eq('restaurant_id', r.id).eq('active', true).order('name').then(({ data }) => setStaff((data ?? []) as Staff[])); }, [r.id]);
  return staff;
}

function PlanView({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const staff = useStaff(r);
  const [mon, setMon] = useState(() => mondayOf(new Date()));
  const [wk, setWk] = useState<Week | null>(null);
  const [edit, setEdit] = useState<{ staff: Staff; day: string; shift: Shift | null } | null>(null);
  const [share, setShare] = useState(false);
  const load = useCallback(async () => { try { setWk(await rpc<Week>('planning_week', { p_restaurant_id: r.id, p_monday: mon })); } catch (e) { a.fail(e); } }, [r.id, mon, a]);
  useEffect(() => { load(); }, [load]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(mon, i)), [mon]);
  const copyPrev = async () => {
    try { const n = await rpc<number>('planning_copy_week', { p_restaurant_id: r.id, p_from_monday: addDays(mon, -7), p_to_monday: mon }); a.toast(t('{n} services copiés', { n })); load(); } catch (e) { a.fail(e); }
  };
  const tot = (wk?.days ?? []).reduce((s, d) => ({ h: s.h + Number(d.planned_hours), c: s.c + Number(d.planned_cost_cents), e: s.e + Number(d.expected_cents ?? 0) }), { h: 0, c: 0, e: 0 });
  const pct = (c: number, e: number) => (e > 0 ? Math.round((c / e) * 100) : null);
  const tone = (p: number | null) => (p == null ? 'text-muted' : p > 35 ? 'text-danger' : p > 28 ? 'text-warn' : 'text-ok');
  const name = (id: string) => staff.find(s => s.id === id)?.name ?? '';

  return <>
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Btn className="px-2.5" aria-label={t('Semaine précédente')} onClick={() => setMon(addDays(mon, -7))}><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></Btn>
        <p className="min-w-44 text-center font-semibold">{dayLabel(mon, { day: 'numeric', month: 'short' })} – {dayLabel(addDays(mon, 6), { day: 'numeric', month: 'short' })}</p>
        <Btn className="px-2.5" aria-label={t('Semaine suivante')} onClick={() => setMon(addDays(mon, 7))}><ChevronRight className="h-4 w-4 rtl:rotate-180" /></Btn>
        <span className="me-auto" />
        <Btn onClick={copyPrev}><Copy className="h-4 w-4" /> {t('Reprendre la semaine précédente')}</Btn>
        <Btn tone="brand" disabled={!wk?.shifts.length} onClick={() => setShare(true)}><MessageCircle className="h-4 w-4" /> {t('Envoyer à l’équipe')}</Btn>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] table-fixed text-sm">
          <thead><tr>
            <th className="w-36 pb-2 text-start text-xs uppercase tracking-wider text-muted">{t('Équipe')}</th>
            {days.map(d => <th key={d} className="pb-2 text-start text-xs font-semibold capitalize text-muted">{dayLabel(d, { weekday: 'short', day: 'numeric' })}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-line/10">
            {staff.map(s => (
              <tr key={s.id}>
                <td className="py-2 pe-2 font-semibold">{s.name}</td>
                {days.map(d => {
                  const sh = (wk?.shifts ?? []).filter(x => x.staff_id === s.id && x.day === d);
                  return (
                    <td key={d} className="p-1 align-top">
                      <div className="flex min-h-12 flex-col gap-1">
                        {sh.map(x => <button key={x.id} onClick={() => setEdit({ staff: s, day: d, shift: x })} className="rounded-lg bg-brand/12 px-2 py-1 text-start text-xs font-semibold text-brand tabular" dir="ltr">{x.start}–{x.end}{x.note ? <span className="block truncate font-normal text-muted">{x.note}</span> : null}</button>)}
                        <button onClick={() => setEdit({ staff: s, day: d, shift: null })} aria-label={t('Ajouter un service')} className="grid h-7 place-items-center rounded-lg border border-dashed border-line/20 text-muted hover:border-brand hover:text-brand"><Plus className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-line/15 text-xs">
            <tr><td className="pt-3 font-semibold text-muted">{t('Heures prévues')}</td>{(wk?.days ?? []).map(d => <td key={d.day} className="pt-3 font-semibold tabular">{Number(d.planned_hours) ? hrs(Number(d.planned_hours)) : '–'}{Number(d.worked_hours) > 0 && <span className="block font-normal text-muted">{t('{h} pointées', { h: hrs(Number(d.worked_hours)) })}</span>}</td>)}</tr>
            <tr><td className="pt-2 font-semibold text-muted">{t('Coût prévu')}</td>{(wk?.days ?? []).map(d => <td key={d.day} className="pt-2 tabular">{Number(d.planned_cost_cents) ? mad(Number(d.planned_cost_cents)) : '–'}{Number(d.missing_rates) > 0 && <span className="block text-warn">{t('{n} sans coût/h', { n: d.missing_rates })}</span>}</td>)}</tr>
            <tr><td className="pt-2 font-semibold text-muted">{t('CA attendu')}</td>{(wk?.days ?? []).map(d => <td key={d.day} className="pt-2 tabular">{d.expected_cents ? mad(Number(d.expected_cents)) : '–'}{d.revenue_cents != null && <span className="block text-muted">{t('réel {m}', { m: mad(Number(d.revenue_cents)) })}</span>}</td>)}</tr>
            <tr><td className="pt-2 font-semibold text-muted">{t('Salaires / CA')}</td>{(wk?.days ?? []).map(d => { const p = pct(Number(d.planned_cost_cents), Number(d.expected_cents ?? 0)); return <td key={d.day} className={`pt-2 font-bold tabular ${tone(p)}`}>{p != null && Number(d.planned_cost_cents) ? `${p} %` : '–'}</td>; })}</tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 rounded-2xl bg-surface-2 px-4 py-3 text-sm">
        <span>{t('Semaine')} : <b className="tabular">{hrs(tot.h)}</b></span>
        <span>{t('Coût')} : <b className="tabular">{mad(tot.c)}</b></span>
        <span>{t('CA attendu')} : <b className="tabular">{mad(tot.e)}</b></span>
        <span className={tone(pct(tot.c, tot.e))}>{t('Salaires / CA')} : <b className="tabular">{pct(tot.c, tot.e) ?? '–'} %</b></span>
      </div>
      <p className="mt-2 text-xs text-muted">{t('CA attendu : la moyenne du même jour sur les 4 semaines d’avant. Le coût vient du coût horaire de chaque personne (page Équipe). Repère souvent cité en restauration : 25 à 35 %.')}</p>
    </Card>

    {!!wk?.late.length && (
      <Card>
        <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold"><AlarmClock className="h-5 w-5 text-warn" />{t('Retards cette semaine')}</h2>
        <ul className="divide-y divide-line/10 text-sm">
          {wk.late.map((x, i) => <li key={i} className="flex justify-between py-2"><span><b>{name(x.staff_id)}</b> · <span className="capitalize">{dayLabel(x.day, { weekday: 'long' })}</span></span><span className="tabular">{t('prévu {p}, arrivé {c}', { p: x.planned, c: x.clock_in })} · <b className="text-warn">+{x.minutes} min</b></span></li>)}
        </ul>
      </Card>
    )}

    {edit && <ShiftModal r={r} {...edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    {share && wk && <ShareModal r={r} mon={mon} wk={wk} staff={staff} onClose={() => setShare(false)} />}
  </>;
}

function ShiftModal({ r, staff, day, shift, onClose, onSaved }: { r: Restaurant; staff: Staff; day: string; shift: Shift | null; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [f, setF] = useState({ start: shift?.start ?? '09:00', end: shift?.end ?? '17:00', note: shift?.note ?? '' });
  const presets = [['09:00', '17:00'], ['11:00', '16:00'], ['17:00', '00:00'], ['18:00', '02:00']];
  const save = async () => {
    const row = { start_time: f.start, end_time: f.end, note: f.note.trim() || null };
    try {
      if (shift) check(await supabase.from('staff_schedule').update(row).eq('id', shift.id).select('id'));
      else check(await supabase.from('staff_schedule').insert({ ...row, restaurant_id: r.id, staff_id: staff.id, day }).select('id'));
      onSaved();
    } catch (e) { a.fail(e); }
  };
  const del = async () => { if (!shift) return; try { check(await supabase.from('staff_schedule').delete().eq('id', shift.id).select('id')); onSaved(); } catch (e) { a.fail(e); } };
  return (
    <Modal title={`${staff.name} · ${dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}`} onClose={onClose}
      footer={<div className="flex justify-between">{shift ? <Btn tone="danger" onClick={del}><Trash2 className="h-4 w-4" /> {t('Supprimer')}</Btn> : <span />}<Btn tone="brand" disabled={f.start === f.end} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">{presets.map(([s, e]) => <button key={s + e} onClick={() => setF({ ...f, start: s, end: e })} className="rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold tabular" dir="ltr">{s}–{e}</button>)}</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Début')}><input type="time" className={inputCls} value={f.start} onChange={e => setF({ ...f, start: e.target.value })} /></Field>
          <Field label={t('Fin')}><input type="time" className={inputCls} value={f.end} onChange={e => setF({ ...f, end: e.target.value })} /></Field>
        </div>
        <p className="text-sm text-muted">{t('{h} de travail', { h: hrs(shiftH(f.start, f.end)) })}{f.end < f.start ? ` · ${t('finit le lendemain')}` : ''}</p>
        <Field label={t('Note (poste, tâche)')}><input className={inputCls} maxLength={80} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={t('Salle, cuisine, ouverture…')} /></Field>
      </div>
    </Modal>
  );
}

function ShareModal({ r, mon, wk, staff, onClose }: { r: Restaurant; mon: string; wk: Week; staff: Staff[]; onClose: () => void }) {
  const a = useAdminCtx();
  const text = useMemo(() => {
    const lines = [`${r.name} · ${t('Planning')} ${dayLabel(mon, { day: 'numeric', month: 'short' })} – ${dayLabel(addDays(mon, 6), { day: 'numeric', month: 'short' })}`, ''];
    for (const s of staff) {
      const sh = wk.shifts.filter(x => x.staff_id === s.id);
      if (!sh.length) continue;
      lines.push(`*${s.name}*`);
      for (const x of sh) lines.push(`${dayLabel(x.day, { weekday: 'short', day: 'numeric' })} : ${x.start}–${x.end}${x.note ? ` (${x.note})` : ''}`);
      lines.push('');
    }
    return lines.join('\n').trim();
  }, [r.name, mon, wk, staff]);
  const copy = async () => { try { await navigator.clipboard.writeText(text); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  return (
    <Modal title={t('Envoyer à l’équipe')} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Btn onClick={copy}><Copy className="h-4 w-4" /> {t('Copier')}</Btn>
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-[#063B1E]"><MessageCircle className="h-4 w-4" /> WhatsApp</a></div>}>
      <p className="mb-2 text-sm text-muted">{t('À coller dans le groupe WhatsApp de l’équipe.')}</p>
      <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-surface-2 p-4 text-sm">{text}</pre>
    </Modal>
  );
}

function TipsView({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const staff = useStaff(r);
  const [from, setFrom] = useState(() => addDays(mondayOf(new Date()), -7));
  const [to, setTo] = useState(() => addDays(mondayOf(new Date()), -1));
  const [rule, setRule] = useState<'hours' | 'equal'>('hours');
  const [excl, setExcl] = useState<string[]>([]);
  const [pv, setPv] = useState<{ total_cents: number; hours: number; lines: TipLine[]; overlap: boolean } | null>(null);
  const [hist, setHist] = useState<Payout[]>([]);
  const [busy, setBusy] = useState(false);
  const args = { p_restaurant_id: r.id, p_from: from, p_to: to, p_rule: rule, p_exclude: excl };
  const load = useCallback(async () => {
    try {
      setPv(from && to && to >= from ? await rpc('tips_preview', args) : null);
      setHist(check(await supabase.from('tip_payouts').select('*').eq('restaurant_id', r.id).order('period_from', { ascending: false }).limit(12)) as Payout[]);
    } catch (e) { a.fail(e); }
  }, [r.id, from, to, rule, excl.join(), a]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  const save = async () => { setBusy(true); try { await rpc('tips_distribute', args); a.toast(t('Partage enregistré')); load(); } catch (e) { a.fail(e); } setBusy(false); };
  const cancel = async (id: string) => { try { await rpc('tips_cancel', { p_payout_id: id }); load(); } catch (e) { a.fail(e); } };

  return <>
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Coins className="h-5 w-5 text-brand" />{t('Partager les pourboires')}</h2>
      <p className="mb-4 text-sm text-muted">{t('Les pourboires saisis à la caisse sur la période, partagés selon les heures pointées ou à parts égales. Une période ne peut être partagée qu’une fois.')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('Du')}><input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label={t('Au')}><input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></Field>
        <Field label={t('Règle')}><select className={inputCls} value={rule} onChange={e => setRule(e.target.value as 'hours' | 'equal')}><option value="hours">{t('Selon les heures pointées')}</option><option value="equal">{t('À parts égales')}</option></select></Field>
      </div>
      {!!staff.length && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">{t('Exclure :')}</span>
          {staff.map(s => <button key={s.id} onClick={() => setExcl(x => x.includes(s.id) ? x.filter(y => y !== s.id) : [...x, s.id])} className={`rounded-full px-3 py-1 font-semibold ${excl.includes(s.id) ? 'bg-danger/15 text-danger line-through' : 'bg-surface-2'}`}>{s.name}</button>)}
        </div>
      )}
      {pv && (
        <div className="mt-5">
          <p className="mb-2 flex items-baseline justify-between"><span className="text-muted">{t('Total des pourboires')}</span><b className="font-display text-3xl text-brand tabular">{mad(Number(pv.total_cents))}</b></p>
          {!pv.lines.length ? <p className="text-sm text-muted">{t('Personne n’a pointé sur cette période.')}</p> : (
            <ul className="divide-y divide-line/10 rounded-2xl bg-surface-2 px-4">
              {pv.lines.map(l => <li key={l.staff_id} className="flex justify-between py-2.5"><span className="font-semibold">{l.name} <span className="font-normal text-muted">· {hrs(Number(l.hours))}</span></span><b className="tabular">{mad(Number(l.amount_cents))}</b></li>)}
            </ul>
          )}
          {pv.overlap && <p className="mt-3 text-sm font-semibold text-warn">{t('Une partie de cette période a déjà été partagée.')}</p>}
          <div className="mt-4 flex justify-end"><Btn tone="brand" disabled={busy || pv.overlap || !pv.lines.length || !Number(pv.total_cents)} onClick={save}>{t('Enregistrer le partage')}</Btn></div>
        </div>
      )}
    </Card>
    {!!hist.length && (
      <Card>
        <h2 className="mb-3 font-display text-xl font-semibold">{t('Partages enregistrés')}</h2>
        <ul className="divide-y divide-line/10 text-sm">
          {hist.map(h => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="font-semibold">{dayLabel(h.period_from, { day: 'numeric', month: 'short' })} – {dayLabel(h.period_to, { day: 'numeric', month: 'short' })}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{h.lines.map(l => `${l.name} ${mad(Number(l.amount_cents))}`).join(' · ')}</span>
              <b className="tabular">{mad(Number(h.total_cents))}</b>
              {a.canEditProfile && <Btn tone="ghost" className="px-2 py-1" aria-label={t('Supprimer')} onClick={() => cancel(h.id)}><Trash2 className="h-4 w-4" /></Btn>}
            </li>
          ))}
        </ul>
      </Card>
    )}
  </>;
}
