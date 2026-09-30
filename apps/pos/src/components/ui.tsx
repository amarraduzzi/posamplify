import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { t } from '../lib/i18n';

export function Modal({ title, onClose, children, footer, wide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#02050c]/70 p-4 backdrop-blur-[2px]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" className={`pop panel flex max-h-full w-full flex-col overflow-hidden rounded-3xl shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
        <div className="flex items-center justify-between gap-3 border-b border-line/[0.07] px-6 py-4">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button onClick={onClose} aria-label={t('Fermer')} className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-line/[0.07] bg-bg/40 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

type BtnTone = 'brand' | 'ghost' | 'danger' | 'ok' | 'plain';
const TONES: Record<BtnTone, string> = {
  brand: 'gold-fill text-brand-ink hover:brightness-110',
  ok: 'bg-ok text-[#032A2A] shadow-[0_10px_24px_-12px_rgb(var(--ok)/.8)] hover:brightness-110',
  danger: 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20',
  ghost: 'border border-line/15 text-ink hover:bg-surface-2',
  plain: 'bg-surface-2 text-ink border border-line/[0.06] hover:bg-surface-3',
};
export function Btn({ tone = 'plain', className = '', children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone }) {
  return (
    <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 font-semibold transition active:scale-[.97] disabled:pointer-events-none disabled:opacity-40 ${TONES[tone]} ${className}`}>
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-semibold text-muted">{label}</span>{children}</label>;
}
export const inputCls = 'w-full rounded-xl border border-line/[0.12] bg-bg/70 px-3.5 py-2.5 text-ink outline-none transition placeholder:text-muted/60 focus:border-brand focus:ring-2 focus:ring-brand/20';
