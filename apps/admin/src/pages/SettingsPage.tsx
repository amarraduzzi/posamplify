import { useState } from 'react';
import { Save, ExternalLink } from 'lucide-react';
import { supabase, MENU_URL } from '../lib/supabase';
import { check } from '../lib/api';
import { uploadImage } from '../lib/image';
import { useAdminCtx } from '../store';
import type { I18n, Restaurant } from '../lib/types';
import { Btn, Card, Field, I18nInput, ImageField, Toggle, inputCls } from '../components/ui';

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
    logo_url: r.branding.logo_url ?? null as string | null, cover_url: r.branding.cover_url ?? null as string | null, tagline: (r.branding.tagline ?? {}) as I18n });
  const ps = r.pos_settings ?? {};
  const [pos, setPos] = useState({ receipt: ps.printers?.receipt ?? 'TICKET', kitchen: ps.printers?.stations?.kitchen ?? 'CUISINE', bar: ps.printers?.stations?.bar ?? 'BAR',
    idle: String(ps.idle_lock_minutes ?? 10), footer: ps.receipt_footer ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }));

  const save = async () => {
    setBusy(true);
    try {
      check(await supabase.from('restaurants').update({
        ...f, name: f.name.trim(), ice: f.ice.trim() || null, legal_name: f.legal_name.trim() || null, tax_id: f.tax_id.trim() || null,
        rc: f.rc.trim() || null, phone: f.phone.trim() || null, address: f.address.trim() || null, city: f.city.trim() || null,
        branding: { ...r.branding, ...brand, logo_url: brand.logo_url || undefined, cover_url: brand.cover_url || undefined },
        pos_settings: { ...ps, printers: { receipt: pos.receipt.trim() || 'TICKET', stations: { kitchen: pos.kitchen.trim() || 'CUISINE', bar: pos.bar.trim() || 'BAR' } },
          idle_lock_minutes: Math.max(0, Math.min(120, Number(pos.idle) || 0)), receipt_footer: pos.footer.trim() || undefined },
      }).eq('id', r.id).select('id'));
      await a.reload();
      a.toast('Restaurant enregistré');
    } catch (e) { a.fail(e); }
    setBusy(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Restaurant</h1>
        {!ro && <Btn tone="brand" disabled={busy || !f.name.trim() || !f.languages.length} onClick={save}><Save className="h-4 w-4" /> Enregistrer</Btn>}
      </div>
      {ro && <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm">Seul le propriétaire peut modifier ces informations.</p>}
      <fieldset disabled={ro} className="space-y-6">
        <Card>
          <h2 className="mb-4 font-bold">Adresses</h2>
          <p className="text-sm">Menu client : <a className="font-semibold text-brand underline" href={`${MENU_URL}/${r.slug}`} target="_blank" rel="noreferrer">{MENU_URL}/{r.slug} <ExternalLink className="inline h-3 w-3" /></a></p>
          <p className="mt-1 text-sm text-muted">Les QR codes des tables (page Tables) ajoutent le numéro de table à cette adresse.</p>
        </Card>
        <Card>
          <h2 className="mb-4 font-bold">Informations</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nom du restaurant"><input className={inputCls} value={f.name} onChange={e => set({ name: e.target.value })} /></Field>
            <Field label="Téléphone"><input className={inputCls} value={f.phone} onChange={e => set({ phone: e.target.value })} /></Field>
            <Field label="Adresse"><input className={inputCls} value={f.address} onChange={e => set({ address: e.target.value })} /></Field>
            <Field label="Ville"><input className={inputCls} value={f.city} onChange={e => set({ city: e.target.value })} /></Field>
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-bold">Apparence du menu client</h2>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <Field group label="Couleur principale">
                <div className="flex items-center gap-3"><input type="color" value={brand.primary_color} onChange={e => setBrand({ ...brand, primary_color: e.target.value })} className="h-11 w-16 rounded-lg border border-line/15" />
                  <input className={`${inputCls} w-32`} value={brand.primary_color} onChange={e => setBrand({ ...brand, primary_color: e.target.value })} /></div>
              </Field>
              <Field group label="Thème">
                <div className="flex gap-2">{(['light', 'dark'] as const).map(t => <button key={t} type="button" onClick={() => setBrand({ ...brand, theme: t })} className={`flex-1 rounded-xl py-2.5 font-semibold ${brand.theme === t ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{t === 'light' ? 'Clair' : 'Sombre'}</button>)}</div>
              </Field>
              <Field group label="Slogan"><I18nInput value={brand.tagline} onChange={t => setBrand({ ...brand, tagline: t })} langs={f.languages.length ? f.languages : ['fr']} /></Field>
              <Field group label="Langues du menu" hint="La première langue cochée est la langue par défaut.">
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
              <Field group label="Logo"><ImageField aspect="aspect-square" url={brand.logo_url} onChange={u => setBrand({ ...brand, logo_url: u })} upload={file => uploadImage(r.id, 'brand', file, 512)} /></Field>
              <Field group label="Photo de couverture"><ImageField aspect="aspect-[16/7]" url={brand.cover_url} onChange={u => setBrand({ ...brand, cover_url: u })} upload={file => uploadImage(r.id, 'brand', file, 1600)} /></Field>
            </div>
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-bold">Commandes en ligne</h2>
          <div className="flex flex-wrap gap-6">
            <Toggle checked={f.accept_dine_in} onChange={v => set({ accept_dine_in: v })} label="Sur place (QR code à table)" />
            <Toggle checked={f.accept_takeaway} onChange={v => set({ accept_takeaway: v })} label="À emporter" />
            <Toggle checked={f.accept_delivery} onChange={v => set({ accept_delivery: v })} label="Livraison" />
          </div>
        </Card>
        <Card>
          <h2 className="mb-1 font-bold">Informations fiscales</h2>
          <p className="mb-4 text-sm text-muted">Imprimées sur chaque ticket. Obligatoires pour la facturation électronique DGI.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Raison sociale"><input className={inputCls} value={f.legal_name} onChange={e => set({ legal_name: e.target.value })} /></Field>
            <Field label="ICE (15 chiffres)"><input className={inputCls} inputMode="numeric" maxLength={15} value={f.ice} onChange={e => set({ ice: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Identifiant fiscal (IF)"><input className={inputCls} value={f.tax_id} onChange={e => set({ tax_id: e.target.value })} /></Field>
            <Field label="Registre de commerce (RC)"><input className={inputCls} value={f.rc} onChange={e => set({ rc: e.target.value })} /></Field>
            <Field label="TVA par défaut">
              <select className={inputCls} value={f.default_vat_bp} onChange={e => set({ default_vat_bp: Number(e.target.value) })}>
                {[0, 700, 1000, 1400, 2000].map(v => <option key={v} value={v}>{v / 100} %</option>)}
              </select>
            </Field>
            <Field label="Fin de journée de caisse" hint="Les ventes après minuit et avant cette heure comptent pour la veille.">
              <select className={inputCls} value={f.day_cutoff_hour} onChange={e => set({ day_cutoff_hour: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 5, 6].map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </Field>
          </div>
        </Card>
        <Card>
          <h2 className="mb-1 font-bold">Caisse</h2>
          <p className="mb-4 text-sm text-muted">Noms exacts des imprimantes dans Windows (programme printhost).</p>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Imprimante tickets"><input className={inputCls} value={pos.receipt} onChange={e => setPos({ ...pos, receipt: e.target.value })} /></Field>
            <Field label="Imprimante cuisine"><input className={inputCls} value={pos.kitchen} onChange={e => setPos({ ...pos, kitchen: e.target.value })} /></Field>
            <Field label="Imprimante bar"><input className={inputCls} value={pos.bar} onChange={e => setPos({ ...pos, bar: e.target.value })} /></Field>
            <Field label="Verrouillage après (minutes)" hint="0 = jamais."><input className={inputCls} inputMode="numeric" value={pos.idle} onChange={e => setPos({ ...pos, idle: e.target.value.replace(/\D/g, '') })} /></Field>
            <div className="md:col-span-2"><Field label="Message en bas du ticket"><input className={inputCls} maxLength={80} value={pos.footer} onChange={e => setPos({ ...pos, footer: e.target.value })} placeholder="Merci de votre visite, à bientôt !" /></Field></div>
          </div>
        </Card>
      </fieldset>
    </div>
  );
}
