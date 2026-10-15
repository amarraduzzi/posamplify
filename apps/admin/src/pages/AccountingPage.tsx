// Accounting: the month at a glance (sales and VAT, money received, purchases, a VAT estimate) and the
// files for the accountant: entries for Sage or any other software, an Excel workbook, the supplier
// invoices. The owner can give the accountant a private link to the same page, without a login.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Download, FileArchive, FileSpreadsheet, Link2, MessageCircle, RefreshCw, Unlink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad, rpc } from '../lib/api';
import { t } from '../lib/i18n';
import { download, dmy, entriesCsv, fileSlug, workbook, type Pack } from '../lib/accounting';
import { signedUrls } from '../lib/invoices';
import type { Restaurant } from '../lib/types';
import { useAdminCtx } from '../store';
import { Btn, Card, inputCls } from '../components/ui';

// i18n:values
const ACCOUNTS: [string, string][] = [
  ['sales', 'Ventes'], ['vat_out', 'TVA facturée'], ['cash', 'Caisse (espèces)'], ['card', 'Encaissements par carte'], ['transfer', 'Virements reçus'],
  ['other', 'Autres encaissements'], ['customers', 'Clients en compte'], ['purchases', 'Achats'], ['vat_in', 'TVA récupérable'],
  ['suppliers', 'Fournisseurs'], ['bank', 'Banque'], ['suspense', 'Compte d’attente (écarts, sorties de caisse)'],
];
const METHOD: Record<string, string> = { cash: 'Espèces', card: 'Carte', transfer: 'Virement', account: 'En compte client', other: 'Autre' };
const JOURNALS: Record<string, string> = { VE: 'Ventes', HA: 'Achats', CA: 'Caisse', BQ: 'Banque' };
// i18n:end

const monthBounds = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
};
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };

/** The back office page (owner and managers). */
export function AccountingPage({ r }: { r: Restaurant }) {
  return <AccountingView r={r} />;
}

/** The accountant's page, opened from his private link (no login). */
export function AccountantPage({ keyParam }: { keyParam: string }) {
  return <div className="mx-auto max-w-5xl p-4 md:p-10"><AccountingView accountantKey={keyParam} /></div>;
}

