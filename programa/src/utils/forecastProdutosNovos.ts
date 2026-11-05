// Planilha de produtos NOVOS do Forecast (criacao em lote com vinculo ao catalogo): funcoes PURAS.
// Gera o modelo a partir dos orfaos sem sugestao do backfill, le/valida a planilha preenchida pelo humano e valida
// os argumentos do script. Nada aqui usa banco, rede ou o console: o service e a casca do script fazem o IO.
import * as path from 'node:path';
import { forecastProductCreateSchema } from '../validators/forecast';
import {
  bancoDaUrl,
  celula,
  dentroDoRepo,
  inteiroPositivo,
  lerRegistros,
  nomeBase,
  type ErroArgumentos,
  type LinhaProposta,
} from './forecastCatalogoBackfill';
import { normalizeProductName } from './forecastWorkbook';

/** Colunas do modelo gerado por `--modelo`. A planilha real pode ter outras: sao lidas por NOME e as extras ignoradas. */
export const COLUNAS_PLANILHA = [
  'produtoNovo',
  'codigos',
  'embalagens',
  'familia',
  'catalogItemIds',
  'fonte',
  'leadTimeDias',
  'observacao',
  'criar',
] as const;

/** Colunas que `--criar` exige no cabecalho (as demais, como `embalagens` e `observacao`, sao informativas). */
export const COLUNAS_OBRIGATORIAS_CRIAR = [
  'produtoNovo',
  'codigos',
  'familia',
  'catalogItemIds',
  'fonte',
  'leadTimeDias',
  'criar',
] as const;

export const SEPARADOR_LISTA = ' | ';

/** Espelha `lerLeadTime` de web/src/pages/Forecast/forecastPendentes.ts (inteiro de 1 a 999 dias). */
export const LEAD_TIME_MAX_DIAS = 999;

const BOM = '﻿';

export type StatusProdutoNovo = 'aplicado' | 'ja_aplicado' | 'conflito' | 'item_mudou' | 'erro' | 'ignorado';

export type MotivoProdutoNovo =
  | 'nao_aprovado'
  | 'nome_invalido'
  | 'codigos_invalidos'
  | 'codigos_mais_de_7'
  | 'colunas_desalinhadas'
  | 'catalog_item_id_invalido'
  | 'fonte_vazia'
  | 'lead_time_invalido'
  | 'duplicado_no_arquivo'
  | 'lead_time_divergente_no_arquivo'
  | 'fonte_inexistente'
  | 'fonte_ambigua'
  | 'fonte_inativa'
  | 'lead_time_ausente'
  | 'lead_time_divergente'
  | 'familia_inexistente'
  | 'familia_ambigua'
  | 'familia_inativa'
  | 'familia_ausente'
  | 'item_inexistente'
  | 'item_inativo'
  | 'codigo_do_item_mudou'
  | 'produto_ja_existe'
  | 'produto_inativo'
  | 'codigo_em_outro_produto'
  | 'codigo_ligado_a_outro_item'
  | 'codigo_em_mais_de_um_item'
  | 'cadastro_ocupado'
  | 'rejeitado_pelo_cadastro';

// ---------- nomes ----------

