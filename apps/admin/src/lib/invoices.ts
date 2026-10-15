// Supplier invoices and delivery notes: a photo or PDF in the private "supplier-docs" bucket,
// plus one row in supplier_documents (supplier, date, amount, note). Photos are made smaller in the
// browser (text stays readable) so a phone on 4G uploads them in a few seconds.
import { supabase } from './supabase';
import { check } from './api';
import { t } from './i18n';

export const DOC_BUCKET = 'supplier-docs';
export const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;

export interface SupplierDoc {
  id: string; restaurant_id: string; supplier_id: string | null; supplier_name: string | null; purchase_order_id: string | null;
  doc_date: string; amount_cents: number | null; note: string | null; file_path: string; mime_type: string; size_bytes: number; created_at: string;
}
export interface DocMeta { supplier_id?: string | null; supplier_name?: string | null; purchase_order_id?: string | null; doc_date: string; amount_cents?: number | null; vat_cents?: number | null; doc_number?: string | null; note?: string | null }

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** A photo at most 2000 px on its long side, as JPEG on a white background; a PDF as it is. */
async function prepare(file: File): Promise<{ blob: Blob; mime: string; ext: string }> {
  if (isPdf(file)) {
    if (file.size > MAX_BYTES) throw new Error(t('Fichier trop lourd (10 Mo maximum) : {n}', { n: file.name }));
    return { blob: file, mime: 'application/pdf', ext: 'pdf' };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; })
      .catch(() => { throw new Error(t('Format non lu : {n}. Envoyez une photo (JPEG, PNG) ou un PDF.', { n: file.name })); });
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((r, j) => c.toBlob(b => (b ? r(b) : j(new Error('image'))), 'image/jpeg', 0.82));
    return { blob, mime: 'image/jpeg', ext: 'jpg' };
  } finally { URL.revokeObjectURL(url); }
}

/** Uploads one invoice file and records it. The file is removed again if the record fails. */
export async function addInvoice(restaurantId: string, file: File, meta: DocMeta): Promise<SupplierDoc> {
  const { blob, mime, ext } = await prepare(file);
  const path = `${restaurantId}/${meta.doc_date.slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from(DOC_BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw new Error(t('Envoi de la facture impossible : {m}', { m: up.error.message }));
  try {
    return check(await supabase.from('supplier_documents').insert({
      restaurant_id: restaurantId, supplier_id: meta.supplier_id ?? null, supplier_name: meta.supplier_name?.trim() || null,
      purchase_order_id: meta.purchase_order_id ?? null, doc_date: meta.doc_date, amount_cents: meta.amount_cents ?? null,
      note: meta.note?.trim() || null, file_path: path, mime_type: mime, size_bytes: blob.size,
      ...(meta.vat_cents != null ? { vat_cents: meta.vat_cents } : {}), ...(meta.doc_number ? { doc_number: meta.doc_number } : {}),
    }).select('*').single()) as SupplierDoc;
  } catch (e) {
    await supabase.storage.from(DOC_BUCKET).remove([path]);
    throw e;
  }
}

/** Several files of the same delivery: returns how many were saved and the first error, if any. */
export async function addInvoices(restaurantId: string, files: File[], meta: DocMeta): Promise<{ saved: number; error: unknown }> {
  let saved = 0, error: unknown = null;
  for (const f of files) {
    try { await addInvoice(restaurantId, f, meta); saved++; } catch (e) { error = error ?? e; }
  }
  return { saved, error };
}

/** Temporary links (1 hour) to view private files. */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  return Object.fromEntries((data ?? []).filter(x => x.signedUrl && x.path).map(x => [x.path as string, x.signedUrl as string]));
}

export async function removeInvoice(d: SupplierDoc) {
  check(await supabase.from('supplier_documents').delete().eq('id', d.id).select('id'));
  await supabase.storage.from(DOC_BUCKET).remove([d.file_path]);
}
