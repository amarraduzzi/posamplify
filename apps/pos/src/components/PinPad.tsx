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
      {masked ? (
        <div key={error ?? 'ok'} className={`mb-4 flex h-12 items-center justify-center gap-3 ${error ? 'shake' : ''}`} aria-label={`${v.length} chiffres`}>
          {Array.from({ length: Math.max(4, v.length) }).map((_, i) => (
            <span key={i} className={`h-3.5 w-3.5 rounded-full transition-all duration-150 ${i < v.length ? 'scale-110 bg-brand shadow-[0_0_12px_rgb(var(--brand)/.7)]' : 'bg-surface-3'}`} />
          ))}
        </div>
      ) : (
        <div className="mb-3 flex h-16 items-center justify-center rounded-2xl bg-bg font-display text-4xl font-semibold tabular">
          {v || <span className="text-muted/40">0</span>}
        </div>
      )}
      {error && <p className="mb-3 text-center text-sm font-semibold text-danger">{error}</p>}
      <div className="grid grid-cols-3 gap-2.5">
        {keys.map(k => (
          <button key={k} type="button" onClick={() => press(k)} disabled={busy}
            className={`h-16 rounded-2xl text-2xl font-semibold transition active:scale-95 ${
              k === 'ok' ? 'gold-fill text-brand-ink' : k === 'back' ? 'text-muted hover:bg-surface-2 hover:text-ink' : 'border border-line/[0.07] bg-surface-2 hover:bg-surface-3'}`}>
            {k === 'back' ? <Delete className="mx-auto h-6 w-6" /> : k === 'ok' ? '✓' : k}
          </button>
        ))}
      </div>
      {allowDecimal && (
        <button type="button" onClick={() => press('ok')} disabled={busy || !v}
          className="gold-fill mt-2.5 h-14 w-full rounded-2xl text-lg font-bold text-brand-ink disabled:opacity-40">{submitLabel}</button>
      )}
    </div>
  );
}
