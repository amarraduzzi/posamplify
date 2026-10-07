// Promotions: happy hours (a percentage off dishes at set hours), promo codes, and menus by time
// (breakfast in the morning, a Ftour menu at sunset during Ramadan). Applied by the database.
import { useCallback, useEffect, useState } from 'react';
import { Clock, Moon, Pencil, Percent, Plus, Tag, Ticket, Trash2 } from 'lucide-react';
import { tr } from '@resto/shared';
import { supabase } from '../lib/supabase';
import { check, fromCents, mad, rpc, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Category, Item, Restaurant } from '../lib/types';
import { Btn, Card, Field, Modal, Toggle, inputCls } from '../components/ui';

interface Promo {
  id: string; kind: 'happy_hour' | 'code'; name: string; active: boolean; discount_type: 'percent' | 'amount'; value: number;
  category_ids: string[]; item_ids: string[]; days: number[]; start_time: string | null; end_time: string | null; starts_on: string | null; ends_on: string | null;
  code: string | null; min_order_cents: number; max_uses: number | null; once_per_phone: boolean; channels: string[];
}
interface Report { id: string; name: string; kind: string; orders: number; given_cents: number; revenue_cents: number }
type Cat = Category & { schedule: { days?: number[]; from?: string; to?: string; start_on?: string; end_on?: string } | null };
// i18n:values
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
// i18n:end
const hm = (x: string | null) => (x ? x.slice(0, 5) : '');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDays = (ds: number[]) => (ds.length === 7 ? t('tous les jours') : ds.map(d => t(DAYS[d - 1])).join(', '));
const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });

