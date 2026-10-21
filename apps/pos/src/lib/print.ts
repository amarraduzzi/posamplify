// Printing through printhost.exe (tools/printhost, offered for download as /printhost.exe): a small
// Windows program that listens on http://127.0.0.1:8934 and writes raw ESC/POS bytes to the Windows
// printer with the given name (USB or network, whatever Windows knows). Chrome allows an https page
// to call 127.0.0.1. When printhost is not running, nothing breaks: printing reports "not available".
// Which printer does what is chosen on each PC (Réglages du poste), from the printers Windows sees;
// otherwise the names set in the admin (Paramètres > Caisse), otherwise TICKET / CUISINE / BAR.
import type { DayReport, FiscalDoc, Order, Restaurant, PosSettings } from './types';
import { amount, dateTime, METHOD, TYPE } from './format';
import { courseTicket } from './stations';

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

// ---- the Android app (Amplify Caisse for Android): the same service, plus finding printers itself
/** This till runs inside the Amplify Caisse Android app (it prints through the app). */
export const inAndroidApp = () => typeof navigator !== 'undefined' && /AmplifyCaisseAndroid/.test(navigator.userAgent);
/** An Android tablet or phone in the browser: the app is what lets it print. */
export const androidBrowser = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) && !inAndroidApp();
/** The APK, built by GitHub and served by the till's own site. */
export const ANDROID_APK = '/amplify-caisse.apk';
type PrinterList = { ok: boolean; error?: string; printers?: { name: string; default: boolean; kind?: string }[] };
/** Android app: looks for printers on the network (takes a few seconds), then lists them all. */
export async function scanPrinters() {
  const r = await call<PrinterList>('/scan', { method: 'POST' }, 15000);
  return r?.ok && Array.isArray(r.printers) ? r.printers : null;
}
/** Android app: adds a network printer by its IP address. Throws the app's message when nobody answers there. */
export async function addNetworkPrinter(ip: string) {
  const r = await call<PrinterList>('/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip: ip.trim(), port: 9100 }) }, 6000);
  if (!r) throw new Error("L'application ne répond pas.");
  if (!r.ok) throw new Error(r.error || 'Imprimante introuvable.');
  return r.printers ?? [];
}
/** The printers Windows sees on this PC; null with the old Dom's printhost (no list: update it). */
export async function listPrinters(): Promise<{ name: string; default: boolean }[] | null> {
  const r = await call<{ ok: boolean; printers?: { name: string; default: boolean }[] }>('/printers', undefined, 3000);
  return r?.ok && Array.isArray(r.printers) ? r.printers : null;
}

/** This PC's own choice of printers (kept on this PC only). */
export type LocalPrinters = { receipt?: string; stations?: Record<string, string> };
const LOCAL_KEY = 'pos-printers';
export function localPrinters(): LocalPrinters {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as LocalPrinters; } catch { return {}; }
}
export function setLocalPrinters(v: LocalPrinters) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch { /* private mode: the admin names stay */ }
}

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

