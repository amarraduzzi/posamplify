// Encaisser: the client's ticket in the salon. The prestation of the appointment or the Nouba is
// already there with the person who did it; add a prestation, a product or another line, a discount
// or "offert" (with a reason), then cash, card or both, the tip and the change. The ticket can go to
// the client on WhatsApp.
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Banknote, CheckCircle2, CreditCard, Gift, Heart, Layers, MessageCircle, Package, Plus, Scissors, Trash2 } from 'lucide-react';
import { supabase, MENU_URL } from '../lib/supabase';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { waLink } from '../lib/whatsapp';
import { Btn, Field, Modal, inputCls } from './ui';
import { svcName, type AgService } from '../pages/AgendaServicesPage';

export interface TillPerson { id: string; name: string; agenda_color?: string | null }
export interface CheckoutFrom {
  appointment_id?: string; queue_id?: string; name?: string; phone?: string | null;
  staff_id?: string | null; service_id?: string | null; price_cents?: number | null;
}
interface Line {
  key: number; kind: 'service' | 'product' | 'other' | 'pack' | 'pack_payment' | 'giftcard'; service_id: string | null; product_id?: string | null;
  use_pack?: string | null; pack_id?: string | null; client_pack_id?: string | null; max?: number; name: string; price: string; qty: number; staff_id: string;
}
/** what the client has at the salon: her stamps, her packs */
interface Wallet {
  name: string | null;
  loyalty: { enabled: boolean; every: number; stamps: number; ready: boolean; type: 'percent' | 'amount'; value: number; name: string };
  packs: { id: string; name: string; service_id: string | null; left: number; total: number; expires_on: string; due_cents: number; session_cents: number }[];
}
interface PackOffer { id: string; name: string; service_id: string; sessions: number; price_cents: number }
interface TillProduct { id: string; name: string; category: string | null; price_cents: number; stock: number; min_stock: number | null }

