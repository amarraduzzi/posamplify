import { useEffect, useState } from 'react';
import { Check, Copy, MessageCircle, Pause, Play, Plus, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, rpc } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, inputCls } from '../components/ui';
import { t } from '../lib/i18n';
import { billing, fmtDay, intlPhone, reminderText, waTo } from '../lib/billing';
import { BillingModal } from '../components/BillingModal';
import { mad } from '../lib/api';

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
  const [resetting, setResetting] = useState<Restaurant | null>(null);
  const [billingOf, setBillingOf] = useState<Restaurant | null>(null);
  const load = async () => { try { setList(check(await supabase.from('restaurants').select('*').order('created_at')) as Restaurant[]); } catch (e) { a.fail(e); } };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const status = async (r: Restaurant, s: string, days?: number) => {
    try {
      await rpc('admin_set_status', { p_restaurant_id: r.id, p_status: s, p_trial_ends_at: days ? new Date(Date.now() + days * 86400000).toISOString() : null });
      a.toast(t('{name} : {status}', { name: r.name, status: t(STATUS[s]) })); await load(); await a.reload();
    } catch (e) { a.fail(e); }
  };
  // changes show at once; the list is reloaded only if the server says no
  const patch = (id: string, p: Partial<Restaurant>) => setList(l => l.map(x => (x.id === id ? { ...x, ...p } : x)));
  const setProducts = async (r: Restaurant, products: string[], plan?: 'essentiel' | 'restaurant') => {
    if (!products.length) { a.toast(t('Gardez au moins un produit.'), 'error'); return; }
    patch(r.id, { products: products as Restaurant['products'], ...(plan ? { pos_plan: plan } : {}) });
    try {
      const res = await rpc<{ products: string[]; pos_plan: string; devices: number }>('admin_set_products', { p_restaurant_id: r.id, p_products: products, p_pos_plan: plan ?? null });
      patch(r.id, { products: res.products as Restaurant['products'], pos_plan: res.pos_plan as Restaurant['pos_plan'] });
      if (res.pos_plan === 'essentiel' && res.devices > 1 && res.products.includes('pos')) a.toast(t('{name} : Essentiel, mais {n} caisses déjà reliées. Retirez-en pour n’en garder qu’une.', { name: r.name, n: res.devices }), 'error');
      void a.reload();
    } catch (e) { a.fail(e); await load(); }
  };
  const setSitePlan = async (r: Restaurant, plan: 'basic' | 'premium') => {
    patch(r.id, { site_plan: plan });
    try { await rpc('admin_set_site_plan', { p_restaurant_id: r.id, p_plan: plan }); void a.reload(); } catch (e) { a.fail(e); await load(); }
  };
  // a service included in another one (Site with POS or Profit, Commandes with POS) is ticked and locked
  // Maître: the fine dining package, an option of the till
  const SERVICES = [['pos', 'POS'], ['profit', 'Profit'], ['site', 'Site'], ['orders', 'Commandes'], ['maitre', 'Maître'], ['agenda', 'Agenda']] as const;
  const included = (r: Restaurant, k: string) => {
    const pr = r.products ?? [];
    return (k === 'site' && (pr.includes('pos') || pr.includes('profit'))) || (k === 'orders' && pr.includes('pos'));
  };
  const toggle = (r: Restaurant, k: string) => {
    const pr = (r.products ?? []) as string[];
    void setProducts(r, pr.includes(k) ? pr.filter(x => x !== k) : [...pr, k]);
  };
  const sel = 'h-8 w-full rounded-lg border border-line/15 bg-surface ps-2 pe-1 text-xs font-semibold';
  const iconBtn = 'grid h-8 w-7 shrink-0 place-items-center rounded-lg transition hover:bg-surface-2';
  return (
    <div>
      <div className="mb-6 flex items-center justify-between"><h1 className="font-display text-3xl font-semibold">{t('Plateforme')}</h1><Btn tone="brand" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> {t('Nouveau restaurant')}</Btn></div>
      <ToCollect list={list} onOpen={setBillingOf} />
      <div className="card overflow-x-auto rounded-3xl">
        <table className="w-full min-w-[1220px] table-fixed text-sm">
          <colgroup><col /><col className="w-[128px]" /><col className="w-[490px]" /><col className="w-[124px]" /><col className="w-[110px]" /><col className="w-[200px]" /></colgroup>
          <thead className="bg-surface-2 text-xs font-semibold text-muted">
            <tr><th className="px-4 py-2.5 text-start">{t('Restaurant')}</th><th className="px-2 text-start">{t('Statut')}</th><th className="px-2 text-start">{t('Services')}</th><th className="pe-2 ps-3 text-start">{t('Caisse')}</th><th className="px-2 text-start">{t('Site web')}</th><th className="pe-3 text-end">{t('Actions')}</th></tr>
          </thead>
          <tbody>
            {list.map(r => {
              const pr = (r.products ?? []) as string[];
              return (
                <tr key={r.id} className="border-t border-line/10 align-middle">
                  <td className="px-4 py-3"><p className="truncate font-semibold" title={r.name}>{r.name}</p><p className="truncate text-xs text-muted">{r.slug}{r.is_demo ? ` · ${t('démo')}` : ''}</p></td>
                  <td className="px-2">
                    {(() => {
                      const bl = billing(r);
                      const [label, tone] = bl.state === 'paused' ? [t('Suspendu'), 'bg-danger/10 text-danger'] : bl.state === 'cancelled' ? [t('Résilié'), 'bg-danger/10 text-danger']
                        : bl.state === 'setup' ? [t('En préparation'), 'bg-surface-2 text-muted'] : bl.state === 'trial' ? [`${t('Essai')} ${bl.due ? fmtDay(bl.due) : ''}`, 'bg-warn/15 text-warn']
                        : bl.state === 'late' ? [t('Retard {n} j', { n: -(bl.left ?? 0) }), 'bg-danger/15 text-danger'] : bl.state === 'soon' ? [`${t('À payer')} ${fmtDay(bl.due!)}`, 'bg-warn/15 text-warn']
                        : [`${t('Payé')} → ${fmtDay(bl.due!)}`, 'bg-ok/15 text-ok'];
                      return <button type="button" onClick={() => setBillingOf(r)} title={t('Paiements')} className={`inline-flex max-w-full items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold transition hover:ring-2 hover:ring-line/20 ${tone}`}>{label}</button>;
                    })()}
                  </td>
                  <td className="px-2">
                    <div className="flex gap-1">
                      {SERVICES.map(([k, label]) => {
                        const inc = included(r, k), on = inc || pr.includes(k);
                        const needsPos = k === 'maitre' && !pr.includes('pos');
                        return (
                          <button key={k} type="button" role="checkbox" aria-checked={on} disabled={inc || needsPos} onClick={() => toggle(r, k)}
                            title={inc ? (k === 'orders' ? t('Inclus avec POS') : t('Inclus avec POS et Profit')) : needsPos ? t('Option de la caisse : activez d’abord POS') : k === 'maitre' ? t('Amplify Maître : fiche client, briefing, acomptes, rythme de la soirée') : undefined}
                            className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 text-xs font-bold transition ${inc ? 'cursor-default border-transparent bg-night/10 text-ink' : on ? 'border-night bg-night text-white' : 'border-line/20 text-muted hover:border-line/40 hover:text-ink'}`}>
                            <span className={`grid h-4 w-4 place-items-center rounded ${on ? (inc ? 'bg-night/25 text-ink' : 'bg-white/20') : 'border border-line/30'}`}>{on && <Check className="h-3 w-3" strokeWidth={3} />}</span>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="pe-2 ps-3">
                    {pr.includes('pos') ? (
                      <select aria-label={t('Formule POS')} className={sel} value={r.pos_plan ?? 'restaurant'} onChange={e => setProducts(r, pr, e.target.value as 'essentiel' | 'restaurant')}>
                        <option value="essentiel">{t('Essentiel')}</option><option value="restaurant">{t('Restaurant')}</option>
                      </select>
                    ) : <span className="px-2 text-muted">—</span>}
                  </td>
                  <td className="px-2">
                    <select aria-label={t('Formule du site')} className={`${sel} ${r.site_plan === 'premium' ? 'border-brand/40 text-brand' : ''}`} value={r.site_plan ?? 'basic'} onChange={e => setSitePlan(r, e.target.value as 'basic' | 'premium')}>
                      <option value="basic">{t('Classique')}</option><option value="premium">{t('Premium')}</option>
                    </select>
                  </td>
                  <td className="pe-3 ps-2">
                    {/* fixed slots, so the icons line up from one row to the next */}
                    <div className="grid grid-cols-[40px_repeat(5,28px)] items-center justify-end gap-0.5">
                      {r.status === 'trial' ? <button type="button" className={`${iconBtn} w-10 text-xs font-bold`} title={t('Prolonger l’essai de 14 jours')} onClick={() => status(r, 'trial', 14)}>{t('+14 j')}</button> : <span />}
                      {r.status !== 'active' ? <button type="button" className={`${iconBtn} text-ok`} aria-label={t('Activer')} title={t('Activer')} onClick={() => status(r, 'active')}><Play className="h-4 w-4" /></button> : <span />}
                      <button type="button" className={iconBtn} aria-label={t('Accès à {name}', { name: r.name })} title={t('Ajouter un accès')} onClick={() => setMember(r)}><UserPlus className="h-4 w-4" /></button>
                      <button type="button" className={iconBtn} aria-label={t('Remettre à zéro {name}', { name: r.name })} title={t('Remettre à zéro (ventes et stock)')} onClick={() => setResetting(r)}><RotateCcw className="h-4 w-4" /></button>
                      {r.status !== 'paused' ? <button type="button" className={`${iconBtn} text-danger hover:bg-danger/10`} aria-label={t('Suspendre')} title={t('Suspendre')} onClick={() => status(r, 'paused')}><Pause className="h-4 w-4" /></button> : <span />}
                      {(r.status === 'paused' || r.status === 'cancelled' || r.is_demo) ? <button type="button" className={`${iconBtn} text-danger hover:bg-danger/10`} aria-label={t('Supprimer {name}', { name: r.name })} title={t('Supprimer')} onClick={() => setRemoving(r)}><Trash2 className="h-4 w-4" /></button> : <span />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-muted"><span className="inline-flex h-5 items-center gap-1 rounded-md bg-night/10 px-1.5 text-xs font-bold text-ink"><Check className="h-3 w-3" strokeWidth={3} />{t('gris')}</span>{t('= inclus : le site web est compris avec POS et Profit, Commandes est compris avec POS.')}</p>
      <p className="mt-1 text-sm text-muted">{t("Suspendre : le menu reste visible, mais les commandes et la caisse sont bloquées jusqu'à la réactivation.")} {t('Supprimer définitivement : possible une fois suspendu.')}</p>
      <SiteLeads />
      {creating && <CreateRestaurant onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await load(); await a.reload(); }} />}
      {billingOf && <BillingModal r={billingOf} onClose={() => setBillingOf(null)} onChanged={load} />}
      {member && <AddMember r={member} onClose={() => setMember(null)} />}
      {resetting && <ResetActivity r={resetting} onClose={() => setResetting(null)} onDone={async () => { setResetting(null); await load(); await a.reload(); }} />}
      {removing && <DeleteRestaurant r={removing} onClose={() => setRemoving(null)} onDone={async () => { setRemoving(null); await load(); await a.reload(); }} />}
    </div>
  );
}

/** A readable temporary password: 3 groups of 4, no look-alike characters (0/o, 1/l). */
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789', n = new Uint32Array(12);
  crypto.getRandomValues(n);
  const c = [...n].map(x => abc[x % abc.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

/** The login is created by the server function "admin-account" (platform admins only). An e-mail that
 *  already has an account keeps its password: it is simply linked. */
async function createLogin(email: string, password: string, mustChange: boolean): Promise<{ existed: boolean }> {
  const { data, error } = await supabase.functions.invoke('admin-account', { body: { email, password, must_change: mustChange } });
  if (error) {
    let code = '';
    try { code = (await (error as { context?: Response }).context?.json())?.error ?? ''; } catch { /* not json */ }
    if (code === 'invalid_email') throw new Error(t('Adresse e-mail invalide.'));
    if (code === 'weak_password') throw new Error(t('Mot de passe trop court (8 caractères minimum).'));
    if (code === 'not_allowed') throw new Error(t('Réservé aux administrateurs de la plateforme.'));
    if (code) throw new Error(t('Création du compte impossible : {m}', { m: code }));
    throw new Error(t('La fonction « admin-account » ne répond pas. Est-elle installée dans Supabase (Edge Functions) ?'));
  }
  return { existed: !!(data as { existed?: boolean })?.existed };
}

/** E-mail, password (generated, can be changed) and "choose her own password at first login". */
function LoginFields({ email, setEmail, pw, setPw, must, setMust, optional }: {
  email: string; setEmail: (v: string) => void; pw: string; setPw: (v: string) => void; must: boolean; setMust: (v: boolean) => void; optional?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
      <p className="text-sm font-bold">{t('Connexion')}</p>
      <Field label={optional ? t('E-mail du propriétaire (facultatif)') : t('E-mail du compte')}><input dir="ltr" className={inputCls} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nom@exemple.ma" /></Field>
      {email.includes('@') && <>
        <Field label={t('Mot de passe')} hint={t('Si ce compte existe déjà, son mot de passe ne change pas.')}>
          <div className="flex gap-2">
            <input dir="ltr" className={`${inputCls} font-mono`} value={pw} onChange={e => setPw(e.target.value)} />
            <Btn type="button" className="shrink-0 px-3" title={t('Nouveau mot de passe')} aria-label={t('Nouveau mot de passe')} onClick={() => setPw(tempPassword())}><RotateCcw className="h-4 w-4" /></Btn>
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={must} onChange={e => setMust(e.target.checked)} /> {t('Choisir son propre mot de passe à la première connexion')}</label>
      </>}
    </div>
  );
}

/** What to send to the customer: the link, the e-mail and the password, to copy or to send on WhatsApp. */
function LoginCard({ name, email, pw, existed, onClose }: { name: string; email: string; pw: string; existed: boolean; onClose: () => void }) {
  const a = useAdminCtx();
  const url = location.origin;
  const text = existed
    ? t('Bonjour, vous avez maintenant accès à {n} sur Amplify : {u}. Connectez-vous avec votre e-mail {e} et votre mot de passe habituel.', { n: name, u: url, e: email })
    : [t('Bonjour, voici vos accès Amplify pour {n} :', { n: name }), `${t('Lien')} : ${url}`, `${t('E-mail')} : ${email}`, `${t('Mot de passe')} : ${pw}`,
       t('À la première connexion, vous choisirez votre propre mot de passe.')].join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(text); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  return (
    <Modal title={t('Accès prêts')} onClose={onClose} footer={<div className="flex flex-wrap justify-end gap-2">
      <Btn onClick={copy}><Copy className="h-4 w-4" /> {t('Copier')}</Btn>
      <Btn onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')}><MessageCircle className="h-4 w-4" /> WhatsApp</Btn>
      <Btn tone="brand" onClick={onClose}>{t('Terminé')}</Btn></div>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{existed ? t('Ce compte existait déjà : il a été relié, son mot de passe n’a pas changé.') : t('Le compte est créé et confirmé. Envoyez ces accès au client.')}</p>
        <dl className="space-y-1.5 rounded-2xl bg-surface-2 p-4 text-sm">
          <div className="flex gap-3"><dt className="w-28 text-muted">{t('Lien')}</dt><dd dir="ltr" className="font-semibold">{url}</dd></div>
          <div className="flex gap-3"><dt className="w-28 text-muted">{t('E-mail')}</dt><dd dir="ltr" className="font-semibold">{email}</dd></div>
          {!existed && <div className="flex gap-3"><dt className="w-28 text-muted">{t('Mot de passe')}</dt><dd dir="ltr" className="font-mono font-semibold">{pw}</dd></div>}
        </dl>
        {!existed && <p className="text-xs text-muted">{t('Ce mot de passe n’est montré qu’une fois. Envoyez-le maintenant.')}</p>}
      </div>
    </Modal>
  );
}

function CreateRestaurant({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState(tempPassword);
  const [must, setMust] = useState(true);
  const [demo, setDemo] = useState(false);
  const [kind, setKind] = useState<'all' | 'pos' | 'profit' | 'site' | 'orders'>('all');
  const [city, setCity] = useState('');
  const [theme, setTheme] = useState<'riad' | 'nuit' | 'moderne' | 'atelier'>('riad');
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<{ existed: boolean } | null>(null);
  const auto = (n: string) => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const mail = email.trim().toLowerCase();
  const create = async () => {
    if (mail && pw.length < 8) { a.toast(t('Mot de passe trop court (8 caractères minimum).'), 'error'); return; }
    setBusy(true);
    try {
      // the login first: if it fails, no restaurant without its owner
      const login = mail ? await createLogin(mail, pw, must) : null;
      await rpc('admin_create_restaurant', { p_slug: slug, p_name: name.trim(), p_owner_email: mail || null, p_is_demo: demo,
        p_products: kind === 'all' ? ['pos', 'profit'] : [kind], p_city: city.trim() || null, p_theme: kind === 'site' ? theme : null });
      a.toast(t('Restaurant créé (essai de 14 jours)'));
      if (login) setCard(login); else onDone();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  if (card) return <LoginCard name={name.trim()} email={mail} pw={pw} existed={card.existed} onClose={onDone} />;
  return (
    <Modal title={t('Nouveau restaurant')} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !name.trim() || slug.length < 3} onClick={create}>{t('Créer')}</Btn></div>}>
      <div className="space-y-4">
        <Field group label={t('Produits')}>
          <div className="flex flex-wrap gap-2">{([['all', 'POS + Profit'], ['pos', 'POS'], ['profit', 'Profit'], ['site', 'Site'], ['orders', 'Commandes']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${kind === k ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{l}</button>))}</div>
        </Field>
        <Field label={t('Nom')}><input autoFocus className={inputCls} value={name} onChange={e => { setName(e.target.value); setSlug(auto(e.target.value)); }} /></Field>
        <Field label={t('Ville')}><input className={inputCls} value={city} onChange={e => setCity(e.target.value)} placeholder="Rabat" /></Field>
        {kind === 'site' && <Field label={t('Style du site')}><select className={inputCls} value={theme} onChange={e => setTheme(e.target.value as typeof theme)}><option value="riad">Riad</option><option value="nuit">Nuit</option><option value="moderne">Moderne</option><option value="atelier">Atelier</option></select></Field>}
        {kind === 'site' && <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{t('Démo de site : choisissez ensuite ce restaurant à gauche, importez la carte (Menu) et ajoutez la photo (Restaurant). Le site n’est pas sur Google tant qu’il n’est pas mis en ligne.')}</p>}
        <Field label={t('Adresse du menu')} hint={t('Le menu sera sur …/{slug}', { slug: slug || 'nom-du-restaurant' })}><input dir="ltr" className={inputCls} value={slug} onChange={e => setSlug(auto(e.target.value))} /></Field>
        <LoginFields email={email} setEmail={setEmail} pw={pw} setPw={setPw} must={must} setMust={setMust} optional />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)} /> {t('Restaurant de démonstration')}</label>
      </div>
    </Modal>
  );
}

function AddMember({ r, onClose }: { r: Restaurant; onClose: () => void }) {
  const a = useAdminCtx();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState(tempPassword);
  const [role, setRole] = useState<'owner' | 'manager' | 'device'>('owner');
  const [must, setMust] = useState(true);
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<{ existed: boolean } | null>(null);
  const mail = email.trim().toLowerCase();
  const add = async () => {
    if (pw.length < 8) { a.toast(t('Mot de passe trop court (8 caractères minimum).'), 'error'); return; }
    setBusy(true);
    try {
      // a till (poste) keeps the password it was given: nobody "logs in for the first time" there
      const login = await createLogin(mail, pw, role !== 'device' && must);
      await rpc('admin_add_member', { p_restaurant_id: r.id, p_email: mail, p_role: role });
      a.toast(t('Accès ajouté')); setCard(login);
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  if (card) return <LoginCard name={r.name} email={mail} pw={pw} existed={card.existed} onClose={onClose} />;
  return (
    <Modal title={t('Accès à {name}', { name: r.name })} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !mail.includes('@')} onClick={add}>{t('Ajouter')}</Btn></div>}>
      <div className="space-y-4">
        <Field label={t('Rôle')}>
          <select className={inputCls} value={role} onChange={e => setRole(e.target.value as typeof role)}>
            <option value="owner">{t('Propriétaire (tout)')}</option><option value="manager">{t('Manager (menu, personnel, tables)')}</option><option value="device">{t('Caisse (poste)')}</option>
          </select>
        </Field>
        <LoginFields email={email} setEmail={setEmail} pw={pw} setPw={setPw} must={role !== 'device' && must} setMust={setMust} />
      </div>
    </Modal>
  );
}

/** Start fresh before going live: sales, tickets, stock and test bookings go; the menu, recipes, ingredients,
 *  tables, staff and customers stay. Only before real service: real tickets must be kept 10 years. */
function ResetActivity({ r, onClose, onDone }: { r: Restaurant; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = typed.trim().toLowerCase() === r.slug;
  const reset = async () => {
    setBusy(true);
    try {
      const res = await rpc<{ orders: number; tickets: number }>('admin_reset_activity', { p_restaurant_id: r.id, p_confirm_slug: typed });
      a.toast(t('{name} remis à zéro : {n} commande(s) effacée(s)', { name: r.name, n: res.orders })); onDone();
    } catch (e) { a.fail(e); setBusy(false); }
  };
  return (
    <Modal title={t('Remettre {name} à zéro ?', { name: r.name })} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Btn onClick={onClose}>{t('Annuler')}</Btn><Btn tone="danger" disabled={!ok || busy} onClick={reset}><RotateCcw className="h-4 w-4" /> {t('Remettre à zéro')}</Btn></div>}>
      <div className="space-y-4">
        <p>{t('Effacé : commandes, tickets, paiements, clôtures, caisse, stock, achats, inventaires, réservations et pointages. La numérotation des tickets repart à 1.')}</p>
        <p>{t('Gardé : menu, options, recettes, ingrédients et prix, fournisseurs, tables, équipe, clients (points remis à 0), site et ventes importées.')}</p>
        <p className="rounded-xl bg-danger/10 p-3 text-sm font-semibold text-danger">{t('Seulement avant le vrai démarrage : les vrais tickets doivent être gardés 10 ans. Ensuite, faites un inventaire d’ouverture (Stock) pour démarrer le stock.')}</p>
        <Field label={t('Tapez « {slug} » pour confirmer', { slug: r.slug })}><input className={inputCls} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" /></Field>
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

/** Who has to pay: late first, then the next 7 days. A reminder on WhatsApp, or straight to the payment. */
function ToCollect({ list, onOpen }: { list: Restaurant[]; onOpen: (r: Restaurant) => void }) {
  const rows = list.map(r => ({ r, b: billing(r) })).filter(x => x.b.state === 'late' || x.b.state === 'soon' || (x.b.state === 'trial' && (x.b.left ?? 99) <= 7))
    .sort((x, y) => (x.b.left ?? 0) - (y.b.left ?? 0));
  if (!rows.length) return null;
  const total = rows.filter(x => x.b.state !== 'trial').reduce((s, x) => s + (x.b.amount ?? 0), 0);
  return (
    <div className="card mb-5 rounded-3xl p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">{t('À encaisser')}</h2>
        {total > 0 && <p className="text-sm text-muted">{t('Total attendu : {a}', { a: mad(total) })}</p>}
      </div>
      <ul className="divide-y divide-line/10">
        {rows.map(({ r, b }) => {
          const phone = intlPhone(r.owner_whatsapp || r.phone);
          const when = b.state === 'late' ? t('en retard de {n} j', { n: -(b.left ?? 0) }) : b.state === 'trial' ? t('fin d’essai le {d}', { d: fmtDay(b.due!, true) }) : b.left === 0 ? t('aujourd’hui') : t('le {d}', { d: fmtDay(b.due!, true) });
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
              <span className={`w-40 whitespace-nowrap font-semibold ${b.state === 'late' ? 'text-danger' : 'text-warn'}`}>{when}</span>
              <span className="w-24 whitespace-nowrap text-end font-semibold tabular">{b.amount ? mad(b.amount) : '—'}</span>
              <span className="flex gap-1">
                {phone && b.due && <a href={waTo(phone, reminderText(r, b.due, b.amount))} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold hover:bg-surface-2"><MessageCircle className="h-4 w-4" />{t('Rappel')}</a>}
                <button type="button" onClick={() => onOpen(r)} className="inline-flex h-8 items-center rounded-lg bg-night px-3 text-xs font-bold text-white">{t('Paiement reçu')}</button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
