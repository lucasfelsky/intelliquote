import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import type { ForecastRascunhoCotacaoPutInput } from '../validators/forecast';
import { AuditLogService } from './AuditLogService';
import type { FrozenProduct } from './ForecastSnapshotService';

const ENTITY_TYPE = 'forecast_quote_draft';

const MSG_CORRIDA =
  'O rascunho desta cotação acabou de ser alterado em outra aba ou sessão. Recarregue o rascunho e confira.';

export type AcaoRascunho = 'create' | 'update' | 'delete' | 'nenhuma';

export interface RascunhoCotacaoItem {
  productId: number;
  quantidadeKg: number;
  observacao: string | null;
}

export interface RascunhoCotacaoData {
  snapshotId: number;
  itens: RascunhoCotacaoItem[];
  /** ISO 8601. */
  criadoEm: string;
  /** ISO 8601. Devolva no PUT seguinte (`atualizadoEm`) para a checagem de concorrencia. */
  atualizadoEm: string;
}

export interface RascunhoCotacaoGravado {
  acao: AcaoRascunho;
  rascunho: RascunhoCotacaoData | null;
}

interface RascunhoLinha {
  snapshotId: number;
  items: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function naoEncontrada(): HttpError {
  return new HttpError(404, 'Quinzena nao encontrada.');
}

function corrida(): HttpError {
  return new HttpError(409, MSG_CORRIDA);
}

function paraItens(items: unknown): RascunhoCotacaoItem[] {
  return (Array.isArray(items) ? items : []).map((raw) => {
    const item = raw as Partial<RascunhoCotacaoItem>;
    return {
      productId: Number(item.productId),
      quantidadeKg: Number(item.quantidadeKg),
      observacao: item.observacao ?? null,
    };
  });
}

function paraRascunhoData(row: RascunhoLinha): RascunhoCotacaoData {
  return {
    snapshotId: row.snapshotId,
    itens: paraItens(row.items),
    criadoEm: row.createdAt.toISOString(),
    atualizadoEm: row.updatedAt.toISOString(),
  };
}

function mesmosItens(a: RascunhoCotacaoItem[], b: RascunhoCotacaoItem[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Rascunho da cotacao montada no pop-up "Criar cotacao" (E5), PRIVADO do dono: cada chamada filtra por (quinzena, usuario
// logado), entao ninguem le o rascunho de outra pessoa. A quinzena excluida (soft delete) responde 404 e mantem o
// rascunho. O AuditLog guarda so ids, rotulo da quinzena, contagem de itens e se ha observacao: nunca o texto da
// observacao (texto livre). Nao toca a decisao de compra nem a cotacao (E4 liga o rascunho a cotacao gerada).
export class ForecastRascunhoCotacaoService {
  static async obter(snapshotId: number, userId: number): Promise<RascunhoCotacaoData | null> {
    const snapshot = await prisma.forecastSnapshot.findFirst({
      where: { id: snapshotId, deletedAt: null },
      select: { id: true },
    });
    if (!snapshot) throw naoEncontrada();
    const row = await prisma.forecastQuoteDraft.findUnique({
      where: { snapshotId_userId: { snapshotId, userId } },
    });
    return row ? paraRascunhoData(row) : null;
  }

  // Grava o rascunho do usuario: a lista COMPLETA de itens substitui a anterior (upsert). Lista vazia apaga. Sem mudanca
  // = 'nenhuma' (sem gravar nem auditar). Concorrencia otimista por `updatedAt`: o UPDATE/DELETE so vale se a linha ainda
  // tem o `updatedAt` lido; e, se o cliente mandou `atualizadoEm`, ele precisa bater com o da linha atual.
  static async gravar(
    snapshotId: number,
    userId: number,
    input: ForecastRascunhoCotacaoPutInput,
  ): Promise<RascunhoCotacaoGravado> {
    const snapshot = await prisma.forecastSnapshot.findFirst({
      where: { id: snapshotId, deletedAt: null },
      select: { id: true, label: true, products: true },
    });
    if (!snapshot) throw naoEncontrada();

    const itens: RascunhoCotacaoItem[] = input.itens.map((item) => ({
      productId: item.productId,
      quantidadeKg: item.quantidadeKg,
      observacao: item.observacao ?? null,
    }));

    if (itens.length > 0) {
      const produtos = new Set(
        (snapshot.products as unknown as FrozenProduct[]).map((p) => p.productId).filter((id) => typeof id === 'number'),
      );
      const fora = itens.map((i) => i.productId).filter((id) => !produtos.has(id));
      if (fora.length > 0) {
        throw new HttpError(400, `Produto fora desta quinzena: ${fora.join(', ')}.`);
      }
    }

    const label = snapshot.label;
    const esperado = input.atualizadoEm;
    const confere = (atual: { updatedAt: Date } | null): void => {
      if (esperado === undefined) return;
      if (esperado === null ? atual !== null : atual === null || atual.updatedAt.toISOString() !== esperado) {
        throw corrida();
      }
    };

    try {
      return await prisma.$transaction(async (tx) => {
        const viva = await tx.forecastSnapshot.findFirst({
          where: { id: snapshotId, deletedAt: null },
          select: { id: true },
        });
        if (!viva) throw naoEncontrada();

        const atual = await tx.forecastQuoteDraft.findUnique({
          where: { snapshotId_userId: { snapshotId, userId } },
        });
        confere(atual);

        if (itens.length === 0) {
          if (!atual) return { acao: 'nenhuma' as const, rascunho: null };
          const resultado = await tx.forecastQuoteDraft.deleteMany({
            where: { id: atual.id, updatedAt: atual.updatedAt },
          });
          if (resultado.count === 0) throw corrida();
          await AuditLogService.log(
            {
              entityType: ENTITY_TYPE,
              entityId: atual.id,
              action: 'delete',
              performedById: userId,
              metadata: {
                snapshotId,
                label,
                totalItens: paraItens(atual.items).length,
              },
            },
            tx,
          );
          return { acao: 'delete' as const, rascunho: null };
        }

        const comObservacao = itens.some((i) => i.observacao !== null);
        const items = itens as unknown as Prisma.InputJsonValue;

        if (!atual) {
          const criado = await tx.forecastQuoteDraft.create({ data: { snapshotId, userId, items } });
          await AuditLogService.log(
            {
              entityType: ENTITY_TYPE,
              entityId: criado.id,
              action: 'create',
              performedById: userId,
              metadata: { snapshotId, label, totalItens: itens.length, comObservacao },
            },
            tx,
          );
          return { acao: 'create' as const, rascunho: paraRascunhoData(criado) };
        }

        const antes = paraItens(atual.items);
        if (mesmosItens(antes, itens)) {
          return { acao: 'nenhuma' as const, rascunho: paraRascunhoData(atual) };
        }

        const resultado = await tx.forecastQuoteDraft.updateMany({
          where: { id: atual.id, updatedAt: atual.updatedAt },
          data: { items, updatedAt: new Date() },
        });
        if (resultado.count === 0) throw corrida();

        const depois = await tx.forecastQuoteDraft.findUnique({ where: { id: atual.id } });
        if (!depois) throw corrida();
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: atual.id,
            action: 'update',
            performedById: userId,
            metadata: {
              snapshotId,
              label,
              totalItens: itens.length,
              comObservacao,
              antes: { totalItens: antes.length },
            },
          },
          tx,
        );
        return { acao: 'update' as const, rascunho: paraRascunhoData(depois) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw corrida();
      }
      throw error;
    }
  }

  // Apaga o rascunho do usuario (sem rascunho = 'nenhuma'). Equivale ao PUT com lista vazia, sem checar `atualizadoEm`.
  static async apagar(snapshotId: number, userId: number): Promise<RascunhoCotacaoGravado> {
    return ForecastRascunhoCotacaoService.gravar(snapshotId, userId, { itens: [] });
  }
}
