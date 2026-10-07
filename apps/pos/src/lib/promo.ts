// Happy hours shown on the till tiles. The database applies the real price when the line is sent;
// this only mirrors app.in_window so staff see "-30 %" on the right dishes at the right time.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface HappyHour {
  id: string; name: string; value: number; category_ids: string[]; item_ids: string[];
  days: number[]; start_time: string | null; end_time: string | null; starts_on: string | null; ends_on: string | null;
}

function local(tz: string, at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(at).map(x => [x.type, x.value]));
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1;
  return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, dow };
}
const prevDay = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

export function inWindow(h: HappyHour, tz: string, at = new Date()): boolean {
  const { day, hm, dow } = local(tz, at);
  const t1 = h.start_time?.slice(0, 5), t2 = h.end_time?.slice(0, 5);
  const dated = (d: string) => (!h.starts_on || d >= h.starts_on) && (!h.ends_on || d <= h.ends_on);
  if (!t1 || !t2 || t1 === t2) return h.days.includes(dow) && dated(day);
  if (t1 < t2) return hm >= t1 && hm < t2 && h.days.includes(dow) && dated(day);
  if (hm >= t1) return h.days.includes(dow) && dated(day);
  if (hm < t2) return h.days.includes(((dow + 5) % 7) + 1) && dated(prevDay(day));
  return false;
}

/** Percent off (basis points) per item right now, refreshed every minute. Mirrors the server: the best happy hour wins. */
export function useHappyHours(rid: string | undefined, tz: string) {
  const [list, setList] = useState<HappyHour[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!rid) return;
    let alive = true;
    const load = () => supabase.from('promotions').select('id,name,value,category_ids,item_ids,days,start_time,end_time,starts_on,ends_on')
      .eq('restaurant_id', rid).eq('kind', 'happy_hour').eq('active', true)
      .then(({ data }) => { if (alive && data) setList(data as HappyHour[]); });
    load();
    const a = setInterval(() => setTick(x => x + 1), 60_000), b = setInterval(load, 10 * 60_000);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, [rid]);
  void tick;
  const live = list.filter(h => inWindow(h, tz));
  return (itemId: string, categoryId: string) => live
    .filter(h => (!h.category_ids.length && !h.item_ids.length) || h.category_ids.includes(categoryId) || h.item_ids.includes(itemId))
    .reduce((m, h) => Math.max(m, h.value), 0);
}
