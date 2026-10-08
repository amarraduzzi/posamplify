import { useEffect, useState } from 'react';
import { MessageCircle, Plus, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, rpc } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, inputCls } from '../components/ui';
import { dateLocale, t } from '../lib/i18n';

// i18n:values
const STATUS: Record<string, string> = { trial: 'Essai', active: 'Actif', paused: 'Suspendu', cancelled: 'Résilié' };
// i18n:end

/** Your own screen: all restaurants, create one, pause for non-payment, add logins. */
export function PlatformPage() {
  const a = useAdminCtx();
  const [list, setList] = useState<Restaurant[]>([]);
  const [creating, setCreating] = useState(false);
  const [member, setMember] = useState<Restaurant | null>(null);
  const [removing, setRemoving] = useState<Restaurant | null>(null);
  const load = async () => { try { setList(check(await supabase.from('restaurants').select('*').order('created_at')) as Restaurant[]); } catch (e) { a.fail(e); } };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const status = async (r: Restaurant, s: string, days?: number) => {
    try {
      await rpc('admin_set_status', { p_restaurant_id: r.id, p_status: s, p_trial_ends_at: days ? new Date(Date.now() + days * 86400000).toISOString() : null });
      a.toast(t('{name} : {status}', { name: r.name, status: t(STATUS[s]) })); await load(); await a.reload();
    } catch (e) { a.fail(e); }
  };
  const setProducts = async (r: Restaurant, products: string[], plan?: 'essentiel' | 'restaurant') => {
    if (!products.length) { a.toast(t('Gardez au moins un produit.'), 'error'); return; }
    try {
      const res = await rpc<{ products: string[]; pos_plan: string; devices: number }>('admin_set_products', { p_restaurant_id: r.id, p_products: products, p_pos_plan: plan ?? null });
      a.toast(res.pos_plan === 'essentiel' && res.devices > 1 && res.products.includes('pos')
        ? t('{name} : Essentiel, mais {n} caisses déjà reliées. Retirez-en pour n’en garder qu’une.', { name: r.name, n: res.devices })
        : t('{name} : mis à jour', { name: r.name }));
      await load(); await a.reload();
    } catch (e) { a.fail(e); }
  };
  return (
    <div>
      <div className="mb-6 flex items-center justify-between"><h1 className="font-display text-3xl font-semibold">{t('Plateforme')}</h1><Btn tone="brand" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> {t('Nouveau restaurant')}</Btn></div>
      <div className="overflow-x-auto card rounded-3xl">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-muted"><tr><th className="px-4 py-2 text-start">{t('Restaurant')}</th><th className="text-start">{t('Statut')}</th><th className="text-start">{t("Fin d'essai")}</th><th className="text-start">{t('Produits')}</th><th className="px-4 text-end">{t('Actions')}</th></tr></thead>
          <tbody>
            {list.map(r => (
              <tr key={r.id} className="border-t border-line/10">
                <td className="px-4 py-2.5"><p className="font-semibold">{r.name}</p><p className="text-xs text-muted">{r.slug}{r.is_demo ? ` · ${t('démo')}` : ''}</p></td>
                <td><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.status === 'active' ? 'bg-ok/15 text-ok' : r.status === 'trial' ? 'bg-warn/15 text-warn' : 'bg-danger/10 text-danger'}`}>{t(STATUS[r.status])}</span></td>
                <td className="tabular">{r.trial_ends_at && r.status === 'trial' ? new Date(r.trial_ends_at).toLocaleDateString(dateLocale()) : '—'}</td>
                <td className="py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {(['pos', 'profit', 'site'] as const).map(k => {
                      const on = (r.products ?? []).includes(k);
                      return <button key={k} onClick={() => setProducts(r, on ? (r.products ?? []).filter(x => x !== k) : [...(r.products ?? []), k], r.pos_plan)}
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${on ? 'bg-night text-white' : 'bg-surface-2 text-muted line-through'}`}>{k === 'pos' ? 'POS' : k === 'profit' ? 'Profit' : 'Site'}</button>;
                    })}
                    {(r.products ?? []).includes('pos') && (
                      <select aria-label={t('Formule POS')} className="rounded-lg border border-line/15 bg-surface px-1.5 py-1 text-xs" value={r.pos_plan ?? 'restaurant'} onChange={e => setProducts(r, r.products ?? ['pos'], e.target.value as 'essentiel' | 'restaurant')}>
                        <option value="essentiel">{t('Essentiel')}</option><option value="restaurant">{t('Restaurant')}</option>
                      </select>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 text-end">
                  <div className="flex flex-wrap justify-end gap-1">
                    <Btn className="px-2.5 py-1.5" aria-label={t('Accès à {name}', { name: r.name })} onClick={() => setMember(r)}><UserPlus className="h-4 w-4" /></Btn>
                    {r.status !== 'active' && <Btn className="px-2.5 py-1.5" onClick={() => status(r, 'active')}>{t('Activer')}</Btn>}
                    {r.status === 'trial' && <Btn className="px-2.5 py-1.5" onClick={() => status(r, 'trial', 14)}>{t('+14 j')}</Btn>}
                    {r.status !== 'paused' && <Btn tone="danger" className="px-2.5 py-1.5" onClick={() => status(r, 'paused')}>{t('Suspendre')}</Btn>}
                    {(r.status === 'paused' || r.status === 'cancelled' || r.is_demo) && <Btn tone="danger" className="px-2.5 py-1.5" aria-label={t('Supprimer {name}', { name: r.name })} onClick={() => setRemoving(r)}><Trash2 className="h-4 w-4" /></Btn>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">{t("Suspendre : le menu reste visible, mais les commandes et la caisse sont bloquées jusqu'à la réactivation.")} {t('Supprimer définitivement : possible une fois suspendu.')}</p>
      <SiteLeads />
      {creating && <CreateRestaurant onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await load(); await a.reload(); }} />}
      {member && <AddMember r={member} onClose={() => setMember(null)} />}
      {removing && <DeleteRestaurant r={removing} onClose={() => setRemoving(null)} onDone={async () => { setRemoving(null); await load(); await a.reload(); }} />}
    </div>
  );
}

