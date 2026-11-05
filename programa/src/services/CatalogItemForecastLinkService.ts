// Vinculo do item de catalogo com o Forecast: o codigo DBCorp do item precisa existir em ForecastProductCode
// para entrar no calculo. Tudo aqui roda dentro de UMA transacao com a advisory lock do import (forecast:import);
// falha no vinculo desfaz o item. Sem pasta repositories: regras e queries ficam no service.
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sugerirVinculos, type LinhaAprovada, type LinhaProposta } from '../utils/forecastCatalogoBackfill';
import {
  agruparProdutosNovos,
  contarResultados,
  resolverPorNome,
  type FontePlanilha,
  type LinhaLida,
  type LinhaModelo,
  type LinhaProdutoNovo,
  type RelatorioProdutosNovos,
  type ResultadoProdutoNovo,
} from '../utils/forecastProdutosNovos';
import { normalizeProductCode, normalizeProductName } from '../utils/forecastWorkbook';
import { HttpError } from '../utils/http';
import type { CatalogItemForecastLink } from '../validators/domain';
import { AuditLogService } from './AuditLogService';
import {
  CADASTRO_OCUPADO_MESSAGE,
  CADASTRO_TX_OPTIONS,
  adicionarCodigoNaTransacao,
  criarProdutoNaTransacao,
  isCadastroOcupado,
  travarImportForecast,
  type OrigemCadastro,
} from './ForecastProductCadastroService';
import { preencherLeadTimeSeVazio } from './ForecastSourceService';

type Db = Prisma.TransactionClient;

const ENTITY_TYPE = 'forecast_product';
const CODIGO_MAX = 40;

export type ProdutoDoCodigo = { id: number; nome: string; origem: 'planilha' | 'dbcorp' };

export type SituacaoCodigo =
  | { tipo: 'livre' }
  | {
      tipo: 'ativo' | 'inativo';
      codeId: number;
      catalogItemId: number | null;
      produto: ProdutoDoCodigo;
    };

export interface VinculoResultado {
  situacao: 'adicionado' | 'produto_novo' | 'ja_no_forecast' | 'produto_inativo';
  produto: ProdutoDoCodigo;
  codigoId: number;
}

export interface ItemSemForecast {
  id: number;
  commercialName: string;
  marketName: string;
  dbcorpCode: string | null;
  familyId: number | null;
  family: { id: number; name: string } | null;
}

function origemDoProduto(origin: string): 'planilha' | 'dbcorp' {
  return origin === 'dbcorp' ? 'dbcorp' : 'planilha';
}

// Onde o codigo esta hoje no Forecast: livre, ou em produto ativo/inativo (codigo e unico no cadastro).
export async function situacaoDoCodigo(db: Db | typeof prisma, code: string): Promise<SituacaoCodigo> {
  const row = await db.forecastProductCode.findUnique({
    where: { code: normalizeProductCode(code) },
    select: {
      id: true,
      catalogItemId: true,
      product: { select: { id: true, name: true, isActive: true, origin: true } },
    },
  });
  if (!row) return { tipo: 'livre' };
  return {
    tipo: row.product.isActive ? 'ativo' : 'inativo',
    codeId: row.id,
    catalogItemId: row.catalogItemId,
    produto: { id: row.product.id, nome: row.product.name, origem: origemDoProduto(row.product.origin) },
  };
}

export interface VincularNaTransacaoInput {
  catalogItemId: number;
  code: string;
  vinculo: CatalogItemForecastLink | null;
  exigido: boolean;
  userId: number | null;
  origem: OrigemCadastro;
}

