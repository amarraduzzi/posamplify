// Amplify's billing of its customers: when the next payment is due and how late it is, the receipt
// and the WhatsApp messages. Dates are calendar days (YYYY-MM-DD), compared in the Moroccan day.
import { dateLocale, t } from './i18n';
import { mad } from './api';
import type { PayMethod, Restaurant } from './types';

export interface PlatformPayment { id: string; restaurant_id: string; number: number; amount_cents: number; method: PayMethod; paid_on: string; period_from: string; period_to: string; note: string | null; created_at: string }
// i18n:values
export const METHODS: Record<PayMethod, string> = { cash: 'Espèces', transfer: 'Virement', cashplus: 'CashPlus', card: 'Carte', other: 'Autre' };
// i18n:end

export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' });
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export const fmtDay = (d: string, long = false) => new Date(`${d}T12:00:00Z`).toLocaleDateString(dateLocale(), long ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } : { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
export const receiptNo = (p: PlatformPayment) => `R-${p.paid_on.slice(0, 4)}-${String(p.number).padStart(4, '0')}`;

export type BillState = 'setup' | 'trial' | 'late' | 'soon' | 'ok' | 'paused' | 'cancelled';
/** Where a customer stands: the date of the next payment, and how many days late (negative: days left). */
export function billing(r: Restaurant) {
  const due = r.paid_until ?? r.billing_start ?? (r.status === 'trial' && r.trial_ends_at ? r.trial_ends_at.slice(0, 10) : null);
  const left = due ? days(today(), due) : null;
  let state: BillState;
  if (r.status === 'cancelled') state = 'cancelled';
  else if (r.status === 'paused') state = 'paused';
  else if (!r.billing_start && !r.paid_until) state = r.status === 'trial' ? 'trial' : 'setup';
  else if (!r.paid_until && r.billing_start! > today()) state = 'setup';
  else if (left != null && left < 0) state = 'late';
  else if (left != null && left <= 7) state = 'soon';
  else state = 'ok';
  return { due, left, state, amount: r.billing_amount_cents ?? null };
}

export const intlPhone = (p?: string | null) => { const d = (p ?? '').replace(/\D/g, ''); return !d ? '' : d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '212' + d.slice(1) : d; };
export const waTo = (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

export const receiptText = (r: Restaurant, p: PlatformPayment) => [
  t('Reçu Amplify n° {n}', { n: receiptNo(p) }),
  r.name,
  t('{a} reçus le {d} ({m})', { a: mad(p.amount_cents), d: fmtDay(p.paid_on, true), m: t(METHODS[p.method]) }),
  t('Période : du {a} au {b}', { a: fmtDay(p.period_from, true), b: fmtDay(p.period_to, true) }),
  t('Merci ! Amplify Growth Studio'),
].join('\n');

export const reminderText = (r: Restaurant, due: string, amount: number | null) =>
  t('Bonjour, petit rappel : votre abonnement Amplify pour {name} est à régler le {d}{a}. Merci !', { name: r.name, d: fmtDay(due, true), a: amount ? ` (${mad(amount)})` : '' });

/** A printable receipt (the browser's print window, also "save as PDF"). */
export function printReceipt(r: Restaurant, p: PlatformPayment) {
  const w = window.open('', '_blank', 'width=520,height=720');
  if (!w) return;
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const row = (k: string, v: string) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;
  w.document.write(`<!doctype html><html dir="${document.documentElement.dir || 'ltr'}"><head><meta charset="utf-8"><title>${esc(receiptNo(p))}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;color:#111;margin:40px;max-width:440px}h1{font-size:22px;margin:0}p{margin:4px 0;color:#555}table{width:100%;border-collapse:collapse;margin:24px 0}td{padding:8px 0;border-bottom:1px solid #ddd}td:last-child{text-align:end;font-weight:600}.big{font-size:28px;font-weight:800;margin-top:8px}</style></head><body>
<h1>${esc(t('Reçu de paiement'))}</h1><p>Amplify Growth Studio · +212 660 353 741</p><p>${esc(receiptNo(p))}</p>
<table>${row(t('Client'), r.name)}${row(t('Payé le'), fmtDay(p.paid_on, true))}${row(t('Mode de paiement'), t(METHODS[p.method]))}${row(t('Période'), `${fmtDay(p.period_from, true)} → ${fmtDay(p.period_to, true)}`)}${p.note ? row(t('Note'), p.note) : ''}</table>
<p>${esc(t('Montant reçu'))}</p><p class="big">${esc(mad(p.amount_cents))}</p>
<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}
