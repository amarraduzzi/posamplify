import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, LogOut, Monitor } from 'lucide-react';
import { displayCode, setDisplay } from '../lib/display';
import { usePos } from '../store';
import * as P from '../lib/print';
import { Btn, Modal } from './ui';
import { t } from '../lib/i18n';
import { LangSwitch } from './LangSwitch';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const pos = usePos();
  const s = pos.settings;
  const [msg, setMsg] = useState<string | null>(null);
  const [photos, setPhotos] = useState(localStorage.getItem('pos-photos') !== 'off');
  const printers = [
    { label: t('Ticket (caisse)'), name: P.receiptPrinter(s) },
    ...[...new Set(pos.categories.map(c => c.station))].map(st => ({ label: t('Bon {s}', { s: t(st === 'bar' ? 'bar' : st === 'kitchen' ? 'cuisine' : st) }), name: P.printerFor(s, st) })),
  ];
  const test = async (name: string, label: string) => {
    setMsg(null);
    try { await P.print(name, 'Test', [{ text: 'TEST IMPRESSION', bold: true, large: true, center: true }, { text: name, center: true }, { text: new Date().toLocaleString('fr-FR'), center: true }]); setMsg(`${label} : ${t('OK')}`); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <Modal title={t('Réglages du poste')} onClose={onClose}>
      <h3 className="mb-2 font-bold">{t('Langue')}</h3>
      <LangSwitch className="mb-6 w-fit" />
      <h3 className="mb-2 font-bold">{t('Imprimantes')}</h3>
      <p className="mb-3 text-sm text-muted">{pos.printerOk ? t("Programme d'impression détecté sur ce PC.") : t("Programme d'impression (printhost) non détecté sur ce PC : les tickets ne s'impriment pas automatiquement.")}</p>
      <div className="space-y-2">
        {printers.map(p => (
          <div key={p.label} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
            <span>{p.label} <span className="text-muted">→ {p.name}</span></span>
            <Btn className="py-1.5" disabled={!pos.printerOk} onClick={() => test(p.name, p.label)}><Printer className="h-4 w-4" /> {t('Test')}</Btn>
          </div>
        ))}
      </div>
      {msg && <p className="mt-2 text-sm font-semibold">{msg}</p>}
      <h3 className="mb-2 mt-6 font-bold">{t('Affichage')}</h3>
      <label className="flex cursor-pointer items-center justify-between rounded-xl bg-surface-2 px-3 py-3">
        <span>{t('Photos des articles')}<span className="block text-xs text-muted">{t('Désactivez sur un PC lent.')}</span></span>
        <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={photos}
          onChange={e => { const on = e.target.checked; setPhotos(on); localStorage.setItem('pos-photos', on ? 'on' : 'off'); }} />
      </label>
      <DisplaySetup />
      <h3 className="mb-2 mt-6 font-bold">{t('Poste')}</h3>
      <Btn tone="danger" onClick={pos.logout}><LogOut className="h-4 w-4" /> {t('Déconnecter ce poste')}</Btn>
    </Modal>
  );
}

/** Customer display: a tablet (QR to scan) or a second monitor on this PC. */
function DisplaySetup() {
  const [code, setCode] = useState(displayCode());
  const [qr, setQr] = useState('');
  const link = code ? `${location.origin}/?ecran=${code}` : '';
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 360 }).then(setQr).catch(() => {}); else setQr(''); }, [link]);
  return <>
    <h3 className="mb-2 mt-6 font-bold">{t('Écran client')}</h3>
    <label className="flex cursor-pointer items-center justify-between rounded-xl bg-surface-2 px-3 py-3">
      <span>{t('Afficher la commande au client')}<span className="block text-xs text-muted">{t('Sur une tablette tournée vers le client, ou un 2e écran branché à ce PC.')}</span></span>
      <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={!!code} onChange={e => setCode(setDisplay(e.target.checked))} />
    </label>
    {code && (
      <div className="mt-2 flex items-center gap-4 rounded-xl bg-surface-2 p-3">
        {qr && <img src={qr} alt="" className="h-28 w-28 rounded-lg bg-white p-1" />}
        <div className="space-y-2 text-sm">
          <p>{t('Tablette : scannez ce QR avec la tablette, puis laissez la page ouverte.')}</p>
          <Btn className="py-1.5" onClick={() => window.open(link, 'ecran-client', 'popup')}><Monitor className="h-4 w-4" /> {t('Ouvrir sur ce PC (2e écran)')}</Btn>
        </div>
      </div>
    )}
  </>;
}