/** Chave de comparacao por nome: sem acento, maiusculas, espacos colapsados. */
export function chaveDeNome(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export type ResolucaoPorNome<T> = { tipo: 'unico'; item: T } | { tipo: 'nenhum' } | { tipo: 'ambiguo' };

/** Exatamente 1 candidato com a mesma chave = ok; 0 = nenhum; 2+ = ambiguo (nunca escolhe "a primeira"). */
export function resolverPorNome<T extends { nome: string }>(lista: readonly T[], nome: string): ResolucaoPorNome<T> {
  const chave = chaveDeNome(nome);
  const achados = lista.filter((item) => chaveDeNome(item.nome) === chave);
  if (achados.length === 1) return { tipo: 'unico', item: achados[0] };
  return achados.length === 0 ? { tipo: 'nenhum' } : { tipo: 'ambiguo' };
}

// ---------- celulas ----------

/** `A | B | C` -> ['A','B','C']. Celula vazia -> []. Parte vazia (ex.: `A |  | C`) -> null (invalida). */
export function lerListaDaCelula(texto: string): string[] | null {
  if (texto.trim() === '') return [];
  const partes = texto.split('|').map((parte) => parte.trim());
  return partes.some((parte) => parte === '') ? null : partes;
}

export type LeituraLeadTime = { ok: true; valor: number | null } | { ok: false };

/** Vazio = sem valor; senao inteiro de 1 a 999. */
export function lerLeadTimeDias(texto: string): LeituraLeadTime {
  const limpo = texto.trim();
  if (limpo === '') return { ok: true, valor: null };
  if (!/^\d{1,3}$/.test(limpo)) return { ok: false };
  const valor = Number(limpo);
  return valor >= 1 && valor <= LEAD_TIME_MAX_DIAS ? { ok: true, valor } : { ok: false };
}

// ---------- leitura da planilha ----------

export interface LinhaProdutoNovo {
  /** Numero do registro no arquivo (cabecalho = 1). */
  linha: number;
  nome: string;
  codigos: string[];
  catalogItemIds: number[];
  fonte: string;
  chaveFonte: string;
  familia: string;
  leadTimeDias: number | null;
  /** Lead time da fonte conforme o ARQUIVO: o valor informado por alguma linha pronta da mesma fonte. */
  leadTimeDaFonteNoArquivo: number | null;
}

export type LinhaLida =
  | { linha: number; status: 'ignorado'; motivo: 'nao_aprovado' }
  | { linha: number; status: 'erro'; motivo: MotivoProdutoNovo }
  | { linha: number; status: 'pronta'; dados: LinhaProdutoNovo };

export type LeituraPlanilha = { ok: true; linhas: LinhaLida[] } | { ok: false; erros: string[] };

const MENSAGEM_SEM_CRIAR = 'Coluna criar ausente: acrescente a coluna criar e escreva sim nas linhas a criar.';

const schemaNomeCodigos = forecastProductCreateSchema.pick({ nome: true, codigos: true });

type ValidacaoLinha = { ok: true; dados: Omit<LinhaProdutoNovo, 'linha' | 'leadTimeDaFonteNoArquivo'> } | { ok: false; motivo: MotivoProdutoNovo };

function validarLinha(valores: {
  nome: string;
  codigos: string;
  catalogItemIds: string;
  familia: string;
  fonte: string;
  leadTimeDias: string;
}): ValidacaoLinha {
  const idsLidos = lerListaDaCelula(valores.catalogItemIds);
  const ids = idsLidos?.map((parte) => inteiroPositivo(parte)) ?? [];
  if (idsLidos === null || ids.some((id) => id === null)) return { ok: false, motivo: 'catalog_item_id_invalido' };
  const catalogItemIds = ids as number[];

  const codigosLidos = lerListaDaCelula(valores.codigos);
  const parse = schemaNomeCodigos.safeParse({ nome: valores.nome, codigos: codigosLidos ?? [''] });
  if (!parse.success) {
    const issues = parse.error.issues;
    if (issues.some((i) => i.path[0] === 'nome')) return { ok: false, motivo: 'nome_invalido' };
    if (issues.some((i) => i.path[0] === 'codigos' && i.code === 'too_big' && i.path.length === 1)) {
      return { ok: false, motivo: 'codigos_mais_de_7' };
    }
    return { ok: false, motivo: 'codigos_invalidos' };
  }
  const { nome, codigos } = parse.data;
  if (codigos.length !== catalogItemIds.length) return { ok: false, motivo: 'colunas_desalinhadas' };

  const fonte = valores.fonte.trim();
  if (fonte === '') return { ok: false, motivo: 'fonte_vazia' };
  const leadTime = lerLeadTimeDias(valores.leadTimeDias);
  if (!leadTime.ok) return { ok: false, motivo: 'lead_time_invalido' };

  return {
    ok: true,
    dados: {
      nome,
      codigos,
      catalogItemIds,
      fonte,
      chaveFonte: chaveDeNome(fonte),
      familia: valores.familia.trim(),
      leadTimeDias: leadTime.valor,
    },
  };
}

function chavesDuplicadas(prontas: readonly LinhaProdutoNovo[]): Set<number> {
  const marcadas = new Set<number>();
  const marcar = (chaveDe: (l: LinhaProdutoNovo) => string[]) => {
    const porChave = new Map<string, number[]>();
    for (const l of prontas) {
      for (const chave of new Set(chaveDe(l))) porChave.set(chave, [...(porChave.get(chave) ?? []), l.linha]);
    }
    for (const linhas of porChave.values()) if (linhas.length > 1) linhas.forEach((n) => marcadas.add(n));
  };
  marcar((l) => [normalizeProductName(l.nome)]);
  marcar((l) => l.codigos);
  marcar((l) => l.catalogItemIds.map(String));
  return marcadas;
}

/**
 * Le a planilha preenchida. So `criar` = `sim` (sem caixa e sem espacos) aprova a linha; o resto e `ignorado`.
 * Colunas lidas por NOME do cabecalho (qualquer ordem); colunas desconhecidas sao ignoradas. `embalagens` e
 * `observacao` nunca sao lidas. Arquivo sem a coluna `criar` e recusado (nunca "tudo aprovado" por omissao).
 * Os erros de leitura trazem so numero de linha e nome de coluna, nunca valor de celula.
 */
export function lerPlanilhaProdutosNovos(texto: string): LeituraPlanilha {
  if (texto.includes('�')) return { ok: false, erros: ['Salve a planilha como CSV UTF-8.'] };
  const registros = lerRegistros(texto);
  if (registros.length === 0) return { ok: false, erros: ['Arquivo vazio.'] };

  const cabecalho = registros[0].map((c) => c.trim());
  const indice = (nome: string) => cabecalho.indexOf(nome);
  const erros: string[] = [];
  if (indice('criar') === -1) erros.push(MENSAGEM_SEM_CRIAR);
  const faltando = COLUNAS_OBRIGATORIAS_CRIAR.filter((c) => c !== 'criar' && indice(c) === -1);
  if (faltando.length > 0) erros.push(`Colunas ausentes no cabecalho: ${faltando.join(', ')}.`);
  if (erros.length > 0) return { ok: false, erros };

  const valorDa = (registro: string[], coluna: string) => registro[indice(coluna)] ?? '';
  const lidas: LinhaLida[] = [];
  const prontas: LinhaProdutoNovo[] = [];
  registros.slice(1).forEach((registro, i) => {
    const linha = i + 2;
    if (valorDa(registro, 'criar').trim().toLowerCase() !== 'sim') {
      lidas.push({ linha, status: 'ignorado', motivo: 'nao_aprovado' });
      return;
    }
    const validada = validarLinha({
      nome: valorDa(registro, 'produtoNovo'),
      codigos: valorDa(registro, 'codigos'),
      catalogItemIds: valorDa(registro, 'catalogItemIds'),
      familia: valorDa(registro, 'familia'),
      fonte: valorDa(registro, 'fonte'),
      leadTimeDias: valorDa(registro, 'leadTimeDias'),
    });
    if (!validada.ok) {
      lidas.push({ linha, status: 'erro', motivo: validada.motivo });
      return;
    }
    const dados: LinhaProdutoNovo = { linha, ...validada.dados, leadTimeDaFonteNoArquivo: null };
    prontas.push(dados);
    lidas.push({ linha, status: 'pronta', dados });
  });

  // Validacao ENTRE as linhas aprovadas e prontas.
  const duplicadas = chavesDuplicadas(prontas);
  const restantes = prontas.filter((l) => !duplicadas.has(l.linha));
  const valoresPorFonte = new Map<string, Set<number>>();
  for (const l of restantes) {
    if (l.leadTimeDias === null) continue;
    const valores = valoresPorFonte.get(l.chaveFonte) ?? new Set<number>();
    valores.add(l.leadTimeDias);
    valoresPorFonte.set(l.chaveFonte, valores);
  }

  const linhas = lidas.map((l): LinhaLida => {
    if (l.status !== 'pronta') return l;
    if (duplicadas.has(l.linha)) return { linha: l.linha, status: 'erro', motivo: 'duplicado_no_arquivo' };
    const valores = valoresPorFonte.get(l.dados.chaveFonte);
    if (valores && valores.size > 1) {
      return { linha: l.linha, status: 'erro', motivo: 'lead_time_divergente_no_arquivo' };
    }
    const doArquivo = valores ? [...valores][0] : null;
    return { linha: l.linha, status: 'pronta', dados: { ...l.dados, leadTimeDaFonteNoArquivo: doArquivo } };
  });
  return { ok: true, linhas };
}

// ---------- modelo (planilha de produtos novos) ----------

export interface LinhaModelo {
  produtoNovo: string;
  codigos: string[];
  embalagens: string[];
  familia: string;
  catalogItemIds: number[];
  fonte: '';
  leadTimeDias: '';
  observacao: string;
  criar: '';
}

function embalagemDoNome(nomeComercial: string): string {
  const limpo = nomeComercial.replace(/\s+/g, ' ').trim();
  const corte = limpo.indexOf(' - ');
  return corte === -1 ? '' : limpo.slice(corte + 3).trim();
}

/**
 * Orfaos `sem_sugestao` da proposta do backfill (nenhum produto parecido no Forecast), agrupados por `nomeBase`
 * (a MESMA funcao do backfill). Cada grupo e um produto novo candidato: codigos e ids na ordem do nome comercial.
 */
export function agruparProdutosNovos(proposta: readonly LinhaProposta[]): LinhaModelo[] {
  const grupos = new Map<string, LinhaProposta[]>();
  for (const linha of proposta) {
    if (linha.confianca !== 'sem_sugestao') continue;
    const base = nomeBase(linha.nomeComercial);
    if (base === '') continue;
    grupos.set(base, [...(grupos.get(base) ?? []), linha]);
  }

  return [...grupos]
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([base, itens]): LinhaModelo => {
      const ordenados = [...itens].sort(
        (a, b) => a.nomeComercial.localeCompare(b.nomeComercial, 'pt-BR') || a.catalogItemId - b.catalogItemId,
      );
      const familias = new Set(ordenados.map((i) => i.familiaItem ?? ''));
      const familiasDiferentes = familias.size > 1;
      const embalagens = ordenados.map((i) => embalagemDoNome(i.nomeComercial));
      const observacoes: string[] = [];
      if (familiasDiferentes) observacoes.push('familias diferentes no grupo');
      if (ordenados.length > 7) observacoes.push('mais de 7 codigos: divida em produtos');
      return {
        produtoNovo: base,
        codigos: ordenados.map((i) => i.codigo),
        embalagens: embalagens.every((e) => e === '') ? [] : embalagens,
        familia: familiasDiferentes ? '' : [...familias][0],
        catalogItemIds: ordenados.map((i) => i.catalogItemId),
        fonte: '',
        leadTimeDias: '',
        observacao: observacoes.join('; '),
        criar: '',
      };
    });
}

