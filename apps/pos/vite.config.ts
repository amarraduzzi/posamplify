import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Many Moroccan tills are Windows 7 PCs stuck on Chrome 109: the output
  // (JS and CSS) must run there. That is also why this app uses Tailwind v3
  // (v4 needs Chrome 111+).
  build: { target: ['es2020', 'chrome109'], cssTarget: ['chrome109'] },
  server: { port: 5174, host: true },
});
