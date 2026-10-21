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

export interface PromoInfo { code: string; name: string; discount_type: 'percent' | 'amount'; value: number; min_order_cents: number }
export const checkPromo = (slug: string, code: string, subtotal: number) =>
  call<PromoInfo>('check_promo_code', { p_slug: slug, p_code: code, p_subtotal_cents: subtotal });

// ---- the story actions: a one-time code for the next visit
export interface GuestVoucher {
  code: string; name: string; discount_type: 'percent' | 'amount'; value: number; min_order_cents: number;
  starts_on: string; ends_on: string; days: number[]; start_time: string | null; end_time: string | null; channels: string[];
}
export type VoucherResult = { status: 'ok'; voucher: GuestVoucher } | { status: 'none' | 'full' };
export const issueVoucher = (orderId: string, actionId: string) =>
  call<VoucherResult>('issue_guest_voucher', { p_order_id: orderId, p_action_id: actionId });

// ---- reservations and waitlist
export interface BookingInfo { enabled: boolean; waitlist: boolean; max_party: number; days_ahead: number; note: string | null; name: string; timezone: string; deposit_party?: number | null; deposit_cents?: number | null }
export interface ReservationStatus {
  kind: 'booking' | 'waitlist'; status: 'requested' | 'confirmed' | 'called' | 'seated' | 'cancelled' | 'no_show';
  starts_at: string | null; party_size: number; name: string; created_at: string; called_at: string | null; quoted_min: number | null; ahead: number | null;
  occasion?: string | null; deposit_cents?: number | null; deposit_state?: 'due' | 'paid' | 'used' | 'refunded' | 'kept' | null;
  restaurant: { name: string; slug: string; phone: string | null; address: string | null; city: string | null; timezone: string; note: string | null };
}
export const getBookingInfo = (slug: string) => call<BookingInfo | null>('get_booking_info', { p_slug: slug });
export const bookingSlots = (slug: string, date: string, party: number) => call<string[]>('booking_slots', { p_slug: slug, p_date: date, p_party: party });
export const bookTable = (slug: string, b: { client_id: string; starts_at: string; party_size: number; name: string; phone: string; note?: string; occasion?: string }) =>
  call<{ token: string; status: string; starts_at: string }>('book_table', { p_slug: slug, p_booking: b });
export const joinWaitlist = (slug: string, e: { client_id: string; party_size: number; name: string; phone: string }) =>
  call<{ token: string }>('waitlist_join', { p_slug: slug, p_entry: e });
export const reservationStatus = (token: string) => call<ReservationStatus | null>('reservation_status', { p_token: token });
export const reservationCancel = (token: string) => call<{ ok: boolean }>('reservation_cancel', { p_token: token });

// ---- the courier's page (?livreur=<token>)
export interface CourierOrder {
  id: string; ticket_number: number; status: 'assigned' | 'picked_up'; customer_name: string | null; customer_phone: string | null;
  address: string | null; location: { lat: number; lng: number } | null; total_cents: number; paid: boolean; note: string | null;
  wanted_at: string | null; eta_at: string | null; kitchen_ready: boolean; items: { q: number; name: string }[];
}
export interface CourierPage {
  courier: { name: string }; restaurant: { name: string; phone: string | null; address: string | null; city: string | null; timezone: string };
  orders: CourierOrder[]; done_today: number; cash_to_return_cents: number;
}
export const courierOrders = (token: string) => call<CourierPage>('courier_orders', { p_token: token });
export const courierUpdate = (token: string, orderId: string, action: 'picked_up' | 'delivered' | 'failed', code?: string, note?: string) =>
  call<{ ok: boolean; error?: string; tries_left?: number }>('courier_update', { p_token: token, p_order_id: orderId, p_action: action, p_code: code ?? null, p_note: note ?? null });

// ---- the sign-up QR (club, tastings)
export interface SignupInfo {
  name: string; branding: Record<string, unknown> | null; languages: string[]; enabled: boolean;
  loyalty: { reward_points: number; reward_cents: number; per_dh: number } | null;
  event: { name: string; offer: string | null; active: boolean } | null;
}
export interface SignupResult { name: string; existed: boolean; again: boolean; event: string | null; offer: string | null; card_key?: string | null }
export const signupInfo = (slug: string, event: string | null) => call<SignupInfo | null>('signup_info', { p_slug: slug, p_event: event });
export const customerSignup = (slug: string, name: string, phone: string, consent: boolean, event: string | null) =>
  call<SignupResult>('customer_signup', { p_slug: slug, p_name: name, p_phone: phone, p_consent: consent, p_event: event });

// ---- the customer's points card (?carte=<key>)
/** A reward on the card: a free dish (named in every language, maybe with a photo) or money off. */
export interface CardReward { id: string; kind: 'item' | 'discount'; points: number; cents: number | null; name: Record<string, string | null> | null; image_url: string | null }
export interface CustomerCard {
  restaurant: { name: string; branding: Record<string, unknown> | null; languages: string[] };
  loyalty: { enabled: boolean; per_dh: number; reward_points: number; reward_cents: number; rewards?: CardReward[] };
  customer: { name: string | null; points: number; visits: number; last_visit_at: string | null };
  recent: { points: number; reason: 'earn' | 'redeem'; at: string; name?: string | null }[];
}
export interface CardGift { id: string; label: string; expires_at: string | null }
/** The gifts the guest has won and not used yet (separate function: a card still opens if it is not installed). */
export const customerWallet = (slug: string, key: string) => call<CardGift[]>('customer_card_wallet', { p_slug: slug, p_key: key });
export const customerCard = (slug: string, key: string) => call<CustomerCard | null>('customer_card', { p_slug: slug, p_key: key });
