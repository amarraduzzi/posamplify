// The supplier sheet: who he is (contact, WhatsApp, address), the papers the accountant needs (ICE, IF, RC,
// RIB, terms, way of paying), how he delivers (days, delay, minimum order) and what he delivers: per product
// his reference, his packaging, the agreed price, and whether he is the usual supplier of it (the purchase
// orders then go to him at that price). A product can come from several suppliers.
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Plus, Star, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad, toCents } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, Toggle, inputCls } from './ui';

interface Sup {
  id: string; name: string; phone: string | null; email: string | null; contact: string | null; delivery_days: number[]; lead_days: number; note: string | null; active: boolean;
  address: string | null; city: string | null; ice: string | null; if_number: string | null; rc: string | null; rib: string | null;
  pay_method: string | null; min_order_cents: number | null; payment_terms_days: number;
}
interface Ing { id: string; name: string; purchase_unit: string; purchase_price_cents: number | null }
interface Link { id?: string; ingredient_id: string; ref: string; pack: string; price: string; main: boolean }
interface Other { ingredient_id: string; supplier_id: string; is_main: boolean }

// i18n:values
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const TERMS: [number, string][] = [[0, 'À la livraison'], [7, '7 jours'], [15, '15 jours'], [30, '30 jours'], [45, '45 jours'], [60, '60 jours']];
const METHODS: [string, string][] = [['cash', 'Espèces'], ['transfer', 'Virement'], ['check', 'Chèque'], ['card', 'Carte']];
// i18n:end
const digits = (s: string) => s.replace(/\D/g, '');
/** "06 61 00 00 00" -> "212661000000" (wa.me wants international digits) */
const intlPhone = (v: string) => { const d = digits(v); return !d ? '' : d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '212' + d.slice(1) : d; };
const money = (c: number | null | undefined) => (c == null ? '' : String(c / 100).replace('.', ','));
const ribShow = (s: string) => digits(s).replace(/(\d{3})(\d{3})(\d{16})(\d{2})/, '$1 $2 $3 $4');

