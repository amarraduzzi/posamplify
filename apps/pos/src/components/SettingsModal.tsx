import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, LogOut, Monitor, Download, RefreshCw } from 'lucide-react';
import { displayCode, setDisplay } from '../lib/display';
import { usePos } from '../store';
import * as P from '../lib/print';
import { Btn, Modal } from './ui';
import { t } from '../lib/i18n';
import { LangSwitch } from './LangSwitch';
import { autoFullscreen, setAutoFullscreen } from '../lib/fullscreen';
import { setTpeSettings, tpeSettings, type TpeSettings, type TpeTest } from '../lib/tpe';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const pos = usePos();
  const [photos, setPhotos] = useState(localStorage.getItem('pos-photos') !== 'off');
  const [full, setFull] = useState(autoFullscreen());
  return (
    <Modal title={t('Réglages du poste')} onClose={onClose}>
      <h3 className="mb-2 font-bold">{t('Langue')}</h3>
      <LangSwitch className="mb-6 w-fit" />
      <PrinterSetup />
      <TpeSetup />
      <h3 className="mb-2 mt-6 font-bold">{t('Affichage')}</h3>
      <label className="flex cursor-pointer items-center justify-between rounded-xl bg-surface-2 px-3 py-3">
        <span>{t('Photos des articles')}<span className="block text-xs text-muted">{t('Désactivez sur un PC lent.')}</span></span>
        <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={photos}
          onChange={e => { const on = e.target.checked; setPhotos(on); localStorage.setItem('pos-photos', on ? 'on' : 'off'); }} />
      </label>
      <label className="mt-2 flex cursor-pointer items-center justify-between rounded-xl bg-surface-2 px-3 py-3">
        <span>{t('Plein écran automatique')}<span className="block text-xs text-muted">{t('Sans barre en haut. Échap pour sortir, un toucher pour revenir.')}</span></span>
        <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={full}
          onChange={e => { const on = e.target.checked; setFull(on); setAutoFullscreen(on); }} />
      </label>
      <DisplaySetup />
      <h3 className="mb-2 mt-6 font-bold">{t('Poste')}</h3>
      <Btn tone="danger" onClick={pos.logout}><LogOut className="h-4 w-4" /> {t('Déconnecter ce poste')}</Btn>
    </Modal>
  );
}

