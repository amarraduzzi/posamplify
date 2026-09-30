// Amplify Profit: fixed costs, result of the month and break-even per day.
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, fromCents, mad, rpc, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, inputCls } from '../components/ui';

// i18n:values
const CATS: Record<string, string> = {
  loyer: 'Loyer', salaires: 'Salaires', charges_sociales: 'Charges sociales (CNSS, AMO)', energie: 'Électricité et gaz', eau: 'Eau',
  telecom: 'Internet et téléphone', assurance: 'Assurance', credit: 'Crédit et leasing', comptable: 'Comptable',
  marketing: 'Marketing', entretien: 'Entretien et réparations', logiciels: 'Logiciels et abonnements', impots: 'Impôts et taxes', autre: 'Autre',
};
const FREQ: Record<string, string> = { month: 'par mois', year: 'par an', week: 'par semaine' };
const COGS: Record<string, string> = {
  purchases: 'vos achats du mois', recipes: 'estimé avec vos fiches techniques et les ventes', target: 'estimé avec votre objectif de food cost',
};
// i18n:end

interface Fixed { id: string; name: string; category: string; amount_cents: number; frequency: 'month' | 'year' | 'week'; active: boolean }
interface Month {
  month: string; days_in_month: number; days_gone: number; days_open: number; uses_pos: boolean; revenue_source: 'pos' | 'manual' | null;
  revenue_ttc_cents: number; revenue_ht_cents: number; revenue_today_ttc_cents: number;
  typed_revenue_ttc_cents: number | null; typed_purchases_cents: number | null;
  cogs_cents: number; cogs_source: 'purchases' | 'recipes' | 'target'; food_cost_bp: number; target_food_cost_bp: number;
  fixed_cents: number; result_cents: number; breakeven_month_ht_cents: number | null; breakeven_day_ttc_cents: number | null;
}
const monthly = (f: Pick<Fixed, 'amount_cents' | 'frequency'>) =>
  f.frequency === 'month' ? f.amount_cents : f.frequency === 'year' ? f.amount_cents / 12 : f.amount_cents * 52 / 12;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

