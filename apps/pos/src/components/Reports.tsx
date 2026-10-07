import { useEffect, useState } from 'react';
import { Printer, Lock, ArrowDownCircle, Banknote, Archive, RefreshCw, NotebookPen, CreditCard, Landmark, CheckCircle2, PackageX, Minus, Plus, Search, MessageCircle } from 'lucide-react';
import { tr } from '@resto/shared';
import { usePos } from '../store';
import * as db from '../lib/data';
import * as P from '../lib/print';
import { mad, methodLabel, time, toCents } from '../lib/format';
import { PIN_ERRORS, errorMessage } from '../lib/errors';
import type { CashMovement, DayReport } from '../lib/types';
import { Btn, Field, Modal, inputCls } from './ui';
import { ManagerApproval } from './StaffGate';
import { t } from '../lib/i18n';

export function ReportsView() {
  const pos = usePos();
  const r = pos.restaurant!;
  const [rep, setRep] = useState<DayReport | null>(null);
  const [moves, setMoves] = useState<CashMovement[]>([]);
  const [dialog, setDialog] = useState<null | 'float' | 'payout' | 'z' | 'account' | 'waste'>(null);
  const stockOn = !!r.products?.includes('profit');
  const creditOn = !!r.loyalty?.customers && !!r.loyalty?.credit;
  const load = async () => {
    try {
      const x = await db.dayReport(r.id);
      setRep(x); pos.setDayClosed(!!x.closed);
      setMoves(await db.cashMovements(r.id, x.business_date));
    } catch (e) { pos.fail(e); }
  };
  useEffect(() => { load(); }, [pos.orders.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const printRep = async (title: string, x: DayReport) => {
    try { await P.print(P.receiptPrinter(pos.settings), title, P.reportTicket(r, x, title)); } catch (e) { pos.fail(e); }
  };
  if (!rep) return <p className="text-muted">{t('Chargement…')}</p>;
  const K = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className="panel rounded-3xl p-5"><p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p><p className={`mt-1 tabular ${strong ? 'font-display text-4xl font-semibold text-brand' : 'text-2xl font-bold'}`}>{value}</p></div>
  );
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-auto font-display text-2xl font-semibold">{t('Journée du {d}', { d: rep.business_date })} {rep.closed && <span className="ms-2 rounded bg-warn/20 px-2 py-0.5 text-sm text-warn">{t('clôturée')}</span>}</h2>
        <Btn onClick={load} aria-label={t('Actualiser')}><RefreshCw className="h-4 w-4" /></Btn>
        <Btn onClick={pos.openDrawer}><Archive className="h-4 w-4" /> {t('Ouvrir le tiroir')}</Btn>
        <Btn onClick={() => setDialog('float')} disabled={rep.closed}><Banknote className="h-4 w-4" /> {t('Fond de caisse')}</Btn>
        {stockOn && <Btn onClick={() => setDialog('waste')}><PackageX className="h-4 w-4" /> {t('Perte')}</Btn>}
        {creditOn && <Btn onClick={() => setDialog('account')} disabled={rep.closed}><NotebookPen className="h-4 w-4" /> {t('Ardoises')}</Btn>}
        <Btn tone="danger" onClick={() => setDialog('payout')} disabled={rep.closed}><ArrowDownCircle className="h-4 w-4" /> {t('Sortie de caisse')}</Btn>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <K label={t("Chiffre d'affaires TTC")} value={mad(rep.revenue_ttc_cents)} strong />
        <K label={t('Tickets')} value={String(rep.tickets)} />
        <K label={t('Espèces attendues en caisse')} value={mad(rep.expected_cash_cents)} strong />
        <K label={t('Commandes ouvertes')} value={String(rep.open_orders)} />
        {Object.entries(rep.payments).map(([m, c]) => <K key={m} label={methodLabel(m)} value={mad(c)} />)}
        <K label={t('Pourboires')} value={mad(rep.tips_cents)} />
        <K label={t('Remises')} value={mad(rep.discounts_cents)} />
        <K label={t('Avoirs ({n})', { n: rep.credit_notes })} value={mad(rep.credit_notes_cents)} />
        <K label={t('TVA collectée')} value={mad(rep.vat_cents)} />
        {creditOn && <K label={t('Ardoises réglées')} value={mad(rep.account_received_cents ?? 0)} />}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="panel rounded-3xl p-5">
          <h3 className="mb-2 font-bold">{t('Par employé')}</h3>
          {rep.by_staff.length ? rep.by_staff.map((s, i) => <p key={i} className="flex justify-between py-1"><span>{s.name ?? '—'}</span><span className="tabular">{mad(s.revenue_ttc_cents)}</span></p>) : <p className="text-muted">{t('Aucune vente.')}</p>}
        </section>
        <section className="panel rounded-3xl p-5">
          <h3 className="mb-2 font-bold">{t('Mouvements de caisse')}</h3>
          {moves.length ? moves.map(m => (
            <p key={m.id} className="flex justify-between py-1 text-sm"><span>{time(m.created_at, r.timezone)} · {m.kind === 'float' ? t('Fond') : m.kind === 'payout' ? t('Sortie') : t('Dépôt')} · {m.reason}{m.staff_id ? ` (${pos.staffById.get(m.staff_id)?.name ?? ''})` : ''}</span>
              <span className={`tabular ${m.kind === 'float' ? '' : 'text-danger'}`}>{m.kind === 'float' ? '' : '-'}{mad(m.amount_cents)}</span></p>
          )) : <p className="text-muted">{t('Aucun mouvement.')}</p>}
        </section>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Btn onClick={() => printRep('RAPPORT X', rep)}><Printer className="h-4 w-4" /> {t('Imprimer rapport X')}</Btn>
        <Btn tone="brand" disabled={rep.closed} onClick={() => setDialog('z')}><Lock className="h-4 w-4" /> {t('Clôturer la journée (Z)')}</Btn>
      </div>
      {(dialog === 'float' || dialog === 'payout') && <CashDialog kind={dialog} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog === 'waste' && <WasteDialog onClose={() => setDialog(null)} />}
      {dialog === 'account' && <AccountDialog onClose={() => setDialog(null)} onDone={() => load()} />}
      {dialog === 'z' && <ZDialog rep={rep} onClose={() => setDialog(null)} onDone={async x => { setDialog(null); await printRep('RAPPORT Z', x); load(); }} />}
    </div>
  );
}

