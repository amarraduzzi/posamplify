import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { resolveTenant } from './lib/tenant';

// No restaurant in the address (the bare domain): show the Amplify POS website.
// It is a separate chunk, so guests at a table never download it.
const Landing = lazy(() => import('./landing/Landing'));
const ProfitLanding = lazy(() => import('./landing/ProfitLanding'));
// the website: the bare domain (Amplify POS) and /profit (Amplify Profit); "profit" is a reserved slug
const slug = resolveTenant().slug;
const site = !slug ? 'pos' : slug === 'profit' ? 'profit' : null;
// shown inside the website's phone mockup: hide the scrollbars (Windows draws them)
try { if (window.self !== window.top) document.documentElement.classList.add('embedded'); } catch { /* cross-origin parent */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {site ? <Suspense fallback={<div style={{ minHeight: '100dvh', background: '#020F20' }} />}>{site === 'profit' ? <ProfitLanding /> : <Landing />}</Suspense> : <App />}
  </StrictMode>,
);
