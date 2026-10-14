// Supabase Edge Function (platform): creates a login (e-mail + password) for a new customer of Amplify,
// so the restaurant owner never has to sign up herself. Platform admins only.
// The account is confirmed straight away; with "must_change_password" the back office asks the owner
// to choose her own password at her first login.
// If the e-mail already has an account, nothing is changed and the existing account is reused.
//
// Security: the caller's own login is checked against platform_admins (with her token, under RLS).
// The service key is the one Supabase gives every Edge Function (SUPABASE_SERVICE_ROLE_KEY): it never
// leaves the server and nobody has to copy it anywhere.
// Deploy: Edge Functions > Deploy a new function > Via Editor, name "admin-account", paste this file,
// turn "Verify JWT" off (checked here).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  if (!/^Bearer /.test(auth)) return json({ error: 'not_allowed' }, 401);

  let body: { email?: string; password?: string; must_change?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: 'invalid_email' }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: 'weak_password' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  // 1. the caller must be a platform admin (checked with her own token)
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await caller.auth.getUser();
  if (!who?.user) return json({ error: 'not_allowed' }, 401);
  const { data: adm, error: admErr } = await caller.from('platform_admins').select('user_id').eq('user_id', who.user.id);
  if (admErr || !adm?.length) return json({ error: 'not_allowed' }, 403);

  // 2. create the account, confirmed, with the password chosen by the admin
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { must_change_password: body.must_change !== false },
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) return json({ ok: true, existed: true });
    return json({ error: 'create_failed', message: error.message }, 400);
  }
  return json({ ok: true, existed: false, user_id: data.user?.id });
});
