// The sign-up QR codes: one for the counter and tables, one per tasting. Guests scan, their phone
// fills in name and number, one tap puts them in the customer file (with WhatsApp consent).
import { useCallback, useEffect, useState } from 'react';
import { Copy, Download, Plus, Printer, QrCode, Users } from 'lucide-react';
import QRCode from 'qrcode';
import { supabase, MENU_URL } from '../lib/supabase';
import { check } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { qrPngBlob, saveBlob } from '../lib/qrFiles';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, inputCls } from './ui';

export interface SignupEvent { id: string; name: string; event_date: string | null; key: string; offer: string | null; active: boolean; created_at: string }

export const signupUrl = (r: Restaurant, key?: string | null) => `${MENU_URL}/${r.slug}?club${key ? `=${key}` : ''}`;

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** An A5 poster: the restaurant, what you get, the QR code. */
async function printPoster(r: Restaurant, title: string, sub: string, url: string) {
  const qr = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#FFFFFF' } });
  const w = window.open('', '_blank', 'width=620,height=860');
  if (!w) return;
  const ar = r.languages.includes('ar');
  const logo = r.branding?.logo_url ? `<img class="logo" src="${esc(r.branding.logo_url)}" alt="">` : `<p class="rname">${esc(r.name)}</p>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page{size:A5;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Georgia,'Times New Roman',serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .p{width:148mm;height:209mm;padding:16mm 14mm;display:flex;flex-direction:column;align-items:center;text-align:center}
    .logo{height:22mm;max-width:60mm;object-fit:contain}.rname{font-size:20pt;margin:0;letter-spacing:.02em}
    h1{font-size:25pt;line-height:1.1;margin:9mm 0 3mm;font-weight:600}.sub{font-size:12.5pt;margin:0;color:#444;max-width:110mm;font-family:system-ui,sans-serif}
    .qr{width:72mm;height:72mm;margin:9mm 0 5mm;padding:4mm;border:1.2mm solid #111;border-radius:6mm}.qr svg{width:100%;height:100%}
    .how{font-family:system-ui,sans-serif;font-size:11pt;font-weight:600;margin:0}.ar{font-family:'Noto Naskh Arabic',Tahoma,sans-serif;direction:rtl;font-size:12pt;margin:2mm 0 0;color:#444}
    .foot{margin-top:auto;font-family:system-ui,sans-serif;font-size:8pt;color:#888}
  </style></head><body><div class="p">${logo}<h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p><div class="qr">${qr}</div>
  <p class="how">Scannez avec l’appareil photo · 10 secondes</p>${ar ? '<p class="ar">امسحوا الرمز بكاميرا الهاتف</p>' : ''}
  <p class="foot">${esc(r.name)}</p></div><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
  w.document.close();
}

export function SignupQrModal({ r, onClose, onShowEvent }: { r: Restaurant; onClose: () => void; onShowEvent: (e: SignupEvent) => void }) {
  const a = useAdminCtx();
  const [svg, setSvg] = useState('');
  const [events, setEvents] = useState<SignupEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [offer, setOffer] = useState('');
  const url = signupUrl(r);

  const load = useCallback(async () => {
    try {
      const ev = check(await supabase.from('signup_events').select('*').eq('restaurant_id', r.id).order('created_at', { ascending: false })) as SignupEvent[];
      const ppl = check(await supabase.from('signup_event_people').select('event_id').eq('restaurant_id', r.id)) as { event_id: string }[];
      setEvents(ev);
      setCounts(ppl.reduce<Record<string, number>>((m, p) => ({ ...m, [p.event_id]: (m[p.event_id] ?? 0) + 1 }), {}));
    } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { load(); QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setSvg); }, [load, url]);

  const copy = async (u: string) => { try { await navigator.clipboard.writeText(u); a.toast(t('Lien copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  const create = async () => {
    if (!name.trim()) { a.toast(t('Donnez un nom à la dégustation.'), 'error'); return; }
    try {
      check(await supabase.from('signup_events').insert({ restaurant_id: r.id, name: name.trim(), event_date: date || null, offer: offer.trim() || null }).select('id'));
      setAdding(false); setName(''); setDate(''); setOffer(''); a.toast(t('Dégustation créée')); load();
    } catch (e) { a.fail(e); }
  };
  const toggle = async (e: SignupEvent) => {
    try { check(await supabase.from('signup_events').update({ active: !e.active }).eq('id', e.id).select('id')); load(); } catch (x) { a.fail(x); }
  };
  const generalTitle = t('Rejoignez le club {r}', { r: r.name });
  const generalSub = t('Offres et nouveautés sur WhatsApp.');

  return (
    <Modal title={t('QR d’inscription')} onClose={onClose} wide>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-5">
          <div className="h-36 w-36 shrink-0 rounded-2xl bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="min-w-[14rem] flex-1">
            <p className="font-semibold">{t('Pour le comptoir, les tables et le ticket')}</p>
            <p className="mt-1 text-sm text-muted">{t('Le client scanne, son téléphone remplit le prénom et le numéro, il appuie une fois. Il arrive dans vos clients, d’accord pour WhatsApp.')}</p>
            <p dir="ltr" className="mt-2 truncate text-xs text-muted rtl:text-end">{url}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn tone="brand" className="px-3 py-1.5" onClick={() => printPoster(r, generalTitle, generalSub, url)}><Printer className="h-4 w-4" /> {t('Imprimer l’affiche')}</Btn>
              <Btn className="px-3 py-1.5" onClick={async () => saveBlob(await qrPngBlob(url), `${r.slug}-club.png`)}><Download className="h-4 w-4" /> PNG</Btn>
              <Btn className="px-3 py-1.5" onClick={() => copy(url)}><Copy className="h-4 w-4" /> {t('Copier le lien')}</Btn>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-lg font-semibold">{t('Dégustations et événements')}</p>
              <p className="text-sm text-muted">{t('Un QR par événement : vous voyez qui est venu, et le client montre son écran pour recevoir l’offre.')}</p>
            </div>
            {!adding && <Btn tone="brand" className="shrink-0 px-3 py-1.5" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> {t('Nouvelle dégustation')}</Btn>}
          </div>
          {adding && (
            <div className="mb-3 rounded-2xl bg-surface-2 p-4">
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                <Field label={t('Nom')}><input autoFocus className={inputCls} value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder={t('Dégustation nouvelle carte')} /></Field>
                <Field label={t('Date (facultatif)')}><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
              </div>
              <div className="mt-3"><Field label={t('Offre affichée après l’inscription (facultatif)')}><input className={inputCls} value={offer} onChange={e => setOffer(e.target.value)} maxLength={120} placeholder={t('Une assiette offerte')} /></Field></div>
              <div className="mt-3 flex justify-end gap-2"><Btn tone="ghost" onClick={() => setAdding(false)}>{t('Annuler')}</Btn><Btn tone="brand" onClick={create}>{t('Créer')}</Btn></div>
            </div>
          )}
          {!events.length && !adding ? (
            <p className="rounded-2xl border border-dashed border-line/20 p-5 text-center text-sm text-muted">{t('Pas encore de dégustation.')}</p>
          ) : (
            <ul className="divide-y divide-line/10 rounded-2xl border border-line/10">
              {events.map(e => {
                const u = signupUrl(r, e.key);
                return (
                  <li key={e.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${e.active ? '' : 'opacity-60'}`}>
                    <div className="min-w-[12rem] flex-1">
                      <p className="font-semibold">{e.name}</p>
                      <p className="text-xs text-muted">{e.event_date ? new Date(e.event_date + 'T12:00:00').toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' }) : ''}{e.event_date && e.offer ? ' · ' : ''}{e.offer ?? ''}{!e.active ? ` · ${t('Fermée')}` : ''}</p>
                    </div>
                    <button onClick={() => onShowEvent(e)} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-sm font-semibold hover:bg-brand/10"><Users className="h-4 w-4" /> {counts[e.id] ?? 0}</button>
                    <Btn className="px-2.5 py-1.5" title={t('Imprimer l’affiche')} onClick={() => printPoster(r, e.name, e.offer ?? t('Inscrivez-vous en 10 secondes.'), u)}><Printer className="h-4 w-4" /></Btn>
                    <Btn className="px-2.5 py-1.5" title="PNG" onClick={async () => saveBlob(await qrPngBlob(u), `${r.slug}-${e.key}.png`)}><QrCode className="h-4 w-4" /></Btn>
                    <Btn className="px-2.5 py-1.5" title={t('Copier le lien')} onClick={() => copy(u)}><Copy className="h-4 w-4" /></Btn>
                    <Btn tone="ghost" className="px-2.5 py-1.5 text-sm" onClick={() => toggle(e)}>{e.active ? t('Fermer') : t('Rouvrir')}</Btn>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
