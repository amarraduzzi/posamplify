import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Plus, Printer, RefreshCw, Pencil, Trash2, X, Download } from 'lucide-react';
import { supabase, MENU_URL } from '../lib/supabase';
import { check, token } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Restaurant, Table } from '../lib/types';
import { Btn, Field, Modal, Toggle, inputCls } from '../components/ui';
import { t } from '../lib/i18n';
import { downloadOne, downloadZip, fileStems } from '../lib/qrFiles';

export const tableUrl = (r: Restaurant, t: Table) => `${MENU_URL}/${r.slug}/t/${t.qr_token}`;
/** The one QR for the whole restaurant: opens the menu on "Sur place"; the guest types the table number. */
export const sharedUrl = (r: Restaurant) => `${MENU_URL}/${r.slug}?surplace`;

export function TablesPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [tables, setTables] = useState<Table[]>([]);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<Table | null>(null);
  const [printing, setPrinting] = useState<Table[] | null>(null);
  const [printingShared, setPrintingShared] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const t = check(await supabase.from('dining_tables').select('*').eq('restaurant_id', r.id)) as Table[];
      setTables(t.sort((x, y) => (x.zone ?? '').localeCompare(y.zone ?? '') || x.sort_order - y.sort_order || x.label.localeCompare(y.label, 'fr', { numeric: true })));
    } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  // one file for one table, or a zip of all active tables
  const run = async (key: string, job: () => Promise<void>) => {
    setBusy(key);
    try { await job(); } catch (e) { a.fail(e); }
    setBusy(null);
  };
  const active = tables.filter(x => x.active);
  const stems = fileStems(r, tables);

  if (printing) return <QrSheet r={r} tables={printing} onClose={() => setPrinting(null)} />;
  if (printingShared) return <SharedQrSheet r={r} onClose={() => setPrintingShared(false)} />;
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="me-auto font-display text-3xl font-semibold">{t('Tables & QR codes')}</h1>
        <Btn onClick={() => run('zip', () => downloadZip(r, active, tableUrl))} disabled={!active.length || busy !== null}><Download className="h-4 w-4" /> {busy === 'zip' ? t('Préparation du fichier…') : t('Tout télécharger (zip)')}</Btn>
        <Btn onClick={() => setPrinting(tables.filter(x => x.active))} disabled={!tables.length}><Printer className="h-4 w-4" /> {t('Imprimer tous les QR codes')}</Btn>
        <Btn tone="brand" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> {t('Ajouter des tables')}</Btn>
      </div>
      <p className="mb-4 text-sm text-muted">{t('Chaque table a son propre QR code. Le client qui le scanne commande directement pour cette table. Collez les QR codes sur les tables (idéalement plastifiés).')} {t('Téléchargez chaque QR code en PNG ou SVG pour l’intégrer dans vos propres supports (cartes, chevalets, autocollants).')}</p>
      <SharedQrPanel r={r} hasTables={active.length > 0} busy={busy} run={run} onPrint={() => setPrintingShared(true)} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
        {tables.map(tb => (
          <div key={tb.id} className={`card rounded-3xl p-3 ${tb.active ? '' : 'opacity-50'}`}>
            <div className="flex items-start justify-between">
              <div><p className="text-xl font-black">{tb.label}</p>{tb.zone && <p className="text-xs text-muted">{tb.zone}</p>}</div>
              <button onClick={() => setEdit(tb)} aria-label={t('Modifier la table {n}', { n: tb.label })} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-2"><Pencil className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 space-y-1.5">
              <Btn className="w-full !px-2 !py-1.5" onClick={() => setPrinting([tb])}><Printer className="h-4 w-4" /> {t('Imprimer')}</Btn>
              <div className="grid grid-cols-2 gap-1.5">
                {(['png', 'svg'] as const).map(kind => (
                  <Btn key={kind} tone="ghost" className="min-w-0 !gap-1.5 !px-2 !py-1.5" disabled={busy !== null}
                    aria-label={t('Télécharger le QR code de la table {n} en {f}', { n: tb.label, f: kind.toUpperCase() })}
                    onClick={() => run(`${tb.id}-${kind}`, () => downloadOne(tableUrl(r, tb), stems[tables.indexOf(tb)], kind))}>
                    <Download className="h-4 w-4 shrink-0" /> {kind.toUpperCase()}
                  </Btn>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      {!tables.length && <p className="text-muted">{t('Aucune table.')}</p>}
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
    .filter(l => !existing.some(x => x.label === l));
  const save = async () => {
    setBusy(true);
    try {
      check(await supabase.from('dining_tables').insert(labels.map(l => ({ restaurant_id: r.id, label: l, zone: zone.trim() || null, sort_order: Number(l) }))).select('id'));
      a.toast(t('{n} table(s) ajoutée(s)', { n: labels.length })); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={t('Ajouter des tables')} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={!labels.length || busy} onClick={save}>{t('Ajouter {n} table(s)', { n: labels.length })}</Btn></div>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('De la table n°')}><input className={inputCls} inputMode="numeric" value={from} onChange={e => setFrom(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label={t('À la table n°')}><input className={inputCls} inputMode="numeric" value={to} onChange={e => setTo(e.target.value.replace(/\D/g, ''))} /></Field>
        </div>
        <Field label={t('Zone (facultatif)')} hint={t('Par exemple Terrasse, Salle, Étage.')}><input className={inputCls} value={zone} onChange={e => setZone(e.target.value)} /></Field>
        <p className="text-sm text-muted">{t('Les numéros déjà existants sont ignorés. Pour une table avec un nom (ex. « Bar 1 »), créez-la puis renommez-la.')}</p>
      </div>
    </Modal>
  );
}

function TableEditor({ t: tb, onClose, onSaved }: { t: Table; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [label, setLabel] = useState(tb.label);
  const [zone, setZone] = useState(tb.zone ?? '');
  const [active, setActive] = useState(tb.active);
  const save = async (extra: Record<string, unknown> = {}) => {
    try { check(await supabase.from('dining_tables').update({ label: label.trim(), zone: zone.trim() || null, active, ...extra }).eq('id', tb.id).select('id')); a.toast(t('Enregistré')); onSaved(); } catch (e) { a.fail(e); }
  };
  const remove = async () => { try { check(await supabase.from('dining_tables').delete().eq('id', tb.id).select('id')); a.toast(t('Table supprimée')); onSaved(); } catch (e) { a.fail(e); } };
  return (
    <Modal title={t('Table {n}', { n: tb.label })} onClose={onClose} footer={<div className="flex justify-between"><Btn tone="danger" onClick={remove}><Trash2 className="h-4 w-4" /> {t('Supprimer')}</Btn><Btn tone="brand" disabled={!label.trim()} onClick={() => save()}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <Field label={t('Nom / numéro')}><input className={inputCls} maxLength={20} value={label} onChange={e => setLabel(e.target.value)} /></Field>
        <Field label={t('Zone')}><input className={inputCls} value={zone} onChange={e => setZone(e.target.value)} /></Field>
        <Toggle checked={active} onChange={setActive} label={t('Active (commandes possibles)')} />
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <p className="mb-2">{t("Nouveau QR code : l'ancien code collé sur la table ne fonctionnera plus. À utiliser si un QR code a été copié ou abîmé.")}</p>
          <Btn onClick={() => save({ qr_token: token(10) })}><RefreshCw className="h-4 w-4" /> {t('Générer un nouveau QR code')}</Btn>
        </div>
      </div>
    </Modal>
  );
}

/** Printable sheet: 6 QR cards per A4 page. */
function QrSheet({ r, tables, onClose }: { r: Restaurant; tables: Table[]; onClose: () => void }) {
  const [codes, setCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    Promise.all(tables.map(async x => [x.id, await QRCode.toString(tableUrl(r, x), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })] as const))
      .then(x => setCodes(Object.fromEntries(x)));
  }, [r, tables]);
  return (
    <div>
      <div className="no-print mb-4 flex items-center gap-2">
        <Btn onClick={onClose}><X className="h-4 w-4" /> {t('Fermer')}</Btn>
        <Btn tone="brand" onClick={() => window.print()} disabled={Object.keys(codes).length < tables.length}><Printer className="h-4 w-4" /> {t('Imprimer')}</Btn>
        <span className="text-sm text-muted">{t('{n} QR code(s), 6 par page A4.', { n: tables.length })}</span>
      </div>
      <div dir="ltr" className="grid grid-cols-2 gap-4 print:gap-3 md:grid-cols-3">
        {/* printed cards: trilingual on purpose, identical whatever the back office language */}
        {tables.map(tb => (
          <div key={tb.id} className="flex break-inside-avoid flex-col items-center rounded-2xl border-2 border-ink/80 bg-white p-4 text-center text-black">
            {r.branding.logo_url ? <img src={r.branding.logo_url} alt="" className="mb-1 h-10 object-contain" /> : null}
            <p className="text-lg font-black">{r.name}</p>
            <div className="my-2 w-40" dangerouslySetInnerHTML={{ __html: codes[tb.id] ?? '' }} />
            <p className="text-2xl font-black">Table {tb.label}</p>
            <p className="mt-1 text-xs leading-tight">Scannez pour voir le menu et commander</p>
            <p className="text-xs leading-tight">Scan to order</p>
            <p className="text-xs leading-tight" dir="rtl">امسح الرمز للطلب</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Choice between a QR per table and one QR for the whole restaurant (the guest types the table number). */
function SharedQrPanel({ r, hasTables, busy, run, onPrint }: {
  r: Restaurant; hasTables: boolean; busy: string | null;
  run: (key: string, job: () => Promise<void>) => Promise<void>; onPrint: () => void;
}) {
  const a = useAdminCtx();
  const on = !!r.qr_shared;
  const [saving, setSaving] = useState(false);
  const [svg, setSvg] = useState('');
  useEffect(() => { if (on) QRCode.toString(sharedUrl(r), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setSvg); }, [on, r]);
  const toggle = async (v: boolean) => {
    setSaving(true);
    try { check(await supabase.from('restaurants').update({ qr_shared: v }).eq('id', r.id).select('id')); await a.reload(); a.toast(t('Enregistré')); } catch (e) { a.fail(e); }
    setSaving(false);
  };
  return (
    <div className="card mb-5 rounded-3xl p-4">
      <Toggle checked={on} onChange={toggle} disabled={saving} label={t('Un seul QR code pour tout le restaurant')} />
      <p className="mt-2 text-sm text-muted">{t('Le client scanne, choisit « Sur place » et tape son numéro de table. Un seul modèle à imprimer pour toutes les tables. Les QR codes par table continuent de fonctionner.')}</p>
      {on && (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="w-32 shrink-0 rounded-xl bg-white p-1" dir="ltr" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="font-semibold">{t('QR code unique du restaurant')}</p>
            <div className="flex flex-wrap gap-1.5">
              <Btn className="!px-3 !py-1.5" onClick={onPrint}><Printer className="h-4 w-4" /> {t('Imprimer')}</Btn>
              {(['png', 'svg'] as const).map(kind => (
                <Btn key={kind} tone="ghost" className="!gap-1.5 !px-3 !py-1.5" disabled={busy !== null}
                  aria-label={t('Télécharger le QR code unique en {f}', { f: kind.toUpperCase() })}
                  onClick={() => run(`shared-${kind}`, () => downloadOne(sharedUrl(r), `${r.slug}-qr-restaurant`, kind))}>
                  <Download className="h-4 w-4 shrink-0" /> {kind.toUpperCase()}
                </Btn>
              ))}
            </div>
            {!hasTables && <p className="text-sm text-danger">{t('Ajoutez d’abord vos tables : les numéros tapés par les clients doivent correspondre aux tables ci-dessous.')}</p>}
            {hasTables && <p className="text-xs text-muted">{t('Les numéros tapés par les clients doivent correspondre aux tables ci-dessous.')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Printed card for the one shared QR: trilingual on purpose, identical whatever the back office language. */
function SharedQrSheet({ r, onClose }: { r: Restaurant; onClose: () => void }) {
  const [code, setCode] = useState('');
  useEffect(() => { QRCode.toString(sharedUrl(r), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setCode); }, [r]);
  return (
    <div>
      <div className="no-print mb-4 flex items-center gap-2">
        <Btn onClick={onClose}><X className="h-4 w-4" /> {t('Fermer')}</Btn>
        <Btn tone="brand" onClick={() => window.print()} disabled={!code}><Printer className="h-4 w-4" /> {t('Imprimer')}</Btn>
      </div>
      <div dir="ltr" className="mx-auto flex max-w-xs break-inside-avoid flex-col items-center rounded-2xl border-2 border-ink/80 bg-white p-5 text-center text-black">
        {r.branding.logo_url ? <img src={r.branding.logo_url} alt="" className="mb-1 h-10 object-contain" /> : null}
        <p className="text-lg font-black">{r.name}</p>
        <div className="my-2 w-48" dangerouslySetInnerHTML={{ __html: code }} />
        <p className="mt-1 text-sm font-bold leading-tight">Scannez, choisissez « Sur place » et entrez votre numéro de table</p>
        <p className="mt-1 text-xs leading-tight">Scan, choose “Dine in” and enter your table number</p>
        <p className="mt-1 text-xs leading-tight" dir="rtl">امسحوا الرمز، اختاروا «في المطعم» واكتبوا رقم طاولتكم</p>
      </div>
    </div>
  );
}
