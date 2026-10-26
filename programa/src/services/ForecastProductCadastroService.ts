// Cadastro de produto pela tela a partir de um PENDENTE de cadastro (PR 3B): cria produto (origin dbcorp) e
// acrescenta codigo. Fica fora de ForecastProductService para esse arquivo nao passar de 900 linhas.
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  FORECAST_MAX_CODES_PER_PRODUCT,
  FORECAST_PRODUCT_ORIGIN_DBCORP,
  FORECAST_PRODUCT_ORIGIN_PLANILHA,
} from '../constants/forecast';
import { normalizeProductCode, normalizeProductName } from '../utils/forecastWorkbook';
import { HttpError } from '../utils/http';
import type { ForecastProductCodeAddInput, ForecastProductCreateInput } from '../validators/forecast';
import { AuditLogService } from './AuditLogService';

type Db = Prisma.TransactionClient;

const ENTITY_TYPE = 'forecast_product';

// O import da planilha e o confirm DBCorp seguram a MESMA advisory lock por ate 120 s: sem estas opcoes o
// default do Prisma (5 s) estoura com P2028 enquanto a importacao roda. 10 s de espera pela conexao e 30 s
// para a transacao (a escrita em si e curta; o tempo e quase todo espera pela lock).
export const CADASTRO_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;
export const CADASTRO_OCUPADO_MESSAGE = 'O cadastro está ocupado por uma importação. Tente novamente em instantes.';

// P2028 (transacao expirou ou sem conexao a tempo) vira 503 claro em vez de 500 generico.
export function isTransactionTimeout(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028';
}

// Deadlock (Postgres 40P01): o Prisma devolve P2034 em escrita comum e P2010 (meta.code 40P01) em SQL cru. Cruzamento
// raro entre o import (deleteMany dos codigos) e as travas de linha do produto; tentar de novo resolve.
export function isDeadlock(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  const metaCode = (error.meta as { code?: unknown } | undefined)?.code;
  return metaCode === '40P01' || error.message.includes('40P01') || error.message.includes('deadlock detected');
}

// Timeout ou deadlock: ambos viram 503 "tente novamente" (nunca 500) nas escritas que travam a linha do produto.
export function isCadastroOcupado(error: unknown): boolean {
  return isTransactionTimeout(error) || isDeadlock(error);
}

// Trava a linha do produto (FOR NO KEY UPDATE) e devolve id/isActive, ou null se nao existe. Serializa as escritas
// do MESMO produto entre si (meses atipicos, embalagens) sem bloquear INSERT com FK (KEY SHARE) de outras tabelas.
// Mesmo racional de lockQuoteRequestForPurchaseOrders (QuotePurchaseOrderService). DEVE ser a PRIMEIRA instrucao da
// transacao, antes de ler marcas/codigos: lock depois de ler ou escrever codigos pode dar deadlock com o import.
export async function lockForecastProduct(
  tx: Db,
  productId: number,
): Promise<{ id: number; isActive: boolean } | null> {
  const rows = await tx.$queryRaw<Array<{ id: number; isActive: boolean }>>`
    SELECT id, "isActive" FROM "ForecastProduct" WHERE id = ${productId} FOR NO KEY UPDATE
  `;
  return rows[0] ?? null;
}

export interface ForecastProductCriado {
  id: number;
  nome: string;
  ativo: boolean;
  origem: string;
  fonteId: number;
  familiaId: number;
  codigos: Array<{ id: number; posicao: number; codigo: string }>;
}

export interface ForecastProductReativado {
  id: number;
  nome: string;
  ativo: true;
  // 'planilha' | 'dbcorp'. Produto 'planilha' que nao esta na proxima planilha e inativado de novo pelo import.
  origem: 'planilha' | 'dbcorp';
  // false = o produto ja estava ativo (nada gravado nem auditado).
  alterado: boolean;
}

export interface ForecastProductCodigoAdicionado {
  produtoId: number;
  // 'planilha' | 'dbcorp'. Em produto 'planilha' o proximo import apaga o codigo se ele nao estiver na planilha.
  produtoOrigem: string;
  codigo: { id: number; posicao: number; codigo: string };
}

