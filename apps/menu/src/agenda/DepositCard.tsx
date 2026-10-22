// The deposit on the client's page: how much, until when, how to pay (the salon's payment link, its
// RIB to copy, CashPlus), "J'ai payé" with the reference, and then what happened to it.
import { useState } from 'react';
import { Check, Clock, Copy, CreditCard, ExternalLink, Loader2, Wallet } from 'lucide-react';
import { formatMoney } from '@resto/shared';
import { agendaDepositReport, type AgendaDeposit } from '../lib/api';

const D = {
  fr: {
    toPay: (m: string) => `Acompte à payer : ${m}`, before: (d: string) => `Avant ${d}. Sans paiement, le créneau est libéré.`,
    why: { service: 'Cette prestation demande un acompte.', no_shows: 'Un acompte est demandé pour confirmer ce rendez-vous.', manual: 'Le salon demande un acompte pour confirmer.' },
    payLink: 'Payer en ligne', rib: 'Virement', copy: 'Copier', copied: 'Copié', cashplus: 'CashPlus', atSalon: 'Ou sur place.',
    paid: 'J’ai payé', ref: 'Référence du paiement (facultatif)', send: 'Envoyer', reported: 'Merci ! Le salon vérifie et confirme.',
    received: (m: string) => `Acompte reçu : ${m}. Il sera déduit le jour du rendez-vous.`, expired: 'L’acompte n’a pas été payé à temps : le rendez-vous est annulé.',
    credited: (m: string) => `Votre acompte de ${m} est gardé comme avoir pour votre prochaine visite.`, refunded: (m: string) => `Votre acompte de ${m} a été remboursé.`,
    kept: (m: string) => `Acompte de ${m} conservé par le salon.`, error: 'Une erreur est survenue. Réessayez.',
  },
  en: {
    toPay: (m: string) => `Deposit to pay: ${m}`, before: (d: string) => `Before ${d}. Without payment, the time is released.`,
    why: { service: 'This service requires a deposit.', no_shows: 'A deposit is required to confirm this appointment.', manual: 'The salon asks a deposit to confirm.' },
    payLink: 'Pay online', rib: 'Bank transfer', copy: 'Copy', copied: 'Copied', cashplus: 'CashPlus', atSalon: 'Or on site.',
    paid: 'I have paid', ref: 'Payment reference (optional)', send: 'Send', reported: 'Thank you! The salon checks and confirms.',
    received: (m: string) => `Deposit received: ${m}. It will be deducted on the day.`, expired: 'The deposit was not paid in time: the appointment is cancelled.',
    credited: (m: string) => `Your ${m} deposit is kept as a credit for your next visit.`, refunded: (m: string) => `Your ${m} deposit was refunded.`,
    kept: (m: string) => `${m} deposit kept by the salon.`, error: 'Something went wrong. Try again.',
  },
  ar: {
    toPay: (m: string) => `العربون اللي خاصكم تخلصو: ${m}`, before: (d: string) => `قبل ${d}. بلا خلاص، كيتحرر الموعد.`,
    why: { service: 'هاد الخدمة كتطلب عربون.', no_shows: 'كيتطلب عربون باش يتأكد هاد الموعد.', manual: 'الصالون كيطلب عربون باش يأكد الموعد.' },
    payLink: 'الخلاص أونلاين', rib: 'تحويل بنكي', copy: 'نسخ', copied: 'تنسخ', cashplus: 'كاش بلوس', atSalon: 'ولا فالمحل.',
    paid: 'خلصت', ref: 'مرجع الخلاص (اختياري)', send: 'إرسال', reported: 'شكرا! الصالون غادي يتحقق ويأكد.',
    received: (m: string) => `توصلنا بالعربون: ${m}. غادي يتنقص نهار الموعد.`, expired: 'العربون ما تخلصش فالوقت: الموعد تلغى.',
    credited: (m: string) => `العربون ديالكم (${m}) محفوظ ليكم للزيارة الجاية.`, refunded: (m: string) => `ترجع ليكم العربون ديال ${m}.`,
    kept: (m: string) => `الصالون احتفظ بالعربون ديال ${m}.`, error: 'وقع خطأ. عاودو المحاولة.',
  },
};