// Liga o codigo do item ao Forecast. Devolve null quando nada foi pedido nem exigido (codigo livre, sem escolha).
export async function vincularNaTransacao(
  tx: Db,
  { catalogItemId, code, vinculo, exigido, userId, origem }: VincularNaTransacaoInput,
): Promise<VinculoResultado | null> {
  const codigo = normalizeProductCode(code);
  const situacao = await situacaoDoCodigo(tx, codigo);

  if (situacao.tipo !== 'livre') {
    const { produto } = situacao;
    if (vinculo && (vinculo.modo === 'novo' || vinculo.productId !== produto.id)) {
      throw new HttpError(409, `O código ${codigo} já pertence ao produto ${produto.nome}.`);
    }
    // Nunca sobrescreve um catalogItemId ja preenchido (outro item pode ser o dono do vinculo).
    if (situacao.catalogItemId === null) {
      await tx.forecastProductCode.update({ where: { id: situacao.codeId }, data: { catalogItemId } });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: produto.id,
          action: 'code_catalog_link',
          performedById: userId,
          metadata: { source: origem, codeId: situacao.codeId, catalogItemId },
        },
        tx,
      );
    }
    return {
      situacao: situacao.tipo === 'ativo' ? 'ja_no_forecast' : 'produto_inativo',
      produto,
      codigoId: situacao.codeId,
    };
  }

  if (!vinculo) {
    if (!exigido) return null;
    throw new HttpError(
      400,
      `O código ${codigo} não está no Forecast. Escolha o produto do Forecast ou crie um produto novo para salvar o item.`,
      'FORECAST_VINCULO_OBRIGATORIO',
    );
  }
  if (codigo.length > CODIGO_MAX) {
    throw new HttpError(400, `O código aceita no máximo ${CODIGO_MAX} caracteres.`);
  }

  if (vinculo.modo === 'existente') {
    const adicionado = await adicionarCodigoNaTransacao(tx, vinculo.productId, codigo, userId, { origem, catalogItemId });
    const produto = await tx.forecastProduct.findUnique({
      where: { id: vinculo.productId },
      select: { id: true, name: true },
    });
    return {
      situacao: 'adicionado',
      produto: { id: adicionado.produtoId, nome: produto?.name ?? '', origem: origemDoProduto(adicionado.produtoOrigem) },
      codigoId: adicionado.codigo.id,
    };
  }

  const criado = await criarProdutoNaTransacao(
    tx,
    { nome: vinculo.nome, codigos: [codigo], sourceId: vinculo.sourceId, familyId: vinculo.familyId },
    userId,
    { origem, catalogItemIdPorCodigo: new Map([[codigo, catalogItemId]]) },
  );
  return {
    situacao: 'produto_novo',
    produto: { id: criado.id, nome: criado.nome, origem: 'dbcorp' },
    codigoId: criado.codigos[0]?.id ?? 0,
  };
}

// Troca/zera o codigo do item: so solta o vinculo (catalogItemId = null). O CODIGO NAO E APAGADO do Forecast:
// ele continua medindo venda/estoque do DBCorp, com ou sem item no catalogo.
export async function liberarVinculoAntigo(
  tx: Db,
  { catalogItemId, codeAntigo, userId }: { catalogItemId: number; codeAntigo: string; userId: number | null },
): Promise<void> {
  const { count } = await tx.forecastProductCode.updateMany({
    where: { code: normalizeProductCode(codeAntigo), catalogItemId },
    data: { catalogItemId: null },
  });
  if (count > 0) {
    await AuditLogService.log(
      {
        entityType: 'catalog_item',
        entityId: catalogItemId,
        action: 'code_catalog_unlink',
        performedById: userId,
        metadata: { source: 'catalogo', catalogItemId },
      },
      tx,
    );
  }
}

// Itens ATIVOS com codigo DBCorp que nao esta em ForecastProductCode (ativo ou inativo).
export async function listarSemForecast(db: Db | typeof prisma): Promise<{ itens: ItemSemForecast[]; total: number }> {
  const [itens, codigos] = await Promise.all([
    db.catalogItem.findMany({
      where: { isActive: true, dbcorpCode: { not: null } },
      select: {
        id: true,
        commercialName: true,
        marketName: true,
        dbcorpCode: true,
        familyId: true,
        family: { select: { id: true, name: true } },
      },
      orderBy: [{ commercialName: 'asc' }],
    }),
    db.forecastProductCode.findMany({ select: { code: true } }),
  ]);
  const noForecast = new Set(codigos.map((c) => normalizeProductCode(c.code)));
  const fora = itens.filter((item) => {
    const code = normalizeProductCode(item.dbcorpCode ?? '');
    return code !== '' && !noForecast.has(code);
  });
  return { itens: fora, total: fora.length };
}

