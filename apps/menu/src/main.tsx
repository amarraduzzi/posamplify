import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { resolveTenant } from './lib/tenant';
import { load } from './lib/storage';

// No restaurant in the address (the bare domain): show the Amplify POS website.
// It is a separate chunk, so guests at a table never download it.
const Landing = lazy(() => import('./landing/Landing'));
const ProfitLanding = lazy(() => import('./landing/ProfitLanding'));
const FeaturesLanding = lazy(() => import('./landing/FeaturesLanding'));
// the website: the bare domain (Amplify POS) and /profit (Amplify Profit); "profit" is a reserved slug
// the courier's page (?livreur=<token>), from the till's WhatsApp message
const courier = new URLSearchParams(location.search).get('livreur');
const CourierApp = lazy(() => import('./courier/CourierApp'));
// the sign-up page (?club, or ?club=<key> for a tasting), from the QR in the manager space > Clients
const clubParam = new URLSearchParams(location.search).get('club');
const club = clubParam !== null ? (/^[a-z0-9]{6,32}$/i.test(clubParam) ? clubParam : '') : null;
const ClubSignup = lazy(() => import('./club/ClubSignup'));
// the customer's points card (?carte=<key>), from the link the restaurant sent or the sign-up page
const carteParam = new URLSearchParams(location.search).get('carte');
const carte = carteParam && /^[a-z0-9]{16,40}$/i.test(carteParam) ? carteParam : null;
const CardPage = lazy(() => import('./card/CardPage'));
// Amplify Agenda: the salon's booking page (?rdv) and the client's page (?rdv=<token>)
const rdvParam = new URLSearchParams(location.search).get('rdv');
const rdv = rdvParam !== null ? (/^[a-z0-9]{8,32}$/i.test(rdvParam) ? rdvParam : '') : null;
const AgendaApp = lazy(() => import('./agenda/AgendaApp'));
const slug = courier ? 'livreur' : resolveTenant().slug;
const site = !slug ? 'pos' : slug === 'profit' ? 'profit' : slug === 'fonctionnalites' ? 'features' : null;
// When the product pages live on the company site (VITE_MARKETING_URL, e.g. https://amplifygrowthstudio.com),
// the old landing pages send visitors there. Restaurant menus (/<slug>) are never redirected.
// default: the company site; VITE_MARKETING_URL='' keeps the old landing pages here
const MARKETING = ((import.meta.env.VITE_MARKETING_URL as string | undefined) ?? 'https://www.amplifygrowthstudio.com').replace(/\/$/, '');
const TARGET = { pos: '/amplify-pos/', profit: '/amplify-profit/', features: '/amplify-pos/fonctionnalites/' } as const;
const redirecting = !!(site && MARKETING);
// The points card installed on the home screen (Android) opens on the restaurant page: from there a phone that has its card goes
// straight to it. It only applies inside the installed app (display-mode: standalone), never in a normal browser tab,
// so the ordering site and the table QR keep working as before.
const toCard = (() => {
  try {
    if (courier || carte || club !== null || rdv !== null || site || !slug || /\/t\//.test(location.pathname)) return null;
    if (!window.matchMedia('(display-mode: standalone)').matches) return null;
    return load<string>(`card:${slug}`, 3 * 365 * 86400_000);
  } catch { return null; }
})();
if (toCard) location.replace(`${location.pathname}?carte=${encodeURIComponent(toCard)}`);
if (site && MARKETING) location.replace(`${MARKETING}${TARGET[site]}${location.hash}`);
// shown inside the website's phone mockup: hide the scrollbars (Windows draws them)
try { if (window.self !== window.top) document.documentElement.classList.add('embedded'); } catch { /* cross-origin parent */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {courier ? <Suspense fallback={null}><CourierApp token={courier} /></Suspense> : rdv !== null && slug && !site ? <Suspense fallback={null}><AgendaApp slug={slug} token={rdv || null} /></Suspense> : carte && slug && !site ? <Suspense fallback={null}><CardPage slug={slug} cardKey={carte} /></Suspense> : club !== null && slug && !site ? <Suspense fallback={null}><ClubSignup slug={slug} eventKey={club || null} /></Suspense> : redirecting || toCard ? null : site ? <Suspense fallback={<div style={{ minHeight: '100dvh', background: '#020F20' }} />}>{site === 'profit' ? <ProfitLanding /> : site === 'features' ? <FeaturesLanding /> : <Landing />}</Suspense> : <App />}
  </StrictMode>,
);
