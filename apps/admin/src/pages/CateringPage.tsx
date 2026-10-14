// Catering (traiteur): quotes and orders for events. A quote becomes a confirmed order, confirmed
// orders appear in the production plan of their day, deposits and the balance are noted as they come,
// and "Facturer" turns a fully paid order into a real ticket or invoice (with the customer's ICE).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, FileText, MessageCircle, Plus, Printer, Receipt, Trash2, Truck, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, fromCents, mad, rpc, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { I18n, Restaurant } from '../lib/types';
import { Btn, Card, Field, inputCls } from '../components/ui';

type Status = 'quote' | 'confirmed' | 'delivered' | 'cancelled';
type Method = 'cash' | 'card' | 'transfer' | 'other';
interface Cat {
  id: string; number: number; status: Status; customer_name: string; customer_phone: string | null; company: string | null; ice: string | null;
  event_date: string; event_time: string | null; mode: 'pickup' | 'delivery'; address: string | null; guests: number | null; note: string | null;
  delivery_fee_cents: number; order_id: string | null; invoiced_at: string | null; created_at: string;
}
interface CLine { id?: string; catering_id: string; menu_item_id: string | null; ingredient_id: string | null; name: string; unit_price_cents: number; qty: number; vat_bp: number | null; sort_order: number }
interface CPay { id: string; catering_id: string; kind: 'deposit' | 'balance'; method: Method; amount_cents: number; paid_on: string; note: string | null }
interface Doc { doc_type: string; doc_number: string; issued_at: string; seller: Record<string, string | null>; buyer: Record<string, string | null> | null;
  lines: { name: string; qty: number; unit_ttc: number; total_ttc: number; vat_bp: number }[]; vat_breakdown: { vat_bp: number; ht: number; vat: number; ttc: number }[];
  total_ht_cents: number; total_vat_cents: number; total_ttc_cents: number; payments: { method: string; amount: number }[] }

// i18n:values
const ST: Record<Status, string> = { quote: 'Devis', confirmed: 'Confirmée', delivered: 'Livrée', cancelled: 'Annulée' };
const METHOD: Record<Method, string> = { cash: 'Espèces', card: 'Carte', transfer: 'Virement', other: 'Chèque ou autre' };
// i18n:end
const TONE: Record<Status, string> = { quote: 'bg-surface-2 text-ink', confirmed: 'bg-brand/15 text-brand', delivered: 'bg-ok/15 text-ok', cancelled: 'bg-surface-2 text-muted line-through' };
const num = (n: number) => `CT-${String(n).padStart(4, '0')}`;
const intl = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '212' + d.slice(1) : d; };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const today = () => new Date().toLocaleDateString('en-CA');
const lineTotal = (l: Pick<CLine, 'unit_price_cents' | 'qty'>) => l.unit_price_cents * l.qty;

