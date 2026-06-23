#!/usr/bin/env node
/**
 * Copia os arquivos estaticos servidos pelo backend a partir de `public/`
 * para `dist/public/`, para que o build de producao do tsc tenha os assets
 * no mesmo lugar.
 *
 * Historico:
 * - Antes da Fase 5.D, isso copiava TUDO de public/ (incluindo o legacy
 *   `index.html` + `app.js` + `styles.css` da UI vanilla JS).
 * - A partir da Fase 5.D, o frontend principal foi migrado para React + Vite
 *   e e hospedado no Firebase Hosting. O backend em Cloud Run agora so
 *   precisa servir:
 *     - `public/portal.html` (supplier portal) e os assets minimos dele
 *       (as <style> ja estao inline no proprio HTML; sem arquivo JS externo).
 *   Tudo o mais (React bundle, login gate, etc.) vive em
 *   `Portal COMEX/sq-comex-updates/hosting-intelliquote/` e nao precisa
 *   ser embarcado no container do backend.
 *
 * Fase 8: `public/index.html`, `public/app.js`, `public/styles.css` e
 * `public/styles.legacy.css` foram removidos definitivamente. Este script
 * continua existindo para garantir que `portal.html` chegue no container,
 * mas agora so copia esse arquivo (o resto do public/ sao logos/favicon).
 *
 * Uso: `npm run build:web`
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'public');
const DEST = path.resolve(__dirname, '..', 'dist', 'public');

function rimraf(p) {
  if (!fs.existsSync(p)) return;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const child = path.join(p, entry.name);
    if (entry.isDirectory()) rimraf(child);
    else fs.unlinkSync(child);
  }
  fs.rmdirSync(p);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(SRC)) {
  console.error(`[copy-web] Pasta nao encontrada: ${SRC}`);
  process.exit(1);
}

rimraf(DEST);
copyDir(SRC, DEST);
console.log(`[copy-web] Copiado ${SRC} -> ${DEST}`);
