export const mad = (cents: number) => {
  const n = Number(cents) / 100;
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} MAD`;
};
/** For printed tickets: always 2 decimals, dot separator, no currency. */
export const amount = (cents: number) => (Number(cents) / 100).toFixed(2);
export const toCents = (s: string) => {
  const n = Number(String(s).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
export const time = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
export const dateTime = (iso: string, tz: string) =>
  new Date(iso).toLocaleString('fr-FR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const minutesSince = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
export const METHOD: Record<string, string> = { cash: 'Espèces', card: 'Carte', transfer: 'Virement', other: 'Autre' };
export const TYPE: Record<string, string> = { dine_in: 'Sur place', takeaway: 'À emporter', delivery: 'Livraison' };
export const STATUS: Record<string, string> = { new: 'Nouvelle', preparing: 'En préparation', ready: 'Prête', served: 'Servie', cancelled: 'Annulée' };
export const uid = () => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16); c.getRandomValues(b);
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
