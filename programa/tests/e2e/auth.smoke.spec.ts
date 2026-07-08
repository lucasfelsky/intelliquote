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

  // Os testes abaixo precisam de DB seedado. Rodam no config embedded
  // (`npm run test:e2e:embedded`, que sobe Postgres efemero + seed e seta
  // E2E_EMBEDDED); no `npm run test:e2e` sem seed, ficam skipped.
  const seededTest = process.env.E2E_EMBEDDED ? test : test.skip

  seededTest('login + me retorna user do admin (precisa de seed)', async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    expect(login.status()).toBe(200)
    const cookies = login.headers()['set-cookie'] || ''
    expect(cookies).toMatch(/intelliquote_access_token|connect\.sid/i)

    // A APIRequestContext do Playwright mantem o cookie jar entre chamadas;
    // nao setar Cookie manualmente (o set-cookie cru tem atributos que nao
    // valem como header de request -> "Invalid character in header").
    const me = await request.get('/api/v1/auth/me')
    expect(me.status()).toBe(200)
    const meBody = await me.json()
    // /api/v1/auth/me responde { user: {...} } (ver AuthController.me).
    expect(meBody.user.email).toBe(ADMIN_EMAIL)
    expect(['admin']).toContain(meBody.user.role)
  })

  test.skip('RBAC bloqueia acesso a rota admin com role=viewer (precisa de seed)', async () => {
    // Stub: login com user de role 'viewer' e tenta GET /users.
    // Espera 403.
  })
})
