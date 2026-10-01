// Kitchen screen (KDS): a tablet or TV at the kitchen or the bar shows the bons of
// its stations, oldest first, with how long they have been waiting. One tap: ready.
// Works on the same order data as the till (offline too: taps are queued).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChefHat, LogOut, RotateCcw, Wifi, WifiOff } from 'lucide-react';
import { usePos } from '../store';
import { dropCache, readCache, writeCache } from '../lib/cache';
import { ticketRef } from '../lib/print';
import { chime } from '../lib/sound';
import { Btn, Modal } from './ui';
import { t } from '../lib/i18n';
import type { Line, Order } from '../lib/types';

export interface KdsConfig { stations: string[] }
const KEY = 'pos-kds';
export const kdsConfig = () => readCache<KdsConfig>(KEY);
export const setKdsConfig = (c: KdsConfig | null) => (c ? writeCache(KEY, c) : dropCache(KEY));

const sentAt = (l: Line) => l.kitchen_sent_at ?? l.print_requested_at ?? null;
const stationLabel = (s: string) => (s === 'kitchen' ? t('Cuisine') : s === 'bar' ? t('Bar') : s);

/** Choose which stations this screen shows (from the stations the menu uses). */
export function KdsSetup({ onClose, onStart }: { onClose: () => void; onStart: (c: KdsConfig) => void }) {
  const pos = usePos();
  const all = [...new Set(['kitchen', ...pos.categories.map(c => c.station).filter(Boolean)])];
  const [pick, setPick] = useState<string[]>(kdsConfig()?.stations ?? ['kitchen']);
  return (
    <Modal title={t('Écran cuisine')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={!pick.length} onClick={() => onStart({ stations: pick })}><ChefHat className="h-4 w-4" /> {t('Ouvrir l’écran cuisine')}</Btn></div>}>
      <p className="mb-4 text-sm text-muted">{t('Ce poste affiche les bons à préparer, sans code personnel. Choisissez ce qu’il montre :')}</p>
      <div className="flex flex-wrap gap-2">
        {all.map(s => {
          const on = pick.includes(s);
          return <button key={s} onClick={() => setPick(p => (on ? p.filter(x => x !== s) : [...p, s]))}
            className={`rounded-2xl px-5 py-3 font-bold ${on ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`}>{stationLabel(s)}</button>;
        })}
      </div>
    </Modal>
  );
}

