// Sales of the Commandes page as a spreadsheet: one row per article of every finished order.
import { supabase } from './supabase';
import { check } from './api';
import { dateLocale, t } from './i18n';
import { xlsxBlob, type Cell } from './xlsx';

export interface SaleLine { id: string; name: string; quantity: number; unit_price_cents: number; vat_bp: number; created_at: string }
export interface SaleOrder {
  id: string; ticket_number: number; business_date: string; order_type: 'dine_in' | 'takeaway' | 'delivery'; table_id: string | null;
  customer_name: string | null; customer_phone: string | null; discount_cents: number; total_cents: number; created_at: string; order_lines: SaleLine[];
}

/** Finished guest orders (served, handed over or delivered) of a period of business days, e.g. 2026-10-01 .. 2026-10-31. */
export async function fetchSales(restaurantId: string, from: string, to: string): Promise<SaleOrder[]> {
  const out: SaleOrder[] = [];
  for (let start = 0; ; start += 300) {
    const rows = check(await supabase.from('orders')
      .select('id, ticket_number, business_date, order_type, table_id, customer_name, customer_phone, discount_cents, total_cents, created_at, order_lines(id, name, quantity, unit_price_cents, vat_bp, created_at)')
      .eq('restaurant_id', restaurantId).eq('source', 'qr').eq('status', 'served').gte('business_date', from).lte('business_date', to)
      .order('business_date').order('ticket_number').range(start, start + 299)) as unknown as SaleOrder[];
    out.push(...rows);
    if (rows.length < 300) return out;
  }
}

const TYPE: Record<SaleOrder['order_type'], string> = { dine_in: 'Sur place', takeaway: 'À emporter', delivery: 'Livraison' };
const eur = (c: number) => Math.round(c) / 100;

export function salesRows(orders: SaleOrder[], tableLabel: (id: string | null) => string | null, tz: string): Cell[][] {
  const head: Cell[] = [t('Date'), t('Heure'), t('N° de commande'), t('Type'), t('Table'), t('Article'), t('Quantité'), t('Prix unitaire TTC'), t('TVA %'),
    t('Total TTC'), t('Total HT'), t('TVA'), t('Remise de la commande'), t('Total de la commande TTC'), t('Client'), t('Téléphone')];
  const rows: Cell[][] = [head];
  for (const o of orders) {
    const time = new Date(o.created_at).toLocaleTimeString(dateLocale(), { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    [...o.order_lines].sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach((l, i) => {
      const ttc = l.unit_price_cents * l.quantity;
      const ht = Math.round(ttc / (1 + l.vat_bp / 10000));
      // order-level amounts sit on the first line only, so a column total never counts them twice
      rows.push([o.business_date, time, o.ticket_number, t(TYPE[o.order_type]), tableLabel(o.table_id), l.name, l.quantity, eur(l.unit_price_cents), l.vat_bp / 100,
        eur(ttc), eur(ht), eur(ttc - ht), i === 0 ? eur(o.discount_cents) : null, i === 0 ? eur(o.total_cents) : null, o.customer_name, o.customer_phone]);
    });
  }
  return rows;
}

export const SALES_MONEY_COLUMNS = [7, 9, 10, 11, 12, 13];
export const SALES_WIDTHS = [12, 8, 12, 12, 8, 30, 9, 16, 8, 12, 12, 10, 18, 22, 20, 16];

export const salesXlsx = (rows: Cell[][]) => xlsxBlob(t('Ventes'), rows, { widths: SALES_WIDTHS, money: SALES_MONEY_COLUMNS });

/** Semicolon-separated with a decimal comma and a BOM: opens correctly in Excel in French and Arabic settings. */
export function salesCsv(rows: Cell[][]): Blob {
  const cell = (v: Cell) => {
    if (v === null) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    // a leading = + - @ would be run as a formula by a spreadsheet
    const s = /^[=@]|^[+-](?![\d\s])/.test(v) ? `'${v}` : v;   // a phone number like +2126… is not a formula
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return new Blob(['\ufeff' + rows.map(r => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
}
