// Customer file and loyalty points. OFF until the owner switches it on: only then
// are phone numbers kept (law 09-08: keep only what is needed, with consent for messages).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cake, Copy, Gift, MessageCircle, NotebookPen, Pencil, Printer, Search, ShieldCheck, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, fromCents, mad, rpc, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, Toggle, inputCls } from '../components/ui';

interface Customer {
  id: string; phone: string; name: string | null; birthday: string | null; note: string | null; marketing_ok: boolean;
  points: number; visits: number; spent_cents: number; first_visit_at: string | null; last_visit_at: string | null; created_at: string;
  credit_allowed: boolean; credit_limit_cents: number | null; balance_cents: number;
}
type Loyalty = NonNullable<Restaurant['loyalty']>;
type Filter = 'all' | 'birthday' | 'whatsapp' | 'lost' | 'debt';

export function CustomersPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const loyalty: Loyalty = r.loyalty ?? {};
  const [list, setList] = useState<Customer[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [edit, setEdit] = useState<Customer | null>(null);
  const [settings, setSettings] = useState(false);

  const load = useCallback(async () => {
    if (!loyalty.customers) { setList([]); return; }
    try { setList(check(await supabase.from('customers').select('*').eq('restaurant_id', r.id).order('last_visit_at', { ascending: false, nullsFirst: false }).limit(2000)) as Customer[]); }
    catch (e) { a.fail(e); setList([]); }
  }, [r.id, loyalty.customers, a]);
  useEffect(() => { load(); }, [load]);

  const month = new Date().getMonth() + 1;
  const shown = useMemo(() => {
    const f = q.trim().toLowerCase().replace(/\s/g, '');
    return (list ?? []).filter(c =>
      (!f || (c.name ?? '').toLowerCase().includes(f) || c.phone.includes(f.replace(/\D/g, '') || '§'))
      && (filter === 'all'
        || (filter === 'birthday' && c.birthday && Number(c.birthday.slice(5, 7)) === month)
        || (filter === 'whatsapp' && c.marketing_ok)
        || (filter === 'debt' && Number(c.balance_cents) !== 0)
        || (filter === 'lost' && c.last_visit_at && Date.now() - Date.parse(c.last_visit_at) > 30 * 864e5 && c.visits >= 2)));
  }, [list, q, filter, month]);

  const saveLoyalty = async (l: Loyalty) => {
    try {
      check(await supabase.from('restaurants').update({ loyalty: l }).eq('id', r.id).select('id'));
      await a.reload(); a.toast(t('Enregistré'));
    } catch (e) { a.fail(e); }
  };
  const copyNumbers = async () => {
    const nums = shown.filter(c => c.marketing_ok).map(c => c.phone).join('\n');
    try { await navigator.clipboard.writeText(nums); a.toast(t('{n} numéros copiés', { n: shown.filter(c => c.marketing_ok).length })); } catch { a.toast(t('Copie impossible'), 'error'); }
  };

  if (!loyalty.customers) {
    return (
      <div>
        <h1 className="mb-6 font-display text-3xl font-semibold">{t('Clients')}</h1>
        <div className="night rounded-[2rem] p-6 md:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{t('Option')}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{t('Un fichier clients et des points de fidélité')}</h2>
          <ul className="mt-4 space-y-2 text-white/75">
            <li>• {t('Chaque client est reconnu par son numéro : commandes à emporter, livraison, menu QR, ou associé à la caisse.')}</li>
            <li>• {t('Vous voyez qui revient, combien il dépense, sa dernière visite et son anniversaire.')}</li>
            <li>• {t('Points de fidélité : par exemple 1 point par 10 DH, 100 points = 50 DH offerts.')}</li>
            <li>• {t('Les numéros des clients d’accord pour vos offres WhatsApp, prêts à copier.')}</li>
          </ul>
          <p className="mt-4 flex items-start gap-2 rounded-2xl bg-white/5 p-3 text-sm text-white/70"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            {t('Désactivé par défaut. Une fois activé, les numéros sont gardés pour ce restaurant seulement, visibles par le propriétaire et les managers. La caisse ne montre que le client recherché, jamais la liste. Loi 09-08 : informez vos clients (par exemple sur le ticket ou à la caisse).')}</p>
          {a.canEditProfile
            ? <Btn tone="brand" className="mt-5" onClick={() => saveLoyalty({ ...loyalty, customers: true })}><Users className="h-4 w-4" /> {t('Activer le fichier clients')}</Btn>
            : <p className="mt-5 text-sm text-white/60">{t('Seul le propriétaire peut activer cette option.')}</p>}
        </div>
      </div>
    );
  }

  const credit = !!loyalty.credit;
  const owed = (list ?? []).reduce((s, c) => s + Math.max(0, Number(c.balance_cents)), 0);
  const FILTERS: [Filter, string][] = [['all', t('Tous ({n})', { n: list?.length ?? 0 })], ...(credit ? [['debt', t('Ardoises ouvertes')] as [Filter, string]] : []), ['birthday', t('Anniversaire ce mois')], ['whatsapp', t('D’accord pour WhatsApp')], ['lost', t('Ne reviennent plus')]];
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <h1 className="font-display text-3xl font-semibold">{t('Clients')}</h1>
          <p className="text-muted">{loyalty.enabled
            ? t('Points de fidélité : 1 point par {d} DH, {p} points = {m} offerts.', { d: loyalty.per_dh ?? 10, p: loyalty.reward_points ?? 100, m: mad(loyalty.reward_cents ?? 5000) })
            : t('Fichier clients actif. Points de fidélité désactivés.')}</p>
        </div>
        <div className="relative w-60">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} ps-9`} placeholder={t('Nom ou téléphone')} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {a.canEditProfile && <Btn onClick={() => setSettings(true)}><Gift className="h-4 w-4" /> {t('Fidélité et ardoise')}</Btn>}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${filter === k ? 'bg-night text-white' : 'bg-surface-2 text-muted hover:text-ink'}`}>{l}</button>)}
        {credit && owed > 0 && <span className="ms-auto flex items-center gap-1.5 rounded-full bg-warn/15 px-3 py-1.5 text-sm font-bold text-warn"><NotebookPen className="h-4 w-4" /> {t('Total des ardoises : {m}', { m: mad(owed) })}</span>}
        {filter === 'whatsapp' && shown.length > 0 && <Btn className="ms-auto px-3 py-1.5" onClick={copyNumbers}><Copy className="h-4 w-4" /> {t('Copier les numéros')}</Btn>}
      </div>

      <div className="card overflow-x-auto rounded-3xl">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3 text-start">{t('Client')}</th>
              <th className="px-3 py-3 text-end">{t('Visites')}</th>
              <th className="px-3 py-3 text-end">{t('Dépensé')}</th>
              {loyalty.enabled && <th className="px-3 py-3 text-end">{t('Points')}</th>}
              {credit && <th className="px-3 py-3 text-end">{t('Ardoise')}</th>}
              <th className="px-3 py-3 text-end">{t('Dernière visite')}</th>
              <th className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/10">
            {shown.map(c => (
              <tr key={c.id} onClick={() => setEdit(c)} className="cursor-pointer hover:bg-surface-2/60">
                <td className="px-4 py-2.5">
                  <p className="flex items-center gap-1.5 font-semibold">{c.name || t('Sans nom')}
                    {c.birthday && Number(c.birthday.slice(5, 7)) === month && <Cake className="h-4 w-4 text-brand" />}
                    {c.marketing_ok && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[10px] font-bold text-ok">WhatsApp</span>}</p>
                  <p dir="ltr" className="text-xs text-muted rtl:text-end">{c.phone}</p>
                </td>
                <td className="px-3 py-2.5 text-end tabular">{c.visits}</td>
                <td className="px-3 py-2.5 text-end tabular">{mad(c.spent_cents)}</td>
                {loyalty.enabled && <td className="px-3 py-2.5 text-end font-semibold tabular">{c.points}</td>}
                {credit && <td className={`px-3 py-2.5 text-end tabular ${Number(c.balance_cents) > 0 ? 'font-bold text-warn' : 'text-muted'}`}>{Number(c.balance_cents) !== 0 ? mad(Number(c.balance_cents)) : c.credit_allowed ? '0' : '—'}</td>}
                <td className="px-3 py-2.5 text-end text-muted">{c.last_visit_at ? new Date(c.last_visit_at).toLocaleDateString(dateLocale()) : '—'}</td>
                <td className="px-3 py-2.5 text-end"><Pencil className="inline h-4 w-4 text-muted" /></td>
              </tr>
            ))}
            {list !== null && !shown.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">{t('Aucun client pour le moment. Ils arrivent avec les commandes qui ont un numéro de téléphone.')}</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && <CustomerEditor c={edit} points={!!loyalty.enabled} credit={credit} r={r} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {settings && <LoyaltySettings loyalty={loyalty} onClose={() => setSettings(false)} onSave={l => { setSettings(false); saveLoyalty(l); }} />}
    </div>
  );
}

