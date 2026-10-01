// Customer file and loyalty points. OFF until the owner switches it on: only then
// are phone numbers kept (law 09-08: keep only what is needed, with consent for messages).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cake, Copy, Gift, Pencil, Search, ShieldCheck, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, fromCents, mad, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, Toggle, inputCls } from '../components/ui';

interface Customer {
  id: string; phone: string; name: string | null; birthday: string | null; note: string | null; marketing_ok: boolean;
  points: number; visits: number; spent_cents: number; first_visit_at: string | null; last_visit_at: string | null; created_at: string;
}
type Loyalty = NonNullable<Restaurant['loyalty']>;
type Filter = 'all' | 'birthday' | 'whatsapp' | 'lost';

export function CustomersPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const loyalty: Loyalty = r.loyalty ?? {};
  const [list, setList] = useState<Customer[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [edit, setEdit] = useState<Customer | null>(null);
  const [settings, setSettings] = useState(false);

  const load = useCallback(async () => {
    if (!loyalty.customers) { setList([]); return; }
    try { setList(check(await supabase.from('customers').select('*').eq('restaurant_id', r.id).order('last_visit_at', { ascending: false, nullsFirst: false }).limit(2000)) as Customer[]); }
    catch (e) { a.fail(e); setList([]); }
  }, [r.id, loyalty.customers, a]);
  useEffect(() => { load(); }, [load]);

  const month = new Date().getMonth() + 1;
  const shown = useMemo(() => {
    const f = q.trim().toLowerCase().replace(/\s/g, '');
    return (list ?? []).filter(c =>
      (!f || (c.name ?? '').toLowerCase().includes(f) || c.phone.includes(f.replace(/\D/g, '') || '§'))
      && (filter === 'all'
        || (filter === 'birthday' && c.birthday && Number(c.birthday.slice(5, 7)) === month)
        || (filter === 'whatsapp' && c.marketing_ok)
        || (filter === 'lost' && c.last_visit_at && Date.now() - Date.parse(c.last_visit_at) > 30 * 864e5 && c.visits >= 2)));
  }, [list, q, filter, month]);

  const saveLoyalty = async (l: Loyalty) => {
    try {
      check(await supabase.from('restaurants').update({ loyalty: l }).eq('id', r.id).select('id'));
      await a.reload(); a.toast(t('Enregistré'));
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

  const FILTERS: [Filter, string][] = [['all', t('Tous ({n})', { n: list?.length ?? 0 })], ['birthday', t('Anniversaire ce mois')], ['whatsapp', t('D’accord pour WhatsApp')], ['lost', t('Ne reviennent plus')]];
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <h1 className="font-display text-3xl font-semibold">{t('Clients')}</h1>
          <p className="text-muted">{loyalty.enabled
            ? t('Points de fidélité : 1 point par {d} DH, {p} points = {m} offerts.', { d: loyalty.per_dh ?? 10, p: loyalty.reward_points ?? 100, m: mad(loyalty.reward_cents ?? 5000) })
            : t('Fichier clients actif. Points de fidélité désactivés.')}</p>
        </div>
        <div className="relative w-60">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} ps-9`} placeholder={t('Nom ou téléphone')} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {a.canEditProfile && <Btn onClick={() => setSettings(true)}><Gift className="h-4 w-4" /> {t('Fidélité')}</Btn>}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${filter === k ? 'bg-night text-white' : 'bg-surface-2 text-muted hover:text-ink'}`}>{l}</button>)}
        {filter === 'whatsapp' && shown.length > 0 && <Btn className="ms-auto px-3 py-1.5" onClick={copyNumbers}><Copy className="h-4 w-4" /> {t('Copier les numéros')}</Btn>}
      </div>

      <div className="card overflow-x-auto rounded-3xl">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3 text-start">{t('Client')}</th>
              <th className="px-3 py-3 text-end">{t('Visites')}</th>
              <th className="px-3 py-3 text-end">{t('Dépensé')}</th>
              {loyalty.enabled && <th className="px-3 py-3 text-end">{t('Points')}</th>}
              <th className="px-3 py-3 text-end">{t('Dernière visite')}</th>
              <th className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/10">
            {shown.map(c => (
              <tr key={c.id} onClick={() => setEdit(c)} className="cursor-pointer hover:bg-surface-2/60">
                <td className="px-4 py-2.5">
                  <p className="flex items-center gap-1.5 font-semibold">{c.name || t('Sans nom')}
                    {c.birthday && Number(c.birthday.slice(5, 7)) === month && <Cake className="h-4 w-4 text-brand" />}
                    {c.marketing_ok && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[10px] font-bold text-ok">WhatsApp</span>}</p>
                  <p dir="ltr" className="text-xs text-muted rtl:text-end">{c.phone}</p>
                </td>
                <td className="px-3 py-2.5 text-end tabular">{c.visits}</td>
                <td className="px-3 py-2.5 text-end tabular">{mad(c.spent_cents)}</td>
                {loyalty.enabled && <td className="px-3 py-2.5 text-end font-semibold tabular">{c.points}</td>}
                <td className="px-3 py-2.5 text-end text-muted">{c.last_visit_at ? new Date(c.last_visit_at).toLocaleDateString(dateLocale()) : '—'}</td>
                <td className="px-3 py-2.5 text-end"><Pencil className="inline h-4 w-4 text-muted" /></td>
              </tr>
            ))}
            {list !== null && !shown.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">{t('Aucun client pour le moment. Ils arrivent avec les commandes qui ont un numéro de téléphone.')}</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && <CustomerEditor c={edit} points={!!loyalty.enabled} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {settings && <LoyaltySettings loyalty={loyalty} onClose={() => setSettings(false)} onSave={l => { setSettings(false); saveLoyalty(l); }} />}
    </div>
  );
}

