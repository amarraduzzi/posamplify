// The accountant's files: entries as CSV (Sage: semicolon, Windows encoding, no header; others: UTF-8
// with a header), an Excel workbook for the month, and the supplier invoices as a zip.
import JSZip from 'jszip';

export interface Entry { journal: string; date: string; piece: string; account: string; label: string; debit: number; credit: number }
export interface Pack {
  restaurant: { name: string; legal_name: string | null; ice: string | null; tax_id: string | null; rc: string | null; address: string | null; city: string | null };
  from: string; to: string; accounts: Record<string, string>; entries: Entry[];
  days: { date: string; tickets: number; ht: number; vat: number; ttc: number }[];
  vat: { rate: number; ht: number; vat: number; ttc: number }[];
  payments: Record<string, number>;
  invoices: { number: string; type: string; date: string; buyer: string | null; ice: string | null; ht: number; vat: number; ttc: number }[];
  purchases: { date: string; supplier: string; number: string | null; ttc: number | null; vat: number | null; pages: number }[];
  cash: { payouts: number; deposits: number };
  stock_purchases_cents: number;
}

/** 1234,56 (the French way accounting software reads it) */
export const amount = (c: number) => (Number(c) / 100).toFixed(2).replace('.', ',');
export const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const clean = (s: string) => s.replace(/[;\r\n\t"]/g, ' ').replace(/[’‘]/g, "'").trim();

export function entriesCsv(p: Pack, sage: boolean): Blob {
  const rows = p.entries.map(e => [e.journal, dmy(e.date), clean(e.piece), e.account, clean(e.label).slice(0, 69), e.debit ? amount(e.debit) : '', e.credit ? amount(e.credit) : ''].join(';'));
  if (!sage) return new Blob(['﻿' + ['Journal;Date;Piece;Compte;Libelle;Debit;Credit', ...rows].join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  return new Blob([cp1252(rows.join('\r\n') + '\r\n')], { type: 'text/csv;charset=windows-1252' });
}

// Windows-1252: what Sage on Windows reads; a letter it does not have becomes "?"
const W: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
export function cp1252(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  let n = 0;
  for (const ch of s) { const c = ch.codePointAt(0)!; out[n++] = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : W[c] ?? 0x3f; }
  return out.slice(0, n);
}

// ---------- a small Excel writer (one style for headers, one for amounts) ----------
type Cell = string | number | null | { money: number } | { b: string };
const xesc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const col = (i: number) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function sheet(rows: Cell[][], widths: number[]) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${col(ci)}${ri + 1}`;
    if (v == null || v === '') return '';
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    if (typeof v === 'object' && 'money' in v) return `<c r="${ref}" s="2"><v>${(v.money / 100).toFixed(2)}</v></c>`;
    if (typeof v === 'object' && 'b' in v) return `<c r="${ref}" s="1" t="inlineStr"><is><t>${xesc(v.b)}</t></is></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xesc(String(v))}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`;
}
export async function workbook(sheets: { name: string; rows: Cell[][]; widths: number[] }[]): Promise<Blob> {
  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xesc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach((s, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, sheet(s.rows, s.widths)));
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function download(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
export const fileSlug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'restaurant';