function paraCsvDe(colunas: readonly string[], linhas: readonly string[][]): string {
  const corpo = [colunas.join(';'), ...linhas.map((l) => l.map(celula).join(';'))];
  return `${BOM}${corpo.join('\r\n')}\r\n`;
}

/** CSV para o Excel pt-BR (BOM UTF-8, `;`, CRLF). `fonte`, `leadTimeDias` e `criar` saem vazios para o humano. */
export function modeloParaCsv(linhas: readonly LinhaModelo[]): string {
  return paraCsvDe(
    COLUNAS_PLANILHA,
    linhas.map((l) => [
      l.produtoNovo,
      l.codigos.join(SEPARADOR_LISTA),
      l.embalagens.join(SEPARADOR_LISTA),
      l.familia,
      l.catalogItemIds.join(SEPARADOR_LISTA),
      l.fonte,
      l.leadTimeDias,
      l.observacao,
      l.criar,
    ]),
  );
}

export interface FontePlanilha {
  id: number;
  nome: string;
  leadTimeDays: number | null;
  ativa: boolean;
}

/** CSV de consulta das fontes: `id;nome;leadTimeDias;ativa` (`sim`/`nao`). */
export function fontesParaCsv(fontes: readonly FontePlanilha[]): string {
  return paraCsvDe(
    ['id', 'nome', 'leadTimeDias', 'ativa'],
    fontes.map((f) => [String(f.id), f.nome, f.leadTimeDays === null ? '' : String(f.leadTimeDays), f.ativa ? 'sim' : 'nao']),
  );
}

