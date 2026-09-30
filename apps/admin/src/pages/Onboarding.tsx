import { useEffect, useState } from 'react';
import { Check, Coffee, Soup, Sandwich, FileX, ArrowRight, Printer, ExternalLink, Camera, TrendingUp } from 'lucide-react';
import { ImportMenu } from '../components/ImportMenu';
import { supabase, MENU_URL, POS_URL } from '../lib/supabase';
import { check, rpc } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, inputCls } from '../components/ui';
import { LangSwitch } from '../components/LangSwitch';
import { dateLocale, getLang, t } from '../lib/i18n';

type C = [fr: string, en: string, ar: string, icon: string, station: 'kitchen' | 'bar'];
// Category names are restaurant data (stored in fr/en/ar); only the template labels go through t().
// i18n:values
const TEMPLATES: Record<string, { label: string; Icon: typeof Coffee; cats: C[] }> = {
  cafe: { label: 'Café', Icon: Coffee, cats: [
    ['Boissons chaudes', 'Hot drinks', 'مشروبات ساخنة', '☕', 'bar'], ['Boissons froides', 'Cold drinks', 'مشروبات باردة', '🥤', 'bar'],
    ['Jus frais', 'Fresh juices', 'عصائر طازجة', '🍹', 'bar'], ['Petit-déjeuner', 'Breakfast', 'فطور', '🍳', 'kitchen'],
    ['Viennoiseries', 'Pastries', 'معجنات', '🥐', 'kitchen'], ['Crêpes', 'Crêpes', 'كريب', '🥞', 'kitchen']] },
  restaurant: { label: 'Restaurant', Icon: Soup, cats: [
    ['Entrées', 'Starters', 'مقبلات', '🥗', 'kitchen'], ['Plats', 'Main courses', 'أطباق رئيسية', '🍲', 'kitchen'],
    ['Grillades', 'Grills', 'مشويات', '🍗', 'kitchen'], ['Desserts', 'Desserts', 'حلويات', '🍰', 'kitchen'],
    ['Boissons', 'Drinks', 'مشروبات', '🥤', 'bar']] },
  snack: { label: 'Snack / Fast-food', Icon: Sandwich, cats: [
    ['Burgers', 'Burgers', 'برغر', '🍔', 'kitchen'], ['Tacos', 'Tacos', 'تاكوس', '🌮', 'kitchen'], ['Sandwichs', 'Sandwiches', 'ساندويتشات', '🥪', 'kitchen'],
    ['Pizzas', 'Pizzas', 'بيتزا', '🍕', 'kitchen'], ['Accompagnements', 'Sides', 'مرافقات', '🍟', 'kitchen'], ['Boissons', 'Drinks', 'مشروبات', '🥤', 'bar']] },
  empty: { label: 'Je commence vide', Icon: FileX, cats: [] },
};
// i18n:end
const slugify = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
type StepKey = 'restaurant' | 'menu' | 'tables' | 'you' | 'till' | 'done';
// i18n:values
const STEP_LABEL: Record<StepKey, string> = { restaurant: 'Restaurant', menu: 'Menu', tables: 'Tables', you: 'Vous', till: 'Caisse', done: 'Terminé' };
// i18n:end
/** The product chosen on the website (?produit=pos|profit), remembered from the sign-up page. */
export function signupProducts(): ('pos' | 'profit')[] {
  const v = localStorage.getItem('signup-product');
  return v === 'profit' ? ['profit'] : v === 'pos' ? ['pos'] : ['pos', 'profit'];
}
type DonePage = 'menu' | 'tables' | 'profit';

