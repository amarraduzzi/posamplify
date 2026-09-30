import { useMemo } from 'react';
import { AMPLIFY, amplifyMarkSvg } from '@resto/shared';

let seq = 0;
/** The Amplify mark (sound bars + growth arrow). tone 'dark' = on a dark background (white bars). */
export function AmplifyMark({ className = '', tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  const html = useMemo(() => amplifyMarkSvg({ bars: tone === 'dark' ? '#FFFFFF' : AMPLIFY.navy, id: `lm${++seq}` }), [tone]);
  return <span className={`inline-block shrink-0 ${className}`} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />;
}

/** AMPLIFY POS wordmark next to the mark, as on the Amplify logo. */
export function AmplifyLogo({ className = '', mark = 'h-8 w-10', text = 'text-lg', product = 'POS' }: { className?: string; mark?: string; text?: string; product?: 'POS' | 'PROFIT' }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`} dir="ltr">
      <AmplifyMark className={mark} />
      <span className={`font-logo font-extrabold leading-none tracking-[0.02em] whitespace-nowrap text-white ${text}`}>
        AMPLIFY <span className="text-[#05B962]">{product}</span>
      </span>
    </span>
  );
}
