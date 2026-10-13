// node term-repro.cjs <delayMs> : cria PrismaClient numa worker thread e a encerra apos delayMs.
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const delay = Number(process.argv[2]);
const root = process.cwd();
const w = new Worker(`
  const { PrismaClient } = require(${JSON.stringify(path.join(root, 'node_modules/@prisma/client'))});
  new PrismaClient();
  setInterval(() => {}, 1000);
`, { eval: true });
setTimeout(() => { w.terminate().then(() => process.exit(0)); }, delay);
