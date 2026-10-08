// The courier's page: his deliveries, call / WhatsApp / directions, picked up, and delivered with the
// guest's 4-digit code (proof of delivery). No app, no login: the secret link from the till.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bike, Check, MapPin, MessageCircle, Navigation, Phone, RefreshCw } from 'lucide-react';
import { formatMoney } from '@resto/shared';
import { courierOrders, courierUpdate, type CourierOrder, type CourierPage } from '../lib/api';

const S = {
  fr: {
    hello: (n: string) => `Bonjour ${n}`, done: (n: number) => `${n} livrée(s) aujourd’hui`, cash: 'Espèces à rapporter', none: 'Aucune livraison pour le moment.', noneHint: 'La page se met à jour toute seule.',
    call: 'Appeler', directions: 'Itinéraire', toCollect: 'À encaisser', paid: 'Déjà payée', picked: 'J’ai récupéré la commande', notReady: 'Pas encore prête en cuisine',
    deliver: 'Livrée : entrer le code', code: 'Code donné par le client', confirm: 'Valider la livraison', wrong: (n: number) => `Code incorrect. Encore ${n} essai(s).`,
    tooMany: 'Trop d’essais. Appelez le restaurant.', problem: 'Un problème ?', reasons: ['Client absent', 'Adresse introuvable', 'Le client refuse la commande', 'Autre'],
    other: 'Expliquez en quelques mots', send: 'Signaler au restaurant', cancel: 'Annuler', onWay: 'En route', assigned: 'À récupérer', notFound: 'Ce lien n’est plus valable. Demandez un nouveau lien au restaurant.',
    error: 'Pas de connexion. Réessayez.', for: (h: string) => `pour ${h}`, ready: (h: string) => `prête vers ${h}`,
  },
  ar: {
    hello: (n: string) => `مرحبا ${n}`, done: (n: number) => `${n} تسليم اليوم`, cash: 'النقود المطلوب إرجاعها', none: 'لا توجد توصيلات حاليا.', noneHint: 'تتحدث الصفحة تلقائيا.',
    call: 'اتصال', directions: 'الاتجاهات', toCollect: 'للتحصيل', paid: 'مدفوعة مسبقا', picked: 'استلمت الطلب', notReady: 'لم تجهز بعد في المطبخ',
    deliver: 'تم التسليم: أدخل الرمز', code: 'الرمز الذي أعطاه الزبون', confirm: 'تأكيد التسليم', wrong: (n: number) => `رمز خاطئ. بقيت ${n} محاولة.`,
    tooMany: 'محاولات كثيرة. اتصل بالمطعم.', problem: 'مشكلة؟', reasons: ['الزبون غائب', 'العنوان غير موجود', 'الزبون يرفض الطلب', 'أخرى'],
    other: 'اشرح بكلمات قليلة', send: 'إبلاغ المطعم', cancel: 'إلغاء', onWay: 'في الطريق', assigned: 'للاستلام', notFound: 'هذا الرابط لم يعد صالحا. اطلب رابطا جديدا من المطعم.',
    error: 'لا يوجد اتصال. حاول مرة أخرى.', for: (h: string) => `لـ ${h}`, ready: (h: string) => `جاهزة حوالي ${h}`,
  },
};
type Lang = keyof typeof S;
const intl = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '212' + d.slice(1) : d; };

