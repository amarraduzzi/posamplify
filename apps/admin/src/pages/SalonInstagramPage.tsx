// Instagram for the salon:
//  * "Fait par…": posts and stories of the salon, signed by a person of the team, with that person's
//    own booking link (their clients book straight with them, their commission follows);
//  * what the clients share by themselves: the mirror after paying, "J'ai rendez-vous", "Je suis n°3",
//    and what they get for it (the same actions as the restaurants).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Copy, Download, ImageUp, Link2, Save, Share2, Sparkles } from 'lucide-react';
import type { GuestAction } from '@resto/shared';
import { guestActionsOf } from '@resto/shared';
import { supabase, MENU_URL } from '../lib/supabase';
import { check } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Toggle, inputCls } from '../components/ui';
import { GuestActions } from '../components/GuestActions';
import { svcName, type AgService } from './AgendaServicesPage';
import { SIZES, drawMaker, loadImg, pngBlob, type MakerFormat, type MakerKind } from '../lib/salonMaker';

interface Person { id: string; name: string; agenda_services: string[] }
interface Pair { before: string; after: string; caption?: string; consent?: boolean }
const mad = (c: number) => `${(c / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH`;

export function SalonInstagramPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const tz = r.timezone || 'UTC';
  const [people, setPeople] = useState<Person[]>([]);
  const [services, setServices] = useState<AgService[]>([]);
  const [kind, setKind] = useState<MakerKind>('service');
  const [format, setFormat] = useState<MakerFormat>('story');
  const [who, setWho] = useState<string>('');
  const [svc, setSvc] = useState<string>('');
  const [pair, setPair] = useState(0);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [imgs, setImgs] = useState<{ logo: HTMLImageElement | null; before: HTMLImageElement | null; after: HTMLImageElement | null }>({ logo: null, before: null, after: null });
  const [times, setTimes] = useState<string[] | null>(null);
  const [wait, setWait] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const handle = (r.branding.instagram ?? '').replace(/^@/, '');
  const pairs = ((r.site as { before_after?: Pair[] } | null)?.before_after ?? []).filter(x => x.consent && x.before && x.after);
  const queueOn = !!(r.agenda as { queue?: boolean } | null)?.queue;

  useEffect(() => {
    supabase.from('staff').select('id,name,agenda_services').eq('restaurant_id', r.id).eq('active', true).eq('agenda', true).order('agenda_sort').order('name').then(x => setPeople((x.data ?? []) as Person[]));
    supabase.from('agenda_services').select('*').eq('restaurant_id', r.id).eq('active', true).order('sort_order').then(x => { const l = (x.data ?? []) as AgService[]; setServices(l); setSvc(s => s || l[0]?.id || ''); });
    loadImg(r.branding.logo_url).then(logo => setImgs(i => ({ ...i, logo })));
  }, [r.id, r.branding.logo_url]);
  useEffect(() => {
    const p = pairs[pair]; if (kind !== 'before_after' || !p) return;
    Promise.all([loadImg(p.before), loadImg(p.after)]).then(([before, after]) => setImgs(i => ({ ...i, before, after })));
  }, [kind, pair]); // eslint-disable-line react-hooks/exhaustive-deps
  // the free times left today (for that person and prestation), the wait now
  useEffect(() => {
    if (kind !== 'slots' || !svc) return;
    setTimes(null);
    const day = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    supabase.rpc('agenda_slots', { p_slug: r.slug, p_service: svc, p_staff: who || null, p_day: day })
      .then(({ data }) => {
        // the clients that can still really come: start times at least one prestation apart
        const gap = ((services.find(s => s.id === svc)?.duration_min ?? 30) + (services.find(s => s.id === svc)?.buffer_min ?? 0)) * 60000;
        const out: string[] = []; let last = -Infinity;
        for (const x of (data ?? []) as string[]) { const tm = new Date(x).getTime(); if (tm >= Date.now() && tm - last >= gap) { out.push(new Date(x).toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })); last = tm; } }
        setTimes(out);
      });
  }, [kind, svc, who, r.slug, tz, services]);
  useEffect(() => {
    if (kind !== 'wait') return;
    supabase.rpc('salon_wait', { p_slug: r.slug, p_host: null }).then(({ data }) => setWait((data as { wait_min?: number } | null)?.wait_min ?? null));
  }, [kind, r.slug]);

  const person = people.find(p => p.id === who);
  const service = services.find(s => s.id === svc);
  const link = kind === 'wait' ? `${MENU_URL}/${r.slug}?nouba`
    : `${MENU_URL}/${r.slug}?rdv${kind === 'service' && svc ? `&s=${svc}` : ''}${who ? `&p=${who}` : ''}`;
  const input = useMemo(() => {
    const by = person ? t('par {name}', { name: person.name }) : undefined;
    const base = { kind, format, primary: r.branding.primary_color || '#8E3B4F', salon: r.name, handle: handle || undefined, logo: imgs.logo, labels: { before: t('Avant'), after: t('Après') } };
    if (kind === 'service') return { ...base, photo, title: service ? svcName(service) : r.name, price: service ? `${service.price_from ? t('dès') + ' ' : ''}${mad(service.price_cents)}` : undefined, by, cta: person ? t('Réservez avec {name}', { name: person.name }) : t('Réservez en ligne') };
    if (kind === 'before_after') { const p = pairs[pair]; return { ...base, before: imgs.before, after: imgs.after, title: p?.caption || t('Avant, après'), by, cta: person ? t('Réservez avec {name}', { name: person.name }) : t('Réservez en ligne') }; }
    if (kind === 'slots') return { ...base, times: times ?? [], title: times?.length ? t('Encore {n} places aujourd’hui', { n: times.length }) : t('Plus de créneau aujourd’hui'), subtitle: service ? svcName(service) : undefined, by, cta: t('Réservez vite : lien en story') };
    return { ...base, wait: wait == null ? '–' : wait <= 5 ? t('Sans attente') : `≈ ${wait} min`, title: t('L’attente maintenant'), subtitle: t('Passez, ou prenez votre place en ligne'), cta: t('Prenez votre place : lien en story') };
  }, [kind, format, r, handle, imgs, photo, service, person, pairs, pair, times, wait]);
  useEffect(() => { if (canvas.current) drawMaker(canvas.current, input, 0.32); }, [input]);

  const share = async (save: boolean) => {
    const c = document.createElement('canvas'); drawMaker(c, input, 1);
    const blob = await pngBlob(c), f = new File([blob], `${r.slug}-${kind}.png`, { type: 'image/png' });
    try { if (!save && navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f] }); return; } } catch { /* cancelled */ return; }
    const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = f.name; el.click(); setTimeout(() => URL.revokeObjectURL(el.href), 4000);
  };
  const copy = async (x: string) => { try { await navigator.clipboard.writeText(x); setCopied(x); setTimeout(() => setCopied(null), 2000); } catch { a.toast(t('Copie impossible'), 'error'); } };
  const chip = (on: boolean) => `rounded-xl px-3 py-2 text-sm font-semibold ${on ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted'}`;
  const { w, h } = SIZES[format];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">{t('Instagram')}</h1>
        <p className="text-muted">{t('Vos clientes et votre équipe font votre publicité. Chaque image porte votre nom, votre @ et le bon lien de réservation.')}</p>
      </div>

      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Sparkles className="h-5 w-5 text-brand" />{t('Fait par…')}</h2>
        <p className="mb-4 text-sm text-muted">{t('Une image prête pour Instagram, signée par une personne de l’équipe. Le lien réserve directement avec elle : ses clientes viennent chez elle, sa commission suit.')}</p>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {([['service', t('Une prestation')], ['before_after', t('Avant, après')], ['slots', t('Créneaux libres aujourd’hui')], ...(queueOn ? [['wait', t('L’attente maintenant')]] as const : [])] as const).map(([k, l]) => (
                <button key={k} className={chip(kind === k)} onClick={() => setKind(k)}>{l}</button>
              ))}
            </div>
            {kind !== 'wait' && <Field group label={t('Signé par')}>
              <div className="flex flex-wrap gap-1.5">
                <button className={chip(!who)} onClick={() => setWho('')}>{t('Le salon')}</button>
                {people.map(p => <button key={p.id} className={chip(who === p.id)} onClick={() => setWho(p.id)}>{p.name}</button>)}
              </div>
            </Field>}
            {(kind === 'service' || kind === 'slots') && <Field label={t('Prestation')}>
              <select className={inputCls} value={svc} onChange={e => setSvc(e.target.value)}>
                {services.filter(s => !person || !person.agenda_services.length || person.agenda_services.includes(s.id)).map(s => <option key={s.id} value={s.id}>{svcName(s)} · {mad(s.price_cents)}</option>)}
              </select>
            </Field>}
            {kind === 'service' && <div className="flex flex-wrap items-center gap-2">
              <input ref={file} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (!f) return; const i = new Image(); i.onload = () => setPhoto(i); i.src = URL.createObjectURL(f); }} />
              <Btn onClick={() => file.current?.click()}><ImageUp className="h-4 w-4" /> {photo ? t('Changer la photo') : t('Ajouter une photo (facultatif)')}</Btn>
              {photo && <Btn onClick={() => setPhoto(null)}>{t('Sans photo')}</Btn>}
            </div>}
            {kind === 'before_after' && (pairs.length ? <div className="flex flex-wrap gap-2">
              {pairs.map((p, i) => <button key={i} onClick={() => setPair(i)} className={`overflow-hidden rounded-xl ring-2 ${pair === i ? 'ring-brand' : 'ring-transparent'}`}><img src={p.after} alt="" className="h-20 w-16 object-cover" /></button>)}
            </div> : <p className="rounded-2xl bg-surface-2 p-3 text-sm text-muted">{t('Ajoutez des photos avant/après (avec l’accord de la cliente) dans « Site du salon ».')}</p>)}
            {kind === 'slots' && times && !times.length && <p className="text-sm text-muted">{t('Plus aucun créneau libre aujourd’hui pour cette prestation.')}</p>}
            <Field group label={t('Format')}>
              <div className="flex gap-1.5">
                <button className={chip(format === 'story')} onClick={() => setFormat('story')}>{t('Story')}</button>
                <button className={chip(format === 'post')} onClick={() => setFormat('post')}>{t('Publication')}</button>
              </div>
            </Field>
            <div className="rounded-2xl bg-surface-2 p-3">
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4 text-brand" />{t('Le lien à coller (sticker « Lien » ou bio)')}</p>
              <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate text-xs" dir="ltr">{link}</code>
                <Btn className="px-3" onClick={() => copy(link)}>{copied === link ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Btn></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn tone="brand" onClick={() => share(false)}><Share2 className="h-4 w-4" /> {t('Partager')}</Btn>
              <Btn onClick={() => share(true)}><Download className="h-4 w-4" /> {t('Télécharger')}</Btn>
            </div>
          </div>
          <canvas ref={canvas} style={{ aspectRatio: `${w}/${h}` }} className="mx-auto w-[260px] rounded-2xl shadow-xl" />
        </div>
      </Card>

      {people.length > 0 && (
        <Card>
          <h2 className="mb-1 font-display text-xl font-semibold">{t('Le lien de chaque personne')}</h2>
          <p className="mb-3 text-sm text-muted">{t('À mettre dans la bio de chacune : ses clientes réservent directement avec elle.')}</p>
          <ul className="divide-y divide-line/10">
            {people.map(p => { const l = `${MENU_URL}/${r.slug}?rdv&p=${p.id}`; return (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <span className="w-28 font-semibold">{p.name}</span>
                <code className="min-w-0 flex-1 truncate text-xs text-muted" dir="ltr">{l}</code>
                <Btn className="px-3" onClick={() => copy(l)}>{copied === l ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Btn>
              </li>); })}
          </ul>
        </Card>
      )}

      <ClientStories r={r} />
    </div>
  );
}

