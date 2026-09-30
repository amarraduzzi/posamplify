// "Importer mon menu": an Excel/CSV export of the old till, or photos / a PDF of
// the paper menu read by the AI. Everything is shown for checking first; one
// click imports it all (or nothing), and each import can be undone.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, Download, FileSpreadsheet, Loader2, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { tr } from '@resto/shared';
import { supabase } from '../lib/supabase';
import { check, errorMessage, rpc, toCents, fromCents } from '../lib/api';
import { fileForAi } from '../lib/image';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Category, I18n, Item, Restaurant } from '../lib/types';
import { Btn, Modal, inputCls } from './ui';
import {
  BLOCKING, ROLES, buildRows, suggestCategory, decodeText, detect, fromAi, issuesOf, norm, parseCsv, payload, templateCsv,
  type Cell, type DraftRow, type Issue, type Mapping, type Role,
} from '../lib/menuImport';

type Step = 'choose' | 'reading' | 'map' | 'preview' | 'saving' | 'done';
interface ImportRow { id: string; source: 'file' | 'photo'; file_name: string | null; created_at: string; item_ids: string[]; category_ids: string[]; skipped: number; undone_at: string | null }

// i18n:values
const ROLE_LABEL: Record<Role, string> = {
  ignore: 'Ne pas utiliser', category: 'Catégorie', name: 'Nom', name_ar: 'Nom en arabe', name_en: 'Nom en anglais',
  price: 'Prix', variant: 'Taille / variante', description: 'Description',
};
const ISSUE_LABEL: Record<Issue, string> = {
  no_name: 'Nom manquant', no_price: 'Prix manquant', zero_price: 'Prix à 0', duplicate: 'En double',
  exists: 'Déjà au menu, sera ignoré', too_long: 'Nom trop long',
};
// i18n:end

