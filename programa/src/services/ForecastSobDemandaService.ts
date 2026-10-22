import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { ForecastSobDemandaPatchInput } from '../validators/forecast';
import { HttpError } from '../utils/http';
import { AuditLogService } from './AuditLogService';

type Db = Prisma.TransactionClient | typeof prisma;

const ENTITY_TYPE = 'forecast_product';

export interface ForecastSobDemandaData {
  productId: number;
  sobDemanda: boolean;
  motivo: string | null;
}

// Compra sob demanda (PR 6a): o produto so e comprado quando o cliente envia a programacao. A marca mora no cadastro
// do produto (nao na quinzena) e o import da planilha nao a sobrescreve; o relatorio le o valor ATUAL.
export class ForecastSobDemandaService {
  // Marca ou desmarca. `sobDemanda: false` limpa o motivo. Sem alteracao nao grava nem audita. O AuditLog guarda so
  // ids e flags: nunca o texto do motivo nem o nome do produto.
  static async patch(
    productId: number,
    input: ForecastSobDemandaPatchInput,
    userId: number | null,
  ): Promise<ForecastSobDemandaData> {
    return prisma.$transaction(async (tx) => {
      const product = await tx.forecastProduct.findUnique({
        where: { id: productId },
        select: { id: true, purchaseOnDemand: true, purchaseOnDemandNote: true },
      });
      if (!product) throw new HttpError(404, 'Produto nao encontrado.');

      const sobDemanda = input.sobDemanda;
      const motivo = sobDemanda ? (input.motivo ?? null) : null;
      const alterado = product.purchaseOnDemand !== sobDemanda || product.purchaseOnDemandNote !== motivo;
      if (alterado) {
        await tx.forecastProduct.update({
          where: { id: productId },
          data: { purchaseOnDemand: sobDemanda, purchaseOnDemandNote: motivo },
        });
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: productId,
            action: 'purchase_on_demand_update',
            performedById: userId,
            metadata: { antes: product.purchaseOnDemand, depois: sobDemanda, comMotivo: motivo !== null },
          },
          tx,
        );
      }
      return { productId, sobDemanda, motivo };
    });
  }

  // Produtos marcados entre os informados (1 consulta). O gateway so precisa trocar este provedor.
  static async regrasDosProdutos(
    productIds: number[],
    db: Db = prisma,
  ): Promise<Map<number, { motivo: string | null }>> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return new Map();
    const rows = await db.forecastProduct.findMany({
      where: { id: { in: ids }, purchaseOnDemand: true },
      select: { id: true, purchaseOnDemandNote: true },
    });
    return new Map(rows.map((r) => [r.id, { motivo: r.purchaseOnDemandNote }]));
  }
}
