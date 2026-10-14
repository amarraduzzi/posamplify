// Supplier invoices on screen: pick photos/PDFs with a delivery, a gallery per supplier (or all),
// a large view, and adding one on its own.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, FileText, Plus, Trash2, X, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, inputCls } from './ui';
import { MAX_FILES, addInvoices, isPdf, removeInvoice, signedUrls, type SupplierDoc } from '../lib/invoices';

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });

/** "Photo de la facture": files chosen with a delivery, sent once the delivery is saved. */
export function InvoicePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const previews = useMemo(() => files.map(f => (isPdf(f) ? null : URL.createObjectURL(f))), [files]);
  useEffect(() => () => previews.forEach(u => u && URL.revokeObjectURL(u)), [previews]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {files.map((f, i) => (
        <span key={i} className="relative inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line/15" title={f.name}>
          {previews[i] ? <img src={previews[i]!} alt="" className="h-full w-full object-cover" /> : <FileText className="h-7 w-7 text-muted" />}
          <button type="button" aria-label={t('Retirer {n}', { n: f.name })} onClick={() => onChange(files.filter((_, j) => j !== i))}
            className="absolute end-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-ink/70 text-white"><X className="h-3 w-3" /></button>
        </span>
      ))}
      {files.length < MAX_FILES && (
        <label className="inline-flex h-16 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line/30 px-4 text-sm font-semibold text-muted hover:border-brand hover:text-brand">
          <Camera className="h-5 w-5" />{files.length ? t('Ajouter une page') : t('Photo de la facture (facultatif)')}
          <input type="file" accept="image/*,application/pdf" multiple className="sr-only"
            onChange={e => { onChange([...files, ...Array.from(e.target.files ?? [])].slice(0, MAX_FILES)); e.target.value = ''; }} />
        </label>
      )}
    </div>
  );
}

