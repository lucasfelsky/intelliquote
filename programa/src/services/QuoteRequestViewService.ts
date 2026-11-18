import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * "Resposta nova" por usuario na lista de cotacoes.
 *
 * Referencia do usuario U para a cotacao Q = QuoteRequestView(U,Q).lastSeenAt ?? User(U).createdAt.
 * Q tem resposta nova se, depois da referencia, houve:
 *  - snapshot de preco (QuoteResponsePriceSnapshot.recordedAt), exceto o manual lancado pelo proprio U
 *    (manual com performedById NULL conta: nao e de ninguem); ou
 *  - resposta do portal (SupplierPortalResponse.submittedAt) - cobre revisao que so mudou prazo/validade.
 * `QuoteResponse.updatedAt` NAO entra: muda em vencedor/comparacao/preco-alvo (falso positivo).
 *
 * Baseline preguicoso: usuario elegivel sem NENHUMA linha em QuoteRequestView (promovido/novo depois do
 * backfill da migracao) recebe `lastSeenAt = agora` em todas as cotacoes ativas na primeira listagem com
 * `withNewResponses` ou na primeira abertura (`markSeen`), para nao acender a lista inteira.
 */

export interface NewResponseSnapshot {
  quoteRequestId: number;
  recordedAt: Date;
  source: string;
  performedById: number | null;
}

/**
 * Predicado unico (funcao pura e filtro SQL): so o snapshot manual lancado pelo proprio usuario
 * deixa de contar. Manual com performedById NULL conta.
 */
export function isCountableSnapshot(
  snapshot: Pick<NewResponseSnapshot, 'source' | 'performedById'>,
  userId: number,
): boolean {
  return !(snapshot.source === 'manual' && snapshot.performedById === userId);
}

/** Menor `lastSeenAt ?? userCreatedAt` do lote (lista vazia -> userCreatedAt). */
export function computeMinReference(
  quoteRequestIds: number[],
  lastSeenByQuoteRequestId: Map<number, Date>,
  userCreatedAt: Date,
): Date {
  let min = quoteRequestIds.length === 0 ? userCreatedAt : null;
  for (const id of quoteRequestIds) {
    const reference = lastSeenByQuoteRequestId.get(id) ?? userCreatedAt;
    if (min === null || reference < min) min = reference;
  }
  return min ?? userCreatedAt;
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
    if (!isCountableSnapshot(snapshot, input.userId)) continue;
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
  /**
   * Baseline preguicoso: se o usuario nao tem NENHUMA linha em QuoteRequestView, grava
   * `lastSeenAt = agora` para todas as cotacoes ativas (deletedAt null) e devolve true; senao false.
   *
   * - Chamado na primeira listagem com `withNewResponses` e no `markSeen` (quem abre uma cotacao por
   *   link/e-mail antes de ver a lista tambem ganha baseline).
   * - Idempotente e seguro sob corrida: `createMany ... skipDuplicates` e um unico INSERT ... ON CONFLICT
   *   DO NOTHING; duas abas simultaneas veem zero linhas, a segunda vira no-op e nenhuma lanca P2002.
   * - Sem AuditLog: e recibo de leitura, nao dado de negocio (mesma excecao do `markSeen`).
   * - Residuo: quem ja tinha linhas, perdeu e recuperou o acesso nao recebe baseline novo.
   */
  static async ensureBaseline(
    userId: number,
    client: PrismaClient | Prisma.TransactionClient = prisma,
  ): Promise<boolean> {
    const existing = await client.quoteRequestView.findFirst({ where: { userId }, select: { id: true } });
    if (existing) return false;

    const quoteRequests = await client.quoteRequest.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (quoteRequests.length > 0) {
      const now = new Date();
      await client.quoteRequestView.createMany({
        data: quoteRequests.map((quoteRequest) => ({
          userId,
          quoteRequestId: quoteRequest.id,
          lastSeenAt: now,
        })),
        skipDuplicates: true,
      });
    }
    return true;
  }

  /** Marca a cotacao como vista agora (upsert pela unique composta), garantindo antes o baseline. */
  static async markSeen(
    userId: number,
    quoteRequestId: number,
    client: PrismaClient | Prisma.TransactionClient = prisma,
  ) {
    await QuoteRequestViewService.ensureBaseline(userId, client);
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

    // Pagina sem view: so entao vale perguntar se o usuario nao tem nenhuma. Se nao tinha,
    // o baseline foi gravado agora e nada acende nesta chamada.
    if (views.length === 0 && (await QuoteRequestViewService.ensureBaseline(userId, client))) {
      return new Set();
    }

    const lastSeenByQuoteRequestId = new Map(views.map((view) => [view.quoteRequestId, view.lastSeenAt]));

    // Corte global da leitura = menor referencia real do lote; a referencia por cotacao continua em
    // computeNewResponseIds, entao o resultado nao muda.
    const minReference = computeMinReference(quoteRequestIds, lastSeenByQuoteRequestId, user.createdAt);

    const [snapshotRows, portalRows] = await Promise.all([
      client.quoteResponsePriceSnapshot.findMany({
        where: {
          recordedAt: { gt: minReference },
          quoteResponse: {
            deletedAt: null,
            quoteRequestId: { in: quoteRequestIds },
            quoteRequest: { deletedAt: null },
          },
          // Equivalente SQL de isCountableSnapshot: `performedById <> x` com NULL tambem e NULL,
          // por isso o ramo `null` explicito (manual sem autor conta).
          OR: [{ source: { not: 'manual' } }, { performedById: null }, { performedById: { not: userId } }],
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
