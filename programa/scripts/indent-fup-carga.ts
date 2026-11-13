// Conferência/dry-run/reconciliação da FUP Importação Indent. Casca fina: a regra está em src/utils/indentFup*.ts.
// Nesta fase (H1) NADA é gravado no banco: --gravar e --reconciliar --fonte banco são recusados (saída 2).
//
// Uso (cwd = programa/; planilha e relatórios SEMPRE fora do repositório, que é público):
//   node node_modules/ts-node/dist/bin.js --transpile-only scripts/indent-fup-carga.ts --conferencia --planilha C:\fora\fup.xlsx --saida C:\fora\relatorio.xlsx [--sem-banco] [--data-referencia AAAA-MM-DD] [--janela-vinculos-meses 24]
//   ... --aplicar --planilha C:\fora\fup.xlsx --de-para C:\fora\relatorio-editado.xlsx --saida C:\fora\dryrun.xlsx [--sem-banco]
//   ... --reconciliar --fonte planilha --planilha C:\fora\fup.xlsx --saida C:\fora\reconciliacao.xlsx
// O stdout só traz contagens, caminhos e OK/FALHA (nunca nomes, preços, comissão nem a DATABASE_URL).
import 'dotenv/config';
import * as path from 'node:path';
import { type Cadastros, CADASTROS_VAZIOS, conferir, reconciliar } from '../src/utils/indentFupConferencia';
import { lerArgumentos, lerCadastrosSomenteLeitura } from '../src/utils/indentFupCli';
import { normalizarLinha } from '../src/utils/indentFupNormalize';
import { lerFupArquivo } from '../src/utils/indentFupParse';
import {
  gravarWorkbook,
  lerDeParaArquivo,
  montarDryRun,
  montarRelatorioConferencia,
  montarRelatorioReconciliacao,
} from '../src/utils/indentFupRelatorio';

function linha(texto: string): void {
  process.stdout.write(`${texto}\n`);
}