// Transacao do vinculo: lock do import PRIMEIRO, depois tudo na mesma transacao (item + codigo).
export async function executarComVinculo<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      await travarImportForecast(tx);
      return fn(tx);
    }, CADASTRO_TX_OPTIONS);
  } catch (error) {
    if (isCadastroOcupado(error)) throw new HttpError(503, CADASTRO_OCUPADO_MESSAGE);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = (error.meta as { target?: unknown } | undefined)?.target;
      const alvo = Array.isArray(target) ? target.join(',') : String(target ?? '');
      if (alvo.includes('marketName')) {
        throw new HttpError(409, 'Ja existe um item cadastrado com esse nome de mercado.');
      }
      throw new HttpError(409, 'Esse código já pertence a um produto.');
    }
    throw error;
  }
}

// ---------- backfill (itens ja existentes sem Forecast) ----------

// Transacao que o Postgres recusa escrever (SET TRANSACTION READ ONLY e a 1a instrucao): a proposta nunca grava.
export async function emTransacaoSomenteLeitura<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return fn(tx);
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

// Proposta SOMENTE LEITURA: itens ativos fora do Forecast + produtos com codigos, e a sugestao de cada um.
export async function gerarPropostaBackfill(): Promise<LinhaProposta[]> {
  return emTransacaoSomenteLeitura(async (tx) => {
    const { itens } = await listarSemForecast(tx);
    const produtos = await tx.forecastProduct.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        origin: true,
        familyId: true,
        codes: { select: { code: true, catalogItemId: true, catalogItem: { select: { commercialName: true } } } },
      },
      orderBy: [{ id: 'asc' }],
    });
    return sugerirVinculos(
      itens.map((item) => ({
        catalogItemId: item.id,
        codigo: normalizeProductCode(item.dbcorpCode ?? ''),
        nomeComercial: item.commercialName,
        familyId: item.familyId,
        familia: item.family?.name ?? null,
      })),
      produtos.map((p) => ({
        id: p.id,
        nome: p.name,
        ativo: p.isActive,
        origem: origemDoProduto(p.origin),
        familyId: p.familyId,
        codigos: p.codes.map((c) => ({
          code: c.code,
          catalogItemId: c.catalogItemId,
          nomeComercialDoItem: c.catalogItem?.commercialName ?? null,
        })),
      })),
    );
  });
}

export type StatusBackfill = 'aplicado' | 'ja_aplicado' | 'conflito' | 'item_mudou' | 'erro';

export interface ResultadoLinhaBackfill {
  linha: number;
  catalogItemId: number;
  produtoId: number;
  status: StatusBackfill;
  erro?: string;
}

export interface RelatorioBackfill {
  gravar: boolean;
  resultados: ResultadoLinhaBackfill[];
  contagem: Record<StatusBackfill, number>;
}

// Sentinela do dry-run: aborta a transacao (rollback) e carrega o relatorio simulado.
class DryRunRollback extends Error {
  constructor(readonly relatorio: RelatorioBackfill) {
    super('dry-run');
  }
}

function contar(resultados: ResultadoLinhaBackfill[]): Record<StatusBackfill, number> {
  const contagem: Record<StatusBackfill, number> = { aplicado: 0, ja_aplicado: 0, conflito: 0, item_mudou: 0, erro: 0 };
  for (const r of resultados) contagem[r.status] += 1;
  return contagem;
}

