// Printing through printhost.exe (the small local program already installed
// at Dom's Café, see the domscafe repo): it listens on http://127.0.0.1:8934
// and writes raw ESC/POS bytes to the Windows printer with the given name.
// Chrome allows an https page to call 127.0.0.1. When printhost is not
// running, nothing breaks: printing reports "not available".
import type { DayReport, FiscalDoc, Order, Restaurant, PosSettings } from './types';
import { amount, dateTime, METHOD, TYPE } from './format';

const HOST = 'http://127.0.0.1:8934';

export interface TicketLine { text: string; bold?: boolean; large?: boolean; center?: boolean; qr?: string }
const W = 32; // characters per line on 58mm paper (80mm printers print it fine too)

async function call<T>(path: string, init?: RequestInit, ms = 4000): Promise<T | null> {
  const c = new AbortController();
  const t = window.setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(HOST + path, { ...init, signal: c.signal });
    return (await r.json()) as T;
  } catch { return null; } finally { window.clearTimeout(t); }
}

export const pingPrinter = async () => !!(await call<{ ok: boolean }>('/ping', undefined, 1500))?.ok;

function ascii(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^\x20-\x7E]/g, '?');
}
/** Native ESC/POS QR code (GS ( k), centred: supported by Epson-compatible ticket printers. */
function qrBytes(data: string): number[] {
  const d = [...ascii(data)].map(c => c.charCodeAt(0) & 0xff).slice(0, 300);
  const n = d.length + 3;
  return [
    0x1b, 0x61, 1,
    0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,          // model 2
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06,                // module size 6
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,                // error correction M
    0x1d, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30, ...d,     // store the data
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30,                // print it
    0x0a, 0x1b, 0x61, 0,
  ];
}

/** "Leave us a review" block under a receipt, when the owner set the Google link. */
function reviewBlock(r: Restaurant): TicketLine[] {
  const u = r.branding?.review_url;
  if (!u || !/^https:\/\/\S+$/.test(u) || r.branding?.review_on_receipt === false) return [];
  return [rule(), { text: 'Votre avis compte !', bold: true, center: true }, { text: 'Scannez pour nous noter sur Google', center: true }, { text: '', qr: u }];
}

function escpos(lines: TicketLine[], opts: { cut?: boolean; drawer?: boolean } = {}): string {
  const b: number[] = [0x1b, 0x40];
  for (const l of lines) {
    if (l.qr) { b.push(...qrBytes(l.qr)); continue; }
    b.push(0x1b, 0x61, l.center ? 1 : 0, 0x1b, 0x45, l.bold ? 1 : 0, 0x1d, 0x21, l.large ? 0x11 : 0);
    for (const ch of ascii(l.text)) b.push(ch.charCodeAt(0) & 0xff);
    b.push(0x0a);
  }
  b.push(0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x1b, 0x61, 0);
  if (lines.length) b.push(0x0a, 0x0a, 0x0a);
  if (opts.cut !== false && lines.length) b.push(0x1d, 0x56, 0x42, 0x00);
  if (opts.drawer) b.push(0x1b, 0x70, 0x00, 0x19, 0xfa); // kick the cash drawer
  return btoa(String.fromCharCode(...b));
}

export async function print(printer: string, title: string, lines: TicketLine[], opts: { drawer?: boolean; cut?: boolean } = {}) {
  const r = await call<{ ok: boolean; error?: string }>('/print', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ printerName: printer, title, dataBase64: escpos(lines, opts) }),
  }, 8000);
  if (!r) throw new Error("Impression impossible : le programme d'impression (printhost) ne répond pas sur ce PC.");
  if (!r.ok) throw new Error(r.error || "Échec de l'impression.");
}

export const printerFor = (s: PosSettings, station: string) =>
  s.printers?.stations?.[station] ?? (station === 'bar' ? 'BAR' : 'CUISINE');
export const receiptPrinter = (s: PosSettings) => s.printers?.receipt ?? 'TICKET';