async function cadastrosDoBanco(semBanco: boolean): Promise<Cadastros> {
  if (semBanco) return CADASTROS_VAZIOS;
  // Import tardio: com --sem-banco o Prisma nunca é carregado.
  const { prisma } = await import('../src/lib/prisma');
  try {
    return await lerCadastrosSomenteLeitura(prisma);
  } finally {
    await prisma.$disconnect();
  }
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
  if (config.modo === 'aplicar' && config.gravar) {
    process.stderr.write('Gravação indisponível nesta versão (H1: somente conferência e dry-run). Nada foi gravado.\n');
    return 2;
  }
  if (config.modo === 'reconciliar' && config.fonte === 'banco') {
    process.stderr.write('Reconciliação pelo banco indisponível nesta versão (H1). Use --fonte planilha.\n');
    return 2;
  }

  const fup = await lerFupArquivo(config.planilha);
  if (fup.colunasAusentes.length > 0) {
    process.stderr.write(`Planilha fora do formato esperado: ${fup.colunasAusentes.length} coluna(s)/aba obrigatória(s) ausente(s).\n`);
    return 2;
  }
  linha(`Linhas lidas: ${fup.linhas.length}`);
  linha(`Linhas vazias ignoradas: ${fup.linhasVaziasIgnoradas}`);

  if (config.modo === 'reconciliar') {
    if (!fup.dash) {
      process.stderr.write('Aba DASH não encontrada ou fora do formato esperado (nenhum mês reconhecido).\n');
      return 2;
    }
    const rec = reconciliar(fup.linhas.map(normalizarLinha), fup.dash);
    await gravarWorkbook(montarRelatorioReconciliacao(rec), config.saida);
    const divergentes = rec.meses.filter((m) => !m.ok).length + rec.totais.filter((t) => !t.ok).length;
    linha(`Anos no DASH: ${fup.dash.anos.join(', ')}`);
    linha(`Meses comparados: ${rec.meses.length}; divergentes (tolerância ${rec.tolerancia}): ${divergentes}`);
    linha(`Meses/totais com DASH desatualizado (zerado onde a planilha tem movimento): ${rec.desatualizados}`);
    if (rec.mensagem !== null) linha(rec.mensagem);
    linha(`Relatório: ${config.saida}`);
    linha(rec.ok ? 'OK' : 'FALHA');
    return rec.ok ? 0 : 1;
  }

  let dePara: Awaited<ReturnType<typeof lerDeParaArquivo>> | null = null;
  if (config.modo === 'aplicar' && config.deParaArquivo !== null) {
    dePara = await lerDeParaArquivo(config.deParaArquivo);
    if (!dePara.ok) {
      process.stderr.write(`De-para inválido: ${dePara.erro}\n`);
      return 2;
    }
  }
  const cadastros = await cadastrosDoBanco(config.semBanco);
  const conf = conferir({
    linhas: fup.linhas,
    dash: fup.dash,
    cadastros,
    dePara: dePara && dePara.ok ? dePara.entradas : [],
    dataReferencia: config.dataReferencia,
    janelaMeses: config.janelaVinculosMeses,
  });
  const wb =
    config.modo === 'conferencia' ? montarRelatorioConferencia(conf, fup.perfil) : montarDryRun(conf);
  await gravarWorkbook(wb, config.saida);

  const r = conf.resumo;
  const p = conf.plano;
  linha(config.modo === 'aplicar' ? 'DRY-RUN: nada foi gravado.' : 'Conferência (somente leitura).');
  linha(`Linhas aceitas: ${r.linhasAceitas}; rejeitadas: ${r.linhasRejeitadas}`);
  linha(`Fornecedores: ${r.fornecedoresTextos} textos -> ${r.fornecedoresDepois} (criar ${p.fornecedores.criar}, usar ${p.fornecedores.usar})`);
  linha(`Clientes: ${r.clientesTextos} textos -> ${r.clientesDepois} (criar ${p.clientes.criar}, usar ${p.clientes.usar})`);
  linha(`Produtos: ${r.produtosTextos} textos -> ${r.produtosDepois} (criar ${p.produtos.criar}, usar ${p.produtos.usar})`);
  linha(`Produtos com mais de um NCM: ${r.produtosNcmMultiplo}`);
  linha(`Grupos de quase-duplicidade: ${r.quaseDuplicidades}`);
  linha(`Pedidos: ${p.historico.pedidos}; linhas a carregar: ${p.historico.linhas}`);
  linha(`Janela de vínculos: ${conf.janela.months} meses, de ${conf.janela.start} a ${conf.janela.end}`);
  linha(`Vínculos fornecedor-produto: entram ${p.vinculos.entram}; já existem ${p.vinculos.jaExistem}; fora da janela ${p.vinculos.foraDaJanela}`);
  const motivos = Object.values(p.rejeicoesPorMotivo).reduce((a, b) => a + b, 0);
  linha(`Rejeições (motivos): ${motivos}; alertas: ${conf.alertas.length}`);
  if (conf.reconciliacao) {
    const divergentes = conf.reconciliacao.meses.filter((m) => !m.ok).length;
    linha(`Reconciliação DASH: ${conf.reconciliacao.ok ? 'OK' : 'FALHA'} (${divergentes} mês(es) divergente(s), ${conf.reconciliacao.desatualizados} com DASH desatualizado)`);
    if (conf.reconciliacao.mensagem !== null) linha(conf.reconciliacao.mensagem);
  } else {
    linha('Reconciliação DASH: indisponível (aba ausente ou fora do formato esperado)');
  }
  linha(`Relatório: ${config.saida}`);
  linha('OK');
  return 0;
}

// Erro inesperado: só o tipo e o código (nunca `message`/`stack`, que podem trazer caminho, nome ou valor da planilha).
function descreverErro(erro: unknown): string {
  const nome = erro instanceof Error ? erro.name : typeof erro;
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === 'string' && /^[A-Z0-9_]{1,40}$/.test(codigo) ? `${nome} ${codigo}` : nome;
}

main()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro: unknown) => {
    process.stderr.write(`Erro inesperado (${descreverErro(erro)}).\n`);
    process.exitCode = 1;
  });