export function DepositCard({ dep, token, lang, tz, onDone }: { dep: AgendaDeposit; token: string; lang: 'fr' | 'en' | 'ar'; tz: string; onDone: () => void }) {
  const t = D[lang];
  const [ref, setRef] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const m = formatMoney(dep.amount_cents, 'MAD', lang as 'fr');
  const loc = lang === 'ar' ? 'ar-MA-u-nu-latn' : lang === 'en' ? 'en-GB' : 'fr-FR';
  const due = dep.due_at ? new Intl.DateTimeFormat(loc, { timeZone: tz, weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(dep.due_at)) : '';
  const report = async () => {
    setBusy(true); setErr(null);
    try { await agendaDepositReport(token, ref.trim()); setOpen(false); onDone(); } catch { setErr(t.error); }
    setBusy(false);
  };
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s.replace(/\s/g, '')); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ } };

  if (dep.status !== 'pending') {
    const text = dep.status === 'paid' ? t.received(m) : dep.status === 'expired' ? t.expired : dep.status === 'credited' ? t.credited(m)
      : dep.status === 'refunded' ? t.refunded(m) : dep.status === 'kept' ? t.kept(m) : null;
    if (!text) return null;
    return <p className={`mx-5 mt-4 flex items-start gap-2 rounded-2xl p-4 text-sm font-semibold ${dep.status === 'paid' || dep.status === 'credited' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-surface-2 text-muted'}`}>
      {dep.status === 'paid' ? <Check className="mt-0.5 size-4 shrink-0" /> : <Wallet className="mt-0.5 size-4 shrink-0" />}{text}</p>;
  }
  const p = dep.pay ?? {};
  return (
    <div className="mx-5 mt-4 space-y-3 rounded-3xl border-2 border-amber-500/40 bg-amber-500/5 p-5">
      <div>
        <p className="font-display text-xl font-semibold">{t.toPay(m)}</p>
        <p className="mt-1 text-sm text-muted">{t.why[dep.reason]}</p>
        {due && <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-amber-600"><Clock className="size-4" /><span className="first-letter:uppercase">{t.before(due)}</span></p>}
      </div>
      {p.link && <a href={p.link} target="_blank" rel="noopener" className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand font-semibold text-brand-ink press"><CreditCard className="size-4" />{t.payLink}<ExternalLink className="size-3.5 opacity-70" /></a>}
      {p.rib && (
        <div className="rounded-2xl bg-surface p-3 text-sm">
          <p className="text-xs text-muted">{t.rib}{p.rib_name ? ` · ${p.rib_name}` : ''}{p.bank ? ` · ${p.bank}` : ''}</p>
          <div className="mt-1 flex items-center gap-2">
            <p dir="ltr" className="flex-1 font-semibold tabular-nums tracking-wide">{p.rib}</p>
            <button onClick={() => copy(p.rib!)} className="flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? t.copied : t.copy}</button>
          </div>
        </div>
      )}
      {p.cashplus && <p className="rounded-2xl bg-surface p-3 text-sm"><span className="text-xs text-muted">{t.cashplus}</span><br /><span className="font-semibold">{p.cashplus}</span></p>}
      {p.note && <p className="text-sm text-muted">{p.note}</p>}
      <p className="text-sm text-muted">{t.atSalon}</p>
      {dep.reported ? <p className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-600"><Check className="size-4" />{t.reported}</p>
        : open ? (
          <div className="space-y-2">
            <input className="h-12 w-full rounded-2xl border border-line bg-surface px-4 outline-none focus:border-brand" placeholder={t.ref} value={ref} onChange={e => setRef(e.target.value)} maxLength={120} />
            <button disabled={busy} onClick={report} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-emerald-600 font-semibold text-white press disabled:opacity-40">{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t.send}</button>
          </div>
        ) : <button onClick={() => setOpen(true)} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-surface font-semibold shadow-[var(--shadow)] press"><Check className="size-4" />{t.paid}</button>}
      {err && <p className="text-sm text-red-500">{err}</p>}
    </div>
  );
}

/** the line on the booking page before confirming */
export const depositNote = (lang: 'fr' | 'en' | 'ar', cents: number, hours?: number | null) => {
  const m = formatMoney(cents, 'MAD', lang as 'fr');
  return lang === 'ar' ? `هاد الخدمة كتطلب عربون ديال ${m}${hours ? ` (يتخلص فـ ${hours} ساعة)` : ''}، كيتنقص نهار الموعد.`
    : lang === 'en' ? `This service needs a ${m} deposit${hours ? ` (to pay within ${hours} h)` : ''}, deducted on the day.`
    : `Cette prestation demande un acompte de ${m}${hours ? ` (à payer sous ${hours} h)` : ''}, déduit le jour du rendez-vous.`;
};
