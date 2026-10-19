import type { I18n } from '@resto/shared';
export type { I18n };
export type PayMethod = 'cash' | 'transfer' | 'cashplus' | 'card' | 'other';
export interface Restaurant {
  id: string; slug: string; name: string; status: 'trial' | 'active' | 'paused' | 'cancelled'; trial_ends_at: string | null; is_demo: boolean;
  timezone: string; currency: string; languages: string[]; day_cutoff_hour: number; glovo_markup_bp?: number;
  branding: { primary_color?: string; theme?: 'dark' | 'light'; logo_url?: string; cover_url?: string; tagline?: I18n; font_display?: string; review_url?: string; review_on_receipt?: boolean; guest_share?: boolean; instagram?: string; guest_reward_on?: boolean; guest_reward?: string; guest_actions?: import('@resto/shared').GuestAction[] };
  opening_hours: Record<string, [string, string][]>;
  booking?: { enabled?: boolean; waitlist?: boolean; auto_confirm?: boolean; capacity?: number; duration_min?: number; slot_minutes?: number; lead_minutes?: number; days_ahead?: number; max_party?: number; note?: string | null };
  online?: { prep_minutes?: number; delivery_fee_cents?: number; delivery_min_cents?: number; delivery_free_from_cents?: number | null; delivery_area?: string; schedule?: boolean; paused_until?: string | null };
  accept_dine_in: boolean; accept_takeaway: boolean; accept_delivery: boolean;
  /** one shared QR for the whole restaurant: the guest types the table number */
  qr_shared?: boolean;
  legal_name: string | null; ice: string | null; tax_id: string | null; rc: string | null; address: string | null; city: string | null; phone: string | null;
  default_vat_bp: number;
  products?: ('pos' | 'profit' | 'site' | 'orders')[];
  pos_plan?: 'essentiel' | 'restaurant';
  kiosk_token?: string | null;
  owner_whatsapp?: string | null;
  /** Amplify's billing of this customer (set by Amplify only). No billing_start: not started yet. */
  /** accountant's private link key, and own account numbers */
  accounting_token?: string | null; accounting?: Record<string, string>;
  billing_start?: string | null; billing_amount_cents?: number | null; billing_period?: 'month' | 'year'; billing_method?: PayMethod | null; paid_until?: string | null;
  /** 'premium' unlocks the premium website styles; set by Amplify only */
  site_plan?: 'basic' | 'premium';
  site?: { enabled?: boolean; theme?: 'nuit' | 'riad' | 'moderne' | 'atelier' | 'maison' | 'signature'; catering?: boolean; request?: boolean;
    story?: { title?: I18n; text?: I18n; image?: string }[]; chef?: { name?: string; role?: I18n; text?: I18n; photo?: string }; signatures?: { item_id: string; text?: I18n }[]; about?: I18n; gallery?: string[]; cuisine?: string; price_range?: string; instagram?: string; facebook?: string; tiktok?: string; maps_url?: string; domain?: string; video_url?: string; whatsapp?: string; wa_order?: boolean; wa_delivery?: boolean };
  profit_settings?: { target_food_cost_bp?: number; days_open_per_month?: number; order_days?: number; auto_sold_out?: boolean };
  loyalty?: { customers?: boolean; enabled?: boolean; per_dh?: number; reward_points?: number; reward_cents?: number; credit?: boolean };
  pos_settings: { printers?: { receipt?: string; stations?: Record<string, string> }; stations?: { key: string; name: string }[]; idle_lock_minutes?: number; receipt_footer?: string };
}
export interface Category { id: string; restaurant_id: string; name: I18n; icon: string | null; station: string; sort_order: number; active: boolean; course?: number | null; takeaway_discount_cents?: number }
export interface Variant { id?: string; menu_item_id?: string; name: I18n; price_cents: number; sort_order: number; active: boolean; glovo_price_cents?: number | null }
export interface Item {
  id: string; restaurant_id: string; category_id: string; name: I18n; description: I18n; price_cents: number;
  image_url: string | null; vat_bp: number | null; station: string | null; tags: string[]; active: boolean; available: boolean; sort_order: number;
  item_variants: Variant[]; takeaway_discount_cents?: number | null; glovo_price_cents?: number | null;
  /** price_cents is the price of 1 kg; the till asks the weight */
  sold_by_weight?: boolean;
}
export interface Staff { id: string; name: string; role: 'staff' | 'manager'; active: boolean }
export interface Table { id: string; label: string; zone: string | null; qr_token: string; sort_order: number; active: boolean }

export type BaseUnit = 'g' | 'ml' | 'pc';
export interface Ingredient {
  id: string; restaurant_id: string; name: string; name_ar: string | null; category: string;
  base_unit: BaseUnit; purchase_unit: string; purchase_qty: number; purchase_price_cents: number | null;
  waste_bp: number; price_estimated: boolean; supplier: string | null; active: boolean; updated_at: string;
  stock_qty?: number | null; stock_min?: number | null; stock_since?: string | null; supplier_id?: string | null;
  is_preparation?: boolean; made_ahead?: boolean;
}
export interface RecipeLine { id: string; menu_item_id: string; variant_id: string | null; ingredient_id: string; qty: number; sort_order: number; dine_in_only?: boolean }
export interface ProfitDish {
  item_id: string; variant_id: string | null; name: I18n; variant_name: I18n | null; category: I18n; image_url: string | null;
  price_cents: number; vat_bp: number; price_ht_cents: number; lines: number; unpriced: number; estimated: number;
  cost_cents: number | null; food_cost_bp: number | null; margin_cents: number | null; suggested_price_cents: number | null;
  sold_qty: number; profit_cents: number | null;
  sold_by_weight?: boolean;
}
export interface ProfitData { target_food_cost_bp: number; days: number; uses_pos: boolean; dishes: ProfitDish[] }
/** Premium website styles: paid (site_plan premium), or free to try during the trial. */
export const premiumAccess = (r?: Pick<Restaurant, 'site_plan' | 'status' | 'trial_ends_at'> | null) =>
  !!r && (r.site_plan === 'premium' || (r.status === 'trial' && (!r.trial_ends_at || new Date(r.trial_ends_at).getTime() > Date.now())));
/** Using the premium styles for free, during the trial (not paid yet). */
export const premiumOnTrial = (r?: Pick<Restaurant, 'site_plan' | 'status' | 'trial_ends_at'> | null) => premiumAccess(r) && r!.site_plan !== 'premium';

/** The restaurant has only Amplify Site (website and menu, no till, no Profit). */
export const isSiteOnly = (r?: { products?: string[] } | null) => !!r && (r.products ?? []).length === 1 && r.products![0] === 'site';
