// Produtos NOVOS do Forecast com vinculo ao catalogo (irmao do backfill). Casca fina: toda a regra esta em
// src/utils/forecastProdutosNovos.ts e src/services/CatalogItemForecastLinkService.ts.
//
// Uso (cwd = programa/; arquivos SEMPRE fora do repositorio, que e publico; nunca sobrescreve arquivo existente):
//   1) fontes do Forecast (SOMENTE LEITURA), para escrever o NOME da fonte na planilha:
//      node node_modules/ts-node/dist/bin.js --transpile-only scripts/forecast-produtos-novos.ts --fontes --saida C:\fora-do-repo\fontes.csv
//   2) modelo da planilha de produtos novos (SOMENTE LEITURA):
//      node node_modules/ts-node/dist/bin.js --transpile-only scripts/forecast-produtos-novos.ts --modelo --saida C:\fora-do-repo\produtos-novos.csv
// O stdout so traz contagens (nunca nomes, codigos nem a DATABASE_URL).
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { gerarModeloProdutosNovos, listarFontesParaPlanilha } from '../src/services/CatalogItemForecastLinkService';
import {
  fontesParaCsv,
  lerArgumentosProdutosNovos,
  modeloParaCsv,
  resumoDeLeituraSomente,
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

  process.stderr.write('O modo --criar ainda nao esta disponivel.\n');
  return 2;
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
