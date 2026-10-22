// Encaisser at the salon's till: the prestation is already there with who did it; add a prestation,
// a product, a discount or "offert" (with a reason); cash, card or both, the tip, the change. The
// ticket keeps who took the money (the person unlocked on the till), prints with the drawer, or goes
// to the client on WhatsApp.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Banknote, CheckCircle2, CreditCard, Gift, Heart, Layers, MessageCircle, Package, Plus, Printer, Scissors, Trash2 } from 'lucide-react';
import { usePos } from '../store';
import { rpc } from '../lib/data';
import { supabase as sb } from '../lib/supabase';

const MENU_URL = ((import.meta.env.VITE_MENU_URL as string) || 'https://menu.amplifygrowthstudio.com').replace(/\/$/, '');
import { mad, toCents } from '../lib/format';
import { t } from '../lib/i18n';
import * as P from '../lib/print';
import { Btn, Field, Modal, inputCls } from '../components/ui';
import { svcName, waLink, colorOf, type From, type Person, type Product, type Svc } from './data';

interface Line {
  key: number; kind: 'service' | 'product' | 'other' | 'pack' | 'pack_payment' | 'giftcard'; service_id: string | null; product_id?: string | null;
  use_pack?: string | null; pack_id?: string | null; client_pack_id?: string | null; max?: number; name: string; price: string; qty: number; staff_id: string;
}
interface Wallet {
  name: string | null;
  loyalty: { enabled: boolean; every: number; stamps: number; ready: boolean; type: 'percent' | 'amount'; value: number; name: string };
  packs: { id: string; name: string; service_id: string | null; left: number; total: number; expires_on: string; due_cents: number; session_cents: number }[];
}
interface PackOffer { id: string; name: string; service_id: string; sessions: number; price_cents: number }
type Made = { kind: 'pack' | 'giftcard'; code?: string; name?: string; amount_cents?: number; due_cents?: number; sessions?: number };
type Done = { number: number; share_token?: string; stamps?: number | null; every?: number | null; made?: Made[] };
let seq = 0;
const num = (s: string) => (s.trim() === '' ? 0 : /^\d+([.,]\d{0,2})?$/.test(s.trim()) ? toCents(s) : NaN);
const dh = (c: number) => String(c / 100);
const TILL_ERR: Record<string, string> = {
  day_closed: 'La caisse de ce jour est clôturée.', already_paid: 'Ce client est déjà encaissé.',
  payment_mismatch: 'Le paiement ne correspond pas au total.', free_reason_required: 'Indiquez pourquoi c’est offert.',
  voucher_used: 'Ce code a déjà servi.', voucher_not_today: 'Ce code n’est pas valable aujourd’hui.', voucher_unknown: 'Code inconnu.', voucher_min: 'Le minimum du code n’est pas atteint.',
  loyalty_not_ready: 'La carte de fidélité n’est pas encore complète.', phone_required: 'Un pack se vend avec le numéro de la cliente.',
  pack_empty: 'Ce pack n’a plus de séance.', pack_not_client: 'Ce pack appartient à une autre cliente.',
  giftcard_balance: 'Le solde de la carte cadeau ne suffit pas.', giftcard_unknown: 'Carte cadeau inconnue.', giftcard_expired: 'Cette carte cadeau a expiré.', giftcard_empty: 'Cette carte cadeau est épuisée.',
};
export const tillMessage = (e: unknown) => { const m = String((e as Error)?.message ?? e); const k = Object.keys(TILL_ERR).find(x => m.includes(x)); return k ? t(TILL_ERR[k]) : null; };

