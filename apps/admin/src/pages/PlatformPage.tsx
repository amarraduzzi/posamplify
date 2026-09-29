import { useEffect, useState } from 'react';
import { Plus, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, rpc } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, inputCls } from '../components/ui';

const STATUS: Record<string, string> = { trial: 'Essai', active: 'Actif', paused: 'Suspendu', cancelled: 'Résilié' };

/** Your own screen: all restaurants, create one, pause for non-payment, add logins. */
export function PlatformPage() {
  const a = useAdminCtx();
  const [list, setList] = useState<Restaurant[]>([]);
  const [creating, setCreating] = useState(false);
  const [member, setMember] = useState<Restaurant | null>(null);
  const load = async () => { try { setList(check(await supabase.from('restaurants').select('*').order('created_at')) as Restaurant[]); } catch (e) { a.fail(e); } };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const status = async (r: Restaurant, s: string, days?: number) => {
    try {
      await rpc('admin_set_status', { p_restaurant_id: r.id, p_status: s, p_trial_ends_at: days ? new Date(Date.now() + days * 86400000).toISOString() : null });
      a.toast(`${r.name} : ${STATUS[s]}`); await load(); await a.reload();
    } catch (e) { a.fail(e); }
  };
  return (
    <div>
      <div className="mb-6 flex items-center justify-between"><h1 className="text-2xl font-bold">Plateforme</h1><Btn tone="brand" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau restaurant</Btn></div>
      <div className="overflow-x-auto rounded-2xl border border-line/10 bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-muted"><tr><th className="px-4 py-2">Restaurant</th><th>Statut</th><th>Fin d'essai</th><th className="px-4 text-right">Actions</th></tr></thead>
          <tbody>
            {list.map(r => (
              <tr key={r.id} className="border-t border-line/10">
                <td className="px-4 py-2.5"><p className="font-semibold">{r.name}</p><p className="text-xs text-muted">{r.slug}{r.is_demo ? ' · démo' : ''}</p></td>
                <td><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.status === 'active' ? 'bg-ok/15 text-ok' : r.status === 'trial' ? 'bg-warn/15 text-warn' : 'bg-danger/10 text-danger'}`}>{STATUS[r.status]}</span></td>
                <td className="tabular">{r.trial_ends_at && r.status === 'trial' ? new Date(r.trial_ends_at).toLocaleDateString('fr-FR') : '—'}</td>
                <td className="px-4 py-2 text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    <Btn className="px-2.5 py-1.5" onClick={() => setMember(r)}><UserPlus className="h-4 w-4" /></Btn>
                    {r.status !== 'active' && <Btn className="px-2.5 py-1.5" onClick={() => status(r, 'active')}>Activer</Btn>}
                    {r.status === 'trial' && <Btn className="px-2.5 py-1.5" onClick={() => status(r, 'trial', 14)}>+14 j</Btn>}
                    {r.status !== 'paused' && <Btn tone="danger" className="px-2.5 py-1.5" onClick={() => status(r, 'paused')}>Suspendre</Btn>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">Suspendre : le menu reste visible, mais les commandes et la caisse sont bloquées jusqu'à la réactivation.</p>
      {creating && <CreateRestaurant onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await load(); await a.reload(); }} />}
      {member && <AddMember r={member} onClose={() => setMember(null)} />}
    </div>
  );
}

function CreateRestaurant({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const auto = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const create = async () => {
    setBusy(true);
    try {
      await rpc('admin_create_restaurant', { p_slug: slug, p_name: name.trim(), p_owner_email: email.trim() || null, p_is_demo: demo });
      a.toast('Restaurant créé (essai de 30 jours)'); onDone();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title="Nouveau restaurant" onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !name.trim() || slug.length < 3} onClick={create}>Créer</Btn></div>}>
      <div className="space-y-4">
        <Field label="Nom"><input autoFocus className={inputCls} value={name} onChange={e => { setName(e.target.value); setSlug(auto(e.target.value)); }} /></Field>
        <Field label="Adresse du menu" hint={`Le menu sera sur …/${slug || 'nom-du-restaurant'}`}><input className={inputCls} value={slug} onChange={e => setSlug(auto(e.target.value))} /></Field>
        <Field label="E-mail du propriétaire (facultatif)" hint="Le compte doit déjà exister : Supabase > Authentication > Users > Add user."><input className={inputCls} type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)} /> Restaurant de démonstration</label>
      </div>
    </Modal>
  );
}

function AddMember({ r, onClose }: { r: Restaurant; onClose: () => void }) {
  const a = useAdminCtx();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'manager' | 'device'>('device');
  const add = async () => {
    try { await rpc('admin_add_member', { p_restaurant_id: r.id, p_email: email.trim(), p_role: role }); a.toast('Accès ajouté'); onClose(); } catch (e) { a.fail(e); }
  };
  return (
    <Modal title={`Accès à ${r.name}`} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={!email.includes('@')} onClick={add}>Ajouter</Btn></div>}>
      <div className="space-y-4">
        <Field label="E-mail du compte" hint="Créez d'abord le compte dans Supabase > Authentication > Users (Auto Confirm)."><input autoFocus className={inputCls} type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field label="Rôle">
          <select className={inputCls} value={role} onChange={e => setRole(e.target.value as typeof role)}>
            <option value="device">Caisse (poste)</option><option value="manager">Manager (menu, personnel, tables)</option><option value="owner">Propriétaire (tout)</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}
