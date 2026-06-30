import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config para o IntelliQuote (Sprint 4.2 / L5).
 *
 * Foco: Portal do Fornecedor (Fluxo B do [[Integração end-to-end]]).
 *   - GET /portal?token=<raw> -> carrega portal.html
 *   - GET /api/v1/portal/tokens/:raw -> metadados
 *   - POST /api/v1/portal/tokens/:raw/respond -> submit
 *
 * O webServer sobe:
 *   - IntelliQuote backend (npm run dev) na 3000 (sobe se nao estiver up)
 *   - (opcional) MailHog para verificar o link magico no e-mail
 *
 * Para rodar offline (sem o app rodando), passe `PLAYWRIGHT_BASE_URL` ja
 * apontando para um ambiente externo e o webServer nao sobe.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Portal do fornecedor usa token magico unico por execucao
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000/health/ready',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
})
