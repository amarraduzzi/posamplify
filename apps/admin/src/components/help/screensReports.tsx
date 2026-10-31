import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, Copy, Sparkles } from 'lucide-react';
import { t } from '../../lib/i18n';
import { Admin, Btn, Card, Chip, Field, tr, type ScreenDef } from './kit';

const Over = ({ children }: { children: ReactNode }) => <div className="relative h-full">{children}</div>;
const K = ({ l, v, h }: { l: string; v: string; h?: string }) => <Card h={h} className="!p-2.5"><p className="text-[11px] text-muted">{l}</p><p className="tabular text-base font-bold">{v}</p></Card>;
const Li = ({ a, b }: { a: ReactNode; b?: ReactNode }) => <p className="flex justify-between gap-2 py-0.5 text-[12.5px] font-semibold"><span>{a}</span><span className="tabular text-muted">{b}</span></p>;

const Reports = () => (
  <Over><Admin active="reports" title={t('Ventes')} right={<Btn h="export" tone="soft"><Download className="h-3.5 w-3.5" />{t('Export comptable (CSV)')}</Btn>}>
    <div className="mb-2.5 flex items-center gap-2">
      <span data-h="tabs" className="flex gap-1 rounded-xl bg-surface p-1 text-xs font-semibold ring-1 ring-line/10"><span className="rounded-lg bg-night px-3 py-1 text-white">{t('Journée')}</span><span className="px-3 py-1 text-muted">{t('Produits')}</span></span>
      <span data-h="date" className="rounded-lg border border-line/15 bg-surface px-2.5 py-1 text-xs font-semibold">31/10/2026</span>
      <span className="ms-auto rounded-lg bg-surface-2 px-2.5 py-1 text-[11px] font-bold">{t('Journée clôturée (Z).')}</span>
    </div>
    <div data-h="kpis" className="mb-2.5 grid grid-cols-4 gap-2">
      <K l={tr('Chiffre d’affaires TTC', 'Sales incl. VAT', 'رقم المعاملات')} v="3 420 MAD" /><K l={t('Tickets')} v="84" /><K l={t('Ticket moyen')} v="41 MAD" /><K l={t('TVA')} v="311 MAD" />
      <K l={t('Pourboires')} v="45 MAD" /><K l={t('Remises')} v="60 MAD" /><K l={t('Sorties de caisse')} v="120 MAD" /><K l={t('Commandes annulées')} v="2" />
    </div>
    <Card h="staff" className="!p-2.5"><p className="mb-1 text-sm font-bold">{t('Par employé')}</p><Li a="Youssef" b="1 980 MAD" /><Li a="Salma" b="1 440 MAD" /></Card>
  </Admin></Over>
);

const Live = () => (
  <Over><Admin active="live" title={t('En direct')}>
    <div className="mb-2.5 grid grid-cols-3 gap-2">
      <K h="sales" l={t('Chiffre d’affaires aujourd’hui')} v="2 180 MAD" /><K l={t('Tables occupées')} v="6" /><K l={t('Commandes ouvertes')} v="4" />
    </div>
    <div className="grid grid-cols-2 gap-2">
      <Card h="watch" className="!p-2.5"><p className="mb-1 text-sm font-bold">{t('À regarder aujourd’hui')}</p>
        <p className="rounded-lg bg-warn/10 px-2 py-1 text-[12px] font-semibold text-warn">{t('Remise de {m} sur le ticket {n}', { m: '20 MAD', n: '#412' })}</p>
        <p className="mt-1 rounded-lg bg-warn/10 px-2 py-1 text-[12px] font-semibold text-warn">{t('Stock bas : {p}', { p: tr('Lait', 'Milk', 'حليب') })}</p></Card>
      <Card className="!p-2.5"><p className="mb-1 text-sm font-bold">{t('Équipe présente')}</p><Li a="Youssef" b={t('depuis {h}', { h: '09:05' })} /><Li a="Salma" b={t('depuis {h}', { h: '11:30' })} />
        <p className="mb-1 mt-2 text-sm font-bold">{t('Dernières ventes')}</p><Li a="#0412" b="148 MAD" /></Card>
    </div>
    <Card h="wa" className="mt-2 flex items-center gap-2 !p-2.5"><div className="min-w-0 flex-1"><p className="text-xs font-bold">{t('Rapport Z sur WhatsApp')}</p><p className="text-[11px] text-muted">{t('Votre numéro WhatsApp')} · <span dir="ltr">06 •• •• •• 12</span></p></div><Btn>{t('Enregistrer')}</Btn></Card>
  </Admin></Over>
);