// 409 quando algum codigo ja esta em QUALQUER produto (ativo ou inativo): codigo e unico no cadastro.
async function assertCodigosLivres(tx: Db, codigos: string[]): Promise<void> {
  const existentes = await tx.forecastProductCode.findMany({
    where: { code: { in: codigos } },
    select: { code: true, product: { select: { name: true } } },
  });
  const primeiro = existentes[0];
  if (primeiro) {
    throw new HttpError(409, `O código ${primeiro.code} já pertence ao produto ${primeiro.product.name}.`);
  }
}

// codigo (maiusculas) -> id do item de catalogo ativo com aquele dbcorpCode; so vale se for EXATAMENTE 1
// (mesma regra de plan()).
async function catalogoPorCodigo(tx: Db): Promise<Map<string, number>> {
  const rows = await tx.catalogItem.findMany({
    where: { isActive: true, dbcorpCode: { not: null } },
    select: { id: true, dbcorpCode: true },
  });
  const porCodigo = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.dbcorpCode) continue;
    const key = normalizeProductCode(row.dbcorpCode);
    if (key) porCodigo.set(key, [...(porCodigo.get(key) ?? []), row.id]);
  }
  return new Map([...porCodigo].filter(([, ids]) => ids.length === 1).map(([k, ids]) => [k, ids[0]]));
}

