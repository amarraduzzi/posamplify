import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Plus, Printer, RefreshCw, Pencil, Trash2, X } from 'lucide-react';
import { supabase, MENU_URL } from '../lib/supabase';
import { check, token } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Restaurant, Table } from '../lib/types';
import { Btn, Field, Modal, Toggle, inputCls } from '../components/ui';

export const tableUrl = (r: Restaurant, t: Table) => `${MENU_URL}/${r.slug}/t/${t.qr_token}`;

export function TablesPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [tables, setTables] = useState<Table[]>([]);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<Table | null>(null);
  const [printing, setPrinting] = useState<Table[] | null>(null);
  const load = useCallback(async () => {
    try {
      const t = check(await supabase.from('dining_tables').select('*').eq('restaurant_id', r.id)) as Table[];
      setTables(t.sort((x, y) => (x.zone ?? '').localeCompare(y.zone ?? '') || x.sort_order - y.sort_order || x.label.localeCompare(y.label, 'fr', { numeric: true })));
    } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  if (printing) return <QrSheet r={r} tables={printing} onClose={() => setPrinting(null)} />;
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Tables & QR codes</h1>
        <Btn onClick={() => setPrinting(tables.filter(t => t.active))} disabled={!tables.length}><Printer className="h-4 w-4" /> Imprimer tous les QR codes</Btn>
        <Btn tone="brand" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Ajouter des tables</Btn>
      </div>
      <p className="mb-4 text-sm text-muted">Chaque table a son propre QR code. Le client qui le scanne commande directement pour cette table. Collez les QR codes sur les tables (idéalement plastifiés).</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {tables.map(t => (
          <div key={t.id} className={`rounded-2xl border border-line/10 bg-surface p-3 ${t.active ? '' : 'opacity-50'}`}>
            <div className="flex items-start justify-between">
              <div><p className="text-xl font-black">{t.label}</p>{t.zone && <p className="text-xs text-muted">{t.zone}</p>}</div>
              <button onClick={() => setEdit(t)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-2"><Pencil className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 flex gap-1">
              <Btn className="flex-1 px-2 py-1.5" onClick={() => setPrinting([t])}><Printer className="h-4 w-4" /> QR</Btn>
            </div>
          </div>
        ))}
      </div>
      {!tables.length && <p className="text-muted">Aucune table.</p>}
      {adding && <AddTables r={r} existing={tables} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {edit && <TableEditor t={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function AddTables({ r, existing, onClose, onSaved }: { r: Restaurant; existing: Table[]; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const nums = existing.map(t => Number(t.label)).filter(Number.isFinite);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  const [from, setFrom] = useState(String(next));
  const [to, setTo] = useState(String(next + 9));
  const [zone, setZone] = useState('');
  const [busy, setBusy] = useState(false);
  const labels = Array.from({ length: Math.max(0, Math.min(200, Number(to) - Number(from) + 1)) }, (_, i) => String(Number(from) + i))
    .filter(l => !existing.some(t => t.label === l));
  const save = async () => {
    setBusy(true);
    try {
      check(await supabase.from('dining_tables').insert(labels.map(l => ({ restaurant_id: r.id, label: l, zone: zone.trim() || null, sort_order: Number(l) }))).select('id'));
      a.toast(`${labels.length} table(s) ajoutée(s)`); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title="Ajouter des tables" onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={!labels.length || busy} onClick={save}>Ajouter {labels.length} table(s)</Btn></div>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="De la table n°"><input className={inputCls} inputMode="numeric" value={from} onChange={e => setFrom(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="À la table n°"><input className={inputCls} inputMode="numeric" value={to} onChange={e => setTo(e.target.value.replace(/\D/g, ''))} /></Field>
        </div>
        <Field label="Zone (facultatif)" hint="Par exemple Terrasse, Salle, Étage."><input className={inputCls} value={zone} onChange={e => setZone(e.target.value)} /></Field>
        <p className="text-sm text-muted">Les numéros déjà existants sont ignorés. Pour une table avec un nom (ex. « Bar 1 »), créez-la puis renommez-la.</p>
      </div>
    </Modal>
  );
}

function TableEditor({ t, onClose, onSaved }: { t: Table; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [label, setLabel] = useState(t.label);
  const [zone, setZone] = useState(t.zone ?? '');
  const [active, setActive] = useState(t.active);
  const save = async (extra: Record<string, unknown> = {}) => {
    try { check(await supabase.from('dining_tables').update({ label: label.trim(), zone: zone.trim() || null, active, ...extra }).eq('id', t.id).select('id')); a.toast('Enregistré'); onSaved(); } catch (e) { a.fail(e); }
  };
  const remove = async () => { try { check(await supabase.from('dining_tables').delete().eq('id', t.id).select('id')); a.toast('Table supprimée'); onSaved(); } catch (e) { a.fail(e); } };
  return (
    <Modal title={`Table ${t.label}`} onClose={onClose} footer={<div className="flex justify-between"><Btn tone="danger" onClick={remove}><Trash2 className="h-4 w-4" /> Supprimer</Btn><Btn tone="brand" disabled={!label.trim()} onClick={() => save()}>Enregistrer</Btn></div>}>
      <div className="space-y-4">
        <Field label="Nom / numéro"><input className={inputCls} maxLength={20} value={label} onChange={e => setLabel(e.target.value)} /></Field>
        <Field label="Zone"><input className={inputCls} value={zone} onChange={e => setZone(e.target.value)} /></Field>
        <Toggle checked={active} onChange={setActive} label="Active (commandes possibles)" />
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <p className="mb-2">Nouveau QR code : l'ancien code collé sur la table ne fonctionnera plus. À utiliser si un QR code a été copié ou abîmé.</p>
          <Btn onClick={() => save({ qr_token: token(10) })}><RefreshCw className="h-4 w-4" /> Générer un nouveau QR code</Btn>
        </div>
      </div>
    </Modal>
  );
}

/** Printable sheet: 6 QR cards per A4 page. */
function QrSheet({ r, tables, onClose }: { r: Restaurant; tables: Table[]; onClose: () => void }) {
  const [codes, setCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    Promise.all(tables.map(async t => [t.id, await QRCode.toString(tableUrl(r, t), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })] as const))
      .then(x => setCodes(Object.fromEntries(x)));
  }, [r, tables]);
  return (
    <div>
      <div className="no-print mb-4 flex items-center gap-2">
        <Btn onClick={onClose}><X className="h-4 w-4" /> Fermer</Btn>
        <Btn tone="brand" onClick={() => window.print()} disabled={Object.keys(codes).length < tables.length}><Printer className="h-4 w-4" /> Imprimer</Btn>
        <span className="text-sm text-muted">{tables.length} QR code(s), 6 par page A4.</span>
      </div>
      <div className="grid grid-cols-2 gap-4 print:gap-3 md:grid-cols-3">
        {tables.map(t => (
          <div key={t.id} className="flex break-inside-avoid flex-col items-center rounded-2xl border-2 border-ink/80 bg-white p-4 text-center text-black">
            {r.branding.logo_url ? <img src={r.branding.logo_url} alt="" className="mb-1 h-10 object-contain" /> : null}
            <p className="text-lg font-black">{r.name}</p>
            <div className="my-2 w-40" dangerouslySetInnerHTML={{ __html: codes[t.id] ?? '' }} />
            <p className="text-2xl font-black">Table {t.label}</p>
            <p className="mt-1 text-xs leading-tight">Scannez pour voir le menu et commander</p>
            <p className="text-xs leading-tight">Scan to order</p>
            <p className="text-xs leading-tight" dir="rtl">امسح الرمز للطلب</p>
          </div>
        ))}
      </div>
    </div>
  );
}
