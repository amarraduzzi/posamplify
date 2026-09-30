import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { check, errorMessage } from './lib/api';
import { applyLang, getLang, saveLang, type Lang } from './lib/i18n';
import type { Restaurant } from './lib/types';

export interface Toast { id: number; text: string; tone: 'ok' | 'error' }
export type Role = 'owner' | 'manager' | 'device' | 'admin';

function useAdmin() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // opened from the "mot de passe oublié" email: ask for a new password first
  const [recovery, setRecovery] = useState(() => new URLSearchParams(location.search).has('reset'));
  const endRecovery = useCallback(() => {
    setRecovery(false);
    history.replaceState(null, '', location.pathname);
  }, []);
  const [isAdmin, setIsAdmin] = useState(false);
  const [list, setList] = useState<{ r: Restaurant; role: Role }[] | null>(null);
  const [current, setCurrent] = useState<Restaurant | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // language: applied before the first render (main.tsx); state here re-renders the app on change
  const [lang, setLangState] = useState<Lang>(getLang);
  const setLang = useCallback((l: Lang) => { applyLang(l); saveLang(l); setLangState(l); }, []);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 7000 : 3000);
  }, []);
  const fail = useCallback((e: unknown) => toast(errorMessage(e), 'error'), [toast]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    if (!session) { setList(null); return; }
    try {
      const uid = session.user.id;
      const admin = check(await supabase.from('platform_admins').select('user_id').eq('user_id', uid)).length > 0;
      setIsAdmin(admin);
      const ms = check(await supabase.from('memberships').select('restaurant_id, role').eq('user_id', uid)) as { restaurant_id: string; role: Role }[];
      const rs = check(await supabase.from('restaurants').select('*').order('name')) as Restaurant[];
      const out = rs.map(r => ({ r, role: (ms.find(m => m.restaurant_id === r.id)?.role ?? 'admin') as Role }))
        .filter(x => admin || x.role === 'owner' || x.role === 'manager');
      setList(out);
      setCurrent(c => {
        const keep = c && out.find(x => x.r.id === c.id)?.r;
        const saved = localStorage.getItem('admin-restaurant');
        return keep ?? out.find(x => x.r.id === saved)?.r ?? out[0]?.r ?? null;
      });
    } catch (e) { fail(e); setList([]); }
  }, [session, fail]);
  useEffect(() => { reload(); }, [reload]);

  const choose = (r: Restaurant) => { localStorage.setItem('admin-restaurant', r.id); setCurrent(r); };
  const role: Role | null = current ? (list?.find(x => x.r.id === current.id)?.role ?? null) : null;
  // platform admins can edit everything; owners the profile; managers menu, staff and tables
  const canEditProfile = isAdmin || role === 'owner';
  return { lang, setLang, session, recovery, endRecovery, isAdmin, list, current, choose, role, canEditProfile, reload, toasts, toast, fail };
}

export type Admin = ReturnType<typeof useAdmin>;
const Ctx = createContext<Admin | null>(null);
export function AdminProvider({ children }: { children: ReactNode }) { const v = useAdmin(); return <Ctx.Provider value={v}>{children}</Ctx.Provider>; }
export const useAdminCtx = () => useContext(Ctx)!;
