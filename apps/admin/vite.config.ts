import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Installable on Windows and Android: an "Amplify App" icon on the desktop, its own window.
    // The service worker only keeps the app's files; data always comes live from the server.
    VitePWA({
      registerType: 'prompt', // a new version is switched on when the page is hidden, never mid-typing (src/lib/sw.ts)
      injectRegister: false,
      manifest: {
        name: 'Amplify App', short_name: 'Amplify App', description: 'La gestion de votre restaurant', id: '/', start_url: '/', scope: '/', display: 'standalone',
        background_color: '#001E3E', theme_color: '#001E3E', lang: 'fr',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        globIgnores: ['**/*.exe'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/compta\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // Owners use whatever PC they have, often older ones: keep it Chrome 109 safe.
  build: { target: ['es2020', 'chrome109'], cssTarget: ['chrome109'] },
  server: { port: 5175, host: true },
});
