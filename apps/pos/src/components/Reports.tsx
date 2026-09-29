import { useEffect, useState } from 'react';
import { Printer, Lock, ArrowDownCircle, Banknote, Archive, RefreshCw } from 'lucide-react';
import { usePos } from '../store';
import * as db from '../lib/data';
import * as P from '../lib/print';
import { mad, METHOD, time, toCents } from '../lib/format';
import { PIN_ERRORS, errorMessage } from '../lib/errors';
import type { CashMovement, DayReport } from '../lib/types';
import { Btn, Field, Modal, inputCls } from './ui';
import { ManagerApproval } from './StaffGate';

export function ReportsView() {
  const pos = usePos();
  const r = pos.restaurant!;
  const [rep, setRep] = useState<DayReport | null>(null);
  const [moves, setMoves] = useState<CashMovement[]>([]);
  const [dialog, setDialog] = useState<null | 'float' | 'payout' | 'z'>(null);
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
  if (!rep) return <p className="text-muted">Chargement…</p>;
  const K = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className="rounded-2xl border border-line/10 bg-surface p-4"><p className="text-sm text-muted">{label}</p><p className={`tabular ${strong ? 'text-3xl font-black' : 'text-xl font-bold'}`}>{value}</p></div>
  );
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-bold">Journée du {rep.business_date} {rep.closed && <span className="ml-2 rounded bg-warn/20 px-2 py-0.5 text-sm text-warn">clôturée</span>}</h2>
        <Btn onClick={load}><RefreshCw className="h-4 w-4" /></Btn>
        <Btn onClick={pos.openDrawer}><Archive className="h-4 w-4" /> Ouvrir le tiroir</Btn>
        <Btn onClick={() => setDialog('float')} disabled={rep.closed}><Banknote className="h-4 w-4" /> Fond de caisse</Btn>
        <Btn tone="danger" onClick={() => setDialog('payout')} disabled={rep.closed}><ArrowDownCircle className="h-4 w-4" /> Sortie de caisse</Btn>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <K label="Chiffre d'affaires TTC" value={mad(rep.revenue_ttc_cents)} strong />
        <K label="Tickets" value={String(rep.tickets)} />
        <K label="Espèces attendues en caisse" value={mad(rep.expected_cash_cents)} strong />
        <K label="Commandes ouvertes" value={String(rep.open_orders)} />
        {Object.entries(rep.payments).map(([m, c]) => <K key={m} label={METHOD[m] ?? m} value={mad(c)} />)}
        <K label="Pourboires" value={mad(rep.tips_cents)} />
        <K label="Remises" value={mad(rep.discounts_cents)} />
        <K label={`Avoirs (${rep.credit_notes})`} value={mad(rep.credit_notes_cents)} />
        <K label="TVA collectée" value={mad(rep.vat_cents)} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-line/10 bg-surface p-4">
          <h3 className="mb-2 font-bold">Par employé</h3>
          {rep.by_staff.length ? rep.by_staff.map((s, i) => <p key={i} className="flex justify-between py-1"><span>{s.name ?? '—'}</span><span className="tabular">{mad(s.revenue_ttc_cents)}</span></p>) : <p className="text-muted">Aucune vente.</p>}
        </section>
        <section className="rounded-2xl border border-line/10 bg-surface p-4">
          <h3 className="mb-2 font-bold">Mouvements de caisse</h3>
          {moves.length ? moves.map(m => (
            <p key={m.id} className="flex justify-between py-1 text-sm"><span>{time(m.created_at, r.timezone)} · {m.kind === 'float' ? 'Fond' : m.kind === 'payout' ? 'Sortie' : 'Dépôt'} · {m.reason}{m.staff_id ? ` (${pos.staffById.get(m.staff_id)?.name ?? ''})` : ''}</span>
              <span className={`tabular ${m.kind === 'float' ? '' : 'text-danger'}`}>{m.kind === 'float' ? '' : '-'}{mad(m.amount_cents)}</span></p>
          )) : <p className="text-muted">Aucun mouvement.</p>}
        </section>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Btn onClick={() => printRep('RAPPORT X', rep)}><Printer className="h-4 w-4" /> Imprimer rapport X</Btn>
        <Btn tone="brand" disabled={rep.closed} onClick={() => setDialog('z')}><Lock className="h-4 w-4" /> Clôturer la journée (Z)</Btn>
      </div>
      {(dialog === 'float' || dialog === 'payout') && <CashDialog kind={dialog} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
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
      pos.toast('Enregistré', 'ok'); onDone();
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={kind === 'float' ? 'Fond de caisse' : 'Sortie de caisse'} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || toCents(amount) <= 0 || reason.trim().length < 2} onClick={save}>Enregistrer</Btn></div>}>
      <div className="space-y-3">
        <Field label="Montant (MAD)"><input autoFocus className={inputCls} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label={kind === 'payout' ? 'Pour quoi ? (fournisseur, achat…)' : 'Motif'}><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} /></Field>
        {kind === 'payout' && <p className="text-sm text-muted">Une sortie ne compte pas dans le chiffre d'affaires, elle réduit les espèces attendues.</p>}
      </div>
    </Modal>
  );
}

function ZDialog({ rep, onClose, onDone }: { rep: DayReport; onClose: () => void; onDone: (x: DayReport) => void }) {
  const pos = usePos();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approve = async (managerId: string, pin: string) => {
    setBusy(true); setError(null);
    try {
      const res = await db.rpc<{ ok: boolean; error?: string; totals?: DayReport }>('close_day', { p_restaurant_id: pos.restaurant!.id, p_business_date: rep.business_date, p_manager_staff_id: managerId, p_pin: pin });
      if (!res.ok) setError(PIN_ERRORS[res.error ?? 'invalid']);
      else { pos.setDayClosed(true); pos.toast('Journée clôturée', 'ok'); onDone({ ...rep, ...res.totals, closed: true } as DayReport); }
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };
  return (
    <Modal title="Clôturer la journée (rapport Z)" onClose={onClose}>
      <p className="mb-2">Chiffre d'affaires : <b className="tabular">{mad(rep.revenue_ttc_cents)}</b> · Espèces attendues : <b className="tabular">{mad(rep.expected_cash_cents)}</b></p>
      <p className="mb-4 text-sm text-warn">Définitif : après la clôture, plus aucune vente n'est possible sur cette journée.</p>
      {rep.open_orders > 0
        ? <p className="font-semibold text-danger">{rep.open_orders} commande(s) encore ouverte(s). Encaissez-les ou annulez-les d'abord.</p>
        : <ManagerApproval onApprove={approve} busy={busy} error={error} />}
    </Modal>
  );
}
