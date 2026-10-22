// Amplify Agenda: the prestations of the salon (what a client can book): name in the salon's
// languages, category, duration, the time to prepare after, the price ("à partir de"), online or not.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Globe, Pencil, Plus, Scissors } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, Toggle, inputCls } from '../components/ui';
import { t } from '../lib/i18n';

export interface AgService {
  id: string; name: Record<string, string>; description: Record<string, string>; category: string | null;
  duration_min: number; buffer_min: number; price_cents: number; price_from: boolean; deposit_cents?: number; online: boolean; active: boolean; sort_order: number;
}
export const svcName = (s: Pick<AgService, 'name'>) => s.name.fr || s.name.ar || s.name.en || '';
export const fmtDuration = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`);
const mad = (c: number) => `${(c / 100).toLocaleString('fr-FR')} DH`;
const DURATIONS = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];

export function AgendaServicesPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [list, setList] = useState<AgService[] | null>(null);
  const [edit, setEdit] = useState<AgService | 'new' | null>(null);
  const load = useCallback(async () => {
    try { setList(check(await supabase.from('agenda_services').select('*').eq('restaurant_id', r.id).order('sort_order').order('created_at')) as AgService[]); }
    catch (e) { a.fail(e); setList([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  const cats = useMemo(() => [...new Set((list ?? []).map(s => s.category || ''))], [list]);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold">{t('Prestations')}</h1>
        <Btn tone="brand" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> {t('Nouvelle prestation')}</Btn>
      </div>
      <p className="mb-6 text-sm text-muted">{t('Ce que vos clients peuvent réserver. La durée sert à placer les rendez-vous ; le temps de préparation après la prestation n’est pas montré au client.')}</p>
      {list === null ? <p className="text-muted">{t('Chargement…')}</p> : !list.length ? (
        <div className="card rounded-3xl p-10 text-center">
          <Scissors className="mx-auto h-10 w-10 text-brand/60" />
          <p className="mt-3 font-semibold">{t('Aucune prestation pour le moment.')}</p>
          <p className="mt-1 text-sm text-muted">{t('Commencez par vos prestations les plus demandées : coupe, brushing, couleur, barbe…')}</p>
          <Btn tone="brand" className="mt-4" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> {t('Nouvelle prestation')}</Btn>
        </div>
      ) : cats.map(c => (
        <section key={c} className="mb-6">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-muted">{c || t('Sans catégorie')}</h2>
          <ul className="card divide-y divide-line/10 overflow-hidden rounded-3xl">
            {list.filter(s => (s.category || '') === c).map(s => (
              <li key={s.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${s.active ? '' : 'opacity-50'}`}>
                <div className="min-w-[180px] flex-1">
                  <p className="font-semibold">{svcName(s)}{s.name.ar && s.name.fr ? <span className="ms-3 text-sm font-normal text-muted"><bdi dir="rtl">{s.name.ar}</bdi></span> : null}</p>
                  <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{fmtDuration(s.duration_min)}{s.buffer_min ? ` + ${s.buffer_min} min` : ''}</span>
                    {!s.online && <span>{t('Pas en ligne')}</span>}
                    {!!s.deposit_cents && <span className="font-semibold text-amber-700">{t('Acompte {m}', { m: mad(s.deposit_cents) })}</span>}
                  </p>
                </div>
                <p className="font-semibold tabular">{s.price_from ? `${t('dès')} ` : ''}{mad(s.price_cents)}</p>
                <Btn onClick={() => setEdit(s)} aria-label={t('Modifier {name}', { name: svcName(s) })}><Pencil className="h-4 w-4" /></Btn>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {edit && <ServiceEditor r={r} s={edit === 'new' ? null : edit} cats={cats.filter(Boolean)} next={(list?.length ?? 0) + 1} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function ServiceEditor({ r, s, cats, next, onClose, onSaved }: { r: Restaurant; s: AgService | null; cats: string[]; next: number; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [f, setF] = useState(() => ({
    fr: s?.name.fr ?? '', ar: s?.name.ar ?? '', en: s?.name.en ?? '', desc: s?.description.fr ?? '', category: s?.category ?? '',
    duration: String(s?.duration_min ?? 30), buffer: String(s?.buffer_min ?? 0), price: s ? String(s.price_cents / 100) : '',
    deposit: s?.deposit_cents ? String(s.deposit_cents / 100) : '',
    from: s?.price_from ?? false, online: s?.online ?? true, active: s?.active ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const dep = f.deposit.trim() ? Math.round((Number(f.deposit.replace(',', '.')) || 0) * 100) : 0;
  const ok = !!(f.fr.trim() || f.ar.trim()) && Number(f.duration) >= 5 && (dep === 0 || dep >= 1000);
  const save = async () => {
    setBusy(true);
    try {
      const name = Object.fromEntries(Object.entries({ fr: f.fr, ar: f.ar, en: f.en }).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      const row = {
        restaurant_id: r.id, name, description: f.desc.trim() ? { ...(s?.description ?? {}), fr: f.desc.trim() } : {},
        category: f.category.trim() || null, duration_min: Math.round(Number(f.duration)), buffer_min: Math.max(0, Math.round(Number(f.buffer) || 0)),
        price_cents: Math.round((Number(f.price.replace(',', '.')) || 0) * 100), price_from: f.from, deposit_cents: dep, online: f.online, active: f.active,
        ...(s ? {} : { sort_order: next }),
      };
      if (s) check(await supabase.from('agenda_services').update(row).eq('id', s.id).select('id'));
      else check(await supabase.from('agenda_services').insert(row).select('id'));
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal wide title={s ? svcName(s) : t('Nouvelle prestation')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !ok} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Nom (français)')}><input className={inputCls} maxLength={60} value={f.fr} onChange={e => setF({ ...f, fr: e.target.value })} placeholder={t('Coupe et brushing')} /></Field>
          <Field label={t('Nom (arabe)')}><input className={inputCls} dir="rtl" maxLength={60} value={f.ar} onChange={e => setF({ ...f, ar: e.target.value })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Nom (anglais, facultatif)')}><input className={inputCls} maxLength={60} value={f.en} onChange={e => setF({ ...f, en: e.target.value })} /></Field>
          <Field label={t('Catégorie')}>
            <input className={inputCls} list="ag-cats" maxLength={30} value={f.category} onChange={e => setF({ ...f, category: e.target.value })} placeholder={t('Coupe, Couleur, Barbe, Ongles…')} />
            <datalist id="ag-cats">{cats.map(c => <option key={c} value={c} />)}</datalist>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('Durée')}>
            <select className={inputCls} value={DURATIONS.includes(Number(f.duration)) ? f.duration : 'x'} onChange={e => setF({ ...f, duration: e.target.value === 'x' ? f.duration : e.target.value })}>
              {DURATIONS.map(d => <option key={d} value={d}>{fmtDuration(d)}</option>)}
              {!DURATIONS.includes(Number(f.duration)) && <option value="x">{fmtDuration(Number(f.duration) || 0)}</option>}
            </select>
          </Field>
          <Field label={t('Préparation après (min)')}><input className={inputCls} inputMode="numeric" value={f.buffer} onChange={e => setF({ ...f, buffer: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label={t('Prix (DH)')}><input className={inputCls} inputMode="decimal" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></Field>
        </div>
        <Field label={t('Acompte demandé à la réservation (DH)')} hint={t('Vide : pas d’acompte. Minimum 10 DH. Les règles se règlent dans « Acomptes et no-shows ».')}>
          <input className={`${inputCls} sm:w-48`} inputMode="decimal" value={f.deposit} onChange={e => setF({ ...f, deposit: e.target.value })} placeholder="0" />
        </Field>
        <Field label={t('Description (facultatif)')}><textarea className={`${inputCls} min-h-[70px]`} maxLength={300} value={f.desc} onChange={e => setF({ ...f, desc: e.target.value })} placeholder={t('Shampooing, coupe, brushing. Cheveux longs : supplément.')} /></Field>
        <div className="flex flex-wrap gap-6">
          <Toggle checked={f.from} onChange={v => setF({ ...f, from: v })} label={t('Prix « à partir de »')} />
          <Toggle checked={f.online} onChange={v => setF({ ...f, online: v })} label={t('Réservable en ligne')} />
          <Toggle checked={f.active} onChange={v => setF({ ...f, active: v })} label={t('Active')} />
        </div>
        {!f.online && <p className="flex items-center gap-2 text-xs text-muted"><Globe className="h-3.5 w-3.5" />{t('Hors ligne : seul le salon peut la placer dans l’agenda (par exemple un soin à valider d’abord).')}</p>}
      </div>
    </Modal>
  );
}
