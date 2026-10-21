// Formules (Amplify Maître): the ftour of Ramadan, group menus, events. A fixed menu per guest, at a
// fixed time, on chosen days, with covers per day, a deposit and choices per guest. Guests book them
// from the booking link; the host stand sees them in the till, the kitchen gets its list in the briefing.
import { useEffect, useState } from 'react';
import { Moon, Pencil, Plus, Users, PartyPopper, UtensilsCrossed } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Modal, Toggle, inputCls } from './ui';

type Kind = 'ftour' | 'group' | 'event';
interface Offer {
  id: string; kind: Kind; name: string; description: string | null; price_cents: number; deposit_cents: number | null;
  options: string[]; min_party: number; max_party: number; starts_on: string | null; ends_on: string | null; weekdays: number[];
  at_time: string; covers: number | null; online: boolean; active: boolean; sort_order: number;
}
const KINDS: { id: Kind; label: () => string; Icon: typeof Moon }[] = [
  { id: 'ftour', label: () => t('Ftour'), Icon: Moon },
  { id: 'group', label: () => t('Menu de groupe'), Icon: Users },
  { id: 'event', label: () => t('Soirée spéciale'), Icon: PartyPopper },
];
// Monday first, as on a Moroccan calendar; the numbers are those of the database (0 = Sunday)
const DAYS: [number, string][] = [[1, 'Lun'], [2, 'Mar'], [3, 'Mer'], [4, 'Jeu'], [5, 'Ven'], [6, 'Sam'], [0, 'Dim']];
const mad = (c: number | null | undefined) => `${(Number(c ?? 0) / 100).toLocaleString('fr-FR')} MAD`;
const toC = (s: string) => Math.round((Number(s.replace(',', '.')) || 0) * 100);

