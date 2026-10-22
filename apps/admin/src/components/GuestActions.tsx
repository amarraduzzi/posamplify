import { useEffect, useState } from 'react';
import { Plus, Trash2, Gift, Ticket } from 'lucide-react';
import type { GuestAction } from '@resto/shared';
import { supabase } from '../lib/supabase';
import { Btn, Field, Toggle, inputCls } from './ui';
import { t } from '../lib/i18n';

const DAYS: [number, string][] = [[1, 'Lun'], [2, 'Mar'], [3, 'Mer'], [4, 'Jeu'], [5, 'Ven'], [6, 'Sam'], [7, 'Dim']];
const newId = () => Math.random().toString(36).slice(2, 10);

/** Ready-made actions: the owner switches one on and adjusts it. */
const PRESETS: { label: string; make: () => GuestAction }[] = [
  { label: '-10 % prochaine visite', make: () => ({ id: newId(), on: true, name: '-10 % sur votre prochaine commande', when: 'next', type: 'percent', value: 10, min: 0, valid_days: 30, delay: 'next_day', max_per_week: 30 }) },
  { label: 'Montant offert prochaine visite', make: () => ({ id: newId(), on: true, name: '20 DH offerts sur votre prochaine commande', when: 'next', type: 'amount', value: 20, min: 80, valid_days: 30, delay: 'next_day', max_per_week: 30 }) },
  { label: 'Cadeau tout de suite', make: () => ({ id: newId(), on: true, name: 'Un café offert', when: 'table', type: 'gift' }) },
];

/** The same, for a hair salon: a gift at the reception, a code for the next visit. */
const SALON_PRESETS: { label: string; make: () => GuestAction }[] = [
  { label: '-10 % prochaine visite', make: () => ({ id: newId(), on: true, name: '-10 % sur votre prochaine visite', when: 'next', type: 'percent', value: 10, min: 0, valid_days: 45, delay: 'next_day', max_per_week: 20 }) },
  { label: 'Soin offert prochaine visite', make: () => ({ id: newId(), on: true, name: 'Un soin offert à votre prochaine visite', when: 'next', type: 'gift', valid_days: 45, delay: 'next_day', max_per_week: 10 }) },
  { label: 'Cadeau tout de suite', make: () => ({ id: newId(), on: true, name: 'Un échantillon offert', when: 'table', type: 'gift' }) },
];

/** What the guest will read, so the owner sees the result of the settings. */
function summary(a: GuestAction, cur: string, salon?: boolean): string {
  if (salon) {
    if (a.when === 'table') return t('La cliente montre sa story à l’accueil, qui lui remet : {x}.', { x: a.name || '…' });
    const what = a.type === 'gift' ? (a.name || '…') : a.type === 'percent' ? `${a.value ?? 0} %` : `${a.value ?? 0} ${cur}`;
    return t('La cliente reçoit un code personnel pour sa prochaine visite : {v}, {from}, pendant {d} jours. À taper à la caisse.', { v: what, from: a.delay === 'now' ? t('dès maintenant') : t('dès demain'), d: a.valid_days ?? 30 });
  }
  if (a.when === 'table') return t('Le client montre sa story au serveur, qui lui remet : {x}.', { x: a.name || '…' });
  const v = a.type === 'percent' ? `${a.value ?? 0} %` : `${a.value ?? 0} ${cur}`;
  const from = a.delay === 'now' ? t('dès maintenant') : t('dès demain');
  const min = a.min ? t(', à partir de {m} {c} d’achat', { m: a.min, c: cur }) : '';
  return t('Le client reçoit un code personnel : {v} sur sa prochaine commande, {from}, pendant {d} jours{min}.', { v, from, d: a.valid_days ?? 30, min });
}

interface Stats { issued: number; used: number; given_cents: number; revenue_cents: number }

