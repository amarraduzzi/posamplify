// Ventes > Produits: what every dish or product sold over any period, compared with the period
// just before, and one product in detail (per day, per weekday, per hour, per size).
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Search } from 'lucide-react';
import { tr } from '@resto/shared';
import { mad, rpc } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { I18n, Restaurant } from '../lib/types';
import { Btn, Card, Modal, inputCls } from './ui';

type Item = { key: string; item_id: string | null; name: I18n; category: I18n | null; image_url: string | null; qty: number; revenue_cents: number;
  prev_qty: number; prev_revenue_cents: number; days_sold: number; tickets: number; margin_cents: number | null };
type Data = { from: string; to: string; prev_from: string; prev_to: string; items: Item[];
  totals: { revenue_cents: number; qty: number; tickets: number; discount_cents: number; prev_revenue_cents: number; prev_qty: number; prev_tickets: number } };
type Detail = { qty: number; revenue_cents: number; tickets: number; all_tickets: number; daily: { day: string; qty: number; revenue_cents: number }[];
  weekdays: { dow: number; qty: number; revenue_cents: number; days: number }[]; hours: { hour: number; qty: number }[]; variants: { name: I18n; qty: number; revenue_cents: number }[] };
type Sort = 'revenue' | 'qty' | 'trend' | 'margin' | 'name';

const n = (x: unknown) => Number(x ?? 0);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (s: string) => new Date(`${s}T12:00:00`);
const addDays = (s: string, k: number) => { const d = day(s); d.setDate(d.getDate() + k); return iso(d); };
/** % change, null when there is nothing to compare with */
const change = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const c = change(cur, prev);
  if (c == null) return cur > 0 ? <span className="text-xs font-semibold text-brand">{t('nouveau')}</span> : <span className="text-muted">—</span>;
  return <span className={`inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-semibold tabular ${c >= 0 ? 'text-ok' : 'text-danger'}`}>{c >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(c)} %</span>;
}

