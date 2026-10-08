import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Save, ExternalLink, Star, Download, Plus, Trash2 } from 'lucide-react';
import { stationKey, stationsOf, type Station } from '../lib/stations';
import { supabase, MENU_URL } from '../lib/supabase';
import { check } from '../lib/api';
import { uploadImage } from '../lib/image';
import { useAdminCtx } from '../store';
import type { I18n, Restaurant } from '../lib/types';
import { Btn, Card, Field, I18nInput, ImageField, Toggle, inputCls } from '../components/ui';
import { t } from '../lib/i18n';

const LANGS: [string, string][] = [['fr', 'Français'], ['ar', 'العربية'], ['en', 'English'], ['es', 'Español']];

export function SettingsPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const ro = !a.canEditProfile;
  const [f, setF] = useState({
    name: r.name, phone: r.phone ?? '', address: r.address ?? '', city: r.city ?? '',
    legal_name: r.legal_name ?? '', ice: r.ice ?? '', tax_id: r.tax_id ?? '', rc: r.rc ?? '',
    default_vat_bp: r.default_vat_bp, languages: r.languages,
    accept_dine_in: r.accept_dine_in, accept_takeaway: r.accept_takeaway, accept_delivery: r.accept_delivery,
    day_cutoff_hour: r.day_cutoff_hour,
  });
  const [brand, setBrand] = useState({ primary_color: r.branding.primary_color ?? '#C2410C', theme: r.branding.theme ?? 'light',
    logo_url: r.branding.logo_url ?? null as string | null, cover_url: r.branding.cover_url ?? null as string | null, tagline: (r.branding.tagline ?? {}) as I18n,
    review_url: r.branding.review_url ?? '', review_on_receipt: r.branding.review_on_receipt ?? true });
  const reviewOk = !brand.review_url.trim() || /^https:\/\/\S+$/.test(brand.review_url.trim());
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    const u = brand.review_url.trim();
    if (!u || !reviewOk) { setQr(null); return; }
    QRCode.toDataURL(u, { width: 600, margin: 2 }).then(setQr).catch(() => setQr(null));
  }, [brand.review_url, reviewOk]);
  const ps = r.pos_settings ?? {};
  const [pos, setPos] = useState({ receipt: ps.printers?.receipt ?? 'TICKET',
    idle: String(ps.idle_lock_minutes ?? 10), footer: ps.receipt_footer ?? '' });
  const [stations, setStations] = useState<Station[]>(() => stationsOf(r));
  const [newSt, setNewSt] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }));

  const save = async () => {
    setBusy(true);
    try {
      check(await supabase.from('restaurants').update({
        ...f, name: f.name.trim(), ice: f.ice.trim() || null, legal_name: f.legal_name.trim() || null, tax_id: f.tax_id.trim() || null,
        rc: f.rc.trim() || null, phone: f.phone.trim() || null, address: f.address.trim() || null, city: f.city.trim() || null,
        branding: { ...r.branding, ...brand, logo_url: brand.logo_url || undefined, cover_url: brand.cover_url || undefined, review_url: brand.review_url.trim() || undefined },
        pos_settings: { ...ps, printers: { receipt: pos.receipt.trim() || 'TICKET', stations: Object.fromEntries(stations.map(x => [x.key, x.printer.trim() || 'CUISINE'])) },
          stations: stations.map(x => ({ key: x.key, name: x.name.trim() || x.key })),
          idle_lock_minutes: Math.max(0, Math.min(120, Number(pos.idle) || 0)), receipt_footer: pos.footer.trim() || undefined },
      }).eq('id', r.id).select('id'));
      await a.reload();
      a.toast(t('Restaurant enregistré'));
    } catch (e) { a.fail(e); }
    setBusy(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="me-auto font-display text-3xl font-semibold">{t('Restaurant')}</h1>
        {!ro && <Btn tone="brand" disabled={busy || !f.name.trim() || !f.languages.length || !reviewOk} onClick={save}><Save className="h-4 w-4" /> {t('Enregistrer')}</Btn>}
      </div>
      {ro && <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm">{t('Seul le propriétaire peut modifier ces informations.')}</p>}
      <fieldset disabled={ro} className="space-y-6">
        <Card>
          <h2 className="mb-4 font-display text-xl font-semibold">{t('Adresses')}</h2>
          <p className="text-sm">{t('Menu client :')} <a dir="ltr" className="font-semibold text-brand underline" href={`${MENU_URL}/${r.slug}`} target="_blank" rel="noreferrer">{MENU_URL}/{r.slug} <ExternalLink className="inline h-3 w-3" /></a></p>
          <p className="mt-1 text-sm text-muted">{t('Les QR codes des tables (page Tables) ajoutent le numéro de table à cette adresse.')}</p>
        </Card>
        <Card>
          <h2 className="mb-4 font-display text-xl font-semibold">{t('Informations')}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('Nom du restaurant')}><input className={inputCls} value={f.name} onChange={e => set({ name: e.target.value })} /></Field>
            <Field label={t('Téléphone')}><input dir="ltr" className={inputCls} value={f.phone} onChange={e => set({ phone: e.target.value })} /></Field>
            <Field label={t('Adresse')}><input className={inputCls} value={f.address} onChange={e => set({ address: e.target.value })} /></Field>
            <Field label={t('Ville')}><input className={inputCls} value={f.city} onChange={e => set({ city: e.target.value })} /></Field>
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-display text-xl font-semibold">{t('Apparence du menu client')}</h2>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <Field group label={t('Couleur principale')}>
                <div className="flex items-center gap-3"><input type="color" aria-label={t('Couleur principale')} value={brand.primary_color} onChange={e => setBrand({ ...brand, primary_color: e.target.value })} className="h-11 w-16 rounded-lg border border-line/15" />
                  <input dir="ltr" aria-label={t('Couleur principale')} className={`${inputCls} !w-32`} value={brand.primary_color} onChange={e => setBrand({ ...brand, primary_color: e.target.value })} /></div>
              </Field>
              <Field group label={t('Thème')}>
                <div className="flex gap-2">{(['light', 'dark'] as const).map(th => <button key={th} type="button" onClick={() => setBrand({ ...brand, theme: th })} className={`flex-1 rounded-xl py-2.5 font-semibold ${brand.theme === th ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{th === 'light' ? t('Clair') : t('Sombre')}</button>)}</div>
              </Field>
              <Field group label={t('Slogan')}><I18nInput value={brand.tagline} onChange={v => setBrand({ ...brand, tagline: v })} langs={f.languages.length ? f.languages : ['fr']} /></Field>
              <Field group label={t('Langues du menu')} hint={t('La première langue cochée est la langue par défaut.')}>
                <div className="flex flex-wrap gap-2">
                  {LANGS.map(([code, label]) => {
                    const on = f.languages.includes(code);
                    return <button key={code} type="button" onClick={() => set({ languages: on ? f.languages.filter(x => x !== code) : [...f.languages, code] })}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold ${on ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{label}</button>;
                  })}
                </div>
              </Field>
            </div>
            <div className="space-y-4">
              <Field group label={t('Logo')}><ImageField aspect="aspect-square" url={brand.logo_url} onChange={u => setBrand({ ...brand, logo_url: u })} upload={file => uploadImage(r.id, 'brand', file, 512)} /></Field>
              <Field group label={t('Photo de couverture')}><ImageField aspect="aspect-[16/7]" url={brand.cover_url} onChange={u => setBrand({ ...brand, cover_url: u })} upload={file => uploadImage(r.id, 'brand', file, 1600)} /></Field>
            </div>
          </div>
        </Card>
        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Star className="h-5 w-5 text-brand" /> {t('Avis Google')}</h2>
          <p className="mb-4 text-sm text-muted">{t('Plus d’avis, plus de clients sur Google Maps. Le lien s’imprime en QR code sous chaque ticket et apparaît sur votre menu QR.')}</p>
          <div className="grid gap-5 md:grid-cols-[1fr_auto]">
            <div className="space-y-4">
              <Field label={t('Lien pour laisser un avis')} hint={reviewOk ? t('Google Business Profile > « Demander des avis » > copiez le lien (il commence par https://g.page/r/).') : t('Le lien doit commencer par https://')}>
                <input dir="ltr" className={inputCls} value={brand.review_url} onChange={e => setBrand({ ...brand, review_url: e.target.value })} placeholder="https://g.page/r/..." />
              </Field>
              <Toggle checked={brand.review_on_receipt} onChange={v => setBrand({ ...brand, review_on_receipt: v })} label={t('Imprimer le QR sous les tickets')} />
              <p className="rounded-xl bg-surface-2 p-3 text-xs text-muted">{t('Règle Google : ne donnez rien en échange d’un avis (réduction, cadeau, tirage au sort) et demandez-le à tous les clients, pas seulement aux contents. Sinon Google peut supprimer vos avis.')}</p>
            </div>
            {qr && (
              <div className="text-center">
                <img src={qr} alt={t('QR code avis Google')} className="mx-auto h-40 w-40 rounded-xl border border-line/10 bg-white p-1" />
                <a href={qr} download={`avis-google-${r.slug}.png`} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand"><Download className="h-4 w-4" /> {t('Télécharger pour les tables')}</a>
              </div>
            )}
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-display text-xl font-semibold">{t('Commandes en ligne')}</h2>
          <div className="flex flex-wrap gap-6">
            <Toggle checked={f.accept_dine_in} onChange={v => set({ accept_dine_in: v })} label={t('Sur place (QR code à table)')} />
            <Toggle checked={f.accept_takeaway} onChange={v => set({ accept_takeaway: v })} label={t('À emporter')} />
            <Toggle checked={f.accept_delivery} onChange={v => set({ accept_delivery: v })} label={t('Livraison')} />
          </div>
        </Card>
        <Card>
          <h2 className="mb-1 font-display text-xl font-semibold">{t('Informations fiscales')}</h2>
          <p className="mb-4 text-sm text-muted">{t('Imprimées sur chaque ticket. Obligatoires pour la facturation électronique DGI.')}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('Raison sociale')}><input className={inputCls} value={f.legal_name} onChange={e => set({ legal_name: e.target.value })} /></Field>
            <Field label={t('ICE (15 chiffres)')}><input dir="ltr" className={inputCls} inputMode="numeric" maxLength={15} value={f.ice} onChange={e => set({ ice: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('Identifiant fiscal (IF)')}><input className={inputCls} value={f.tax_id} onChange={e => set({ tax_id: e.target.value })} /></Field>
            <Field label={t('Registre de commerce (RC)')}><input className={inputCls} value={f.rc} onChange={e => set({ rc: e.target.value })} /></Field>
            <Field label={t('TVA par défaut')}>
              <select className={inputCls} value={f.default_vat_bp} onChange={e => set({ default_vat_bp: Number(e.target.value) })}>
                {[0, 700, 1000, 1400, 2000].map(v => <option key={v} value={v}>{v / 100} %</option>)}
              </select>
            </Field>
            <Field label={t('Fin de journée de caisse')} hint={t('Les ventes après minuit et avant cette heure comptent pour la veille.')}>
              <select className={inputCls} value={f.day_cutoff_hour} onChange={e => set({ day_cutoff_hour: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 5, 6].map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </Field>
          </div>
        </Card>
        <Card>
          <h2 className="mb-1 font-display text-xl font-semibold">{t('Caisse')}</h2>
          <p className="mb-4 text-sm text-muted">{t('Noms exacts des imprimantes dans Windows (programme printhost).')}</p>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t('Imprimante tickets')}><input dir="ltr" className={inputCls} value={pos.receipt} onChange={e => setPos({ ...pos, receipt: e.target.value })} /></Field>
            <Field label={t('Verrouillage après (minutes)')} hint={t('0 = jamais.')}><input className={inputCls} inputMode="numeric" value={pos.idle} onChange={e => setPos({ ...pos, idle: e.target.value.replace(/\D/g, '') })} /></Field>
            <div className="md:col-span-2"><Field label={t('Message en bas du ticket')} hint={t('Imprimé tel quel sur le ticket (caractères latins uniquement).')}><input className={inputCls} maxLength={80} value={pos.footer} onChange={e => setPos({ ...pos, footer: e.target.value })} placeholder="Merci de votre visite, à bientôt !" /></Field></div>
          </div>
        </Card>
        <Card>
          <h2 className="mb-1 font-display text-xl font-semibold">{t('Postes de préparation')}</h2>
          <p className="mb-4 text-sm text-muted">{t('Chaque poste reçoit ses bons, sur son imprimante et sur son écran cuisine. Ajoutez par exemple Grill, Pizza ou Dessert, puis choisissez le poste de chaque catégorie dans le Menu.')}</p>
          <div className="space-y-2">
            {stations.map((x, i) => (
              <div key={x.key} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label={i === 0 ? t('Nom du poste') : ''}><input className={inputCls} maxLength={20} value={x.name} onChange={e => setStations(ss => ss.map(y => y.key === x.key ? { ...y, name: e.target.value } : y))} /></Field>
                <Field label={i === 0 ? t('Imprimante') : ''}><input dir="ltr" className={inputCls} value={x.printer} onChange={e => setStations(ss => ss.map(y => y.key === x.key ? { ...y, printer: e.target.value } : y))} /></Field>
                {x.key === 'kitchen' || x.key === 'bar' ? <span className="w-10" /> : <Btn tone="danger" aria-label={t('Supprimer')} onClick={() => setStations(ss => ss.filter(y => y.key !== x.key))}><Trash2 className="h-4 w-4" /></Btn>}
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input className={inputCls} maxLength={20} value={newSt} onChange={e => setNewSt(e.target.value)} placeholder={t('Nouveau poste : Grill, Pizza, Dessert…')} />
            <Btn disabled={!newSt.trim() || stations.some(x => x.key === stationKey(newSt))} onClick={() => { setStations(ss => [...ss, { key: stationKey(newSt), name: newSt.trim(), printer: 'CUISINE' }]); setNewSt(''); }}><Plus className="h-4 w-4" /> {t('Ajouter')}</Btn>
          </div>
          <p className="mt-2 text-xs text-muted">{t('Plusieurs postes peuvent partager la même imprimante. Pensez à enregistrer.')}</p>
        </Card>
      </fieldset>
    </div>
  );
}
