import { useEffect, useState } from 'react';
import { Delete } from 'lucide-react';

/** Numeric keypad for PINs and amounts; also works with the physical keyboard. */
export function PinPad({ onSubmit, busy, error, masked = true, maxLen = 6, submitLabel = 'Valider', allowDecimal = false, value: controlled, onChange }: {
  onSubmit: (v: string) => void; busy?: boolean; error?: string | null; masked?: boolean; maxLen?: number;
  submitLabel?: string; allowDecimal?: boolean; value?: string; onChange?: (v: string) => void;
}) {
  const [inner, setInner] = useState('');
  const v = controlled ?? inner;
  const set = (n: string) => (onChange ? onChange(n) : setInner(n));
  const press = (k: string) => {
    if (busy) return;
    if (k === 'back') return set(v.slice(0, -1));
    if (k === 'ok') { if (v) onSubmit(v); if (!controlled) setInner(''); return; }
    if (k === ',' && (!allowDecimal || v.includes(','))) return;
    if (v.length >= maxLen) return;
    set(v + k);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Enter') press('ok');
      else if ((e.key === ',' || e.key === '.') && allowDecimal) press(',');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', allowDecimal ? ',' : 'back', '0', allowDecimal ? 'back' : 'ok'];
  return (
    <div className="mx-auto w-full max-w-xs">
      <div className="mb-3 flex h-14 items-center justify-center rounded-xl bg-bg text-3xl font-bold tracking-[0.3em] tabular">
        {masked ? '•'.repeat(v.length) : v || <span className="text-muted/50">0</span>}
      </div>
      {error && <p className="mb-2 text-center text-sm font-semibold text-danger">{error}</p>}
      <div className="grid grid-cols-3 gap-2">
        {keys.map(k => (
          <button key={k} type="button" onClick={() => press(k)} disabled={busy}
            className={`h-14 rounded-xl text-xl font-bold transition active:scale-95 ${k === 'ok' ? 'bg-brand text-brand-ink' : 'bg-surface-2 hover:bg-surface-3'}`}>
            {k === 'back' ? <Delete className="mx-auto h-6 w-6" /> : k === 'ok' ? '✓' : k}
          </button>
        ))}
      </div>
      {allowDecimal && (
        <button type="button" onClick={() => press('ok')} disabled={busy || !v}
          className="mt-2 h-12 w-full rounded-xl bg-brand font-bold text-brand-ink disabled:opacity-40">{submitLabel}</button>
      )}
    </div>
  );
}