export class ForecastProductCadastroService {
  // Cria produto a partir de um pendente de cadastro (origin 'dbcorp'). So entra no calculo na PROXIMA
  // quinzena montada: a fonte precisa estar ativa com lead time e a familia ativa. Mesma advisory lock do
  // import (planilha e DBCorp), para nao competir com ele.
  static async create(input: ForecastProductCreateInput, userId: number | null): Promise<ForecastProductCriado> {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'forecast:import'}))`;

        const source = await tx.forecastSource.findUnique({
          where: { id: input.sourceId },
          select: { id: true, isActive: true, leadTimeDays: true },
        });
        if (!source || !source.isActive) throw new HttpError(400, 'A fonte escolhida não existe ou está inativa.');
        if (source.leadTimeDays === null) throw new HttpError(400, 'A fonte escolhida não tem lead time cadastrado.');

        const family = await tx.itemFamily.findUnique({
          where: { id: input.familyId },
          select: { id: true, isActive: true },
        });
        if (!family || !family.isActive) throw new HttpError(400, 'A família escolhida não existe ou está inativa.');

        const nome = input.nome.replace(/\s+/g, ' ').trim();
        const normalizedName = normalizeProductName(nome);
        const duplicado = await tx.forecastProduct.findUnique({
          where: { normalizedName },
          select: { id: true },
        });
        if (duplicado) throw new HttpError(409, 'Já existe um produto com esse nome.');

        const codigos = input.codigos.map(normalizeProductCode);
        await assertCodigosLivres(tx, codigos);
        const catalogByCode = await catalogoPorCodigo(tx);

        const product = await tx.forecastProduct.create({
          data: {
            name: nome,
            normalizedName,
            sheetOrder: null,
            sourceId: source.id,
            familyId: family.id,
            isActive: true,
            origin: FORECAST_PRODUCT_ORIGIN_DBCORP,
          },
        });
        const criados: ForecastProductCriado['codigos'] = [];
        for (const [index, code] of codigos.entries()) {
          const row = await tx.forecastProductCode.create({
            data: {
              productId: product.id,
              position: index + 1,
              code,
              catalogItemId: catalogByCode.get(code) ?? null,
            },
          });
          criados.push({ id: row.id, posicao: row.position, codigo: row.code });
        }

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: product.id,
            action: 'create',
            performedById: userId,
            // So ids e contagens: nunca nome de produto nem codigo DBCorp.
            metadata: {
              source: 'dbcorp_pendente',
              sourceId: source.id,
              familyId: family.id,
              codigos: codigos.length,
            },
          },
          tx,
        );
        return {
          id: product.id,
          nome: product.name,
          ativo: true,
          origem: FORECAST_PRODUCT_ORIGIN_DBCORP,
          fonteId: source.id,
          familiaId: family.id,
          codigos: criados,
        };
      }, CADASTRO_TX_OPTIONS);
    } catch (error) {
      if (isTransactionTimeout(error)) throw new HttpError(503, CADASTRO_OCUPADO_MESSAGE);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'Já existe um produto com esse nome ou código.');
      }
      throw error;
    }
  }

  // Reativa um produto inativo (so o flag isActive: origem, fonte, codigos, embalagens, marcas e grupo ficam como
  // estao). Mesma advisory lock do import, para nao cruzar com uma importacao que inativa/adota o produto. Ja ativo =
  // 'alterado: false', sem gravar nem auditar. O AuditLog guarda so ids e flags: nunca nome, codigo ou observacao.
  static async reativar(productId: number, userId: number | null): Promise<ForecastProductReativado> {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'forecast:import'}))`;

        const product = await tx.forecastProduct.findUnique({
          where: { id: productId },
          select: { id: true, name: true, isActive: true, origin: true },
        });
        if (!product) throw new HttpError(404, 'Produto não encontrado.');
        const origem =
          product.origin === FORECAST_PRODUCT_ORIGIN_DBCORP
            ? FORECAST_PRODUCT_ORIGIN_DBCORP
            : FORECAST_PRODUCT_ORIGIN_PLANILHA;
        const base = { id: product.id, nome: product.name, ativo: true, origem } as const;
        if (product.isActive) return { ...base, alterado: false };

        const { count } = await tx.forecastProduct.updateMany({
          where: { id: productId, isActive: false },
          data: { isActive: true },
        });
        if (count === 0) return { ...base, alterado: false };

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: productId,
            action: 'reactivate',
            performedById: userId,
            // So flags e origem: nunca nome de produto, codigo DBCorp nem observacao.
            metadata: { source: 'manual', origem, antes: false, depois: true },
          },
          tx,
        );
        return { ...base, alterado: true };
      }, CADASTRO_TX_OPTIONS);
    } catch (error) {
      if (isTransactionTimeout(error)) throw new HttpError(503, CADASTRO_OCUPADO_MESSAGE);
      throw error;
    }
  }

  // Acrescenta 1 codigo a um produto ativo (menor posicao livre de 1..7, embalagem nula).
  static async addCode(
    productId: number,
    input: ForecastProductCodeAddInput,
    userId: number | null,
  ): Promise<ForecastProductCodigoAdicionado> {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'forecast:import'}))`;

        const product = await tx.forecastProduct.findUnique({
          where: { id: productId },
          select: { id: true, isActive: true, origin: true, codes: { select: { position: true } } },
        });
        if (!product) throw new HttpError(404, 'Produto não encontrado.');
        if (!product.isActive) throw new HttpError(400, 'Produto inativo.');

        const usadas = new Set(product.codes.map((c) => c.position));
        let position = 0;
        for (let p = 1; p <= FORECAST_MAX_CODES_PER_PRODUCT; p += 1) {
          if (!usadas.has(p)) {
            position = p;
            break;
          }
        }
        if (position === 0) {
          throw new HttpError(400, `O produto já tem ${FORECAST_MAX_CODES_PER_PRODUCT} códigos.`);
        }

        const code = normalizeProductCode(input.codigo);
        await assertCodigosLivres(tx, [code]);
        const catalogByCode = await catalogoPorCodigo(tx);

        const row = await tx.forecastProductCode.create({
          data: { productId, position, code, catalogItemId: catalogByCode.get(code) ?? null },
        });
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: productId,
            action: 'code_add',
            performedById: userId,
            // So ids e posicao: nunca o codigo DBCorp.
            metadata: { source: 'dbcorp_pendente', position, codeId: row.id },
          },
          tx,
        );
        return {
          produtoId: productId,
          produtoOrigem:
            product.origin === FORECAST_PRODUCT_ORIGIN_DBCORP
              ? FORECAST_PRODUCT_ORIGIN_DBCORP
              : FORECAST_PRODUCT_ORIGIN_PLANILHA,
          codigo: { id: row.id, posicao: row.position, codigo: row.code },
        };
      }, CADASTRO_TX_OPTIONS);
    } catch (error) {
      if (isTransactionTimeout(error)) throw new HttpError(503, CADASTRO_OCUPADO_MESSAGE);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'Esse código já pertence a um produto.');
      }
      throw error;
    }
  }
}
