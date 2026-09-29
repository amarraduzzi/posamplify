import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Minus, Plus, Send, Wallet, Printer, Percent, Ban, ArrowLeftRight, QrCode, Trash2, Search, X, StickyNote, RotateCcw, Merge } from 'lucide-react';
import { tr } from '@resto/shared';
import { usePos, type OrderTarget } from '../store';
import * as db from '../lib/data';
import { mad, time, uid } from '../lib/format';
import { ticketRef } from '../lib/print';
import { PIN_ERRORS, errorMessage } from '../lib/errors';
import type { DraftLine, Item, Line, Order } from '../lib/types';
import { Btn, Field, Modal, inputCls } from './ui';
import { ManagerApproval } from './StaffGate';
import { PaymentModal } from './PaymentModal';
import { Star8 } from './Brand';
import { t } from '../lib/i18n';

type Dialog = null | 'pay' | 'discount' | 'cancel' | 'move' | 'note' | 'leave' | { void: Line } | { variants: Item } | { lineNote: string };

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
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [payId, setPayId] = useState<string | null>(null);
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

  const addItem = (i: Item, variantId: string | null = null) => {
    if (i.variants.length && !variantId) { setDialog({ variants: i }); return; }
    const v = i.variants.find(x => x.id === variantId);
    const name = tr(i.name, lang) + (v ? ` (${tr(v.name, lang)})` : '');
    setDraft(d => {
      const same = d.find(x => x.item_id === i.id && x.variant_id === variantId && !x.note);
      if (same) return d.map(x => x === same ? { ...x, quantity: x.quantity + 1 } : x);
      return [...d, { key: uid(), item_id: i.id, variant_id: variantId, name, unit_price_cents: Number(v ? v.price_cents : i.price_cents), quantity: 1, note: '', station: stationOf(i) }];
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
        <div className="scroll-thin flex-1 overflow-y-auto px-4 py-3">
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
                  <p className="text-xs text-muted">{l.kitchen_sent_at ? t('Envoyé') : <span className="text-warn">{t('Pas encore envoyé')}</span>}</p>
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
        </div>

        <div className="space-y-1 border-t border-line/[0.07] bg-bg/30 px-5 py-4 text-sm">
          {discount > 0 && <>
            <p className="flex justify-between text-muted"><span>{t('Sous-total')}</span><span className="tabular">{mad(subtotal)}</span></p>
            <p className="flex justify-between text-ok"><span>{t('Remise')}</span><span className="tabular">-{mad(discount)}</span></p>
          </>}
          <p className="flex items-baseline justify-between"><span className="text-xs font-bold uppercase tracking-[0.2em] text-muted">{t('Total')}</span><span className="font-display text-4xl font-semibold text-brand tabular">{mad(total)}</span></p>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-line/[0.07] p-3">
          <Btn tone="brand" disabled={busy || !draft.length} onClick={sendNow} className="py-4 text-base"><Send className="h-5 w-5 rtl:-scale-x-100" /> {t('Envoyer')}</Btn>
          <Btn tone="ok" disabled={busy || nothing || total <= 0} onClick={payNow} className="py-4 text-base"><Wallet className="h-5 w-5" /> {t('Encaisser')}</Btn>
          <Btn disabled={busy || !order} onClick={() => order && pos.printBill(order)}><Printer className="h-4 w-4" /> {t('Addition')}</Btn>
          <Btn disabled={busy || !order} onClick={() => pos.requireOnline() && setDialog('discount')}><Percent className="h-4 w-4" /> {t('Remise')}</Btn>
          <Btn disabled={busy || !order} onClick={() => setDialog('note')}><StickyNote className="h-4 w-4" /> {t('Note')}</Btn>
          <Btn disabled={busy || !order?.order_lines.length} onClick={resend}><RotateCcw className="h-4 w-4" /> {t('Renvoyer bon')}</Btn>
          {order?.table_id && <Btn disabled={busy} onClick={() => setDialog('move')}><ArrowLeftRight className="h-4 w-4" /> {t('Changer table')}</Btn>}
          <Btn tone="danger" disabled={busy || !order} onClick={() => pos.requireOnline() && setDialog('cancel')} className={order?.table_id ? '' : 'col-span-2'}><Ban className="h-4 w-4" /> {t('Annuler')}</Btn>
        </div>
      </aside>

      {/* ------------------------------------------------ dialogs */}
      {dialog === 'pay' && payId && <PaymentModal orderId={payId} label={label} onClose={() => setDialog(null)} onPaid={onClose} />}
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
      {dialog && typeof dialog === 'object' && 'variants' in dialog && (
        <Modal title={nameOf(dialog.variants.name)} onClose={() => setDialog(null)}>
          <div className="grid grid-cols-2 gap-2">
            {dialog.variants.variants.map(v => (
              <Btn key={v.id} className="flex-col py-4" onClick={() => { addItem(dialog.variants, v.id); setDialog(null); }}>
                <span>{nameOf(v.name)}</span><span className="text-brand tabular">{mad(v.price_cents)}</span>
              </Btn>
            ))}
          </div>
        </Modal>
      )}
      {dialog && typeof dialog === 'object' && 'lineNote' in dialog && (
        <LineNoteDialog initial={draft.find(d => d.key === dialog.lineNote)?.note ?? ''} onClose={() => setDialog(null)}
          onSave={n => { setDraft(d => d.map(x => x.key === dialog.lineNote ? { ...x, note: n } : x)); setDialog(null); }} />
      )}
      {dialog && typeof dialog === 'object' && 'void' in dialog && order && (
        <VoidDialog line={dialog.void} onClose={() => setDialog(null)} />
      )}
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
      {line.kitchen_sent_at ? (pos.online ? <>
        <p className="mb-3 text-center text-sm text-muted">{t('Déjà envoyé en cuisine : validation manager nécessaire.')}</p>
        <ManagerApproval onApprove={approve} busy={busy} error={error} />
      </> : <p className="text-center text-sm text-muted">{t('Déjà envoyé en cuisine : la validation manager demande une connexion internet.')}</p>) : <Btn tone="danger" className="w-full" onClick={() => remove().catch(pos.fail)}>{t('Retirer')}</Btn>}
    </Modal>
  );
}
