// The rhythm of the evening: where each table is in its meal, and since when.
// From the lines of its open orders: sent to the kitchen, marked ready on the kitchen screen,
// served at the table, held for "Envoyer la suite". A table that waits too long turns colour.
// Restaurants without a kitchen screen never mark dishes ready: then the till does not count
// "waiting for the kitchen" (it would always look late) and keeps to what it knows.
import type { Order } from './types';

/** minutes after which a table is "late" at each stage */
export const LATE = { kitchen: 20, ready: 4, next: 20, eating: 40 };

export type Phase = 'kitchen' | 'ready' | 'next' | 'eating' | 'sent';
export interface Rhythm {
  phase: Phase;
  /** the course concerned (1 starter, 2 main, 3 dessert), null without courses */
  course: number | null;
  /** minutes in this phase */
  min: number;
  late: boolean;
  /** courses of the meal: done (served), going (in the kitchen or on the table), waiting (held) */
  courses: { c: number; s: 'done' | 'going' | 'waiting' }[];
}

const KEY = 'pos-rhythm-seen';
/** what this till has seen the team use: the kitchen screen (ready), the "served" tap */
function seen(orders: Order[]) {
  let s = { ready: false, served: false };
  try { s = { ...s, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* fine */ }
  const lines = orders.flatMap(o => o.order_lines);
  const now = { ready: s.ready || lines.some(l => l.ready_at), served: s.served || lines.some(l => l.served_at) };
  if (now.ready !== s.ready || now.served !== s.served) { try { localStorage.setItem(KEY, JSON.stringify(now)); } catch { /* fine */ } }
  return now;
}

const mins = (iso: string, at: number) => Math.max(0, Math.floor((at - Date.parse(iso)) / 60000));
const latest = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().pop() ?? null;
const earliest = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;

export function rhythmOf(tableOrders: Order[], allOrders: Order[], at = Date.now()): Rhythm | null {
  const lines = tableOrders.flatMap(o => o.order_lines).filter(l => Number(l.quantity) > 0);
  if (!lines.length) return null;
  const use = seen(allOrders);
  const sent = lines.filter(l => !l.held);
  const held = lines.filter(l => l.held);
  const cs = [...new Set(lines.map(l => l.course).filter((c): c is number => !!c))].sort();
  const courses = cs.map(c => {
    const ls = lines.filter(l => l.course === c);
    const s: 'done' | 'going' | 'waiting' = ls.every(l => l.held) ? 'waiting' : use.served && ls.filter(l => !l.held).every(l => l.served_at) ? 'done' : 'going';
    return { c, s };
  });
  const minCourse = (ls: typeof lines) => ls.map(l => l.course ?? 0).filter(Boolean).sort()[0] ?? null;
  const maxCourse = (ls: typeof lines) => ls.map(l => l.course ?? 0).filter(Boolean).sort().pop() ?? null;

  // a dish ready at the pass and not taken to the table: it gets cold
  const ready = sent.filter(l => l.ready_at && !l.served_at);
  if (ready.length) {
    const m = mins(earliest(ready.map(l => l.ready_at))!, at);
    return { phase: 'ready', course: minCourse(ready), min: m, late: m >= LATE.ready, courses };
  }
  // in the kitchen (only counted where the kitchen screen is used)
  const cooking = sent.filter(l => !l.ready_at && !l.served_at);
  if (use.ready && cooking.length) {
    const m = mins(earliest(cooking.map(l => l.kitchen_sent_at ?? l.created_at))!, at);
    return { phase: 'kitchen', course: minCourse(cooking), min: m, late: m >= LATE.kitchen, courses };
  }
  if (use.served && !cooking.length) {
    const m = mins(latest(sent.map(l => l.served_at)) ?? earliest(sent.map(l => l.created_at))!, at);
    // everything served and a course still held: time for "Envoyer la suite"?
    if (held.length) return { phase: 'next', course: minCourse(held), min: m, late: m >= LATE.next, courses };
    return { phase: 'eating', course: maxCourse(sent), min: m, late: m >= LATE.eating, courses };
  }
  // without the screens: only the time since the last dishes were sent
  const m = mins(latest(sent.map(l => l.kitchen_sent_at ?? l.created_at)) ?? lines[0].created_at, at);
  return { phase: held.length ? 'next' : 'sent', course: held.length ? minCourse(held) : maxCourse(sent), min: m, late: false, courses };
}