// ---------- relatorio da criacao em lote ----------

export const STATUS_PRODUTO_NOVO = ['aplicado', 'ja_aplicado', 'conflito', 'item_mudou', 'erro', 'ignorado'] as const;

export interface ResultadoProdutoNovo {
  linha: number;
  status: StatusProdutoNovo;
  motivo: MotivoProdutoNovo | null;
  produtoId: number | null;
}

export interface RelatorioProdutosNovos {
  gravar: boolean;
  resultados: ResultadoProdutoNovo[];
  contagem: Record<StatusProdutoNovo, number>;
}

/** Contagem com os 6 status (zeros inclusive). */
export function contarResultados(resultados: readonly ResultadoProdutoNovo[]): Record<StatusProdutoNovo, number> {
  const contagem: Record<StatusProdutoNovo, number> = {
    aplicado: 0,
    ja_aplicado: 0,
    conflito: 0,
    item_mudou: 0,
    erro: 0,
    ignorado: 0,
  };
  for (const r of resultados) contagem[r.status] += 1;
  return contagem;
}

/** CSV do relatorio (fora do repo): `linha;status;motivo;produtoId`. O motivo e um codigo fixo, nunca texto livre. */
export function relatorioParaCsv(resultados: readonly ResultadoProdutoNovo[]): string {
  return paraCsvDe(
    ['linha', 'status', 'motivo', 'produtoId'],
    resultados.map((r) => [String(r.linha), r.status, r.motivo ?? '', r.produtoId === null ? '' : String(r.produtoId)]),
  );
}