export function SupplierSheet({ r, supplierId, onClose, onSaved }: { r: Restaurant; supplierId: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const a = useAdminCtx();
  const [f, setF] = useState({ name: '', contact: '', phone: '', email: '', address: '', city: '', ice: '', if_number: '', rc: '', rib: '', terms: 0, method: '' as string,
    days: [] as number[], lead: '1', min: '', note: '', active: true });
  const [links, setLinks] = useState<Link[]>([]);
  const [before, setBefore] = useState<Link[]>([]);
  const [ings, setIngs] = useState<Ing[]>([]);
  const [others, setOthers] = useState<Other[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [ready, setReady] = useState(!supplierId);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  // products bought from him (purchases noted) that are not linked yet
  const [bought, setBought] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [g, sp, ss] = await Promise.all([
          supabase.from('ingredients').select('id, name, purchase_unit, purchase_price_cents').eq('restaurant_id', r.id).eq('active', true).eq('is_preparation', false).order('name'),
          supabase.from('supplier_products').select('id, supplier_id, ingredient_id, ref, pack_label, price_cents, is_main').eq('restaurant_id', r.id),
          supabase.from('suppliers').select('id, name').eq('restaurant_id', r.id),
        ]);
        setIngs(check(g) as Ing[]);
        setNames(new Map((check(ss) as { id: string; name: string }[]).map(x => [x.id, x.name])));
        const all = check(sp) as { id: string; supplier_id: string; ingredient_id: string; ref: string | null; pack_label: string | null; price_cents: number | null; is_main: boolean }[];
        setOthers(all.filter(x => x.supplier_id !== supplierId).map(x => ({ ingredient_id: x.ingredient_id, supplier_id: x.supplier_id, is_main: x.is_main })));
        if (supplierId) {
          const s = check(await supabase.from('suppliers').select('*').eq('id', supplierId).single()) as unknown as Sup;
          setF({ name: s.name, contact: s.contact ?? '', phone: s.phone ? `+${s.phone}` : '', email: s.email ?? '', address: s.address ?? '', city: s.city ?? '',
            ice: s.ice ?? '', if_number: s.if_number ?? '', rc: s.rc ?? '', rib: s.rib ? ribShow(s.rib) : '', terms: s.payment_terms_days ?? 0, method: s.pay_method ?? '',
            days: s.delivery_days ?? [], lead: String(s.lead_days ?? 1), min: money(s.min_order_cents), note: s.note ?? '', active: s.active });
          const mine = all.filter(x => x.supplier_id === supplierId).map(x => ({ id: x.id, ingredient_id: x.ingredient_id, ref: x.ref ?? '', pack: x.pack_label ?? '', price: money(x.price_cents), main: x.is_main }));
          setLinks(mine); setBefore(mine);
          const pb = check(await supabase.from('stock_purchases').select('ingredient_id').eq('restaurant_id', r.id).eq('supplier_id', supplierId).limit(500)) as { ingredient_id: string }[];
          setBought([...new Set(pb.map(x => x.ingredient_id))]);
        }
        setReady(true);
      } catch (e) { a.fail(e); onClose(); }
    })();
  }, [r.id, supplierId]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(ings.map(g => [g.id, g])), [ings]);
  const usualElsewhere = (ingId: string) => others.find(o => o.ingredient_id === ingId && o.is_main);
  const set = (i: number, p: Partial<Link>) => setLinks(ls => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const free = ings.filter(g => !links.some(l => l.ingredient_id === g.id) && (!q.trim() || g.name.toLowerCase().includes(q.trim().toLowerCase())));
  const add = (g: Ing) => { setLinks(ls => [...ls, { ingredient_id: g.id, ref: '', pack: '', price: '', main: !usualElsewhere(g.id) }]); setQ(''); };

  const ice = digits(f.ice), rib = digits(f.rib), ifn = digits(f.if_number);
  const errors = [
    !f.name.trim() && t('Indiquez le nom du fournisseur.'),
    ice && ice.length !== 15 && t('L’ICE a 15 chiffres.'),
    rib && rib.length !== 24 && t('Le RIB a 24 chiffres.'),
    ifn && ifn.length > 12 && t('L’IF a au plus 12 chiffres.'),
  ].filter(Boolean) as string[];

  const save = async () => {
    if (errors.length) { a.toast(errors[0], 'error'); return; }
    setBusy(true);
    try {
      const row = {
        name: f.name.trim(), contact: f.contact.trim() || null, phone: intlPhone(f.phone) || null, email: f.email.trim() || null,
        address: f.address.trim() || null, city: f.city.trim() || null, ice: ice || null, if_number: ifn || null, rc: f.rc.trim() || null, rib: rib || null,
        payment_terms_days: f.terms, pay_method: f.method || null, delivery_days: [...f.days].sort(), lead_days: Math.max(0, Math.min(30, Math.round(Number(f.lead) || 0))),
        min_order_cents: f.min.trim() ? toCents(f.min) : null, note: f.note.trim() || null, active: f.active,
      };
      let id = supplierId;
      if (id) check(await supabase.from('suppliers').update(row).eq('id', id).select('id'));
      else id = (check(await supabase.from('suppliers').insert({ ...row, restaurant_id: r.id }).select('id')) as { id: string }[])[0].id;
      // the products: removed, changed, new (the usual one last, so the database moves the product to him)
      const keep = new Set(links.filter(l => l.id).map(l => l.id));
      const gone = before.filter(l => !keep.has(l.id)).map(l => l.id!);
      if (gone.length) check(await supabase.from('supplier_products').delete().in('id', gone).select('id'));
      const ordered = [...links].sort((x, y) => Number(x.main) - Number(y.main));
      for (const l of ordered) {
        const v = { ref: l.ref.trim() || null, pack_label: l.pack.trim() || null, price_cents: l.price.trim() ? toCents(l.price) : null, is_main: l.main };
        const old = before.find(b => b.id === l.id);
        if (l.id && old && old.ref === l.ref && old.pack === l.pack && old.price === l.price && old.main === l.main) continue;
        if (l.id) check(await supabase.from('supplier_products').update(v).eq('id', l.id).select('id'));
        else check(await supabase.from('supplier_products').insert({ ...v, restaurant_id: r.id, supplier_id: id, ingredient_id: l.ingredient_id }).select('id'));
      }
      a.toast(t('Fiche enregistrée')); onSaved(id!);
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const remove = async () => {
    if (!supplierId || !window.confirm(t('Supprimer {name} ?', { name: f.name }))) return;
    try { check(await supabase.from('suppliers').delete().eq('id', supplierId).select('id')); a.toast(t('Fournisseur supprimé')); onSaved(supplierId); } catch (e) { a.fail(e); }
  };

  const box = 'space-y-3 rounded-2xl bg-surface-2 p-4';
  const h = 'font-display text-lg font-semibold';
  return (
    <Modal wide title={supplierId ? f.name || t('Fournisseur') : t('Nouveau fournisseur')} onClose={onClose}
      footer={<div className="flex flex-wrap items-center gap-3">
        {supplierId ? <Btn tone="danger" onClick={remove}><Trash2 className="h-4 w-4" /> {t('Supprimer')}</Btn> : null}
        {supplierId && <Toggle checked={f.active} onChange={v => setF({ ...f, active: v })} label={t('Actif')} />}
        <Btn tone="brand" className="ms-auto" disabled={busy || !ready} onClick={save}>{t('Enregistrer')}</Btn>
      </div>}>
      {!ready ? <p className="text-muted">{t('Chargement…')}</p> : (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className={box}>
              <h3 className={h}>{t('Coordonnées')}</h3>
              <Field label={t('Nom')}><input autoFocus={!supplierId} className={inputCls} maxLength={80} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={t('Metro, grossiste Hay Riad…')} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('Contact')}><input className={inputCls} maxLength={80} value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })} placeholder={t('Prénom')} /></Field>
                <Field label={t('WhatsApp')}><input className={inputCls} dir="ltr" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="06 61 00 00 00" /></Field>
              </div>
              <Field label={t('E-mail')}><input className={inputCls} dir="ltr" type="email" maxLength={120} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
              <div className="grid grid-cols-[2fr_1fr] gap-3">
                <Field label={t('Adresse')}><input className={inputCls} maxLength={200} value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
                <Field label={t('Ville')}><input className={inputCls} maxLength={60} value={f.city} onChange={e => setF({ ...f, city: e.target.value })} /></Field>
              </div>
            </section>

            <section className={box}>
              <h3 className={h}>{t('Administratif')}</h3>
              <div className="grid grid-cols-2 gap-3">
                <Field label="ICE"><input className={`${inputCls} tabular`} dir="ltr" inputMode="numeric" maxLength={20} value={f.ice} onChange={e => setF({ ...f, ice: e.target.value })} placeholder={t('15 chiffres')} /></Field>
                <Field label={t('IF')}><input className={`${inputCls} tabular`} dir="ltr" inputMode="numeric" maxLength={14} value={f.if_number} onChange={e => setF({ ...f, if_number: e.target.value })} /></Field>
              </div>
              <div className="grid grid-cols-[1fr_2fr] gap-3">
                <Field label={t('RC')}><input className={inputCls} dir="ltr" maxLength={30} value={f.rc} onChange={e => setF({ ...f, rc: e.target.value })} /></Field>
                <Field label={t('RIB')}><input className={`${inputCls} tabular`} dir="ltr" inputMode="numeric" maxLength={32} value={f.rib} onChange={e => setF({ ...f, rib: e.target.value })} onBlur={() => setF(x => ({ ...x, rib: digits(x.rib).length === 24 ? ribShow(x.rib) : x.rib }))} placeholder={t('24 chiffres')} /></Field>
              </div>
              <Field label={t('Paiement')}>
                <select className={inputCls} value={f.terms} onChange={e => setF({ ...f, terms: Number(e.target.value) })}>{TERMS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
              </Field>
              <Field group label={t('Moyen de paiement habituel')}>
                <div className="flex flex-wrap gap-1.5">
                  {METHODS.map(([k, l]) => <button key={k} type="button" onClick={() => setF({ ...f, method: f.method === k ? '' : k })} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${f.method === k ? 'bg-night text-white' : 'bg-surface text-muted'}`}>{t(l)}</button>)}
                </div>
              </Field>
              {errors.filter(x => x !== t('Indiquez le nom du fournisseur.')).map(x => <p key={x} className="text-sm text-warn">{x}</p>)}
            </section>
          </div>

          <section className={box}>
            <h3 className={h}>{t('Livraison')}</h3>
            <Field group label={t('Jours de livraison')}>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => { const on = f.days.includes(i + 1); return <button key={d} type="button" onClick={() => setF({ ...f, days: on ? f.days.filter(x => x !== i + 1) : [...f.days, i + 1] })} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${on ? 'bg-night text-white' : 'bg-surface text-muted'}`}><CalendarDays className="me-1 inline h-3.5 w-3.5" />{t(d)}</button>; })}
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-[8rem_10rem_1fr]">
              <Field label={t('Délai (jours)')}><input className={inputCls} inputMode="numeric" value={f.lead} onChange={e => setF({ ...f, lead: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label={t('Commande minimum (DH)')}><input className={inputCls} inputMode="decimal" value={f.min} onChange={e => setF({ ...f, min: e.target.value })} /></Field>
              <Field label={t('Note')}><input className={inputCls} maxLength={300} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={t('Livre avant 8 h, appeler la veille…')} /></Field>
            </div>
          </section>

          <section className={box}>
            <div className="flex flex-wrap items-end gap-2">
              <div className="me-auto">
                <h3 className={h}>{t('Ses produits ({n})', { n: links.length })}</h3>
                <p className="text-sm text-muted">{t('L’étoile = votre fournisseur habituel pour ce produit : les bons de commande vont chez lui, au prix convenu.')}</p>
              </div>
            </div>
            {links.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead><tr className="text-xs uppercase tracking-wider text-muted">
                    <th className="w-10 pb-2" /><th className="min-w-[9rem] pb-2 pe-3 text-start">{t('Produit')}</th><th className="pb-2 text-start">{t('Sa référence')}</th><th className="pb-2 text-start">{t('Conditionnement')}</th><th className="pb-2 text-end">{t('Prix convenu')}</th><th className="w-10 pb-2" />
                  </tr></thead>
                  <tbody className="divide-y divide-line/10">
                    {links.map((l, i) => {
                      const g = byId.get(l.ingredient_id);
                      const other = usualElsewhere(l.ingredient_id);
                      return (
                        <tr key={l.ingredient_id}>
                          <td className="py-2"><button type="button" aria-pressed={l.main} aria-label={t('Fournisseur habituel')} title={t('Fournisseur habituel')} onClick={() => set(i, { main: !l.main })}
                            className={`grid h-9 w-9 place-items-center rounded-lg ${l.main ? 'text-brand' : 'text-muted/50 hover:text-muted'}`}><Star className={`h-5 w-5 ${l.main ? 'fill-current' : ''}`} /></button></td>
                          <td className="py-2 pe-2">
                            <span className="block font-semibold">{g?.name ?? '?'}</span>
                            {l.main && other ? <span className="block text-xs text-warn">{t('Remplace {s} comme habituel', { s: names.get(other.supplier_id) ?? '' })}</span>
                              : !l.main && other ? <span className="block text-xs text-muted">{t('Habituel : {s}', { s: names.get(other.supplier_id) ?? '' })}</span> : null}
                          </td>
                          <td className="py-2 pe-2"><input className={`${inputCls} !py-1.5`} maxLength={40} value={l.ref} onChange={e => set(i, { ref: e.target.value })} placeholder="—" /></td>
                          <td className="py-2 pe-2"><input className={`${inputCls} !py-1.5`} maxLength={40} value={l.pack} onChange={e => set(i, { pack: e.target.value })} placeholder={g?.purchase_unit ?? ''} /></td>
                          <td className="py-2 pe-2"><div className="flex items-center justify-end gap-1.5">
                            <input className={`${inputCls} !w-24 !py-1.5 text-end`} inputMode="decimal" value={l.price} onChange={e => set(i, { price: e.target.value })} placeholder={g?.purchase_price_cents != null ? money(g.purchase_price_cents) : '—'} />
                            <span className="w-16 truncate text-xs text-muted">/ {g?.purchase_unit}</span></div></td>
                          <td className="py-2"><button type="button" aria-label={t('Retirer')} onClick={() => setLinks(ls => ls.filter((_, j) => j !== i))} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {(() => {
              const sug = bought.filter(id => !links.some(l => l.ingredient_id === id)).map(id => byId.get(id)).filter((g): g is Ing => !!g);
              return sug.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm text-muted">{t('Déjà achetés chez lui :')}</span>
                  {sug.map(g => <button key={g.id} type="button" onClick={() => add(g)} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-3 py-1.5 text-sm font-semibold hover:bg-brand/20"><Plus className="h-3.5 w-3.5" />{g.name}</button>)}
                </div>
              );
            })()}
            <div>
              <input className={inputCls} value={q} onChange={e => setQ(e.target.value)} placeholder={t('Ajouter un produit : tapez son nom')} />
              {q.trim() && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {free.slice(0, 12).map(g => (
                    <button key={g.id} type="button" onClick={() => add(g)} className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold ring-1 ring-line/15 hover:bg-brand/10">
                      <Plus className="h-3.5 w-3.5" />{g.name}{g.purchase_price_cents != null && <span className="text-xs font-normal text-muted">{mad(g.purchase_price_cents)}</span>}</button>
                  ))}
                  {!free.length && <span className="text-sm text-muted">{t('Rien trouvé.')}</span>}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
