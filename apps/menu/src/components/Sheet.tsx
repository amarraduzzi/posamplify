import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Bottom sheet on phones, centered dialog on wider screens. `media` renders edge to edge above the title. */
export function Sheet({ open, onClose, title, children, footer, closeLabel, media }: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
  media?: ReactNode;
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[3px] animate-fade" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="relative w-full sm:max-w-md max-h-[94dvh] flex flex-col bg-surface text-ink rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl animate-sheet outline-none overflow-hidden"
      >
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {media ? (
            <div className="relative">
              {media}
              <div className="absolute top-2.5 inset-x-0 mx-auto h-1.5 w-10 rounded-full bg-white/70 sm:hidden" aria-hidden />
            </div>
          ) : (
            <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
          )}
          <div className="flex items-start gap-3 px-6 pt-4 pb-2">
            <div className="flex-1 min-w-0">{title}</div>
            {!media && <CloseButton onClose={onClose} label={closeLabel} />}
          </div>
          <div className="px-6 pb-5">{children}</div>
        </div>
        {media && <CloseButton onClose={onClose} label={closeLabel} floating />}
        {footer && <div className="border-t border-line bg-surface px-5 pt-3 pb-safe">{footer}</div>}
      </div>
    </div>
  );
}

function CloseButton({ onClose, label, floating }: { onClose: () => void; label: string; floating?: boolean }) {
  return (
    <button
      onClick={onClose}
      aria-label={label}
      className={floating
        ? 'absolute top-4 end-4 grid place-items-center size-10 rounded-full bg-black/45 text-white backdrop-blur-md press'
        : 'shrink-0 -me-1 grid place-items-center size-9 rounded-full bg-surface-2 text-muted hover:text-ink transition-colors'}
    >
      <X className="size-4.5" />
    </button>
  );
}