function CashDialog({ kind, onClose, onDone }: { kind: 'float' | 'payout'; onClose: () => void; onDone: () => void }) {
  const pos = usePos();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState(kind === 'float' ? 'Fond de caisse' : '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await db.addCashMovement(pos.restaurant!.id, kind, toCents(amount), reason.trim(), pos.staff?.id ?? null);
      if (kind === 'payout') await pos.openDrawer();
      pos.toast(t('Enregistré'), 'ok'); onDone();
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={kind === 'float' ? t('Fond de caisse') : t('Sortie de caisse')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || toCents(amount) <= 0 || reason.trim().length < 2} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-3">
        <Field label={t('Montant (MAD)')}><input autoFocus className={inputCls} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label={kind === 'payout' ? t('Pour quoi ? (fournisseur, achat…)') : t('Motif')}><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} /></Field>
        {kind === 'payout' && <p className="text-sm text-muted">{t("Une sortie ne compte pas dans le chiffre d'affaires, elle réduit les espèces attendues.")}</p>}
      </div>
    </Modal>
  );
}

/** The Z report as a WhatsApp message to the owner (the number set in the manager space > En direct). */
function zWhatsApp(r: { name: string; owner_whatsapp?: string | null } | null, z: DayReport): string | null {
  let n = (r?.owner_whatsapp ?? '').replace(/\D/g, '');
  if (!n) return null;
  if (n.length === 10 && n.startsWith('0')) n = '212' + n.slice(1);
  const M: Record<string, string> = { cash: 'Espèces', card: 'Carte', transfer: 'Virement', account: 'Ardoise' };
  const diff = Number(z.cash_diff_cents ?? 0);
  const lines = [
    `*${r!.name} · Rapport Z ${z.business_date}*`,
    `Chiffre d'affaires : ${mad(z.revenue_ttc_cents)} (${z.tickets} tickets)`,
    ...Object.entries(z.payments ?? {}).map(([k, v]) => `· ${M[k] ?? k} : ${mad(Number(v))}`),
    `Remises : ${mad(z.discounts_cents)}`,
    z.credit_notes ? `Avoirs : ${z.credit_notes} (${mad(Math.abs(z.credit_notes_cents))})` : '',
    z.cancelled_orders ? `Commandes annulées : ${z.cancelled_orders}` : '',
    z.tips_cents ? `Pourboires : ${mad(z.tips_cents)}` : '',
    z.cash_payouts_cents ? `Sorties de caisse : ${mad(z.cash_payouts_cents)}` : '',
    `Espèces attendues : ${mad(z.expected_cash_cents)} · comptées : ${mad(z.counted_cash_cents ?? 0)}`,
    `Écart de caisse : ${diff > 0 ? '+' : ''}${mad(diff)}${Math.abs(diff) > 1000 ? ' ⚠️' : ' ✅'}`,
  ].filter(Boolean);
  return `https://wa.me/${n}?text=${encodeURIComponent(lines.join('\n'))}`;
}

