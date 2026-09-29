import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Bottom sheet on phones, centered dialog on wider screens. */
export function Sheet({ open, onClose, title, children, footer, closeLabel }: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/55 animate-fade" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="relative w-full sm:max-w-md max-h-[92dvh] flex flex-col bg-surface text-ink rounded-t-3xl sm:rounded-3xl shadow-2xl animate-sheet outline-none"
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        <div className="flex items-start gap-3 px-5 pt-3 pb-2">
          <div className="flex-1 min-w-0">{title}</div>
          <button
            onClick={onClose}
            aria-label={closeLabel}
            className="shrink-0 -me-1 grid place-items-center size-9 rounded-full bg-surface-2 text-muted hover:text-ink transition-colors"
          >
            <X className="size-4.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-line px-5 pt-3 pb-safe">{footer}</div>}
      </div>
    </div>
  );
}
