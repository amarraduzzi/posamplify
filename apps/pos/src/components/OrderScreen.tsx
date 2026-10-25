import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ArrowLeft, Minus, Plus, Send, ChevronUp, Users, UserRound, Gift, Wallet, Printer, Percent, Ban, ArrowLeftRight, QrCode, Trash2, Search, X, StickyNote, RotateCcw, Merge, Ticket, FastForward } from 'lucide-react';
import { loyaltyRewards, promoPrice, tr, type LoyaltyReward } from '@resto/shared';
import { usePos, type OrderTarget } from '../store';
import * as db from '../lib/data';
import { kg, mad, time, uid } from '../lib/format';
import { ticketRef } from '../lib/print';
import { PIN_ERRORS, errorMessage } from '../lib/errors';
import type { ChosenMod, DraftLine, Item, Line, ModGroup, Order, OrderReward } from '../lib/types';
import { Btn, Field, Modal, inputCls } from './ui';
import { ManagerApproval } from './StaffGate';
import { PaymentModal } from './PaymentModal';
import { AccountDialog } from './Reports';
import { Star8 } from './Brand';
import { t } from '../lib/i18n';
import { useIsPhone } from '../lib/phone';
import { useHappyHours } from '../lib/promo';
import { show } from '../lib/display';
import { courseName } from '../lib/stations';
import { GuestChips, GuestSheet, useGuests, type Guest } from './Guest';
import { hasMaitre, occasionOf } from '../lib/occasion';
import { CALLS, serviceDone, useServiceCalls } from '../lib/service';
import { dayPart, useQuickPicks } from '../lib/quickPicks';

type Dialog = null | 'promo' | 'pay' | 'split' | 'customer' | 'discount' | 'cancel' | 'move' | 'note' | 'leave' | { void: Line } | { pick: Item } | { lineNote: string; itemId?: string | null } | { weigh: Item };

