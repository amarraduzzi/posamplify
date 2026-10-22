// The salon's clients: everyone who had an appointment, searchable by name or number, with the last
// and next visit, no-shows and colour formulas. A tap opens the client card.
import { useEffect, useState } from 'react';
import { CalendarClock, FlaskConical, Search, UserX } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { inputCls } from '../components/ui';
import { ClientCardModal } from '../components/AgendaClient';

interface Row { id: string; name: string | null; phone: string; tags: string[]; visits: number; last: string | null; next: string | null; no_shows: number; formulas: number }

export function AgendaClientsPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const tz = r.timezone || 'UTC';
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const id = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc('agenda_clients', { p_restaurant_id: r.id, p_q: q || null });
      if (error) a.fail(error);
      setRows((data ?? []) as Row[]);
    }, q ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [r.id, q, a, open]);
  const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: tz, day: 'numeric', month: 'short' });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-semibold">{t('Clients')}</h1>
      <label className="relative block max-w-md">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input className={`${inputCls} ps-10`} value={q} onChange={e => setQ(e.target.value)} placeholder={t('Nom ou numéro')} />
      </label>
      {rows === null ? <p className="text-muted">{t('Chargement…')}</p> : !rows.length ? (
        <p className="card rounded-3xl p-8 text-center text-muted">{q ? t('Aucun client trouvé.') : t('Vos clients apparaissent ici dès leur premier rendez-vous avec un numéro.')}</p>
      ) : (
        <ul className="card divide-y divide-line/10 overflow-hidden rounded-3xl">
          {rows.map(x => (
            <li key={x.id}>
              <button onClick={() => setOpen(x.phone)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-start hover:bg-surface-2">
                <div className="min-w-[180px] flex-1">
                  <p className="font-semibold">{x.name || x.phone} {x.tags.map(tag => <span key={tag} className="ms-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand">{t(tag)}</span>)}</p>
                  <p className="text-sm text-muted">{x.phone} · {t('{n} visite(s)', { n: x.visits })}{x.last ? ` · ${t('dernière le {d}', { d: date(x.last) })}` : ''}</p>
                </div>
                {x.next && <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand"><CalendarClock className="h-4 w-4" />{date(x.next)}</span>}
                {x.formulas > 0 && <span className="inline-flex items-center gap-1 text-sm text-muted"><FlaskConical className="h-4 w-4" />{x.formulas}</span>}
                {x.no_shows > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-600"><UserX className="h-3.5 w-3.5" />{x.no_shows}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <ClientCardModal r={r} phone={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