/** The invoices of one supplier (or of all suppliers), newest first, with a large view. */
export function InvoiceGallery({ r, supplierId, supplierName, limit = 24, compact }: { r: Restaurant; supplierId?: string; supplierName?: string; limit?: number; compact?: boolean }) {
  const a = useAdminCtx();
  const [docs, setDocs] = useState<SupplierDoc[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [sups, setSups] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState<SupplierDoc | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    try {
      let q = supabase.from('supplier_documents').select('*').eq('restaurant_id', r.id).order('doc_date', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
      if (supplierId) q = q.eq('supplier_id', supplierId);
      const [d, s] = await Promise.all([q, supabase.from('suppliers').select('id, name').eq('restaurant_id', r.id).order('name')]);
      const list = check(d) as SupplierDoc[];
      setSups(check(s) as { id: string; name: string }[]);
      setDocs(list);
      setUrls(await signedUrls(list.map(x => x.file_path)).catch(() => ({})));
    } catch (e) { a.fail(e); setDocs([]); }
  }, [r.id, supplierId, limit, a]);
  useEffect(() => { load(); }, [load]);
  const supName = (d: SupplierDoc) => sups.find(s => s.id === d.supplier_id)?.name ?? d.supplier_name ?? t('Sans fournisseur');

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        {!compact && <p className="me-auto text-sm text-muted">{docs?.length ? t('{n} document(s), les plus récents d’abord.', { n: docs.length }) : ''}</p>}
        {compact && <p className="me-auto font-semibold">{t('Factures')}{docs?.length ? ` (${docs.length})` : ''}</p>}
        <Btn className="px-3 py-1.5 text-sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> {t('Ajouter une facture')}</Btn>
      </div>
      {docs === null ? <p className="text-muted">{t('Chargement…')}</p> : !docs.length ? (
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{t('Aucune facture pour l’instant. Prenez la facture ou le bon de livraison en photo à chaque livraison : vous la retrouvez ici, pour vous et votre comptable.')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {docs.map(d => (
            <li key={d.id}>
              <button type="button" onClick={() => setOpen(d)} className="group block w-full overflow-hidden rounded-2xl bg-surface-2 text-start ring-1 ring-line/10 hover:ring-brand">
                <span className="grid aspect-[4/3] place-items-center overflow-hidden bg-white">
                  {d.mime_type === 'application/pdf' || !urls[d.file_path]
                    ? <span className="flex flex-col items-center gap-1 text-muted"><FileText className="h-8 w-8" />{d.mime_type === 'application/pdf' ? 'PDF' : ''}</span>
                    : <img src={urls[d.file_path]} alt="" loading="lazy" className="h-full w-full object-cover object-top transition group-hover:scale-[1.03]" />}
                </span>
                <span className="block px-3 py-2 text-sm">
                  {!supplierId && <span className="block truncate font-semibold">{supName(d)}</span>}
                  <span className="flex justify-between gap-2 text-muted"><span>{day(d.doc_date)}</span>{d.amount_cents != null && <span className="font-semibold text-ink tabular">{mad(Number(d.amount_cents))}</span>}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <InvoiceViewer d={open} url={urls[open.file_path]} supplier={supName(open)} onClose={() => setOpen(null)} onDeleted={() => { setOpen(null); load(); }} />}
      {adding && <AddInvoiceModal r={r} sups={sups} supplierId={supplierId} supplierName={supplierName} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function InvoiceViewer({ d, url, supplier, onClose, onDeleted }: { d: SupplierDoc; url?: string; supplier: string; onClose: () => void; onDeleted: () => void }) {
  const a = useAdminCtx();
  const [confirm, setConfirm] = useState(false);
  const del = async () => { try { await removeInvoice(d); a.toast(t('Facture supprimée')); onDeleted(); } catch (e) { a.fail(e); } };
  const pdf = d.mime_type === 'application/pdf';
  return (
    <Modal wide title={`${supplier} · ${day(d.doc_date)}`} onClose={onClose}
      footer={<div className="flex flex-wrap items-center justify-between gap-2">
        {confirm
          ? <span className="flex items-center gap-2 text-sm">{t('Supprimer cette facture ?')}<Btn tone="danger" className="py-1.5" onClick={del}>{t('Supprimer')}</Btn><Btn className="py-1.5" onClick={() => setConfirm(false)}>{t('Annuler')}</Btn></span>
          : <Btn tone="danger" className="py-1.5" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" /> {t('Supprimer')}</Btn>}
        {url && <a href={url} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold"><ExternalLink className="h-4 w-4" /> {pdf ? t('Ouvrir le PDF') : t('Ouvrir en grand')}</a>}
      </div>}>
      <div className="space-y-3">
        <p className="flex flex-wrap gap-x-4 text-sm text-muted">
          {d.amount_cents != null && <span>{t('Montant')} <b className="text-ink tabular">{mad(Number(d.amount_cents))}</b></span>}
          {d.note && <span>{d.note}</span>}
        </p>
        {!url ? <p className="text-muted">{t('Chargement…')}</p>
          : pdf ? <iframe src={url} title={supplier} className="h-[70vh] w-full rounded-xl bg-white" />
          : <img src={url} alt={supplier} className="mx-auto max-h-[70vh] rounded-xl bg-white object-contain" />}
      </div>
    </Modal>
  );
}

/** One invoice on its own (not with a delivery): supplier, date, amount, note, photos. */
export function AddInvoiceModal({ r, sups, supplierId, supplierName, onClose, onSaved }: { r: Restaurant; sups: { id: string; name: string }[]; supplierId?: string; supplierName?: string; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [files, setFiles] = useState<File[]>([]);
  const [sup, setSup] = useState(supplierId ?? '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const res = await addInvoices(r.id, files, { supplier_id: sup || null, doc_date: date, amount_cents: amount.trim() ? toCents(amount) : null, note });
    if (res.error) a.fail(res.error);
    if (res.saved) { a.toast(t('Facture enregistrée')); onSaved(); }
    setBusy(false);
  };
  return (
    <Modal title={t('Ajouter une facture')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !files.length || !date} onClick={save}>{busy ? t('Envoi…') : t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <InvoicePicker files={files} onChange={setFiles} />
        <div className="grid gap-3 sm:grid-cols-2">
          {supplierId ? <Field label={t('Fournisseur')}><input className={inputCls} value={supplierName ?? ''} disabled /></Field> : (
            <Field label={t('Fournisseur')}>
              <select className={inputCls} value={sup} onChange={e => setSup(e.target.value)}>
                <option value="">{t('Sans fournisseur')}</option>
                {sups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <Field label={t('Date de la facture')}><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label={t('Montant (DH, facultatif)')}><input className={inputCls} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
          <Field label={t('Note (facultatif)')}><input className={inputCls} maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder={t('N° de facture, avoir…')} /></Field>
        </div>
        <p className="text-xs text-muted">{t('Une photo par page (5 maximum), ou un PDF. Seuls le propriétaire et les managers les voient.')} {t('C’est un justificatif : pour le stock et ce que vous devez, notez l’achat ou réceptionnez la commande.')}</p>
      </div>
    </Modal>
  );
}
