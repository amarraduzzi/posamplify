// The restaurant's website: switch it on, pick a style, write the welcome text, add photos and
// links, and (later) connect its own domain. Logo, cover photo and tagline come from Restaurant.
import { useState } from 'react';
import { Copy, ExternalLink, Globe, Image as ImageIcon, Save, Search, Trash2 } from 'lucide-react';
import { supabase, SITE_URL } from '../lib/supabase';
import { check } from '../lib/api';
import { uploadImage } from '../lib/image';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, I18nInput, ImageField, Toggle, inputCls } from '../components/ui';

type Site = NonNullable<Restaurant['site']>;
// i18n:values
const THEMES: { k: Site['theme']; name: string; text: string; sw: [string, string, string] }[] = [
  { k: 'nuit', name: 'Nuit', text: 'Plein écran et cinéma : grande photo ou vidéo, plats en bande défilante. Pour un lieu du soir.', sw: ['#12100E', '#1C1915', '#C9A15A'] },
  { k: 'riad', name: 'Riad', text: 'Arches, zellige et carte à l’ancienne. Pour une cuisine marocaine ou un lieu de caractère.', sw: ['#EFE3D1', '#F7EEE1', '#1E5B4F'] },
  { k: 'moderne', name: 'Moderne', text: 'Clair, grandes cartes photo. Pour un snack, un brunch ou une chaîne.', sw: ['#FFFFFF', '#F2F2EE', '#2540C9'] },
];
const PRICES: [string, string][] = [['', '–'], ['$', 'Abordable'], ['$$', 'Moyen'], ['$$$', 'Haut de gamme']];
// i18n:end
const https = (u?: string) => !u || /^https:\/\/\S+$/.test(u);

