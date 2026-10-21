// La Nouba for the salon: one card per person working with the client in the chair and one big
// "Suivant" button, the queue with the estimate, a walk-in in two taps, the links and the settings.
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { BellRing, Copy, Download, ExternalLink, Footprints, Home, Plus, Save, SkipForward, UserX, X } from 'lucide-react';
import { waLink } from '../lib/whatsapp';
import { supabase, MENU_URL } from '../lib/supabase';
import { check } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Modal, Toggle, inputCls } from '../components/ui';
import { svcName, type AgService } from './AgendaServicesPage';

interface Entry {
  id: string; status: 'waiting' | 'serving'; name: string; phone: string | null; service_id: string | null; staff_id: string | null;
  served_by: string | null; remote: boolean; coming: boolean; created_at: string; started_at: string | null; start: string | null;
  token: string; notified: boolean;
}
interface Board { open: boolean; working: number; queue: Entry[] }
interface Person { id: string; name: string; agenda_color: string | null; agenda: boolean; active: boolean }
const HEX = /^#[0-9a-f]{6}$/i;
const mins = (iso: string | null) => (iso ? Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000)) : null);
const since = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);

export function NoubaPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const g = r.agenda ?? {};
  const [board, setBoard] = useState<Board | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [services, setServices] = useState<AgService[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('nouba_board', { p_restaurant_id: r.id });
      if (error) throw error;
      setBoard(data as Board);
    } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => {
    load();
    supabase.from('staff').select('id, name, agenda_color, agenda, active').eq('restaurant_id', r.id).then(x => setPeople((x.data ?? []) as Person[]));
    supabase.from('agenda_services').select('*').eq('restaurant_id', r.id).eq('active', true).order('sort_order').then(x => setServices((x.data ?? []) as AgService[]));
    const id = window.setInterval(load, 10000);
    return () => window.clearInterval(id);
  }, [load, r.id]);

  const act = async (key: string, fn: () => PromiseLike<{ error: unknown }>) => {
    setBusy(key);
    try { const { error } = await fn(); if (error) throw error; await load(); } catch (e) { a.fail(e); }
    setBusy(null);
  };
  const next = async (staff: string) => {
    setBusy(staff);
    try {
      const { data, error } = await supabase.rpc('nouba_next', { p_restaurant_id: r.id, p_staff: staff, p_entry: null });
      if (error) throw error;
      if (!(data as { next: unknown }).next) a.toast(t('Personne en attente pour {name}.', { name: person(staff)?.name ?? '' }));
      await load();
    } catch (e) { a.fail(e); }
    setBusy(null);
  };
  // "Prévenir": WhatsApp to the client whose turn is near, with the link to their place
  const tell = async (q: Entry) => {
    const m = mins(q.start);
    const text = t('Bonjour {name}, c’est bientôt votre tour chez {salon} (environ {n} min). Merci de venir maintenant. Votre place : {link}',
      { name: q.name, salon: r.name, n: m ?? 0, link: `${MENU_URL}/${r.slug}?nouba=${q.token}` });
    window.open(waLink(q.phone!, text), '_blank', 'noopener');
    await act(q.id, () => supabase.rpc('nouba_notified', { p_restaurant_id: r.id, p_entry: q.id }));
  };
  const setStatus = (id: string, status: string) => act(id, () => supabase.rpc('nouba_set', { p_restaurant_id: r.id, p_entry: id, p_status: status }));

  const svc = (id: string | null) => { const s = services.find(x => x.id === id); return s ? svcName(s) : ''; };
  const person = (id: string | null) => people.find(p => p.id === id);
  const queue = board?.queue ?? [];
  const waiting = queue.filter(q => q.status === 'waiting');
  // the people who take clients: working now first (they have a client or the plan uses them)
  const team = people.filter(p => p.active && p.agenda);

  if (!g.queue) return (
    <div className="space-y-5">
      <h1 className="font-display text-3xl font-semibold">{t('La Nouba')}</h1>
      <Card>
        <p className="font-semibold">{t('La file d’attente en direct pour les clients sans rendez-vous.')}</p>
        <p className="mt-1 text-sm text-muted">{t('Vos clients voient de chez eux combien de temps il faut attendre, prennent leur place à distance ou avec le QR à l’entrée. Vous appuyez sur « Suivant » quand un fauteuil se libère.')}</p>
        {a.canEditProfile && <Btn tone="brand" className="mt-4" onClick={() => setSettings(true)}>{t('Activer la Nouba')}</Btn>}
      </Card>
      {settings && <NoubaSettings r={r} onClose={() => setSettings(false)} />}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="me-auto font-display text-3xl font-semibold">{t('La Nouba')}</h1>
        <Btn tone="brand" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> {t('Client sans rendez-vous')}</Btn>
        <Btn onClick={() => setSettings(true)}>{t('Liens et réglages')}</Btn>
      </div>
      {board && !board.open && <p className="rounded-2xl bg-amber-500/10 p-4 text-sm">{t('Personne ne travaille en ce moment selon les horaires : la file est fermée pour les clients.')}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {team.map(p => {
          const chair = queue.find(q => q.status === 'serving' && q.served_by === p.id);
          const color = p.agenda_color && HEX.test(p.agenda_color) ? p.agenda_color : '#64748b';
          return (
            <Card key={p.id}>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full font-semibold text-white" style={{ background: color }}>{p.name.slice(0, 1)}</span>
                <p className="me-auto font-display text-xl font-semibold">{p.name}</p>
              </div>
              <div className="mt-4 min-h-[3.5rem] rounded-2xl bg-surface-2 px-4 py-3">
                {chair ? <>
                  <p className="font-semibold">{chair.name}</p>
                  <p className="text-sm text-muted">{[svc(chair.service_id), t('depuis {n} min', { n: since(chair.started_at) })].filter(Boolean).join(' · ')}</p>
                </> : <p className="text-sm text-muted">{t('Fauteuil libre')}</p>}
              </div>
              <button disabled={busy === p.id} onClick={() => next(p.id)}
                className="mt-4 flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-lg font-bold text-brand-ink transition active:scale-[.98] disabled:opacity-50">
                <SkipForward className="h-5 w-5" />{t('Suivant')}
              </button>
              {chair && <button onClick={() => setStatus(chair.id, 'done')} className="mt-2 w-full text-sm font-semibold text-muted">{t('Terminer sans prendre le suivant')}</button>}
            </Card>
          );
        })}
      </div>

      <Card>
        <h2 className="mb-3 font-display text-xl font-semibold">{t('En attente')} <span className="text-muted">({waiting.length})</span></h2>
        {!waiting.length ? <p className="rounded-2xl bg-surface-2 p-5 text-sm text-muted">{t('Personne n’attend.')}</p> : (
          <ol className="divide-y divide-line/10">
            {waiting.map((q, i) => {
              const m = mins(q.start); const want = person(q.staff_id);
              return (
                <li key={q.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 font-bold tabular">{i + 1}</span>
                  <div className="min-w-[160px] flex-1">
                    <p className="flex items-center gap-2 font-semibold">{q.name}
                      {q.remote && <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-bold text-sky-600"><Home className="h-3 w-3" />{q.coming ? t('arrive') : t('à distance')}</span>}
                    </p>
                    <p className="text-sm text-muted">{[svc(q.service_id), want ? t('avec {name}', { name: want.name }) : '', q.phone].filter(Boolean).join(' · ')}</p>
                  </div>
                  <p className="text-sm font-semibold tabular">{m == null ? '–' : m === 0 ? t('maintenant') : `≈ ${m} min`}</p>
                  <div className="flex gap-1">
                    {q.phone && <Btn className={`px-2.5 ${!q.notified && (mins(q.start) ?? 99) <= 20 ? 'bg-brand text-brand-ink' : ''}`} title={t('Prévenir sur WhatsApp')} onClick={() => tell(q)}>
                      <BellRing className="h-4 w-4" />{q.notified ? <span className="text-xs">✓</span> : null}</Btn>}
                    {team.length > 1 && team.map(p => (
                      <button key={p.id} title={t('Prendre avec {name}', { name: p.name })} onClick={() => act(q.id, () => supabase.rpc('nouba_next', { p_restaurant_id: r.id, p_staff: p.id, p_entry: q.id }))}
                        className="grid h-9 w-9 place-items-center rounded-full text-xs font-bold text-white" style={{ background: p.agenda_color && HEX.test(p.agenda_color) ? p.agenda_color : '#64748b' }}>{p.name.slice(0, 1)}</button>
                    ))}
                    <Btn className="px-2.5" title={t('Pas venu')} onClick={() => setStatus(q.id, 'no_show')}><UserX className="h-4 w-4" /></Btn>
                    <Btn className="px-2.5" title={t('Retirer')} onClick={() => setStatus(q.id, 'left')}><X className="h-4 w-4" /></Btn>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      {adding && <AddWalkIn r={r} services={services} team={team} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
      {settings && <NoubaSettings r={r} onClose={() => setSettings(false)} />}
    </div>
  );
}

function AddWalkIn({ r, services, team, onClose, onDone }: { r: Restaurant; services: AgService[]; team: Person[]; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [svc, setSvc] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chip = (on: boolean) => `rounded-xl px-3 py-2 text-sm font-semibold ${on ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted'}`;
  const save = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('nouba_add', { p_restaurant_id: r.id, p_entry: { name, phone, service_id: svc, staff_id: who } });
      if (error) throw error;
      a.toast(t('Ajouté à la file')); onDone();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={t('Client sans rendez-vous')} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy} onClick={save}><Footprints className="h-4 w-4" /> {t('Ajouter à la file')}</Btn></div>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Prénom (facultatif)')}><input className={inputCls} value={name} maxLength={60} onChange={e => setName(e.target.value)} autoFocus /></Field>
          <Field label={t('Téléphone (facultatif)')}><input className={inputCls} value={phone} inputMode="tel" dir="ltr" onChange={e => setPhone(e.target.value)} /></Field>
        </div>
        {!!services.length && <div className="flex flex-wrap gap-1.5">{services.map(s => <button key={s.id} type="button" className={chip(svc === s.id)} onClick={() => setSvc(svc === s.id ? null : s.id)}>{svcName(s)}</button>)}</div>}
        {team.length > 1 && <div className="flex flex-wrap gap-1.5">
          <button type="button" className={chip(who === null)} onClick={() => setWho(null)}>{t('Le premier libre')}</button>
          {team.map(p => <button key={p.id} type="button" className={chip(who === p.id)} onClick={() => setWho(p.id)}>{p.name}</button>)}
        </div>}
      </div>
    </Modal>
  );
}

function NoubaSettings({ r, onClose }: { r: Restaurant; onClose: () => void }) {
  const a = useAdminCtx();
  const g = r.agenda ?? {};
  const [f, setF] = useState({ queue: g.queue ?? true, remote: g.queue_remote ?? true, max: String(g.queue_remote_max ?? 5), def: String(g.queue_default_min ?? 30) });
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState({ home: '', door: '' });
  const home = `${MENU_URL}/${r.slug}?nouba`, door = `${MENU_URL}/${r.slug}?nouba=ici`;
  useEffect(() => {
    Promise.all([home, door].map(l => QRCode.toDataURL(l, { margin: 1, width: 600, color: { dark: '#001E3E', light: '#FFFFFF' } })))
      .then(([h, d]) => setQr({ home: h, door: d })).catch(() => {});
  }, [home, door]);
  const save = async () => {
    setBusy(true);
    try {
      const agenda = { ...(r.agenda ?? {}), queue: f.queue, queue_remote: f.remote, queue_remote_max: Math.max(0, Math.min(30, Number(f.max) || 0)),
        queue_default_min: Math.max(5, Math.min(180, Number(f.def) || 30)) };
      check(await supabase.from('restaurants').update({ agenda }).eq('id', r.id).select('id'));
      a.toast(t('Enregistré')); await a.reload(); onClose();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  const Link = ({ title, text, link, img, file }: { title: string; text: string; link: string; img: string; file: string }) => (
    <div className="flex items-center gap-4 rounded-2xl bg-surface-2 p-3">
      {img && <img src={img} alt={title} className="h-20 w-20 rounded-xl bg-white p-1" />}
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">{title}</p>
        <p className="text-xs text-muted">{text}</p>
        <div className="flex flex-wrap gap-1.5">
          <Btn className="px-2.5 py-1 text-sm" onClick={() => copy(link)}><Copy className="h-3.5 w-3.5" /> {t('Copier')}</Btn>
          <a href={link} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-xl bg-surface px-2.5 py-1 text-sm font-semibold"><ExternalLink className="h-3.5 w-3.5" /> {t('Voir')}</a>
          {img && <a href={img} download={file} className="inline-flex items-center gap-1 rounded-xl bg-surface px-2.5 py-1 text-sm font-semibold"><Download className="h-3.5 w-3.5" /> QR</a>}
        </div>
      </div>
    </div>
  );
  return (
    <Modal wide title={t('La Nouba : liens et réglages')} onClose={onClose}
      footer={a.canEditProfile ? <div className="flex justify-end"><Btn tone="brand" disabled={busy} onClick={save}><Save className="h-4 w-4" /> {t('Enregistrer')}</Btn></div> : undefined}>
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <Link title={t('Lien « attente en direct »')} text={t('Bio Instagram, Google, WhatsApp : le client voit l’attente et prend sa place de chez lui.')} link={home} img={qr.home} file={`nouba-${r.slug}.png`} />
          <Link title={t('QR à l’entrée')} text={t('Collé à la porte : le client prend sa place en arrivant, sans limite.')} link={door} img={qr.door} file={`nouba-entree-${r.slug}.png`} />
        </div>
        <fieldset disabled={!a.canEditProfile} className="space-y-4">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <Toggle checked={f.queue} onChange={v => setF({ ...f, queue: v })} label={t('La Nouba est active')} />
            <Toggle checked={f.remote} onChange={v => setF({ ...f, remote: v })} label={t('Places à distance')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Places à distance en même temps')} hint={t('Au-delà, le client doit venir au salon. Évite les places prises par des gens qui ne viennent pas.')}>
              <input className={inputCls} inputMode="numeric" value={f.max} onChange={e => setF({ ...f, max: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Field label={t('Durée par client sans prestation (min)')} hint={t('Sert à l’estimation quand le client ne choisit pas de prestation.')}>
              <input className={inputCls} inputMode="numeric" value={f.def} onChange={e => setF({ ...f, def: e.target.value.replace(/\D/g, '') })} />
            </Field>
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
