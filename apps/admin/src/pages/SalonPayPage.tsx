// Commissions et paie: per person, the month computed from the real tickets (after discount,
// cancelled tickets left out): prestations and products, the commission by that person's rules,
// the salary, the tips, the advances, bonuses and deductions, and what is left to pay. A month
// marked paid keeps its figures. Owner only.
import { useCallback, useEffect, useState } from 'react';
import { Banknote, CheckCircle2, ChevronLeft, ChevronRight, Plus, Settings2, Trash2, Undo2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, rpc } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Modal, Toggle, inputCls } from '../components/ui';
import { svcName, type AgService } from './AgendaServicesPage';

interface Item { id: string; kind: 'advance' | 'bonus' | 'deduction'; amount_cents: number; note: string | null; at: string }
interface Row {
  staff_id: string; name: string; agenda_color: string | null; has_plan: boolean; clients: number; services_cents: number; products_cents: number;
  service_commission_cents: number; product_commission_cents: number; commission_cents: number; base_cents: number; base_mode: 'plus' | 'max';
  earned_cents: number; tips_cents: number; tips_in_pay: boolean; bonus_cents: number; advance_cents: number; deduction_cents: number; net_cents: number;
  paid_at: string | null; items: Item[];
}
interface Plan {
  base_cents: number; base_mode: 'plus' | 'max'; service_mode: 'flat' | 'tiers' | 'by_service'; service_rate_bp: number;
  tiers: { from_cents: number; rate_bp: number }[]; service_rates: Record<string, number>; product_rate_bp: number; product_basis: 'price' | 'margin'; tips_in_pay: boolean;
}
const mad = (c: number) => `${(Number(c) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DH`;
const pct = (bp: number) => `${(bp / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const num = (s: string) => { const n = Number(s.replace(',', '.').replace(/\s/g, '')); return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null; };
const monthOf = (d: Date, tz: string) => `${d.toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7)}-01`;
const shift = (m: string, n: number) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 10); };
// i18n:values
const KIND: Record<string, string> = { advance: 'Avance', bonus: 'Prime', deduction: 'Retenue' };
// i18n:end

export function SalonPayPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const tz = r.timezone || 'UTC';
  const [month, setMonth] = useState(() => monthOf(new Date(), tz));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [services, setServices] = useState<AgService[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [item, setItem] = useState<Row | null>(null);
  const load = useCallback(async () => {
    try {
      const x = await rpc<{ staff: Row[] }>('agenda_payroll', { p_restaurant_id: r.id, p_month: month });
      setRows(x.staff);
      const p = check(await supabase.from('agenda_pay_plans').select('*').eq('restaurant_id', r.id)) as (Plan & { staff_id: string })[];
      setPlans(Object.fromEntries(p.map(y => [y.staff_id, y])));
    } catch (e) { a.fail(e); setRows([]); }
  }, [r.id, month, a]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { supabase.from('agenda_services').select('*').eq('restaurant_id', r.id).eq('active', true).order('sort_order').then(x => setServices((x.data ?? []) as AgService[])); }, [r.id]);
  const current = monthOf(new Date(), tz);
  const label = new Date(`${month}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const total = (rows ?? []).reduce((s, x) => s + Number(x.net_cents), 0);
  const comm = (rows ?? []).reduce((s, x) => s + Number(x.commission_cents), 0);
  const ca = (rows ?? []).reduce((s, x) => s + Number(x.services_cents) + Number(x.products_cents), 0);
  const setPaid = async (x: Row, paid: boolean) => {
    try { await rpc('agenda_payout_set', { p_restaurant_id: r.id, p_staff: x.staff_id, p_month: month, p_paid: paid }); a.toast(paid ? t('Marqué payé') : t('Mois rouvert')); load(); } catch (e) { a.fail(e); }
  };
  const removeItem = async (i: Item) => { try { check(await supabase.from('agenda_pay_items').delete().eq('id', i.id).select('id')); load(); } catch (e) { a.fail(e); } };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold">{t('Commissions et paie')}</h1>
        <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
          <button className="rounded-lg p-2 hover:bg-surface" onClick={() => setMonth(shift(month, -1))} aria-label={t('Mois précédent')}><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></button>
          <span className="min-w-[9rem] px-2 text-center font-semibold first-letter:uppercase">{label}</span>
          <button className="rounded-lg p-2 hover:bg-surface disabled:opacity-30" disabled={month >= current} onClick={() => setMonth(shift(month, 1))} aria-label={t('Mois suivant')}><ChevronRight className="h-4 w-4 rtl:rotate-180" /></button>
        </div>
      </div>
      <p className="text-sm text-muted">{t('Calculé sur les vrais tickets de la caisse : après remise, sans les tickets annulés, ligne par ligne selon qui a fait la prestation ou vendu le produit.')}</p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="card rounded-3xl p-4"><p className="text-sm text-muted">{t('Chiffre de l’équipe')}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{mad(ca)}</p></div>
        <div className="card rounded-3xl p-4"><p className="text-sm text-muted">{t('Commissions')}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{mad(comm)}</p></div>
        <div className="card col-span-2 rounded-3xl p-4 lg:col-span-1"><p className="text-sm text-muted">{t('Total à payer')}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{mad(total)}</p></div>
      </div>

      {rows === null ? <p className="text-muted">{t('Chargement…')}</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map(x => (
            <Card key={x.staff_id} className={x.paid_at ? 'ring-2 ring-emerald-500/30' : ''}>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-semibold text-white" style={{ background: x.agenda_color || '#64748b' }}>{x.name.slice(0, 1)}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-xl font-semibold">{x.name}</p>
                  <p className="truncate text-xs text-muted">{plans[x.staff_id] ? ruleText(plans[x.staff_id]) : t('Aucune règle de paie')}</p>
                </div>
                {!x.paid_at && <Btn className="px-3" onClick={() => setEdit(x)} title={t('Règles de paie')}><Settings2 className="h-4 w-4" /></Btn>}
              </div>
              <dl className="mt-4 space-y-1.5 text-sm">
                <Line label={t('Prestations ({n} clients)', { n: x.clients })} value={mad(x.services_cents)} muted />
                {Number(x.products_cents) > 0 && <Line label={t('Produits vendus')} value={mad(x.products_cents)} muted />}
                <Line label={t('Commission prestations')} value={mad(x.service_commission_cents)} />
                {Number(x.product_commission_cents) > 0 && <Line label={t('Commission produits')} value={mad(x.product_commission_cents)} />}
                {Number(x.base_cents) > 0 && <Line label={x.base_mode === 'max' ? t('Minimum garanti') : t('Salaire fixe')} value={x.base_mode === 'max' ? (Number(x.base_cents) > Number(x.commission_cents) ? t('{m} (appliqué)', { m: mad(x.base_cents) }) : t('{m} (dépassé)', { m: mad(x.base_cents) })) : mad(x.base_cents)} />}
                {Number(x.tips_cents) > 0 && <Line label={x.tips_in_pay ? t('Pourboires') : t('Pourboires (déjà donnés)')} value={mad(x.tips_cents)} muted={!x.tips_in_pay} />}
                {Number(x.bonus_cents) > 0 && <Line label={t('Primes')} value={`+${mad(x.bonus_cents)}`} />}
                {Number(x.advance_cents) > 0 && <Line label={t('Avances')} value={`-${mad(x.advance_cents)}`} red />}
                {Number(x.deduction_cents) > 0 && <Line label={t('Retenues')} value={`-${mad(x.deduction_cents)}`} red />}
              </dl>
              <div className="mt-3 flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
                <span className="font-semibold">{t('Net à payer')}</span><span className="font-display text-2xl font-semibold tabular">{mad(x.net_cents)}</span>
              </div>
              {x.items.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">{x.items.map(i => (
                  <li key={i.id} className="flex items-center gap-2"><span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">{t(KIND[i.kind])}</span>
                    <span className="flex-1 truncate text-muted">{i.note}</span><span className="tabular">{mad(i.amount_cents)}</span>
                    {!x.paid_at && <button onClick={() => removeItem(i)} className="text-muted hover:text-danger" aria-label={t('Supprimer')}><Trash2 className="h-4 w-4" /></button>}</li>
                ))}</ul>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {x.paid_at ? <>
                  <span className="flex flex-1 items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{t('Payé le {d}', { d: new Date(x.paid_at).toLocaleDateString('fr-FR', { timeZone: tz }) })}</span>
                  <Btn className="px-3" onClick={() => setPaid(x, false)}><Undo2 className="h-4 w-4" /> {t('Rouvrir')}</Btn>
                </> : <>
                  <Btn className="flex-1" onClick={() => setItem(x)}><Plus className="h-4 w-4" /> {t('Avance, prime, retenue')}</Btn>
                  <Btn tone="brand" className="flex-1" disabled={month > current} onClick={() => setPaid(x, true)}><Banknote className="h-4 w-4" /> {t('Marquer payé')}</Btn>
                </>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <PlanEditor r={r} who={edit} plan={plans[edit.staff_id]} services={services} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {item && <ItemEditor r={r} who={item} month={month} onClose={() => setItem(null)} onSaved={() => { setItem(null); load(); }} />}
    </div>
  );
}

