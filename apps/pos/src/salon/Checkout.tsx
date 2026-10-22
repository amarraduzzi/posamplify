// Encaisser at the salon's till: the prestation is already there with who did it; add a prestation,
// a product, a discount or "offert" (with a reason); cash, card or both, the tip, the change. The
// ticket keeps who took the money (the person unlocked on the till), prints with the drawer, or goes
// to the client on WhatsApp.
import { useState } from 'react';
import { Banknote, CheckCircle2, CreditCard, Gift, MessageCircle, Package, Plus, Printer, Scissors, Trash2 } from 'lucide-react';
import { usePos } from '../store';
import { rpc } from '../lib/data';
import { mad, toCents } from '../lib/format';
import { t } from '../lib/i18n';
import * as P from '../lib/print';
import { Btn, Field, Modal, inputCls } from '../components/ui';
import { svcName, waLink, colorOf, type From, type Person, type Product, type Svc } from './data';

interface Line { key: number; kind: 'service' | 'product' | 'other'; service_id: string | null; product_id?: string | null; name: string; price: string; qty: number; staff_id: string }
let seq = 0;
const num = (s: string) => (s.trim() === '' ? 0 : /^\d+([.,]\d{0,2})?$/.test(s.trim()) ? toCents(s) : NaN);
const dh = (c: number) => String(c / 100);
const TILL_ERR: Record<string, string> = {
  day_closed: 'La caisse de ce jour est clôturée.', already_paid: 'Ce client est déjà encaissé.',
  payment_mismatch: 'Le paiement ne correspond pas au total.', free_reason_required: 'Indiquez pourquoi c’est offert.',
};
export const tillMessage = (e: unknown) => { const m = String((e as Error)?.message ?? e); const k = Object.keys(TILL_ERR).find(x => m.includes(x)); return k ? t(TILL_ERR[k]) : null; };

