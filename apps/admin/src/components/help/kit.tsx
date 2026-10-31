import type { ComponentType, ReactNode } from 'react';
import { UtensilsCrossed, Globe, CalendarDays, BadgePercent, Heart, ShieldAlert, QrCode, Users, Monitor, BarChart3, Settings, LifeBuoy } from 'lucide-react';
import { getLang, t } from '../../lib/i18n';

/** pick the text in the language of the back office: fr, en, ar */
export const tr = (fr: string, en: string, ar: string) => { const l = getLang(); return l === 'ar' ? ar : l === 'en' ? en : fr; };

/** a replica screen: logical size + content. Elements carrying data-h="name" can be pointed at by a step. */
export interface ScreenDef { w: number; h: number; render: () => ReactNode }

type Tone = 'gold' | 'soft' | 'danger' | 'dark';
export function Btn({ h, children, tone = 'gold', className = '' }: { h?: string; children: ReactNode; tone?: Tone; className?: string }) {
  const c = tone === 'gold' ? 'gold-fill text-brand-ink' : tone === 'danger' ? 'bg-danger/10 text-danger' : tone === 'dark' ? 'bg-ink text-white' : 'bg-surface-2 text-ink';
  return <span data-h={h} className={`inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-xl px-3 py-1.5 text-[13px] font-bold ${c} ${className}`}>{children}</span>;
}
export const Card = ({ h, children, className = '' }: { h?: string; children: ReactNode; className?: string }) =>
  <div data-h={h} className={`card rounded-2xl p-3 ${className}`}>{children}</div>;
export const Field = ({ label, value, h, className = '' }: { label: string; value?: ReactNode; h?: string; className?: string }) => (
  <div data-h={h} className={className}>
    <p className="mb-0.5 text-[11px] font-bold text-muted">{label}</p>
    <div className="min-h-[30px] rounded-lg border border-line/15 bg-surface px-2.5 py-1.5 text-[13px] font-semibold">{value}</div>
  </div>
);
export const Chip = ({ h, children, on }: { h?: string; children: ReactNode; on?: boolean }) =>
  <span data-h={h} className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${on ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink'}`}>{children}</span>;

/** dimmed page + centred dialog */
export const Modal = ({ title, children, w = 400 }: { title: string; children: ReactNode; w?: number }) => (
  <div className="absolute inset-0 z-10 grid place-items-center bg-black/30">
    <div className="rounded-2xl bg-surface p-4 shadow-2xl" style={{ width: w }}>
      <p className="mb-3 font-display text-base font-semibold">{title}</p>
      {children}
    </div>
  </div>
);

export function Browser({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line/15 bg-bg">
      <div className="flex h-6 shrink-0 items-center gap-1.5 bg-surface-3 px-3" dir="ltr">
        <i className="h-2 w-2 rounded-full bg-danger/60" /><i className="h-2 w-2 rounded-full bg-warn/60" /><i className="h-2 w-2 rounded-full bg-ok/60" />
        <span className="mx-auto rounded-md bg-surface px-10 text-[10px] font-semibold text-muted">Amplify</span>
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

const NAV: [string, string, ComponentType<{ className?: string }>][] = [
  ['menu', 'Menu', UtensilsCrossed], ['online', 'Commande en ligne', Globe], ['booking', 'Réservations', CalendarDays], ['promos', 'Promotions', BadgePercent],
  ['customers', 'Clients', Heart], ['allergens', 'Allergènes', ShieldAlert], ['tables', 'Tables & QR codes', QrCode], ['staff', 'Personnel', Users],
  ['devices', 'Caisses', Monitor], ['reports', 'Ventes', BarChart3], ['settings', 'Restaurant', Settings], ['help', 'Aide', LifeBuoy],
];
/** French label of each menu entry (used by the real-application tour) */
export const NAV_FR: Record<string, string> = Object.fromEntries(NAV.map(([id, fr]) => [id, fr]));

/** the back office: menu on the side, page on the right */
export function Admin({ active, title, right, children }: { active: string; title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <Browser>
      <div className="flex h-full text-ink">
        <aside className="night flex w-[160px] shrink-0 flex-col gap-0.5 p-2.5">
          <p className="mb-2 px-1.5 font-logo text-[13px] font-extrabold tracking-wide">Amplify</p>
          {NAV.map(([id, fr, Icon]) => (
            <div key={id} data-h={'nav-' + id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold ${id === active ? 'bg-white/15 text-white' : 'text-white/60'}`}>
              <Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{t(fr)}</span>
            </div>
          ))}
        </aside>
        <main className="relative min-w-0 flex-1 overflow-hidden p-4">
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-display text-lg font-semibold">{title}</h2><div className="flex gap-2">{right}</div></div>
          {children}
        </main>
      </div>
    </Browser>
  );
}

/** the till: dark bezel, top bar with the staff member and the tabs */
export function Till({ tab, children }: { tab?: number; children?: ReactNode }) {
  const tabs = [tr('Tables', 'Tables', 'الطاولات'), tr('Commandes', 'Orders', 'الطلبات'), tr('Historique', 'History', 'السجل'), tr('Caisse & rapports', 'Till & reports', 'الصندوق والتقارير')];
  return (
    <div className="h-full rounded-[22px] bg-ink p-2.5">
      <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-bg text-ink">
        <div className="flex h-9 shrink-0 items-center gap-1 bg-surface px-3 text-[12px] font-bold">
          <span className="me-3 font-logo font-extrabold">Amplify</span>
          {tab !== undefined && tabs.map((x, i) => <span key={i} className={`rounded-lg px-2.5 py-1 ${i === tab ? 'bg-brand/15 text-brand' : 'text-muted'}`}>{x}</span>)}
          <span className="ms-auto text-muted">Youssef</span>
        </div>
        <div className="relative min-h-0 flex-1 p-3">{children}</div>
      </div>
    </div>
  );
}

/** a phone with the customer's menu inside */
export function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="h-full rounded-[34px] bg-ink p-2">
      <div className="relative flex h-full flex-col overflow-hidden rounded-[27px] bg-bg text-ink">
        <div className="mx-auto mt-1.5 h-1.5 w-14 shrink-0 rounded-full bg-ink/15" />
        {children}
      </div>
    </div>
  );
}
