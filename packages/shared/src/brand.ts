// Amplify brand: colors taken from the Amplify Growth Studio logo, and the logo
// mark (sound bars + growth arrow) redrawn as a vector so it stays sharp at any
// size and also works on dark backgrounds. No React here: each app wraps it.

export const AMPLIFY = {
  navy: '#002E5F',
  navyDeep: '#001E3E',
  green: '#05B962',
  greenDeep: '#00874B',
} as const;

const RIBBON = 'M175 312 L313 140 L355 203 L440 98 L505 128 Q474 222 405 260 Q362 282 348 250 L310 196 Q268 272 175 312 Z';
const HEAD = 'M392 82 L536 20 L538 166 Z';

/**
 * The mark as an SVG string.
 * bars: color of the bars and the swoosh (navy on light, white on dark).
 * id: unique per page, used for the mask that cuts the bars around the arrow.
 */
export function amplifyMarkSvg({ bars = AMPLIFY.navy, id = 'am' }: { bars?: string; id?: string } = {}): string {
  const g = `${id}g`, m = `${id}m`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="14 14 530 348" width="100%" height="100%" aria-hidden="true">
<defs>
<linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16C872"/><stop offset=".55" stop-color="${AMPLIFY.green}"/><stop offset="1" stop-color="#079A52"/></linearGradient>
<mask id="${m}" maskUnits="userSpaceOnUse" x="0" y="0" width="560" height="370"><rect width="560" height="370" fill="#fff"/><path d="${RIBBON}" fill="#000" stroke="#000" stroke-width="20" stroke-linejoin="round"/></mask>
</defs>
<g fill="${bars}" mask="url(#${m})">
<rect x="20" y="210" width="35" height="56" rx="17.5"/><rect x="73" y="185" width="34" height="107" rx="17"/><rect x="126" y="150" width="34" height="160" rx="17"/><rect x="179" y="120" width="35" height="235" rx="17.5"/><rect x="232" y="152" width="35" height="173" rx="17.5"/>
</g>
<path d="M376 287 Q472 266 494 166 Q492 256 376 287 Z" fill="${bars}"/>
<g fill="url(#${g})" stroke="url(#${g})" stroke-width="3" stroke-linejoin="round"><path d="${RIBBON}"/><path d="${HEAD}"/></g>
</svg>`;
}
