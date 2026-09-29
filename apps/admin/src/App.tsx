import { useEffect, useState } from 'react';
import { UtensilsCrossed, Users, QrCode, Settings, BarChart3, Shield, LogOut, ExternalLink, Menu as MenuIcon } from 'lucide-react';
import { inkFor } from '@resto/shared';
import { useAdminCtx } from './store';
import { supabase, MENU_URL } from './lib/supabase';
import { errorMessage } from './lib/api';
import { Btn, Field, inputCls } from './components/ui';
import { MenuPage } from './pages/MenuPage';
import { StaffPage } from './pages/StaffPage';
import { TablesPage } from './pages/TablesPage';
import { SettingsPage } from './pages/SettingsPage';
import { ReportsPage } from './pages/ReportsPage';
import { PlatformPage } from './pages/PlatformPage';

type Page = 'menu' | 'staff' | 'tables' | 'settings' | 'reports' | 'platform';
const STATUS: Record<string, string> = { trial: 'Essai', active: 'Actif', paused: 'Suspendu', cancelled: 'Résilié' };

export default function App() {
  const a = useAdminCtx();
  const [page, setPage] = useState<Page>('menu');
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const c = a.current?.branding?.primary_color;
    const m = c && /^#?([0-9a-f]{6})$/i.exec(c);
    if (m) {
      const n = parseInt(m[1], 16);
      document.documentElement.style.setProperty('--brand', `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`);
      document.documentElement.style.setProperty('--brand-ink', inkFor(c!) === '#ffffff' ? '255 255 255' : '20 20 20');
    }
  }, [a.current]);

  if (a.session === undefined) return null;
  if (!a.session) return <Login />;
  if (a.list === null) return <p className="p-8 text-muted">Chargement…</p>;

  const r = a.current;
  const nav: { id: Page; label: string; Icon: typeof UtensilsCrossed; show: boolean }[] = [
    { id: 'menu', label: 'Menu', Icon: UtensilsCrossed, show: !!r },
    { id: 'tables', label: 'Tables & QR codes', Icon: QrCode, show: !!r },
    { id: 'staff', label: 'Personnel', Icon: Users, show: !!r },
    { id: 'reports', label: 'Ventes', Icon: BarChart3, show: !!r },
    { id: 'settings', label: 'Restaurant', Icon: Settings, show: !!r },
    { id: 'platform', label: 'Plateforme', Icon: Shield, show: a.isAdmin },
  ];
  const current = !r && a.isAdmin ? 'platform' : page;

  return (
    <div className="flex h-full">
      <aside className={`no-print fixed inset-y-0 left-0 z-40 w-64 shrink-0 flex-col border-r border-line/10 bg-surface p-4 md:static md:flex ${navOpen ? 'flex' : 'hidden'}`}>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Restaurant</p>
        {a.list.length > 1 ? (
          <select className={`${inputCls} mb-2`} value={r?.id ?? ''} onChange={e => { const x = a.list!.find(l => l.r.id === e.target.value); if (x) a.choose(x.r); }}>
            {a.list.map(x => <option key={x.r.id} value={x.r.id}>{x.r.name}</option>)}
          </select>
        ) : <p className="mb-2 text-lg font-bold">{r?.name ?? '—'}</p>}
        {r && <p className="mb-4 text-xs text-muted">{STATUS[r.status]}{r.status === 'trial' && r.trial_ends_at ? ` jusqu'au ${new Date(r.trial_ends_at).toLocaleDateString('fr-FR')}` : ''} · {a.role === 'admin' ? 'administrateur' : a.role === 'owner' ? 'propriétaire' : 'manager'}</p>}
        <nav className="space-y-1">
          {nav.filter(n => n.show).map(n => (
            <button key={n.id} onClick={() => { setPage(n.id); setNavOpen(false); }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-semibold ${current === n.id ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
              <n.Icon className="h-5 w-5" />{n.label}
            </button>
          ))}
        </nav>
        {r && <a href={`${MENU_URL}/${r.slug}`} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2"><ExternalLink className="h-4 w-4" /> Voir le menu client</a>}
        <div className="mt-auto pt-4">
          <p className="mb-2 truncate text-xs text-muted">{a.session.user.email}</p>
          <Btn className="w-full" onClick={() => supabase.auth.signOut()}><LogOut className="h-4 w-4" /> Déconnexion</Btn>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setNavOpen(false)} />}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="no-print sticky top-0 z-20 flex items-center gap-2 border-b border-line/10 bg-surface px-4 py-2 md:hidden">
          <button onClick={() => setNavOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2"><MenuIcon className="h-5 w-5" /></button>
          <span className="font-bold">{r?.name}</span>
        </div>
        <div className="mx-auto max-w-6xl p-4 md:p-8">
          {!r && !a.isAdmin && <p className="text-muted">Ce compte ne gère aucun restaurant.</p>}
          {r && r.status === 'paused' && <p className="mb-4 rounded-xl bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">Abonnement suspendu : consultation seulement.</p>}
          {r && current === 'menu' && <MenuPage key={r.id} r={r} />}
          {r && current === 'staff' && <StaffPage key={r.id} r={r} />}
          {r && current === 'tables' && <TablesPage key={r.id} r={r} />}
          {r && current === 'settings' && <SettingsPage key={r.id} r={r} />}
          {r && current === 'reports' && <ReportsPage key={r.id} r={r} />}
          {current === 'platform' && a.isAdmin && <PlatformPage />}
        </div>
      </main>
      <div className="no-print pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {a.toasts.map(t => <div key={t.id} className={`pop rounded-xl px-4 py-2.5 font-semibold text-white shadow-xl ${t.tone === 'error' ? 'bg-danger' : 'bg-ok'}`}>{t.text}</div>)}
      </div>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(errorMessage(error));
    setBusy(false);
  };
  return (
    <div className="grid h-full place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-surface p-6 shadow-sm">
        <div><h1 className="text-2xl font-bold">Espace gérant</h1><p className="text-sm text-muted">Menu, personnel, tables et ventes.</p></div>
        <Field label="E-mail"><input className={inputCls} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
        <Field label="Mot de passe"><input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
        <Btn tone="brand" className="w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</Btn>
      </form>
    </div>
  );
}
