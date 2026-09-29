import { useEffect, useState, type ReactNode } from 'react';
import { X, ImagePlus, Trash2, Link as LinkIcon } from 'lucide-react';
import type { I18n } from '../lib/types';

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" className={`pop flex max-h-full w-full flex-col rounded-2xl bg-surface shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between gap-3 border-b border-line/10 px-5 py-3.5">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Fermer" className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line/10 px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

type Tone = 'brand' | 'plain' | 'ghost' | 'danger';
const T: Record<Tone, string> = {
  brand: 'bg-brand text-brand-ink hover:brightness-110',
  plain: 'bg-surface-2 text-ink hover:bg-surface-3',
  ghost: 'border border-line/15 bg-surface text-ink hover:bg-surface-2',
  danger: 'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/15',
};
export function Btn({ tone = 'plain', className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-40 ${T[tone]} ${className}`} />;
}
export const inputCls = 'w-full rounded-xl border border-line/15 bg-surface px-3.5 py-2.5 outline-none placeholder:text-muted/60 focus:border-brand disabled:bg-surface-2 disabled:text-muted';
/** A labelled control. Use group for button groups / multi-input widgets (a <label> would name the first button). */
export function Field({ label, hint, children, group }: { label: string; hint?: string; children: ReactNode; group?: boolean }) {
  const inner = <><span className="mb-1 block text-sm font-semibold">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}</>;
  return group ? <div role="group" aria-label={label} className="block">{inner}</div> : <label className="block">{inner}</label>;
}
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-sm disabled:opacity-50" aria-pressed={checked}>
      <span className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-ok' : 'bg-surface-3'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-[22px]' : 'left-0.5'}`} /></span>
      {label && <span>{label}</span>}
    </button>
  );
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line/10 bg-surface p-5 ${className}`}>{children}</div>;
}

const LBL: Record<string, string> = { fr: 'Français', en: 'English', ar: 'العربية', es: 'Español' };
/** One text in several languages; the first language is required. */
const SHORT: Record<string, string> = { fr: 'FR', en: 'EN', ar: 'ع', es: 'ES' };
export function I18nInput({ value, onChange, langs, multiline, max = 80, required, compact, ariaLabel }: {
  value: I18n; onChange: (v: I18n) => void; langs: string[]; multiline?: boolean; max?: number; required?: boolean; compact?: boolean; ariaLabel?: string;
}) {
  const [cur, setCur] = useState(langs[0]);
  const set = (t: string) => { const n = { ...value, [cur]: t.slice(0, max) }; if (!n[cur]) delete n[cur]; onChange(n); };
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <div>
      <div className="mb-1.5 flex gap-1">
        {langs.map((l, i) => (
          <button key={l} type="button" onClick={() => setCur(l)}
            className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold ${cur === l ? 'bg-ink text-bg' : 'bg-surface-2 text-muted'}`}>
            {(compact ? SHORT[l] : LBL[l]) ?? l}{i === 0 && required ? ' *' : ''}{value[l] ? '' : ' ·'}
          </button>
        ))}
      </div>
      <Tag aria-label={ariaLabel ? `${ariaLabel} (${LBL[cur] ?? cur})` : undefined} dir={cur === 'ar' ? 'rtl' : 'ltr'} rows={multiline ? 3 : undefined} className={inputCls} value={value[cur] ?? ''} onChange={e => set(e.target.value)}
        placeholder={cur === langs[0] ? '' : `${LBL[cur] ?? cur} (facultatif, sinon ${LBL[langs[0]] ?? langs[0]})`} />
    </div>
  );
}

/** Photo: upload a file (resized in the browser) or paste a link. */
export function ImageField({ url, onChange, upload, aspect = 'aspect-[4/3]' }: {
  url: string | null; onChange: (u: string | null) => void; upload: (f: File) => Promise<string>; aspect?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true); setErr(null);
    try { onChange(await upload(f)); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="space-y-2">
      <div className={`relative w-full max-w-xs overflow-hidden rounded-xl bg-surface-2 ${aspect}`}>
        {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center p-2 text-center text-sm text-muted">{url ? 'Photo introuvable' : 'Pas de photo'}</div>}
        {busy && <div className="absolute inset-0 grid place-items-center bg-white/70 text-sm font-semibold">Envoi…</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm font-semibold hover:bg-surface-3">
          <ImagePlus className="h-4 w-4" /> {url ? 'Changer' : 'Ajouter une photo'}
          <input type="file" accept="image/*" className="hidden" onChange={e => pick(e.target.files?.[0])} />
        </label>
        <Btn type="button" onClick={() => setLink(v => !v)}><LinkIcon className="h-4 w-4" /> Lien</Btn>
        {url && <Btn type="button" tone="danger" onClick={() => onChange(null)}><Trash2 className="h-4 w-4" /></Btn>}
      </div>
      {link && <input className={inputCls} placeholder="https://…" defaultValue={url ?? ''} onBlur={e => onChange(e.target.value.trim() || null)} />}
      {err && <p className="text-sm text-danger">{err}</p>}
    </div>
  );
}
