// Backfill do vinculo Catalogo -> Forecast (itens ativos com codigo DBCorp fora do Forecast): funcoes PURAS.
// Gera a PROPOSTA (sugestao + confianca, para revisao humana), le o CSV aprovado e valida os argumentos do script.
// Nada aqui usa banco, rede ou o console: o service e a casca do script fazem o IO.
import * as path from 'node:path';

/** Espelha FORECAST_MAX_CODES_PER_PRODUCT (constants/forecast.ts). */
const MAX_CODIGOS = 7;

export type Confianca = 'alta' | 'media' | 'baixa' | 'sem_sugestao' | 'bloqueada';
export type CriterioSugestao =
  | 'irmao_catalogo'
  | 'irmao_familia_diferente'
  | 'nome_do_produto'
  | 'varios_candidatos'
  | 'nenhum'
  | 'bloqueio';

export interface OrfaoCatalogo {
  catalogItemId: number;
  codigo: string;
  nomeComercial: string;
  familyId: number | null;
  familia: string | null;
}

export interface ProdutoDoForecast {
  id: number;
  nome: string;
  ativo: boolean;
  origem: 'planilha' | 'dbcorp';
  familyId: number | null;
  codigos: Array<{ code: string; catalogItemId: number | null; nomeComercialDoItem: string | null }>;
}

export interface AlternativaProposta {
  produtoId: number;
  nome: string;
}

export interface LinhaProposta {
  codigo: string;
  catalogItemId: number;
  nomeComercial: string;
  familiaItem: string | null;
  produtoSugeridoId: number | null;
  produtoSugeridoNome: string | null;
  produtoAtivo: boolean | null;
  codigosNoProduto: number | null;
  /** Vagas que sobram no produto DEPOIS das sugestoes anteriores e desta (acumulado, na ordem do nome comercial). */
  vagasAposSugestoes: number | null;
  criterio: CriterioSugestao;
  confianca: Confianca;
  motivo: string;
  alternativas: AlternativaProposta[];
  /** Sempre vazio na proposta: o humano escreve `sim` para aprovar a linha. */
  aprovado: '';
}

/** Parte do nome antes do 1o ' - ' (sem acento, maiusculas, espacos colapsados). Sem ' - ' = nome todo. */
export function nomeBase(nome: string): string {
  const limpo = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
  const corte = limpo.indexOf(' - ');
  return (corte === -1 ? limpo : limpo.slice(0, corte)).trim();
}

const normalizarCodigo = (codigo: string): string => codigo.trim().toUpperCase();

function familiaCompativel(a: number | null, b: number | null): boolean {
  return a === null || b === null || a === b;
}

interface Candidato {
  produto: ProdutoDoForecast;
  irmaos: number;
}

function melhorPrimeiro(a: Candidato, b: Candidato): number {
  if (b.irmaos !== a.irmaos) return b.irmaos - a.irmaos;
  if (a.produto.ativo !== b.produto.ativo) return a.produto.ativo ? -1 : 1;
  return a.produto.id - b.produto.id;
}

/**
 * Sugere o produto do Forecast de cada item orfao. Regras, em ordem:
 * 1. codigo em mais de 1 item orfao -> bloqueada;
 * 2. IRMAOS = produtos com algum codigo cujo item tem o mesmo `nomeBase`;
 * 3. NOME = produtos cujo `nomeBase(nome)` comeca com o `nomeBase` do item;
 * 4. 1 irmao ativo e familia compativel -> alta; 1 irmao de outra familia, ou 0 irmao e 1 por NOME -> media;
 *    varios candidatos -> baixa (o de mais irmaos sugerido, os demais em `alternativas`); nenhum -> sem_sugestao;
 * 5. produto inativo -> bloqueada;
 * 6. vagas ACUMULADAS: cada sugestao consome 1 vaga do produto; sem vaga -> bloqueada.
 */