// Aplica SO as linhas aprovadas, numa transacao com a lock do import. Idempotente: codigo ja no produto aprovado vira
// `ja_aplicado`. Por linha, HttpError (produto cheio/inativo/inexistente, codigo ja ocupado) vira resultado da linha
// (os checks rodam antes de qualquer escrita, entao a transacao segue valida); qualquer outro erro aborta tudo.
// `gravar: false` = DRY-RUN: tudo e simulado de verdade (vagas acumuladas) e desfeito no fim.
export async function aplicarBackfill(
  linhasAprovadas: readonly LinhaAprovada[],
  { gravar }: { gravar: boolean },
): Promise<RelatorioBackfill> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await travarImportForecast(tx);
        const resultados: ResultadoLinhaBackfill[] = [];
        for (const aprovada of linhasAprovadas) {
          const base = { linha: aprovada.linha, catalogItemId: aprovada.catalogItemId, produtoId: aprovada.produtoId };
          const codigo = normalizeProductCode(aprovada.codigo);
          const item = await tx.catalogItem.findUnique({
            where: { id: aprovada.catalogItemId },
            select: { id: true, isActive: true, dbcorpCode: true },
          });
          if (!item || !item.isActive || normalizeProductCode(item.dbcorpCode ?? '') !== codigo) {
            resultados.push({ ...base, status: 'item_mudou' });
            continue;
          }
          try {
            const situacao = await situacaoDoCodigo(tx, codigo);
            if (situacao.tipo !== 'livre') {
              if (situacao.produto.id !== aprovada.produtoId) {
                resultados.push({ ...base, status: 'conflito', erro: 'codigo ja pertence a outro produto' });
                continue;
              }
              // Preenche o catalogItemId se estiver nulo (nunca sobrescreve).
              await vincularNaTransacao(tx, {
                catalogItemId: item.id,
                code: codigo,
                vinculo: { modo: 'existente', productId: aprovada.produtoId },
                exigido: true,
                userId: null,
                origem: 'backfill_catalogo',
              });
              resultados.push({ ...base, status: 'ja_aplicado' });
              continue;
            }
            await adicionarCodigoNaTransacao(tx, aprovada.produtoId, codigo, null, {
              origem: 'backfill_catalogo',
              catalogItemId: item.id,
            });
            resultados.push({ ...base, status: 'aplicado' });
          } catch (error) {
            if (!(error instanceof HttpError)) throw error;
            resultados.push({ ...base, status: 'erro', erro: error.message });
          }
        }
        const relatorio: RelatorioBackfill = { gravar, resultados, contagem: contar(resultados) };
        if (!gravar) throw new DryRunRollback(relatorio);
        return relatorio;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof DryRunRollback) return error.relatorio;
    throw error;
  }
}

// ---------- planilha de produtos novos (somente leitura) ----------

// Fontes do Forecast para o humano escrever o NOME certo na coluna `fonte` da planilha. SOMENTE LEITURA.
export async function listarFontesParaPlanilha(): Promise<FontePlanilha[]> {
  return emTransacaoSomenteLeitura(async (tx) => {
    const fontes = await tx.forecastSource.findMany({
      select: { id: true, name: true, leadTimeDays: true, isActive: true },
      orderBy: [{ name: 'asc' }],
    });
    return fontes.map((f) => ({ id: f.id, nome: f.name, leadTimeDays: f.leadTimeDays, ativa: f.isActive }));
  });
}

// Modelo da planilha de produtos novos: os orfaos `sem_sugestao` da proposta do backfill, agrupados por nome base.
// Reusa a proposta inteira (nenhuma query nova). SOMENTE LEITURA.
export async function gerarModeloProdutosNovos(): Promise<LinhaModelo[]> {
  return agruparProdutosNovos(await gerarPropostaBackfill());
}

// ---------- criacao em lote de produtos novos ----------

const ORIGEM_LOTE: OrigemCadastro = 'lote_produtos_novos';

// Sentinela do dry-run: forca o rollback da transacao da linha e carrega o resultado simulado.
class LinhaDryRun extends Error {
  constructor(readonly resultado: ResultadoProdutoNovo) {
    super('dry-run');
  }
}

