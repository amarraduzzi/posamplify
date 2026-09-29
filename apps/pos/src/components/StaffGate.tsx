import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { usePos } from '../store';
import { rpc } from '../lib/data';
import { PIN_ERRORS, errorMessage } from '../lib/errors';
import type { Staff } from '../lib/types';
import { PinPad } from './PinPad';
import { isNetworkError } from '../lib/supabase';
import { checkPinOffline, forgetPinIfStale, rememberPin } from '../lib/pins';
import { AmplifyLogo, PatternBackdrop, initials } from './Brand';
import { getLang, t } from '../lib/i18n';
import { LangSwitch } from './LangSwitch';

/** Staff pick their name and type their PIN. Shown at start and after the idle lock. */
export function StaffGate() {
  const pos = usePos();
  const [who, setWho] = useState<Staff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = pos.restaurant!;
  // nobody is working: a good moment to switch to a new app version, if one is waiting
  useEffect(() => { if (!import.meta.env.PROD) return; import('../lib/sw').then(m => m.applyUpdateIfWaiting()).catch(() => {}); }, []);
  const submit = async (pin: string) => {
    if (!who) return;
    setBusy(true); setError(null);
    const offline = async () => {
      // no internet: unlock with the PIN this till remembered at the last online login
      const res = await checkPinOffline(r.id, who.id, pin);
      if (res === 'ok') pos.setStaff(who);
      else if (res === 'unknown') setError(t('Première connexion de {name} sur ce poste : une connexion internet est nécessaire.', { name: who.name }));
      else setError(PIN_ERRORS[res] ?? t('Code incorrect.'));
    };
    try {
      if (!pos.online) await offline();
      else {
        const res = await rpc<{ ok: boolean; error?: string; staff?: Staff }>('verify_staff_pin', { p_restaurant_id: r.id, p_staff_id: who.id, p_pin: pin });
        if (res.ok && res.staff) { pos.setStaff({ ...who, ...res.staff }); void rememberPin(r.id, who.id, pin); }
        else {
          if (res.error === 'invalid') void forgetPinIfStale(r.id, who.id, pin);
          setError(PIN_ERRORS[res.error ?? 'invalid'] ?? t('Code incorrect.'));
        }
      }
    } catch (e) {
      if (isNetworkError(e)) await offline();
      else setError(errorMessage(e));
    }
    setBusy(false);
  };
  return (
    <div className="ambient relative flex h-full flex-col items-center justify-center gap-8 overflow-hidden p-6">
      <PatternBackdrop />
      <div className="absolute start-6 top-5 flex items-center gap-4">
        <AmplifyLogo size="sm" className="opacity-90" />
        <LangSwitch />
      </div>
      <Clock tz={r.timezone} />
      <div className="rise relative text-center">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-brand">{who ? t('Code personnel') : t('Bienvenue')}</p>
        <h1 className="mt-2 font-display text-5xl font-semibold">{r.name}</h1>
        <p className="mt-2 text-lg text-muted">{who ? t('Code de {name}', { name: who.name }) : t('Qui êtes-vous ?')}</p>
      </div>
      {!who ? (
        <div className="relative grid w-full max-w-3xl grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {pos.staffList.map((s, i) => (
            <button key={s.id} onClick={() => { setWho(s); setError(null); }} style={{ animationDelay: `${i * 40}ms` }}
              className="rise panel group flex flex-col items-center gap-3 rounded-3xl px-4 py-6 transition hover:-translate-y-0.5 hover:border-brand/60 active:scale-95">
              <span aria-hidden className={`grid h-16 w-16 place-items-center rounded-full text-xl font-bold ${
                s.role === 'manager' ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-brand ring-1 ring-brand/30 group-hover:ring-brand/70'}`}>
                {initials(s.name)}
              </span>
              <span className="text-lg font-bold leading-tight">{s.name}</span>
              {s.role === 'manager' && <span className="-mt-2 text-[11px] font-bold uppercase tracking-widest text-brand">{t('Manager')}</span>}
            </button>
          ))}
          {!pos.staffList.length && <p className="col-span-full text-center text-muted">{t("Aucun employé. Ajoutez le personnel dans l'espace gérant.")}</p>}
        </div>
      ) : (
        <div className="rise panel relative w-full max-w-sm rounded-3xl p-6">
          <div className="mb-5 flex items-center justify-center gap-3">
            <span aria-hidden className={`grid h-12 w-12 place-items-center rounded-full font-bold ${who.role === 'manager' ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-brand ring-1 ring-brand/40'}`}>{initials(who.name)}</span>
            <span className="text-xl font-bold">{who.name}</span>
          </div>
          <PinPad onSubmit={submit} busy={busy} error={error} />
          <button onClick={() => setWho(null)} className="mx-auto mt-5 flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t("Changer d'employé")}</button>
        </div>
      )}
      <button onClick={pos.logout} className="relative text-xs text-muted/60 hover:text-ink">{t('Déconnecter ce poste')}</button>
    </div>
  );
}

function Clock({ tz }: { tz: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = window.setInterval(() => setNow(Date.now()), 10000); return () => window.clearInterval(i); }, []);
  const d = new Date(now);
  return (
    <div className="absolute end-6 top-5 text-end">
      <p className="font-display text-3xl font-semibold tabular leading-none">{d.toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}</p>
      <p className="mt-1 text-xs capitalize text-muted">{d.toLocaleDateString(getLang() === 'ar' ? 'ar-MA' : 'fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' })}</p>
    </div>
  );
}

/** Asks a manager to approve an action. Returns the manager id + PIN, verified server side by the action itself. */
export function ManagerApproval({ onApprove, busy, error }: { onApprove: (managerId: string, pin: string) => void; busy?: boolean; error?: string | null }) {
  const pos = usePos();
  const managers = pos.staffList.filter(s => s.role === 'manager');
  const [who, setWho] = useState<string>(pos.staff?.role === 'manager' ? pos.staff.id : managers[0]?.id ?? '');
  if (!managers.length) return <p className="text-danger">{t('Aucun manager défini pour ce restaurant.')}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-center gap-2">
        {managers.map(m => (
          <button key={m.id} onClick={() => setWho(m.id)}
            className={`rounded-full px-4 py-2 text-sm font-bold transition ${who === m.id ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink'}`}>{m.name}</button>
        ))}
      </div>
      <PinPad onSubmit={pin => onApprove(who, pin)} busy={busy} error={error} />
    </div>
  );
}
