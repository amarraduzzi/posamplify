// The salon's website (module "Site du salon"): switch it on, the welcome text, photos of the salon,
// before/after photos (only shown once the salon ticks that the client agreed), the Google reviews
// link and the social links. The prestations, the team, the hours and the live wait come by themselves.
import { useState } from 'react';
import { Copy, ExternalLink, Globe, Image as ImageIcon, Save, ShieldCheck, SplitSquareHorizontal, Star, Trash2 } from 'lucide-react';
import { supabase, SITE_URL } from '../lib/supabase';
import { check } from '../lib/api';
import { uploadImage } from '../lib/image';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { t } from '../lib/i18n';
import { Btn, Card, Field, I18nInput, ImageField, Toggle, inputCls } from '../components/ui';
import { SiteStats } from '../components/SiteStats';

type BA = { before: string; after: string; caption?: string; consent?: boolean };
type Site = NonNullable<Restaurant['site']> & { reviews_url?: string; before_after?: BA[] };
const https = (u?: string) => !u || /^https:\/\/\S+$/.test(u);

export function SalonSitePage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [s, setS] = useState<Site>({ gallery: [], before_after: [], ...((r.site ?? {}) as Site) });
  const [busy, setBusy] = useState(false);
  const [pair, setPair] = useState<BA>({ before: '', after: '', caption: '', consent: false });
  const owner = a.canEditProfile;
  const link = s.domain ? `https://${s.domain}` : `${SITE_URL}/${r.slug}`;
  const set = (p: Partial<Site>) => setS(x => ({ ...x, ...p }));
  const ok = [s.instagram, s.facebook, s.tiktok, s.maps_url, s.reviews_url].every(https) && (!s.domain || /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(s.domain));
  const save = async () => {
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries({ ...s, domain: s.domain?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || undefined }).filter(([, v]) => v !== '' && v !== undefined));
      check(await supabase.from('restaurants').update({ site: clean }).eq('id', r.id).select('id'));
      a.toast(t('Enregistré')); await a.reload();
    } catch (e) { a.fail(/restaurants_site_domain_idx/.test(String((e as Error).message)) ? new Error(t('Ce domaine est déjà utilisé.')) : e); }
    setBusy(false);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  const addPair = () => {
    if (!pair.before || !pair.after || !pair.consent) return;
    set({ before_after: [...(s.before_after ?? []), { ...pair, caption: pair.caption?.trim() || undefined }].slice(0, 6) });
    setPair({ before: '', after: '', caption: '', consent: false });
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl font-semibold">{t('Site du salon')}</h1>
        <p className="text-muted">{t('Un site à votre nom, fait pour Google et le téléphone : vos prestations et vos prix, votre équipe, vos photos avant/après, l’attente en direct et le bouton de réservation. Il se met à jour tout seul.')}</p>
      </div>

      <div className="night flex flex-wrap items-center gap-4 rounded-[2rem] p-6">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/20 text-brand"><Globe className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{r.site?.enabled ? t('Votre site est en ligne') : t('Votre site n’est pas encore en ligne')}</p>
          <p className="truncate text-sm text-white/60" dir="ltr">{link}</p>
        </div>
        <Btn className="px-3 py-1.5 text-sm" onClick={copy}><Copy className="h-4 w-4" /> {t('Copier')}</Btn>
        <a href={`${SITE_URL}/${r.slug}`} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/15"><ExternalLink className="h-4 w-4" /> {t('Voir le site')}</a>
      </div>

      <SiteStats r={r} />

      <fieldset disabled={!owner} className="space-y-5">
        <Card>
          <Toggle checked={!!s.enabled} onChange={v => set({ enabled: v })} label={t('Mettre le site en ligne (visible sur Google)')} />
          <div className="mt-5"><Field group label={t('Texte de bienvenue')}><I18nInput multiline max={500} langs={r.languages} value={s.about ?? {}} onChange={v => set({ about: v })} /></Field></div>
          <p className="mt-2 text-xs text-muted">{t('Deux phrases : votre quartier, votre spécialité, ce qu’on vient chercher chez vous. La couleur, le logo, la photo de couverture et le slogan viennent de la page Salon.')}</p>
        </Card>

        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><SplitSquareHorizontal className="h-5 w-5 text-brand" />{t('Avant / après')}</h2>
          <p className="mb-4 text-sm text-muted">{t('Le visiteur fait glisser pour comparer. Jusqu’à 6. Une photo n’apparaît sur le site que si la cliente a donné son accord.')}</p>
          {(s.before_after ?? []).length > 0 && (
            <ul className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.before_after!.map((x, i) => (
                <li key={x.before + i} className="relative overflow-hidden rounded-2xl bg-surface-2">
                  <div className="grid grid-cols-2"><img src={x.before} alt="" className="aspect-[4/5] w-full object-cover" /><img src={x.after} alt="" className="aspect-[4/5] w-full object-cover" /></div>
                  <p className="flex items-center gap-2 px-3 py-2 text-sm"><ShieldCheck className="h-4 w-4 text-brand" /><span className="flex-1 truncate font-semibold">{x.caption || t('Sans titre')}</span></p>
                  <button type="button" aria-label={t('Supprimer')} onClick={() => set({ before_after: s.before_after!.filter((_, j) => j !== i) })} className="absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
          {(s.before_after ?? []).length < 6 && (
            <div className="space-y-3 rounded-2xl border border-dashed border-line/30 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="mb-1 text-sm font-semibold">{t('Avant')}</p><ImageField aspect="aspect-[4/5]" url={pair.before || null} onChange={u => setPair(p => ({ ...p, before: u ?? '' }))} upload={f => uploadImage(r.id, 'site', f, 1200)} /></div>
                <div><p className="mb-1 text-sm font-semibold">{t('Après')}</p><ImageField aspect="aspect-[4/5]" url={pair.after || null} onChange={u => setPair(p => ({ ...p, after: u ?? '' }))} upload={f => uploadImage(r.id, 'site', f, 1200)} /></div>
              </div>
              <Field label={t('Prestation (facultatif)')}><input className={inputCls} maxLength={40} value={pair.caption} onChange={e => setPair(p => ({ ...p, caption: e.target.value }))} placeholder={t('Balayage, couleur, lissage…')} /></Field>
              <label className="flex items-start gap-3 rounded-xl bg-brand/5 p-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={!!pair.consent} onChange={e => setPair(p => ({ ...p, consent: e.target.checked }))} />
                <span>{t('La cliente a accepté que ces photos soient publiées sur le site du salon.')}</span>
              </label>
              <div className="flex justify-end"><Btn tone="brand" disabled={!pair.before || !pair.after || !pair.consent} onClick={addPair}>{t('Ajouter')}</Btn></div>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><ImageIcon className="h-5 w-5 text-brand" />{t('Photos du salon')}</h2>
          <p className="mb-4 text-sm text-muted">{t('L’entrée, les fauteuils, l’ambiance. Jusqu’à 6 photos.')}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(s.gallery ?? []).map((u, i) => (
              <div key={u + i} className="relative">
                <img src={u} alt="" className="aspect-square w-full rounded-2xl object-cover" />
                <button type="button" aria-label={t('Supprimer')} onClick={() => set({ gallery: s.gallery!.filter((_, j) => j !== i) })} className="absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {(s.gallery ?? []).length < 6 && <ImageField url={null} onChange={u => u && set({ gallery: [...(s.gallery ?? []), u] })} upload={f => uploadImage(r.id, 'site', f, 1600)} />}
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Star className="h-5 w-5 text-brand" />{t('Avis Google')}</h2>
          <p className="mb-4 text-sm text-muted">{t('Le lien de votre fiche Google. Le site affiche un bouton vers vos avis : il ne montre jamais d’avis ni de note inventés.')}</p>
          <Field label={t('Lien vers vos avis Google')}><input className={inputCls} dir="ltr" value={s.reviews_url ?? ''} onChange={e => set({ reviews_url: e.target.value.trim() })} placeholder="https://g.page/r/…" /></Field>
        </Card>

        <Card>
          <h2 className="mb-4 font-display text-xl font-semibold">{t('Liens')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Instagram"><input className={inputCls} dir="ltr" value={s.instagram ?? ''} onChange={e => set({ instagram: e.target.value.trim() })} placeholder="https://instagram.com/…" /></Field>
            <Field label="TikTok"><input className={inputCls} dir="ltr" value={s.tiktok ?? ''} onChange={e => set({ tiktok: e.target.value.trim() })} placeholder="https://tiktok.com/@…" /></Field>
            <Field label="Facebook"><input className={inputCls} dir="ltr" value={s.facebook ?? ''} onChange={e => set({ facebook: e.target.value.trim() })} placeholder="https://facebook.com/…" /></Field>
            <Field label={t('Lien Google Maps (facultatif)')}><input className={inputCls} dir="ltr" value={s.maps_url ?? ''} onChange={e => set({ maps_url: e.target.value.trim() })} placeholder="https://maps.app.goo.gl/…" /></Field>
            <Field label={t('Numéro WhatsApp')}><input className={inputCls} dir="ltr" inputMode="tel" value={s.whatsapp ?? ''} onChange={e => set({ whatsapp: e.target.value })} placeholder={r.phone ?? '06 12 34 56 78'} /></Field>
            <Field label={t('Votre propre domaine (facultatif)')}><input className={inputCls} dir="ltr" value={s.domain ?? ''} onChange={e => set({ domain: e.target.value.trim().toLowerCase() })} placeholder="www.monsalon.ma" /></Field>
          </div>
          {!ok && <p className="mt-2 text-sm text-danger">{t('Les liens doivent commencer par https://')}</p>}
        </Card>
      </fieldset>
      {owner && <div className="sticky bottom-4 flex justify-end"><Btn tone="brand" disabled={busy || !ok} onClick={save} className="shadow-xl"><Save className="h-4 w-4" /> {t('Enregistrer')}</Btn></div>}
    </div>
  );
}
