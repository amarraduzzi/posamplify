import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Offline till: a service worker keeps the app itself on the PC, so it
    // still opens (and reloads) without internet. Menu photos are cached as
    // they are seen. The database API is never cached here: offline data
    // lives in the till's own queue (src/lib/outbox.ts).
    VitePWA({
      registerType: 'prompt', // never reload in the middle of an order; updates apply at the staff lock screen
      injectRegister: false,
      manifest: {
        name: 'Amplify Caisse', short_name: 'Amplify Caisse', description: 'La caisse Amplify POS', id: '/', start_url: '/', scope: '/', display: 'standalone',
        background_color: '#020F20', theme_color: '#020F20', lang: 'fr',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        globIgnores: ['**/*.exe', '**/*.apk'],
        navigateFallback: 'index.html',
        // downloads (the Windows print program, the Android app) always come from the network
        navigateFallbackDenylist: [/\.(exe|apk)$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [{
          urlPattern: ({ request, url }) => request.destination === 'image' && !url.pathname.includes('/rest/v1/'),
          handler: 'CacheFirst',
          options: { cacheName: 'menu-photos', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [0, 200] } },
        }],
      },
    }),
  ],
  // Many Moroccan tills are Windows 7 PCs stuck on Chrome 109: the output
  // (JS and CSS) must run there. That is also why this app uses Tailwind v3
  // (v4 needs Chrome 111+).
  build: { target: ['es2020', 'chrome109'], cssTarget: ['chrome109'] },
  server: { port: 5174, host: true },
});
