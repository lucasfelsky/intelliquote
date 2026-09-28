// Banco descartavel e SMTP console: nunca usa DATABASE_URL do .env.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

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
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('iq_critical_test');
  await run('node_modules/prisma/build/index.js', ['migrate', 'deploy']);
  await run('node_modules/vitest/vitest.mjs', ['run', 'tests/critical-fixes-db.test.ts', '--maxWorkers=1']);
} finally {
  const stopping = pg.stop();
  if (process.platform === 'win32') {
    // taskkill usado pela biblioteca pode falhar no sandbox; pg_ctl encerra
    // somente o cluster criado acima. A biblioteca limpa seu diretorio ao sair.
    await new Promise((resolve, reject) => {
      const child = spawn(join(cwd, 'node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe'),
        ['-D', dataDir, 'stop', '-m', 'fast', '-W'], { windowsHide: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('exit', resolve);
    });
  }
  await stopping;
}
