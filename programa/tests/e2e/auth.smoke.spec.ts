import { test, expect } from '@playwright/test'

/**
 * Auth interno — smoke (sem DB seedado).
 * Cobre o caminho HTTP do `/api/v1/auth/login` + `/api/v1/auth/me` via API request context.
 *
 * Para o fluxo completo com seed (login real, refresh, RBAC), ver
 * `auth.flow.spec.ts` em CI/staging.
 */

const ADMIN_EMAIL = 'admin@sqquimica.com' // seed.ts cria este user
const ADMIN_PASSWORD = 'admin123'          // ver prisma/seed.ts

test.describe('Auth interno — smoke (sem DB)', () => {
  test('POST /api/v1/auth/login com credenciais invalidas retorna 401', async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: { email: 'inexistente@sqquimica.com', password: 'senha-errada' },
    })
    expect([401, 400]).toContain(res.status())
  })

  test('GET /api/v1/auth/me sem token retorna 401', async ({ request }) => {
    const res = await request.get('/api/v1/auth/me')
    expect(res.status()).toBe(401)
  })

  test('GET /health/live retorna 200', async ({ request }) => {
    const res = await request.get('/health/live')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('status')
  })

  test('GET /health/ready retorna 200 ou 503 (sem DB)', async ({ request }) => {
    // Em ambiente sem DB, o readiness retorna 503 (esperado). Em CI com
    // DB seedado, retorna 200. Aceitamos os dois como smoke signal.
    const res = await request.get('/health/ready')
    expect([200, 503]).toContain(res.status())
  })

  // Os 2 testes abaixo sao skipped por padrao porque precisam de DB seedado.
  // Para rodar local: `npm run prisma:seed` antes de `npm run test:e2e`.
  test.skip('login + me retorna user do admin (precisa de seed)', async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    expect(login.status()).toBe(200)
    const cookies = login.headers()['set-cookie'] || ''
    expect(cookies).toMatch(/intelliquote_access_token|connect\.sid/i)

    const me = await request.get('/api/v1/auth/me', {
      headers: { Cookie: cookies },
    })
    expect(me.status()).toBe(200)
    const meBody = await me.json()
    expect(meBody.email).toBe(ADMIN_EMAIL)
    expect(['admin']).toContain(meBody.role)
  })

  test.skip('RBAC bloqueia acesso a rota admin com role=viewer (precisa de seed)', async () => {
    // Stub: login com user de role 'viewer' e tenta GET /users.
    // Espera 403.
  })
})
