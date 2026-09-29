import { useCallback, useEffect, useState } from 'react';
import { Plus, KeyRound, Pencil } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, rpc } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Restaurant, Staff } from '../lib/types';
import { Btn, Field, Modal, Toggle, inputCls } from '../components/ui';

export function StaffPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [edit, setEdit] = useState<Staff | 'new' | null>(null);
  const [pinFor, setPinFor] = useState<Staff | null>(null);
  const load = useCallback(async () => {
    try { setStaff(check(await supabase.from('staff').select('id,name,role,active').eq('restaurant_id', r.id).order('active', { ascending: false }).order('name')) as Staff[]); } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  const toggle = async (s: Staff) => { try { check(await supabase.from('staff').update({ active: !s.active }).eq('id', s.id).select('id')); load(); } catch (e) { a.fail(e); } };
  return (
    <div>
      <div className="mb-6 flex items-center justify-between"><h1 className="font-display text-3xl font-semibold">Personnel</h1><Btn tone="brand" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> Ajouter</Btn></div>
      <p className="mb-4 text-sm text-muted">Chaque employé choisit son nom sur la caisse et tape son code. Les managers valident remises, annulations, avoirs et clôture Z.</p>
      <ul className="divide-y divide-line/10 overflow-hidden card rounded-3xl">
        {staff.map(s => (
          <li key={s.id} className={`flex items-center gap-3 px-4 py-3 ${s.active ? '' : 'opacity-50'}`}>
            <div className="flex-1"><p className="font-semibold">{s.name}</p><p className="text-sm text-muted">{s.role === 'manager' ? 'Manager' : 'Employé'}</p></div>
            <Btn onClick={() => setPinFor(s)}><KeyRound className="h-4 w-4" /> Code</Btn>
            <Btn onClick={() => setEdit(s)}><Pencil className="h-4 w-4" /></Btn>
            <Toggle checked={s.active} onChange={() => toggle(s)} label={s.active ? 'Actif' : 'Inactif'} />
          </li>
        ))}
        {!staff.length && <li className="px-4 py-10 text-center text-muted">Aucun employé.</li>}
      </ul>
      {edit && <StaffEditor r={r} s={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {pinFor && <PinEditor s={pinFor} onClose={() => setPinFor(null)} />}
    </div>
  );
}

function StaffEditor({ r, s, onClose, onSaved }: { r: Restaurant; s: Staff | null; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [name, setName] = useState(s?.name ?? '');
  const [role, setRole] = useState<Staff['role']>(s?.role ?? 'staff');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (s) check(await supabase.from('staff').update({ name: name.trim(), role }).eq('id', s.id).select('id'));
      else {
        const row = check(await supabase.from('staff').insert({ restaurant_id: r.id, name: name.trim(), role }).select('id').single()) as { id: string };
        await rpc('set_staff_pin', { p_staff_id: row.id, p_pin: pin });
      }
      a.toast('Enregistré'); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const ok = name.trim() && (s || /^\d{4,6}$/.test(pin));
  return (
    <Modal title={s ? `Modifier ${s.name}` : 'Nouvel employé'} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={!ok || busy} onClick={save}>Enregistrer</Btn></div>}>
      <div className="space-y-4">
        <Field label="Prénom (affiché sur la caisse)"><input autoFocus className={inputCls} maxLength={40} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field group label="Rôle">
          <div className="flex gap-2">{(['staff', 'manager'] as const).map(x => <button key={x} type="button" onClick={() => setRole(x)} className={`flex-1 rounded-xl py-2.5 font-semibold ${role === x ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{x === 'manager' ? 'Manager' : 'Employé'}</button>)}</div>
        </Field>
        {!s && <Field label="Code (4 à 6 chiffres)" hint="Personnel : évitez 1234, 0000 et les dates de naissance."><input className={inputCls} inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></Field>}
      </div>
    </Modal>
  );
}

function PinEditor({ s, onClose }: { s: Staff; onClose: () => void }) {
  const a = useAdminCtx();
  const [pin, setPin] = useState('');
  const save = async () => { try { await rpc('set_staff_pin', { p_staff_id: s.id, p_pin: pin }); a.toast(`Nouveau code pour ${s.name}`); onClose(); } catch (e) { a.fail(e); } };
  return (
    <Modal title={`Nouveau code pour ${s.name}`} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={!/^\d{4,6}$/.test(pin)} onClick={save}>Enregistrer</Btn></div>}>
      <Field label="Code (4 à 6 chiffres)" hint="Le code n'est jamais affiché ni stocké en clair. Un changement débloque aussi un compte bloqué après 5 erreurs.">
        <input autoFocus className={inputCls} inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
      </Field>
    </Modal>
  );
}
