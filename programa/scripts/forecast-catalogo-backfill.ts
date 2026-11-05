// Backfill do vinculo Catalogo -> Forecast (itens ativos com codigo DBCorp fora do Forecast). Casca fina: toda a
// regra esta em src/utils/forecastCatalogoBackfill.ts e src/services/CatalogItemForecastLinkService.ts.
//
// Uso (cwd = programa/; arquivos SEMPRE fora do repositorio, que e publico):
//   1) proposta SOMENTE LEITURA (transacao READ ONLY):
//      node node_modules/ts-node/dist/bin.js --transpile-only scripts/forecast-catalogo-backfill.ts --proposta --saida C:\fora-do-repo\proposta.csv
//   2) revisar o CSV e escrever `sim` na coluna `aprovado` das linhas aceitas (produtoSugeridoId e editavel);
//   3) dry-run (padrao, nao grava):
//      node node_modules/ts-node/dist/bin.js --transpile-only scripts/forecast-catalogo-backfill.ts --aplicar --entrada C:\fora-do-repo\proposta.csv
//   4) gravar (so apos conferir o dry-run; fora da janela de importacao do Forecast):
//      ... --aplicar --entrada C:\fora-do-repo\proposta.csv --gravar --confirmo-banco <host:porta/banco>
// O stdout so traz contagens (nunca nomes, codigos nem a DATABASE_URL). Idempotente: rodar de novo devolve ja_aplicado.
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { aplicarBackfill, gerarPropostaBackfill } from '../src/services/CatalogItemForecastLinkService';
import { lerArgumentos, lerCsvAprovado, paraCsv, paraJson } from '../src/utils/forecastCatalogoBackfill';

function linha(texto: string): void {
  process.stdout.write(`${texto}\n`);
}

async function main(): Promise<number> {
  const config = lerArgumentos(process.argv.slice(2), {
    raizRepo: path.resolve(__dirname, '..', '..'),
    databaseUrl: process.env.DATABASE_URL ?? '',
  });
  if (!config.ok) {
    process.stderr.write(`${config.erro}\n`);
    return config.codigo;
  }

  if (config.modo === 'proposta') {
    const linhas = await gerarPropostaBackfill();
    fs.writeFileSync(config.saida, config.formato === 'json' ? paraJson(linhas) : paraCsv(linhas), 'utf8');
    const porConfianca = new Map<string, number>();
    for (const l of linhas) porConfianca.set(l.confianca, (porConfianca.get(l.confianca) ?? 0) + 1);
    linha(`Proposta gerada (somente leitura): ${linhas.length} itens.`);
    for (const [confianca, n] of [...porConfianca].sort()) linha(`  ${confianca}: ${n}`);
    return 0;
  }

  const leitura = lerCsvAprovado(fs.readFileSync(config.entrada, 'utf8'));
  if (!leitura.ok) {
    for (const erro of leitura.erros) process.stderr.write(`${erro}\n`);
    return 2;
  }
  const relatorio = await aplicarBackfill(leitura.linhas, { gravar: config.gravar });
  linha(config.gravar ? 'Aplicacao GRAVADA.' : 'DRY-RUN: nada foi gravado.');
  linha(`Linhas aprovadas lidas: ${leitura.linhas.length}`);
  for (const [status, n] of Object.entries(relatorio.contagem)) linha(`  ${status}: ${n}`);
  // Detalhe por linha so com o numero da linha do CSV e o status (sem nome, codigo nem mensagem do servidor).
  for (const r of relatorio.resultados.filter((x) => x.status === 'conflito' || x.status === 'erro')) {
    linha(`  linha ${r.linha}: ${r.status}`);
  }
  return relatorio.contagem.erro > 0 || relatorio.contagem.conflito > 0 ? 1 : 0;
}

main()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch(() => {
    process.stderr.write('erro inesperado\n');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