export function OffersCard({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [list, setList] = useState<Offer[] | null>(null);
  const [edit, setEdit] = useState<Offer | 'new' | null>(null);
  const load = async () => {
    try { setList(check(await supabase.from('booking_offers').select('*').eq('restaurant_id', r.id).order('sort_order').order('created_at')) as Offer[]); }
    catch (e) { a.fail(e); setList([]); }
  };
  useEffect(() => { load(); }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h2 className="me-auto font-display text-xl font-semibold">{t('Formules : ftour, groupes, soirées')}</h2>
        {a.canEditProfile && <Btn tone="brand" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> {t('Nouvelle formule')}</Btn>}
      </div>
      <p className="mb-4 text-sm text-muted">{t('Un menu fixe par personne, à une heure fixe, les jours choisis, avec un nombre de couverts par jour. Vos clients la réservent depuis votre lien ; la cuisine reçoit sa liste dans le briefing du soir.')}</p>
      {list === null ? <p className="text-muted">{t('Chargement…')}</p> : !list.length ? (
        <p className="rounded-2xl bg-surface-2 p-5 text-sm text-muted">{t('Aucune formule. Pour le Ramadan : créez votre ftour (prix par personne, heure du ftour, couverts par soir).')}</p>
      ) : (
        <ul className="divide-y divide-line/10">
          {list.map(o => {
            const K = KINDS.find(k => k.id === o.kind)!;
            return (
              <li key={o.id} className={`flex flex-wrap items-center gap-3 py-3 ${o.active ? '' : 'opacity-50'}`}>
                <K.Icon className="h-5 w-5 text-brand" />
                <div className="min-w-[200px] flex-1">
                  <p className="font-semibold">{o.name} <span className="text-sm font-normal text-muted">· {mad(o.price_cents)} / {t('pers.')}</span></p>
                  <p className="text-sm text-muted">
                    {t('à {h}', { h: o.at_time.slice(0, 5) })}
                    {o.starts_on || o.ends_on ? ` · ${o.starts_on ?? '…'} → ${o.ends_on ?? '…'}` : ''}
                    {o.covers ? ` · ${t('{n} couverts par jour', { n: o.covers })}` : ''}
                    {o.deposit_cents ? ` · ${t('acompte {m} / pers.', { m: mad(o.deposit_cents) })}` : ''}
                    {o.options.length ? ` · ${o.options.join(', ')}` : ''}
                    {!o.online ? ` · ${t('pas en ligne')}` : ''}
                  </p>
                </div>
                {a.canEditProfile && <Btn className="px-3 py-1.5 text-sm" onClick={() => setEdit(o)}><Pencil className="h-4 w-4" /> {t('Modifier')}</Btn>}
              </li>
            );
          })}
        </ul>
      )}
      {edit && <OfferEditor r={r} o={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </Card>
  );
}

function OfferEditor({ r, o, onClose, onSaved }: { r: Restaurant; o: Offer | null; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [f, setF] = useState(() => ({
    kind: (o?.kind ?? 'ftour') as Kind, name: o?.name ?? '', description: o?.description ?? '',
    price: o ? String(o.price_cents / 100) : '', deposit: o?.deposit_cents ? String(o.deposit_cents / 100) : '',
    options: (o?.options ?? []).join(', '), min: String(o?.min_party ?? 1), max: String(o?.max_party ?? 20),
    from: o?.starts_on ?? '', to: o?.ends_on ?? '', days: o?.weekdays ?? [], time: o?.at_time.slice(0, 5) ?? '18:30',
    covers: o?.covers ? String(o.covers) : '', online: o?.online ?? true, active: o?.active ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const row = {
        restaurant_id: r.id, kind: f.kind, name: f.name.trim(), description: f.description.trim() || null,
        price_cents: toC(f.price), deposit_cents: toC(f.deposit) > 0 ? toC(f.deposit) : null,
        options: [...new Set(f.options.split(',').map(x => x.trim().slice(0, 30)).filter(Boolean))].slice(0, 6),
        min_party: Math.max(1, Number(f.min) || 1), max_party: Math.max(Number(f.min) || 1, Number(f.max) || 20),
        starts_on: f.from || null, ends_on: f.to || null, weekdays: f.days, at_time: f.time || '19:00',
        covers: Number(f.covers) > 0 ? Number(f.covers) : null, online: f.online, active: f.active,
      };
      if (o) check(await supabase.from('booking_offers').update(row).eq('id', o.id).select('id'));
      else check(await supabase.from('booking_offers').insert(row).select('id'));
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const day = (n: number) => setF(s => ({ ...s, days: s.days.includes(n) ? s.days.filter(x => x !== n) : [...s.days, n] }));
  return (
    <Modal wide title={o ? o.name : t('Nouvelle formule')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !f.name.trim()} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {KINDS.map(k => (
            <button key={k.id} type="button" onClick={() => setF({ ...f, kind: k.id, ...(k.id === 'ftour' && !o ? { time: '18:30' } : {}) })}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold ${f.kind === k.id ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted'}`}><k.Icon className="h-4 w-4" />{k.label()}</button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Nom')}><input className={inputCls} maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={f.kind === 'ftour' ? t('Ftour royal') : t('Menu groupe')} /></Field>
          <Field label={t('Heure')} hint={f.kind === 'ftour' ? t('L’heure du ftour (maghrib) : changez-la au fil du mois.') : undefined}><input type="time" className={inputCls} value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /></Field>
        </div>
        <Field label={t('Ce qui est servi')}><textarea className={`${inputCls} min-h-[72px]`} maxLength={300} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder={t('Harira, dattes, chebakia, msemen, jus frais, tajine au choix, thé')} /></Field>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label={t('Prix par personne (MAD)')}><input className={inputCls} inputMode="decimal" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></Field>
          <Field label={t('Acompte par personne (MAD)')}><input className={inputCls} inputMode="decimal" value={f.deposit} onChange={e => setF({ ...f, deposit: e.target.value })} placeholder={t('Aucun')} /></Field>
          <Field label={t('Personnes min.')}><input className={inputCls} inputMode="numeric" value={f.min} onChange={e => setF({ ...f, min: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label={t('Personnes max.')}><input className={inputCls} inputMode="numeric" value={f.max} onChange={e => setF({ ...f, max: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <Field label={t('Choix par personne (facultatif)')} hint={t('Séparés par des virgules, 6 au plus. La cuisine voit combien de chaque.')}>
          <input className={inputCls} value={f.options} onChange={e => setF({ ...f, options: e.target.value })} placeholder={t('Classique, Végétarien, Enfant')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('Du')}><input type="date" className={inputCls} value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
          <Field label={t('Au')}><input type="date" className={inputCls} value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
          <Field label={t('Couverts par jour')}><input className={inputCls} inputMode="numeric" value={f.covers} onChange={e => setF({ ...f, covers: e.target.value.replace(/\D/g, '') })} placeholder={t('Sans limite')} /></Field>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold text-muted">{t('Jours (aucun choisi : tous les jours)')}</p>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(([n, l]) => <button key={n} type="button" onClick={() => day(n)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${f.days.includes(n) ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted'}`}>{t(l)}</button>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-6">
          <Toggle checked={f.online} onChange={v => setF({ ...f, online: v })} label={t('Réservable en ligne')} />
          <Toggle checked={f.active} onChange={v => setF({ ...f, active: v })} label={t('Active')} />
        </div>
        <p className="flex items-center gap-2 text-xs text-muted"><UtensilsCrossed className="h-3.5 w-3.5" />{t('Le soir même, la caisse ouvre l’addition avec la formule, une ligne par choix.')}</p>
      </div>
    </Modal>
  );
}
