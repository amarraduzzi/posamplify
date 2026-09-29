import { useState } from 'react';
import { KeyRound, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { rpc } from '../lib/data';
import { errorMessage } from '../lib/errors';
import { usePos } from '../store';
import { Btn, Field, inputCls } from './ui';

const CODE_ERRORS: Record<string, string> = {
  invalid_code: 'Code invalide ou expiré. Demandez un nouveau code dans l\'espace gérant.',
  already_member: 'Ce compte gère déjà ce restaurant.',
  ordering_unavailable: 'Abonnement du restaurant suspendu.',
};

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
      setError(CODE_ERRORS[m] ?? (/anonymous/i.test(m) ? "La connexion par code n'est pas activée (Supabase : Allow anonymous sign-ins)." : errorMessage(err)));
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
    <div className="grid h-full place-items-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line/10 bg-surface p-6">
        <h1 className="text-2xl font-bold">Caisse</h1>
        <p className="mb-5 text-sm text-muted">{disconnected ? 'Ce poste n\'est relié à aucun restaurant.' : 'Relier ce poste à votre restaurant (une seule fois).'}</p>
        {mode === 'code' ? (
          <form onSubmit={pair} className="space-y-4">
            <Field label="Code de connexion">
              <input autoFocus className={`${inputCls} text-center text-2xl font-bold uppercase tracking-[0.3em]`} maxLength={9} value={code}
                onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXXXXXX" autoComplete="off" />
            </Field>
            <p className="text-xs text-muted">Le code se crée dans l'espace gérant, rubrique « Caisses ». Il est valable 30 minutes.</p>
            {error && <p className="text-sm font-semibold text-danger">{error}</p>}
            <Btn tone="brand" className="w-full" disabled={busy || code.replace(/\s|-/g, '').length !== 8}><KeyRound className="h-4 w-4" /> {busy ? 'Connexion…' : 'Relier ce poste'}</Btn>
          </form>
        ) : (
          <form onSubmit={login} className="space-y-4">
            <Field label="E-mail du poste"><input className={inputCls} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
            <Field label="Mot de passe"><input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
            {error && <p className="text-sm font-semibold text-danger">{error}</p>}
            <Btn tone="brand" className="w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</Btn>
          </form>
        )}
        <button onClick={() => { setMode(mode === 'code' ? 'email' : 'code'); setError(null); }} className="mx-auto mt-4 flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          {mode === 'code' ? <><Mail className="h-4 w-4" /> Se connecter avec un e-mail</> : <><KeyRound className="h-4 w-4" /> Utiliser un code de connexion</>}
        </button>
        {disconnected && <button onClick={pos.logout} className="mx-auto mt-2 block text-xs text-muted/70 hover:text-ink">Se déconnecter</button>}
      </div>
    </div>
  );
}
