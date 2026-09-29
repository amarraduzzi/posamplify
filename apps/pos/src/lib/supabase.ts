import { createClient } from '@supabase/supabase-js';

// The till logs in once with its own account (role "device") and stays
// logged in; staff then identify themselves with their PIN on top of that.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pos-auth' } },
);
