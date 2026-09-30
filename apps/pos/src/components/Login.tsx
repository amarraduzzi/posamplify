import { useState } from 'react';
import { KeyRound, Mail } from 'lucide-react';
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
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pair = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
      }
      await rpc('pair_device', { p_code: code.replace(/\s|-/g, '') });
      await pos.refreshMemberships();
    } catch (err) {
      const m = (err as Error).message;
      setError(CODE_ERRORS[m] ? t(CODE_ERRORS[m]) : (/anonymous/i.test(m) ? t("La connexion par code n'est pas activée (Supabase : Allow anonymous sign-ins).") : errorMessage(err)));
    }
    setBusy(false);
  };
  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(errorMessage(error));
    setBusy(false);
  };

  return (
    <div className="ambient relative grid h-full place-items-center overflow-hidden p-6">
      <PatternBackdrop />
      <div className="rise relative w-full max-w-md">
        <div className="mb-8 flex justify-end"><LangSwitch /></div>
        <AmplifyLogo size="lg" className="mb-8 justify-center" />
        <div className="panel rounded-3xl p-8">
          <h1 className="font-display text-3xl font-semibold">{t('Caisse')}</h1>
          <p className="mb-6 mt-1 text-sm text-muted">{disconnected ? t("Ce poste n'est relié à aucun restaurant.") : t('Relier ce poste à votre restaurant (une seule fois).')}</p>
          {mode === 'code' ? (
            <form onSubmit={pair} className="space-y-4">
              <Field label={t('Code de connexion')}>
                <input autoFocus className={`${inputCls} h-16 text-center font-display text-3xl font-semibold uppercase tracking-[0.35em]`} maxLength={9} value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXXXXXX" autoComplete="off" />
              </Field>
              <p className="text-xs leading-relaxed text-muted">{t("Le code se crée dans l'espace gérant, rubrique « Caisses ». Il est valable 30 minutes.")}</p>
              {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">{error}</p>}
              <Btn tone="brand" className="h-14 w-full text-base" disabled={busy || code.replace(/\s|-/g, '').length !== 8}><KeyRound className="h-5 w-5" /> {busy ? t('Connexion…') : t('Relier ce poste')}</Btn>
            </form>
          ) : (
            <form onSubmit={login} className="space-y-4">
              <Field label={t('E-mail du poste')}><input className={inputCls} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
              <Field label={t('Mot de passe')}><input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
              {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">{error}</p>}
              <Btn tone="brand" className="h-14 w-full text-base" disabled={busy}>{busy ? t('Connexion…') : t('Se connecter')}</Btn>
            </form>
          )}
          <button onClick={() => { setMode(mode === 'code' ? 'email' : 'code'); setError(null); }} className="mx-auto mt-5 flex items-center gap-1.5 text-sm text-muted hover:text-ink">
            {mode === 'code' ? <><Mail className="h-4 w-4" /> {t('Se connecter avec un e-mail')}</> : <><KeyRound className="h-4 w-4" /> {t('Utiliser un code de connexion')}</>}
          </button>
          {disconnected && <button onClick={pos.logout} className="mx-auto mt-2 block text-xs text-muted/70 hover:text-ink">{t('Se déconnecter')}</button>}
        </div>
      </div>
    </div>
  );
}
