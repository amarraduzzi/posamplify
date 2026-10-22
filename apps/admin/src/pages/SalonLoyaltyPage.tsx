// Fidélité et cadeaux: the salon's loyalty card (a stamp per paid visit, the reward at N), the packs
// it sells (N sessions of one prestation for a price, paid at once or in parts) and what has been
// sold: the clients' packs with the sessions left and what is still due, the gift cards with their
// balance. The till does the rest: it knows the client from her number.
import { useCallback, useEffect, useState } from 'react';
import { Gift, Heart, Layers, Pencil, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, rpc } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Loyalty, Restaurant } from '../lib/types';
import { Btn, Card, Field, Modal, Toggle, inputCls } from '../components/ui';
import { svcName, type AgService } from './AgendaServicesPage';

interface Pack { id: string; name: string; service_id: string; sessions: number; price_cents: number; valid_days: number; active: boolean }
interface Sold {
  packs: { id: string; name: string; client: string | null; phone: string | null; left: number; total: number; price_cents: number; paid_cents: number; expires_on: string }[];
  giftcards: { id: string; code: string; for: string | null; initial_cents: number; balance_cents: number; expires_on: string }[];
  outstanding_cents: number;
}
const mad = (c: number) => `${(Number(c) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DH`;
const num = (s: string) => { const n = Number(s.replace(',', '.').replace(/\s/g, '')); return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null; };
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

