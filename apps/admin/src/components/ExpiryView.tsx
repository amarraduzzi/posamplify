// Dates: the lots of the ingredients tracked for expiry, soonest first. What expired, what expires soon,
// what is fine, and the stock that has no date yet. A lot can be thrown away (with a reason, valued in dirhams),
// its date corrected, and undated stock can be given a date.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad, rpc } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Ingredient, Restaurant, StockLot } from '../lib/types';
import { SIZE_UNIT, fmtQty } from '../lib/profit';
import { Btn, Field, Modal, inputCls } from './ui';

// i18n:values
const REASON: Record<string, string> = { expired: 'Périmé', damaged: 'Abîmé', returned: 'Rendu au fournisseur', quality: 'Qualité', other: 'Autre' };
// i18n:end
const num = (s: string) => Number(String(s).replace(',', '.').replace(/\s/g, ''));
const shown = (x: number) => String(Math.round(x * 1000) / 1000).replace('.', ',');
const iso = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400000);
const dayText = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
const unitCents = (l: StockLot, g?: Ingredient) => l.unit_cost_cents != null ? Number(l.unit_cost_cents)
  : g?.purchase_price_cents != null && Number(g.purchase_qty) > 0 ? Number(g.purchase_price_cents) / Number(g.purchase_qty) : null;

type Tone = 'bad' | 'warn' | 'ok';
function status(l: StockLot, g: Ingredient | undefined, today: string): { tone: Tone; label: string } {
  const left = daysBetween(today, iso(l.expires_on));
  const warn = g?.expiry_warn_days ?? 2;
  if (left < 0) return { tone: 'bad', label: t('Périmé depuis {n} j', { n: -left }) };
  if (left === 0) return { tone: 'bad', label: t('Aujourd’hui') };
  if (left <= warn) return { tone: 'warn', label: t('Dans {n} j', { n: left }) };
  return { tone: 'ok', label: t('Dans {n} j', { n: left }) };
}
const TONE: Record<Tone, string> = { bad: 'bg-danger/10 text-danger', warn: 'bg-warn/15 text-warn', ok: 'bg-ok/10 text-ok' };

