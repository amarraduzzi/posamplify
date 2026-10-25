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

/** boccadillos mode: the guest must give a name (the order is paid at the counter first) */
export const getBoccadillos = (slug: string) =>
  call<boolean>('get_boccadillos', { p_slug: slug });

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
export interface BookingInfo { enabled: boolean; waitlist: boolean; max_party: number; days_ahead: number; note: string | null; name: string; timezone: string; deposit_party?: number | null; deposit_cents?: number | null; offers?: OfferPublic[] }
/** a formule (ftour, group menu, special evening): fixed menu per guest at a fixed time */
export interface OfferPublic {
  id: string; kind: 'ftour' | 'group' | 'event'; name: string; description: string | null; price_cents: number; deposit_cents: number | null;
  options: string[]; min_party: number; max_party: number; starts_on: string | null; ends_on: string | null; weekdays: number[]; at_time: string;
}
export interface ReservationStatus {
  kind: 'booking' | 'waitlist'; status: 'requested' | 'confirmed' | 'called' | 'seated' | 'cancelled' | 'no_show';
  starts_at: string | null; party_size: number; name: string; created_at: string; called_at: string | null; quoted_min: number | null; ahead: number | null;
  occasion?: string | null; deposit_cents?: number | null; deposit_state?: 'due' | 'paid' | 'used' | 'refunded' | 'kept' | null;
  offer?: string | null; offer_choices?: Record<string, number>;
  restaurant: { name: string; slug: string; phone: string | null; address: string | null; city: string | null; timezone: string; note: string | null };
}
export const getBookingInfo = (slug: string) => call<BookingInfo | null>('get_booking_info', { p_slug: slug });
export const bookingSlots = (slug: string, date: string, party: number) => call<string[]>('booking_slots', { p_slug: slug, p_date: date, p_party: party });
export const bookTable = (slug: string, b: { client_id: string; starts_at: string; party_size: number; name: string; phone: string; note?: string; occasion?: string }) =>
  call<{ token: string; status: string; starts_at: string }>('book_table', { p_slug: slug, p_booking: b });
export const offerDays = (slug: string, offerId: string, party: number) => call<{ day: string; left: number }[]>('offer_days', { p_slug: slug, p_offer_id: offerId, p_party: party });
export const bookOffer = (slug: string, b: { client_id: string; offer_id: string; day: string; party_size: number; name: string; phone: string; note?: string; choices?: Record<string, number> }) =>
  call<{ token: string; status: string; starts_at: string; deposit_cents: number | null }>('book_offer', { p_slug: slug, p_booking: b });
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
  loyalty: { reward_points: number; reward_cents: number; per_dh: number; mode?: 'rewards' | 'value'; percent?: number | null } | null;
  event: { name: string; offer: string | null; active: boolean } | null;
}
export interface SignupResult { name: string; existed: boolean; again: boolean; event: string | null; offer: string | null; card_key?: string | null }
export const signupInfo = (slug: string, event: string | null) => call<SignupInfo | null>('signup_info', { p_slug: slug, p_event: event });
export const customerSignup = (slug: string, name: string, phone: string, consent: boolean, event: string | null) =>
  call<SignupResult>('customer_signup', { p_slug: slug, p_name: name, p_phone: phone, p_consent: consent, p_event: event });

// ---- the customer's points card (?carte=<key>)
/** A reward on the card: a free dish (named in every language, maybe with a photo) or money off. */
export interface CardReward { id: string; kind: 'item' | 'discount'; points: number; cents: number | null; name: Record<string, string | null> | null; image_url: string | null }
export interface CardDish { name: Record<string, string | undefined> | null; price_cents: number; image_url: string | null }
export interface CustomerCard {
  restaurant: { name: string; branding: Record<string, unknown> | null; languages: string[] };
  loyalty: { enabled: boolean; per_dh: number; reward_points: number; reward_cents: number; rewards?: CardReward[];
    /** savings mode: 1 point = 1 DH; menu = what the savings buy now, next = just above */
    mode?: 'rewards' | 'value'; percent?: number | null; min_points?: number; menu?: CardDish[]; next?: CardDish[] };
  customer: { name: string | null; points: number; spendable?: number; visits: number; last_visit_at: string | null };
  recent: { points: number; reason: 'earn' | 'redeem'; at: string; name?: string | null }[];
}
export interface CardGift { id: string; label: string; expires_at: string | null }
/** The gifts the guest has won and not used yet (separate function: a card still opens if it is not installed). */
export const customerWallet = (slug: string, key: string) => call<CardGift[]>('customer_card_wallet', { p_slug: slug, p_key: key });
export const customerCard = (slug: string, key: string) => call<CustomerCard | null>('customer_card', { p_slug: slug, p_key: key });

