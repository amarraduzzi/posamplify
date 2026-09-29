const STAR = 'M12 1.2L15.16 4.36H19.64V8.84L22.8 12L19.64 15.16V19.64H15.16L12 22.8L8.84 19.64H4.36V15.16L1.2 12L4.36 8.84V4.36H8.84Z';

/** Eight-pointed star (khatam), the Amplify POS mark. */
export function Star8({ className = '', filled = true, stroke = 1.2 }: { className?: string; filled?: boolean; stroke?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d={STAR} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : stroke} strokeLinejoin="round" />
    </svg>
  );
}

/** Logo: gold star with a small inner star cut out, plus the wordmark. */
export function AmplifyLogo({ className = '', size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'lg' ? 'h-11 w-11' : size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
  const t = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-base' : 'text-lg';
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className={`relative grid place-items-center ${s}`}>
        <Star8 className="absolute inset-0 h-full w-full text-brand" />
        <Star8 className="relative h-[42%] w-[42%] text-bg" />
      </span>
      <span className={`font-display font-semibold leading-none ${t}`}>
        Amplify <span className="text-brand">POS</span>
      </span>
    </div>
  );
}

/** Background with the zellige lattice fading out from the top. */
export function PatternBackdrop({ className = '' }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      <div className="fade-radial absolute inset-0"><div className="zellige absolute inset-0 opacity-[0.13]" /></div>
    </div>
  );
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
