// The salon's client card: visits, no-shows, notes and tags, an allergy (a colour can need a test first),
// and the colour formulas: what was used, by whom, when. Opened from the client list or an appointment.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FlaskConical, MessageCircle, Phone, Plus, Save, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, inputCls } from './ui';
import { svcName } from '../pages/AgendaServicesPage';
import { waLink } from '../lib/whatsapp';

export interface ClientCard {
  id: string; name: string | null; phone: string; note: string | null; tags: string[]; allergies: string | null; birthday: string | null;
  visits: number; spent_cents: number; first: string | null; last: string | null; no_shows: number; cancelled: number;
  appointments: { id: string; starts_at: string; status: string; service: Record<string, string>; duration_min: number; price_cents: number; staff_id: string | null; note: string | null }[];
  formulas: { id: string; created_at: string; service: string | null; formula: string; note: string | null; staff_id: string | null }[];
}
export const CLIENT_TAGS = ['VIP', 'Fidèle', 'Nouveau', 'Cuir chevelu sensible', 'Toujours en retard'];
const mad = (c: number) => `${(Number(c) / 100).toLocaleString('fr-FR')} DH`;

export function useClient(r: Restaurant, phone: string | null) {
  const [c, setC] = useState<ClientCard | null | undefined>(undefined);
  const load = useCallback(async () => {
    if (!phone) { setC(null); return; }
    const { data } = await supabase.rpc('agenda_client', { p_restaurant_id: r.id, p_phone: phone });
    setC((data ?? null) as ClientCard | null);
  }, [r.id, phone]);
  useEffect(() => { load(); }, [load]);
  return { c, load };
}