// ---- Le service discret: the guest at a table calls a waiter, water or the bill
export type ServiceKind = 'waiter' | 'water' | 'bill';
export interface TableService { enabled: boolean; open?: { kind: ServiceKind; at: string }[]; done?: { kind: ServiceKind; at: string }[] }
export const tableService = (slug: string, token: string) => call<TableService>('table_service', { p_slug: slug, p_table_token: token });
export const callService = (slug: string, token: string, kind: ServiceKind) =>
  call<{ ok: boolean; at: string; again: boolean }>('call_service', { p_slug: slug, p_table_token: token, p_kind: kind });

// ---- Amplify Agenda: the salon's booking page (?rdv) and the client's page (?rdv=<token>)
export type LText = Record<string, string | undefined>;
export interface AgendaService { id: string; name: LText; description: LText; category: string | null; duration_min: number; price_cents: number; price_from: boolean; deposit_cents?: number }
export interface AgendaStaff { id: string; name: string; color: string | null; services: string[] }
export interface AgendaInfo {
  enabled: boolean; name: string; timezone: string; languages: string[]; branding: Record<string, unknown> | null;
  phone: string | null; address: string | null; city: string | null; note: string | null;
  days_ahead: number; cancel_hours: number; any_staff: boolean; services: AgendaService[]; staff: AgendaStaff[]; deposit_hours?: number | null;
}
export interface AgendaBooked { token: string; status: 'requested' | 'confirmed'; starts_at: string; duplicate: boolean; staff?: string }
export interface AgendaStatus {
  status: 'requested' | 'confirmed' | 'arrived' | 'done' | 'cancelled' | 'no_show'; starts_at: string; ends_at: string; duration_min: number;
  service: LText; price_cents: number; price_from: boolean; name: string; staff: string | null; any_staff: boolean;
  cancelled_by: 'client' | 'salon' | null; can_cancel: boolean; client_confirmed?: boolean; can_confirm?: boolean;
  deposit?: AgendaDeposit | null;
  salon: { name: string; slug: string; phone: string | null; address: string | null; city: string | null; timezone: string; languages: string[];
           branding: Record<string, unknown> | null; cancel_hours: number; note: string | null; handle?: string | null };
}
export interface AgendaDeposit {
  amount_cents: number; reason: 'service' | 'no_shows' | 'manual'; due_at: string | null; reported: boolean;
  status: 'pending' | 'paid' | 'expired' | 'cancelled' | 'to_settle' | 'kept' | 'credited' | 'refunded';
  pay?: { rib?: string; rib_name?: string; bank?: string; cashplus?: string; link?: string; note?: string } | null;
}
export const agendaDepositReport = (token: string, ref: string) => call<{ ok: boolean }>('agenda_deposit_report', { p_token: token, p_ref: ref || null });
export const agendaInfo = (slug: string) => call<AgendaInfo | null>('agenda_info', { p_slug: slug });
export const agendaDays = (slug: string, service: string, staff: string | null) =>
  call<string[]>('agenda_days', { p_slug: slug, p_service: service, p_staff: staff });
export const agendaSlots = (slug: string, service: string, staff: string | null, day: string) =>
  call<string[]>('agenda_slots', { p_slug: slug, p_service: service, p_staff: staff, p_day: day });
export const agendaBook = (slug: string, b: { client_id: string; service_id: string; staff_id: string | null; starts_at: string; name: string; phone: string; note?: string; lang?: string }) =>
  call<AgendaBooked>('agenda_book', { p_slug: slug, p_booking: b });
