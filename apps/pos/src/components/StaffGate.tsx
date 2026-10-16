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
import { LangMenu } from './LangMenu';
import { readCache, writeCache } from '../lib/cache';
import { isPhoneNow } from '../lib/phone';
import { InstallButton } from './InstallButton';

const LAST = 'gate-last-staff';

/** Staff pick their name and type their PIN. Shown at start and after the idle lock. */
export function StaffGate({ onKitchen }: { onKitchen?: () => void }) {
  const pos = usePos();
  // a phone is usually one waiter's own: start on his PIN pad
  const [who, setWho] = useState<Staff | null>(null);
  const [preset, setPreset] = useState(false);
  useEffect(() => {
    if (preset || !pos.staffList.length) return;
    setPreset(true);
    if (!isPhoneNow()) return;
    try { const id = localStorage.getItem(LAST); const s = pos.staffList.find(x => x.id === id); if (s) setWho(s); } catch { /* ignore */ }
  }, [pos.staffList, preset]);
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
  // who is clocked in, and the bookings left today (no money: every employee sees this screen)
  const [gate, setGate] = useState<{ on_duty: string[]; bookings_today: number } | null>(() => readCache(`gate:${r.id}`));
  useEffect(() => {
    if (!pos.online) return;
    rpc<{ on_duty: string[]; bookings_today: number }>('pos_gate_info', { p_restaurant_id: r.id })
      .then(x => { setGate(x); writeCache(`gate:${r.id}`, x); }).catch(() => {});
  }, [r.id, pos.online, clocking]);
  const onDuty = new Set(gate?.on_duty ?? []);
  const working = pos.staffList.filter(s => onDuty.has(s.id));
  const others = pos.staffList.filter(s => !onDuty.has(s.id));
  const tablesBusy = new Set(pos.orders.filter(o => o.table_id).map(o => o.table_id)).size;
  const facts = [
    tablesBusy > 0 && t('{n} table(s) occupée(s)', { n: tablesBusy }),
    pos.pendingQr.length > 0 && t('{n} commande(s) QR à accepter', { n: pos.pendingQr.length }),
    (gate?.bookings_today ?? 0) > 0 && t('{n} réservation(s) aujourd’hui', { n: gate!.bookings_today }),
  ].filter(Boolean) as string[];
  const logo = r.branding?.logo_url;
  const pick = (s: Staff) => { setWho(s); setError(null); try { localStorage.setItem(LAST, s.id); } catch { /* ignore */ } };
  const card = (s: Staff, i: number, on: boolean) => (
    <button key={s.id} onClick={() => pick(s)} style={{ animationDelay: `${i * 35}ms` }}
      className={`rise panel group relative flex w-[calc(50%-0.35rem)] items-center gap-3 rounded-2xl p-3 text-start sm:w-44 transition hover:border-brand/60 active:scale-[.97] sm:flex-col sm:gap-2 sm:rounded-3xl sm:px-4 sm:py-4 sm:text-center ${on ? '' : 'opacity-80'}`}>
      <span aria-hidden className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg font-bold sm:h-14 sm:w-14 ${
        s.role === 'manager' ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-brand ring-1 ring-brand/30 group-hover:ring-brand/70'}`}>
        {initials(s.name)}
        {on && <span className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface bg-ok" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-base font-bold leading-tight sm:text-lg">{s.name}</span>
        {s.role === 'manager' && <span className="text-[10px] font-bold uppercase tracking-widest text-brand">{t('Manager')}</span>}
      </span>
    </button>
  );
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: r.timezone }).format(new Date()));
  return (
    <div className="ambient relative flex h-full flex-col overflow-y-auto">
      <PatternBackdrop />
      {/* top: Amplify, the time, the language; one line on every screen */}
      <header className="relative flex items-center gap-3 px-5 pb-2 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 sm:pt-5">
        <AmplifyLogo size="sm" className="opacity-90" />
        <span className="ms-auto"><Clock tz={r.timezone} /></span>
        <LangMenu dark />
      </header>

      <main className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col items-center px-5 pb-4 pt-2 sm:justify-center sm:px-8">
        {/* the restaurant */}
        <div className="rise flex flex-col items-center text-center">
          {logo
            ? <img src={logo} alt="" className="h-20 w-20 rounded-3xl bg-white object-contain p-2 shadow-[0_12px_40px_-12px_rgb(var(--brand)/.5)] sm:h-16 sm:w-16" />
            : <span className="gold-fill grid h-20 w-20 place-items-center rounded-3xl font-display text-3xl font-semibold text-brand-ink sm:h-16 sm:w-16 sm:text-2xl">{initials(r.name)}</span>}
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.3em] text-brand">{who ? t('Code personnel') : hour >= 5 && hour < 18 ? t('Bonjour') : t('Bonsoir')}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold leading-tight sm:text-4xl">{r.name}</h1>
          {!who && facts.length > 0 && (
            <p className="mt-3 flex flex-wrap justify-center gap-2">
              {facts.map(f => <span key={f} className="rounded-full bg-surface-2/80 px-3 py-1 text-xs font-semibold text-muted">{f}</span>)}
            </p>
          )}
        </div>

        {!who ? (
          <div className="mt-6 w-full">
            {working.length > 0 && <p className="mb-2.5 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-ok"><span className="h-2 w-2 rounded-full bg-ok" />{t('En service')}</p>}
            <div className="flex flex-wrap justify-center gap-2.5 sm:gap-4">
              {(working.length ? working : others).map((s, i) => card(s, i, working.length > 0))}
            </div>
            {working.length > 0 && others.length > 0 && <>
              <p className="mb-2.5 mt-5 text-center text-xs font-bold uppercase tracking-[0.18em] text-muted">{t('Autres')}</p>
              <div className="flex flex-wrap justify-center gap-2.5 sm:gap-4">{others.map((s, i) => card(s, i, false))}</div>
            </>}
            {!pos.staffList.length && <p className="text-center text-muted">{t("Aucun employé. Ajoutez le personnel dans l'espace gérant.")}</p>}
          </div>
        ) : (
          <div className="rise panel relative mt-6 w-full max-w-sm rounded-3xl p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-center gap-3">
              <span aria-hidden className={`grid h-12 w-12 place-items-center rounded-full font-bold ${who.role === 'manager' ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-brand ring-1 ring-brand/40'}`}>{initials(who.name)}</span>
              <span className="text-xl font-bold">{who.name}</span>
            </div>
            <PinPad onSubmit={submit} busy={busy} error={error} round />
            <button onClick={() => setWho(null)} className="mx-auto mt-4 flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t("Changer d'employé")}</button>
          </div>
        )}

        {/* clock-in / out: only useful when the owner has Amplify Profit to read the hours */}
        {!who && r.products?.includes('profit') && pos.staffList.length > 0 && (
          <button onClick={() => setClocking(true)} className="panel relative mt-6 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold hover:border-brand/60">
            <Clock3 className="h-4 w-4 text-brand" /> {t('Pointer arrivée / départ')}
          </button>
        )}
      </main>
      <footer className="relative flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] text-xs text-muted/60">
        {onKitchen && <button onClick={onKitchen} className="hover:text-ink">{t('Écran cuisine')}</button>}
        <button onClick={pos.logout} className="hover:text-ink">{t('Déconnecter ce poste')}</button>
        <InstallButton link />
      </footer>
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
    <div className="text-end">
      <p className="font-display text-2xl font-semibold tabular leading-none sm:text-3xl">{d.toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}</p>
      <p className="mt-1 hidden text-xs capitalize text-muted sm:block">{d.toLocaleDateString(getLang() === 'ar' ? 'ar-MA' : getLang() === 'en' ? 'en-GB' : 'fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' })}</p>
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