/** First-run wizard for a restaurant that signed up by itself. Amplify Profit alone: no tables, staff or till steps. */
export function Onboarding({ onDone }: { onDone: (page?: DonePage) => void }) {
  const a = useAdminCtx();
  const [step, setStep] = useState(() => Number(localStorage.getItem('admin-wizard-step') ?? 0));
  const r = step > 0 ? a.current : null;
  const products = r?.products ?? signupProducts();
  const keys: StepKey[] = products.includes('pos') ? ['restaurant', 'menu', 'tables', 'you', 'till', 'done'] : ['restaurant', 'menu', 'done'];
  const STEPS = () => keys.map(k => t(STEP_LABEL[k]));
  const key = keys[Math.min(step, keys.length - 1)];
  const go = (n: number) => { localStorage.setItem('admin-wizard-step', String(n)); setStep(n); };
  const next = () => go(step + 1);
  const finish = (page?: DonePage) => { localStorage.removeItem('admin-wizard-step'); localStorage.removeItem('signup-product'); onDone(page); };

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <div className="mb-6 flex justify-end"><LangSwitch /></div>
      <ol className="mb-8 flex flex-wrap gap-2 text-sm">
        {STEPS().map((s, i) => (
          <li key={s} className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ${i === step ? 'bg-brand text-brand-ink' : i < step ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-muted'}`}>
            {i < step ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}{s}
          </li>
        ))}
      </ol>
      {key === 'restaurant' && <StepRestaurant onNext={next} />}
      {key === 'menu' && r && <StepMenu r={r} onNext={next} />}
      {key === 'tables' && r && <StepTables r={r} onNext={next} />}
      {key === 'you' && r && <StepYou r={r} onNext={next} />}
      {key === 'till' && r && <StepTill r={r} onNext={next} />}
      {key === 'done' && r && <StepDone r={r} onFinish={finish} />}
      {step > 0 && !r && <p className="text-muted">{t('Chargement…')}</p>}
    </div>
  );
}

function StepRestaurant({ onNext }: { onNext: () => void }) {
  const a = useAdminCtx();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [slug, setSlug] = useState('');
  const [free, setFree] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (slug.length < 3) { setFree(null); return; }
    const tm = window.setTimeout(() => rpc<boolean>('slug_available', { p_slug: slug }).then(setFree).catch(() => setFree(null)), 300);
    return () => window.clearTimeout(tm);
  }, [slug]);
  const create = async () => {
    setBusy(true);
    try {
      const id = await rpc<string>('signup_restaurant', { p_name: name.trim(), p_slug: slug, p_city: city.trim() || null, p_products: signupProducts() });
      localStorage.setItem('admin-restaurant', id);
      await a.reload();
      onNext();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Card>
      <h1 className="mb-1 font-display text-3xl font-semibold">{t('Bienvenue !')}</h1>
      <p className="mb-6 text-muted">{t("Créons votre restaurant. Vous avez 30 jours d'essai gratuit, sans engagement.")}</p>
      <div className="space-y-4">
        <Field label={t('Nom du restaurant')}><input autoFocus className={inputCls} value={name} onChange={e => { setName(e.target.value); setSlug(slugify(e.target.value)); }} /></Field>
        <Field label={t('Ville')}><input className={inputCls} value={city} onChange={e => setCity(e.target.value)} placeholder="Rabat" /></Field>
        <Field label={t('Adresse de votre menu')} hint={free === false ? t('Cette adresse est déjà prise, choisissez-en une autre.') : `${MENU_URL}/${slug || 'votre-restaurant'}`}>
          <input dir="ltr" className={`${inputCls} ${free === false ? 'border-danger' : ''}`} value={slug} onChange={e => setSlug(slugify(e.target.value))} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end"><Btn tone="brand" disabled={busy || !name.trim() || !free} onClick={create}>{t('Créer mon restaurant')} <ArrowRight className="h-4 w-4 rtl:rotate-180" /></Btn></div>
    </Card>
  );
}