export const agendaStatus = (token: string) => call<AgendaStatus | null>('agenda_status', { p_token: token });
export const agendaCancel = (token: string) => call<{ ok: boolean }>('agenda_cancel', { p_token: token });
export const agendaConfirm = (token: string) => call<{ ok: boolean }>('agenda_confirm', { p_token: token });

// ---- la Nouba: the live queue of a salon (?nouba, ?nouba=ici at the door, ?nouba=<token> the client's place)
export interface NoubaInfo {
  enabled: boolean; open?: boolean; working?: number; waiting?: number; wait_min?: number | null; remote?: boolean; booking: boolean;
  name: string; timezone: string; languages: string[]; branding: Record<string, unknown> | null; phone: string | null; address: string | null; city: string | null;
  services?: { id: string; name: LText; duration_min: number; price_cents: number; price_from: boolean }[];
  staff?: AgendaStaff[];
}
export interface NoubaStatus {
  status: 'waiting' | 'serving' | 'done' | 'left' | 'no_show'; name: string; remote: boolean; coming: boolean; created_at: string;
  ahead: number | null; wait_min: number | null; soon: boolean; service: LText | null; staff: string | null;
  salon: { name: string; slug: string; phone: string | null; address: string | null; city: string | null; timezone: string; languages: string[]; branding: Record<string, unknown> | null; handle?: string | null };
}
export const noubaInfo = (slug: string) => call<NoubaInfo | null>('nouba_info', { p_slug: slug });
export const noubaEstimate = (slug: string, service: string | null, staff: string | null) =>
  call<{ open: boolean; wait_min: number | null }>('nouba_estimate', { p_slug: slug, p_service: service, p_staff: staff });
export const noubaJoin = (slug: string, e: { client_id: string; name: string; phone: string; service_id?: string | null; staff_id?: string | null; here?: boolean; lang?: string }) =>
  call<{ token: string; duplicate: boolean }>('nouba_join', { p_slug: slug, p_entry: e });
export const noubaStatus = (token: string) => call<NoubaStatus | null>('nouba_status', { p_token: token });
export const noubaAnswer = (token: string, answer: 'coming' | 'leave') => call<{ ok: boolean }>('nouba_answer', { p_token: token, p_answer: answer });

// ---- the salon's clients on Instagram: the mirror frame of a paid ticket (?miroir=<token>) and its code
export interface SalonAction { id: string; on: boolean; name: string; when: 'table' | 'next'; type: 'gift' | 'percent' | 'amount'; value?: number; min?: number; valid_days?: number }
export interface MirrorVoucher { code: string; name: string; kind: 'percent' | 'amount' | 'gift'; value: number; min_cents: number; starts_on: string; ends_on: string; days: number[]; used: boolean }
export interface SalonMirror {
  salon: { name: string; slug: string; languages: string[]; timezone: string; currency: string; branding: Record<string, unknown> | null; handle: string | null };
  share: boolean; actions: SalonAction[]; at: string; number: number; services: string[]; staff: string[]; voucher: MirrorVoucher | null;
}
export interface SalonFeedbackInfo {
  salon: { name: string; slug: string; languages: string[]; branding: Record<string, unknown> | null; handle?: string | null };
  review_url: string | null; at: string; name: string | null; services: string[]; staff: string[]; done: { rating: number; comment: string | null } | null;
}
export const salonFeedbackInfo = (token: string) => call<SalonFeedbackInfo | null>('salon_feedback_info', { p_token: token });
export const salonFeedback = (token: string, rating: number, comment: string) => call<{ ok: boolean; review_url: string | null }>('salon_feedback', { p_token: token, p_rating: rating, p_comment: comment || null });
export const salonFeedbackGoogle = (token: string) => call<{ ok: boolean }>('salon_feedback_google', { p_token: token });
export const salonMirror = (token: string) => call<SalonMirror | null>('salon_mirror', { p_token: token });
export const salonVoucher = (token: string, action: string) => call<{ status: 'ok' | 'none' | 'full'; code?: string }>('salon_voucher', { p_token: token, p_action_id: action });

