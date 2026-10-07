import { PostgrestClient } from '@supabase/postgrest-js';
import type { OrderStatusResult, PlaceOrderInput, PlaceOrderResult, PublicMenu } from '@resto/shared';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Guests never log in: the anon key only allows the three public functions.
// Only the small PostgREST client is used (not the full supabase-js with auth,
// realtime and storage), which keeps the guest page light on slow 4G.
// Works with both the new publishable keys (sb_publishable_...) and legacy
// anon JWTs; only a JWT may go in the Authorization header.
const db = new PostgrestClient(`${url}/rest/v1`, {
  headers: anonKey?.startsWith('eyJ')
    ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
    : { apikey: anonKey },
});

export class ApiError extends Error {
  constructor(message: string, public details?: string) { super(message); }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  try {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new ApiError(error.message, error.details ?? undefined);
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('network');
  }
}

export const getMenu = (slug: string, tableToken: string | null) =>
  call<PublicMenu | null>('get_menu', { p_slug: slug, p_table_token: tableToken });

export const placeOrder = (slug: string, order: PlaceOrderInput) =>
  call<PlaceOrderResult>('place_order', { p_slug: slug, p_order: order });

export const getOrderStatus = (orderId: string) =>
  call<OrderStatusResult | null>('get_order_status', { p_order_id: orderId });

// ---- reservations and waitlist
export interface BookingInfo { enabled: boolean; waitlist: boolean; max_party: number; days_ahead: number; note: string | null; name: string; timezone: string }
export interface ReservationStatus {
  kind: 'booking' | 'waitlist'; status: 'requested' | 'confirmed' | 'called' | 'seated' | 'cancelled' | 'no_show';
  starts_at: string | null; party_size: number; name: string; created_at: string; called_at: string | null; quoted_min: number | null; ahead: number | null;
  restaurant: { name: string; slug: string; phone: string | null; address: string | null; city: string | null; timezone: string; note: string | null };
}
export const getBookingInfo = (slug: string) => call<BookingInfo | null>('get_booking_info', { p_slug: slug });
export const bookingSlots = (slug: string, date: string, party: number) => call<string[]>('booking_slots', { p_slug: slug, p_date: date, p_party: party });
export const bookTable = (slug: string, b: { client_id: string; starts_at: string; party_size: number; name: string; phone: string; note?: string }) =>
  call<{ token: string; status: string; starts_at: string }>('book_table', { p_slug: slug, p_booking: b });
export const joinWaitlist = (slug: string, e: { client_id: string; party_size: number; name: string; phone: string }) =>
  call<{ token: string }>('waitlist_join', { p_slug: slug, p_entry: e });
export const reservationStatus = (token: string) => call<ReservationStatus | null>('reservation_status', { p_token: token });
export const reservationCancel = (token: string) => call<{ ok: boolean }>('reservation_cancel', { p_token: token });
