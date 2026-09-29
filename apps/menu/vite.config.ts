import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Guests scan with whatever phone they have: keep the JS output conservative.
  // (Tailwind v4 CSS itself needs Safari 15.4+ / Chrome 99+.)
  build: { target: ['es2020', 'chrome99', 'safari15'] },
  server: { port: 5173, host: true },
});
