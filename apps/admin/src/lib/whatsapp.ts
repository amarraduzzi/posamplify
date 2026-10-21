// WhatsApp by hand (until the WhatsApp Business API): open the salon's WhatsApp with the message ready.
/** a Moroccan number for wa.me: 06... -> 2126... */
export const waNumber = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? `212${d.slice(1)}` : d; };
export const waLink = (phone: string, text: string) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
/** day as YYYY-MM-DD in a time zone */
export const ymdIn = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
