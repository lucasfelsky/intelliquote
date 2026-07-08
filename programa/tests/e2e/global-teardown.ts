// Teardown do E2E self-contained: derruba o backend e o Postgres efemero
// subidos pelo global-setup.ts, e apaga o data dir temporario.
//
// Se `E2E_CROSS_APP=1`, tambem derruba o emulador Firebase Auth (Phase 3).
// Ordem: emulador Auth PRIMEIRO (evita que o backend tente reconectar), depois
// backend, depois Postgres.

import { rmSync } from 'node:fs'

type StashedState = {
  pg?: { stop: () => Promise<void> }
  backend?: { kill: (signal?: NodeJS.Signals) => boolean }
  dataDir?: string
  firebaseEmulator?: { cleanup: () => Promise<void> }
}

export default async function globalTeardown() {
  const stash = (globalThis as unknown as { __IQ_E2E__?: StashedState }).__IQ_E2E__
  if (!stash) return

  // 1) Emulador Auth cross-app (Phase 3) — se presente.
  if (stash.firebaseEmulator) {
    try {
      console.log('[e2e teardown] derrubando emulador Firebase Auth...')
      await stash.firebaseEmulator.cleanup()
    } catch {
      // ignore
    }
  }

  // 2) Backend.
  try {
    stash.backend?.kill('SIGTERM')
  } catch {
    // ignore
  }

  // 3) Postgres efemero.
  try {
    await stash.pg?.stop()
  } catch {
    // ignore
  }

  // 4) Data dir.
  if (stash.dataDir) {
    try {
      rmSync(stash.dataDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}
