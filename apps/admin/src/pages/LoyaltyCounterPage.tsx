// "Comptoir fidélité": the counter screen of a restaurant that has the loyalty product without the till.
// The staff member finds the guest by phone number, credits the points of the bill, hands over a reward, or undoes
// a mistake. Every action asks for the staff PIN; the database does the work (loyalty_counter_* functions).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Gift, Phone, Search, Undo2, UserPlus, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { mad, rpc, toCents, errorMessage } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant, Staff } from '../lib/types';
import { Btn, inputCls } from '../components/ui';

interface Reward { id: string; kind: string; points: number; cents?: number | null; label: string | null; affordable: boolean }
interface WalletItem { id: string; label: string; source: string; expires_at: string | null }
interface Cust { id: string; name: string | null; phone: string; points: number; visits: number; rewards: Reward[]; wallet: WalletItem[] }
interface Entry { id: number; at: string; reason: string; points: number; amount_cents: number | null; reward: string | null; customer: string; staff: string | null; undone: boolean; can_undo: boolean }
interface Result { ok: boolean; error?: string; customer?: Cust; points_added?: number; label?: string; duplicate?: boolean }

const PIN_ERR: Record<string, string> = {
  invalid: 'Code incorrect (ou personne inconnue).',
  locked: 'Trop d’essais : ce code est bloqué quelques minutes.',
  already_used: 'Ce cadeau a déjà été utilisé.',
  expired: 'Ce cadeau a expiré.',
  cancelled: 'Ce cadeau a été annulé.',
  already_undone: 'Cette opération est déjà annulée.',
  too_late: 'On ne peut annuler que le jour même.',
  points_already_spent: 'Le client a déjà dépensé ces points : impossible d’annuler.',
};
const CODES: Record<string, string> = {
  invalid_amount: 'Montant invalide (entre 1 et 10 000 DH).',
  amount_too_small: 'Montant trop petit pour gagner un point.',
  daily_limit: 'Limite du jour atteinte pour ce client (nombre d’additions par jour).',
  invalid_phone: 'Numéro de téléphone invalide.',
  not_enough_points: 'Pas assez de points.',
  reward_not_found: 'Récompense introuvable.',
  loyalty_off: 'La fidélité n’est pas activée (Clients > Réglages).',
  loyalty_not_available: 'La fidélité n’est pas disponible pour ce restaurant.',
};
const explain = (e: unknown) => {
  const msg = (e as { message?: string })?.message ?? '';
  const k = Object.keys(CODES).find(x => msg.includes(x));
  return k ? t(CODES[k]!) : errorMessage(e);
};
const newId = () => crypto.randomUUID();

