import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, CalendarClock, Circle, Clock, DoorOpen, Flower2, Minus, Plus, QrCode, RotateCw, Square, Trash2, Type, UtensilsCrossed, Wand2, Wine, X, AppWindow, RectangleHorizontal, Users } from 'lucide-react';
import { usePos, type OrderTarget } from '../store';
import { mad } from '../lib/format';
import { t } from '../lib/i18n';
import * as db from '../lib/data';
import { PIN_ERRORS, errorMessage } from '../lib/errors';
import type { FloorPlan, PlanItem, Table } from '../lib/types';
import { Btn, Modal, inputCls } from './ui';
import { ManagerApproval } from './StaffGate';
import type { Reservation } from './Reservations';

// The floor plan: each zone of the restaurant drawn on a grid of 48 x 32 squares. In service the tables show
// their state (free, occupied with total and minutes, dish ready, QR order, booking coming); a manager
// draws the room once in the editor: drag the tables, add the bar, the door, windows, walls, plants.

export const GW = 48, GH = 32;
const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const box = (x: number, y: number, w: number, h: number) => ({ left: pct(x, GW), top: pct(y, GH), width: pct(w, GW), height: pct(h, GH) });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const placed = (tb: Table) => tb.plan_x != null && tb.plan_y != null;

const KINDS: { k: PlanItem['k']; label: () => string; icon: typeof Wine; w: number; h: number }[] = [
  { k: 'bar', label: () => t('Bar'), icon: Wine, w: 12, h: 3 },
  { k: 'kitchen', label: () => t('Cuisine'), icon: UtensilsCrossed, w: 10, h: 5 },
  { k: 'door', label: () => t('Entrée'), icon: DoorOpen, w: 4, h: 1 },
  { k: 'window', label: () => t('Fenêtre'), icon: AppWindow, w: 8, h: 1 },
  { k: 'wall', label: () => t('Mur'), icon: RectangleHorizontal, w: 12, h: 1 },
  { k: 'plant', label: () => t('Plante'), icon: Flower2, w: 2, h: 2 },
  { k: 'text', label: () => t('Texte'), icon: Type, w: 8, h: 2 },
];
const kindOf = (k: PlanItem['k']) => KINDS.find(x => x.k === k)!;

/** how a fixed thing of the room is drawn, the same in service and in the editor */
function ItemShape({ it }: { it: PlanItem }) {
  const K = kindOf(it.k);
  const Icon = K.icon;
  const name = it.t || (it.k === 'text' || it.k === 'wall' || it.k === 'window' || it.k === 'door' || it.k === 'plant' ? '' : K.label());
  const cls: Record<PlanItem['k'], string> = {
    bar: 'rounded-lg bg-line/[0.10] border border-line/20 text-ink/70',
    kitchen: 'rounded-lg bg-line/[0.06] border border-dashed border-line/25 text-ink/60',
    door: 'border-x-2 border-brand/70 bg-brand/15 text-brand',
    window: 'rounded-sm bg-sky-300/25 border border-sky-300/50',
    wall: 'rounded-sm bg-line/40',
    plant: 'rounded-full bg-emerald-500/25 border border-emerald-500/40 text-emerald-500',
    text: 'text-ink/60 font-display font-semibold',
  };
  return (
    <div className={`flex h-full w-full items-center justify-center gap-1 overflow-hidden text-xs font-bold ${cls[it.k]}`}>
      {(it.k === 'bar' || it.k === 'kitchen' || it.k === 'plant' || (it.k === 'door' && it.w * it.h >= 4)) && <Icon className="h-3.5 w-3.5 shrink-0" />}
      {name && <span className={`truncate ${it.k === 'text' ? 'text-sm' : ''}`}>{name}</span>}
    </div>
  );
}