function StepMenu({ r, onNext }: { r: Restaurant; onNext: () => void }) {
  const a = useAdminCtx();
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const pick = async (key: string) => {
    setBusy(true);
    try {
      const existing = check(await supabase.from('categories').select('id').eq('restaurant_id', r.id)) as unknown[];
      const cats = TEMPLATES[key].cats;
      if (!existing.length && cats.length) {
        check(await supabase.from('categories').insert(cats.map(([fr, en, ar, icon, station], i) => ({
          restaurant_id: r.id, name: { fr, en, ar }, icon, station, sort_order: (i + 1) * 10 }))).select('id'));
      }
      onNext();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Card>
      <h1 className="mb-1 font-display text-3xl font-semibold">{t("Votre type d'établissement")}</h1>
      <p className="mb-6 text-muted">{t('Nous préparons les catégories du menu. Vous ajouterez vos articles et prix ensuite, et vous pourrez tout modifier.')}</p>
      <button disabled={busy} onClick={() => setImporting(true)} className="mb-4 flex w-full items-center gap-4 rounded-2xl border border-brand/50 bg-gradient-to-r from-brand/15 to-surface p-5 text-start transition hover:border-brand disabled:opacity-50">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full gold-fill text-brand-ink"><Camera className="h-6 w-6" /></span>
        <span>
          <span className="block font-bold">{t('Importer ma carte (photo ou Excel)')}</span>
          <span className="block text-sm text-muted">{t('Le plus rapide : tous vos plats et prix sont créés pour vous.')}</span>
        </span>
      </button>
      <p className="mb-3 text-sm font-semibold text-muted">{t('Ou commencez avec des catégories prêtes :')}</p>
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(TEMPLATES).map(([k, tp]) => (
          <button key={k} disabled={busy} onClick={() => pick(k)} className="rounded-2xl border border-line/15 p-5 text-start transition hover:border-brand disabled:opacity-50">
            <tp.Icon className="mb-2 h-7 w-7 text-brand" />
            <p className="font-bold">{t(tp.label)}</p>
            <p className="text-xs text-muted">{tp.cats.map(c => (getLang() === 'ar' ? c[2] : c[0])).join(getLang() === 'ar' ? '، ' : ', ') || t('Aucune catégorie')}</p>
          </button>
        ))}
      </div>
      {importing && <ImportMenu r={r} cats={[]} items={[]} onDone={() => setImported(true)}
        onClose={() => { setImporting(false); if (imported) onNext(); }} />}
    </Card>
  );
}

