import { PostgrestClient } from '@supabase/postgrest-js';
import type { OrderStatusResult, PlaceOrderInput, PlaceOrderResult, PublicMenu } from '@resto/shared';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Guests never log in: the anon key only allows the three public functions.
// Only the small PostgREST client is used (not the full supabase-js with auth,
// realtime and storage), which keeps the guest page light on slow 4G.
const db = new PostgrestClient(`${url}/rest/v1`, {
  headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
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
