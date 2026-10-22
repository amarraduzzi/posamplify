import { useEffect, useState } from 'react';
import { BellRing, UtensilsCrossed, Users, QrCode, Settings, BarChart3, Shield, LogOut, ExternalLink, Menu as MenuIcon, Monitor, Sparkles, TrendingUp, Carrot, Wallet, ClipboardList, UserCheck, Heart, Globe, CalendarDays, BadgePercent, Building2, CalendarClock, Activity, LayoutTemplate, Rocket, CookingPot, ChefHat, Calculator, MonitorDown, Scissors, Clock4, CalendarCheck2, Footprints } from 'lucide-react';
import { useAdminCtx } from './store';
import { supabase, MENU_URL, SITE_URL } from './lib/supabase';
import { isSiteOnly } from './lib/types';
import { errorMessage } from './lib/api';
import { useInstall } from './lib/install';
import { Btn, Field, inputCls } from './components/ui';
import { MenuPage } from './pages/MenuPage';
import { StaffPage } from './pages/StaffPage';
import { AgendaServicesPage } from './pages/AgendaServicesPage';
import { AgendaTeamPage } from './pages/AgendaTeamPage';
import { AgendaBookingPage } from './pages/AgendaBookingPage';
import { NoubaPage } from './pages/NoubaPage';
import { AgendaDayPage } from './pages/AgendaDayPage';
import { AgendaClientsPage } from './pages/AgendaClientsPage';
import { SalonSitePage } from './pages/SalonSitePage';
import { TablesPage } from './pages/TablesPage';
import { SettingsPage } from './pages/SettingsPage';
import { ReportsPage } from './pages/ReportsPage';
import { PlatformPage } from './pages/PlatformPage';
import { Onboarding } from './pages/Onboarding';
import { DevicesPage } from './pages/DevicesPage';
import { BriefingPage } from './pages/BriefingPage';
import { LoginShowcase } from './components/LoginShowcase';
import { AmplifyLogo, AmplifyMark, PatternBackdrop } from './components/Brand';
import { LangSwitch } from './components/LangSwitch';
import { LangMenu } from './components/LangMenu';
import { dateLocale, t } from './lib/i18n';
import { useCaptcha } from './lib/captcha';
import { ProfitPage } from './pages/ProfitPage';
import { IngredientsPage } from './pages/IngredientsPage';
import { ProductionPage } from './pages/ProductionPage';
import { CateringPage } from './pages/CateringPage';
import { AccountingPage, AccountantPage } from './pages/AccountingPage';
import { SiteRequestBanner, useSiteRequests } from './components/SiteRequests';
import { BillingBanner } from './components/OwnerBilling';
import { unlockSound } from './lib/chime';
import { ChargesPage } from './pages/ChargesPage';
import { StockPage } from './pages/StockPage';
import { TeamPage } from './pages/TeamPage';
import { CustomersPage } from './pages/CustomersPage';
import { LoyaltyCounterPage } from './pages/LoyaltyCounterPage';
import { OnlinePage } from './pages/OnlinePage';
import { BookingPage } from './pages/BookingPage';
import { PromotionsPage } from './pages/PromotionsPage';
import { GroupPage } from './pages/GroupPage';
import { PlanningPage } from './pages/PlanningPage';
import { OrdersPage, screenAccent } from './pages/OrdersPage';
import { LivePage } from './pages/LivePage';
import { SitePage } from './pages/SitePage';
import { UpgradePage } from './pages/UpgradePage';

type Page = 'counter' | 'inbox' | 'upgrade' | 'site' | 'live' | 'planning' | 'group' | 'online' | 'booking' | 'promos' | 'briefing' | 'menu' | 'staff' | 'tables' | 'devices' | 'settings' | 'reports' | 'platform' | 'profit' | 'ingredients' | 'production' | 'catering' | 'stock' | 'team' | 'charges' | 'customers' | 'accounting' | 'agservices' | 'agteam' | 'agbooking' | 'nouba' | 'agday' | 'agclients' | 'agsite';
// i18n:values
const STATUS: Record<string, string> = { trial: 'Essai', active: 'Actif', paused: 'Suspendu', cancelled: 'Résilié' };
// i18n:end