// ---- iPad / iPhone: Safari may not talk to a printer, the free Epson app "TM Print Assistant" does.
// The till hands each ticket to the app through its link (ePOS-Print XML); the app prints it on the
// Epson printer chosen in the app. iOS only opens another app on a tap, so tickets printed later
// (after the payment is saved, a bon sent from a phone) wait in a small "Imprimer" bar.
/** An iPad or iPhone (iPadOS presents itself as a Mac with a touch screen). */
export const isIOS = () => typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const EPSON_KEY = 'pos-epson-app';
/** This iPad prints through Epson TM Print Assistant (switched on in Réglages du poste). */
export const usesEpsonApp = () => { try { return localStorage.getItem(EPSON_KEY) === 'on'; } catch { return false; } };
export function setEpsonApp(on: boolean) {
  try { if (on) localStorage.setItem(EPSON_KEY, 'on'); else localStorage.removeItem(EPSON_KEY); } catch { /* private mode */ }
}
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** One ticket in ePOS-Print XML (without the <epos-print> wrapper). */
function eposXml(lines: TicketLine[], opts: { cut?: boolean; drawer?: boolean } = {}) {
  let x = '';
  for (const l of lines) {
    if (l.qr) { x += `<text align="center"/><symbol type="qrcode_model_2" level="level_m" width="6">${xmlEsc(ascii(l.qr).slice(0, 300))}</symbol><feed/><text align="left"/>`; continue; }
    x += `<text align="${l.center ? 'center' : 'left'}" em="${l.bold ? 'true' : 'false'}" dw="${l.large ? 'true' : 'false'}" dh="${l.large ? 'true' : 'false'}">${xmlEsc(ascii(l.text)).replace(/\n/g, '&#10;')}&#10;</text>`;
  }
  x += '<text align="left" em="false" dw="false" dh="false"/>';
  if (lines.length) x += opts.cut !== false ? '<feed line="3"/><cut type="feed"/>' : '<feed line="3"/>';
  if (opts.drawer) x += '<pulse drawer="drawer_1" time="pulse_100"/>';
  return x;
}
let epsonJobs: string[] = [];
const epsonSubs = new Set<(n: number) => void>();
/** Tickets waiting for a tap to go to the Epson app. */
export const epsonWaiting = () => epsonJobs.length;
export function onEpsonWaiting(f: (n: number) => void) { epsonSubs.add(f); return () => { epsonSubs.delete(f); }; }
const epsonNotify = () => epsonSubs.forEach(f => f(epsonJobs.length));
/** Sends every waiting ticket to the Epson app in one go (call it from a tap). */
export function flushEpson() {
  if (!epsonJobs.length) return;
  const xml = '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">' + epsonJobs.join('') + '</epos-print>';
  epsonJobs = []; epsonNotify();
  // No return link: iOS opens it as a new Safari tab (the till restarts, or Safari opens instead of
  // the home-screen app). The staff taps "◀ Caisse / ◀ Safari" at the top left: the till is exactly as it was.
  // In Safari: after printing the Epson app opens a tiny page that closes itself, so Safari shows the
  // till tab again as it was. From the home-screen icon there is no way back but "◀".
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  window.location.href = 'tmprintassistant://tmprintassistant.epson.com/print?ver=1&data-type=eposprintxml&reselect=no&data='
    + encodeURIComponent(xml) + (standalone ? '' : '&success=' + encodeURIComponent(window.location.origin + '/terug.html'));
}
export function clearEpson() { epsonJobs = []; epsonNotify(); }
function printEpson(lines: TicketLine[], opts: { drawer?: boolean; cut?: boolean }) {
  epsonJobs.push(eposXml(lines, opts));
  // tickets made in the same moment (bons of several stations) go together
  window.setTimeout(() => {
    const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (ua?.isActive) flushEpson(); else { epsonNotify(); armEpsonTap(); }
  }, 0);
}
// A ticket made after a wait (the payment saved on the server) prints at the very next touch
// anywhere (usually "Terminé"): iOS accepts opening the Epson app from any tap.
let armed = false;
function armEpsonTap() {
  if (armed) return;
  armed = true;
  const go = (e: Event) => { if ((e.target as Element | null)?.closest?.('[data-epson-cancel]')) return; armed = false; document.removeEventListener('click', go, true); flushEpson(); };
  document.addEventListener('click', go, true);
}

export async function print(printer: string, title: string, lines: TicketLine[], opts: { drawer?: boolean; cut?: boolean } = {}) {
  if (usesEpsonApp()) { printEpson(lines, opts); return; }
  const r = await call<{ ok: boolean; error?: string }>('/print', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ printerName: printer, title, dataBase64: escpos(lines, opts) }),
  }, 8000);
  if (!r) throw new Error(inAndroidApp() ? "Impression impossible : l'application ne répond pas. Fermez-la et rouvrez-la." : "Impression impossible : le programme d'impression (printhost) ne répond pas sur ce PC.");
  if (!r.ok) throw new Error(r.error || "Échec de l'impression.");
}

export const printerFor = (s: PosSettings, station: string) =>
  localPrinters().stations?.[station] || s.printers?.stations?.[station] || (station === 'bar' ? 'BAR' : 'CUISINE');
export const receiptPrinter = (s: PosSettings) => localPrinters().receipt || s.printers?.receipt || 'TICKET';

const rule = (c = '-') => ({ text: c.repeat(W) });
// Large text is printed twice as wide, so only half as many characters fit on a line: a large row
// is laid out on W / 2 columns. (At full width the amount wrapped to the next line, and its first
// digit was left behind: "60.00 MAD" came out as "6" + "0.00 MAD".)
const row = (left: string, right: string, width = W) => {
  const l = ascii(left), r = ascii(right);
  const space = Math.max(1, width - l.length - r.length);
  return l.length + r.length + 1 > width ? `${l}\n${' '.repeat(Math.max(0, width - r.length))}${r}` : l + ' '.repeat(space) + r;
};
const rowsW = (left: string, right: string, width: number, extra: Partial<TicketLine> = {}): TicketLine[] =>
  row(left, right, extra.large ? Math.floor(width / 2) : width).split('\n').map(text => ({ text, ...extra }));
const rows = (left: string, right: string, extra: Partial<TicketLine> = {}): TicketLine[] => rowsW(left, right, W, extra);