function CreateRestaurant({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [demo, setDemo] = useState(false);
  const [kind, setKind] = useState<'all' | 'pos' | 'profit' | 'site'>('all');
  const [city, setCity] = useState('');
  const [theme, setTheme] = useState<'riad' | 'nuit' | 'moderne'>('riad');
  const [busy, setBusy] = useState(false);
  const auto = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const create = async () => {
    setBusy(true);
    try {
      await rpc('admin_create_restaurant', { p_slug: slug, p_name: name.trim(), p_owner_email: email.trim() || null, p_is_demo: demo,
        p_products: kind === 'all' ? ['pos', 'profit'] : [kind], p_city: city.trim() || null, p_theme: kind === 'site' ? theme : null });
      a.toast(t('Restaurant créé (essai de 14 jours)')); onDone();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={t('Nouveau restaurant')} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !name.trim() || slug.length < 3} onClick={create}>{t('Créer')}</Btn></div>}>
      <div className="space-y-4">
        <Field group label={t('Produits')}>
          <div className="flex flex-wrap gap-2">{([['all', 'POS + Profit'], ['pos', 'POS'], ['profit', 'Profit'], ['site', 'Site']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${kind === k ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{l}</button>))}</div>
        </Field>
        <Field label={t('Nom')}><input autoFocus className={inputCls} value={name} onChange={e => { setName(e.target.value); setSlug(auto(e.target.value)); }} /></Field>
        <Field label={t('Ville')}><input className={inputCls} value={city} onChange={e => setCity(e.target.value)} placeholder="Rabat" /></Field>
        {kind === 'site' && <Field label={t('Style du site')}><select className={inputCls} value={theme} onChange={e => setTheme(e.target.value as typeof theme)}><option value="riad">Riad</option><option value="nuit">Nuit</option><option value="moderne">Moderne</option></select></Field>}
        {kind === 'site' && <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{t('Démo de site : choisissez ensuite ce restaurant à gauche, importez la carte (Menu) et ajoutez la photo (Restaurant). Le site n’est pas sur Google tant qu’il n’est pas mis en ligne.')}</p>}
        <Field label={t('Adresse du menu')} hint={t('Le menu sera sur …/{slug}', { slug: slug || 'nom-du-restaurant' })}><input dir="ltr" className={inputCls} value={slug} onChange={e => setSlug(auto(e.target.value))} /></Field>
        <Field label={t('E-mail du propriétaire (facultatif)')} hint={t('Le compte doit déjà exister : Supabase > Authentication > Users > Add user.')}><input dir="ltr" className={inputCls} type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)} /> {t('Restaurant de démonstration')}</label>
      </div>
    </Modal>
  );
}

