import { useCallback, useEffect, useState } from 'react';
import { Monitor, Trash2, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, rpc } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, Modal, inputCls } from '../components/ui';
import { PairingCode } from './Onboarding';
import { dateLocale, t } from '../lib/i18n';

interface Member { user_id: string; role: string; label: string | null; created_at: string }
// i18n:values
const ROLE: Record<string, string> = { owner: 'Propriétaire', manager: 'Manager', device: 'Caisse' };
// i18n:end

/** Tills connected to this restaurant (and the other logins), with revoke. */
export function DevicesPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [members, setMembers] = useState<Member[]>([]);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState(() => t('Caisse'));
  const me = a.session?.user.id;
  const load = useCallback(async () => {
    try { setMembers(check(await supabase.from('memberships').select('user_id, role, label, created_at').eq('restaurant_id', r.id).order('created_at')) as Member[]); }
    catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  const revoke = async (m: Member) => {
    try { await rpc('revoke_member', { p_restaurant_id: r.id, p_user_id: m.user_id }); a.toast(t('Accès retiré')); load(); } catch (e) { a.fail(e); }
  };
  const tills = members.filter(m => m.role === 'device');
  const people = members.filter(m => m.role !== 'device');
  return (
    <div>
      <div className="mb-6 flex items-center justify-between"><h1 className="font-display text-3xl font-semibold">{t('Caisses')}</h1><Btn tone="brand" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> {t('Relier une caisse')}</Btn></div>
      <p className="mb-4 text-sm text-muted">{t("Chaque ordinateur, tablette ou téléphone de serveur est relié avec un code à usage unique. Si un appareil est perdu ou volé, retirez-le ici : il perd immédiatement l'accès.")}</p>
      <ul className="mb-8 divide-y divide-line/10 overflow-hidden card rounded-3xl">
        {tills.map(m => (
          <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
            <Monitor className="h-5 w-5 text-muted" />
            <div className="flex-1"><p className="font-semibold">{m.label ?? t('Caisse')}</p><p className="text-sm text-muted">{t('Reliée le {d}', { d: new Date(m.created_at).toLocaleDateString(dateLocale()) })}</p></div>
            {a.canEditProfile && <Btn tone="danger" onClick={() => revoke(m)}><Trash2 className="h-4 w-4" /> {t('Retirer')}</Btn>}
          </li>
        ))}
        {!tills.length && <li className="px-4 py-8 text-center text-muted">{t('Aucune caisse reliée.')}</li>}
      </ul>
      <h2 className="mb-3 font-display text-xl font-semibold">{t("Accès à l'espace gérant")}</h2>
      <ul className="divide-y divide-line/10 overflow-hidden card rounded-3xl">
        {people.map(m => (
          <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1"><p className="font-semibold">{ROLE[m.role] ? t(ROLE[m.role]) : m.role}{m.user_id === me ? ` ${t('(vous)')}` : ''}</p><p className="text-sm text-muted">{t('Depuis le {d}', { d: new Date(m.created_at).toLocaleDateString(dateLocale()) })}</p></div>
            {a.canEditProfile && m.user_id !== me && <Btn tone="danger" aria-label={t('Retirer')} onClick={() => revoke(m)}><Trash2 className="h-4 w-4" /></Btn>}
          </li>
        ))}
      </ul>
      {adding && (
        <Modal title={t('Relier une caisse')} onClose={() => { setAdding(false); load(); }}>
          <div className="space-y-4">
            <Field label={t("Nom de l'appareil")}><input className={inputCls} maxLength={40} value={label} onChange={e => setLabel(e.target.value)} placeholder={t('Caisse comptoir, Téléphone Youssef…')} /></Field>
            <PairingCode r={r} label={label} />
          </div>
        </Modal>
      )}
    </div>
  );
}
