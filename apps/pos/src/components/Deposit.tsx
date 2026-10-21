import { useEffect, useState } from 'react';
import { Banknote, CreditCard, Landmark, MessageCircle, RotateCcw, ShieldCheck, Lock } from 'lucide-react';
import { usePos } from '../store';
import * as db from '../lib/data';
import { supabase } from '../lib/supabase';
import { check } from '../lib/data';
import { mad, toCents } from '../lib/format';
import { PIN_ERRORS, errorMessage } from '../lib/errors';
import { t } from '../lib/i18n';
import { Btn, Field, Modal, inputCls } from './ui';
import { ManagerApproval } from './StaffGate';
import type { Reservation } from './Reservations';

// The deposit (acompte) of a booking at the host stand: what was asked, received, used at the
// bill, given back or kept. Received here (cash, card, transfer), the booking is confirmed.

type Method = 'cash' | 'card' | 'transfer';
interface Move { id: number; kind: 'in' | 'used' | 'refund' | 'kept'; amount_cents: number | string; method: Method | null; ref: string | null; created_at: string }

/** The amount the restaurant's rule asks for this many guests (0: none). */
export function depositRule(booking: { deposit_party?: number; deposit_cents?: number } | undefined, party: number) {
  const from = Number(booking?.deposit_party ?? 0), per = Number(booking?.deposit_cents ?? 0);
  return from > 0 && per > 0 && party >= from ? party * per : 0;
}

/** the chip on a booking: what is going on with its deposit */
export function DepositChip({ x }: { x: Pick<Reservation, 'deposit_cents' | 'deposit_state'> }) {
  if (!x.deposit_state) return null;
  const m = mad(Number(x.deposit_cents ?? 0));
  const [label, cls] = {
    due: [t('Acompte {m} à recevoir', { m }), 'bg-warn/15 text-warn'],
    paid: [t('Acompte {m} reçu', { m }), 'bg-ok/15 text-ok'],
    used: [t('Acompte utilisé'), 'bg-surface-2 text-muted'],
    refunded: [t('Acompte rendu'), 'bg-surface-2 text-muted'],
    kept: [t('Acompte conservé'), 'bg-surface-2 text-muted'],
  }[x.deposit_state];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}><ShieldCheck className="h-3 w-3" />{label}</span>;
}

const METHODS: { id: Method; label: () => string; Icon: typeof Banknote }[] = [
  { id: 'cash', label: () => t('Espèces'), Icon: Banknote },
  { id: 'card', label: () => t('Carte'), Icon: CreditCard },
  { id: 'transfer', label: () => t('Virement'), Icon: Landmark },
];

