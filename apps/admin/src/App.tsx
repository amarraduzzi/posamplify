import { useState } from 'react';
import { UtensilsCrossed, Users, QrCode, Settings, BarChart3, Shield, LogOut, ExternalLink, Menu as MenuIcon, Monitor, Sparkles } from 'lucide-react';
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
import { Onboarding } from './pages/Onboarding';
import { DevicesPage } from './pages/DevicesPage';
import { BriefingPage } from './pages/BriefingPage';
import { AmplifyLogo, PatternBackdrop, Star8 } from './components/Brand';
import { LangSwitch } from './components/LangSwitch';
import { dateLocale, t } from './lib/i18n';

type Page = 'briefing' | 'menu' | 'staff' | 'tables' | 'devices' | 'settings' | 'reports' | 'platform';
// i18n:values
const STATUS: Record<string, string> = { trial: 'Essai', active: 'Actif', paused: 'Suspendu', cancelled: 'Résilié' };
// i18n:end

export default function App() {
  const a = useAdminCtx();
  const [page, setPage] = useState<Page>('briefing');
  const [navOpen, setNavOpen] = useState(false);
  // wizard progress lives in localStorage (survives a refresh); bump re-renders after it changes
  const [, bump] = useState(0);


  if (a.session === undefined) return null;
  if (!a.session) return <Login />;
  if (a.list === null) return <p className="p-8 text-muted">{t('Chargement…')}</p>;
  // the wizard stays until its last step, also after the restaurant exists
  const inWizard = localStorage.getItem('admin-wizard-step') !== null;
  if ((inWizard || !a.list.length) && !a.isAdmin) {
    return <Onboarding onDone={p => { if (p) setPage(p); bump(n => n + 1); }} />;
  }

  const r = a.current;
  const nav: { id: Page; label: string; Icon: typeof UtensilsCrossed; show: boolean }[] = [
    { id: 'briefing', label: t('Briefing'), Icon: Sparkles, show: !!r },
    { id: 'menu', label: t('Menu'), Icon: UtensilsCrossed, show: !!r },
    { id: 'tables', label: t('Tables & QR codes'), Icon: QrCode, show: !!r },
    { id: 'staff', label: t('Personnel'), Icon: Users, show: !!r },
    { id: 'devices', label: t('Caisses'), Icon: Monitor, show: !!r },
    { id: 'reports', label: t('Ventes'), Icon: BarChart3, show: !!r },
    { id: 'settings', label: t('Restaurant'), Icon: Settings, show: !!r },
    { id: 'platform', label: t('Plateforme'), Icon: Shield, show: a.isAdmin },
  ];
  const current = !r && a.isAdmin ? 'platform' : page;

  return (
    <div className="flex h-full">
      <aside className={`night no-print fixed inset-y-0 start-0 z-40 w-68 shrink-0 flex-col overflow-hidden p-4 md:static md:flex ${navOpen ? 'flex' : 'hidden'}`} style={{ width: 272 }}>
        <PatternBackdrop className="opacity-70" />
        <AmplifyLogo className="relative mb-7 mt-1 px-2" />
        <div className="relative mb-5 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">{t('Restaurant')}</p>
          {a.list.length > 1 ? (
            <select className="mb-1 w-full rounded-xl border border-white/10 bg-night-2 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-brand" value={r?.id ?? ''} onChange={e => { const x = a.list!.find(l => l.r.id === e.target.value); if (x) a.choose(x.r); }}>
              {a.list.map(x => <option key={x.r.id} value={x.r.id}>{x.r.name}</option>)}
            </select>
          ) : <p className="font-display text-xl font-semibold leading-tight">{r?.name ?? '—'}</p>}
          {r && <p className="mt-1 flex items-center gap-1.5 text-xs text-white/55">
            <span className={`h-1.5 w-1.5 rounded-full ${r.status === 'active' ? 'bg-ok' : r.status === 'trial' ? 'bg-brand' : 'bg-danger'}`} />
            {t(STATUS[r.status])}{r.status === 'trial' && r.trial_ends_at ? ` ${t("jusqu'au {d}", { d: new Date(r.trial_ends_at).toLocaleDateString(dateLocale()) })}` : ''} · {a.role === 'admin' ? t('administrateur') : a.role === 'owner' ? t('propriétaire') : t('manager')}</p>}
        </div>
        <nav className="relative space-y-1">
          {nav.filter(n => n.show).map(n => (
            <button key={n.id} onClick={() => { setPage(n.id); setNavOpen(false); }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-[15px] font-semibold transition ${current === n.id ? 'gold-fill text-brand-ink' : 'text-white/60 hover:bg-white/[0.06] hover:text-white'}`}>
              <n.Icon className="h-5 w-5" />{n.label}
            </button>
          ))}
        </nav>
        {r && <a href={`${MENU_URL}/${r.slug}`} target="_blank" rel="noreferrer" className="relative mt-4 flex items-center gap-2 rounded-xl border border-brand/30 px-3 py-2.5 text-sm font-semibold text-brand hover:bg-brand/10"><ExternalLink className="h-4 w-4" /> {t('Voir le menu client')}</a>}
        <div className="relative mt-auto pt-4">
          <LangSwitch dark className="mb-3 flex w-full" />
          <p className="mb-2 truncate px-1 text-xs text-white/40" dir="ltr">{a.session.user.email}</p>
          <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:bg-white/[0.06] hover:text-white" onClick={() => supabase.auth.signOut()}><LogOut className="h-4 w-4 rtl:-scale-x-100" /> {t('Déconnexion')}</button>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setNavOpen(false)} />}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="night no-print sticky top-0 z-20 flex items-center gap-3 px-4 py-2.5 md:hidden">
          <button onClick={() => setNavOpen(true)} aria-label={t('Menu')} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><MenuIcon className="h-5 w-5" /></button>
          <span className="me-auto font-display text-lg font-semibold">{r?.name}</span>
          <LangSwitch dark />
        </div>
        <div className="rise mx-auto max-w-6xl p-4 md:p-10" key={current}>
          {!r && !a.isAdmin && <p className="text-muted">{t('Ce compte ne gère aucun restaurant.')}</p>}
          {r && r.status === 'paused' && <p className="mb-4 rounded-xl bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">{t('Abonnement suspendu : consultation seulement.')}</p>}
          {r && current === 'briefing' && <BriefingPage key={r.id} r={r} />}
          {r && current === 'menu' && <MenuPage key={r.id} r={r} />}
          {r && current === 'staff' && <StaffPage key={r.id} r={r} />}
          {r && current === 'tables' && <TablesPage key={r.id} r={r} />}
          {r && current === 'devices' && <DevicesPage key={r.id} r={r} />}
          {r && current === 'settings' && <SettingsPage key={r.id} r={r} />}
          {r && current === 'reports' && <ReportsPage key={r.id} r={r} />}
          {current === 'platform' && a.isAdmin && <PlatformPage />}
        </div>
      </main>
      <div className="no-print pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {a.toasts.map(x => <div key={x.id} className={`pop rounded-2xl px-5 py-3 font-semibold text-white shadow-2xl ${x.tone === 'error' ? 'bg-danger' : 'bg-night'}`}>{x.tone !== 'error' && <span className="me-2 text-brand">✓</span>}{x.text}</div>)}
      </div>
    </div>
  );
}

function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>(() => (new URLSearchParams(location.search).has('inscription') ? 'signup' : 'login'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null); setInfo(null);
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setError(errorMessage(error));
    } else {
      localStorage.setItem('admin-wizard-step', '0');
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin } });
      if (error) { setError(errorMessage(error)); localStorage.removeItem('admin-wizard-step'); }
      else if (!data.session) setInfo(t('Compte créé. Ouvrez le lien reçu par e-mail pour le confirmer, puis connectez-vous.'));
    }
    setBusy(false);
  };
  return (
    <div className="flex h-full">
      <section className="night relative hidden flex-1 flex-col justify-between overflow-hidden p-12 lg:flex">
        <PatternBackdrop />
        <AmplifyLogo size="lg" className="relative" />
        <div className="relative max-w-lg">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-brand">{t('Fait pour le Maroc')}</p>
          <h2 className="mt-4 font-display text-5xl font-semibold leading-[1.08]">{t('Le plus beau menu QR et la caisse la plus simple de votre ville.')}</h2>
          <ul className="mt-8 space-y-3 text-white/75">
            {[t('Menu en français, arabe et anglais, avec photos'), t('Caisse, tickets cuisine et bar, rapports Z'), t('Fonctionne même sans internet')].map(x => (
              <li key={x} className="flex items-center gap-3"><Star8 className="h-4 w-4 shrink-0 text-brand" />{x}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/40">{t('30 jours gratuits · sans engagement')}</p>
      </section>
      <div className="grid flex-1 place-items-center p-6 lg:max-w-xl">
        <form onSubmit={submit} className="rise w-full max-w-sm space-y-5">
          <div className="mb-10 flex items-center justify-between gap-3 lg:mb-6 lg:justify-end">
            <AmplifyLogo tone="light" className="lg:hidden" />
            <LangSwitch />
          </div>
          <div>
            <h1 className="font-display text-4xl font-semibold">{mode === 'login' ? t('Espace gérant') : t('Créer mon compte')}</h1>
            <p className="mt-2 text-muted">{mode === 'login' ? t('Menu, personnel, tables et ventes.') : t('Menu QR, caisse et gestion. 30 jours gratuits, sans engagement.')}</p>
          </div>
          <Field label={t('E-mail')}><input className={inputCls} dir="ltr" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
          <Field label={t('Mot de passe')} hint={mode === 'signup' ? t('8 caractères minimum.') : undefined}>
            <input className={inputCls} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} required />
          </Field>
          {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">{error}</p>}
          {info && <p className="rounded-xl bg-ok/10 px-3 py-2 text-sm font-semibold text-ok">{info}</p>}
          <Btn tone="brand" className="h-12 w-full text-base" disabled={busy}>{busy ? '…' : mode === 'login' ? t('Se connecter') : t('Créer mon compte')}</Btn>
          <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); setInfo(null); }} className="w-full text-center text-sm font-semibold text-muted hover:text-ink">
            {mode === 'login' ? t('Nouveau restaurant ? Créer un compte') : t('Déjà un compte ? Se connecter')}
          </button>
        </form>
      </div>
    </div>
  );
}