export function OrderScreen({ target, onClose, onRetarget }: { target: OrderTarget; onClose: () => void; onRetarget: (t: OrderTarget) => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const hh = useHappyHours(r.id, r.timezone);
  // line names (kitchen bons, receipts) stay in the restaurant's main language;
  // the screen shows names in the till's language when the menu has them
  const lang = r.languages[0] ?? 'fr';
  // item names in the till's language when the menu has them (Arabic, English), else the restaurant's
  const uiLang = pos.lang === 'fr' ? lang : pos.lang;
  const nameOf = (n: Record<string, string>) => tr(n, uiLang, r.languages);
  const lineName = (l: { menu_item_id?: string | null; item_id?: string | null; variant_id: string | null; name: string; weight_g?: number | null }) => {
    if (uiLang === lang) return l.name;
    const it = pos.itemById.get((l.menu_item_id ?? l.item_id) || '');
    if (!it) return l.name;
    const v = it.variants.find(x => x.id === l.variant_id);
    return nameOf(it.name) + (v ? ` (${nameOf(v.name)})` : '') + (l.weight_g ? ` · ${kg(l.weight_g)}` : '');
  };
  const phone = useIsPhone();
  const [sheet, setSheet] = useState(false);
  // a table opened for a formule booking: the bill starts with the formule (one line per choice), to send
  const [draft, setDraft] = useState<DraftLine[]>(() => {
    const of = target.kind === 'table' ? target.guest?.offer : undefined;
    if (!of || !(of.price_cents > 0)) return [];
    const ls = Object.entries(of.choices).filter(([, n]) => Number(n) > 0).map(([c, n]) => [`${of.name} · ${c}`, Number(n)] as const);
    const rest = of.party - ls.reduce((s, [, n]) => s + n, 0);
    return [...ls, ...(rest > 0 ? [[of.name, rest] as const] : [])].map(([name, q]) => ({
      key: uid(), item_id: null, variant_id: null, name: name.slice(0, 120), unit_price_cents: of.price_cents, quantity: q, note: '', station: 'kitchen', modifiers: [], course: null }));
  });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [payId, setPayId] = useState<string | null>(null);
  // paying one part of a split bill: afterwards, back to what is left
  const [partOf, setPartOf] = useState<string | null>(null);
  // the customer of this order, as the server returned it (points to spend)
  const [cust, setCust] = useState<Customer | null>(null);
  const loyalty = r.loyalty ?? {};
  const [busy, setBusy] = useState(false);
  // phone: the dishes sold most at this time of day come first ("Populaires")
  const picks = useQuickPicks(r.id);
  const popular = useMemo(() => (picks.popular[dayPart(r.timezone)] ?? []).filter(id => pos.itemById.has(id)), [picks, r.timezone, pos.itemById]);
  const hasPopular = phone && popular.length >= 4;
  const [cat, setCat] = useState<string>(pos.categories[0]?.id ?? '');
  const [popOn, setPopOn] = useState(true);
  const showPopular = hasPopular && popOn;
  const [query, setQuery] = useState('');
  const showPhotos = localStorage.getItem('pos-photos') !== 'off';
  // new takeaway / delivery / glovo order details
  const [kind, setKind] = useState<'takeaway' | 'delivery' | 'glovo'>(target.kind === 'new' ? (target.source === 'glovo' ? 'glovo' : target.orderType) : 'takeaway');
  // a table opened for its booking: the bill is the guest's from the first dish (name and phone go with the order)
  const [customer, setCustomer] = useState(() => ({ name: target.kind === 'table' ? target.guest?.name ?? '' : '', phone: target.kind === 'table' ? target.guest?.phone ?? '' : '', address: '', ref: '' }));

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
  // a happy hour is applied by the database when the line is sent: show the same price before that
  // takeaway: the reduction of the dish or its category, applied by the database too (before the happy hour)
  const takeaway = (order?.order_type ?? (tableId ? 'dine_in' : kind === 'glovo' ? 'delivery' : kind)) === 'takeaway';
  const offOf = (i: Item) => (takeaway ? Number(i.takeaway_discount_cents ?? pos.categories.find(c => c.id === i.category_id)?.takeaway_discount_cents ?? 0) : 0);
  // Glovo: the Glovo price of each dish, size and option (exact, or the restaurant price + the Glovo markup,
  // rounded up to the dirham), the same as the database writes; no happy hour on Glovo
  const glovo = (order?.source ?? (tableId ? 'pos' : kind === 'glovo' ? 'glovo' : 'pos')) === 'glovo';
  const gm = Number(r.glovo_markup_bp ?? 0);
  const gp = (base: number, exact?: number | null) => exact != null ? Number(exact) : gm > 0 ? Math.ceil(Number(base) * (10000 + gm) / 1000000) * 100 : Number(base);
  const priced = (i: Item): Item => !glovo ? i : {
    ...i, price_cents: gp(i.price_cents, i.glovo_price_cents),
    variants: i.variants.map(v => ({ ...v, price_cents: gp(v.price_cents, v.glovo_price_cents) })),
    groups: i.groups?.map(g => ({ ...g, options: g.options.map(o => ({ ...o, price_cents: gp(o.price_cents, o.glovo_price_cents) })) })),
  };
  const hhOf = (i: Item): number => (glovo ? 0 : hh(i.id, i.category_id));
  const dUnit = (d: DraftLine, promo = true) => {
    const it = d.item_id ? pos.items.find(i => i.id === d.item_id) : null;
    if (!it) return d.unit_price_cents;
    // from the menu in the current mode, so switching takeaway / Glovo reprices the lines not yet sent
    const pi = priced(it), v = d.variant_id ? pi.variants.find(x => x.id === d.variant_id) : null;
    const opts = (pi.groups ?? []).flatMap(g => g.options);
    const mods = (d.modifiers ?? []).reduce((s, m) => s + Number(opts.find(o => o.id === m.id)?.price_cents ?? m.price_cents), 0);
    const unit = promoPrice(Math.max(0, Number(v ? v.price_cents : pi.price_cents) - offOf(it)), promo ? hhOf(it) : 0) + mods;
    // sold by weight: the price above is for 1 kg (the database rounds the same way)
    return d.weight_g ? Math.round(unit * d.weight_g / 1000) : unit;
  };
  const draftTotal = draft.reduce((s, d) => s + dUnit(d) * d.quantity, 0);
  const subtotal = Number(order?.subtotal_cents ?? 0) + draftTotal;
  const discount = Number(order?.discount_cents ?? 0);
  const total = subtotal - discount;
  const pendingQr = order && order.source === 'qr' && order.status === 'new';

  // ---- menu -----------------------------------------------------------------
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (q) return pos.items.filter(i => Object.values(i.name).some(n => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q))).map(priced);
    if (showPopular) return popular.map(id => pos.itemById.get(id)!).filter(Boolean).map(priced);
    return pos.items.filter(i => i.category_id === cat).map(priced);
  }, [pos.items, cat, query, glovo, gm, showPopular, popular]); // eslint-disable-line react-hooks/exhaustive-deps
  const courseOf = (i: Item) => pos.categories.find(c => c.id === i.category_id)?.course ?? null;
  const usesCourses = pos.categories.some(c => c.course);
  const cycleCourse = (key: string) => setDraft(d => d.map(x => x.key === key ? { ...x, course: x.course === 3 ? null : (x.course ?? 0) + 1 } : x));
  const stationOf = (i: Item) => i.station ?? pos.categories.find(c => c.id === i.category_id)?.station ?? 'kitchen';

  const addItem = (i: Item, variantId: string | null = null, mods: ChosenMod[] | null = null, weight: number | null = null) => {
    // sizes or options to choose: ask first (the same names and prices as the server will write)
    if ((i.variants.length && !variantId) || (i.groups?.length && mods === null)) { setDialog({ pick: i }); return; }
    // sold by weight: the weight read on the scale
    if (i.sold_by_weight && !weight) { setDialog({ weigh: i }); return; }
    const v = i.variants.find(x => x.id === variantId);
    const chosen = mods ?? [];
    const name = tr(i.name, lang) + (v ? ` (${tr(v.name, lang)})` : '') + (chosen.length ? ` + ${chosen.map(m => m.name).join(', ')}` : '');
    const price = Number(v ? v.price_cents : i.price_cents) + chosen.reduce((s, m) => s + Number(m.price_cents), 0);
    const sig = chosen.map(m => m.id).sort().join(',');
    if (weight) {
      // each weighing is its own line, named like the ticket: "Gâteaux secs · 0,450 kg"
      setDraft(d => [...d, { key: uid(), item_id: i.id, variant_id: null, name: `${tr(i.name, lang)} · ${kg(weight)}`.slice(0, 120), unit_price_cents: Math.round(Number(i.price_cents) * weight / 1000),
        quantity: 1, note: '', station: stationOf(i), modifiers: [], course: courseOf(i), weight_g: weight }]);
      return;
    }
    setDraft(d => {
      const same = d.find(x => x.item_id === i.id && x.variant_id === variantId && !x.note && (x.course ?? null) === courseOf(i) && (x.modifiers ?? []).map(m => m.id).sort().join(',') === sig);
      if (same) return d.map(x => x === same ? { ...x, quantity: x.quantity + 1 } : x);
      return [...d, { key: uid(), item_id: i.id, variant_id: variantId, name: name.slice(0, 120), unit_price_cents: price, quantity: 1, note: '', station: stationOf(i), modifiers: chosen, course: courseOf(i) }];
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
      // the occasion of the booking goes to the kitchen with the first bon
      note: !order && target.kind === 'table' ? occasionOf(target.guest?.occasion)?.kitchen ?? null : null,
    }, draft.map(d => ({ ...d, unit_price_cents: dUnit(d) })), { send });
    setDraft([]);
    if (target.kind === 'new') onRetarget({ kind: 'order', orderId: o.id });
    return o;
  };

  const sendNow = () => run(async () => { await commit(true); });
  // nothing to pay on this table (empty, or only free items): one tap frees it, no PIN (the server agrees)
  const freeOrder = !!order && Number(order.total_cents) === 0 && !draft.length && order.source !== 'qr';
  // a reward or an approved discount covers the whole bill: it is closed at 0 DH (a ticket, no payment)
  const covered = !!order && !draft.length && total === 0 && Number(order.discount_cents) > 0 && order.order_lines.length > 0;
  const freeTable = () => run(async () => {
    if (!order || !pos.requireOnline()) return;
    const res = await db.rpc<{ ok: boolean; error?: string }>('cancel_order', { p_order_id: order.id, p_reason: null, p_manager_staff_id: null, p_pin: null });
    if (!res.ok) { setDialog('cancel'); return; }
    await pos.reloadOrders();
    try { navigator.vibrate?.(40); } catch { /* not supported */ }
    pos.toast(t('{l} libérée', { l: label }), 'ok');
    onClose();
  });
  // phone at the table: a clear confirmation, a short buzz, then back to the tables for the next one
  const sendPhone = () => run(async () => {
    const n = draft.reduce((s, d) => s + d.quantity, 0);
    const o = await commit(true);
    if (!o) return;
    try { navigator.vibrate?.(60); } catch { /* not supported */ }
    pos.toast(t('Envoyé : {n} article(s), {l}', { n, l: label }), 'ok');
    onClose();
  });
  // the last draft line of a dish (the one − and "précision" act on)
  const lastDraft = (itemId: string) => [...draft].reverse().find(d => d.item_id === itemId) ?? null;
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
  const nextCourse = order && order.order_lines.some(l => l.held) ? Math.min(...order.order_lines.filter(l => l.held).map(l => l.course ?? 9)) : null;
  const fireBtn = nextCourse != null && order ? (
    <Btn tone="brand" disabled={busy} onClick={() => run(() => pos.fireNext(order))} className="col-span-2 py-3.5 text-base">
      <FastForward className="h-5 w-5 rtl:-scale-x-100" /> {t('Envoyer la suite : {c}', { c: courseName(nextCourse) || t('suite') })} ({order.order_lines.filter(l => l.held && (l.course ?? 9) === nextCourse).reduce((n, l) => n + l.quantity, 0)})
    </Btn>
  ) : null;
  // the screen turned to the guest follows this ticket
  useEffect(() => {
    show(r, nothing ? { mode: 'idle' } : { mode: 'order', label, subtotal, discount, promo: order?.discount_kind === 'promo', total,
      lines: [...(order?.order_lines ?? []).map(l => ({ q: l.quantity, name: lineName(l), total: Number(l.line_total_cents), list: l.list_price_cents ? Number(l.list_price_cents) * l.quantity : undefined })),
              ...draft.map(d => ({ q: d.quantity, name: lineName(d), total: dUnit(d) * d.quantity, list: dUnit(d) < dUnit(d, false) ? dUnit(d, false) * d.quantity : undefined }))] });
  }, [order, draft, label]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => show(r, { mode: 'idle' }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // the order's guest (allergies, VIP, points), loaded when a bill with a customer is opened
  useEffect(() => {
    if (!loyalty.customers || !order?.customer_id || cust?.id === order.customer_id || !pos.online) return;
    let gone = false;
    db.rpc<Customer | null>('pos_order_customer', { p_order_id: order.id }).then(c => { if (!gone && c) setCust(c); }).catch(() => {});
    return () => { gone = true; };
  }, [order?.id, order?.customer_id, loyalty.customers, pos.online]); // eslint-disable-line react-hooks/exhaustive-deps
  const booked = useGuests([], [target.kind === 'table' && !order ? target.guest?.phone : null]);
  const bookedGuest = target.kind === 'table' && !order && target.guest ? booked.byPhone(target.guest.phone) : null;

  // a guest of this table called (Le service discret): the waiter who opens the table sees it and answers
  const svc = useServiceCalls(r.id, hasMaitre(r));
  const tCalls = svc.filter(c => c.table_id === (order?.table_id ?? tableId));

  const banners = <>
    {tCalls.length > 0 && (
      <div className="flex flex-wrap items-center gap-2 bg-violet-500 px-4 py-2 text-sm font-bold text-white">
        {tCalls.map(c => { const C = CALLS[c.kind]; return <span key={c.id} className="inline-flex items-center gap-1"><C.Icon className="h-4 w-4" />{C.label()}</span>; })}
        <button onClick={() => serviceDone(r.id, { tableId: tCalls[0].table_id }, pos.staff?.id ?? null).catch(e => pos.fail(e))}
          className="ms-auto rounded-lg bg-white px-3 py-1 text-violet-700">{t('C’est fait')}</button>
      </div>
    )}
    {target.kind === 'table' && !order && target.guest && (
      <div className="flex flex-wrap items-center gap-2 border-b border-line/[0.07] bg-sky-500/10 px-4 py-2 text-sm">
        <CalendarClock className="h-4 w-4 text-sky-500" />
        <span className="font-semibold">{t('Réservation : {n}', { n: target.guest.name })}</span>
        {occasionOf(target.guest.occasion) && <span className="inline-flex items-center gap-1 rounded-full bg-pink-500/20 px-2 py-0.5 text-xs font-bold text-pink-400">{occasionOf(target.guest.occasion)!.label()}</span>}
        <GuestChips g={bookedGuest} />
      </div>
    )}
    {loyalty.customers && order && (
      <CustomerBar order={order} cust={cust} loyalty={loyalty} onPick={() => setDialog('customer')} onRedeemed={c => setCust(c)} onAdd={addItem} />
    )}
        {pendingQr && (
          <div className="flex items-center gap-2 bg-qr px-4 py-2.5 text-sm font-bold text-white">
            <QrCode className="h-4 w-4" /> {t('Commande client à accepter')}{order!.table_by_guest ? <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{t('Table saisie par le client')}</span> : null}
            <button disabled={busy} onClick={() => run(() => pos.acceptQr(order!))} className="ms-auto rounded-lg bg-white px-3 py-1 text-qr">{pos.restaurant?.boccadillos ? t('Encaisser et envoyer en cuisine') : t('Accepter')}</button>
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
                  <p className="text-xs text-muted">{l.course ? `${courseName(l.course)} · ` : ''}{l.held ? <span className="font-semibold text-brand">{t('En attente de la suite')}</span> : l.kitchen_sent_at ? (l.served_at ? t('Servi') : l.ready_at ? t('Prêt') : t('Envoyé')) : l.print_requested_at ? t('Envoyé (bon à la caisse)') : <span className="text-warn">{t('Pas encore envoyé')}</span>}</p>
                </div>
                <span className="text-end font-semibold tabular">{Number(l.list_price_cents) > Number(l.unit_price_cents) && <span className="block text-xs font-normal text-muted line-through">{mad(Number(l.list_price_cents) * l.quantity)}</span>}{mad(l.line_total_cents)}</span>
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
                  <span className="flex flex-wrap gap-x-3">
                    <button onClick={() => setDialog({ lineNote: d.key })} className="text-xs text-brand">{d.note ? `“${d.note}”` : t('+ précision')}</button>
                    {(usesCourses || d.course) && <button onClick={() => cycleCourse(d.key)} className="rounded-md bg-surface-2 px-1.5 text-xs font-semibold text-muted">{d.course ? courseName(d.course) : t('Sans service')}</button>}
                  </span>
                </div>
                <span className="font-semibold tabular">{mad(dUnit(d) * d.quantity)}</span>
              </li>
            ))}
          </ul>
          {order?.note && <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm"><b>{t('Note :')}</b> {order.note}</p>}
    </>;
  const totalsBox = <>
        <div className="space-y-1 border-t border-line/[0.07] bg-bg/30 px-5 py-4 text-sm">
          {discount > 0 && <>
            <p className="flex justify-between text-muted"><span>{t('Sous-total')}</span><span className="tabular">{mad(subtotal)}</span></p>
            <p className="flex justify-between text-ok"><span>{order?.discount_kind === 'promo' ? t('Code promo') : t('Remise')}</span><span className="tabular">-{mad(discount)}</span></p>
          </>}
          <p className="flex items-baseline justify-between"><span className="text-xs font-bold uppercase tracking-[0.2em] text-muted">{t('Total')}</span><span className="font-display text-4xl font-semibold text-brand tabular">{mad(total)}</span></p>
        </div>
    </>;
  const actionsGrid = <>
        <div className="grid grid-cols-2 gap-2 border-t border-line/[0.07] p-3">
          {fireBtn}
          <Btn tone="brand" disabled={busy || !draft.length} onClick={sendNow} className="py-4 text-base"><Send className="h-5 w-5 rtl:-scale-x-100" /> {t('Envoyer')}</Btn>
          <Btn tone="ok" disabled={busy || nothing || (total <= 0 && !covered)} onClick={payNow} className="py-4 text-base"><Wallet className="h-5 w-5" /> {t('Encaisser')}</Btn>
          <Btn disabled={busy || !order} onClick={() => order && pos.printBill(order)}><Printer className="h-4 w-4" /> {t('Addition')}</Btn>
          <Btn disabled={busy || !order || !order.order_lines.length || draft.length > 0} onClick={() => setDialog('split')}><Users className="h-4 w-4" /> {t('Partager')}</Btn>
          <Btn disabled={busy || !order} onClick={() => pos.requireOnline() && setDialog('discount')}><Percent className="h-4 w-4" /> {t('Remise')}</Btn>
          <Btn disabled={busy || !order} onClick={() => setDialog('note')}><StickyNote className="h-4 w-4" /> {t('Note')}</Btn>
          <Btn disabled={busy || !order || !order.order_lines.length} onClick={() => pos.requireOnline() && setDialog('promo')}><Ticket className="h-4 w-4" /> {order?.discount_kind === 'promo' ? t('Retirer le code') : t('Code promo')}</Btn>
          <Btn disabled={busy || !order?.order_lines.length} onClick={resend}><RotateCcw className="h-4 w-4" /> {t('Renvoyer bon')}</Btn>
          {order?.table_id && <Btn disabled={busy} onClick={() => setDialog('move')}><ArrowLeftRight className="h-4 w-4" /> {t('Changer table')}</Btn>}
          {freeOrder
            ? <Btn tone="danger" disabled={busy} onClick={freeTable} className={order?.table_id ? '' : 'col-span-2'}><Ban className="h-4 w-4" /> {order?.table_id ? t('Libérer la table') : t('Supprimer')}</Btn>
            : <Btn tone="danger" disabled={busy || !order} onClick={() => pos.requireOnline() && setDialog('cancel')} className={order?.table_id ? '' : 'col-span-2'}><Ban className="h-4 w-4" /> {t('Annuler')}</Btn>}
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
      {dialog === 'promo' && order && <PromoDialog order={order} onClose={() => setDialog(null)} />}
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
      {dialog && typeof dialog === 'object' && 'weigh' in dialog && (
        <WeighDialog name={nameOf(dialog.weigh.name)} perKg={dUnit({ key: '', item_id: dialog.weigh.id, variant_id: null, name: '', unit_price_cents: dialog.weigh.price_cents, quantity: 1, note: '', station: '' })}
          onClose={() => setDialog(null)} onWeigh={g => { addItem(dialog.weigh, null, [], g); setDialog(null); }} />
      )}
      {dialog && typeof dialog === 'object' && 'lineNote' in dialog && (
        <LineNoteDialog initial={draft.find(d => d.key === dialog.lineNote)?.note ?? ''} onClose={() => setDialog(null)}
          learned={[...(picks.notes[dialog.itemId ?? draft.find(d => d.key === dialog.lineNote)?.item_id ?? ''] ?? []), ...picks.common_notes]}
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
          <div className="space-y-2 border-b border-line/[0.07] bg-surface px-3 py-2">
            <div className="flex gap-2 overflow-x-auto">
              {(['takeaway', 'delivery', 'glovo'] as const).map(k => (
                <button key={k} onClick={() => setKind(k)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-bold ${kind === k ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`}>
                  {k === 'takeaway' ? t('À emporter') : k === 'delivery' ? t('Livraison (tél.)') : 'Glovo'}
                </button>
              ))}
            </div>
            {/* the same details as on the till: a delivery cannot be sent without its address */}
            {kind === 'glovo'
              ? <input className={`${inputCls} py-2`} placeholder={t('Réf. Glovo')} value={customer.ref} onChange={e => setCustomer({ ...customer, ref: e.target.value })} />
              : <div className="grid grid-cols-2 gap-2">
                  <input className={`${inputCls} py-2`} placeholder={t('Nom')} value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} />
                  <input className={`${inputCls} py-2`} inputMode="tel" placeholder={t('Téléphone')} value={customer.phone} onChange={e => setCustomer({ ...customer, phone: e.target.value })} />
                </div>}
            {kind === 'delivery' && <input className={`${inputCls} py-2`} placeholder={t('Adresse de livraison')} value={customer.address} onChange={e => setCustomer({ ...customer, address: e.target.value })} />}
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
              {hasPopular && (
                <button onClick={() => setPopOn(true)}
                  className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-bold ${showPopular ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`}>★ {t('Populaires')}</button>
              )}
              {pos.categories.map(c => (
                <button key={c.id} onClick={() => { setCat(c.id); setPopOn(false); }}
                  className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-bold ${!showPopular && cat === c.id ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`}>
                  {c.icon ? `${c.icon} ` : ''}{nameOf(c.name)}
                </button>
              ))}
            </div>
          )}
        </div>
        <ul className="scroll-thin flex-1 divide-y divide-line/[0.07] overflow-y-auto">
          {visibleItems.map(i => {
            const inDraft = draft.filter(d => d.item_id === i.id).reduce((n, d) => n + d.quantity, 0);
            const last = inDraft ? lastDraft(i.id) : null;
            return (
              <li key={i.id} className={`flex items-center gap-2 pe-3 ${inDraft ? 'bg-brand/[0.07]' : ''}`}>
                <button onClick={() => addItem(i)} disabled={!i.available}
                  onContextMenu={e => { e.preventDefault(); if (last) setDialog({ lineNote: last.key, itemId: i.id }); }}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3.5 ps-4 text-start active:bg-surface-2 disabled:opacity-35">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-tight">{nameOf(i.name)}</span>
                    <span className="text-sm text-brand tabular">{i.variants.length ? t('{n} options', { n: i.variants.length }) : mad(Math.max(0, i.price_cents - offOf(i)))}{i.sold_by_weight ? ' / kg' : ''}{!i.available && ` · ${t('épuisé')}`}</span>
                    {i.available && hhOf(i) > 0 && <span className="ms-2 rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-bold text-ok">-{hhOf(i) / 100}%</span>}
                    {i.available && (pos.stockLow[i.id] ?? 99) <= 5 && <span className={`ms-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${pos.stockLow[i.id] <= 2 ? 'bg-danger/15 text-danger' : 'bg-warn/15 text-warn'}`}>{t('plus que {n}', { n: pos.stockLow[i.id] })}</span>}
                  </span>
                </button>
                {last && (
                  <button onClick={() => setDialog({ lineNote: last.key, itemId: i.id })}
                    className={`max-w-[6.5rem] shrink truncate rounded-full px-2.5 py-1.5 text-xs font-semibold ${last.note ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-muted'}`}>
                    {last.note || t('+ précision')}
                  </button>
                )}
                {inDraft > 0 ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <button onClick={() => last && bump(last.key, -1)} aria-label={t('Retirer')} className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 active:scale-95"><Minus className="h-5 w-5" /></button>
                    <span className="w-6 text-center text-lg font-bold tabular">{inDraft}</span>
                    <button onClick={() => addItem(i)} aria-label={t('Ajouter')} className="grid h-10 w-10 place-items-center rounded-full bg-brand text-brand-ink active:scale-95"><Plus className="h-5 w-5" /></button>
                  </span>
                ) : (
                  <button onClick={() => addItem(i)} disabled={!i.available} aria-label={t('Ajouter')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-brand active:scale-95 disabled:opacity-35"><Plus className="h-5 w-5" /></button>
                )}
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
          {freeOrder
            ? <Btn tone="danger" disabled={busy} onClick={freeTable} className="px-4 text-base"><Ban className="h-5 w-5" /> {t('Libérer')}</Btn>
            : <Btn tone="brand" disabled={busy || !draft.length} onClick={sendPhone} className="px-5 text-base"><Send className="h-5 w-5 rtl:-scale-x-100" /> {t('Envoyer')}</Btn>}
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
              {fireBtn}
              {freeOrder
                ? <Btn tone="danger" disabled={busy} onClick={() => { setSheet(false); freeTable(); }} className="col-span-2 py-4 text-base"><Ban className="h-5 w-5" /> {order?.table_id ? t('Libérer la table') : t('Supprimer')}</Btn>
                : <Btn tone="brand" disabled={busy || !draft.length} onClick={() => { setSheet(false); sendPhone(); }} className="col-span-2 py-4 text-base"><Send className="h-5 w-5 rtl:-scale-x-100" /> {t('Envoyer en cuisine')}</Btn>}
              <Btn disabled={busy || !order} onClick={() => setDialog('note')}><StickyNote className="h-4 w-4" /> {t('Note')}</Btn>
              {order?.table_id ? <Btn disabled={busy} onClick={() => setDialog('move')}><ArrowLeftRight className="h-4 w-4" /> {t('Changer table')}</Btn>
                : <Btn disabled={busy} onClick={() => setSheet(false)}>{t('Ajouter')}</Btn>}
              <p className="col-span-2 pt-1 text-center text-xs text-muted">{t('L’encaissement se fait à la caisse.')}</p>
              {/* an order with money: a manager approves the cancel (same as the till), kept quiet so nobody taps it by mistake */}
              {order && !freeOrder && <button disabled={busy} onClick={() => pos.requireOnline() && setDialog('cancel')} className="col-span-2 mx-auto mt-1 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/10"><Ban className="h-4 w-4" /> {t('Annuler la commande')}</button>}
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
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-brand tabular">
                      {i.variants.length ? t('{n} options', { n: i.variants.length }) : mad(Math.max(0, i.price_cents - offOf(i)))}{i.sold_by_weight ? ' / kg' : ''}{!i.available && ` · ${t('épuisé')}`}
                      {i.available && hhOf(i) > 0 && <span className="rounded-full bg-ok px-2 py-0.5 text-[11px] font-bold text-[#032A2A]">-{hhOf(i) / 100}%</span>}
                      {i.available && (pos.stockLow[i.id] ?? 99) <= 5 && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${pos.stockLow[i.id] <= 2 ? 'bg-danger text-white' : 'bg-warn text-[#1B1300]'}`}>{t('plus que {n}', { n: pos.stockLow[i.id] })}</span>}
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

function PromoDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState(order.customer_phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = order.discount_kind === 'promo';
  const run = async () => {
    setBusy(true); setError(null);
    try {
      if (active) await db.rpc('pos_remove_promo', { p_order_id: order.id });
      else {
        if (phone.trim() && phone.trim() !== (order.customer_phone ?? '')) await db.rpc('pos_attach_customer', { p_order_id: order.id, p_phone: phone.trim(), p_name: order.customer_name, p_marketing_ok: null });
        const res = await db.rpc<{ discount_cents: number }>('pos_apply_promo', { p_order_id: order.id, p_code: code.trim() });
        pos.toast(t('Code appliqué : -{m}', { m: mad(Number(res.discount_cents)) }), 'ok');
      }
      await pos.reloadOrders(); onClose();
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };
  return (
    <Modal title={active ? t('Retirer le code promo') : t('Code promo')} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Btn onClick={onClose}>{t('Fermer')}</Btn><Btn tone={active ? 'danger' : 'brand'} disabled={busy || (!active && code.trim().length < 3)} onClick={run}>{active ? t('Retirer') : t('Appliquer')}</Btn></div>}>
      {active ? <p>{t('Le code promo de cette commande ({m}) sera retiré.', { m: mad(Number(order.discount_cents)) })}</p> : (
        <div className="space-y-3">
          <Field label={t('Code')}><input autoFocus className={`${inputCls} font-mono text-lg uppercase`} value={code} maxLength={20} onChange={e => setCode(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && code.trim().length >= 3 && run()} /></Field>
          {r.loyalty?.customers && <Field label={t('Téléphone du client (si le code est limité à une fois par client)')}><input className={inputCls} inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="06…" /></Field>}
        </div>
      )}
      {error && <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
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

/** Sold by weight: the weight read on the scale, in grams or kilos, with the price it makes. */
function WeighDialog({ name, perKg, onClose, onWeigh }: { name: string; perKg: number; onClose: () => void; onWeigh: (g: number) => void }) {
  const [val, setVal] = useState('');
  const [unit, setUnit] = useState<'g' | 'kg'>('g');
  const n = Number(val.replace(',', '.')) || 0;
  const g = Math.round(unit === 'kg' ? n * 1000 : n);
  const ok = g >= 1 && g <= 100000;
  const ok2 = () => { if (ok) onWeigh(g); };
  return (
    <Modal title={name} onClose={onClose} footer={<div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted">{mad(perKg)} / kg</span>
      <Btn tone="brand" disabled={!ok} onClick={ok2}>{ok ? `${t('Ajouter')} · ${mad(Math.round(perKg * g / 1000))}` : t('Ajouter')}</Btn></div>}>
      <p className="mb-3 text-sm text-muted">{t('Le poids lu sur la balance.')}</p>
      <div className="flex gap-2">
        <input autoFocus inputMode="decimal" className={`${inputCls} text-2xl font-bold tabular`} value={val} aria-label={t('Poids')}
          onChange={e => setVal(e.target.value.replace(/[^\d.,]/g, ''))} onKeyDown={e => { if (e.key === 'Enter') ok2(); }} placeholder={unit === 'g' ? '450' : '0,450'} />
        <div className="flex shrink-0 rounded-2xl bg-surface-2 p-1">
          {(['g', 'kg'] as const).map(u => <button key={u} type="button" onClick={() => setUnit(u)} className={`rounded-xl px-4 font-bold ${unit === u ? 'bg-surface shadow-sm' : 'text-muted'}`}>{u}</button>)}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {[250, 500, 750, 1000].map(x => <button key={x} type="button" onClick={() => onWeigh(x)} className="rounded-full bg-surface-2 px-3.5 py-2 text-sm font-semibold tabular">{x < 1000 ? `${x} g` : '1 kg'}</button>)}
      </div>
      {n > 0 && !ok && <p className="mt-2 text-sm font-semibold text-danger">{t('Entre 1 g et 100 kg.')}</p>}
    </Modal>
  );
}

function LineNoteDialog({ initial, onClose, onSave, learned = [] }: { initial: string; onClose: () => void; onSave: (n: string) => void; learned?: string[] }) {
  const [note, setNote] = useState(initial);
  // what staff typed most often for this dish (and overall) first, then the usual ones
  const DEFAULTS = ['Sans oignon', 'Bien cuit', 'Saignant', 'Sans sucre', 'Épicé', 'À part'];
  const seen = new Set<string>();
  const chips = [...learned.map(x => ({ x, mine: true })), ...DEFAULTS.map(x => ({ x, mine: false }))]
    .filter(c => { const k = c.x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
  return (
    <Modal title={t('Précision pour la cuisine')} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" onClick={() => onSave(note.trim())}>{t('OK')}</Btn></div>}>
      {/* the kitchen bon is printed in French: the chips insert French text whatever the till language */}
      <div className="mb-3 flex flex-wrap gap-2">
        {chips.map(({ x, mine }) => <button key={x} onClick={() => setNote(n => n ? `${n}, ${x.toLowerCase()}` : x)} className={`rounded-full px-3.5 py-2 text-sm font-semibold ${mine ? 'bg-brand/15 text-brand' : 'bg-surface-2'}`}>{mine ? x : t(x)}</button>)}
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

interface Customer extends Partial<Omit<Guest, 'id' | 'name' | 'phone' | 'visits'>> { id: string; name: string | null; phone: string; points: number; visits: number; credit_allowed?: boolean; credit_limit_cents?: number | null; balance_cents?: number }

/** The customer chip on the ticket: who, points, and the reward when there are enough points. */
function CustomerBar({ order, cust, loyalty, onPick, onRedeemed, onAdd }: {
  order: Order; cust: Customer | null; loyalty: NonNullable<import('../lib/types').Restaurant['loyalty']>; onPick: () => void; onRedeemed: (c: Customer) => void; onAdd: (i: Item) => void;
}) {
  const pos = usePos();
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [settle, setSettle] = useState(false);
  const [freeOpen, setFreeOpen] = useState(false);
  // savings mode: 1 point = 1 DH, the customer pays with them; the menu up to his savings is free for him
  const value = loyalty.mode === 'value';
  // what was earned today waits for the next visit: the till asks what can be spent now
  const [spendable, setSpendable] = useState<{ id: string; points: number; spendable: number } | null>(null);
  const maitre = hasMaitre(pos.restaurant);
  const rewards = loyaltyRewards(loyalty);
  const known = cust && cust.id === order.customer_id ? cust : null;
  const applied = (order.order_rewards ?? []).filter(x => !x.released_at);
  const max = Math.max(1, loyalty.max_per_order ?? 1);
  const sofar = applied.reduce((n, x) => n + Number(x.cents), 0);
  // rewards can be added while the bill has no manager discount or promo code, and the maximum is not reached
  const open = !!loyalty.enabled && !!known && !(Number(order.discount_cents) > 0 && order.discount_kind !== 'loyalty') && (value ? !applied.some(x => x.reward_id === 'value') : applied.length < max);
  useEffect(() => {
    if (!value || !known || !pos.online) return;
    let gone = false;
    db.rpc<{ points: number; spendable: number }>('loyalty_spendable', { p_restaurant_id: pos.restaurant!.id, p_customer_id: known.id })
      .then(x => { if (!gone) setSpendable({ id: known.id, ...x }); }, () => { /* the button stays off */ });
    return () => { gone = true; };
  }, [value, known?.id, known?.points, pos.online]); // eslint-disable-line react-hooks/exhaustive-deps
  const saved = known ? Number(known.points) * 100 : 0;
  const sp = known && spendable?.id === known.id ? Math.min(Number(spendable.spendable), Number(known.points)) : 0;
  const later = known ? Number(known.points) - sp : 0;
  const usable = value && open && sp > 0 && sp >= (loyalty.min_points ?? 0);
  const useNow = Math.min(sp * 100, Number(order.subtotal_cents) - sofar);
  const free = value && known ? pos.items.filter(i => i.available && !i.sold_by_weight && !i.variants.length && Number(i.price_cents) > 0 && Number(i.price_cents) <= sp * 100)
    .sort((x, y) => Number(y.price_cents) - Number(x.price_cents)) : [];
  const useSavings = async () => {
    if (!pos.requireOnline() || !known) return;
    setBusy(true);
    try {
      const res = await db.rpc<{ points: number; cents: number }>('pos_redeem_value', { p_order_id: order.id, p_cents: null });
      await pos.reloadOrders();
      onRedeemed({ ...known, points: res.points });
      pos.toast(t('Cagnotte utilisée : −{m}', { m: mad(Number(res.cents)) }), 'ok');
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  /** what a reward would take off, and whether the bill can carry it (the rewards together may cover the bill, never more) */
  const fit = (rw: LoyaltyReward) => {
    if (rw.kind !== 'item') return { there: true, ok: Number(order.subtotal_cents) >= sofar + (rw.cents ?? 0) };
    const lines = order.order_lines.filter(l => l.menu_item_id === rw.item_id);
    const there = lines.reduce((n, l) => n + Number(l.quantity), 0) > applied.filter(x => x.menu_item_id === rw.item_id).length;
    return { there, ok: !there || Number(order.subtotal_cents) >= sofar + Math.min(...lines.map(l => Number(l.unit_price_cents))) };
  };
  const redeem = async (rw: LoyaltyReward) => {
    if (!pos.requireOnline() || !known) return;
    setBusy(true);
    try {
      const res = await db.rpc<{ points: number }>('pos_redeem_reward', { p_order_id: order.id, p_reward_id: rw.id });
      await pos.reloadOrders();
      onRedeemed({ ...known, points: res.points });
      pos.toast(t('Récompense utilisée'), 'ok');
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  // a mistake at the till: take one reward off, the points come back
  const release = async (x: OrderReward) => {
    if (!pos.requireOnline()) return;
    setBusy(true);
    try {
      const res = await db.rpc<{ points: number | null }>('pos_release_reward', { p_order_reward_id: x.id });
      await pos.reloadOrders();
      if (known && res.points != null) onRedeemed({ ...known, points: res.points });
      pos.toast(t('Récompense retirée'), 'ok');
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line/[0.07] bg-surface-2/60 px-4 py-2 text-sm">
      <UserRound className="h-4 w-4 text-brand" />
      {order.customer_id
        ? <button disabled={!maitre} onClick={() => setSheet(true)} className={`font-semibold ${maitre ? 'underline decoration-line/30 underline-offset-4 hover:decoration-brand' : ''}`}>{known?.name || order.customer_name || t('Client associé')}{known && loyalty.enabled ? <span className="ms-1 text-muted">· {value ? t('Cagnotte {m}', { m: mad(saved) }) : t('{n} points', { n: known.points })}</span> : null}</button>
        : <span className="text-muted">{t('Pas de client')}</span>}
      {maitre && known?.tags && <GuestChips g={known as Guest} />}
      {sheet && order.customer_id && <GuestSheet customerId={order.customer_id} onClose={() => setSheet(false)} onSaved={g => onRedeemed({ ...(known ?? { points: 0 }), ...g } as Customer)} />}
      {known && Number(known.balance_cents ?? 0) !== 0 && <button onClick={() => setSettle(true)} title={t('Régler une ardoise')} className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-bold text-warn underline decoration-warn/30 underline-offset-2">{t('Ardoise {m}', { m: mad(Number(known.balance_cents)) })}</button>}
      {settle && known && <AccountDialog phone0={known.phone} onClose={() => setSettle(false)} onDone={b => onRedeemed({ ...known, balance_cents: b ?? known.balance_cents })} />}
      {applied.map(x => (
        <span key={x.id} className="inline-flex items-center gap-1 rounded-full bg-ok/15 py-0.5 ps-2 pe-1 text-xs font-bold text-ok">
          <Gift className="h-3 w-3" />{x.name || (x.kind === 'item' ? t('Produit') : t('Remise fidélité'))} · −{mad(Number(x.cents))}
          <button disabled={busy} onClick={() => release(x)} aria-label={t('Retirer la récompense')} title={t('Retirer la récompense')} className="rounded-full p-0.5 hover:bg-ok/20 disabled:opacity-40"><X className="h-3 w-3" /></button>
        </span>
      ))}
      {order.discount_kind === 'loyalty' && applied.length === 0 && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-bold text-ok">{t('Récompense appliquée')}</span>}
      <span className="ms-auto flex flex-wrap justify-end gap-2">
        {value && free.length > 0 && <button onClick={() => setFreeOpen(o => !o)} className="flex items-center gap-1 rounded-lg bg-ok/15 px-2.5 py-1 text-xs font-bold text-ok"><Gift className="h-3.5 w-3.5" /> {t('Gratuit pour lui ({n})', { n: free.length })}</button>}
        {usable && useNow > 0 && <button disabled={busy} onClick={useSavings} className="flex items-center gap-1 rounded-lg bg-ok px-2.5 py-1 text-xs font-bold text-[#032A2A] disabled:opacity-40"><Wallet className="h-3.5 w-3.5" /> {t('Utiliser la cagnotte (−{m})', { m: mad(useNow) })}</button>}
        {value && later > 0 && <span className="text-xs text-muted">{t('{m} gagnés aujourd’hui : à la prochaine visite', { m: mad(later * 100) })}</span>}
        {value && open && sp > 0 && !usable && <span className="text-xs text-muted">{t('Cagnotte utilisable dès {m}', { m: mad((loyalty.min_points ?? 0) * 100) })}</span>}
        {!value && open && rewards.filter(rw => known!.points >= rw.points && fit(rw).ok).map(rw => {
          // a free dish needs a unit of that dish on the ticket that is not free yet
          const there = fit(rw).there;
          return (
            <button key={rw.id} disabled={busy || !there} onClick={() => redeem(rw)} title={there ? undefined : t('Ajoutez d’abord ce produit à la commande')}
              className="flex items-center gap-1 rounded-lg bg-ok px-2.5 py-1 text-xs font-bold text-[#032A2A] disabled:opacity-40"><Gift className="h-3.5 w-3.5" />
              {' '}{rw.kind === 'item' ? t('{n} offert · {p} pts', { n: rw.label || t('Produit'), p: rw.points }) : t('Utiliser {p} pts (−{m})', { p: rw.points, m: mad(rw.cents ?? 0) })}
            </button>
          );
        })}
        <button onClick={onPick} className="rounded-lg bg-surface px-2.5 py-1 text-xs font-bold text-brand">{order.customer_id ? t('Changer') : t('Client')}</button>
      </span>
      {freeOpen && free.length > 0 && (
        <div className="flex w-full flex-wrap gap-1.5 pt-1">
          <span className="w-full text-xs text-muted">{t('Avec sa cagnotte de {m}, ces produits sont gratuits. Touchez pour ajouter.', { m: mad(sp * 100) })}</span>
          {free.slice(0, 24).map(i => (
            <button key={i.id} onClick={() => onAdd(i)} className="rounded-lg bg-surface px-2.5 py-1 text-xs font-semibold hover:bg-ok/15">{tr(i.name, pos.lang)} · {mad(Number(i.price_cents))}</button>
          ))}
        </div>
      )}
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
            {found.credit_allowed !== undefined && (found.credit_allowed || Number(found.balance_cents ?? 0) !== 0) && (
              <p className="mt-1 text-sm">{t('Ardoise')} : <b className="tabular">{mad(Number(found.balance_cents ?? 0))}</b>{found.credit_allowed ? <span className="text-muted"> / {t('plafond {m}', { m: mad(Number(found.credit_limit_cents ?? 0)) })}</span> : null}</p>
            )}
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
