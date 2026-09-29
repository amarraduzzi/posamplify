import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { resolveTenant } from './lib/tenant';

// No restaurant in the address (the bare domain): show the Amplify POS website.
// It is a separate chunk, so guests at a table never download it.
const Landing = lazy(() => import('./landing/Landing'));
const isSite = !resolveTenant().slug;
// shown inside the website's phone mockup: hide the scrollbars (Windows draws them)
try { if (window.self !== window.top) document.documentElement.classList.add('embedded'); } catch { /* cross-origin parent */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSite ? <Suspense fallback={<div style={{ minHeight: '100dvh', background: '#070B14' }} />}><Landing /></Suspense> : <App />}
  </StrictMode>,
);