export function sugerirVinculos(orfaos: readonly OrfaoCatalogo[], produtos: readonly ProdutoDoForecast[]): LinhaProposta[] {
  const ordenados = [...orfaos].sort(
    (a, b) => a.nomeComercial.localeCompare(b.nomeComercial, 'pt-BR') || a.catalogItemId - b.catalogItemId,
  );

  const porCodigo = new Map<string, number>();
  for (const o of ordenados) {
    const chave = normalizarCodigo(o.codigo);
    porCodigo.set(chave, (porCodigo.get(chave) ?? 0) + 1);
  }

  const baseDoNomeDoProduto = new Map(produtos.map((p) => [p.id, nomeBase(p.nome)] as const));
  const baseDosItens = new Map(
    produtos.map(
      (p) =>
        [
          p.id,
          p.codigos.map((c) => (c.nomeComercialDoItem ? nomeBase(c.nomeComercialDoItem) : '')).filter((b) => b !== ''),
        ] as const,
    ),
  );
  const usados = new Map(produtos.map((p) => [p.id, p.codigos.length] as const));

  return ordenados.map((orfao): LinhaProposta => {
    const codigo = normalizarCodigo(orfao.codigo);
    const base = nomeBase(orfao.nomeComercial);
    const linha = (parcial: Partial<LinhaProposta> & Pick<LinhaProposta, 'criterio' | 'confianca' | 'motivo'>): LinhaProposta => ({
      codigo,
      catalogItemId: orfao.catalogItemId,
      nomeComercial: orfao.nomeComercial,
      familiaItem: orfao.familia,
      produtoSugeridoId: null,
      produtoSugeridoNome: null,
      produtoAtivo: null,
      codigosNoProduto: null,
      vagasAposSugestoes: null,
      alternativas: [],
      aprovado: '',
      ...parcial,
    });

    if ((porCodigo.get(codigo) ?? 0) > 1) {
      return linha({ criterio: 'bloqueio', confianca: 'bloqueada', motivo: 'codigo em mais de um item do catalogo' });
    }
    if (base === '') return linha({ criterio: 'nenhum', confianca: 'sem_sugestao', motivo: 'item sem nome comercial' });

    const irmaos: Candidato[] = produtos
      .map((produto) => ({
        produto,
        irmaos: (baseDosItens.get(produto.id) ?? []).filter((b) => b === base).length,
      }))
      .filter((c) => c.irmaos > 0)
      .sort(melhorPrimeiro);
    const porNome: Candidato[] = produtos
      .filter((p) => (baseDoNomeDoProduto.get(p.id) ?? '').startsWith(base))
      .map((produto) => ({ produto, irmaos: 0 }))
      .sort(melhorPrimeiro);

    const irmaosAtivos = irmaos.filter((c) => c.produto.ativo);
    const nomeAtivos = porNome.filter((c) => c.produto.ativo);

    let pool: Candidato[];
    let origem: 'irmao' | 'nome';
    if (irmaosAtivos.length > 0) {
      pool = irmaosAtivos;
      origem = 'irmao';
    } else if (irmaos.length > 0) {
      return bloqueadaPorInativo(linha, irmaos[0].produto, irmaos.length > 1 ? irmaos.slice(1) : []);
    } else if (nomeAtivos.length > 0) {
      pool = nomeAtivos;
      origem = 'nome';
    } else if (porNome.length > 0) {
      return bloqueadaPorInativo(linha, porNome[0].produto, porNome.slice(1));
    } else {
      return linha({ criterio: 'nenhum', confianca: 'sem_sugestao', motivo: 'nenhum produto parecido no Forecast' });
    }

    const escolhido = pool[0].produto;
    const alternativas = pool.slice(1).map((c) => ({ produtoId: c.produto.id, nome: c.produto.nome }));
    let confianca: Confianca;
    let criterio: CriterioSugestao;
    let motivo: string;
    if (pool.length > 1) {
      confianca = 'baixa';
      criterio = 'varios_candidatos';
      motivo = `${pool.length} produtos candidatos; sugerido o de mais itens irmaos`;
    } else if (origem === 'irmao') {
      if (familiaCompativel(orfao.familyId, escolhido.familyId)) {
        confianca = 'alta';
        criterio = 'irmao_catalogo';
        motivo = 'outro item do catalogo com o mesmo nome base ja esta neste produto';
      } else {
        confianca = 'media';
        criterio = 'irmao_familia_diferente';
        motivo = 'item irmao no produto, mas a familia do produto e outra';
      }
    } else {
      confianca = 'media';
      criterio = 'nome_do_produto';
      motivo = 'nome do produto comeca com o nome base do item (sem item irmao)';
    }

    const dadosDoProduto = {
      produtoSugeridoId: escolhido.id,
      produtoSugeridoNome: escolhido.nome,
      produtoAtivo: escolhido.ativo,
      codigosNoProduto: escolhido.codigos.length,
      alternativas,
    };
    const ocupadas = usados.get(escolhido.id) ?? escolhido.codigos.length;
    if (ocupadas >= MAX_CODIGOS) {
      return linha({
        ...dadosDoProduto,
        vagasAposSugestoes: 0,
        criterio: 'bloqueio',
        confianca: 'bloqueada',
        motivo: 'produto com 7 codigos',
      });
    }
    usados.set(escolhido.id, ocupadas + 1);
    return linha({
      ...dadosDoProduto,
      vagasAposSugestoes: MAX_CODIGOS - (ocupadas + 1),
      criterio,
      confianca,
      motivo,
    });
  });
}

