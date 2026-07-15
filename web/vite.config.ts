import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { claudeCodeBridge } from './vite-plugin-claude-code';

export default defineConfig({
  // En CI (build de déploiement GitHub Pages), le site est servi depuis
  // https://arcturyus.github.io/FoodRecorder/ et non à la racine du domaine.
  base: process.env.CI ? '/FoodRecorder/' : '/',
  plugins: [react(), claudeCodeBridge()],
  server: {
    headers: {
      // Requis par web-llm / transformers.js (SharedArrayBuffer, threads WASM)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
