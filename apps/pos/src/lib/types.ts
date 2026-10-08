import type { I18n } from '@resto/shared';

export type Role = 'device' | 'manager' | 'owner';
export type OrderStatus = 'new' | 'preparing' | 'ready' | 'served' | 'cancelled';
export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type Source = 'qr' | 'pos' | 'phone' | 'glovo';
export type Method = 'cash' | 'card' | 'transfer' | 'other';

export interface PosSettings {
  printers?: { receipt?: string; stations?: Record<string, string> };
  /** kitchen stations beyond Cuisine and Bar (grill, pizza, dessert...) */
  stations?: { key: string; name: string }[];
  idle_lock_minutes?: number;
  receipt_footer?: string;
}

export interface Restaurant {
  id: string; slug: string; name: string; status: string; timezone: string; currency: string;
  languages: string[]; branding: { primary_color?: string; logo_url?: string; review_url?: string; review_on_receipt?: boolean };
  legal_name: string | null; ice: string | null; tax_id: string | null; rc: string | null;
  address: string | null; city: string | null; phone: string | null;
  pos_settings: PosSettings; trial_ends_at: string | null; products?: string[];
  accept_takeaway?: boolean; accept_delivery?: boolean; pos_plan?: 'essentiel' | 'restaurant';
  booking?: { enabled?: boolean; waitlist?: boolean; duration_min?: number };
  /** customer file and loyalty points: off unless the owner switched them on */
  online?: { prep_minutes?: number; delivery_fee_cents?: number; delivery_min_cents?: number; delivery_free_from_cents?: number | null; delivery_area?: string; schedule?: boolean; paused_until?: string | null };
  loyalty?: { customers?: boolean; enabled?: boolean; per_dh?: number; reward_points?: number; reward_cents?: number; credit?: boolean };
  owner_whatsapp?: string | null;
}

export interface Staff { id: string; name: string; role: 'staff' | 'manager'; active: boolean }
export interface Table { id: string; label: string; zone: string | null; sort_order: number; active: boolean }
export interface Category { id: string; name: I18n; icon: string | null; station: string; sort_order: number; course?: number | null }
export interface Variant { id: string; menu_item_id: string; name: I18n; price_cents: number; sort_order: number }
export interface ModOption { id: string; group_id: string; name: I18n; price_cents: number; sort_order: number }
/** Extras / set-menu choices: pick between min_select and max_select options (null = no limit). */
export interface ModGroup { id: string; name: I18n; min_select: number; max_select: number | null; sort_order: number; options: ModOption[] }
export interface Item {
  id: string; category_id: string; name: I18n; price_cents: number; station: string | null;
  available: boolean; sort_order: number; variants: Variant[]; image_url?: string | null;
  groups?: ModGroup[];
}
export interface ChosenMod { id: string; name: string; price_cents: number }

export interface Line {
  id: string; order_id: string; menu_item_id: string | null; variant_id: string | null;
  name: string; unit_price_cents: number; quantity: number; line_total_cents: number;
  station: string; note: string | null; kitchen_sent_at: string | null; created_at: string;
  modifiers?: ChosenMod[];
  /** price before a happy hour (set by the database) */
  list_price_cents?: number | null; promo_id?: string | null;
  /** course (1 starter, 2 main, 3 dessert); a held line waits for "Envoyer la suite"; served_at: taken to the table */
  course?: number | null; held?: boolean; served_at?: string | null;
  /** the kitchen screen marked it ready */
  ready_at?: string | null;
  /** sent from a device without printer: a till with a printer prints the bon */
  print_requested_at?: string | null;
}

export interface Order {
  id: string; client_id: string; business_date: string; ticket_number: number; source: Source;
  order_type: OrderType; table_id: string | null; status: OrderStatus;
  customer_name: string | null; customer_phone: string | null; delivery_address: string | null;
  external_ref: string | null; note: string | null; staff_id: string | null;
  subtotal_cents: number; discount_cents: number; total_cents: number;
  closed_at: string | null; created_at: string; order_lines: Line[];
  customer_id?: string | null; discount_kind?: 'loyalty' | 'promo' | null; promo_id?: string | null;
  /** own online ordering: time asked for, ready time given by the till, guest's location */
  wanted_at?: string | null; eta_at?: string | null; delivery_location?: { lat: number; lng: number } | null;
  /** own delivery: courier, status, the guest's 4-digit code (proof of delivery) */
  courier_id?: string | null; delivery_status?: 'assigned' | 'picked_up' | 'delivered' | 'failed' | null; delivery_code?: string | null; delivery_note?: string | null; picked_up_at?: string | null; delivered_at?: string | null;
  /** Set on the till for orders taken offline, until the server gives a ticket number. */
  local_ref?: string;
}

export interface FiscalDoc {
  id: string; doc_type: 'ticket' | 'invoice' | 'credit_note'; doc_number: string; order_id: string | null;
  original_document_id: string | null; issued_at: string; business_date: string; currency: string;
  seller: { name?: string; legal_name?: string; ice?: string; if?: string; rc?: string; address?: string; city?: string };
  buyer: { name?: string; ice?: string } | null;
  lines: { name: string; qty: number; unit_ttc: number; total_ttc: number; vat_bp: number; discount: number; net_ttc: number; ht: number; vat: number }[];
  vat_breakdown: { vat_bp: number; ht: number; vat: number; ttc: number }[];
  payments: { method: Method; amount: number; tip: number; staff_id?: string }[];
  discount_cents: number; total_ht_cents: number; total_vat_cents: number; total_ttc_cents: number;
  reason: string | null; staff_id: string | null; hash: string;
}

export interface DayReport {
  business_date: string; tickets: number; credit_notes: number; credit_notes_cents: number;
  revenue_ttc_cents: number; revenue_ht_cents: number; vat_cents: number; discounts_cents: number;
  vat_breakdown: { vat_bp: number; ht: number; vat: number; ttc: number }[];
  payments: Record<string, number>; tips_cents: number;
  cash_float_cents: number; cash_payouts_cents: number; cash_deposits_cents: number; expected_cash_cents: number;
  open_orders: number; cancelled_orders: number;
  by_staff: { staff_id: string | null; name: string | null; revenue_ttc_cents: number }[];
  closed?: boolean; counted_cash_cents?: number | null; cash_diff_cents?: number | null;
  account_sales_cents?: number; account_received_cents?: number; account_received?: Record<string, number>;
}

export interface CashMovement { id: string; kind: 'float' | 'payout' | 'deposit'; amount_cents: number; reason: string; staff_id: string | null; created_at: string }

/** A line typed at the till but not yet sent. */
export interface DraftLine {
  key: string; item_id: string | null; variant_id: string | null; name: string;
  unit_price_cents: number; quantity: number; note: string; station: string;
  modifiers?: ChosenMod[];
  course?: number | null;
}
