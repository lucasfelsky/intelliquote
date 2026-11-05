// Produtos NOVOS do Forecast com vinculo ao catalogo (irmao do backfill). Casca fina: toda a regra esta em
// src/utils/forecastProdutosNovos.ts e src/services/CatalogItemForecastLinkService.ts.
//
// Uso (cwd = programa/; arquivos SEMPRE fora do repositorio, que e publico; nunca sobrescreve arquivo existente):
//   1) fontes do Forecast (SOMENTE LEITURA), para escrever o NOME da fonte na planilha:
//      node node_modules/ts-node/dist/bin.js --transpile-only scripts/forecast-produtos-novos.ts --fontes --saida C:\fora-do-repo\fontes.csv
//   2) modelo da planilha de produtos novos (SOMENTE LEITURA):
//      node node_modules/ts-node/dist/bin.js --transpile-only scripts/forecast-produtos-novos.ts --modelo --saida C:\fora-do-repo\produtos-novos.csv
//   3) preencher a planilha (colunas fonte, leadTimeDias e criar = sim nas linhas aprovadas); salvar como CSV UTF-8;
//   4) dry-run (padrao, nao grava; --relatorio traz o motivo de cada linha):
//      node node_modules/ts-node/dist/bin.js --transpile-only scripts/forecast-produtos-novos.ts --criar --entrada C:\fora-do-repo\produtos-novos.csv --relatorio C:\fora-do-repo\relatorio.csv
//   5) gravar (so apos conferir o dry-run; fora da janela de importacao do Forecast):
//      ... --criar --entrada C:\fora-do-repo\produtos-novos.csv --gravar --confirmo-banco <host:porta/banco>
// Exit: 0 = sem conflito/item_mudou/erro; 1 = algum deles ou erro inesperado; 2 = argumentos, cabecalho ou encoding.
// Idempotente: rodar de novo devolve ja_aplicado. O stdout so traz contagens (nunca nomes, codigos nem a DATABASE_URL).
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prisma } from '../src/lib/prisma';
import {
  criarProdutosNovos,
  gerarModeloProdutosNovos,
  listarFontesParaPlanilha,
} from '../src/services/CatalogItemForecastLinkService';
import {
  codigoDeSaida,
  fontesParaCsv,
  lerArgumentosProdutosNovos,
  lerPlanilhaProdutosNovos,
  modeloParaCsv,
  relatorioParaCsv,
  resumoDeLeituraSomente,
  resumoDoRelatorio,
} from '../src/utils/forecastProdutosNovos';

function linha(texto: string): void {
  process.stdout.write(`${texto}\n`);
}

// 'wx': nao sobrescreve o arquivo nem em corrida (a planilha preenchida a mao e do humano).
function gravarNovo(caminho: string, conteudo: string): void {
  fs.writeFileSync(caminho, conteudo, { encoding: 'utf8', flag: 'wx' });
}

async function main(): Promise<number> {
  const config = lerArgumentosProdutosNovos(process.argv.slice(2), {
    raizRepo: path.resolve(__dirname, '..', '..'),
    databaseUrl: process.env.DATABASE_URL ?? '',
    existe: fs.existsSync,
  });
  if (!config.ok) {
    process.stderr.write(`${config.erro}\n`);
    return config.codigo;
  }

  if (config.modo === 'fontes') {
    const fontes = await listarFontesParaPlanilha();
    gravarNovo(config.saida, fontesParaCsv(fontes));
    linha(resumoDeLeituraSomente('fontes', fontes.length));
    return 0;
  }

  if (config.modo === 'modelo') {
    const modelo = await gerarModeloProdutosNovos();
    gravarNovo(config.saida, modeloParaCsv(modelo));
    linha(resumoDeLeituraSomente('modelo', modelo.length, modelo.reduce((soma, m) => soma + m.codigos.length, 0)));
    return 0;
  }

  // Os erros de leitura so trazem numero de linha e nome de COLUNA (nunca valor de celula).
  const leitura = lerPlanilhaProdutosNovos(fs.readFileSync(config.entrada, 'utf8'));
  if (!leitura.ok) {
    for (const erro of leitura.erros) process.stderr.write(`${erro}\n`);
    return 2;
  }
  const relatorio = await criarProdutosNovos(leitura.linhas, { gravar: config.gravar });
  for (const texto of resumoDoRelatorio(relatorio)) linha(texto);
  if (config.relatorio !== null) gravarNovo(config.relatorio, relatorioParaCsv(relatorio.resultados));
  return codigoDeSaida(relatorio);
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