function ZDialog({ rep, onClose, onDone }: { rep: DayReport; onClose: () => void; onDone: (x: DayReport) => void }) {
  const pos = usePos();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // blind count: the manager counts the drawer before seeing what should be there
  const [counted, setCounted] = useState('');
  const [step, setStep] = useState<'count' | 'approve'>('count');
  const [done, setDone] = useState<DayReport | null>(null);
  const approve = async (managerId: string, pin: string) => {
    setBusy(true); setError(null);
    try {
      const res = await db.rpc<{ ok: boolean; error?: string; totals?: DayReport }>('close_day', {
        p_restaurant_id: pos.restaurant!.id, p_business_date: rep.business_date, p_manager_staff_id: managerId, p_pin: pin,
        p_counted_cash_cents: toCents(counted) });
      if (!res.ok) setError(PIN_ERRORS[res.error ?? 'invalid']);
      else { pos.setDayClosed(true); pos.toast(t('Journée clôturée'), 'ok'); setDone({ ...rep, ...res.totals, closed: true } as DayReport); }
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };
  if (done) {
    const diff = Number(done.cash_diff_cents ?? 0);
    const tone = Math.abs(diff) <= 1000 ? 'text-ok' : diff < 0 ? 'text-danger' : 'text-warn';
    return (
      <Modal title={t('Journée clôturée')} onClose={() => onDone(done)}
        footer={<div className="flex flex-wrap justify-end gap-2">
          {zWhatsApp(pos.restaurant, done) && <a href={zWhatsApp(pos.restaurant, done)!} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-[#063B1E]"><MessageCircle className="h-4 w-4" /> {t('Envoyer au patron')}</a>}
          <Btn tone="brand" onClick={() => onDone(done)}><Printer className="h-4 w-4" /> {t('Imprimer le rapport Z')}</Btn></div>}>
        <dl className="space-y-2 text-lg">
          <div className="flex justify-between"><dt>{t('Espèces comptées')}</dt><dd className="font-bold tabular">{mad(done.counted_cash_cents ?? 0)}</dd></div>
          <div className="flex justify-between"><dt>{t('Espèces attendues')}</dt><dd className="font-bold tabular">{mad(done.expected_cash_cents)}</dd></div>
          <div className={`flex justify-between border-t border-line/10 pt-2 ${tone}`}><dt className="font-bold">{t('Écart de caisse')}</dt>
            <dd className="font-display text-2xl font-semibold tabular">{diff > 0 ? '+' : ''}{mad(diff)}</dd></div>
        </dl>
        <p className={`mt-3 text-sm ${tone}`}>{Math.abs(diff) <= 1000 ? t('La caisse est juste.') : diff < 0 ? t('Il manque de l’argent dans la caisse. Le gérant en sera informé.') : t('Il y a plus d’argent que prévu : une vente n’a peut-être pas été encaissée.')}</p>
      </Modal>
    );
  }
  return (
    <Modal title={t('Clôturer la journée (rapport Z)')} onClose={onClose}>
      <p className="mb-2">{t("Chiffre d'affaires :")} <b className="tabular">{mad(rep.revenue_ttc_cents)}</b></p>
      <p className="mb-4 text-sm text-warn">{t("Définitif : après la clôture, plus aucune vente n'est possible sur cette journée.")}</p>
      {pos.queue.some(q => q.state !== 'done')
        ? <p className="font-semibold text-danger">{t("Des opérations de ce poste ne sont pas encore envoyées (voir Synchronisation). Attendez qu'elles partent avant de clôturer.")}</p>
        : rep.open_orders > 0
        ? <p className="font-semibold text-danger">{t("{n} commande(s) encore ouverte(s). Encaissez-les ou annulez-les d'abord.", { n: rep.open_orders })}</p>
        : step === 'count' ? (
          <div className="space-y-3">
            <Field label={t('Comptez les espèces dans la caisse (MAD)')}>
              <input autoFocus className={`${inputCls} text-2xl tabular`} inputMode="decimal" value={counted} onChange={e => setCounted(e.target.value)} placeholder="0"
                onKeyDown={e => { if (e.key === 'Enter' && counted.trim()) setStep('approve'); }} />
            </Field>
            <p className="text-sm text-muted">{t('Billets et pièces, fond de caisse compris. Le montant attendu s’affiche après.')}</p>
            <div className="flex justify-end"><Btn tone="brand" disabled={!counted.trim() || toCents(counted) < 0} onClick={() => setStep('approve')}>{t('Continuer')}</Btn></div>
          </div>
        ) : (<>
          <p className="mb-3 text-sm">{t('Espèces comptées :')} <b className="tabular">{mad(toCents(counted))}</b> <button className="ms-2 text-brand underline" onClick={() => setStep('count')}>{t('Modifier')}</button></p>
          <ManagerApproval onApprove={approve} busy={busy} error={error} />
        </>)}
    </Modal>
  );
}

interface AcctCustomer { id: string; name: string | null; phone: string; credit_allowed?: boolean; credit_limit_cents?: number | null; balance_cents?: number }
type SettleMethod = 'cash' | 'card' | 'transfer';

/** A customer pays back (part of) the ardoise: find by phone, amount, method, receipt. */
function AccountDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const [phone, setPhone] = useState('');
  const [c, setC] = useState<AcctCustomer | null | undefined>(undefined);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SettleMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount_cents: number; balance_cents: number; method: string } | null>(null);
  const bal = Number(c?.balance_cents ?? 0);
  const amt = toCents(amount);
  const search = async () => {
    if (!pos.requireOnline()) return;
    setBusy(true); setError(null);
    try {
      const x = await db.rpc<AcctCustomer | null>('pos_find_customer', { p_restaurant_id: r.id, p_phone: phone });
      setC(x); setAmount(x && Number(x.balance_cents ?? 0) > 0 ? String(Number(x.balance_cents) / 100) : '');
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };
  const settle = async () => {
    if (!c || !pos.requireOnline()) return;
    setBusy(true); setError(null);
    try {
      const res = await db.rpc<{ balance_cents: number; amount_cents: number; method: string; at: string }>('pos_account_payment', {
        p_restaurant_id: r.id, p_customer_id: c.id, p_amount_cents: amt, p_method: method, p_staff_id: pos.staff?.id ?? null });
      setDone(res);
      if (pos.printerOk) {
        try {
          await P.print(P.receiptPrinter(pos.settings), 'Reglement ardoise',
            P.accountReceipt(r, { name: c.name, phone: c.phone, amount_cents: Number(res.amount_cents), method, balance_cents: Number(res.balance_cents), at: res.at, staff: pos.staff?.name }),
            { drawer: method === 'cash' });
        } catch (e) { pos.fail(e); }
      }
      onDone();
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };
  if (done) return (
    <Modal title={t('Ardoise réglée')} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" onClick={onClose}>{t('Terminé')}</Btn></div>}>
      <div className="py-4 text-center">
        <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-ok/15 pop"><CheckCircle2 className="h-12 w-12 text-ok" /></span>
        <p className="mt-3 text-lg font-bold">{c?.name || c?.phone}</p>
        <p className="text-muted">{t('Payé {m} ({w})', { m: mad(Number(done.amount_cents)), w: methodLabel(done.method) })}</p>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.25em] text-muted">{t('Reste à payer')}</p>
        <p className="font-display text-5xl font-semibold text-brand tabular">{mad(Number(done.balance_cents))}</p>
      </div>
    </Modal>
  );
  const methods: { id: SettleMethod; label: string; Icon: typeof Banknote }[] = [
    { id: 'cash', label: t('Espèces'), Icon: Banknote }, { id: 'card', label: t('Carte'), Icon: CreditCard }, { id: 'transfer', label: t('Virement'), Icon: Landmark }];
  return (
    <Modal title={t('Régler une ardoise')} onClose={onClose}
      footer={<div className="flex items-center justify-between gap-3">
        {error ? <p className="text-sm font-semibold text-danger">{error}</p> : <span className="text-sm text-muted">{t('Pas un nouveau ticket : la vente a déjà son ticket fiscal.')}</span>}
        <Btn tone="ok" disabled={busy || !c || amt <= 0 || amt > bal} onClick={settle}>{t('Encaisser {m}', { m: mad(amt) })}</Btn>
      </div>}>
      <div className="space-y-4">
        <Field label={t('Téléphone du client')}>
          <div className="flex gap-2">
            <input autoFocus className={inputCls} inputMode="tel" value={phone} placeholder="06…" onChange={e => { setPhone(e.target.value); setC(undefined); }}
              onKeyDown={e => { if (e.key === 'Enter' && phone.replace(/\D/g, '').length >= 9) search(); }} />
            <Btn disabled={busy || phone.replace(/\D/g, '').length < 9} onClick={search}>{t('Chercher')}</Btn>
          </div>
        </Field>
        {c === null && <p className="text-sm text-muted">{t('Aucun client avec ce numéro.')}</p>}
        {c && <>
          <div className="flex items-center justify-between rounded-2xl bg-surface-2 p-4">
            <div><p className="text-lg font-bold">{c.name || t('Sans nom')}</p><p dir="ltr" className="text-sm text-muted rtl:text-end">{c.phone}</p></div>
            <div className="text-end"><p className="text-xs font-bold uppercase tracking-wider text-muted">{t('Doit')}</p><p className="font-display text-3xl font-semibold text-brand tabular">{mad(bal)}</p></div>
          </div>
          {bal <= 0 ? <p className="text-sm text-muted">{t('Rien à régler.')}</p> : <>
            <Field label={t('Montant payé (MAD)')}><input className={inputCls} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
            <div className="grid grid-cols-3 gap-2">
              {methods.map(m => (
                <button key={m.id} onClick={() => setMethod(m.id)} className={`flex items-center justify-center gap-2 rounded-2xl py-3 font-bold transition ${method === m.id ? 'gold-fill text-brand-ink' : 'border border-line/[0.06] bg-surface-2 hover:bg-surface-3'}`}>
                  <m.Icon className="h-5 w-5" />{m.label}
                </button>
              ))}
            </div>
            {amt > bal && <p className="text-sm font-semibold text-danger">{t('Le montant dépasse ce que le client doit.')}</p>}
          </>}
        </>}
      </div>
    </Modal>
  );
}

// i18n:values
const REASONS = ['Tombé', 'Brûlé', 'Retour client', 'Périmé', 'Repas du personnel', 'Erreur en cuisine'];
// i18n:end

/** A dish that was lost (dropped, burnt, sent back): its ingredients leave the live stock, with who and why. */
function WasteDialog({ onClose }: { onClose: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const nameOf = (n: Record<string, string>) => tr(n, pos.lang, r.languages);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ id: string; variant: string | null } | null>(null);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = q.trim().toLowerCase();
  const list = pos.items.filter(i => !f || nameOf(i.name).toLowerCase().includes(f)).slice(0, 60);
  const item = pick ? pos.itemById.get(pick.id) : null;
  const save = async () => {
    if (!pick || !pos.requireOnline()) return;
    setBusy(true); setError(null);
    try {
      const res = await db.rpc<{ cost_cents: number }>('pos_stock_waste', { p_restaurant_id: r.id, p_menu_item_id: pick.id, p_variant_id: pick.variant, p_qty: qty, p_reason: reason.trim(), p_staff_id: pos.staff?.id ?? null });
      pos.toast(t('Perte notée ({m})', { m: mad(Number(res.cost_cents)) }), 'ok');
      void pos.refreshStock();
      onClose();
    } catch (e) { setError(/no_recipe/.test(String((e as Error).message)) ? t('Ce plat n’a pas encore de fiche technique (Marges, dans l’espace gérant).') : errorMessage(e)); }
    setBusy(false);
  };
  return (
    <Modal title={t('Noter une perte')} onClose={onClose} wide
      footer={<div className="flex items-center justify-between gap-3">
        {error ? <p className="text-sm font-semibold text-danger">{error}</p> : <span className="text-sm text-muted">{t('Les ingrédients sortent du stock. Visible par le gérant, avec votre nom.')}</span>}
        <Btn tone="brand" disabled={busy || !pick || reason.trim().length < 2} onClick={save}><PackageX className="h-4 w-4" /> {t('Noter la perte')}</Btn>
      </div>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input autoFocus className={`${inputCls} ps-9`} placeholder={t('Chercher un plat')} value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <ul className="scroll-thin max-h-80 space-y-1 overflow-y-auto">
            {list.map(i => (i.variants.length ? i.variants.map(v => ({ i, v })) : [{ i, v: null }]).map(({ i: it, v }) => {
              const on = pick?.id === it.id && pick.variant === (v?.id ?? null);
              return (
                <li key={it.id + (v?.id ?? '')}>
                  <button onClick={() => setPick({ id: it.id, variant: v?.id ?? null })} className={`w-full rounded-xl px-3 py-2.5 text-start font-semibold transition ${on ? 'gold-fill text-brand-ink' : 'bg-surface-2 hover:bg-surface-3'}`}>
                    {nameOf(it.name)}{v ? <span className={on ? '' : 'text-muted'}> · {nameOf(v.name)}</span> : null}
                  </button>
                </li>
              );
            }))}
          </ul>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl bg-surface-2 p-4 text-center">
            <p className="text-sm text-muted">{item ? nameOf(item.name) : t('Choisissez le plat')}</p>
            <div className="mt-3 flex items-center justify-center gap-4">
              <button aria-label="-" onClick={() => setQty(n => Math.max(1, n - 1))} className="grid h-12 w-12 place-items-center rounded-full bg-surface-3"><Minus className="h-5 w-5" /></button>
              <span className="w-16 font-display text-5xl font-semibold tabular">{qty}</span>
              <button aria-label="+" onClick={() => setQty(n => Math.min(100, n + 1))} className="grid h-12 w-12 place-items-center rounded-full bg-surface-3"><Plus className="h-5 w-5" /></button>
            </div>
          </div>
          <Field label={t('Raison')}>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {REASONS.map(x => <button key={x} onClick={() => setReason(t(x))} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${reason === t(x) ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink'}`}>{t(x)}</button>)}
            </div>
            <input className={inputCls} maxLength={120} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('Ou écrivez la raison')} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
