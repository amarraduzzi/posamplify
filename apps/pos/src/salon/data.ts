// The salon on the till: its data (prestations, people, today's appointments, the Nouba, the till).
import { supabase } from '../lib/supabase';
import type { Restaurant } from '../lib/types';

export interface Svc { id: string; name: Record<string, string>; category: string | null; duration_min: number; price_cents: number; price_from: boolean; active: boolean; sort_order: number }
export interface Product { id: string; name: string; category: string | null; price_cents: number; stock: number; min_stock: number | null }
export interface Person { id: string; name: string; role: 'staff' | 'manager'; agenda_color: string | null; agenda: boolean; agenda_services: string[] }
export interface Appt {
  id: string; staff_id: string | null; service_id: string | null; status: string; source: string; starts_at: string; duration_min: number;
  name: string; phone: string | null; note: string | null; service_name: Record<string, string>; price_cents: number; client_confirmed_at: string | null;
}
export interface QEntry {
  id: string; status: 'waiting' | 'serving'; name: string; phone: string | null; service_id: string | null; staff_id: string | null;
  served_by: string | null; remote: boolean; coming: boolean; created_at: string; started_at: string | null; start: string | null;
}
export interface Board { open: boolean; working: number; staff: string[]; wait_min: number | null; queue: QEntry[] }
export interface Unpaid { kind: 'appointment' | 'queue'; id: string; name: string; phone: string | null; at: string; status: string; staff_id: string | null; service_id: string | null; service: Record<string, string> | null; price_cents: number | null; reason?: string }
export interface Sale {
  id: string; number: number; at: string; name: string | null; phone: string | null; staff_id: string | null; cashier_id: string | null; total_cents: number; tip_cents: number;
  discount_cents: number; discount_reason: string | null; free_reason: string | null; cash_cents: number | null; card_cents: number;
  appointment_id: string | null; queue_id: string | null; cancelled: boolean; cancel_reason: string | null;
  lines: { kind: string; name: string; quantity: number; line_cents: number; staff_id: string | null }[];
}
export interface TillDay {
  date: string; today: string; manager: boolean; sales: Sale[]; unpaid: Unpaid[];
  totals: { tickets: number; total_cents: number; card_cents: number; cash_cents: number | null; tip_cents: number; discount_cents: number; free: number; cancelled: number };
  staff: { staff_id: string; total_cents: number; clients: number; tip_cents: number }[];
  closed: null | { at: string; counted_cash_cents: number; expected_cash_cents: number; cash_diff_cents: number; unpaid: Unpaid[]; note: string | null; staff_id: string | null };
}
export interface From { appointment_id?: string; queue_id?: string; name?: string; phone?: string | null; staff_id?: string | null; service_id?: string | null; price_cents?: number | null }

/** a salon: Amplify Agenda without the restaurant products */
export const isSalon = (r: Restaurant) => !!r.products?.includes('agenda') && !r.products.some(p => p === 'pos' || p === 'profit' || p === 'orders');
export const svcName = (n: Record<string, string> | null | undefined) => (n ? n.fr || n.ar || n.en || '' : '');
const HEX = /^#[0-9a-f]{6}$/i;
export const colorOf = (p?: Pick<Person, 'agenda_color'>) => (p?.agenda_color && HEX.test(p.agenda_color) ? p.agenda_color : '#64748b');
export const fromUnpaid = (u: Unpaid): From => ({
  appointment_id: u.kind === 'appointment' ? u.id : undefined, queue_id: u.kind === 'queue' ? u.id : undefined,
  name: u.name, phone: u.phone, staff_id: u.staff_id, service_id: u.service_id, price_cents: u.price_cents,
});
/** a Moroccan number for wa.me: 06... -> 2126... */
export const waLink = (phone: string, text: string) => {
  const d = phone.replace(/\D/g, ''); const n = d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? `212${d.slice(1)}` : d;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
};

function tzOffset(at: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(at).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - at.getTime()) / 60000;
}
/** the instant of a local date (YYYY-MM-DD) and time (HH:MM) in a time zone */
export function instant(day: string, hm: string, tz: string) {
  const guess = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), +hm.slice(0, 2), +hm.slice(3, 5)));
  return new Date(guess.getTime() - tzOffset(guess, tz) * 60000);
}
export const ymdIn = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export async function loadSalonStatic(rid: string) {
  const [p, s, pr] = await Promise.all([
    supabase.from('staff').select('id,name,role,agenda_color,agenda,agenda_services').eq('restaurant_id', rid).eq('active', true).order('agenda_sort').order('name'),
    supabase.from('agenda_services').select('id,name,category,duration_min,price_cents,price_from,active,sort_order').eq('restaurant_id', rid).eq('active', true).order('sort_order'),
    supabase.from('agenda_products').select('id,name,category,price_cents,stock,min_stock').eq('restaurant_id', rid).eq('kind', 'retail').eq('active', true).order('sort_order').order('name'),
  ]);
  if (p.error) throw p.error; if (s.error) throw s.error;
  return { people: p.data as Person[], services: s.data as Svc[], products: (pr.error ? [] : pr.data) as Product[] };
}
export async function loadToday(rid: string, tz: string) {
  const day = ymdIn(new Date(), tz);
  const next = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + 1)).toISOString().slice(0, 10);
  const [a, b, c] = await Promise.all([
    supabase.from('agenda_appointments').select('id,staff_id,service_id,status,source,starts_at,duration_min,name,phone,note,service_name,price_cents,client_confirmed_at')
      .eq('restaurant_id', rid).gte('starts_at', instant(day, '00:00', tz).toISOString()).lt('starts_at', instant(next, '00:00', tz).toISOString()).neq('status', 'cancelled').order('starts_at'),
    supabase.rpc('nouba_board', { p_restaurant_id: rid }),
    supabase.rpc('agenda_day_till', { p_restaurant_id: rid, p_date: null }),
  ]);
  if (a.error) throw a.error; if (c.error) throw c.error;
  return { appts: a.data as Appt[], board: (b.error ? null : b.data) as Board | null, till: c.data as TillDay };
}
