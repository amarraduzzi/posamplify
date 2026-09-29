import { useRef, useState } from 'react';
import { Banknote, CreditCard, Split, Landmark, CheckCircle2, Printer, FileText } from 'lucide-react';
import { usePos, type PayResult } from '../store';
import { mad, toCents } from '../lib/format';
import { errorMessage } from '../lib/errors';
import type { Order } from '../lib/types';
import { Btn, Field, Modal, inputCls } from './ui';
import { PinPad } from './PinPad';
import { t } from '../lib/i18n';

type Mode = 'cash' | 'card' | 'mixed' | 'transfer';

export function PaymentModal({ orderId, label, onClose, onPaid }: { orderId: string; label: string; onClose: () => void; onPaid: () => void }) {
  const pos = usePos();
  // keep the last known version: once paid, the order leaves the open list
  // but this screen must still show the change to give back
  const live = pos.orders.find(o => o.id === orderId);
  const snap = useRef<Order | undefined>(live);
  if (live) snap.current = live;
  const order = snap.current;
  const total = Number(order?.total_cents ?? 0);
  const [mode, setMode] = useState<Mode>('cash');
  const [received, setReceived] = useState('');
  const [cashPart, setCashPart] = useState('');
  const [tip, setTip] = useState('');
  const [keepChange, setKeepChange] = useState(false);
  const [invoice, setInvoice] = useState(false);
  const [buyer, setBuyer] = useState({ name: '', ice: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ res: PayResult; change: number; total: number } | null>(null);

  const receivedC = received ? toCents(received) : total;
  const extra = Math.max(0, receivedC - total);
  const tipC = mode === 'cash' ? (keepChange ? extra : 0) : toCents(tip);
  const change = mode === 'cash' ? (keepChange ? 0 : extra) : 0;
  const cashC = Math.min(total, toCents(cashPart));
  const cardC = total - cashC;

  const quick = [total, ...[50, 100, 200, 500].map(x => x * 100).filter(x => x > total)].slice(0, 4);
  const ok = mode === 'cash' ? receivedC >= total : mode === 'mixed' ? cashC > 0 && cardC > 0 : true;
  const buyerOk = !invoice || (/^\d{15}$/.test(buyer.ice) && buyer.name.trim());

  const confirm = async () => {
    if (!order) return;
    setBusy(true); setError(null);
    const payments = mode === 'mixed'
      ? [{ method: 'cash', amount_cents: cashC, tip_cents: 0 }, { method: 'card', amount_cents: cardC, tip_cents: tipC }]
      : [{ method: mode, amount_cents: total, tip_cents: tipC }];
    try {
      const res = await pos.pay(order, payments, invoice ? { name: buyer.name.trim(), ice: buyer.ice } : null, change);
      if (res) setDone({ res, change, total });
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };

  if (done) { const doc = 'doc' in done.res ? done.res.doc : null; return (
    <Modal title={t('Encaissé')} onClose={onPaid}
      footer={<div className="flex justify-between gap-2">
        {doc ? <Btn onClick={() => pos.reprintDoc(doc, label)}><Printer className="h-4 w-4" /> {t('Réimprimer')}</Btn> : <span />}
        <Btn tone="brand" onClick={onPaid}>{t('Terminé')}</Btn>
      </div>}>
      <div className="py-4 text-center">
        <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-ok/15 pop"><CheckCircle2 className="h-12 w-12 text-ok" /></span>
        <p className="mt-3 text-lg font-bold">{doc ? doc.doc_number : t('Reçu provisoire')}</p>
        <p className="text-muted">{label} · {mad(doc ? doc.total_ttc_cents : done.total)}</p>
        {!doc && <p className="mx-auto mt-3 max-w-xs rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">{t('Hors ligne : le ticket fiscal sera émis automatiquement au retour de la connexion (voir Historique).')}</p>}
        {done.change > 0 && <p className="mt-8 text-xs font-bold uppercase tracking-[0.25em] text-muted">{t('À rendre')}</p>}
        {done.change > 0 && <p className="font-display text-6xl font-semibold text-brand tabular">{mad(done.change)}</p>}
      </div>
    </Modal>
  ); }

  if (!order) return <Modal title={t('Encaisser')} onClose={onClose}><p className="text-muted">{t('Chargement…')}</p></Modal>;

  const modes: { id: Mode; label: string; Icon: typeof Banknote }[] = [
    { id: 'cash', label: t('Espèces'), Icon: Banknote }, { id: 'card', label: t('Carte'), Icon: CreditCard },
    { id: 'mixed', label: t('Mixte'), Icon: Split }, { id: 'transfer', label: t('Virement'), Icon: Landmark },
  ];

  return (
    <Modal title={`${t('Encaisser')} · ${label}`} onClose={onClose} wide
      footer={<div className="flex items-center justify-between gap-3">
        {error ? <p className="text-sm font-semibold text-danger">{error}</p> : <span className="text-sm text-muted">{t('Ticket fiscal émis à la validation.')}</span>}
        <Btn tone="ok" className="px-8 py-3.5 text-lg" disabled={busy || !ok || !buyerOk} onClick={confirm}>
          {busy ? t('Encaissement…') : t('Valider {m}', { m: mad(total + tipC) })}
        </Btn>
      </div>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-3xl border border-brand/25 bg-bg p-5 text-center">
            <div className="zellige absolute inset-0 opacity-[0.06]" aria-hidden />
            <p className="relative text-xs font-bold uppercase tracking-[0.25em] text-muted">{t('Total à payer')}</p>
            <p className="relative mt-1 font-display text-5xl font-semibold text-brand tabular">{mad(total)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {modes.map(m => (
              <button key={m.id} onClick={() => setMode(m.id)}
                className={`flex items-center justify-center gap-2 rounded-2xl py-3.5 font-bold transition ${mode === m.id ? 'gold-fill text-brand-ink' : 'border border-line/[0.06] bg-surface-2 hover:bg-surface-3'}`}>
                <m.Icon className="h-5 w-5" />{m.label}
              </button>
            ))}
          </div>
          {mode === 'cash' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                {quick.map(q => <button key={q} onClick={() => setReceived(String(q / 100))} className="flex-1 rounded-xl border border-line/[0.06] bg-surface-2 py-2.5 text-sm font-bold tabular hover:bg-surface-3">{q === total ? t('Exact') : mad(q)}</button>)}
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-bg px-4 py-3">
                <span className="text-muted">{keepChange ? t('Pourboire') : t('À rendre')}</span>
                <span className="font-display text-3xl font-semibold text-brand tabular">{mad(extra)}</span>
              </div>
              {extra > 0 && (
                <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={keepChange} onChange={e => setKeepChange(e.target.checked)} className="h-5 w-5" /> {t('Le client laisse la monnaie en pourboire')}</label>
              )}
            </div>
          )}
          {mode === 'mixed' && (
            <p className="rounded-xl bg-bg px-4 py-3 text-sm">{t('Espèces')} <b className="tabular">{mad(cashC)}</b> + {t('Carte')} <b className="tabular">{mad(cardC)}</b></p>
          )}
          {(mode === 'card' || mode === 'mixed') && (
            <Field label={t('Pourboire sur la carte (MAD)')}><input className={inputCls} inputMode="decimal" value={tip} onChange={e => setTip(e.target.value)} placeholder="0" /></Field>
          )}
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={invoice} onChange={e => setInvoice(e.target.checked)} className="h-5 w-5" /><FileText className="h-4 w-4" /> {t('Facture avec ICE (client professionnel)')}</label>
          {invoice && (
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder={t('Raison sociale')} value={buyer.name} onChange={e => setBuyer({ ...buyer, name: e.target.value })} />
              <input className={inputCls} placeholder={t('ICE (15 chiffres)')} inputMode="numeric" value={buyer.ice} onChange={e => setBuyer({ ...buyer, ice: e.target.value.replace(/\D/g, '').slice(0, 15) })} />
            </div>
          )}
        </div>
        <div>
          {mode === 'cash' && <><p className="mb-2 text-center text-sm font-semibold text-muted">{t('Montant reçu')}</p><PinPad masked={false} allowDecimal maxLen={8} value={received} onChange={setReceived} onSubmit={() => ok && buyerOk && confirm()} /></>}
          {mode === 'mixed' && <><p className="mb-2 text-center text-sm font-semibold text-muted">{t('Part en espèces')}</p><PinPad masked={false} allowDecimal maxLen={8} value={cashPart} onChange={setCashPart} onSubmit={() => ok && buyerOk && confirm()} /></>}
          {(mode === 'card' || mode === 'transfer') && <p className="py-16 text-center text-muted">{mode === 'card' ? t('Passez la carte sur le terminal, puis validez.') : t('Vérifiez la réception du virement, puis validez.')}</p>}
        </div>
      </div>
    </Modal>
  );
}