export function SalonLoyaltyPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [services, setServices] = useState<AgService[]>([]);
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [sold, setSold] = useState<Sold | null>(null);
  const [edit, setEdit] = useState<Pack | 'new' | null>(null);
  const [tab, setTab] = useState<'packs' | 'giftcards'>('packs');
  const load = useCallback(async () => {
    try {
      setPacks(check(await supabase.from('agenda_packs').select('*').eq('restaurant_id', r.id).order('sort_order').order('name')) as Pack[]);
      setSold(await rpc<Sold>('agenda_prepaid_list', { p_restaurant_id: r.id }));
    } catch (e) { a.fail(e); setPacks([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { supabase.from('agenda_services').select('*').eq('restaurant_id', r.id).eq('active', true).order('sort_order').then(x => setServices((x.data ?? []) as AgService[])); }, [r.id]);
  const svc = (id: string) => services.find(s => s.id === id);

  return (
    <div className="space-y-5">
      <h1 className="font-display text-3xl font-semibold">{t('Fidélité et cadeaux')}</h1>
      <p className="max-w-2xl text-sm text-muted">{t('La caisse reconnaît la cliente à son numéro : elle voit ses tampons, ses packs et ce qu’il reste à payer. Une carte cadeau se vend et se paie à la caisse avec son code.')}</p>

      <LoyaltyCard r={r} />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Layers className="h-5 w-5 text-brand" />
          <div className="me-auto"><h2 className="font-display text-xl font-semibold">{t('Packs')}</h2><p className="text-sm text-muted">{t('Plusieurs séances d’une prestation, à un prix. Payé d’un coup ou en plusieurs fois.')}</p></div>
          <Btn tone="brand" onClick={() => setEdit('new')} disabled={!services.length}><Plus className="h-4 w-4" /> {t('Nouveau pack')}</Btn>
        </div>
        {packs && !packs.length && <p className="rounded-2xl border border-dashed border-line/20 p-4 text-sm text-muted">{t('Exemple : 5 brushings pour 300 DH au lieu de 400 DH. La cliente revient, vous êtes payé d’avance.')}</p>}
        <div className="divide-y divide-line/10">
          {(packs ?? []).map(p => {
            const s = svc(p.service_id); const full = (s?.price_cents ?? 0) * p.sessions; const save = full - p.price_cents;
            return (
              <div key={p.id} className={`flex flex-wrap items-center gap-3 py-3 ${p.active ? '' : 'opacity-50'}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-sm text-muted">{t('{n} × {svc}', { n: p.sessions, svc: s ? svcName(s) : '?' })} · {t('{m} la séance', { m: mad(Math.floor(p.price_cents / p.sessions)) })}{save > 0 ? ` · ${t('économie {m}', { m: mad(save) })}` : ''} · {t('valable {n} jours', { n: p.valid_days })}</p>
                </div>
                <p className="font-display text-lg font-semibold tabular">{mad(p.price_cents)}</p>
                <Btn className="px-3" onClick={() => setEdit(p)} aria-label={t('Modifier')}><Pencil className="h-4 w-4" /></Btn>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="me-auto font-display text-xl font-semibold">{t('Vendus')}</h2>
          {sold && <p className="text-sm text-muted">{t('Encore dû aux clientes : {m}', { m: mad(sold.outstanding_cents) })}</p>}
        </div>
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm font-semibold">
          {([['packs', t('Packs des clientes')], ['giftcards', t('Cartes cadeaux')]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-lg px-3 py-2 ${tab === k ? 'bg-surface shadow-sm' : 'text-muted'}`}>{l}</button>
          ))}
        </div>
        {tab === 'packs' && (sold?.packs.length ? (
          <div className="divide-y divide-line/10">
            {sold.packs.map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1"><p className="font-semibold">{p.client || p.phone}</p><p className="text-sm text-muted">{p.name} · {t('jusqu’au {d}', { d: day(p.expires_on) })}</p></div>
                {p.price_cents > p.paid_cents && <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700">{t('reste à payer {m}', { m: mad(p.price_cents - p.paid_cents) })}</span>}
                <span className="font-semibold tabular">{t('{a}/{b} séances', { a: p.left, b: p.total })}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted">{t('Aucun pack vendu pour l’instant.')}</p>)}
        {tab === 'giftcards' && (sold?.giftcards.length ? (
          <div className="divide-y divide-line/10">
            {sold.giftcards.map(g => (
              <div key={g.id} className="flex flex-wrap items-center gap-3 py-3">
                <Gift className="h-4 w-4 text-brand" />
                <div className="min-w-0 flex-1"><p dir="ltr" className="font-semibold tracking-wider">{g.code}</p><p className="text-sm text-muted">{g.for ? `${t('Pour {name}', { name: g.for })} · ` : ''}{t('jusqu’au {d}', { d: day(g.expires_on) })}</p></div>
                <span className="font-semibold tabular">{mad(g.balance_cents)} <span className="text-sm font-normal text-muted">/ {mad(g.initial_cents)}</span></span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted">{t('Aucune carte cadeau vendue. Elle se vend à la caisse : « Carte cadeau » dans l’encaissement.')}</p>)}
      </Card>

      {edit && <PackModal r={r} pack={edit === 'new' ? null : edit} services={services} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function LoyaltyCard({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const l: Loyalty = { enabled: false, every: 10, type: 'amount', value: 0, name: '', ...(r.agenda?.loyalty ?? {}) };
  const [f, setF] = useState({ enabled: l.enabled, every: String(l.every), type: l.type, value: l.value ? String(l.value) : '', name: l.name });
  const [busy, setBusy] = useState(false);
  const every = Number(f.every); const value = num(f.value);
  const bad = f.enabled && (!Number.isInteger(every) || every < 2 || every > 50 || value == null || value <= 0 || (f.type === 'percent' && value > 100) || !f.name.trim());
  const save = async () => {
    setBusy(true);
    try {
      const agenda = { ...(r.agenda ?? {}), loyalty: { enabled: f.enabled, every: every || 10, type: f.type, value: value ?? 0, name: f.name.trim() } };
      check(await supabase.from('restaurants').update({ agenda }).eq('id', r.id).select('id'));
      a.toast(t('Enregistré')); await a.reload();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Heart className="h-5 w-5 text-brand" />
        <div className="me-auto"><h2 className="font-display text-xl font-semibold">{t('Carte de fidélité')}</h2><p className="text-sm text-muted">{t('Un tampon par visite payée. Au bout du compte, la caisse propose la récompense.')}</p></div>
        <Toggle checked={f.enabled} onChange={v => setF({ ...f, enabled: v })} label={t('Activée')} />
      </div>
      {f.enabled && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('Récompense après')} hint={t('visites payées')}><input className={inputCls} inputMode="numeric" value={f.every} onChange={e => setF({ ...f, every: e.target.value })} /></Field>
          <Field label={t('Type')}>
            <select className={inputCls} value={f.type} onChange={e => setF({ ...f, type: e.target.value as Loyalty['type'] })}>
              <option value="amount">{t('Montant offert (DH)')}</option><option value="percent">{t('Pourcentage (%)')}</option>
            </select>
          </Field>
          <Field label={f.type === 'percent' ? t('Pourcentage') : t('Montant (DH)')}><input className={inputCls} inputMode="decimal" value={f.value} onChange={e => setF({ ...f, value: e.target.value })} placeholder={f.type === 'percent' ? '20' : '80'} /></Field>
          <Field label={t('Nom de la récompense')}><input className={inputCls} maxLength={40} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={t('Brushing offert')} /></Field>
        </div>
        {!bad && <p className="rounded-xl bg-brand/5 px-3 py-2 text-sm">{t('À la visite n° {n}, la cliente reçoit : {name} ({v}).', { n: every + 1, name: f.name.trim(), v: f.type === 'percent' ? `-${value} %` : `-${mad((value ?? 0) * 100)}` })}</p>}
      </>}
      <div className="flex justify-end"><Btn tone="brand" disabled={busy || bad} onClick={save}>{t('Enregistrer')}</Btn></div>
    </Card>
  );
}

function PackModal({ r, pack, services, onClose, onSaved }: { r: Restaurant; pack: Pack | null; services: AgService[]; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [f, setF] = useState({ name: pack?.name ?? '', service_id: pack?.service_id ?? services[0]?.id ?? '', sessions: String(pack?.sessions ?? 5),
    price: pack ? String(pack.price_cents / 100) : '', valid: String(pack?.valid_days ?? 365), active: pack?.active ?? true });
  const [busy, setBusy] = useState(false);
  const s = services.find(x => x.id === f.service_id);
  const n = Number(f.sessions); const price = num(f.price); const valid = Number(f.valid);
  const bad = !f.name.trim() || !s || !Number.isInteger(n) || n < 2 || n > 100 || price == null || price < 1 || !Number.isInteger(valid) || valid < 7 || valid > 1095;
  const full = (s?.price_cents ?? 0) * (n || 0);
  const save = async () => {
    setBusy(true);
    try {
      const row = { name: f.name.trim(), service_id: f.service_id, sessions: n, price_cents: Math.round((price ?? 0) * 100), valid_days: valid, active: f.active };
      if (pack) check(await supabase.from('agenda_packs').update(row).eq('id', pack.id).select('id'));
      else check(await supabase.from('agenda_packs').insert({ ...row, restaurant_id: r.id }).select('id'));
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={pack ? t('Modifier le pack') : t('Nouveau pack')} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Btn onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy || bad} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-3">
        <Field label={t('Prestation')}>
          <select className={inputCls} value={f.service_id} onChange={e => setF({ ...f, service_id: e.target.value })}>
            {services.map(x => <option key={x.id} value={x.id}>{svcName(x)} · {mad(x.price_cents)}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Nombre de séances')}><input className={inputCls} inputMode="numeric" value={f.sessions} onChange={e => setF({ ...f, sessions: e.target.value, name: !pack && (!f.name || f.name === autoName(f.sessions, s)) ? autoName(e.target.value, s) : f.name })} /></Field>
          <Field label={t('Prix du pack (DH)')} hint={full ? t('Au détail : {m}', { m: mad(full) }) : undefined}><input className={inputCls} inputMode="decimal" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></Field>
        </div>
        <Field label={t('Nom')}><input className={inputCls} maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={autoName(f.sessions, s)} /></Field>
        <Field label={t('Valable (jours)')}><input className={inputCls} inputMode="numeric" value={f.valid} onChange={e => setF({ ...f, valid: e.target.value })} /></Field>
        {pack && <Toggle checked={f.active} onChange={v => setF({ ...f, active: v })} label={t('En vente')} />}
        {!bad && price != null && <p className="rounded-xl bg-brand/5 px-3 py-2 text-sm">{t('{m} la séance', { m: mad(Math.floor(price * 100 / n)) })}{full > price * 100 ? ` · ${t('la cliente économise {m}', { m: mad(full - price * 100) })}` : ''}</p>}
      </div>
    </Modal>
  );
}
const autoName = (n: string, s?: AgService) => (s ? `${n} × ${svcName(s)}` : '');
