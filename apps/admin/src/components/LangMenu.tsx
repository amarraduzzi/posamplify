// One small button with the current language (FR ▾); tapping it opens the three languages under each other.
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { useAdminCtx } from '../store';
import { LANGS } from '../lib/i18n';

export function LangMenu({ dark = false, className = '' }: { dark?: boolean; className?: string }) {
  const a = useAdminCtx();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const cur = LANGS.find(l => l.id === a.lang) ?? LANGS[0];
  return (
    <div ref={box} className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Langue / اللغة / Language"
        className={`flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-bold transition ${dark ? 'bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/15' : 'border border-[rgb(var(--line)/.12)] bg-[rgb(var(--surface))] text-[rgb(var(--ink))] hover:bg-[rgb(var(--surface-2))]'}`}>
        <Globe className="h-4 w-4 opacity-70" />{cur.short}<ChevronDown className={`h-3.5 w-3.5 opacity-60 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="menu" className="absolute end-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-2xl border border-[rgb(var(--line)/.1)] bg-[rgb(var(--surface))] p-1.5 text-[rgb(var(--ink))] shadow-2xl">
          {LANGS.map(l => (
            <li key={l.id}>
              <button type="button" role="menuitemradio" aria-checked={l.id === a.lang} lang={l.id} onClick={() => { a.setLang(l.id); setOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-start text-sm font-semibold ${l.id === a.lang ? 'bg-[rgb(var(--brand)/.12)]' : 'hover:bg-[rgb(var(--surface-2))]'}`}>
                <span className="flex-1">{l.label}</span>{l.id === a.lang && <Check className="h-4 w-4 text-[rgb(var(--brand))]" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