function CustomerEditor({ c, points, onClose, onSaved }: { c: Customer; points: boolean; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [f, setF] = useState({ name: c.name ?? '', birthday: c.birthday ?? '', note: c.note ?? '', marketing_ok: c.marketing_ok, points: String(c.points) });
  const save = async () => {
    try {
      check(await supabase.from('customers').update({ name: f.name.trim() || null, birthday: f.birthday || null, note: f.note.trim() || null, marketing_ok: f.marketing_ok,
        points: Math.max(0, Math.round(Number(f.points) || 0)) }).eq('id', c.id).select('id'));
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
        {points && <Field label={t('Points')} hint={t('Correction manuelle, enregistrée dans le journal.')}><input className={`${inputCls} w-32`} inputMode="numeric" value={f.points} onChange={e => setF({ ...f, points: e.target.value.replace(/\D/g, '') })} /></Field>}
        <Field label={t('Note')}><input className={inputCls} maxLength={300} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={t('Allergie, table préférée…')} /></Field>
        <Toggle checked={f.marketing_ok} onChange={v => setF({ ...f, marketing_ok: v })} label={t('D’accord pour recevoir les offres sur WhatsApp')} />
      </div>
    </Modal>
  );
}

function LoyaltySettings({ loyalty, onClose, onSave }: { loyalty: Loyalty; onClose: () => void; onSave: (l: Loyalty) => void }) {
  const [on, setOn] = useState(!!loyalty.enabled);
  const [per, setPer] = useState(String(loyalty.per_dh ?? 10));
  const [pts, setPts] = useState(String(loyalty.reward_points ?? 100));
  const [val, setVal] = useState(fromCents(loyalty.reward_cents ?? 5000));
  const p = Math.max(1, Number(per) || 10), n = Math.max(1, Number(pts) || 100), v = toCents(val);
  // what the reward is worth compared to what the customer spent to get it
  const ratio = v / (n * p * 100);
  return (
    <Modal title={t('Fidélité')} onClose={onClose}
      footer={<div className="flex justify-between">
        <Btn tone="ghost" className="text-danger" onClick={() => onSave({ ...loyalty, customers: false, enabled: false })}>{t('Désactiver le fichier clients')}</Btn>
        <Btn tone="brand" onClick={() => onSave({ ...loyalty, customers: true, enabled: on, per_dh: p, reward_points: n, reward_cents: v })}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <Toggle checked={on} onChange={setOn} label={t('Points de fidélité')} />
        {on && <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('1 point tous les (DH)')}><input className={inputCls} inputMode="numeric" value={per} onChange={e => setPer(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label={t('Récompense à (points)')}><input className={inputCls} inputMode="numeric" value={pts} onChange={e => setPts(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label={t('Valeur offerte (DH)')}><input className={inputCls} inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} /></Field>
          </div>
          <p className="rounded-xl bg-surface-2 p-3 text-sm">{t('Le client dépense {s} pour gagner {m} : {pc} de remise.', { s: mad(n * p * 100), m: mad(v), pc: `${(ratio * 100).toFixed(1).replace('.', ',')} %` })}
            {ratio > 0.1 && <span className="block text-warn">{t('Attention : plus de 10 % de remise, c’est beaucoup pour un restaurant. Comparez avec votre marge.')}</span>}</p>
        </>}
      </div>
    </Modal>
  );
}