function Line({ label, value, muted, red }: { label: string; value: string; muted?: boolean; red?: boolean }) {
  return <div className="flex justify-between gap-3"><dt className={muted ? 'text-muted' : ''}>{label}</dt><dd className={`tabular ${muted ? 'text-muted' : 'font-semibold'} ${red ? 'text-red-600' : ''}`}>{value}</dd></div>;
}

function ruleText(p: Plan) {
  const parts: string[] = [];
  if (p.base_cents) parts.push(p.base_mode === 'max' ? t('minimum {m}', { m: mad(p.base_cents) }) : t('fixe {m}', { m: mad(p.base_cents) }));
  if (p.service_mode === 'flat' && p.service_rate_bp) parts.push(t('{p} des prestations', { p: pct(p.service_rate_bp) }));
  if (p.service_mode === 'tiers') parts.push(p.tiers.map(x => (x.from_cents ? t('{p} au-delà de {m}', { p: pct(x.rate_bp), m: mad(x.from_cents) }) : pct(x.rate_bp))).join(', '));
  if (p.service_mode === 'by_service') parts.push(t('par prestation ({n} taux)', { n: Object.keys(p.service_rates).length + 1 }));
  if (p.product_rate_bp) parts.push(t('{p} de la {b} des produits', { p: pct(p.product_rate_bp), b: p.product_basis === 'margin' ? t('marge') : t('vente') }));
  return parts.join(' · ') || t('Aucune commission');
}

