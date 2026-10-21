import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Crown, Pencil, Phone, Star, UserRound } from 'lucide-react';
import { usePos } from '../store';
import * as db from '../lib/data';
import { mad } from '../lib/format';
import { t } from '../lib/i18n';
import { Btn, Field, Modal, inputCls } from './ui';
import { hasMaitre } from '../lib/occasion';

// The guest profile: what the team knows about a regular (allergies, VIP, preferences, what they
// like), shown where it matters: the bill, the floor plan, the reservations. Only when the restaurant
// keeps a customer file (loyalty.customers).

export interface Guest {
  id: string; name: string | null; phone: string; visits: number; spent_cents: number | string;
  last_visit_at: string | null; birthday: string | null; tags: string[]; allergies: string | null; note: string | null;
}
export interface GuestFull extends Guest {
  favorites: { name: string; qty: number }[];
  recent: { at: string; total_cents: number | string; table: string | null }[];
  bookings: { seated: number; no_shows: number; cancelled: number };
}

/** the tags offered in one tap; the team can type others */
export const GUEST_TAGS = ['VIP', 'Habitué', 'Végétarien', 'Sans alcool', 'Presse', 'Anniversaire'];
export const isVip = (g?: Pick<Guest, 'tags'> | null) => !!g?.tags?.some(x => x.toLowerCase() === 'vip');

const norm = (p: string) => {
  const d = p.replace(/\D/g, '');
  if (/^00212\d{9}$/.test(d)) return '0' + d.slice(5);
  if (/^212\d{9}$/.test(d)) return '0' + d.slice(3);
  if (/^[5-7]\d{8}$/.test(d)) return '0' + d;
  return d;
};

// one small cache for the whole till: the floor plan and the reservations ask for the same guests
const cache = new Map<string, { g: Guest | null; at: number }>();
let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach(f => f()); };
/** after a change: everyone asks again */
export function forgetGuest(g?: Guest | null) {
  if (g) { cache.delete(`id:${g.id}`); cache.delete(`ph:${g.phone}`); } else cache.clear();
  bump();
}
function remember(g: Guest) {
  const at = Date.now();
  cache.set(`id:${g.id}`, { g, at }); cache.set(`ph:${g.phone}`, { g, at });
}