const rule = (c = '-') => ({ text: c.repeat(W) });
const row = (left: string, right: string) => {
  const l = ascii(left), r = ascii(right);
  const space = Math.max(1, W - l.length - r.length);
  return l.length + r.length + 1 > W ? `${l}\n${' '.repeat(Math.max(0, W - r.length))}${r}` : l + ' '.repeat(space) + r;
};
const rows = (left: string, right: string, extra: Partial<TicketLine> = {}): TicketLine[] =>
  row(left, right).split('\n').map(text => ({ text, ...extra }));

function header(r: Restaurant, seller?: FiscalDoc['seller']): TicketLine[] {
  const s = seller ?? { name: r.name, legal_name: r.legal_name ?? undefined, ice: r.ice ?? undefined, if: r.tax_id ?? undefined, rc: r.rc ?? undefined, address: r.address ?? undefined, city: r.city ?? undefined };
  const out: TicketLine[] = [{ text: (s.name ?? r.name).toUpperCase(), bold: true, large: true, center: true }];
  if (s.legal_name) out.push({ text: s.legal_name, center: true });
  if (s.address) out.push({ text: s.address, center: true });
  if (s.city) out.push({ text: s.city, center: true });
  if (r.phone) out.push({ text: `Tel ${r.phone}`, center: true });
  const ids = [s.ice && `ICE ${s.ice}`, s.if && `IF ${s.if}`, s.rc && `RC ${s.rc}`].filter(Boolean) as string[];
  ids.forEach(t => out.push({ text: t, center: true }));
  return out;
}

export function kitchenTicket(o: Order, station: string, lines: { quantity: number; name: string; note: string | null }[], label: string, tz: string, staff?: string): TicketLine[] {
  const out: TicketLine[] = [
    { text: station.toUpperCase(), bold: true, large: true, center: true },
    rule('='),
    { text: `${label}  ${ticketRef(o)}`, bold: true, large: true },
    { text: `${dateTime(new Date().toISOString(), tz)}${staff ? '  ' + staff : ''}` },
    rule(),
  ];
  for (const l of lines) {
    out.push({ text: `${l.quantity}x ${l.name}`, bold: true, large: true });
    if (l.note) out.push({ text: `   > ${l.note}`, bold: true });
  }
  if (o.note) { out.push(rule()); out.push({ text: `NOTE: ${o.note}`, bold: true }); }
  out.push(rule('='));
  return out;
}

/** Provisional bill ("addition"), clearly not a fiscal document. */
export function billTicket(r: Restaurant, o: Order, label: string, tz: string): TicketLine[] {
  const out = header(r);
  out.push(rule(), { text: `${label}  ${ticketRef(o)}`, bold: true }, { text: dateTime(new Date().toISOString(), tz) }, rule());
  for (const l of o.order_lines) out.push(...rows(`${l.quantity} ${l.name}`, amount(l.line_total_cents)));
  out.push(rule());
  if (o.discount_cents > 0) out.push(...rows('Remise', '-' + amount(o.discount_cents)));
  out.push(...rows('TOTAL', `${amount(o.total_cents)} MAD`, { bold: true, large: true }));
  out.push(rule(), { text: 'ADDITION - document non fiscal', center: true, bold: true });
  return out;
}

/** Receipt for a customer paying back (part of) the ardoise. Not a fiscal document: the sale already had its ticket. */
export function accountReceipt(r: Restaurant, x: { name: string | null; phone: string; amount_cents: number; method: string; balance_cents: number; at: string; staff?: string }): TicketLine[] {
  const out = header(r);
  out.push(rule(), { text: 'REGLEMENT ARDOISE', bold: true, center: true }, { text: dateTime(x.at, r.timezone), center: true }, rule());
  out.push({ text: `Client : ${x.name || x.phone}` });
  if (x.staff) out.push({ text: `Encaisse par : ${x.staff}` });
  out.push(rule());
  out.push(...rows(`Paye (${METHOD[x.method] ?? x.method})`, `${amount(x.amount_cents)} MAD`, { bold: true, large: true }));
  out.push(...rows('Reste a payer', `${amount(x.balance_cents)} MAD`, { bold: true }));
  out.push(rule(), { text: 'Document non fiscal. Les ventes', center: true }, { text: 'figurent sur les tickets d\'origine.', center: true });
  return out;
}

