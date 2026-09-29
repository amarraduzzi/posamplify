import { useEffect, useState } from 'react';
import { Printer, Undo2, RefreshCw } from 'lucide-react';
import { usePos } from '../store';
import * as db from '../lib/data';
import { mad, METHOD, time } from '../lib/format';
import { PIN_ERRORS, errorMessage } from '../lib/errors';
import type { FiscalDoc } from '../lib/types';
import { Btn, Field, Modal, inputCls } from './ui';
import { ManagerApproval } from './StaffGate';

/** Today's fiscal documents: reprint a duplicate, refund with a credit note. */
export function HistoryView() {
  const pos = usePos();
  const r = pos.restaurant!;
  const [docs, setDocs] = useState<FiscalDoc[] | null>(null);
  const [open, setOpen] = useState<FiscalDoc | null>(null);
  const [refund, setRefund] = useState<FiscalDoc | null>(null);
  const load = () => pos.businessDate && db.todaysDocs(r.id, pos.businessDate).then(setDocs).catch(pos.fail);
  useEffect(() => { load(); }, [pos.businessDate, pos.orders.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const credited = new Set((docs ?? []).filter(d => d.original_document_id).map(d => d.original_document_id));
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">Tickets du {pos.businessDate}</h2>
        <Btn onClick={load}><RefreshCw className="h-4 w-4" /> Actualiser</Btn>
      </div>
      {!docs ? <p className="text-muted">Chargement…</p> : !docs.length ? <p className="py-16 text-center text-muted">Aucun ticket aujourd'hui.</p> : (
        <div className="panel overflow-hidden rounded-3xl">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-muted"><tr><th className="px-4 py-2">N°</th><th>Heure</th><th>Paiement</th><th>Serveur</th><th className="px-4 text-right">Total</th></tr></thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id} onClick={() => setOpen(d)} className="cursor-pointer border-t border-line/10 hover:bg-surface-2">
                  <td className="px-4 py-2.5 font-semibold">{d.doc_number}{d.doc_type === 'credit_note' && <span className="ml-2 rounded bg-danger/20 px-1.5 text-xs text-danger">avoir</span>}{credited.has(d.id) && <span className="ml-2 rounded bg-surface-3 px-1.5 text-xs text-muted">remboursé</span>}</td>
                  <td className="tabular">{time(d.issued_at, r.timezone)}</td>
                  <td>{d.payments.map(p => METHOD[p.method]).join(' + ')}</td>
                  <td>{d.staff_id ? pos.staffById.get(d.staff_id)?.name : ''}</td>
                  <td className={`px-4 text-right font-bold tabular ${d.total_ttc_cents < 0 ? 'text-danger' : ''}`}>{mad(d.total_ttc_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Modal title={open.doc_number} onClose={() => setOpen(null)}
          footer={<div className="flex justify-between gap-2">
            <Btn onClick={() => pos.reprintDoc(open)}><Printer className="h-4 w-4" /> Duplicata</Btn>
            {open.doc_type !== 'credit_note' && !credited.has(open.id) && <Btn tone="danger" onClick={() => { setRefund(open); setOpen(null); }}><Undo2 className="h-4 w-4" /> Avoir (remboursement)</Btn>}
          </div>}>
          <ul className="space-y-1 text-sm">
            {open.lines.map((l, i) => <li key={i} className="flex justify-between"><span>{l.qty}× {l.name}</span><span className="tabular">{mad(l.total_ttc)}</span></li>)}
          </ul>
          <div className="mt-3 space-y-1 border-t border-line/10 pt-3 text-sm">
            {!!open.discount_cents && <p className="flex justify-between text-ok"><span>Remise</span><span className="tabular">{mad(-Math.abs(open.discount_cents))}</span></p>}
            <p className="flex justify-between text-lg font-black"><span>Total TTC</span><span className="tabular">{mad(open.total_ttc_cents)}</span></p>
            {open.vat_breakdown.map(v => <p key={v.vat_bp} className="flex justify-between text-muted"><span>TVA {v.vat_bp / 100}%</span><span className="tabular">{mad(v.vat)}</span></p>)}
            {open.payments.map((p, i) => <p key={i} className="flex justify-between"><span>{METHOD[p.method]}{p.tip ? ` (pourboire ${mad(p.tip)})` : ''}</span><span className="tabular">{mad(p.amount)}</span></p>)}
            {open.reason && <p className="text-muted">Motif : {open.reason}</p>}
          </div>
        </Modal>
      )}
      {refund && <RefundDialog doc={refund} onClose={() => setRefund(null)} onDone={() => { setRefund(null); load(); }} />}
    </div>
  );
}

function RefundDialog({ doc, onClose, onDone }: { doc: FiscalDoc; onClose: () => void; onDone: () => void }) {
  const pos = usePos();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approve = async (managerId: string, pin: string) => {
    setBusy(true); setError(null);
    try {
      const res = await db.rpc<{ ok: boolean; error?: string; document?: FiscalDoc }>('issue_credit_note', { p_document_id: doc.id, p_reason: reason, p_manager_staff_id: managerId, p_pin: pin });
      if (!res.ok) setError(PIN_ERRORS[res.error ?? 'invalid']);
      else { if (res.document) await pos.reprintDoc(res.document, undefined, false); pos.toast(`Avoir ${res.document?.doc_number} émis`, 'ok'); onDone(); }
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };
  return (
    <Modal title={`Avoir sur ${doc.doc_number} (${mad(doc.total_ttc_cents)})`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">L'avoir annule entièrement ce ticket. Remboursez le client avec le même moyen de paiement.</p>
      <Field label="Motif (obligatoire)"><input className={`${inputCls} mb-4`} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {reason.trim() ? <ManagerApproval onApprove={approve} busy={busy} error={error} /> : <p className="text-center text-sm text-muted">Indiquez un motif pour continuer.</p>}
    </Modal>
  );
}
