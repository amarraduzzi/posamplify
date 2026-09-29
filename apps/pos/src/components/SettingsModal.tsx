import { useState } from 'react';
import { Printer, LogOut } from 'lucide-react';
import { usePos } from '../store';
import * as P from '../lib/print';
import { Btn, Modal } from './ui';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const pos = usePos();
  const s = pos.settings;
  const [msg, setMsg] = useState<string | null>(null);
  const printers = [
    { label: 'Ticket (caisse)', name: P.receiptPrinter(s) },
    ...[...new Set(pos.categories.map(c => c.station))].map(st => ({ label: `Bon ${st}`, name: P.printerFor(s, st) })),
  ];
  const test = async (name: string, label: string) => {
    setMsg(null);
    try { await P.print(name, 'Test', [{ text: 'TEST IMPRESSION', bold: true, large: true, center: true }, { text: label, center: true }, { text: new Date().toLocaleString('fr-FR'), center: true }]); setMsg(`${label} : OK`); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <Modal title="Réglages du poste" onClose={onClose}>
      <h3 className="mb-2 font-bold">Imprimantes</h3>
      <p className="mb-3 text-sm text-muted">{pos.printerOk ? "Programme d'impression détecté sur ce PC." : "Programme d'impression (printhost) non détecté sur ce PC : les tickets ne s'impriment pas automatiquement."}</p>
      <div className="space-y-2">
        {printers.map(p => (
          <div key={p.label} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
            <span>{p.label} <span className="text-muted">→ {p.name}</span></span>
            <Btn className="py-1.5" disabled={!pos.printerOk} onClick={() => test(p.name, p.label)}><Printer className="h-4 w-4" /> Test</Btn>
          </div>
        ))}
      </div>
      {msg && <p className="mt-2 text-sm font-semibold">{msg}</p>}
      <h3 className="mb-2 mt-6 font-bold">Poste</h3>
      <Btn tone="danger" onClick={pos.logout}><LogOut className="h-4 w-4" /> Déconnecter ce poste</Btn>
    </Modal>
  );
}