export function SalonCheckout({ from, people, services, products, onClose, onPaid }: { from: From; people: Person[]; services: Svc[]; products: Product[]; onClose: () => void; onPaid: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const first = services.find(s => s.id === from.service_id);
  const team = people.filter(p => p.agenda);
  const [lines, setLines] = useState<Line[]>(() => first || from.price_cents
    ? [{ key: ++seq, kind: 'service', service_id: first?.id ?? null, name: first ? svcName(first.name) : t('Prestation'), price: dh(from.price_cents ?? first?.price_cents ?? 0), qty: 1, staff_id: from.staff_id ?? '' }]
    : []);
  const [name, setName] = useState(from.name ?? '');
  const [phone, setPhone] = useState(from.phone ?? '');
  const [disc, setDisc] = useState(''); const [discWhy, setDiscWhy] = useState(''); const [free, setFree] = useState('');
  const [method, setMethod] = useState<'cash' | 'card' | 'both'>('cash');
  const [card, setCard] = useState(''); const [tip, setTip] = useState(''); const [given, setGiven] = useState('');
  const [adding, setAdding] = useState<'service' | 'product' | 'pack' | null>(null);
  const addProduct = (pr: Product) => setLines(ls => {
    const same = ls.find(l => l.product_id === pr.id);
    if (same) return ls.map(l => (l === same ? { ...l, qty: Math.min(99, l.qty + 1) } : l));
    return [...ls, { key: ++seq, kind: 'product', service_id: null, product_id: pr.id, name: pr.name, price: dh(pr.price_cents), qty: 1, staff_id: from.staff_id ?? ls.find(l => l.kind === 'service')?.staff_id ?? pos.staff?.id ?? '' }];
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [useLoyalty, setUseLoyalty] = useState(false);
  const [offers, setOffers] = useState<PackOffer[]>([]);
  const [gcode, setGcode] = useState('');
  const [ginfo, setGinfo] = useState<{ code: string; balance_cents: number; expires_on: string } | null>(null);
  const [gamount, setGamount] = useState('');
  const [gerr, setGerr] = useState<string | null>(null);
  // a code from a client's story (Le miroir), checked before paying
  const [vcode, setVcode] = useState('');
  const [vinfo, setVinfo] = useState<{ code: string; name: string; kind: 'percent' | 'amount' | 'gift'; value: number; min_cents: number } | null>(null);
  const [verr, setVerr] = useState<string | null>(null);

  const unitOf = (l: Line) => (l.use_pack ? (wallet?.packs.find(p => p.id === l.use_pack)?.session_cents ?? 0) : (num(l.price) || 0));
  const sub = lines.reduce((s, l) => s + unitOf(l) * l.qty, 0);
  const lc = wallet?.loyalty;
  const lred = useLoyalty && lc?.ready ? (lc.type === 'percent' ? Math.round(sub * Math.min(lc.value, 100) / 100) : Math.min(Math.round(lc.value * 100), sub)) : 0;
  const discount = num(disc); const tipC = num(tip);
  const vOk = !!vinfo && sub >= vinfo.min_cents;
  const vdisc = vOk ? (vinfo!.kind === 'percent' ? Math.round(sub * vinfo!.value / 10000) : vinfo!.kind === 'amount' ? Math.min(vinfo!.value, sub) : 0) : 0;
  const total = Math.max(0, sub - (discount || 0) - vdisc - lred);
  const packPaid = lines.reduce((s, l) => s + (l.use_pack ? unitOf(l) : 0), 0);
  const gPaid = ginfo ? Math.min(num(gamount) || 0, ginfo.balance_cents) : 0;
  const prepaid = packPaid + gPaid;
  const due = total + (tipC || 0) - prepaid;
  const cardC = method === 'card' ? due : method === 'both' ? (num(card) || 0) : 0;
  const cashC = due - cardC;
  const change = given && cashC > 0 ? num(given) - cashC : null;
  const bad = !lines.length || lines.some(l => !l.name.trim() || Number.isNaN(num(l.price))) || Number.isNaN(discount) || discount > sub
    || Number.isNaN(tipC) || cashC < 0 || due < 0 || (total === 0 && !free.trim() && !vinfo && !useLoyalty) || (!!vcode.trim() && !vOk)
    || lines.some(l => (l.kind === 'pack' || l.kind === 'pack_payment') && ((num(l.price) || 0) < 1 || (l.max != null && num(l.price) > l.max)))
    || lines.some(l => l.kind === 'giftcard' && (num(l.price) || 0) < 1000) || (lines.some(l => l.kind === 'pack') && phone.replace(/\D/g, '').length < 9)
    || (!!gcode.trim() && !ginfo);
  const digits = phone.replace(/\D/g, '');
  useEffect(() => {
    if (digits.length < 9) { setWallet(null); setUseLoyalty(false); return; }
    const id = window.setTimeout(() => { rpc<Wallet | null>('agenda_client_wallet', { p_restaurant_id: r.id, p_phone: digits }).then(w => setWallet(w ?? null)).catch(() => setWallet(null)); }, 350);
    return () => window.clearTimeout(id);
  }, [digits, r.id]);
  useEffect(() => {
    sb.from('agenda_packs').select('id,name,service_id,sessions,price_cents').eq('restaurant_id', r.id).eq('active', true).order('sort_order').order('name').then(x => setOffers((x.data ?? []) as PackOffer[]));
  }, [r.id]);
  const checkGift = async () => {
    setGerr(null); setGinfo(null);
    try {
      const x = await rpc<{ ok: boolean; error?: string; code: string; balance_cents: number; expires_on: string }>('agenda_giftcard_check', { p_restaurant_id: r.id, p_code: gcode.trim() });
      if (x.ok) { setGinfo(x); setGamount(dh(Math.min(x.balance_cents, Math.max(0, total + (tipC || 0) - packPaid)))); }
      else setGerr(t(TILL_ERR[x.error ?? 'giftcard_unknown'] ?? 'Carte cadeau inconnue.'));
    } catch (e) { pos.fail(e); }
  };
  const lineLabel = (l: Line) => (l.kind === 'giftcard' ? `${t('Carte cadeau')}${l.name.trim() ? ` · ${l.name.trim()}` : ''}` : l.name.trim());
  const madeText = (x: Made) => (x.kind === 'giftcard' ? `${t('Carte cadeau')} : ${x.code} (${mad(x.amount_cents ?? 0)})`
    : `${x.name} : ${t('{n} séances', { n: x.sessions ?? 0 })}${x.due_cents ? ` · ${t('reste à payer {m}', { m: mad(x.due_cents) })}` : ''}`);
  const checkCode = async () => {
    setVerr(null); setVinfo(null);
    try {
      const x = await rpc<{ ok: boolean; error?: string; code: string; name: string; kind: 'percent' | 'amount' | 'gift'; value: number; min_cents: number }>('agenda_voucher_check', { p_restaurant_id: r.id, p_code: vcode.trim() });
      if (x.ok) setVinfo(x); else setVerr(t(TILL_ERR[x.error ?? 'voucher_unknown'] ?? 'Code inconnu.'));
    } catch (e) { pos.fail(e); }
  };
  const set = (k: number, p: Partial<Line>) => setLines(ls => ls.map(l => (l.key === k ? { ...l, ...p } : l)));
  const who = (id: string) => people.find(p => p.id === id)?.name;

  const printIt = async (n: number, drawer: boolean, share?: string, d?: Done | null) => {
    try {
      await P.print(P.receiptPrinter(pos.settings), `Ticket ${n}`, P.salonTicket(r, {
        number: n, at: new Date().toISOString(), client: name.trim() || null, cashier: pos.staff?.name,
        lines: [...lines.map(l => ({ quantity: l.qty, name: l.use_pack ? `${lineLabel(l)} (${t('Pack')})` : lineLabel(l), line_cents: unitOf(l) * l.qty, staff: l.kind === 'service' && l.staff_id ? who(l.staff_id) : undefined })),
          ...(prepaid ? [{ quantity: 1, name: t('Payé par pack ou carte cadeau'), line_cents: -prepaid }] : []),
          ...(d?.made ?? []).map(x => ({ quantity: 1, name: madeText(x), line_cents: 0 })),
          ...(d?.every ? [{ quantity: 1, name: t('Fidélité : {a}/{b}', { a: d.stamps ?? 0, b: d.every }), line_cents: 0 }] : [])],
        discount_cents: (discount || 0) + vdisc + lred, total_cents: total, cash_cents: cashC, card_cents: cardC, tip_cents: tipC || 0,
        change_cents: change != null && change > 0 ? change : 0, free_reason: total === 0 ? free.trim() : null,
        mirror_url: share ? `${MENU_URL}/${r.slug}?miroir=${share}` : undefined,
      }), { drawer });
    } catch (e) { pos.fail(e); }
  };
  const pay = async () => {
    setBusy(true);
    try {
      const res = await rpc<Done>('agenda_checkout_by', { p_restaurant_id: r.id, p_cashier: pos.staff?.id ?? null, p: {
        appointment_id: from.appointment_id, queue_id: from.queue_id, name: name.trim() || undefined, phone: phone.replace(/\D/g, '') || undefined,
        lines: lines.map(l => ({ kind: l.kind, service_id: l.service_id, product_id: l.product_id ?? null, use_pack: l.use_pack ?? null, pack_id: l.pack_id ?? null,
          client_pack_id: l.client_pack_id ?? null, name: l.name.trim(), quantity: l.qty, unit_cents: l.use_pack ? 0 : num(l.price), staff_id: l.staff_id || null })),
        loyalty: useLoyalty && !!lc?.ready, giftcard_code: ginfo && gPaid > 0 ? ginfo.code : undefined, giftcard_cents: ginfo && gPaid > 0 ? gPaid : undefined,
        discount_cents: discount || 0, discount_reason: discWhy.trim() || undefined, free_reason: total === 0 ? free.trim() : undefined,
        cash_cents: cashC, card_cents: cardC, tip_cents: tipC || 0, voucher_code: vOk ? vinfo!.code : undefined,
      } });
      setDone(res);
      if (pos.printerOk) await printIt(res.number, cashC > 0, res.share_token, res);
    } catch (e) { const m = tillMessage(e); if (m) pos.toast(m, 'error'); else pos.fail(e); }
    setBusy(false);
  };
  const ticketText = () => [r.name, t('Ticket n° {n}', { n: done?.number ?? '' }), '',
    ...lines.map(l => `${l.qty > 1 ? `${l.qty} × ` : ''}${lineLabel(l)} : ${mad(unitOf(l) * l.qty)}`),
    ...(discount || vdisc || lred ? [`${t('Remise')} : -${mad((discount || 0) + vdisc + lred)}`] : []), `${t('Total')} : ${mad(total)}`,
    ...(prepaid ? [`${t('Payé par pack ou carte cadeau')} : ${mad(prepaid)}`] : []), ...(done?.made ?? []).map(madeText),
    ...(done?.every ? [`${t('Fidélité')} : ${done.stamps ?? 0}/${done.every}`] : []), '', t('Merci et à bientôt !'),
    ...(done?.share_token ? ['', t('Votre photo dans le miroir du salon :'), `${MENU_URL}/${r.slug}?miroir=${done.share_token}`] : [])].join('\n');

  const [mirrorQr, setMirrorQr] = useState<string | null>(null);
  useEffect(() => {
    if (!done?.share_token) return;
    QRCode.toDataURL(`${MENU_URL}/${r.slug}?miroir=${done.share_token}`, { margin: 1, width: 360 }).then(setMirrorQr).catch(() => setMirrorQr(null));
  }, [done?.share_token, r.slug]);

  if (done) return (
    <Modal title={t('Encaissé')} onClose={onPaid}>
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-ok" />
        <p className="font-display text-4xl font-semibold tabular">{mad(total)}</p>
        {(done.made ?? []).filter(x => x.kind === 'giftcard').map(x => (
          <div key={x.code} className="rounded-2xl border-2 border-dashed border-brand p-3"><p className="text-xs text-muted">{t('Carte cadeau')} · {mad(x.amount_cents ?? 0)}</p><p dir="ltr" className="font-display text-3xl font-semibold tracking-widest">{x.code}</p></div>
        ))}
        {(done.made ?? []).filter(x => x.kind === 'pack' && x.due_cents).map(x => <p key={x.name} className="font-semibold text-warn">{t('{name} : reste à payer {m}', { name: x.name ?? '', m: mad(x.due_cents ?? 0) })}</p>)}
        {done.every ? <p className="font-semibold">{t('Fidélité : {a}/{b}', { a: done.stamps ?? 0, b: done.every })}</p> : null}
        <p className="text-muted">{t('Ticket n° {n}', { n: done.number })}{tipC ? ` · ${t('pourboire {m}', { m: mad(tipC) })}` : ''}</p>
        {change != null && change > 0 && <p className="rounded-2xl bg-warn/15 py-3 text-xl font-bold text-warn">{t('Monnaie à rendre : {m}', { m: mad(change) })}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <Btn onClick={() => printIt(done.number, false, done.share_token, done)}><Printer className="h-4 w-4" /> {pos.printerOk ? t('Réimprimer') : t('Imprimer le ticket')}</Btn>
          {phone.replace(/\D/g, '').length >= 9 && <a href={waLink(phone, ticketText())} target="_blank" rel="noopener" className="flex items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-2.5 font-semibold text-white"><MessageCircle className="h-5 w-5" />WhatsApp</a>}
        </div>
        {mirrorQr && <div className="rounded-2xl bg-white p-3 text-[#0b1220]">
          <img src={mirrorQr} alt="" className="mx-auto h-36 w-36" />
          <p className="mt-2 text-sm font-semibold">{t('Le miroir : la cliente scanne et poste sa photo')}</p>
        </div>}
        <Btn tone="ok" className="w-full py-3.5 text-lg" onClick={onPaid}>{t('Terminé')}</Btn>
      </div>
    </Modal>
  );

  const chip = (on: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${on ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`;
  return (
    <Modal title={t('Encaisser')} onClose={onClose} wide
      footer={<div className="flex items-center gap-3">
        <div className="me-auto"><p className="text-xs text-muted">{t('À payer')}</p><p className="font-display text-3xl font-semibold tabular">{mad(due)}</p></div>
        <Btn onClick={onClose}>{t('Annuler')}</Btn>
        <Btn tone="ok" className="px-6 py-3.5 text-lg" disabled={busy || bad} onClick={pay}>{total === 0 ? <><Gift className="h-5 w-5" /> {t('Valider offert')}</> : <><CheckCircle2 className="h-5 w-5" /> {t('Encaisser')}</>}</Btn>
      </div>}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Client')}><input className={inputCls} maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder={t('Nom (facultatif)')} /></Field>
          <Field label={t('Téléphone')}><input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="06 12 34 56 78" /></Field>
        </div>
        {wallet && (wallet.loyalty.enabled || wallet.packs.length > 0) && (
          <div className="space-y-2 rounded-2xl bg-brand/10 p-3 ring-1 ring-brand/20">
            {wallet.loyalty.enabled && (
              <div className="flex flex-wrap items-center gap-3">
                <Heart className="h-5 w-5 text-brand" />
                <span className="font-semibold">{t('Fidélité : {a}/{b}', { a: Math.min(wallet.loyalty.stamps, wallet.loyalty.every), b: wallet.loyalty.every })}</span>
                <span className="flex gap-1">{Array.from({ length: wallet.loyalty.every }, (_, i) => <span key={i} className={`h-3 w-3 rounded-full ${i < wallet.loyalty.stamps ? 'bg-brand' : 'bg-line/20'}`} />)}</span>
                {wallet.loyalty.ready && <button onClick={() => setUseLoyalty(x => !x)} className={`ms-auto ${chip(useLoyalty)}`}><Gift className="me-1 inline h-4 w-4" />{useLoyalty ? t('Récompense appliquée : -{m}', { m: mad(lred) }) : t('Offrir : {name}', { name: wallet.loyalty.name })}</button>}
              </div>
            )}
            {wallet.packs.filter(p => p.due_cents > 0 && !lines.some(l => l.client_pack_id === p.id)).map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Layers className="h-4 w-4 text-warn" /><span className="flex-1">{t('{name} : reste à payer {m}', { name: p.name, m: mad(p.due_cents) })}</span>
                <Btn onClick={() => setLines(ls => [...ls, { key: ++seq, kind: 'pack_payment', service_id: null, client_pack_id: p.id, max: p.due_cents, name: t('Versement : {name}', { name: p.name }), price: dh(p.due_cents), qty: 1, staff_id: '' }])}>{t('Ajouter un versement')}</Btn>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2">
          {lines.map(l => (
            <div key={l.key} className="rounded-2xl bg-surface-2 p-3">
              <div className="flex items-center gap-2">
                {l.kind === 'service' ? <Scissors className="h-4 w-4 shrink-0 text-brand" /> : l.kind === 'giftcard' ? <Gift className="h-4 w-4 shrink-0 text-brand" /> : l.kind === 'pack' || l.kind === 'pack_payment' ? <Layers className="h-4 w-4 shrink-0 text-brand" /> : <Package className="h-4 w-4 shrink-0 text-brand" />}
                {l.kind === 'giftcard' ? <span className="font-semibold">{t('Carte cadeau')}</span> : null}
                <input className="min-w-0 flex-1 bg-transparent font-semibold outline-none" maxLength={l.kind === 'giftcard' ? 60 : 80} value={l.name} placeholder={l.kind === 'giftcard' ? t('Pour qui ? (facultatif)') : t('Nom du produit')}
                  readOnly={!!l.product_id || l.kind === 'pack' || l.kind === 'pack_payment'} onChange={e => set(l.key, { name: e.target.value })} aria-label={t('Nom')} />
                {(l.kind === 'product' || l.kind === 'other') && <select className="rounded-lg bg-bg/70 px-2 py-1.5 text-sm" value={l.qty} onChange={e => set(l.key, { qty: Number(e.target.value) })} aria-label={t('Quantité')}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} ×</option>)}</select>}
                {l.use_pack ? <span className="w-32 text-end font-semibold text-ok">{t('Pack')} · {mad(unitOf(l))}</span> : <div className="flex w-32 items-center rounded-xl bg-bg/70 px-2 ring-1 ring-line/10">
                  <input className="w-full bg-transparent py-2 text-end text-lg font-semibold tabular outline-none" inputMode="decimal" value={l.price} onChange={e => set(l.key, { price: e.target.value })} aria-label={t('Prix (DH)')} />
                  <span className="ps-1 text-xs text-muted">DH</span>
                </div>}
                <button className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:text-danger" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label={t('Supprimer')}><Trash2 className="h-4 w-4" /></button>
              </div>
              {l.kind === 'pack' && l.max != null && <p className="mt-1 text-xs text-muted">{t('Payé maintenant, sur {m}. Le reste se paie aux prochaines visites.', { m: mad(l.max) })}</p>}
              {l.kind === 'service' && !!wallet?.packs.some(p => p.left > 0 && (!p.service_id || !l.service_id || p.service_id === l.service_id)) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {wallet!.packs.filter(p => p.left > 0 && (!p.service_id || !l.service_id || p.service_id === l.service_id)).map(p => (
                    <button key={p.id} onClick={() => set(l.key, { use_pack: l.use_pack === p.id ? null : p.id })} className={chip(l.use_pack === p.id)}>
                      <Layers className="me-1 inline h-3.5 w-3.5" />{l.use_pack === p.id ? t('Payé par le pack : {name}', { name: p.name }) : t('Utiliser le pack {name} ({n} restantes)', { name: p.name, n: p.left })}</button>
                  ))}
                </div>
              )}
              {(l.kind === 'service' || l.kind === 'product') && team.length > 0 && (
                <div className="scroll-thin mt-2 flex gap-1.5 overflow-x-auto">
                  {l.kind === 'product' && <span className="shrink-0 self-center text-xs text-muted">{t('Vendu par')}</span>}
                  {team.map(p => <button key={p.id} onClick={() => set(l.key, { staff_id: l.kind === 'product' && l.staff_id === p.id ? '' : p.id })} className={chip(l.staff_id === p.id)}>
                    <span className="me-1.5 inline-block h-2 w-2 rounded-full" style={{ background: colorOf(p) }} />{p.name}</button>)}
                </div>
              )}
            </div>
          ))}
          {!lines.length && <p className="rounded-2xl border border-dashed border-line/20 p-4 text-center text-sm text-muted">{t('Ajoutez une prestation ou un produit.')}</p>}
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => setAdding(adding === 'service' ? null : 'service')}><Plus className="h-4 w-4" /> {t('Prestation')}</Btn>
            <Btn onClick={() => setAdding(adding === 'product' ? null : 'product')}><Package className="h-4 w-4" /> {t('Produit ou autre')}</Btn>
            {offers.length > 0 && <Btn onClick={() => setAdding(adding === 'pack' ? null : 'pack')}><Layers className="h-4 w-4" /> {t('Pack')}</Btn>}
            <Btn onClick={() => { setLines(ls => [...ls, { key: ++seq, kind: 'giftcard', service_id: null, name: '', price: '', qty: 1, staff_id: '' }]); setAdding(null); }}><Gift className="h-4 w-4" /> {t('Carte cadeau')}</Btn>
          </div>
          {adding === 'pack' && (
            <div className="flex flex-wrap gap-1.5 rounded-2xl bg-surface-2 p-3">
              {offers.map(o => (
                <button key={o.id} onClick={() => { setLines(ls => [...ls, { key: ++seq, kind: 'pack', service_id: null, pack_id: o.id, max: o.price_cents, name: o.name, price: dh(o.price_cents), qty: 1, staff_id: '' }]); setAdding(null); }}
                  className="rounded-xl bg-bg/70 px-3 py-2.5 text-start text-sm font-semibold">{o.name} <span className="text-muted tabular">{mad(o.price_cents)}</span>
                  <span className="block text-xs font-normal text-muted">{t('{n} séances', { n: o.sessions })}</span></button>
              ))}
              {digits.length < 9 && <p className="w-full text-xs text-warn">{t('Un pack se vend avec le numéro de la cliente.')}</p>}
            </div>
          )}
          {adding === 'product' && (
            <div className="flex flex-wrap gap-1.5 rounded-2xl bg-surface-2 p-3">
              {products.map(pr => (
                <button key={pr.id} onClick={() => addProduct(pr)} className="rounded-xl bg-bg/70 px-3 py-2.5 text-start text-sm font-semibold">
                  {pr.name} <span className="text-muted tabular">{mad(pr.price_cents)}</span>
                  <span className={`block text-xs font-normal ${pr.stock <= 0 ? 'text-danger' : pr.min_stock != null && pr.stock <= pr.min_stock ? 'text-warn' : 'text-muted'}`}>{pr.stock <= 0 ? t('Plus en stock') : t('{n} en stock', { n: pr.stock })}</span>
                </button>
              ))}
              <button onClick={() => { setLines(ls => [...ls, { key: ++seq, kind: 'other', service_id: null, product_id: null, name: '', price: '', qty: 1, staff_id: '' }]); setAdding(null); }}
                className="rounded-xl border border-dashed border-line/30 px-3 py-2.5 text-sm font-semibold text-muted">{t('Autre (texte libre)')}</button>
            </div>
          )}
          {adding === 'service' && (
            <div className="flex flex-wrap gap-1.5 rounded-2xl bg-surface-2 p-3">
              {services.map(s => (
                <button key={s.id} onClick={() => { setLines(ls => [...ls, { key: ++seq, kind: 'service', service_id: s.id, name: svcName(s.name), price: dh(s.price_cents), qty: 1, staff_id: from.staff_id ?? ls[0]?.staff_id ?? pos.staff?.id ?? '' }]); setAdding(null); }}
                  className="rounded-xl bg-bg/70 px-3 py-2.5 text-sm font-semibold">{svcName(s.name)} <span className="text-muted tabular">{mad(s.price_cents)}</span></button>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Remise (DH)')}><input className={inputCls} inputMode="decimal" value={disc} onChange={e => setDisc(e.target.value)} placeholder="0" /></Field>
          {discount > 0 && total > 0 && <Field label={t('Raison de la remise')}><input className={inputCls} maxLength={100} value={discWhy} onChange={e => setDiscWhy(e.target.value)} placeholder={t('Fidélité, geste commercial…')} /></Field>}
          <div className="sm:col-span-2">
            <Field label={t('Code d’une story (facultatif)')}>
              <div className="flex gap-2">
                <input className={`${inputCls} uppercase`} dir="ltr" maxLength={20} value={vcode} onChange={e => { setVcode(e.target.value.toUpperCase()); setVinfo(null); setVerr(null); }} placeholder="SA-XXXXXX" />
                <Btn onClick={checkCode} disabled={!vcode.trim()}>{t('Vérifier')}</Btn>
              </div>
            </Field>
            {vinfo && <p className={`mt-1 text-sm font-semibold ${vOk ? 'text-ok' : 'text-warn'}`}>{vOk ? t('{name} · appliqué : -{m}', { name: vinfo.name, m: mad(vdisc) }) : t('Minimum {m} de prestations', { m: mad(vinfo.min_cents) })}</p>}
            {verr && <p className="mt-1 text-sm font-semibold text-danger">{verr}</p>}
          </div>
          <div className="sm:col-span-2">
            <Field label={t('Payer avec une carte cadeau')}>
              <div className="flex gap-2">
                <input className={`${inputCls} uppercase`} dir="ltr" maxLength={20} value={gcode} onChange={e => { setGcode(e.target.value.toUpperCase()); setGinfo(null); setGerr(null); }} placeholder="KDO-XXXXXX" />
                {ginfo ? <input className={`${inputCls} w-32`} inputMode="decimal" value={gamount} onChange={e => setGamount(e.target.value)} aria-label={t('Montant (DH)')} />
                  : <Btn onClick={checkGift} disabled={!gcode.trim()}>{t('Vérifier')}</Btn>}
              </div>
            </Field>
            {ginfo && <p className="mt-1 text-sm font-semibold text-ok">{t('Solde : {m}', { m: mad(ginfo.balance_cents) })}</p>}
            {gerr && <p className="mt-1 text-sm font-semibold text-danger">{gerr}</p>}
          </div>
          {total === 0 && lines.length > 0 && !vinfo && !useLoyalty && <Field label={t('Pourquoi c’est offert ?')}><input className={inputCls} maxLength={100} value={free} onChange={e => setFree(e.target.value)} placeholder={t('Famille, retouche gratuite…')} /></Field>}
        </div>
        {prepaid > 0 && <p className="rounded-xl bg-ok/10 px-3 py-2 font-semibold text-ok">{t('Payé par pack ou carte cadeau : {m}', { m: mad(prepaid) })}</p>}
        {total > 0 && <>
          <div className="grid grid-cols-3 gap-2">
            {([['cash', Banknote, t('Espèces')], ['card', CreditCard, t('Carte')], ['both', Plus, t('Les deux')]] as const).map(([k, I, l]) => (
              <button key={k} onClick={() => setMethod(k)} className={`flex flex-col items-center gap-1 rounded-2xl py-4 font-semibold ring-1 ${method === k ? 'gold-fill text-brand-ink ring-brand' : 'bg-surface-2 ring-line/10'}`}><I className="h-6 w-6" />{l}</button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('Pourboire (DH)')}><input className={inputCls} inputMode="decimal" value={tip} onChange={e => setTip(e.target.value)} placeholder="0" /></Field>
            {method === 'both' && <Field label={t('Par carte (DH)')}><input className={inputCls} inputMode="decimal" value={card} onChange={e => setCard(e.target.value)} /></Field>}
            {method !== 'card' && cashC > 0 && <Field label={t('Espèces reçues (DH)')}><input className={inputCls} inputMode="decimal" value={given} onChange={e => setGiven(e.target.value)} placeholder={dh(cashC)} /></Field>}
          </div>
          {change != null && change > 0 && <p className="text-lg font-bold text-warn">{t('Monnaie à rendre : {m}', { m: mad(change) })}</p>}
          {method === 'both' && <p className="text-sm text-muted">{t('Espèces : {a} · Carte : {b}', { a: mad(Math.max(0, cashC)), b: mad(cardC) })}</p>}
        </>}
        {discount > sub && <p className="text-sm text-danger">{t('La remise dépasse le total.')}</p>}
        {cashC < 0 && <p className="text-sm text-danger">{t('Le montant par carte dépasse le total.')}</p>}
      </div>
    </Modal>
  );
}
