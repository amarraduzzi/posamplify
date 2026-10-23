// "Situation fournisseurs": over a period, per supplier what was owed at the start, bought, paid and owed at
// the end, against the period before. A row opens the detail: each product (quantity, average price, price
// change), each delivery (order and invoice numbers, what was ordered and did not come), each payment.
// To print (or save as PDF) and to export for the accountant (Excel).
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, FileSpreadsheet, Printer, TrendingDown, TrendingUp } from 'lucide-react';
import { mad, rpc } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { BaseUnit, Restaurant } from '../lib/types';
import { download, fileSlug } from '../lib/accounting';
import { xlsxBlob, type Cell } from '../lib/xlsx';
import { Btn, inputCls } from './ui';
import { Smooth } from './Smooth';

interface Row { id: string | null; name: string | null; phone: string | null; opening_cents: number; purchased_cents: number; paid_cents: number; credit_cents: number; closing_cents: number; deliveries: number; unpriced: number; prev_purchased_cents: number }
interface Report { from: string; to: string; prev_from: string; prev_to: string; restaurant: string; suppliers: Row[] }
interface Product { ingredient_id: string; name: string; base_unit: BaseUnit; purchase_unit: string; units: number; total_cents: number | null; avg_unit_cents: number | null; prev_avg_unit_cents: number | null }
interface Delivery { date: string; number: string | null; total_cents: number | null; lines: number; invoices: string[]; short: { name: string; unit: string; ordered: number; received: number }[] }
interface Payment { date: string; kind: 'payment' | 'credit' | 'opening'; amount_cents: number; method: string | null; reference: string | null; note: string | null }
interface Detail { products: Product[]; deliveries: Delivery[]; payments: Payment[] }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const presets = () => {
  const now = new Date();
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return {
    week: [ymd(monday), ymd(now)],
    month: [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)],
    last: [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))],
  } as const;
};
type Preset = keyof ReturnType<typeof presets> | 'custom';
const n3 = (x: number) => String(Math.round(x * 1000) / 1000).replace('.', ',');
const METHOD: Record<string, string> = { cash: 'espèces', transfer: 'virement', check: 'chèque', card: 'carte' };

