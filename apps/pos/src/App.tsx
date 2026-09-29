import { useEffect, useState } from 'react';
import { Armchair, Receipt, History as HistoryIcon, BarChart3, Lock, Printer, Wifi, WifiOff, ShoppingBag, Bike, Settings } from 'lucide-react';
import { inkFor } from '@resto/shared';
import { usePos, type OrderTarget } from './store';
import { Login } from './components/Login';
import { StaffGate } from './components/StaffGate';
import { TablesView } from './components/TablesView';
import { LiveOrders } from './components/LiveOrders';
import { OrderScreen } from './components/OrderScreen';
import { HistoryView } from './components/History';
import { ReportsView } from './components/Reports';
import { SettingsModal } from './components/SettingsModal';
import { Star8, initials } from './components/Brand';
import { SyncPanel } from './components/SyncPanel';
import { t } from './lib/i18n';

type Tab = 'tables' | 'live' | 'history' | 'reports';

function hexToChannels(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export default function App() {
  const pos = usePos();
  const [tab, setTab] = useState<Tab>('tables');
  const [target, setTarget] = useState<OrderTarget | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { const i = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(i); }, []);

  // restaurant brand color
  useEffect(() => {
    const c = pos.restaurant?.branding?.primary_color;
    const ch = c && hexToChannels(c);
    if (ch) {
      document.documentElement.style.setProperty('--brand', ch);
      document.documentElement.style.setProperty('--brand-ink', inkFor(c!) === '#ffffff' ? '255 255 255' : '20 20 20');
    }
    if (pos.restaurant) document.title = `${t('Caisse')} · ${pos.restaurant.name}`;
  }, [pos.restaurant]);

  // idle lock: back to the staff screen after N minutes without touching the screen
  const { staff, setStaff } = pos;
  const idleMin = pos.settings.idle_lock_minutes ?? 10;
  useEffect(() => {
    if (!staff || !idleMin) return;
    let timer = window.setTimeout(() => setStaff(null), idleMin * 60000);
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(() => setStaff(null), idleMin * 60000); };
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    return () => { window.clearTimeout(timer); window.removeEventListener('pointerdown', reset); window.removeEventListener('keydown', reset); };
  }, [staff, idleMin, setStaff]);

  if (pos.session === undefined) return <Center>{t('Chargement…')}</Center>;
  if (!pos.session) return <Login />;
  if (pos.memberships === null) return <Center>{pos.loadError ?? t('Chargement…')}</Center>;
  if (!pos.memberships.length) return <Login disconnected />;
  if (!pos.restaurant) return (
    <Center>
      <div className="space-y-3 text-center">
        <p className="font-display text-3xl font-semibold text-ink">{t('Choisissez le restaurant')}</p>
        {pos.memberships.map(m => <button key={m.restaurant.id} onClick={() => pos.chooseRestaurant(m.restaurant)} className="panel block w-72 rounded-2xl px-5 py-4 text-lg font-semibold text-ink transition hover:border-brand/60">{m.restaurant.name}</button>)}
      </div>
    </Center>
  );
  if (!pos.staff) return <StaffGate />;

  const r = pos.restaurant;
  const occupied = new Set(pos.orders.filter(o => o.table_id).map(o => o.table_id)).size;
  const stale = now - pos.lastSync > 30000;
  const tabs: { id: Tab; label: string; Icon: typeof Armchair; badge?: number }[] = [
    { id: 'tables', label: t('Tables {a}/{b}', { a: occupied, b: pos.tables.length }), Icon: Armchair },
    { id: 'live', label: t('Commandes ({n})', { n: pos.orders.length }), Icon: Receipt, badge: pos.pendingQr.length },
    { id: 'history', label: t('Historique'), Icon: HistoryIcon },
    { id: 'reports', label: t('Caisse & rapports'), Icon: BarChart3 },
  ];

  return (
    <div className="ambient flex h-full flex-col">
      {pos.pendingQr.length > 0 && (
        <button onClick={() => setTab('live')} className="animate-pulse bg-gradient-to-r from-qr to-[#7a5cff] py-2.5 text-center font-bold text-white">
          {pos.pendingQr.length === 1 ? t('1 nouvelle commande client (QR) à accepter') : t('{n} nouvelles commandes clients (QR) à accepter', { n: pos.pendingQr.length })}
        </button>
      )}
      <header className="flex flex-wrap items-center gap-3 border-b border-line/[0.07] bg-surface/90 px-4 py-2.5">
        <div className="me-1 flex min-w-0 items-center gap-3">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center">
            <Star8 className="absolute inset-0 h-full w-full text-brand" />
            <span className="relative text-xs font-bold text-brand-ink">{initials(r.name).slice(0, 2)}</span>
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold leading-tight">{r.name}</p>
            <p className="text-xs text-muted tabular"><b className="font-semibold text-ink">{new Date(now).toLocaleTimeString('fr-FR', { timeZone: r.timezone, hour: '2-digit', minute: '2-digit' })}</b> · {pos.staff.name}</p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-1 rounded-2xl border border-line/[0.06] bg-bg/70 p-1">
          {tabs.map(x => (
            <button key={x.id} onClick={() => setTab(x.id)}
              className={`relative flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-bold transition ${tab === x.id ? 'gold-fill text-brand-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
              <x.Icon className="h-4 w-4" />{x.label}
              {!!x.badge && <span className="absolute -end-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-qr px-1 text-xs text-white ring-2 ring-surface">{x.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <button aria-label={t('Emporter')} title={t('Nouvelle commande à emporter')} onClick={() => setTarget({ kind: 'new', orderType: 'takeaway', source: 'pos' })}
            className="flex items-center gap-1.5 rounded-xl border border-brand/40 bg-brand/10 px-3.5 py-2.5 text-sm font-bold text-brand transition hover:bg-brand/20"><ShoppingBag className="h-4 w-4" /><span className="hidden xl:inline">{t('Emporter')}</span></button>
          <button aria-label={t('Livraison')} title={t('Livraison (téléphone)')} onClick={() => setTarget({ kind: 'new', orderType: 'delivery', source: 'phone' })}
            className="flex items-center gap-1.5 rounded-xl border border-line/[0.12] px-3.5 py-2.5 text-sm font-bold text-muted transition hover:bg-surface-2 hover:text-ink"><Bike className="h-4 w-4" /><span className="hidden xl:inline">{t('Livraison')}</span></button>
          <ConnectionPill stale={stale} onClick={() => setShowSync(true)} />
          <span title={pos.printerOk ? t('Impression automatique active') : t("Programme d'impression non détecté sur ce PC")}
            className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${pos.printerOk ? 'bg-ok/10 text-ok' : 'bg-surface-2 text-muted'}`}>
            <Printer className="h-3.5 w-3.5" /><span className="hidden 2xl:inline">{pos.printerOk ? t('Impr.') : t('Sans impr.')}</span>
            <span className={`h-2 w-2 rounded-full ${pos.printerOk ? 'bg-ok' : 'bg-muted/50'}`} />
          </span>
          <button onClick={() => pos.setLang(pos.lang === 'ar' ? 'fr' : 'ar')} aria-label={pos.lang === 'ar' ? 'Français' : 'العربية'} title={pos.lang === 'ar' ? 'Français' : 'العربية'}
            className="grid h-10 min-w-10 place-items-center rounded-xl bg-surface-2 px-2 text-sm font-bold text-muted transition hover:text-ink">{pos.lang === 'ar' ? 'FR' : 'ع'}</button>
          <button onClick={() => setShowSettings(true)} aria-label={t('Réglages')} className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-muted transition hover:text-ink"><Settings className="h-4 w-4" /></button>
          <button aria-label={t('Verrouiller')} title={t('Verrouiller')} onClick={() => pos.setStaff(null)} className="flex items-center gap-1.5 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm font-bold transition hover:bg-surface-3"><Lock className="h-4 w-4" /><span className="hidden xl:inline">{t('Verrouiller')}</span></button>
        </div>
      </header>

      {!pos.online && (
        <button onClick={() => setShowSync(true)} className="flex items-center justify-center gap-2 bg-warn/15 py-2 text-sm font-semibold text-warn">
          <WifiOff className="h-4 w-4" /> {t("Hors ligne : commandes, bons et encaissements continuent sur ce poste et partent automatiquement au retour d'internet.")}
          {pos.pendingCount > 0 && <span className="rounded-full bg-warn px-2 py-0.5 text-xs font-bold text-black">{t('{n} en attente', { n: pos.pendingCount })}</span>}
        </button>
      )}
      {pos.online && pos.failedOps.length > 0 && (
        <button onClick={() => setShowSync(true)} className="bg-danger/15 py-2 text-center text-sm font-semibold text-danger">
          {t('{n} opération(s) refusée(s) par le serveur : touchez pour vérifier.', { n: pos.failedOps.length })}
        </button>
      )}
      {pos.dayClosed && <p className="bg-warn/15 py-1.5 text-center text-sm font-semibold text-warn">{t('Journée clôturée (Z) : les ventes reprennent à la prochaine journée.')}</p>}
      {r.status === 'paused' && <p className="bg-danger/15 py-1.5 text-center text-sm font-semibold text-danger">{t('Abonnement suspendu : la caisse est en lecture seule.')}</p>}

      <main className="scroll-thin flex-1 overflow-y-auto p-5">
        {tab === 'tables' && <TablesView onOpen={setTarget} />}
        {tab === 'live' && <LiveOrders onOpen={setTarget} />}
        {tab === 'history' && (pos.online ? <HistoryView /> : <OfflineNotice what={t("L'historique des tickets")} />)}
        {tab === 'reports' && (pos.online ? <ReportsView /> : <OfflineNotice what={t('Les rapports et la caisse')} />)}
      </main>

      {target && <OrderScreen target={target} onClose={() => setTarget(null)} onRetarget={setTarget} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showSync && <SyncPanel onClose={() => setShowSync(false)} />}
      <Toasts />
    </div>
  );
}

function ConnectionPill({ stale, onClick }: { stale: boolean; onClick: () => void }) {
  const pos = usePos();
  const failed = pos.failedOps.length;
  const [tone, text, title] = !pos.online ? ['danger', t('Hors ligne'), t('Pas de connexion : la caisse continue sur ce poste')]
    : failed ? ['danger', t('{n} à vérifier', { n: failed }), t('Des opérations ont été refusées par le serveur')]
    : pos.pendingCount ? ['warn', t('Envoi…'), t('Envoi des opérations en attente')]
    : pos.live && !stale ? ['ok', t('En direct'), t('Connecté, mises à jour en direct')]
    : ['warn', t('En ligne'), t('Connexion instable : actualisation toutes les 10 s')];
  const cls = tone === 'ok' ? 'bg-ok/10 text-ok' : tone === 'warn' ? 'bg-warn/15 text-warn' : 'bg-danger/15 text-danger';
  const dot = tone === 'ok' ? 'bg-ok shadow-[0_0_8px_rgb(var(--ok))]' : tone === 'warn' ? 'bg-warn' : 'bg-danger';
  return (
    <button onClick={onClick} title={title} aria-label={`${t('Connexion')} : ${text}`}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${cls}`}>
      {pos.online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      <span className="hidden 2xl:inline">{text}</span>
      {pos.pendingCount > 0 && <span className="rounded-full bg-black/20 px-1.5 tabular">{pos.pendingCount}</span>}
      <span className={`h-2 w-2 rounded-full ${dot}`} />
    </button>
  );
}

function OfflineNotice({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-warn/10 text-warn"><WifiOff className="h-8 w-8" /></span>
      <p className="mt-4 font-display text-2xl font-semibold">{t('Connexion requise')}</p>
      <p className="mt-2 text-muted">{t('{what} viennent du serveur. Ils reviennent dès que la connexion est rétablie. Les commandes et encaissements, eux, continuent normalement.', { what })}</p>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="ambient grid h-full place-items-center p-6 text-muted">{children}</div>;
}

function Toasts() {
  const { toasts } = usePos();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map(x => (
        <div key={x.id} className={`pop rounded-2xl px-5 py-3 font-semibold shadow-2xl ${x.tone === 'error' ? 'bg-danger text-white' : x.tone === 'ok' ? 'bg-ok text-[#04130b]' : 'panel text-ink'}`}>{x.text}</div>
      ))}
    </div>
  );
}
