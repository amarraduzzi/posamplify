import { useState } from 'react';
import { ArrowLeft, Lock } from 'lucide-react';
import { usePos } from '../store';
import { rpc } from '../lib/data';
import { PIN_ERRORS, errorMessage } from '../lib/errors';
import type { Staff } from '../lib/types';
import { PinPad } from './PinPad';

/** Staff pick their name and type their PIN. Shown at start and after the idle lock. */
export function StaffGate() {
  const pos = usePos();
  const [who, setWho] = useState<Staff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = pos.restaurant!;
  const submit = async (pin: string) => {
    if (!who) return;
    setBusy(true); setError(null);
    try {
      const res = await rpc<{ ok: boolean; error?: string; staff?: Staff }>('verify_staff_pin', { p_restaurant_id: r.id, p_staff_id: who.id, p_pin: pin });
      if (res.ok && res.staff) pos.setStaff({ ...who, ...res.staff });
      else setError(PIN_ERRORS[res.error ?? 'invalid'] ?? 'Code incorrect.');
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <Lock className="mx-auto h-8 w-8 text-brand" />
        <h1 className="mt-2 text-2xl font-bold">{r.name}</h1>
        <p className="text-muted">{who ? `Code de ${who.name}` : 'Qui êtes-vous ?'}</p>
      </div>
      {!who ? (
        <div className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {pos.staffList.map(s => (
            <button key={s.id} onClick={() => { setWho(s); setError(null); }}
              className="rounded-2xl border border-line/10 bg-surface px-4 py-6 text-lg font-bold transition hover:border-brand active:scale-95">
              {s.name}
              {s.role === 'manager' && <span className="mt-1 block text-xs font-semibold uppercase text-brand">Manager</span>}
            </button>
          ))}
          {!pos.staffList.length && <p className="col-span-full text-center text-muted">Aucun employé. Ajoutez le personnel dans l'espace gérant.</p>}
        </div>
      ) : (
        <div className="w-full max-w-xs">
          <PinPad onSubmit={submit} busy={busy} error={error} />
          <button onClick={() => setWho(null)} className="mx-auto mt-4 flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Changer d'employé</button>
        </div>
      )}
      <button onClick={pos.logout} className="text-xs text-muted/70 hover:text-ink">Déconnecter ce poste</button>
    </div>
  );
}

/** Asks a manager to approve an action. Returns the manager id + PIN, verified server side by the action itself. */
export function ManagerApproval({ onApprove, busy, error }: { onApprove: (managerId: string, pin: string) => void; busy?: boolean; error?: string | null }) {
  const pos = usePos();
  const managers = pos.staffList.filter(s => s.role === 'manager');
  const [who, setWho] = useState<string>(pos.staff?.role === 'manager' ? pos.staff.id : managers[0]?.id ?? '');
  if (!managers.length) return <p className="text-danger">Aucun manager défini pour ce restaurant.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-center gap-2">
        {managers.map(m => (
          <button key={m.id} onClick={() => setWho(m.id)}
            className={`rounded-full px-4 py-2 text-sm font-bold ${who === m.id ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{m.name}</button>
        ))}
      </div>
      <PinPad onSubmit={pin => onApprove(who, pin)} busy={busy} error={error} />
    </div>
  );
}
