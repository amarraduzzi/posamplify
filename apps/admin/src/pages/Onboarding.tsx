import { useEffect, useState } from 'react';
import { Check, Coffee, Soup, Sandwich, FileX, ArrowRight, Printer, ExternalLink } from 'lucide-react';
import { supabase, MENU_URL, POS_URL } from '../lib/supabase';
import { check, rpc } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, inputCls } from '../components/ui';

type C = [fr: string, en: string, ar: string, icon: string, station: 'kitchen' | 'bar'];
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
const slugify = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const STEPS = ['Restaurant', 'Menu', 'Tables', 'Vous', 'Caisse', 'Terminé'];

/** First-run wizard for a restaurant that signed up by itself. */
export function Onboarding({ onDone }: { onDone: (page?: 'menu' | 'tables') => void }) {
  const a = useAdminCtx();
  const [step, setStep] = useState(() => Number(localStorage.getItem('admin-wizard-step') ?? 0));
  const r = step > 0 ? a.current : null;
  const go = (n: number) => { localStorage.setItem('admin-wizard-step', String(n)); setStep(n); };
  const finish = (page?: 'menu' | 'tables') => { localStorage.removeItem('admin-wizard-step'); onDone(page); };

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <ol className="mb-8 flex flex-wrap gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ${i === step ? 'bg-brand text-brand-ink' : i < step ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-muted'}`}>
            {i < step ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}{s}
          </li>
        ))}
      </ol>
      {step === 0 && <StepRestaurant onNext={() => go(1)} />}
      {step === 1 && r && <StepMenu r={r} onNext={() => go(2)} />}
      {step === 2 && r && <StepTables r={r} onNext={() => go(3)} />}
      {step === 3 && r && <StepYou r={r} onNext={() => go(4)} />}
      {step === 4 && r && <StepTill r={r} onNext={() => go(5)} />}
      {step === 5 && r && <StepDone r={r} onFinish={finish} />}
      {step > 0 && !r && <p className="text-muted">Chargement…</p>}
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
    const t = window.setTimeout(() => rpc<boolean>('slug_available', { p_slug: slug }).then(setFree).catch(() => setFree(null)), 300);
    return () => window.clearTimeout(t);
  }, [slug]);
  const create = async () => {
    setBusy(true);
    try {
      const id = await rpc<string>('signup_restaurant', { p_name: name.trim(), p_slug: slug, p_city: city.trim() || null });
      localStorage.setItem('admin-restaurant', id);
      await a.reload();
      onNext();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Card>
      <h1 className="mb-1 text-2xl font-bold">Bienvenue !</h1>
      <p className="mb-6 text-muted">Créons votre restaurant. Vous avez 30 jours d'essai gratuit, sans engagement.</p>
      <div className="space-y-4">
        <Field label="Nom du restaurant"><input autoFocus className={inputCls} value={name} onChange={e => { setName(e.target.value); setSlug(slugify(e.target.value)); }} /></Field>
        <Field label="Ville"><input className={inputCls} value={city} onChange={e => setCity(e.target.value)} placeholder="Rabat" /></Field>
        <Field label="Adresse de votre menu" hint={free === false ? 'Cette adresse est déjà prise, choisissez-en une autre.' : `${MENU_URL}/${slug || 'votre-restaurant'}`}>
          <input className={`${inputCls} ${free === false ? 'border-danger' : ''}`} value={slug} onChange={e => setSlug(slugify(e.target.value))} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end"><Btn tone="brand" disabled={busy || !name.trim() || !free} onClick={create}>Créer mon restaurant <ArrowRight className="h-4 w-4" /></Btn></div>
    </Card>
  );
}

