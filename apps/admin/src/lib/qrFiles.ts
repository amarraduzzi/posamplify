// Downloadable QR code files (PNG, SVG, zip). The QR codes are drawn in the browser, as for printing.
import QRCode from 'qrcode';
import type { Restaurant, Table } from './types';

/** Same link as the printed QR codes (see tableUrl in TablesPage). */
export type UrlOf = (r: Restaurant, t: Table) => string;

const OPTS = { margin: 2, errorCorrectionLevel: 'M' as const };

export const qrSvgText = (url: string) => QRCode.toString(url, { ...OPTS, type: 'svg' });

/** 1024 px wide: sharp enough for a print shop and a Word or Canva document. */
export async function qrPngBlob(url: string, width = 1024): Promise<Blob> {
  const dataUrl = await QRCode.toDataURL(url, { ...OPTS, width });
  return (await fetch(dataUrl)).blob();
}

/** File name without accents or spaces: "Bar 1" -> "bar-1". Labels without Latin letters or digits get a number. */
export function fileStem(r: Restaurant, tb: Table, index: number): string {
  const part = tb.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${r.slug}-table-${part || index + 1}`;
}

/** Unique stems for a list of tables (two labels can reduce to the same text). */
export function fileStems(r: Restaurant, tables: Table[]): string[] {
  const seen = new Map<string, number>();
  return tables.map((tb, i) => {
    const s = fileStem(r, tb, i);
    const n = (seen.get(s) ?? 0) + 1;
    seen.set(s, n);
    return n > 1 ? `${s}-${n}` : s;
  });
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadOne(url: string, stem: string, kind: 'png' | 'svg') {
  if (kind === 'png') saveBlob(await qrPngBlob(url), `${stem}.png`);
  else saveBlob(new Blob([await qrSvgText(url)], { type: 'image/svg+xml' }), `${stem}.svg`);
}

/** One zip with a png and an svg folder. jszip loads only when someone clicks. */
export async function downloadZip(r: Restaurant, tables: Table[], urlOf: UrlOf) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const stems = fileStems(r, tables);
  for (let i = 0; i < tables.length; i++) {
    const url = urlOf(r, tables[i]);
    zip.file(`png/${stems[i]}.png`, await qrPngBlob(url));
    zip.file(`svg/${stems[i]}.svg`, await qrSvgText(url));
  }
  saveBlob(await zip.generateAsync({ type: 'blob' }), `${r.slug}-qr-codes.zip`);
}
