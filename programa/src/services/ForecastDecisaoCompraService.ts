import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  itemDaListaDeCompra,
  paraDecisaoCompraData,
  type DecisaoCompraData,
} from '../utils/forecastDecisaoCompra';
import type { ItemRelatorioCompras } from '../utils/forecastRelatorioCompras';
import { HttpError } from '../utils/http';
import type { ForecastDecisaoPutInput } from '../validators/forecast';
import { AuditLogService } from './AuditLogService';
import { ForecastSnapshotService, type FrozenProduct } from './ForecastSnapshotService';

const ENTITY_TYPE = 'forecast_purchase_decision';

const MSG_CORRIDA =
  'A quantidade decidida deste item acabou de ser gravada por outra pessoa. Atualize a tela e confira.';

export type AcaoDecisao = 'create' | 'update' | 'delete' | 'nenhuma';

export interface ForecastDecisoesData {
  snapshotId: number;
  label: string;
  decisoes: DecisaoCompraData[];
}

export interface ForecastDecisaoGravada {
  acao: AcaoDecisao;
  decisao: DecisaoCompraData | null;
}

type CampoAlterado = 'quantidadeKg' | 'status' | 'observacao';

function naoEncontrada(): HttpError {
  return new HttpError(404, 'Quinzena nao encontrada.');
}

function corrida(): HttpError {
  return new HttpError(409, MSG_CORRIDA);
}

function foraDaLista(): HttpError {
  return new HttpError(400, 'O item não está na lista de compra desta quinzena.');
}

// Quantidade decidida de compra (PR3 do piloto do Forecast), por item e quinzena. A quinzena excluida (soft delete) some
// da rota (404) e mantem as decisoes. O AuditLog guarda so ids, kg, rotulo da quinzena, status e se ha observacao: nunca o
// texto da observacao (texto livre). Este service importa o ForecastSnapshotService; o inverso nao existe (evita ciclo).
export class ForecastDecisaoCompraService {
  static async listar(snapshotId: number): Promise<ForecastDecisoesData> {
    const snapshot = await prisma.forecastSnapshot.findFirst({
      where: { id: snapshotId, deletedAt: null },
      select: { id: true, label: true },
    });
    if (!snapshot) throw naoEncontrada();
    const rows = await prisma.forecastPurchaseDecision.findMany({
      where: { snapshotId },
      orderBy: { productId: 'asc' },
    });
    return { snapshotId: snapshot.id, label: snapshot.label, decisoes: rows.map(paraDecisaoCompraData) };
  }

  // Grava (cria/atualiza/apaga) a decisao de um item. `quantidadeKg: null` apaga. Sem mudanca = 'nenhuma' (sem gravar nem
  // auditar). A quantidade nova (criar ou mudar) so vale para item da lista de compra e congela `suggestedKg`/`demandKg`.
  static async gravar(
    snapshotId: number,
    productId: number,
    input: ForecastDecisaoPutInput,
    userId: number | null,
  ): Promise<ForecastDecisaoGravada> {
    const snapshot = await prisma.forecastSnapshot.findFirst({
      where: { id: snapshotId, deletedAt: null },
      select: { id: true, label: true, products: true },
    });
    if (!snapshot) throw naoEncontrada();
    const produtos = snapshot.products as unknown as FrozenProduct[];
    if (!produtos.some((p) => p.productId === productId)) {
      throw new HttpError(400, 'O produto não faz parte desta quinzena.');
    }

    let item: ItemRelatorioCompras | null = null;
    if (input.quantidadeKg !== null) {
      const relatorio = await ForecastSnapshotService.getRelatorioCompras(snapshotId);
      item = itemDaListaDeCompra(relatorio, productId);
    }
    const label = snapshot.label;

    try {
      return await prisma.$transaction(async (tx) => {
        const viva = await tx.forecastSnapshot.findFirst({
          where: { id: snapshotId, deletedAt: null },
          select: { id: true },
        });
        if (!viva) throw naoEncontrada();

        const atual = await tx.forecastPurchaseDecision.findUnique({
          where: { snapshotId_productId: { snapshotId, productId } },
        });

        if (input.quantidadeKg === null) {
          if (!atual) return { acao: 'nenhuma' as const, decisao: null };
          const resultado = await tx.forecastPurchaseDecision.deleteMany({
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
                productId,
                label,
                quantidadeKg: Number(atual.quantityKg),
                sugeridaKg: Number(atual.suggestedKg),
                status: atual.status,
                comObservacao: atual.note != null,
              },
            },
            tx,
          );
          return { acao: 'delete' as const, decisao: null };
        }

        const quantidadeKg = input.quantidadeKg;

        if (!atual) {
          if (!item) throw foraDaLista();
          const criada = await tx.forecastPurchaseDecision.create({
            data: {
              snapshotId,
              productId,
              quantityKg: quantidadeKg,
              status: input.status ?? 'nao',
              note: input.observacao ?? null,
              suggestedKg: item.quantidadeFinal,
              demandKg: item.demanda,
              decidedById: userId,
            },
          });
          await AuditLogService.log(
            {
              entityType: ENTITY_TYPE,
              entityId: criada.id,
              action: 'create',
              performedById: userId,
              metadata: {
                snapshotId,
                productId,
                label,
                quantidadeKg,
                sugeridaKg: item.quantidadeFinal,
                demandaKg: item.demanda,
                status: criada.status,
                comObservacao: criada.note != null,
              },
            },
            tx,
          );
          return { acao: 'create' as const, decisao: paraDecisaoCompraData(criada) };
        }

        const camposAlterados: CampoAlterado[] = [];
        const data: Prisma.ForecastPurchaseDecisionUncheckedUpdateManyInput = {};
        if (Number(atual.quantityKg) !== quantidadeKg) {
          if (!item) throw foraDaLista();
          camposAlterados.push('quantidadeKg');
          data.quantityKg = quantidadeKg;
          // Mudou a quantidade: recongela a sugestao e a demanda do momento.
          data.suggestedKg = item.quantidadeFinal;
          data.demandKg = item.demanda;
        }
        if (input.status !== undefined && input.status !== atual.status) {
          camposAlterados.push('status');
          data.status = input.status;
        }
        if (input.observacao !== undefined && input.observacao !== atual.note) {
          camposAlterados.push('observacao');
          data.note = input.observacao;
        }
        if (camposAlterados.length === 0) {
          return { acao: 'nenhuma' as const, decisao: paraDecisaoCompraData(atual) };
        }

        const resultado = await tx.forecastPurchaseDecision.updateMany({
          where: { id: atual.id, updatedAt: atual.updatedAt },
          data: { ...data, decidedById: userId, updatedAt: new Date() },
        });
        if (resultado.count === 0) throw corrida();

        const depois = await tx.forecastPurchaseDecision.findUnique({ where: { id: atual.id } });
        if (!depois) throw corrida();
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: atual.id,
            action: 'update',
            performedById: userId,
            metadata: {
              snapshotId,
              productId,
              label,
              quantidadeKg: Number(depois.quantityKg),
              sugeridaKg: Number(depois.suggestedKg),
              demandaKg: Number(depois.demandKg),
              status: depois.status,
              comObservacao: depois.note != null,
              antes: { quantidadeKg: Number(atual.quantityKg), status: atual.status },
              camposAlterados,
            },
          },
          tx,
        );
        return { acao: 'update' as const, decisao: paraDecisaoCompraData(depois) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw corrida();
      }
      throw error;
    }
  }
}
