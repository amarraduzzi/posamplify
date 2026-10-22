// The review after the visit (?avis=<ticket token>): five stars and a word for the salon. Then every
// client, whatever the stars, is invited to say it on Google too (Google forbids asking only the
// happy ones, so nobody is filtered).
import { useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, Star } from 'lucide-react';
import type { Branding } from '@resto/shared';
import { applyBranding, applyLang } from '../theme';
import { salonFeedback, salonFeedbackGoogle, salonFeedbackInfo, type SalonFeedbackInfo } from '../lib/api';

type Lang = 'fr' | 'ar' | 'en';
const S = {
  fr: { title: 'Comment c’était ?', sub: (s: string) => `Votre avis sur votre visite chez ${s}.`, by: 'avec', word: 'Un mot pour le salon (facultatif)', send: 'Envoyer',
        thanks: 'Merci pour votre avis !', thanksSub: 'Le salon le lit, il compte vraiment.', google: 'Le dire aussi sur Google', googleSub: 'Un avis sur Google aide le salon à se faire connaître.',
        notFound: 'Ce lien a expiré.', error: 'Une erreur est survenue. Réessayez.', change: 'Modifier', stars: ['Pas content', 'Bof', 'Bien', 'Très bien', 'Parfait'] },
  ar: { title: 'كيف كانت الزيارة؟', sub: (s: string) => `رأيك فالزيارة ديالك عند ${s}.`, by: 'مع', word: 'كلمة للصالون (اختياري)', send: 'إرسال',
        thanks: 'شكرا على رأيك!', thanksSub: 'الصالون كيقراه، وكيهمو بزاف.', google: 'قولها حتى فـ Google', googleSub: 'رأيك فـ Google كيعاون الصالون يتعرف.',
        notFound: 'هاد الرابط سالا.', error: 'وقع خطأ. عاود المحاولة.', change: 'تعديل', stars: ['ماشي مزيان', 'عادي', 'مزيان', 'مزيان بزاف', 'ممتاز'] },
  en: { title: 'How was it?', sub: (s: string) => `Your review of your visit to ${s}.`, by: 'with', word: 'A word for the salon (optional)', send: 'Send',
        thanks: 'Thank you for your review!', thanksSub: 'The salon reads it, it really counts.', google: 'Say it on Google too', googleSub: 'A Google review helps the salon get known.',
        notFound: 'This link has expired.', error: 'Something went wrong. Try again.', change: 'Edit', stars: ['Not happy', 'Meh', 'Good', 'Very good', 'Perfect'] },
};
function pickLang(langs: string[] | null | undefined): Lang {
  const ok = (langs?.length ? langs : ['fr']).filter((x): x is Lang => x in S);
  const phone = (navigator.language || '').slice(0, 2) as Lang;
  return ok.includes(phone) ? phone : ok[0] ?? 'fr';
}

export default function AvisApp({ token }: { token: string }) {
  const [x, setX] = useState<SalonFeedbackInfo | null | undefined>(undefined);
  const [lang, setLang] = useState<Lang>('fr');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  useEffect(() => {
    salonFeedbackInfo(token).then(i => {
      setX(i);
      if (!i) return;
      const l = pickLang(i.salon.languages); setLang(l); applyLang(l);
      applyBranding((i.salon.branding ?? {}) as Branding, i.salon.name);
      if (i.done) { setRating(i.done.rating); setComment(i.done.comment ?? ''); setSent(true); }
    }).catch(() => setX(null));
  }, [token]);
  const t = S[lang];
  if (x === undefined) return <main className="grid min-h-dvh place-items-center bg-bg"><Loader2 className="size-6 animate-spin text-muted" /></main>;
  if (!x) return <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center text-muted">{t.notFound}</main>;
  const logo = (x.salon.branding as Branding | null)?.logo_url;
  const send = async () => {
    setBusy(true); setErr(false);
    try { await salonFeedback(token, rating, comment.trim()); setSent(true); } catch { setErr(true); }
    setBusy(false);
  };
  const google = () => { salonFeedbackGoogle(token).catch(() => undefined); };

  return (
    <main className="min-h-dvh bg-bg px-5 pb-12 pt-10 text-ink">
      <div className="mx-auto max-w-md text-center">
        {logo ? <img src={logo} alt="" className="mx-auto size-16 rounded-2xl object-cover" /> : <p className="font-display text-2xl font-semibold">{x.salon.name}</p>}
        {!sent ? <>
          <h1 className="mt-6 font-display text-[1.9rem] font-semibold leading-tight">{t.title}</h1>
          <p className="mt-2 text-muted">{t.sub(x.salon.name)}</p>
          {(x.services.length > 0 || x.staff.length > 0) && <p className="mt-1 text-sm text-muted">{x.services.join(' · ')}{x.staff.length ? ` · ${t.by} ${x.staff.join(', ')}` : ''}</p>}
          <div className="mt-8 flex justify-center gap-2" dir="ltr" role="radiogroup" aria-label={t.title}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} role="radio" aria-checked={rating === n} aria-label={t.stars[n - 1]} onClick={() => setRating(n)} className="press p-1">
                <Star className={`size-11 transition ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-line'}`} strokeWidth={1.5} />
              </button>
            ))}
          </div>
          <p className="mt-2 h-5 text-sm font-semibold text-muted">{rating ? t.stars[rating - 1] : ''}</p>
          {rating > 0 && <>
            <textarea className="mt-5 h-24 w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-start outline-none focus:border-brand" placeholder={t.word} value={comment} onChange={e => setComment(e.target.value)} maxLength={500} />
            <button disabled={busy} onClick={send} className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand text-lg font-semibold text-brand-ink glow-brand press disabled:opacity-40">
              {busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}{t.send}</button>
          </>}
          {err && <p className="mt-3 text-sm text-red-500">{t.error}</p>}
        </> : <>
          <div className="mt-6 flex justify-center gap-1" dir="ltr">{[1, 2, 3, 4, 5].map(n => <Star key={n} className={`size-7 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-line'}`} strokeWidth={1.5} />)}</div>
          <h1 className="mt-4 font-display text-[1.9rem] font-semibold leading-tight">{t.thanks}</h1>
          <p className="mt-2 text-muted">{t.thanksSub}</p>
          {x.review_url && <div className="mt-8 rounded-3xl bg-surface p-5 shadow-[var(--shadow)]">
            <p className="text-sm text-muted">{t.googleSub}</p>
            <a href={x.review_url} target="_blank" rel="noopener" onClick={google} className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand text-lg font-semibold text-brand-ink press">
              <Star className="size-5" />{t.google}<ExternalLink className="size-4 opacity-70" /></a>
          </div>}
          <button onClick={() => setSent(false)} className="mt-6 text-sm font-semibold text-muted underline">{t.change}</button>
        </>}
      </div>
    </main>
  );
}
