import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, onClose, children, footer, wide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" className={`pop flex max-h-full w-full flex-col rounded-2xl border border-line/10 bg-surface shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
        <div className="flex items-center justify-between gap-3 border-b border-line/10 px-5 py-3.5">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Fermer" className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line/10 px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

type BtnTone = 'brand' | 'ghost' | 'danger' | 'ok' | 'plain';
const TONES: Record<BtnTone, string> = {
  brand: 'bg-brand text-brand-ink hover:brightness-110',
  ok: 'bg-ok text-black hover:brightness-110',
  danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25',
  ghost: 'border border-line/15 text-ink hover:bg-surface-2',
  plain: 'bg-surface-2 text-ink hover:bg-surface-3',
};
export function Btn({ tone = 'plain', className = '', children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone }) {
  return (
    <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold transition active:scale-[.97] disabled:pointer-events-none disabled:opacity-40 ${TONES[tone]} ${className}`}>
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-semibold text-muted">{label}</span>{children}</label>;
}
export const inputCls = 'w-full rounded-xl border border-line/15 bg-bg px-3.5 py-2.5 text-ink outline-none placeholder:text-muted/70 focus:border-brand';
