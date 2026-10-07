import type { I18n } from '@resto/shared';
export type { I18n };
export interface Restaurant {
  id: string; slug: string; name: string; status: 'trial' | 'active' | 'paused' | 'cancelled'; trial_ends_at: string | null; is_demo: boolean;
  timezone: string; currency: string; languages: string[]; day_cutoff_hour: number;
  branding: { primary_color?: string; theme?: 'dark' | 'light'; logo_url?: string; cover_url?: string; tagline?: I18n; font_display?: string; review_url?: string; review_on_receipt?: boolean };
  opening_hours: Record<string, [string, string][]>;
  booking?: { enabled?: boolean; waitlist?: boolean; auto_confirm?: boolean; capacity?: number; duration_min?: number; slot_minutes?: number; lead_minutes?: number; days_ahead?: number; max_party?: number; note?: string | null };
  online?: { prep_minutes?: number; delivery_fee_cents?: number; delivery_min_cents?: number; delivery_free_from_cents?: number | null; delivery_area?: string; schedule?: boolean; paused_until?: string | null };
  accept_dine_in: boolean; accept_takeaway: boolean; accept_delivery: boolean;
  legal_name: string | null; ice: string | null; tax_id: string | null; rc: string | null; address: string | null; city: string | null; phone: string | null;
  default_vat_bp: number;
  products?: ('pos' | 'profit')[];
  pos_plan?: 'essentiel' | 'restaurant';
  profit_settings?: { target_food_cost_bp?: number; days_open_per_month?: number; order_days?: number; auto_sold_out?: boolean };
  loyalty?: { customers?: boolean; enabled?: boolean; per_dh?: number; reward_points?: number; reward_cents?: number; credit?: boolean };
  pos_settings: { printers?: { receipt?: string; stations?: Record<string, string> }; idle_lock_minutes?: number; receipt_footer?: string };
}
export interface Category { id: string; restaurant_id: string; name: I18n; icon: string | null; station: string; sort_order: number; active: boolean }
export interface Variant { id?: string; menu_item_id?: string; name: I18n; price_cents: number; sort_order: number; active: boolean }
export interface Item {
  id: string; restaurant_id: string; category_id: string; name: I18n; description: I18n; price_cents: number;
  image_url: string | null; vat_bp: number | null; station: string | null; tags: string[]; active: boolean; available: boolean; sort_order: number;
  item_variants: Variant[];
}
export interface Staff { id: string; name: string; role: 'staff' | 'manager'; active: boolean }
export interface Table { id: string; label: string; zone: string | null; qr_token: string; sort_order: number; active: boolean }

export type BaseUnit = 'g' | 'ml' | 'pc';
export interface Ingredient {
  id: string; restaurant_id: string; name: string; name_ar: string | null; category: string;
  base_unit: BaseUnit; purchase_unit: string; purchase_qty: number; purchase_price_cents: number | null;
  waste_bp: number; price_estimated: boolean; supplier: string | null; active: boolean; updated_at: string;
  stock_qty?: number | null; stock_min?: number | null; stock_since?: string | null; supplier_id?: string | null;
}
export interface RecipeLine { id: string; menu_item_id: string; variant_id: string | null; ingredient_id: string; qty: number; sort_order: number }
export interface ProfitDish {
  item_id: string; variant_id: string | null; name: I18n; variant_name: I18n | null; category: I18n; image_url: string | null;
  price_cents: number; vat_bp: number; price_ht_cents: number; lines: number; unpriced: number; estimated: number;
  cost_cents: number | null; food_cost_bp: number | null; margin_cents: number | null; suggested_price_cents: number | null;
  sold_qty: number; profit_cents: number | null;
}
export interface ProfitData { target_food_cost_bp: number; days: number; uses_pos: boolean; dishes: ProfitDish[] }
