import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Minus, Plus, Send, ChevronUp, Users, UserRound, Gift, Wallet, Printer, Percent, Ban, ArrowLeftRight, QrCode, Trash2, Search, X, StickyNote, RotateCcw, Merge } from 'lucide-react';
import { tr } from '@resto/shared';
import { usePos, type OrderTarget } from '../store';
import * as db from '../lib/data';
import { mad, time, uid } from '../lib/format';
import { ticketRef } from '../lib/print';
import { PIN_ERRORS, errorMessage } from '../lib/errors';
import type { ChosenMod, DraftLine, Item, Line, ModGroup, Order } from '../lib/types';
import { Btn, Field, Modal, inputCls } from './ui';
import { ManagerApproval } from './StaffGate';
import { PaymentModal } from './PaymentModal';
import { Star8 } from './Brand';
import { t } from '../lib/i18n';
import { useIsPhone } from '../lib/phone';

type Dialog = null | 'pay' | 'split' | 'customer' | 'discount' | 'cancel' | 'move' | 'note' | 'leave' | { void: Line } | { pick: Item } | { lineNote: string };

export function OrderScreen({ target, onClose, onRetarget }: { target: OrderTarget; onClose: () => void; onRetarget: (t: OrderTarget) => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  // line names (kitchen bons, receipts) stay in the restaurant's main language;
  // the screen shows names in the till's language when the menu has them
  const lang = r.languages[0] ?? 'fr';
  const uiLang = pos.lang === 'ar' ? 'ar' : lang;
  const nameOf = (n: Record<string, string>) => tr(n, uiLang, r.languages);
  const lineName = (l: { menu_item_id?: string | null; item_id?: string | null; variant_id: string | null; name: string }) => {
    if (uiLang === lang) return l.name;
    const it = pos.itemById.get((l.menu_item_id ?? l.item_id) || '');
    if (!it) return l.name;
    const v = it.variants.find(x => x.id === l.variant_id);
    return nameOf(it.name) + (v ? ` (${nameOf(v.name)})` : '');
  };
  const phone = useIsPhone();
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [payId, setPayId] = useState<string | null>(null);
  // paying one part of a split bill: afterwards, back to what is left
  const [partOf, setPartOf] = useState<string | null>(null);
  // the customer of this order, as the server returned it (points to spend)
  const [cust, setCust] = useState<Customer | null>(null);
  const loyalty = r.loyalty ?? {};
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState<string>(pos.categories[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const showPhotos = localStorage.getItem('pos-photos') !== 'off';
  // new takeaway / delivery / glovo order details
  const [kind, setKind] = useState<'takeaway' | 'delivery' | 'glovo'>(target.kind === 'new' ? (target.source === 'glovo' ? 'glovo' : target.orderType) : 'takeaway');
  const [customer, setCustomer] = useState({ name: '', phone: '', address: '', ref: '' });

  // ---- which order(s) are we looking at -------------------------------------
  const tableId = target.kind === 'table' ? target.tableId : null;
  const tableOrders = useMemo(() => tableId ? pos.orders.filter(o => o.table_id === tableId) : [], [pos.orders, tableId]);
  const order: Order | null = target.kind === 'order' ? pos.orders.find(o => o.id === target.orderId) ?? null
    : target.kind === 'table' ? (tableOrders.find(o => o.source !== 'qr') ?? tableOrders[0] ?? null) : null;
  const extraOrders = tableOrders.filter(o => o.id !== order?.id);
  const table = order?.table_id ? pos.tableById.get(order.table_id) : tableId ? pos.tableById.get(tableId) : null;

  // an order we were showing got paid/cancelled elsewhere: leave
  const [seen, setSeen] = useState(false);
  // (not while the payment screen shows the change to give back)
  useEffect(() => { if (order) setSeen(true); else if (seen && target.kind === 'order' && dialog !== 'pay') onClose(); }, [order, seen, target.kind, onClose, dialog]);

  const label = order ? pos.labelOf(order) : table ? t('Table {n}', { n: table.label }) : kind === 'glovo' ? 'Glovo' : kind === 'delivery' ? t('Livraison') : t('À emporter');
  const draftTotal = draft.reduce((s, d) => s + d.unit_price_cents * d.quantity, 0);
  const subtotal = Number(order?.subtotal_cents ?? 0) + draftTotal;
  const discount = Number(order?.discount_cents ?? 0);
  const total = subtotal - discount;
  const pendingQr = order && order.source === 'qr' && order.status === 'new';

  // ---- menu -----------------------------------------------------------------
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (q) return pos.items.filter(i => Object.values(i.name).some(n => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)));
    return pos.items.filter(i => i.category_id === cat);
  }, [pos.items, cat, query]);
  const stationOf = (i: Item) => i.station ?? pos.categories.find(c => c.id === i.category_id)?.station ?? 'kitchen';

  const addItem = (i: Item, variantId: string | null = null, mods: ChosenMod[] | null = null) => {
    // sizes or options to choose: ask first (the same names and prices as the server will write)
    if ((i.variants.length && !variantId) || (i.groups?.length && mods === null)) { setDialog({ pick: i }); return; }
    const v = i.variants.find(x => x.id === variantId);
    const chosen = mods ?? [];
    const name = tr(i.name, lang) + (v ? ` (${tr(v.name, lang)})` : '') + (chosen.length ? ` + ${chosen.map(m => m.name).join(', ')}` : '');
    const price = Number(v ? v.price_cents : i.price_cents) + chosen.reduce((s, m) => s + Number(m.price_cents), 0);
    const sig = chosen.map(m => m.id).sort().join(',');
    setDraft(d => {
      const same = d.find(x => x.item_id === i.id && x.variant_id === variantId && !x.note && (x.modifiers ?? []).map(m => m.id).sort().join(',') === sig);
      if (same) return d.map(x => x === same ? { ...x, quantity: x.quantity + 1 } : x);
      return [...d, { key: uid(), item_id: i.id, variant_id: variantId, name: name.slice(0, 120), unit_price_cents: price, quantity: 1, note: '', station: stationOf(i), modifiers: chosen }];
    });
  };
  const bump = (key: string, delta: number) => setDraft(d => d.flatMap(x => x.key !== key ? [x] : x.quantity + delta <= 0 ? [] : [{ ...x, quantity: x.quantity + delta }]));

  // ---- actions --------------------------------------------------------------
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { pos.fail(e); }
    setBusy(false);
  };

  const commit = async (send: boolean) => {
    if (target.kind === 'new' && !order && (kind === 'delivery') && !customer.address.trim()) {
      pos.toast(t("Indiquez l'adresse de livraison."), 'error'); return null;
    }
    const o = await pos.commitDraft({
      order, tableId: order?.table_id ?? tableId,
      orderType: order?.order_type ?? (tableId ? 'dine_in' : kind === 'glovo' ? 'delivery' : kind),
      source: order?.source ?? (tableId ? 'pos' : kind === 'glovo' ? 'glovo' : kind === 'delivery' ? 'phone' : 'pos'),
      customer: order ? undefined : customer,
    }, draft, { send });
    setDraft([]);
    if (target.kind === 'new') onRetarget({ kind: 'order', orderId: o.id });
    return o;
  };

  const sendNow = () => run(async () => { await commit(true); });
  const payNow = () => run(async () => {
    const o = draft.length ? await commit(true) : order;
    if (!o) return;
    setPayId(o.id);
    setDialog('pay');
  });
  const back = () => (draft.length ? setDialog('leave') : onClose());

  const mergeAll = () => run(async () => {
    if (!order || !pos.requireOnline()) return;
    await db.rpc('pos_merge_orders', { p_target: order.id, p_sources: extraOrders.map(o => o.id) });
    for (const x of extraOrders) if (x.source === 'qr' && x.status === 'new') await pos.sendToKitchen(order, x.order_lines);
    if (extraOrders.some(x => x.status === 'new') && order.status === 'new') pos.updateOrder(order.id, { status: 'preparing' });
    await pos.reloadOrders();
  });

  const resend = () => run(async () => {
    if (!order) return;
    // reprint every line (e.g. paper jam): temporarily treat them as unsent
    await pos.sendToKitchen(order, order.order_lines.map(l => ({ ...l, kitchen_sent_at: null })));
  });

  const nothing = !order && !draft.length;

  const banners = <>
    {loyalty.customers && order && (
      <CustomerBar order={order} cust={cust} loyalty={loyalty} onPick={() => setDialog('customer')} onRedeemed={c => setCust(c)} />
    )}
        {pendingQr && (
          <div className="flex items-center gap-2 bg-qr px-4 py-2.5 text-sm font-bold text-white">
            <QrCode className="h-4 w-4" /> {t('Commande client à accepter')}
            <button disabled={busy} onClick={() => run(() => pos.acceptQr(order!))} className="ms-auto rounded-lg bg-white px-3 py-1 text-qr">{t('Accepter')}</button>
          </div>
        )}
        {extraOrders.length > 0 && (
          <div className="flex items-center gap-2 bg-warn/15 px-4 py-2.5 text-sm font-semibold text-warn">
            {t('{n} commandes sur cette table', { n: extraOrders.length + 1 })}
            <button disabled={busy} onClick={mergeAll} className="ms-auto flex items-center gap-1 rounded-lg bg-warn px-3 py-1 text-black"><Merge className="h-4 w-4" /> {t('Regrouper')}</button>
          </div>
        )}
    </>;
  const ticketBody = <>
          {nothing && (
            <div className="py-20 text-center text-muted">
              <Star8 filled={false} stroke={0.6} className="mx-auto h-14 w-14 text-brand/40" />
              <p className="mt-3">{t('Touchez un article pour commencer.')}</p>
            </div>
          )}
          <ul className="divide-y divide-line/[0.07]">
            {order?.order_lines.map(l => (
              <li key={l.id} className="flex items-start gap-2 py-2">
                <span className="w-8 shrink-0 font-bold tabular">{l.quantity}×</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">{lineName(l)}</p>
                  {l.note && <p className="text-xs italic text-muted">{l.note}</p>}
                  <p className="text-xs text-muted">{l.kitchen_sent_at ? t('Envoyé') : l.print_requested_at ? t('Envoyé (bon à la caisse)') : <span className="text-warn">{t('Pas encore envoyé')}</span>}</p>
                </div>
                <span className="font-semibold tabular">{mad(l.line_total_cents)}</span>
                <button onClick={() => setDialog({ void: l })} aria-label={t('Retirer')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
            {draft.map(d => (
              <li key={d.key} className="-mx-2 flex items-start gap-2 rounded-xl bg-brand/[0.07] px-2 py-2">
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => bump(d.key, -1)} className="grid h-8 w-8 place-items-center rounded-lg bg-surface-2"><Minus className="h-4 w-4" /></button>
                  <span className="w-6 text-center font-bold tabular">{d.quantity}</span>
                  <button onClick={() => bump(d.key, 1)} className="grid h-8 w-8 place-items-center rounded-lg bg-surface-2"><Plus className="h-4 w-4" /></button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">{lineName(d)}</p>
                  <button onClick={() => setDialog({ lineNote: d.key })} className="text-xs text-brand">{d.note ? `“${d.note}”` : t('+ précision')}</button>
                </div>
                <span className="font-semibold tabular">{mad(d.unit_price_cents * d.quantity)}</span>
              </li>
            ))}
          </ul>
          {order?.note && <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm"><b>{t('Note :')}</b> {order.note}</p>}
    </>;
  const totalsBox = <>
        <div className="space-y-1 border-t border-line/[0.07] bg-bg/30 px-5 py-4 text-sm">
          {discount > 0 && <>
            <p className="flex justify-between text-muted"><span>{t('Sous-total')}</span><span className="tabular">{mad(subtotal)}</span></p>
            <p className="flex justify-between text-ok"><span>{t('Remise')}</span><span className="tabular">-{mad(discount)}</span></p>
          </>}
          <p className="flex items-baseline justify-between"><span className="text-xs font-bold uppercase tracking-[0.2em] text-muted">{t('Total')}</span><span className="font-display text-4xl font-semibold text-brand tabular">{mad(total)}</span></p>
        </div>
    </>;
  const actionsGrid = <>
        <div className="grid grid-cols-2 gap-2 border-t border-line/[0.07] p-3">
          <Btn tone="brand" disabled={busy || !draft.length} onClick={sendNow} className="py-4 text-base"><Send className="h-5 w-5 rtl:-scale-x-100" /> {t('Envoyer')}</Btn>
          <Btn tone="ok" disabled={busy || nothing || total <= 0} onClick={payNow} className="py-4 text-base"><Wallet className="h-5 w-5" /> {t('Encaisser')}</Btn>
          <Btn disabled={busy || !order} onClick={() => order && pos.printBill(order)}><Printer className="h-4 w-4" /> {t('Addition')}</Btn>
          <Btn disabled={busy || !order || !order.order_lines.length || draft.length > 0} onClick={() => setDialog('split')}><Users className="h-4 w-4" /> {t('Partager')}</Btn>
          <Btn disabled={busy || !order} onClick={() => pos.requireOnline() && setDialog('discount')}><Percent className="h-4 w-4" /> {t('Remise')}</Btn>
          <Btn disabled={busy || !order} onClick={() => setDialog('note')}><StickyNote className="h-4 w-4" /> {t('Note')}</Btn>
          <Btn disabled={busy || !order?.order_lines.length} onClick={resend}><RotateCcw className="h-4 w-4" /> {t('Renvoyer bon')}</Btn>
          {order?.table_id && <Btn disabled={busy} onClick={() => setDialog('move')}><ArrowLeftRight className="h-4 w-4" /> {t('Changer table')}</Btn>}
          <Btn tone="danger" disabled={busy || !order} onClick={() => pos.requireOnline() && setDialog('cancel')} className={order?.table_id ? '' : 'col-span-2'}><Ban className="h-4 w-4" /> {t('Annuler')}</Btn>
        </div>
    </>;
  const dialogs = <>
      {/* ------------------------------------------------ dialogs */}
      {dialog === 'pay' && payId && <PaymentModal orderId={payId} label={partOf ? `${label} · ${t('part')}` : label} onClose={() => setDialog(null)}
        onPaid={() => {
          if (!partOf) { onClose(); return; }
          const rest = pos.orders.find(o => o.id === partOf);
          setPartOf(null); setPayId(null); setDialog(null);
          if (!rest) onClose();
          else onRetarget(rest.table_id ? { kind: 'table', tableId: rest.table_id } : { kind: 'order', orderId: rest.id });
        }} />}
      {dialog === 'customer' && order && <CustomerDialog order={order} onClose={() => setDialog(null)} onDone={c => { setCust(c); setDialog(null); }} />}
      {dialog === 'split' && order && <SplitDialog order={order} lineName={lineName} onClose={() => setDialog(null)}
        onPayAll={() => { setDialog(null); payNow(); }}
        onPart={id => { setPartOf(order.id); setPayId(id); setDialog('pay'); }} />}
      {dialog === 'discount' && order && <DiscountDialog order={order} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && order && <CancelDialog order={order} onClose={() => setDialog(null)} onDone={onClose} />}
      {dialog === 'move' && order && <MoveDialog order={order} onClose={() => setDialog(null)} onMoved={id => { setDialog(null); onRetarget({ kind: 'table', tableId: id }); }} />}
      {dialog === 'note' && order && <NoteDialog order={order} onClose={() => setDialog(null)} />}
      {dialog === 'leave' && (
        <Modal title={t('Articles non envoyés')} onClose={() => setDialog(null)}
          footer={<div className="flex justify-end gap-2">
            <Btn tone="danger" onClick={onClose}>{t('Abandonner')}</Btn>
            <Btn tone="brand" onClick={() => run(async () => { await commit(true); onClose(); })}>{t('Envoyer et quitter')}</Btn>
          </div>}>
          <p>{t("{n} article(s) n'ont pas encore été envoyés.", { n: draft.length })}</p>
        </Modal>
      )}
      {dialog && typeof dialog === 'object' && 'pick' in dialog && (
        <PickDialog item={dialog.pick} lang={lang} nameOf={nameOf} onClose={() => setDialog(null)}
          onPick={(variantId, mods) => { addItem(dialog.pick, variantId, mods); setDialog(null); }} />
      )}
      {dialog && typeof dialog === 'object' && 'lineNote' in dialog && (
        <LineNoteDialog initial={draft.find(d => d.key === dialog.lineNote)?.note ?? ''} onClose={() => setDialog(null)}
          onSave={n => { setDraft(d => d.map(x => x.key === dialog.lineNote ? { ...x, note: n } : x)); setDialog(null); }} />
      )}
      {dialog && typeof dialog === 'object' && 'void' in dialog && order && (
        <VoidDialog line={dialog.void} onClose={() => setDialog(null)} />
      )}
    </>;

  // ---------------------------------------------------------------- phone: order taking at the table
  if (phone) {
    const count = (order?.order_lines.reduce((n, l) => n + l.quantity, 0) ?? 0) + draft.reduce((n, d) => n + d.quantity, 0);
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-bg">
        <div className="flex items-center gap-2 border-b border-line/[0.07] bg-surface px-3 py-2.5">
          <button onClick={back} aria-label={t('Retour')} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /></button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-xl font-semibold leading-tight">{label}</h1>
            {order && <p className="text-xs text-muted">{ticketRef(order)} · {time(order.created_at, r.timezone)}</p>}
          </div>
        </div>
        {target.kind === 'new' && !order && (
          <div className="flex gap-2 overflow-x-auto border-b border-line/[0.07] bg-surface px-3 py-2">
            {(['takeaway', 'delivery', 'glovo'] as const).map(k => (
              <button key={k} onClick={() => setKind(k)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-bold ${kind === k ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`}>
                {k === 'takeaway' ? t('À emporter') : k === 'delivery' ? t('Livraison (tél.)') : 'Glovo'}
              </button>
            ))}
          </div>
        )}
        <div className="border-b border-line/[0.07] bg-surface/60 px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Rechercher un article')} className={`${inputCls} py-2 ps-9`} />
            {query && <button onClick={() => setQuery('')} aria-label={t('Effacer')} className="absolute end-2 top-1/2 -translate-y-1/2 text-muted"><X className="h-4 w-4" /></button>}
          </div>
          {!query && (
            <div className="scroll-thin -mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-1">
              {pos.categories.map(c => (
                <button key={c.id} onClick={() => setCat(c.id)}
                  className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-bold ${cat === c.id ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`}>
                  {c.icon ? `${c.icon} ` : ''}{nameOf(c.name)}
                </button>
              ))}
            </div>
          )}
        </div>
        <ul className="scroll-thin flex-1 divide-y divide-line/[0.07] overflow-y-auto">
          {visibleItems.map(i => {
            const inDraft = draft.filter(d => d.item_id === i.id).reduce((n, d) => n + d.quantity, 0);
            return (
              <li key={i.id}>
                <button onClick={() => addItem(i)} disabled={!i.available}
                  className={`flex w-full items-center gap-3 px-4 py-3.5 text-start active:bg-surface-2 disabled:opacity-35 ${inDraft ? 'bg-brand/[0.07]' : ''}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-tight">{nameOf(i.name)}</span>
                    <span className="text-sm text-brand tabular">{i.variants.length ? t('{n} options', { n: i.variants.length }) : mad(i.price_cents)}{!i.available && ` · ${t('épuisé')}`}</span>
                  </span>
                  {inDraft > 0
                    ? <span className="grid h-9 min-w-9 place-items-center rounded-full bg-brand px-2 font-bold text-brand-ink tabular">{inDraft}</span>
                    : <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-brand"><Plus className="h-5 w-5" /></span>}
                </button>
              </li>
            );
          })}
          {!visibleItems.length && <li className="py-10 text-center text-muted">{t('Aucun article.')}</li>}
        </ul>
        <div className="flex gap-2 border-t border-line/[0.07] bg-surface p-3">
          <button onClick={() => setSheet(true)} className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-start">
            <ChevronUp className="h-5 w-5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1"><span className="block text-xs text-muted">{t('Ticket · {n} article(s)', { n: count })}</span><b className="tabular">{mad(total)}</b></span>
          </button>
          <Btn tone="brand" disabled={busy || !draft.length} onClick={sendNow} className="px-5 text-base"><Send className="h-5 w-5 rtl:-scale-x-100" /> {t('Envoyer')}</Btn>
        </div>
        {sheet && (
          <div className="fixed inset-0 z-50 flex flex-col bg-bg">
            <div className="flex items-center gap-2 border-b border-line/[0.07] bg-surface px-3 py-2.5">
              <button onClick={() => setSheet(false)} aria-label={t('Retour')} className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /></button>
              <h2 className="font-display text-xl font-semibold">{t('Ticket')} · {label}</h2>
            </div>
            {banners}
            <div className="scroll-thin flex-1 overflow-y-auto px-4 py-3">{ticketBody}</div>
            {totalsBox}
            <div className="grid grid-cols-2 gap-2 border-t border-line/[0.07] p-3">
              <Btn tone="brand" disabled={busy || !draft.length} onClick={() => { sendNow(); setSheet(false); }} className="col-span-2 py-4 text-base"><Send className="h-5 w-5 rtl:-scale-x-100" /> {t('Envoyer en cuisine')}</Btn>
              <Btn disabled={busy || !order} onClick={() => setDialog('note')}><StickyNote className="h-4 w-4" /> {t('Note')}</Btn>
              {order?.table_id ? <Btn disabled={busy} onClick={() => setDialog('move')}><ArrowLeftRight className="h-4 w-4" /> {t('Changer table')}</Btn>
                : <Btn disabled={busy} onClick={() => setSheet(false)}>{t('Ajouter')}</Btn>}
              <p className="col-span-2 pt-1 text-center text-xs text-muted">{t('L’encaissement se fait à la caisse.')}</p>
            </div>
          </div>
        )}
        {dialogs}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex bg-bg">
      {/* ------------------------------------------------ menu */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line/[0.07] bg-surface px-4 py-3">
          <Btn onClick={back} className="px-3"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /> {t('Retour')}</Btn>
          <h1 className="truncate font-display text-2xl font-semibold">{label}</h1>
          {order && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted">{ticketRef(order)} · {time(order.created_at, r.timezone)}</span>}
          <div className="relative ms-auto w-72">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Rechercher un article')} className={`${inputCls} py-2 ps-9`} />
            {query && <button onClick={() => setQuery('')} aria-label={t('Effacer')} className="absolute end-2 top-1/2 -translate-y-1/2 text-muted"><X className="h-4 w-4" /></button>}
          </div>
        </div>

        {target.kind === 'new' && !order && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line/[0.07] bg-surface px-4 py-2.5">
            {(['takeaway', 'delivery', 'glovo'] as const).map(k => (
              <button key={k} onClick={() => setKind(k)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold transition ${kind === k ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink'}`}>
                {k === 'takeaway' ? t('À emporter') : k === 'delivery' ? t('Livraison (tél.)') : 'Glovo'}
              </button>
            ))}
            {kind === 'glovo'
              ? <input className={`${inputCls} w-40 py-1.5`} placeholder={t('Réf. Glovo')} value={customer.ref} onChange={e => setCustomer({ ...customer, ref: e.target.value })} />
              : <>
                  <input className={`${inputCls} w-36 py-1.5`} placeholder={t('Nom')} value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} />
                  <input className={`${inputCls} w-36 py-1.5`} placeholder={t('Téléphone')} value={customer.phone} onChange={e => setCustomer({ ...customer, phone: e.target.value })} />
                </>}
            {kind === 'delivery' && <input className={`${inputCls} min-w-[200px] flex-1 py-1.5`} placeholder={t('Adresse de livraison')} value={customer.address} onChange={e => setCustomer({ ...customer, address: e.target.value })} />}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {!query && (
            <nav className="scroll-thin w-48 shrink-0 space-y-1 overflow-y-auto border-e border-line/[0.07] bg-surface/50 p-2.5">
              {pos.categories.map(c => (
                <button key={c.id} onClick={() => setCat(c.id)}
                  className={`flex w-full items-center gap-2.5 rounded-2xl px-3 py-3 text-start text-sm font-bold leading-tight transition ${cat === c.id ? 'gold-fill text-brand-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
                  {c.icon && <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-base ${cat === c.id ? 'bg-black/10' : 'bg-surface-2'}`}>{c.icon}</span>}
                  <span className="min-w-0 flex-1">{nameOf(c.name)}</span>
                </button>
              ))}
            </nav>
          )}
          <div className="scroll-thin grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 overflow-y-auto p-4">
            {visibleItems.map(i => {
              const inDraft = draft.filter(d => d.item_id === i.id).reduce((n, d) => n + d.quantity, 0);
              return (
                <button key={i.id} onClick={() => addItem(i)} disabled={!i.available}
                  className={`panel group relative flex flex-col overflow-hidden rounded-2xl text-start transition hover:border-brand/50 active:scale-95 disabled:opacity-35 ${inDraft ? '!border-brand ring-1 ring-brand' : ''}`}>
                  {showPhotos && i.image_url && (
                    <span className="relative block aspect-[4/3] w-full overflow-hidden bg-surface-2">
                      <img src={i.image_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
                    </span>
                  )}
                  <span className="flex flex-1 flex-col justify-between gap-1 p-3">
                    <span className="text-sm font-bold leading-tight">{nameOf(i.name)}</span>
                    <span className="text-sm font-bold text-brand tabular">
                      {i.variants.length ? t('{n} options', { n: i.variants.length }) : mad(i.price_cents)}{!i.available && ` · ${t('épuisé')}`}
                    </span>
                  </span>
                  {inDraft > 0 && <span className="absolute end-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-brand px-1.5 text-sm font-bold text-brand-ink shadow-lg tabular">{inDraft}</span>}
                </button>
              );
            })}
            {!visibleItems.length && <p className="col-span-full py-10 text-center text-muted">{t('Aucun article.')}</p>}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ ticket */}
      <aside className="flex w-[400px] shrink-0 flex-col border-s border-line/[0.07] bg-surface">
        <div className="flex items-center gap-2 border-b border-line/[0.07] px-5 py-3">
          <Star8 className="h-4 w-4 text-brand" />
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">{t('Ticket')}</p>
          <p className="ms-auto text-xs font-semibold text-muted">{t('{n} article(s)', { n: (order?.order_lines.reduce((n, l) => n + l.quantity, 0) ?? 0) + draft.reduce((n, d) => n + d.quantity, 0) })}</p>
        </div>
        {banners}
        <div className="scroll-thin flex-1 overflow-y-auto px-4 py-3">
          {ticketBody}
        </div>

        {totalsBox}

        {actionsGrid}
      </aside>

      {dialogs}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DiscountDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const pos = usePos();
  const [mode, setMode] = useState<'pct' | 'mad'>('pct');
  const [value, setValue] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = Number(order.subtotal_cents);
  const n = Number(value.replace(',', '.')) || 0;
  const cents = Math.min(sub, Math.max(0, Math.round(mode === 'pct' ? sub * n / 100 : n * 100)));
  const approve = async (managerId: string, pin: string) => {
    setBusy(true); setError(null);
    try {
      const res = await db.rpc<{ ok: boolean; error?: string }>('apply_discount', { p_order_id: order.id, p_discount_cents: cents, p_manager_staff_id: managerId, p_pin: pin });
      if (!res.ok) setError(PIN_ERRORS[res.error ?? 'invalid']);
      else { await pos.reloadOrders(); pos.toast(t('Remise de {m} appliquée', { m: mad(cents) }), 'ok'); onClose(); }
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };
  return (
    <Modal title={t('Remise')} onClose={onClose}>
      <div className="mb-4 flex gap-2">
        {(['pct', 'mad'] as const).map(m => <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-xl py-2 font-bold ${mode === m ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{m === 'pct' ? '%' : t('MAD')}</button>)}
      </div>
      <div className="mb-2 flex gap-2">
        {(mode === 'pct' ? ['5', '10', '15', '20', '50', '100'] : ['5', '10', '20', '50']).map(p => <button key={p} onClick={() => setValue(p)} className="flex-1 rounded-lg bg-surface-2 py-2 font-bold">{p}</button>)}
      </div>
      <input className={`${inputCls} mb-2`} inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} />
      <p className="mb-4 text-center">{t('Remise :')} <b className="tabular">{mad(cents)}</b> · {t('Nouveau total')} <b className="tabular">{mad(sub - cents)}</b></p>
      <p className="mb-2 text-center text-sm font-semibold text-muted">{t('Validation manager')}</p>
      <ManagerApproval onApprove={approve} busy={busy} error={error} />
    </Modal>
  );
}

function CancelDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const pos = usePos();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = !order.order_lines.length;
  const doCancel = async (managerId: string | null, pin: string | null) => {
    setBusy(true); setError(null);
    try {
      const res = await db.rpc<{ ok: boolean; error?: string }>('cancel_order', { p_order_id: order.id, p_reason: reason || null, p_manager_staff_id: managerId, p_pin: pin });
      if (!res.ok) setError(PIN_ERRORS[res.error ?? 'invalid']);
      else { await pos.reloadOrders(); pos.toast(t('Commande annulée'), 'ok'); onDone(); }
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };
  return (
    <Modal title={t('Annuler la commande {ref}', { ref: ticketRef(order) })} onClose={onClose}>
      {empty ? (
        <div className="space-y-4"><p>{t('Cette commande est vide.')}</p><Btn tone="danger" className="w-full" disabled={busy} onClick={() => doCancel(null, null)}>{t('Annuler la commande')}</Btn></div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {['Erreur de saisie', 'Client parti', 'Plat refusé', 'Test'].map(x => <button key={x} onClick={() => setReason(x)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${reason === x ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{t(x)}</button>)}
          </div>
          <Field label={t('Motif (obligatoire)')}><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} /></Field>
          {reason.trim() ? <ManagerApproval onApprove={doCancel} busy={busy} error={error} /> : <p className="text-center text-sm text-muted">{t('Indiquez un motif pour continuer.')}</p>}
        </div>
      )}
    </Modal>
  );
}

function MoveDialog({ order, onClose, onMoved }: { order: Order; onClose: () => void; onMoved: (tableId: string) => void }) {
  const pos = usePos();
  const [busy, setBusy] = useState(false);
  const move = async (tableId: string) => {
    setBusy(true);
    try {
      const there = pos.orders.find(o => o.table_id === tableId && o.id !== order.id);
      if (there) {
        // merging two bills is done by the server
        if (!pos.requireOnline()) { setBusy(false); return; }
        await db.rpc('pos_merge_orders', { p_target: there.id, p_sources: [order.id] });
        await pos.reloadOrders();
      } else pos.updateOrder(order.id, { table_id: tableId });
      pos.toast(there ? t('Commandes regroupées') : t('Table changée'), 'ok');
      onMoved(tableId);
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={t('Changer de table')} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">{t('Une table occupée regroupe les deux additions.')}</p>
      <div className="grid grid-cols-5 gap-2">
        {pos.tables.filter(x => x.id !== order.table_id).map(tb => {
          const busyT = pos.orders.some(o => o.table_id === tb.id);
          return <button key={tb.id} disabled={busy} onClick={() => move(tb.id)} className={`aspect-square rounded-xl text-lg font-black ${busyT ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{tb.label}</button>;
        })}
      </div>
    </Modal>
  );
}

function NoteDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const pos = usePos();
  const [note, setNote] = useState(order.note ?? '');
  const save = async () => {
    pos.updateOrder(order.id, { note: note.trim() || null }); onClose();
  };
  return (
    <Modal title={t('Note de commande')} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <textarea autoFocus rows={3} maxLength={300} className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder={t('Allergie, demande particulière…')} />
    </Modal>
  );
}

function LineNoteDialog({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (n: string) => void }) {
  const [note, setNote] = useState(initial);
  return (
    <Modal title={t('Précision pour la cuisine')} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" onClick={() => onSave(note.trim())}>{t('OK')}</Btn></div>}>
      {/* the kitchen bon is printed in French: the chips insert French text whatever the till language */}
      <div className="mb-3 flex flex-wrap gap-2">
        {['Sans oignon', 'Bien cuit', 'Saignant', 'Sans sucre', 'Épicé', 'À part'].map(x => <button key={x} onClick={() => setNote(n => n ? `${n}, ${x.toLowerCase()}` : x)} className="rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold">{t(x)}</button>)}
      </div>
      <input autoFocus maxLength={200} className={inputCls} value={note} onChange={e => setNote(e.target.value)} />
    </Modal>
  );
}

/** Removing a line already sent to the kitchen needs a manager. */
function VoidDialog({ line, onClose }: { line: Line; onClose: () => void }) {
  const pos = usePos();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => { pos.deleteLine(line.id); pos.toast(t('Article retiré'), 'ok'); onClose(); };
  const approve = async (managerId: string, pin: string) => {
    setBusy(true); setError(null);
    try {
      const res = await db.rpc<{ ok: boolean; error?: string; staff?: { role: string } }>('verify_staff_pin', { p_restaurant_id: pos.restaurant!.id, p_staff_id: managerId, p_pin: pin });
      if (!res.ok) setError(PIN_ERRORS[res.error ?? 'invalid']);
      else if (res.staff?.role !== 'manager') setError(PIN_ERRORS.not_manager);
      else await remove();
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };
  return (
    <Modal title={t('Retirer « {name} »', { name: line.name })} onClose={onClose}>
      {line.kitchen_sent_at || line.print_requested_at ? (pos.online ? <>
        <p className="mb-3 text-center text-sm text-muted">{t('Déjà envoyé en cuisine : validation manager nécessaire.')}</p>
        <ManagerApproval onApprove={approve} busy={busy} error={error} />
      </> : <p className="text-center text-sm text-muted">{t('Déjà envoyé en cuisine : la validation manager demande une connexion internet.')}</p>) : <Btn tone="danger" className="w-full" onClick={() => remove().catch(pos.fail)}>{t('Retirer')}</Btn>}
    </Modal>
  );
}

/** Size and options of a dish (extras, cooking, set-menu choices), with min/max per group. */
function PickDialog({ item, lang, nameOf, onClose, onPick }: {
  item: Item; lang: string; nameOf: (n: Record<string, string>) => string; onClose: () => void;
  onPick: (variantId: string | null, mods: ChosenMod[]) => void;
}) {
  const [variant, setVariant] = useState<string | null>(item.variants[0]?.id ?? null);
  const [picked, setPicked] = useState<string[]>([]);
  const groups = item.groups ?? [];
  const countIn = (g: ModGroup) => g.options.filter(o => picked.includes(o.id)).length;
  const toggle = (g: ModGroup, id: string) => setPicked(p => {
    if (p.includes(id)) return p.filter(x => x !== id);
    if (g.max_select === 1) return [...p.filter(x => !g.options.some(o => o.id === x)), id];
    if (g.max_select != null && countIn(g) >= g.max_select) return p;
    return [...p, id];
  });
  const missing = groups.find(g => countIn(g) < g.min_select);
  const v = item.variants.find(x => x.id === variant);
  // in the restaurant's main language: that is what the kitchen bon and the ticket print
  const mods: ChosenMod[] = groups.flatMap(g => g.options.filter(o => picked.includes(o.id)).map(o => ({ id: o.id, name: tr(o.name, lang), price_cents: Number(o.price_cents) })));
  const total = Number(v ? v.price_cents : item.price_cents) + mods.reduce((s, m) => s + m.price_cents, 0);
  // only sizes, nothing else to choose: one tap adds it
  if (!groups.length) {
    return (
      <Modal title={nameOf(item.name)} onClose={onClose}>
        <div className="grid grid-cols-2 gap-2">
          {item.variants.map(x => (
            <Btn key={x.id} className="flex-col py-4" onClick={() => onPick(x.id, [])}>
              <span>{nameOf(x.name)}</span><span className="text-brand tabular">{mad(x.price_cents)}</span>
            </Btn>
          ))}
        </div>
      </Modal>
    );
  }
  return (
    <Modal wide title={nameOf(item.name)} onClose={onClose}
      footer={<div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted">{missing ? t('Choisissez : {g}', { g: nameOf(missing.name) }) : ''}</span>
        <Btn tone="brand" disabled={!!missing} onClick={() => onPick(item.variants.length ? variant : null, mods)} className="px-6 py-3 text-base">{t('Ajouter')} · {mad(total)}</Btn>
      </div>}>
      <div className="space-y-5">
        {item.variants.length > 0 && (
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.15em] text-muted">{t('Taille')}</p>
            <div className="flex flex-wrap gap-2">
              {item.variants.map(x => (
                <button key={x.id} onClick={() => setVariant(x.id)} className={`rounded-2xl px-4 py-3 font-bold ${variant === x.id ? 'gold-fill text-brand-ink' : 'bg-surface-2'}`}>
                  {nameOf(x.name)} <span className="tabular opacity-80">{mad(x.price_cents)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {groups.map(g => (
          <section key={g.id}>
            <p className="mb-2 flex justify-between text-xs font-bold uppercase tracking-[0.15em] text-muted">
              <span>{nameOf(g.name)}</span>
              <span className={countIn(g) < g.min_select ? 'text-brand' : ''}>
                {g.min_select > 0 ? (g.max_select === g.min_select ? t('{n} au choix', { n: g.min_select }) : t('au moins {n}', { n: g.min_select })) : g.max_select ? t('jusqu’à {n}', { n: g.max_select }) : t('facultatif')}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {g.options.map(o => {
                const on = picked.includes(o.id);
                return (
                  <button key={o.id} onClick={() => toggle(g, o.id)}
                    className={`rounded-2xl px-3 py-3 text-start font-bold leading-tight ${on ? 'gold-fill text-brand-ink' : 'bg-surface-2'}`}>
                    {nameOf(o.name)}
                    {Number(o.price_cents) > 0 && <span className="block text-sm tabular opacity-80">+ {mad(o.price_cents)}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}

/** Split the bill: by items (that part is paid on its own ticket) or in equal parts (amount per person). */
function SplitDialog({ order, lineName, onClose, onPayAll, onPart }: {
  order: Order; lineName: (l: Line) => string; onClose: () => void; onPayAll: () => void; onPart: (orderId: string) => void;
}) {
  const pos = usePos();
  const [mode, setMode] = useState<'items' | 'equal'>('items');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [people, setPeople] = useState(2);
  const [busy, setBusy] = useState(false);
  const total = Number(order.total_cents);
  const part = order.order_lines.reduce((s, l) => s + (qty[l.id] ?? 0) * Number(l.unit_price_cents), 0);
  const chosen = Object.entries(qty).filter(([, q]) => q > 0);
  const each = Math.ceil(total / people / 100) * 100; // rounded up to the dirham
  const bump = (l: Line, d: number) => setQty(q => ({ ...q, [l.id]: Math.max(0, Math.min(l.quantity, (q[l.id] ?? 0) + d)) }));
  const payPart = async () => {
    if (!pos.requireOnline()) return;
    setBusy(true);
    try {
      const res = await db.rpc<{ order_id: string }>('pos_split_order', { p_order_id: order.id, p_lines: chosen.map(([line_id, quantity]) => ({ line_id, quantity })) });
      await pos.reloadOrders();
      onPart(res.order_id);
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  return (
    <Modal wide title={t('Partager l’addition')} onClose={onClose}
      footer={mode === 'items'
        ? <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted">{t('Cette part')} <b className="text-lg text-ink tabular">{mad(part)}</b></span>
            <Btn tone="ok" disabled={busy || !chosen.length || part >= total + Number(order.discount_cents)} onClick={payPart} className="px-6 py-3">{t('Encaisser cette part')}</Btn></div>
        : <div className="flex justify-end"><Btn tone="ok" onClick={onPayAll} className="px-6 py-3">{t('Encaisser le total {m}', { m: mad(total) })}</Btn></div>}>
      <div className="mb-4 flex gap-2">
        {([['items', t('Par article')], ['equal', t('En parts égales')]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} className={`flex-1 rounded-xl py-2.5 font-bold ${mode === k ? 'gold-fill text-brand-ink' : 'bg-surface-2'}`}>{l}</button>
        ))}
      </div>
      {mode === 'items' ? (
        <>
          {Number(order.discount_cents) > 0 && <p className="mb-3 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">{t('Une remise est appliquée sur cette addition : partagez avant la remise, ou encaissez le total.')}</p>}
          <p className="mb-3 text-sm text-muted">{t('Choisissez ce que cette personne paie. Elle reçoit son propre ticket ; le reste reste sur la table.')}</p>
          <ul className="divide-y divide-line/[0.07]">
            {order.order_lines.map(l => (
              <li key={l.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1"><p className="font-semibold leading-tight">{lineName(l)}</p><p className="text-xs text-muted tabular">{l.quantity} × {mad(l.unit_price_cents)}</p></div>
                <div className="flex items-center gap-1">
                  <button aria-label={t('Moins')} onClick={() => bump(l, -1)} className="grid h-10 w-10 place-items-center rounded-lg bg-surface-2"><Minus className="h-4 w-4" /></button>
                  <span className="w-10 text-center font-bold tabular">{qty[l.id] ?? 0}</span>
                  <button aria-label={t('Plus')} onClick={() => bump(l, 1)} className="grid h-10 w-10 place-items-center rounded-lg bg-surface-2"><Plus className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="py-4 text-center">
          <p className="text-sm text-muted">{t('Nombre de personnes')}</p>
          <div className="mt-2 flex items-center justify-center gap-4">
            <button aria-label={t('Moins')} onClick={() => setPeople(p => Math.max(2, p - 1))} className="grid h-12 w-12 place-items-center rounded-xl bg-surface-2"><Minus className="h-5 w-5" /></button>
            <span className="w-16 font-display text-4xl font-semibold tabular">{people}</span>
            <button aria-label={t('Plus')} onClick={() => setPeople(p => Math.min(30, p + 1))} className="grid h-12 w-12 place-items-center rounded-xl bg-surface-2"><Plus className="h-5 w-5" /></button>
          </div>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-muted">{t('Par personne')}</p>
          <p className="font-display text-5xl font-semibold text-brand tabular">{mad(each)}</p>
          {each * people !== total && <p className="mt-1 text-sm text-muted">{t('Arrondi au dirham. Le dernier paie {m}.', { m: mad(total - each * (people - 1)) })}</p>}
          <p className="mt-4 text-sm text-muted">{t('Encaissez ensuite le total en « Mixte » ou en espèces : un seul ticket pour la table.')}</p>
        </div>
      )}
    </Modal>
  );
}

interface Customer { id: string; name: string | null; phone: string; points: number; visits: number }

/** The customer chip on the ticket: who, points, and the reward when there are enough points. */
function CustomerBar({ order, cust, loyalty, onPick, onRedeemed }: {
  order: Order; cust: Customer | null; loyalty: NonNullable<import('../lib/types').Restaurant['loyalty']>; onPick: () => void; onRedeemed: (c: Customer) => void;
}) {
  const pos = usePos();
  const [busy, setBusy] = useState(false);
  const need = loyalty.reward_points ?? 100;
  const known = cust && cust.id === order.customer_id ? cust : null;
  const canRedeem = !!loyalty.enabled && !!known && known.points >= need && !Number(order.discount_cents)
    && Number(order.subtotal_cents) > (loyalty.reward_cents ?? 5000);
  const redeem = async () => {
    if (!pos.requireOnline() || !known) return;
    setBusy(true);
    try {
      const res = await db.rpc<{ points: number }>('pos_redeem_points', { p_order_id: order.id });
      await pos.reloadOrders();
      onRedeemed({ ...known, points: res.points });
      pos.toast(t('Récompense utilisée'), 'ok');
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line/[0.07] bg-surface-2/60 px-4 py-2 text-sm">
      <UserRound className="h-4 w-4 text-brand" />
      {order.customer_id
        ? <span className="font-semibold">{known?.name || order.customer_name || t('Client associé')}{known && loyalty.enabled ? <span className="ms-1 text-muted">· {t('{n} points', { n: known.points })}</span> : null}</span>
        : <span className="text-muted">{t('Pas de client')}</span>}
      {order.discount_kind === 'loyalty' && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-bold text-ok">{t('Récompense appliquée')}</span>}
      <span className="ms-auto flex gap-2">
        {canRedeem && <button disabled={busy} onClick={redeem} className="flex items-center gap-1 rounded-lg bg-ok px-2.5 py-1 text-xs font-bold text-[#032A2A]"><Gift className="h-3.5 w-3.5" /> {t('Utiliser {p} pts (−{m})', { p: need, m: mad(loyalty.reward_cents ?? 5000) })}</button>}
        <button onClick={onPick} className="rounded-lg bg-surface px-2.5 py-1 text-xs font-bold text-brand">{order.customer_id ? t('Changer') : t('Client')}</button>
      </span>
    </div>
  );
}

/** Find a customer by phone, or add a new one, and attach them to the order. */
function CustomerDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (c: Customer) => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const [phone, setPhone] = useState(order.customer_phone ?? '');
  const [found, setFound] = useState<Customer | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (!pos.requireOnline()) return;
    setBusy(true);
    try { const c = await db.rpc<Customer | null>('pos_find_customer', { p_restaurant_id: r.id, p_phone: phone }); setFound(c); setName(c?.name ?? ''); }
    catch (e) { pos.fail(e); }
    setBusy(false);
  };
  const attach = async () => {
    if (!pos.requireOnline()) return;
    setBusy(true);
    try {
      const c = await db.rpc<Customer>('pos_attach_customer', { p_order_id: order.id, p_phone: phone, p_name: name.trim() || null, p_marketing_ok: found ? null : ok });
      await pos.reloadOrders();
      pos.toast(t('Client associé'), 'ok');
      onDone(c);
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={t('Client')} onClose={onClose}
      footer={found !== undefined ? <div className="flex justify-end"><Btn tone="brand" disabled={busy} onClick={attach}>{t('Associer à la commande')}</Btn></div> : undefined}>
      <div className="space-y-4">
        <Field label={t('Téléphone')}>
          <div className="flex gap-2">
            <input autoFocus className={inputCls} inputMode="tel" value={phone} onChange={e => { setPhone(e.target.value); setFound(undefined); }} placeholder="06…"
              onKeyDown={e => { if (e.key === 'Enter' && phone.replace(/\D/g, '').length >= 9) search(); }} />
            <Btn disabled={busy || phone.replace(/\D/g, '').length < 9} onClick={search}>{t('Chercher')}</Btn>
          </div>
        </Field>
        {found && (
          <div className="rounded-2xl bg-surface-2 p-4">
            <p className="text-lg font-bold">{found.name || t('Sans nom')}</p>
            <p className="text-sm text-muted">{t('{v} visite(s)', { v: found.visits })}{r.loyalty?.enabled ? ` · ${t('{n} points', { n: found.points })}` : ''}</p>
          </div>
        )}
        {found === null && (
          <>
            <p className="text-sm text-muted">{t('Nouveau client.')}</p>
            <Field label={t('Prénom (facultatif)')}><input className={inputCls} maxLength={60} value={name} onChange={e => setName(e.target.value)} /></Field>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5" checked={ok} onChange={e => setOk(e.target.checked)} />
              <span>{t('Le client accepte de recevoir nos offres sur WhatsApp')}<span className="block text-xs text-muted">{t('Demandez-lui. Sans son accord, son numéro sert seulement aux points.')}</span></span></label>
          </>
        )}
      </div>
    </Modal>
  );
}