function bloqueadaPorInativo(
  linha: (parcial: Partial<LinhaProposta> & Pick<LinhaProposta, 'criterio' | 'confianca' | 'motivo'>) => LinhaProposta,
  produto: ProdutoDoForecast,
  outros: Candidato[],
): LinhaProposta {
  return linha({
    produtoSugeridoId: produto.id,
    produtoSugeridoNome: produto.nome,
    produtoAtivo: false,
    codigosNoProduto: produto.codigos.length,
    alternativas: outros.map((c) => ({ produtoId: c.produto.id, nome: c.produto.nome })),
    criterio: 'bloqueio',
    confianca: 'bloqueada',
    motivo: 'produto inativo',
  });
}

// ---------- CSV / JSON ----------

const COLUNAS = [
  'codigo',
  'catalogItemId',
  'nomeComercial',
  'familiaItem',
  'produtoSugeridoId',
  'produtoSugeridoNome',
  'produtoAtivo',
  'codigosNoProduto',
  'vagasAposSugestoes',
  'criterio',
  'confianca',
  'motivo',
  'alternativas',
  'aprovado',
] as const;

function celula(valor: string): string {
  return /[;"\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

function valorDaColuna(linha: LinhaProposta, coluna: (typeof COLUNAS)[number]): string {
  switch (coluna) {
    case 'alternativas':
      return linha.alternativas.map((a) => `${a.produtoId}:${a.nome}`).join(' | ');
    case 'produtoAtivo':
      return linha.produtoAtivo === null ? '' : linha.produtoAtivo ? 'sim' : 'nao';
    default: {
      const v = linha[coluna];
      return v === null || v === undefined ? '' : String(v);
    }
  }
}

/** CSV para o Excel pt-BR: BOM UTF-8, separador `;`, CRLF. A coluna `aprovado` sai vazia. */
export function paraCsv(linhas: readonly LinhaProposta[]): string {
  const corpo = [COLUNAS.join(';'), ...linhas.map((l) => COLUNAS.map((c) => celula(valorDaColuna(l, c))).join(';'))];
  return `﻿${corpo.join('\r\n')}\r\n`;
}

export function paraJson(linhas: readonly LinhaProposta[]): string {
  return `${JSON.stringify(linhas, null, 2)}\n`;
}

/** Quebra o texto CSV (separador `;`, aspas duplas) em registros de celulas. Aceita BOM e CRLF/LF. */
function lerRegistros(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const registros: string[][] = [];
  let atual: string[] = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else aspas = false;
      } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ';') {
      atual.push(campo);
      campo = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && t[i + 1] === '\n') i += 1;
      atual.push(campo);
      campo = '';
      registros.push(atual);
      atual = [];
    } else campo += ch;
  }
  if (campo !== '' || atual.length > 0) {
    atual.push(campo);
    registros.push(atual);
  }
  return registros.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface LinhaAprovada {
  /** Numero do registro no arquivo (cabecalho = 1). */
  linha: number;
  catalogItemId: number;
  codigo: string;
  produtoId: number;
}

export type LeituraAprovados = { ok: true; linhas: LinhaAprovada[] } | { ok: false; erros: string[] };

const inteiroPositivo = (texto: string | undefined): number | null => {
  const limpo = (texto ?? '').trim();
  return /^\d+$/.test(limpo) && Number(limpo) > 0 ? Number(limpo) : null;
};

/**
 * Le o CSV revisado pelo humano. So as linhas com `aprovado` = `sim` (sem caixa) entram; o resto e ignorado.
 * `produtoSugeridoId` e editavel: o que vale e o que esta no arquivo. Linha aprovada sem id valido = erro com o
 * numero da linha (nada e aplicado).
 */