export default function CourierApp({ token }: { token: string }) {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('courier-lang') === 'ar' ? 'ar' : 'fr'));
  const t = S[lang];
  const [page, setPage] = useState<CourierPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setPage(await courierOrders(token)); setError(null); }
    catch (e) { setError(/not_found/.test(String((e as Error).message)) ? 'notFound' : 'error'); }
  }, [token]);
  useEffect(() => { load(); const iv = setInterval(() => { if (!document.hidden) load(); }, 20_000); return () => clearInterval(iv); }, [load]);
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; try { localStorage.setItem('courier-lang', lang); } catch { /* private mode */ } }, [lang]);
  const tz = page?.restaurant.timezone ?? 'Africa/Casablanca';
  const hm = (iso: string) => new Date(iso).toLocaleTimeString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

  if (error === 'notFound') return <main className="grid min-h-dvh place-items-center bg-bg p-8 text-center text-ink"><p>{t.notFound}</p></main>;
  return (
    <main className="min-h-dvh bg-bg pb-10 text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-brand text-brand-ink"><Bike className="size-5" /></span>
          <div className="min-w-0 flex-1"><p className="truncate font-semibold">{page ? t.hello(page.courier.name.split(' ')[0]) : '…'}</p><p className="truncate text-xs text-muted">{page?.restaurant.name}</p></div>
          <button onClick={() => setLang(lang === 'fr' ? 'ar' : 'fr')} className="rounded-full bg-surface-2 px-3 py-1.5 text-sm font-bold">{lang === 'fr' ? 'ع' : 'FR'}</button>
          <button onClick={load} aria-label="refresh" className="grid size-9 place-items-center rounded-full bg-surface-2"><RefreshCw className="size-4" /></button>
        </div>
      </header>
      <div className="mx-auto max-w-md space-y-3 px-4 pt-4">
        {error && <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-danger">{t.error}</p>}
        {page && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <p className="rounded-2xl card px-4 py-3"><b className="block font-display text-2xl">{page.done_today}</b>{t.done(page.done_today).replace(/^\d+ /, '')}</p>
            <p className="rounded-2xl card px-4 py-3"><b className="block font-display text-2xl" dir="ltr">{formatMoney(page.cash_to_return_cents, 'MAD', lang)}</b>{t.cash}</p>
          </div>
        )}
        {page && !page.orders.length && <div className="py-16 text-center text-muted"><Bike className="mx-auto size-12 opacity-40" /><p className="mt-3 text-lg">{t.none}</p><p className="text-sm">{t.noneHint}</p></div>}
        {page?.orders.map(o => <Delivery key={o.id} o={o} token={token} lang={lang} hm={hm} city={page.restaurant.city} onChanged={load} />)}
      </div>
    </main>
  );
}