/** The guests of these orders (customer ids) and these phones, from the cache, fetched when missing. */
export function useGuests(ids: (string | null | undefined)[], phones: (string | null | undefined)[]) {
  const pos = usePos();
  const r = pos.restaurant;
  const on = !!r?.loyalty?.customers && hasMaitre(r);
  const [, setV] = useState(version);
  useEffect(() => { const f = () => setV(version); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  const idKey = [...new Set(ids.filter((x): x is string => !!x))].sort().join(',');
  const phKey = [...new Set(phones.filter((x): x is string => !!x).map(norm))].sort().join(',');
  useEffect(() => {
    if (!on || !r || !pos.online) return;
    const fresh = (k: string) => { const c = cache.get(k); return c && Date.now() - c.at < 120_000; };
    const needIds = idKey ? idKey.split(',').filter(x => !fresh(`id:${x}`)) : [];
    const needPh = phKey ? phKey.split(',').filter(x => !fresh(`ph:${x}`)) : [];
    if (!needIds.length && !needPh.length) return;
    let gone = false;
    db.rpc<Guest[]>('pos_guests', { p_restaurant_id: r.id, p_ids: needIds.slice(0, 200), p_phones: needPh.slice(0, 200) }).then(list => {
      if (gone) return;
      const at = Date.now();
      // not in the file: remembered as "nobody", so the till does not ask every second
      needIds.forEach(x => cache.set(`id:${x}`, { g: null, at }));
      needPh.forEach(x => cache.set(`ph:${x}`, { g: null, at }));
      list.forEach(remember);
      bump();
    }).catch(() => { /* the profile is a bonus: nothing shows */ });
    return () => { gone = true; };
  }, [on, r, pos.online, idKey, phKey]);
  return useMemo(() => ({
    on,
    byId: (id?: string | null) => (id ? cache.get(`id:${id}`)?.g ?? null : null),
    byPhone: (p?: string | null) => (p ? cache.get(`ph:${norm(p)}`)?.g ?? null : null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [on, version]);
}

/** The few words a waiter must see at once: allergies in red, VIP, the visits, the other tags. */
export function GuestChips({ g, compact, className = '' }: { g: Guest | null | undefined; compact?: boolean; className?: string }) {
  if (!g) return null;
  const others = g.tags.filter(x => x.toLowerCase() !== 'vip');
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {g.allergies && (
        <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white" title={g.allergies}>
          <AlertTriangle className="h-3 w-3 shrink-0" /><span className="truncate">{compact ? t('Allergie') : g.allergies}</span>
        </span>
      )}
      {isVip(g) && <span className="inline-flex items-center gap-1 rounded-full bg-brand/20 px-2 py-0.5 text-xs font-bold text-brand"><Crown className="h-3 w-3" />VIP</span>}
      {!compact && others.map(x => <span key={x} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{x}</span>)}
      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
        {g.visits > 0 ? t('{n}e visite', { n: g.visits + 1 }) : t('Première visite')}
      </span>
    </span>
  );
}

const day = (iso: string, tz?: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' });

/** The full profile, and its form. By customer id, or by phone (a booking): a new guest is added on save. */
export function GuestSheet({ customerId, phone, name, onClose, onSaved }: {
  customerId?: string | null; phone?: string | null; name?: string | null; onClose: () => void; onSaved?: (g: GuestFull) => void;
}) {
  const pos = usePos();
  const r = pos.restaurant!;
  const [g, setG] = useState<GuestFull | null | undefined>(undefined);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: '', allergies: '', note: '', tags: [] as string[], birthday: '', more: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pos.requireOnline()) { onClose(); return; }
    db.rpc<GuestFull | null>('pos_guest', { p_restaurant_id: r.id, p_customer_id: customerId ?? null, p_phone: customerId ? null : phone ?? null })
      .then(x => {
        setG(x);
        setF({ name: x?.name ?? name ?? '', allergies: x?.allergies ?? '', note: x?.note ?? '', tags: x?.tags ?? [], birthday: x?.birthday ?? '', more: '' });
        if (!x) setEdit(true);
      }, e => { pos.fail(e); onClose(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (x: string) => setF(s => ({ ...s, tags: s.tags.includes(x) ? s.tags.filter(y => y !== x) : [...s.tags, x].slice(0, 8) }));
  const save = async () => {
    if (!pos.requireOnline()) return;
    setBusy(true);
    try {
      const tags = f.more.trim() ? [...f.tags, f.more.trim().slice(0, 20)] : f.tags;
      const x = await db.rpc<GuestFull>('pos_guest_save', {
        p_restaurant_id: r.id, p_customer_id: g?.id ?? null, p_phone: g ? null : phone ?? null, p_name: f.name.trim() || null,
        p_note: f.note, p_allergies: f.allergies, p_tags: tags, p_birthday: f.birthday || null,
      });
      forgetGuest(x); remember(x); bump();
      // the open orders of the guest now carry the allergies: the next kitchen bon prints them
      void pos.reloadOrders();
      setG(x); setEdit(false); setF(s => ({ ...s, tags: x.tags, more: '' }));
      pos.toast(t('Fiche client enregistrée'), 'ok');
      onSaved?.(x);
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };

  const title = g?.name || name || t('Client');
  return (
    <Modal wide title={<span className="flex items-center gap-2"><UserRound className="h-5 w-5 text-brand" />{title}</span>} onClose={onClose}
      footer={edit ? (
        <div className="flex justify-end gap-2">
          {g && <Btn onClick={() => setEdit(false)}>{t('Annuler')}</Btn>}
          <Btn tone="brand" disabled={busy} onClick={save}>{t('Enregistrer')}</Btn>
        </div>
      ) : (
        <div className="flex justify-end"><Btn onClick={() => setEdit(true)}><Pencil className="h-4 w-4" /> {t('Compléter la fiche')}</Btn></div>
      )}>
      {g === undefined ? <p className="text-muted">{t('Chargement…')}</p> : edit ? (
        <div className="space-y-4">
          {!g && <p className="text-sm text-muted">{t('Pas encore de fiche pour ce numéro : elle est créée à l’enregistrement.')}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Nom')}><input className={inputCls} maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
            <Field label={t('Anniversaire (facultatif)')}><input type="date" className={inputCls} value={f.birthday} onChange={e => setF({ ...f, birthday: e.target.value })} /></Field>
          </div>
          <Field label={t('Allergies et intolérances')}>
            <input className={`${inputCls} ${f.allergies.trim() ? 'border-danger/60' : ''}`} maxLength={200} value={f.allergies} placeholder={t('Ex. : noix, gluten, fruits de mer')}
              onChange={e => setF({ ...f, allergies: e.target.value })} />
          </Field>
          <p className="-mt-2 text-xs text-muted">{t('Imprimé sur chaque bon cuisine de ce client.')}</p>
          <Field label={t('Préférences')}>
            <textarea className={`${inputCls} min-h-[72px]`} maxLength={300} value={f.note} placeholder={t('Ex. : table près de la fenêtre, eau pétillante, café après le dessert')}
              onChange={e => setF({ ...f, note: e.target.value })} />
          </Field>
          <div>
            <p className="mb-2 text-sm font-semibold text-muted">{t('Étiquettes')}</p>
            <div className="flex flex-wrap gap-2">
              {[...new Set([...GUEST_TAGS, ...f.tags])].map(x => (
                <button key={x} onClick={() => toggle(x)}
                  className={`rounded-full px-3 py-1.5 text-sm font-bold ${f.tags.includes(x) ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`}>{x}</button>
              ))}
              {f.tags.length < 8 && <input className={`${inputCls} w-36 py-1.5`} maxLength={20} placeholder={t('Autre…')} value={f.more} onChange={e => setF({ ...f, more: e.target.value })} />}
            </div>
          </div>
        </div>
      ) : g && (
        <div className="space-y-5">
          {g.allergies && (
            <div className="flex items-start gap-3 rounded-2xl bg-danger/15 p-4 text-danger">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div><p className="text-xs font-bold uppercase tracking-wide">{t('Allergies')}</p><p className="text-lg font-bold">{g.allergies}</p></div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {isVip(g) && <span className="inline-flex items-center gap-1 rounded-full gold-fill px-3 py-1 text-sm font-bold text-brand-ink"><Crown className="h-4 w-4" />VIP</span>}
            {g.tags.filter(x => x.toLowerCase() !== 'vip').map(x => <span key={x} className="rounded-full bg-surface-2 px-3 py-1 text-sm font-semibold">{x}</span>)}
            <a href={`tel:${g.phone}`} className="ms-auto inline-flex items-center gap-1 text-sm text-muted" dir="ltr"><Phone className="h-3.5 w-3.5" />{g.phone}</a>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t('Visites')} value={String(g.visits)} />
            <Stat label={t('Dépensé')} value={mad(Number(g.spent_cents))} />
            <Stat label={t('Dernière visite')} value={g.last_visit_at ? day(g.last_visit_at, r.timezone) : '–'} />
            <Stat label={t('Pas venu')} value={String(g.bookings?.no_shows ?? 0)} warn={(g.bookings?.no_shows ?? 0) > 0} />
          </div>
          {g.note && <div className="rounded-2xl bg-surface-2 p-4"><p className="mb-1 text-xs font-bold text-muted">{t('Préférences')}</p><p>{g.note}</p></div>}
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><Star className="h-4 w-4 text-brand" />{t('Ses plats préférés')}</p>
              {g.favorites.length ? (
                <ul className="space-y-1 text-sm">{g.favorites.map(x => <li key={x.name} className="flex justify-between gap-2"><span className="truncate">{x.name}</span><span className="text-muted tabular">×{x.qty}</span></li>)}</ul>
              ) : <p className="text-sm text-muted">{t('Rien encore.')}</p>}
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><CalendarClock className="h-4 w-4 text-brand" />{t('Dernières visites')}</p>
              {g.recent.length ? (
                <ul className="space-y-1 text-sm">{g.recent.map(x => (
                  <li key={x.at} className="flex justify-between gap-2"><span>{day(x.at, r.timezone)}{x.table ? <span className="text-muted"> · {t('table {n}', { n: x.table })}</span> : null}</span><span className="tabular">{mad(Number(x.total_cents))}</span></li>
                ))}</ul>
              ) : <p className="text-sm text-muted">{t('Rien encore.')}</p>}
            </div>
          </div>
          {g.birthday && <p className="text-sm text-muted">{t('Anniversaire : {d}', { d: new Date(`${g.birthday}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) })}</p>}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-2.5">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`font-display text-lg font-semibold tabular ${warn ? 'text-danger' : ''}`}>{value}</p>
    </div>
  );
}
