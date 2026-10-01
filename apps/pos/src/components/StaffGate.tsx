import { useEffect, useState } from 'react';
import { ArrowLeft, Clock3 } from 'lucide-react';
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
export function StaffGate({ onKitchen }: { onKitchen?: () => void }) {
  const pos = usePos();
  const [who, setWho] = useState<Staff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clocking, setClocking] = useState(false);
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
      {/* clock-in / out: only useful when the owner has Amplify Profit to read the hours */}
      {r.products?.includes('profit') && pos.staffList.length > 0 && (
        <button onClick={() => setClocking(true)} className="panel relative flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold hover:border-brand/60">
          <Clock3 className="h-4 w-4 text-brand" /> {t('Pointer arrivée / départ')}
        </button>
      )}
      <div className="relative flex items-center gap-4 text-xs text-muted/60">
        {onKitchen && <button onClick={onKitchen} className="hover:text-ink">{t('Écran cuisine')}</button>}
        <button onClick={pos.logout} className="hover:text-ink">{t('Déconnecter ce poste')}</button>
      </div>
      {clocking && <ClockIn onClose={() => setClocking(false)} />}
    </div>
  );
}

/** Clock in or out with the personal PIN. Needs the internet (hours are kept on the server). */
function ClockIn({ onClose }: { onClose: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const [who, setWho] = useState<Staff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ action: 'in' | 'out'; name: string; minutes?: number; forgot?: boolean } | null>(null);
  useEffect(() => { if (!done) return; const i = window.setTimeout(onClose, 3500); return () => window.clearTimeout(i); }, [done, onClose]);
  const submit = async (pin: string) => {
    if (!who) return;
    if (!pos.online) { setError(t('Pas de connexion internet : le pointage n’est pas possible pour le moment.')); return; }
    setBusy(true); setError(null);
    try {
      const res = await rpc<{ ok: boolean; error?: string; action: 'in' | 'out'; name: string; minutes?: number; forgot?: boolean }>('pos_clock', { p_restaurant_id: r.id, p_staff_id: who.id, p_pin: pin });
      if (res.ok) setDone(res);
      else setError(PIN_ERRORS[res.error ?? 'invalid'] ?? t('Code incorrect.'));
    } catch (e) { setError(isNetworkError(e) ? t('Pas de connexion internet : le pointage n’est pas possible pour le moment.') : errorMessage(e)); }
    setBusy(false);
  };
  const time = new Date().toLocaleTimeString('fr-FR', { timeZone: r.timezone, hour: '2-digit', minute: '2-digit' });
  const dur = (m = 0) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#02050c]/80 p-6 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" className="pop panel w-full max-w-2xl rounded-3xl p-6">
        {done ? (
          <div className="py-8 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-brand">{done.action === 'in' ? t('Arrivée') : t('Départ')} · {time}</p>
            <h2 className="mt-3 font-display text-4xl font-semibold">{done.action === 'in' ? t('Bonjour {name} !', { name: done.name }) : t('Bonne soirée {name} !', { name: done.name })}</h2>
            {done.action === 'out' && <p className="mt-2 text-lg text-muted">{t('Temps de travail : {d}', { d: dur(done.minutes) })}</p>}
            {done.forgot && <p className="mt-3 text-sm text-warn">{t('Votre dernier départ n’avait pas été pointé. Le gérant le corrigera.')}</p>}
          </div>
        ) : !who ? (
          <>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold">{t('Qui pointe ?')}</h2>
              <button onClick={onClose} className="text-sm text-muted hover:text-ink">{t('Annuler')}</button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {pos.staffList.map(s => (
                <button key={s.id} onClick={() => { setWho(s); setError(null); }} className="panel flex items-center gap-3 rounded-2xl px-4 py-4 text-start hover:border-brand/60 active:scale-95">
                  <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 font-bold text-brand">{initials(s.name)}</span>
                  <span className="font-bold">{s.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="mx-auto max-w-sm">
            <p className="mb-4 text-center text-lg">{t('Code de {name}', { name: who.name })}</p>
            <PinPad onSubmit={submit} busy={busy} error={error} />
            <button onClick={() => setWho(null)} className="mx-auto mt-5 flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t("Changer d'employé")}</button>
          </div>
        )}
      </div>
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