function header(r: Restaurant, seller?: FiscalDoc['seller']): TicketLine[] {
  const s = seller ?? { name: r.name, legal_name: r.legal_name ?? undefined, ice: r.ice ?? undefined, if: r.tax_id ?? undefined, rc: r.rc ?? undefined, address: r.address ?? undefined, city: r.city ?? undefined };
  const out: TicketLine[] = [{ text: (s.name ?? r.name).toUpperCase(), bold: true, large: true, center: true }];
  if (s.legal_name) out.push({ text: s.legal_name, center: true });
  if (s.address) out.push({ text: s.address, center: true });
  // "12 Rue X, Rabat 10000" + city "Rabat" would print the city twice
  if (s.city && !(s.address ?? '').toLowerCase().includes(s.city.toLowerCase())) out.push({ text: s.city, center: true });
  if (r.phone) out.push({ text: `Tel ${r.phone}`, center: true });
  const ids = [s.ice && `ICE ${s.ice}`, s.if && `IF ${s.if}`, s.rc && `RC ${s.rc}`].filter(Boolean) as string[];
  ids.forEach(t => out.push({ text: t, center: true }));
  return out;
}

export function kitchenTicket(o: Order, station: string, lines: { quantity: number; name: string; note: string | null; course?: number | null }[], label: string, tz: string, staff?: string,
  later: { quantity: number; name: string; course: number | null }[] = []): TicketLine[] {
  const out: TicketLine[] = [
    { text: station.toUpperCase(), bold: true, large: true, center: true },
    rule('='),
    { text: `${label}  ${ticketRef(o)}`, bold: true, large: true },
    { text: `${dateTime(new Date().toISOString(), tz)}${staff ? '  ' + staff : ''}` },
    rule(),
  ];
  if (o.guest_alert) out.push({ text: `!! ALLERGIE: ${o.guest_alert}`, bold: true, large: true }, rule());
  let course: number | null | undefined = undefined;
  for (const l of [...lines].sort((a, b) => (a.course ?? 0) - (b.course ?? 0))) {
    if (l.course && l.course !== course) out.push({ text: `-- ${courseTicket(l.course)} --`, bold: true, center: true });
    course = l.course;
    out.push({ text: `${l.quantity}x ${l.name}`, bold: true, large: true });
    if (l.note) out.push({ text: `   > ${l.note}`, bold: true });
  }
  if (later.length) {
    out.push(rule(), { text: 'A SUIVRE (en attente):', bold: true });
    for (const l of later) out.push({ text: `  ${l.quantity}x ${l.name}${l.course ? ' (' + courseTicket(l.course) + ')' : ''}` });
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
  if (r.pos_settings?.receipt_layout === 'caisse') {
    // the VAT rates are only known to the server: the table uses the one rate set in receipt_vat_bp (if any);
    // the numbered ticket that follows has the real figures
    const bp = r.pos_settings?.receipt_vat_bp;
    const ht = bp ? Math.round(o.total_cents * 10000 / (10000 + bp)) : 0;
    return caisseLayout(r, { name: r.name, address: r.address, phone: r.phone, ice: r.ice, issuedAt: new Date().toISOString(), ticketNo: o.ticket_number ? String(o.ticket_number) : (o.local_ref ?? '-'),
      label: extra.label, staff: extra.staff, lines: o.order_lines.map(l => ({ qty: l.quantity, name: l.name, total: l.line_total_cents })),
      discount: o.discount_cents, total: o.total_cents, vat: bp ? [{ vat_bp: bp, ht, vat: o.total_cents - ht }] : undefined });
  }
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

/** The "caisse" layout: the customer receipt laid out like the one Zayna's customers got from caisse.ma.
 *  Switched on per restaurant with pos_settings.receipt_layout = 'caisse' (80 mm paper: receipt_cols 48, or 42 / 32).
 *  Used for the fiscal ticket and for the provisional receipt (offline), so "TOTAL TTC" never shows on it. */
interface CaisseData {
  name: string; address?: string | null; phone?: string | null; ice?: string | null;
  issuedAt: string; ticketNo: string; label?: string; staff?: string; copy?: boolean;
  lines: { qty: number; name: string; total: number }[]; discount: number; total: number;
  vat?: { vat_bp: number; ht: number; vat: number }[];
}
function caisseLayout(r: Restaurant, x: CaisseData): TicketLine[] {
  const want = r.pos_settings?.receipt_cols;
  const C = want === 32 || want === 42 || want === 48 ? want : 48;
  const line = (c = '-'): TicketLine => ({ text: c.repeat(C) });
  const blank = (): TicketLine => ({ text: '' });
  const ps = r.pos_settings ?? {};
  const out: TicketLine[] = [{ text: ascii(ps.receipt_name || x.name), bold: true, center: true }];
  const address = ps.receipt_address || x.address;
  if (address) out.push({ text: address, center: true });
  if (x.phone) out.push({ text: x.phone, center: true });
  if (x.ice) out.push({ text: x.ice, center: true });
  out.push(line());
  out.push({ text: `Date creation : ${dateTime(x.issuedAt, r.timezone)}` });
  out.push({ text: `${ps.receipt_boutique ? `Boutique : ${ps.receipt_boutique}   ` : ''}Ticket:${x.ticketNo}` });
  if (x.copy) out.push({ text: 'DUPLICATA', bold: true });
  out.push(blank());
  if (x.label) out.push({ text: /^table/i.test(x.label) ? `Sur place ( ${x.label} )` : x.label });
  if (x.staff) out.push({ text: `Caissier : ${x.staff}` });
  out.push(line());
  const art = '* ARTICLE *';
  const pos = Math.max(4, Math.floor((C - art.length) / 2));
  out.push({ text: 'QTE'.padEnd(pos) + art + ' '.repeat(Math.max(1, C - pos - art.length - 4)) + 'PRIX' });
  out.push(line());
  for (const l of x.lines) out.push(...rowsW(`${l.qty}`.padEnd(5) + l.name, amount(l.total), C));
  out.push(line());
  const sub = x.lines.reduce((t, l) => t + l.total, 0);
  out.push(...rowsW('Sous-total', `${amount(sub)} MAD`, C));
  if (x.discount) out.push(...rowsW('Remise', amount(-Math.abs(x.discount) * Math.sign(x.total || 1)), C));
  out.push(line());
  out.push(...rowsW('Total', `${amount(x.total)} MAD`, C, { bold: true, large: true }));
  out.push(line());
  if (x.vat) {
    const w1 = Math.max(9, Math.floor(C / 3)), w2 = Math.max(13, Math.floor(C / 3));
    out.push({ text: 'Taux TVA'.padEnd(w1) + 'Montant H.T.'.padEnd(w2) + 'T.V.A' });
    for (const v of x.vat) out.push({ text: `${(v.vat_bp / 100).toFixed(0)} %`.padEnd(w1) + amount(v.ht).padEnd(w2) + amount(v.vat) });
  }
  out.push(blank());
  out.push({ text: 'NOTE', large: true, center: true });
  out.push(blank());
  out.push({ text: ps.receipt_footer || 'Merci pour votre visite', center: true });
  out.push(...reviewBlock(r));
  return out;
}

/** The official receipt, printed from the immutable fiscal document. */
export function fiscalTicket(r: Restaurant, d: FiscalDoc, extra: { label?: string; staff?: string; change_cents?: number; copy?: boolean }): TicketLine[] {
  if (r.pos_settings?.receipt_layout === 'caisse' && d.doc_type === 'ticket') {
    const sel = d.seller ?? { name: r.name };
    return caisseLayout(r, { name: sel.name ?? r.name, address: sel.address, phone: r.phone, ice: sel.ice, issuedAt: d.issued_at, ticketNo: String(Number(d.doc_number.split('-').pop()) || d.doc_number),
      label: extra.label, staff: extra.staff, copy: extra.copy, lines: d.lines.map(l => ({ qty: l.qty, name: l.name, total: l.total_ttc })),
      discount: d.discount_cents, total: d.total_ttc_cents, vat: d.vat_breakdown });
  }
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
  // nothing to pay: a reward or a discount covered the whole bill
  if (d.doc_type !== 'credit_note' && Number(d.total_ttc_cents) === 0 && d.payments.length === 0) out.push(...rows('Offert, aucun paiement', amount(0)));
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
  if (rep.advances_received_cents) {
    add('Acomptes recus', amount(rep.advances_received_cents));
    for (const [m, c] of Object.entries(rep.advances_received ?? {})) add(`  ${METHOD[m] ?? m}`, amount(c));
  }
  if (rep.advances_refunded_cents) add('Acomptes rendus', amount(rep.advances_refunded_cents));
  if (rep.advances_kept_cents) add('Acomptes conserves (no-show)', amount(rep.advances_kept_cents));
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
    : o.source === 'catering' ? `${tr('Traiteur')}${o.customer_name ? ' - ' + o.customer_name : ''}`
    : o.external_ref === 'borne' ? `${tr('Borne')} · ${tr(TYPE[o.order_type] ?? o.order_type)}${o.customer_name ? ' - ' + o.customer_name : ''}`
    : `${tr(TYPE[o.order_type] ?? o.order_type)}${o.customer_name ? ' - ' + o.customer_name : ''}`;