export function ChargesPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [m, setM] = useState<Month | null>(null);
  const [costs, setCosts] = useState<Fixed[]>([]);
  const [edit, setEdit] = useState<Fixed | 'new' | null>(null);
  const [rev, setRev] = useState('');
  const [buy, setBuy] = useState('');
  const isNow = iso(cursor) === iso(new Date());

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        rpc<Month>('profit_month', { p_restaurant_id: r.id, p_month: iso(cursor) }),
        supabase.from('fixed_costs').select('*').eq('restaurant_id', r.id).order('category').order('name'),
      ]);
      setM(p); setCosts(check(c) as Fixed[]);
      setRev(fromCents(p.typed_revenue_ttc_cents)); setBuy(fromCents(p.typed_purchases_cents));
    } catch (e) { a.fail(e); }
  }, [r.id, cursor, a]);
  useEffect(() => { load(); }, [load]);

  const saveFigures = async () => {
    try {
      check(await supabase.from('month_figures').upsert({
        restaurant_id: r.id, month: iso(cursor),
        revenue_ttc_cents: rev.trim() ? toCents(rev) : null, purchases_cents: buy.trim() ? toCents(buy) : null,
      }, { onConflict: 'restaurant_id,month' }).select('id'));
      a.toast(t('Chiffres enregistrés')); load();
    } catch (e) { a.fail(e); }
  };
  const remove = async (f: Fixed) => {
    try { check(await supabase.from('fixed_costs').delete().eq('id', f.id).select('id')); a.toast(t('Charge supprimée')); load(); } catch (e) { a.fail(e); }
  };
  const setDays = async (v: string) => {
    const n = Math.round(Number(v));
    if (!(n >= 1 && n <= 31) || n === m?.days_open) return;
    try {
      check(await supabase.from('restaurants').update({ profit_settings: { ...(r.profit_settings ?? {}), days_open_per_month: n } }).eq('id', r.id).select('id'));
      a.toast(t('Enregistré')); load();
    } catch (e) { a.fail(e); }
  };
  const addSocial = async () => {
    const salaries = costs.filter(c => c.active && c.category === 'salaires').reduce((s, c) => s + monthly(c), 0);
    if (!salaries) return;
    try {
      check(await supabase.from('fixed_costs').insert({ restaurant_id: r.id, name: t('Charges sociales estimées (21 %)'), category: 'charges_sociales', amount_cents: Math.round(salaries * 0.21), frequency: 'month' }).select('id'));
      a.toast(t('Charge ajoutée')); load();
    } catch (e) { a.fail(e); }
  };

  const monthName = cursor.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' });
  const hasSalaries = costs.some(c => c.active && c.category === 'salaires');
  const hasSocial = costs.some(c => c.active && c.category === 'charges_sociales');
  const positive = (m?.result_cents ?? 0) >= 0;
  const noRevenue = !!m && m.revenue_source === null;
  const todayPct = m?.breakeven_day_ttc_cents ? Math.min(100, Math.round(m.revenue_today_ttc_cents * 100 / m.breakeven_day_ttc_cents)) : 0;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand">Amplify Profit</p>
          <h1 className="font-display text-3xl font-semibold">{t('Charges et résultat')}</h1>
          <p className="text-muted">{t('Ce qui reste vraiment à la fin du mois, et le chiffre à faire chaque jour.')}</p>
        </div>
        <div className="flex items-center gap-1 rounded-2xl border border-line/[0.1] bg-surface p-1">
          <button aria-label={t('Mois précédent')} onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-surface-2"><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></button>
          <span className="min-w-36 text-center font-semibold capitalize">{monthName}</span>
          <button aria-label={t('Mois suivant')} disabled={isNow} onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-surface-2 disabled:opacity-30"><ChevronRight className="h-4 w-4 rtl:rotate-180" /></button>
        </div>
      </div>

      {!m ? <p className="text-muted">{t('Chargement…')}</p> : (<>
        {/* ---- the two numbers that matter */}
        <div className="night relative mb-5 grid gap-6 overflow-hidden rounded-[2rem] p-6 md:grid-cols-2 md:p-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">{t('Résultat du mois')}{isNow ? ` · ${t('en cours')}` : ''}</p>
            <p className={`mt-1 font-display text-5xl font-semibold tabular ${noRevenue ? 'text-white/40' : positive ? 'text-brand' : 'text-[#F47171]'}`}>{noRevenue ? '—' : `${m.result_cents > 0 ? '+' : ''}${mad(m.result_cents)}`}</p>
            <p className="mt-2 text-sm text-white/60">
              {m.revenue_source === null ? t('Indiquez le chiffre d’affaires du mois pour voir votre résultat.')
                : isNow ? t('Sur {d} jours passés. Les charges fixes comptent pour le mois entier.', { d: m.days_gone }) : t('Hors TVA, avant impôt sur les bénéfices.')}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{t('Point mort')}</p>
            {m.breakeven_day_ttc_cents == null || m.fixed_cents === 0
              ? <p className="mt-2 text-white/60">{t('Ajoutez vos charges fixes (loyer, salaires…) pour le calculer.')}</p>
              : <>
                  <p className="mt-1 font-display text-5xl font-semibold tabular">{mad(m.breakeven_day_ttc_cents)}<span className="text-lg text-white/50"> / {t('jour')}</span></p>
                  <p className="mt-2 text-sm text-white/60">{t('Le chiffre d’affaires TTC à faire chaque jour d’ouverture pour ne pas perdre d’argent.')}</p>
                  {isNow && m.uses_pos && (
                    <div className="mt-4">
                      <div className="flex justify-between text-sm"><span>{t('Aujourd’hui')}: <b className="tabular">{mad(m.revenue_today_ttc_cents)}</b></span><span className="tabular text-white/60">{todayPct} %</span></div>
                      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${todayPct >= 100 ? 'bg-brand' : 'bg-[#F2AD46]'}`} style={{ width: `${todayPct}%` }} /></div>
                      <p className="mt-1.5 text-xs text-white/60">{todayPct >= 100 ? t('Point mort atteint : tout ce qui suit est du bénéfice.') : t('Encore {x} pour atteindre le point mort.', { x: mad(m.breakeven_day_ttc_cents - m.revenue_today_ttc_cents) })}</p>
                    </div>
                  )}
                </>}
            <label className="mt-3 flex items-center gap-2 text-xs text-white/60">{t('Jours d’ouverture par mois')}
              <input key={m.days_open} defaultValue={m.days_open} onBlur={e => setDays(e.target.value)} inputMode="numeric" className="w-12 rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-center text-white outline-none focus:border-brand" /></label>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* ---- the account of the month */}
          <section className="card rounded-3xl p-6">
            <h2 className="mb-4 font-display text-xl font-semibold">{t('Le compte du mois')}</h2>
            <dl className="divide-y divide-line/10">
              <Row label={t('Chiffre d’affaires HT')} hint={m.revenue_source === 'pos' ? t('depuis la caisse Amplify POS') : m.revenue_source === 'manual' ? t('saisi par vous') : t('pas encore indiqué')} value={mad(m.revenue_ht_cents)} />
              <Row label={t('Marchandises')} hint={noRevenue ? t(COGS[m.cogs_source]) : `${t(COGS[m.cogs_source])} · ${(m.food_cost_bp / 100).toFixed(1).replace('.', ',')} %`} value={`− ${mad(m.cogs_cents)}`} />
              <Row label={t('Charges fixes')} hint={t('voir la liste')} value={`− ${mad(m.fixed_cents)}`} />
              <div className="flex items-center justify-between pt-3">
                <dt className="font-bold">{t('Résultat')}</dt>
                <dd className={`font-display text-2xl font-semibold tabular ${noRevenue ? 'text-muted' : positive ? 'text-ok' : 'text-danger'}`}>{noRevenue ? '—' : mad(m.result_cents)}</dd>
              </div>
            </dl>

            <div className="mt-5 rounded-2xl bg-surface-2 p-4">
              <p className="mb-3 text-sm font-bold">{t('Vos chiffres de {m}', { m: monthName })}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  <Field label={t('Chiffre d’affaires TTC (DH)')} hint={m.uses_pos ? t('Vide : le chiffre de la caisse. À remplir si la caisse n’a pas tout enregistré ce mois.') : t('Le total de vos tickets Z du mois.')}>
                    <input className={inputCls} inputMode="decimal" value={rev} onChange={e => setRev(e.target.value)} placeholder={m.uses_pos ? fromCents(m.revenue_ttc_cents) || '85000' : '85000'} />
                  </Field>
                )}
                <Field label={t('Achats de marchandises (DH)')} hint={t('Nourriture et boissons achetées ce mois. Sinon estimé avec vos fiches.')}>
                  <input className={inputCls} inputMode="decimal" value={buy} onChange={e => setBuy(e.target.value)} placeholder="25000" />
                </Field>
              </div>
              <div className="mt-3 flex justify-end"><Btn tone="brand" onClick={saveFigures}>{t('Enregistrer')}</Btn></div>
            </div>
          </section>

          {/* ---- fixed costs */}
          <section className="card rounded-3xl p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-semibold">{t('Charges fixes')}</h2>
              <Btn tone="brand" className="px-3 py-1.5" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> {t('Ajouter')}</Btn>
            </div>
            {!costs.length ? (
              <div className="rounded-2xl border border-dashed border-line/20 p-6 text-center text-sm text-muted">
                <p>{t('Ajoutez ce que vous payez chaque mois : loyer, salaires, électricité, eau, internet, assurance, comptable, crédit…')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-line/10">
                {costs.map(c => (
                  <li key={c.id} className={`flex items-center gap-3 py-2.5 ${c.active ? '' : 'opacity-40'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{c.name}</p>
                      <p className="text-xs text-muted">{t(CATS[c.category] ?? 'Autre')} · {mad(c.amount_cents)} {t(FREQ[c.frequency])}</p>
                    </div>
                    <span className="text-end font-semibold tabular">{mad(Math.round(monthly(c)))}<span className="block text-[11px] font-normal text-muted">{t('par mois')}</span></span>
                    <button aria-label={t('Modifier')} onClick={() => setEdit(c)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2"><Pencil className="h-4 w-4" /></button>
                    <button aria-label={t('Supprimer')} onClick={() => remove(c)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
                <li className="flex items-center justify-between pt-3 font-bold"><span>{t('Total par mois')}</span><span className="tabular">{mad(m.fixed_cents)}</span></li>
              </ul>
            )}
            {hasSalaries && !hasSocial && (
              <button onClick={addSocial} className="mt-4 w-full rounded-2xl border border-warn/40 bg-warn/5 px-4 py-3 text-start text-sm hover:bg-warn/10">
                <b>{t('Charges sociales oubliées ?')}</b> {t('En plus des salaires, l’employeur paie la CNSS et l’AMO (environ 21 %). Cliquez pour les ajouter en estimation, à vérifier avec votre comptable.')}
              </button>
            )}
          </section>
        </div>
      </>)}

      {edit && <CostEditor r={r} cost={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function Row({ label, hint, value }: { label: string; hint: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt><span className="font-semibold">{label}</span><span className="block text-xs text-muted">{hint}</span></dt>
      <dd className="font-semibold tabular">{value}</dd>
    </div>
  );
}

function CostEditor({ r, cost, onClose, onSaved }: { r: Restaurant; cost: Fixed | null; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [name, setName] = useState(cost?.name ?? '');
  const [category, setCategory] = useState(cost?.category ?? 'loyer');
  const [amount, setAmount] = useState(fromCents(cost?.amount_cents));
  const [frequency, setFrequency] = useState<Fixed['frequency']>(cost?.frequency ?? 'month');
  const [active, setActive] = useState(cost?.active ?? true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const nm = name.trim() || t(CATS[category]);
    if (!amount.trim()) { a.toast(t('Indiquez le montant.'), 'error'); return; }
    setBusy(true);
    const row = { name: nm, category, amount_cents: toCents(amount), frequency, active };
    try {
      if (cost) check(await supabase.from('fixed_costs').update(row).eq('id', cost.id).select('id'));
      else check(await supabase.from('fixed_costs').insert({ ...row, restaurant_id: r.id }).select('id'));
      a.toast(t('Charge enregistrée')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={cost ? t('Modifier la charge') : t('Nouvelle charge fixe')} onClose={onClose}
      footer={<div className="flex justify-end gap-3"><Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <Field label={t('Type')}>
          <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
            {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </Field>
        <Field label={t('Nom (facultatif)')}><input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder={t(CATS[category])} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Montant (DH)')}><input autoFocus className={inputCls} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="8000" /></Field>
          <Field label={t('Payé')}>
            <select className={inputCls} value={frequency} onChange={e => setFrequency(e.target.value as Fixed['frequency'])}>
              {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </Field>
        </div>
        {category === 'salaires' && <p className="rounded-xl bg-surface-2 p-3 text-xs text-muted">{t('Indiquez le total des salaires nets ou bruts de l’équipe. Les charges patronales (CNSS, AMO) peuvent être ajoutées à part.')}</p>}
        {cost && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> {t('Toujours en cours')}</label>}
      </div>
    </Modal>
  );
}
