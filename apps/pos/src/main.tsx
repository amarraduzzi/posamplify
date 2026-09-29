import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { PosProvider } from './store';
import { unlockAudio } from './lib/sound';

document.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });
createRoot(document.getElementById('root')!).render(
  <StrictMode><PosProvider><App /></PosProvider></StrictMode>,
);
