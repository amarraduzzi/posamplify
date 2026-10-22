// Encaisser: the client's ticket in the salon. The prestation of the appointment or the Nouba is
// already there with the person who did it; add a prestation, a product or another line, a discount
// or "offert" (with a reason), then cash, card or both, the tip and the change. The ticket can go to
// the client on WhatsApp.
import { useEffect, useMemo, useState } from 'react';
import { Banknote, CheckCircle2, CreditCard, Gift, MessageCircle, Package, Plus, Scissors, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { waLink } from '../lib/whatsapp';
import { Btn, Field, Modal, inputCls } from './ui';
import { svcName, type AgService } from '../pages/AgendaServicesPage';

export interface TillPerson { id: string; name: string; agenda_color?: string | null }
export interface CheckoutFrom {
  appointment_id?: string; queue_id?: string; name?: string; phone?: string | null;
  staff_id?: string | null; service_id?: string | null; price_cents?: number | null;
}
interface Line { key: number; kind: 'service' | 'product' | 'other'; service_id: string | null; product_id?: string | null; name: string; price: string; qty: number; staff_id: string }
interface TillProduct { id: string; name: string; category: string | null; price_cents: number; stock: number; min_stock: number | null }

export const mad = (c: number) => `${(c / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DH`;
const cents = (s: string) => { const n = Number(s.replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN; };
const dh = (c: number) => String(c / 100);
let seq = 0;

const ERR: Record<string, () => string> = {
  day_closed: () => t('La caisse de ce jour est clôturée.'),
  already_paid: () => t('Ce client est déjà encaissé.'),
  payment_mismatch: () => t('Le paiement ne correspond pas au total.'),
  free_reason_required: () => t('Indiquez pourquoi c’est offert.'),
};
export const tillError = (e: unknown) => { const m = String((e as Error)?.message ?? e); const k = Object.keys(ERR).find(x => m.includes(x)); return k ? new Error(ERR[k]()) : e; };

export function CheckoutModal({ r, people, services, from, onClose, onPaid }: {
  r: Restaurant; people: TillPerson[]; services: AgService[]; from: CheckoutFrom; onClose: () => void; onPaid: () => void;
}) {
  const a = useAdminCtx();
  const first = services.find(s => s.id === from.service_id);
  const [lines, setLines] = useState<Line[]>(() => first || from.price_cents
    ? [{ key: ++seq, kind: 'service', service_id: first?.id ?? null, name: first ? svcName(first) : t('Prestation'), price: dh(from.price_cents ?? first?.price_cents ?? 0), qty: 1, staff_id: from.staff_id ?? '' }]
    : []);
  const [name, setName] = useState(from.name ?? '');
  const [phone, setPhone] = useState(from.phone ?? '');
  const [disc, setDisc] = useState('');
  const [discWhy, setDiscWhy] = useState('');
  const [free, setFree] = useState('');
  const [method, setMethod] = useState<'cash' | 'card' | 'both'>('cash');
  const [card, setCard] = useState('');
  const [tip, setTip] = useState('');
  const [given, setGiven] = useState('');
  const [adding, setAdding] = useState<'service' | 'product' | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number: number; total_cents: number } | null>(null);

  const sub = lines.reduce((s, l) => s + (cents(l.price) || 0) * l.qty, 0);
  const discount = disc ? cents(disc) : 0;
  const total = Math.max(0, sub - (discount || 0));
  const tipC = tip ? cents(tip) : 0;
  const due = total + (tipC || 0);
  const cardC = method === 'card' ? due : method === 'both' ? (cents(card) || 0) : 0;
  const cashC = due - cardC;
  const change = given && cashC > 0 ? cents(given) - cashC : null;
  const bad = !lines.length || lines.some(l => !l.name.trim() || Number.isNaN(cents(l.price))) || Number.isNaN(discount) || discount > sub
    || Number.isNaN(tipC) || cashC < 0 || (total === 0 && !free.trim());
  const set = (k: number, p: Partial<Line>) => setLines(ls => ls.map(l => (l.key === k ? { ...l, ...p } : l)));
  const byCat = useMemo(() => services.filter(s => s.active !== false), [services]);
  // the products for sale of the salon (Produits et stock)
  const [products, setProducts] = useState<TillProduct[]>([]);
  useEffect(() => {
    supabase.from('agenda_products').select('id,name,category,price_cents,stock,min_stock').eq('restaurant_id', r.id).eq('kind', 'retail').eq('active', true).order('sort_order').order('name')
      .then(x => setProducts((x.data ?? []) as TillProduct[]));
  }, [r.id]);
  const addProduct = (pr: TillProduct) => setLines(ls => {
    const same = ls.find(l => l.product_id === pr.id);
    if (same) return ls.map(l => (l === same ? { ...l, qty: Math.min(99, l.qty + 1) } : l));
    return [...ls, { key: ++seq, kind: 'product', service_id: null, product_id: pr.id, name: pr.name, price: dh(pr.price_cents), qty: 1, staff_id: from.staff_id ?? ls.find(l => l.kind === 'service')?.staff_id ?? '' }];
  });

  const pay = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('agenda_checkout', { p_restaurant_id: r.id, p: {
        appointment_id: from.appointment_id, queue_id: from.queue_id, name: name.trim() || undefined, phone: phone.replace(/\D/g, '') || undefined,
        lines: lines.map(l => ({ kind: l.kind, service_id: l.service_id, product_id: l.product_id ?? null, name: l.name.trim(), quantity: l.qty, unit_cents: cents(l.price), staff_id: l.staff_id || null })),
        discount_cents: discount || 0, discount_reason: discWhy.trim() || undefined, free_reason: total === 0 ? free.trim() : undefined,
        cash_cents: cashC, card_cents: cardC, tip_cents: tipC || 0,
      } });
      if (error) throw error;
      setDone(data as { number: number; total_cents: number });
    } catch (e) { a.fail(tillError(e)); }
    setBusy(false);
  };
  const ticketText = () => [
    `${r.name}`, t('Ticket n° {n}', { n: done?.number ?? '' }), '',
    ...lines.map(l => `${l.qty > 1 ? `${l.qty} × ` : ''}${l.name} : ${mad((cents(l.price) || 0) * l.qty)}`),
    ...(discount ? [`${t('Remise')} : -${mad(discount)}`] : []),
    `${t('Total')} : ${mad(total)}`, '', t('Merci et à bientôt !'),
  ].join('\n');

  if (done) return (
    <Modal title={t('Encaissé')} onClose={onPaid}>
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
        <p className="font-display text-3xl font-semibold tabular">{mad(total)}</p>
        <p className="text-muted">{t('Ticket n° {n}', { n: done.number })}{tipC ? ` · ${t('pourboire {m}', { m: mad(tipC) })}` : ''}{change != null && change > 0 ? ` · ${t('Monnaie à rendre : {m}', { m: mad(change) })}` : ''}</p>
        {phone.replace(/\D/g, '').length >= 9 && <a href={waLink(phone, ticketText())} target="_blank" rel="noopener" className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] py-3 font-semibold text-white"><MessageCircle className="h-5 w-5" />{t('Envoyer le ticket sur WhatsApp')}</a>}
        <Btn className="w-full" onClick={onPaid}>{t('Fermer')}</Btn>
      </div>
    </Modal>
  );

  return (
    <Modal title={t('Encaisser')} onClose={onClose} wide
      footer={<div className="flex items-center gap-3">
        <div className="me-auto"><p className="text-xs text-muted">{t('À payer')}</p><p className="font-display text-2xl font-semibold tabular">{mad(due)}</p></div>
        <Btn onClick={onClose}>{t('Annuler')}</Btn>
        <Btn tone="brand" disabled={busy || bad} onClick={pay}>{total === 0 ? <><Gift className="h-4 w-4" /> {t('Valider offert')}</> : <><CheckCircle2 className="h-4 w-4" /> {t('Encaisser')}</>}</Btn>
      </div>}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Client')}><input className={inputCls} maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder={t('Nom (facultatif)')} /></Field>
          <Field label={t('Téléphone')}><input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="06 12 34 56 78" /></Field>
        </div>

        <div className="space-y-2">
          {lines.map(l => (
            <div key={l.key} className="rounded-2xl bg-surface-2 p-3">
              <div className="flex items-center gap-2">
                {l.kind === 'service' ? <Scissors className="h-4 w-4 shrink-0 text-brand" /> : <Package className="h-4 w-4 shrink-0 text-brand" />}
                <input className="min-w-0 flex-1 bg-transparent font-semibold outline-none" maxLength={80} value={l.name} readOnly={!!l.product_id} placeholder={t('Nom du produit')} onChange={e => set(l.key, { name: e.target.value })} aria-label={t('Nom')} />
                {l.kind !== 'service' && <select className="rounded-lg bg-surface px-2 py-1 text-sm" value={l.qty} onChange={e => set(l.key, { qty: Number(e.target.value) })} aria-label={t('Quantité')}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} ×</option>)}</select>}
                <div className="flex w-28 items-center rounded-lg bg-surface px-2 ring-1 ring-line/10">
                  <input className="w-full bg-transparent py-1.5 text-end font-semibold tabular outline-none" inputMode="decimal" value={l.price} onChange={e => set(l.key, { price: e.target.value })} aria-label={t('Prix (DH)')} />
                  <span className="ps-1 text-xs text-muted">DH</span>
                </div>
                <button className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-danger" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label={t('Supprimer')}><Trash2 className="h-4 w-4" /></button>
              </div>
              {l.kind !== 'other' && people.length > 0 && (
                <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
                  {l.kind === 'product' && <span className="shrink-0 self-center text-xs text-muted">{t('Vendu par')}</span>}
                  {people.map(p => (
                    <button key={p.id} onClick={() => set(l.key, { staff_id: l.kind === 'product' && l.staff_id === p.id ? '' : p.id })}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${l.staff_id === p.id ? 'bg-brand text-brand-ink' : 'bg-surface text-muted'}`}>{p.name}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!lines.length && <p className="rounded-2xl border border-dashed border-line/20 p-4 text-center text-sm text-muted">{t('Ajoutez une prestation ou un produit.')}</p>}
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => setAdding(adding === 'service' ? null : 'service')}><Plus className="h-4 w-4" /> {t('Prestation')}</Btn>
            <Btn onClick={() => setAdding(adding === 'product' ? null : 'product')}><Package className="h-4 w-4" /> {t('Produit ou autre')}</Btn>
          </div>
          {adding === 'product' && (
            <div className="flex flex-wrap gap-1.5 rounded-2xl bg-surface-2 p-3">
              {products.map(pr => (
                <button key={pr.id} onClick={() => addProduct(pr)} className="rounded-xl bg-surface px-3 py-2 text-start text-sm font-semibold shadow-sm">
                  {pr.name} <span className="text-muted tabular">{mad(pr.price_cents)}</span>
                  <span className={`block text-xs font-normal ${pr.stock <= 0 ? 'text-red-600' : pr.min_stock != null && pr.stock <= pr.min_stock ? 'text-amber-700' : 'text-muted'}`}>{pr.stock <= 0 ? t('Plus en stock') : t('{n} en stock', { n: pr.stock })}</span>
                </button>
              ))}
              <button onClick={() => { setLines(ls => [...ls, { key: ++seq, kind: 'other', service_id: null, product_id: null, name: '', price: '', qty: 1, staff_id: '' }]); setAdding(null); }}
                className="rounded-xl border border-dashed border-line/30 px-3 py-2 text-sm font-semibold text-muted">{t('Autre (texte libre)')}</button>
              {!products.length && <p className="w-full text-xs text-muted">{t('Ajoutez vos produits dans « Produits et stock » pour les vendre ici et suivre le stock.')}</p>}
            </div>
          )}
          {adding === 'service' && (
            <div className="flex flex-wrap gap-1.5 rounded-2xl bg-surface-2 p-3">
              {byCat.map(s => (
                <button key={s.id} onClick={() => { setLines(ls => [...ls, { key: ++seq, kind: 'service', service_id: s.id, name: svcName(s), price: dh(s.price_cents), qty: 1, staff_id: from.staff_id ?? ls[0]?.staff_id ?? '' }]); setAdding(null); }}
                  className="rounded-xl bg-surface px-3 py-2 text-sm font-semibold shadow-sm">{svcName(s)} <span className="text-muted tabular">{mad(s.price_cents)}</span></button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Remise (DH)')}><input className={inputCls} inputMode="decimal" value={disc} onChange={e => setDisc(e.target.value)} placeholder="0" /></Field>
          {discount > 0 && total > 0 && <Field label={t('Raison de la remise')}><input className={inputCls} maxLength={100} value={discWhy} onChange={e => setDiscWhy(e.target.value)} placeholder={t('Fidélité, geste commercial…')} /></Field>}
          {total === 0 && lines.length > 0 && <Field label={t('Pourquoi c’est offert ?')}><input className={inputCls} maxLength={100} value={free} onChange={e => setFree(e.target.value)} placeholder={t('Famille, retouche gratuite…')} /></Field>}
        </div>

        {total > 0 && <>
          <div className="grid grid-cols-3 gap-2">
            {([['cash', Banknote, t('Espèces')], ['card', CreditCard, t('Carte')], ['both', Plus, t('Les deux')]] as const).map(([k, I, l]) => (
              <button key={k} onClick={() => setMethod(k)} className={`flex flex-col items-center gap-1 rounded-2xl py-3 text-sm font-semibold ring-1 ${method === k ? 'bg-brand text-brand-ink ring-brand' : 'bg-surface ring-line/10'}`}>
                <I className="h-5 w-5" />{l}</button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('Pourboire (DH)')}><input className={inputCls} inputMode="decimal" value={tip} onChange={e => setTip(e.target.value)} placeholder="0" /></Field>
            {method === 'both' && <Field label={t('Par carte (DH)')}><input className={inputCls} inputMode="decimal" value={card} onChange={e => setCard(e.target.value)} /></Field>}
            {method !== 'card' && cashC > 0 && <Field label={t('Espèces reçues (DH)')} hint={change != null && change >= 0 ? t('Monnaie à rendre : {m}', { m: mad(change) }) : undefined}>
              <input className={inputCls} inputMode="decimal" value={given} onChange={e => setGiven(e.target.value)} placeholder={dh(cashC)} /></Field>}
          </div>
          {method === 'both' && <p className="text-sm text-muted">{t('Espèces : {a} · Carte : {b}', { a: mad(Math.max(0, cashC)), b: mad(cardC) })}</p>}
        </>}
        {discount > sub && <p className="text-sm text-danger">{t('La remise dépasse le total.')}</p>}
        {cashC < 0 && <p className="text-sm text-danger">{t('Le montant par carte dépasse le total.')}</p>}
      </div>
    </Modal>
  );
}
