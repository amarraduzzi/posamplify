/** Eight-pointed star (khatam), the signature of Moroccan zellige. */
export function Star8({ className = '', filled = true, stroke = 1.2 }: { className?: string; filled?: boolean; stroke?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M12 1.2L15.16 4.36H19.64V8.84L22.8 12L19.64 15.16V19.64H15.16L12 22.8L8.84 19.64H4.36V15.16L1.2 12L4.36 8.84V4.36H8.84Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0 : stroke}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Thin line, star, thin line. */
export function Divider({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 text-brand ${className}`} aria-hidden>
      <span className="h-px w-10 bg-gradient-to-r from-transparent to-current opacity-60 rtl:rotate-180" />
      <Star8 className="size-2.5" />
      <span className="h-px w-10 bg-gradient-to-l from-transparent to-current opacity-60 rtl:rotate-180" />
    </div>
  );
}

/** Product signature shown at the bottom of every guest menu. */
export function PoweredBy({ label }: { label: string }) {
  return (
    <a href="https://amplify-admin.pages.dev" target="_blank" rel="noopener"
      className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors">
      <span>{label}</span>
      <Star8 className="size-3 text-brand" />
      <span className="font-semibold tracking-wide text-ink/80">Amplify POS</span>
    </a>
  );
}