export function KitchenScreen({ config, onExit }: { config: KdsConfig; onExit: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const [now, setNow] = useState(Date.now());
  const [confirmExit, setConfirmExit] = useState(false);
  useEffect(() => { const i = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(i); }, []);

  const mine = (l: Line) => config.stations.includes(l.station);
  // one card per order and station group: the lines waiting for this screen
  const cards = useMemo(() => pos.orders
    .map(o => ({ o, lines: o.order_lines.filter(l => mine(l) && sentAt(l) && !l.ready_at) }))
    .filter(c => c.lines.length)
    .map(c => ({ ...c, since: Math.min(...c.lines.map(l => Date.parse(sentAt(l)!))) }))
    .sort((a, b) => a.since - b.since), [pos.orders, config.stations]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = useMemo(() => pos.orders
    .flatMap(o => o.order_lines.filter(l => mine(l) && l.ready_at && now - Date.parse(l.ready_at) < 15 * 60000).map(l => ({ o, l })))
    .sort((a, b) => Date.parse(b.l.ready_at!) - Date.parse(a.l.ready_at!)), [pos.orders, config.stations, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const recent = useMemo(() => {
    const m = new Map<string, { o: Order; lines: Line[] }>();
    done.forEach(({ o, l }) => m.set(o.id, { o, lines: [...(m.get(o.id)?.lines ?? []), l] }));
    return [...m.values()].slice(0, 6);
  }, [done]);

  // a sound when a new bon arrives
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(cards.flatMap(c => c.lines.map(l => l.id)));
    if (seen.current && [...ids].some(id => !seen.current!.has(id))) chime();
    seen.current = ids;
  }, [cards]);

  const minutes = (since: number) => Math.max(0, Math.floor((now - since) / 60000));
  const tone = (m: number) => (m >= 20 ? 'border-danger bg-danger/10' : m >= 10 ? 'border-warn bg-warn/10' : 'border-line/15 bg-surface');
  const badge = (m: number) => (m >= 20 ? 'bg-danger text-white' : m >= 10 ? 'bg-warn text-black' : 'bg-surface-2 text-ink');

  return (
    <div className="ambient flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line/[0.07] bg-surface/90 px-4 py-2.5">
        <ChefHat className="h-6 w-6 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-xl font-semibold leading-tight">{config.stations.map(stationLabel).join(' · ')}</p>
          <p className="text-xs text-muted">{r.name} · {t('{n} bon(s) à préparer', { n: cards.length })}</p>
        </div>
        <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${pos.online ? 'bg-ok/10 text-ok' : 'bg-danger/15 text-danger'}`}>
          {pos.online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{pos.online ? t('En direct') : t('Hors ligne')}
        </span>
        <p className="font-display text-2xl font-semibold tabular">{new Date(now).toLocaleTimeString('fr-FR', { timeZone: r.timezone, hour: '2-digit', minute: '2-digit' })}</p>
        <button aria-label={t('Quitter l’écran cuisine')} onClick={() => setConfirmExit(true)} className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-muted hover:text-ink"><LogOut className="h-4 w-4" /></button>
      </header>

      <main className="scroll-thin flex-1 overflow-y-auto p-4">
        {!cards.length ? (
          <div className="grid h-full place-items-center text-center text-muted">
            <div><ChefHat className="mx-auto h-16 w-16 text-brand/40" /><p className="mt-3 text-xl">{t('Rien à préparer pour le moment.')}</p></div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {cards.map(({ o, lines, since }) => {
              const m = minutes(since);
              return (
                <article key={o.id} className={`flex flex-col overflow-hidden rounded-3xl border-2 ${tone(m)}`}>
                  <div className="flex items-start justify-between gap-2 px-4 pt-3">
                    <div className="min-w-0">
                      <p className="truncate font-display text-2xl font-semibold leading-tight">{pos.labelOf(o)}</p>
                      <p className="text-sm text-muted">{ticketRef(o)}{o.source === 'qr' ? ' · QR' : ''}</p>
                    </div>
                    <span className={`rounded-xl px-2.5 py-1 font-display text-xl font-semibold tabular ${badge(m)}`}>{t('{n} min', { n: m })}</span>
                  </div>
                  <ul className="flex-1 space-y-2 px-4 py-3">
                    {lines.map(l => (
                      <li key={l.id} className="leading-tight">
                        <p className="text-lg font-bold"><span className="tabular text-brand">{l.quantity}×</span> {l.name}</p>
                        {l.note && <p className="text-base font-semibold italic text-warn">» {l.note}</p>}
                      </li>
                    ))}
                  </ul>
                  {o.note && <p className="mx-4 mb-3 rounded-xl bg-surface-2 px-3 py-2 text-sm"><b>{t('Note :')}</b> {o.note}</p>}
                  <button onClick={() => pos.markReady(o, lines.map(l => l.id), true)}
                    className="flex items-center justify-center gap-2 bg-ok py-4 text-lg font-bold text-[#032A2A] active:brightness-90">
                    <Check className="h-6 w-6" /> {t('Prêt')}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {recent.length > 0 && (
        <footer className="flex items-center gap-2 overflow-x-auto border-t border-line/[0.07] bg-surface/80 px-4 py-2">
          <span className="shrink-0 text-xs font-bold uppercase tracking-[0.15em] text-muted">{t('Prêts')}</span>
          {recent.map(({ o, lines }) => (
            <button key={o.id} onClick={() => pos.markReady(o, lines.map(l => l.id), false)} title={t('Rappeler')}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold hover:bg-surface-3">
              <RotateCcw className="h-3.5 w-3.5 text-muted" /> {pos.labelOf(o)} · {ticketRef(o)}
            </button>
          ))}
        </footer>
      )}

      {confirmExit && (
        <Modal title={t('Quitter l’écran cuisine ?')} onClose={() => setConfirmExit(false)}
          footer={<div className="flex justify-end gap-2"><Btn onClick={() => setConfirmExit(false)}>{t('Annuler')}</Btn><Btn tone="danger" onClick={onExit}>{t('Quitter')}</Btn></div>}>
          <p>{t('Ce poste redevient une caisse normale (avec code personnel).')}</p>
        </Modal>
      )}
    </div>
  );
}
