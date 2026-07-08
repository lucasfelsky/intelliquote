// Global setup do E2E self-contained (sem docker / sem Postgres de sistema).
//
// Sobe um Postgres EFEMERO via `embedded-postgres` (binario baixado em
// node_modules, nao um servico), roda `prisma migrate deploy` + seed contra
// ele, e sobe o backend do IntelliQuote apontando pra esse banco. O teardown
// (global-teardown.ts) derruba backend + Postgres e apaga o data dir.
//
// Usado por playwright.embedded.config.ts. Handles guardados em globalThis
// (setup e teardown rodam no mesmo processo do runner do Playwright).

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

  ;(globalThis as unknown as { __IQ_E2E__?: unknown }).__IQ_E2E__ = { pg, backend, dataDir }
}