export const mad = (c: number) => `${(c / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DH`;
const cents = (s: string) => { const n = Number(s.replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN; };
const dh = (c: number) => String(c / 100);
let seq = 0;

const ERR: Record<string, () => string> = {
  day_closed: () => t('La caisse de ce jour est clôturée.'),
  already_paid: () => t('Ce client est déjà encaissé.'),
  payment_mismatch: () => t('Le paiement ne correspond pas au total.'),
  free_reason_required: () => t('Indiquez pourquoi c’est offert.'),
  voucher_used: () => t('Ce code a déjà servi.'),
  voucher_not_today: () => t('Ce code n’est pas valable aujourd’hui.'),
  voucher_unknown: () => t('Code inconnu.'),
  voucher_min: () => t('Le minimum du code n’est pas atteint.'),
  loyalty_not_ready: () => t('La carte de fidélité n’est pas encore complète.'),
  phone_required: () => t('Un pack se vend avec le numéro de la cliente.'),
  pack_empty: () => t('Ce pack n’a plus de séance.'),
  pack_not_client: () => t('Ce pack appartient à une autre cliente.'),
  giftcard_balance: () => t('Le solde de la carte cadeau ne suffit pas.'),
  giftcard_unknown: () => t('Carte cadeau inconnue.'),
  giftcard_expired: () => t('Cette carte cadeau a expiré.'),
};
export const tillError = (e: unknown) => { const m = String((e as Error)?.message ?? e); const k = Object.keys(ERR).find(x => m.includes(x)); return k ? new Error(ERR[k]()) : e; };

export function CheckoutModal({ r, people, services, from, onClose, onPaid }: {
  r: Restaurant; people: TillPerson[]; services: AgService[]; from: CheckoutFrom; onClose: () => void; onPaid: () => void;
}) {
  const a = useAdminCtx();
  const first = services.find(s => s.id === from.service_id);
  const [lines, setLines] = useState<Line[]>(() => first || from.price_cents
    ? [{ key: ++seq, kind: 'service', service_id: first?.id ?? null, name: first ? svcName(first) : t('Prestation'), price: dh(from.price_cents ?? first?.price_cents ?? 0), qty: 1, staff_id: from.staff_id ?? '' }]
    : []);
  const [name, setName] = useState(from.name ?? '');
  const [phone, setPhone] = useState(from.phone ?? '');
  const [disc, setDisc] = useState('');
  const [discWhy, setDiscWhy] = useState('');
  const [free, setFree] = useState('');
  const [method, setMethod] = useState<'cash' | 'card' | 'both'>('cash');
  const [card, setCard] = useState('');
  const [tip, setTip] = useState('');
  const [given, setGiven] = useState('');
  const [adding, setAdding] = useState<'service' | 'product' | 'pack' | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number: number; total_cents: number; share_token?: string; stamps?: number | null; every?: number | null;
    made?: { kind: 'pack' | 'giftcard'; code?: string; name?: string; amount_cents?: number; due_cents?: number; sessions?: number }[] } | null>(null);
  // the client's stamps and packs (from her number), the reward, a gift card that pays
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [useLoyalty, setUseLoyalty] = useState(false);
  const [offers, setOffers] = useState<PackOffer[]>([]);
  const [gcode, setGcode] = useState('');
  const [ginfo, setGinfo] = useState<{ code: string; balance_cents: number; expires_on: string } | null>(null);
  const [gamount, setGamount] = useState('');
  const [gerr, setGerr] = useState<string | null>(null);
  // the deposit paid before the visit: taken off the bill (it is a credit with its own code)
  const [depNote, setDepNote] = useState<string | null>(null);
  useEffect(() => {
    if (!from.appointment_id) return;
    type Dep = { status: string; code: string | null; balance_cents: number | null; amount_cents: number };
    const use = (d: Dep | null) => {
      if (!d || d.status !== 'paid' || !d.code || !d.balance_cents) return;
      const first = lines.reduce((s, l) => s + (cents(l.price) || 0) * l.qty, 0);
      setGcode(d.code); setGinfo({ code: d.code, balance_cents: d.balance_cents, expires_on: '' });
      setGamount(dh(Math.min(d.balance_cents, first || d.balance_cents)));
      setDepNote(t('Acompte déjà payé : {m}', { m: mad(d.balance_cents) }));
    };
    supabase.rpc('agenda_appt_deposit', { p_restaurant_id: r.id, p_appointment: from.appointment_id }).then(({ data }) => use(data as Dep | null));
  }, [from.appointment_id, r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // a code from a client's story (Le miroir), checked before paying
  const [vcode, setVcode] = useState('');
  const [vinfo, setVinfo] = useState<{ code: string; name: string; kind: 'percent' | 'amount' | 'gift'; value: number; min_cents: number } | null>(null);
  const [verr, setVerr] = useState<string | null>(null);

  const unitOf = (l: Line) => (l.use_pack ? (wallet?.packs.find(p => p.id === l.use_pack)?.session_cents ?? 0) : (cents(l.price) || 0));
  const sub = lines.reduce((s, l) => s + unitOf(l) * l.qty, 0);
  const lc = wallet?.loyalty;
  const lred = useLoyalty && lc?.ready ? (lc.type === 'percent' ? Math.round(sub * Math.min(lc.value, 100) / 100) : Math.min(Math.round(lc.value * 100), sub)) : 0;
  const discount = disc ? cents(disc) : 0;
  const vOk = !!vinfo && sub >= vinfo.min_cents;
  const vdisc = vOk ? (vinfo!.kind === 'percent' ? Math.round(sub * vinfo!.value / 10000) : vinfo!.kind === 'amount' ? Math.min(vinfo!.value, sub) : 0) : 0;
  const total = Math.max(0, sub - (discount || 0) - vdisc - lred);
  const tipC = tip ? cents(tip) : 0;
  const packPaid = lines.reduce((s, l) => s + (l.use_pack ? unitOf(l) : 0), 0);
  const gPaid = ginfo ? Math.min(cents(gamount) || 0, ginfo.balance_cents) : 0;
  const prepaid = packPaid + gPaid;
  const due = total + (tipC || 0) - prepaid;
  const cardC = method === 'card' ? due : method === 'both' ? (cents(card) || 0) : 0;
  const cashC = due - cardC;
  const change = given && cashC > 0 ? cents(given) - cashC : null;
  const bad = !lines.length || lines.some(l => !l.name.trim() || Number.isNaN(cents(l.price))) || Number.isNaN(discount) || discount > sub
    || Number.isNaN(tipC) || cashC < 0 || due < 0 || (total === 0 && !free.trim() && !vinfo && !useLoyalty) || (!!vcode.trim() && !vOk)
    || lines.some(l => (l.kind === 'pack' || l.kind === 'pack_payment') && ((cents(l.price) || 0) < 1 || (l.max != null && cents(l.price) > l.max)))
    || lines.some(l => l.kind === 'giftcard' && (cents(l.price) || 0) < 1000) || (lines.some(l => l.kind === 'pack') && phone.replace(/\D/g, '').length < 9)
    || (!!gcode.trim() && !ginfo);
  // the client's wallet, as soon as her number is there
  const digits = phone.replace(/\D/g, '');
  useEffect(() => {
    if (digits.length < 9) { setWallet(null); setUseLoyalty(false); return; }
    const id = window.setTimeout(() => {
      supabase.rpc('agenda_client_wallet', { p_restaurant_id: r.id, p_phone: digits }).then(({ data }) => setWallet((data as Wallet | null) ?? null));
    }, 350);
    return () => window.clearTimeout(id);
  }, [digits, r.id]);
  useEffect(() => {
    supabase.from('agenda_packs').select('id,name,service_id,sessions,price_cents').eq('restaurant_id', r.id).eq('active', true).order('sort_order').order('name').then(x => setOffers((x.data ?? []) as PackOffer[]));
  }, [r.id]);
  const checkGift = async () => {
    setGerr(null); setGinfo(null);
    const { data, error } = await supabase.rpc('agenda_giftcard_check', { p_restaurant_id: r.id, p_code: gcode.trim() });
    if (error) { a.fail(error); return; }
    const x = data as { ok: boolean; error?: string; code: string; balance_cents: number; expires_on: string };
    if (x.ok) { setGinfo(x); setGamount(dh(Math.min(x.balance_cents, Math.max(0, total + (tipC || 0) - packPaid)))); }
    else setGerr(x.error === 'giftcard_expired' ? t('Cette carte cadeau a expiré.') : x.error === 'giftcard_empty' ? t('Cette carte cadeau est épuisée.') : t('Carte cadeau inconnue.'));
  };
  const checkCode = async () => {
    setVerr(null); setVinfo(null);
    const { data, error } = await supabase.rpc('agenda_voucher_check', { p_restaurant_id: r.id, p_code: vcode.trim() });
    if (error) { a.fail(error); return; }
    const x = data as { ok: boolean; error?: string; code: string; name: string; kind: 'percent' | 'amount' | 'gift'; value: number; min_cents: number };
    if (x.ok) setVinfo(x); else setVerr(x.error === 'voucher_used' ? t('Ce code a déjà servi.') : x.error === 'voucher_not_today' ? t('Ce code n’est pas valable aujourd’hui.') : t('Code inconnu.'));
  };
  const set = (k: number, p: Partial<Line>) => setLines(ls => ls.map(l => (l.key === k ? { ...l, ...p } : l)));
  const byCat = useMemo(() => services.filter(s => s.active !== false), [services]);
  // the products for sale of the salon (Produits et stock)
  const [products, setProducts] = useState<TillProduct[]>([]);
  useEffect(() => {
    supabase.from('agenda_products').select('id,name,category,price_cents,stock,min_stock').eq('restaurant_id', r.id).eq('kind', 'retail').eq('active', true).order('sort_order').order('name')
      .then(x => setProducts((x.data ?? []) as TillProduct[]));
  }, [r.id]);
  const addProduct = (pr: TillProduct) => setLines(ls => {
    const same = ls.find(l => l.product_id === pr.id);
    if (same) return ls.map(l => (l === same ? { ...l, qty: Math.min(99, l.qty + 1) } : l));
    return [...ls, { key: ++seq, kind: 'product', service_id: null, product_id: pr.id, name: pr.name, price: dh(pr.price_cents), qty: 1, staff_id: from.staff_id ?? ls.find(l => l.kind === 'service')?.staff_id ?? '' }];
  });

  const pay = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('agenda_checkout', { p_restaurant_id: r.id, p: {
        appointment_id: from.appointment_id, queue_id: from.queue_id, name: name.trim() || undefined, phone: phone.replace(/\D/g, '') || undefined,
        lines: lines.map(l => ({ kind: l.kind, service_id: l.service_id, product_id: l.product_id ?? null, use_pack: l.use_pack ?? null, pack_id: l.pack_id ?? null,
          client_pack_id: l.client_pack_id ?? null, name: l.name.trim(), quantity: l.qty, unit_cents: l.use_pack ? 0 : cents(l.price), staff_id: l.staff_id || null })),
        loyalty: useLoyalty && !!lc?.ready, giftcard_code: ginfo && gPaid > 0 ? ginfo.code : undefined, giftcard_cents: ginfo && gPaid > 0 ? gPaid : undefined,
        discount_cents: discount || 0, discount_reason: discWhy.trim() || undefined, free_reason: total === 0 ? free.trim() : undefined,
        cash_cents: cashC, card_cents: cardC, tip_cents: tipC || 0, voucher_code: vOk ? vinfo!.code : undefined,
      } });
      if (error) throw error;
      setDone(data as NonNullable<typeof done>);
    } catch (e) { a.fail(tillError(e)); }
    setBusy(false);
  };
  const ticketText = () => [
    `${r.name}`, t('Ticket n° {n}', { n: done?.number ?? '' }), '',
    ...lines.map(l => `${l.qty > 1 ? `${l.qty} × ` : ''}${lineLabel(l)} : ${mad(unitOf(l) * l.qty)}`),
    ...(discount || vdisc || lred ? [`${t('Remise')} : -${mad((discount || 0) + vdisc + lred)}`] : []),
    `${t('Total')} : ${mad(total)}`, ...(prepaid ? [`${t('Payé par pack ou carte cadeau')} : ${mad(prepaid)}`] : []),
    ...(done?.made ?? []).map(x => (x.kind === 'giftcard' ? `${t('Carte cadeau')} : ${x.code} (${mad(x.amount_cents ?? 0)})` : `${x.name} : ${t('{n} séances', { n: x.sessions ?? 0 })}${x.due_cents ? ` · ${t('reste à payer {m}', { m: mad(x.due_cents) })}` : ''}`)),
    ...(done?.every ? [`${t('Fidélité')} : ${done.stamps ?? 0}/${done.every}`] : []),
    '', t('Merci et à bientôt !'),
    ...(done?.share_token ? ['', t('Votre photo dans le miroir du salon :'), `${MENU_URL}/${r.slug}?miroir=${done.share_token}`] : []),
  ].join('\n');

  const lineLabel = (l: Line) => (l.kind === 'giftcard' ? `${t('Carte cadeau')}${l.name.trim() ? ` · ${l.name.trim()}` : ''}` : l.name);

  // the mirror's QR on the screen: the client scans it at the reception
  const [mirrorQr, setMirrorQr] = useState<string | null>(null);
  useEffect(() => {
    if (!done?.share_token) return;
    QRCode.toDataURL(`${MENU_URL}/${r.slug}?miroir=${done.share_token}`, { margin: 1, width: 360 }).then(setMirrorQr).catch(() => setMirrorQr(null));
  }, [done?.share_token, r.slug]);

  if (done) return (
    <Modal title={t('Encaissé')} onClose={onPaid}>
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
        <p className="font-display text-3xl font-semibold tabular">{mad(total)}</p>
        {(done.made ?? []).filter(x => x.kind === 'giftcard').map(x => (
          <div key={x.code} className="rounded-2xl border-2 border-dashed border-brand p-3"><p className="text-xs text-muted">{t('Carte cadeau')} · {mad(x.amount_cents ?? 0)}</p><p dir="ltr" className="font-display text-2xl font-semibold tracking-widest">{x.code}</p></div>
        ))}
        {(done.made ?? []).filter(x => x.kind === 'pack' && x.due_cents).map(x => <p key={x.name} className="text-sm font-semibold text-amber-700">{t('{name} : reste à payer {m}', { name: x.name ?? '', m: mad(x.due_cents ?? 0) })}</p>)}
        {done.every ? <p className="text-sm font-semibold">{t('Fidélité : {a}/{b}', { a: done.stamps ?? 0, b: done.every })}</p> : null}
        <p className="text-muted">{t('Ticket n° {n}', { n: done.number })}{tipC ? ` · ${t('pourboire {m}', { m: mad(tipC) })}` : ''}{change != null && change > 0 ? ` · ${t('Monnaie à rendre : {m}', { m: mad(change) })}` : ''}</p>
        {phone.replace(/\D/g, '').length >= 9 && <a href={waLink(phone, ticketText())} target="_blank" rel="noopener" className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] py-3 font-semibold text-white"><MessageCircle className="h-5 w-5" />{t('Envoyer le ticket sur WhatsApp')}</a>}
        {mirrorQr && <div className="rounded-2xl bg-surface-2 p-3">
          <img src={mirrorQr} alt="" className="mx-auto h-36 w-36 rounded-xl" />
          <p className="mt-2 text-sm font-semibold">{t('Le miroir : la cliente scanne et poste sa photo')}</p>
        </div>}
        <Btn className="w-full" onClick={onPaid}>{t('Fermer')}</Btn>
      </div>
    </Modal>
  );

  return (
    <Modal title={t('Encaisser')} onClose={onClose} wide
      footer={<div className="flex items-center gap-3">
        <div className="me-auto"><p className="text-xs text-muted">{t('À payer')}</p><p className="font-display text-2xl font-semibold tabular">{mad(due)}</p></div>
        <Btn onClick={onClose}>{t('Annuler')}</Btn>
        <Btn tone="brand" disabled={busy || bad} onClick={pay}>{total === 0 ? <><Gift className="h-4 w-4" /> {t('Valider offert')}</> : <><CheckCircle2 className="h-4 w-4" /> {t('Encaisser')}</>}</Btn>
      </div>}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Client')}><input className={inputCls} maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder={t('Nom (facultatif)')} /></Field>
          <Field label={t('Téléphone')}><input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="06 12 34 56 78" /></Field>
        </div>

        {wallet && (wallet.loyalty.enabled || wallet.packs.length > 0) && (
          <div className="space-y-2 rounded-2xl bg-brand/5 p-3 ring-1 ring-brand/15">
            {wallet.loyalty.enabled && (
              <div className="flex flex-wrap items-center gap-3">
                <Heart className="h-4 w-4 text-brand" />
                <span className="text-sm font-semibold">{t('Fidélité : {a}/{b}', { a: Math.min(wallet.loyalty.stamps, wallet.loyalty.every), b: wallet.loyalty.every })}</span>
                <span className="flex gap-1">{Array.from({ length: wallet.loyalty.every }, (_, i) => <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < wallet.loyalty.stamps ? 'bg-brand' : 'bg-line/20'}`} />)}</span>
                {wallet.loyalty.ready && <Btn tone={useLoyalty ? 'brand' : 'plain'} className="ms-auto px-3 py-1.5 text-sm" onClick={() => setUseLoyalty(x => !x)}><Gift className="h-4 w-4" />{useLoyalty ? t('Récompense appliquée : -{m}', { m: mad(lred) }) : t('Offrir : {name}', { name: wallet.loyalty.name })}</Btn>}
              </div>
            )}
            {wallet.packs.filter(p => p.due_cents > 0 && !lines.some(l => l.client_pack_id === p.id)).map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Layers className="h-4 w-4 text-amber-700" /><span className="flex-1">{t('{name} : reste à payer {m}', { name: p.name, m: mad(p.due_cents) })}</span>
                <Btn className="px-3 py-1.5 text-sm" onClick={() => setLines(ls => [...ls, { key: ++seq, kind: 'pack_payment', service_id: null, client_pack_id: p.id, max: p.due_cents, name: t('Versement : {name}', { name: p.name }), price: dh(p.due_cents), qty: 1, staff_id: '' }])}>{t('Ajouter un versement')}</Btn>
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
                <input className="min-w-0 flex-1 bg-transparent font-semibold outline-none" maxLength={l.kind === 'giftcard' ? 60 : 80} value={l.name} readOnly={!!l.product_id || l.kind === 'pack' || l.kind === 'pack_payment'}
                  placeholder={l.kind === 'giftcard' ? t('Pour qui ? (facultatif)') : t('Nom du produit')} onChange={e => set(l.key, { name: e.target.value })} aria-label={t('Nom')} />
                {(l.kind === 'product' || l.kind === 'other') && <select className="rounded-lg bg-surface px-2 py-1 text-sm" value={l.qty} onChange={e => set(l.key, { qty: Number(e.target.value) })} aria-label={t('Quantité')}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} ×</option>)}</select>}
                {l.use_pack ? <span className="w-28 text-end text-sm font-semibold text-emerald-700">{t('Pack')} · {mad(unitOf(l))}</span> : <div className="flex w-28 items-center rounded-lg bg-surface px-2 ring-1 ring-line/10">
                  <input className="w-full bg-transparent py-1.5 text-end font-semibold tabular outline-none" inputMode="decimal" value={l.price} onChange={e => set(l.key, { price: e.target.value })} aria-label={t('Prix (DH)')} />
                  <span className="ps-1 text-xs text-muted">DH</span>
                </div>}
                <button className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-danger" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label={t('Supprimer')}><Trash2 className="h-4 w-4" /></button>
              </div>
              {l.kind === 'pack' && l.max != null && <p className="mt-1 text-xs text-muted">{t('Payé maintenant, sur {m}. Le reste se paie aux prochaines visites.', { m: mad(l.max) })}</p>}
              {l.kind === 'service' && !!wallet?.packs.some(p => p.left > 0 && (!p.service_id || !l.service_id || p.service_id === l.service_id)) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {wallet!.packs.filter(p => p.left > 0 && (!p.service_id || !l.service_id || p.service_id === l.service_id)).map(p => (
                    <button key={p.id} onClick={() => set(l.key, { use_pack: l.use_pack === p.id ? null : p.id })}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${l.use_pack === p.id ? 'bg-emerald-600 text-white' : 'bg-emerald-500/10 text-emerald-700'}`}>
                      <Layers className="me-1 inline h-3 w-3" />{l.use_pack === p.id ? t('Payé par le pack : {name}', { name: p.name }) : t('Utiliser le pack {name} ({n} restantes)', { name: p.name, n: p.left })}</button>
                  ))}
                </div>
              )}
              {(l.kind === 'service' || l.kind === 'product') && people.length > 0 && (
                <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
                  {l.kind === 'product' && <span className="shrink-0 self-center text-xs text-muted">{t('Vendu par')}</span>}
                  {people.map(p => (
                    <button key={p.id} onClick={() => set(l.key, { staff_id: l.kind === 'product' && l.staff_id === p.id ? '' : p.id })}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${l.staff_id === p.id ? 'bg-brand text-brand-ink' : 'bg-surface text-muted'}`}>{p.name}</button>
                  ))}
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
                  className="rounded-xl bg-surface px-3 py-2 text-start text-sm font-semibold shadow-sm">{o.name} <span className="text-muted tabular">{mad(o.price_cents)}</span>
                  <span className="block text-xs font-normal text-muted">{t('{n} séances', { n: o.sessions })}</span></button>
              ))}
              {digits.length < 9 && <p className="w-full text-xs text-amber-700">{t('Un pack se vend avec le numéro de la cliente.')}</p>}
            </div>
          )}
          {adding === 'product' && (
            <div className="flex flex-wrap gap-1.5 rounded-2xl bg-surface-2 p-3">
              {products.map(pr => (
                <button key={pr.id} onClick={() => addProduct(pr)} className="rounded-xl bg-surface px-3 py-2 text-start text-sm font-semibold shadow-sm">
                  {pr.name} <span className="text-muted tabular">{mad(pr.price_cents)}</span>
                  <span className={`block text-xs font-normal ${pr.stock <= 0 ? 'text-red-600' : pr.min_stock != null && pr.stock <= pr.min_stock ? 'text-amber-700' : 'text-muted'}`}>{pr.stock <= 0 ? t('Plus en stock') : t('{n} en stock', { n: pr.stock })}</span>
                </button>
              ))}
              <button onClick={() => { setLines(ls => [...ls, { key: ++seq, kind: 'other', service_id: null, product_id: null, name: '', price: '', qty: 1, staff_id: '' }]); setAdding(null); }}
                className="rounded-xl border border-dashed border-line/30 px-3 py-2 text-sm font-semibold text-muted">{t('Autre (texte libre)')}</button>
              {!products.length && <p className="w-full text-xs text-muted">{t('Ajoutez vos produits dans « Produits et stock » pour les vendre ici et suivre le stock.')}</p>}
            </div>
          )}
          {adding === 'service' && (
            <div className="flex flex-wrap gap-1.5 rounded-2xl bg-surface-2 p-3">
              {byCat.map(s => (
                <button key={s.id} onClick={() => { setLines(ls => [...ls, { key: ++seq, kind: 'service', service_id: s.id, name: svcName(s), price: dh(s.price_cents), qty: 1, staff_id: from.staff_id ?? ls[0]?.staff_id ?? '' }]); setAdding(null); }}
                  className="rounded-xl bg-surface px-3 py-2 text-sm font-semibold shadow-sm">{svcName(s)} <span className="text-muted tabular">{mad(s.price_cents)}</span></button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Remise (DH)')}><input className={inputCls} inputMode="decimal" value={disc} onChange={e => setDisc(e.target.value)} placeholder="0" /></Field>
          {discount > 0 && total > 0 && <Field label={t('Raison de la remise')}><input className={inputCls} maxLength={100} value={discWhy} onChange={e => setDiscWhy(e.target.value)} placeholder={t('Fidélité, geste commercial…')} /></Field>}
          <Field label={t('Code d’une story (facultatif)')} hint={vinfo ? (vOk ? t('{name} · appliqué : -{m}', { name: vinfo.name, m: mad(vdisc) }) : t('Minimum {m} de prestations', { m: mad(vinfo.min_cents) })) : verr ?? undefined}>
            <div className="flex gap-2">
              <input className={`${inputCls} uppercase`} dir="ltr" maxLength={20} value={vcode} onChange={e => { setVcode(e.target.value.toUpperCase()); setVinfo(null); setVerr(null); }} placeholder="SA-XXXXXX" />
              <Btn onClick={checkCode} disabled={!vcode.trim()}>{t('Vérifier')}</Btn>
            </div>
          </Field>
          <Field label={t('Payer avec une carte cadeau')} hint={ginfo ? t('Solde : {m}', { m: mad(ginfo.balance_cents) }) : gerr ?? undefined}>
            <div className="flex gap-2">
              <input className={`${inputCls} uppercase`} dir="ltr" maxLength={20} value={gcode} onChange={e => { setGcode(e.target.value.toUpperCase()); setGinfo(null); setGerr(null); }} placeholder="KDO-XXXXXX" />
              {ginfo ? <input className={`${inputCls} w-28`} inputMode="decimal" value={gamount} onChange={e => setGamount(e.target.value)} aria-label={t('Montant (DH)')} />
                : <Btn onClick={checkGift} disabled={!gcode.trim()}>{t('Vérifier')}</Btn>}
            </div>
          </Field>
          {total === 0 && lines.length > 0 && !vinfo && !useLoyalty && <Field label={t('Pourquoi c’est offert ?')}><input className={inputCls} maxLength={100} value={free} onChange={e => setFree(e.target.value)} placeholder={t('Famille, retouche gratuite…')} /></Field>}
        </div>

        {depNote && <p className="text-sm font-semibold text-emerald-700">{depNote}</p>}
        {prepaid > 0 && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700">{t('Payé par pack ou carte cadeau : {m}', { m: mad(prepaid) })}</p>}
        {total > 0 && <>
          <div className="grid grid-cols-3 gap-2">
            {([['cash', Banknote, t('Espèces')], ['card', CreditCard, t('Carte')], ['both', Plus, t('Les deux')]] as const).map(([k, I, l]) => (
              <button key={k} onClick={() => setMethod(k)} className={`flex flex-col items-center gap-1 rounded-2xl py-3 text-sm font-semibold ring-1 ${method === k ? 'bg-brand text-brand-ink ring-brand' : 'bg-surface ring-line/10'}`}>
                <I className="h-5 w-5" />{l}</button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('Pourboire (DH)')}><input className={inputCls} inputMode="decimal" value={tip} onChange={e => setTip(e.target.value)} placeholder="0" /></Field>
            {method === 'both' && <Field label={t('Par carte (DH)')}><input className={inputCls} inputMode="decimal" value={card} onChange={e => setCard(e.target.value)} /></Field>}
            {method !== 'card' && cashC > 0 && <Field label={t('Espèces reçues (DH)')} hint={change != null && change >= 0 ? t('Monnaie à rendre : {m}', { m: mad(change) }) : undefined}>
              <input className={inputCls} inputMode="decimal" value={given} onChange={e => setGiven(e.target.value)} placeholder={dh(cashC)} /></Field>}
          </div>
          {method === 'both' && <p className="text-sm text-muted">{t('Espèces : {a} · Carte : {b}', { a: mad(Math.max(0, cashC)), b: mad(cardC) })}</p>}
        </>}
        {discount > sub && <p className="text-sm text-danger">{t('La remise dépasse le total.')}</p>}
        {cashC < 0 && <p className="text-sm text-danger">{t('Le montant par carte dépasse le total.')}</p>}
      </div>
    </Modal>
  );
}