const Briefing = () => (
  <Over><Admin active="briefing" title={t('Briefing')} right={<Btn h="ask" tone="soft"><Sparkles className="h-3.5 w-3.5" />{t('Demander le résumé')}</Btn>}>
    <div data-h="day" className="mb-2.5 flex items-center justify-between rounded-xl bg-surface px-3 py-1.5 text-[12.5px] font-bold ring-1 ring-line/10"><span className="flex items-center gap-1 text-muted"><ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />{t('Jour précédent')}</span><span>31/10/2026</span><span className="flex items-center gap-1 text-muted">{t('Jour suivant')}<ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" /></span></div>
    <Card h="summary" className="mb-2 !p-2.5"><p className="mb-0.5 text-sm font-bold">{t('Votre conseiller')}</p><p className="text-[12.5px] leading-snug">{tr('Belle journée : 3 420 MAD, en hausse de 12 % sur samedi dernier. Pensez à mettre le tajine en avant demain.', 'Great day: 3,420 MAD, up 12% on last Saturday. Consider promoting the tajine tomorrow.', 'يوم جيد: 3420 درهم، بزيادة 12٪ عن السبت الماضي. فكّر في إبراز الطاجين غدًا.')}</p></Card>
    <div className="grid grid-cols-2 gap-2">
      <Card h="points" className="!p-2.5"><p className="mb-1 text-sm font-bold">{t('Ce qu’il faut retenir')}</p><div className="space-y-1"><Chip on>{t('Bonne nouvelle')}</Chip> <Chip>{t('À vérifier')}</Chip> <Chip>{t('Idée')}</Chip></div></Card>
      <Card h="hours" className="!p-2.5"><p className="mb-1 text-sm font-bold">{t('Ventes par heure')}</p><div className="flex h-12 items-end gap-1">{[20, 35, 80, 100, 60, 40, 70, 90, 50].map((x, i) => <i key={i} className="flex-1 rounded-t bg-brand" style={{ height: x + '%' }} />)}</div></Card>
    </div>
  </Admin></Over>
);

const Accounting = () => (
  <Over><Admin active="accounting" title={t('Comptabilité')}>
    <Card h="link" className="mb-2.5 !p-2.5"><p className="mb-1.5 text-sm font-bold">{t('Le lien pour votre comptable')}</p>
      <div className="flex items-center gap-2"><span dir="ltr" className="min-w-0 flex-1 truncate rounded-lg border border-line/15 bg-surface px-2.5 py-1.5 text-xs font-semibold">…/compta/x7Kq92…</span><Btn tone="soft"><Copy className="h-3.5 w-3.5" />{t('Copier')}</Btn><Btn tone="danger">{t('Couper le lien')}</Btn></div></Card>
    <Card className="mb-2.5 !p-2.5"><p className="mb-1.5 text-sm font-bold">{t('Les fichiers du mois')}</p>
      <div className="flex items-end gap-2"><Field h="month" label={t('Mois')} value="10 / 2026" className="w-32" /><Btn h="excel" tone="soft">{t('Dossier Excel du mois')}</Btn><Btn h="sage">{tr('Écritures pour Sage', 'Entries for Sage', 'قيود Sage')}</Btn></div></Card>
    <Card h="vat" className="!p-2.5"><div className="flex justify-between text-[13px] font-bold"><span>{t('TVA estimée de la période')}</span><span className="tabular">2 840 MAD</span></div><p className="text-[11px] text-muted">{t('Estimation, à vérifier par votre comptable.')}</p></Card>
  </Admin></Over>
);

const d = (render: () => ReactNode): ScreenDef => ({ w: 760, h: 440, render });
export const REPORT_SCREENS: Record<string, ScreenDef> = { reports: d(() => <Reports />), live: d(() => <Live />), briefing: d(() => <Briefing />), accounting: d(() => <Accounting />) };
