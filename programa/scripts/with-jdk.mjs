#!/usr/bin/env node
// with-jdk.mjs — roda o comando passado com o bin de um JDK 11+ na frente do PATH.
//
// Motivo: o Auth Emulator do firebase-tools exige JDK 11+. Em algumas máquinas
// o `java` default do PATH é Java 8 (ex.: o shim Oracle "javapath" no Windows).
//
// Ordem de resolução do JAVA_HOME:
//   1. process.env.JAVA_HOME, se o bin existir.
//   2. Pastas conhecidas de instalação no Windows (Temurin / Adoptium /
//      OpenJDK / Zulu / Oracle) — procura a versão mais alta disponível.
//   3. No-op: cai no `java` do PATH (dev é responsável por ter um JDK 11+).
//
// Uso: node scripts/with-jdk.mjs <comando> [args...]
// Ex.: node scripts/with-jdk.mjs firebase emulators:start --only auth
//
// Por que sem `shell:true`: evita re-serialização/escaping de args no Windows
// (quebra payloads com espaço). Os npm scripts invocam o firebase pelo
// entrypoint node (`node node_modules/firebase-tools/lib/bin/firebase.js ...`)
// em vez do binário `.cmd`, que precisaria de shell pra resolver.

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const [, , cmd, ...args] = process.argv

if (!cmd) {
  console.error('uso: node scripts/with-jdk.mjs <comando> [args...]')
  process.exit(1)
}

const isWindows = os.platform() === 'win32'

function tryResolveJdkBin() {
  // 1) JAVA_HOME explícito
  if (process.env.JAVA_HOME) {
    const bin = path.join(process.env.JAVA_HOME, 'bin')
    if (fs.existsSync(bin)) return bin
    console.warn(
      `[with-jdk] JAVA_HOME setado (${process.env.JAVA_HOME}) mas ${bin} não existe; tentando autodetectar.`,
    )
  }

  // 2) Autodetect no Windows
  if (isWindows) {
    const candidates = [
      'C:/Program Files/Eclipse Adoptium',
      'C:/Program Files/AdoptOpenJDK',
      'C:/Program Files/Zulu',
      'C:/Program Files/OpenJDK',
      'C:/Program Files/Java',
    ]
    for (const base of candidates) {
      if (!fs.existsSync(base)) continue
      let entries
      try {
        entries = fs.readdirSync(base).filter((n) => /jdk-\d+/i.test(n) || /^jdk/i.test(n))
      } catch {
        continue
      }
      if (entries.length === 0) continue
      // Maior versão primeiro
      entries.sort((a, b) => {
        const na = Number((a.match(/jdk-?(\d+)/i) || [])[1] ?? 0)
        const nb = Number((b.match(/jdk-?(\d+)/i) || [])[1] ?? 0)
        return nb - na
      })
      for (const e of entries) {
        const bin = path.join(base, e, 'bin')
        if (fs.existsSync(bin)) {
          console.log(`[with-jdk] JDK autodetectado: ${path.join(base, e)}`)
          return bin
        }
      }
    }
  }

  return null
}

const jdkBin = tryResolveJdkBin()
if (jdkBin) {
  process.env.PATH = jdkBin + path.delimiter + (process.env.PATH ?? '')
  // Também seta JAVA_HOME pra filhos que dependam
  process.env.JAVA_HOME = path.dirname(jdkBin)
} else {
  console.warn(
    '[with-jdk] nenhum JDK 11+ encontrado; usando o `java` do PATH (precisa ser JDK 11+ pro emulador).',
  )
}

const child = spawn(cmd, args, { stdio: 'inherit' })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
child.on('error', (err) => {
  console.error(`[with-jdk] falha ao iniciar "${cmd}":`, err.message)
  process.exit(1)
})