/**
 * Linhas do stdout: SO contagens e `linha N: <status>` das linhas com problema. Nunca nome, codigo, fonte, familia,
 * motivo, mensagem do servidor nem DATABASE_URL (o motivo vai so para o arquivo `--relatorio`).
 */
export function resumoDoRelatorio(relatorio: RelatorioProdutosNovos): string[] {
  const saida = [
    relatorio.gravar ? 'GRAVADO.' : 'DRY-RUN: nada foi gravado.',
    `Linhas lidas: ${relatorio.resultados.length}`,
    ...STATUS_PRODUTO_NOVO.map((status) => `  ${status}: ${relatorio.contagem[status]}`),
  ];
  for (const r of relatorio.resultados) {
    if (r.status === 'conflito' || r.status === 'item_mudou' || r.status === 'erro') saida.push(`  linha ${r.linha}: ${r.status}`);
  }
  return saida;
}

/** Exit code (D15): 0 = nada de `conflito`/`item_mudou`/`erro`; 1 = algum deles. */
export function codigoDeSaida(relatorio: RelatorioProdutosNovos): 0 | 1 {
  const { conflito, item_mudou: itemMudou, erro } = relatorio.contagem;
  return conflito + itemMudou + erro > 0 ? 1 : 0;
}

/**
 * Erro inesperado (que nao e HttpError) no meio do lote: as linhas ja gravadas ficam. Carrega SO o numero delas,
 * para o script informar; a causa original fica em `cause` e nunca e impressa (pode ter nome ou codigo).
 */
export class LoteInterrompido extends Error {
  readonly linhasGravadas: number;
  readonly cause: unknown;

  constructor(linhasGravadas: number, causa: unknown) {
    super(causa instanceof Error ? causa.message : 'erro inesperado');
    this.name = 'LoteInterrompido';
    this.linhasGravadas = linhasGravadas;
    this.cause = causa;
  }
}

/** Unica linha impressa quando o lote e interrompido: so um inteiro (nunca nome, codigo nem mensagem). */
export function resumoDeLoteInterrompido(linhasGravadas: number): string {
  const n = Number.isInteger(linhasGravadas) && linhasGravadas > 0 ? linhasGravadas : 0;
  return `Linhas gravadas ate o erro: ${n}`;
}

export function resumoDeLeituraSomente(modo: 'fontes', total: number): string;
export function resumoDeLeituraSomente(modo: 'modelo', total: number, itens: number): string;
export function resumoDeLeituraSomente(modo: 'fontes' | 'modelo', total: number, itens = 0): string {
  return modo === 'fontes'
    ? `Fontes exportadas (somente leitura): ${total}.`
    : `Modelo gerado (somente leitura): ${total} produtos novos, ${itens} itens.`;
}

// ---------- argumentos do script ----------

export type ConfigProdutosNovos =
  | { ok: true; modo: 'fontes'; saida: string }
  | { ok: true; modo: 'modelo'; saida: string }
  | { ok: true; modo: 'criar'; entrada: string; relatorio: string | null; gravar: boolean };

