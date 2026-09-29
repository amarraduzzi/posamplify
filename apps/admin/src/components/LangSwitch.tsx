import { useAdminCtx } from '../store';
import { LANGS } from '../lib/i18n';

/** Français / العربية switch, remembered in this browser. dark = on the midnight sidebar. */
export function LangSwitch({ className = '', dark }: { className?: string; dark?: boolean }) {
  const a = useAdminCtx();
  return (
    <div className={`inline-flex rounded-full border p-1 ${dark ? 'border-white/10 bg-white/[0.04]' : 'border-line/[0.1] bg-surface'} ${className}`} role="group" aria-label="Langue / اللغة">
      {LANGS.map(l => (
        <button key={l.id} type="button" onClick={() => a.setLang(l.id)} aria-pressed={a.lang === l.id} lang={l.id}
          className={`flex-1 rounded-full px-3 py-1 text-xs font-bold transition ${a.lang === l.id ? 'gold-fill text-brand-ink' : dark ? 'text-white/60 hover:text-white' : 'text-muted hover:text-ink'}`}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
