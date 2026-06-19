// Copia web/dist/ para o destino usado pelo deploy do Firebase Hosting.
// Pode ser customizado pelas env vars (caso o deploy use outro caminho).
import { cp, rm, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'dist');
const projectRoot = resolve(__dirname, '..', '..', '..');
const DEST = process.env.FIREBASE_HOSTING_DEST
  ? resolve(projectRoot, process.env.FIREBASE_HOSTING_DEST)
  : resolve(projectRoot, 'Portal COMEX', 'sq-comex-updates', 'hosting-intelliquote');

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });
await cp(SRC, DEST, { recursive: true });
console.log(`[copy-to-firebase-hosting] ${SRC} -> ${DEST}`);
