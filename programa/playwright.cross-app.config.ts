import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

// Sinaliza (o mais cedo possivel, no load do config) que este run E2E cobre o
// fluxo cross-app. O `global-setup.ts` usa essa env pra subir o emulador
// Firebase Auth alem do Postgres efemero + backend.
process.env.E2E_CROSS_APP = '1'
process.env.E2E_EMBEDDED = '1' // tambem exige backend + DB (auto-provision precisa de User table)

/**
 * Config de E2E cross-app (Sprint 5.5+, Phase 3 do E2E).
 *
 * Diferente do playwright.embedded.config.ts (que sobe backend + Postgres
 * efemero e roda os smokes sem Firebase), este config ADICIONA o emulador
 * Firebase Auth ao stack:
 *   - global-setup.ts sobe Postgres efemero + Auth Emulator + backend apontando
 *     pro emulador Auth (via FIREBASE_AUTH_EMULATOR_HOST + FIREBASE_PROJECT_ID)
 *   - os specs em tests/e2e/auth.firebase.spec.ts mintam um ID Token via
 *     `mintFirebaseIdToken()` e chamam POST /api/v1/auth/firebase pra validar
 *     o auto-provision + a troca por JWT local.
 *
 * Rodar: npm run test:e2e:cross-app
 * Requer JDK 11+ (autodetectado via scripts/with-jdk.mjs).
 */
export default defineConfig({
  ...baseConfig,
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  // Backend + emulador Auth geridos pelo global-setup (nao pelo webServer do
  // Playwright).
  webServer: undefined,
  // Foco: os specs cross-app. Outros specs que dependem so de DB rodam
  // normalmente.
  testMatch: /.*\.(firebase|auth)\.spec\.ts/,
})
