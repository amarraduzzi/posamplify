// Printing the QR orders on a ticket printer through printhost.exe: the small Windows program of the till
// (tools/printhost, offered as /printhost.exe) that listens on http://127.0.0.1:8934 and writes raw ESC/POS bytes to
// a Windows printer. Chrome lets an https page call 127.0.0.1, and printhost accepts this admin's address.
// The choice of printer is made on each PC (localStorage), because the printer is plugged into that PC.
const HOST = 'http://127.0.0.1:8934';

export interface TicketLine { text: string; bold?: boolean; large?: boolean; center?: boolean }
const W = 32; // characters per line on 58 mm paper (80 mm printers print it fine too)

async function call<T>(path: string, init?: RequestInit, ms = 4000): Promise<T | null> {
  const c = new AbortController();
  const timer = window.setTimeout(() => c.abort(), ms);
  try { return (await (await fetch(HOST + path, { ...init, signal: c.signal })).json()) as T; }
  catch { return null; } finally { window.clearTimeout(timer); }
}

/** Is printhost running on this PC? */
export const pingPrinter = async () => !!(await call<{ ok: boolean }>('/ping', undefined, 1500))?.ok;
/** The printers Windows sees; null when printhost is old (no list) or not running. */
export async function listPrinters(): Promise<{ name: string; default: boolean }[] | null> {
  const r = await call<{ ok: boolean; printers?: { name: string; default: boolean }[] }>('/printers', undefined, 3000);
  return r?.ok && Array.isArray(r.printers) ? r.printers : null;
}

const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^\x20-\x7E]/g, '?');

function escpos(lines: TicketLine[]): string {
  const b: number[] = [0x1b, 0x40];
  for (const l of lines) {
    b.push(0x1b, 0x61, l.center ? 1 : 0, 0x1b, 0x45, l.bold ? 1 : 0, 0x1d, 0x21, l.large ? 0x11 : 0);
    for (const ch of ascii(l.text)) b.push(ch.charCodeAt(0) & 0xff);
    b.push(0x0a);
  }
  b.push(0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x1b, 0x61, 0, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00); // reset, feed, cut
  return btoa(String.fromCharCode(...b));
}

export async function sendPrint(printer: string, title: string, lines: TicketLine[]) {
  const r = await call<{ ok: boolean; error?: string }>('/print', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ printerName: printer, title, dataBase64: escpos(lines) }),
  }, 8000);
  if (!r) throw new Error('printhost');
  if (!r.ok) throw new Error(r.error || 'print');
}

// ---- this PC's choice
export interface PrintCfg { name: string; auto: boolean }
const cfgKey = (rid: string) => `orders-printer:${rid}`;
export function getPrintCfg(rid: string): PrintCfg {
  try { const v = JSON.parse(localStorage.getItem(cfgKey(rid)) ?? '{}') as Partial<PrintCfg>; return { name: v.name ?? '', auto: !!v.auto }; } catch { return { name: '', auto: false }; }
}
export function setPrintCfg(rid: string, v: PrintCfg) { try { localStorage.setItem(cfgKey(rid), JSON.stringify(v)); } catch { /* private mode: the choice is kept until the page closes */ } }

// ---- never print the same order twice automatically (the page can be reloaded or shown in two windows)
const doneKey = (rid: string) => `orders-printed:${rid}`;
export function wasPrinted(rid: string, id: string) { try { return (JSON.parse(localStorage.getItem(doneKey(rid)) ?? '[]') as string[]).includes(id); } catch { return false; } }
export function markPrinted(rid: string, id: string) {
  try { const l = (JSON.parse(localStorage.getItem(doneKey(rid)) ?? '[]') as string[]).filter(x => x !== id); l.push(id); localStorage.setItem(doneKey(rid), JSON.stringify(l.slice(-200))); } catch { /* fine */ }
}

// ---- the ticket
const rule = (c = '-'): TicketLine => ({ text: c.repeat(W) });
const row = (l: string, r: string) => { const a = ascii(l), b = ascii(r); return a.length + b.length + 1 > W ? `${a}\n${' '.repeat(Math.max(0, W - b.length))}${b}` : a + ' '.repeat(W - a.length - b.length) + b; };
const TYPE: Record<string, string> = { dine_in: 'SUR PLACE', takeaway: 'A EMPORTER', delivery: 'LIVRAISON' };
export interface TicketOrder {
  ticket_number: number; order_type: string; customer_name: string | null; customer_phone: string | null; delivery_address: string | null;
  note: string | null; wanted_at?: string | null; total_cents: number; created_at: string; order_lines: { name: string; quantity: number; note: string | null }[];
}
export function orderTicket(restaurant: string, o: TicketOrder, opts: { table: string | null; tz: string; locale: string; eta: string | null; reprint?: boolean }): TicketLine[] {
  const hm = (iso: string) => new Date(iso).toLocaleTimeString(opts.locale, { timeZone: opts.tz, hour: '2-digit', minute: '2-digit' });
  const day = new Date(o.created_at).toLocaleDateString(opts.locale, { timeZone: opts.tz, day: '2-digit', month: '2-digit' });
  const out: TicketLine[] = [
    { text: restaurant.toUpperCase(), bold: true, center: true },
    rule('='),
    { text: `COMMANDE #${o.ticket_number}`, bold: true, large: true, center: true },
    { text: opts.table ? `TABLE ${opts.table}` : TYPE[o.order_type] ?? o.order_type.toUpperCase(), bold: true, large: true, center: true },
    { text: `${day} ${hm(o.created_at)}${opts.reprint ? '  (COPIE)' : ''}`, center: true },
  ];
  if (o.wanted_at && o.order_type !== 'dine_in') out.push({ text: `POUR ${hm(o.wanted_at)}`, bold: true, center: true });
  else if (opts.eta) out.push({ text: `PRETE VERS ${hm(opts.eta)}`, bold: true, center: true });
  out.push(rule());
  for (const l of o.order_lines) {
    out.push({ text: `${l.quantity}x ${l.name}`, bold: true, large: true });
    if (l.note) out.push({ text: `   > ${l.note}`, bold: true });
  }
  if (o.note) out.push(rule(), { text: `NOTE: ${o.note}`, bold: true });
  const who = [o.customer_name, o.customer_phone].filter(Boolean).join(' - ');
  if (who) out.push(rule(), { text: who });
  if (o.order_type === 'delivery' && o.delivery_address) out.push({ text: o.delivery_address });
  out.push(rule(), ...row('TOTAL', `${(o.total_cents / 100).toFixed(2)} MAD`).split('\n').map(text => ({ text, bold: true })), rule('='));
  return out;
}