export function DepositDialog({ x, onClose, onDone, onAsk }: { x: Reservation; onClose: () => void; onDone: () => void; onAsk?: () => void }) {
  const pos = usePos();
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [method, setMethod] = useState<Method>('cash');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [close, setClose] = useState<null | 'refund' | 'kept'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('reservation_deposits').select('*').eq('reservation_id', x.id).order('created_at')
      .then(r => { try { setMoves(check(r) as Move[]); } catch (e) { pos.fail(e); setMoves([]); } });
  }, [x.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sum = (k: Move['kind']) => (moves ?? []).filter(m => m.kind === k).reduce((s, m) => s + Number(m.amount_cents), 0);
  const asked = Number(x.deposit_cents ?? 0), got = sum('in'), used = sum('used'), back = sum('refund'), kept = sum('kept');
  const left = got - used - back - kept;
  const toGet = Math.max(0, asked - got);
  const open = !['cancelled', 'no_show'].includes(x.status);
  useEffect(() => { if (moves && !amount && toGet > 0) setAmount(String(toGet / 100)); }, [moves]); // eslint-disable-line react-hooks/exhaustive-deps

  const receive = async () => {
    if (!pos.requireOnline()) return;
    const c = toCents(amount);
    if (!(c > 0)) return;
    setBusy(true); setError(null);
    try {
      await db.rpc('pos_deposit_receive', { p_reservation_id: x.id, p_amount_cents: c, p_method: method, p_ref: ref.trim() || null, p_staff_id: pos.staff?.id ?? null });
      pos.toast(t('Acompte de {m} reçu', { m: mad(c) }), 'ok');
      onDone();
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };
  const finish = async (managerId: string, pin: string) => {
    if (!pos.requireOnline() || !close) return;
    setBusy(true); setError(null);
    try {
      const res = await db.rpc<{ ok: boolean; error?: string; amount_cents?: number }>('pos_deposit_close', {
        p_reservation_id: x.id, p_action: close, p_method: close === 'refund' ? method : null, p_staff_id: managerId, p_pin: pin });
      if (!res.ok) setError(PIN_ERRORS[res.error ?? 'invalid'] ?? t('Code incorrect.'));
      else {
        pos.toast(close === 'refund' ? t('Acompte de {m} rendu', { m: mad(Number(res.amount_cents)) }) : t('Acompte de {m} conservé', { m: mad(Number(res.amount_cents)) }), 'ok');
        onDone();
      }
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };

  return (
    <Modal title={t('Acompte · {n}', { n: x.name })} onClose={onClose}>
      {!moves ? <p className="text-muted">{t('Chargement…')}</p> : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <Row k={t('Demandé')} v={mad(asked)} />
            <Row k={t('Reçu')} v={mad(got)} strong={got > 0} />
            {used > 0 && <Row k={t('Utilisé sur l’addition')} v={mad(used)} />}
            {back > 0 && <Row k={t('Rendu')} v={mad(back)} />}
            {kept > 0 && <Row k={t('Conservé')} v={mad(kept)} />}
            <Row k={t('Disponible')} v={mad(Math.max(0, left))} strong />
          </dl>
          {moves.filter(m => m.kind === 'in').map(m => (
            <p key={m.id} className="text-xs text-muted">{new Date(m.created_at).toLocaleString('fr-FR', { timeZone: pos.restaurant?.timezone, dateStyle: 'short', timeStyle: 'short' })} · {METHODS.find(z => z.id === m.method)?.label()} · {mad(Number(m.amount_cents))}{m.ref ? ` · ${m.ref}` : ''}</p>
          ))}

          {close ? (
            <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
              <p className="font-semibold">{close === 'refund' ? t('Rendre {m} au client', { m: mad(left) }) : t('Conserver {m} (pas venu ou annulation tardive)', { m: mad(left) })}</p>
              {close === 'refund' && <MethodPick v={method} set={setMethod} />}
              <ManagerApproval onApprove={finish} busy={busy} error={error} />
              <button onClick={() => { setClose(null); setError(null); }} className="text-sm font-semibold text-muted">{t('Retour')}</button>
            </div>
          ) : <>
            {open && (x.deposit_state === 'due' || x.deposit_state === 'paid') && (
              <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
                <p className="font-semibold">{t('Recevoir l’acompte')}</p>
                <MethodPick v={method} set={setMethod} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('Montant (MAD)')}><input className={inputCls} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
                  <Field label={t('Référence (facultatif)')}><input className={inputCls} maxLength={64} value={ref} onChange={e => setRef(e.target.value)} placeholder={method === 'transfer' ? t('N° du virement') : ''} /></Field>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {onAsk && x.phone && toGet > 0 && <Btn onClick={onAsk}><MessageCircle className="h-4 w-4" /> {t('Demander sur WhatsApp')}</Btn>}
                  <Btn tone="brand" disabled={busy || !(toCents(amount) > 0)} onClick={receive}>{t('Encaisser {m}', { m: amount ? mad(toCents(amount)) : '' })}</Btn>
                </div>
                {error && <p className="text-sm font-semibold text-danger">{error}</p>}
              </div>
            )}
            {left > 0 && (
              <div className="flex flex-wrap gap-2">
                <Btn onClick={() => setClose('refund')}><RotateCcw className="h-4 w-4" /> {t('Rendre l’acompte')}</Btn>
                {!open && <Btn onClick={() => setClose('kept')}><Lock className="h-4 w-4" /> {t('Conserver l’acompte')}</Btn>}
              </div>
            )}
            {left > 0 && open && <p className="text-xs text-muted">{t('Le soir même, l’acompte se déduit de l’addition à l’encaissement.')}</p>}
          </>}
        </div>
      )}
    </Modal>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className="rounded-xl bg-surface-2 px-3 py-2"><dt className="text-xs text-muted">{k}</dt><dd className={`tabular ${strong ? 'font-display text-lg font-semibold' : 'font-semibold'}`}>{v}</dd></div>;
}
function MethodPick({ v, set }: { v: Method; set: (m: Method) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {METHODS.map(m => (
        <button key={m.id} onClick={() => set(m.id)} className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold ${v === m.id ? 'gold-fill text-brand-ink' : 'bg-surface text-muted'}`}>
          <m.Icon className="h-4 w-4" />{m.label()}
        </button>
      ))}
    </div>
  );
}
