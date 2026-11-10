import { Prisma, QuoteRequestStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  statusDaCotacao,
  type CotacaoVinculadaData,
} from '../utils/forecastCotacaoVinculo';
import { AuditLogService } from './AuditLogService';

const ENTITY_TYPE = 'forecast_purchase_decision';

// Envio que conta como "enviada": o evento terminou com ao menos um e-mail entregue (completed/partial).
const STATUS_ENVIO_ENTREGUE = ['completed', 'partial'];

export interface RegistroDeEnvio {
  /** Decisoes atualizadas pelo envio (itens vinculados ao Forecast que existem na cotacao). */
  atualizadas: number;
}

// Leitura e escrita do vinculo cotacao <-> Forecast (E4a). Leitura: a cotacao viva MAIS RECENTE vinculada a cada item da
// quinzena (itens e cotacoes excluidos nao contam). Escrita: o gancho do ENVIO aos fornecedores, que preenche a Qtd. final.
export class ForecastCotacaoVinculoService {
  // productId -> cotacao vinculada (a de maior id). Sem vinculo = ausente do mapa.
  static async cotacoesDosItens(
    snapshotId: number,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<Map<number, CotacaoVinculadaData>> {
    const itens = await db.quoteRequestItem.findMany({
      where: {
        forecastSnapshotId: snapshotId,
        forecastProductId: { not: null },
        deletedAt: null,
        quoteRequest: { deletedAt: null },
      },
      select: {
        forecastProductId: true,
        quoteRequest: {
          select: {
            id: true,
            requestCode: true,
            status: true,
            purchaseOrderSentAt: true,
            dispatchEvents: { where: { status: { in: STATUS_ENVIO_ENTREGUE } }, select: { id: true }, take: 1 },
          },
        },
      },
      orderBy: { quoteRequestId: 'asc' },
    });
    const mapa = new Map<number, CotacaoVinculadaData>();
    for (const item of itens) {
      if (item.forecastProductId === null) continue;
      const q = item.quoteRequest;
      // Ordem crescente: a ultima gravada no mapa e a de maior id.
      mapa.set(item.forecastProductId, {
        id: q.id,
        requestCode: q.requestCode,
        statusCotacao: statusDaCotacao({
          status: q.status === QuoteRequestStatus.closed ? 'closed' : 'open',
          purchaseOrderSentAt: q.purchaseOrderSentAt,
          enviada: q.dispatchEvents.length > 0,
        }),
      });
    }
    return mapa;
  }

  // Gancho do envio (DispatchController.create, depois de gravar o evento): para cada item da cotacao vinculado ao Forecast,
  // grava a Qtd. final = quantidade COTADA (QuoteRequestItem.quantity, kg inteiro), `finalAt` (so no 1o envio desta cotacao;
  // reenvios nao mexem na data) e `finalQuoteRequestId`, e leva o status da decisao a 'cotando' SO quando ainda e 'nao' (nunca
  // regride preco/confirmado/po). Decisao inexistente (apagada depois da criacao da cotacao) e ignorada. Tudo numa transacao
  // com AuditLog (ids, kg e status; nunca a observacao). O CHAMADOR captura qualquer erro: o envio nunca cai por causa daqui.
  static async registrarEnvio(quoteRequestId: number, userId: number | null): Promise<RegistroDeEnvio> {
    const itens = await prisma.quoteRequestItem.findMany({
      where: {
        quoteRequestId,
        deletedAt: null,
        forecastSnapshotId: { not: null },
        forecastProductId: { not: null },
      },
      select: { forecastSnapshotId: true, forecastProductId: true, quantity: true },
    });
    if (itens.length === 0) return { atualizadas: 0 };

    return prisma.$transaction(async (tx) => {
      const agora = new Date();
      let atualizadas = 0;
      for (const item of itens) {
        const snapshotId = item.forecastSnapshotId as number;
        const productId = item.forecastProductId as number;
        const atual = await tx.forecastPurchaseDecision.findUnique({
          where: { snapshotId_productId: { snapshotId, productId } },
        });
        if (!atual) continue;

        const primeiroEnvio = atual.finalQuoteRequestId !== quoteRequestId || atual.finalAt === null;
        const novoStatus = atual.status === 'nao' ? 'cotando' : atual.status;
        const mudou =
          primeiroEnvio ||
          Number(atual.finalKg ?? Number.NaN) !== item.quantity ||
          novoStatus !== atual.status;
        if (!mudou) continue;

        const resultado = await tx.forecastPurchaseDecision.updateMany({
          where: { id: atual.id, updatedAt: atual.updatedAt },
          data: {
            finalKg: item.quantity,
            finalAt: primeiroEnvio ? agora : atual.finalAt,
            finalQuoteRequestId: quoteRequestId,
            status: novoStatus,
            updatedAt: agora,
          },
        });
        // Outra pessoa gravou a decisao no meio: nao sobrescreve; a proxima leitura/envio reconcilia.
        if (resultado.count === 0) continue;
        atualizadas += 1;
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: atual.id,
            action: 'update',
            performedById: userId,
            metadata: {
              snapshotId,
              productId,
              via: 'envio-cotacao',
              quoteRequestId,
              finalKg: item.quantity,
              status: novoStatus,
              camposAlterados: ['finalKg', ...(primeiroEnvio ? ['finalAt'] : []), 'finalQuoteRequestId', ...(novoStatus !== atual.status ? ['status'] : [])],
              antes: {
                finalKg: atual.finalKg === null ? null : Number(atual.finalKg),
                finalQuoteRequestId: atual.finalQuoteRequestId,
                status: atual.status,
              },
            },
          },
          tx,
        );
      }
      return { atualizadas };
    });
  }
}