// Todas as verificacoes rodam ANTES da primeira escrita; depois dela so `throw` (rollback da linha), nunca `return`
// de status. A lock forecast:import ja foi adquirida por executarComVinculo (1a instrucao da transacao).
async function processarLinhaNova(tx: Db, dados: LinhaProdutoNovo): Promise<ResultadoProdutoNovo> {
  const { linha, codigos, catalogItemIds } = dados;
  const resultado = (
    status: ResultadoProdutoNovo['status'],
    motivo: ResultadoProdutoNovo['motivo'] = null,
    produtoId: number | null = null,
  ): ResultadoProdutoNovo => ({ linha, status, motivo, produtoId });

  // a. Os itens do catalogo continuam como na planilha (existem, ativos, com o MESMO codigo da posicao).
  const itens = await tx.catalogItem.findMany({
    where: { id: { in: catalogItemIds } },
    select: { id: true, isActive: true, dbcorpCode: true, familyId: true },
  });
  const itemPorId = new Map(itens.map((item) => [item.id, item]));
  for (const [i, codigo] of codigos.entries()) {
    const item = itemPorId.get(catalogItemIds[i]);
    if (!item) return resultado('item_mudou', 'item_inexistente');
    if (!item.isActive) return resultado('item_mudou', 'item_inativo');
    if (normalizeProductCode(item.dbcorpCode ?? '') !== codigo) return resultado('item_mudou', 'codigo_do_item_mudou');
  }

  // b. Codigo em mais de 1 item ATIVO do catalogo: o vinculo por posicao seria ambiguo para o humano.
  const ativos = await tx.catalogItem.findMany({
    where: { isActive: true, dbcorpCode: { not: null } },
    select: { id: true, dbcorpCode: true },
  });
  const itensPorCodigo = new Map<string, number>();
  for (const ativo of ativos) {
    const chave = normalizeProductCode(ativo.dbcorpCode ?? '');
    itensPorCodigo.set(chave, (itensPorCodigo.get(chave) ?? 0) + 1);
  }
  if (codigos.some((codigo) => (itensPorCodigo.get(codigo) ?? 0) > 1)) {
    return resultado('conflito', 'codigo_em_mais_de_um_item');
  }

  // c. Idempotencia e conflitos com o que ja existe no Forecast.
  const produto = await tx.forecastProduct.findUnique({
    where: { normalizedName: normalizeProductName(dados.nome) },
    select: { id: true },
  });
  const situacoes: SituacaoCodigo[] = [];
  for (const codigo of codigos) situacoes.push(await situacaoDoCodigo(tx, codigo));
  if (produto) {
    const doProduto = situacoes.map((s) => s.tipo !== 'livre' && s.produto.id === produto.id);
    const ligadoAOutro = situacoes.some(
      (s, i) => s.tipo !== 'livre' && s.produto.id === produto.id && s.catalogItemId !== null && s.catalogItemId !== catalogItemIds[i],
    );
    if (ligadoAOutro) return resultado('conflito', 'codigo_ligado_a_outro_item');
    if (!doProduto.every(Boolean)) return resultado('conflito', 'produto_ja_existe');
    // Todos os codigos ja estao no produto: so preenche o catalogItemId que estiver nulo (nunca sobrescreve).
    for (const [i, codigo] of codigos.entries()) {
      const situacao = situacoes[i];
      if (situacao.tipo === 'livre' || situacao.catalogItemId !== null) continue;
      await vincularNaTransacao(tx, {
        catalogItemId: catalogItemIds[i],
        code: codigo,
        vinculo: { modo: 'existente', productId: produto.id },
        exigido: true,
        userId: null,
        origem: ORIGEM_LOTE,
      });
    }
    return resultado('ja_aplicado', null, produto.id);
  }
  if (situacoes.some((s) => s.tipo !== 'livre')) return resultado('conflito', 'codigo_em_outro_produto');

  // d. Fonte pelo NOME (uma so; ambigua ou inativa = erro).
  const fontes = (
    await tx.forecastSource.findMany({ select: { id: true, name: true, isActive: true, leadTimeDays: true } })
  ).map((f) => ({ id: f.id, nome: f.name, ativa: f.isActive, leadTimeDays: f.leadTimeDays }));
  const fonteAchada = resolverPorNome(fontes, dados.fonte);
  if (fonteAchada.tipo === 'nenhum') return resultado('erro', 'fonte_inexistente');
  if (fonteAchada.tipo === 'ambiguo') return resultado('erro', 'fonte_ambigua');
  const fonte = fonteAchada.item;
  if (!fonte.ativa) return resultado('erro', 'fonte_inativa');

  // e. Familia: pelo nome da planilha, ou herdada dos itens quando todos tem a mesma familia ativa.
  const familias = (await tx.itemFamily.findMany({ select: { id: true, name: true, isActive: true } })).map((f) => ({
    id: f.id,
    nome: f.name,
    ativa: f.isActive,
  }));
  let familyId: number;
  if (dados.familia !== '') {
    const familiaAchada = resolverPorNome(familias, dados.familia);
    if (familiaAchada.tipo === 'nenhum') return resultado('erro', 'familia_inexistente');
    if (familiaAchada.tipo === 'ambiguo') return resultado('erro', 'familia_ambigua');
    if (!familiaAchada.item.ativa) return resultado('erro', 'familia_inativa');
    familyId = familiaAchada.item.id;
  } else {
    const doCatalogo = new Set(catalogItemIds.map((id) => itemPorId.get(id)?.familyId ?? null));
    const [unica] = [...doCatalogo];
    const herdada = doCatalogo.size === 1 && unica !== null ? familias.find((f) => f.id === unica) : undefined;
    if (!herdada || !herdada.ativa) return resultado('erro', 'familia_ausente');
    familyId = herdada.id;
  }

  // f. Lead time e da FONTE: nunca sobrescreve um que ja existe.
  if (fonte.leadTimeDays !== null && dados.leadTimeDias !== null && fonte.leadTimeDays !== dados.leadTimeDias) {
    return resultado('conflito', 'lead_time_divergente');
  }
  if (fonte.leadTimeDays === null && dados.leadTimeDaFonteNoArquivo === null) return resultado('erro', 'lead_time_ausente');

  // g. ESCRITAS: daqui em diante so `throw`.
  if (fonte.leadTimeDays === null && dados.leadTimeDaFonteNoArquivo !== null) {
    await preencherLeadTimeSeVazio(tx, fonte.id, dados.leadTimeDaFonteNoArquivo, null, ORIGEM_LOTE);
  }
  const criado = await criarProdutoNaTransacao(tx, { nome: dados.nome, codigos, sourceId: fonte.id, familyId }, null, {
    origem: ORIGEM_LOTE,
    catalogItemIdPorCodigo: new Map(codigos.map((codigo, i) => [codigo, catalogItemIds[i]] as const)),
  });
  return resultado('aplicado', null, criado.id);
}

