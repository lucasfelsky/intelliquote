// Banco descartavel e SMTP console: nunca usa DATABASE_URL do .env.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn, execFileSync } from 'node:child_process';

const cwd = dirname(dirname(fileURLToPath(import.meta.url)));
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const dataDir = mkdtempSync(join(tmpdir(), 'iq-critical-pg-'));
const pg = new EmbeddedPostgres({
  database_dir: dataDir,
  user: 'postgres', password: 'local-test-only', port, persistent: false,
  onLog: () => {},
});
const dbUrl = `postgresql://postgres:local-test-only@127.0.0.1:${port}/iq_critical_test`;
const env = { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl,
  NODE_ENV: 'test', MAILER_PROVIDER: 'console', RUN_DB_TESTS: 'true' };
function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { cwd, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Teste local terminou com codigo ${code}`)));
  });
}
const STOP_TIMEOUT_MS = 15000;
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
function readPostmasterPid() {
  try {
    const pid = Number.parseInt(readFileSync(join(dataDir, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0], 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}
function normalizePath(p) {
  return String(p).replace(/\//g, '\\').toLowerCase();
}
// Confirma que o PID lido de postmaster.pid e mesmo o postgres deste cluster
// (PID reutilizado por outro processo nunca pode ser morto por engano).
function isClusterPostmaster(pid) {
  try {
    const dir = normalizePath(dataDir);
    if (process.platform === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object Name,CommandLine | ConvertTo-Json -Compress`],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      const info = JSON.parse(out);
      if (typeof info?.Name !== 'string' || typeof info?.CommandLine !== 'string') return false;
      return info.Name.toLowerCase() === 'postgres.exe' && normalizePath(info.CommandLine).includes(dir);
    }
    const args = execFileSync('ps', ['-o', 'args=', '-p', String(pid)],
      { encoding: 'utf8', timeout: 10000 });
    return args.includes('postgres') && normalizePath(args).includes(dir);
  } catch { return false; }
}
function listDescendants(rootPid) {
  // taskkill /T nao alcanca filhos cujo pai ja morreu (io_worker orfao): mapeia a
  // arvore enquanto o postmaster ainda existe.
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process -Filter "Name=\'postgres.exe\'" | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId)" }'],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    const children = new Map();
    for (const line of out.split(/\r?\n/)) {
      const [p, pp] = line.trim().split(',').map(Number);
      if (!p || !pp) continue;
      if (!children.has(pp)) children.set(pp, []);
      children.get(pp).push(p);
    }
    const found = [];
    const queue = [rootPid];
    while (queue.length > 0) {
      for (const c of children.get(queue.shift()) ?? []) { found.push(c); queue.push(c); }
    }
    return found;
  } catch { return []; }
}
function taskkill(args) {
  return new Promise(resolve => {
    const child = spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', resolve);
    child.once('exit', resolve);
  });
}
async function killTree(pid, beforeFirstKill) {
  if (!pid) return;
  let notified = false;
  const notify = () => { if (!notified) { notified = true; beforeFirstKill?.(); } };
  if (process.platform === 'win32') {
    // Mata filhos primeiro e repete: processos criados durante o desligamento
    // (io_worker) apontam para um pai ja morto e escapam do taskkill /T.
    const known = new Set([pid]);
    for (let attempt = 0; attempt < 5; attempt++) {
      const found = [...known].flatMap(p => listDescendants(p)).filter(p => !known.has(p));
      found.forEach(p => known.add(p));
      const targets = attempt === 0 ? [...known] : found;
      if (attempt > 0 && targets.length === 0) break;
      if (targets.length > 0) { notify(); await taskkill([...targets.flatMap(p => ['/PID', String(p)]), '/T', '/F']); }
      await new Promise(r => setTimeout(r, 500));
    }
    return;
  }
  notify();
  try { process.kill(-pid, 'SIGKILL'); } catch { /* ignora */ }
  try { process.kill(pid, 'SIGKILL'); } catch { /* ja encerrado */ }
}
async function teardown() {
  const pid = readPostmasterPid();
  // pg.stop() registra o listener de 'exit' ao ser chamado: precisa comecar com o
  // postmaster ainda vivo (antes do primeiro kill), senao o evento nunca chega.
  let stopping = null;
  const startStop = () => { stopping ??= withTimeout(pg.stop(), STOP_TIMEOUT_MS); };
  // Banco descartavel: mata postmaster + filhos (io_worker etc.) enquanto o pai
  // ainda vive; depois de morto, taskkill /T nao alcanca os filhos orfaos.
  // So mata por PID se ele for o postgres deste cluster (anti PID reutilizado).
  if (pid && isClusterPostmaster(pid)) {
    console.log(`teardown: postmaster ${pid} confirmado (postgres.exe + dataDir do cluster).`);
    await killTree(pid, startStop);
  } else {
    console.error(`teardown: PID ${pid} nao confere com o postgres do cluster; nao mato por PID.`);
  }
  startStop();
  try {
    await stopping;
  } catch (err) {
    console.error(`pg.stop() nao concluiu (${err.message}).`);
  }
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* best effort */ }
}

let testFailed = false;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('iq_critical_test');
  await run('node_modules/prisma/build/index.js', ['migrate', 'deploy']);
  const testFiles = process.argv.slice(2);
  await run('node_modules/vitest/vitest.mjs', ['run', ...(testFiles.length > 0 ? testFiles : ['tests/critical-fixes-db.test.ts']), '--maxWorkers=1']);
} catch (err) {
  testFailed = true;
  console.error(err instanceof Error ? err.message : err);
} finally {
  await teardown();
}
process.exit(testFailed ? 1 : 0);