export function ExpiryView({ r, ings, today, onChanged }: { r: Restaurant; ings: Ingredient[]; today: string; onChanged: () => void }) {
  const a = useAdminCtx();
  const [lots, setLots] = useState<StockLot[] | null>(null);
  const [discard, setDiscard] = useState<StockLot | null>(null);
  const [edit, setEdit] = useState<StockLot | null>(null);
  const [rest, setRest] = useState<{ g: Ingredient; qty: number } | null>(null);
  const [auto, setAuto] = useState(!!r.profit_settings?.expiry_auto_discard);
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(ings.map(g => [g.id, g])), [ings]);
  const tracked = useMemo(() => ings.filter(g => g.track_expiry), [ings]);

  const load = useCallback(async () => {
    try {
      setLots(check(await supabase.from('stock_lots').select('*').eq('restaurant_id', r.id).gt('qty_remaining', 0).order('expires_on')) as unknown as StockLot[]);
    } catch (e) { a.fail(e); setLots([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  const done = () => { load(); onChanged(); };
  // everything past its date goes in one go (what expires today stays until tomorrow)
  const sweep = async (n: number, cents: number) => {
    if (!window.confirm(t('Jeter {n} livraison(s) périmée(s){m} ? Le stock est mis à jour.', { n, m: cents > 0 ? ` (${mad(cents)})` : '' }))) return;
    setBusy(true);
    try { const x = await rpc<{ lots: number }>('expiry_sweep', { p_restaurant_id: r.id }); a.toast(t('{n} livraison(s) jetée(s)', { n: x.lots })); done(); }
    catch (e) { a.fail(e); }
    setBusy(false);
  };
  const setAutoDiscard = async (v: boolean) => {
    setAuto(v);
    try { check(await supabase.from('restaurants').update({ profit_settings: { ...(r.profit_settings ?? {}), expiry_auto_discard: v } }).eq('id', r.id).select('id')); a.toast(t('Enregistré')); }
    catch (e) { setAuto(!v); a.fail(e); }
  };

  if (!tracked.length) return (
    <div className="card rounded-3xl p-10 text-center">
      <CalendarDays className="mx-auto h-8 w-8 text-muted" />
      <h2 className="mt-3 font-display text-xl font-semibold">{t('Suivez les dates de péremption')}</h2>
      <p className="mx-auto mt-2 max-w-xl text-muted">{t('Ouvrez un ingrédient (page Ingrédients) et activez « Suivre les dates de péremption ». Ensuite, notez la date à chaque livraison : Amplify vous montre ce qui expire et ce que ça vous coûte.')}</p>
    </div>
  );
  if (!lots) return <p className="text-muted">…</p>;

  const rows = lots.map(l => {
    const g = byId.get(l.ingredient_id);
    const s = status(l, g, today);
    const u = unitCents(l, g);
    return { l, g, s, value: u != null ? Math.round(Number(l.qty_remaining) * u) : null };
  }).filter(x => x.g);
  const sum = (tone: Tone) => rows.filter(x => x.s.tone === tone).reduce((n, x) => n + (x.value ?? 0), 0);
  const count = (tone: Tone) => rows.filter(x => x.s.tone === tone).length;
  const datedBy = new Map<string, number>();
  lots.forEach(l => datedBy.set(l.ingredient_id, (datedBy.get(l.ingredient_id) ?? 0) + Number(l.qty_remaining)));
  const undated = tracked.filter(g => g.stock_qty != null).map(g => ({ g, qty: Number(g.stock_qty) - (datedBy.get(g.id) ?? 0) })).filter(x => x.qty > 0.0005);
  const notStarted = tracked.filter(g => g.stock_qty == null);
  const gone = rows.filter(x => iso(x.l.expires_on) < today);
  const goneCents = gone.reduce((n, x) => n + (x.value ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {([['bad', t('Périmé ou à jeter aujourd’hui')], ['warn', t('Expire bientôt')], ['ok', t('Pas de souci')]] as [Tone, string][]).map(([tone, label]) => (
          <div key={tone} className="card rounded-2xl p-4">
            <p className="text-sm text-muted">{label}</p>
            <p className={`font-display text-3xl font-semibold tabular ${tone === 'ok' ? '' : tone === 'bad' ? 'text-danger' : 'text-warn'}`}>{count(tone)}</p>
            <p className="text-xs text-muted">{t('{n} en stock', { n: mad(sum(tone)) })}</p>
          </div>
        ))}
      </div>

      {(gone.length > 0 || a.canEditProfile) && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3">
          {gone.length > 0 && <Btn tone="brand" disabled={busy} onClick={() => sweep(gone.length, goneCents)}><Trash2 className="h-4 w-4" /> {t('Jeter tout ce qui est périmé ({n})', { n: gone.length })}</Btn>}
          {a.canEditProfile && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={auto} onChange={e => setAutoDiscard(e.target.checked)} />
              {t('Jeter automatiquement ce qui est périmé à la clôture de la journée')}
            </label>
          )}
        </div>
      )}

      <section className="card rounded-3xl p-6">
        <h2 className="mb-4 font-display text-xl font-semibold">{t('Par date, la plus proche d’abord')}</h2>
        {!rows.length ? <p className="text-sm text-muted">{t('Aucune livraison datée en stock. Notez la date de péremption quand vous notez un achat.')}</p> : (
          <ul className="divide-y divide-line/10">
            {rows.map(({ l, g, s, value }) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${TONE[s.tone]}`}>{s.label}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{g!.name} <span className="font-normal text-muted">· {fmtQty(Number(l.qty_remaining), g!.base_unit)}</span></p>
                  <p className="text-xs text-muted">
                    {dayText(iso(l.expires_on))} · {g!.expiry_type === 'ddm' ? t('À consommer de préférence avant') : t('À consommer jusqu’au')}
                    {l.estimated && <span className="ms-2 rounded-full bg-surface-2 px-2 py-0.5 font-semibold">{t('date estimée')}</span>}
                    {l.lot_code && <span className="ms-2">{t('Lot')} {l.lot_code}</span>}
                    {l.supplier && <span className="ms-2">{l.supplier}</span>}
                  </p>
                </div>
                {value != null && <span className="text-sm tabular text-muted">{mad(value)}</span>}
                <Btn aria-label={t('Corriger la date')} onClick={() => setEdit(l)}><Pencil className="h-4 w-4" /></Btn>
                <Btn onClick={() => setDiscard(l)}><Trash2 className="h-4 w-4" /> {t('Jeter')}</Btn>
              </li>
            ))}
          </ul>
        )}
      </section>

      {undated.length > 0 && (
        <section className="card rounded-3xl p-6">
          <h2 className="font-display text-xl font-semibold">{t('Stock sans date')}</h2>
          <p className="mb-3 mt-1 text-sm text-muted">{t('Du stock présent avant le suivi des dates. Il sort en premier. Donnez-lui une date pour qu’il apparaisse ci-dessus.')}</p>
          <ul className="divide-y divide-line/10">
            {undated.map(({ g, qty }) => (
              <li key={g.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 font-semibold">{g.name} <span className="font-normal text-muted">· {fmtQty(qty, g.base_unit)}</span></span>
                <Btn onClick={() => setRest({ g, qty })}><Plus className="h-4 w-4" /> {t('Donner une date')}</Btn>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notStarted.length > 0 && (
        <p className="flex items-start gap-2 rounded-2xl bg-surface-2 p-4 text-sm text-muted"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          {t('Le stock en direct n’est pas démarré pour : {l}. Démarrez-le dans « En direct » pour suivre leurs dates.', { l: notStarted.map(g => g.name).join(', ') })}</p>
      )}

      {discard && <DiscardModal l={discard} g={byId.get(discard.ingredient_id)!} onClose={() => setDiscard(null)} onDone={() => { setDiscard(null); done(); }} />}
      {edit && <DateModal l={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); done(); }} />}
      {rest && <RestModal g={rest.g} qty={rest.qty} today={today} onClose={() => setRest(null)} onDone={() => { setRest(null); done(); }} />}
    </div>
  );
}

function DiscardModal({ l, g, onClose, onDone }: { l: StockLot; g: Ingredient; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const big = SIZE_UNIT[g.base_unit];
  const [val, setVal] = useState(shown(Number(l.qty_remaining) / big.f));
  const [reason, setReason] = useState('expired');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const qty = Math.round(num(val) * big.f * 1000) / 1000;
  const ok = Number.isFinite(qty) && qty > 0 && qty <= Number(l.qty_remaining) + 0.0005;
  const u = unitCents(l, g);
  const save = async () => {
    setBusy(true);
    try {
      await rpc('stock_lot_discard', { p_lot_id: l.id, p_qty: Math.min(qty, Number(l.qty_remaining)), p_reason: reason, p_note: note.trim() || null });
      a.toast(t('Jeté : stock mis à jour')); onDone();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={`${t('Jeter')} · ${g.name}`} onClose={onClose}
      footer={<div className="flex justify-end gap-3"><Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy || !ok} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('Cette livraison : {q}, expire le {d}', { q: fmtQty(Number(l.qty_remaining), g.base_unit), d: dayText(iso(l.expires_on)) })}</p>
        <Field label={t('Quantité jetée ({u})', { u: big.u })}><input autoFocus className={inputCls} inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} /></Field>
        <Field label={t('Raison')}>
          <select className={inputCls} value={reason} onChange={e => setReason(e.target.value)}>
            {Object.entries(REASON).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </Field>
        <Field label={t('Note (facultatif)')}><input className={inputCls} maxLength={200} value={note} onChange={e => setNote(e.target.value)} /></Field>
        {ok && u != null && <p className="rounded-xl bg-surface-2 p-3 text-sm">{t('Perte estimée')} : <b className="tabular">{mad(Math.round(Math.min(qty, Number(l.qty_remaining)) * u))}</b></p>}
      </div>
    </Modal>
  );
}

function DateModal({ l, onClose, onDone }: { l: StockLot; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [date, setDate] = useState(iso(l.expires_on));
  const [code, setCode] = useState(l.lot_code ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await rpc('stock_lot_set_expiry', { p_lot_id: l.id, p_expires_on: date, p_lot_code: code.trim() || null }); a.toast(t('Enregistré')); onDone(); }
    catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={t('Corriger la date')} onClose={onClose}
      footer={<div className="flex justify-end gap-3"><Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy || !date} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Date de péremption')}><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label={t('N° de lot (facultatif)')}><input className={inputCls} maxLength={40} value={code} onChange={e => setCode(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function RestModal({ g, qty: max, today, onClose, onDone }: { g: Ingredient; qty: number; today: string; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const big = SIZE_UNIT[g.base_unit];
  const [val, setVal] = useState(shown(max / big.f));
  const [date, setDate] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const qty = Math.round(num(val) * big.f * 1000) / 1000;
  const ok = Number.isFinite(qty) && qty > 0 && qty <= max + 0.0005 && !!date;
  const save = async () => {
    setBusy(true);
    try { await rpc('stock_lot_from_rest', { p_ingredient_id: g.id, p_qty: Math.min(qty, max), p_expires_on: date, p_lot_code: code.trim() || null }); a.toast(t('Enregistré')); onDone(); }
    catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={`${t('Donner une date')} · ${g.name}`} onClose={onClose}
      footer={<div className="flex justify-end gap-3"><Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy || !ok} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('Stock sans date : {q}', { q: fmtQty(max, g.base_unit) })}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Quantité ({u})', { u: big.u })}><input autoFocus className={inputCls} inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} /></Field>
          <Field label={t('Date de péremption')}><input type="date" className={inputCls} value={date} min={today} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <Field label={t('N° de lot (facultatif)')}><input className={inputCls} maxLength={40} value={code} onChange={e => setCode(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
