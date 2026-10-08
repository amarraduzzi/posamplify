import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { resolveTenant } from './lib/tenant';

// No restaurant in the address (the bare domain): show the Amplify POS website.
// It is a separate chunk, so guests at a table never download it.
const Landing = lazy(() => import('./landing/Landing'));
const ProfitLanding = lazy(() => import('./landing/ProfitLanding'));
const FeaturesLanding = lazy(() => import('./landing/FeaturesLanding'));
// the website: the bare domain (Amplify POS) and /profit (Amplify Profit); "profit" is a reserved slug
// the courier's page (?livreur=<token>), from the till's WhatsApp message
const courier = new URLSearchParams(location.search).get('livreur');
const CourierApp = lazy(() => import('./courier/CourierApp'));
const slug = courier ? 'livreur' : resolveTenant().slug;
const site = !slug ? 'pos' : slug === 'profit' ? 'profit' : slug === 'fonctionnalites' ? 'features' : null;
// When the product pages live on the company site (VITE_MARKETING_URL, e.g. https://amplifygrowthstudio.com),
// the old landing pages send visitors there. Restaurant menus (/<slug>) are never redirected.
// default: the company site; VITE_MARKETING_URL='' keeps the old landing pages here
const MARKETING = ((import.meta.env.VITE_MARKETING_URL as string | undefined) ?? 'https://www.amplifygrowthstudio.com').replace(/\/$/, '');
const TARGET = { pos: '/amplify-pos/', profit: '/amplify-profit/', features: '/amplify-pos/fonctionnalites/' } as const;
const redirecting = !!(site && MARKETING);
if (site && MARKETING) location.replace(`${MARKETING}${TARGET[site]}${location.hash}`);
// shown inside the website's phone mockup: hide the scrollbars (Windows draws them)
try { if (window.self !== window.top) document.documentElement.classList.add('embedded'); } catch { /* cross-origin parent */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {courier ? <Suspense fallback={null}><CourierApp token={courier} /></Suspense> : redirecting ? null : site ? <Suspense fallback={<div style={{ minHeight: '100dvh', background: '#020F20' }} />}>{site === 'profit' ? <ProfitLanding /> : site === 'features' ? <FeaturesLanding /> : <Landing />}</Suspense> : <App />}
  </StrictMode>,
);
