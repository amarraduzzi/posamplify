import { BellRing, ChefHat, Clock, Hourglass, Utensils } from 'lucide-react';
import { t } from '../lib/i18n';
import { courseName } from '../lib/stations';
import type { Phase, Rhythm } from '../lib/rhythm';

// How the rhythm of a table shows: one short line (where they are, since how long) and the ring
// around the table when it waits too long.

export const PHASES: Record<Phase, { label: (c: number | null) => string; Icon: typeof Clock; tone: string; ring: string }> = {
  kitchen: { label: c => (c ? t('{c} en cuisine', { c: courseName(c) }) : t('En cuisine')), Icon: ChefHat, tone: '', ring: 'outline outline-4 outline-offset-2 outline-orange-400' },
  ready: { label: () => t('Prêt'), Icon: BellRing, tone: 'rounded-full bg-warn px-1.5 text-white', ring: 'outline outline-4 outline-offset-2 outline-danger blink' },
  next: { label: c => (c ? t('{c} ?', { c: courseName(c) }) : t('La suite ?')), Icon: Hourglass, tone: '', ring: 'outline outline-4 outline-offset-2 outline-amber-300' },
  eating: { label: c => (c ? t('{c} servi', { c: courseName(c) }) : t('Servi')), Icon: Utensils, tone: '', ring: 'outline outline-4 outline-offset-2 outline-sky-400' },
  sent: { label: () => '', Icon: Clock, tone: '', ring: '' },
};

/** the short line under the table number */
export function RhythmLine({ r, small }: { r: Rhythm; small?: boolean }) {
  const P = PHASES[r.phase];
  return (
    <span className={`mt-0.5 flex max-w-full items-center gap-0.5 truncate font-semibold ${small ? 'text-[10px]' : 'text-[11px]'} ${P.tone || 'opacity-80'}`}>
      <P.Icon className="h-2.5 w-2.5 shrink-0" />
      {!small && P.label(r.course) && <span className="truncate">{P.label(r.course)} ·</span>}
      {r.min < 60 ? t('{n} min', { n: r.min }) : `${Math.floor(r.min / 60)} h ${String(r.min % 60).padStart(2, '0')}`}
    </span>
  );
}

/** the courses of the meal as three small marks: served, going, waiting */
export function CourseDots({ r }: { r: Rhythm }) {
  if (r.courses.length < 2) return null;
  return (
    <span className="mt-1 flex gap-0.5">
      {r.courses.map(x => (
        <i key={x.c} title={courseName(x.c)} className={`h-1.5 w-3 rounded-full ${x.s === 'done' ? 'bg-current opacity-80' : x.s === 'going' ? 'bg-current opacity-40' : 'border border-current opacity-40'}`} />
      ))}
    </span>
  );
}

/** above the room: how many tables are where, and how many wait too long */
export function RhythmSummary({ list }: { list: Rhythm[] }) {
  if (!list.length) return null;
  const count = (p: Phase) => ({ n: list.filter(x => x.phase === p).length, late: list.filter(x => x.phase === p && x.late).length });
  const items: { p: Phase; label: string }[] = [
    { p: 'ready', label: t('À servir') }, { p: 'kitchen', label: t('En cuisine') },
    { p: 'next', label: t('Attendent la suite') }, { p: 'eating', label: t('À table') },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ p, label }) => {
        const c = count(p); if (!c.n) return null;
        const P = PHASES[p];
        return (
          <span key={p} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ${c.late ? 'bg-danger/15 text-danger' : 'bg-surface-2 text-ink/80'}`}>
            <P.Icon className="h-4 w-4" />{label} {c.n}{c.late ? ` · ${t('{n} en retard', { n: c.late })}` : ''}
          </span>
        );
      })}
    </div>
  );
}
