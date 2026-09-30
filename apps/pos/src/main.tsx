import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { unlockAudio } from './lib/sound';

const root = createRoot(document.getElementById('root')!);
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // clear message instead of a black screen when the hosting is misconfigured
  root.render(
    <div style={{ padding: 32, fontFamily: 'sans-serif', color: '#ECF2FA' }}>
      <h1>Configuration incomplète</h1>
      <p>Variable manquante : {!url && 'VITE_SUPABASE_URL '}{!key && 'VITE_SUPABASE_ANON_KEY'}</p>
      <p>Ajoutez-la dans Cloudflare (Settings &gt; Variables and secrets), puis relancez le déploiement.</p>
    </div>,
  );
} else {
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  // keep the till app on this PC so it opens without internet (not in dev: it would cache stale code)
  if (import.meta.env.PROD) import('./lib/sw').then(m => m.startServiceWorker()).catch(() => {});
  const Root = lazy(async () => {
    const [{ default: App }, { PosProvider }] = await Promise.all([import('./App'), import('./store')]);
    return { default: () => <PosProvider><App /></PosProvider> };
  });
  root.render(<StrictMode><Suspense fallback={null}><Root /></Suspense></StrictMode>);
}
