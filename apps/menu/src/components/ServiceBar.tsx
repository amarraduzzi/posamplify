// Le service discret: at the table (table QR), three discreet buttons. The waiters' screens light up;
// the guest sees the call was received, then that it was answered.
import { useEffect, useState } from 'react';
import { BellRing, Check, GlassWater, Receipt } from 'lucide-react';
import { callService, tableService, type ServiceKind, type TableService } from '../lib/api';

const S = {
  fr: { title: 'Besoin de quelque chose ?', waiter: 'Un serveur', water: 'De l’eau', bill: 'L’addition', sent: 'Demandé', coming: 'C’est noté, on arrive.', answered: 'Un serveur s’en occupe.', error: 'Pas de connexion. Réessayez ou faites signe.' },
  en: { title: 'Need anything?', waiter: 'A waiter', water: 'Water', bill: 'The bill', sent: 'Asked', coming: 'Noted, we are coming.', answered: 'A waiter is on it.', error: 'No connection. Try again or wave to us.' },
  ar: { title: 'تحتاجون شيئا؟', waiter: 'نادل', water: 'ماء', bill: 'الفاتورة', sent: 'تم الطلب', coming: 'تم التسجيل، نحن قادمون.', answered: 'نادل يتكفل بطلبكم.', error: 'لا يوجد اتصال. أعيدوا المحاولة أو أشيروا إلينا.' },
};
const ICONS: Record<ServiceKind, typeof BellRing> = { waiter: BellRing, water: GlassWater, bill: Receipt };

export function ServiceBar({ slug, token, lang }: { slug: string; token: string; lang: string }) {
  const t = (S as Record<string, typeof S.fr>)[lang] ?? S.fr;
  const [st, setSt] = useState<TableService | null>(null);
  const [busy, setBusy] = useState<ServiceKind | null>(null);
  const [error, setError] = useState(false);
  const refresh = () => tableService(slug, token).then(setSt).catch(() => {});
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 10000);
    return () => window.clearInterval(id);
  }, [slug, token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st?.enabled) return null;
  const open = new Set((st.open ?? []).map(x => x.kind));
  const done = (st.done ?? []).length > 0 && !open.size;
  const call = async (k: ServiceKind) => {
    setBusy(k); setError(false);
    try { await callService(slug, token, k); await refresh(); } catch { setError(true); }
    setBusy(null);
  };
  return (
    <div className="mx-auto mt-5 w-full max-w-sm rounded-3xl border border-line bg-surface/80 p-3 backdrop-blur-md">
      <p className="mb-2 text-center text-sm font-semibold text-muted">{t.title}</p>
      <div className="grid grid-cols-3 gap-2">
        {(['waiter', 'water', 'bill'] as ServiceKind[]).map(k => {
          const I = ICONS[k], on = open.has(k);
          return (
            <button key={k} disabled={busy !== null || on} onClick={() => call(k)}
              className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-sm font-semibold transition press ${on ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink'}`}>
              {on ? <Check className="size-5" /> : <I className={`size-5 ${busy === k ? 'animate-pulse' : ''}`} />}
              <span>{on ? t.sent : t[k]}</span>
            </button>
          );
        })}
      </div>
      {open.size > 0 && <p className="mt-2 text-center text-sm">{t.coming}</p>}
      {done && <p className="mt-2 text-center text-sm text-muted">{t.answered}</p>}
      {error && <p className="mt-2 text-center text-sm text-red-400">{t.error}</p>}
    </div>
  );
}