export function lerCsvAprovado(texto: string): LeituraAprovados {
  const registros = lerRegistros(texto);
  if (registros.length === 0) return { ok: false, erros: ['Arquivo vazio.'] };
  const cabecalho = registros[0].map((c) => c.trim());
  const indice = (nome: string) => cabecalho.indexOf(nome);
  const iAprovado = indice('aprovado');
  const iItem = indice('catalogItemId');
  const iCodigo = indice('codigo');
  const iProduto = indice('produtoSugeridoId');
  const faltando = ['aprovado', 'catalogItemId', 'codigo', 'produtoSugeridoId'].filter((c) => indice(c) === -1);
  if (faltando.length > 0) return { ok: false, erros: [`Colunas ausentes no cabecalho: ${faltando.join(', ')}.`] };

  const linhas: LinhaAprovada[] = [];
  const erros: string[] = [];
  registros.slice(1).forEach((registro, i) => {
    if ((registro[iAprovado] ?? '').trim().toLowerCase() !== 'sim') return;
    const numero = i + 2;
    const catalogItemId = inteiroPositivo(registro[iItem]);
    const produtoId = inteiroPositivo(registro[iProduto]);
    const codigo = normalizarCodigo(registro[iCodigo] ?? '');
    if (catalogItemId === null) erros.push(`Linha ${numero}: catalogItemId invalido.`);
    else if (codigo === '') erros.push(`Linha ${numero}: codigo vazio.`);
    else if (produtoId === null) erros.push(`Linha ${numero}: produtoSugeridoId invalido ou vazio.`);
    else linhas.push({ linha: numero, catalogItemId, codigo, produtoId });
  });
  return erros.length > 0 ? { ok: false, erros } : { ok: true, linhas };
}

// ---------- argumentos do script ----------

export type ConfigBackfill =
  | { ok: true; modo: 'proposta'; saida: string; formato: 'csv' | 'json' }
  | { ok: true; modo: 'aplicar'; entrada: string; gravar: boolean };

export type ErroArgumentos = { ok: false; erro: string; codigo: 2 };

function dentroDoRepo(alvo: string, raizRepo: string): boolean {
  const relativo = path.relative(path.resolve(raizRepo), path.resolve(alvo));
  return relativo === '' || (!relativo.startsWith('..') && !path.isAbsolute(relativo));
}

/** `host:porta/banco` de uma DATABASE_URL (nunca a senha). Vazio se a URL for invalida. */
export function bancoDaUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.host}${url.pathname}`;
  } catch {
    return '';
  }
}

/**
 * Valida os argumentos do script.
 *   --proposta --saida <arq.csv|arq.json>
 *   --aplicar --entrada <arq.csv> [--gravar --confirmo-banco <host:porta/banco>]
 * Sem `--gravar` e DRY-RUN. `--gravar` exige `--confirmo-banco` igual a `host + pathname` da DATABASE_URL.
 * Arquivos de saida/entrada DENTRO do repo sao recusados: dado real nunca entra no repositorio publico.
 */
export function lerArgumentos(
  argv: readonly string[],
  ctx: { raizRepo: string; databaseUrl: string },
): ConfigBackfill | ErroArgumentos {
  const falha = (erro: string): ErroArgumentos => ({ ok: false, erro, codigo: 2 });
  const comValor = new Set(['--saida', '--entrada', '--confirmo-banco']);
  const flags = new Set(['--proposta', '--aplicar', '--gravar']);
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

  const proposta = marcados.has('--proposta');
  const aplicar = marcados.has('--aplicar');
  if (proposta && aplicar) return falha('Escolha so um modo: --proposta ou --aplicar.');
  if (!proposta && !aplicar) return falha('Informe o modo: --proposta ou --aplicar.');

  if (proposta) {
    if (marcados.has('--gravar') || valores.has('--entrada') || valores.has('--confirmo-banco')) {
      return falha('--proposta e somente leitura: nao aceita --gravar, --entrada nem --confirmo-banco.');
    }
    const saida = valores.get('--saida');
    if (!saida) return falha('Informe --saida <arquivo.csv|arquivo.json>.');
    const ext = path.extname(saida).toLowerCase();
    if (ext !== '.csv' && ext !== '.json') return falha('--saida deve terminar em .csv ou .json.');
    if (dentroDoRepo(saida, ctx.raizRepo)) {
      return falha('--saida esta dentro do repositorio: grave fora dele (o repositorio e publico).');
    }
    return { ok: true, modo: 'proposta', saida, formato: ext === '.json' ? 'json' : 'csv' };
  }

  if (valores.has('--saida')) return falha('--aplicar nao aceita --saida.');
  const entrada = valores.get('--entrada');
  if (!entrada) return falha('Informe --entrada <arquivo.csv>.');
  if (path.extname(entrada).toLowerCase() !== '.csv') return falha('--entrada deve terminar em .csv.');
  if (dentroDoRepo(entrada, ctx.raizRepo)) {
    return falha('--entrada esta dentro do repositorio: use um arquivo fora dele (o repositorio e publico).');
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
  return { ok: true, modo: 'aplicar', entrada, gravar };
}
