import { test, expect } from '@playwright/test'

// Helper cross-app (CommonJS). O Playwright carrega specs via ts-node-dev
// com transpile-only, entao `require` e' preservado e resolve relativo.
// (Cuidado: nao trocar para `import { foo } from './cross-app-helpers.cjs'`
// porque o tsconfig do programa e' "module": "CommonJS" e o default
// import ESM quebraria no tsc strict mode mesmo que o Playwright ignore.)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mintFirebaseIdToken } = require('./cross-app-helpers.cjs')

/**
 * Fluxo A (cross-app) — Portal COMEX → IntelliQuote via Firebase ID token.
 *
 * Cobre o caminho do "usuario acessa o IntelliQuote a partir do Portal
 * COMEX": o front do Portal tem o Firebase ID Token do usuario logado, envia
 * como Bearer no `POST /api/v1/auth/firebase`, e o backend troca por um par de
 * JWTs IntelliQuote (access + refresh) + grava em cookie.
 *
 * Setup (global-setup.ts, gated por E2E_CROSS_APP=1):
 *   - Postgres efemero com seed (admin@sqquimica.com ja existe)
 *   - Emulador Firebase Auth em 127.0.0.1:9099 (sq-comex-updates-3d22f)
 *   - Backend IntelliQuote em :3000 com FIREBASE_AUTH_EMULATOR_HOST apontado
 *     pro emulador
 *
 * Rodar: `npm run test:e2e:cross-app`
 */

const PROJECT_ID = 'sq-comex-updates-3d22f'

// Emulador que o global-setup subiu (handle em globalThis.__IQ_E2E__).
// Aqui so precisamos de um "objeto emulator" com o basico pra o helper
// `mintFirebaseIdToken` saber onde conectar.
const EMULATOR_HANDLE = {
  host: '127.0.0.1',
  port: 9099,
  projectId: PROJECT_ID,
  baseUrl: 'http://127.0.0.1:9099',
  identitytoolkitUrl: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1',
}

const CROSS_APP_ENABLED = process.env.E2E_CROSS_APP === '1'
const describeIf = CROSS_APP_ENABLED ? test.describe : test.describe.skip

describeIf('Fluxo A cross-app — Portal COMEX -> IntelliQuote via Firebase ID token', () => {
  test('POST /api/v1/auth/firebase faz auto-provision + troca por JWT local', async ({ request }) => {
    const email = `e2e-cross-app-${Date.now()}@sqquimica.com`
    const { idToken } = await mintFirebaseIdToken(EMULATOR_HANDLE, {
      email,
      password: 'e2e-pass-123',
      claims: { role: 'admin' },
    })
    expect(idToken).toBeTruthy()
    expect(idToken.length).toBeGreaterThan(100)

    const res = await request.post('/api/v1/auth/firebase', {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()

    // Shape do response (ver FirebaseAuthController.exchange).
    expect(body).toHaveProperty('user')
    expect(body).toHaveProperty('accessToken')
    expect(body).toHaveProperty('refreshToken')
    expect(body).toHaveProperty('expiresIn')
    expect(typeof body.accessToken).toBe('string')
    expect(typeof body.refreshToken).toBe('string')
    expect(typeof body.expiresIn).toBe('number')

    // User auto-provisionado com role honrada da custom claim.
    expect(body.user).toMatchObject({
      email,
      role: 'admin',
    })
    expect(typeof body.user.id).toBe('number')
    expect(body.user.id).toBeGreaterThan(0)

    // Cookies de sessao (defesa em profundidade alem do body).
    const setCookie = res.headers()['set-cookie'] || ''
    expect(setCookie).toMatch(/intelliquote_access_token/)
    expect(setCookie).toMatch(/intelliquote_refresh_token/)
  })

  test('auto-provision cria User com nome derivado do email e role default comprador', async ({ request }) => {
    const uniqueEmail = `e2e-cross-app-noname-${Date.now()}@sqquimica.com`
    const { idToken } = await mintFirebaseIdToken(EMULATOR_HANDLE, {
      email: uniqueEmail,
      password: 'pass-123',
      // sem claims -> DEFAULT_INTERNAL_ROLE = 'comprador'
    })

    const res = await request.post('/api/v1/auth/firebase', {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()

    // Ver FirebaseAuthController.exchange -> mapFirebaseRoleToInternal.
    expect(body.user.role).toBe('comprador')
    // Display name fallback: parte antes do @ do email.
    expect(body.user.name).toBe(uniqueEmail.split('@')[0])
    expect(body.user.email).toBe(uniqueEmail)
  })

  test('login repetido com mesmo uid eh idempotente (mesmo id interno)', async ({ request }) => {
    const repeatedEmail = `e2e-cross-app-rep-${Date.now()}@sqquimica.com`

    // 1) Primeira chamada: provisiona com role default 'comprador'.
    const token1 = await mintFirebaseIdToken(EMULATOR_HANDLE, {
      email: repeatedEmail,
      password: 'pass-123',
    })
    const res1 = await request.post('/api/v1/auth/firebase', {
      headers: { Authorization: `Bearer ${token1.idToken}` },
    })
    expect(res1.status()).toBe(200)
    const user1 = (await res1.json()).user
    expect(user1.role).toBe('comprador')

    // 2) Segunda chamada: MESMO uid mas role 'admin' na custom claim.
    //    O backend deve atualizar o role do user existente (mesmo id).
    const token2 = await mintFirebaseIdToken(EMULATOR_HANDLE, {
      email: repeatedEmail,
      password: 'pass-123',
      claims: { role: 'admin' },
    })
    const res2 = await request.post('/api/v1/auth/firebase', {
      headers: { Authorization: `Bearer ${token2.idToken}` },
    })
    expect(res2.status()).toBe(200)
    const user2 = (await res2.json()).user

    expect(user2.id).toBe(user1.id)
    expect(user2.email).toBe(repeatedEmail)
    expect(user2.role).toBe('admin')
  })

  test('JWT local retornado funciona em /api/v1/auth/me (cookie jar)', async ({ request }) => {
    const meEmail = `e2e-cross-app-me-${Date.now()}@sqquimica.com`
    const { idToken } = await mintFirebaseIdToken(EMULATOR_HANDLE, {
      email: meEmail,
      password: 'pass-123',
      claims: { role: 'comprador' },
    })

    const login = await request.post('/api/v1/auth/firebase', {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    expect(login.status()).toBe(200)
    // O Playwright APIRequestContext mantem o cookie jar entre requests,
    // entao o cookie intelliquote_access_token devolvido no /auth/firebase
    // e' reenviado no /auth/me (mesmo padrao de auth.smoke.spec.ts:54).
    const me = await request.get('/api/v1/auth/me')
    expect(me.status()).toBe(200)
    const meBody = await me.json()
    expect(meBody.user.email).toBe(meEmail)
    expect(meBody.user.role).toBe('comprador')
  })
})
