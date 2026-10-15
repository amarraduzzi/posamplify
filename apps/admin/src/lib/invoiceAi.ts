// Reading a supplier invoice with the AI (function "invoice-extract"): header, totals, VAT and lines
// matched to the restaurant's ingredients. Nothing is saved: the screens prefill, the owner checks.
import { supabase } from './supabase';
import { fileForAi } from './image';
import { t } from './i18n';
import type { BaseUnit, Ingredient } from './types';

export interface InvoiceLine { label: string; qty: number | null; unit: 'kg' | 'g' | 'l' | 'cl' | 'ml' | 'pc' | null; total_ttc: number | null; vat_rate: number | null; ingredient_id: string | null }
export interface InvoiceRead { supplier: string | null; ice: string | null; number: string | null; date: string | null; total_ht: number | null; total_vat: number | null; total_ttc: number | null; lines: InvoiceLine[] }

/** The quantity of a line in the ingredient's base unit (g, ml or pieces); null if the units don't fit. */
export function toBase(qty: number | null, unit: InvoiceLine['unit'], base: BaseUnit): number | null {
  if (qty == null || !unit) return null;
  const f: Record<string, Partial<Record<BaseUnit, number>>> = { kg: { g: 1000 }, g: { g: 1 }, l: { ml: 1000 }, cl: { ml: 10 }, ml: { ml: 1 }, pc: { pc: 1 } };
  const k = f[unit]?.[base];
  return k ? qty * k : null;
}

export async function readInvoice(restaurantId: string, files: File[], ings: Pick<Ingredient, 'id' | 'name' | 'base_unit'>[]): Promise<InvoiceRead> {
  const prepared = await Promise.all(files.slice(0, 5).map(f => fileForAi(f)));
  if (prepared.reduce((s, p) => s + p.bytes, 0) > 11 * 1024 * 1024) throw new Error(t('Fichiers trop lourds (max. 11 Mo en tout). Envoyez moins de pages ou des photos plus légères.'));
  const { data, error } = await supabase.functions.invoke('invoice-extract', { body: {
    restaurant_id: restaurantId, files: prepared.map(({ mime, data }) => ({ mime, data })),
    ingredients: ings.slice(0, 500).map(g => ({ id: g.id, name: g.name, unit: g.base_unit })),
  } });
  if (error || !data || data.error) {
    const ctx = (error as { context?: Response } | null)?.context;
    const body = data?.error ? data : ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    const code = body?.error ?? '';
    if (code === 'ai_not_configured' || ctx?.status === 404) throw new Error(t("La lecture des factures par l'IA n'est pas encore activée."));
    if (code === 'ai_busy') throw new Error(t("L'IA est très demandée en ce moment. Réessayez dans une minute."));
    if (code === 'too_large' || code === 'too_many_files') throw new Error(t('Fichiers trop lourds (max. 11 Mo en tout). Envoyez moins de pages ou des photos plus légères.'));
    throw new Error(t("L'IA n'a pas pu lire cette facture. Essayez une photo plus nette, bien éclairée et prise de face."));
  }
  return data as InvoiceRead;
}
