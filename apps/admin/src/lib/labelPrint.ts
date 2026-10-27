// Product labels (one per batch): the page of the label, printed through the browser's own print dialog (any printer
// that Windows or the tablet knows, including label printers with their driver), or sent as a ticket to the ticket
// printer of orderPrint.ts (printhost). The facts come from the database (production_label), the allergens included.
import { allergenName } from '@resto/shared';
import { sendPrint, type TicketLine } from './orderPrint';
import type { ProductionLabel } from './types';

export type LabelSize = '50x30' | '58x40' | '80x50' | '100x60';
export const LABEL_SIZES: { id: LabelSize; w: number; h: number; base: number; name: number }[] = [
  { id: '50x30',  w: 50,  h: 30, base: 6.5, name: 9 },
  { id: '58x40',  w: 58,  h: 40, base: 7.5, name: 11 },
  { id: '80x50',  w: 80,  h: 50, base: 9,   name: 13 },
  { id: '100x60', w: 100, h: 60, base: 11,  name: 16 },
];
export interface LabelOpts {
  size: LabelSize;
  bilingual: boolean;          // French + Arabic allergen names
  copies: number;
  net: string;                 // free text, e.g. "500 g" (optional)
  expires: string | null;      // YYYY-MM-DD: the date to print (the one of the database, or one typed by hand)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 2026-10-27 → 27/10/2026 (no time zone: the date is a calendar day). */
export const dmy = (iso: string) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

// ---- what the label says about allergens. NEVER "none" for something that is not fully checked.
export type AllergenText = { state: 'unchecked' } | { state: 'none' } | { state: 'some'; contains: string[]; traces: string[] };
export function allergenState(l: Pick<ProductionLabel, 'allergens' | 'may_contain' | 'allergens_complete'>): AllergenText {
  if (!l.allergens_complete) return { state: 'unchecked' };
  if (!l.allergens.length && !l.may_contain.length) return { state: 'none' };
  return { state: 'some', contains: l.allergens, traces: l.may_contain };
}
const expiryWord = (type: string) => type === 'ddm' ? 'DDM' : 'DLC';

function allergenHtml(l: ProductionLabel, bilingual: boolean): string {
  const a = allergenState(l);
  const names = (codes: string[]) => codes.map(c => bilingual ? `${esc(allergenName(c, 'fr'))} / <bdi dir="rtl">${esc(allergenName(c, 'ar'))}</bdi>` : esc(allergenName(c, 'fr'))).join(', ');
  if (a.state === 'unchecked') return `<div class="al"><b>Allergènes :</b> demandez au personnel${bilingual ? ' / <bdi dir="rtl">اسأل الموظفين</bdi>' : ''}</div>`;
  if (a.state === 'none') return `<div class="al">Aucun allergène déclaré${bilingual ? ' / <bdi dir="rtl">لا مسببات حساسية معلنة</bdi>' : ''}</div>`;
  return (a.contains.length ? `<div class="al"><b>Contient${bilingual ? ' / <bdi dir="rtl">يحتوي على</bdi>' : ''} :</b> <b>${names(a.contains)}</b></div>` : '')
    + (a.traces.length ? `<div class="al">Peut contenir${bilingual ? ' / <bdi dir="rtl">قد يحتوي على</bdi>' : ''} : ${names(a.traces)}</div>` : '');
}

function oneLabel(l: ProductionLabel, o: LabelOpts): string {
  const exp = o.expires ? `<div class="x"><b>${expiryWord(l.expiry_type)} ${esc(dmy(o.expires))}</b></div>` : '';
  return `<div class="label">
<div class="rs">${esc(l.restaurant)}</div>
<div class="nm">${esc(l.name)}</div>
<div class="d">Fabriqué le ${esc(dmy(l.produced_on))}${o.net.trim() ? ` · ${esc(o.net.trim())}` : ''}</div>
${exp}
<div class="d">Lot : <b>${esc(l.lot_code ?? '—')}</b></div>
${allergenHtml(l, o.bilingual)}
</div>`;
}

/** The whole page: one label per copy. The label never grows: text that does not fit is cut at the border, which labelOverflows() detects. */
export function labelPage(l: ProductionLabel, o: LabelOpts): string {
  const s = LABEL_SIZES.find(x => x.id === o.size) ?? LABEL_SIZES[1];
  const copies = Math.min(Math.max(Math.round(o.copies) || 1, 1), 200);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(l.name)} ${esc(l.lot_code ?? '')}</title><style>
@page{size:${s.w}mm ${s.h}mm;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
.label{width:${s.w}mm;height:${s.h}mm;overflow:hidden;padding:${s.w >= 80 ? 3 : 2}mm;font:${s.base}pt/1.2 Arial,Helvetica,sans-serif;color:#000;page-break-after:always;break-after:page;background:#fff}
.label:last-child{page-break-after:auto;break-after:auto}
.rs{font-size:${s.base - 0.5}pt;text-transform:uppercase;letter-spacing:.04em}
.nm{font-size:${s.name}pt;font-weight:bold;line-height:1.1;margin:.6mm 0 1mm}
.d,.x{margin:.2mm 0}.x{font-size:${s.base + 1.5}pt}
.al{margin-top:1mm;padding-top:.8mm;border-top:.2mm solid #000}.al+.al{border-top:0;margin-top:.4mm;padding-top:0}
</style></head><body>${Array.from({ length: copies }, () => oneLabel(l, o)).join('')}</body></html>`;
}

/** Does the text fit in the label? A label that does not fit must not be printed: an allergen could be cut off. */
export function labelOverflows(doc: Document): boolean {
  return Array.from(doc.querySelectorAll<HTMLElement>('.label')).some(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
}

/** Through the browser's print dialog (for no dialog: Chrome started with --kiosk-printing). */
export function printLabelInBrowser(l: ProductionLabel, o: LabelOpts) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const w = f.contentWindow!;
  w.document.open(); w.document.write(labelPage(l, o)); w.document.close();
  setTimeout(() => { w.focus(); w.print(); setTimeout(() => f.remove(), 60_000); }, 200);
}

// ---- as a ticket for the ticket printer (printhost). Only the French text: the printer has no Arabic.
const W = 32;
const wrap = (s: string): string[] => {
  const out: string[] = []; let cur = '';
  for (const w of s.split(/\s+/).filter(Boolean)) {
    if ((cur + ' ' + w).trim().length > W) { if (cur) out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
};
export function labelTicket(l: ProductionLabel, o: Pick<LabelOpts, 'net' | 'expires'>): TicketLine[] {
  const a = allergenState(l);
  const names = (codes: string[]) => codes.map(c => allergenName(c, 'fr')).join(', ');
  const out: TicketLine[] = [
    { text: l.restaurant.toUpperCase(), center: true },
    { text: l.name, bold: true, large: true, center: true },
    { text: `Fabrique le ${dmy(l.produced_on)}${o.net.trim() ? ` - ${o.net.trim()}` : ''}`, center: true },
  ];
  if (o.expires) out.push({ text: `${expiryWord(l.expiry_type)} ${dmy(o.expires)}`, bold: true, large: true, center: true });
  out.push({ text: `Lot : ${l.lot_code ?? '-'}`, center: true }, { text: '-'.repeat(W) });
  if (a.state === 'unchecked') out.push(...wrap('ALLERGENES : demandez au personnel').map(text => ({ text, bold: true })));
  else if (a.state === 'none') out.push({ text: 'Aucun allergene declare' });
  else {
    if (a.contains.length) out.push(...wrap(`CONTIENT : ${names(a.contains)}`).map(text => ({ text, bold: true })));
    if (a.traces.length) out.push(...wrap(`Peut contenir : ${names(a.traces)}`).map(text => ({ text })));
  }
  return out;
}
export async function printLabelTicket(printer: string, l: ProductionLabel, o: Pick<LabelOpts, 'net' | 'expires' | 'copies'>) {
  const lines = labelTicket(l, o);
  const n = Math.min(Math.max(Math.round(o.copies) || 1, 1), 50);
  for (let i = 0; i < n; i++) await sendPrint(printer, `${l.name} ${l.lot_code ?? ''}`, lines);
}

// ---- this PC's choices
export interface LabelCfg { size: LabelSize; bilingual: boolean }
const key = (rid: string) => `label-cfg:${rid}`;
export function getLabelCfg(rid: string): LabelCfg {
  try {
    const v = JSON.parse(localStorage.getItem(key(rid)) ?? '{}') as Partial<LabelCfg>;
    return { size: LABEL_SIZES.some(s => s.id === v.size) ? v.size as LabelSize : '58x40', bilingual: !!v.bilingual };
  } catch { return { size: '58x40', bilingual: false }; }
}
export function setLabelCfg(rid: string, v: LabelCfg) { try { localStorage.setItem(key(rid), JSON.stringify(v)); } catch { /* private mode: kept until the page closes */ } }
