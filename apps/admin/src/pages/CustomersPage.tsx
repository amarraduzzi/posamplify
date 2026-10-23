// Customer file and loyalty points. OFF until the owner switches it on: only then
// are phone numbers kept (law 09-08: keep only what is needed, with consent for messages).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loyaltyRewards, type LoyaltyReward } from '@resto/shared';
import { AlertTriangle, Cake, Copy, Gift, Trash2, MessageCircle, NotebookPen, Pencil, Plus, Printer, QrCode, Search, ShieldCheck, Upload, UserPlus, Users, X } from 'lucide-react';
import { supabase, MENU_URL } from '../lib/supabase';
import { check, fromCents, mad, rpc, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { intlPhone } from '../lib/billing';
import { COMEBACK_BONUS_MAX, COMEBACK_DAYS, birthdayCfg, birthdayFresh, birthdayGivesBonus, birthdayMessage, comebackCfg, comebackGivesBonus, comebackMessage, comebackPending, type BirthdayCfg, type ComebackCfg } from '../lib/comeback';
import { useAdminCtx } from '../store';
import type { I18n, ProfitData, Restaurant } from '../lib/types';
import { Btn, Field, Modal, Toggle, inputCls } from '../components/ui';
import { ImportData } from '../components/ImportData';
import { SignupQrModal, type SignupEvent } from '../components/SignupQr';

interface Customer {
  id: string; phone: string; name: string | null; birthday: string | null; note: string | null; marketing_ok: boolean;
  /** the guest profile, also seen and completed at the till */
  allergies: string | null; tags: string[];
  points: number; visits: number; spent_cents: number; first_visit_at: string | null; last_visit_at: string | null; created_at: string;
  credit_allowed: boolean; credit_limit_cents: number | null; balance_cents: number; source: 'qr' | 'event' | null; card_key: string;
  /** when the owner last sent the message to bring him back */
  comeback_at: string | null;
  /** when the owner last sent the birthday message */
  birthday_msg_at: string | null;
}
type Loyalty = NonNullable<Restaurant['loyalty']>;
type Filter = 'all' | 'birthday' | 'lost';
type Tab = 'clients' | 'savings' | 'tabs';

export function CustomersPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const loyalty: Loyalty = r.loyalty ?? {};
  const [list, setList] = useState<Customer[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [edit, setEdit] = useState<Customer | null>(null);
  const [settings, setSettings] = useState<'rewards' | 'messages' | null>(null);
  const [tab, setTab] = useState<Tab>('clients');
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [qr, setQr] = useState(false);
  // the guests of one tasting
  const [event, setEvent] = useState<{ ev: SignupEvent; ids: Set<string> } | null>(null);

  const load = useCallback(async () => {
    if (!loyalty.customers) { setList([]); return; }
    try { setList(check(await supabase.from('customers').select('*').eq('restaurant_id', r.id).order('last_visit_at', { ascending: false, nullsFirst: false }).limit(2000)) as Customer[]); }
    catch (e) { a.fail(e); setList([]); }
  }, [r.id, loyalty.customers, a]);
  useEffect(() => { load(); }, [load]);

  const month = new Date().getMonth() + 1;
  const cb = useMemo(() => comebackCfg(loyalty), [loyalty]);
  const bd = useMemo(() => birthdayCfg(loyalty), [loyalty]);
  const shown = useMemo(() => {
    const f = q.trim().toLowerCase().replace(/\s/g, '');
    return (list ?? []).filter(c =>
      (!event || event.ids.has(c.id)) && (!f || (c.name ?? '').toLowerCase().includes(f) || c.phone.includes(f.replace(/\D/g, '') || '§'))
      && (filter === 'all'
        || (filter === 'birthday' && c.birthday && Number(c.birthday.slice(5, 7)) === month)
        || (filter === 'lost' && c.last_visit_at && Date.now() - Date.parse(c.last_visit_at) > cb.days * 864e5 && c.visits >= 2)));
  }, [list, q, filter, month, event, cb.days]);

  const saveLoyalty = async (l: Loyalty) => {
    try {
      check(await supabase.from('restaurants').update({ loyalty: l }).eq('id', r.id).select('id'));
      await a.reload(); a.toast(t('Enregistré'));
    } catch (e) { a.fail(e); }
  };
  const showEvent = async (ev: SignupEvent) => {
    try {
      const ppl = check(await supabase.from('signup_event_people').select('customer_id').eq('event_id', ev.id)) as { customer_id: string }[];
      setEvent({ ev, ids: new Set(ppl.map(p => p.customer_id)) }); setFilter('all'); setQr(false); load();
    } catch (e) { a.fail(e); }
  };
  const copyNumbers = async () => {
    const nums = shown.filter(c => c.marketing_ok).map(c => c.phone).join('\n');
    try { await navigator.clipboard.writeText(nums); a.toast(t('{n} numéros copiés', { n: shown.filter(c => c.marketing_ok).length })); } catch { a.toast(t('Copie impossible'), 'error'); }
  };

  if (!loyalty.customers) {
    return (
      <div>
        <h1 className="mb-6 font-display text-3xl font-semibold">{t('Clients')}</h1>
        <div className="night rounded-[2rem] p-6 md:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{t('Option')}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{t('Un fichier clients et des points de fidélité')}</h2>
          <ul className="mt-4 space-y-2 text-white/75">
            <li>• {t('Chaque client est reconnu par son numéro : commandes à emporter, livraison, menu QR, ou associé à la caisse.')}</li>
            <li>• {t('Vous voyez qui revient, combien il dépense, sa dernière visite et son anniversaire.')}</li>
            <li>• {t('Points de fidélité : par exemple 1 point par 10 DH, 100 points = 50 DH offerts.')}</li>
            <li>• {t('Les numéros des clients d’accord pour vos offres WhatsApp, prêts à copier.')}</li>
          </ul>
          <p className="mt-4 flex items-start gap-2 rounded-2xl bg-white/5 p-3 text-sm text-white/70"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            {t('Désactivé par défaut. Une fois activé, les numéros sont gardés pour ce restaurant seulement, visibles par le propriétaire et les managers. La caisse ne montre que le client recherché, jamais la liste. Loi 09-08 : informez vos clients (par exemple sur le ticket ou à la caisse).')}</p>
          {a.canEditProfile
            ? <Btn tone="brand" className="mt-5" onClick={() => saveLoyalty({ ...loyalty, customers: true })}><Users className="h-4 w-4" /> {t('Activer le fichier clients')}</Btn>
            : <p className="mt-5 text-sm text-white/60">{t('Seul le propriétaire peut activer cette option.')}</p>}
        </div>
      </div>
    );
  }

  const credit = !!loyalty.credit;
  const value = loyalty.mode === 'value';
  const FILTERS: [Filter, string][] = [['all', t('Tous ({n})', { n: list?.length ?? 0 })], ['birthday', t('Anniversaire ce mois')], ['lost', t('Ne reviennent plus')]];
  const TABS: [Tab, string, typeof Users][] = [['clients', t('Clients'), Users], ['savings', t('Fidélité'), Gift], ['tabs', t('Ardoises'), NotebookPen]];
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <h1 className="font-display text-3xl font-semibold">{t('Clients')}</h1>
          <p className="text-muted">{!loyalty.enabled ? t('Fichier clients actif.')
            : value ? t('Cagnotte : {p} % de chaque addition revient au client.', { p: loyalty.percent ?? 5 })
            : t('Points de fidélité : 1 point par {d} DH, {p} points = {m} offerts.', { d: loyalty.per_dh ?? 10, p: loyalty.reward_points ?? 100, m: mad(loyalty.reward_cents ?? 5000) })}</p>
        </div>
        <div className="flex rounded-2xl bg-surface-2 p-1" role="tablist">
          {TABS.map(([k, l, Icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === k ? 'bg-surface shadow-sm' : 'text-muted hover:text-ink'}`}>
              <Icon className="h-4 w-4" /> {l}</button>
          ))}
        </div>
      </div>
      {qr && <SignupQrModal r={r} onClose={() => { setQr(false); load(); }} onShowEvent={showEvent} />}
      {importing && <ImportData kind="customers" r={r} onClose={() => setImporting(false)} onDone={load} />}
      {adding && <NewCustomer r={r} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}

      {tab === 'savings' && <SavingsPanel r={r} loyalty={loyalty} canEdit={a.canEditProfile} onSave={saveLoyalty} onOpen={setSettings} />}
      {tab === 'tabs' && <TabsPanel r={r} list={list ?? []} credit={credit} canEdit={a.canEditProfile} onToggle={v => saveLoyalty({ ...loyalty, credit: v })} onOpen={setEdit} onChanged={load} />}

      {tab === 'clients' && <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} ps-9`} placeholder={t('Nom ou téléphone')} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {event && <span className="flex items-center gap-1.5 rounded-full bg-brand/15 px-3 py-1.5 text-sm font-bold text-brand">{event.ev.name} · {event.ids.size}<button aria-label={t('Fermer')} onClick={() => setEvent(null)}><X className="h-4 w-4" /></button></span>}
        {FILTERS.map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${filter === k ? 'bg-night text-white' : 'bg-surface-2 text-muted hover:text-ink'}`}>{l}</button>)}
        <span className="ms-auto flex flex-wrap gap-2">
          {event && shown.some(c => c.marketing_ok) && <Btn className="px-3 py-2" onClick={copyNumbers}><Copy className="h-4 w-4" /> {t('Copier les numéros')}</Btn>}
          <Btn tone="ghost" className="px-3 py-2" title={t('QR d’inscription')} onClick={() => setQr(true)}><QrCode className="h-4 w-4" /> <span className="hidden lg:inline">{t('QR d’inscription')}</span></Btn>
          <Btn tone="ghost" className="px-3 py-2" title={t('Importer')} onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> <span className="hidden lg:inline">{t('Importer')}</span></Btn>
          <Btn tone="brand" className="px-3 py-2" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> {t('Nouveau client')}</Btn>
        </span>
      </div>
      {filter === 'lost' && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 p-3 text-sm">
          <MessageCircle className="h-4 w-4 shrink-0 text-brand" />
          <p className="me-auto min-w-0 flex-1">
            {t('Pas venus depuis {d} jours. Le bouton ouvre WhatsApp avec un message prêt.', { d: cb.days })}
            {shown.some(c => !c.marketing_ok) && <span className="block text-muted">{t('{n} sans accord WhatsApp : pas de message possible.', { n: shown.filter(c => !c.marketing_ok).length })}</span>}
          </p>
        </div>
      )}

      <div className="card overflow-x-auto rounded-3xl">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3 text-start">{t('Client')}</th>
              <th className="px-3 py-3 text-end">{t('Visites')}</th>
              <th className="px-3 py-3 text-end">{t('Dépensé')}</th>
              {loyalty.enabled && <th className="px-3 py-3 text-end">{value ? t('Cagnotte') : t('Points')}</th>}
              {credit && <th className="px-3 py-3 text-end">{t('Ardoise')}</th>}
              <th className="px-3 py-3 text-end">{t('Dernière visite')}</th>
              {(filter === 'lost' || filter === 'birthday') && <th className="px-3 py-3 text-end">{t('Message')}</th>}
              <th className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/10">
            {shown.map(c => (
              <tr key={c.id} onClick={() => setEdit(c)} className="cursor-pointer hover:bg-surface-2/60">
                <td className="px-4 py-2.5">
                  <p className="flex items-center gap-1.5 font-semibold">{c.name || t('Sans nom')}
                    {c.birthday && Number(c.birthday.slice(5, 7)) === month && <Cake className="h-4 w-4 text-brand" />}
                    {c.marketing_ok && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[10px] font-bold text-ok">WhatsApp</span>}
                    {(c.tags ?? []).map(x => <span key={x} className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-bold text-muted">{x}</span>)}
                    {c.allergies && <span title={c.allergies} className="inline-flex items-center gap-0.5 rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger"><AlertTriangle className="h-3 w-3" />{t('Allergie')}</span>}
                    {filter === 'birthday' && c.birthday_msg_at && !birthdayFresh(c) && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-bold text-muted">{t('Message envoyé le {d}', { d: new Date(c.birthday_msg_at).toLocaleDateString(dateLocale()) })}</span>}
                    {filter === 'lost' && comebackPending(c) && c.comeback_at && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-bold text-muted">{t('Contacté le {d}', { d: new Date(c.comeback_at).toLocaleDateString(dateLocale()) })}</span>}</p>
                  <p dir="ltr" className="text-xs text-muted rtl:text-end">{c.phone}</p>
                </td>
                <td className="px-3 py-2.5 text-end tabular">{c.visits}</td>
                <td className="px-3 py-2.5 text-end tabular">{mad(c.spent_cents)}</td>
                {loyalty.enabled && <td className="px-3 py-2.5 text-end font-semibold tabular">{value ? mad(c.points * 100) : c.points}</td>}
                {credit && <td className={`px-3 py-2.5 text-end tabular ${Number(c.balance_cents) > 0 ? 'font-bold text-warn' : 'text-muted'}`}>{Number(c.balance_cents) !== 0 ? mad(Number(c.balance_cents)) : '—'}</td>}
                <td className="px-3 py-2.5 text-end text-muted">{c.last_visit_at ? new Date(c.last_visit_at).toLocaleDateString(dateLocale()) : '—'}</td>
                {(filter === 'lost' || filter === 'birthday') && <td className="px-3 py-2.5 text-end" onClick={e => e.stopPropagation()}>
                  {c.marketing_ok ? <ComebackButton kind={filter} c={c} r={r} cb={cb} bd={bd} pointsOn={!!loyalty.enabled} onSent={load} /> : <span className="text-xs text-muted">{t('Sans accord WhatsApp')}</span>}
                </td>}
                <td className="px-3 py-2.5 text-end"><Pencil className="inline h-4 w-4 text-muted" /></td>
              </tr>
            ))}
            {list !== null && !shown.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">{t('Aucun client pour le moment. Ils arrivent avec les commandes qui ont un numéro de téléphone.')}</td></tr>}
          </tbody>
        </table>
      </div>
      </>}

      {edit && <CustomerEditor c={edit} points={!!loyalty.enabled} value={value} credit={credit} r={r} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {settings && <LoyaltySettings part={settings} rid={r.id} restaurantName={r.name} loyalty={loyalty} onClose={() => setSettings(null)} onSave={l => { setSettings(null); saveLoyalty(l); }} />}
    </div>
  );
}

/** One tap: the WhatsApp message opens, and the database notes the day (and adds the bonus points of an offer, once). */
function ComebackButton({ kind, c, r, cb, bd, pointsOn, onSent }: { kind: 'lost' | 'birthday'; c: Customer; r: Restaurant; cb: ComebackCfg; bd: BirthdayCfg; pointsOn: boolean; onSent: () => void }) {
  const a = useAdminCtx();
  const birthday = kind === 'birthday';
  const bonus = birthday ? (birthdayGivesBonus(bd, pointsOn, c) ? bd.bonus : 0) : (comebackGivesBonus(cb, pointsOn, c) ? cb.bonus : 0);
  const who = { first: c.name ? c.name.split(' ')[0] : '', restaurant: r.name, bonus };
  const text = birthday ? birthdayMessage(bd, who) : comebackMessage(cb, who);
  const again = birthday ? !birthdayFresh(c) : comebackPending(c);
  const sent = async () => {
    try {
      const res = await rpc<{ bonus: number }>(birthday ? 'customer_birthday_sent' : 'customer_comeback_sent', { p_customer_id: c.id });
      a.toast(res.bonus ? t('Message ouvert · {b} points ajoutés à sa carte', { b: res.bonus }) : t('Message ouvert, la date est notée'));
      onSent();
    } catch (e) { a.fail(e); }
  };
  return (
    <a href={`https://wa.me/${intlPhone(c.phone)}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener" onClick={sent}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold ${again ? 'bg-surface-2 text-ink hover:bg-surface-3' : 'bg-brand text-brand-ink'}`}>
      <MessageCircle className="h-3.5 w-3.5" /> {again ? t('Relancer') : t('Envoyer')}{bonus > 0 && <span className="opacity-80">+{bonus}</span>}
    </a>
  );
}

function CustomerEditor({ c, points, value, credit, r, onClose, onSaved }: { c: Customer; points: boolean; value: boolean; credit: boolean; r: Restaurant; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [f, setF] = useState({ name: c.name ?? '', birthday: c.birthday ?? '', note: c.note ?? '', allergies: c.allergies ?? '', tags: (c.tags ?? []).join(', '), marketing_ok: c.marketing_ok, points: String(c.points),
    credit_allowed: c.credit_allowed, limit: fromCents(c.credit_limit_cents ?? 50000) });
  const [statement, setStatement] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const cardUrl = `${MENU_URL}/${r.slug}?carte=${c.card_key}`;
  const copyCard = async () => { try { await navigator.clipboard.writeText(cardUrl); a.toast(t('Lien copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  const save = async () => {
    try {
      check(await supabase.from('customers').update({ name: f.name.trim() || null, birthday: f.birthday || null, note: f.note.trim() || null, marketing_ok: f.marketing_ok,
        allergies: f.allergies.trim() || null, tags: [...new Set(f.tags.split(',').map(x => x.trim().slice(0, 20)).filter(Boolean))].slice(0, 8),
        points: Math.max(0, Math.round(Number(f.points) || 0)),
        ...(credit ? { credit_allowed: f.credit_allowed, credit_limit_cents: f.credit_allowed ? Math.max(0, toCents(f.limit)) : c.credit_limit_cents } : {}) }).eq('id', c.id).select('id'));
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
  };
  const remove = async () => {
    try { check(await supabase.from('customers').delete().eq('id', c.id).select('id')); a.toast(t('Client supprimé')); onSaved(); } catch (e) { a.fail(e); }
  };
  return (
    <Modal title={c.name || c.phone} onClose={onClose}
      footer={<div className="flex justify-between"><Btn tone="danger" onClick={remove}>{t('Supprimer (droit à l’oubli)')}</Btn><Btn tone="brand" onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <p className="text-sm text-muted"><span dir="ltr">{c.phone}</span> · {t('{v} visite(s)', { v: c.visits })} · {mad(c.spent_cents)}{c.first_visit_at ? ` · ${t('client depuis le {d}', { d: new Date(c.first_visit_at).toLocaleDateString(dateLocale()) })}` : ''}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Prénom')}><input className={inputCls} maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('Anniversaire')}><input type="date" className={inputCls} value={f.birthday} onChange={e => setF({ ...f, birthday: e.target.value })} /></Field>
        </div>
        {points && <Field label={value ? t('Cagnotte (DH)') : t('Points')} hint={t('Correction manuelle, enregistrée dans le journal.')}><input className={`${inputCls} w-32`} inputMode="numeric" value={f.points} onChange={e => setF({ ...f, points: e.target.value.replace(/\D/g, '') })} /></Field>}
        {points && c.card_key && (
          <div className="rounded-2xl bg-surface-2 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Gift className="h-5 w-5 text-brand" />
              <p className="me-auto font-semibold">{t('Carte fidélité du client')}</p>
              <Btn onClick={copyCard}><Copy className="h-4 w-4" /> {t('Copier le lien')}</Btn>
              <a href={`https://wa.me/${intlPhone(c.phone)}?text=${encodeURIComponent(t('Bonjour{n}, voici votre carte fidélité {r} : vos points et votre récompense. {u}', { n: c.name ? ` ${c.name.split(' ')[0]}` : '', r: r.name, u: cardUrl }))}`} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-brand-ink"><MessageCircle className="h-4 w-4" /> {t('Envoyer sur WhatsApp')}</a>
            </div>
            <p className="mt-2 text-xs text-muted">{t('Un lien privé : le client y voit ses points et sa récompense, sans application. Envoyez-le seulement à lui.')}</p>
          </div>
        )}
        <Field label={t('Allergies et intolérances')} hint={t('Imprimé sur chaque bon cuisine de ce client.')}><input className={inputCls} maxLength={200} value={f.allergies} onChange={e => setF({ ...f, allergies: e.target.value })} placeholder={t('Ex. : noix, gluten, fruits de mer')} /></Field>
        <Field label={t('Préférences')}><input className={inputCls} maxLength={300} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={t('Ex. : table près de la fenêtre, eau pétillante')} /></Field>
        <Field label={t('Étiquettes')} hint={t('Séparées par des virgules. Ex. : VIP, Habitué, Végétarien')}><input className={inputCls} value={f.tags} onChange={e => setF({ ...f, tags: e.target.value })} /></Field>
        <Toggle checked={f.marketing_ok} onChange={v => setF({ ...f, marketing_ok: v })} label={t('D’accord pour recevoir les offres sur WhatsApp')} />
        {credit && (
          <div className="rounded-2xl bg-surface-2 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <NotebookPen className="h-5 w-5 text-brand" />
              <p className="me-auto font-semibold">{t('Ardoise')}</p>
              <p className={`font-display text-2xl font-semibold tabular ${Number(c.balance_cents) > 0 ? 'text-warn' : ''}`}>{mad(Number(c.balance_cents))}</p>
            </div>
            <div className="mt-3 grid items-end gap-3 sm:grid-cols-2">
              <Toggle checked={f.credit_allowed} onChange={v => setF({ ...f, credit_allowed: v })} label={t('Peut payer plus tard')} />
              {f.credit_allowed && <Field label={t('Plafond (DH)')}><input className={inputCls} inputMode="decimal" value={f.limit} onChange={e => setF({ ...f, limit: e.target.value })} /></Field>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn onClick={() => setStatement(true)}><Printer className="h-4 w-4" /> {t('Relevé du mois')}</Btn>
              <Btn tone="ghost" onClick={() => setAdjust(true)}>{t('Corriger le solde')}</Btn>
            </div>
          </div>
        )}
      </div>
      {statement && <Statement c={c} r={r} onClose={() => setStatement(false)} />}
      {adjust && <AdjustBalance c={c} onClose={() => setAdjust(false)} onDone={() => { setAdjust(false); onSaved(); }} />}
    </Modal>
  );
}

/** A customer added by hand (a regular, a catering customer): the same rules as the import, the phone is the key. */
function NewCustomer({ r, onClose, onSaved }: { r: Restaurant; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [f, setF] = useState({ phone: '', name: '', birthday: '', note: '', marketing_ok: false });
  const [busy, setBusy] = useState(false);
  const digits = f.phone.replace(/\D/g, '');
  const save = async () => {
    if (digits.length < 6 || digits.length > 15) { a.toast(t('Indiquez un numéro de téléphone valide.'), 'error'); return; }
    setBusy(true);
    try {
      const res = await rpc<{ created: number; updated: number; skipped: number }>('import_customers', { p_restaurant_id: r.id,
        p_rows: [{ phone: f.phone.trim(), name: f.name.trim() || null, birthday: f.birthday || null, note: f.note.trim() || null, marketing_ok: f.marketing_ok, points: 0, visits: 0, spent_cents: 0 }] });
      if (res.skipped) a.toast(t('Indiquez un numéro de téléphone valide.'), 'error');
      else { a.toast(res.updated ? t('Ce numéro existait déjà : la fiche est complétée.') : t('Client ajouté')); onSaved(); }
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={t('Nouveau client')} onClose={onClose}
      footer={<div className="flex justify-end gap-3"><Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy} onClick={save}><Plus className="h-4 w-4" /> {t('Ajouter')}</Btn></div>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Téléphone')}><input autoFocus className={inputCls} dir="ltr" inputMode="tel" maxLength={20} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="06…" /></Field>
          <Field label={t('Prénom')}><input className={inputCls} maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('Anniversaire')}><input type="date" className={inputCls} value={f.birthday} onChange={e => setF({ ...f, birthday: e.target.value })} /></Field>
          <Field label={t('Note')}><input className={inputCls} maxLength={300} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={t('Allergie, table préférée…')} /></Field>
        </div>
        <Toggle checked={f.marketing_ok} onChange={v => setF({ ...f, marketing_ok: v })} label={t('D’accord pour recevoir les offres sur WhatsApp')} />
        <p className="text-xs text-muted">{t('Cochez seulement si le client a donné son accord (loi 09-08).')}</p>
      </div>
    </Modal>
  );
}

interface Dish { id: string; name: string; price: number; cost: number | null }
const nameOf = (n: I18n | null | undefined) => (n?.fr || n?.en || Object.values(n ?? {})[0] || '') as string;
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')} %`;
const newId = () => `r${Math.random().toString(36).slice(2, 8)}`;

function LoyaltySettings({ part, rid, restaurantName, loyalty, onClose, onSave }: { part: 'rewards' | 'messages'; rid: string; restaurantName: string; loyalty: Loyalty; onClose: () => void; onSave: (l: Loyalty) => void }) {
  const [on, setOn] = useState(!!loyalty.enabled);
  const credit = !!loyalty.credit;
  const [per, setPer] = useState(String(loyalty.per_dh ?? 10));
  const [maxPer, setMaxPer] = useState(String(loyalty.max_per_order ?? 1));
  const cb0 = comebackCfg(loyalty);
  const [cbDays, setCbDays] = useState(String(cb0.days));
  const [cbMode, setCbMode] = useState<ComebackCfg['mode']>(cb0.mode);
  const [cbOffer, setCbOffer] = useState(cb0.offer);
  const [cbBonus, setCbBonus] = useState(String(cb0.bonus));
  const [cbMsg, setCbMsg] = useState(cb0.message);
  const bd0 = birthdayCfg(loyalty);
  const [bdOffer, setBdOffer] = useState(bd0.offer);
  const [bdBonus, setBdBonus] = useState(String(bd0.bonus));
  const [bdMsg, setBdMsg] = useState(bd0.message);
  const [rewards, setRewards] = useState<LoyaltyReward[]>(() => loyaltyRewards(loyalty).map(x => (x.id === 'legacy' ? { ...x, id: newId() } : x)));
  const [dishes, setDishes] = useState<Dish[]>([]);
  const p = Math.max(1, Number(per) || 10);
  // the points each saved reward costs today, to warn when the price goes up
  const was = useMemo(() => new Map((loyalty.rewards ?? []).map(x => [x.id, x.points] as const)), [loyalty.rewards]);

  // the dishes to give away, and what each costs to make (from the recipes, when there are some)
  useEffect(() => {
    (async () => {
      try {
        const items = check(await supabase.from('menu_items').select('id, name, price_cents').eq('restaurant_id', rid).eq('active', true).order('sort_order')) as { id: string; name: I18n; price_cents: number }[];
        const cost = new Map<string, number>();
        try {
          const pr = await rpc<ProfitData>('profit_dishes', { p_restaurant_id: rid, p_days: 30 });
          for (const d of pr.dishes) if (d.cost_cents != null) cost.set(d.item_id, Math.min(cost.get(d.item_id) ?? Infinity, Number(d.cost_cents)));
        } catch { /* no recipes yet: the cost stays unknown */ }
        setDishes(items.map(i => ({ id: i.id, name: nameOf(i.name), price: Number(i.price_cents), cost: cost.get(i.id) ?? null })));
      } catch { /* the list stays empty */ }
    })();
  }, [rid]);

  const setAt = (i: number, rw: LoyaltyReward) => setRewards(list => list.map((x, j) => (j === i ? rw : x)));
  // what the settings say right now (days kept inside the limits), for the preview
  const cbNow: ComebackCfg = { days: Math.min(COMEBACK_DAYS.max, Math.max(COMEBACK_DAYS.min, Math.round(Number(cbDays) || COMEBACK_DAYS.def))), mode: cbMode, offer: cbOffer.trim(),
    bonus: Math.min(COMEBACK_BONUS_MAX, Math.max(0, Math.round(Number(cbBonus) || 0))), message: cbMsg.trim() };
  const preview = comebackMessage(cbNow, { first: 'Hind', restaurant: restaurantName, bonus: on && cbMode === 'offer' ? cbNow.bonus : 0 });
  const bdNow: BirthdayCfg = { offer: bdOffer.trim(), bonus: Math.min(COMEBACK_BONUS_MAX, Math.max(0, Math.round(Number(bdBonus) || 0))), message: bdMsg.trim() };
  const bdPreview = birthdayMessage(bdNow, { first: 'Hind', restaurant: restaurantName, bonus: on ? bdNow.bonus : 0 });
  const valid = rewards.length > 0 && rewards.every(rw => rw.points >= 1 && (rw.kind === 'item' ? !!rw.item_id : (rw.cents ?? 0) >= 1));
  const save = () => {
    const list = rewards.map(rw => rw.kind === 'item'
      ? { id: rw.id, kind: 'item' as const, points: rw.points, item_id: rw.item_id, label: (dishes.find(d => d.id === rw.item_id)?.name ?? rw.label ?? '').slice(0, 80) || undefined }
      : { id: rw.id, kind: 'discount' as const, points: rw.points, cents: rw.cents });
    // the first money reward is also kept in the old fields (the sign-up page and old screens still read them)
    const money = list.find(x => x.kind === 'discount');
    const comeback = { days: cbNow.days, mode: cbMode, offer: cbOffer.trim(), bonus_points: Math.min(COMEBACK_BONUS_MAX, Math.max(0, Math.round(Number(cbBonus) || 0))), message: cbMsg.trim() };
    const birthday = { offer: bdOffer.trim(), bonus_points: Math.min(COMEBACK_BONUS_MAX, Math.max(0, Math.round(Number(bdBonus) || 0))), message: bdMsg.trim() };
    onSave({ ...loyalty, customers: true, enabled: on, credit, per_dh: loyalty.mode === 'value' ? loyalty.per_dh : p, rewards: list, max_per_order: Math.min(10, Math.max(1, Number(maxPer) || 1)), comeback, birthday,
      reward_points: money?.points ?? loyalty.reward_points ?? 100, reward_cents: money?.cents ?? loyalty.reward_cents ?? 5000 });
  };

  return (
    <Modal title={part === 'rewards' ? t('Récompenses') : t('Messages WhatsApp')} onClose={onClose}
      footer={<div className="flex justify-end">
        <Btn tone="brand" disabled={part === 'rewards' && on && !valid} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        {part === 'rewards' && <Toggle checked={on} onChange={setOn} label={t('Points de fidélité')} />}
        {part === 'rewards' && on && <>
          <Field label={t('1 point tous les (DH)')}><input className={inputCls} inputMode="numeric" value={per} onChange={e => setPer(e.target.value.replace(/\D/g, ''))} /></Field>
          <div>
            <p className="text-sm font-semibold">{t('Récompenses')}</p>
            <p className="mt-0.5 text-sm text-muted">{t('Un produit offert est déduit de l’addition quand le client le commande. Le client peut cumuler plusieurs récompenses sur une même addition, jusqu’au maximum ci-dessous.')}</p>
          </div>
          <div className="space-y-3">
            {rewards.map((rw, i) => (
              <RewardRow key={rw.id} rw={rw} p={p} was={was.get(rw.id)} dishes={dishes} onChange={x => setAt(i, x)}
                onRemove={() => setRewards(list => list.filter((_, j) => j !== i))} />
            ))}
          </div>
          <Field label={t('Récompenses maximum par addition')}>
            <input className={inputCls} inputMode="numeric" value={maxPer} onChange={e => setMaxPer(e.target.value.replace(/\D/g, '').slice(0, 2))} />
            <p className="mt-1 text-xs text-muted">{t('Entre 1 et 10. Si les récompenses couvrent toute l’addition, elle est clôturée à 0 DH.')}</p>
          </Field>
          {rewards.length < 8 && (
            <Btn tone="ghost" onClick={() => setRewards(list => [...list, { id: newId(), kind: 'item', points: 50, item_id: dishes[0]?.id }])}>
              <Plus className="h-4 w-4" /> {t('Ajouter une récompense')}</Btn>
          )}
          {!valid && <p className="text-sm text-warn">{t('Chaque récompense a besoin d’un produit ou d’un montant.')}</p>}
        </>}
        {part === 'messages' && <>
        <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
          <p className="font-semibold">{t('Message pour faire revenir les clients')}</p>
          <p className="text-sm text-muted">{t('Dans Clients, filtre « Ne reviennent plus », un bouton ouvre WhatsApp avec ce message, prêt à envoyer. Seulement pour les clients qui ont donné leur accord.')}</p>
          <Field label={t('Client perdu après (jours sans visite)')} hint={t('Entre {a} et {b}.', { a: COMEBACK_DAYS.min, b: COMEBACK_DAYS.max })}>
            <input className={`${inputCls} w-32`} inputMode="numeric" value={cbDays} onChange={e => setCbDays(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          </Field>
          <Field label={t('Type de message')} group>
            <div className="flex flex-wrap gap-2">
              <Btn tone={cbMode === 'invite' ? 'brand' : 'ghost'} onClick={() => setCbMode('invite')}>{t('Invitation seule')}</Btn>
              <Btn tone={cbMode === 'offer' ? 'brand' : 'ghost'} onClick={() => setCbMode('offer')}>{t('Invitation avec offre')}</Btn>
            </div>
          </Field>
          {cbMode === 'offer' && <>
            <Field label={t('Votre offre')} hint={t('À honorer à la caisse, par exemple avec une remise du manager. Facultatif si vous offrez des points.')}>
              <input className={inputCls} maxLength={120} value={cbOffer} onChange={e => setCbOffer(e.target.value)} placeholder={t('Un café offert à votre prochaine visite')} />
            </Field>
            {on
              ? <Field label={t('Points bonus offerts')} hint={t('Ajoutés à sa carte quand vous envoyez le message, une seule fois tant que le client n’est pas revenu. 0 = aucun.')}>
                  <input className={`${inputCls} w-32`} inputMode="numeric" value={cbBonus} onChange={e => setCbBonus(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                </Field>
              : <p className="text-sm text-muted">{t('Activez les points de fidélité pour pouvoir offrir des points bonus.')}</p>}
          </>}
          <Field label={t('Votre propre texte (facultatif)')} hint={t('Laissez vide pour le texte proposé. Vous pouvez utiliser {name}, {restaurant}, {offer} et {points}.')}>
            <textarea className={inputCls} rows={3} maxLength={500} value={cbMsg} onChange={e => setCbMsg(e.target.value)} />
          </Field>
          <div className="rounded-xl bg-surface p-3 text-sm">
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">{t('Aperçu')}</p>
            <p className="whitespace-pre-wrap">{preview}</p>
          </div>
        </div>
        <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
          <p className="font-semibold">{t('Message d’anniversaire')}</p>
          <p className="text-sm text-muted">{t('Dans Clients, filtre « Anniversaire ce mois », un bouton ouvre WhatsApp avec ce message. Une fois par an et par client, seulement pour ceux qui ont donné leur accord.')}</p>
          <Field label={t('Votre cadeau')} hint={t('À honorer à la caisse, par exemple avec une remise du manager. Facultatif si vous offrez des points.')}>
            <input className={inputCls} maxLength={120} value={bdOffer} onChange={e => setBdOffer(e.target.value)} placeholder={t('Un dessert offert ce mois-ci')} />
          </Field>
          {on
            ? <Field label={t('Points bonus offerts')} hint={t('Ajoutés à sa carte quand vous envoyez le message, une seule fois par an. 0 = aucun.')}>
                <input className={`${inputCls} w-32`} inputMode="numeric" value={bdBonus} onChange={e => setBdBonus(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              </Field>
            : <p className="text-sm text-muted">{t('Activez les points de fidélité pour pouvoir offrir des points bonus.')}</p>}
          <Field label={t('Votre propre texte (facultatif)')} hint={t('Laissez vide pour le texte proposé. Vous pouvez utiliser {name}, {restaurant}, {offer} et {points}.')}>
            <textarea className={inputCls} rows={3} maxLength={500} value={bdMsg} onChange={e => setBdMsg(e.target.value)} />
          </Field>
          <div className="rounded-xl bg-surface p-3 text-sm">
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">{t('Aperçu')}</p>
            <p className="whitespace-pre-wrap">{bdPreview}</p>
          </div>
        </div>
        </>}
      </div>
    </Modal>
  );
}

/** One reward: free dish or money off, with what it costs you compared to what the customer spent to earn it. */
function RewardRow({ rw, p, was, dishes, onChange, onRemove }: { rw: LoyaltyReward; p: number; was?: number; dishes: Dish[]; onChange: (r: LoyaltyReward) => void; onRemove: () => void }) {
  const [val, setVal] = useState(fromCents(rw.cents ?? null));
  const spend = rw.points * p * 100;
  const dish = rw.kind === 'item' ? dishes.find(d => d.id === rw.item_id) : undefined;
  // "give back X %": the owner types the percentage, the points follow (and follow again when 1 point per X DH or the value changes)
  const [target, setTarget] = useState('');
  const worth = rw.kind === 'discount' ? (rw.cents ?? 0) : (dish?.price ?? 0);
  const tgt = Number(target.replace(',', '.'));
  const suggested = tgt > 0 && worth > 0 ? Math.max(1, Math.round(worth / (tgt / 100) / (p * 100))) : 0;
  useEffect(() => {
    if (suggested && suggested !== rw.points) onChange({ ...rw, points: suggested });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested]);
  let note: React.ReactNode = null;
  if (rw.kind === 'discount' && (rw.cents ?? 0) > 0) {
    const ratio = (rw.cents ?? 0) / spend;
    note = <>{t('Le client dépense {s} pour gagner {m} : {pc} de remise.', { s: mad(spend), m: mad(rw.cents ?? 0), pc: pct(ratio) })}
      {ratio > 0.1 && <span className="block text-warn">{t('Attention : plus de 10 % de remise, c’est beaucoup pour un restaurant. Comparez avec votre marge.')}</span>}</>;
  } else if (dish) {
    note = dish.cost != null
      ? <>{t('Le client dépense {s} pour gagner ce produit. Il vous coûte environ {c}, soit {pc} de ses dépenses.', { s: mad(spend), c: mad(dish.cost), pc: pct(dish.cost / spend) })}
          {dish.cost / spend > 0.05 && <span className="block text-warn">{t('Attention : ce produit offert coûte plus de 5 % de ce que le client dépense.')}</span>}</>
      : <>{t('Le client dépense {s} pour gagner ce produit (prix {m}, soit {pc}). Ajoutez sa recette dans Profit pour voir ce qu’il vous coûte vraiment.', { s: mad(spend), m: mad(dish.price), pc: pct(dish.price / spend) })}
          {dish.price / spend > 0.1 && <span className="block text-warn">{t('Attention : plus de 10 % de remise, c’est beaucoup pour un restaurant. Comparez avec votre marge.')}</span>}</>;
  }
  return (
    <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
      <div className="grid items-end gap-2 sm:grid-cols-[9rem_6rem_6rem_1fr_auto]">
        <Field label={t('Récompense')}>
          <select className={inputCls} value={rw.kind} onChange={e => onChange(e.target.value === 'item'
            ? { id: rw.id, kind: 'item', points: rw.points, item_id: dishes[0]?.id } : { id: rw.id, kind: 'discount', points: rw.points, cents: toCents(val) || undefined })}>
            <option value="item">{t('Produit offert')}</option>
            <option value="discount">{t('Remise')}</option>
          </select>
        </Field>
        <Field label={t('Retour visé (%)')}><input className={inputCls} inputMode="decimal" placeholder="5" value={target} onChange={e => setTarget(e.target.value.replace(/[^\d.,]/g, '').slice(0, 5))} /></Field>
        <Field label={t('Points')}><input className={inputCls} inputMode="numeric" value={rw.points || ''} onChange={e => { setTarget(''); onChange({ ...rw, points: Number(e.target.value.replace(/\D/g, '')) || 0 }); }} /></Field>
        {rw.kind === 'item'
          ? <Field label={t('Produit')}>
              <select className={inputCls} value={rw.item_id ?? ''} onChange={e => onChange({ ...rw, item_id: e.target.value || undefined })}>
                <option value="">{t('Choisir…')}</option>
                {dishes.map(d => <option key={d.id} value={d.id}>{d.name} · {mad(d.price)}</option>)}
              </select>
            </Field>
          : <Field label={t('Valeur offerte (DH)')}>
              <input className={inputCls} inputMode="decimal" value={val} onChange={e => { setVal(e.target.value); onChange({ ...rw, cents: toCents(e.target.value) || undefined }); }} />
            </Field>}
        <button type="button" onClick={onRemove} aria-label={t('Supprimer')} className="grid h-11 w-11 place-items-center rounded-xl text-danger hover:bg-surface"><Trash2 className="h-4 w-4" /></button>
      </div>
      {note && <p className="text-sm">{note}</p>}
      {target && worth <= 0 && <p className="text-xs text-muted">{t('Choisissez d’abord la valeur ou le produit : les points se calculent ensuite.')}</p>}
      {was != null && rw.points > was && <p className="text-sm text-warn">{t('Attention : cette récompense coûtait {a} points, elle en coûtera {b}. Les clients qui ont déjà {a} points ne pourront plus l’échanger tout de suite.', { a: was, b: rw.points })}</p>}
    </div>
  );
}

interface StatementLine { date: string; at: string; kind: 'sale' | 'refund' | 'payment' | 'adjust'; amount_cents: number; method: string | null; doc_number: string | null; note: string | null }
interface StatementData { from: string; to: string; opening_cents: number; closing_cents: number; debits_cents: number; credits_cents: number; balance_cents: number; lines: StatementLine[] }
const KIND: Record<StatementLine['kind'], string> = { sale: 'Achat à l’ardoise', refund: 'Avoir', payment: 'Règlement', adjust: 'Correction' };
const PAY: Record<string, string> = { cash: 'espèces', card: 'carte', transfer: 'virement' };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The monthly statement of one customer: to print, or to send on WhatsApp. */
function Statement({ c, r, onClose }: { c: Customer; r: Restaurant; onClose: () => void }) {
  const a = useAdminCtx();
  const [month, setMonth] = useState(() => ymd(new Date()).slice(0, 7));
  const [st, setSt] = useState<StatementData | null>(null);
  useEffect(() => {
    const [y, m] = month.split('-').map(Number);
    setSt(null);
    rpc<StatementData>('customer_statement', { p_customer_id: c.id, p_from: ymd(new Date(y, m - 1, 1)), p_to: ymd(new Date(y, m, 0)) }).then(setSt, e => a.fail(e));
  }, [month, c.id, a]);
  const day = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(dateLocale());
  const label = (l: StatementLine) => `${t(KIND[l.kind])}${l.doc_number ? ` ${l.doc_number}` : ''}${l.method ? ` (${t(PAY[l.method] ?? l.method)})` : ''}${l.note ? ` · ${l.note}` : ''}`;
  const wa = () => {
    if (!st) return;
    const lines = st.lines.map(l => `${day(l.date)}  ${label(l)}  ${l.amount_cents > 0 ? '+' : ''}${mad(Number(l.amount_cents))}`);
    const text = [t('Bonjour {n},', { n: c.name || '' }).replace(' ,', ','), t('Votre relevé {r} du mois :', { r: r.name }), '',
      t('Solde précédent : {m}', { m: mad(Number(st.opening_cents)) }), ...lines, '', t('Reste à payer : {m}', { m: mad(Number(st.closing_cents)) }), t('Merci !')].join('\n');
    const phone = c.phone.replace(/^0/, '212');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  const printIt = () => {
    if (!st) return;
    const esc = (x: string) => x.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
    const dir = document.documentElement.dir || 'ltr';
    const rows = st.lines.map(l => `<tr><td>${esc(day(l.date))}</td><td>${esc(label(l))}</td><td class="n">${l.amount_cents > 0 ? '+' : ''}${esc(mad(Number(l.amount_cents)))}</td></tr>`).join('');
    const w = window.open('', '_blank');
    if (!w) { a.toast(t('Autorisez les fenêtres pour imprimer.'), 'error'); return; }
    w.document.write(`<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(t('Relevé'))}</title><style>
      body{font:14px system-ui,sans-serif;color:#001E3E;margin:32px}h1{font-size:20px;margin:0}p{margin:4px 0;color:#4A5A6E}
      table{width:100%;border-collapse:collapse;margin-top:16px}td{padding:6px 4px;border-bottom:1px solid #e3e8ee}.n{text-align:end;white-space:nowrap}
      .tot{margin-top:16px;font-size:18px;font-weight:700;text-align:end}</style></head><body>
      <h1>${esc(r.name)}</h1><p>${esc(t('Relevé du mois {m}', { m: month }))}</p><p>${esc(c.name || '')} ${esc(c.phone)}</p>
      <table><tr><td></td><td>${esc(t('Solde précédent'))}</td><td class="n">${esc(mad(Number(st.opening_cents)))}</td></tr>${rows}</table>
      <p class="tot">${esc(t('Reste à payer : {m}', { m: mad(Number(st.closing_cents)) }))}</p></body></html>`);
    w.document.close(); w.focus(); w.print();
  };
  return (
    <Modal title={t('Relevé · {n}', { n: c.name || c.phone })} onClose={onClose} wide
      footer={<div className="flex flex-wrap justify-end gap-2 print:hidden">
        <Btn onClick={printIt} disabled={!st}><Printer className="h-4 w-4" /> {t('Imprimer')}</Btn>
        <Btn tone="brand" onClick={wa} disabled={!st}><MessageCircle className="h-4 w-4" /> {t('Envoyer sur WhatsApp')}</Btn>
      </div>}>
      <div className="space-y-4" id="statement">
        <div className="flex flex-wrap items-end gap-3">
          <div className="me-auto"><p className="font-semibold">{r.name}</p><p dir="ltr" className="text-sm text-muted rtl:text-end">{c.name ? `${c.name} · ` : ''}{c.phone}</p></div>
          <Field label={t('Mois')}><input type="month" className={`${inputCls} w-44 print:hidden`} value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></Field>
        </div>
        {!st ? <p className="text-muted">{t('Chargement…')}</p> : <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[[t('Solde précédent'), st.opening_cents], [t('Achats'), st.debits_cents], [t('Réglé ou déduit'), st.credits_cents], [t('Reste à payer'), st.closing_cents]].map(([l, v], i) => (
              <div key={i} className={`rounded-2xl p-3 ${i === 3 ? 'bg-night text-white' : 'bg-surface-2'}`}><p className={`text-xs ${i === 3 ? 'text-white/70' : 'text-muted'}`}>{l}</p><p className="font-display text-xl font-semibold tabular">{mad(Number(v))}</p></div>
            ))}
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line/10">
              {st.lines.map((l, i) => (
                <tr key={i}><td className="py-2 pe-3 text-muted">{day(l.date)}</td><td className="py-2">{label(l)}</td>
                  <td className={`py-2 text-end font-semibold tabular ${l.amount_cents < 0 ? 'text-ok' : ''}`}>{l.amount_cents > 0 ? '+' : ''}{mad(Number(l.amount_cents))}</td></tr>
              ))}
              {!st.lines.length && <tr><td colSpan={3} className="py-8 text-center text-muted">{t('Aucun mouvement ce mois-ci.')}</td></tr>}
            </tbody>
          </table>
          {month !== ymd(new Date()).slice(0, 7) && Number(st.balance_cents) !== Number(st.closing_cents) && <p className="text-sm text-muted">{t('Aujourd’hui, le client doit {m}.', { m: mad(Number(st.balance_cents)) })}</p>}
        </>}
      </div>
    </Modal>
  );
}

/** A correction by hand (forgotten payment, commercial gesture), always with a reason. */
function AdjustBalance({ c, onClose, onDone }: { c: Customer; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [dir, setDir] = useState<'down' | 'up'>('down');
  const [val, setVal] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = toCents(val) * (dir === 'down' ? -1 : 1);
  const save = async () => {
    setBusy(true);
    try { await rpc('customer_account_adjust', { p_customer_id: c.id, p_amount_cents: cents, p_note: note.trim() }); a.toast(t('Enregistré')); onDone(); }
    catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={t('Corriger le solde')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !cents || note.trim().length < 2} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('Pour un règlement oublié ou un geste commercial. Les ventes et règlements à la caisse se font tout seuls. Chaque correction est gardée dans le relevé.')}</p>
        <div className="flex gap-2">
          {(['down', 'up'] as const).map(d => <button key={d} onClick={() => setDir(d)} className={`flex-1 rounded-xl py-2.5 text-sm font-bold ${dir === d ? 'bg-night text-white' : 'bg-surface-2 text-muted'}`}>{d === 'down' ? t('Diminuer la dette') : t('Augmenter la dette')}</button>)}
        </div>
        <Field label={t('Montant (DH)')}><input autoFocus className={inputCls} inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} /></Field>
        <Field label={t('Motif')}><input className={inputCls} maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder={t('Réglé en dehors de la caisse, geste commercial…')} /></Field>
        <p className="rounded-xl bg-surface-2 p-3 text-sm">{t('Nouveau solde : {m}', { m: mad(Number(c.balance_cents) + cents) })}</p>
      </div>
    </Modal>
  );
}

/** Fidélité: in savings mode, two choices with big buttons (how much comes back, from when it can be used);
 *  the WhatsApp messages are ready and only opened to change the text. */
function SavingsPanel({ r, loyalty, canEdit, onSave, onOpen }: { r: Restaurant; loyalty: Loyalty; canEdit: boolean; onSave: (l: Loyalty) => void; onOpen: (p: 'rewards' | 'messages') => void }) {
  const value = loyalty.mode === 'value';
  const on = !!loyalty.enabled;
  const percent = loyalty.percent ?? 5;
  const min = loyalty.min_points ?? 0;
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const setValue = (x: Partial<Loyalty>) => onSave({ ...loyalty, customers: true, enabled: true, mode: 'value', percent, min_points: min, ...x });
  const choice = (active: boolean) => `flex-1 rounded-2xl px-4 py-3 text-start transition ${active ? 'bg-night text-white' : 'bg-surface-2 hover:bg-surface-3'} disabled:opacity-50`;
  return (
    <div className="space-y-5">
      <div className="card rounded-3xl p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Gift className="h-7 w-7 shrink-0 text-brand" />
          <div className="me-auto min-w-[14rem] flex-1">
            <h2 className="font-display text-xl font-semibold">{t('La cagnotte')}</h2>
            <p className="text-sm text-muted">{t('À chaque visite, le client met de côté une partie de son addition. Il la dépense sur tout le menu.')}</p>
          </div>
          {canEdit && <Toggle checked={on} onChange={v => v ? setValue({}) : onSave({ ...loyalty, enabled: false })} label={on ? t('Activée') : t('Désactivée')} />}
        </div>

        {on && !value && (
          <div className="mt-5 rounded-2xl bg-brand/10 p-4">
            <p className="font-semibold">{t('Vous utilisez encore les récompenses avec des points.')}</p>
            <p className="mt-1 text-sm text-muted">{t('Plus simple : la cagnotte en dirhams. Pas de liste de récompenses à tenir, le client choisit sur le menu.')}</p>
            {confirmSwitch ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-warn">{t('Les points déjà gagnés deviennent des dirhams : 1 point = 1 DH.')}</p>
                <div className="flex flex-wrap gap-2">
                  <Btn tone="brand" onClick={() => setValue({})}>{t('Passer à la cagnotte')}</Btn>
                  <Btn tone="ghost" onClick={() => setConfirmSwitch(false)}>{t('Annuler')}</Btn>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {canEdit && <Btn tone="brand" onClick={() => setConfirmSwitch(true)}>{t('Passer à la cagnotte')}</Btn>}
                {canEdit && <Btn tone="ghost" onClick={() => onOpen('rewards')}>{t('Modifier mes récompenses')}</Btn>}
              </div>
            )}
          </div>
        )}

        {on && value && <>
          <p className="mt-6 text-sm font-semibold">{t('Combien revient au client ?')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[3, 5, 10].map(p => (
              <button key={p} type="button" disabled={!canEdit} onClick={() => setValue({ percent: p })} className={choice(percent === p)} aria-pressed={percent === p}>
                <span className="block font-display text-2xl font-semibold">{p} %</span>
                <span className={`block text-xs ${percent === p ? 'text-white/70' : 'text-muted'}`}>{p === 3 ? t('Petit cadeau') : p === 5 ? t('Normal') : t('Généreux')}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">{t('Exemple : un client dépense {s}, il met {m} dans sa cagnotte.', { s: mad(20000), m: mad(Math.floor(200 / Math.round(100 / percent)) * 100) })}</p>

          <p className="mt-6 text-sm font-semibold">{t('Utilisable à partir de')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[0, 20, 50].map(m => (
              <button key={m} type="button" disabled={!canEdit} onClick={() => setValue({ min_points: m })} className={choice(min === m)} aria-pressed={min === m}>
                <span className="block font-display text-2xl font-semibold">{m ? mad(m * 100) : t('Tout de suite')}</span>
                <span className={`block text-xs ${min === m ? 'text-white/70' : 'text-muted'}`}>{m ? t('Évite le petit cadeau à chaque visite') : t('Dès le premier dirham')}</span>
              </button>
            ))}
          </div>
          <p className="mt-4 rounded-2xl bg-surface-2 p-3 text-sm">{t('À la caisse, le client voit ce qu’il peut prendre gratuitement. Un plat plus cher ? Sa cagnotte paie une partie.')}</p>
        </>}
      </div>

      <div className="card rounded-3xl p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <MessageCircle className="h-7 w-7 shrink-0 text-brand" />
          <div className="me-auto min-w-[14rem] flex-1">
            <h2 className="font-display text-xl font-semibold">{t('Messages WhatsApp')}</h2>
            <p className="text-sm text-muted">{t('Anniversaire et « vous nous manquez » : déjà écrits. Envoyez-les depuis Clients, avec les filtres.')}</p>
          </div>
          {canEdit && <Btn tone="ghost" onClick={() => onOpen('messages')}><Pencil className="h-4 w-4" /> {t('Personnaliser')}</Btn>}
        </div>
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <Btn tone="ghost" className="text-sm text-danger" onClick={() => { if (window.confirm(t('Désactiver le fichier clients ? Les clients ne sont plus reconnus à la caisse.'))) onSave({ ...loyalty, customers: false, enabled: false, credit: false }); }}>{t('Désactiver le fichier clients')}</Btn>
        </div>
      )}
      <p className="sr-only">{r.name}</p>
    </div>
  );
}

/** Ardoises: who owes what, the total, and "Payé" in one tap. */
function TabsPanel({ r, list, credit, canEdit, onToggle, onOpen, onChanged }: {
  r: Restaurant; list: Customer[]; credit: boolean; canEdit: boolean; onToggle: (v: boolean) => void; onOpen: (c: Customer) => void; onChanged: () => void;
}) {
  const [pay, setPay] = useState<Customer | null>(null);
  const [statement, setStatement] = useState<Customer | null>(null);
  const owing = list.filter(c => Number(c.balance_cents) > 0).sort((x, y) => Number(y.balance_cents) - Number(x.balance_cents));
  const total = owing.reduce((n, c) => n + Number(c.balance_cents), 0);
  const allowed = list.filter(c => c.credit_allowed).length;
  if (!credit) return (
    <div className="card flex flex-wrap items-center gap-4 rounded-3xl p-5 md:p-6">
      <NotebookPen className="h-7 w-7 shrink-0 text-brand" />
      <div className="me-auto min-w-[14rem] flex-1">
        <h2 className="font-display text-xl font-semibold">{t('Ardoises')}</h2>
        <p className="text-sm text-muted">{t('Certains clients prennent maintenant et paient plus tard. Vous choisissez qui, et jusqu’à combien.')}</p>
      </div>
      {canEdit && <Btn tone="brand" onClick={() => onToggle(true)}>{t('Activer les ardoises')}</Btn>}
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="night flex flex-wrap items-end gap-4 rounded-3xl p-5 md:p-6">
        <div className="me-auto">
          <p className="text-sm text-white/70">{t('À encaisser')}</p>
          <p className="font-display text-4xl font-semibold tabular">{mad(total)}</p>
        </div>
        <p className="text-sm text-white/70">{t('{n} client(s) doivent de l’argent', { n: owing.length })} · {t('{n} autorisé(s)', { n: allowed })}</p>
      </div>
      <div className="card divide-y divide-line/10 rounded-3xl">
        {owing.map(c => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <button type="button" onClick={() => onOpen(c)} className="me-auto min-w-[10rem] flex-1 text-start">
              <span className="block font-semibold">{c.name || t('Sans nom')}</span>
              <span dir="ltr" className="block text-xs text-muted rtl:text-end">{c.phone}</span>
            </button>
            <span className="font-display text-xl font-semibold tabular text-warn">{mad(Number(c.balance_cents))}</span>
            <Btn tone="ghost" className="px-3 py-2 text-sm" onClick={() => setStatement(c)}><Printer className="h-4 w-4" /> {t('Relevé')}</Btn>
            <Btn tone="brand" className="px-3 py-2 text-sm" onClick={() => setPay(c)}><ShieldCheck className="h-4 w-4" /> {t('Payé')}</Btn>
          </div>
        ))}
        {!owing.length && <p className="px-4 py-10 text-center text-muted">{t('Personne ne doit d’argent.')}</p>}
      </div>
      <p className="text-sm text-muted">{t('Pour autoriser un client : ouvrez sa fiche dans Clients et cochez « Peut payer plus tard ».')}</p>
      {canEdit && <div className="flex justify-end"><Btn tone="ghost" className="text-sm" onClick={() => onToggle(false)}>{t('Désactiver les ardoises')}</Btn></div>}
      {pay && <PayTab r={r} c={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); onChanged(); }} />}
      {statement && <Statement c={statement} r={r} onClose={() => setStatement(null)} />}
    </div>
  );
}

/** The customer pays (all or part of) what he owes: same record as a payment at the till. */
function PayTab({ r, c, onClose, onDone }: { r: Restaurant; c: Customer; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [val, setVal] = useState(fromCents(Number(c.balance_cents)));
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [busy, setBusy] = useState(false);
  const cents = toCents(val);
  const save = async () => {
    setBusy(true);
    try {
      await rpc('pos_account_payment', { p_restaurant_id: r.id, p_customer_id: c.id, p_amount_cents: cents, p_method: method, p_staff_id: null });
      a.toast(t('{m} encaissé', { m: mad(cents) })); onDone();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={c.name || c.phone} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || cents <= 0} onClick={save}><ShieldCheck className="h-4 w-4" /> {t('Payé')}</Btn></div>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('Doit : {m}', { m: mad(Number(c.balance_cents)) })}</p>
        <Field label={t('Montant payé (DH)')}><input autoFocus className={inputCls} inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} /></Field>
        <div className="flex gap-2">
          {(['cash', 'card', 'transfer'] as const).map(m => (
            <button key={m} type="button" onClick={() => setMethod(m)} className={`flex-1 rounded-xl py-2.5 text-sm font-bold ${method === m ? 'bg-night text-white' : 'bg-surface-2 text-muted'}`}>
              {m === 'cash' ? t('Espèces') : m === 'card' ? t('Carte') : t('Virement')}</button>
          ))}
        </div>
        {cents > 0 && cents < Number(c.balance_cents) && <p className="rounded-xl bg-surface-2 p-3 text-sm">{t('Reste à payer : {m}', { m: mad(Number(c.balance_cents) - cents) })}</p>}
      </div>
    </Modal>
  );
}
