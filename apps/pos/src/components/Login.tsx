import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { Btn, Field, inputCls } from './ui';

/** One-time login of the till itself (its own account, set up by the owner). */
export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(errorMessage(error));
    setBusy(false);
  };
  return (
    <div className="grid h-full place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line/10 bg-surface p-6">
        <div>
          <h1 className="text-2xl font-bold">Caisse</h1>
          <p className="text-sm text-muted">Connexion de ce poste (une seule fois).</p>
        </div>
        <Field label="E-mail du poste"><input className={inputCls} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
        <Field label="Mot de passe"><input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
        <Btn tone="brand" className="w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</Btn>
      </form>
    </div>
  );
}
