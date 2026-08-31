/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The app talks to a same-origin /api during development, so the client never needs to
    // know a backend host. Deployment can put both behind one origin without code changes.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Well clear of anything these tests legitimately need — the slowest is under two
    // seconds here. The default five is not: a CI runner is a fraction of a development
    // machine and shares what it has, so a test doing real work against a real router and a
    // real query cache can cross five seconds there while never coming near it locally. A
    // timeout that only fires on the slower machine reports a scheduling accident as a
    // broken feature.
    testTimeout: 15_000,
  },
});