/**
 * Valida os argumentos do script.
 *   --fontes --saida <arq.csv>
 *   --modelo --saida <arq.csv>
 *   --criar --entrada <arq.csv> [--relatorio <arq.csv>] [--gravar --confirmo-banco <host:porta/banco>]
 * Sem `--gravar` e DRY-RUN. `--gravar` exige `--confirmo-banco` igual a `host + pathname` da DATABASE_URL.
 * Arquivos DENTRO do repo sao recusados (dado real nunca entra no repositorio publico) e `--saida`/`--relatorio`
 * nunca sobrescrevem um arquivo que ja existe (protege a planilha preenchida a mao).
 */
export function lerArgumentosProdutosNovos(
  argv: readonly string[],
  ctx: { raizRepo: string; databaseUrl: string; existe: (caminho: string) => boolean },
): ConfigProdutosNovos | ErroArgumentos {
  const falha = (erro: string): ErroArgumentos => ({ ok: false, erro, codigo: 2 });
  const comValor = new Set(['--saida', '--entrada', '--relatorio', '--confirmo-banco']);
  const flags = new Set(['--fontes', '--modelo', '--criar', '--gravar']);
  const valores = new Map<string, string>();
  const marcados = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (flags.has(arg)) {
      if (marcados.has(arg)) return falha(`Argumento repetido: ${arg}.`);
      marcados.add(arg);
    } else if (comValor.has(arg)) {
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith('--')) return falha(`Falta o valor de ${arg}.`);
      if (valores.has(arg)) return falha(`Argumento repetido: ${arg}.`);
      valores.set(arg, valor);
      i += 1;
    } else {
      return falha(`Argumento desconhecido: ${arg}.`);
    }
  }

  const modos = ['--fontes', '--modelo', '--criar'].filter((m) => marcados.has(m));
  if (modos.length > 1) return falha('Escolha so um modo: --fontes, --modelo ou --criar.');
  if (modos.length === 0) return falha('Informe o modo: --fontes, --modelo ou --criar.');

  const arquivoCsv = (rotulo: '--saida' | '--entrada' | '--relatorio', caminho: string, novo: boolean): string | null => {
    if (path.extname(caminho).toLowerCase() !== '.csv') return `${rotulo} deve terminar em .csv.`;
    if (dentroDoRepo(caminho, ctx.raizRepo)) {
      return `${rotulo} esta dentro do repositorio: use um arquivo fora dele (o repositorio e publico).`;
    }
    if (novo && ctx.existe(caminho)) return `${rotulo} ja existe: nao sobrescrevo. Escolha outro nome.`;
    return null;
  };

  if (modos[0] !== '--criar') {
    const modo = modos[0];
    if (marcados.has('--gravar') || valores.has('--entrada') || valores.has('--confirmo-banco') || valores.has('--relatorio')) {
      return falha(`${modo} e somente leitura: nao aceita --gravar, --entrada, --relatorio nem --confirmo-banco.`);
    }
    const saida = valores.get('--saida');
    if (!saida) return falha('Informe --saida <arquivo.csv>.');
    const problema = arquivoCsv('--saida', saida, true);
    if (problema) return falha(problema);
    return { ok: true, modo: modo === '--fontes' ? 'fontes' : 'modelo', saida };
  }

  if (valores.has('--saida')) return falha('--criar nao aceita --saida.');
  const entrada = valores.get('--entrada');
  if (!entrada) return falha('Informe --entrada <arquivo.csv>.');
  const problemaEntrada = arquivoCsv('--entrada', entrada, false);
  if (problemaEntrada) return falha(problemaEntrada);

  const relatorio = valores.get('--relatorio') ?? null;
  if (relatorio !== null) {
    const problemaRelatorio = arquivoCsv('--relatorio', relatorio, true);
    if (problemaRelatorio) return falha(problemaRelatorio);
    if (path.resolve(relatorio) === path.resolve(entrada)) return falha('--relatorio deve ser diferente de --entrada.');
  }

  const gravar = marcados.has('--gravar');
  if (gravar) {
    const confirmado = valores.get('--confirmo-banco');
    const banco = bancoDaUrl(ctx.databaseUrl);
    if (!confirmado) return falha('--gravar exige --confirmo-banco <host:porta/banco>.');
    if (banco === '' || confirmado !== banco) {
      return falha('--confirmo-banco nao confere com o banco da DATABASE_URL: nada foi gravado.');
    }
  } else if (valores.has('--confirmo-banco')) {
    return falha('--confirmo-banco so vale junto com --gravar.');
  }
  return { ok: true, modo: 'criar', entrada, relatorio, gravar };
}