function Delivery({ o, token, lang, hm, city, onChanged }: { o: CourierOrder; token: string; lang: Lang; hm: (iso: string) => string; city: string | null; onChanged: () => void }) {
  const t = S[lang];
  const [mode, setMode] = useState<null | 'code' | 'problem'>(null);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const maps = o.location ? `https://www.google.com/maps/dir/?api=1&destination=${o.location.lat},${o.location.lng}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([o.address, city].filter(Boolean).join(', '))}`;
  const act = async (action: 'picked_up' | 'delivered' | 'failed') => {
    setBusy(true); setMsg(null);
    try {
      const r = await courierUpdate(token, o.id, action, action === 'delivered' ? code : undefined, action === 'failed' ? (reason === t.reasons[3] ? other : reason) : undefined);
      if (!r.ok) setMsg(t.wrong(r.tries_left ?? 0)); else { setMode(null); onChanged(); }
    } catch (e) { setMsg(/too_many_tries/.test(String((e as Error).message)) ? t.tooMany : t.error); }
    setBusy(false);
  };
  return (
    <article className="overflow-hidden rounded-3xl card">
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <p className="font-display text-2xl font-semibold" dir="ltr">#{o.ticket_number}</p>
          <p className="truncate font-semibold">{o.customer_name}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${o.status === 'picked_up' ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{o.status === 'picked_up' ? t.onWay : t.assigned}</span>
      </div>
      <p className="flex items-start gap-1.5 px-4 pt-2 text-[15px]"><MapPin className="mt-0.5 size-4 shrink-0 text-brand" />{o.address}</p>
      {o.note && <p className="mx-4 mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">{o.note}</p>}
      <p className="px-4 pt-2 text-xs text-muted">{o.items.map(i => `${i.q}× ${i.name}`).join(' · ')}</p>
      <div className="flex flex-wrap gap-2 px-4 pt-2 text-xs">
        {o.wanted_at && <span className="rounded-full bg-surface-2 px-2 py-0.5">{t.for(hm(o.wanted_at))}</span>}
        {o.eta_at && <span className="rounded-full bg-surface-2 px-2 py-0.5">{t.ready(hm(o.eta_at))}</span>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 px-4">
        {o.customer_phone && <a href={`tel:${o.customer_phone}`} className="flex flex-col items-center gap-1 rounded-2xl bg-surface-2 py-2.5 text-xs font-semibold"><Phone className="size-5" />{t.call}</a>}
        {o.customer_phone && <a href={`https://wa.me/${intl(o.customer_phone)}`} target="_blank" rel="noopener" className="flex flex-col items-center gap-1 rounded-2xl bg-surface-2 py-2.5 text-xs font-semibold"><MessageCircle className="size-5" />WhatsApp</a>}
        <a href={maps} target="_blank" rel="noopener" className="flex flex-col items-center gap-1 rounded-2xl bg-surface-2 py-2.5 text-xs font-semibold"><Navigation className="size-5" />{t.directions}</a>
      </div>
      <p className="mx-4 mt-3 flex items-center justify-between rounded-2xl border border-line px-4 py-2.5">
        <span className="text-sm">{o.paid ? t.paid : t.toCollect}</span>
        <b className="font-display text-2xl" dir="ltr">{o.paid ? '✓' : formatMoney(o.total_cents, 'MAD', lang)}</b>
      </p>
      <div className="space-y-2 p-4">
        {o.status === 'assigned' && <>
          {!o.kitchen_ready && <p className="text-center text-xs text-muted">{t.notReady}</p>}
          <button disabled={busy} onClick={() => act('picked_up')} className="h-14 w-full rounded-2xl bg-brand text-lg font-semibold text-brand-ink press disabled:opacity-50">{t.picked}</button>
        </>}
        {o.status === 'picked_up' && mode !== 'code' && <button onClick={() => { setMode('code'); setMsg(null); }} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-lg font-semibold text-brand-ink press"><Check className="size-5" />{t.deliver}</button>}
        {mode === 'code' && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t.code}</p>
            <input autoFocus inputMode="numeric" maxLength={4} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} dir="ltr"
              className="h-16 w-full rounded-2xl border border-line bg-surface text-center font-display text-4xl tracking-[0.5em] outline-none focus:border-brand" placeholder="····" />
            {msg && <p className="text-sm font-semibold text-danger">{msg}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode(null)} className="h-12 rounded-2xl bg-surface-2 font-semibold">{t.cancel}</button>
              <button disabled={busy || code.length !== 4} onClick={() => act('delivered')} className="h-12 rounded-2xl bg-brand font-semibold text-brand-ink disabled:opacity-50">{t.confirm}</button>
            </div>
          </div>
        )}
        {mode === 'problem' ? (
          <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
            <div className="flex flex-wrap gap-2">{t.reasons.map(x => <button key={x} onClick={() => setReason(x)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${reason === x ? 'bg-danger text-white' : 'bg-surface'}`}>{x}</button>)}</div>
            {reason === t.reasons[3] && <input value={other} maxLength={160} onChange={e => setOther(e.target.value)} placeholder={t.other} className="h-11 w-full rounded-xl border border-line bg-surface px-3 outline-none" />}
            {msg && <p className="text-sm font-semibold text-danger">{msg}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode(null)} className="h-11 rounded-xl bg-surface font-semibold">{t.cancel}</button>
              <button disabled={busy || !reason || (reason === t.reasons[3] && !other.trim())} onClick={() => act('failed')} className="h-11 rounded-xl bg-danger font-semibold text-white disabled:opacity-50">{t.send}</button>
            </div>
          </div>
        ) : mode !== 'code' && <button onClick={() => { setMode('problem'); setMsg(null); }} className="flex w-full items-center justify-center gap-1.5 py-2 text-sm font-semibold text-muted"><AlertTriangle className="size-4" />{t.problem}</button>}
      </div>
    </article>
  );
}
