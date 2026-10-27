// Allergens on the guest menu. Shown only when the owner switched them on (get_menu_allergens returns something).
// A product that is not completely filled in shows NOTHING precise: never "no allergens" by omission.
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { ALLERGEN_CODES, allergenIcon, allergenName } from '@resto/shared';
import type { Strings } from '../lib/strings';

export interface AllergenInfo { ok: boolean; a: string[]; m: string[] }

/** The allergens of one product, one small line. Nothing when there is none to tell. */
export function AllergenLine({ info, lang, t }: { info: AllergenInfo | null | undefined; lang: string; t: Strings }) {
  if (!info || !info.ok || (info.a.length === 0 && info.m.length === 0)) return null;
  return (
    <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
      {info.a.length > 0 && <span><b className="font-semibold">{t.allergens} :</b> {info.a.map(c => `${allergenIcon(c)} ${allergenName(c, lang)}`).join(' · ')}</span>}
      {info.a.length > 0 && info.m.length > 0 && <br />}
      {info.m.length > 0 && <span>{t.allergenTraces} {info.m.map(c => allergenName(c, lang)).join(', ')}</span>}
    </p>
  );
}

/** The full block in the product sheet (also says when it is not known). */
export function AllergenBlock({ info, lang, t }: { info: AllergenInfo | null | undefined; lang: string; t: Strings }) {
  if (!info) return null;
  return (
    <div className="mt-4 rounded-2xl bg-surface-2 p-3.5 text-sm">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted"><ShieldAlert className="size-3.5" />{t.allergens}</p>
      {!info.ok
        ? <p className="text-muted">{t.allergenUnknown}</p>
        : info.a.length === 0 && info.m.length === 0
          ? <p className="text-muted">{t.allergenNone}</p>
          : <AllergenLine info={info} lang={lang} t={t} />}
    </div>
  );
}

/** "I have an allergy": hides the products that contain it, may contain it, or are not verified. */
export function AllergenFilter({ avoid, onChange, hidden, lang, t }: {
  avoid: string[]; onChange: (v: string[]) => void; hidden: number; lang: string; t: Strings;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-2xl card p-3">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2 text-start text-sm font-semibold">
        <ShieldAlert className="size-4 text-brand" />
        <span className="flex-1">{t.allergyAsk}</span>
        {avoid.length > 0 && <span className="rounded-full bg-brand/12 px-2 py-0.5 text-[11px] font-bold text-brand tabular-nums">{avoid.length}</span>}
      </button>
      {(open || avoid.length > 0) && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-muted">{t.allergyHide}</p>
          <div className="flex flex-wrap gap-1.5">
            {ALLERGEN_CODES.map(c => {
              const on = avoid.includes(c);
              return (
                <button key={c} type="button" aria-pressed={on}
                  onClick={() => onChange(on ? avoid.filter(x => x !== c) : [...avoid, c])}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${on ? 'border-brand bg-brand/12 text-brand' : 'border-line text-muted'}`}>
                  <span aria-hidden>{allergenIcon(c)}</span>{allergenName(c, lang)}
                </button>
              );
            })}
          </div>
          {avoid.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>{t.allergyHidden(hidden)}</span>
              <button type="button" onClick={() => onChange([])} className="font-semibold text-brand">{t.allergyClear}</button>
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted">{t.allergyNote}</p>
        </div>
      )}
    </div>
  );
}