/** The card terminal (TPE) of this till: off, or the test terminal to try the whole flow. */
function TpeSetup() {
  const [v, setV] = useState<TpeSettings>(tpeSettings());
  const save = (n: TpeSettings) => { setV(n); setTpeSettings(n); };
  const tests: { id: TpeTest; label: string }[] = [
    { id: 'approved', label: t('Accepté') }, { id: 'declined', label: t('Refusé par la banque') },
    { id: 'unreachable', label: t('Terminal injoignable') }, { id: 'timeout', label: t('Pas de carte (délai dépassé)') },
  ];
  return <>
    <h3 className="mb-2 mt-6 font-bold">{t('Terminal de paiement (TPE)')}</h3>
    <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
      <div className="flex flex-wrap gap-2">
        {(['off', 'test'] as const).map(m => (
          <button key={m} type="button" onClick={() => save({ ...v, mode: m })}
            className={`rounded-xl px-3.5 py-2 font-semibold transition ${v.mode === m ? 'gold-fill text-brand-ink' : 'bg-surface hover:bg-surface-3'}`}>
            {m === 'off' ? t('Sans liaison') : t('Terminal de test')}
          </button>
        ))}
      </div>
      {v.mode === 'off'
        ? <p className="text-muted">{t('Le montant se tape sur le terminal, puis « Carte » se valide ici, comme aujourd’hui.')}</p>
        : <>
            <p className="text-muted">{t('Avec « Carte », le montant part sur le terminal et le ticket s’imprime quand il accepte. Le terminal de test simule la réponse, sans vrai paiement.')}</p>
            <label className="flex flex-wrap items-center gap-2">{t('Réponse simulée')}
              <select className="rounded-lg border border-line/15 bg-surface px-2 py-1.5" value={v.test} onChange={e => save({ ...v, test: e.target.value as TpeTest })}>
                {tests.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
          </>}
      <p className="text-xs text-muted">{t('Liaison avec un vrai terminal : demandez à votre banque ou au CMI d’activer la « liaison caisse » (protocole Concert) sur le terminal.')}</p>
    </div>
  </>;
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

/** iPad / iPhone: printing through the free Epson app TM Print Assistant (the app finds the printer). */
function EpsonAppSetup() {
  const pos = usePos();
  const [on, setOn] = useState(P.usesEpsonApp());
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = async () => { P.setEpsonApp(!on); setOn(!on); setMsg(null); await pos.recheckPrinter(); };
  const test = () => P.print('Epson', 'Test', [{ text: 'TEST IMPRESSION', bold: true, large: true, center: true }, { text: 'iPad', center: true }, { text: new Date().toLocaleString('fr-FR'), center: true }]);
  return <>
    <h3 className="mb-2 font-bold">{t('Imprimantes')}</h3>
    <div className="space-y-3 rounded-xl bg-surface-2 p-4 text-sm">
      <p className="font-semibold">{t('Sur iPad, les tickets s’impriment avec l’application gratuite Epson TM Print Assistant :')}</p>
      <ol className="list-decimal space-y-1 ps-5 text-muted">
        <li>{t('Installez Epson TM Print Assistant depuis l’App Store.')}</li>
        <li>{t('Ouvrez-la, choisissez votre imprimante Epson (même wifi que l’iPad) et faites un test.')}</li>
        <li>{t('Revenez ici, activez, puis touchez Test.')}</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Btn tone={on ? undefined : 'brand'} onClick={toggle}>{on ? t('Désactiver') : t('Activer l’impression Epson')}</Btn>
        {on && <Btn onClick={() => { try { test(); } catch (e) { setMsg((e as Error).message); } }}><Printer className="h-4 w-4" /> {t('Test')}</Btn>}
      </div>
      {on && <p className="text-xs text-muted">{t('Après chaque ticket, touchez « ◀ » en haut à gauche de l’écran pour revenir à la caisse.')}</p>}
    </div>
    {msg && <p className="mt-2 text-sm font-semibold">{msg}</p>}
  </>;
}

/** The printers of this PC: install the print program, then pick which printer prints what,
 *  from the printers Windows sees (USB or network). Kept on this PC. */
function PrinterSetup() {
  if (P.isIOS()) return <EpsonAppSetup />;
  return <PcPrinterSetup />;
}

function PcPrinterSetup() {
  const pos = usePos();
  const s = pos.settings;
  const [list, setList] = useState<{ name: string; default: boolean }[] | null>(null);
  const [mine, setMine] = useState<P.LocalPrinters>(P.localPrinters());
  const [msg, setMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const roles = [
    { key: 'receipt', label: t('Ticket (caisse)') },
    ...[...new Set(pos.categories.map(c => c.station))].map(st => ({ key: st, label: t('Bon {s}', { s: t(st === 'bar' ? 'bar' : st === 'kitchen' ? 'cuisine' : st) }) })),
  ];
  const nameOf = (k: string) => (k === 'receipt' ? P.receiptPrinter(s) : P.printerFor(s, k));
  const load = async () => { setList(pos.printerOk ? await P.listPrinters() : null); };
  useEffect(() => { load(); }, [pos.printerOk]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (k: string, name: string) => {
    const next: P.LocalPrinters = k === 'receipt' ? { ...mine, receipt: name } : { ...mine, stations: { ...(mine.stations ?? {}), [k]: name } };
    P.setLocalPrinters(next); setMine(next); setMsg(null);
  };
  const allOn = (name: string) => {
    const next: P.LocalPrinters = { receipt: name, stations: Object.fromEntries(roles.filter(r => r.key !== 'receipt').map(r => [r.key, name])) };
    P.setLocalPrinters(next); setMine(next);
  };
  const test = async (name: string, label: string) => {
    setMsg(null);
    try { await P.print(name, 'Test', [{ text: 'TEST IMPRESSION', bold: true, large: true, center: true }, { text: label, center: true }, { text: name, center: true }, { text: new Date().toLocaleString('fr-FR'), center: true }]); setMsg(`${label} : ${t('OK')}`); }
    catch (e) { setMsg((e as Error).message); }
  };
  const again = async () => { setChecking(true); const ok = await pos.recheckPrinter(); if (ok) await load(); setChecking(false); };
  const names = list?.map(p => p.name) ?? [];
  // the Android app: look for printers on the network, add one by its IP address
  const android = P.inAndroidApp();
  const [ip, setIp] = useState('');
  const [scanning, setScanning] = useState(false);
  const scan = async () => { setScanning(true); setMsg(null); const l = await P.scanPrinters(); if (l) setList(l); setScanning(false); if (l && !l.length) setMsg(t('Aucune imprimante trouvée sur le wifi. Vérifiez qu’elle est allumée et branchée au même réseau, ou ajoutez son adresse IP.')); };
  const addIp = async () => { setMsg(null); try { setList(await P.addNetworkPrinter(ip)); setIp(''); setMsg(t('Imprimante ajoutée.')); } catch (e) { setMsg((e as Error).message); } };
  const download = <a href="/printhost.exe" download className="inline-flex items-center gap-2 rounded-xl gold-fill px-4 py-2.5 font-bold text-brand-ink"><Download className="h-4 w-4" /> {t('Télécharger le programme d’impression')}</a>;

  return <>
    <h3 className="mb-2 font-bold">{t('Imprimantes')}</h3>
    {!pos.printerOk && P.androidBrowser() ? (
      <div className="space-y-3 rounded-xl bg-surface-2 p-4 text-sm">
        <p className="font-semibold">{t('Pour imprimer depuis cette tablette Android, installez une fois l’application Amplify Caisse :')}</p>
        <ol className="list-decimal space-y-1 ps-5 text-muted">
          <li>{t('Touchez Télécharger, puis ouvrez le fichier.')}</li>
          <li>{t('Android demande d’autoriser l’installation : Paramètres, puis Autoriser. Si « Application inconnue » s’affiche : Installer quand même.')}</li>
          <li>{t('Ouvrez Amplify Caisse (nouvelle icône) et reliez la caisse avec un code, comme la première fois.')}</li>
          <li>{t('Ici, dans Réglages du poste : Rechercher les imprimantes, puis Test.')}</li>
        </ol>
        <a href={P.ANDROID_APK} download="amplify-caisse.apk" className="inline-flex items-center gap-2 rounded-xl gold-fill px-4 py-2.5 font-bold text-brand-ink"><Download className="h-4 w-4" /> {t('Télécharger l’application Android')}</a>
        <p className="text-xs text-muted">{t('Imprimantes wifi, Bluetooth, USB et imprimantes intégrées (Sunmi). Sans l’application, les bons s’impriment sur une autre caisse équipée d’une imprimante.')}</p>
      </div>
    ) : !pos.printerOk ? (
      <div className="space-y-3 rounded-xl bg-surface-2 p-4 text-sm">
        <p className="font-semibold">{t('Pour imprimer depuis ce PC (Windows), installez une fois le programme d’impression :')}</p>
        <ol className="list-decimal space-y-1 ps-5 text-muted">
          <li>{t('Branchez l’imprimante (câble USB) ou reliez-la au même réseau (wifi ou câble réseau), et installez-la dans Windows.')}</li>
          <li>{t('Téléchargez le programme et ouvrez le fichier. Si Windows affiche « Windows a protégé votre ordinateur » : Informations complémentaires, puis Exécuter quand même.')}</li>
          <li>{t('Un message « C’est prêt » s’affiche. Revenez ici et touchez Vérifier.')}</li>
        </ol>
        <div className="flex flex-wrap gap-2">{download}<Btn onClick={again} disabled={checking}><RefreshCw className="h-4 w-4" /> {t('Vérifier')}</Btn></div>
        <p className="text-xs text-muted">{t('Sur une tablette ou un téléphone : rien à installer, les bons s’impriment sur la caisse équipée d’une imprimante.')}</p>
      </div>
    ) : list === null ? (
      <div className="space-y-3 rounded-xl bg-surface-2 p-4 text-sm">
        <p>{t('Ancienne version du programme d’impression : elle imprime, mais ne sait pas lister les imprimantes. Installez la nouvelle version (elle remplace l’ancienne).')}</p>
        <div className="flex flex-wrap gap-2">{download}<Btn onClick={again} disabled={checking}><RefreshCw className="h-4 w-4" /> {t('Vérifier')}</Btn></div>
      </div>
    ) : (
      <div className="space-y-2">
        <p className="text-sm text-muted">{android
          ? (list.length ? t('Choisissez l’imprimante de chaque ticket. Imprimantes trouvées par la tablette : {n}.', { n: list.length }) : t('Aucune imprimante pour le moment. Wifi : allumez-la sur le même réseau puis Rechercher. Bluetooth : associez-la d’abord dans les paramètres Bluetooth d’Android. USB : branchez-la.'))
          : (list.length ? t('Choisissez l’imprimante de chaque ticket. Imprimantes vues par Windows sur ce PC : {n}.', { n: list.length }) : t('Programme d’impression actif, mais Windows ne voit aucune imprimante. Installez l’imprimante dans Windows (Paramètres > Imprimantes), puis touchez Vérifier.'))}</p>
        {roles.map(r => {
          const cur = nameOf(r.key);
          const missing = !names.some(n => n.toLowerCase() === cur.toLowerCase());
          return (
            <div key={r.key} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
              <span className="min-w-28 flex-1 font-semibold">{r.label}</span>
              <select aria-label={r.label} value={missing ? '' : names.find(n => n.toLowerCase() === cur.toLowerCase())} onChange={e => choose(r.key, e.target.value)}
                className={`min-w-0 flex-[2] rounded-lg border bg-surface px-2 py-2 text-sm ${missing ? 'border-danger text-danger' : 'border-line/15'}`}>
                {missing && <option value="">{t('« {n} » introuvable : choisissez', { n: cur })}</option>}
                {names.map(n => <option key={n} value={n}>{n}{list.find(p => p.name === n)?.default ? ` (${t('par défaut')})` : ''}</option>)}
              </select>
              <Btn className="py-1.5" disabled={missing} onClick={() => test(cur, r.label)}><Printer className="h-4 w-4" /> {t('Test')}</Btn>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2 pt-1">
          {list.length === 1 && roles.length > 1 && <Btn onClick={() => allOn(list[0].name)}>{t('Tout imprimer sur {n}', { n: list[0].name })}</Btn>}
          {android
            ? <Btn tone="brand" onClick={scan} disabled={scanning}><RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} /> {scanning ? t('Recherche…') : t('Rechercher les imprimantes')}</Btn>
            : <Btn onClick={again} disabled={checking}><RefreshCw className="h-4 w-4" /> {t('Vérifier')}</Btn>}
        </div>
        {android && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
            <span className="text-sm text-muted">{t('Imprimante wifi non trouvée ? Son adresse IP :')}</span>
            <input value={ip} onChange={e => setIp(e.target.value)} inputMode="decimal" dir="ltr" placeholder="192.168.1.50" className="w-36 rounded-lg border border-line/15 bg-surface px-2 py-1.5 text-sm" />
            <Btn className="py-1.5" disabled={!ip.trim()} onClick={addIp}>{t('Ajouter')}</Btn>
          </div>
        )}
      </div>
    )}
    {msg && <p className="mt-2 text-sm font-semibold">{msg}</p>}
  </>;
}