export function CateringPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [list, setList] = useState<Cat[] | null>(null);
  const [sums, setSums] = useState<Record<string, { total: number; paid: number }>>({});
  const [tab, setTab] = useState<'open' | 'done' | 'cancelled'>('open');
  const [open, setOpen] = useState<string | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const from = new Date(Date.now() - 120 * 86400_000).toLocaleDateString('en-CA');
      const cs = check(await supabase.from('catering_orders').select('*').eq('restaurant_id', r.id).gte('event_date', from).order('event_date').order('event_time')) as Cat[];
      const ids = cs.map(c => c.id);
      const [ls, ps] = ids.length ? await Promise.all([
        supabase.from('catering_lines').select('catering_id, unit_price_cents, qty').eq('restaurant_id', r.id).in('catering_id', ids),
        supabase.from('catering_payments').select('catering_id, amount_cents').eq('restaurant_id', r.id).in('catering_id', ids),
      ]) : [{ data: [], error: null }, { data: [], error: null }];
      const s: Record<string, { total: number; paid: number }> = Object.fromEntries(cs.map(c => [c.id, { total: Number(c.delivery_fee_cents), paid: 0 }]));
      for (const l of check(ls) as CLine[]) s[l.catering_id].total += lineTotal(l);
      for (const p of check(ps) as CPay[]) s[p.catering_id].paid += Number(p.amount_cents);
      setList(cs); setSums(s);
    } catch (e) { a.fail(e); setList([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  if (open) return <CateringEditor r={r} id={open === 'new' ? null : open} onBack={() => { setOpen(null); load(); }} onOpen={setOpen} />;

  const shown = (list ?? []).filter(c => (tab === 'open' ? c.status === 'quote' || c.status === 'confirmed' : tab === 'done' ? c.status === 'delivered' : c.status === 'cancelled'));
  if (tab !== 'open') shown.reverse();
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const counts = { open: 0, done: 0, cancelled: 0 };
  for (const c of list ?? []) counts[c.status === 'delivered' ? 'done' : c.status === 'cancelled' ? 'cancelled' : 'open']++;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <h1 className="font-display text-3xl font-semibold">{t('Traiteur')}</h1>
          <p className="text-muted">{t('Devis et commandes pour les événements. Les commandes confirmées entrent dans le plan de production de leur jour.')}</p>
        </div>
        <Btn tone="brand" onClick={() => setOpen('new')}><Plus className="h-4 w-4" /> {t('Nouvelle commande')}</Btn>
      </div>
      <div className="flex gap-1 rounded-2xl bg-surface-2 p-1 sm:w-fit">
        {(['open', 'done', 'cancelled'] as const).map(k => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition sm:flex-none ${tab === k ? 'bg-surface shadow-sm' : 'text-muted hover:text-ink'}`}>
            {k === 'open' ? t('À venir') : k === 'done' ? t('Livrées') : t('Annulées')} <span className="text-muted">{counts[k]}</span>
          </button>
        ))}
      </div>
      {list === null ? <p className="text-muted">{t('Chargement…')}</p> : !shown.length ? (
        <Card>
          <div className="mx-auto max-w-md py-6 text-center">
            <Receipt className="mx-auto mb-3 h-10 w-10 text-brand" />
            <p className="font-display text-xl font-semibold">{tab === 'open' ? t('Aucune commande à venir') : t('Rien ici pour le moment')}</p>
            {tab === 'open' && <p className="mt-2 text-sm text-muted">{t('Créez un devis pour un mariage, un séminaire ou un anniversaire. Vous l’envoyez sur WhatsApp ou l’imprimez, puis vous le confirmez quand le client accepte.')}</p>}
          </div>
        </Card>
      ) : (
        <ul className="space-y-2">
          {shown.map(c => {
            const s = sums[c.id] ?? { total: 0, paid: 0 };
            const due = s.total - s.paid;
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setOpen(c.id)} className="card flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3 text-start transition hover:bg-surface-2/60">
                  <span className="w-24 shrink-0">
                    <span className="block font-semibold capitalize">{dayLabel(c.event_date)}</span>
                    <span className="block text-sm text-muted tabular" dir="ltr">{c.event_time?.slice(0, 5) ?? ''}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">{c.company || c.customer_name}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${TONE[c.status]}`}>{c.order_id ? t('Facturée') : t(ST[c.status])}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3 text-sm text-muted">
                      <span className="tabular">{num(c.number)}</span>
                      {c.company && <span>{c.customer_name}</span>}
                      {c.guests && <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{c.guests}</span>}
                      {c.mode === 'delivery' && <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5" />{t('Livraison')}</span>}
                    </span>
                  </span>
                  <span className="text-end">
                    <span className="block font-semibold tabular">{mad(s.total)}</span>
                    <span className={`block text-sm tabular ${due > 0 && c.status !== 'cancelled' ? 'text-warn' : 'text-muted'}`}>{due > 0 ? t('reste {m}', { m: mad(due) }) : s.total > 0 ? t('payé') : ''}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface Row { key: string; ref: string; name: string; price: string; qty: string; vat_bp: number | null }
let seq = 0;
const blank = (): Row => ({ key: String(++seq), ref: '', name: '', price: '', qty: '', vat_bp: null });

function CateringEditor({ r, id, onBack, onOpen }: { r: Restaurant; id: string | null; onBack: () => void; onOpen: (id: string) => void }) {
  const a = useAdminCtx();
  const nm = (n: I18n) => n[r.languages[0]] ?? n.fr ?? Object.values(n)[0] ?? '';
  const [c, setC] = useState<Cat | null>(null);
  const [f, setF] = useState({ customer_name: '', customer_phone: '', company: '', ice: '', event_date: today(), event_time: '', mode: 'pickup' as 'pickup' | 'delivery', address: '', guests: '', note: '', fee: '' });
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [pays, setPays] = useState<CPay[]>([]);
  const [items, setItems] = useState<{ id: string; name: I18n; price_cents: number; vat_bp: number | null }[]>([]);
  const [preps, setPreps] = useState<{ id: string; name: string; base_unit: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pay, setPay] = useState<{ method: Method; amount: string; date: string } | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const frozen = !!c?.order_id;

  const load = useCallback(async () => {
    try {
      const [mi, pr] = await Promise.all([
        supabase.from('menu_items').select('id, name, price_cents, vat_bp').eq('restaurant_id', r.id).eq('active', true).order('sort_order'),
        supabase.from('ingredients').select('id, name, base_unit').eq('restaurant_id', r.id).eq('is_preparation', true).eq('active', true).order('name'),
      ]);
      setItems(check(mi) as typeof items); setPreps(check(pr) as typeof preps);
      if (!id) return;
      const [co, ls, ps] = await Promise.all([
        supabase.from('catering_orders').select('*').eq('id', id).single(),
        supabase.from('catering_lines').select('*').eq('catering_id', id).order('sort_order'),
        supabase.from('catering_payments').select('*').eq('catering_id', id).order('paid_on').order('created_at'),
      ]);
      const x = check(co) as unknown as Cat;
      setC(x);
      setF({ customer_name: x.customer_name, customer_phone: x.customer_phone ?? '', company: x.company ?? '', ice: x.ice ?? '', event_date: x.event_date,
        event_time: x.event_time?.slice(0, 5) ?? '', mode: x.mode, address: x.address ?? '', guests: x.guests ? String(x.guests) : '', note: x.note ?? '', fee: fromCents(x.delivery_fee_cents || null) });
      const lines = check(ls) as CLine[];
      setRows(lines.length ? lines.map(l => ({ key: String(++seq), ref: l.menu_item_id ? `m:${l.menu_item_id}` : l.ingredient_id ? `p:${l.ingredient_id}` : 'text', name: l.name, price: fromCents(l.unit_price_cents), qty: String(l.qty), vat_bp: l.vat_bp })) : [blank()]);
      setPays(check(ps) as CPay[]);
      setDirty(false);
      if (x.order_id) {
        const [o] = check(await supabase.from('orders').select('fiscal_document_id').eq('id', x.order_id)) as { fiscal_document_id: string | null }[];
        if (o?.fiscal_document_id) setDoc(check(await supabase.from('fiscal_documents').select('*').eq('id', o.fiscal_document_id).single()) as unknown as Doc);
      }
    } catch (e) { a.fail(e); }
  }, [id, r.id, a]);
  useEffect(() => { load(); }, [load]);

  const set = (p: Partial<typeof f>) => { setF(v => ({ ...v, ...p })); setDirty(true); };
  const setRow = (key: string, p: Partial<Row>) => { setRows(rs => rs.map(x => (x.key === key ? { ...x, ...p } : x))); setDirty(true); };
  const pick = (key: string, ref: string) => {
    if (ref.startsWith('m:')) { const it = items.find(x => x.id === ref.slice(2)); if (it) return setRow(key, { ref, name: nm(it.name), price: fromCents(it.price_cents), vat_bp: it.vat_bp }); }
    if (ref.startsWith('p:')) { const g = preps.find(x => x.id === ref.slice(2)); if (g) return setRow(key, { ref, name: g.name, vat_bp: null }); }
    setRow(key, { ref, vat_bp: null });
  };
  const lines = rows.filter(x => x.ref && x.name.trim() && Number(x.qty) > 0);
  const fee = f.mode === 'delivery' ? toCents(f.fee || '0') : 0;
  const total = lines.reduce((s, x) => s + toCents(x.price || '0') * Math.round(Number(x.qty)), 0) + fee;
  const paid = pays.reduce((s, p) => s + Number(p.amount_cents), 0);
  const due = total - paid;

  const save = async (patch: Partial<Cat> = {}): Promise<Cat | null> => {
    if (!f.customer_name.trim()) { a.toast(t('Indiquez le nom du client.'), 'error'); return null; }
    if (!f.event_date) { a.toast(t('Indiquez la date de l’événement.'), 'error'); return null; }
    if (f.ice && !/^\d{15}$/.test(f.ice)) { a.toast(t('L\'ICE doit contenir exactement 15 chiffres.'), 'error'); return null; }
    if (rows.some(x => x.ref && x.name.trim() && !(Number(x.qty) > 0 && Number.isInteger(Number(x.qty))))) { a.toast(t('Les quantités sont des nombres entiers (pièces, plateaux, personnes).'), 'error'); return null; }
    setBusy(true);
    const row = { customer_name: f.customer_name.trim(), customer_phone: f.customer_phone.trim() || null, company: f.company.trim() || null, ice: f.ice.trim() || null,
      event_date: f.event_date, event_time: f.event_time || null, mode: f.mode, address: f.address.trim() || null, guests: Number(f.guests) || null,
      note: f.note.trim() || null, delivery_fee_cents: fee, ...patch };
    try {
      const saved = (c
        ? check(await supabase.from('catering_orders').update(row).eq('id', c.id).select('*').single())
        : check(await supabase.from('catering_orders').insert({ ...row, restaurant_id: r.id }).select('*').single())) as unknown as Cat;
      check(await supabase.from('catering_lines').delete().eq('catering_id', saved.id).select('id'));
      if (lines.length) check(await supabase.from('catering_lines').insert(lines.map((x, i) => ({
        restaurant_id: r.id, catering_id: saved.id, name: x.name.trim().slice(0, 120), unit_price_cents: toCents(x.price || '0'), qty: Math.round(Number(x.qty)),
        menu_item_id: x.ref.startsWith('m:') ? x.ref.slice(2) : null, ingredient_id: x.ref.startsWith('p:') ? x.ref.slice(2) : null, vat_bp: x.vat_bp, sort_order: i,
      }))).select('id'));
      setC(saved); setDirty(false);
      if (!c) onOpen(saved.id);
      setBusy(false);
      return saved;
    } catch (e) { a.fail(e); setBusy(false); return null; }
  };

  const status = async (s: Status, msg: string) => { if (await save({ status: s })) { a.toast(msg); load(); } };
  const addPay = async () => {
    if (!pay) return;
    const amount = toCents(pay.amount || '0');
    if (!(amount > 0)) { a.toast(t('Indiquez le montant.'), 'error'); return; }
    const saved = dirty || !c ? await save() : c;
    if (!saved) return;
    try {
      check(await supabase.from('catering_payments').insert({ restaurant_id: r.id, catering_id: saved.id, method: pay.method, amount_cents: amount, paid_on: pay.date, kind: amount >= due ? 'balance' : 'deposit' }).select('id'));
      setPay(null); a.toast(t('Paiement noté')); load();
    } catch (e) { a.fail(e); }
  };
  const delPay = async (p: CPay) => {
    if (!window.confirm(t('Supprimer ce paiement de {m} ?', { m: mad(p.amount_cents) }))) return;
    try { check(await supabase.from('catering_payments').delete().eq('id', p.id).select('id')); load(); } catch (e) { a.fail(e); }
  };
  const invoice = async () => {
    const saved = dirty ? await save() : c;
    if (!saved) return;
    if (!window.confirm(f.ice ? t('Émettre la facture au nom de {n} (ICE {i}) ? Elle ne pourra plus être modifiée.', { n: f.company || f.customer_name, i: f.ice }) : t('Émettre le ticket ? La commande ne pourra plus être modifiée. Pour une facture au nom d’une société, ajoutez d’abord son ICE.'))) return;
    setBusy(true);
    try {
      const res = await rpc<{ document: Doc }>('catering_invoice', { p_id: saved.id, p_buyer: null });
      setDoc(res.document); a.toast(t('Facturé : {n}', { n: res.document.doc_number })); await load();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      a.toast(m.includes('not_fully_paid') ? t('Notez d’abord tous les paiements : le reste à payer doit être à zéro.') : m.includes('day_closed') ? t('La journée est déjà clôturée à la caisse : facturez demain.') : m, 'error');
    }
    setBusy(false);
  };

  // the quote / order form, or the invoice once issued (from the fiscal document itself)
  const print = () => {
    const w = window.open('', '_blank');
    if (!w) { a.toast(t('Autorisez les fenêtres pour imprimer.'), 'error'); return; }
    const seller = [r.legal_name || r.name, r.address, r.city, r.phone, r.ice ? `ICE ${r.ice}` : '', r.rc ? (/^rc/i.test(r.rc) ? r.rc : `RC ${r.rc}`) : '', r.tax_id ? (/^if/i.test(r.tax_id) ? r.tax_id : `IF ${r.tax_id}`) : ''].filter(Boolean).map(esc).join('<br>');
    const dt = new Date(`${f.event_date}T12:00:00Z`).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    let body: string;
    if (doc) {
      body = `<h1>${esc(doc.doc_type === 'invoice' ? t('Facture') : t('Ticket'))} ${esc(doc.doc_number)}</h1>
        <p class="m">${esc(new Date(doc.issued_at).toLocaleDateString(dateLocale()))} · ${esc(num(c!.number))}</p>
        ${doc.buyer ? `<p><b>${esc(doc.buyer.name)}</b><br>${doc.buyer.ice ? `ICE ${esc(doc.buyer.ice)}<br>` : ''}${esc(doc.buyer.address ?? '')}</p>` : `<p><b>${esc(f.customer_name)}</b></p>`}
        <table><tr><th>${esc(t('Désignation'))}</th><th class="n">${esc(t('Qté'))}</th><th class="n">${esc(t('Prix TTC'))}</th><th class="n">${esc(t('Total TTC'))}</th></tr>
        ${doc.lines.map(l => `<tr><td>${esc(l.name)}</td><td class="n">${l.qty}</td><td class="n">${esc(mad(l.unit_ttc))}</td><td class="n">${esc(mad(l.total_ttc))}</td></tr>`).join('')}</table>
        <table class="t">${doc.vat_breakdown.map(v => `<tr><td>${esc(t('TVA {p} %', { p: v.vat_bp / 100 }))}</td><td class="n">${esc(t('HT'))} ${esc(mad(v.ht))}</td><td class="n">${esc(mad(v.vat))}</td></tr>`).join('')}
        <tr><td>${esc(t('Total HT'))}</td><td></td><td class="n">${esc(mad(doc.total_ht_cents))}</td></tr>
        <tr class="b"><td>${esc(t('Total TTC'))}</td><td></td><td class="n">${esc(mad(doc.total_ttc_cents))}</td></tr></table>
        <p class="m">${esc(t('Payé'))} : ${doc.payments.map(p => `${esc(t(METHOD[p.method as Method] ?? p.method))} ${esc(mad(p.amount))}`).join(', ')}</p>`;
    } else {
      const title = c?.status === 'quote' || !c ? t('Devis') : t('Bon de commande');
      body = `<h1>${esc(title)} ${c ? esc(num(c.number)) : ''}</h1>
        <p class="m">${esc(t('Établi le {d}', { d: new Date().toLocaleDateString(dateLocale()) }))}</p>
        <p><b>${esc(f.company || f.customer_name)}</b>${f.company ? `<br>${esc(f.customer_name)}` : ''}${f.ice ? `<br>ICE ${esc(f.ice)}` : ''}${f.customer_phone ? `<br>${esc(f.customer_phone)}` : ''}</p>
        <p>${esc(t('Événement'))} : <b>${esc(dt)}${f.event_time ? ` ${esc(t('à {h}', { h: f.event_time }))}` : ''}</b>${f.guests ? ` · ${esc(t('{n} personnes', { n: f.guests }))}` : ''}<br>
        ${f.mode === 'delivery' ? `${esc(t('Livraison'))} : ${esc(f.address)}` : esc(t('À retirer sur place'))}</p>
        <table><tr><th>${esc(t('Désignation'))}</th><th class="n">${esc(t('Qté'))}</th><th class="n">${esc(t('Prix TTC'))}</th><th class="n">${esc(t('Total TTC'))}</th></tr>
        ${lines.map(x => { const p = toCents(x.price || '0'), q = Math.round(Number(x.qty)); return `<tr><td>${esc(x.name)}</td><td class="n">${q}</td><td class="n">${esc(mad(p))}</td><td class="n">${esc(mad(p * q))}</td></tr>`; }).join('')}
        ${fee ? `<tr><td>${esc(t('Livraison'))}</td><td class="n">1</td><td class="n">${esc(mad(fee))}</td><td class="n">${esc(mad(fee))}</td></tr>` : ''}</table>
        <table class="t"><tr class="b"><td>${esc(t('Total TTC'))}</td><td class="n">${esc(mad(total))}</td></tr>
        ${paid ? `<tr><td>${esc(t('Déjà versé'))}</td><td class="n">${esc(mad(paid))}</td></tr><tr class="b"><td>${esc(t('Reste à payer'))}</td><td class="n">${esc(mad(due))}</td></tr>` : ''}</table>
        ${f.note ? `<p class="m">${esc(f.note)}</p>` : ''}
        <p class="m">${esc(title === t('Devis') ? t('Ce devis n’est pas une facture. La facture est remise après paiement.') : t('Ce bon de commande n’est pas une facture. La facture est remise après paiement.'))}</p>`;
    }
    w.document.write(`<!doctype html><html dir="${document.documentElement.dir}"><head><meta charset="utf-8"><title>${esc(c ? num(c.number) : t('Devis'))}</title><style>
      body{font:14px/1.5 system-ui,sans-serif;color:#111;max-width:760px;margin:32px auto;padding:0 24px}h1{font-size:24px;margin:24px 0 4px}.m{color:#555}
      table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:start}.n{text-align:end;white-space:nowrap}
      .t{width:auto;margin-inline-start:auto}.b td{font-weight:700}.s{color:#333}@media print{body{margin:0}}</style></head>
      <body><p class="s">${seller}</p>${body}<script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  const whatsapp = () => {
    if (!f.customer_phone) return;
    const dt = new Date(`${f.event_date}T12:00:00Z`).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    const msg = [
      t('Bonjour {n},', { n: f.customer_name }),
      c?.status === 'quote' || !c ? t('voici notre devis {k} pour le {d} :', { k: c ? num(c.number) : '', d: dt }) : t('votre commande {k} pour le {d} est confirmée :', { k: c ? num(c.number) : '', d: dt }),
      ...lines.map(x => `- ${Math.round(Number(x.qty))} × ${x.name} : ${mad(toCents(x.price || '0') * Math.round(Number(x.qty)))}`),
      ...(fee ? [`- ${t('Livraison')} : ${mad(fee)}`] : []),
      `${t('Total TTC')} : ${mad(total)}`,
      ...(paid ? [`${t('Déjà versé')} : ${mad(paid)}`, `${t('Reste à payer')} : ${mad(due)}`] : []),
      r.name,
    ].join('\n');
    window.open(`https://wa.me/${intl(f.customer_phone)}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  };

  const choices = useMemo(() => ({ items: items.map(x => ({ v: `m:${x.id}`, l: nm(x.name) })), preps: preps.map(x => ({ v: `p:${x.id}`, l: x.name })) }), [items, preps]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Btn tone="ghost" onClick={() => { if (!dirty || window.confirm(t('Quitter sans enregistrer ?'))) onBack(); }}><ArrowLeft className="h-4 w-4" /> {t('Traiteur')}</Btn>
        <h1 className="me-auto font-display text-2xl font-semibold">{c ? num(c.number) : t('Nouvelle commande')}
          {c && <span className={`ms-3 rounded-full px-2.5 py-1 align-middle text-sm font-bold ${TONE[c.status]}`}>{frozen ? t('Facturée') : t(ST[c.status])}</span>}</h1>
        <Btn onClick={print} disabled={!lines.length}><Printer className="h-4 w-4" /> {doc ? (doc.doc_type === 'invoice' ? t('Imprimer la facture') : t('Imprimer le ticket')) : t('Imprimer')}</Btn>
        {f.customer_phone && <Btn onClick={whatsapp} disabled={!lines.length}><MessageCircle className="h-4 w-4" /> WhatsApp</Btn>}
        {!frozen && <Btn tone="brand" disabled={busy} onClick={async () => { if (await save()) a.toast(t('Enregistré')); }}>{t('Enregistrer')}</Btn>}
      </div>

      <fieldset disabled={frozen} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <Card>
            <h2 className="mb-4 font-display text-xl font-semibold">{t('Client et événement')}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Nom du client')}><input className={inputCls} maxLength={80} value={f.customer_name} onChange={e => set({ customer_name: e.target.value })} /></Field>
              <Field label={t('Téléphone')}><input className={inputCls} dir="ltr" inputMode="tel" maxLength={30} value={f.customer_phone} onChange={e => set({ customer_phone: e.target.value })} placeholder="06…" /></Field>
              <Field label={t('Société (facultatif)')}><input className={inputCls} maxLength={80} value={f.company} onChange={e => set({ company: e.target.value })} /></Field>
              <Field label={t('ICE de la société (pour une facture)')}><input className={inputCls} dir="ltr" inputMode="numeric" maxLength={15} value={f.ice} onChange={e => set({ ice: e.target.value.replace(/\D/g, '') })} placeholder="15 chiffres" /></Field>
              <Field label={t('Date')}><input type="date" className={inputCls} value={f.event_date} onChange={e => set({ event_date: e.target.value })} /></Field>
              <Field label={t('Heure')}><input type="time" className={inputCls} value={f.event_time} onChange={e => set({ event_time: e.target.value })} /></Field>
              <Field label={t('Nombre de personnes')}><input className={inputCls} inputMode="numeric" value={f.guests} onChange={e => set({ guests: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field group label={t('Retrait ou livraison')}>
                <div className="grid grid-cols-2 gap-2">
                  {(['pickup', 'delivery'] as const).map(m => (
                    <button key={m} type="button" onClick={() => set({ mode: m })} className={`rounded-xl border px-2 py-2.5 text-sm font-semibold transition ${f.mode === m ? 'border-brand bg-brand/10 text-brand' : 'border-line/[0.12] hover:bg-surface-2'}`}>
                      {m === 'pickup' ? t('Retrait') : t('Livraison')}
                    </button>
                  ))}
                </div>
              </Field>
              {f.mode === 'delivery' && <>
                <Field label={t('Adresse de livraison')}><input className={inputCls} maxLength={300} value={f.address} onChange={e => set({ address: e.target.value })} /></Field>
                <Field label={t('Frais de livraison (DH)')}><input className={inputCls} inputMode="decimal" value={f.fee} onChange={e => set({ fee: e.target.value })} placeholder="0" /></Field>
              </>}
              <div className="sm:col-span-2"><Field label={t('Note (allergies, installation, décoration…)')}><textarea className={inputCls} rows={2} maxLength={1000} value={f.note} onChange={e => set({ note: e.target.value })} /></Field></div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-1 font-display text-xl font-semibold">{t('Articles')}</h2>
            <p className="mb-4 text-sm text-muted">{t('Un article de la carte, une préparation (mini-viennoiseries, pièces) ou un texte libre. Le prix traiteur peut être différent du prix en boutique.')}</p>
            <div className="space-y-2">
              {rows.map(x => (
                <div key={x.key} className="space-y-2 border-b border-line/10 pb-3 last:border-0">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select className={inputCls} value={x.ref} onChange={e => pick(x.key, e.target.value)} aria-label={t('Article')}>
                      <option value="">{t('Choisir…')}</option>
                      <option value="text">{t('Texte libre')}</option>
                      {choices.items.length > 0 && <optgroup label={t('La carte')}>{choices.items.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</optgroup>}
                      {choices.preps.length > 0 && <optgroup label={t('Préparations')}>{choices.preps.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</optgroup>}
                    </select>
                    <input className={inputCls} maxLength={120} value={x.name} onChange={e => setRow(x.key, { name: e.target.value })} placeholder={t('Nom sur le devis')} aria-label={t('Nom sur le devis')} />
                  </div>
                  <div className="grid grid-cols-[5rem_7rem_minmax(0,1fr)_2.5rem] items-center gap-2">
                    <input className={`${inputCls} text-end`} inputMode="numeric" value={x.qty} onChange={e => setRow(x.key, { qty: e.target.value.replace(/\D/g, '') })} placeholder={t('Qté')} aria-label={t('Quantité')} />
                    <input className={`${inputCls} text-end`} inputMode="decimal" value={x.price} onChange={e => setRow(x.key, { price: e.target.value })} placeholder={t('Prix DH')} aria-label={t('Prix unitaire (DH)')} />
                    <span className="text-end text-sm font-semibold tabular">{x.price && Number(x.qty) > 0 ? mad(toCents(x.price) * Math.round(Number(x.qty))) : ''}</span>
                    <button type="button" aria-label={t('Retirer')} title={t('Retirer')} onClick={() => { setRows(rs => (rs.length > 1 ? rs.filter(y => y.key !== x.key) : [blank()])); setDirty(true); }} className="rounded-lg p-2 text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
              <Btn tone="ghost" className="px-2.5 py-1.5 text-sm" onClick={() => setRows(rs => [...rs, blank()])}><Plus className="h-4 w-4" /> {t('Ajouter un article')}</Btn>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 font-display text-xl font-semibold">{t('Total')}</h2>
            <dl className="space-y-1.5 text-sm">
              {fee > 0 && <div className="flex justify-between"><dt className="text-muted">{t('Livraison')}</dt><dd className="tabular">{mad(fee)}</dd></div>}
              <div className="flex justify-between text-lg font-semibold"><dt>{t('Total TTC')}</dt><dd className="tabular">{mad(total)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">{t('Déjà versé')}</dt><dd className="tabular">{mad(paid)}</dd></div>
              <div className={`flex justify-between font-semibold ${due > 0 ? 'text-warn' : due < 0 ? 'text-danger' : 'text-ok'}`}><dt>{t('Reste à payer')}</dt><dd className="tabular">{mad(due)}</dd></div>
            </dl>
            {due < 0 && <p className="mt-2 text-xs text-danger">{t('Le client a versé plus que le total : corrigez un paiement.')}</p>}

            <h3 className="mb-2 mt-5 text-sm font-bold">{t('Paiements')}</h3>
            {!pays.length && <p className="text-sm text-muted">{t('Aucun acompte pour le moment.')}</p>}
            <ul className="space-y-1.5">
              {pays.map(p => (
                <li key={p.id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                  <span className="flex-1">{t(METHOD[p.method])} <span className="text-muted">· {new Date(`${p.paid_on}T12:00:00Z`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span></span>
                  <span className="tabular font-semibold">{mad(p.amount_cents)}</span>
                  {!frozen && <button type="button" aria-label={t('Supprimer')} title={t('Supprimer')} onClick={() => delPay(p)} className="rounded p-1 text-muted hover:text-danger"><X className="h-3.5 w-3.5" /></button>}
                </li>
              ))}
            </ul>
            {!frozen && (pay ? (
              <div className="mt-3 space-y-2 rounded-2xl border border-line/10 p-3">
                <select className={inputCls} value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value as Method })}>
                  {(Object.keys(METHOD) as Method[]).map(m => <option key={m} value={m}>{t(METHOD[m])}</option>)}
                </select>
                <div className="flex gap-2">
                  <input className={inputCls} inputMode="decimal" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} placeholder={t('Montant DH')} aria-label={t('Montant DH')} />
                  <input type="date" className={inputCls} value={pay.date} onChange={e => setPay({ ...pay, date: e.target.value })} aria-label={t('Date')} />
                </div>
                <div className="flex justify-end gap-2"><Btn tone="ghost" className="px-3 py-1.5 text-sm" onClick={() => setPay(null)}>{t('Annuler')}</Btn><Btn tone="brand" className="px-3 py-1.5 text-sm" onClick={addPay}>{t('Noter')}</Btn></div>
              </div>
            ) : <Btn className="mt-3 w-full justify-center" disabled={total <= 0} onClick={() => setPay({ method: 'transfer', amount: due > 0 ? fromCents(due) : '', date: today() })}><Plus className="h-4 w-4" /> {t('Noter un paiement')}</Btn>)}
          </Card>

          {!frozen && (
            <Card>
              <h2 className="mb-3 font-display text-xl font-semibold">{t('Étapes')}</h2>
              <div className="space-y-2">
                {(!c || c.status === 'quote') && <Btn tone="brand" className="w-full justify-center" disabled={busy || !lines.length} onClick={() => status('confirmed', t('Commande confirmée : elle entre dans le plan de production.'))}><Check className="h-4 w-4" /> {t('Le client accepte : confirmer')}</Btn>}
                {c?.status === 'confirmed' && <Btn className="w-full justify-center" disabled={busy} onClick={() => status('delivered', t('Commande livrée'))}><Truck className="h-4 w-4" /> {t('Marquer comme livrée')}</Btn>}
                {(c?.status === 'confirmed' || c?.status === 'delivered') && <Btn tone="brand" className="w-full justify-center" disabled={busy || due !== 0 || total <= 0} onClick={invoice}><FileText className="h-4 w-4" /> {f.ice ? t('Émettre la facture') : t('Émettre le ticket')}</Btn>}
                {(c?.status === 'confirmed' || c?.status === 'delivered') && due !== 0 && <p className="text-xs text-muted">{t('La facture s’émet quand tout est payé. Elle passe par le système fiscal de la caisse.')}</p>}
                {c && c.status !== 'cancelled' && <Btn tone="ghost" className="w-full justify-center" disabled={busy} onClick={() => { if (window.confirm(paid ? t('Annuler cette commande ? Pensez à rembourser les {m} déjà versés.', { m: mad(paid) }) : t('Annuler cette commande ?'))) status('cancelled', t('Commande annulée')); }}><X className="h-4 w-4" /> {t('Annuler la commande')}</Btn>}
                {c?.status === 'cancelled' && <Btn className="w-full justify-center" disabled={busy} onClick={() => status('quote', t('Remis en devis'))}>{t('Remettre en devis')}</Btn>}
              </div>
            </Card>
          )}
          {frozen && doc && (
            <Card>
              <p className="font-semibold">{doc.doc_type === 'invoice' ? t('Facture {n}', { n: doc.doc_number }) : t('Ticket {n}', { n: doc.doc_number })}</p>
              <p className="mt-1 text-sm text-muted">{t('Émise le {d}. Elle figure dans vos rapports et dans le Z du jour.', { d: new Date(doc.issued_at).toLocaleDateString(dateLocale()) })}</p>
            </Card>
          )}
        </div>
      </fieldset>
    </div>
  );
}
