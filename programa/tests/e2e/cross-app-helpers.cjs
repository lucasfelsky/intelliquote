// Helpers cross-app (E2E Phase 3, sprint 5.5+).
//
// Conjunto de utilidades que ligam o E2E self-contained do IntelliQuote ao
// emulador Firebase Auth (substituindo o lado "Portal COMEX" do fluxo cross-
// app). Usado por `tests/e2e/global-setup.ts` e por specs que precisem mintar
// um Firebase ID Token para chamar `POST /api/v1/auth/firebase`.
//
// Decisao de design: helpers em .cjs (CommonJS) para serem importaveis tanto
// pelo `global-setup.ts` (TS executado via ts-node-dev) quanto por outros
// .cjs (scripts) sem briga de modulos. Mantem a interface async/await
// moderna para uso com TypeScript.
//
// Padrao de uso:
//
//   const { startFirebaseAuthEmulator, stopFirebaseAuthEmulator,
//           mintFirebaseIdToken } = require('./cross-app-helpers.cjs')
//
//   const emulator = await startFirebaseAuthEmulator({ projectId })
//   // ... rodar specs ...
//   const idToken = await mintFirebaseIdToken(emulator, {
//     email: 'admin@sqquimica.com',
//     password: 'admin123',
//     claims: { role: 'admin' },
//   })
//   await stopFirebaseAuthEmulator(emulator)

const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')
const net = require('node:net')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const FIREBASE_BIN = path.join(REPO_ROOT, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js')
const WITH_JDK = path.join(REPO_ROOT, 'scripts', 'with-jdk.mjs')
const EMULATOR_CONFIG = path.join(REPO_ROOT, 'tests', 'e2e', 'firebase.emulator.json')

const DEFAULT_AUTH_HOST = '127.0.0.1'
const DEFAULT_AUTH_PORT = 9099
const DEFAULT_HUB_PORT = 4400

function getFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, host, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function isPortOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.request({ host, port, method: 'GET', path: '/', timeout: timeoutMs }, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end()
  })
}

async function waitForHealth(url, timeoutMs = 90_000) {
  const start = Date.now()
  const parsed = new URL(url)
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(parsed.hostname, Number(parsed.port))) {
      // Checar de verdade que e o emulador (responde 200 com ready:true).
      try {
        const body = await fetchJson(url, null, 2000)
        if (body && body.authEmulator && body.authEmulator.ready) return
      } catch {
        // ainda subindo
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`[cross-app] timeout esperando ${url}`)
}

function fetchJson(url, body, timeoutMs = 10_000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const opts = {
      host: parsed.hostname,
      port: Number(parsed.port),
      path: parsed.pathname + parsed.search,
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
        ...(body ? { 'Content-Length': Buffer.byteLength(JSON.stringify(body)) } : {}),
      },
      timeout: timeoutMs,
    }
    const req = http.request(opts, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8')
        try {
          const json = text ? JSON.parse(text) : null
          if (res.statusCode >= 400) {
            const err = new Error(`HTTP ${res.statusCode}: ${text}`)
            err.status = res.statusCode
            err.body = json
            reject(err)
            return
          }
          resolve(json)
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`timeout ${url}`))
    })
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

/**
 * Sobe o emulador Firebase Auth (e apenas ele) com config minimalista.
 *
 * @param {object} [opts]
 * @param {string} [opts.projectId] Default 'sq-comex-updates-3d22f' (bate com
 *   o default do `env.ts` e com o `FIREBASE_PROJECT_ID` que o backend usa).
 * @param {string} [opts.host] Default 127.0.0.1.
 * @param {number} [opts.port] Default 9099. Se ocupado, pega dinamico.
 * @returns {Promise<{ process, host, port, projectId, baseUrl, identitytoolkitUrl, cleanup }>}
 */
