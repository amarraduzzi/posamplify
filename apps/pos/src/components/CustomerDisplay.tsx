// The screen turned to the guest (?ecran=<code>): no login, it only shows what the till sends.
// Labels are in French and Arabic side by side, as on a Moroccan receipt.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { listen, type DisplayMsg } from '../lib/display';
import { mad } from '../lib/format';

const L = ({ fr, ar }: { fr: string; ar: string }) => <>{fr} <span dir="rtl" lang="ar" className="opacity-70">· {ar}</span></>;

export function CustomerDisplay({ code }: { code: string }) {
  const [m, setM] = useState<DisplayMsg | null>(null);
  const [qr, setQr] = useState('');
  useEffect(() => listen(code, setM), [code]);
  const link = m ? `${m.menuUrl}/${m.r.slug}` : '';
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 400 }).then(setQr).catch(() => {}); }, [link]);
  useEffect(() => { document.documentElement.requestFullscreen?.().catch(() => {}); }, []);
  const s = m?.s ?? { mode: 'idle' as const };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>
      <header className="flex items-center gap-4 border-b border-line/[0.07] px-8 py-5">
        {m?.r.logo && <img src={m.r.logo} alt="" className="h-12 w-12 rounded-xl object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
        <p className="font-display text-2xl font-semibold">{m?.r.name ?? ''}</p>
        {!m && <p className="ms-auto text-sm text-muted">En attente de la caisse…</p>}
      </header>

      {s.mode === 'idle' && (
        <main className="grid flex-1 place-items-center p-10 text-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.35em] text-brand"><L fr="Bienvenue" ar="مرحبا" /></p>
            <p className="mt-3 font-display text-6xl font-semibold">{m?.r.name ?? ''}</p>
            {qr && (
              <div className="mx-auto mt-10 flex w-fit items-center gap-6 rounded-3xl bg-surface p-5 text-start">
                <img src={qr} alt="" className="h-36 w-36 rounded-xl bg-white p-1.5" />
                <div className="max-w-xs"><p className="text-xl font-semibold"><L fr="Notre menu en ligne" ar="قائمتنا" /></p>
                  <p className="mt-1 text-muted">Commandez à emporter ou en livraison, sans commission.</p></div>
              </div>
            )}
          </div>
        </main>
      )}

      {s.mode === 'order' && (
        <main className="grid flex-1 grid-cols-[1fr_minmax(20rem,36%)] overflow-hidden">
          <ul className="divide-y divide-line/[0.07] overflow-y-auto px-8 py-4 text-2xl">
            {s.lines.map((l, i) => (
              <li key={i} className={`flex items-baseline gap-4 py-3`}>
                <span className="w-12 font-bold tabular">{l.q}×</span>
                <span className="flex-1">{l.name}</span>
                {l.list && l.list > l.total && <span className="text-lg text-muted line-through tabular">{mad(l.list)}</span>}
                <span className="font-semibold tabular">{mad(l.total)}</span>
              </li>
            ))}
          </ul>
          <aside className="flex flex-col justify-end gap-3 border-s border-line/[0.07] bg-surface/40 p-8">
            <p className="text-muted">{s.label}</p>
            {s.discount > 0 && <>
              <p className="flex justify-between text-xl text-muted"><span><L fr="Sous-total" ar="المجموع الفرعي" /></span><span className="tabular">{mad(s.subtotal)}</span></p>
              <p className="flex justify-between text-xl text-ok"><span>{s.promo ? 'Code promo' : 'Remise'}</span><span className="tabular">-{mad(s.discount)}</span></p>
            </>}
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-muted"><L fr="Total" ar="المجموع" /></p>
            <p className="whitespace-nowrap font-display text-6xl font-semibold text-brand tabular">{mad(s.total)}</p>
          </aside>
        </main>
      )}

      {s.mode === 'pay' && (
        <main className="grid flex-1 grid-cols-3 place-items-center p-10 text-center">
          <div><p className="text-lg text-muted"><L fr="À payer" ar="للأداء" /></p><p className="font-display text-6xl font-semibold tabular">{mad(s.total)}</p></div>
          <div><p className="text-lg text-muted"><L fr="Reçu" ar="المبلغ المسلم" /></p><p className="font-display text-6xl font-semibold tabular">{mad(s.given)}</p></div>
          <div><p className="text-lg text-muted"><L fr="À rendre" ar="الباقي" /></p><p className="whitespace-nowrap font-display text-6xl font-semibold text-brand tabular">{mad(s.change)}</p></div>
        </main>
      )}

      {s.mode === 'thanks' && (
        <main className="grid flex-1 place-items-center p-10 text-center">
          <div>
            <p className="font-display text-7xl font-semibold text-brand"><L fr="Merci !" ar="شكرا" /></p>
            {s.change > 0 && <p className="mt-6 text-3xl"><L fr="Votre monnaie" ar="الباقي" /> : <b className="tabular">{mad(s.change)}</b></p>}
          </div>
        </main>
      )}
    </div>
  );
}