function CustomerEditor({ c, points, credit, r, onClose, onSaved }: { c: Customer; points: boolean; credit: boolean; r: Restaurant; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [f, setF] = useState({ name: c.name ?? '', birthday: c.birthday ?? '', note: c.note ?? '', marketing_ok: c.marketing_ok, points: String(c.points),
    credit_allowed: c.credit_allowed, limit: fromCents(c.credit_limit_cents ?? 50000) });
  const [statement, setStatement] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const save = async () => {
    try {
      check(await supabase.from('customers').update({ name: f.name.trim() || null, birthday: f.birthday || null, note: f.note.trim() || null, marketing_ok: f.marketing_ok,
        points: Math.max(0, Math.round(Number(f.points) || 0)),
        ...(credit ? { credit_allowed: f.credit_allowed, credit_limit_cents: f.credit_allowed ? Math.max(0, toCents(f.limit)) : c.credit_limit_cents } : {}) }).eq('id', c.id).select('id'));
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
  };
  const remove = async () => {
    try { check(await supabase.from('customers').delete().eq('id', c.id).select('id')); a.toast(t('Client supprimé')); onSaved(); } catch (e) { a.fail(e); }
  };
  return (
    <Modal title={c.name || c.phone} onClose={onClose}
      footer={<div className="flex justify-between"><Btn tone="danger" onClick={remove}>{t('Supprimer (droit à l’oubli)')}</Btn><Btn tone="brand" onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <p className="text-sm text-muted"><span dir="ltr">{c.phone}</span> · {t('{v} visite(s)', { v: c.visits })} · {mad(c.spent_cents)}{c.first_visit_at ? ` · ${t('client depuis le {d}', { d: new Date(c.first_visit_at).toLocaleDateString(dateLocale()) })}` : ''}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Prénom')}><input className={inputCls} maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('Anniversaire')}><input type="date" className={inputCls} value={f.birthday} onChange={e => setF({ ...f, birthday: e.target.value })} /></Field>
        </div>
        {points && <Field label={t('Points')} hint={t('Correction manuelle, enregistrée dans le journal.')}><input className={`${inputCls} w-32`} inputMode="numeric" value={f.points} onChange={e => setF({ ...f, points: e.target.value.replace(/\D/g, '') })} /></Field>}
        <Field label={t('Note')}><input className={inputCls} maxLength={300} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={t('Allergie, table préférée…')} /></Field>
        <Toggle checked={f.marketing_ok} onChange={v => setF({ ...f, marketing_ok: v })} label={t('D’accord pour recevoir les offres sur WhatsApp')} />
        {credit && (
          <div className="rounded-2xl bg-surface-2 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <NotebookPen className="h-5 w-5 text-brand" />
              <p className="me-auto font-semibold">{t('Ardoise')}</p>
              <p className={`font-display text-2xl font-semibold tabular ${Number(c.balance_cents) > 0 ? 'text-warn' : ''}`}>{mad(Number(c.balance_cents))}</p>
            </div>
            <div className="mt-3 grid items-end gap-3 sm:grid-cols-2">
              <Toggle checked={f.credit_allowed} onChange={v => setF({ ...f, credit_allowed: v })} label={t('Peut payer plus tard')} />
              {f.credit_allowed && <Field label={t('Plafond (DH)')}><input className={inputCls} inputMode="decimal" value={f.limit} onChange={e => setF({ ...f, limit: e.target.value })} /></Field>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn onClick={() => setStatement(true)}><Printer className="h-4 w-4" /> {t('Relevé du mois')}</Btn>
              <Btn tone="ghost" onClick={() => setAdjust(true)}>{t('Corriger le solde')}</Btn>
            </div>
          </div>
        )}
      </div>
      {statement && <Statement c={c} r={r} onClose={() => setStatement(false)} />}
      {adjust && <AdjustBalance c={c} onClose={() => setAdjust(false)} onDone={() => { setAdjust(false); onSaved(); }} />}
    </Modal>
  );
}

function LoyaltySettings({ loyalty, onClose, onSave }: { loyalty: Loyalty; onClose: () => void; onSave: (l: Loyalty) => void }) {
  const [on, setOn] = useState(!!loyalty.enabled);
  const [credit, setCredit] = useState(!!loyalty.credit);
  const [per, setPer] = useState(String(loyalty.per_dh ?? 10));
  const [pts, setPts] = useState(String(loyalty.reward_points ?? 100));
  const [val, setVal] = useState(fromCents(loyalty.reward_cents ?? 5000));
  const p = Math.max(1, Number(per) || 10), n = Math.max(1, Number(pts) || 100), v = toCents(val);
  // what the reward is worth compared to what the customer spent to get it
  const ratio = v / (n * p * 100);
  return (
    <Modal title={t('Fidélité et ardoise')} onClose={onClose}
      footer={<div className="flex justify-between">
        <Btn tone="ghost" className="text-danger" onClick={() => onSave({ ...loyalty, customers: false, enabled: false, credit: false })}>{t('Désactiver le fichier clients')}</Btn>
        <Btn tone="brand" onClick={() => onSave({ ...loyalty, customers: true, enabled: on, credit, per_dh: p, reward_points: n, reward_cents: v })}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <div className="rounded-2xl bg-surface-2 p-4">
          <Toggle checked={credit} onChange={setCredit} label={t('Ardoise : certains clients paient plus tard')} />
          <p className="mt-1.5 text-sm text-muted">{t('Vous choisissez qui y a droit et jusqu’à quel montant, client par client. Le ticket est émis à la vente, le client règle plus tard à la caisse.')}</p>
        </div>
        <Toggle checked={on} onChange={setOn} label={t('Points de fidélité')} />
        {on && <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('1 point tous les (DH)')}><input className={inputCls} inputMode="numeric" value={per} onChange={e => setPer(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label={t('Récompense à (points)')}><input className={inputCls} inputMode="numeric" value={pts} onChange={e => setPts(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label={t('Valeur offerte (DH)')}><input className={inputCls} inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} /></Field>
          </div>
          <p className="rounded-xl bg-surface-2 p-3 text-sm">{t('Le client dépense {s} pour gagner {m} : {pc} de remise.', { s: mad(n * p * 100), m: mad(v), pc: `${(ratio * 100).toFixed(1).replace('.', ',')} %` })}
            {ratio > 0.1 && <span className="block text-warn">{t('Attention : plus de 10 % de remise, c’est beaucoup pour un restaurant. Comparez avec votre marge.')}</span>}</p>
        </>}
      </div>
    </Modal>
  );
}

interface StatementLine { date: string; at: string; kind: 'sale' | 'refund' | 'payment' | 'adjust'; amount_cents: number; method: string | null; doc_number: string | null; note: string | null }
interface StatementData { from: string; to: string; opening_cents: number; closing_cents: number; debits_cents: number; credits_cents: number; balance_cents: number; lines: StatementLine[] }
const KIND: Record<StatementLine['kind'], string> = { sale: 'Achat à l’ardoise', refund: 'Avoir', payment: 'Règlement', adjust: 'Correction' };
const PAY: Record<string, string> = { cash: 'espèces', card: 'carte', transfer: 'virement' };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The monthly statement of one customer: to print, or to send on WhatsApp. */
function Statement({ c, r, onClose }: { c: Customer; r: Restaurant; onClose: () => void }) {
  const a = useAdminCtx();
  const [month, setMonth] = useState(() => ymd(new Date()).slice(0, 7));
  const [st, setSt] = useState<StatementData | null>(null);
  useEffect(() => {
    const [y, m] = month.split('-').map(Number);
    setSt(null);
    rpc<StatementData>('customer_statement', { p_customer_id: c.id, p_from: ymd(new Date(y, m - 1, 1)), p_to: ymd(new Date(y, m, 0)) }).then(setSt, e => a.fail(e));
  }, [month, c.id, a]);
  const day = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(dateLocale());
  const label = (l: StatementLine) => `${t(KIND[l.kind])}${l.doc_number ? ` ${l.doc_number}` : ''}${l.method ? ` (${t(PAY[l.method] ?? l.method)})` : ''}${l.note ? ` · ${l.note}` : ''}`;
  const wa = () => {
    if (!st) return;
    const lines = st.lines.map(l => `${day(l.date)}  ${label(l)}  ${l.amount_cents > 0 ? '+' : ''}${mad(Number(l.amount_cents))}`);
    const text = [t('Bonjour {n},', { n: c.name || '' }).replace(' ,', ','), t('Votre relevé {r} du mois :', { r: r.name }), '',
      t('Solde précédent : {m}', { m: mad(Number(st.opening_cents)) }), ...lines, '', t('Reste à payer : {m}', { m: mad(Number(st.closing_cents)) }), t('Merci !')].join('\n');
    const phone = c.phone.replace(/^0/, '212');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  const printIt = () => {
    if (!st) return;
    const esc = (x: string) => x.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
    const dir = document.documentElement.dir || 'ltr';
    const rows = st.lines.map(l => `<tr><td>${esc(day(l.date))}</td><td>${esc(label(l))}</td><td class="n">${l.amount_cents > 0 ? '+' : ''}${esc(mad(Number(l.amount_cents)))}</td></tr>`).join('');
    const w = window.open('', '_blank');
    if (!w) { a.toast(t('Autorisez les fenêtres pour imprimer.'), 'error'); return; }
    w.document.write(`<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(t('Relevé'))}</title><style>
      body{font:14px system-ui,sans-serif;color:#001E3E;margin:32px}h1{font-size:20px;margin:0}p{margin:4px 0;color:#4A5A6E}
      table{width:100%;border-collapse:collapse;margin-top:16px}td{padding:6px 4px;border-bottom:1px solid #e3e8ee}.n{text-align:end;white-space:nowrap}
      .tot{margin-top:16px;font-size:18px;font-weight:700;text-align:end}</style></head><body>
      <h1>${esc(r.name)}</h1><p>${esc(t('Relevé du mois {m}', { m: month }))}</p><p>${esc(c.name || '')} ${esc(c.phone)}</p>
      <table><tr><td></td><td>${esc(t('Solde précédent'))}</td><td class="n">${esc(mad(Number(st.opening_cents)))}</td></tr>${rows}</table>
      <p class="tot">${esc(t('Reste à payer : {m}', { m: mad(Number(st.closing_cents)) }))}</p></body></html>`);
    w.document.close(); w.focus(); w.print();
  };
  return (
    <Modal title={t('Relevé · {n}', { n: c.name || c.phone })} onClose={onClose} wide
      footer={<div className="flex flex-wrap justify-end gap-2 print:hidden">
        <Btn onClick={printIt} disabled={!st}><Printer className="h-4 w-4" /> {t('Imprimer')}</Btn>
        <Btn tone="brand" onClick={wa} disabled={!st}><MessageCircle className="h-4 w-4" /> {t('Envoyer sur WhatsApp')}</Btn>
      </div>}>
      <div className="space-y-4" id="statement">
        <div className="flex flex-wrap items-end gap-3">
          <div className="me-auto"><p className="font-semibold">{r.name}</p><p dir="ltr" className="text-sm text-muted rtl:text-end">{c.name ? `${c.name} · ` : ''}{c.phone}</p></div>
          <Field label={t('Mois')}><input type="month" className={`${inputCls} w-44 print:hidden`} value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></Field>
        </div>
        {!st ? <p className="text-muted">{t('Chargement…')}</p> : <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[[t('Solde précédent'), st.opening_cents], [t('Achats'), st.debits_cents], [t('Réglé ou déduit'), st.credits_cents], [t('Reste à payer'), st.closing_cents]].map(([l, v], i) => (
              <div key={i} className={`rounded-2xl p-3 ${i === 3 ? 'bg-night text-white' : 'bg-surface-2'}`}><p className={`text-xs ${i === 3 ? 'text-white/70' : 'text-muted'}`}>{l}</p><p className="font-display text-xl font-semibold tabular">{mad(Number(v))}</p></div>
            ))}
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line/10">
              {st.lines.map((l, i) => (
                <tr key={i}><td className="py-2 pe-3 text-muted">{day(l.date)}</td><td className="py-2">{label(l)}</td>
                  <td className={`py-2 text-end font-semibold tabular ${l.amount_cents < 0 ? 'text-ok' : ''}`}>{l.amount_cents > 0 ? '+' : ''}{mad(Number(l.amount_cents))}</td></tr>
              ))}
              {!st.lines.length && <tr><td colSpan={3} className="py-8 text-center text-muted">{t('Aucun mouvement ce mois-ci.')}</td></tr>}
            </tbody>
          </table>
          {month !== ymd(new Date()).slice(0, 7) && Number(st.balance_cents) !== Number(st.closing_cents) && <p className="text-sm text-muted">{t('Aujourd’hui, le client doit {m}.', { m: mad(Number(st.balance_cents)) })}</p>}
        </>}
      </div>
    </Modal>
  );
}

/** A correction by hand (forgotten payment, commercial gesture), always with a reason. */
function AdjustBalance({ c, onClose, onDone }: { c: Customer; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [dir, setDir] = useState<'down' | 'up'>('down');
  const [val, setVal] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = toCents(val) * (dir === 'down' ? -1 : 1);
  const save = async () => {
    setBusy(true);
    try { await rpc('customer_account_adjust', { p_customer_id: c.id, p_amount_cents: cents, p_note: note.trim() }); a.toast(t('Enregistré')); onDone(); }
    catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={t('Corriger le solde')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !cents || note.trim().length < 2} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('Pour un règlement oublié ou un geste commercial. Les ventes et règlements à la caisse se font tout seuls. Chaque correction est gardée dans le relevé.')}</p>
        <div className="flex gap-2">
          {(['down', 'up'] as const).map(d => <button key={d} onClick={() => setDir(d)} className={`flex-1 rounded-xl py-2.5 text-sm font-bold ${dir === d ? 'bg-night text-white' : 'bg-surface-2 text-muted'}`}>{d === 'down' ? t('Diminuer la dette') : t('Augmenter la dette')}</button>)}
        </div>
        <Field label={t('Montant (DH)')}><input autoFocus className={inputCls} inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} /></Field>
        <Field label={t('Motif')}><input className={inputCls} maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder={t('Réglé en dehors de la caisse, geste commercial…')} /></Field>
        <p className="rounded-xl bg-surface-2 p-3 text-sm">{t('Nouveau solde : {m}', { m: mad(Number(c.balance_cents) + cents) })}</p>
      </div>
    </Modal>
  );
}
