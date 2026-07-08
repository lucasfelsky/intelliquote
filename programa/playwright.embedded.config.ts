import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

// Sinaliza (o mais cedo possivel, no load do config) que este run tem DB
// seedado. Os workers do Playwright herdam este env, entao os specs podem
// habilitar testes que dependem de seed (que ficam skipped no `npm run
// test:e2e` sem seed).
process.env.E2E_EMBEDDED = '1'

/**
 * Config de E2E SELF-CONTAINED (Sprint 2026-07-06).
 *
 * Diferente do playwright.config.ts (que sobe o backend via webServer e
 * espera um Postgres externo — usado no CI, que tem Postgres 16 + MailHog
 * como services), este config:
 *   - global-setup.ts sobe um Postgres EFEMERO via embedded-postgres (sem
 *     docker/servico), roda migrate+seed e sobe o backend apontando pra ele.
 *   - global-teardown.ts derruba tudo.
 *
 * Rodar: npm run test:e2e:embedded
 * Requer JDK so' se for exercitar o emulador Firestore (fluxos cross-app);
 * os smokes de backend/portal nao precisam.
 */
export default defineConfig({
  ...baseConfig,
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  // Backend gerido pelo global-setup (nao pelo webServer do Playwright).
  webServer: undefined,
})