// Cria os produtos novos aprovados na planilha, UMA transacao por linha (lock forecast:import + CADASTRO_TX_OPTIONS):
// a falha de uma linha desfaz so ela (lead time da fonte incluso). `ignorado` e `erro` da leitura entram no relatorio
// sem abrir transacao. HttpError (inclusive 503 cadastro ocupado e 409 de unicidade) vira `erro` da linha; qualquer
// outro erro aborta o lote (as linhas ja gravadas ficam; rodar de novo e idempotente).
// `gravar: false` = DRY-RUN: a transacao de cada linha roda de verdade e termina em rollback forcado (sentinela).
export async function criarProdutosNovos(
  linhas: readonly LinhaLida[],
  { gravar }: { gravar: boolean },
): Promise<RelatorioProdutosNovos> {
  const resultados: ResultadoProdutoNovo[] = [];
  for (const lida of linhas) {
    if (lida.status === 'ignorado') {
      resultados.push({ linha: lida.linha, status: 'ignorado', motivo: lida.motivo, produtoId: null });
      continue;
    }
    if (lida.status === 'erro') {
      resultados.push({ linha: lida.linha, status: 'erro', motivo: lida.motivo, produtoId: null });
      continue;
    }
    try {
      resultados.push(
        await executarComVinculo(async (tx) => {
          const resultado = await processarLinhaNova(tx, lida.dados);
          if (!gravar) throw new LinhaDryRun(resultado);
          return resultado;
        }),
      );
    } catch (error) {
      if (error instanceof LinhaDryRun) {
        // O produto simulado nao existe de verdade: nao devolve o id dele.
        const { resultado } = error;
        resultados.push(resultado.status === 'aplicado' ? { ...resultado, produtoId: null } : resultado);
      } else if (error instanceof HttpError) {
        resultados.push({
          linha: lida.linha,
          status: 'erro',
          motivo: error.status === 503 ? 'cadastro_ocupado' : 'rejeitado_pelo_cadastro',
          produtoId: null,
        });
      } else {
        throw error;
      }
    }
  }
  return { gravar, resultados, contagem: contarResultados(resultados) };
}
