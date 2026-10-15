import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { applyLang, readLang } from './lib/i18n';
import './lib/install'; // catch the browser's install offer before the app loads

// Amplify Screen: the orders screen (?scherm=commandes) installs as its own app, with its own icon
if (new URLSearchParams(location.search).get('scherm') === 'commandes') {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/screen.webmanifest');
  document.title = 'Amplify Screen';
}

// language before the first render, so an Arabic back office never flashes in French
applyLang(readLang());

const root = createRoot(document.getElementById('root')!);
if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  root.render(<div style={{ padding: 32, fontFamily: 'sans-serif' }}><h1>Configuration incomplète</h1><p>Ajoutez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans Cloudflare puis relancez le déploiement.</p></div>);
} else {
  const Root = lazy(async () => {
    const [{ default: App }, { AdminProvider }] = await Promise.all([import('./App'), import('./store')]);
    return { default: () => <AdminProvider><App /></AdminProvider> };
  });
  root.render(<StrictMode><Suspense fallback={null}><Root /></Suspense></StrictMode>);
  // installable app (icon on the desktop); not in dev, it would cache stale code
  if (import.meta.env.PROD) import('./lib/sw').then(m => m.startServiceWorker()).catch(() => {});
}