function PlanEditor({ r, who, plan, services, onClose, onSaved }: { r: Restaurant; who: Row; plan?: Plan; services: AgService[]; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const p = plan ?? { base_cents: 0, base_mode: 'plus', service_mode: 'flat', service_rate_bp: 0, tiers: [], service_rates: {}, product_rate_bp: 0, product_basis: 'price', tips_in_pay: true } as Plan;
  const [base, setBase] = useState(p.base_cents ? String(p.base_cents / 100) : '');
  const [baseMode, setBaseMode] = useState(p.base_mode);
  const [mode, setMode] = useState(p.service_mode);
  const [rate, setRate] = useState(p.service_rate_bp ? String(p.service_rate_bp / 100) : '');
  const [tiers, setTiers] = useState(() => (p.tiers.length ? p.tiers : [{ from_cents: 0, rate_bp: 0 }, { from_cents: 1000000, rate_bp: 0 }]).map(x => ({ from: String(x.from_cents / 100), rate: String(x.rate_bp / 100) })));
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(p.service_rates).map(([k, v]) => [k, String(v / 100)])));
  const [prodRate, setProdRate] = useState(p.product_rate_bp ? String(p.product_rate_bp / 100) : '');
  const [basis, setBasis] = useState(p.product_basis);
  const [tips, setTips] = useState(p.tips_in_pay);
  const [busy, setBusy] = useState(false);
  const okPct = (s: string) => s.trim() === '' || (num(s) != null && num(s)! <= 100);
  const okTiers = tiers.every((x, i) => okPct(x.rate) && num(x.from) != null && (i === 0 ? num(x.from) === 0 : num(x.from)! > num(tiers[i - 1].from)!));
  const ok = (base.trim() === '' || num(base) != null) && okPct(rate) && okPct(prodRate) && (mode !== 'tiers' || okTiers) && Object.values(rates).every(okPct);
  const bp = (s: string) => Math.round((num(s) ?? 0) * 100);
  const chip = (on: boolean) => `flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold ${on ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted'}`;
  const save = async () => {
    setBusy(true);
    try {
      await rpc('agenda_pay_plan_save', { p_restaurant_id: r.id, p_staff: who.staff_id, p: {
        base_cents: Math.round((num(base) ?? 0) * 100), base_mode: baseMode, service_mode: mode, service_rate_bp: bp(rate),
        tiers: mode === 'tiers' ? tiers.map(x => ({ from_cents: Math.round((num(x.from) ?? 0) * 100), rate_bp: bp(x.rate) })) : [],
        service_rates: mode === 'by_service' ? Object.fromEntries(Object.entries(rates).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, bp(v)])) : {},
        product_rate_bp: bp(prodRate), product_basis: basis, tips_in_pay: tips,
      } });
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal wide title={t('Règles de paie · {name}', { name: who.name })} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Btn onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy || !ok} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="font-semibold">{t('Salaire fixe')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Par mois (DH)')}><input className={inputCls} inputMode="decimal" value={base} onChange={e => setBase(e.target.value)} placeholder="0" /></Field>
            <Field group label={t('Comment')}>
              <div className="flex gap-2">
                <button type="button" className={chip(baseMode === 'plus')} onClick={() => setBaseMode('plus')}>{t('En plus des commissions')}</button>
                <button type="button" className={chip(baseMode === 'max')} onClick={() => setBaseMode('max')}>{t('Minimum garanti')}</button>
              </div>
            </Field>
          </div>
          <p className="text-xs text-muted">{baseMode === 'max' ? t('La personne touche le plus élevé des deux : son fixe ou ses commissions.') : t('Le fixe s’ajoute aux commissions.')}</p>
        </section>

        <section className="space-y-3">
          <h3 className="font-semibold">{t('Commission sur les prestations')}</h3>
          <div className="flex gap-2">
            <button type="button" className={chip(mode === 'flat')} onClick={() => setMode('flat')}>{t('Un pourcentage')}</button>
            <button type="button" className={chip(mode === 'tiers')} onClick={() => setMode('tiers')}>{t('Par paliers')}</button>
            <button type="button" className={chip(mode === 'by_service')} onClick={() => setMode('by_service')}>{t('Par prestation')}</button>
          </div>
          {mode === 'flat' && <Field label={t('Pourcentage du chiffre des prestations')}><input className={`${inputCls} sm:max-w-40`} inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} placeholder="40" /></Field>}
          {mode === 'tiers' && <>
            <p className="text-xs text-muted">{t('Chaque partie du chiffre du mois est payée au taux de son palier. Mettez 0 % au premier palier pour ne payer qu’au-delà d’un minimum.')}</p>
            <ul className="space-y-2">
              {tiers.map((x, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-24 text-muted">{i === 0 ? t('Dès 0 DH') : t('Au-delà de')}</span>
                  {i > 0 && <div className="w-32"><input className={inputCls} inputMode="decimal" value={x.from} onChange={e => setTiers(ts => ts.map((y, j) => (j === i ? { ...y, from: e.target.value } : y)))} aria-label={t('À partir de (DH)')} /></div>}
                  {i > 0 && <span className="text-muted">DH</span>}
                  <div className="w-24"><input className={inputCls} inputMode="decimal" value={x.rate} onChange={e => setTiers(ts => ts.map((y, j) => (j === i ? { ...y, rate: e.target.value } : y)))} aria-label={t('Taux (%)')} /></div>
                  <span className="text-muted">%</span>
                  {i > 0 && <button type="button" onClick={() => setTiers(ts => ts.filter((_, j) => j !== i))} className="p-1.5 text-muted hover:text-danger" aria-label={t('Supprimer')}><Trash2 className="h-4 w-4" /></button>}
                </li>
              ))}
            </ul>
            {tiers.length < 10 && <Btn onClick={() => setTiers(ts => [...ts, { from: String((num(ts[ts.length - 1].from) ?? 0) + 5000), rate: '' }])}><Plus className="h-4 w-4" /> {t('Ajouter un palier')}</Btn>}
            {!okTiers && <p className="text-sm text-danger">{t('Chaque palier doit commencer plus haut que le précédent, avec un taux entre 0 et 100 %.')}</p>}
          </>}
          {mode === 'by_service' && <>
            <Field label={t('Taux par défaut (%)')}><input className={`${inputCls} sm:max-w-40`} inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} placeholder="40" /></Field>
            <ul className="divide-y divide-line/10 rounded-2xl border border-line/10 px-3">
              {services.map(s => (
                <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1 font-semibold">{svcName(s)}</span>
                  <div className="w-24"><input className={inputCls} inputMode="decimal" value={rates[s.id] ?? ''} placeholder={rate || '0'} onChange={e => setRates(x => ({ ...x, [s.id]: e.target.value }))} aria-label={svcName(s)} /></div>
                  <span className="text-muted">%</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">{t('Laissé vide : le taux par défaut.')}</p>
          </>}
        </section>

        <section className="space-y-3">
          <h3 className="font-semibold">{t('Commission sur les produits vendus')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Pourcentage')}><input className={inputCls} inputMode="decimal" value={prodRate} onChange={e => setProdRate(e.target.value)} placeholder="0" /></Field>
            <Field group label={t('Calculé sur')}>
              <div className="flex gap-2">
                <button type="button" className={chip(basis === 'price')} onClick={() => setBasis('price')}>{t('Le prix de vente')}</button>
                <button type="button" className={chip(basis === 'margin')} onClick={() => setBasis('margin')}>{t('La marge')}</button>
              </div>
            </Field>
          </div>
        </section>

        <Toggle checked={tips} onChange={setTips} label={t('Pourboires versés avec la paie (sinon : déjà donnés en espèces)')} />
      </div>
    </Modal>
  );
}

function ItemEditor({ r, who, month, onClose, onSaved }: { r: Restaurant; who: Row; month: string; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [kind, setKind] = useState<Item['kind']>('advance');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const v = num(amount);
  const save = async () => {
    try {
      check(await supabase.from('agenda_pay_items').insert({ restaurant_id: r.id, staff_id: who.staff_id, month, kind, amount_cents: Math.round((v ?? 0) * 100), note: note.trim() || null }).select('id'));
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
  };
  return (
    <Modal title={who.name} onClose={onClose} footer={<div className="flex justify-end gap-2"><Btn onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={!v} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <div className="flex gap-2">{(['advance', 'bonus', 'deduction'] as const).map(k => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`flex-1 rounded-xl py-2.5 text-sm font-semibold ${kind === k ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted'}`}>{t(KIND[k])}</button>
        ))}</div>
        <p className="text-xs text-muted">{kind === 'advance' ? t('Argent déjà donné pendant le mois : retiré du net à payer.') : kind === 'bonus' ? t('Ajouté au net à payer.') : t('Retiré du net à payer (casse, retard…).')}</p>
        <Field label={t('Montant (DH)')}><input className={`${inputCls} text-lg font-semibold`} inputMode="decimal" autoFocus value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label={t('Note (facultatif)')}><input className={inputCls} maxLength={200} value={note} onChange={e => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