export function ImportMenu({ r, cats, items, onClose, onDone }: { r: Restaurant; cats: Category[]; items: Item[]; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const langs = r.languages.length ? r.languages : ['fr'];
  const latin = langs.find(l => l !== 'ar') ?? 'fr';
  const showAr = langs.includes('ar') && latin !== 'ar';
  const tn = (n: I18n) => tr(n, langs[0]);
  const [step, setStep] = useState<Step>('choose');
  const [source, setSource] = useState<'file' | 'photo'>('file');
  const [fileName, setFileName] = useState('');
  const [sheet, setSheet] = useState<Cell[][]>([]);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ import_id: string; items: number; categories: number; skipped: number } | null>(null);
  const [history, setHistory] = useState<ImportRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const loadHistory = async () => {
    try { setHistory(check(await supabase.from('menu_imports').select('*').eq('restaurant_id', r.id).order('created_at', { ascending: false }).limit(5)) as ImportRow[]); }
    catch { /* table missing on an old database: no history */ }
  };
  useEffect(() => { loadHistory(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const existing = useMemo(() => items.map(i => ({ category: cats.find(c => c.id === i.category_id)?.name ?? {}, name: i.name })), [items, cats]);
  const issues = useMemo(() => issuesOf(rows, existing), [rows, existing]);
  const included = rows.filter(x => x.include);
  const blocking = included.filter(x => issues.get(x.id)!.some(i => BLOCKING.includes(i)));
  const willSkip = included.filter(x => issues.get(x.id)!.some(i => i === 'exists' || i === 'duplicate')).length;
  const catKey = (c: I18n) => norm(Object.values(c)[0] ?? '');
  const groups = useMemo(() => {
    const m = new Map<string, DraftRow[]>();
    for (const x of rows) { const k = catKey(x.category); m.set(k, [...(m.get(k) ?? []), x]); }
    return [...m.values()];
  }, [rows]);
  const newCats = new Set(included.map(x => catKey(x.category)).filter(k => !cats.some(c => Object.values(c.name).some(v => norm(v) === k)))).size;

  // ---------------------------------------------------------------- file route
  const readFile = async (f: File) => {
    setErr(''); setFileName(f.name); setSource('file');
    try {
      let data: Cell[][];
      if (/\.(xlsx|xlsm)$/i.test(f.name)) {
        const { readSheet } = await import('read-excel-file/browser');
        data = (await readSheet(f)) as Cell[][];
      } else if (/\.xls$/i.test(f.name)) {
        setErr(t("Ancien format Excel (.xls) : ouvrez-le dans Excel et choisissez « Enregistrer sous » > .xlsx ou CSV.")); return;
      } else data = parseCsv(decodeText(await f.arrayBuffer()));
      data = data.filter(row => row.some(c => String(c ?? '').trim() !== ''));
      if (data.length < 1) { setErr(t('Ce fichier est vide.')); return; }
      const m = detect(data);
      setSheet(data); setMapping(m);
      if (!m.roles.some(x => x === 'name' || x === 'name_ar') || !m.roles.includes('price')) { setStep('map'); return; }
      setRows(buildRows(data, m, latin, t('Menu'))); setStep('preview');
    } catch (e) { setErr(t('Lecture du fichier impossible : {m}', { m: errorMessage(e) })); }
  };
  const applyMapping = () => {
    if (!mapping) return;
    setRows(buildRows(sheet, mapping, latin, t('Menu'))); setStep('preview');
  };

  // ---------------------------------------------------------------- photo route
  const readPhotos = async (list: FileList) => {
    const files = [...list].slice(0, 6);
    if (!files.length) return;
    setErr(''); setSource('photo'); setFileName(files.map(f => f.name).join(', ').slice(0, 200)); setStep('reading');
    try {
      const prepared = await Promise.all(files.map(f => fileForAi(f)));
      if (prepared.reduce((s, p) => s + p.bytes, 0) > 11 * 1024 * 1024) throw new Error(t('Fichiers trop lourds (max. 11 Mo en tout). Envoyez moins de pages ou des photos plus légères.'));
      const { data, error } = await supabase.functions.invoke('menu-extract', { body: { restaurant_id: r.id, files: prepared.map(({ mime, data }) => ({ mime, data })) } });
      if (error || !data || data.error) {
        const ctx = (error as { context?: Response } | null)?.context;
        const body = data?.error ? data : ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
        const code = body?.error ?? '';
        if (code === 'ai_not_configured' || ctx?.status === 404) throw new Error(t("La lecture par l'IA n'est pas encore activée. Utilisez un fichier Excel ou CSV."));
        if (code === 'ai_busy') throw new Error(t("L'IA est très demandée en ce moment. Réessayez dans une minute."));
        if (code === 'too_large' || code === 'too_many_files') throw new Error(t('Fichiers trop lourds (max. 11 Mo en tout). Envoyez moins de pages ou des photos plus légères.'));
        throw new Error(t("L'IA n'a pas pu lire cette carte. Essayez une photo plus nette, bien éclairée et prise de face."));
      }
      const got = fromAi(data.categories ?? [], langs);
      if (!got.length) throw new Error(t("Aucun article trouvé sur ces images. Essayez une photo plus nette, bien éclairée et prise de face."));
      setRows(got); setStep('preview');
    } catch (e) { setErr(errorMessage(e).replace(/^Erreur : /, '')); setStep('choose'); }
  };

  // ---------------------------------------------------------------- save / undo
  const save = async () => {
    setStep('saving'); setErr('');
    try {
      const res = await rpc<{ import_id: string; items: number; categories: number; skipped: number }>('import_menu', {
        p_restaurant_id: r.id, p_source: source, p_file_name: fileName || null, p_rows: payload(rows),
      });
      setResult(res); setStep('done'); onDone(); loadHistory();
    } catch (e) {
      const msg = (e as Error).message ?? '';
      const m = msg.match(/^row (\d+): (.*)$/);
      setErr(m ? t('Ligne {n} : {m}', { n: m[1], m: m[2] }) : errorMessage(e));
      setStep('preview');
    }
  };
  const undo = async (id: string) => {
    try {
      const u = await rpc<{ removed: number; hidden: number }>('undo_menu_import', { p_import_id: id });
      a.toast(u.hidden ? t('{n} articles retirés. {h} déjà vendus sont masqués.', { n: u.removed, h: u.hidden }) : t('{n} articles retirés.', { n: u.removed }));
      onDone(); loadHistory();
      if (result?.import_id === id) onClose();
    } catch (e) { a.fail(e); }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([templateCsv(showAr)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'modele-menu.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const patch = (id: string, p: Partial<DraftRow>) => setRows(rs => rs.map(x => (x.id === id ? { ...x, ...p } : x)));
  const renameCat = (group: DraftRow[], lang: string, v: string) => {
    const ids = new Set(group.map(x => x.id));
    setRows(rs => rs.map(x => (ids.has(x.id) ? { ...x, category: { ...x.category, [lang]: v } } : x)));
  };

  const setTarget = (group: DraftRow[], id: string) => {
    const ids = new Set(group.map(x => x.id));
    const c = cats.find(x => x.id === id);
    setRows(rs => rs.map(x => (!ids.has(x.id) ? x : c
      ? { ...x, orig: x.orig ?? x.category, category: c.name, target: c.id, icon: c.icon ?? '' }
      : { ...x, category: x.orig ?? x.category, target: undefined, orig: undefined })));
  };
  const fillPrice = (group: DraftRow[], v: string) => {
    const cents = toCents(v);
    if (!v.trim() || !cents) return;
    const ids = new Set(group.map(x => x.id));
    setRows(rs => rs.map(x => (ids.has(x.id) && !x.variants.length && x.price == null ? { ...x, price: cents } : x)));
  };

  // ---------------------------------------------------------------- screens
  const footer = step === 'preview' ? (
    <div className="flex flex-wrap items-center gap-3">
      <p className="me-auto text-sm text-muted">
        {blocking.length
          ? <span className="font-semibold text-danger">{t('{n} ligne(s) à corriger ou à décocher', { n: blocking.length })}</span>
          : t('Tout est prêt.')}
      </p>
      <Btn tone="ghost" onClick={() => { setRows([]); setStep('choose'); }}>{t('Recommencer')}</Btn>
      <Btn tone="brand" disabled={!included.length || blocking.length > 0} onClick={save}>
        <Check className="h-4 w-4" /> {t('Importer {n} articles', { n: included.length - willSkip })}
      </Btn>
    </div>
  ) : step === 'map' ? (
    <div className="flex justify-end gap-3">
      <Btn tone="ghost" onClick={() => setStep('choose')}>{t('Retour')}</Btn>
      <Btn tone="brand" disabled={!mapping?.roles.some(x => x === 'name' || x === 'name_ar') || !mapping?.roles.includes('price')} onClick={applyMapping}>{t('Continuer')}</Btn>
    </div>
  ) : undefined;

  return (
    <Modal title={t('Importer mon menu')} onClose={step === 'reading' || step === 'saving' ? () => {} : onClose} footer={footer} wide>
      {err && <p role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{err}</p>}

      {step === 'choose' && (
        <div className="space-y-5">
          <p className="text-muted">{t("Vous changez de caisse ? Ne retapez pas votre carte. Choisissez la méthode la plus simple pour vous. Vous vérifiez tout avant l'import.")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={() => photoRef.current?.click()} className="group relative overflow-hidden rounded-3xl border border-brand/40 bg-gradient-to-br from-brand/15 to-surface p-5 text-start transition hover:border-brand">
              <span className="absolute end-4 top-4 inline-flex items-center gap-1 rounded-full bg-brand/20 px-2 py-0.5 text-xs font-bold text-brand"><Sparkles className="h-3 w-3" /> {t('IA')}</span>
              <Camera className="mb-3 h-8 w-8 text-brand" />
              <p className="font-display text-lg font-semibold">{t('Photo ou PDF de la carte')}</p>
              <p className="mt-1 text-sm text-muted">{t("Prenez votre carte en photo (jusqu'à 6 pages). L'IA lit les articles, les prix et traduit en arabe.")}</p>
            </button>
            <button onClick={() => fileRef.current?.click()} className="rounded-3xl border border-line/[0.12] bg-surface p-5 text-start transition hover:border-brand">
              <FileSpreadsheet className="mb-3 h-8 w-8 text-brand" />
              <p className="font-display text-lg font-semibold">{t('Fichier Excel ou CSV')}</p>
              <p className="mt-1 text-sm text-muted">{t("L'export des articles de votre ancienne caisse. Les colonnes sont reconnues automatiquement.")}</p>
            </button>
          </div>
          <input ref={photoRef} type="file" accept="image/*,application/pdf,.pdf,.heic" multiple className="hidden" onChange={e => { if (e.target.files) readPhotos(e.target.files); e.target.value = ''; }} />
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.csv,.txt,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
          <button onClick={downloadTemplate} className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline">
            <Download className="h-4 w-4" /> {t("Pas d'export ? Télécharger un modèle Excel à remplir")}
          </button>

          {history.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-bold">{t('Imports précédents')}</h3>
              <ul className="divide-y divide-line/10 rounded-2xl border border-line/[0.08]">
                {history.map(h => (
                  <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    {h.source === 'photo' ? <Camera className="h-4 w-4 text-muted" /> : <FileSpreadsheet className="h-4 w-4 text-muted" />}
                    <span className="min-w-0 flex-1 truncate">
                      <bdi>{h.file_name || (h.source === 'photo' ? t('Photo') : t('Fichier'))}</bdi>
                      <span className="ms-2 text-muted">{new Date(h.created_at).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' })} · {t('{n} articles', { n: h.item_ids.length })}</span>
                    </span>
                    {h.undone_at
                      ? <span className="text-xs text-muted">{t('Annulé')}</span>
                      : h.item_ids.length > 0 && <Btn tone="ghost" className="px-2.5 py-1 text-xs" onClick={() => undo(h.id)}><RotateCcw className="h-3.5 w-3.5" /> {t('Annuler')}</Btn>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {step === 'reading' && (
        <div className="grid place-items-center gap-4 py-16 text-center">
          <span className="relative grid h-16 w-16 place-items-center rounded-full gold-fill text-brand-ink"><Sparkles className="h-7 w-7" /><Loader2 className="absolute -inset-2 h-20 w-20 animate-spin text-brand/40" /></span>
          <p className="font-display text-xl font-semibold">{t("L'IA lit votre carte…")}</p>
          <p className="max-w-sm text-sm text-muted">{t('Cela prend 20 à 60 secondes selon le nombre de pages. Ne fermez pas cette fenêtre.')}</p>
        </div>
      )}

      {step === 'map' && mapping && (
        <div>
          <p className="mb-4 text-muted">{t('Indiquez ce que contient chaque colonne. Il faut au moins un nom et un prix.')}</p>
          <div className="space-y-2">
            {mapping.roles.map((role, i) => {
              const head = mapping.headerRow >= 0 ? String(sheet[mapping.headerRow][i] ?? '') : '';
              const sample = sheet.slice(mapping.headerRow + 1).map(x => x[i]).filter(c => String(c ?? '').trim()).slice(0, 3).map(String);
              return (
                <div key={i} className="grid items-center gap-2 rounded-2xl bg-surface-2 p-3 sm:grid-cols-[1fr_200px]">
                  <div className="min-w-0">
                    <p className="font-semibold"><bdi>{head || t('Colonne {n}', { n: i + 1 })}</bdi></p>
                    <p className="truncate text-sm text-muted"><bdi>{sample.join(' · ') || '—'}</bdi></p>
                  </div>
                  <select aria-label={head || t('Colonne {n}', { n: i + 1 })} className={inputCls} value={role}
                    onChange={e => setMapping({ ...mapping, roles: mapping.roles.map((x, k) => (k === i ? e.target.value as Role : x)), priceNames: mapping.priceNames.map((x, k) => (k === i ? head : x)) })}>
                    {ROLES.map(x => <option key={x} value={x}>{t(ROLE_LABEL[x])}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-brand/15 px-3 py-1 font-bold text-brand">{t('{n} articles', { n: included.length })}</span>
            <span className="rounded-full bg-surface-2 px-3 py-1">{t('{n} catégories', { n: groups.length })}{newCats ? ` · ${t('{n} nouvelles', { n: newCats })}` : ''}</span>
            {willSkip > 0 && <span className="rounded-full bg-surface-2 px-3 py-1">{t('{n} déjà au menu', { n: willSkip })}</span>}
            {blocking.length > 0 && <span className="rounded-full bg-danger/10 px-3 py-1 font-semibold text-danger">{t('{n} à vérifier', { n: blocking.length })}</span>}
            <label className="ms-auto inline-flex items-center gap-2"><input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} /> {t('Seulement les lignes à vérifier')}</label>
          </div>
          {source === 'photo' && <p className="mb-3 flex items-start gap-2 rounded-2xl bg-surface-2 p-3 text-sm"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" />{t("Lu par l'IA : vérifiez surtout les prix et les traductions. Vous pouvez tout modifier ici ou plus tard dans le menu.")}</p>}
          {source === 'file' && mapping && <button onClick={() => setStep('map')} className="mb-3 text-sm font-semibold text-brand hover:underline">{t('Colonnes mal reconnues ? Les corriger')}</button>}

          <div className="space-y-4">
            {groups.map(g => {
              const shownRows = onlyIssues ? g.filter(x => issues.get(x.id)!.length) : g;
              if (!shownRows.length) return null;
              const c0 = g[0].category;
              const target = g[0].target ?? '';
              const exact = !target && cats.find(c => Object.values(c.name).some(v => Object.values(c0).some(w => norm(v) === norm(w))));
              const sugg = !target && !exact ? suggestCategory(g[0].orig ?? c0, cats) : null;
              const missing = g.filter(x => x.include && !x.variants.length && x.price == null).length;
              return (
                <section key={g[0].id} className="overflow-hidden rounded-2xl border border-line/[0.08]">
                  <div className="flex flex-wrap items-center gap-2 bg-surface-2 px-3 py-2">
                    <span className="text-lg">{g[0].icon}</span>
                    {target || exact
                      ? <span className="font-bold"><bdi>{tn(exact ? exact.name : c0)}</bdi></span>
                      : <>
                          <input aria-label={t('Catégorie')} className={`${inputCls} max-w-[220px] py-1.5 font-bold`} value={c0[latin] ?? ''} placeholder={Object.values(c0)[0]} onChange={e => renameCat(g, latin, e.target.value)} />
                          {showAr && <input aria-label={t('Catégorie en arabe')} dir="rtl" className={`${inputCls} max-w-[200px] py-1.5`} value={c0.ar ?? ''} placeholder="بالعربية" onChange={e => renameCat(g, 'ar', e.target.value)} />}
                        </>}
                    <span className="ms-auto text-xs text-muted">{t('{n} articles', { n: g.length })}</span>
                  </div>
                  {(cats.length > 0 && !exact || missing > 0) && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-line/[0.06] bg-surface-2/60 px-3 py-2 text-sm">
                      {cats.length > 0 && !exact && (
                        <label className="flex items-center gap-2">
                          <span className="whitespace-nowrap text-muted">{t('Ajouter à')}</span>
                          <select aria-label={t('Ajouter à')} className={`${inputCls} w-auto py-1.5 ${sugg ? 'border-brand' : ''}`} value={target} onChange={e => setTarget(g, e.target.value)}>
                            <option value="">{t('Nouvelle catégorie')}</option>
                            {sugg && <option value={sugg.id}>{tn(sugg.name)} ★ {t('suggéré')}</option>}
                            {cats.filter(c => c.id !== sugg?.id).map(c => <option key={c.id} value={c.id}>{tn(c.name)}</option>)}
                          </select>
                        </label>
                      )}
                      {sugg && !target && (
                        <button type="button" onClick={() => setTarget(g, sugg.id)} className="rounded-full bg-brand/15 px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/25">
                          {t('Mettre dans « {c} » ?', { c: tn(sugg.name) })}
                        </button>
                      )}
                      {missing > 0 && (
                        <form className="ms-auto flex items-center gap-2" onSubmit={e => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('p') as HTMLInputElement; fillPrice(g, f.value); f.value = ''; }}>
                          <span className="text-muted">{t('{n} sans prix :', { n: missing })}</span>
                          <input name="p" aria-label={t('Même prix pour tous')} inputMode="decimal" placeholder={t('Même prix pour tous')} className={`${inputCls} w-40 py-1.5`} />
                          <Btn type="submit" tone="ghost" className="px-3 py-1.5">{t('Appliquer')}</Btn>
                        </form>
                      )}
                    </div>
                  )}
                  <ul className="divide-y divide-line/10">
                    {shownRows.map(x => {
                      const is = issues.get(x.id)!;
                      const bad = x.include && is.some(i => BLOCKING.includes(i));
                      return (
                        <li key={x.id} className={`grid items-center gap-2 px-3 py-2 sm:grid-cols-[auto_1fr_1fr_170px_auto] ${x.include ? '' : 'opacity-45'} ${bad ? 'bg-danger/5' : ''}`}>
                          <input type="checkbox" aria-label={t('Importer cette ligne')} checked={x.include} onChange={e => patch(x.id, { include: e.target.checked })} />
                          <input aria-label={t('Nom')} className={`${inputCls} py-1.5`} value={x.name[latin] ?? ''} placeholder={Object.values(x.name)[0] ?? t('Nom')} onChange={e => patch(x.id, { name: { ...x.name, [latin]: e.target.value } })} />
                          {showAr ? <input aria-label={t('Nom en arabe')} dir="rtl" className={`${inputCls} py-1.5`} value={x.name.ar ?? ''} placeholder="بالعربية" onChange={e => patch(x.id, { name: { ...x.name, ar: e.target.value } })} /> : <span />}
                          {x.variants.length
                            ? <div className="text-xs tabular">{x.variants.map((v, k) => (
                                <label key={k} className="flex items-center gap-1"><bdi className="w-20 truncate text-muted" title={Object.values(v.name)[0]}>{Object.values(v.name)[0]}</bdi>
                                  <input aria-label={t('Prix')} inputMode="decimal" className={`${inputCls} w-16 px-2 py-1 text-xs`} value={fromCents(v.price)}
                                    onChange={e => patch(x.id, { variants: x.variants.map((w, j) => (j === k ? { ...w, price: e.target.value.trim() ? toCents(e.target.value) : null } : w)) })} /></label>))}
                              </div>
                            : <input aria-label={t('Prix (DH)')} inputMode="decimal" className={`${inputCls} py-1.5 tabular`} value={fromCents(x.price)} placeholder="DH"
                                onChange={e => patch(x.id, { price: e.target.value.trim() ? toCents(e.target.value) : null })} />}
                          <div className="flex min-w-[70px] flex-wrap justify-end gap-1">
                            {is.map(i => <span key={i} className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${BLOCKING.includes(i) ? 'bg-danger/15 text-danger' : 'bg-surface-3 text-muted'}`}>{t(ISSUE_LABEL[i])}</span>)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {step === 'saving' && (
        <div className="grid place-items-center gap-3 py-16"><Loader2 className="h-10 w-10 animate-spin text-brand" /><p>{t('Import en cours…')}</p></div>
      )}

      {step === 'done' && result && (
        <div className="grid place-items-center gap-4 py-10 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full gold-fill text-brand-ink"><Check className="h-8 w-8" /></span>
          <p className="font-display text-2xl font-semibold">{t('{n} articles importés', { n: result.items })}</p>
          <p className="text-muted">
            {t('{n} nouvelles catégories.', { n: result.categories })}
            {result.skipped > 0 && <> {t('{n} déjà présents, ignorés.', { n: result.skipped })}</>}
          </p>
          <p className="max-w-md text-sm text-muted">{t('Ajoutez maintenant les photos des plats depuis le menu. Tout est déjà visible sur la caisse et le menu QR.')}</p>
          <div className="flex gap-3">
            <Btn tone="ghost" onClick={() => undo(result.import_id)}><Trash2 className="h-4 w-4" /> {t('Annuler cet import')}</Btn>
            <Btn tone="brand" onClick={onClose}>{t('Voir le menu')}</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
