import { Minus, Plus, Trash2 } from 'lucide-react';

export function Stepper({ value, onChange, min = 1, max = 20, size = 'md', removeLabel }: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'md';
  removeLabel?: string;
}) {
  const s = size === 'sm' ? 'size-8' : 'size-10';
  const showTrash = min === 0 && value === 1 && removeLabel;
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-surface-2 p-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={showTrash ? removeLabel : '−'}
        className={`${s} grid place-items-center rounded-full bg-surface text-ink shadow-sm disabled:opacity-40 active:scale-95 transition`}
      >
        {showTrash ? <Trash2 className="size-4" /> : <Minus className="size-4" />}
      </button>
      <span className="min-w-7 text-center font-semibold tabular-nums" aria-live="polite">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="+"
        className={`${s} grid place-items-center rounded-full bg-surface text-ink shadow-sm disabled:opacity-40 active:scale-95 transition`}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
