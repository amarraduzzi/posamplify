import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, ArrowUp, ArrowDown, Search, Trash2, Eye, EyeOff } from 'lucide-react';
import { tr } from '@resto/shared';
import { supabase } from '../lib/supabase';
import { check, fromCents, mad, toCents } from '../lib/api';
import { uploadImage } from '../lib/image';
import { useAdminCtx } from '../store';
import type { Category, I18n, Item, Restaurant, Variant } from '../lib/types';
import { Btn, Field, I18nInput, ImageField, Modal, Toggle, inputCls } from '../components/ui';

const TAGS: Record<string, string> = { popular: 'Populaire', new: 'Nouveau', spicy: 'Épicé', vegetarian: 'Végétarien' };
const ICONS = ['☕', '🥤', '🍹', '🍕', '🍔', '🌮', '🥪', '🥗', '🍳', '🥞', '🍰', '🍦', '🍝', '🍲', '🥘', '🍗', '🐟', '🍟', '🥐', '🫖'];

export function MenuPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const lang = r.languages[0] ?? 'fr';
  const [cats, setCats] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [editCat, setEditCat] = useState<Category | 'new' | null>(null);
  const [editItem, setEditItem] = useState<Item | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, i] = await Promise.all([
        supabase.from('categories').select('*').eq('restaurant_id', r.id).order('sort_order').order('created_at'),
        supabase.from('menu_items').select('*, item_variants(*)').eq('restaurant_id', r.id).order('sort_order').order('created_at'),
      ]);
      const cs = check(c) as Category[];
      setCats(cs);
      setItems((check(i) as Item[]).map(x => ({ ...x, item_variants: [...x.item_variants].sort((p, n) => p.sort_order - n.sort_order || p.price_cents - n.price_cents) })));
      setSel(s => (s && cs.some(x => x.id === s) ? s : cs[0]?.id ?? null));
    } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    return f ? items.filter(i => Object.values(i.name).some(n => n.toLowerCase().includes(f))) : items.filter(i => i.category_id === sel);
  }, [items, sel, q]);

  const upd = async (table: string, id: string, patch: Record<string, unknown>) => {
    try { check(await supabase.from(table).update(patch).eq('id', id).select('id')); await load(); } catch (e) { a.fail(e); }
  };
  const move = async (list: { id: string; sort_order: number }[], idx: number, dir: -1 | 1, table: string) => {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    // renumber the whole list so equal sort_orders (imports) still move
    const order = list.map(x => x.id);
    [order[idx], order[j]] = [order[j], order[idx]];
    try {
      await Promise.all(order.map((id, k) => supabase.from(table).update({ sort_order: (k + 1) * 10 }).eq('id', id)));
      await load();
    } catch (e) { a.fail(e); }
  };

  const cat = cats.find(c => c.id === sel);
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-3xl font-semibold">Menu</h1>
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} pl-9`} placeholder="Chercher un article" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-[260px_1fr]">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">Catégories</h2>
            <Btn className="px-3 py-1.5" onClick={() => setEditCat('new')}><Plus className="h-4 w-4" /> Ajouter</Btn>
          </div>
          <ul className="space-y-1">
            {cats.map((c, idx) => (
              <li key={c.id} className={`group flex items-center gap-1 rounded-xl ${sel === c.id && !q ? 'bg-brand text-brand-ink' : 'hover:bg-surface-2'}`}>
                <button onClick={() => { setSel(c.id); setQ(''); }} className="min-w-0 flex-1 px-3 py-2.5 text-left font-semibold">
                  <span className="mr-1.5">{c.icon}</span>{tr(c.name, lang)}
                  <span className="ml-1 text-xs opacity-60">({items.filter(i => i.category_id === c.id).length})</span>
                  {!c.active && <span className="ml-1 text-xs opacity-70">· masquée</span>}
                </button>
                <button onClick={() => move(cats, idx, -1, 'categories')} className="hidden h-8 w-7 place-items-center group-hover:grid" aria-label="Monter"><ArrowUp className="h-4 w-4" /></button>
                <button onClick={() => move(cats, idx, 1, 'categories')} className="hidden h-8 w-7 place-items-center group-hover:grid" aria-label="Descendre"><ArrowDown className="h-4 w-4" /></button>
                <button onClick={() => setEditCat(c)} className="grid h-8 w-8 place-items-center" aria-label="Modifier"><Pencil className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
          {!cats.length && <p className="text-sm text-muted">Commencez par créer une catégorie (Boissons, Plats…).</p>}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">{q ? 'Résultats' : cat ? tr(cat.name, lang) : 'Articles'}</h2>
            {cat && <Btn tone="brand" onClick={() => setEditItem('new')}><Plus className="h-4 w-4" /> Ajouter un article</Btn>}
          </div>
          <ul className="divide-y divide-line/10 overflow-hidden card rounded-3xl">
            {shown.map((i, idx) => (
              <li key={i.id} className={`flex items-center gap-3 px-3 py-2.5 ${i.active ? '' : 'opacity-50'}`}>
                {i.image_url ? <img src={i.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-lg bg-surface-2" />}
                <button onClick={() => setEditItem(i)} className="min-w-0 flex-1 text-left">
                  <p className="truncate font-semibold">{tr(i.name, lang)}</p>
                  <p className="text-sm text-muted tabular">
                    {i.item_variants.length ? i.item_variants.map(v => `${tr(v.name, lang)} ${mad(v.price_cents)}`).join(' · ') : mad(i.price_cents)}
                    {i.tags.map(t => <span key={t} className="ml-2 rounded bg-surface-2 px-1.5 text-xs">{TAGS[t] ?? t}</span>)}
                  </p>
                </button>
                <Toggle checked={i.available} onChange={v => upd('menu_items', i.id, { available: v })} label={i.available ? 'Disponible' : 'Épuisé'} />
                <button onClick={() => upd('menu_items', i.id, { active: !i.active })} title={i.active ? 'Masquer du menu' : 'Afficher'} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-surface-2">
                  {i.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
                {!q && <>
                  <button onClick={() => move(shown, idx, -1, 'menu_items')} className="grid h-9 w-7 place-items-center rounded-lg hover:bg-surface-2" aria-label="Monter"><ArrowUp className="h-4 w-4" /></button>
                  <button onClick={() => move(shown, idx, 1, 'menu_items')} className="grid h-9 w-7 place-items-center rounded-lg hover:bg-surface-2" aria-label="Descendre"><ArrowDown className="h-4 w-4" /></button>
                </>}
              </li>
            ))}
            {!shown.length && <li className="px-4 py-10 text-center text-muted">{q ? 'Aucun article trouvé.' : 'Aucun article dans cette catégorie.'}</li>}
          </ul>
          <p className="mt-2 text-xs text-muted">« Épuisé » : visible mais non commandable aujourd'hui. L'œil masque l'article du menu et de la caisse.</p>
        </section>
      </div>

      {editCat && <CategoryEditor r={r} cat={editCat === 'new' ? null : editCat} count={cats.length} onClose={() => setEditCat(null)} onSaved={async id => { setEditCat(null); await load(); if (id) setSel(id); }} />}
      {editItem && <ItemEditor r={r} cats={cats} item={editItem === 'new' ? null : editItem} catId={sel} count={shown.length}
        onClose={() => setEditItem(null)} onSaved={async () => { setEditItem(null); await load(); }} />}
    </div>
  );
}

function CategoryEditor({ r, cat, count, onClose, onSaved }: { r: Restaurant; cat: Category | null; count: number; onClose: () => void; onSaved: (id?: string) => void }) {
  const a = useAdminCtx();
  const [name, setName] = useState<I18n>(cat?.name ?? {});
  const [icon, setIcon] = useState(cat?.icon ?? '');
  const [station, setStation] = useState(cat?.station ?? 'kitchen');
  const [active, setActive] = useState(cat?.active ?? true);
  const [busy, setBusy] = useState(false);
  const ok = !!name[r.languages[0]]?.trim();
  const save = async () => {
    setBusy(true);
    try {
      const row = { name, icon: icon || null, station, active };
      if (cat) check(await supabase.from('categories').update(row).eq('id', cat.id).select('id'));
      const created = cat ? null : (check(await supabase.from('categories').insert({ ...row, restaurant_id: r.id, sort_order: (count + 1) * 10 }).select('id').single()) as { id: string });
      a.toast('Catégorie enregistrée'); onSaved(created?.id);
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const remove = async () => {
    try { check(await supabase.from('categories').delete().eq('id', cat!.id).select('id')); a.toast('Catégorie supprimée'); onSaved(); } catch (e) { a.fail(e); }
  };
  return (
    <Modal title={cat ? 'Modifier la catégorie' : 'Nouvelle catégorie'} onClose={onClose}
      footer={<div className="flex justify-between">{cat ? <Btn tone="danger" onClick={remove}><Trash2 className="h-4 w-4" /> Supprimer</Btn> : <span />}<Btn tone="brand" disabled={!ok || busy} onClick={save}>Enregistrer</Btn></div>}>
      <div className="space-y-4">
        <Field group label="Nom"><I18nInput value={name} onChange={setName} langs={r.languages} max={60} required /></Field>
        <Field group label="Icône">
          <div className="mb-2 flex flex-wrap gap-1">{ICONS.map(i => <button key={i} type="button" onClick={() => setIcon(i)} className={`h-9 w-9 rounded-lg text-lg ${icon === i ? 'bg-brand/20 ring-2 ring-brand' : 'bg-surface-2'}`}>{i}</button>)}</div>
          <input className={`${inputCls} w-24`} value={icon} onChange={e => setIcon(e.target.value.slice(0, 4))} />
        </Field>
        <Field label="Préparé à" hint="Détermine sur quelle imprimante le bon est envoyé.">
          <select className={inputCls} value={station} onChange={e => setStation(e.target.value)}>
            <option value="kitchen">Cuisine</option><option value="bar">Bar</option>
          </select>
        </Field>
        <Toggle checked={active} onChange={setActive} label="Visible sur le menu et la caisse" />
      </div>
    </Modal>
  );
}

function ItemEditor({ r, cats, item, catId, count, onClose, onSaved }: {
  r: Restaurant; cats: Category[]; item: Item | null; catId: string | null; count: number; onClose: () => void; onSaved: () => void;
}) {
  const a = useAdminCtx();
  const [name, setName] = useState<I18n>(item?.name ?? {});
  const [desc, setDesc] = useState<I18n>(item?.description ?? {});
  const [price, setPrice] = useState(fromCents(item?.price_cents ?? null));
  const [category, setCategory] = useState(item?.category_id ?? catId ?? cats[0]?.id ?? '');
  const [image, setImage] = useState<string | null>(item?.image_url ?? null);
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [vat, setVat] = useState<string>(item?.vat_bp == null ? '' : String(item.vat_bp));
  const [station, setStation] = useState<string>(item?.station ?? '');
  const [active, setActive] = useState(item?.active ?? true);
  const [available, setAvailable] = useState(item?.available ?? true);
  const [variants, setVariants] = useState<(Variant & { priceText: string })[]>(
    (item?.item_variants ?? []).map(v => ({ ...v, priceText: fromCents(v.price_cents) })));
  const [busy, setBusy] = useState(false);
  const ok = !!name[r.languages[0]]?.trim() && !!category && (variants.length ? variants.every(v => v.name[r.languages[0]]?.trim() && v.priceText) : price !== '');

  const save = async () => {
    setBusy(true);
    try {
      const row = {
        name, description: desc, category_id: category, image_url: image, tags, active, available,
        price_cents: variants.length ? Math.min(...variants.map(v => toCents(v.priceText))) : toCents(price),
        vat_bp: vat === '' ? null : Number(vat), station: station || null,
      };
      let id = item?.id;
      if (id) check(await supabase.from('menu_items').update(row).eq('id', id).select('id'));
      else id = (check(await supabase.from('menu_items').insert({ ...row, restaurant_id: r.id, sort_order: (count + 1) * 10 }).select('id').single()) as { id: string }).id;
      // variants: update kept ones, insert new ones, delete removed ones
      const keep = variants.filter(v => v.id).map(v => v.id!);
      const removed = (item?.item_variants ?? []).filter(v => !keep.includes(v.id!)).map(v => v.id!);
      if (removed.length) check(await supabase.from('item_variants').delete().in('id', removed).select('id'));
      for (const [k, v] of variants.entries()) {
        const vr = { name: v.name, price_cents: toCents(v.priceText), sort_order: k, active: true };
        if (v.id) check(await supabase.from('item_variants').update(vr).eq('id', v.id).select('id'));
        else check(await supabase.from('item_variants').insert({ ...vr, restaurant_id: r.id, menu_item_id: id }).select('id'));
      }
      a.toast('Article enregistré'); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const remove = async () => {
    try { check(await supabase.from('menu_items').delete().eq('id', item!.id).select('id')); a.toast('Article supprimé'); onSaved(); } catch (e) { a.fail(e); }
  };

  return (
    <Modal wide title={item ? tr(item.name, r.languages[0]) : 'Nouvel article'} onClose={onClose}
      footer={<div className="flex justify-between">{item ? <Btn tone="danger" onClick={remove}><Trash2 className="h-4 w-4" /> Supprimer</Btn> : <span />}<Btn tone="brand" disabled={!ok || busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Btn></div>}>
      <div className="grid gap-5 md:grid-cols-[1fr_240px]">
        <div className="space-y-4">
          <Field group label="Nom"><I18nInput ariaLabel="Nom" value={name} onChange={setName} langs={r.languages} required /></Field>
          <Field group label="Description"><I18nInput value={desc} onChange={setDesc} langs={r.languages} multiline max={500} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Catégorie">
              <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
                {cats.map(c => <option key={c.id} value={c.id}>{tr(c.name, r.languages[0])}</option>)}
              </select>
            </Field>
            {!variants.length && <Field label="Prix (MAD)"><input className={inputCls} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="35" /></Field>}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold">Tailles / options {variants.length ? '' : '(facultatif)'}</span>
              <Btn className="px-3 py-1.5" onClick={() => setVariants(v => [...v, { name: {}, price_cents: 0, priceText: price, sort_order: v.length, active: true }])}><Plus className="h-4 w-4" /> Option</Btn>
            </div>
            {variants.map((v, k) => (
              <div key={v.id ?? k} className="mb-2 flex items-start gap-2">
                <div className="min-w-0 flex-1"><I18nInput compact ariaLabel={`Option ${k + 1}`} value={v.name} onChange={n => setVariants(vs => vs.map((x, j) => j === k ? { ...x, name: n } : x))} langs={r.languages} max={60} /></div>
                <div className="mt-8 w-24 shrink-0"><input aria-label={`Prix option ${k + 1}`} className={inputCls} inputMode="decimal" placeholder="Prix" value={v.priceText} onChange={e => setVariants(vs => vs.map((x, j) => j === k ? { ...x, priceText: e.target.value } : x))} /></div>
                <button onClick={() => setVariants(vs => vs.filter((_, j) => j !== k))} className="mt-8 grid h-11 w-10 place-items-center rounded-lg text-danger hover:bg-danger/10"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {variants.length > 0 && <p className="text-xs text-muted">Avec des options, le client doit en choisir une ; chaque option a son prix.</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            {Object.entries(TAGS).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTags(t => t.includes(k) ? t.filter(x => x !== k) : [...t, k])}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${tags.includes(k) ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{l}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="TVA">
              <select className={inputCls} value={vat} onChange={e => setVat(e.target.value)}>
                <option value="">Par défaut du restaurant ({r.default_vat_bp / 100} %)</option>
                {[0, 700, 1000, 1400, 2000].map(v => <option key={v} value={v}>{v / 100} %</option>)}
              </select>
            </Field>
            <Field label="Préparé à">
              <select className={inputCls} value={station} onChange={e => setStation(e.target.value)}>
                <option value="">Comme la catégorie</option><option value="kitchen">Cuisine</option><option value="bar">Bar</option>
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-6">
            <Toggle checked={active} onChange={setActive} label="Visible" />
            <Toggle checked={available} onChange={setAvailable} label="Disponible aujourd'hui" />
          </div>
        </div>
        <Field group label="Photo"><ImageField url={image} onChange={setImage} upload={f => uploadImage(r.id, 'items', f)} /></Field>
      </div>
    </Modal>
  );
}