async function startFirebaseAuthEmulator(opts = {}) {
  const projectId = opts.projectId || 'sq-comex-updates-3d22f'
  const host = opts.host || DEFAULT_AUTH_HOST
  let port = opts.port || DEFAULT_AUTH_PORT

  // Verificar se ja esta rodando (caso o caller queira reusar).
  if (await isPortOpen(host, port)) {
    const child = null
    return {
      process: child,
      host,
      port,
      projectId,
      baseUrl: `http://${host}:${port}`,
      identitytoolkitUrl: `http://${host}:${port}/identitytoolkit.googleapis.com/v1`,
      cleanup: async () => {},
    }
  }

  const child = spawn(
    process.execPath,
    [WITH_JDK, process.execPath, FIREBASE_BIN, 'emulators:start', '--only', 'auth',
     '--project', projectId, '--config', EMULATOR_CONFIG],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    },
  )

  // Capturar output (silencioso por default; descomente pra debug).
  child.stdout.on('data', (chunk) => {
    process.env.E2E_CROSS_APP_VERBOSE && process.stdout.write(`[emulator] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    process.env.E2E_CROSS_APP_VERBOSE && process.stderr.write(`[emulator] ${chunk}`)
  })

  // Encerrar o emulador se o processo pai morrer (Windows-safe via best-effort).
  const cleanup = async () => {
    if (child.exitCode !== null) return
    try {
      child.kill('SIGTERM')
    } catch {}
    // Esperar ate 5s pra morrer limpo; depois forca.
    const start = Date.now()
    while (Date.now() - start < 5000) {
      if (child.exitCode !== null) break
      await new Promise((r) => setTimeout(r, 100))
    }
    if (child.exitCode === null) {
      try {
        child.kill('SIGKILL')
      } catch {}
    }
  }

  // Esperar ate o emulador responder com ready=true.
  const baseUrl = `http://${host}:${port}`
  await waitForHealth(baseUrl)

  return {
    process: child,
    host,
    port,
    projectId,
    baseUrl,
    identitytoolkitUrl: `${baseUrl}/identitytoolkit.googleapis.com/v1`,
    cleanup,
  }
}

/**
 * Encerra o emulador Firebase Auth retornado por startFirebaseAuthEmulator.
 */
async function stopFirebaseAuthEmulator(emulator) {
  if (!emulator) return
  if (emulator.cleanup) {
    await emulator.cleanup()
  }
}

/**
 * Cria (ou autentica) um usuario no emulador Auth e devolve um ID Token com
 * custom claims opcionais aplicados.
 *
 * Fluxo:
 *   1. signUp (ou signInWithPassword se o user ja existir)
 *   2. accounts:update com Bearer=owner + customAttributes (string JSON)
 *   3. signInWithPassword de novo pra devolver idToken com claims aplicados
 *
 * @param {object} emulator - retorno de startFirebaseAuthEmulator
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} opts.password
 * @param {object} [opts.claims] Ex.: { role: 'admin' }.
 * @returns {Promise<{ idToken, localId, email, expiresIn }>}
 */
async function mintFirebaseIdToken(emulator, opts) {
  if (!emulator) throw new Error('emulator obrigatorio')
  const { email, password, claims = {} } = opts
  if (!email || !password) throw new Error('email e password obrigatorios')

  const key = 'fake-api-key'
  const base = emulator.identitytoolkitUrl

  let idToken
  let localId

  // Tentar signUp primeiro; se o user ja existir (code 400 EMAIL_EXISTS), fazer signIn.
  try {
    const signUpRes = await fetchJson(
      `${base}/accounts:signUp?key=${key}`,
      { email, password, returnSecureToken: true },
    )
    idToken = signUpRes.idToken
    localId = signUpRes.localId
  } catch (err) {
    if (err && err.body && err.body.error && /EMAIL_EXISTS/.test(err.body.error.message)) {
      const signInRes = await fetchJson(
        `${base}/accounts:signInWithPassword?key=${key}`,
        { email, password, returnSecureToken: true },
      )
      idToken = signInRes.idToken
      localId = signInRes.localId
    } else {
      throw err
    }
  }

  // Aplicar custom claims (se houver).
  if (Object.keys(claims).length > 0) {
    await fetchJson(
      `${base}/accounts:update?key=${key}`,
      {
        localId,
        customAttributes: JSON.stringify(claims),
        idToken,
      },
      10_000,
      // O emulador Auth aceita o header "Authorization: Bearer owner" como
      // bypass do escopo do idToken (ele confia no owner = emulador local).
      // Sem isso, INSUFFICIENT_PERMISSION porque o idToken do signUp nao tem
      // permissao admin pra editar o proprio user via accounts:update.
      { Authorization: 'Bearer owner' },
    )
    // O accounts:update nao devolve novo idToken. Fazer login de novo pra ter
    // um token com as claims aplicadas (verificado manualmente no emulador).
    const refreshSignIn = await fetchJson(
      `${base}/accounts:signInWithPassword?key=${key}`,
      { email, password, returnSecureToken: true },
    )
    idToken = refreshSignIn.idToken
  }

  // Decodificar payload pra devolver info util.
  const payloadB64 = idToken.split('.')[1]
  const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4)
  const payload = JSON.parse(Buffer.from(padded, 'base64url').toString('utf-8'))

  return {
    idToken,
    localId,
    email: payload.email,
    claims: payload.role ? { role: payload.role } : {},
    expiresIn: 3600,
  }
}

module.exports = {
  startFirebaseAuthEmulator,
  stopFirebaseAuthEmulator,
  mintFirebaseIdToken,
  // exporta pra testes/integracao com outros modulos
  _internal: { fetchJson, isPortOpen, waitForHealth, getFreePort },
}
