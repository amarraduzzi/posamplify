// Print an order ticket (80 mm) through the browser's own print dialog: no extra software needed.
// Works on any device with a printer. For no dialog at all, start Chrome with --kiosk-printing.
import { mad } from './api';
import { dateLocale, t } from './i18n';

interface Line { name: string; quantity: number; note: string | null }
interface Ticketable {
  ticket_number: number; order_type: 'dine_in' | 'takeaway' | 'delivery'; table_id: string | null;
  customer_name: string | null; customer_phone: string | null; delivery_address: string | null;
  note: string | null; wanted_at?: string | null; eta_at?: string | null; total_cents: number; created_at: string;
  order_lines: Line[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TYPE = { dine_in: 'Sur place', takeaway: 'À emporter', delivery: 'Livraison' } as const;

export function printOrderInBrowser(restaurant: string, o: Ticketable, table: string | null, tz: string) {
  const time = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const date = new Date(o.created_at).toLocaleDateString(dateLocale(), { timeZone: tz });
  const where = o.order_type === 'dine_in' && table ? t('Sur place · Table {n}', { n: table }) : t(TYPE[o.order_type]);
  const lines = o.order_lines.map(l =>
    `<div class="l"><b>${l.quantity}×</b> ${esc(l.name)}</div>${l.note ? `<div class="n">${esc(l.note)}</div>` : ''}`).join('');
  const who = [o.customer_name, o.customer_phone, o.delivery_address].filter(Boolean).map(x => `<div>${esc(x as string)}</div>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>#${o.ticket_number}</title><style>
@page{size:80mm auto;margin:0}
*{box-sizing:border-box}
body{width:72mm;margin:0 auto;padding:4mm 0;font:13px/1.35 "Courier New",monospace;color:#000}
h1{font-size:16px;text-align:center;margin:0 0 2px}
.c{text-align:center}.big{font-size:26px;font-weight:bold}
hr{border:0;border-top:1px dashed #000;margin:6px 0}
.l{font-size:15px;margin:3px 0}.n{padding-left:18px;font-style:italic}
.tot{text-align:right;font-size:16px;font-weight:bold}
</style></head><body>
<h1>${esc(restaurant)}</h1>
<div class="c big">#${o.ticket_number}</div>
<div class="c">${esc(where)} · ${esc(date)} ${esc(time(o.created_at))}</div>
${o.wanted_at ? `<div class="c">${esc(t('Pour {h}', { h: time(o.wanted_at) }))}</div>` : ''}
${o.eta_at ? `<div class="c">${esc(t('Prête vers {h}', { h: time(o.eta_at) }))}</div>` : ''}
<hr>${lines}<hr>
${o.note ? `<div><b>${esc(t('Note du client'))} :</b> ${esc(o.note)}</div><hr>` : ''}
${who ? who + '<hr>' : ''}
<div class="tot">${esc(mad(o.total_cents))}</div>
</body></html>`;

  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const w = f.contentWindow!;
  w.document.open(); w.document.write(html); w.document.close();
  const go = () => { w.focus(); w.print(); setTimeout(() => f.remove(), 60_000); };
  setTimeout(go, 150);
}