export function SalonCheckout({ from, people, services, products, onClose, onPaid }: { from: From; people: Person[]; services: Svc[]; products: Product[]; onClose: () => void; onPaid: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const first = services.find(s => s.id === from.service_id);
  const team = people.filter(p => p.agenda);
  const [lines, setLines] = useState<Line[]>(() => first || from.price_cents
    ? [{ key: ++seq, kind: 'service', service_id: first?.id ?? null, name: first ? svcName(first.name) : t('Prestation'), price: dh(from.price_cents ?? first?.price_cents ?? 0), qty: 1, staff_id: from.staff_id ?? '' }]
    : []);
  const [name, setName] = useState(from.name ?? '');
  const [phone, setPhone] = useState(from.phone ?? '');
  const [disc, setDisc] = useState(''); const [discWhy, setDiscWhy] = useState(''); const [free, setFree] = useState('');
  const [method, setMethod] = useState<'cash' | 'card' | 'both'>('cash');
  const [card, setCard] = useState(''); const [tip, setTip] = useState(''); const [given, setGiven] = useState('');
  const [adding, setAdding] = useState<'service' | 'product' | null>(null);
  const addProduct = (pr: Product) => setLines(ls => {
    const same = ls.find(l => l.product_id === pr.id);
    if (same) return ls.map(l => (l === same ? { ...l, qty: Math.min(99, l.qty + 1) } : l));
    return [...ls, { key: ++seq, kind: 'product', service_id: null, product_id: pr.id, name: pr.name, price: dh(pr.price_cents), qty: 1, staff_id: '' }];
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number: number } | null>(null);

  const sub = lines.reduce((s, l) => s + (num(l.price) || 0) * l.qty, 0);
  const discount = num(disc); const tipC = num(tip);
  const total = Math.max(0, sub - (discount || 0));
  const due = total + (tipC || 0);
  const cardC = method === 'card' ? due : method === 'both' ? (num(card) || 0) : 0;
  const cashC = due - cardC;
  const change = given && cashC > 0 ? num(given) - cashC : null;
  const bad = !lines.length || lines.some(l => !l.name.trim() || Number.isNaN(num(l.price))) || Number.isNaN(discount) || discount > sub
    || Number.isNaN(tipC) || cashC < 0 || (total === 0 && !free.trim());
  const set = (k: number, p: Partial<Line>) => setLines(ls => ls.map(l => (l.key === k ? { ...l, ...p } : l)));
  const who = (id: string) => people.find(p => p.id === id)?.name;

  const printIt = async (n: number, drawer: boolean) => {
    try {
      await P.print(P.receiptPrinter(pos.settings), `Ticket ${n}`, P.salonTicket(r, {
        number: n, at: new Date().toISOString(), client: name.trim() || null, cashier: pos.staff?.name,
        lines: lines.map(l => ({ quantity: l.qty, name: l.name.trim(), line_cents: (num(l.price) || 0) * l.qty, staff: l.staff_id ? who(l.staff_id) : undefined })),
        discount_cents: discount || 0, total_cents: total, cash_cents: cashC, card_cents: cardC, tip_cents: tipC || 0,
        change_cents: change != null && change > 0 ? change : 0, free_reason: total === 0 ? free.trim() : null,
      }), { drawer });
    } catch (e) { pos.fail(e); }
  };
  const pay = async () => {
    setBusy(true);
    try {
      const res = await rpc<{ number: number }>('agenda_checkout_by', { p_restaurant_id: r.id, p_cashier: pos.staff?.id ?? null, p: {
        appointment_id: from.appointment_id, queue_id: from.queue_id, name: name.trim() || undefined, phone: phone.replace(/\D/g, '') || undefined,
        lines: lines.map(l => ({ kind: l.kind, service_id: l.service_id, product_id: l.product_id ?? null, name: l.name.trim(), quantity: l.qty, unit_cents: num(l.price), staff_id: l.staff_id || null })),
        discount_cents: discount || 0, discount_reason: discWhy.trim() || undefined, free_reason: total === 0 ? free.trim() : undefined,
        cash_cents: cashC, card_cents: cardC, tip_cents: tipC || 0,
      } });
      setDone(res);
      if (pos.printerOk) await printIt(res.number, cashC > 0);
    } catch (e) { const m = tillMessage(e); if (m) pos.toast(m, 'error'); else pos.fail(e); }
    setBusy(false);
  };
  const ticketText = () => [r.name, t('Ticket n° {n}', { n: done?.number ?? '' }), '',
    ...lines.map(l => `${l.qty > 1 ? `${l.qty} × ` : ''}${l.name} : ${mad((num(l.price) || 0) * l.qty)}`),
    ...(discount ? [`${t('Remise')} : -${mad(discount)}`] : []), `${t('Total')} : ${mad(total)}`, '', t('Merci et à bientôt !')].join('\n');

  if (done) return (
    <Modal title={t('Encaissé')} onClose={onPaid}>
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-ok" />
        <p className="font-display text-4xl font-semibold tabular">{mad(total)}</p>
        <p className="text-muted">{t('Ticket n° {n}', { n: done.number })}{tipC ? ` · ${t('pourboire {m}', { m: mad(tipC) })}` : ''}</p>
        {change != null && change > 0 && <p className="rounded-2xl bg-warn/15 py-3 text-xl font-bold text-warn">{t('Monnaie à rendre : {m}', { m: mad(change) })}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <Btn onClick={() => printIt(done.number, false)}><Printer className="h-4 w-4" /> {pos.printerOk ? t('Réimprimer') : t('Imprimer le ticket')}</Btn>
          {phone.replace(/\D/g, '').length >= 9 && <a href={waLink(phone, ticketText())} target="_blank" rel="noopener" className="flex items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-2.5 font-semibold text-white"><MessageCircle className="h-5 w-5" />WhatsApp</a>}
        </div>
        <Btn tone="ok" className="w-full py-3.5 text-lg" onClick={onPaid}>{t('Terminé')}</Btn>
      </div>
    </Modal>
  );

  const chip = (on: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${on ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`;
  return (
    <Modal title={t('Encaisser')} onClose={onClose} wide
      footer={<div className="flex items-center gap-3">
        <div className="me-auto"><p className="text-xs text-muted">{t('À payer')}</p><p className="font-display text-3xl font-semibold tabular">{mad(due)}</p></div>
        <Btn onClick={onClose}>{t('Annuler')}</Btn>
        <Btn tone="ok" className="px-6 py-3.5 text-lg" disabled={busy || bad} onClick={pay}>{total === 0 ? <><Gift className="h-5 w-5" /> {t('Valider offert')}</> : <><CheckCircle2 className="h-5 w-5" /> {t('Encaisser')}</>}</Btn>
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
                <input className="min-w-0 flex-1 bg-transparent font-semibold outline-none" maxLength={80} value={l.name} placeholder={t('Nom du produit')} readOnly={!!l.product_id} onChange={e => set(l.key, { name: e.target.value })} aria-label={t('Nom')} />
                {l.kind !== 'service' && <select className="rounded-lg bg-bg/70 px-2 py-1.5 text-sm" value={l.qty} onChange={e => set(l.key, { qty: Number(e.target.value) })} aria-label={t('Quantité')}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} ×</option>)}</select>}
                <div className="flex w-32 items-center rounded-xl bg-bg/70 px-2 ring-1 ring-line/10">
                  <input className="w-full bg-transparent py-2 text-end text-lg font-semibold tabular outline-none" inputMode="decimal" value={l.price} onChange={e => set(l.key, { price: e.target.value })} aria-label={t('Prix (DH)')} />
                  <span className="ps-1 text-xs text-muted">DH</span>
                </div>
                <button className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:text-danger" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label={t('Supprimer')}><Trash2 className="h-4 w-4" /></button>
              </div>
              {l.kind === 'service' && team.length > 0 && (
                <div className="scroll-thin mt-2 flex gap-1.5 overflow-x-auto">
                  {team.map(p => <button key={p.id} onClick={() => set(l.key, { staff_id: p.id })} className={chip(l.staff_id === p.id)}>
                    <span className="me-1.5 inline-block h-2 w-2 rounded-full" style={{ background: colorOf(p) }} />{p.name}</button>)}
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
                <button key={pr.id} onClick={() => addProduct(pr)} className="rounded-xl bg-bg/70 px-3 py-2.5 text-start text-sm font-semibold">
                  {pr.name} <span className="text-muted tabular">{mad(pr.price_cents)}</span>
                  <span className={`block text-xs font-normal ${pr.stock <= 0 ? 'text-danger' : pr.min_stock != null && pr.stock <= pr.min_stock ? 'text-warn' : 'text-muted'}`}>{pr.stock <= 0 ? t('Plus en stock') : t('{n} en stock', { n: pr.stock })}</span>
                </button>
              ))}
              <button onClick={() => { setLines(ls => [...ls, { key: ++seq, kind: 'other', service_id: null, product_id: null, name: '', price: '', qty: 1, staff_id: '' }]); setAdding(null); }}
                className="rounded-xl border border-dashed border-line/30 px-3 py-2.5 text-sm font-semibold text-muted">{t('Autre (texte libre)')}</button>
            </div>
          )}
          {adding === 'service' && (
            <div className="flex flex-wrap gap-1.5 rounded-2xl bg-surface-2 p-3">
              {services.map(s => (
                <button key={s.id} onClick={() => { setLines(ls => [...ls, { key: ++seq, kind: 'service', service_id: s.id, name: svcName(s.name), price: dh(s.price_cents), qty: 1, staff_id: from.staff_id ?? ls[0]?.staff_id ?? pos.staff?.id ?? '' }]); setAdding(null); }}
                  className="rounded-xl bg-bg/70 px-3 py-2.5 text-sm font-semibold">{svcName(s.name)} <span className="text-muted tabular">{mad(s.price_cents)}</span></button>
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
              <button key={k} onClick={() => setMethod(k)} className={`flex flex-col items-center gap-1 rounded-2xl py-4 font-semibold ring-1 ${method === k ? 'gold-fill text-brand-ink ring-brand' : 'bg-surface-2 ring-line/10'}`}><I className="h-6 w-6" />{l}</button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('Pourboire (DH)')}><input className={inputCls} inputMode="decimal" value={tip} onChange={e => setTip(e.target.value)} placeholder="0" /></Field>
            {method === 'both' && <Field label={t('Par carte (DH)')}><input className={inputCls} inputMode="decimal" value={card} onChange={e => setCard(e.target.value)} /></Field>}
            {method !== 'card' && cashC > 0 && <Field label={t('Espèces reçues (DH)')}><input className={inputCls} inputMode="decimal" value={given} onChange={e => setGiven(e.target.value)} placeholder={dh(cashC)} /></Field>}
          </div>
          {change != null && change > 0 && <p className="text-lg font-bold text-warn">{t('Monnaie à rendre : {m}', { m: mad(change) })}</p>}
          {method === 'both' && <p className="text-sm text-muted">{t('Espèces : {a} · Carte : {b}', { a: mad(Math.max(0, cashC)), b: mad(cardC) })}</p>}
        </>}
        {discount > sub && <p className="text-sm text-danger">{t('La remise dépasse le total.')}</p>}
        {cashC < 0 && <p className="text-sm text-danger">{t('Le montant par carte dépasse le total.')}</p>}
      </div>
    </Modal>
  );
}