/** Messages ("Enregistré", errors) on every screen: login, wizard and the back office. */
export default function App() {
  return <><Screens /><Toasts /></>;
}

function Toasts() {
  const a = useAdminCtx();
  return (
    <div className="no-print pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {a.toasts.map(x => <div key={x.id} className={`pop rounded-2xl px-5 py-3 font-semibold text-white shadow-2xl ${x.tone === 'error' ? 'bg-danger' : 'bg-night'}`}>{x.tone !== 'error' && <span className="me-2 text-[#05B962]">✓</span>}{x.text}</div>)}
    </div>
  );
}

function Screens() {
  const a = useAdminCtx();
  const inst = useInstall();
  const [page, setPage] = useState<Page>('briefing');
  const [navOpen, setNavOpen] = useState(false);
  // wizard progress lives in localStorage (survives a refresh); bump re-renders after it changes
  const [, bump] = useState(0);
  // requests from the premium website: badge, banner and chime on every page
  const siteReqs = useSiteRequests(a.current, !!a.session && !!a.current);
  const [catOpen, setCatOpen] = useState<string | null>(null);
  // browsers play a sound only after a tap: the first tap anywhere allows the chime
  useEffect(() => {
    const go = () => { unlockSound(); window.removeEventListener('pointerdown', go); };
    window.addEventListener('pointerdown', go);
    return () => window.removeEventListener('pointerdown', go);
  }, []);


  // the accountant's private link: no login
  const compta = location.pathname.match(/^\/compta\/([A-Za-z0-9]{24,})\/?$/);
  if (compta) return <AccountantPage keyParam={compta[1]} />;
  if (a.session === undefined) return null;
  if (!a.session) return <Login />;
  if (a.recovery) return <NewPassword />;
  // an account created by Amplify: the owner chooses her own password first
  if (a.session.user.user_metadata?.must_change_password) return <NewPassword first />;
  if (a.list === null) return <p className="p-8 text-muted">{t('Chargement…')}</p>;
  // the wizard stays until its last step, also after the restaurant exists
  const inWizard = localStorage.getItem('admin-wizard-step') !== null;
  if ((inWizard || !a.list.length) && !a.isAdmin) {
    return <Onboarding onDone={p => { if (p) setPage(p); bump(n => n + 1); }} />;
  }

  const r = a.current;
  // which products this restaurant has (Amplify POS, Amplify Profit, or both)
  const products = r?.products ?? ['pos', 'profit'];
  const hasPos = !!r && products.includes('pos');
  const hasProfit = !!r && products.includes('profit');
  // Amplify Commandes: guest orders on a web page, without the till (included with POS)
  const hasOrders = !!r && products.includes('orders') && !hasPos;
  // Amplify Fidélité: the loyalty counter without the till (the till has its own)
  const hasLoyalty = !!r && products.includes('loyalty');
  const siteOnly = isSiteOnly(r);
  // Amplify Agenda: salons (appointments per staff member); alone, the back office shows only what a salon uses
  const hasAgenda = !!r && products.includes('agenda');
  // a salon: Agenda without the till, margins or orders (it may add its website, the module "Site du salon")
  const agendaOnly = hasAgenda && !hasPos && !hasProfit && !hasOrders && !hasLoyalty;
  const nav: { id: Page; label: string; Icon: typeof UtensilsCrossed; show: boolean }[] = [
    { id: 'counter', label: t('Comptoir fidélité'), Icon: Heart, show: hasLoyalty && !hasPos },
    { id: 'inbox', label: t('Commandes'), Icon: BellRing, show: hasOrders },
    { id: 'live', label: t('En direct'), Icon: Activity, show: hasPos },
    { id: 'briefing', label: t('Briefing'), Icon: Sparkles, show: hasPos },
    { id: 'group', label: t('Groupe'), Icon: Building2, show: a.list.filter(x => x.role === 'owner').length >= 2 },
    { id: 'agday', label: t('Agenda'), Icon: CalendarDays, show: hasAgenda },
    { id: 'nouba', label: t('La Nouba'), Icon: Footprints, show: hasAgenda },
    { id: 'agclients', label: t('Clients'), Icon: Users, show: hasAgenda },
    { id: 'agbooking', label: t('Réservation en ligne'), Icon: CalendarCheck2, show: hasAgenda },
    { id: 'agservices', label: t('Prestations'), Icon: Scissors, show: hasAgenda },
    { id: 'agteam', label: t('Équipe et horaires'), Icon: Clock4, show: hasAgenda },
    { id: 'agsite', label: t('Site du salon'), Icon: LayoutTemplate, show: agendaOnly && products.includes('site') },
    { id: 'menu', label: t('Menu'), Icon: UtensilsCrossed, show: !!r && !agendaOnly },
    { id: 'profit', label: t('Marges'), Icon: TrendingUp, show: hasProfit },
    { id: 'ingredients', label: t('Ingrédients'), Icon: Carrot, show: hasProfit },
    { id: 'production', label: t('Production'), Icon: CookingPot, show: hasProfit },
    { id: 'catering', label: t('Traiteur'), Icon: ChefHat, show: hasPos || hasProfit || r?.site_plan === 'premium' || siteReqs.length > 0 },
    { id: 'stock', label: t('Inventaire'), Icon: ClipboardList, show: hasProfit },
    { id: 'team', label: t('Équipe'), Icon: UserCheck, show: hasProfit },
    { id: 'planning', label: t('Planning'), Icon: CalendarClock, show: hasPos || hasProfit },
    { id: 'charges', label: t('Charges'), Icon: Wallet, show: hasProfit },
    { id: 'accounting', label: t('Comptabilité'), Icon: Calculator, show: (hasPos || hasProfit) && a.role !== 'manager' },
    { id: 'site', label: t('Site web'), Icon: LayoutTemplate, show: !agendaOnly && (hasPos || siteOnly || (hasOrders && products.includes('site'))) },
    { id: 'online', label: t('Commande en ligne'), Icon: Globe, show: hasPos || hasOrders },
    { id: 'booking', label: t('Réservations'), Icon: CalendarDays, show: !agendaOnly && (hasPos || hasOrders || siteOnly || products.includes('site')) },
    { id: 'promos', label: t('Promotions'), Icon: BadgePercent, show: hasPos },
    { id: 'customers', label: t('Clients'), Icon: Heart, show: hasPos || hasLoyalty },
    { id: 'tables', label: t('Tables & QR codes'), Icon: QrCode, show: hasPos || hasOrders },
    { id: 'staff', label: t('Personnel'), Icon: Users, show: hasPos || hasLoyalty },
    { id: 'devices', label: t('Caisses'), Icon: Monitor, show: hasPos },
    { id: 'reports', label: t('Ventes'), Icon: BarChart3, show: hasPos },
    { id: 'settings', label: agendaOnly ? t('Salon') : t('Restaurant'), Icon: Settings, show: !!r },
    { id: 'upgrade', label: t('Abonnement'), Icon: Rocket, show: siteOnly && a.role !== 'manager' },
    { id: 'platform', label: t('Plateforme'), Icon: Shield, show: a.isAdmin },
  ];
  const visible = nav.filter(n => n.show).map(n => n.id);
  const current = !r && a.isAdmin ? 'platform' : visible.includes(page) ? page : (visible[0] ?? 'settings');

  // the separate full-screen window of Amplify Commandes (opened from the Commandes page): the orders and nothing else
  if (r && hasOrders && new URLSearchParams(location.search).get('scherm') === 'commandes') {
    const accent = screenAccent(r);
    return (
      <div className="relative flex min-h-full flex-col p-3 md:p-6" style={{ background: `linear-gradient(180deg, ${accent}26 0%, #f3f6fa 45%)` }}>
        <div className="absolute inset-x-0 top-0 h-1.5" style={{ background: accent }} aria-hidden />
        <div className="flex-1"><OrdersPage key={r.id} r={r} screen /></div>
        <footer className="mt-6 flex items-center justify-center gap-2 pb-1 text-xs font-semibold text-muted" dir="ltr">
          <span>Powered by</span>
          <AmplifyMark tone="light" className="h-4 w-[1.2rem]" />
          <span className="font-logo font-extrabold tracking-wide text-[#002E5F]">Amplify Growth Studio</span>
        </footer>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside className={`night no-print fixed inset-y-0 start-0 z-40 w-68 shrink-0 flex-col overflow-hidden p-4 md:static md:flex ${navOpen ? 'flex' : 'hidden'}`} style={{ width: 272 }}>
        <PatternBackdrop className="opacity-70" />
        <AmplifyLogo product={agendaOnly ? 'AGENDA' : hasPos || hasOrders || hasLoyalty ? 'POS' : siteOnly ? 'SITE' : 'PROFIT'} className="relative mb-5 mt-1 shrink-0 px-2" />
        {/* the middle part scrolls on low screens, so language and logout stay visible */}
        <div className="scroll-thin relative -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <div className="relative mb-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">{agendaOnly ? t('Salon') : t('Restaurant')}</p>
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
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-[15px] font-semibold transition [@media(max-height:820px)]:py-2 ${current === n.id ? 'gold-fill text-brand-ink' : 'text-white/60 hover:bg-white/[0.06] hover:text-white'}`}>
              <n.Icon className="h-5 w-5" />{n.label}
              {n.id === 'catering' && siteReqs.length > 0 && <span className="ms-auto grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-xs font-bold text-white" aria-label={t('{n} nouvelles demandes du site', { n: siteReqs.length })}>{siteReqs.length}</span>}
            </button>
          ))}
        </nav>
        {siteOnly && r && <a href={r.site?.domain ? `https://${r.site.domain}` : `${SITE_URL}/${r.slug}`} target="_blank" rel="noreferrer" className="relative mt-4 flex items-center gap-2 rounded-xl border border-brand/30 px-3 py-2.5 text-sm font-semibold text-brand hover:bg-brand/10"><ExternalLink className="h-4 w-4" /> {t('Voir mon site')}</a>}
        {(hasPos || hasOrders) && r && <a href={`${MENU_URL}/${r.slug}`} target="_blank" rel="noreferrer" className="relative mt-4 flex items-center gap-2 rounded-xl border border-brand/30 px-3 py-2.5 text-sm font-semibold text-brand hover:bg-brand/10"><ExternalLink className="h-4 w-4" /> {t('Voir le menu client')}</a>}
        </div>
        <div className="relative shrink-0 border-t border-white/10 pt-3">
          {inst.can && <button onClick={() => inst.install()} className="mb-2 flex w-full items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2.5 text-sm font-semibold text-white hover:bg-white/10"><MonitorDown className="h-4 w-4 text-brand" /> {t('Installer l’application')}</button>}
          <LangSwitch dark className="mb-2 flex w-full" />
          <p className="mb-2 truncate px-1 text-xs text-white/40" dir="ltr">{a.session.user.email}</p>
          <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:bg-white/[0.06] hover:text-white" onClick={() => supabase.auth.signOut()}><LogOut className="h-4 w-4 rtl:-scale-x-100" /> {t('Déconnexion')}</button>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setNavOpen(false)} />}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="night no-print sticky top-0 z-20 flex items-center gap-3 px-4 py-2.5 md:hidden">
          <button onClick={() => setNavOpen(true)} aria-label={t('Menu')} className="relative grid h-10 w-10 place-items-center rounded-xl bg-white/10"><MenuIcon className="h-5 w-5" />{siteReqs.length > 0 && <span className="absolute -end-1 -top-1 h-3 w-3 rounded-full border-2 border-night bg-danger" />}</button>
          <span className="me-auto min-w-0 truncate font-display text-lg font-semibold">{r?.name}</span>
          <LangMenu dark />
        </div>
        {r && a.role === 'owner' && <div className="no-print"><BillingBanner r={r} /></div>}
        {r && <div className="no-print"><SiteRequestBanner rows={siteReqs} onOpen={id => { setCatOpen(id); setPage('catering'); setNavOpen(false); }} /></div>}
        <div className="rise mx-auto max-w-6xl p-4 md:p-10" key={current}>
          {!r && !a.isAdmin && <p className="text-muted">{t('Ce compte ne gère aucun restaurant.')}</p>}
          {r && r.status === 'paused' && <p className="mb-4 rounded-xl bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">{t('Abonnement suspendu : consultation seulement.')}</p>}
          {r && current === 'briefing' && <BriefingPage key={r.id} r={r} />}
          {current === 'group' && <GroupPage />}
          {r && current === 'planning' && <PlanningPage key={r.id} r={r} />}
          {r && current === 'inbox' && <OrdersPage key={r.id} r={r} />}
          {r && current === 'live' && <LivePage key={r.id} r={r} />}
          {r && current === 'site' && <SitePage key={r.id} r={r} />}
          {r && current === 'upgrade' && <UpgradePage key={r.id} r={r} />}
          {r && current === 'menu' && <MenuPage key={r.id} r={r} />}
          {r && current === 'profit' && <ProfitPage key={r.id} r={r} onIngredients={() => setPage('ingredients')} />}
          {r && current === 'ingredients' && <IngredientsPage key={r.id} r={r} />}
          {r && current === 'accounting' && <AccountingPage key={r.id} r={r} />}
          {r && current === 'catering' && <CateringPage key={r.id} r={r} openId={catOpen} onOpened={() => setCatOpen(null)} />}
          {r && current === 'production' && <ProductionPage key={r.id} r={r} onIngredients={() => setPage('ingredients')} />}
          {r && current === 'stock' && <StockPage key={r.id} r={r} />}
          {r && current === 'team' && <TeamPage key={r.id} r={r} />}
          {r && current === 'counter' && <LoyaltyCounterPage key={r.id} r={r} />}
          {r && current === 'customers' && <CustomersPage key={r.id} r={r} />}
          {r && current === 'online' && <OnlinePage key={r.id} r={r} />}
          {r && current === 'booking' && <BookingPage key={r.id} r={r} />}
          {r && current === 'promos' && <PromotionsPage key={r.id} r={r} />}
          {r && current === 'charges' && <ChargesPage key={r.id} r={r} />}
          {r && current === 'staff' && <StaffPage key={r.id} r={r} />}
          {r && current === 'agservices' && <AgendaServicesPage key={r.id} r={r} />}
          {r && current === 'agteam' && <AgendaTeamPage key={r.id} r={r} />}
          {r && current === 'agbooking' && <AgendaBookingPage key={r.id} r={r} />}
          {r && current === 'nouba' && <NoubaPage key={r.id} r={r} />}
          {r && current === 'agday' && <AgendaDayPage key={r.id} r={r} />}
          {r && current === 'agclients' && <AgendaClientsPage key={r.id} r={r} />}
          {r && current === 'agsite' && <SalonSitePage key={r.id} r={r} />}
          {r && current === 'tables' && <TablesPage key={r.id} r={r} />}
          {r && current === 'devices' && <DevicesPage key={r.id} r={r} />}
          {r && current === 'settings' && <SettingsPage key={r.id} r={r} />}
          {r && current === 'reports' && <ReportsPage key={r.id} r={r} />}
          {current === 'platform' && a.isAdmin && <PlatformPage />}
        </div>
      </main>
    </div>
  );
}

function Login() {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>(() => (new URLSearchParams(location.search).has('inscription') ? 'signup' : 'login'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cap = useCaptcha();
  // a link from an email that expired or was already used comes back with #error=...
  useEffect(() => {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('error')) {
      setError(/expired|invalid/i.test(h.get('error_code') ?? h.get('error_description') ?? '')
        ? t('Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien.')
        : t('Ce lien ne fonctionne pas. Demandez un nouveau lien.'));
      if (new URLSearchParams(location.search).has('reset')) setMode('forgot');
      history.replaceState(null, '', location.pathname);
    }
  }, []);
  const switchTo = (m: typeof mode) => { setMode(m); setError(null); setInfo(null); };
  // product chosen on the website (Amplify POS, Amplify Profit, or both)
  const [product] = useState(() => {
    const q = new URLSearchParams(location.search);
    if (q.has('inscription')) {
      const p = q.get('produit');
      try { if (p === 'pos' || p === 'profit' || p === 'site') localStorage.setItem('signup-product', p); else localStorage.removeItem('signup-product'); } catch { /* private mode */ }
    }
    const v = localStorage.getItem('signup-product');
    return v === 'profit' ? 'PROFIT' as const : v === 'site' ? 'SITE' as const : 'POS' as const;
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null); setInfo(null);
    const captchaToken = cap.token;
    cap.reset(); // a token works only once
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password, options: { captchaToken } });
      if (error) setError(errorMessage(error));
    } else if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/?reset=1`, captchaToken });
      // same message whether the account exists or not (nobody can test which emails are customers)
      if (error && !/not found/i.test(error.message)) setError(errorMessage(error));
      else setInfo(t('Si un compte existe avec cet e-mail, vous allez recevoir un lien pour choisir un nouveau mot de passe. Pensez à vérifier les spams.'));
    } else {
      localStorage.setItem('admin-wizard-step', '0');
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin, captchaToken } });
      if (error) { setError(errorMessage(error)); localStorage.removeItem('admin-wizard-step'); }
      else if (!data.session) setInfo(t('Compte créé. Ouvrez le lien reçu par e-mail pour le confirmer, puis connectez-vous.'));
    }
    setBusy(false);
  };
  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <LoginShowcase product={product} />
      <div className="lg-side relative z-10 -mt-8 grid min-w-0 flex-1 items-start justify-items-center rounded-t-[2rem] px-5 pb-8 pt-7 sm:place-items-center sm:p-6 lg:mt-0 lg:max-w-xl lg:overflow-y-auto lg:rounded-none">
        <form onSubmit={submit} className="rise w-full min-w-0 max-w-sm space-y-5">
          <div className="mb-6 hidden items-center justify-end gap-3 lg:flex">
            <LangMenu />
          </div>
          <div>
            {mode !== 'forgot' && (
              <div className="mb-6 grid grid-cols-2 rounded-full bg-[rgb(var(--ink)/.06)] p-1 text-sm font-semibold" role="tablist">
                {(['login', 'signup'] as const).map(m => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchTo(m)}
                    className={`h-10 rounded-full transition-colors ${mode === m ? 'bg-[#001E3E] text-white shadow' : 'text-muted hover:text-ink'}`}>
                    {m === 'login' ? t('Se connecter') : t('Créer un compte')}
                  </button>
                ))}
              </div>
            )}
            <h1 className="lg-h text-[2.75rem] sm:text-5xl">{mode === 'login' ? t('Espace gérant') : mode === 'forgot' ? t('Mot de passe oublié') : t('Créer mon compte')}</h1>
            <p className="mt-2 text-muted">{mode === 'login' ? t('Menu, personnel, tables et ventes.') : mode === 'forgot' ? t('Indiquez votre e-mail : nous vous envoyons un lien pour choisir un nouveau mot de passe.') : t('Menu QR, caisse et gestion. 14 jours gratuits, sans engagement.')}</p>
          </div>
          <Field label={t('E-mail')}><input className={inputCls} dir="ltr" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
          {mode !== 'forgot' && (
            <Field label={t('Mot de passe')} hint={mode === 'signup' ? t('8 caractères minimum.') : undefined}>
              <input className={inputCls} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} required />
            </Field>
          )}
          {mode === 'login' && (
            <button type="button" onClick={() => switchTo('forgot')} className="-mt-2 block text-sm font-semibold text-brand hover:underline">{t('Mot de passe oublié ?')}</button>
          )}
          {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">{error}</p>}
          {info && <p className="rounded-xl bg-ok/10 px-3 py-2 text-sm font-semibold text-ok">{info}</p>}
          {cap.widget}
          <Btn tone="brand" className="h-12 w-full text-base" disabled={busy || !cap.ready}>{busy ? '…' : !cap.ready ? t('Vérification anti-robot…') : mode === 'login' ? t('Se connecter') : mode === 'forgot' ? t('Envoyer le lien') : t('Créer mon compte')}</Btn>
          {mode === 'forgot'
            ? <button type="button" onClick={() => switchTo('login')} className="w-full text-center text-sm font-semibold text-muted hover:text-ink">{t('Déjà un compte ? Se connecter')}</button>
            : <p className="text-center text-sm font-semibold text-muted lg:hidden"><span className="text-brand">★</span> {t('14 jours gratuits · sans engagement')}</p>}
          {/* on a phone the showcase on the left is hidden: its three promises close the page instead */}
          {mode !== 'forgot' && (
            <ul className="space-y-3 border-t border-line/[0.08] pt-5 text-sm text-muted lg:hidden">
              {(product === 'SITE' ? [t('Votre carte depuis une simple photo'), t('Trouvé sur Google, en 3 langues'), t('Les commandes arrivent sur votre WhatsApp')] : [t('Menu QR en français, arabe et anglais'), t('Caisse, bons cuisine et rapports Z'), t('Même quand internet tombe')]).map(x => (
                <li key={x} className="flex items-center gap-3"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#05B962] text-[#001E3E]"><svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><path d="M5 12l4 4 10-10" /></svg></span>{x}</li>
              ))}
            </ul>
          )}
        </form>
      </div>
    </div>
  );
}

/** Opened from the "mot de passe oublié" email: the user is signed in with a one-time link and chooses a new password. */
function NewPassword({ first }: { first?: boolean }) {
  const a = useAdminCtx();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (pw.length < 8) { setError(t('Mot de passe trop court (8 caractères minimum).')); return; }
    if (pw !== pw2) { setError(t('Les deux mots de passe ne sont pas identiques.')); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw, data: { must_change_password: false } });
    setBusy(false);
    if (error) { setError(errorMessage(error)); return; }
    a.toast(t('Mot de passe modifié.'));
    a.endRecovery();
  };
  return (
    <div className="grid h-full place-items-center p-6">
      <form onSubmit={submit} className="rise card w-full max-w-sm space-y-5 rounded-3xl p-7">
        <div className="flex items-center justify-between gap-3"><AmplifyLogo tone="light" size="sm" /><LangSwitch /></div>
        <div>
          <h1 className="font-display text-3xl font-semibold">{first ? t('Bienvenue sur Amplify') : t('Nouveau mot de passe')}</h1>
          {first && <p className="mt-2 text-sm text-muted">{t('Choisissez votre propre mot de passe. Celui que vous avez reçu ne servira plus.')}</p>}
          <p className="mt-2 text-sm text-muted" dir="ltr">{a.session?.user.email}</p>
        </div>
        <Field label={t('Nouveau mot de passe')} hint={t('8 caractères minimum.')}>
          <input className={inputCls} type="password" autoComplete="new-password" autoFocus value={pw} onChange={e => setPw(e.target.value)} required />
        </Field>
        <Field label={t('Confirmer le mot de passe')}>
          <input className={inputCls} type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required />
        </Field>
        {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">{error}</p>}
        <Btn tone="brand" className="h-12 w-full text-base" disabled={busy}>{busy ? '…' : t('Enregistrer le mot de passe')}</Btn>
      </form>
    </div>
  );
}