/** What the clients share by themselves, and what they get for it. */
function ClientStories({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [on, setOn] = useState(r.branding.guest_share ?? true);
  const [ig, setIg] = useState(r.branding.instagram ?? '');
  const [actions, setActions] = useState<GuestAction[]>(() => guestActionsOf(r.branding));
  const [busy, setBusy] = useState(false);
  const owner = a.canEditProfile;
  const save = async () => {
    setBusy(true);
    try {
      check(await supabase.from('restaurants').update({ branding: { ...r.branding, guest_share: on, instagram: ig.replace(/^@/, '').trim() || undefined, guest_actions: actions.map(x => ({ ...x, name: x.name.trim() })) } }).eq('id', r.id).select('id'));
      a.toast(t('Enregistré')); await a.reload();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Camera className="h-5 w-5 text-brand" />{t('Les stories de vos clientes')}</h2>
      <ul className="mb-4 space-y-1.5 text-sm text-muted">
        <li>• {t('Le miroir : après avoir payé, le ticket WhatsApp et le ticket imprimé ont un lien. La cliente prend sa photo dans le miroir, le cadre à votre nom est prêt.')}</li>
        <li>• {t('« J’ai rendez-vous » : après une réservation en ligne, une story avec le jour, l’heure et votre @.')}</li>
        <li>• {t('« Je suis n°3 » : dans la Nouba, une story avec la place et l’attente, pour que ses amis viennent aussi.')}</li>
      </ul>
      <fieldset disabled={!owner} className="space-y-4">
        <Field label={t('Votre compte Instagram')} hint={t('Affiché sur toutes les stories.')}>
          <input dir="ltr" className={inputCls} value={ig} onChange={e => setIg(e.target.value.replace(/^@/, '').trim())} placeholder="mon_salon" />
        </Field>
        <Toggle checked={on} onChange={setOn} label={t('Récompenser les clientes qui partagent le miroir')} />
        {on && <GuestActions restaurantId={r.id} actions={actions} onChange={setActions} currency={r.currency} salon />}
      </fieldset>
      {owner && <div className="mt-4 flex justify-end"><Btn tone="brand" disabled={busy} onClick={save}><Save className="h-4 w-4" /> {t('Enregistrer')}</Btn></div>}
    </Card>
  );
}
