// The pickup board (?retrait=<code>): no login, it only shows what the till sends.
// Labels in French and Arabic side by side. Plays a chime when an order becomes ready.
import { useEffect, useRef, useState } from 'react';
import { listenPickup, type PickupMsg } from '../lib/pickup';
import { chime, unlockAudio } from '../lib/sound';

const L = ({ fr, ar }: { fr: string; ar: string }) => <>{fr} <span dir="rtl" lang="ar" className="opacity-70">· {ar}</span></>;

export function PickupBoard({ code }: { code: string }) {
  const [m, setM] = useState<PickupMsg | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [soundOk, setSoundOk] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const soundRef = useRef(false);
  useEffect(() => listenPickup(code, setM), [code]);
  useEffect(() => { document.documentElement.requestFullscreen?.().catch(() => {}); }, []);
  useEffect(() => {
    if (!m) return;
    const ids = new Set(m.ready.map(x => x.id));
    // the first message only sets the baseline: no chime for what was already waiting
    if (seen.current) {
      const added = m.ready.filter(x => !seen.current!.has(x.id)).map(x => x.id);
      if (added.length) {
        if (soundRef.current) chime();
        setFresh(f => new Set([...f, ...added]));
        window.setTimeout(() => setFresh(f => { const n = new Set(f); added.forEach(i => n.delete(i)); return n; }), 10000);
      }
    }
    seen.current = ids;
  }, [m]);
  const tap = () => { unlockAudio(); soundRef.current = true; setSoundOk(true); document.documentElement.requestFullscreen?.().catch(() => {}); };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg" onClick={tap}>
      <header className="flex items-center gap-4 border-b border-line/[0.07] px-8 py-5">
        {m?.r.logo && <img src={m.r.logo} alt="" className="h-12 w-12 rounded-xl object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
        <p className="font-display text-3xl font-semibold">{m?.r.name ?? ''}</p>
        {!m && <p className="ms-auto text-sm text-muted">En attente de la caisse…</p>}
        {m && !soundOk && <p className="ms-auto text-sm text-muted">Touchez l’écran une fois pour activer le son · المس الشاشة لتفعيل الصوت</p>}
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-2">
        <section className="flex min-h-0 flex-col border-e border-line/[0.07] p-8">
          <h2 className="mb-6 text-2xl font-bold uppercase tracking-[0.2em] text-warn"><L fr="En préparation" ar="قيد التحضير" /></h2>
          <ul className="scroll-thin flex-1 space-y-3 overflow-y-auto">
            {m?.preparing.map(o => (
              <li key={o.id} className="flex items-baseline gap-4 rounded-2xl bg-surface px-6 py-4">
                <span className="font-display text-4xl font-semibold tabular text-muted">{o.ref}</span>
                <span className="truncate text-4xl font-semibold">{o.name}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="flex min-h-0 flex-col bg-ok/[0.04] p-8">
          <h2 className="mb-6 text-2xl font-bold uppercase tracking-[0.2em] text-ok"><L fr="Prêtes" ar="جاهزة" /></h2>
          <ul className="scroll-thin flex-1 space-y-3 overflow-y-auto">
            {m?.ready.map(o => (
              <li key={o.id} className={`flex items-baseline gap-5 rounded-3xl bg-ok px-8 py-6 text-[#032A2A] ${fresh.has(o.id) ? 'animate-pulse ring-8 ring-white/70' : ''}`}>
                <span className="font-display text-6xl font-bold tabular">{o.ref}</span>
                <span className="truncate font-display text-6xl font-semibold">{o.name}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