export function PromotionsPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const lang = r.languages[0] ?? 'fr';
  const [list, setList] = useState<Promo[] | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [rep, setRep] = useState<Report[]>([]);
  const [edit, setEdit] = useState<Promo | 'happy_hour' | 'code' | null>(null);
  const [sched, setSched] = useState<Cat | null>(null);
  const load = useCallback(async () => {
    try {
      const to = ymd(new Date()), from = ymd(new Date(Date.now() - 29 * 86400_000));
      const [p, c, i, x] = await Promise.all([
        supabase.from('promotions').select('*').eq('restaurant_id', r.id).order('created_at'),
        supabase.from('categories').select('*').eq('restaurant_id', r.id).eq('active', true).order('sort_order'),
        supabase.from('menu_items').select('id,name,category_id,price_cents').eq('restaurant_id', r.id).eq('active', true).order('sort_order'),
        rpc<Report[]>('promo_report', { p_restaurant_id: r.id, p_from: from, p_to: to }),
      ]);
      setList(check(p) as Promo[]); setCats(check(c) as Cat[]); setItems(check(i) as Item[]); setRep(x);
    } catch (e) { a.fail(e); setList([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  const toggle = async (p: Promo) => { try { check(await supabase.from('promotions').update({ active: !p.active }).eq('id', p.id).select('id')); load(); } catch (e) { a.fail(e); } };
  const target = (p: Promo) => !p.category_ids.length && !p.item_ids.length ? t('toute la carte')
    : [...p.category_ids.map(id => cats.find(c => c.id === id)).filter(Boolean).map(c => tr(c!.name, lang)), ...p.item_ids.map(id => items.find(i => i.id === id)).filter(Boolean).map(i => tr(i!.name, lang))].join(', ');
  const when = (p: Promo) => [fmtDays(p.days), p.start_time && p.end_time ? `${hm(p.start_time)}–${hm(p.end_time)}` : '', p.starts_on || p.ends_on ? `${p.starts_on ? fmtDate(p.starts_on) : '…'} → ${p.ends_on ? fmtDate(p.ends_on) : '…'}` : ''].filter(Boolean).join(' · ');
  const hhs = (list ?? []).filter(p => p.kind === 'happy_hour'), codes = (list ?? []).filter(p => p.kind === 'code');
  const stat = (id: string) => rep.find(x => x.id === id);

  const Row = ({ p }: { p: Promo }) => {
    const s = stat(p.id);
    return (
      <li className={`flex flex-wrap items-center gap-3 py-3 ${p.active ? '' : 'opacity-50'}`}>
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl font-display text-sm font-bold ${p.kind === 'code' ? 'bg-qr/10 text-qr' : 'bg-brand/10 text-brand'}`}>
          {p.discount_type === 'percent' ? `-${p.value / 100}%` : `-${p.value / 100}`}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{p.name}{p.code && <span className="ms-2 rounded-lg bg-surface-2 px-2 py-0.5 font-mono text-xs">{p.code}</span>}</p>
          <p className="text-sm text-muted">{p.kind === 'happy_hour' ? `${target(p)} · ${when(p)}` : [p.min_order_cents ? t('dès {m}', { m: mad(p.min_order_cents) }) : '', p.max_uses ? t('{n} utilisations max.', { n: p.max_uses }) : '', p.once_per_phone ? t('1 fois par client') : '', p.channels.length === 2 ? t('caisse et en ligne') : p.channels[0] === 'online' ? t('en ligne') : t('caisse'), when(p) !== t('tous les jours') ? when(p) : ''].filter(Boolean).join(' · ')}</p>
        </div>
        {s && s.orders > 0 && <span className="text-end text-xs text-muted">{t('{n} commandes', { n: s.orders })}<br />{t('{m} offerts', { m: mad(Number(s.given_cents)) })}</span>}
        <Toggle checked={p.active} onChange={() => toggle(p)} />
        <Btn className="px-2.5 py-1.5" aria-label={t('Modifier')} onClick={() => setEdit(p)}><Pencil className="h-4 w-4" /></Btn>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand">Amplify POS</p>
        <h1 className="font-display text-3xl font-semibold">{t('Promotions')}</h1>
        <p className="text-muted">{t('Happy hours, codes promo et menus selon l’heure. Appliqués tout seuls, à la caisse comme en ligne, et visibles sur le ticket.')}</p>
      </div>

      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="me-auto flex items-center gap-2 font-display text-xl font-semibold"><Clock className="h-5 w-5 text-brand" />{t('Happy hours')}</h2>
          <Btn tone="brand" onClick={() => setEdit('happy_hour')}><Plus className="h-4 w-4" /> {t('Happy hour')}</Btn>
        </div>
        <p className="mb-2 text-sm text-muted">{t('Remplissez les heures creuses : par exemple -30 % sur les boissons de 15 h à 18 h en semaine.')}</p>
        {list === null ? <p className="text-muted">{t('Chargement…')}</p> : !hhs.length ? <p className="py-4 text-sm text-muted">{t('Aucune happy hour.')}</p> : <ul className="divide-y divide-line/10">{hhs.map(p => <Row key={p.id} p={p} />)}</ul>}
      </Card>

      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="me-auto flex items-center gap-2 font-display text-xl font-semibold"><Ticket className="h-5 w-5 text-brand" />{t('Codes promo')}</h2>
          <Btn tone="brand" onClick={() => setEdit('code')}><Plus className="h-4 w-4" /> {t('Code promo')}</Btn>
        </div>
        <p className="mb-2 text-sm text-muted">{t('À envoyer sur WhatsApp, sur Instagram ou à donner lors d’une dégustation. Le client le tape en commandant en ligne, ou le donne à la caisse.')}</p>
        {list === null ? null : !codes.length ? <p className="py-4 text-sm text-muted">{t('Aucun code.')}</p> : <ul className="divide-y divide-line/10">{codes.map(p => <Row key={p.id} p={p} />)}</ul>}
      </Card>

      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Moon className="h-5 w-5 text-brand" />{t('Menus selon l’heure et Ramadan')}</h2>
        <p className="mb-3 text-sm text-muted">{t('Une catégorie peut n’apparaître qu’à certaines heures ou certains jours : le petit-déjeuner le matin, un menu Ftour au coucher du soleil pendant le Ramadan. En dehors, elle est cachée en ligne et ne peut pas être commandée.')}</p>
        <ul className="divide-y divide-line/10">
          {cats.map(c => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 font-semibold">{c.icon} {tr(c.name, lang)}</span>
              <span className="text-sm text-muted">{c.schedule && Object.keys(c.schedule).length
                ? [c.schedule.days ? fmtDays(c.schedule.days) : '', c.schedule.from && c.schedule.to ? `${c.schedule.from}–${c.schedule.to}` : '', c.schedule.start_on || c.schedule.end_on ? `${c.schedule.start_on ? fmtDate(c.schedule.start_on) : '…'} → ${c.schedule.end_on ? fmtDate(c.schedule.end_on) : '…'}` : ''].filter(Boolean).join(' · ')
                : t('toujours')}</span>
              <Btn className="px-3 py-1.5 text-sm" onClick={() => setSched(c)}><Clock className="h-4 w-4" /> {t('Horaire')}</Btn>
            </li>
          ))}
        </ul>
      </Card>

      {edit && <PromoEditor r={r} p={typeof edit === 'string' ? null : edit} kind={typeof edit === 'string' ? edit : edit.kind} cats={cats} items={items} lang={lang}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {sched && <ScheduleEditor c={sched} lang={lang} onClose={() => setSched(null)} onSaved={() => { setSched(null); load(); }} />}
    </div>
  );
}

function DayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DAYS.map((d, i) => { const on = value.includes(i + 1); return (
        <button key={d} type="button" onClick={() => onChange(on ? value.filter(x => x !== i + 1) : [...value, i + 1].sort())}
          className={`rounded-full px-3 py-1.5 text-sm font-semibold ${on ? 'bg-night text-white' : 'bg-surface-2 text-muted'}`}>{t(d)}</button>
      ); })}
    </div>
  );
}

function PromoEditor({ r, p, kind, cats, items, lang, onClose, onSaved }: { r: Restaurant; p: Promo | null; kind: 'happy_hour' | 'code'; cats: Cat[]; items: Item[]; lang: string; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [f, setF] = useState({
    name: p?.name ?? (kind === 'code' ? '' : t('Happy hour')), type: p?.discount_type ?? 'percent',
    value: p ? (p.discount_type === 'percent' ? String(p.value / 100) : fromCents(p.value)) : kind === 'code' ? '10' : '20',
    cats: p?.category_ids ?? [], items: p?.item_ids ?? [], days: p?.days ?? [1, 2, 3, 4, 5, 6, 7],
    from: hm(p?.start_time ?? (kind === 'happy_hour' ? '15:00' : null)), to: hm(p?.end_time ?? (kind === 'happy_hour' ? '18:00' : null)),
    d1: p?.starts_on ?? '', d2: p?.ends_on ?? '', code: p?.code ?? '', min: p?.min_order_cents ? fromCents(p.min_order_cents) : '',
    max: p?.max_uses ? String(p.max_uses) : '', once: p?.once_per_phone ?? false, pos: p ? p.channels.includes('pos') : true, online: p ? p.channels.includes('online') : true,
  });
  const [busy, setBusy] = useState(false);
  const pct = Number(f.value.replace(',', '.'));
  const ok = f.name.trim() && pct > 0 && (f.type !== 'percent' || pct <= 100) && f.days.length && (kind === 'happy_hour' || /^[A-Za-z0-9_-]{3,20}$/.test(f.code)) && (kind === 'happy_hour' || f.pos || f.online);
  const save = async () => {
    setBusy(true);
    try {
      const row = {
        kind, name: f.name.trim(), discount_type: kind === 'happy_hour' ? 'percent' : f.type,
        value: f.type === 'percent' || kind === 'happy_hour' ? Math.round(pct * 100) : toCents(f.value),
        category_ids: kind === 'happy_hour' ? f.cats : [], item_ids: kind === 'happy_hour' ? f.items : [], days: f.days,
        start_time: f.from || null, end_time: f.to || null, starts_on: f.d1 || null, ends_on: f.d2 || null,
        code: kind === 'code' ? f.code.trim().toUpperCase() : null, min_order_cents: kind === 'code' && f.min.trim() ? toCents(f.min) : 0,
        max_uses: kind === 'code' && f.max.trim() ? Number(f.max) : null, once_per_phone: kind === 'code' && f.once,
        channels: kind === 'code' ? [...(f.pos ? ['pos'] : []), ...(f.online ? ['online'] : [])] : ['pos', 'online'],
      };
      if (p) check(await supabase.from('promotions').update(row).eq('id', p.id).select('id'));
      else check(await supabase.from('promotions').insert({ ...row, restaurant_id: r.id }).select('id'));
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(/promotions_code_idx/.test(String((e as Error).message)) ? new Error(t('Ce code existe déjà.')) : e); }
    setBusy(false);
  };
  const remove = async () => { if (!p) return; try { check(await supabase.from('promotions').delete().eq('id', p.id).select('id')); onSaved(); } catch (e) { a.fail(e); } };
  const toggleIn = (k: 'cats' | 'items', id: string) => setF(x => ({ ...x, [k]: x[k].includes(id) ? x[k].filter(y => y !== id) : [...x[k], id] }));
  return (
    <Modal wide title={kind === 'code' ? (p ? p.name : t('Nouveau code promo')) : (p ? p.name : t('Nouvelle happy hour'))} onClose={onClose}
      footer={<div className="flex justify-between">{p ? <Btn tone="danger" onClick={remove}><Trash2 className="h-4 w-4" /> {t('Supprimer')}</Btn> : <span />}<Btn tone="brand" disabled={busy || !ok} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <Field label={t('Nom')}><input autoFocus className={inputCls} maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={kind === 'code' ? t('Bienvenue, Dégustation Agdal…') : ''} /></Field>
          {kind === 'code' && <Field label={t('Code')} hint={t('3 à 20 lettres ou chiffres, sans espace.')}><input className={`${inputCls} font-mono uppercase`} maxLength={20} value={f.code} onChange={e => setF({ ...f, code: e.target.value.replace(/[^A-Za-z0-9_-]/g, '').toUpperCase() })} placeholder="BIENVENUE10" /></Field>}
          <div className="flex items-end gap-2">
            {kind === 'code' && (
              <div className="flex rounded-xl bg-surface-2 p-1">
                {(['percent', 'amount'] as const).map(k => <button key={k} type="button" onClick={() => setF({ ...f, type: k })} className={`rounded-lg px-3 py-2 text-sm font-semibold ${f.type === k ? 'bg-night text-white' : 'text-muted'}`}>{k === 'percent' ? <Percent className="h-4 w-4" /> : 'DH'}</button>)}
              </div>
            )}
            <Field label={f.type === 'percent' || kind === 'happy_hour' ? t('Réduction (%)') : t('Réduction (DH)')}><input className={`${inputCls} w-32`} inputMode="decimal" value={f.value} onChange={e => setF({ ...f, value: e.target.value })} /></Field>
          </div>
          {kind === 'code' && <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Commande minimum (DH)')}><input className={inputCls} inputMode="decimal" value={f.min} onChange={e => setF({ ...f, min: e.target.value })} placeholder="0" /></Field>
              <Field label={t('Utilisations max.')}><input className={inputCls} inputMode="numeric" value={f.max} onChange={e => setF({ ...f, max: e.target.value.replace(/\D/g, '') })} placeholder={t('illimité')} /></Field>
            </div>
            <Toggle checked={f.once} onChange={v => setF({ ...f, once: v })} label={t('Une seule fois par numéro de téléphone')} />
            <div className="flex flex-wrap gap-5">
              <Toggle checked={f.pos} onChange={v => setF({ ...f, pos: v })} label={t('À la caisse')} />
              <Toggle checked={f.online} onChange={v => setF({ ...f, online: v })} label={t('En ligne')} />
            </div>
          </>}
          <Field group label={t('Jours')}><DayPicker value={f.days} onChange={v => setF({ ...f, days: v })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('De')}><input type="time" className={inputCls} value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
            <Field label={t('À')}><input type="time" className={inputCls} value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
            <Field label={t('Du (facultatif)')}><input type="date" className={inputCls} value={f.d1} onChange={e => setF({ ...f, d1: e.target.value })} /></Field>
            <Field label={t('Au (facultatif)')}><input type="date" className={inputCls} value={f.d2} onChange={e => setF({ ...f, d2: e.target.value })} /></Field>
          </div>
        </div>
        {kind === 'happy_hour' && (
          <Field group label={t('Sur quoi ? (rien coché = toute la carte)')}>
            <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-2xl bg-surface-2 p-3">
              {cats.map(c => (
                <div key={c.id}>
                  <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={f.cats.includes(c.id)} onChange={() => toggleIn('cats', c.id)} /> {c.icon} {tr(c.name, lang)}</label>
                  {!f.cats.includes(c.id) && (
                    <div className="mt-1 grid gap-1 ps-6 sm:grid-cols-2">
                      {items.filter(i => i.category_id === c.id).map(i => <label key={i.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.items.includes(i.id)} onChange={() => toggleIn('items', i.id)} /> {tr(i.name, lang)}</label>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Field>
        )}
        {kind === 'code' && (
          <div className="rounded-2xl bg-surface-2 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold"><Tag className="h-4 w-4 text-brand" />{t('Comment l’utiliser')}</p>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-muted">
              <li>{t('En ligne : le client tape le code dans son panier.')}</li>
              <li>{t('À la caisse : bouton « Code promo » sur la commande.')}</li>
              <li>{t('Un code remplace une remise manuelle, il ne s’ajoute pas à la récompense fidélité.')}</li>
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ScheduleEditor({ c, lang, onClose, onSaved }: { c: Cat; lang: string; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const s = c.schedule ?? {};
  const [days, setDays] = useState<number[]>(s.days ?? [1, 2, 3, 4, 5, 6, 7]);
  const [from, setFrom] = useState(s.from ?? ''); const [to, setTo] = useState(s.to ?? '');
  const [d1, setD1] = useState(s.start_on ?? ''); const [d2, setD2] = useState(s.end_on ?? '');
  const save = async (clear = false) => {
    const schedule = clear ? null : Object.fromEntries(Object.entries({ days: days.length === 7 ? undefined : days, from: from || undefined, to: to || undefined, start_on: d1 || undefined, end_on: d2 || undefined }).filter(([, v]) => v !== undefined));
    try { check(await supabase.from('categories').update({ schedule: schedule && Object.keys(schedule).length ? schedule : null }).eq('id', c.id).select('id')); a.toast(t('Enregistré')); onSaved(); } catch (e) { a.fail(e); }
  };
  return (
    <Modal title={`${t('Horaire')} · ${tr(c.name, lang)}`} onClose={onClose}
      footer={<div className="flex justify-between"><Btn tone="ghost" onClick={() => save(true)}>{t('Toujours visible')}</Btn><Btn tone="brand" onClick={() => save()}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Btn className="px-3 py-1.5 text-sm" onClick={() => { setFrom('07:00'); setTo('11:30'); }}>{t('Petit-déjeuner 7 h – 11 h 30')}</Btn>
          <Btn className="px-3 py-1.5 text-sm" onClick={() => { setFrom('18:30'); setTo('21:00'); }}><Moon className="h-4 w-4" /> {t('Ftour 18 h 30 – 21 h')}</Btn>
          <Btn className="px-3 py-1.5 text-sm" onClick={() => { setFrom('21:00'); setTo('03:30'); }}>{t('Shour 21 h – 3 h 30')}</Btn>
        </div>
        <Field group label={t('Jours')}><DayPicker value={days} onChange={setDays} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('De')}><input type="time" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label={t('À')}><input type="time" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></Field>
          <Field label={t('Du (facultatif)')}><input type="date" className={inputCls} value={d1} onChange={e => setD1(e.target.value)} /></Field>
          <Field label={t('Au (facultatif)')}><input type="date" className={inputCls} value={d2} onChange={e => setD2(e.target.value)} /></Field>
        </div>
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{t('Ramadan : créez une catégorie Ftour, mettez les dates du mois (à confirmer selon l’observation de la lune) et l’heure du ftour. Elle disparaît toute seule après la date de fin.')}</p>
      </div>
    </Modal>
  );
}
