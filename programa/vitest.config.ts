import { defineConfig } from 'vitest/config'

// Config do vitest para o IntelliQuote.
// Exclui `tests/e2e/**` — esses specs sao do Playwright, nao vitest.
// Para rodar E2E: `npm run test:e2e` (config em `playwright.config.ts`).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
})