export function SupplierReport({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(presets().month[0]);
  const [to, setTo] = useState(presets().month[1]);
  const [rep, setRep] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!from || !to || from > to) return;
    setLoading(true);
    try { setRep(await rpc<Report>('supplier_report', { p_restaurant_id: r.id, p_from: from, p_to: to })); setDetails({}); }
    catch (e) { a.fail(e); }
    setLoading(false);
  }, [r.id, from, to, a]);
  useEffect(() => { load(); }, [load]);
  const pick = (p: Preset) => { setPreset(p); if (p !== 'custom') { const [f, tt] = presets()[p]; setFrom(f); setTo(tt); } };

  const key = (x: Row) => x.id ?? 'none';
  const detailOf = async (x: Row): Promise<Detail | null> => {
    if (details[key(x)]) return details[key(x)];
    try {
      const d = await rpc<Detail>('supplier_report_detail', { p_restaurant_id: r.id, p_supplier_id: x.id, p_from: from, p_to: to });
      setDetails(m => ({ ...m, [key(x)]: d }));
      return d;
    } catch (e) { a.fail(e); return null; }
  };
  const toggle = async (x: Row) => { if (open === key(x)) { setOpen(null); return; } setOpen(key(x)); await detailOf(x); };

  const rows = rep?.suppliers ?? [];
  const sum = (f: (x: Row) => number) => rows.reduce((s, x) => s + Number(f(x)), 0);
  const tot = { opening: sum(x => x.opening_cents), bought: sum(x => x.purchased_cents), paid: sum(x => x.paid_cents + x.credit_cents), closing: sum(x => x.closing_cents), prev: sum(x => x.prev_purchased_cents) };
  const nameOf = (x: Row) => x.name ?? t('Sans fournisseur');
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  const period = rep ? t('Du {a} au {b}', { a: day(rep.from), b: day(rep.to) }) : '';
  const change = (now: number, before: number) => before > 0 ? Math.round((now - before) / before * 100) : null;

  // ---------------------------------------------------------------- exports
  const exportXlsx = async () => {
    if (!rep) return;
    setBusy(true);
    try {
      const out: Cell[][] = [[t('Situation fournisseurs'), rep.restaurant], [period], [],
        [t('Fournisseur'), t('Solde début'), t('Achats'), t('Payé et avoirs'), t('Solde fin'), t('Livraisons'), t('Achats période précédente')]];
      for (const x of rows) out.push([nameOf(x), x.opening_cents / 100, x.purchased_cents / 100, (x.paid_cents + x.credit_cents) / 100, x.closing_cents / 100, x.deliveries, x.prev_purchased_cents / 100]);
      out.push([t('Total'), tot.opening / 100, tot.bought / 100, tot.paid / 100, tot.closing / 100, null, tot.prev / 100], [],
        [t('Détail par produit')], [t('Fournisseur'), t('Produit'), t('Quantité'), t('Unité'), t('Prix moyen'), t('Prix moyen avant'), t('Total')]);
      for (const x of rows) {
        const d = await detailOf(x);
        for (const p of d?.products ?? []) out.push([nameOf(x), p.name, Number(p.units), p.purchase_unit, p.avg_unit_cents != null ? p.avg_unit_cents / 100 : null, p.prev_avg_unit_cents != null ? p.prev_avg_unit_cents / 100 : null, p.total_cents != null ? p.total_cents / 100 : null]);
      }
      download(await xlsxBlob(t('Fournisseurs'), out, { widths: [26, 26, 12, 14, 14, 14, 14], money: [1, 2, 3, 4, 6] }), `situation-fournisseurs-${fileSlug(rep.restaurant)}-${rep.from}-${rep.to}.xlsx`);
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const printIt = async (only?: Row) => {
    if (!rep) return;
    const w = window.open('', '_blank');
    if (!w) { a.toast(t('Autorisez les fenêtres pour imprimer.'), 'error'); return; }
    const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
    const list = only ? [only] : rows;
    let body = '';
    if (!only) {
      body += `<table><tr><th>${esc(t('Fournisseur'))}</th><th class="n">${esc(t('Solde début'))}</th><th class="n">${esc(t('Achats'))}</th><th class="n">${esc(t('Payé et avoirs'))}</th><th class="n">${esc(t('Solde fin'))}</th></tr>`
        + rows.map(x => `<tr><td>${esc(nameOf(x))}</td><td class="n">${esc(mad(x.opening_cents))}</td><td class="n">${esc(mad(x.purchased_cents))}</td><td class="n">${esc(mad(x.paid_cents + x.credit_cents))}</td><td class="n"><b>${esc(mad(x.closing_cents))}</b></td></tr>`).join('')
        + `<tr class="tot"><td>${esc(t('Total'))}</td><td class="n">${esc(mad(tot.opening))}</td><td class="n">${esc(mad(tot.bought))}</td><td class="n">${esc(mad(tot.paid))}</td><td class="n">${esc(mad(tot.closing))}</td></tr></table>`;
    }
    for (const x of list) {
      const d = await detailOf(x);
      if (!d) continue;
      body += `<h2>${esc(nameOf(x))}</h2><p>${esc(t('Solde début'))} ${esc(mad(x.opening_cents))} · ${esc(t('Achats'))} ${esc(mad(x.purchased_cents))} · ${esc(t('Payé et avoirs'))} ${esc(mad(x.paid_cents + x.credit_cents))} · <b>${esc(t('Solde fin'))} ${esc(mad(x.closing_cents))}</b></p>`;
      if (d.products.length) body += `<table><tr><th>${esc(t('Produit'))}</th><th class="n">${esc(t('Quantité'))}</th><th class="n">${esc(t('Prix moyen'))}</th><th class="n">${esc(t('Total'))}</th></tr>`
        + d.products.map(p => `<tr><td>${esc(p.name)}</td><td class="n">${esc(n3(Number(p.units)))} ${esc(p.purchase_unit)}</td><td class="n">${p.avg_unit_cents != null ? esc(mad(Number(p.avg_unit_cents))) : ''}</td><td class="n">${p.total_cents != null ? esc(mad(Number(p.total_cents))) : ''}</td></tr>`).join('') + '</table>';
      if (d.deliveries.length) body += `<h3>${esc(t('Livraisons'))}</h3><table>` + d.deliveries.map(v => `<tr><td>${esc(day(v.date))}</td><td>${esc([v.number, ...v.invoices].filter(Boolean).join(' · '))}</td><td class="n">${v.total_cents != null ? esc(mad(Number(v.total_cents))) : ''}</td></tr>`
        + v.short.map(s => `<tr><td></td><td class="warn">${esc(t('{n} : commandé {o}, reçu {r} {u}', { n: s.name, o: n3(Number(s.ordered)), r: n3(Number(s.received)), u: s.unit }))}</td><td></td></tr>`).join('')).join('') + '</table>';
      if (d.payments.length) body += `<h3>${esc(t('Paiements et avoirs'))}</h3><table>` + d.payments.map(p => `<tr><td>${esc(day(p.date))}</td><td>${esc(p.kind === 'payment' ? t('Paiement') : p.kind === 'credit' ? t('Avoir') : t('Solde de départ'))}${p.method ? ` (${esc(t(METHOD[p.method] ?? p.method))})` : ''}${p.reference ? ` · ${esc(p.reference)}` : ''}</td><td class="n">${esc(mad(Number(p.amount_cents)))}</td></tr>`).join('') + '</table>';
    }
    w.document.write(`<!doctype html><html dir="${document.documentElement.dir || 'ltr'}"><head><meta charset="utf-8"><title>${esc(t('Situation fournisseurs'))}</title><style>
      body{font:13px system-ui,sans-serif;color:#001E3E;margin:32px}h1{font-size:20px;margin:0}h2{font-size:16px;margin:28px 0 4px;border-top:2px solid #001E3E;padding-top:12px}h3{font-size:13px;margin:14px 0 2px;color:#4A5A6E}
      p{margin:3px 0;color:#4A5A6E}table{width:100%;border-collapse:collapse;margin-top:8px}th{font-size:11px;text-transform:uppercase;color:#4A5A6E;text-align:start;border-bottom:1px solid #001E3E;padding:5px 4px}
      td{padding:5px 4px;border-bottom:1px solid #e3e8ee}.n{text-align:end;white-space:nowrap}.tot td{font-weight:700;border-top:2px solid #001E3E}.warn{color:#B45309}</style></head><body>
      <h1>${esc(rep.restaurant)}</h1><p>${esc(only ? `${t('Situation fournisseur')} · ${nameOf(only)}` : t('Situation fournisseurs'))}</p><p>${esc(period)}</p>${body}</body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  // ---------------------------------------------------------------- screen
  const PRESETS: [Preset, string][] = [['week', t('Cette semaine')], ['month', t('Ce mois')], ['last', t('Mois dernier')], ['custom', t('Autre période')]];
  const ch = change(tot.bought, tot.prev);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-2xl bg-surface-2 p-1">
          {PRESETS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => pick(k)} className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition ${preset === k ? 'bg-surface shadow-sm' : 'text-muted hover:text-ink'}`}>{l}</button>
          ))}
        </div>
        {preset === 'custom' && <>
          <input type="date" className={`${inputCls} !w-40`} value={from} onChange={e => e.target.value && setFrom(e.target.value)} aria-label={t('Du')} />
          <input type="date" className={`${inputCls} !w-40`} value={to} onChange={e => e.target.value && setTo(e.target.value)} aria-label={t('Au')} />
        </>}
        <span className="ms-auto flex gap-2">
          <Btn tone="ghost" disabled={busy || !rows.length} onClick={() => printIt()}><Printer className="h-4 w-4" /> {t('Imprimer')}</Btn>
          <Btn disabled={busy || !rows.length} onClick={exportXlsx}><FileSpreadsheet className="h-4 w-4" /> {t('Excel')}</Btn>
        </span>
      </div>

      <div className={`night grid gap-4 rounded-3xl p-5 transition-opacity sm:grid-cols-3 md:p-6 ${loading ? 'opacity-70' : ''}`}>
        <div>
          <p className="text-sm text-white/70">{t('Achats')}</p>
          <p className="font-display text-3xl font-semibold tabular">{mad(tot.bought)}</p>
          {ch != null && <p className={`mt-1 flex items-center gap-1 text-xs font-semibold ${ch > 0 ? 'text-warn' : 'text-ok'}`}>{ch > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{t('{p} % par rapport à la période d’avant', { p: ch > 0 ? `+${ch}` : ch })}</p>}
        </div>
        <div><p className="text-sm text-white/70">{t('Payé et avoirs')}</p><p className="font-display text-3xl font-semibold tabular">{mad(tot.paid)}</p></div>
        <div><p className="text-sm text-white/70">{t('Reste dû en fin de période')}</p><p className="font-display text-3xl font-semibold tabular">{mad(tot.closing)}</p></div>
      </div>

      <div className={`card overflow-hidden rounded-3xl transition-opacity ${loading ? 'opacity-60' : ''}`}>
        <div className="hidden grid-cols-[1.6fr_1fr_1fr_1fr_1fr_2rem] gap-3 bg-surface-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted md:grid">
          <span>{t('Fournisseur')}</span><span className="text-end">{t('Solde début')}</span><span className="text-end">{t('Achats')}</span><span className="text-end">{t('Payé et avoirs')}</span><span className="text-end">{t('Solde fin')}</span><span />
        </div>
        {!rows.length && !loading && <p className="px-4 py-10 text-center text-muted">{t('Aucun achat ni paiement sur cette période.')}</p>}
        <ul className="divide-y divide-line/10">
          {rows.map(x => {
            const d = details[key(x)];
            const isOpen = open === key(x);
            const c = change(Number(x.purchased_cents), Number(x.prev_purchased_cents));
            return (
              <li key={key(x)}>
                <button type="button" onClick={() => toggle(x)} aria-expanded={isOpen}
                  className="grid w-full grid-cols-2 items-center gap-3 px-4 py-3 text-start text-sm hover:bg-surface-2/60 md:grid-cols-[1.6fr_1fr_1fr_1fr_1fr_2rem]">
                  <span className="col-span-2 md:col-span-1">
                    <span className="block font-semibold">{nameOf(x)}</span>
                    <span className="block text-xs text-muted">{t('{n} livraison(s)', { n: x.deliveries })}{c != null && <> · <span className={c > 0 ? 'text-warn' : 'text-ok'}>{c > 0 ? `+${c}` : c} %</span></>}{x.unpriced > 0 && <> · <span className="text-warn">{t('{n} sans prix', { n: x.unpriced })}</span></>}</span>
                  </span>
                  <span className="text-end tabular text-muted"><span className="me-1 text-xs md:hidden">{t('Solde début')}</span>{mad(Number(x.opening_cents))}</span>
                  <span className="text-end tabular"><span className="me-1 text-xs text-muted md:hidden">{t('Achats')}</span>{mad(Number(x.purchased_cents))}</span>
                  <span className="text-end tabular text-ok"><span className="me-1 text-xs text-muted md:hidden">{t('Payé')}</span>{mad(Number(x.paid_cents) + Number(x.credit_cents))}</span>
                  <span className={`text-end font-semibold tabular ${Number(x.closing_cents) > 0 ? 'text-warn' : ''}`}><span className="me-1 text-xs font-normal text-muted md:hidden">{t('Solde fin')}</span>{mad(Number(x.closing_cents))}</span>
                  <ChevronDown className={`hidden h-4 w-4 text-muted transition-transform md:block ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                <Smooth open={isOpen}>
                  <div className="space-y-4 bg-surface-2/40 px-4 pb-5 pt-2">
                    {!d ? <p className="text-sm text-muted">{t('Chargement…')}</p> : <>
                      {d.products.length > 0 && (
                        <div>
                          <p className="mb-1 text-sm font-semibold">{t('Produits livrés')}</p>
                          <table className="w-full text-sm">
                            <tbody className="divide-y divide-line/10">
                              {d.products.map(p => {
                                const pc = p.avg_unit_cents != null && p.prev_avg_unit_cents ? Math.round((p.avg_unit_cents - p.prev_avg_unit_cents) / p.prev_avg_unit_cents * 100) : null;
                                return (
                                  <tr key={p.ingredient_id}>
                                    <td className="py-1.5">{p.name}</td>
                                    <td className="py-1.5 text-end tabular text-muted">{n3(Number(p.units))} {p.purchase_unit}</td>
                                    <td className="py-1.5 text-end tabular">{p.avg_unit_cents != null ? `${mad(Number(p.avg_unit_cents))} / ${p.purchase_unit}` : <span className="text-warn">{t('Prix manquant')}</span>}
                                      {pc != null && pc !== 0 && <span className={`ms-1 text-xs font-semibold ${pc > 0 ? 'text-warn' : 'text-ok'}`}>{pc > 0 ? `+${pc}` : pc} %</span>}</td>
                                    <td className="py-1.5 text-end font-semibold tabular">{p.total_cents != null ? mad(Number(p.total_cents)) : '—'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {d.deliveries.length > 0 && (
                        <div>
                          <p className="mb-1 text-sm font-semibold">{t('Livraisons')}</p>
                          <ul className="space-y-1 text-sm">
                            {d.deliveries.map((v, i) => (
                              <li key={i}>
                                <span className="flex flex-wrap items-center gap-x-3">
                                  <span className="w-28 text-muted">{day(v.date)}</span>
                                  <span className="flex-1">{[v.number, ...v.invoices.map(n => t('Facture {n}', { n }))].filter(Boolean).join(' · ') || t('{n} produit(s) noté(s)', { n: v.lines })}</span>
                                  <span className="tabular">{v.total_cents != null ? mad(Number(v.total_cents)) : '—'}</span>
                                </span>
                                {v.short.map((s, j) => <span key={j} className="ms-28 block ps-3 text-xs text-warn">{t('{n} : commandé {o}, reçu {r} {u}', { n: s.name, o: n3(Number(s.ordered)), r: n3(Number(s.received)), u: s.unit })}</span>)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {d.payments.length > 0 && (
                        <div>
                          <p className="mb-1 text-sm font-semibold">{t('Paiements et avoirs')}</p>
                          <ul className="space-y-1 text-sm">
                            {d.payments.map((p, i) => (
                              <li key={i} className="flex flex-wrap gap-x-3">
                                <span className="w-28 text-muted">{day(p.date)}</span>
                                <span className="flex-1">{p.kind === 'payment' ? t('Paiement') : p.kind === 'credit' ? t('Avoir') : t('Solde de départ')}{p.method ? ` (${t(METHOD[p.method] ?? p.method)})` : ''}{p.reference ? ` · ${p.reference}` : ''}</span>
                                <span className="tabular text-ok">{mad(Number(p.amount_cents))}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="flex justify-end"><Btn tone="ghost" className="text-sm" onClick={() => printIt(x)}><Printer className="h-4 w-4" /> {t('Imprimer ce fournisseur')}</Btn></div>
                    </>}
                  </div>
                </Smooth>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
