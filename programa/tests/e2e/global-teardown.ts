// Teardown do E2E self-contained: derruba o backend e o Postgres efemero
// subidos pelo global-setup.ts, e apaga o data dir temporario.

import { rmSync } from 'node:fs'

type StashedState = {
  pg?: { stop: () => Promise<void> }
  backend?: { kill: (signal?: NodeJS.Signals) => boolean }
  dataDir?: string
}

export default async function globalTeardown() {
  const stash = (globalThis as unknown as { __IQ_E2E__?: StashedState }).__IQ_E2E__
  if (!stash) return

  try {
    stash.backend?.kill('SIGTERM')
  } catch {
    // ignore
  }

  try {
    await stash.pg?.stop()
  } catch {
    // ignore
  }

  if (stash.dataDir) {
    try {
      rmSync(stash.dataDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}
