// The customer's points card, from a private link: <slug>?carte=<key>. No app, no login: the key in the link is
// the way in. It shows the points, how far the next reward is and the last visits. The colour, the logo and the
// cover photo come from the restaurant's branding, like the sign-up page.
import { useEffect, useState } from 'react';
import { Gift, Loader2, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { inkFor, type Branding } from '@resto/shared';
import { applyBranding, applyLang } from '../theme';
import InstallApp from './InstallApp';
import { customerCard, type CardReward, type CustomerCard } from '../lib/api';

const S = {
  fr: {
    hello: (n: string | null) => (n ? `Bonjour ${n}` : 'Bonjour'), card: 'Votre carte fidélité', pts: 'points', unit: (n: number) => (n === 1 ? 'point' : 'points'),
    toGo: (n: number, dh: number) => `Plus que ${n} ${n === 1 ? 'point' : 'points'} (environ ${dh} DH) pour votre récompense`,
    reward: (m: string) => `${m} offerts`, ready: 'Votre récompense est prête !', readyTxt: (m: string) => `Dites votre numéro à la caisse : ${m} seront déduits de votre addition.`,
    how: 'Comment ça marche', howTxt: (per: number) => `1 point pour chaque ${per} DH dépensés. Échangez vos points contre une récompense de la liste ci-dessus. Donnez votre numéro à la caisse à chaque visite.`,
    rewards: 'Vos récompenses', free: (n: string) => `${n} offert`, pick: 'Donnez votre numéro à la caisse et choisissez votre récompense.', avail: 'Disponible', need: (n: number) => `Encore ${n} pts`, itemNote: 'Déduit de l’addition quand vous le commandez.',
    visits: (n: number) => `${n} ${n === 1 ? 'visite' : 'visites'}`, last: 'Derniers mouvements', earn: 'Points gagnés', redeem: 'Récompense utilisée', none: 'Pas encore de visite. Vos points arriveront ici dès votre prochaine addition.',
    off: 'Le programme de points n’est pas actif pour le moment.', offVisits: 'Merci de votre fidélité.', notFound: 'Carte introuvable. Vérifiez le lien reçu, ou demandez-le à la caisse.', err: 'Impossible de charger la carte. Réessayez.',
    private: 'Cette carte est privée : ne partagez pas son lien.',
  },
  en: {
    hello: (n: string | null) => (n ? `Hello ${n}` : 'Hello'), card: 'Your loyalty card', pts: 'points', unit: (n: number) => (n === 1 ? 'point' : 'points'),
    toGo: (n: number, dh: number) => `Only ${n} ${n === 1 ? 'point' : 'points'} to go (about ${dh} DH) for your reward`,
    reward: (m: string) => `${m} off`, ready: 'Your reward is ready!', readyTxt: (m: string) => `Give your number at the till: ${m} will be taken off your bill.`,
    how: 'How it works', howTxt: (per: number) => `1 point for every ${per} DH you spend. Swap your points for a reward from the list above. Give your number at the till each visit.`,
    rewards: 'Your rewards', free: (n: string) => `Free ${n}`, pick: 'Give your number at the till and choose your reward.', avail: 'Available', need: (n: number) => `${n} pts to go`, itemNote: 'Taken off your bill when you order it.',
    visits: (n: number) => `${n} ${n === 1 ? 'visit' : 'visits'}`, last: 'Latest activity', earn: 'Points earned', redeem: 'Reward used', none: 'No visit yet. Your points will show up here after your next bill.',
    off: 'The points programme is not active right now.', offVisits: 'Thank you for coming back.', notFound: 'Card not found. Check the link you received, or ask for it at the till.', err: 'Could not load the card. Try again.',
    private: 'This card is private: do not share its link.',
  },
  ar: {
    hello: (n: string | null) => (n ? `مرحبا ${n}` : 'مرحبا'), card: 'بطاقة الوفاء الخاصة بكم', pts: 'نقطة', unit: () => 'نقطة',
    toGo: (n: number, dh: number) => `بقيت ${n} نقطة (حوالي ${dh} درهم) للحصول على مكافأتكم`,
    reward: (m: string) => `${m} هدية`, ready: 'مكافأتكم جاهزة!', readyTxt: (m: string) => `أعطوا رقمكم عند الصندوق: سيتم خصم ${m} من الفاتورة.`,
    how: 'كيف يعمل', howTxt: (per: number) => `نقطة واحدة لكل ${per} درهم تنفقونها. بدّلوا نقاطكم بمكافأة من القائمة أعلاه. أعطوا رقمكم عند الصندوق في كل زيارة.`,
    rewards: 'مكافآتكم', free: (n: string) => `${n} مجانا`, pick: 'أعطوا رقمكم عند الصندوق واختاروا مكافأتكم.', avail: 'متاحة', need: (n: number) => `بقيت ${n} نقطة`, itemNote: 'يُخصم من الفاتورة عندما تطلبونه.',
    visits: (n: number) => `${n} زيارة`, last: 'آخر العمليات', earn: 'نقاط مكتسبة', redeem: 'مكافأة مستعملة', none: 'لا توجد زيارة بعد. ستظهر نقاطكم هنا بعد فاتورتكم القادمة.',
    off: 'برنامج النقاط غير مفعل حاليا.', offVisits: 'شكرا لوفائكم.', notFound: 'البطاقة غير موجودة. تحققوا من الرابط الذي وصلكم أو اطلبوه عند الصندوق.', err: 'تعذر تحميل البطاقة. أعيدوا المحاولة.',
    private: 'هذه البطاقة خاصة: لا تشاركوا رابطها.',
  },
};
type Lang = keyof typeof S;
const HEX = /^#[0-9a-f]{6}$/i;

export default function CardPage({ slug, cardKey }: { slug: string; cardKey: string }) {
  const [card, setCard] = useState<CustomerCard | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [lang, setLang] = useState<Lang>('fr');

  useEffect(() => {
    customerCard(slug, cardKey).then(x => {
      setCard(x);
      if (!x) return;
      const langs = (x.restaurant.languages?.length ? x.restaurant.languages : ['fr']).filter((l): l is Lang => l in S);
      const phoneLang = (navigator.language || '').slice(0, 2) as Lang;
      const l = langs.includes(phoneLang) ? phoneLang : langs[0] ?? 'fr';
      setLang(l); applyLang(l);
      applyBranding((x.restaurant.branding ?? {}) as Branding, x.restaurant.name);
    }).catch(() => { setFailed(true); setCard(null); });
  }, [slug, cardKey]);

  const t = S[lang];
  if (card === undefined) return <Screen><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted" /></Screen>;
  if (card === null) return <Screen><p className="text-center text-muted">{failed ? t.err : t.notFound}</p></Screen>;

  const branding = (card.restaurant.branding ?? {}) as Branding;
  const brand = branding.primary_color && HEX.test(branding.primary_color) ? branding.primary_color : '#C2410C';
  const anti = inkFor(brand) === '#ffffff' ? '#000000' : '#ffffff';
  const { loyalty: L, customer: c } = card;
  const per = Math.max(1, Number(L.per_dh) || 10);
  const points = Number(c.points) || 0;
  const rewards = (L.rewards?.length ? L.rewards : [{ id: 'legacy', kind: 'discount' as const, points: Math.max(1, Number(L.reward_points) || 100), cents: Number(L.reward_cents), name: null, image_url: null }])
    .slice().sort((a, b) => a.points - b.points);
  const rname = (rw: CardReward) => rw.kind === 'item'
    ? t.free((rw.name?.[lang] || rw.name?.fr || Object.values(rw.name ?? {}).find(Boolean) || '') as string)
    : t.reward(`${Math.round(Number(rw.cents) / 100)} DH`);
  const next = rewards.find(rw => rw.points > points);
  const target = next ?? rewards[rewards.length - 1];
  const need = target.points;
  const ready = L.enabled && rewards.some(rw => points >= rw.points);
  const left = Math.max(0, need - points);
  const pct = Math.min(100, Math.round((points / need) * 100));
  const when = (iso: string) => new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-MA-u-nu-latn' : lang === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short' });
  const logo = branding.logo_url;

  return (
    <main className="min-h-dvh bg-bg" style={{ '--anti': anti } as React.CSSProperties}>
      <section className="club-hero relative isolate overflow-hidden px-6 pb-24 pt-9 text-center text-brand-ink">
        {branding.cover_url && <>
          <img src={branding.cover_url} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
          <div className="absolute inset-0 -z-10" style={{ background: 'color-mix(in srgb, var(--brand) 78%, transparent)' }} aria-hidden="true" />
        </>}
        <div className="pointer-events-none absolute inset-0 -z-10 fade-down" aria-hidden="true"><div className="zellige-ink absolute inset-0 opacity-[.13]" /></div>
        <div className="mx-auto max-w-md">
          {logo
            ? <div className="mx-auto w-fit rounded-[1.5rem] bg-white p-1.5 shadow-[0_18px_40px_-14px_rgba(0,0,0,.55)] ring-4 ring-white/25"><img src={logo} alt={card.restaurant.name} className="h-16 w-16 rounded-[1.1rem] object-cover" /></div>
            : <p className="font-display text-2xl font-semibold">{card.restaurant.name}</p>}
          <p className="mt-5 text-sm font-semibold opacity-85">{t.card}</p>
          <h1 className="mt-1 font-display text-[2rem] font-semibold leading-tight">{t.hello(c.name)}</h1>
        </div>
      </section>

      <div className="relative z-10 mx-auto -mt-16 max-w-md px-5 pb-10">
        {!L.enabled ? (
          <div className="rounded-[1.8rem] bg-surface p-6 text-center shadow-[0_18px_40px_-20px_rgba(0,0,0,.45)]">
            <Sparkles className="mx-auto h-10 w-10 text-brand" />
            <p className="mt-3 font-semibold">{t.offVisits}</p>
            <p className="mt-1 text-sm text-muted">{t.visits(Number(c.visits) || 0)}</p>
            <p className="mt-3 text-sm text-muted">{t.off}</p>
          </div>
        ) : (<>
          <div className="rounded-[1.8rem] bg-surface p-6 text-center shadow-[0_18px_40px_-20px_rgba(0,0,0,.45)]">
            <p className="font-display text-[4.2rem] font-semibold leading-none tabular" aria-label={`${points} ${t.pts}`}>{points}</p>
            <p className="mt-1 text-sm font-semibold text-muted">{t.unit(points)} · {t.visits(Number(c.visits) || 0)}</p>

            <div className="mt-6" role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={Math.min(points, need)}>
              <div className="h-3.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs font-semibold text-muted tabular"><span>0</span><span className="flex items-center gap-1"><Gift className="h-3.5 w-3.5" />{need} · {rname(target)}</span></div>
            </div>

            {ready
              ? <div className="mt-5 rounded-2xl p-4" style={{ background: 'color-mix(in srgb, var(--brand) 14%, var(--surface-2))' }}>
                  <p className="flex items-center justify-center gap-2 font-display text-xl font-semibold"><Star className="h-5 w-5 text-brand" />{t.ready}</p>
                  <p className="mt-1 text-sm">{t.pick}</p>
                </div>
              : next ? <p className="mt-5 text-sm font-semibold">{t.toGo(left, left * per)}</p> : null}
          </div>

          <div className="mt-4 rounded-[1.4rem] bg-surface-2 p-5">
            <p className="text-sm font-semibold">{t.rewards}</p>
            <ul className="mt-2 divide-y divide-black/5">
              {rewards.map(rw => {
                const ok = points >= rw.points;
                return (
                  <li key={rw.id} className="flex items-center gap-3 py-3 text-sm">
                    {rw.image_url
                      ? <img src={rw.image_url} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                      : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-surface text-brand"><Gift className="h-5 w-5" /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{rname(rw)}</span>
                      <span className="block text-xs text-muted tabular">{rw.points} {t.pts}{rw.kind === 'item' ? ` · ${t.itemNote}` : ''}</span>
                    </span>
                    <span className={`shrink-0 text-xs font-bold ${ok ? 'text-ink' : 'text-muted'}`}>{ok ? t.avail : t.need(rw.points - points)}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-4 rounded-[1.4rem] bg-surface-2 p-5">
            <p className="text-sm font-semibold">{t.how}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{t.howTxt(per)}</p>
          </div>

          <div className="mt-4 rounded-[1.4rem] bg-surface-2 p-5">
            <p className="text-sm font-semibold">{t.last}</p>
            {card.recent.length === 0
              ? <p className="mt-2 text-sm text-muted">{t.none}</p>
              : <ul className="mt-2 divide-y divide-black/5">
                  {card.recent.map((m, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span><span className="font-medium">{m.reason === 'redeem' ? `${t.redeem}${m.name ? ` · ${m.name}` : ''}` : t.earn}</span> <span className="text-muted">· {when(m.at)}</span></span>
                      <span className={`font-semibold tabular ${m.points < 0 ? 'text-muted' : 'text-brand'}`} dir="ltr">{m.points > 0 ? '+' : ''}{m.points}</span>
                    </li>
                  ))}
                </ul>}
          </div>
        </>)}

        <InstallApp name={card.restaurant.name} brand={brand} logo={logo} cardKey={cardKey} lang={lang} />

        <p className="mt-6 flex items-start justify-center gap-1.5 text-center text-xs text-muted"><ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" /><span>{t.private}</span></p>
        <p className="mt-4 text-center text-[0.7rem] font-medium tracking-wide text-muted">Powered by Amplify</p>
      </div>
    </main>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">{children}</main>;
}