export function ProductSales({ r, today }: { r: Restaurant; today: string }) {
  const a = useAdminCtx();
  const lang = r.languages[0] ?? 'fr';
  const presets = useMemo(() => {
    const d = day(today), first = iso(new Date(d.getFullYear(), d.getMonth(), 1));
    const prevFirst = iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), prevLast = iso(new Date(d.getFullYear(), d.getMonth(), 0));
    return [
      { k: 'today', label: t('Aujourd’hui'), from: today, to: today },
      { k: 'yesterday', label: t('Hier'), from: addDays(today, -1), to: addDays(today, -1) },
      { k: '7', label: t('7 jours'), from: addDays(today, -6), to: today },
      { k: '30', label: t('30 jours'), from: addDays(today, -29), to: today },
      { k: 'month', label: t('Ce mois'), from: first, to: today },
      { k: 'lastmonth', label: t('Mois dernier'), from: prevFirst, to: prevLast },
    ];
  }, [today]);
  const [range, setRange] = useState({ k: '7', from: addDays(today, -6), to: today });
  const [data, setData] = useState<Data | null>(null);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ by: Sort; desc: boolean }>({ by: 'revenue', desc: true });
  const [open, setOpen] = useState<Item | null>(null);

  useEffect(() => {
    if (!range.from || !range.to || range.to < range.from) return;
    let live = true;
    setData(null);
    rpc<Data>('product_sales', { p_restaurant_id: r.id, p_from: range.from, p_to: range.to }).then(x => live && setData(x)).catch(e => live && a.fail(e));
    return () => { live = false; };
  }, [r.id, range.from, range.to, a]);

  const name = (i: Item) => tr(i.name, lang);
  const catName = (i: Item) => (i.category ? tr(i.category, lang) : t('Divers'));
  const total = n(data?.totals.revenue_cents);
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of data?.items ?? []) m.set(catName(i), (m.get(catName(i)) ?? 0) + n(i.revenue_cents));
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (data?.items ?? []).filter(i => (!cat || catName(i) === cat) && (!s || name(i).toLowerCase().includes(s)));
    const val = (i: Item): number | string => sort.by === 'name' ? name(i).toLowerCase() : sort.by === 'qty' ? n(i.qty) : sort.by === 'margin' ? (i.margin_cents == null ? -Infinity : n(i.margin_cents))
      : sort.by === 'trend' ? (change(n(i.revenue_cents), n(i.prev_revenue_cents)) ?? (n(i.revenue_cents) > 0 ? Infinity : -Infinity)) : n(i.revenue_cents);
    return [...list].sort((x, y) => { const p = val(x), o = val(y); const c = p < o ? -1 : p > o ? 1 : 0; return sort.desc ? -c : c; });
  }, [data, cat, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const unsold = rows.filter(i => !n(i.qty)).length;
  // the share bar is drawn against the best seller, so small differences stay visible
  const topShare = Math.max(1, ...(data?.items ?? []).map(i => n(i.revenue_cents)));

  const fmt = (s: string) => day(s).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
  const csv = () => {
    if (!data) return;
    const lines = [['Produit', 'Categorie', 'Quantite', 'CA TTC', 'Part du CA %', 'Quantite periode precedente', 'CA periode precedente', 'Marge HT', 'Jours vendus'],
      ...rows.map(i => [name(i), catName(i), n(i.qty), (n(i.revenue_cents) / 100).toFixed(2), total ? ((n(i.revenue_cents) / total) * 100).toFixed(1) : '0',
        n(i.prev_qty), (n(i.prev_revenue_cents) / 100).toFixed(2), i.margin_cents == null ? '' : (n(i.margin_cents) / 100).toFixed(2), n(i.days_sold)])];
    const esc = (v: unknown) => { const s = String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const u = URL.createObjectURL(new Blob(['﻿' + lines.map(l => l.map(esc).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' }));
    const l = document.createElement('a'); l.href = u; l.download = `produits-${r.slug}-${data.from}-${data.to}.csv`; l.click(); URL.revokeObjectURL(u);
  };
  const Th = ({ by, children, end, wide }: { by: Sort; children: React.ReactNode; end?: boolean; wide?: boolean }) => (
    <th className={`px-3 py-2 font-semibold ${end ? 'text-end' : 'text-start'} ${wide ? 'hidden sm:table-cell' : ''}`}>
      <button type="button" onClick={() => setSort(s => ({ by, desc: s.by === by ? !s.desc : by !== 'name' }))} className={`inline-flex items-center gap-1 ${sort.by === by ? 'text-ink' : ''}`}>
        {children}{sort.by === by && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-2xl bg-surface p-1 ring-1 ring-line/10">
          {presets.map(p => <button key={p.k} type="button" onClick={() => setRange(p)} className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${range.k === p.k ? 'bg-night text-white' : 'text-muted hover:bg-surface-2'}`}>{p.label}</button>)}
        </div>
        <div className="flex items-center gap-1">
          <input type="date" aria-label={t('Du')} className={`${inputCls} !w-40 !py-1.5`} value={range.from} max={today} onChange={e => setRange(x => ({ k: '', from: e.target.value, to: x.to < e.target.value ? e.target.value : x.to }))} />
          <span className="text-muted">–</span>
          <input type="date" aria-label={t('Au')} className={`${inputCls} !w-40 !py-1.5`} value={range.to} min={range.from} max={today} onChange={e => setRange(x => ({ k: '', from: x.from, to: e.target.value }))} />
        </div>
        <Btn className="ms-auto" onClick={csv} disabled={!data?.items.length}><Download className="h-4 w-4" /> {t('Exporter (CSV)')}</Btn>
      </div>

      {!data ? <p className="text-muted">{t('Chargement…')}</p> : <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { l: t("Chiffre d'affaires"), v: mad(total), c: n(data.totals.revenue_cents), p: n(data.totals.prev_revenue_cents) },
            { l: t('Articles vendus'), v: n(data.totals.qty).toLocaleString(dateLocale()), c: n(data.totals.qty), p: n(data.totals.prev_qty) },
            { l: t('Tickets'), v: n(data.totals.tickets).toLocaleString(dateLocale()), c: n(data.totals.tickets), p: n(data.totals.prev_tickets) },
            { l: t('Articles par ticket'), v: data.totals.tickets ? (n(data.totals.qty) / n(data.totals.tickets)).toLocaleString(dateLocale(), { maximumFractionDigits: 1 }) : '—',
              c: data.totals.tickets ? n(data.totals.qty) / n(data.totals.tickets) : 0, p: data.totals.prev_tickets ? n(data.totals.prev_qty) / n(data.totals.prev_tickets) : 0 },
          ].map(x => (
            <Card key={x.l} className="p-4">
              <p className="text-sm text-muted">{x.l}</p>
              <p className="font-display text-2xl font-semibold tabular">{x.v}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted"><Delta cur={x.c} prev={x.p} /> {t('vs {a} – {b}', { a: fmt(data.prev_from), b: fmt(data.prev_to) })}</p>
            </Card>
          ))}
        </div>
        {n(data.totals.discount_cents) > 0 && <p className="text-xs text-muted">{t('Montants encaissés, remises déduites ({m} de remises sur la période).', { m: mad(n(data.totals.discount_cents)) })}</p>}

        <Card className="!p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line/10 p-3">
            <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:pb-0">
              <button type="button" onClick={() => setCat('')} className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${!cat ? 'bg-night text-white' : 'bg-surface-2 text-muted'}`}>{t('Tout')}</button>
              {cats.map(([c, v]) => (
                <button key={c} type="button" onClick={() => setCat(c === cat ? '' : c)} className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${cat === c ? 'bg-night text-white' : 'bg-surface-2 text-muted'}`}>
                  {c} <span className="font-normal opacity-70">{total ? Math.round((v / total) * 100) : 0} %</span>
                </button>
              ))}
            </div>
            <label className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className={`${inputCls} !py-1.5 ps-9`} placeholder={t('Chercher un produit')} value={q} onChange={e => setQ(e.target.value)} />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm md:min-w-[44rem]">
              <thead className="text-muted">
                <tr>
                  <Th by="name">{t('Produit')}</Th>
                  <Th by="qty" end><span className="hidden sm:inline">{t('Quantité')}</span><span className="sm:hidden">{t('Qté')}</span></Th>
                  <Th by="revenue" end><span className="hidden sm:inline">{t("Chiffre d'affaires")}</span><span className="sm:hidden">{t('CA')}</span></Th>
                  <th className="hidden px-3 py-2 text-start font-semibold md:table-cell">{t('Part')}</th>
                  <Th by="trend" end wide>{t('Évolution')}</Th>
                  <Th by="margin" end wide>{t('Marge')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(i => {
                  const share = total ? n(i.revenue_cents) / total : 0;
                  return (
                    <tr key={i.key} onClick={() => setOpen(i)} className={`cursor-pointer border-t border-line/10 hover:bg-surface-2 ${n(i.qty) ? '' : 'text-muted'}`}>
                      <td className="py-2 pe-2 ps-3 sm:px-3">
                        <span className="flex items-center gap-3">
                          {i.image_url ? <img src={i.image_url} alt="" className="hidden h-9 w-9 shrink-0 rounded-lg object-cover sm:block" /> : <span className="hidden h-9 w-9 shrink-0 rounded-lg bg-surface-2 sm:block" />}
                          <span className="min-w-0"><span className="block font-semibold leading-tight">{name(i)}</span><span className="block text-xs text-muted">{catName(i)}</span></span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-end font-semibold tabular sm:px-3">{n(i.qty).toLocaleString(dateLocale())}</td>
                      <td className="whitespace-nowrap py-2 pe-3 ps-2 text-end tabular sm:px-3">{mad(n(i.revenue_cents))}<span className="block sm:hidden"><Delta cur={n(i.revenue_cents)} prev={n(i.prev_revenue_cents)} /></span></td>
                      <td className="hidden px-3 py-2 md:table-cell"><span className="flex items-center gap-2"><span className="h-1.5 w-20 rounded-full bg-surface-2"><span className="block h-1.5 rounded-full bg-brand" style={{ width: `${(n(i.revenue_cents) / topShare) * 100}%` }} /></span><span className="w-10 text-xs tabular text-muted">{Math.round(share * 1000) / 10} %</span></span></td>
                      <td className="hidden px-3 py-2 text-end sm:table-cell"><Delta cur={n(i.revenue_cents)} prev={n(i.prev_revenue_cents)} /></td>
                      <td className="hidden px-3 py-2 text-end tabular sm:table-cell">{i.margin_cents == null ? <span className="text-muted">—</span> : mad(n(i.margin_cents))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && <p className="p-6 text-center text-muted">{t('Aucun produit.')}</p>}
          </div>
          <p className="border-t border-line/10 px-3 py-2 text-xs text-muted">
            {unsold > 0 && <>{t('{n} produit(s) sans vente sur la période.', { n: unsold })} </>}
            {t('La marge apparaît quand la fiche technique est remplie (page Marges).')}
          </p>
        </Card>
      </>}
      {open && data && <ProductDetail r={r} item={open} title={name(open)} from={data.from} to={data.to} onClose={() => setOpen(null)} />}
    </div>
  );
}

// i18n:values
const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
// i18n:end

function Bars({ data, label, sub, highlight }: { data: { id: string; k: string; v: number; tip: string }[]; label: string; sub?: string; highlight?: boolean }) {
  const max = Math.max(1, ...data.map(d => d.v));
  const best = highlight ? Math.max(...data.map(d => d.v)) : -1;
  return (
    <div>
      <p className="font-semibold">{label}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
      <div className="mt-3 flex items-end gap-[3px]" aria-label={label}>
        {data.map(d => (
          <div key={d.id} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={d.tip}>
            <div className="flex h-28 w-full flex-col justify-end">
              <div className={`w-full rounded-t-md ${d.v === best && d.v > 0 ? 'bg-brand' : 'bg-brand/45'}`} style={{ height: `${d.v ? Math.max(3, (d.v / max) * 100) : 0}%` }} />
              {!d.v && <div className="h-[2px] w-full bg-line/15" />}
            </div>
            {data.length <= 24 && <span className="text-[10px] text-muted">{d.k}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductDetail({ r, item, title, from, to, onClose }: { r: Restaurant; item: Item; title: string; from: string; to: string; onClose: () => void }) {
  const a = useAdminCtx();
  const lang = r.languages[0] ?? 'fr';
  const [d, setD] = useState<Detail | null>(null);
  useEffect(() => {
    rpc<Detail>('product_detail', { p_restaurant_id: r.id, p_item_id: item.item_id, p_name: item.item_id ? null : tr(item.name, 'fr'), p_from: from, p_to: to }).then(setD).catch(a.fail);
  }, [r.id, item, from, to, a]);
  const loc = dateLocale();
  const days = d?.daily.length ?? 1;
  const hours = (d?.hours ?? []).filter(h => n(h.qty) > 0).map(h => h.hour);
  const h0 = hours.length ? Math.min(...hours) : 8, h1 = hours.length ? Math.max(...hours) : 22;
  const fmtQ = (x: number) => x.toLocaleString(loc, { maximumFractionDigits: 1 });
  return (
    <Modal wide title={title} onClose={onClose}>
      {!d ? <p className="text-muted">{t('Chargement…')}</p> : (
        <div className="space-y-6">
          <p className="text-sm text-muted">{day(from).toLocaleDateString(loc)}{from !== to ? ` – ${day(to).toLocaleDateString(loc)}` : ''}</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-2xl bg-surface-2 p-3"><p className="text-xs text-muted">{t('Quantité')}</p><p className="font-display text-2xl font-semibold tabular">{fmtQ(n(d.qty))}</p><Delta cur={n(item.qty)} prev={n(item.prev_qty)} /></div>
            <div className="rounded-2xl bg-surface-2 p-3"><p className="text-xs text-muted">{t("Chiffre d'affaires")}</p><p className="font-display text-2xl font-semibold tabular">{mad(n(d.revenue_cents))}</p><Delta cur={n(item.revenue_cents)} prev={n(item.prev_revenue_cents)} /></div>
            <div className="rounded-2xl bg-surface-2 p-3"><p className="text-xs text-muted">{t('Par jour en moyenne')}</p><p className="font-display text-2xl font-semibold tabular">{fmtQ(n(d.qty) / days)}</p><p className="text-xs text-muted">{t('vendu {n} jour(s) sur {d}', { n: n(item.days_sold), d: days })}</p></div>
            <div className="rounded-2xl bg-surface-2 p-3"><p className="text-xs text-muted">{t('Présent dans')}</p><p className="font-display text-2xl font-semibold tabular">{d.all_tickets ? Math.round((n(d.tickets) / n(d.all_tickets)) * 100) : 0} %</p><p className="text-xs text-muted">{t('des tickets ({n} sur {t})', { n: n(d.tickets), t: n(d.all_tickets) })}</p></div>
          </div>
          {!n(d.qty) ? <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{t('Aucune vente sur cette période. Essayez une période plus longue.')}</p> : <>
            {days > 1 && <Bars label={t('Par jour')} data={d.daily.map(x => ({ id: x.day, k: days <= 14 ? String(day(x.day).getDate()) : '', v: n(x.qty), tip: `${day(x.day).toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' })} : ${fmtQ(n(x.qty))} · ${mad(n(x.revenue_cents))}` }))} />}
            <div className="grid gap-6 md:grid-cols-2">
              {days >= 7 && <Bars highlight label={t('Par jour de la semaine')} sub={t('moyenne par jour')} data={d.weekdays.map(x => ({ id: String(x.dow), k: t(DOW[x.dow - 1]), v: x.days ? n(x.qty) / x.days : 0, tip: `${t(DOW[x.dow - 1])} : ${fmtQ(x.days ? n(x.qty) / x.days : 0)} (${fmtQ(n(x.qty))} / ${x.days})` }))} />}
              <Bars highlight label={t('Par heure')} sub={t('heure de la commande')} data={d.hours.filter(x => x.hour >= h0 && x.hour <= h1).map(x => ({ id: String(x.hour), k: `${x.hour}h`, v: n(x.qty), tip: `${x.hour}h – ${x.hour + 1}h : ${fmtQ(n(x.qty))}` }))} />
            </div>
            {d.variants.length > 1 && (
              <div>
                <p className="mb-2 font-semibold">{t('Par taille')}</p>
                <div className="space-y-1.5">
                  {d.variants.map((v, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="w-32 shrink-0 truncate">{tr(v.name, lang) || t('Sans taille')}</span>
                      <span className="h-2 min-w-0 flex-1 rounded-full bg-surface-2"><span className="block h-2 rounded-full bg-brand" style={{ width: `${(n(v.qty) / Math.max(1, n(d.qty))) * 100}%` }} /></span>
                      <span className="w-12 text-end tabular font-semibold">{fmtQ(n(v.qty))}</span>
                      <span className="w-24 text-end tabular text-muted">{mad(n(v.revenue_cents))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>}
        </div>
      )}
    </Modal>
  );
}
