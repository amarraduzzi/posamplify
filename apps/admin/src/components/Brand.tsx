import { useMemo, useState } from 'react';
import { AMPLIFY, amplifyMarkSvg } from '@resto/shared';
const STAR = 'M12 1.2L15.16 4.36H19.64V8.84L22.8 12L19.64 15.16V19.64H15.16L12 22.8L8.84 19.64H4.36V15.16L1.2 12L4.36 8.84V4.36H8.84Z';

/** Eight-pointed star (khatam): the Moroccan ornament used across the screens. */
export function Star8({ className = '', filled = true, stroke = 1.2 }: { className?: string; filled?: boolean; stroke?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d={STAR} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : stroke} strokeLinejoin="round" />
    </svg>
  );
}

let seq = 0;
/** The Amplify mark (sound bars + growth arrow). tone: 'dark' = on a dark background (white bars). */
export function AmplifyMark({ className = '', tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  const [id] = useState(() => `am${++seq}`);
  const html = useMemo(() => amplifyMarkSvg({ bars: tone === 'dark' ? '#FFFFFF' : AMPLIFY.navy, id }), [tone, id]);
  return <span className={`inline-block ${className}`} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Logo: the mark plus the wordmark AMPLIFY POS, in the Amplify colors. */
export function AmplifyLogo({ className = '', size = 'md', tone = 'dark' }: { className?: string; size?: 'sm' | 'md' | 'lg'; tone?: 'dark' | 'light' }) {
  const m = size === 'lg' ? 'h-12 w-[3.65rem]' : size === 'sm' ? 'h-7 w-[2.15rem]' : 'h-9 w-[2.75rem]';
  const t = size === 'lg' ? 'text-[1.6rem]' : size === 'sm' ? 'text-[0.95rem]' : 'text-[1.2rem]';
  return (
    <div className={`flex items-center gap-2.5 ${className}`} dir="ltr">
      <AmplifyMark tone={tone} className={`shrink-0 ${m}`} />
      <span className={`font-logo font-extrabold leading-none tracking-[0.02em] ${t} ${tone === 'dark' ? 'text-white' : 'text-[#002E5F]'}`}>
        AMPLIFY <span className="text-[#05B962]">POS</span>
      </span>
    </div>
  );
}

/** Background with the zellige lattice fading out from the top. */
export function PatternBackdrop({ className = '' }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      <div className="fade-b absolute inset-0"><div className="zellige absolute inset-0 opacity-[0.12]" /></div>
    </div>
  );
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
