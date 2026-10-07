import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  // Config so de teste (producao usa vite.config.ts): libera public/ do backend para o
  // import `portal.html?raw` do teste jsdom do portal.
  server: {
    fs: { allow: [resolve(__dirname), resolve(__dirname, '../public')] },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    // Maior que asyncUtilTimeout (5000): o waitFor/findBy que falhar estoura antes do teste e preserva a
    // mensagem descritiva do Testing Library em vez de "Test timed out".
    testTimeout: 20000,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
