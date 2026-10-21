// Amplify Agenda: who takes appointments, when, for which prestations; days off and closed days.
import { useCallback, useEffect, useState } from 'react';
import { CalendarOff, Copy, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Modal, Toggle, inputCls } from '../components/ui';
import { DAYS } from '../components/HoursEditor';
import { t } from '../lib/i18n';
import { svcName, type AgService } from './AgendaServicesPage';

type Week = Record<string, [string, string][]>;
interface Member { id: string; name: string; role: 'staff' | 'manager'; active: boolean; agenda: boolean; agenda_hours: Week; agenda_services: string[]; agenda_color: string | null; agenda_sort: number }
interface Off { id: string; staff_id: string | null; starts_at: string; ends_at: string; reason: string | null }

// i18n:values
const DAY: Record<string, string> = { mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi', fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche' };
// i18n:end
const COLORS = ['#E07A5F', '#3D8BFD', '#2BB673', '#A66CFF', '#F2A33A', '#E85D9E', '#14B8A6', '#8D6E63'];
const DEFAULT_WEEK: Week = { tue: [['09:30', '13:00'], ['14:00', '19:30']], wed: [['09:30', '13:00'], ['14:00', '19:30']], thu: [['09:30', '13:00'], ['14:00', '19:30']], fri: [['09:30', '12:30'], ['15:00', '20:00']], sat: [['09:30', '20:00']], sun: [['10:00', '18:00']] };
const hoursText = (w: Week) => DAYS.filter(d => (w[d] ?? []).length).map(d => `${t(DAY[d]).slice(0, 3)} ${(w[d] ?? []).map(([a, b]) => `${a}-${b}`).join(', ')}`).join(' · ');

