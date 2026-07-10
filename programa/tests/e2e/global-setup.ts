// Global setup do E2E self-contained (sem docker / sem Postgres de sistema).
//
// Sobe um Postgres EFEMERO via `embedded-postgres` (binario baixado em
// node_modules, nao um servico), roda `prisma migrate deploy` + seed contra
// ele, e sobe o backend do IntelliQuote apontando pra esse banco. O teardown
// (global-teardown.ts) derruba backend + Postgres e apaga o data dir.
//
// Usado por playwright.embedded.config.ts. Handles guardados em globalThis
// (setup e teardown rodam no mesmo processo do runner do Playwright).
//
// Quando `E2E_CROSS_APP=1`, tambem sobe o emulador Firebase Auth (so `auth`,
// sem Firestore/Functions pra manter o run rapido) e seta
// FIREBASE_AUTH_EMULATOR_HOST/FIREBASE_PROJECT_ID no env que o backend herda.
// O backend ja' tem `firebaseAdmin` apontado pro emulador via getFirebaseApp()
// em `middlewares/firebaseAuth.ts` (lendo process.env.FIREBASE_AUTH_EMULATOR_HOST
// a cada request do firebase-admin). Necessario para o teste cross-app do
// Phase 3 (Fluxo A — Portal COMEX → IntelliQuote via Firebase ID token).

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import net from 'node:net'

const BACKEND_PORT = 3000
const DB_NAME = 'intelliquote_e2e'
const TS_NODE = 'node_modules/ts-node/dist/bin.js'
const PRISMA = 'node_modules/prisma/build/index.js'

// Porta livre dinamica pro Postgres efemero — evita conflito se uma execucao
// anterior tiver deixado um postgres.exe orfao (embedded-postgres no Windows
// nem sempre reap o processo no stop()).
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
  })
}

function runOneShot(bin: string, args: string[], env: NodeJS.ProcessEnv, label: string) {
  const result = spawnSync(process.execPath, [bin, ...args], { env, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`[e2e setup] ${label} falhou (exit ${result.status})`)
  }
}

async function waitForHealth(url: string, timeoutMs = 90_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(url, (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      })
      req.on('error', () => resolve(false))
      req.setTimeout(2000, () => {
        req.destroy()
        resolve(false)
      })
    })
    if (ok) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`[e2e setup] timeout esperando ${url}`)
}

export default async function globalSetup() {
  // Import dinamico: embedded-postgres e' ESM; assim funciona no contexto
  // (CJS) em que o Playwright carrega o global setup.
  const { default: EmbeddedPostgres } = await import('embedded-postgres')

  const pgPort = await getFreePort()
  const dbUrl = `postgresql://postgres:postgres@localhost:${pgPort}/${DB_NAME}`
  const dataDir = mkdtempSync(join(tmpdir(), 'iq-e2e-pg-'))
  const pg = new EmbeddedPostgres({
    database_dir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: pgPort,
    persistent: false,
  })

  console.log('[e2e setup] subindo Postgres efemero...')
  await pg.initialise()
  await pg.start()
  await pg.createDatabase(DB_NAME)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: dbUrl,
    DIRECT_URL: dbUrl,
    NODE_ENV: 'test',
    PORT: String(BACKEND_PORT),
    MAILER_PROVIDER: 'console', // sem SMTP real no E2E
    // Credenciais determinísticas do admin seedado (casam com os specs E2E).
    ADMIN_SEED_EMAIL: 'admin@sqquimica.com',
    ADMIN_SEED_PASSWORD: 'admin123',
    ADMIN_SEED_NAME: 'Admin E2E',
  }

  // ----- Cross-app: sobe o emulador Firebase Auth (Phase 3, sprint 5.5+). -----
  // Gated por E2E_CROSS_APP=1 (setado em playwright.cross-app.config.ts). O
  // emulador Auth roda em 127.0.0.1:9099; setamos FIREBASE_AUTH_EMULATOR_HOST
  // e FIREBASE_PROJECT_ID no env que sera passado ao backend. O firebase-admin
  // SDK le process.env.FIREBASE_AUTH_EMULATOR_HOST a cada request, entao o
  // backend ja' vai usar o emulador no primeiro verifyIdToken().
  let firebaseEmulator: Awaited<ReturnType<typeof import('./cross-app-helpers.cjs').startFirebaseAuthEmulator>> | null = null
  if (process.env.E2E_CROSS_APP === '1') {
    console.log('[e2e setup] subindo emulador Firebase Auth...')
    const { startFirebaseAuthEmulator } = await import('./cross-app-helpers.cjs')
    firebaseEmulator = await startFirebaseAuthEmulator({
      projectId: process.env.FIREBASE_PROJECT_ID ?? 'sq-comex-updates-3d22f',
    })
    env.FIREBASE_AUTH_EMULATOR_HOST = `${firebaseEmulator.host}:${firebaseEmulator.port}`
    env.FIREBASE_PROJECT_ID = firebaseEmulator.projectId
    console.log(`[e2e setup] emulador Auth pronto em ${firebaseEmulator.baseUrl} (host do backend: ${env.FIREBASE_AUTH_EMULATOR_HOST})`)
    // Pequeno respiro para o firebase-admin SDK estabilizar o endpoint do
    // emulador (le a env FIREBASE_AUTH_EMULATOR_HOST a cada request, mas
    // ha' cache interno do JWKS por alguns ms apos a primeira chamada).
    // 500ms e' o suficiente na pratica (verificado); 1000ms da margem
    // contra o CI rodando em hardware mais lento.
    await new Promise((r) => setTimeout(r, 1000))
  }
  // --------------------------------------------------------------------------

  console.log('[e2e setup] prisma migrate deploy...')
  runOneShot(PRISMA, ['migrate', 'deploy'], env, 'migrate deploy')

  console.log('[e2e setup] seed...')
  runOneShot(TS_NODE, ['--transpile-only', 'prisma/seed.ts'], env, 'seed')

  console.log('[e2e setup] subindo backend...')
  const backend = spawn(process.execPath, [TS_NODE, '--transpile-only', 'src/server.ts'], {
    env,
    stdio: 'inherit',
  })
  await waitForHealth(`http://localhost:${BACKEND_PORT}/health/ready`)
  console.log('[e2e setup] backend pronto em :' + BACKEND_PORT)

  ;(globalThis as unknown as { __IQ_E2E__?: unknown }).__IQ_E2E__ = {
    pg,
    backend,
    dataDir,
    ...(firebaseEmulator ? { firebaseEmulator } : {}),
  }
}