/** the canvas: grid paper with the shape of the room */
/** fit: the screen height the plan may use, so the whole room is visible without scrolling */
function Paper({ children, grid, innerRef, fit }: { children: ReactNode; grid?: boolean; innerRef?: React.Ref<HTMLDivElement>; fit: string }) {
  return (
    <div ref={innerRef} className="relative mx-auto w-full select-none overflow-hidden rounded-3xl border border-line/[0.08] bg-surface/40"
      style={{
        maxWidth: `max(320px, calc((${fit}) * ${GW / GH}))`,
        aspectRatio: `${GW} / ${GH}`,
        backgroundImage: grid
          ? 'linear-gradient(to right, rgb(var(--line) / 0.07) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--line) / 0.07) 1px, transparent 1px)'
          : 'radial-gradient(rgb(var(--line) / 0.10) 1px, transparent 1px)',
        backgroundSize: grid ? `${100 / GW}% ${100 / GH}%` : `${(100 / GW) * 2}% ${(100 / GH) * 2}%`,
      }}>
      {children}
    </div>
  );
}

export interface TableState { total: number; count: number; qr: boolean; pending: boolean; since: number; ready: boolean; booking?: Reservation }

/** In service: the plan of one zone, each table with its state. */
export function PlanView({ zone, tables, plan, state, onOpen }: {
  zone: string; tables: Table[]; plan: FloorPlan; state: (tb: Table) => TableState; onOpen: (t: OrderTarget) => void;
}) {
  const items = plan.zones?.[zone] ?? [];
  const on = tables.filter(placed);
  const ref = useRef<HTMLDivElement>(null);
  const cell = useCell(ref);
  const off = tables.filter(tb => !placed(tb));
  return (
    <div className="space-y-3">
      <Paper fit="100dvh - 230px" innerRef={ref}>
        {items.map((it, i) => <div key={i} className="pointer-events-none absolute p-[2px]" style={box(it.x, it.y, it.w, it.h)}><ItemShape it={it} /></div>)}
        {on.map(tb => {
          const s = state(tb);
          return (
            <div key={tb.id} className="absolute p-[3px]" style={box(tb.plan_x!, tb.plan_y!, tb.plan_w ?? 4, tb.plan_h ?? 4)}>
              <TableButton tb={tb} s={s} cell={cell} onClick={() => onOpen({ kind: 'table', tableId: tb.id })} />
            </div>
          );
        })}
      </Paper>
      {off.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted">{t('Pas sur le plan :')}</span>
          {off.map(tb => {
            const s = state(tb);
            return (
              <button key={tb.id} onClick={() => onOpen({ kind: 'table', tableId: tb.id })}
                className={`rounded-xl px-3 py-1.5 text-sm font-bold ${s.count ? 'gold-fill text-brand-ink' : 'panel'} ${s.pending ? 'blink' : ''}`}>
                {tb.label}{s.count ? ` · ${mad(s.total)}` : ''}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 20:30, in the restaurant's time zone */
export const hhmm = (iso: string, tz?: string) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

/** the width of one grid square on screen, in px, following the size of the plan */
function useCell(ref: React.RefObject<HTMLDivElement | null>) {
  const [cell, setCell] = useState(18);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setCell(el.getBoundingClientRect().width / GW));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cell;
}

function TableButton({ tb, s, cell, onClick }: { tb: Table; s: TableState; cell: number; onClick: () => void }) {
  const tz = usePos().restaurant?.timezone;
  const round = tb.plan_shape === 'round';
  // the text follows the size of the table on screen: on a phone a small table shows only its number
  const side = Math.min(tb.plan_w ?? 4, tb.plan_h ?? 4) * cell;
  const small = side < 64;
  const tiny = side < 40;
  const fs = Math.max(11, Math.min(30, side * (tiny ? 0.5 : 0.36)));
  return (
    <button onClick={onClick}
      className={`relative flex h-full w-full flex-col items-center justify-center overflow-hidden transition active:scale-95 ${round ? 'rounded-full' : 'rounded-2xl'} ${
        s.count ? 'gold-fill text-brand-ink shadow-lg' : s.booking ? 'panel border-2 !border-sky-400/70' : 'panel hover:border-brand/50'} ${s.pending ? 'blink' : ''}`}>
      {s.qr && !tiny && <span className="absolute end-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-qr shadow"><QrCode className="h-3 w-3 text-white" /></span>}
      <span className="font-display font-semibold leading-none" style={{ fontSize: fs }}>{tb.label}</span>
      {tiny ? (s.ready ? <span className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-warn" /> : null) : s.count > 0 ? <>
        {!small && <span className="mt-1 text-xs font-bold tabular">{mad(s.total)}</span>}
        {s.ready
          ? <span className="mt-0.5 flex items-center gap-0.5 rounded-full bg-warn px-1.5 text-[10px] font-bold text-white"><BellRing className="h-2.5 w-2.5" />{t('Prêt')}</span>
          : <span className="mt-0.5 flex items-center gap-0.5 text-[10px] font-semibold opacity-70"><Clock className="h-2.5 w-2.5" />{t('{n} min', { n: s.since })}</span>}
      </> : s.booking?.starts_at ? (
        <span className="mt-1 flex max-w-full items-center gap-0.5 truncate px-1 text-[10px] font-bold text-sky-500"><CalendarClock className="h-2.5 w-2.5 shrink-0" />{hhmm(s.booking.starts_at, tz)}{!small && ` ${s.booking.name.split(' ')[0]}`}</span>
      ) : tb.seats ? (
        <span className="mt-1 flex items-center gap-0.5 text-[10px] font-semibold text-muted"><Users className="h-2.5 w-2.5" />{tb.seats}</span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------- editor

type Pos = { x: number | null; y: number | null; w: number; h: number; shape: 'rect' | 'round'; seats: number | null };
type Sel = { kind: 'table'; id: string } | { kind: 'item'; i: number } | null;

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The manager draws the room. Everything is saved at once, with a manager PIN. */
export function PlanEditor({ zones, startZone, onClose }: { zones: string[]; startZone: string; onClose: () => void }) {
  const pos = usePos();
  const [zone, setZone] = useState(startZone);
  const [tabs, setTabs] = useState<Record<string, Pos>>(() => Object.fromEntries(pos.tables.map(tb => [tb.id, {
    x: tb.plan_x ?? null, y: tb.plan_y ?? null, w: tb.plan_w ?? 4, h: tb.plan_h ?? 4, shape: tb.plan_shape ?? 'rect', seats: tb.seats ?? null,
  }])));
  const [items, setItems] = useState<Record<string, PlanItem[]>>(() => JSON.parse(JSON.stringify(pos.floorPlan.zones ?? {})));
  const [sel, setSel] = useState<Sel>(null);
  const [dirty, setDirty] = useState(false);
  const [leave, setLeave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paper = useRef<HTMLDivElement>(null);

  const zTables = pos.tables.filter(tb => (tb.zone ?? '') === zone);
  const zItems = items[zone] ?? [];
  const offPlan = zTables.filter(tb => tabs[tb.id].x == null);

  const setT = (id: string, p: Partial<Pos>) => { setTabs(s => ({ ...s, [id]: { ...s[id], ...p } })); setDirty(true); };
  const setI = (i: number, p: Partial<PlanItem>) => { setItems(s => ({ ...s, [zone]: (s[zone] ?? []).map((it, j) => j === i ? { ...it, ...p } : it) })); setDirty(true); };

  /** first free spot of w x h in this zone, scanning from the top left */
  const freeSpot = (w: number, h: number, skip?: string) => {
    const taken = [
      ...zTables.filter(tb => tb.id !== skip && tabs[tb.id].x != null).map(tb => ({ x: tabs[tb.id].x! - 1, y: tabs[tb.id].y! - 1, w: tabs[tb.id].w + 2, h: tabs[tb.id].h + 2 })),
      ...zItems.filter(it => it.k !== 'text'),
    ];
    for (let y = 1; y + h <= GH; y++) for (let x = 1; x + w <= GW; x++) {
      const c = { x, y, w, h };
      if (!taken.some(o => overlaps(c, o))) return { x, y };
    }
    return { x: 0, y: 0 };
  };
  const place = (id: string) => { const p = tabs[id]; const s = freeSpot(p.w, p.h, id); setT(id, s); setSel({ kind: 'table', id }); };
  const placeAll = () => {
    // one by one, each in the first free place left by the ones before
    let next = { ...tabs };
    for (const tb of offPlan) {
      const p = next[tb.id];
      const taken = [
        ...zTables.filter(o => next[o.id].x != null).map(o => ({ x: next[o.id].x! - 1, y: next[o.id].y! - 1, w: next[o.id].w + 2, h: next[o.id].h + 2 })),
        ...zItems.filter(it => it.k !== 'text'),
      ];
      let spot = { x: 0, y: 0 };
      outer: for (let y = 1; y + p.h <= GH; y++) for (let x = 1; x + p.w <= GW; x++) {
        if (!taken.some(o => overlaps({ x, y, w: p.w, h: p.h }, o))) { spot = { x, y }; break outer; }
      }
      next = { ...next, [tb.id]: { ...p, ...spot } };
    }
    setTabs(next); setDirty(true);
  };
  const addItem = (k: PlanItem['k']) => {
    const K = kindOf(k);
    const s = freeSpot(K.w, K.h);
    setItems(st => ({ ...st, [zone]: [...(st[zone] ?? []), { k, x: s.x, y: s.y, w: K.w, h: K.h, ...(k === 'text' ? { t: t('Terrasse') } : {}) }] }));
    setSel({ kind: 'item', i: zItems.length }); setDirty(true);
  };

  // dragging: move (or resize from the corner), snapped to the grid
  const drag = useRef<{ sx: number; sy: number; x: number; y: number; w: number; h: number; mode: 'move' | 'size'; target: Sel } | null>(null);
  const down = (e: RPointerEvent, target: Sel, r: { x: number; y: number; w: number; h: number }, mode: 'move' | 'size') => {
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, ...r, mode, target };
    setSel(target);
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current; const el = paper.current;
    if (!d || !el || !d.target) return;
    const cell = el.getBoundingClientRect().width / GW;
    const dx = Math.round((e.clientX - d.sx) / cell), dy = Math.round((e.clientY - d.sy) / cell);
    const isTable = d.target.kind === 'table';
    const min = isTable ? 2 : 1, max = isTable ? 16 : GW;
    let p: { x: number; y: number; w: number; h: number };
    if (d.mode === 'move') p = { x: clamp(d.x + dx, 0, GW - d.w), y: clamp(d.y + dy, 0, GH - d.h), w: d.w, h: d.h };
    else p = { x: d.x, y: d.y, w: clamp(d.w + dx, min, Math.min(max, GW - d.x)), h: clamp(d.h + dy, min, Math.min(isTable ? 16 : GH, GH - d.y)) };
    if (d.target.kind === 'table') { const id = d.target.id; const c = tabs[id]; if (c.x !== p.x || c.y !== p.y || c.w !== p.w || c.h !== p.h) setT(id, p); }
    else { const i = d.target.i; const c = zItems[i]; if (c && (c.x !== p.x || c.y !== p.y || c.w !== p.w || c.h !== p.h)) setI(i, p); }
  };
  const up = () => { drag.current = null; };

  const save = async (managerId: string | null, pin: string | null) => {
    setBusy(true); setError(null);
    try {
      const plan: FloorPlan = { zones: Object.fromEntries(Object.entries(items).filter(([, v]) => v.length)) };
      const res = await db.rpc<{ ok: boolean; error?: string }>('save_floor_plan', {
        p_restaurant_id: pos.restaurant!.id,
        p_tables: pos.tables.map(tb => { const p = tabs[tb.id]; return { id: tb.id, x: p.x, y: p.y, w: p.w, h: p.h, shape: p.shape, seats: p.seats }; }),
        p_plan: plan, p_staff_id: managerId, p_pin: pin,
      });
      if (!res.ok) { setError(PIN_ERRORS[res.error ?? 'invalid'] ?? t('Code incorrect.')); setBusy(false); return; }
      await pos.reloadStatic();
      pos.toast(t('Plan enregistré'), 'ok');
      onClose();
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };

  const selTable = sel?.kind === 'table' ? pos.tables.find(tb => tb.id === sel.id) : undefined;
  const selItem = sel?.kind === 'item' ? zItems[sel.i] : undefined;

  // on <body>: an animated screen (transform) would otherwise hold the full screen editor inside it
  return createPortal((
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-2 border-b border-line/[0.07] bg-surface px-4 py-3">
        <h2 className="me-2 font-display text-xl font-semibold">{t('Dessiner le plan')}</h2>
        {zones.length > 1 && zones.map(z => (
          <button key={z} onClick={() => { setZone(z); setSel(null); }}
            className={`rounded-full px-4 py-1.5 text-sm font-bold ${zone === z ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`}>{z || t('Salle')}</button>
        ))}
        <span className="flex-1" />
        {leave
          ? <Btn tone="danger" onClick={onClose}><X className="h-4 w-4" /> {t('Quitter sans enregistrer')}</Btn>
          : <Btn onClick={() => (dirty ? setLeave(true) : onClose())}><X className="h-4 w-4" /> {t('Fermer')}</Btn>}
        <Btn tone="brand" disabled={!dirty || !pos.online} onClick={() => setSaving(true)}>{t('Enregistrer')}</Btn>
      </header>
      {!pos.online && <p className="bg-warn/15 py-1.5 text-center text-xs font-semibold text-warn">{t('Hors ligne : le plan sera enregistrable au retour d’internet.')}</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:flex-row">
        <div className="min-w-0 flex-1" onPointerDown={() => setSel(null)}>
          <Paper grid innerRef={paper} fit="100dvh - 130px">
            {zItems.map((it, i) => {
              const on = sel?.kind === 'item' && sel.i === i;
              return (
                <div key={i} className={`absolute touch-none p-[2px] ${on ? 'z-20' : 'z-0'}`} style={box(it.x, it.y, it.w, it.h)}
                  onPointerDown={e => down(e, { kind: 'item', i }, it, 'move')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                  <div className={`h-full w-full cursor-grab rounded-md ${on ? 'ring-2 ring-brand ring-offset-1 ring-offset-bg' : ''}`}><ItemShape it={it} /></div>
                  {on && <Handle onPointerDown={e => down(e, { kind: 'item', i }, it, 'size')} onPointerMove={move} onPointerUp={up} />}
                </div>
              );
            })}
            {zTables.filter(tb => tabs[tb.id].x != null).map(tb => {
              const p = tabs[tb.id];
              const on = sel?.kind === 'table' && sel.id === tb.id;
              const r = { x: p.x!, y: p.y!, w: p.w, h: p.h };
              return (
                <div key={tb.id} className={`absolute touch-none p-[3px] ${on ? 'z-30' : 'z-10'}`} style={box(r.x, r.y, r.w, r.h)}
                  onPointerDown={e => down(e, { kind: 'table', id: tb.id }, r, 'move')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                  <div className={`panel flex h-full w-full cursor-grab flex-col items-center justify-center ${p.shape === 'round' ? 'rounded-full' : 'rounded-2xl'} ${on ? '!border-brand ring-2 ring-brand' : ''}`}>
                    <span className="font-display text-xl font-semibold leading-none">{tb.label}</span>
                    {p.seats && <span className="mt-0.5 flex items-center gap-0.5 text-[10px] font-semibold text-muted"><Users className="h-2.5 w-2.5" />{p.seats}</span>}
                  </div>
                  {on && <Handle onPointerDown={e => down(e, { kind: 'table', id: tb.id }, r, 'size')} onPointerMove={move} onPointerUp={up} />}
                </div>
              );
            })}
          </Paper>
          <p className="mt-2 text-center text-xs text-muted">{t('Faites glisser pour déplacer. Le coin en bas à droite change la taille.')}</p>
        </div>

        <aside className="w-full shrink-0 space-y-4 lg:w-72">
          {selTable && (
            <Card title={t('Table {n}', { n: selTable.label })}>
              <div className="grid grid-cols-2 gap-2">
                <Choice on={tabs[selTable.id].shape === 'rect'} onClick={() => setT(selTable.id, { shape: 'rect' })}><Square className="h-4 w-4" /> {t('Carrée')}</Choice>
                <Choice on={tabs[selTable.id].shape === 'round'} onClick={() => setT(selTable.id, { shape: 'round' })}><Circle className="h-4 w-4" /> {t('Ronde')}</Choice>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([[t('Petite'), 3, 3], [t('Moyenne'), 4, 4], [t('Longue'), 8, 4]] as const).map(([l, w, h]) => (
                  <Choice key={l} on={tabs[selTable.id].w === w && tabs[selTable.id].h === h}
                    onClick={() => { const p = tabs[selTable.id]; setT(selTable.id, { w, h, x: clamp(p.x ?? 0, 0, GW - w), y: clamp(p.y ?? 0, 0, GH - h) }); }}>{l}</Choice>
                ))}
              </div>
              <Stepper label={t('Couverts')} value={tabs[selTable.id].seats} min={1} max={40}
                onChange={v => setT(selTable.id, { seats: v })} />
              <Btn className="w-full" onClick={() => { setT(selTable.id, { x: null, y: null }); setSel(null); }}><Trash2 className="h-4 w-4" /> {t('Retirer du plan')}</Btn>
            </Card>
          )}
          {selItem && sel?.kind === 'item' && (
            <Card title={kindOf(selItem.k).label()}>
              {(selItem.k === 'text' || selItem.k === 'bar' || selItem.k === 'kitchen') && (
                <input className={inputCls} maxLength={30} value={selItem.t ?? ''} placeholder={kindOf(selItem.k).label()}
                  onChange={e => setI(sel.i, { t: e.target.value })} />
              )}
              <div className="grid grid-cols-2 gap-2">
                <Btn onClick={() => setI(sel.i, { w: Math.min(selItem.h, GW - selItem.x), h: Math.min(selItem.w, GH - selItem.y) })}><RotateCw className="h-4 w-4" /> {t('Tourner')}</Btn>
                <Btn tone="danger" onClick={() => { setItems(s => ({ ...s, [zone]: (s[zone] ?? []).filter((_, j) => j !== sel.i) })); setSel(null); setDirty(true); }}><Trash2 className="h-4 w-4" /> {t('Supprimer')}</Btn>
              </div>
            </Card>
          )}

          {offPlan.length > 0 && (
            <Card title={t('Tables à placer')}>
              <div className="flex flex-wrap gap-2">
                {offPlan.map(tb => <button key={tb.id} onClick={() => place(tb.id)} className="panel rounded-xl px-3 py-2 text-sm font-bold hover:border-brand/50">{tb.label}</button>)}
              </div>
              <Btn className="w-full" onClick={placeAll}><Wand2 className="h-4 w-4" /> {t('Tout placer')}</Btn>
            </Card>
          )}

          <Card title={t('Ajouter')}>
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map(K => { const I = K.icon; return <Btn key={K.k} className="justify-start" onClick={() => addItem(K.k)}><I className="h-4 w-4" /> {K.label()}</Btn>; })}
            </div>
          </Card>
        </aside>
      </div>

      {saving && (
        <Modal title={t('Enregistrer le plan')} onClose={() => { setSaving(false); setError(null); }}>
          <p className="mb-4 text-center text-sm text-muted">{t('Un manager valide le nouveau plan.')}</p>
          <ManagerApproval onApprove={(m, p) => save(m, p)} busy={busy} error={error} />
        </Modal>
      )}
    </div>
  ), document.body);
}

function Handle(p: { onPointerDown: (e: RPointerEvent) => void; onPointerMove: (e: RPointerEvent) => void; onPointerUp: () => void }) {
  return <span {...p} className="absolute -bottom-1.5 -end-1.5 z-10 h-5 w-5 cursor-nwse-resize touch-none rounded-full border-2 border-bg bg-brand shadow" />;
}
function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel space-y-3 rounded-2xl p-4"><h3 className="text-sm font-bold">{title}</h3>{children}</section>;
}
function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-sm font-bold ${on ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`}>{children}</button>;
}
function Stepper({ label, value, min, max, onChange }: { label: string; value: number | null; min: number; max: number; onChange: (v: number | null) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold text-muted">{label}</span>
      <div className="flex items-center gap-1">
        <button className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2" onClick={() => onChange(value == null || value <= min ? null : value - 1)}><Minus className="h-4 w-4" /></button>
        <span className="w-8 text-center font-bold tabular">{value ?? '–'}</span>
        <button className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2" onClick={() => onChange(Math.min(max, (value ?? 0) + 1))}><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

/** for each table, its next booking of the coming 3 hours (kept until 15 min late) */
export function useTableBookings(list: Reservation[] | null) {
  return useMemo(() => {
    const m = new Map<string, Reservation>();
    const now = Date.now();
    for (const r of list ?? []) {
      if (r.kind !== 'booking' || !r.table_id || !r.starts_at || !['confirmed', 'requested'].includes(r.status)) continue;
      const at = Date.parse(r.starts_at);
      if (at < now - 15 * 60000 || at > now + 3 * 3600_000) continue;
      const prev = m.get(r.table_id);
      if (!prev || Date.parse(prev.starts_at!) > at) m.set(r.table_id, r);
    }
    return m;
  }, [list]);
}