export function ClientCardModal({ r, phone, onClose }: { r: Restaurant; phone: string; onClose: () => void }) {
  const a = useAdminCtx();
  const tz = r.timezone || 'UTC';
  const { c, load } = useClient(r, phone);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [services, setServices] = useState<{ id: string; name: Record<string, string> }[]>([]);
  const [f, setF] = useState<{ note: string; allergies: string; tags: string[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [fm, setFm] = useState({ service: '', formula: '', note: '', staff: '' });
  useEffect(() => {
    supabase.from('staff').select('id, name').eq('restaurant_id', r.id).eq('active', true).eq('agenda', true).order('name').then(x => setPeople(x.data ?? []));
    supabase.from('agenda_services').select('id, name').eq('restaurant_id', r.id).eq('active', true).order('sort_order').then(x => setServices((x.data ?? []) as { id: string; name: Record<string, string> }[]));
  }, [r.id]);
  useEffect(() => { if (c) setF({ note: c.note ?? '', allergies: c.allergies ?? '', tags: c.tags ?? [] }); }, [c]);
  const who = (id: string | null) => people.find(p => p.id === id)?.name ?? '';
  const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' });

  const saveCard = async () => {
    if (!c || !f) return;
    const { error } = await supabase.from('customers').update({ note: f.note.trim() || null, allergies: f.allergies.trim() || null, tags: f.tags }).eq('id', c.id).select('id');
    if (error) { a.fail(error); return; }
    a.toast(t('Enregistré')); load();
  };
  const addFormula = async () => {
    if (!c || !fm.formula.trim()) return;
    const { error } = await supabase.from('agenda_formulas').insert({ restaurant_id: r.id, customer_id: c.id, service: fm.service || null, formula: fm.formula.trim(), note: fm.note.trim() || null, staff_id: fm.staff || null });
    if (error) { a.fail(error); return; }
    setAdding(false); setFm({ service: '', formula: '', note: '', staff: '' }); load();
  };
  const delFormula = async (id: string) => {
    const { error } = await supabase.from('agenda_formulas').delete().eq('id', id);
    if (error) { a.fail(error); return; }
    load();
  };

  if (c === undefined) return <Modal title="…" onClose={onClose}><p className="text-muted">{t('Chargement…')}</p></Modal>;
  if (c === null) return <Modal title={phone} onClose={onClose}><p className="text-muted">{t('Pas encore de fiche pour ce numéro.')}</p></Modal>;
  const changed = f && (f.note !== (c.note ?? '') || f.allergies !== (c.allergies ?? '') || f.tags.join() !== (c.tags ?? []).join());
  return (
    <Modal wide title={c.name || c.phone} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-2 font-semibold"><Phone className="h-4 w-4" />{c.phone}</a>
          <a href={waLink(c.phone, '')} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-2 font-semibold"><MessageCircle className="h-4 w-4" />WhatsApp</a>
          {c.allergies && <span className="inline-flex items-center gap-1.5 rounded-xl bg-red-500/10 px-3 py-2 font-semibold text-red-600"><AlertTriangle className="h-4 w-4" />{c.allergies}</span>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[[t('Visites'), String(c.visits)], [t('Dernière visite'), c.last ? date(c.last) : '–'], [t('Pas venu'), String(c.no_shows)], [t('Dépensé'), mad(c.spent_cents)]].map(([k, v]) => (
            <div key={k} className={`rounded-2xl bg-surface-2 p-3 ${k === t('Pas venu') && c.no_shows ? 'bg-red-500/10 text-red-600' : ''}`}><p className="text-xs text-muted">{k}</p><p className="font-display text-xl font-semibold">{v}</p></div>
          ))}
        </div>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="me-auto flex items-center gap-2 font-semibold"><FlaskConical className="h-4 w-4 text-brand" />{t('Formules couleur')}</h3>
            {!adding && <Btn className="px-3 py-1.5 text-sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> {t('Ajouter')}</Btn>}
          </div>
          {adding && (
            <div className="mb-3 space-y-3 rounded-2xl border border-brand/30 bg-brand/5 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('Prestation')}>
                  <select className={inputCls} value={fm.service} onChange={e => setFm({ ...fm, service: e.target.value })}>
                    <option value="">–</option>{services.map(s => <option key={s.id} value={svcName(s)}>{svcName(s)}</option>)}
                  </select>
                </Field>
                <Field label={t('Par')}>
                  <select className={inputCls} value={fm.staff} onChange={e => setFm({ ...fm, staff: e.target.value })}>
                    <option value="">–</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label={t('Formule')}><textarea className={`${inputCls} min-h-[64px]`} maxLength={500} value={fm.formula} onChange={e => setFm({ ...fm, formula: e.target.value })} placeholder={t('Ex. : 6.1 + 7.1 (1/2), oxydant 20 vol, pose 35 min')} autoFocus /></Field>
              <Field label={t('Remarque (facultatif)')}><input className={inputCls} maxLength={300} value={fm.note} onChange={e => setFm({ ...fm, note: e.target.value })} placeholder={t('Résultat, ce qu’on changerait la prochaine fois…')} /></Field>
              <div className="flex justify-end gap-2"><Btn onClick={() => setAdding(false)}>{t('Annuler')}</Btn><Btn tone="brand" disabled={!fm.formula.trim()} onClick={addFormula}><Save className="h-4 w-4" /> {t('Enregistrer')}</Btn></div>
            </div>
          )}
          {!c.formulas.length && !adding ? <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{t('Aucune formule. Notez la couleur après chaque coloration : la prochaine sera identique, même avec une autre coiffeuse.')}</p> : (
            <ul className="space-y-2">
              {c.formulas.map(x => (
                <li key={x.id} className="rounded-2xl bg-surface-2 p-3">
                  <p className="flex items-center gap-2 text-xs text-muted"><span>{date(x.created_at)}</span>{x.service && <span>· {x.service}</span>}{x.staff_id && <span>· {who(x.staff_id)}</span>}
                    <button className="ms-auto text-muted hover:text-danger" onClick={() => delFormula(x.id)} aria-label={t('Supprimer')}><Trash2 className="h-3.5 w-3.5" /></button></p>
                  <p className="mt-1 whitespace-pre-wrap font-semibold">{x.formula}</p>
                  {x.note && <p className="mt-1 text-sm text-muted">{x.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {f && <section className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {CLIENT_TAGS.map(tag => {
              const on = f.tags.includes(tag);
              return <button key={tag} type="button" onClick={() => setF({ ...f, tags: on ? f.tags.filter(x => x !== tag) : [...f.tags, tag].slice(0, 8) })}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${on ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted'}`}>{t(tag)}</button>;
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Allergie ou contre-indication')}><input className={inputCls} maxLength={200} value={f.allergies} onChange={e => setF({ ...f, allergies: e.target.value })} placeholder={t('Ex. : réaction à la PPD, test 48 h avant')} /></Field>
            <Field label={t('Note')}><input className={inputCls} maxLength={300} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={t('Préférences, ce qu’elle aime…')} /></Field>
          </div>
          {changed && <div className="flex justify-end"><Btn tone="brand" onClick={saveCard}><Save className="h-4 w-4" /> {t('Enregistrer')}</Btn></div>}
        </section>}

        <section>
          <h3 className="mb-2 font-semibold">{t('Historique')}</h3>
          <ul className="divide-y divide-line/10 text-sm">
            {c.appointments.map(x => (
              <li key={x.id} className="flex flex-wrap items-center gap-x-3 py-2">
                <span className="w-28 shrink-0 tabular text-muted">{date(x.starts_at)}</span>
                <span className="flex-1 font-semibold">{svcName({ name: x.service })}{x.staff_id ? <span className="font-normal text-muted"> · {who(x.staff_id)}</span> : null}</span>
                <span className={`text-xs font-bold ${x.status === 'no_show' ? 'text-red-600' : x.status === 'cancelled' ? 'text-muted line-through' : x.status === 'done' ? 'text-emerald-600' : 'text-muted'}`}>
                  {({ requested: t('À confirmer'), confirmed: t('À venir'), arrived: t('Arrivé'), done: t('Terminé'), cancelled: t('Annulé'), no_show: t('Pas venu') } as Record<string, string>)[x.status] ?? x.status}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  );
}