function AddMember({ r, onClose }: { r: Restaurant; onClose: () => void }) {
  const a = useAdminCtx();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'manager' | 'device'>('device');
  const add = async () => {
    try { await rpc('admin_add_member', { p_restaurant_id: r.id, p_email: email.trim(), p_role: role }); a.toast(t('Accès ajouté')); onClose(); } catch (e) { a.fail(e); }
  };
  return (
    <Modal title={t('Accès à {name}', { name: r.name })} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={!email.includes('@')} onClick={add}>{t('Ajouter')}</Btn></div>}>
      <div className="space-y-4">
        <Field label={t('E-mail du compte')} hint={t("Créez d'abord le compte dans Supabase > Authentication > Users (Auto Confirm).")}><input autoFocus dir="ltr" className={inputCls} type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field label={t('Rôle')}>
          <select className={inputCls} value={role} onChange={e => setRole(e.target.value as typeof role)}>
            <option value="device">{t('Caisse (poste)')}</option><option value="manager">{t('Manager (menu, personnel, tables)')}</option><option value="owner">{t('Propriétaire (tout)')}</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

/** Delete a client for good: everything goes, including the fiscal tickets and the till logins. */
function DeleteRestaurant({ r, onClose, onDone }: { r: Restaurant; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [typed, setTyped] = useState('');
  const [tickets, setTickets] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from('fiscal_documents').select('id', { count: 'exact', head: true }).eq('restaurant_id', r.id)
      .then(res => setTickets(res.count ?? 0));
  }, [r.id]);
  const ok = typed.trim().toLowerCase() === r.slug;
  const remove = async () => {
    setBusy(true);
    try {
      await rpc('admin_delete_restaurant', { p_restaurant_id: r.id, p_confirm_slug: typed });
      a.toast(t('{name} supprimé définitivement', { name: r.name })); onDone();
    } catch (e) { a.fail(e); setBusy(false); }
  };
  return (
    <Modal title={t('Supprimer {name} ?', { name: r.name })} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Btn onClick={onClose}>{t('Annuler')}</Btn><Btn tone="danger" disabled={!ok || busy} onClick={remove}><Trash2 className="h-4 w-4" /> {t('Supprimer définitivement')}</Btn></div>}>
      <div className="space-y-4">
        <p>{t('Tout est effacé : menu, tables, ventes, tickets, stock, équipe, clients et les connexions des caisses. Impossible à annuler.')}</p>
        {!!tickets && <p className="rounded-xl bg-danger/10 p-3 text-sm font-semibold text-danger">{t('Ce restaurant a {n} ticket(s) fiscal(aux). Le commerçant doit garder ses ventes 10 ans : exportez-les d’abord (Ventes, export comptable) et envoyez-les-lui.', { n: tickets })}</p>}
        <Field label={t('Tapez « {slug} » pour confirmer', { slug: r.slug })}><input className={inputCls} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" /></Field>
      </div>
    </Modal>
  );
}

