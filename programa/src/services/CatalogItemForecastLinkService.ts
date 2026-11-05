// Vinculo do item de catalogo com o Forecast: o codigo DBCorp do item precisa existir em ForecastProductCode
// para entrar no calculo. Tudo aqui roda dentro de UMA transacao com a advisory lock do import (forecast:import);
// falha no vinculo desfaz o item. Sem pasta repositories: regras e queries ficam no service.
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { normalizeProductCode } from '../utils/forecastWorkbook';
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
