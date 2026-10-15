// The extra content of a premium website (Maison): the story told in chapters, the chef's word,
// three dishes the house recommends, and the request form (group, private event, catering).
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check } from '../lib/api';
import { uploadImage } from '../lib/image';
import { t } from '../lib/i18n';
import type { I18n, Restaurant } from '../lib/types';
import { Btn, Card, Field, I18nInput, ImageField, Toggle, inputCls } from './ui';

type Site = NonNullable<Restaurant['site']>;
const L = (v: I18n | undefined, lang: string) => v?.[lang] || Object.values(v ?? {}).find(Boolean) || '';

export function SitePremium({ r, s, set }: { r: Restaurant; s: Site; set: (p: Partial<Site>) => void }) {
  const [items, setItems] = useState<{ id: string; name: I18n }[]>([]);
  useEffect(() => {
    supabase.from('menu_items').select('id, name').eq('restaurant_id', r.id).eq('active', true).order('sort_order')
      .then(res => { try { setItems(check(res) as { id: string; name: I18n }[]); } catch { /* the list stays empty */ } });
  }, [r.id]);
  const up = (f: File) => uploadImage(r.id, 'site', f, 1600);
  const story = s.story ?? [];
  const setStory = (i: number, p: Partial<NonNullable<Site['story']>[number]>) => set({ story: story.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const move = (i: number, d: number) => { const n = [...story]; [n[i], n[i + d]] = [n[i + d], n[i]]; set({ story: n }); };
  const chef = s.chef ?? {};
  const sigs = s.signatures ?? [];
  const lang = r.languages[0];

  return (
    <>
      <Card>
        <h2 className="mb-1 font-display text-xl font-semibold">{t('Votre histoire')}</h2>
        <p className="mb-4 text-sm text-muted">{t('Racontez la maison en deux à quatre chapitres, chacun avec une photo : comment tout a commencé, la cuisine, la salle, l’équipe. Sans chapitre, le site montre le texte de bienvenue.')}</p>
        <div className="space-y-4">
          {story.map((c, i) => (
            <div key={i} className="rounded-2xl border border-line/10 p-4">
              <div className="mb-3 flex items-center gap-2">
                <p className="flex-1 font-semibold">{t('Chapitre {n}', { n: i + 1 })}</p>
                <button type="button" disabled={!i} onClick={() => move(i, -1)} aria-label={t('Monter')} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-2 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" disabled={i === story.length - 1} onClick={() => move(i, 1)} aria-label={t('Descendre')} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-2 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => set({ story: story.filter((_, j) => j !== i) })} aria-label={t('Supprimer')} className="grid h-8 w-8 place-items-center rounded-lg text-danger hover:bg-danger/10"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
                <ImageField url={c.image ?? null} onChange={u => setStory(i, { image: u ?? undefined })} upload={up} aspect="aspect-[4/5]" />
                <div className="space-y-3">
                  <Field group label={t('Titre')}><I18nInput max={60} langs={r.languages} value={c.title ?? {}} onChange={v => setStory(i, { title: v })} /></Field>
                  <Field group label={t('Texte')}><I18nInput multiline max={500} langs={r.languages} value={c.text ?? {}} onChange={v => setStory(i, { text: v })} /></Field>
                </div>
              </div>
            </div>
          ))}
        </div>
        {story.length < 4 && <Btn className="mt-4" onClick={() => set({ story: [...story, {}] })}><Plus className="h-4 w-4" /> {t('Ajouter un chapitre')}</Btn>}
      </Card>

      <Card>
        <h2 className="mb-1 font-display text-xl font-semibold">{t('Le mot du chef')}</h2>
        <p className="mb-4 text-sm text-muted">{t('Une photo et une phrase du chef ou de la patronne. Laissez vide pour ne pas afficher ce bloc.')}</p>
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <ImageField url={chef.photo ?? null} onChange={u => set({ chef: { ...chef, photo: u ?? undefined } })} upload={up} aspect="aspect-[3/4]" />
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Nom')}><input className={inputCls} maxLength={60} value={chef.name ?? ''} onChange={e => set({ chef: { ...chef, name: e.target.value } })} placeholder="Yasmine B." /></Field>
              <Field group label={t('Rôle')}><I18nInput compact max={40} langs={r.languages} value={chef.role ?? {}} onChange={v => set({ chef: { ...chef, role: v } })} /></Field>
            </div>
            <Field group label={t('Sa phrase')}><I18nInput multiline max={220} langs={r.languages} value={chef.text ?? {}} onChange={v => set({ chef: { ...chef, text: v } })} /></Field>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 font-display text-xl font-semibold">{t('La maison recommande')}</h2>
        <p className="mb-4 text-sm text-muted">{t('Trois plats de votre carte mis en avant, avec une phrase à vous. Sans choix, le site prend vos plats populaires.')}</p>
        <div className="space-y-3">
          {sigs.map((g, i) => (
            <div key={i} className="grid gap-3 rounded-2xl border border-line/10 p-4 sm:grid-cols-[1fr_2fr_auto]">
              <Field label={t('Plat')}><select className={inputCls} value={g.item_id} onChange={e => set({ signatures: sigs.map((x, j) => (j === i ? { ...x, item_id: e.target.value } : x)) })}>
                {!items.some(it => it.id === g.item_id) && <option value={g.item_id}>{t('Plat retiré de la carte')}</option>}
                {items.map(it => <option key={it.id} value={it.id}>{L(it.name, lang)}</option>)}
              </select></Field>
              <Field group label={t('Votre phrase (facultatif)')}><I18nInput max={140} langs={r.languages} value={g.text ?? {}} onChange={v => set({ signatures: sigs.map((x, j) => (j === i ? { ...x, text: v } : x)) })} /></Field>
              <button type="button" onClick={() => set({ signatures: sigs.filter((_, j) => j !== i) })} aria-label={t('Supprimer')} className="grid h-10 w-10 place-items-center self-end rounded-lg text-danger hover:bg-danger/10"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        {sigs.length < 3 && items.length > 0 && <Btn className="mt-4" onClick={() => set({ signatures: [...sigs, { item_id: (items.find(it => !sigs.some(x => x.item_id === it.id)) ?? items[0]).id }] })}><Plus className="h-4 w-4" /> {t('Ajouter un plat')}</Btn>}
      </Card>

      <Card>
        <h2 className="mb-1 font-display text-xl font-semibold">{t('Demandes d’événements')}</h2>
        <p className="mb-4 text-sm text-muted">{t('Un formulaire sur le site pour un groupe, une privatisation ou un traiteur. Chaque demande arrive dans Traiteur comme un devis à préparer, avec le nom et le téléphone du client.')}</p>
        <Toggle checked={s.request !== false} onChange={v => set({ request: v })} label={t('Afficher le formulaire de demande')} />
      </Card>
    </>
  );
}
