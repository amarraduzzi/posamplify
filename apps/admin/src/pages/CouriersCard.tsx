// The restaurant's own couriers: their private link (to send on WhatsApp), and how deliveries went.
import { useCallback, useEffect, useState } from 'react';
import { Bike, Copy, MessageCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { supabase, MENU_URL } from '../lib/supabase';
import { check, mad, rpc } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, inputCls } from '../components/ui';

interface Courier { id: string; name: string; phone: string | null; active: boolean; token: string }
interface Rep { id: string; delivered: number; failed: number; on_the_way: number; avg_minutes: number | null; cash_to_return_cents: number; delivered_cents: number }
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const intl = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '212' + d.slice(1) : d; };

export function CouriersCard({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [list, setList] = useState<Courier[]>([]);
  const [rep, setRep] = useState<Rep[]>([]);
  const [f, setF] = useState({ name: '', phone: '' });
  const load = useCallback(async () => {
    try {
      setList(check(await supabase.from('couriers').select('id,name,phone,active,token').eq('restaurant_id', r.id).order('active', { ascending: false }).order('name')) as Courier[]);
      setRep(await rpc<Rep[]>('courier_report', { p_restaurant_id: r.id, p_from: ymd(new Date(Date.now() - 6 * 86400_000)), p_to: ymd(new Date()) }));
    } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    try { check(await supabase.from('couriers').insert({ restaurant_id: r.id, name: f.name.trim(), phone: f.phone.trim() || null }).select('id')); setF({ name: '', phone: '' }); load(); } catch (e) { a.fail(e); }
  };
  const upd = async (c: Courier, patch: Partial<Courier> & { token?: string }) => { try { check(await supabase.from('couriers').update(patch).eq('id', c.id).select('id')); load(); } catch (e) { a.fail(e); } };
  const link = (c: Courier) => `${MENU_URL}/?livreur=${c.token}`;
  const copy = async (c: Courier) => { try { await navigator.clipboard.writeText(link(c)); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  const msg = (c: Courier) => t('Bonjour {n}, voici votre page de livraisons pour {r} : {l}', { n: c.name.split(' ')[0], r: r.name, l: link(c) });

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Bike className="h-5 w-5 text-brand" />{t('Livreurs')}</h2>
      <p className="mb-4 text-sm text-muted">{t('Vos propres livreurs. Chacun reçoit un lien privé sur son téléphone : ses courses, l’itinéraire, et la validation avec le code du client. La caisse choisit le livreur de chaque commande.')}</p>
      {list.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead><tr className="text-xs uppercase tracking-wider text-muted">{[t('Livreur'), t('Livrées (7 j)'), t('Problèmes'), t('Temps moyen'), t('À rapporter'), ''].map((h, i) => <th key={i} className="pb-2 pe-3 text-start font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line/10">
              {list.map(c => { const x = rep.find(y => y.id === c.id); return (
                <tr key={c.id} className={c.active ? '' : 'opacity-50'}>
                  <td className="py-2.5 pe-3"><p className="font-semibold">{c.name}</p><p className="text-xs text-muted" dir="ltr">{c.phone}</p></td>
                  <td className="py-2.5 pe-3 tabular">{x?.delivered ?? 0}{x && Number(x.on_the_way) > 0 && <span className="text-xs text-warn"> · {t('{n} en cours', { n: x.on_the_way })}</span>}</td>
                  <td className={`py-2.5 pe-3 tabular ${Number(x?.failed) > 0 ? 'text-danger' : ''}`}>{x?.failed ?? 0}</td>
                  <td className="py-2.5 pe-3 tabular">{x?.avg_minutes != null ? t('{n} min', { n: x.avg_minutes }) : '–'}</td>
                  <td className="py-2.5 pe-3 font-semibold tabular">{Number(x?.cash_to_return_cents) > 0 ? <span className="text-warn">{mad(Number(x!.cash_to_return_cents))}</span> : '–'}</td>
                  <td className="whitespace-nowrap py-2.5 text-end">
                    <Btn className="px-2 py-1.5" aria-label={t('Copier le lien')} onClick={() => copy(c)}><Copy className="h-4 w-4" /></Btn>{' '}
                    {c.phone && <a href={`https://wa.me/${intl(c.phone)}?text=${encodeURIComponent(msg(c))}`} target="_blank" rel="noopener" className="inline-flex items-center rounded-xl bg-[#25D366] px-2.5 py-1.5 text-[#063B1E]" aria-label="WhatsApp"><MessageCircle className="h-4 w-4" /></a>}{' '}
                    <Btn className="px-2 py-1.5" aria-label={t('Nouveau lien')} title={t('Nouveau lien (l’ancien ne marche plus)')} onClick={() => upd(c, { token: crypto.randomUUID().replace(/-/g, '') })}><RefreshCw className="h-4 w-4" /></Btn>{' '}
                    <Btn tone={c.active ? 'danger' : 'plain'} className="px-2 py-1.5 text-sm" onClick={() => upd(c, { active: !c.active })}>{c.active ? <Trash2 className="h-4 w-4" /> : t('Réactiver')}</Btn>
                  </td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1"><Field label={t('Nom')}><input className={inputCls} maxLength={40} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Hamza" /></Field></div>
        <div className="min-w-40 flex-1"><Field label={t('Téléphone (WhatsApp)')}><input className={inputCls} dir="ltr" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="06…" /></Field></div>
        <Btn tone="brand" disabled={!f.name.trim()} onClick={add}><Plus className="h-4 w-4" /> {t('Ajouter un livreur')}</Btn>
      </div>
      <p className="mt-3 text-xs text-muted">{t('« À rapporter » : les commandes livrées que la caisse n’a pas encore encaissées (espèces encore chez le livreur).')}</p>
    </Card>
  );
}
