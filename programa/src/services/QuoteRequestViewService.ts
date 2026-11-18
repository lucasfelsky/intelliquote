import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * "Resposta nova" por usuario na lista de cotacoes.
 *
 * Referencia do usuario U para a cotacao Q = QuoteRequestView(U,Q).lastSeenAt ?? User(U).createdAt.
 * Q tem resposta nova se, depois da referencia, houve:
 *  - snapshot de preco (QuoteResponsePriceSnapshot.recordedAt), exceto o manual lancado pelo proprio U; ou
 *  - resposta do portal (SupplierPortalResponse.submittedAt) - cobre revisao que so mudou prazo/validade.
 * `QuoteResponse.updatedAt` NAO entra: muda em vencedor/comparacao/preco-alvo (falso positivo).
 */

export interface NewResponseSnapshot {
  quoteRequestId: number;
  recordedAt: Date;
  source: string;
  performedById: number | null;
}

/** Funcao pura: devolve os ids de cotacao com resposta nova para o usuario. */
export function computeNewResponseIds(input: {
  userId: number;
  userCreatedAt: Date;
  quoteRequestIds: number[];
  lastSeenByQuoteRequestId: Map<number, Date>;
  snapshots: NewResponseSnapshot[];
  portalLatestSubmittedAt: Map<number, Date>;
}): Set<number> {
  const referenceOf = (quoteRequestId: number): number =>
    (input.lastSeenByQuoteRequestId.get(quoteRequestId) ?? input.userCreatedAt).getTime();

  const wanted = new Set(input.quoteRequestIds);
  const result = new Set<number>();

  for (const snapshot of input.snapshots) {
    if (!wanted.has(snapshot.quoteRequestId) || result.has(snapshot.quoteRequestId)) continue;
    if (snapshot.source === 'manual' && snapshot.performedById === input.userId) continue;
    if (snapshot.recordedAt.getTime() > referenceOf(snapshot.quoteRequestId)) {
      result.add(snapshot.quoteRequestId);
    }
  }

  for (const [quoteRequestId, submittedAt] of input.portalLatestSubmittedAt) {
    if (!wanted.has(quoteRequestId) || result.has(quoteRequestId)) continue;
    if (submittedAt.getTime() > referenceOf(quoteRequestId)) result.add(quoteRequestId);
  }

  return result;
}

export class QuoteRequestViewService {
  /** Marca a cotacao como vista agora (upsert pela unique composta). */
  static async markSeen(
    userId: number,
    quoteRequestId: number,
    client: PrismaClient | Prisma.TransactionClient = prisma,
  ) {
    const now = new Date();
    return client.quoteRequestView.upsert({
      where: { userId_quoteRequestId: { userId, quoteRequestId } },
      create: { userId, quoteRequestId, lastSeenAt: now },
      update: { lastSeenAt: now },
      select: { quoteRequestId: true, lastSeenAt: true },
    });
  }

  /** Ids (entre os informados) com resposta de fornecedor posterior a ultima abertura do usuario. */
  static async findIdsWithNewResponses(
    userId: number,
    quoteRequestIds: number[],
    client: PrismaClient | Prisma.TransactionClient = prisma,
  ): Promise<Set<number>> {
    if (quoteRequestIds.length === 0) return new Set();

    const [views, user] = await Promise.all([
      client.quoteRequestView.findMany({
        where: { userId, quoteRequestId: { in: quoteRequestIds } },
        select: { quoteRequestId: true, lastSeenAt: true },
      }),
      client.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    ]);
    if (!user) return new Set();

    const lastSeenByQuoteRequestId = new Map(views.map((view) => [view.quoteRequestId, view.lastSeenAt]));

    // Estreita a leitura: nada anterior a menor referencia do lote pode contar.
    let minReference = user.createdAt;
    for (const id of quoteRequestIds) {
      const seen = lastSeenByQuoteRequestId.get(id);
      if (seen && seen < minReference) minReference = seen;
    }

    const [snapshotRows, portalRows] = await Promise.all([
      client.quoteResponsePriceSnapshot.findMany({
        where: {
          recordedAt: { gt: minReference },
          quoteResponse: {
            deletedAt: null,
            quoteRequestId: { in: quoteRequestIds },
            quoteRequest: { deletedAt: null },
          },
          NOT: { source: 'manual', performedById: userId },
        },
        select: {
          recordedAt: true,
          source: true,
          performedById: true,
          quoteResponse: { select: { quoteRequestId: true } },
        },
      }),
      client.supplierPortalResponse.groupBy({
        by: ['quoteRequestId'],
        where: {
          deletedAt: null,
          quoteRequestId: { in: quoteRequestIds },
          submittedAt: { gt: minReference },
        },
        _max: { submittedAt: true },
      }),
    ]);

    const portalLatestSubmittedAt = new Map<number, Date>();
    for (const row of portalRows) {
      const submittedAt = row._max.submittedAt;
      if (submittedAt) portalLatestSubmittedAt.set(row.quoteRequestId, submittedAt);
    }

    return computeNewResponseIds({
      userId,
      userCreatedAt: user.createdAt,
      quoteRequestIds,
      lastSeenByQuoteRequestId,
      snapshots: snapshotRows.map((row) => ({
        quoteRequestId: row.quoteResponse.quoteRequestId,
        recordedAt: row.recordedAt,
        source: row.source,
        performedById: row.performedById,
      })),
      portalLatestSubmittedAt,
    });
  }
}
