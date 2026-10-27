// Barcodes at the till (an option of the shop, off by default): a normal product code, or the label of a scale.
// Most scales print an EAN-13: prefix + product number (PLU) + weight or price + check digit, for example
//     2 123456 00450 7   → product 123456, 450 g
// The format of the shop's scale is stored on the restaurant (restaurants.scale_*, see supabase/migrations/20261211000100_barcodes.sql).

export type ScaleValue = 'weight_g' | 'weight_10g' | 'price_cents';
export interface ScaleFormat { prefix: string; codeLen: number; valueLen: number; value: ScaleValue }
export const DEFAULT_SCALE: ScaleFormat = { prefix: '2', codeLen: 6, valueLen: 5, value: 'weight_g' };

/** The shop's scale format from the restaurant row (anything missing or wrong falls back to the default). */
export function scaleFormatOf(r: { scale_prefix?: string | null; scale_code_len?: number | null; scale_value_len?: number | null; scale_value?: string | null }): ScaleFormat {
  const f: ScaleFormat = {
    prefix: r.scale_prefix ?? DEFAULT_SCALE.prefix,
    codeLen: Number(r.scale_code_len ?? DEFAULT_SCALE.codeLen),
    valueLen: Number(r.scale_value_len ?? DEFAULT_SCALE.valueLen),
    value: (r.scale_value as ScaleValue) ?? DEFAULT_SCALE.value,
  };
  return scaleFormatOk(f) ? f : DEFAULT_SCALE;
}
/** prefix (digits) + code + value + 1 check digit = 13 digits. */
export const scaleFormatOk = (f: ScaleFormat) =>
  /^[0-9]{1,3}$/.test(f.prefix) && f.codeLen >= 3 && f.codeLen <= 8 && f.valueLen >= 3 && f.valueLen <= 6
  && f.prefix.length + f.codeLen + f.valueLen === 12 && ['weight_g', 'weight_10g', 'price_cents'].includes(f.value);

/** EAN-13 check digit. */
export function ean13Valid(code: string): boolean {
  if (!/^[0-9]{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

export interface Scannable { id: string; barcode?: string | null; sold_by_weight?: boolean; price_cents: number }
export type ScanResult<T extends Scannable> =
  | { kind: 'item'; item: T; weight_g: number | null }   // weight_g null for a weighed item scanned without weight: the till asks it
  | { kind: 'bad'; code: string }                         // a scale label with a wrong check digit or an impossible weight (misread)
  | { kind: 'unknown'; code: string };

const noZeros = (s: string) => s.replace(/^0+/, '');

/** What a scanned code means: a product, a weighed product with its weight, or nothing known. */
export function resolveScan<T extends Scannable>(raw: string, items: T[], f: ScaleFormat): ScanResult<T> {
  const code = raw.replace(/\s+/g, '');
  if (!code) return { kind: 'unknown', code };
  const exact = items.find(i => i.barcode && i.barcode === code);
  if (exact) return { kind: 'item', item: exact, weight_g: null };
  if (/^[0-9]{13}$/.test(code) && code.startsWith(f.prefix)) {
    if (!ean13Valid(code)) return { kind: 'bad', code };
    const plu = noZeros(code.slice(f.prefix.length, f.prefix.length + f.codeLen));
    const n = Number(code.slice(f.prefix.length + f.codeLen, f.prefix.length + f.codeLen + f.valueLen));
    const item = plu ? items.find(i => i.sold_by_weight && i.barcode && noZeros(i.barcode) === plu) : undefined;
    if (!item) return { kind: 'unknown', code };
    // the weight, in grams; a label with the price: weight = price / (price per kg)
    const g = f.value === 'weight_g' ? n : f.value === 'weight_10g' ? n * 10 : item.price_cents > 0 ? Math.round(n * 1000 / item.price_cents) : 0;
    if (!(g >= 1 && g <= 100000)) return { kind: 'bad', code };
    return { kind: 'item', item, weight_g: g };
  }
  return { kind: 'unknown', code };
}