export function AgendaTeamPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [team, setTeam] = useState<Member[] | null>(null);
  const [services, setServices] = useState<AgService[]>([]);
  const [offs, setOffs] = useState<Off[]>([]);
  const [edit, setEdit] = useState<Member | 'new' | null>(null);
  const [addOff, setAddOff] = useState(false);
  const load = useCallback(async () => {
    try {
      const [m, s, o] = await Promise.all([
        supabase.from('staff').select('id,name,role,active,agenda,agenda_hours,agenda_services,agenda_color,agenda_sort').eq('restaurant_id', r.id).order('agenda_sort').order('name'),
        supabase.from('agenda_services').select('*').eq('restaurant_id', r.id).eq('active', true).order('sort_order'),
        supabase.from('agenda_time_off').select('*').eq('restaurant_id', r.id).gte('ends_at', new Date().toISOString()).order('starts_at'),
      ]);
      setTeam(check(m) as Member[]); setServices(check(s) as AgService[]); setOffs(check(o) as Off[]);
    } catch (e) { a.fail(e); setTeam([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  const nameOf = (id: string | null) => (id ? team?.find(m => m.id === id)?.name ?? '?' : t('Tout le salon'));
  const fmt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: r.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const removeOff = async (o: Off) => { try { check(await supabase.from('agenda_time_off').delete().eq('id', o.id).select('id')); load(); } catch (e) { a.fail(e); } };
  const takes = (team ?? []).filter(m => m.agenda && m.active);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold">{t('Équipe et horaires')}</h1>
        <Btn tone="brand" onClick={() => setEdit('new')}><UserPlus className="h-4 w-4" /> {t('Ajouter une personne')}</Btn>
      </div>
      <p className="text-sm text-muted">{t('Les clients réservent chez une personne précise, ou « peu importe ». Chaque personne a ses horaires et ses prestations.')}</p>
      {team === null ? <p className="text-muted">{t('Chargement…')}</p> : (
        <ul className="card divide-y divide-line/10 overflow-hidden rounded-3xl">
          {team.filter(m => m.active).map(m => (
            <li key={m.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${m.agenda ? '' : 'opacity-60'}`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-bold text-white" style={{ background: m.agenda_color || '#94A3B8' }}>{m.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-[200px] flex-1">
                <p className="font-semibold">{m.name}</p>
                <p className="text-sm text-muted">{m.agenda ? (hoursText(m.agenda_hours) || t('Aucun horaire')) : t('Ne prend pas de rendez-vous')}</p>
                {m.agenda && <p className="text-xs text-muted">{m.agenda_services.length ? m.agenda_services.map(id => services.find(s => s.id === id)).filter(Boolean).map(s => svcName(s!)).join(', ') : t('Toutes les prestations')}</p>}
              </div>
              <Btn onClick={() => setEdit(m)} aria-label={t('Modifier {name}', { name: m.name })}><Pencil className="h-4 w-4" /></Btn>
            </li>
          ))}
          {!team.filter(m => m.active).length && <li className="px-4 py-10 text-center text-muted">{t('Ajoutez les personnes qui prennent des rendez-vous.')}</li>}
        </ul>
      )}
      {team && !takes.length && team.length > 0 && <p className="text-sm font-semibold text-warn">{t('Personne ne prend encore de rendez-vous : ouvrez une fiche et activez « Prend des rendez-vous ».')}</p>}

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="me-auto flex items-center gap-2 font-display text-xl font-semibold"><CalendarOff className="h-5 w-5 text-brand" />{t('Congés et fermetures')}</h2>
          <Btn onClick={() => setAddOff(true)}><Plus className="h-4 w-4" /> {t('Ajouter')}</Btn>
        </div>
        {!offs.length ? <p className="text-sm text-muted">{t('Aucun congé prévu. Ajoutez ici les jours de repos exceptionnels, les vacances, les jours de fête.')}</p> : (
          <ul className="divide-y divide-line/10">
            {offs.map(o => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-[140px] font-semibold">{nameOf(o.staff_id)}</span>
                <span className="flex-1 text-sm text-muted">{fmt(o.starts_at)} → {fmt(o.ends_at)}{o.reason ? ` · ${o.reason}` : ''}</span>
                <Btn tone="danger" className="px-2.5 py-1.5" aria-label={t('Supprimer')} onClick={() => removeOff(o)}><Trash2 className="h-4 w-4" /></Btn>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <MemberEditor r={r} m={edit === 'new' ? null : edit} services={services} n={team?.length ?? 0} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {addOff && <OffEditor r={r} team={takes} onClose={() => setAddOff(false)} onSaved={() => { setAddOff(false); load(); }} />}
    </div>
  );
}

function MemberEditor({ r, m, services, n, onClose, onSaved }: { r: Restaurant; m: Member | null; services: AgService[]; n: number; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [name, setName] = useState(m?.name ?? '');
  const [agenda, setAgenda] = useState(m ? m.agenda : true);
  const [week, setWeek] = useState<Week>(() => (m && Object.keys(m.agenda_hours).length ? m.agenda_hours : DEFAULT_WEEK));
  const [svc, setSvc] = useState<string[]>(m?.agenda_services ?? []);
  const [color, setColor] = useState(m?.agenda_color ?? COLORS[n % COLORS.length]);
  const [busy, setBusy] = useState(false);
  const set = (d: string, i: number, k: 0 | 1, v: string) => setWeek(w => ({ ...w, [d]: (w[d] ?? []).map((x, j) => (j === i ? (k ? [x[0], v] : [v, x[1]]) as [string, string] : x)) }));
  const copy = (d: string) => setWeek(w => Object.fromEntries(DAYS.map(x => [x, (w[x] ?? []).length || x === d ? (w[d] ?? []).map(y => [...y] as [string, string]) : []])));
  const valid = DAYS.every(d => (week[d] ?? []).every(([s, e]) => /^\d\d:\d\d$/.test(s) && /^\d\d:\d\d$/.test(e) && s < e));
  const save = async () => {
    setBusy(true);
    try {
      const clean = Object.fromEntries(DAYS.map(d => [d, week[d] ?? []]).filter(([, v]) => (v as unknown[]).length));
      const row = { name: name.trim(), agenda, agenda_hours: clean, agenda_services: svc, agenda_color: color };
      if (m) check(await supabase.from('staff').update(row).eq('id', m.id).select('id'));
      else check(await supabase.from('staff').insert({ ...row, restaurant_id: r.id, role: 'staff', agenda_sort: n }).select('id'));
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal wide title={m ? m.name : t('Nouvelle personne')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !name.trim() || !valid} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label={t('Prénom')}><input className={inputCls} maxLength={40} value={name} onChange={e => setName(e.target.value)} /></Field>
          <div className="flex gap-1.5 pb-1">{COLORS.map(c => <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className={`h-8 w-8 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-ink' : ''}`} style={{ background: c }} />)}</div>
        </div>
        <Toggle checked={agenda} onChange={setAgenda} label={t('Prend des rendez-vous')} />
        {agenda && <>
          <div>
            <p className="mb-2 text-sm font-semibold text-muted">{t('Horaires de travail')}</p>
            <ul className="divide-y divide-line/10 rounded-2xl border border-line/10 px-3">
              {DAYS.map(d => (
                <li key={d} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="w-24 font-semibold">{t(DAY[d])}</span>
                  {!(week[d] ?? []).length && <span className="text-sm text-muted">{t('Repos')}</span>}
                  {(week[d] ?? []).map(([s, e], i) => (
                    <span key={i} className="flex items-center gap-1">
                      <input type="time" aria-label={t('Début')} className={`${inputCls} w-28 py-1.5`} value={s} onChange={x => set(d, i, 0, x.target.value)} />
                      <span className="text-muted">-</span>
                      <input type="time" aria-label={t('Fin')} className={`${inputCls} w-28 py-1.5`} value={e} onChange={x => set(d, i, 1, x.target.value)} />
                      <button type="button" aria-label={t('Supprimer')} onClick={() => setWeek(w => ({ ...w, [d]: (w[d] ?? []).filter((_, j) => j !== i) }))} className="rounded-lg p-1.5 text-muted hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                    </span>
                  ))}
                  <span className="ms-auto flex gap-1">
                    {(week[d] ?? []).length < 3 && <button type="button" onClick={() => setWeek(w => ({ ...w, [d]: [...(w[d] ?? []), (w[d] ?? []).length ? ['14:00', '19:00'] : ['09:30', '19:00']] }))} className="rounded-lg px-2 py-1 text-xs font-bold text-brand hover:bg-brand/10"><Plus className="inline h-3.5 w-3.5" /> {t('Plage')}</button>}
                    {(week[d] ?? []).length > 0 && <button type="button" onClick={() => copy(d)} title={t('Copier sur les autres jours travaillés')} className="rounded-lg px-2 py-1 text-xs font-bold text-muted hover:bg-surface-2"><Copy className="inline h-3.5 w-3.5" /></button>}
                  </span>
                </li>
              ))}
            </ul>
            {!valid && <p className="mt-2 text-sm text-danger">{t('Une plage doit finir après son début, le même jour.')}</p>}
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-muted">{t('Prestations (aucune cochée : toutes)')}</p>
            <div className="flex flex-wrap gap-1.5">
              {services.map(s => (
                <button key={s.id} type="button" onClick={() => setSvc(x => (x.includes(s.id) ? x.filter(y => y !== s.id) : [...x, s.id]))}
                  className={`rounded-full px-3 py-1.5 text-sm font-bold ${svc.includes(s.id) ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted'}`}>{svcName(s)}</button>
              ))}
              {!services.length && <p className="text-sm text-muted">{t('Créez d’abord vos prestations.')}</p>}
            </div>
          </div>
        </>}
      </div>
    </Modal>
  );
}

function OffEditor({ r, team, onClose, onSaved }: { r: Restaurant; team: Member[]; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: r.timezone }).format(new Date());
  const [f, setF] = useState({ who: '', from: today, fromT: '00:00', to: today, toT: '23:59', reason: '' });
  const [busy, setBusy] = useState(false);
  // the typed day and time are the salon's local time
  const iso = (d: string, h: string) => {
    const guess = new Date(`${d}T${h}:00Z`);
    const local = new Date(guess.toLocaleString('en-US', { timeZone: r.timezone }));
    const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
    return new Date(guess.getTime() - (local.getTime() - utc.getTime())).toISOString();
  };
  const ok = `${f.to}T${f.toT}` > `${f.from}T${f.fromT}`;
  const save = async () => {
    setBusy(true);
    try {
      check(await supabase.from('agenda_time_off').insert({ restaurant_id: r.id, staff_id: f.who || null, starts_at: iso(f.from, f.fromT), ends_at: iso(f.to, f.toT), reason: f.reason.trim() || null }).select('id'));
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={t('Congé ou fermeture')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !ok} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <Field label={t('Qui')}>
          <select className={inputCls} value={f.who} onChange={e => setF({ ...f, who: e.target.value })}>
            <option value="">{t('Tout le salon (fermé)')}</option>
            {team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Du')}><input type="date" className={inputCls} value={f.from} onChange={e => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} /></Field>
          <Field label={t('à')}><input type="time" className={inputCls} value={f.fromT} onChange={e => setF({ ...f, fromT: e.target.value })} /></Field>
          <Field label={t('Au')}><input type="date" className={inputCls} value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
          <Field label={t('à')}><input type="time" className={inputCls} value={f.toT} onChange={e => setF({ ...f, toT: e.target.value })} /></Field>
        </div>
        <Field label={t('Motif (facultatif)')}><input className={inputCls} maxLength={80} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} placeholder={t('Congé, Aïd, formation…')} /></Field>
      </div>
    </Modal>
  );
}