/** "#12" once the server numbered the order, "H3" for an order taken offline and not sent yet. */
export const ticketRef = (o: Pick<Order, 'ticket_number' | 'local_ref'>) =>
  o.ticket_number ? `#${o.ticket_number}` : o.local_ref ?? '#-';

/** Receipt printed when paying without internet. The fiscal ticket follows automatically on reconnection. */
export function provisionalTicket(r: Restaurant, o: Order, extra: { label: string; staff?: string; payments: { method: string; amount_cents: number; tip_cents: number }[]; change_cents: number; tz: string }): TicketLine[] {
  const out = header(r);
  out.push(rule(), { text: 'RECU PROVISOIRE', bold: true, center: true }, { text: dateTime(new Date().toISOString(), extra.tz), center: true });
  out.push({ text: `${extra.label}  ${ticketRef(o)}` });
  if (extra.staff) out.push({ text: `Servi par : ${extra.staff}` });
  out.push(rule());
  for (const l of o.order_lines) out.push(...rows(`${l.quantity} ${l.name}`, amount(l.line_total_cents)));
  out.push(rule());
  if (o.discount_cents > 0) out.push(...rows('Remise', '-' + amount(o.discount_cents)));
  out.push(...rows('TOTAL TTC', `${amount(o.total_cents)} MAD`, { bold: true, large: true }));
  out.push(rule());
  for (const p of extra.payments) {
    out.push(...rows(METHOD[p.method as keyof typeof METHOD] ?? p.method, amount(p.amount_cents)));
    if (p.tip_cents) out.push(...rows('  Pourboire', amount(p.tip_cents)));
  }
  if (extra.change_cents > 0) out.push(...rows('Rendu', amount(extra.change_cents)));
  out.push(rule(), { text: 'Paiement enregistre hors connexion.', center: true }, { text: 'Le ticket fiscal numerote est', center: true }, { text: 'disponible sur demande.', center: true });
  out.push(rule(), { text: r.pos_settings?.receipt_footer || 'Merci de votre visite, a bientot !', center: true });
  out.push(...reviewBlock(r));
  return out;
}

/** The official receipt, printed from the immutable fiscal document. */
export function fiscalTicket(r: Restaurant, d: FiscalDoc, extra: { label?: string; staff?: string; change_cents?: number; copy?: boolean }): TicketLine[] {
  const tz = r.timezone;
  const title = d.doc_type === 'credit_note' ? 'AVOIR' : d.doc_type === 'invoice' ? 'FACTURE' : 'TICKET';
  const out = header(r, d.seller);
  out.push(rule(), { text: `${title} ${d.doc_number}`, bold: true, center: true });
  if (extra.copy) out.push({ text: 'DUPLICATA', bold: true, center: true });
  out.push({ text: dateTime(d.issued_at, tz), center: true });
  if (extra.label) out.push({ text: extra.label });
  if (extra.staff) out.push({ text: `Servi par : ${extra.staff}` });
  if (d.buyer?.name || d.buyer?.ice) {
    out.push(rule());
    if (d.buyer?.name) out.push({ text: `Client : ${d.buyer.name}` });
    if (d.buyer?.ice) out.push({ text: `ICE client : ${d.buyer.ice}` });
  }
  out.push(rule());
  for (const l of d.lines) out.push(...rows(`${l.qty} ${l.name}`, amount(l.total_ttc)));
  out.push(rule());
  if (d.discount_cents) out.push(...rows('Remise', amount(-Math.abs(d.discount_cents) * Math.sign(d.total_ttc_cents || 1))));
  out.push(...rows('TOTAL TTC', `${amount(d.total_ttc_cents)} MAD`, { bold: true, large: true }));
  for (const v of d.vat_breakdown) out.push(...rows(`TVA ${(v.vat_bp / 100).toFixed(0)}% sur ${amount(v.ht)}`, amount(v.vat)));
  out.push(...rows('Total HT', amount(d.total_ht_cents)));
  out.push(rule());
  for (const p of d.payments) {
    out.push(...rows(METHOD[p.method] ?? p.method, amount(p.amount)));
    if (p.tip) out.push(...rows('  Pourboire', amount(p.tip)));
  }
  if (extra.change_cents && extra.change_cents > 0) out.push(...rows('Rendu', amount(extra.change_cents)));
  if (d.reason) out.push(rule(), { text: `Motif : ${d.reason}` });
  out.push(rule(), { text: r.pos_settings?.receipt_footer || 'Merci de votre visite, a bientot !', center: true });
  out.push({ text: `Ctrl ${d.hash.slice(0, 16)}`, center: true });
  if (d.doc_type !== 'credit_note') out.push(...reviewBlock(r));
  return out;
}

