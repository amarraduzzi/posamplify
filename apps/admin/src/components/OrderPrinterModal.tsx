// Setting up the ticket printer for the QR orders, on this PC: is printhost running, which printer, automatic or not, test.
import { useCallback, useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { t } from '../lib/i18n';
import { Btn, Field, Modal, inputCls } from './ui';
import { listPrinters, pingPrinter, sendPrint, setPrintCfg, type PrintCfg } from '../lib/orderPrint';

export function OrderPrinterModal({ rid, name, cfg, onClose, onSaved }: { rid: string; name: string; cfg: PrintCfg; onClose: () => void; onSaved: (c: PrintCfg) => void }) {
  const [state, setState] = useState<'checking' | 'missing' | 'ok'>('checking');
  const [printers, setPrinters] = useState<{ name: string; default: boolean }[] | null>(null);
  const [printer, setPrinter] = useState(cfg.name);
  const [auto, setAuto] = useState(cfg.auto || !cfg.name);
  const [msg, setMsg] = useState('');

  const check = useCallback(async () => {
    setState('checking'); setMsg('');
    if (!(await pingPrinter())) { setState('missing'); return; }
    const l = await listPrinters();
    setPrinters(l);
    if (l && !printer) setPrinter((l.find(p => p.default) ?? l[0])?.name ?? '');
    setState('ok');
  }, [printer]);
  useEffect(() => { void check(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const test = async () => {
    setMsg('');
    try { await sendPrint(printer, 'Test', [{ text: name.toUpperCase(), bold: true, large: true, center: true }, { text: t('Test d’impression'), center: true }, { text: 'OK', bold: true, large: true, center: true }]); setMsg(t('Ticket de test envoyé.')); }
    catch { setMsg(t('Impression impossible : vérifiez que l’imprimante est allumée et que son nom est correct.')); }
  };
  const save = () => { const c = { name: printer.trim(), auto: auto && !!printer.trim() }; setPrintCfg(rid, c); onSaved(c); onClose(); };
  const off = () => { const c = { name: '', auto: false }; setPrintCfg(rid, c); onSaved(c); onClose(); };

  return (
    <Modal title={<span className="flex items-center gap-2"><Printer className="h-5 w-5" /> {t('Imprimante de commandes')}</span>} onClose={onClose}
      footer={<>
        {cfg.name && <Btn tone="ghost" onClick={off}>{t('Désactiver')}</Btn>}
        <Btn onClick={onClose}>{t('Annuler')}</Btn>
        <Btn tone="brand" disabled={state !== 'ok' || !printer.trim()} onClick={save}>{t('Enregistrer')}</Btn>
      </>}>
      <div className="space-y-4 text-sm">
        {state === 'checking' && <p className="text-muted">{t('Vérification…')}</p>}
        {state === 'missing' && (
          <div className="space-y-3">
            <p className="font-semibold">{t('Le programme d’impression ne tourne pas sur ce PC.')}</p>
            <ol className="list-decimal space-y-1 ps-5 text-muted">
              <li>{t('Branchez l’imprimante de tickets sur ce PC Windows et installez-la.')}</li>
              <li>{t('Téléchargez le programme et lancez-le une fois (laissez-le ouvert).')}</li>
              <li>{t('Revenez ici et touchez « Vérifier à nouveau ».')}</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <a href="/printhost.exe" download className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 font-semibold text-brand-ink"><Download className="h-4 w-4" /> {t('Télécharger le programme')}</a>
              <Btn tone="ghost" onClick={() => void check()}>{t('Vérifier à nouveau')}</Btn>
            </div>
          </div>
        )}
        {state === 'ok' && (
          <>
            <p className="rounded-xl bg-ok/10 px-3 py-2 font-semibold text-ok">{t('Le programme d’impression fonctionne sur ce PC.')}</p>
            <Field label={t('Imprimante')} hint={printers ? undefined : t('Écrivez le nom exact de l’imprimante dans Windows.')}>
              {printers
                ? <select className={inputCls} value={printer} onChange={e => setPrinter(e.target.value)}>{printers.map(p => <option key={p.name} value={p.name}>{p.name}{p.default ? ` (${t('par défaut')})` : ''}</option>)}</select>
                : <input className={inputCls} value={printer} onChange={e => setPrinter(e.target.value)} />}
            </Field>
            <label className="flex items-start gap-3 rounded-xl bg-surface-2 p-3">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={auto} onChange={e => setAuto(e.target.checked)} />
              <span><span className="font-semibold">{t('Imprimer automatiquement')}</span><span className="block text-muted">{t('Dès que vous acceptez une commande, le ticket sort. Cette page doit rester ouverte sur ce PC.')}</span></span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Btn tone="ghost" disabled={!printer.trim()} onClick={() => void test()}><Printer className="h-4 w-4" /> {t('Ticket de test')}</Btn>
              {msg && <span className="text-muted">{msg}</span>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
