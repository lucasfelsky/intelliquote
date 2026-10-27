// Backtest do Forecast preditivo (P1b-1; --relatorio p0 reproduz a fase 0, p1 a P1a e p1b a referencia), LOCAL: so escreve em stdout/stderr. Uso (cwd = programa/):
//   node node_modules/ts-node-dev/lib/bin.js --transpile-only --quiet scripts/forecast-preditivo-backtest.ts --entrada <arquivo>
// --quiet e obrigatorio (sem ele o ts-node-dev imprime [INFO] em stdout). Excecao nao capturada deixa o ts-node-dev
// pendurado em modo watch: por isso tudo roda dentro do try/catch, nada e assincrono e nada relanca.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { executarCliRef } from '../src/utils/forecastPreditivoCliRef';

try {
  const r = executarCliRef(process.argv.slice(2), {
    cwd: process.cwd(),
    raizRepo: path.resolve(__dirname, '..', '..'),
    existe: (c) => fs.existsSync(c),
    tamanhoBytes: (c) => fs.statSync(c).size,
    caminhoReal: (c) => fs.realpathSync.native(c),
    lerTexto: (c) => fs.readFileSync(c, 'utf8'),
  });
  if (r.saida !== '') process.stdout.write(r.saida);
  if (r.erro !== '') process.stderr.write(r.erro);
  process.exitCode = r.codigo;
} catch {
  process.stderr.write('erro inesperado\n');
  process.exitCode = 1;
}
