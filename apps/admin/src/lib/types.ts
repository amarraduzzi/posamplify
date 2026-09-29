import type { I18n } from '@resto/shared';
export type { I18n };
export interface Restaurant {
  id: string; slug: string; name: string; status: 'trial' | 'active' | 'paused' | 'cancelled'; trial_ends_at: string | null; is_demo: boolean;
  timezone: string; currency: string; languages: string[]; day_cutoff_hour: number;
  branding: { primary_color?: string; theme?: 'dark' | 'light'; logo_url?: string; cover_url?: string; tagline?: I18n; font_display?: string };
  opening_hours: Record<string, unknown>;
  accept_dine_in: boolean; accept_takeaway: boolean; accept_delivery: boolean;
  legal_name: string | null; ice: string | null; tax_id: string | null; rc: string | null; address: string | null; city: string | null; phone: string | null;
  default_vat_bp: number;
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
