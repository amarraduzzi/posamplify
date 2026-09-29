import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'admin-auth' } },
);
export const MENU_URL = ((import.meta.env.VITE_MENU_URL as string) || 'https://posamplify.pages.dev').replace(/\/$/, '');
export const POS_URL = ((import.meta.env.VITE_POS_URL as string) || 'https://amplify-kassa.pages.dev').replace(/\/$/, '');