type Lead = { id: string; name: string; slug: string; city: string | null; phone: string | null; owner_whatsapp: string | null; products: string[]; status: string; views: number; wa_order: number; calls: number; directions: number; online: number };
const intl = (p?: string | null) => { let d = (p ?? '').replace(/[^\d]/g, '').replace(/^00/, ''); if (/^0[5-7]\d{8}$/.test(d)) d = `212${d.slice(1)}`; return /^\d{9,15}$/.test(d) ? d : ''; };

/** The restaurants whose website brings guests (30 days), warmest first, with the monthly WhatsApp summary to send them. */
function SiteLeads() {
  const a = useAdminCtx();
  const [rows, setRows] = useState<Lead[] | null>(null);
  useEffect(() => { rpc<Lead[]>('admin_site_leads', { p_days: 30 }).then(setRows).catch(() => setRows([])); }, []);
  if (!rows?.length) return null;
  const summary = (l: Lead) => {
    const siteOnly = l.products.length === 1 && l.products[0] === 'site';
    return [t('Bonjour {name}, voici le bilan de votre site sur les 30 derniers jours :', { name: l.name }), '',
      t('{n} visites', { n: l.views }), t('{n} appels', { n: l.calls }), t('{n} demandes d’itinéraire', { n: l.directions }),
      ...(l.wa_order ? [t('{n} commandes WhatsApp', { n: l.wa_order })] : []), ...(l.online ? [t('{n} commandes et réservations en ligne', { n: l.online })] : []), '',
      ...(siteOnly && l.wa_order >= 5 ? [t('Vos clients commandent déjà depuis votre site. Avec Amplify POS, ces commandes arriveraient directement en caisse et en cuisine. 14 jours gratuits : on en parle ?'), ''] : []),
      t('L’équipe Amplify')].join('\n');
  };
  return (
    <div className="mt-10">
      <h2 className="mb-1 font-display text-2xl font-semibold">{t('Sites : les plus actifs (30 jours)')}</h2>
      <p className="mb-4 text-sm text-muted">{t('Les sites avec des commandes WhatsApp sont les meilleurs clients pour Amplify POS. Envoyez le bilan du mois sur WhatsApp, c’est aussi le bon moment pour en parler.')}</p>
      <div className="card overflow-x-auto rounded-3xl">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-muted"><tr><th className="px-4 py-2 text-start">{t('Restaurant')}</th><th className="text-end">{t('Visites')}</th><th className="text-end">{t('WhatsApp')}</th><th className="text-end">{t('Appels')}</th><th className="text-end">{t('Itinéraires')}</th><th className="text-end">{t('En ligne')}</th><th className="px-4 text-end">{t('Bilan')}</th></tr></thead>
          <tbody>{rows.map(l => {
            const to = intl(l.owner_whatsapp || l.phone), siteOnly = l.products.length === 1 && l.products[0] === 'site';
            return (
              <tr key={l.id} className="border-t border-line/10">
                <td className="px-4 py-2.5"><p className="font-semibold">{l.name}{siteOnly && <span className="ms-2 rounded-full bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">Site</span>}</p><p className="text-xs text-muted">{l.city ?? l.slug}</p></td>
                <td className="text-end tabular">{l.views}</td>
                <td className={`text-end tabular ${siteOnly && l.wa_order >= 5 ? 'font-bold text-ok' : ''}`}>{l.wa_order}</td>
                <td className="text-end tabular">{l.calls}</td><td className="text-end tabular">{l.directions}</td><td className="text-end tabular">{l.online}</td>
                <td className="px-4 py-2 text-end">{to
                  ? <a href={`https://wa.me/${to}?text=${encodeURIComponent(summary(l))}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-[#063B1E]"><MessageCircle className="h-4 w-4" /> {t('Envoyer')}</a>
                  : <button type="button" className="text-xs text-muted underline" onClick={async () => { try { await navigator.clipboard.writeText(summary(l)); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } }}>{t('Copier (pas de numéro)')}</button>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}
