// The label of one batch: choose the size, see the label as it will print, print it. The facts come from the database
// (production_label), so the allergens on the label are always the calculated ones. A label that does not fit its
// paper, or has no date, is never printed.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Printer, TriangleAlert } from 'lucide-react';
import { rpc } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import { getPrintCfg } from '../lib/orderPrint';
import {
  LABEL_SIZES, allergenState, getLabelCfg, labelOverflows, labelPage, printLabelInBrowser, printLabelTicket, setLabelCfg,
  type LabelSize,
} from '../lib/labelPrint';
import type { ProductionLabel } from '../lib/types';
import { Btn, Field, Modal, inputCls } from './ui';

export function LabelModal({ rid, id, onClose }: { rid: string; id: string; onClose: () => void }) {
  const a = useAdminCtx();
  const [l, setL] = useState<ProductionLabel | null>(null);
  const cfg0 = useMemo(() => getLabelCfg(rid), [rid]);
  const [size, setSize] = useState<LabelSize>(cfg0.size);
  const [bilingual, setBilingual] = useState(cfg0.bilingual);
  const [copies, setCopies] = useState('1');
  const [net, setNet] = useState('');
  const [date, setDate] = useState('');            // a date typed by hand, when the database has none
  const [overflow, setOverflow] = useState(false);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const ticketPrinter = getPrintCfg(rid).name;

  useEffect(() => {
    let stop = false;
    rpc<ProductionLabel>('production_label', { p_production_id: id }).then(x => { if (!stop) setL(x); }).catch(e => { if (!stop) { a.fail(e); onClose(); } });
    return () => { stop = true; };
  }, [id, a, onClose]);

  const expires = l ? (l.expires_on ? String(l.expires_on).slice(0, 10) : date || null) : null;
  const n = Math.min(Math.max(Math.round(Number(copies)) || 1, 1), 200);
  const opts = { size, bilingual, copies: 1, net, expires };
  // the preview shows one label; the print gets all the copies
  const html = l ? labelPage(l, opts) : '';
  const sz = LABEL_SIZES.find(s => s.id === size) ?? LABEL_SIZES[1];

  const measure = () => { const d = frame.current?.contentDocument; if (d) setOverflow(labelOverflows(d)); };
  useEffect(() => { setOverflow(false); }, [html]);

  const choose = (s: LabelSize, b: boolean) => { setSize(s); setBilingual(b); setLabelCfg(rid, { size: s, bilingual: b }); };
  const blocked = !l || l.cancelled || overflow || !expires;
  const unchecked = l ? allergenState(l).state === 'unchecked' : false;

  const printBrowser = () => { if (l && !blocked) printLabelInBrowser(l, { ...opts, copies: n }); };
  const printTicket = async () => {
    if (!l || blocked) return;
    setBusy(true);
    try { await printLabelTicket(ticketPrinter, l, { net, expires, copies: n }); a.toast(t('Étiquette envoyée à l’imprimante.')); }
    catch { a.toast(t('Impression impossible : vérifiez que l’imprimante est allumée et que son nom est correct.'), 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={<span className="flex items-center gap-2"><Printer className="h-5 w-5" /> {t('Étiquette')}{l ? ` · ${l.name}` : ''}</span>} onClose={onClose} wide
      footer={<>
        <Btn onClick={onClose}>{t('Fermer')}</Btn>
        {ticketPrinter && <Btn tone="ghost" disabled={blocked || busy} onClick={() => void printTicket()}><Printer className="h-4 w-4" /> {t('Imprimante de tickets')}</Btn>}
        <Btn tone="brand" disabled={blocked} onClick={printBrowser}><Printer className="h-4 w-4" /> {t('Imprimer l’étiquette')}</Btn>
      </>}>
      {!l ? <p className="text-muted">{t('Chargement…')}</p> : (
        <div className="space-y-4 text-sm">
          {l.cancelled && <p className="flex items-center gap-2 rounded-xl bg-danger/10 px-3 py-2 font-semibold text-danger"><TriangleAlert className="h-4 w-4 shrink-0" /> {t('Cette production est annulée : pas d’étiquette.')}</p>}
          {!l.expires_on && (
            <div className="rounded-xl bg-warn/10 px-3 py-2">
              <p className="flex items-center gap-2 font-semibold text-warn"><TriangleAlert className="h-4 w-4 shrink-0" /> {t('Aucune date limite connue pour cette préparation.')}</p>
              <p className="mt-1 text-muted">{t('Réglez la durée de conservation de la préparation (page Ingrédients), ou indiquez la date ici pour cette étiquette.')}</p>
              <input type="date" className={`${inputCls} mt-2 !w-auto`} value={date} onChange={e => setDate(e.target.value)} aria-label={t('Date limite')} />
            </div>
          )}
          {unchecked && <p className="flex items-center gap-2 rounded-xl bg-warn/10 px-3 py-2 font-semibold text-warn"><TriangleAlert className="h-4 w-4 shrink-0" /> {t('Allergènes incomplets : l’étiquette dira « demandez au personnel ». Complétez les ingrédients dans la page Allergènes.')}</p>}
          {overflow && <p className="flex items-center gap-2 rounded-xl bg-danger/10 px-3 py-2 font-semibold text-danger"><TriangleAlert className="h-4 w-4 shrink-0" /> {t('Le texte ne tient pas sur cette étiquette : choisissez un format plus grand ou désactivez l’arabe.')}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Format')}>
              <select className={inputCls} value={size} onChange={e => choose(e.target.value as LabelSize, bilingual)}>
                {LABEL_SIZES.map(s => <option key={s.id} value={s.id}>{s.w} × {s.h} mm</option>)}
              </select>
            </Field>
            <Field label={t('Nombre d’étiquettes')}>
              <input className={inputCls} inputMode="numeric" value={copies} onChange={e => setCopies(e.target.value)} />
            </Field>
            <Field label={t('Contenu (facultatif)')} hint={t('Par exemple : 500 g')}>
              <input className={inputCls} value={net} maxLength={30} onChange={e => setNet(e.target.value)} />
            </Field>
            <label className="flex items-start gap-3 rounded-xl bg-surface-2 p-3 sm:self-end">
              <input type="checkbox" className="mt-0.5 h-5 w-5" checked={bilingual} onChange={e => choose(size, e.target.checked)} />
              <span><span className="font-semibold">{t('Allergènes en français et en arabe')}</span><span className="block text-muted">{t('Sur l’imprimante de tickets, seul le français sort.')}</span></span>
            </label>
          </div>

          <div className="flex justify-center rounded-2xl bg-surface-2 p-4">
            <iframe ref={frame} title={t('Aperçu de l’étiquette')} srcDoc={html} onLoad={measure} scrolling="no"
              className="border border-line/20 bg-white shadow" style={{ width: `${sz.w}mm`, height: `${sz.h}mm` }} />
          </div>
          <p className="text-xs text-muted">{t('Imprimez avec la taille de papier de l’étiquette et sans marges. L’aperçu est celui de l’impression.')}</p>
        </div>
      )}
    </Modal>
  );
}
