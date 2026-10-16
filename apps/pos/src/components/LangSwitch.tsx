import { usePos } from '../store';
import { LANGS } from '../lib/i18n';

/** Français / العربية / English switch, remembered on this till and per staff member. */
export function LangSwitch({ className = '', compact }: { className?: string; /** FR / ع / EN on a phone */ compact?: boolean }) {
  const pos = usePos();
  return (
    <div className={`flex rounded-full border border-line/[0.08] bg-surface/70 p-1 ${className}`} role="group" aria-label="Langue / اللغة / Language">
      {LANGS.map(l => (
        <button key={l.id} type="button" onClick={() => pos.setLang(l.id)} aria-pressed={pos.lang === l.id} lang={l.id}
          className={`rounded-full px-3 py-1 text-xs font-bold transition ${pos.lang === l.id ? 'gold-fill text-brand-ink' : 'text-muted hover:text-ink'}`}>
          {compact ? <><span className="sm:hidden">{l.short}</span><span className="hidden sm:inline">{l.label}</span></> : l.label}
        </button>
      ))}
    </div>
  );
}