export function reportTicket(r: Restaurant, rep: DayReport, title: string): TicketLine[] {
  const out: TicketLine[] = [{ text: r.name.toUpperCase(), bold: true, center: true }, { text: title, bold: true, large: true, center: true },
    { text: `Journee du ${rep.business_date}`, center: true }, { text: `Edite le ${dateTime(new Date().toISOString(), r.timezone)}`, center: true }, rule()];
  const add = (a: string, b: string, bold = false) => out.push(...rows(a, b, { bold }));
  add('Tickets', String(rep.tickets));
  add('CA TTC', amount(rep.revenue_ttc_cents), true);
  add('CA HT', amount(rep.revenue_ht_cents));
  add('TVA', amount(rep.vat_cents));
  for (const v of rep.vat_breakdown) add(`  TVA ${v.vat_bp / 100}%`, amount(v.vat));
  add('Remises', amount(rep.discounts_cents));
  add(`Avoirs (${rep.credit_notes})`, amount(rep.credit_notes_cents));
  out.push(rule());
  for (const [m, c] of Object.entries(rep.payments)) add(METHOD[m] ?? m, amount(c));
  add('Pourboires', amount(rep.tips_cents));
  if (rep.account_sales_cents) add('Ventes a l\'ardoise', amount(rep.account_sales_cents));
  if (rep.account_received_cents) {
    add('Ardoises reglees', amount(rep.account_received_cents));
    for (const [m, c] of Object.entries(rep.account_received ?? {})) add(`  ${METHOD[m] ?? m}`, amount(c));
  }
  out.push(rule());
  add('Fond de caisse', amount(rep.cash_float_cents));
  add('Sorties de caisse', amount(rep.cash_payouts_cents));
  add('Especes attendues', amount(rep.expected_cash_cents), true);
  if (rep.counted_cash_cents != null) {
    add('Especes comptees', amount(rep.counted_cash_cents));
    add('Ecart de caisse', amount(rep.cash_diff_cents ?? 0), true);
  }
  out.push(rule());
  for (const s of rep.by_staff) add(s.name ?? 'Sans nom', amount(s.revenue_ttc_cents));
  out.push(rule());
  add('Commandes annulees', String(rep.cancelled_orders));
  return out;
}

/** "Table 5", "À emporter - Karim"... French for tickets; pass t() to get the screen language. */
export const orderLabel = (o: Pick<Order, 'order_type' | 'customer_name' | 'source' | 'external_ref'>, tableLabel?: string | null,
  tr: (fr: string, vars?: Record<string, string | number>) => string = (fr, v) => fr.replace(/\{(\w+)\}/g, (_, k: string) => String(v?.[k] ?? ''))) =>
  tableLabel ? tr('Table {n}', { n: tableLabel })
    : o.source === 'glovo' ? `Glovo${o.external_ref ? ' ' + o.external_ref : ''}`
    : o.external_ref === 'borne' ? `${tr('Borne')} · ${tr(TYPE[o.order_type] ?? o.order_type)}${o.customer_name ? ' - ' + o.customer_name : ''}`
    : `${tr(TYPE[o.order_type] ?? o.order_type)}${o.customer_name ? ' - ' + o.customer_name : ''}`;
