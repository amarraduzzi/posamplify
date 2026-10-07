import { useCaptcha } from '../lib/captcha';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, Clock3, KeyRound, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { rpc } from '../lib/data';
import { errorMessage } from '../lib/errors';
import { usePos } from '../store';
import { Btn, Field, inputCls } from './ui';
import { AmplifyLogo, PatternBackdrop } from './Brand';
import { t } from '../lib/i18n';
import { LangSwitch } from './LangSwitch';

// i18n:values
const CODE_ERRORS: Record<string, string> = {
  invalid_code: "Code invalide ou expiré. Demandez un nouveau code dans l'espace gérant.",
  already_member: 'Ce compte gère déjà ce restaurant.',
  ordering_unavailable: 'Abonnement du restaurant suspendu.',
};
// i18n:end

/**
 * Connects this till to a restaurant. Default: a one-time code created by the
 * owner in the back office (no e-mail account needed for the till). Also shown
 * when a till was disconnected by the owner (session exists, no restaurant).
 */
export function Login({ disconnected }: { disconnected?: boolean }) {
  const pos = usePos();
  const [mode, setMode] = useState<'code' | 'email'>('code');
  // opened from the QR code in the back office: the code comes with the link
  const [code, setCode] = useState(() => { try { return (new URLSearchParams(window.location.search).get('code') ?? '').toUpperCase().slice(0, 9); } catch { return ''; } });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cap = useCaptcha();
  const [focus, setFocus] = useState(false);

  const pair = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const captchaToken = cap.token;
        cap.reset(); // a token works only once
        const { error } = await supabase.auth.signInAnonymously({ options: { captchaToken } });
        if (error) throw error;
      }
      await rpc('pair_device', { p_code: code.replace(/\s|-/g, '') });
      // do not keep the one-time code in the address (nor in a home-screen shortcut)
      try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
      await pos.refreshMemberships();
    } catch (err) {
      const m = (err as Error).message;
      setError(CODE_ERRORS[m] ? t(CODE_ERRORS[m]) : (/anonymous/i.test(m) ? t("La connexion par code n'est pas activée (Supabase : Allow anonymous sign-ins).") : errorMessage(err)));
    }
    setBusy(false);
  };
  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const captchaToken = cap.token;
    cap.reset();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password, options: { captchaToken } });
    if (error) setError(errorMessage(error));
    setBusy(false);
  };

  const clean = code.replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return (
    <div className="flex h-full">
      <PairShowcase />
      <div className="lg-side relative grid flex-1 place-items-center overflow-y-auto p-6 lg:max-w-xl">
        <PatternBackdrop className="opacity-60 lg:hidden" />
        <div className="rise relative w-full max-w-sm">
          <div className="mb-10 flex items-center justify-between gap-3 lg:justify-end">
            <AmplifyLogo className="whitespace-nowrap lg:hidden" />
            <LangSwitch />
          </div>
          <p className="inline-flex items-center gap-2 rounded-full bg-[rgb(var(--brand)/.12)] px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />{mode === 'code' ? t('Une seule fois par poste') : t('Compte du poste')}
          </p>
          <h1 className="lg-h mt-4 text-[clamp(3rem,9vw,4.25rem)]">
            <span className="block overflow-hidden"><span className="lg-rise block">{t('Relier')}</span></span>
            <span className="block overflow-hidden"><span className="lg-rise block text-brand" style={{ animationDelay: '.1s' }}>{t('cette caisse.')}</span></span>
          </h1>
          <p className="mb-7 mt-3 text-muted">{disconnected ? t("Ce poste n'est relié à aucun restaurant.") : mode === 'code' ? t('Tapez le code affiché dans votre espace gérant, rubrique « Caisses ».') : t('Relier ce poste à votre restaurant (une seule fois).')}</p>
          {mode === 'code' ? (
            <form onSubmit={pair} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold">{t('Code de connexion')}</span>
                <span className="relative block" dir="ltr">
                  <input autoFocus aria-label={t('Code de connexion')} className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0" maxLength={9} value={clean}
                    onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                    onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} />
                  <span className="grid grid-cols-8 gap-1.5" aria-hidden>
                    {Array.from({ length: 8 }, (_, i) => (
                      <span key={i} className={`lg-box relative grid h-14 place-items-center rounded-xl border-2 border-[rgb(var(--line)/.14)] bg-surface ${i === 4 ? 'ms-2' : ''} ${clean[i] ? 'full' : ''} ${focus && i === Math.min(clean.length, 7) ? 'on' : ''}`}>
                        {clean[i] ? <span key={clean[i] + i} className="lg-ch lg-code text-3xl">{clean[i]}</span>
                          : focus && i === clean.length ? <span className="lg-caret h-6 w-0.5 rounded bg-brand" /> : <span className="h-1 w-3 rounded bg-[rgb(var(--line)/.18)]" />}
                      </span>
                    ))}
                  </span>
                </span>
              </label>
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />{t("Le code se crée dans l'espace gérant, rubrique « Caisses ». Il est valable 30 minutes.")}</p>
              {error && <p className="shake rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">{error}</p>}
              <Btn tone="brand" className="h-14 w-full text-base" disabled={busy || !cap.ready || clean.length !== 8}>
                {clean.length === 8 && !busy ? <ArrowRight className="h-5 w-5 rtl:rotate-180" /> : <KeyRound className="h-5 w-5" />}
                {busy ? t('Connexion…') : !cap.ready ? t('Vérification anti-robot…') : clean.length === 8 ? t('Relier ce poste') : t('{n} caractères sur 8', { n: clean.length })}
              </Btn>
            </form>
          ) : (
            <form onSubmit={login} className="space-y-4">
              <Field label={t('E-mail du poste')}><input className={inputCls} dir="ltr" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
              <Field label={t('Mot de passe')}><input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
              {error && <p className="shake rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">{error}</p>}
              <Btn tone="brand" className="h-14 w-full text-base" disabled={busy || !cap.ready}>{busy ? t('Connexion…') : !cap.ready ? t('Vérification anti-robot…') : t('Se connecter')}</Btn>
            </form>
          )}
          {/* one widget for both forms (it must stay mounted) */}
          <div className="mt-4">{cap.widget}</div>
          <button onClick={() => { setMode(mode === 'code' ? 'email' : 'code'); setError(null); }} className="mx-auto mt-6 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
            {mode === 'code' ? <><Mail className="h-4 w-4" /> {t('Se connecter avec un e-mail')}</> : <><KeyRound className="h-4 w-4" /> {t('Utiliser un code de connexion')}</>}
          </button>
          {disconnected && <button onClick={pos.logout} className="mx-auto mt-2 block text-xs text-muted/70 hover:text-ink">{t('Se déconnecter')}</button>}
        </div>
      </div>
    </div>
  );
}

