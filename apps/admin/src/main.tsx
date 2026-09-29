import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const root = createRoot(document.getElementById('root')!);
if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  root.render(<div style={{ padding: 32, fontFamily: 'sans-serif' }}><h1>Configuration incomplète</h1><p>Ajoutez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans Cloudflare puis relancez le déploiement.</p></div>);
} else {
  const Root = lazy(async () => {
    const [{ default: App }, { AdminProvider }] = await Promise.all([import('./App'), import('./store')]);
    return { default: () => <AdminProvider><App /></AdminProvider> };
  });
  root.render(<StrictMode><Suspense fallback={null}><Root /></Suspense></StrictMode>);
}