function StepTables({ r, onNext }: { r: Restaurant; onNext: () => void }) {
  const a = useAdminCtx();
  const [n, setN] = useState('10');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const count = Math.max(0, Math.min(200, Number(n) || 0));
      const existing = (check(await supabase.from('dining_tables').select('label').eq('restaurant_id', r.id)) as { label: string }[]).map(t => t.label);
      const rows = Array.from({ length: count }, (_, i) => String(i + 1)).filter(l => !existing.includes(l))
        .map(l => ({ restaurant_id: r.id, label: l, sort_order: Number(l) }));
      if (rows.length) check(await supabase.from('dining_tables').insert(rows).select('id'));
      onNext();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Card>
      <h1 className="mb-1 font-display text-3xl font-semibold">{t('Combien de tables ?')}</h1>
      <p className="mb-6 text-muted">{t('Chaque table reçoit son QR code. Les clients scannent et commandent directement depuis leur table.')}</p>
      <div className="flex flex-wrap gap-2">{['0', '5', '10', '15', '20', '30'].map(x => <button key={x} onClick={() => setN(x)} className={`h-12 w-14 rounded-xl text-lg font-bold ${n === x ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{x}</button>)}
        <input aria-label={t('Nombre de tables')} className={`${inputCls} !w-24`} inputMode="numeric" value={n} onChange={e => setN(e.target.value.replace(/\D/g, ''))} /></div>
      <p className="mt-2 text-xs text-muted">{t("0 si vous faites uniquement de l'emporter. Vous pourrez ajouter des zones (terrasse, salle) plus tard.")}</p>
      <div className="mt-6 flex justify-end"><Btn tone="brand" disabled={busy} onClick={save}>{t('Continuer')} <ArrowRight className="h-4 w-4 rtl:rotate-180" /></Btn></div>
    </Card>
  );
}

function StepYou({ r, onNext }: { r: Restaurant; onNext: () => void }) {
  const a = useAdminCtx();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const row = check(await supabase.from('staff').insert({ restaurant_id: r.id, name: name.trim(), role: 'manager' }).select('id').single()) as { id: string };
      await rpc('set_staff_pin', { p_staff_id: row.id, p_pin: pin });
      onNext();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Card>
      <h1 className="mb-1 font-display text-3xl font-semibold">{t('Votre code de caisse')}</h1>
      <p className="mb-6 text-muted">{t('Sur la caisse, chacun choisit son prénom et tape son code. Vous êtes manager : votre code valide les remises, annulations et la clôture de journée. Ajoutez vos employés ensuite dans « Personnel ».')}</p>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('Votre prénom')}><input autoFocus className={inputCls} maxLength={40} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label={t('Code (4 à 6 chiffres)')}><input className={inputCls} inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
      </div>
      <div className="mt-6 flex justify-between"><Btn onClick={onNext}>{t('Plus tard')}</Btn><Btn tone="brand" disabled={busy || !name.trim() || !/^\d{4,6}$/.test(pin)} onClick={save}>{t('Continuer')} <ArrowRight className="h-4 w-4 rtl:rotate-180" /></Btn></div>
    </Card>
  );
}

export function PairingCode({ r, label, onCreated }: { r: Restaurant; label?: string; onCreated?: () => void }) {
  const a = useAdminCtx();
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const make = async () => { try { setCode(await rpc('create_pairing_code', { p_restaurant_id: r.id, p_label: label || null })); onCreated?.(); } catch (e) { a.fail(e); } };
  return code ? (
    <div className="rounded-2xl bg-surface-2 p-5 text-center">
      <p className="text-sm text-muted">{t("Sur l'ordinateur ou la tablette de caisse, ouvrez")}</p>
      <a href={POS_URL} target="_blank" rel="noreferrer" dir="ltr" className="font-bold text-brand underline">{POS_URL.replace('https://', '')} <ExternalLink className="inline h-3 w-3" /></a>
      <p className="mt-3 text-sm text-muted">{t('et tapez ce code :')}</p>
      <p dir="ltr" className="my-2 font-mono text-4xl font-black tracking-[0.25em]">{code.code}</p>
      <p className="text-xs text-muted">{t("Valable jusqu'à {h}, une seule fois.", { h: new Date(code.expires_at).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) })}</p>
    </div>
  ) : <Btn tone="brand" onClick={make}>{t('Créer un code de connexion')}</Btn>;
}

function StepTill({ r, onNext }: { r: Restaurant; onNext: () => void }) {
  return (
    <Card>
      <h1 className="mb-1 font-display text-3xl font-semibold">{t('Relier votre caisse')}</h1>
      <p className="mb-6 text-muted">{t("La caisse fonctionne dans le navigateur (Chrome) de n'importe quel ordinateur ou tablette. Pas de mot de passe : un code à usage unique suffit.")}</p>
      <PairingCode r={r} label={t('Caisse principale')} />
      <div className="mt-6 flex justify-end"><Btn tone="brand" onClick={onNext}>{t('Continuer')} <ArrowRight className="h-4 w-4 rtl:rotate-180" /></Btn></div>
    </Card>
  );
}

function StepDone({ r, onFinish }: { r: Restaurant; onFinish: (p?: DonePage) => void }) {
  if (!(r.products ?? ['pos']).includes('pos')) {
    return (
      <Card>
        <h1 className="mb-1 font-display text-3xl font-semibold">{t("C'est prêt")} 🎉</h1>
        <p className="mb-6 text-muted">{t('Place aux marges : l’IA peut remplir les fiches techniques de vos plats en une minute.')}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Btn tone="brand" onClick={() => onFinish('profit')}><TrendingUp className="h-4 w-4" /> {t('Calculer mes marges')}</Btn>
          <Btn onClick={() => onFinish('menu')}>{t('Voir mes plats')}</Btn>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <h1 className="mb-1 font-display text-3xl font-semibold">{t("C'est prêt")} 🎉</h1>
      <p className="mb-6 text-muted">{t('Il reste à ajouter vos articles et prix, puis à imprimer les QR codes pour vos tables.')}</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Btn tone="brand" onClick={() => onFinish('menu')}>{t('Ajouter mes articles')}</Btn>
        <Btn onClick={() => onFinish('tables')}><Printer className="h-4 w-4" /> {t('QR codes des tables')}</Btn>
        <a href={`${MENU_URL}/${r.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-semibold"><ExternalLink className="h-4 w-4" /> {t('Voir mon menu')}</a>
      </div>
    </Card>
  );
}