function StepMenu({ r, onNext }: { r: Restaurant; onNext: () => void }) {
  const a = useAdminCtx();
  const [busy, setBusy] = useState(false);
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
      <h1 className="mb-1 text-2xl font-bold">Votre type d'établissement</h1>
      <p className="mb-6 text-muted">Nous préparons les catégories du menu. Vous ajouterez vos articles et prix ensuite, et vous pourrez tout modifier.</p>
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(TEMPLATES).map(([k, t]) => (
          <button key={k} disabled={busy} onClick={() => pick(k)} className="rounded-2xl border border-line/15 p-5 text-left transition hover:border-brand disabled:opacity-50">
            <t.Icon className="mb-2 h-7 w-7 text-brand" />
            <p className="font-bold">{t.label}</p>
            <p className="text-xs text-muted">{t.cats.map(c => c[0]).join(', ') || 'Aucune catégorie'}</p>
          </button>
        ))}
      </div>
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
      <h1 className="mb-1 text-2xl font-bold">Combien de tables ?</h1>
      <p className="mb-6 text-muted">Chaque table reçoit son QR code. Les clients scannent et commandent directement depuis leur table.</p>
      <div className="flex flex-wrap gap-2">{['0', '5', '10', '15', '20', '30'].map(x => <button key={x} onClick={() => setN(x)} className={`h-12 w-14 rounded-xl text-lg font-bold ${n === x ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{x}</button>)}
        <input className={`${inputCls} w-24`} inputMode="numeric" value={n} onChange={e => setN(e.target.value.replace(/\D/g, ''))} /></div>
      <p className="mt-2 text-xs text-muted">0 si vous faites uniquement de l'emporter. Vous pourrez ajouter des zones (terrasse, salle) plus tard.</p>
      <div className="mt-6 flex justify-end"><Btn tone="brand" disabled={busy} onClick={save}>Continuer <ArrowRight className="h-4 w-4" /></Btn></div>
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
      <h1 className="mb-1 text-2xl font-bold">Votre code de caisse</h1>
      <p className="mb-6 text-muted">Sur la caisse, chacun choisit son prénom et tape son code. Vous êtes manager : votre code valide les remises, annulations et la clôture de journée. Ajoutez vos employés ensuite dans « Personnel ».</p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Votre prénom"><input autoFocus className={inputCls} maxLength={40} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Code (4 à 6 chiffres)"><input className={inputCls} inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
      </div>
      <div className="mt-6 flex justify-between"><Btn onClick={onNext}>Plus tard</Btn><Btn tone="brand" disabled={busy || !name.trim() || !/^\d{4,6}$/.test(pin)} onClick={save}>Continuer <ArrowRight className="h-4 w-4" /></Btn></div>
    </Card>
  );
}

export function PairingCode({ r, label, onCreated }: { r: Restaurant; label?: string; onCreated?: () => void }) {
  const a = useAdminCtx();
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const make = async () => { try { setCode(await rpc('create_pairing_code', { p_restaurant_id: r.id, p_label: label || null })); onCreated?.(); } catch (e) { a.fail(e); } };
  return code ? (
    <div className="rounded-2xl bg-surface-2 p-5 text-center">
      <p className="text-sm text-muted">Sur l'ordinateur ou la tablette de caisse, ouvrez</p>
      <a href={POS_URL} target="_blank" rel="noreferrer" className="font-bold text-brand underline">{POS_URL.replace('https://', '')} <ExternalLink className="inline h-3 w-3" /></a>
      <p className="mt-3 text-sm text-muted">et tapez ce code :</p>
      <p className="my-2 font-mono text-4xl font-black tracking-[0.25em]">{code.code}</p>
      <p className="text-xs text-muted">Valable jusqu'à {new Date(code.expires_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, une seule fois.</p>
    </div>
  ) : <Btn tone="brand" onClick={make}>Créer un code de connexion</Btn>;
}

function StepTill({ r, onNext }: { r: Restaurant; onNext: () => void }) {
  return (
    <Card>
      <h1 className="mb-1 text-2xl font-bold">Relier votre caisse</h1>
      <p className="mb-6 text-muted">La caisse fonctionne dans le navigateur (Chrome) de n'importe quel ordinateur ou tablette. Pas de mot de passe : un code à usage unique suffit.</p>
      <PairingCode r={r} label="Caisse principale" />
      <div className="mt-6 flex justify-end"><Btn tone="brand" onClick={onNext}>Continuer <ArrowRight className="h-4 w-4" /></Btn></div>
    </Card>
  );
}

function StepDone({ r, onFinish }: { r: Restaurant; onFinish: (p?: 'menu' | 'tables') => void }) {
  return (
    <Card>
      <h1 className="mb-1 text-2xl font-bold">C'est prêt 🎉</h1>
      <p className="mb-6 text-muted">Il reste à ajouter vos articles et prix, puis à imprimer les QR codes pour vos tables.</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Btn tone="brand" onClick={() => onFinish('menu')}>Ajouter mes articles</Btn>
        <Btn onClick={() => onFinish('tables')}><Printer className="h-4 w-4" /> QR codes des tables</Btn>
        <a href={`${MENU_URL}/${r.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-semibold"><ExternalLink className="h-4 w-4" /> Voir mon menu</a>
      </div>
    </Card>
  );
}
