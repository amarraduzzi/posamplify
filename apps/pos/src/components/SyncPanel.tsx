import { CheckCircle2, CloudOff, RefreshCw, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { usePos } from '../store';
import { describe } from '../lib/outbox';
import { time } from '../lib/format';
import { Btn, Modal } from './ui';
import { t } from '../lib/i18n';

/** What this till still has to send, and what the server refused. */
export function SyncPanel({ onClose }: { onClose: () => void }) {
  const pos = usePos();
  const tz = pos.restaurant!.timezone;
  const labelOf = (orderId: string) => {
    const o = pos.orders.find(x => x.id === orderId);
    return o ? pos.labelOf(o) : t('commande');
  };
  const waiting = pos.queue.filter(q => q.state !== 'done');
  return (
    <Modal title={t('Synchronisation')} onClose={onClose}
      footer={<div className="flex justify-between gap-2">
        <Btn onClick={() => { void pos.reloadOrders(); pos.retryFailed(); }}><RefreshCw className="h-4 w-4" /> {t('Réessayer maintenant')}</Btn>
        <Btn tone="brand" onClick={onClose}>{t('Fermer')}</Btn>
      </div>}>
      <div className={`mb-4 flex items-center gap-3 rounded-2xl px-4 py-3 ${pos.online ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'}`}>
        {pos.online ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <CloudOff className="h-5 w-5 shrink-0" />}
        <p className="text-sm font-semibold">{pos.online
          ? (waiting.length ? t('Connecté : envoi en cours.') : t('Connecté : tout est envoyé.'))
          : t('Hors ligne : tout est gardé sur ce poste et part automatiquement au retour de la connexion. Ne videz pas le navigateur.')}</p>
      </div>
      {!waiting.length ? <p className="py-6 text-center text-muted">{t('Rien en attente.')}</p> : (
        <ul className="space-y-2">
          {waiting.map(q => (
            <li key={q.seq} className={`flex items-start gap-3 rounded-2xl border px-3 py-2.5 ${q.state === 'failed' ? 'border-danger/40 bg-danger/5' : 'border-line/[0.08]'}`}>
              {q.state === 'failed' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> : <Loader2 className={`mt-0.5 h-4 w-4 shrink-0 text-muted ${pos.online ? 'animate-spin' : ''}`} />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{describe(q.op, labelOf)}</p>
                <p className="text-xs text-muted">{time(q.created_at, tz)}</p>
                {q.error && <p className="mt-1 text-xs text-danger">{q.error}{q.op.kind === 'pay' && ` · ${t('Le client a déjà payé : encaissez à nouveau cette commande pour émettre le ticket.')}`}</p>}
              </div>
              {q.state === 'failed' && <>
                <button onClick={() => pos.retryFailed(q.seq)} aria-label={t('Réessayer')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"><RefreshCw className="h-4 w-4" /></button>
                <button onClick={() => pos.dismissFailed(q.seq)} aria-label={t('Ignorer')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger/15 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
