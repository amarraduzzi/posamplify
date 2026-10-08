import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { ImportData } from '../components/ImportData';
import { SalesHistory } from '../components/SalesHistory';
import { supabase } from '../lib/supabase';
import { check, mad, rpc } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, inputCls } from '../components/ui';
import { t } from '../lib/i18n';

interface Rep { business_date: string; tickets: number; revenue_ttc_cents: number; revenue_ht_cents: number; vat_cents: number; discounts_cents: number;
  credit_notes: number; credit_notes_cents: number; payments: Record<string, number>; tips_cents: number; expected_cash_cents: number;
  cash_payouts_cents: number; cancelled_orders: number; open_orders: number; closed?: boolean; by_staff: { name: string | null; revenue_ttc_cents: number }[] }
interface Doc { doc_number: string; doc_type: string; issued_at: string; total_ttc_cents: number; total_ht_cents: number; total_vat_cents: number; payments: { method: string; amount: number }[] }
// French payment labels: used as-is in the CSV (accountants), through t() on screen
// i18n:values
const METHOD: Record<string, string> = { cash: 'Espèces', card: 'Carte', transfer: 'Virement', other: 'Autre', account: 'Ardoise' };
// i18n:end

export function ReportsPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [date, setDate] = useState('');
  const [rep, setRep] = useState<Rep | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [importing, setImporting] = useState(false);
  const [hv, setHv] = useState(0);
  useEffect(() => {
    (async () => {
      try {
        const x = await rpc<Rep>('day_report', { p_restaurant_id: r.id, p_business_date: date || null });
        setRep(x); if (!date) setDate(x.business_date);
        setDocs(check(await supabase.from('fiscal_documents').select('doc_number,doc_type,issued_at,total_ttc_cents,total_ht_cents,total_vat_cents,payments')
          .eq('restaurant_id', r.id).eq('business_date', x.business_date).order('chain_index')) as Doc[]);
      } catch (e) { a.fail(e); }
    })();
  }, [r.id, date, a]);

  // the accounting export stays in French whatever the screen language
  const csv = () => {
    const rows = [['Numero', 'Type', 'Date', 'HT', 'TVA', 'TTC', 'Paiement'], ...docs.map(d => [d.doc_number, d.doc_type, new Date(d.issued_at).toISOString(),
      (d.total_ht_cents / 100).toFixed(2), (d.total_vat_cents / 100).toFixed(2), (d.total_ttc_cents / 100).toFixed(2), d.payments.map(p => METHOD[p.method] ?? p.method).join('+')])];
    const blob = new Blob(['﻿' + rows.map(x => x.join(';')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const u = URL.createObjectURL(blob); const l = document.createElement('a'); l.href = u; l.download = `ventes-${r.slug}-${date}.csv`; l.click(); URL.revokeObjectURL(u);
  };
  const K = ({ l, v, big }: { l: string; v: string; big?: boolean }) => <Card className="p-4"><p className="text-sm text-muted">{l}</p><p className={`tabular font-bold ${big ? 'text-3xl' : 'text-xl'}`}>{v}</p></Card>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="me-auto font-display text-3xl font-semibold">{t('Ventes')}</h1>
        <input type="date" aria-label={t('Date')} className={`${inputCls} !w-44`} value={date} onChange={e => setDate(e.target.value)} />
        <Btn onClick={csv} disabled={!docs.length}><Download className="h-4 w-4" /> {t('Export comptable (CSV)')}</Btn>
      </div>
      {rep && <>
        {rep.closed && <p className="rounded-xl bg-surface-2 px-4 py-2 text-sm">{t('Journée clôturée (Z).')}</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <K l={t("Chiffre d'affaires TTC")} v={mad(rep.revenue_ttc_cents)} big />
          <K l={t('Tickets')} v={String(rep.tickets)} big />
          <K l={t('Ticket moyen')} v={rep.tickets ? mad(Math.round(rep.revenue_ttc_cents / rep.tickets)) : '—'} />
          <K l={t('TVA')} v={mad(rep.vat_cents)} />
          {Object.entries(rep.payments).map(([m, c]) => <K key={m} l={METHOD[m] ? t(METHOD[m]) : m} v={mad(c)} />)}
          <K l={t('Pourboires')} v={mad(rep.tips_cents)} />
          <K l={t('Remises')} v={mad(rep.discounts_cents)} />
          <K l={t('Avoirs ({n})', { n: rep.credit_notes })} v={mad(rep.credit_notes_cents)} />
          <K l={t('Sorties de caisse')} v={mad(rep.cash_payouts_cents)} />
          <K l={t('Commandes annulées')} v={String(rep.cancelled_orders)} />
        </div>
        <Card>
          <h2 className="mb-3 font-display text-xl font-semibold">{t('Par employé')}</h2>
          {rep.by_staff.length ? rep.by_staff.map((s, i) => <p key={i} className="flex justify-between py-1"><span>{s.name ?? '—'}</span><span className="tabular">{mad(s.revenue_ttc_cents)}</span></p>) : <p className="text-muted">{t('Aucune vente.')}</p>}
        </Card>
      </>}
      <SalesHistory r={r} version={hv} onImport={() => setImporting(true)} />
      {importing && <ImportData kind="sales" r={r} onClose={() => setImporting(false)} onDone={() => setHv(x => x + 1)} />}
    </div>
  );
}
