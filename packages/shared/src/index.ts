// Shared between the customer menu, the till and the back office.

// ---------------------------------------------------------------------------
// Types returned by the public database functions
// ---------------------------------------------------------------------------
export type Lang = string; // 'fr' | 'en' | 'ar' | ...
export type I18n = Record<Lang, string>;

export interface Branding {
  primary_color?: string;
  theme?: 'dark' | 'light';
  logo_url?: string;
  cover_url?: string;
  tagline?: I18n;
  font_display?: string;
  /** Google 'ask for reviews' link: QR on the receipt and a button on the guest menu */
  review_url?: string;
  review_on_receipt?: boolean;
}

export interface PublicRestaurant {
  id: string;
  slug: string;
  name: string;
  languages: Lang[];
  currency: string;
  branding: Branding;
  opening_hours: Record<string, [string, string][]>;
  timezone: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  accept_dine_in: boolean;
  accept_takeaway: boolean;
  accept_delivery: boolean;
}

export interface PublicCategory { id: string; name: I18n; icon: string | null }
export interface PublicVariant { id: string; name: I18n; price_cents: number }
export interface PublicModOption { id: string; name: I18n; price_cents: number }
/** Extras / set-menu choices of a dish: pick between min and max options (max null = no limit). */
export interface PublicModGroup { id: string; name: I18n; min: number; max: number | null; options: PublicModOption[] }
export interface PublicItem {
  id: string;
  category_id: string;
  name: I18n;
  description: I18n;
  price_cents: number;
  image_url: string | null;
  tags: string[];
  available: boolean;
  variants: PublicVariant[];
  modifier_groups?: PublicModGroup[];
}

export interface PublicMenu {
  restaurant: PublicRestaurant;
  ordering_enabled: boolean;
  table: { label: string; token: string } | null;
  categories: PublicCategory[];
  items: PublicItem[];
}

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type OrderStatus = 'new' | 'preparing' | 'ready' | 'served' | 'cancelled';

export interface PlaceOrderInput {
  client_id: string;
  order_type: OrderType;
  table_token?: string | null;
  customer?: { name?: string; phone?: string; address?: string };
  note?: string;
  items: { item_id: string; variant_id?: string | null; modifiers?: string[]; quantity: number; note?: string }[];
}

export interface PlaceOrderResult {
  order_id: string;
  ticket_number: number;
  total_cents: number;
  status: OrderStatus;
  duplicate: boolean;
}

export interface OrderStatusResult {
  status: OrderStatus;
  ticket_number: number;
  total_cents: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Picks a translation: requested language, then the restaurant's languages, then anything. */
export function tr(v: I18n | null | undefined, lang: Lang, fallbacks: Lang[] = []): string {
  if (!v) return '';
  for (const l of [lang, ...fallbacks]) {
    const s = v[l];
    if (s && s.trim()) return s;
  }
  return Object.values(v).find(s => s && s.trim()) ?? '';
}

/** 8500 -> "85 MAD", 8550 -> "85,50 MAD"; Arabic uses درهم. */
export function formatMoney(cents: number, currency = 'MAD', lang: Lang = 'fr'): string {
  const n = Number(cents) / 100;
  const whole = Number.isInteger(n);
  const num = n.toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const unit = currency === 'MAD' ? (lang === 'ar' ? 'درهم' : 'MAD') : currency;
  return `${num} ${unit}`;
}

export const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);
export const isRtl = (lang: Lang) => RTL_LANGS.has(lang);

/** Machine error codes raised by the database functions (see migrations). */
export const ERROR_CODES = [
  'restaurant_not_found', 'ordering_unavailable', 'order_type_unavailable', 'invalid_table',
  'customer_required', 'item_unavailable', 'item_sold_out', 'variant_required', 'rate_limited',
  'invalid_request', 'network',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Extracts our error code from a Supabase/PostgREST error. */
export function errorCode(err: unknown): ErrorCode {
  const msg = (err as { message?: string })?.message ?? String(err ?? '');
  const hit = ERROR_CODES.find(c => msg === c || msg.startsWith(c));
  if (hit) return hit;
  if (/fetch|network|Failed to fetch|timeout/i.test(msg)) return 'network';
  return 'invalid_request';
}

/** RFC 4122 v4, works on older browsers without crypto.randomUUID. */
export function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Readable text color (#000/#fff) for a background color. */
export function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // pick whichever gives the higher WCAG contrast ratio
  const onDark = 1.05 / (L + 0.05);
  const onLight = (L + 0.05) / (0.0056 + 0.05); // #141414
  return onLight >= onDark ? '#141414' : '#ffffff';
}
export * from './brand';
