import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Owners use whatever PC they have, often older ones: keep it Chrome 109 safe.
  build: { target: ['es2020', 'chrome109'], cssTarget: ['chrome109'] },
  server: { port: 5175, host: true },
});