export function LoyaltyCounterPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const perDh = Math.max(1, Number((r.loyalty as { per_dh?: number } | undefined)?.per_dh) || 10);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState(() => { try { return localStorage.getItem(`counter-staff:${r.id}`) ?? ''; } catch { return ''; } });
  const [pin, setPin] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [cust, setCust] = useState<Cust | null | undefined>(undefined);   // undefined: nothing searched yet; null: not a client yet
  const [amount, setAmount] = useState('');
  const [recent, setRecent] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  // one request id per attempt: a double tap or a retry on a bad connection never counts twice
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const reqId = (key: string) => { if (attempt.current?.key !== key) attempt.current = { key, id: newId() }; return attempt.current.id; };

  useEffect(() => {
    supabase.from('staff').select('id,name,role,active').eq('restaurant_id', r.id).eq('active', true).order('name')
      .then(({ data }) => setStaff((data ?? []) as Staff[]));
  }, [r.id]);
  const pickStaff = (id: string) => { setStaffId(id); try { localStorage.setItem(`counter-staff:${r.id}`, id); } catch { /* fine */ } };

  const loadRecent = useCallback(async () => {
    try { setRecent((await rpc<Entry[]>('loyalty_counter_recent', { p_restaurant_id: r.id })) ?? []); } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { void loadRecent(); }, [loadRecent]);

  const find = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (phone.replace(/\D/g, '').length < 8) { a.toast(t('Numéro de téléphone invalide.'), 'error'); return; }
    setBusy(true);
    try { setCust(await rpc<Cust | null>('loyalty_counter_find', { p_restaurant_id: r.id, p_phone: phone }) ?? null); setAmount(''); }
    catch (err) { a.fail(err); }
    setBusy(false);
  };
  const reset = () => { setCust(undefined); setPhone(''); setName(''); setAmount(''); setPin(''); attempt.current = null; };

  /** one action with the PIN: the common checks, the call, the answer */
  const act = async (_key: string, fn: string, args: Record<string, unknown>, done: (x: Result) => string) => {
    if (!staffId) { a.toast(t('Choisissez qui valide.'), 'error'); return; }
    if (!/^\d{4,6}$/.test(pin)) { a.toast(t('Entrez votre code (4 à 6 chiffres).'), 'error'); return; }
    setBusy(true);
    try {
      const x = await rpc<Result>(fn, { p_restaurant_id: r.id, p_staff_id: staffId, p_pin: pin, ...args });
      if (!x.ok) { a.toast(t(PIN_ERR[x.error ?? ''] ?? 'Action refusée.'), 'error'); }
      else {
        if (x.customer) setCust(x.customer);
        attempt.current = null; setPin(''); setAmount('');
        a.toast(done(x));
        await loadRecent();
      }
    } catch (err) { a.toast(explain(err), 'error'); }
    setBusy(false);
  };

  const cents = toCents(amount);
  const pts = Math.floor(cents / 100 / perDh);
  const earn = () => cust === undefined ? a.toast(t('Cherchez d’abord le numéro du client.'), 'error') : act(`earn|${phone}|${cents}`, 'loyalty_counter_earn',
    { p_phone: cust?.phone ?? phone, p_amount_cents: cents, p_name: cust ? null : name.trim() || null, p_client_id: reqId(`earn|${phone}|${cents}`) },
    x => x.duplicate ? t('Déjà enregistré.') : t('+{n} points', { n: x.points_added ?? 0 }));
  const redeem = (rw: Reward) => cust && act(`redeem|${rw.id}`, 'loyalty_counter_redeem',
    { p_customer_id: cust.id, p_reward_id: rw.id, p_client_id: reqId(`redeem|${rw.id}`) }, x => t('À donner : {x}', { x: x.label ?? '' }));
  const useGift = (w: WalletItem) => act(`gift|${w.id}`, 'loyalty_wallet_use', { p_wallet_id: w.id }, x => t('Utilisé : {x}', { x: x.label ?? '' }));
  const undo = (en: Entry) => act(`undo|${en.id}`, 'loyalty_counter_undo', { p_ledger_id: en.id }, () => t('Opération annulée.'));

  const hm = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { timeZone: r.timezone, hour: '2-digit', minute: '2-digit' });
  const card = 'rounded-3xl bg-white p-4 shadow-card ring-1 ring-line/10';

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-black">{t('Comptoir fidélité')}</h1>
        <p className="text-sm text-muted">{t('Trouvez le client par son numéro, créditez ses points, offrez une récompense.')}</p>
      </div>

      <div className={card}>
        <p className="text-sm font-bold">{t('Qui valide ?')}</p>
        <div className="mt-2 grid grid-cols-[1fr_7rem] gap-2">
          <select className={inputCls} value={staffId} onChange={e => pickStaff(e.target.value)} aria-label={t('Personnel')}>
            <option value="">{t('Choisir…')}</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}{s.role === 'manager' ? ` (${t('responsable')})` : ''}</option>)}
          </select>
          <input className={inputCls} type="password" inputMode="numeric" autoComplete="off" maxLength={6} placeholder={t('Code')} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} aria-label={t('Code')} />
        </div>
        {!staff.length && <p className="mt-2 text-sm text-muted">{t('Aucun personnel : ajoutez des personnes avec leur code dans « Personnel ».')}</p>}
      </div>

      <form className={card} onSubmit={find}>
        <p className="text-sm font-bold">{t('Numéro du client')}</p>
        <div className="mt-2 flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Phone className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className={`${inputCls} ps-9`} inputMode="tel" autoComplete="off" placeholder="06 12 34 56 78" value={phone} onChange={e => { setPhone(e.target.value); setCust(undefined); }} />
          </div>
          <Btn tone="brand" type="submit" disabled={busy}><Search className="h-4 w-4" /> {t('Chercher')}</Btn>
        </div>
      </form>

      {cust === null && (
        <div className={card}>
          <p className="flex items-center gap-2 font-bold"><UserPlus className="h-5 w-5" /> {t('Nouveau client')}</p>
          <p className="mt-1 text-sm text-muted">{t('Ce numéro n’est pas encore dans le fichier. Il sera créé avec le premier crédit.')}</p>
          <input className={`${inputCls} mt-3`} placeholder={t('Prénom (facultatif)')} maxLength={60} value={name} onChange={e => setName(e.target.value)} />
        </div>
      )}

      {cust !== undefined && (
        <>
          {cust && (
            <div className={card}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-xl font-black">{cust.name || cust.phone}</p>
                  {cust.name && <p className="text-sm text-muted">{cust.phone}</p>}
                  <p className="mt-1 text-sm text-muted">{t('{n} visites', { n: cust.visits })}</p>
                </div>
                <div className="text-end"><p className="font-display text-4xl font-black text-brand">{cust.points}</p><p className="text-xs font-semibold text-muted">{t('points')}</p></div>
              </div>
              <button type="button" onClick={reset} className="mt-2 text-xs text-muted underline">{t('Autre client')}</button>
            </div>
          )}

          <div className={card}>
            <p className="text-sm font-bold">{t('Addition du client')}</p>
            <div className="mt-2 flex items-center gap-2">
              <input className={`${inputCls} text-lg font-bold`} inputMode="decimal" placeholder="0" value={amount} onChange={e => { setAmount(e.target.value.replace(/[^\d.,]/g, '')); }} aria-label={t('Montant en DH')} />
              <span className="font-semibold text-muted">DH</span>
            </div>
            <p className="mt-2 text-sm text-muted">{cents >= 100 ? (pts > 0 ? t('= {n} points (1 point par {d} DH)', { n: pts, d: perDh }) : t('Montant trop petit pour gagner un point.')) : t('1 point par {d} DH dépensés.', { d: perDh })}</p>
            <Btn tone="brand" className="mt-3 min-h-12 w-full !text-base" disabled={busy || pts < 1} onClick={() => void earn()}><Check className="h-5 w-5" /> {pts > 0 ? t('Créditer {n} points', { n: pts }) : t('Créditer')}</Btn>
          </div>

          {cust && cust.rewards.length > 0 && (
            <div className={card}>
              <p className="flex items-center gap-2 text-sm font-bold"><Gift className="h-4 w-4" /> {t('Récompenses')}</p>
              <ul className="mt-2 space-y-2">
                {cust.rewards.map(rw => (
                  <li key={rw.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                    <div className="min-w-0 flex-1"><p className="font-semibold">{rw.label || (rw.cents ? t('Remise {m}', { m: mad(rw.cents) }) : t('Récompense'))}</p><p className="text-sm text-muted">{t('{n} points', { n: rw.points })}</p></div>
                    <Btn tone={rw.affordable ? 'brand' : 'ghost'} disabled={busy || !rw.affordable} onClick={() => void redeem(rw)}>{t('Offrir')}</Btn>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {cust && cust.wallet.length > 0 && (
            <div className={card}>
              <p className="flex items-center gap-2 text-sm font-bold"><Wallet className="h-4 w-4" /> {t('Cadeaux à utiliser')}</p>
              <ul className="mt-2 space-y-2">
                {cust.wallet.map(w => (
                  <li key={w.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                    <div className="min-w-0 flex-1"><p className="font-semibold">{w.label}</p>{w.expires_at && <p className="text-sm text-muted">{t('Jusqu’au {d}', { d: new Date(w.expires_at).toLocaleDateString(dateLocale(), { timeZone: r.timezone }) })}</p>}</div>
                    <Btn tone="brand" disabled={busy} onClick={() => void useGift(w)}>{t('Donner')}</Btn>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className={card}>
        <p className="text-sm font-bold">{t('Dernières opérations')}</p>
        {!recent.length && <p className="mt-2 text-sm text-muted">{t('Rien pour le moment.')}</p>}
        <ul className="mt-2 divide-y divide-line/10">
          {recent.map(en => (
            <li key={en.id} className={`flex items-center gap-3 py-2.5 ${en.undone ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{en.customer}</p>
                <p className="text-xs text-muted">{hm(en.at)}{en.staff ? ` · ${en.staff}` : ''}{en.undone ? ` · ${t('annulé')}` : ''}</p>
              </div>
              <p className="text-sm font-bold">{en.reason === 'earn' ? t('+{n} pts', { n: en.points }) + (en.amount_cents ? ` · ${mad(en.amount_cents)}` : '') : en.reward ?? t('Récompense')}</p>
              {en.can_undo && <button type="button" onClick={() => void undo(en)} disabled={busy} title={t('Annuler (code d’un responsable)')} aria-label={t('Annuler')} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted hover:text-ink"><Undo2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">{t('Annuler demande le code d’un responsable, le jour même.')}</p>
      </div>
    </div>
  );
}