export function GuestActions({ restaurantId, actions, onChange, currency, salon }: {
  restaurantId: string; actions: GuestAction[]; onChange: (a: GuestAction[]) => void; currency: string; salon?: boolean;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    supabase.rpc(salon ? 'agenda_voucher_stats' : 'guest_voucher_stats', { p_restaurant_id: restaurantId, p_days: 30 }).then(({ data, error }) => { if (!error && data) setStats(data as Stats); });
  }, [restaurantId, salon]);

  const patch = (id: string, p: Partial<GuestAction>) => onChange(actions.map(a => (a.id === id ? { ...a, ...p } : a)));
  const money = (c: number) => `${Math.round(c / 100)} ${currency}`;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-surface-2 p-4 text-sm">
        {actions.length === 0
          ? t('Aucune récompense : vos clients partagent leur story sans rien recevoir. C’est très bien aussi, vous gagnez de la publicité gratuite.')
          : t('Le client choisit parmi les actions activées ci-dessous. Pour ne rien offrir, désactivez-les ou supprimez-les.')}
      </div>

      {actions.map(a => {
        const cur = currency;
        return (
          <div key={a.id} className={`space-y-4 rounded-2xl border border-line/10 p-4 ${a.on ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-center gap-3">
              {a.when === 'next' ? <Ticket className="h-5 w-5 text-brand" /> : <Gift className="h-5 w-5 text-brand" />}
              <Toggle checked={a.on} onChange={v => patch(a.id, { on: v })} label={a.on ? t('Active') : t('Désactivée')} />
              <button type="button" aria-label={t('Supprimer')} onClick={() => onChange(actions.filter(x => x.id !== a.id))} className="ms-auto rounded-lg p-2 text-muted hover:bg-surface-2"><Trash2 className="h-4 w-4" /></button>
            </div>

            <Field label={t('Ce que le client lit')}>
              <input className={inputCls} maxLength={60} value={a.name} onChange={e => patch(a.id, { name: e.target.value })} />
            </Field>

            <Field group label={t('Quand')}>
              <div className="flex gap-2">
                {([['table', salon ? t('Tout de suite, à l’accueil') : t('Tout de suite, à table')], ['next', t('Code pour la prochaine visite')]] as const).map(([w, label]) => (
                  <button key={w} type="button" onClick={() => patch(a.id, w === 'table' ? { when: 'table', type: 'gift' } : { when: 'next', type: a.type === 'gift' ? 'percent' : a.type, value: a.value ?? 10, valid_days: a.valid_days ?? 30, delay: a.delay ?? 'next_day' })}
                    className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold ${a.when === w ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{label}</button>
                ))}
              </div>
            </Field>

            {a.when === 'next' && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field group label={t('Type')}>
                    <div className="flex gap-2">
                      {([['percent', '%'], ['amount', cur], ...(salon ? [['gift', t('Cadeau')]] as const : [])] as const).map(([k, l]) => (
                        <button key={k} type="button" onClick={() => patch(a.id, { type: k })} className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold ${a.type === k ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{l}</button>
                      ))}
                    </div>
                  </Field>
                  {a.type === 'gift' ? <Field label={t('Le cadeau')}><input className={inputCls} maxLength={60} value={a.name} onChange={e => patch(a.id, { name: e.target.value })} /></Field> :
                  <Field label={a.type === 'percent' ? t('Pourcentage') : t('Montant ({c})', { c: cur })}>
                    <input dir="ltr" type="number" min={1} max={a.type === 'percent' ? 100 : undefined} className={inputCls} value={a.value ?? ''} onChange={e => patch(a.id, { value: Number(e.target.value) || undefined })} />
                  </Field>}
                  <Field label={salon ? t('Minimum de prestations ({c})', { c: cur }) : t('Commande minimum ({c})', { c: cur })} hint={t('0 = aucun minimum')}>
                    <input dir="ltr" type="number" min={0} className={inputCls} value={a.min ?? 0} onChange={e => patch(a.id, { min: Math.max(0, Number(e.target.value) || 0) })} />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={t('Valable pendant (jours)')}>
                    <input dir="ltr" type="number" min={1} max={365} className={inputCls} value={a.valid_days ?? 30} onChange={e => patch(a.id, { valid_days: Math.max(1, Math.min(365, Number(e.target.value) || 30)) })} />
                  </Field>
                  <Field label={t('Début')}>
                    <select className={inputCls} value={a.delay ?? 'next_day'} onChange={e => patch(a.id, { delay: e.target.value as 'now' | 'next_day' })}>
                      <option value="next_day">{t('Dès le lendemain (recommandé)')}</option>
                      <option value="now">{t('Tout de suite')}</option>
                    </select>
                  </Field>
                  <Field label={t('Maximum par semaine')} hint={t('Vide = sans limite. Limite votre budget.')}>
                    <input dir="ltr" type="number" min={1} className={inputCls} value={a.max_per_week ?? ''} onChange={e => patch(a.id, { max_per_week: Number(e.target.value) || undefined })} />
                  </Field>
                </div>
                <Field group label={t('Jours où le code fonctionne')} hint={t('Aucun jour coché = tous les jours. Idéal pour remplir les jours calmes.')}>
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map(([n, l]) => {
                      const on = (a.days ?? []).includes(n);
                      return <button key={n} type="button" onClick={() => patch(a.id, { days: on ? (a.days ?? []).filter(x => x !== n) : [...(a.days ?? []), n].sort() })}
                        className={`rounded-full px-3 py-1.5 text-sm font-semibold ${on ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{t(l)}</button>;
                    })}
                  </div>
                </Field>
                {!salon && <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('De (heure)')} hint={t('Vide = toute la journée')}><input dir="ltr" type="time" className={inputCls} value={a.from ?? ''} onChange={e => patch(a.id, { from: e.target.value || undefined })} /></Field>
                  <Field label={t('À (heure)')}><input dir="ltr" type="time" className={inputCls} value={a.to ?? ''} onChange={e => patch(a.id, { to: e.target.value || undefined })} /></Field>
                </div>}
                {!salon && <Toggle checked={!!a.in_store_only} onChange={v => patch(a.id, { in_store_only: v })} label={t('Seulement au restaurant (pas en commande en ligne)')} />}
              </>
            )}
            <p className="rounded-xl bg-brand/10 p-3 text-sm">{summary(a, cur, salon)}</p>
          </div>
        );
      })}

      <div>
        <p className="mb-2 text-sm font-semibold">{t('Ajouter une action')}</p>
        <div className="flex flex-wrap gap-2">
          {(salon ? SALON_PRESETS : PRESETS).map(p => <Btn key={p.label} onClick={() => onChange([...actions, p.make()])}><Plus className="h-4 w-4" /> {t(p.label)}</Btn>)}
        </div>
      </div>

      {stats && stats.issued > 0 && (
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-surface-2 p-4 text-center sm:grid-cols-4">
          <div><p className="font-display text-2xl font-semibold">{stats.issued}</p><p className="text-xs text-muted">{t('codes émis (30 jours)')}</p></div>
          <div><p className="font-display text-2xl font-semibold">{stats.used}</p><p className="text-xs text-muted">{t('codes utilisés')}</p></div>
          <div><p className="font-display text-2xl font-semibold">{money(stats.revenue_cents)}</p><p className="text-xs text-muted">{salon ? t('chiffre de ces visites') : t('ventes de ces commandes')}</p></div>
          <div><p className="font-display text-2xl font-semibold">{money(stats.given_cents)}</p><p className="text-xs text-muted">{t('remises accordées')}</p></div>
        </div>
      )}
    </div>
  );
}