export function SitePage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [s, setS] = useState<Site>({ theme: 'nuit', gallery: [], ...(r.site ?? {}) });
  const [busy, setBusy] = useState(false);
  const owner = a.canEditProfile;
  const link = s.domain ? `https://${s.domain}` : `${SITE_URL}/${r.slug}`;
  const preview = `${SITE_URL}/${r.slug}`;
  const set = (p: Partial<Site>) => setS(x => ({ ...x, ...p }));
  const waOk = !s.whatsapp || /^\+?[0-9 ]{9,20}$/.test(s.whatsapp);
  const ok = waOk && [s.instagram, s.facebook, s.tiktok, s.maps_url, s.video_url].every(https) && (!s.domain || /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(s.domain));
  const save = async () => {
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries({ ...s, domain: s.domain?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || undefined }).filter(([, v]) => v !== '' && v !== undefined));
      check(await supabase.from('restaurants').update({ site: clean }).eq('id', r.id).select('id'));
      a.toast(t('Enregistré')); await a.reload();
    } catch (e) { a.fail(/restaurants_site_domain_idx/.test(String((e as Error).message)) ? new Error(t('Ce domaine est déjà utilisé par un autre restaurant.')) : e); }
    setBusy(false);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  const tagline = r.branding?.tagline?.[r.languages[0]] ?? '';
  const title = `${r.name}${s.cuisine ? ` · ${s.cuisine}` : tagline ? ` · ${tagline}` : ''}${r.city ? ` ${t('à')} ${r.city}` : ''}`;
  const desc = (s.about?.[r.languages[0]] || tagline || r.name).slice(0, 158);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand">Amplify</p>
        <h1 className="font-display text-3xl font-semibold">{t('Site web')}</h1>
        <p className="text-muted">{t('Un vrai site pour votre restaurant, fait pour Google et pour le téléphone : votre carte, vos horaires, l’itinéraire, et les boutons Commander et Réserver. Il se met à jour tout seul quand vous changez la carte.')}</p>
      </div>

      <div className="night flex flex-wrap items-center gap-4 rounded-[2rem] p-6">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/20 text-brand"><Globe className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{r.site?.enabled ? t('Votre site est en ligne') : t('Votre site n’est pas encore en ligne')}</p>
          <p className="truncate text-sm text-white/60" dir="ltr">{link}</p>
        </div>
        <Btn className="px-3 py-1.5 text-sm" onClick={copy}><Copy className="h-4 w-4" /> {t('Copier')}</Btn>
        <a href={preview} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/15"><ExternalLink className="h-4 w-4" /> {t('Voir le site')}</a>
      </div>

      <fieldset disabled={!owner} className="space-y-5">
        <Card>
          <Toggle checked={!!s.enabled} onChange={v => set({ enabled: v })} label={t('Mettre le site en ligne (visible sur Google)')} />
          <h2 className="mb-3 mt-6 font-display text-xl font-semibold">{t('Style')}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {THEMES.map(th => (
              <button key={th.k} type="button" onClick={() => set({ theme: th.k })}
                className={`rounded-2xl border-2 p-4 text-start transition ${s.theme === th.k ? 'border-brand' : 'border-line/10 hover:border-line/30'}`}>
                <div className="mb-3 flex h-16 overflow-hidden rounded-xl" style={{ background: th.sw[0] }}>
                  <div className="m-2 flex-1 rounded-lg" style={{ background: th.sw[1] }} /><div className="m-2 ms-0 w-10 rounded-full" style={{ background: th.sw[2] }} />
                </div>
                <p className="font-semibold">{t(th.name)}</p><p className="text-sm text-muted">{t(th.text)}</p>
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted">{t('La couleur principale, le logo, la photo de couverture et le slogan viennent de la page Restaurant.')}</p>
        </Card>

        <Card>
          <h2 className="mb-4 font-display text-xl font-semibold">{t('Présentation')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Type de cuisine')}><input className={inputCls} maxLength={60} value={s.cuisine ?? ''} onChange={e => set({ cuisine: e.target.value })} placeholder={t('Café, brunch, pizzas')} /></Field>
            <Field label={t('Gamme de prix')}><select className={inputCls} value={s.price_range ?? ''} onChange={e => set({ price_range: e.target.value })}>{PRICES.map(([v, l]) => <option key={v} value={v}>{v ? `${v} · ${t(l)}` : l}</option>)}</select></Field>
          </div>
          <div className="mt-4"><Field group label={t('Texte de bienvenue')}><I18nInput multiline max={700} langs={r.languages} value={s.about ?? {}} onChange={v => set({ about: v })} /></Field></div>
          <p className="mt-2 text-xs text-muted">{t('Deux ou trois phrases : votre histoire, votre quartier, ce qu’on vient chercher chez vous. Google lit ce texte.')}</p>
        </Card>

        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><ImageIcon className="h-5 w-5 text-brand" />{t('Photos')}</h2>
          <p className="mb-4 text-sm text-muted">{t('La salle, la terrasse, l’équipe, vos plats. Jusqu’à 6 photos. Sans photo, le site montre celles de votre carte.')}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(s.gallery ?? []).map((u, i) => (
              <div key={u + i} className="relative">
                <img src={u} alt="" className="aspect-[4/3] w-full rounded-2xl object-cover" />
                <button type="button" aria-label={t('Supprimer')} onClick={() => set({ gallery: s.gallery!.filter((_, j) => j !== i) })} className="absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {(s.gallery ?? []).length < 6 && <ImageField url={null} onChange={u => u && set({ gallery: [...(s.gallery ?? []), u] })} upload={f => uploadImage(r.id, 'site', f, 1600)} />}
          </div>
          {s.theme === 'nuit' && <div className="mt-4"><Field label={t('Vidéo d’accueil (facultatif)')}><input className={inputCls} dir="ltr" value={s.video_url ?? ''} onChange={e => set({ video_url: e.target.value.trim() })} placeholder="https://…/video.mp4" /></Field>
            <p className="mt-1 text-xs text-muted">{t('Une vidéo courte et sans son, en .mp4, moins de 8 Mo. Elle tourne en boucle en haut du site. La photo de couverture s’affiche pendant le chargement.')}</p></div>}
        </Card>

        <Card>
          <h2 className="mb-1 font-display text-xl font-semibold">{t('Commandes sur WhatsApp')}</h2>
          <p className="mb-4 text-sm text-muted">{t('Si la commande en ligne est coupée, vos clients choisissent leurs plats sur le site et vous envoient leur commande sur WhatsApp, déjà rédigée. Si elle est active, les boutons Commander mènent à votre commande en ligne.')}</p>
          <Toggle checked={s.wa_order !== false} onChange={v => set({ wa_order: v })} label={t('Recevoir les commandes sur WhatsApp')} />
          {s.wa_order !== false && <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t('Numéro WhatsApp')}><input className={inputCls} dir="ltr" inputMode="tel" value={s.whatsapp ?? ''} onChange={e => set({ whatsapp: e.target.value })} placeholder={r.phone ?? '06 12 34 56 78'} /></Field>
            <div className="pt-7"><Toggle checked={s.wa_delivery !== false} onChange={v => set({ wa_delivery: v })} label={t('Proposer la livraison')} /></div>
          </div>}
          {!waOk && <p className="mt-2 text-sm text-danger">{t('Numéro invalide')}</p>}
          <p className="mt-2 text-xs text-muted">{t('Vide : le numéro de la page Restaurant est utilisé.')}</p>
        </Card>

        <Card>
          <h2 className="mb-4 font-display text-xl font-semibold">{t('Liens')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Instagram"><input className={inputCls} dir="ltr" value={s.instagram ?? ''} onChange={e => set({ instagram: e.target.value.trim() })} placeholder="https://instagram.com/…" /></Field>
            <Field label="Facebook"><input className={inputCls} dir="ltr" value={s.facebook ?? ''} onChange={e => set({ facebook: e.target.value.trim() })} placeholder="https://facebook.com/…" /></Field>
            <Field label="TikTok"><input className={inputCls} dir="ltr" value={s.tiktok ?? ''} onChange={e => set({ tiktok: e.target.value.trim() })} placeholder="https://tiktok.com/@…" /></Field>
            <Field label={t('Lien Google Maps (facultatif)')}><input className={inputCls} dir="ltr" value={s.maps_url ?? ''} onChange={e => set({ maps_url: e.target.value.trim() })} placeholder="https://maps.app.goo.gl/…" /></Field>
          </div>
          {![s.instagram, s.facebook, s.tiktok, s.maps_url].every(https) && <p className="mt-2 text-sm text-danger">{t('Les liens doivent commencer par https://')}</p>}
        </Card>

        <Card>
          <h2 className="mb-1 font-display text-xl font-semibold">{t('Votre propre domaine')}</h2>
          <p className="mb-4 text-sm text-muted">{t('Par exemple domscafe.ma. Indiquez-le ici, puis envoyez-nous un message : nous le relions à votre site et vous expliquons le réglage à faire chez votre hébergeur de domaine.')}</p>
          <Field label={t('Domaine')}><input className={inputCls} dir="ltr" value={s.domain ?? ''} onChange={e => set({ domain: e.target.value.trim().toLowerCase() })} placeholder="www.monrestaurant.ma" /></Field>
        </Card>

        <Card>
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold"><Search className="h-5 w-5 text-brand" />{t('Aperçu Google')}</h2>
          <div className="rounded-2xl bg-white p-4 text-start" dir="ltr">
            <p className="truncate text-sm text-[#202124]">{link.replace(/^https:\/\//, '')}</p>
            <p className="truncate text-xl text-[#1a0dab]">{title}</p>
            <p className="line-clamp-2 text-sm text-[#4d5156]">{desc}</p>
          </div>
        </Card>
      </fieldset>
      {owner && <div className="sticky bottom-4 flex justify-end"><Btn tone="brand" disabled={busy || !ok} onClick={save} className="shadow-xl"><Save className="h-4 w-4" /> {t('Enregistrer')}</Btn></div>}
    </div>
  );
}
