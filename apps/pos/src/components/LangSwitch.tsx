import { usePos } from '../store';
import { LANGS } from '../lib/i18n';

/** Français / العربية switch, remembered on this till and per staff member. */
export function LangSwitch({ className = '' }: { className?: string }) {
  const pos = usePos();
  return (
    <div className={`flex rounded-full border border-line/[0.08] bg-surface/70 p-1 ${className}`} role="group" aria-label="Langue / اللغة">
      {LANGS.map(l => (
        <button key={l.id} type="button" onClick={() => pos.setLang(l.id)} aria-pressed={pos.lang === l.id} lang={l.id}
          className={`rounded-full px-3 py-1 text-xs font-bold transition ${pos.lang === l.id ? 'gold-fill text-brand-ink' : 'text-muted hover:text-ink'}`}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
