// Pick allergens: one chip per allergen, in the language of the back office.
// value null = not filled in yet ("à vérifier"); [] = checked, none.
import { ALLERGEN_CODES, allergenIcon, allergenName } from '@resto/shared';
import { getLang, t } from '../lib/i18n';

export function AllergenChips({ value, onChange, tone = 'brand', disabled }: {
  value: string[]; onChange: (v: string[]) => void; tone?: 'brand' | 'warn'; disabled?: boolean;
}) {
  const lang = getLang();
  const on = tone === 'warn' ? 'border-warn bg-warn/10 text-warn' : 'border-brand bg-brand/10 text-brand';
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALLERGEN_CODES.map(c => {
        const sel = value.includes(c);
        return (
          <button key={c} type="button" disabled={disabled} aria-pressed={sel}
            onClick={() => onChange(sel ? value.filter(x => x !== c) : [...value, c])}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${sel ? on : 'border-line/[0.12] text-muted hover:bg-surface-2'}`}>
            <span aria-hidden>{allergenIcon(c)}</span>{allergenName(c, lang)}
          </button>
        );
      })}
    </div>
  );
}

/** Read-only list of allergens (small badges). */
export function AllergenBadges({ list, tone = 'brand' }: { list: string[]; tone?: 'brand' | 'muted' }) {
  const lang = getLang();
  return (
    <span className="inline-flex flex-wrap gap-1">
      {list.map(c => (
        <span key={c} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone === 'muted' ? 'bg-surface-2 text-muted' : 'bg-brand/10 text-brand'}`}>
          <span aria-hidden>{allergenIcon(c)}</span>{allergenName(c, lang)}
        </span>
      ))}
    </span>
  );
}

/** The block used in the ingredient form and on the allergens page. */
export function AllergenSection({ value, onChange, traces, onTraces, compact }: {
  value: string[] | null; onChange: (v: string[] | null) => void;
  traces?: string[]; onTraces?: (v: string[]) => void; compact?: boolean;
}) {
  const none = value != null && value.length === 0;
  return (
    <div className={compact ? '' : 'rounded-2xl bg-surface-2 p-4'}>
      {!compact && <p className="mb-1 text-sm font-bold">{t('Allergènes')}</p>}
      {value == null && <p className="mb-2 text-xs font-semibold text-warn">{t('Pas encore renseigné : les produits qui l’utilisent restent « à compléter ».')}</p>}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={none} onClick={() => onChange(none ? null : [])}
          className={`rounded-full border px-3 py-1 text-xs font-bold transition ${none ? 'border-ok bg-ok/10 text-ok' : 'border-line/[0.12] text-muted hover:bg-surface-2'}`}>
          {none ? '✓ ' : ''}{t('Aucun allergène (vérifié)')}
        </button>
      </div>
      <AllergenChips value={value ?? []} onChange={v => onChange(v)} disabled={none} />
      {traces && onTraces && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-semibold text-muted">{t('Peut contenir des traces de')}</p>
          <AllergenChips value={traces} onChange={onTraces} tone="warn" />
        </div>
      )}
    </div>
  );
}
