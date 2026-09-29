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
  const [now, setNow] = useState(Date.now());

  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(t); }, []);

  // restaurant brand color
  useEffect(() => {
    const c = pos.restaurant?.branding?.primary_color;
    const ch = c && hexToChannels(c);
    if (ch) {
      document.documentElement.style.setProperty('--brand', ch);
      document.documentElement.style.setProperty('--brand-ink', inkFor(c!) === '#ffffff' ? '255 255 255' : '20 20 20');
    }
    if (pos.restaurant) document.title = `Caisse · ${pos.restaurant.name}`;
  }, [pos.restaurant]);

  // idle lock: back to the staff screen after N minutes without touching the screen
  const { staff, setStaff } = pos;
  const idleMin = pos.settings.idle_lock_minutes ?? 10;
  useEffect(() => {
    if (!staff || !idleMin) return;
    let t = window.setTimeout(() => setStaff(null), idleMin * 60000);
    const reset = () => { window.clearTimeout(t); t = window.setTimeout(() => setStaff(null), idleMin * 60000); };
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    return () => { window.clearTimeout(t); window.removeEventListener('pointerdown', reset); window.removeEventListener('keydown', reset); };
  }, [staff, idleMin, setStaff]);

  if (pos.session === undefined) return <Center>Chargement…</Center>;
  if (!pos.session) return <Login />;
  if (pos.memberships === null) return <Center>{pos.loadError ?? 'Chargement…'}</Center>;
  if (!pos.memberships.length) return <Login disconnected />;
  if (!pos.restaurant) return (
    <Center>
      <div className="space-y-3 text-center">
        <p className="text-lg font-bold">Choisissez le restaurant</p>
        {pos.memberships.map(m => <button key={m.restaurant.id} onClick={() => pos.chooseRestaurant(m.restaurant)} className="block w-64 rounded-xl bg-surface-2 px-4 py-3 font-semibold">{m.restaurant.name}</button>)}
      </div>
    </Center>
  );
  if (!pos.staff) return <StaffGate />;

  const r = pos.restaurant;
  const occupied = new Set(pos.orders.filter(o => o.table_id).map(o => o.table_id)).size;
  const stale = now - pos.lastSync > 30000;
  const tabs: { id: Tab; label: string; Icon: typeof Armchair; badge?: number }[] = [
    { id: 'tables', label: `Tables ${occupied}/${pos.tables.length}`, Icon: Armchair },
    { id: 'live', label: `Commandes (${pos.orders.length})`, Icon: Receipt, badge: pos.pendingQr.length },
    { id: 'history', label: 'Historique', Icon: HistoryIcon },
    { id: 'reports', label: 'Caisse & rapports', Icon: BarChart3 },
  ];

  return (
    <div className="flex h-full flex-col">
      {pos.pendingQr.length > 0 && (
        <button onClick={() => setTab('live')} className="blink bg-qr py-2 text-center font-bold text-white">
          {pos.pendingQr.length === 1 ? '1 nouvelle commande client (QR) à accepter' : `${pos.pendingQr.length} nouvelles commandes clients (QR) à accepter`}
        </button>
      )}
      <header className="flex flex-wrap items-center gap-3 border-b border-line/10 bg-surface px-4 py-2.5">
        <div className="mr-2 min-w-0">
          <p className="truncate font-bold leading-tight">{r.name}</p>
          <p className="text-xs text-muted tabular">{new Date(now).toLocaleTimeString('fr-FR', { timeZone: r.timezone, hour: '2-digit', minute: '2-digit' })} · {pos.staff.name}</p>
        </div>
        <nav className="flex flex-wrap gap-1 rounded-full bg-bg p-1">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold ${tab === t.id ? 'bg-brand text-brand-ink' : 'text-muted hover:text-ink'}`}>
              <t.Icon className="h-4 w-4" />{t.label}
              {!!t.badge && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-qr px-1 text-xs text-white">{t.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setTarget({ kind: 'new', orderType: 'takeaway', source: 'pos' })}
            className="flex items-center gap-1.5 rounded-full border border-brand/50 bg-brand/10 px-3.5 py-2 text-sm font-bold text-brand"><ShoppingBag className="h-4 w-4" /> Emporter</button>
          <button onClick={() => setTarget({ kind: 'new', orderType: 'delivery', source: 'phone' })}
            className="flex items-center gap-1.5 rounded-full border border-line/15 px-3.5 py-2 text-sm font-bold text-muted hover:text-ink"><Bike className="h-4 w-4" /> Livraison</button>
          <span title={pos.live && !stale ? 'Connecté, mises à jour en direct' : 'Connexion instable : actualisation toutes les 10 s'}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-bold ${pos.live && !stale ? 'bg-ok/15 text-ok' : stale ? 'bg-danger/15 text-danger' : 'bg-warn/15 text-warn'}`}>
            {stale ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}{stale ? 'Hors ligne' : pos.live ? 'En direct' : 'En ligne'}
          </span>
          <span title={pos.printerOk ? 'Impression automatique active' : "Programme d'impression non détecté sur ce PC"}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-bold ${pos.printerOk ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-muted'}`}>
            <Printer className="h-3.5 w-3.5" />{pos.printerOk ? 'Impr.' : 'Sans impr.'}
          </span>
          <button onClick={() => setShowSettings(true)} aria-label="Réglages" className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-muted hover:text-ink"><Settings className="h-4 w-4" /></button>
          <button onClick={() => pos.setStaff(null)} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-2 text-sm font-bold"><Lock className="h-4 w-4" /> Verrouiller</button>
        </div>
      </header>

      {pos.dayClosed && <p className="bg-warn/15 py-1.5 text-center text-sm font-semibold text-warn">Journée clôturée (Z) : les ventes reprennent à la prochaine journée.</p>}
      {r.status === 'paused' && <p className="bg-danger/15 py-1.5 text-center text-sm font-semibold text-danger">Abonnement suspendu : la caisse est en lecture seule.</p>}

      <main className="scroll-thin flex-1 overflow-y-auto p-4">
        {tab === 'tables' && <TablesView onOpen={setTarget} />}
        {tab === 'live' && <LiveOrders onOpen={setTarget} />}
        {tab === 'history' && <HistoryView />}
        {tab === 'reports' && <ReportsView />}
      </main>

      {target && <OrderScreen target={target} onClose={() => setTarget(null)} onRetarget={setTarget} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <Toasts />
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center p-6 text-muted">{children}</div>;
}

function Toasts() {
  const { toasts } = usePos();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map(t => (
        <div key={t.id} className={`pop rounded-xl px-4 py-2.5 font-semibold shadow-xl ${t.tone === 'error' ? 'bg-danger text-white' : t.tone === 'ok' ? 'bg-ok text-black' : 'bg-surface-3 text-ink'}`}>{t.text}</div>
      ))}
    </div>
  );
}