/**
 * Left side on large screens: how a till gets connected, shown as a loop of the three real steps
 * (code in the back office, code typed here, staff pick their name). Illustration, no real data.
 */
function PairShowcase() {
  const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [step, setStep] = useState(still ? 2 : 0);
  const [typed, setTyped] = useState(still ? 8 : 0);
  useEffect(() => {
    if (still) return;
    const id = setInterval(() => setStep(s => (s + 1) % 3), 2800);
    return () => clearInterval(id);
  }, [still]);
  useEffect(() => {
    if (still || step !== 1) return;
    setTyped(0);
    const id = setInterval(() => setTyped(n => (n >= 8 ? n : n + 1)), 190);
    return () => clearInterval(id);
  }, [step, still]);
  const CODE = 'K7Q2M9XA';
  const steps = [t('Espace gérant'), t('Code sur la caisse'), t('Caisse prête')];
  const people = [['Karim', t('Manager')], ['Salma', t('Serveuse')], ['Youssef', t('Serveur')], ['Nadia', t('Caisse')]];
  return (
    <section className="lg-show relative hidden flex-1 flex-col justify-between overflow-hidden p-12 text-white lg:flex">
      <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_80%_60%,rgba(5,185,98,.22),transparent_70%),radial-gradient(40%_40%_at_0%_0%,rgba(5,185,98,.12),transparent_70%)]" />
      <span className="lg-grid pointer-events-none absolute inset-0" />
      <AmplifyLogo size="lg" className="relative" />

      <div className="relative grid items-end gap-10 xl:grid-cols-[1fr_21rem]">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold ring-1 ring-white/15">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#05B962] opacity-60" /><span className="relative h-2 w-2 rounded-full bg-[#05B962]" /></span>
            {t('Amplify POS · la caisse')}
          </p>
          <h2 className="lg-h mt-6 text-[clamp(3.4rem,5.6vw,6rem)]">
            <span className="block overflow-hidden"><span className="lg-rise block">{t('Un code.')}</span></span>
            <span className="block overflow-hidden"><span className="lg-rise block text-[#05B962]" style={{ animationDelay: '.12s' }}>{t('Et on encaisse.')}</span></span>
          </h2>
          <ul className="mt-8 space-y-2.5 text-white/80">
            {[t('Chaque employé avec son code personnel'), t('Bons cuisine et bar imprimés tout seuls'), t('Même quand internet tombe')].map((x, i) => (
              <li key={x} className="lg-in flex items-center gap-3" style={{ animationDelay: `${.3 + i * .1}s` }}>
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#05B962] text-[#001E3E]"><Check className="h-3 w-3" strokeWidth={3.2} /></span>{x}
              </li>
            ))}
          </ul>
        </div>

        {/* the loop */}
        <div className="lg-card" aria-hidden="true">
          <div className="relative h-[17.5rem] overflow-hidden rounded-[1.75rem] bg-white/[0.06] p-4 ring-1 ring-white/15 backdrop-blur-md">
            {step === 0 && (
              <div key="s0" className="lg-in flex h-full flex-col">
                <div className="flex items-center gap-1.5 px-1"><span className="h-2 w-2 rounded-full bg-white/25" /><span className="h-2 w-2 rounded-full bg-white/25" /><span className="h-2 w-2 rounded-full bg-white/25" /><span className="ms-2 text-[0.65rem] text-white/50" dir="ltr">app.amplifygrowthstudio.com</span></div>
                <div className="mt-3 flex flex-1 gap-3">
                  <div className="w-20 space-y-1.5 text-[0.65rem]">
                    {[t('Menu'), t('Tables'), t('Caisses'), t('Ventes')].map((x, i) => <p key={x} className={`rounded-md px-2 py-1 ${i === 2 ? 'bg-[#05B962] font-bold text-[#001E3E]' : 'text-white/50'}`}>{x}</p>)}
                  </div>
                  <div className="flex flex-1 flex-col items-center justify-center rounded-xl bg-white text-center text-[#001E3E]">
                    <p className="text-[0.7rem] font-semibold text-[#4A5A6E]">{t('Code pour la nouvelle caisse')}</p>
                    <p className="lg-pop lg-code mt-1 text-[2rem] leading-none tracking-[0.12em]" dir="ltr">{CODE.slice(0, 4)}<span className="text-[#05B962]">·</span>{CODE.slice(4)}</p>
                    <p className="mt-2 text-[0.65rem] text-[#4A5A6E]">{t('Valable 30 minutes')}</p>
                  </div>
                </div>
              </div>
            )}
            {step === 1 && (
              <div key="s1" className="lg-in flex h-full flex-col justify-center">
                <p className="text-center text-xs font-semibold text-white/60">{t('Sur la tablette du comptoir')}</p>
                <div className="mt-4 grid grid-cols-8 gap-1" dir="ltr">
                  {CODE.split('').map((ch, i) => (
                    <span key={i} className={`grid h-11 place-items-center rounded-lg border-2 ${i < typed ? 'border-[#05B962]/60 bg-[#05B962]/10' : i === typed ? 'border-[#05B962] bg-white/5' : 'border-white/15 bg-white/5'} ${i === 4 ? 'ms-1.5' : ''}`}>
                      {i < typed && <span className="lg-pop lg-code text-xl">{ch}</span>}
                    </span>
                  ))}
                </div>
                <p className={`mx-auto mt-5 flex h-10 items-center gap-2 rounded-xl px-5 text-sm font-bold transition-colors ${typed >= 8 ? 'bg-[#05B962] text-[#001E3E]' : 'bg-white/10 text-white/50'}`}>{t('Relier ce poste')}</p>
              </div>
            )}
            {step === 2 && (
              <div key="s2" className="lg-in flex h-full flex-col">
                <p className="flex items-center gap-2 text-sm font-bold"><span className="lg-pop grid h-6 w-6 place-items-center rounded-full bg-[#05B962] text-[#001E3E]"><Check className="h-3.5 w-3.5" strokeWidth={3.2} /></span>{t('Caisse reliée')}</p>
                <p className="mt-1 text-xs text-white/55">{t('Qui êtes-vous ? Choisissez votre nom, puis votre code.')}</p>
                <div className="mt-4 grid flex-1 grid-cols-2 gap-2">
                  {people.map(([n, r], i) => (
                    <div key={n} className="lg-in flex items-center gap-2.5 rounded-xl bg-white/[0.06] px-2.5 ring-1 ring-white/10" style={{ animationDelay: `${.15 + i * .08}s` }}>
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black ${i === 0 ? 'bg-[#05B962] text-[#001E3E]' : 'bg-white/15'}`}>{n[0]}</span>
                      <span className="min-w-0 leading-tight"><span className="block text-sm font-semibold">{n}</span><span className="block truncate text-[0.65rem] text-white/50">{r}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <ol className="mt-3 grid grid-cols-3 gap-2">
            {steps.map((x, i) => (
              <li key={x} className="text-[0.7rem] font-semibold">
                <span className="block h-1 overflow-hidden rounded-full bg-white/15">{i <= step && <span key={`${step}-${i}`} className={`block h-full origin-left rounded-full bg-[#05B962] rtl:origin-right ${i === step && !still ? 'lg-bar' : ''}`} />}</span>
                <span className={`mt-1.5 block ${i === step ? 'text-white' : 'text-white/45'}`}>{i + 1}. {x}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="relative flex items-center justify-between gap-4">
        <p className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold ring-1 ring-white/15"><span className="text-[#05B962]">★</span> {t('Pas de compte e-mail pour la caisse')}</p>
        <p className="text-xs text-white/35">{t('Illustration')}</p>
      </div>
    </section>
  );
}
