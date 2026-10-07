import { useCallback, useEffect, useState } from 'react';
import { Monitor, Trash2, Plus, Copy, ExternalLink, RefreshCw, Tablet } from 'lucide-react';
import QRCode from 'qrcode';
import { MENU_URL } from '../lib/supabase';
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
  // Essentiel: one till; it can be paired again, a second one needs the Restaurant plan
  const full = r.pos_plan === 'essentiel' && tills.length >= 1;
  return (
    <div>
      <div className="mb-6 flex items-center justify-between"><h1 className="font-display text-3xl font-semibold">{t('Caisses')}</h1><Btn tone="brand" disabled={full} onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> {t('Relier une caisse')}</Btn></div>
      {full && <p className="mb-4 rounded-2xl bg-warn/10 px-4 py-3 text-sm font-semibold text-warn">{t('Formule Essentiel : 1 caisse. Pour relier une autre caisse ou des téléphones de serveurs, passez à la formule Restaurant (écrivez-nous sur WhatsApp). Pour remplacer cette caisse, retirez-la d’abord.')}</p>}
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
      <KioskCard r={r} />
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

/** Ordering kiosk: a tablet at the entrance that runs the menu in kiosk mode with a secret link. */
function KioskCard({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [qr, setQr] = useState('');
  const link = r.kiosk_token ? `${MENU_URL}/${r.slug}?borne=${r.kiosk_token}` : '';
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 400 }).then(setQr).catch(() => {}); }, [link]);
  const set = async (on: boolean) => {
    const tok = on ? Array.from(crypto.getRandomValues(new Uint8Array(20)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'[b % 55]).join('') : null;
    try { check(await supabase.from('restaurants').update({ kiosk_token: tok }).eq('id', r.id).select('id')); await a.reload(); a.toast(t('Enregistré')); } catch (e) { a.fail(e); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); a.toast(t('Copié')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  return (
    <div className="mt-8 card rounded-3xl p-5">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold"><Tablet className="h-5 w-5 text-brand" />{t('Borne de commande')}</h2>
      <p className="mt-1 text-sm text-muted">{t('Une tablette à l’entrée où les clients commandent seuls, sur place ou à emporter. Ils reçoivent un numéro et paient à la caisse. Les commandes arrivent comme les commandes QR.')}</p>
      {!r.kiosk_token ? (
        a.canEditProfile && <Btn tone="brand" className="mt-4" onClick={() => set(true)}><Plus className="h-4 w-4" /> {t('Activer la borne')}</Btn>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {qr && <img src={qr} alt="" className="h-28 w-28 rounded-xl bg-white p-1" />}
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            <p>{t('Ouvrez ce lien sur la tablette de la borne (scannez le QR), puis mettez le navigateur en plein écran. Gardez ce lien privé.')}</p>
            <div className="flex flex-wrap gap-2">
              <Btn className="py-1.5" onClick={copy}><Copy className="h-4 w-4" /> {t('Copier')}</Btn>
              <a href={link} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5 font-semibold"><ExternalLink className="h-4 w-4" /> {t('Voir')}</a>
              {a.canEditProfile && <Btn className="py-1.5" onClick={() => set(true)}><RefreshCw className="h-4 w-4" /> {t('Nouveau lien')}</Btn>}
              {a.canEditProfile && <Btn tone="danger" className="py-1.5" onClick={() => set(false)}>{t('Désactiver')}</Btn>}
            </div>
          </div>
        </div>
      )}
      <p className="mt-4 rounded-xl bg-surface-2 p-3 text-sm text-muted"><Monitor className="me-1 inline h-4 w-4" />{t('Écran client : se règle sur la caisse, dans Réglages du poste > Écran client.')}</p>
    </div>
  );
}