function AccountingView({ r, accountantKey }: { r?: Restaurant; accountantKey?: string }) {
  const a = useAdminCtx();
  const [month, setMonth] = useState(prevMonth());
  const [pack, setPack] = useState<Pack | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const { from, to } = monthBounds(month);

  const load = useCallback(async () => {
    setPack(null); setErr('');
    try {
      setPack(accountantKey
        ? await rpc<Pack>('accounting_export_by_key', { p_key: accountantKey, p_from: from, p_to: to })
        : await rpc<Pack>('accounting_export', { p_restaurant_id: r!.id, p_from: from, p_to: to }));
    } catch (e) { setErr(/not_found/.test(String((e as Error).message)) ? t('Ce lien n’est plus valable. Demandez un nouveau lien au restaurant.') : String((e as Error).message)); }
  }, [accountantKey, r, from, to]);
  useEffect(() => { load(); }, [load]);

  const sum = useMemo(() => {
    if (!pack) return null;
    const vatOut = pack.vat.reduce((s, v) => s + Number(v.vat), 0);
    const vatIn = pack.purchases.reduce((s, p) => s + Number(p.vat ?? 0), 0);
    return {
      ttc: pack.vat.reduce((s, v) => s + Number(v.ttc), 0), ht: pack.vat.reduce((s, v) => s + Number(v.ht), 0), vatOut, vatIn,
      buy: pack.purchases.reduce((s, p) => s + Number(p.ttc ?? 0), 0), noVat: pack.purchases.filter(p => p.ttc && p.vat == null).length,
    };
  }, [pack]);
  const base = pack ? `${fileSlug(pack.restaurant.name)}-${month}` : month;
  const fail = (e: unknown) => (a ? a.fail(e) : setErr(String((e as Error).message)));

  const excel = async () => {
    if (!pack || !sum) return;
    setBusy('xlsx');
    try {
      const R = pack.restaurant;
      const m = (c: number | null | undefined) => (c == null ? null : { money: Number(c) });
      const blob = await workbook([
        { name: t('Résumé'), widths: [42, 18, 18, 18], rows: [
          [{ b: R.legal_name || R.name }], [R.name], [R.ice ? `ICE ${R.ice}` : ''], [[R.tax_id ? `IF ${R.tax_id}` : '', R.rc ? `RC ${R.rc}` : ''].filter(Boolean).join(' · ')], [[R.address, R.city].filter(Boolean).join(', ')],
          [t('Période : du {a} au {b}', { a: dmy(pack.from), b: dmy(pack.to) })], [],
          [{ b: t('Ventes') }, { b: 'HT' }, { b: t('TVA') }, { b: 'TTC' }],
          ...pack.vat.map(v => [t('TVA {r} %', { r: Number(v.rate) / 100 }), m(v.ht), m(v.vat), m(v.ttc)]),
          [{ b: t('Total') }, m(sum.ht), m(sum.vatOut), m(sum.ttc)], [],
          [{ b: t('Encaissements') }, { b: t('Montant') }],
          ...Object.entries(pack.payments).map(([k, v]) => [t(METHOD[k] ?? k), m(v)]), [],
          [{ b: t('Achats (factures fournisseurs)') }, { b: 'TTC' }, { b: t('TVA') }],
          [t('{n} factures', { n: pack.purchases.length }), m(sum.buy), m(sum.vatIn)],
          ...(sum.noVat ? [[t('Dont {n} sans TVA renseignée', { n: sum.noVat })]] : []), [],
          [{ b: t('TVA estimée de la période') }, m(sum.vatOut - sum.vatIn)], [t('Estimation, à vérifier par votre comptable.')], [],
          [{ b: t('Caisse') }], [t('Sorties de caisse'), m(pack.cash.payouts)], [t('Versements en banque'), m(pack.cash.deposits)],
          [t('Achats notés dans le stock (contrôle)'), m(pack.stock_purchases_cents)],
        ] },
        { name: t('Ventes par jour'), widths: [14, 10, 16, 16, 16], rows: [
          [{ b: t('Date') }, { b: t('Tickets') }, { b: 'HT' }, { b: t('TVA') }, { b: 'TTC' }],
          ...pack.days.map(d => [dmy(d.date), Number(d.tickets), m(d.ht), m(d.vat), m(d.ttc)]),
        ] },
        { name: t('Factures émises'), widths: [18, 12, 30, 20, 14, 14, 14], rows: [
          [{ b: t('Numéro') }, { b: t('Date') }, { b: t('Client') }, { b: 'ICE' }, { b: 'HT' }, { b: t('TVA') }, { b: 'TTC' }],
          ...pack.invoices.map(i => [i.number, dmy(i.date), i.buyer ?? '', i.ice ?? '', m(i.ht), m(i.vat), m(i.ttc)]),
        ] },
        { name: t('Achats'), widths: [12, 30, 16, 14, 14, 10], rows: [
          [{ b: t('Date') }, { b: t('Fournisseur') }, { b: t('Numéro') }, { b: 'TTC' }, { b: t('TVA') }, { b: t('Pages') }],
          ...pack.purchases.map(p => [dmy(p.date), p.supplier, p.number ?? '', m(p.ttc), m(p.vat), Number(p.pages)]),
        ] },
        { name: t('Écritures'), widths: [8, 12, 14, 12, 44, 14, 14], rows: [
          [{ b: t('Journal') }, { b: t('Date') }, { b: t('Pièce') }, { b: t('Compte') }, { b: t('Libellé') }, { b: t('Débit') }, { b: t('Crédit') }],
          ...pack.entries.map(e => [e.journal, dmy(e.date), e.piece, e.account, e.label, e.debit ? m(e.debit) : null, e.credit ? m(e.credit) : null]),
        ] },
      ]);
      download(blob, `${base}-comptabilite.xlsx`);
    } catch (e) { fail(e); }
    setBusy('');
  };

  const invoicesZip = async () => {
    if (!r) return;
    setBusy('zip');
    try {
      const docs = check(await supabase.from('supplier_documents').select('id, doc_date, supplier_name, file_path, mime_type, suppliers(name)')
        .eq('restaurant_id', r.id).gte('doc_date', from).lte('doc_date', to).order('doc_date').limit(300)) as unknown as { id: string; doc_date: string; supplier_name: string | null; file_path: string; mime_type: string; suppliers: { name: string } | null }[];
      if (!docs.length) { a.toast(t('Aucune facture fournisseur pour ce mois.'), 'error'); setBusy(''); return; }
      const urls = await signedUrls(docs.map(d => d.file_path));
      const { default: JSZip } = await import('jszip');
      const z = new JSZip();
      let n = 0;
      for (const d of docs) {
        const u = urls[d.file_path]; if (!u) continue;
        const res = await fetch(u); if (!res.ok) continue;
        const ext = d.mime_type === 'application/pdf' ? 'pdf' : d.mime_type.split('/')[1] || 'jpg';
        z.file(`${d.doc_date}_${fileSlug(d.suppliers?.name || d.supplier_name || 'fournisseur')}_${++n}.${ext}`, await res.blob());
      }
      download(await z.generateAsync({ type: 'blob' }), `${base}-factures-fournisseurs.zip`);
    } catch (e) { fail(e); }
    setBusy('');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <h1 className="font-display text-3xl font-semibold">{t('Comptabilité')}{accountantKey && pack ? ` · ${pack.restaurant.name}` : ''}</h1>
          <p className="text-muted">{accountantKey ? t('Les chiffres et les fichiers du restaurant, prêts pour votre logiciel.') : t('Les chiffres du mois et les fichiers pour votre comptable, prêts à importer.')}</p>
        </div>
        <label className="text-sm font-semibold">{t('Mois')}<input type="month" className={`${inputCls} mt-1 w-44`} value={month} max={new Date().toISOString().slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
      </div>

      {err && <p className="rounded-2xl bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">{err}</p>}
      {!pack && !err && <p className="text-muted">{t('Chargement…')}</p>}

      {pack && sum && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t('Ventes TTC')} value={mad(sum.ttc)} sub={t('{n} HT', { n: mad(sum.ht) })} />
          <Stat label={t('TVA facturée')} value={mad(sum.vatOut)} />
          <Stat label={t('Achats (factures)')} value={mad(sum.buy)} sub={t('TVA récupérable {n}', { n: mad(sum.vatIn) })} />
          <Stat label={t('TVA estimée')} value={mad(sum.vatOut - sum.vatIn)} sub={t('À vérifier par votre comptable')} tone />
        </div>
        {sum.noVat > 0 && <p className="rounded-2xl bg-warn/15 px-4 py-3 text-sm text-warn">{t('{n} factures fournisseurs sans TVA : elles sont comptées sans TVA récupérable. Ajoutez la TVA dans Fournisseurs pour qu’elle soit déduite.', { n: sum.noVat })}</p>}

        <Card>
          <h2 className="mb-1 font-display text-xl font-semibold">{t('Les fichiers du mois')}</h2>
          <p className="mb-4 text-sm text-muted">{t('{n} écritures, du {a} au {b}.', { n: pack.entries.length, a: dmy(pack.from), b: dmy(pack.to) })}</p>
          <div className="flex flex-wrap gap-2">
            <Btn tone="brand" disabled={!!busy} onClick={excel}><FileSpreadsheet className="h-4 w-4" /> {t('Dossier Excel du mois')}</Btn>
            <Btn disabled={!pack.entries.length} onClick={() => download(entriesCsv(pack, true), `${base}-ecritures-sage.csv`)}><Download className="h-4 w-4" /> {t('Écritures pour Sage')}</Btn>
            <Btn disabled={!pack.entries.length} onClick={() => download(entriesCsv(pack, false), `${base}-ecritures.csv`)}><Download className="h-4 w-4" /> {t('Écritures pour Odoo et autres')}</Btn>
            {r && <Btn disabled={!!busy} onClick={invoicesZip}><FileArchive className="h-4 w-4" /> {busy === 'zip' ? t('Préparation…') : t('Factures fournisseurs (photos)')}</Btn>}
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-xs text-muted"><tr><th className="py-1.5 text-start">{t('Journal')}</th><th className="text-start">{t('Date')}</th><th className="text-start">{t('Compte')}</th><th className="text-start">{t('Libellé')}</th><th className="text-end">{t('Débit')}</th><th className="text-end">{t('Crédit')}</th></tr></thead>
              <tbody>
                {pack.entries.slice(0, 12).map((e, i) => (
                  <tr key={i} className="border-t border-line/10"><td className="py-1.5" title={t(JOURNALS[e.journal] ?? e.journal)}>{e.journal}</td><td className="tabular">{dmy(e.date)}</td><td className="tabular">{e.account}</td><td className="max-w-[260px] truncate">{e.label}</td>
                    <td className="text-end tabular">{e.debit ? mad(e.debit) : ''}</td><td className="text-end tabular">{e.credit ? mad(e.credit) : ''}</td></tr>
                ))}
              </tbody>
            </table>
            {pack.entries.length > 12 && <p className="mt-2 text-xs text-muted">{t('Et {n} autres lignes dans les fichiers.', { n: pack.entries.length - 12 })}</p>}
          </div>
        </Card>

        {r && <AccountantLink r={r} />}
        <AccountsCard r={r} accountantKey={accountantKey} accounts={pack.accounts} onSaved={load} />
        <Guide />
      </>}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ring-1 ${tone ? 'bg-brand/10 ring-brand/20' : 'bg-surface ring-line/10'}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** The private link for the accountant (owner only). */
function AccountantLink({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [key, setKey] = useState<string | null>(r.accounting_token ?? null);
  const owner = a.role === 'owner' || a.isAdmin;
  const url = key ? `${location.origin}/compta/${key}` : '';
  const set = async (on: boolean) => {
    if (!on && !window.confirm(t('Couper le lien ? Votre comptable ne pourra plus l’ouvrir.'))) return;
    try { const res = await rpc<{ key: string | null }>('accounting_link', { p_restaurant_id: r.id, p_on: on }); setKey(res.key); await a.reload(); a.toast(on ? t('Nouveau lien prêt') : t('Lien coupé')); } catch (e) { a.fail(e); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Link2 className="h-5 w-5 text-brand" />{t('Le lien pour votre comptable')}</h2>
      <p className="mb-4 text-sm text-muted">{t('Votre comptable ouvre cette page sans compte et télécharge lui-même les fichiers de chaque mois. Il peut aussi y régler ses numéros de comptes.')}</p>
      {!owner ? <p className="text-sm text-muted">{t('Seul le propriétaire peut créer ce lien.')}</p> : key ? (
        <div className="space-y-3">
          <p className="truncate rounded-xl bg-surface-2 px-3 py-2 text-sm" dir="ltr">{url}</p>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={copy}><Copy className="h-4 w-4" /> {t('Copier')}</Btn>
            <a className="inline-flex items-center gap-2 rounded-xl bg-[#1FA855] px-4 py-2 font-semibold text-white" target="_blank" rel="noopener" href={`https://wa.me/?text=${encodeURIComponent(t('Bonjour, voici l’accès à la comptabilité de {name} (ventes, achats, écritures pour Sage) : {u}', { name: r.name, u: url }))}`}><MessageCircle className="h-4 w-4" /> WhatsApp</a>
            <Btn onClick={() => set(true)}><RefreshCw className="h-4 w-4" /> {t('Nouveau lien')}</Btn>
            <Btn tone="danger" onClick={() => set(false)}><Unlink className="h-4 w-4" /> {t('Couper le lien')}</Btn>
          </div>
        </div>
      ) : <Btn tone="brand" onClick={() => set(true)}><Link2 className="h-4 w-4" /> {t('Créer le lien')}</Btn>}
    </Card>
  );
}

/** The account numbers (PCGE defaults), set once by the accountant or the owner. */
function AccountsCard({ r, accountantKey, accounts, onSaved }: { r?: Restaurant; accountantKey?: string; accounts: Record<string, string>; onSaved: () => void }) {
  const a = useAdminCtx();
  const [v, setV] = useState(accounts);
  const [busy, setBusy] = useState(false);
  const can = !!accountantKey || a.role === 'owner' || a.isAdmin;
  const ok = Object.values(v).every(x => /^[0-9A-Za-z]{1,15}$/.test(x));
  const save = async (reset = false) => {
    setBusy(true);
    const body = reset ? {} : v;
    try {
      if (accountantKey) await rpc('accounting_set_accounts_by_key', { p_key: accountantKey, p_accounts: body });
      else check(await supabase.from('restaurants').update({ accounting: body }).eq('id', r!.id).select('id'));
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Card>
      <h2 className="mb-1 font-display text-xl font-semibold">{t('Numéros de comptes')}</h2>
      <p className="mb-4 text-sm text-muted">{t('Selon le plan comptable marocain (PCGE). Votre comptable peut les remplacer par ses propres comptes : ils servent ensuite pour tous les mois.')}</p>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {ACCOUNTS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1">{t(label)}</span>
            <span className="w-32 shrink-0"><input className={`${inputCls} text-end tabular`} dir="ltr" disabled={!can} value={v[k] ?? ''} maxLength={15} onChange={e => setV({ ...v, [k]: e.target.value.trim() })} /></span>
          </label>
        ))}
      </div>
      {can && <div className="mt-4 flex flex-wrap gap-2"><Btn tone="brand" disabled={busy || !ok} onClick={() => save()}>{t('Enregistrer')}</Btn><Btn disabled={busy} onClick={() => save(true)}>{t('Revenir aux comptes par défaut')}</Btn></div>}
    </Card>
  );
}

function Guide() {
  return (
    <Card>
      <h2 className="mb-3 font-display text-xl font-semibold">{t('Importer les écritures')}</h2>
      <div className="grid gap-6 text-sm md:grid-cols-2">
        <div>
          <h3 className="mb-2 font-semibold">Sage</h3>
          <ol className="list-decimal space-y-1.5 ps-5 text-muted">
            <li>{t('La première fois, créez un format d’import paramétrable pour les écritures (Sage 100 : Fichier, Format import/export paramétrable. Sage 50 : Dossier, Options, Imports paramétrables).')}</li>
            <li>{t('Séparateur : point-virgule. Pas de ligne de titres. Colonnes dans cet ordre : code journal, date (JJ/MM/AAAA), numéro de pièce, compte général, libellé, débit, crédit.')}</li>
            <li>{t('Chaque mois, téléchargez « Écritures pour Sage » et importez-le avec ce format.')}</li>
          </ol>
        </div>
        <div>
          <h3 className="mb-2 font-semibold">{t('Odoo et autres logiciels')}</h3>
          <ol className="list-decimal space-y-1.5 ps-5 text-muted">
            <li>{t('Téléchargez « Écritures pour Odoo et autres » (UTF-8, avec une ligne de titres).')}</li>
            <li>{t('Importez-le comme pièces comptables et faites correspondre les colonnes : Journal, Date, Pièce, Compte, Libellé, Débit, Crédit.')}</li>
            <li>{t('Les journaux : VE ventes (une pièce par jour), HA achats, CA caisse, BQ banque. Chaque pièce est équilibrée.')}</li>
          </ol>
        </div>
      </div>
    </Card>
  );
}
