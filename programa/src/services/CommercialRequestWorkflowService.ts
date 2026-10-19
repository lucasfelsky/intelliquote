import { Prisma, QuoteRequestStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuditLogService } from './AuditLogService';
import { computeFinalPrices, findWinnerKind } from './CommercialRequestPriceService';
import { lockQuoteRequestForPurchaseOrders } from './QuotePurchaseOrderService';
import { buildQuoteRequestItemCreateData } from './QuoteRequestItemFactory';
import type { QuoteRequestCreateInput } from '../validators/domain';
import { HttpError } from '../utils/http';
import { buildRequestCode } from '../utils/requestCode';

// Acoes do COMEX sobre uma solicitacao do comercial (PR2).
//
// Regras:
// - Toda mudanca de status e' `updateMany` com o status esperado no WHERE; `count === 0`
//   lanca 409 dentro da transacao (rollback). O Postgres bloqueia a 2a transacao na linha e
//   reavalia o WHERE, entao a perdedora da corrida ve `count 0`.
// - Mutations com AuditLogService.log(..., tx).
// - Funcoes devolvem os ids das solicitacoes cujo status mudou; o chamador notifica o
//   solicitante APOS o commit.

const ENTITY_TYPE = 'commercial_request';
const INACTIVE_CATALOG_MESSAGE = 'Item de catalogo inativo. Reative-o antes de vincular a cotacao.';

// Opcoes das transacoes interativas que esperam lock (padrao do Prisma: 5 s).
const INTERACTIVE_TX_OPTIONS = { timeout: 15000, maxWait: 10000 };

// Mudanca de status gravada por uma acao. O aviso ao solicitante usa ESTES valores (e nao
// relê o banco), para duas mudancas rapidas nao gerarem dois e-mails do mesmo status.
export interface StatusChange {
  id: number;
  status: 'quoting' | 'fulfilled' | 'rejected';
  quoteCode: string | null;
  rejectionReason: string | null;
}

export interface CreateQuoteWithLinksResult {
  quoteRequest: unknown;
  changes: StatusChange[];
}

function liveQuoteCode(
  quote: { requestCode: string; deletedAt: Date | null } | null | undefined,
): string | null {
  return quote && quote.deletedAt === null ? quote.requestCode : null;
}

function transitionConflict(requestId: number): HttpError {
  return new HttpError(
    409,
    `A solicitacao #${requestId} mudou de status. Atualize a tela e tente de novo.`,
  );
}

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export class CommercialRequestWorkflowService {
  // (a) Cria a cotacao com os itens e vincula as solicitacoes na MESMA transacao.
  static async createQuoteWithLinks(
    payload: QuoteRequestCreateInput,
    userId: number,
  ): Promise<CreateQuoteWithLinksResult> {
    const items = payload.items ?? [];
    const requestIds = [...(payload.commercialRequestIds ?? [])].sort((a, b) => a - b);

    const catalogIds = items.map((item) => item.catalogItemId);
    const catalogItems = await prisma.catalogItem.findMany({
      where: { id: { in: catalogIds }, isActive: true },
      select: { id: true, commercialName: true },
    });
    if (catalogItems.length !== catalogIds.length) {
      throw new HttpError(400, 'Item de catalogo inativo ou inexistente.');
    }
    const commercialNameById = new Map(catalogItems.map((ci) => [ci.id, ci.commercialName]));

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const requests = await tx.commercialRequest.findMany({
        where: { id: { in: requestIds } },
        select: { id: true, status: true, items: { select: { id: true, catalogItemId: true } } },
      });
      const byId = new Map(requests.map((row) => [row.id, row]));
      for (const id of requestIds) {
        if (!byId.has(id)) throw new HttpError(404, `Solicitacao #${id} nao encontrada.`);
      }
      for (const id of requestIds) {
        if (byId.get(id)!.status !== 'pending') {
          throw new HttpError(409, `A solicitacao #${id} nao esta mais pendente.`);
        }
      }

      const payloadCatalogIds = new Set(catalogIds);
      for (const id of requestIds) {
        const matched = byId
          .get(id)!
          .items.filter((item) => payloadCatalogIds.has(item.catalogItemId));
        if (matched.length === 0) {
          throw new HttpError(400, `A solicitacao #${id} nao tem nenhum item nesta cotacao.`);
        }
      }

      const quoteRequest = await tx.quoteRequest.create({
        data: {
          requestCode: payload.requestCode ?? buildRequestCode(),
          productName: payload.productName ?? null,
          quantity: payload.quantity ?? null,
          description: payload.description ?? null,
          desiredIncoterm: payload.desiredIncoterm,
          destinationPort: payload.destinationPort ?? null,
          originPort: payload.originPort ?? 'Shanghai',
          currency: payload.currency ?? 'USD',
          deadlineAt: payload.deadlineAt ?? null,
          status: QuoteRequestStatus.open,
          createdById: userId,
        },
      });

      await AuditLogService.log(
        {
          entityType: 'quote_request',
          entityId: quoteRequest.id,
          action: 'create',
          performedById: userId,
          // Cotacao inteira (incoterm, moeda, prazo...), como o create comum grava.
          afterData: { ...quoteRequest, items: [], quoteResponses: [] },
          metadata: { commercialRequestIds: requestIds },
        },
        tx,
      );

      const createdItemIdByCatalog = new Map<number, number>();
      for (const item of items) {
        const created = await tx.quoteRequestItem.create({
          data: buildQuoteRequestItemCreateData({
            quoteRequestId: quoteRequest.id,
            catalogItemId: item.catalogItemId,
            catalogCommercialName: commercialNameById.get(item.catalogItemId) ?? null,
            quantity: item.quantity,
            unit: item.unit,
            targetPrice: item.targetPrice ?? null,
            notes: item.notes ?? null,
            quoteDestinationPort: quoteRequest.destinationPort,
          }),
          select: { id: true, catalogItemId: true, productName: true, quantity: true, unit: true },
        });
        createdItemIdByCatalog.set(item.catalogItemId, created.id);
        await AuditLogService.log(
          {
            entityType: 'quote_request_item',
            entityId: created.id,
            action: 'create',
            performedById: userId,
            afterData: created,
            metadata: {
              quoteRequestId: quoteRequest.id,
              catalogItemId: item.catalogItemId,
              commercialRequestIds: requestIds,
            },
          },
          tx,
        );
      }

      const now = new Date();
      for (const id of requestIds) {
        const updated = await tx.commercialRequest.updateMany({
          where: { id, status: 'pending' },
          data: {
            status: 'quoting',
            quoteRequestId: quoteRequest.id,
            statusChangedById: userId,
            statusChangedAt: now,
          },
        });
        if (updated.count === 0) throw transitionConflict(id);

        const linkedItemIds: number[] = [];
        const unlinkedItemIds: number[] = [];
        for (const crItem of byId.get(id)!.items) {
          const quoteItemId = createdItemIdByCatalog.get(crItem.catalogItemId);
          if (quoteItemId === undefined) {
            unlinkedItemIds.push(crItem.id);
            continue;
          }
          await tx.commercialRequestItem.update({
            where: { id: crItem.id },
            data: { quoteRequestItemId: quoteItemId },
          });
          linkedItemIds.push(crItem.id);
        }

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'link_quote',
            performedById: userId,
            beforeData: { status: 'pending' },
            afterData: { status: 'quoting', quoteRequestId: quoteRequest.id },
            metadata: {
              quoteRequestId: quoteRequest.id,
              via: 'create',
              linkedItemIds,
              unlinkedItemIds,
            },
          },
          tx,
        );
      }

      // Mesmo include do create atual de cotacao (itens ja criados nesta transacao).
      const full = await tx.quoteRequest.findUnique({
        where: { id: quoteRequest.id },
        include: {
          items: { include: { catalogItem: true }, orderBy: { createdAt: 'asc' } },
          quoteResponses: { where: { deletedAt: null } },
        },
      });

      return {
        quoteRequest: full,
        changes: requestIds.map((id) => ({
          id,
          status: 'quoting' as const,
          quoteCode: quoteRequest.requestCode,
          rejectionReason: null,
        })),
      };
    }, INTERACTIVE_TX_OPTIONS);
  }

  // (b) Vincula uma solicitacao pendente a uma cotacao aberta existente.
  static async linkToExistingQuote(
    requestId: number,
    quoteRequestId: number,
    userId: number,
  ): Promise<StatusChange[]> {
    const exists = await prisma.commercialRequest.findUnique({
      where: { id: requestId },
      select: { id: true },
    });
    if (!exists) throw new HttpError(404, 'Solicitacao nao encontrada.');

    const quoteCode = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Ordem de lock "QuoteRequest primeiro" (#104): serializa com close/reopen/delete/PO.
      await lockQuoteRequestForPurchaseOrders(tx, quoteRequestId);

      const quote = await tx.quoteRequest.findFirst({
        where: { id: quoteRequestId, deletedAt: null },
        select: {
          id: true,
          status: true,
          currency: true,
          destinationPort: true,
          requestCode: true,
        },
      });
      if (!quote) throw new HttpError(404, 'Cotacao nao encontrada.');
      if (quote.status !== QuoteRequestStatus.open) {
        throw new HttpError(409, 'Somente cotacoes abertas aceitam vinculo.');
      }

      const request = await tx.commercialRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          status: true,
          items: {
            orderBy: { id: 'asc' },
            select: {
              id: true,
              catalogItemId: true,
              quantity: true,
              unit: true,
              targetPrice: true,
              targetCurrency: true,
            },
          },
        },
      });
      if (!request) throw new HttpError(404, 'Solicitacao nao encontrada.');
      if (request.status !== 'pending') {
        throw new HttpError(409, `A solicitacao #${requestId} nao esta mais pendente.`);
      }

      // Item igual (mesmo catalogItemId, nao excluido): reaproveita o mais antigo, sem somar
      // quantidade nem alterar alvo.
      const existingItems = await tx.quoteRequestItem.findMany({
        where: {
          quoteRequestId,
          deletedAt: null,
          catalogItemId: { in: request.items.map((item) => item.catalogItemId) },
        },
        select: { id: true, catalogItemId: true },
        orderBy: { id: 'asc' },
      });
      const existingByCatalog = new Map<number, number>();
      for (const item of existingItems) {
        if (item.catalogItemId !== null && !existingByCatalog.has(item.catalogItemId)) {
          existingByCatalog.set(item.catalogItemId, item.id);
        }
      }

      const toCreate = request.items.filter((item) => !existingByCatalog.has(item.catalogItemId));
      const commercialNameById = new Map<number, string>();
      if (toCreate.length > 0) {
        const wantedIds = [...new Set(toCreate.map((item) => item.catalogItemId))];
        const catalogItems = await tx.catalogItem.findMany({
          where: { id: { in: wantedIds }, isActive: true },
          select: { id: true, commercialName: true },
        });
        if (catalogItems.length !== wantedIds.length) {
          throw new HttpError(400, INACTIVE_CATALOG_MESSAGE);
        }
        for (const ci of catalogItems) commercialNameById.set(ci.id, ci.commercialName);
      }

      const updated = await tx.commercialRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: {
          status: 'quoting',
          quoteRequestId,
          statusChangedById: userId,
          statusChangedAt: new Date(),
        },
      });
      if (updated.count === 0) throw transitionConflict(requestId);

      const quoteCurrency = quote.currency.trim().toUpperCase();
      const reusedItemIds: number[] = [];
      const createdItemIds: number[] = [];
      for (const crItem of request.items) {
        let quoteItemId = existingByCatalog.get(crItem.catalogItemId);
        if (quoteItemId !== undefined) {
          reusedItemIds.push(quoteItemId);
        } else {
          // targetPrice so e' copiado com a mesma moeda da cotacao (ela nao tem moeda por item).
          const sameCurrency = (crItem.targetCurrency ?? '').trim().toUpperCase() === quoteCurrency;
          const created = await tx.quoteRequestItem.create({
            data: buildQuoteRequestItemCreateData({
              quoteRequestId,
              catalogItemId: crItem.catalogItemId,
              catalogCommercialName: commercialNameById.get(crItem.catalogItemId) ?? null,
              quantity: crItem.quantity,
              unit: crItem.unit,
              targetPrice: sameCurrency ? decimalToNumber(crItem.targetPrice) : null,
              quoteDestinationPort: quote.destinationPort,
              purchaseOrderId: null,
            }),
            select: {
              id: true,
              catalogItemId: true,
              productName: true,
              quantity: true,
              unit: true,
            },
          });
          quoteItemId = created.id;
          createdItemIds.push(created.id);
          await AuditLogService.log(
            {
              entityType: 'quote_request_item',
              entityId: created.id,
              action: 'create',
              performedById: userId,
              afterData: created,
              metadata: {
                quoteRequestId,
                catalogItemId: crItem.catalogItemId,
                commercialRequestIds: [requestId],
              },
            },
            tx,
          );
        }

        await tx.commercialRequestItem.update({
          where: { id: crItem.id },
          data: { quoteRequestItemId: quoteItemId },
        });
      }

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: requestId,
          action: 'link_quote',
          performedById: userId,
          beforeData: { status: 'pending' },
          afterData: { status: 'quoting', quoteRequestId },
          metadata: { quoteRequestId, via: 'link', reusedItemIds, createdItemIds },
        },
        tx,
      );

      return quote.requestCode;
    }, INTERACTIVE_TX_OPTIONS);

    return [{ id: requestId, status: 'quoting', quoteCode, rejectionReason: null }];
  }

  // (c) Recusa com motivo. Vinculos com a cotacao sao mantidos (historico).
  static async reject(requestId: number, reason: string, userId: number): Promise<StatusChange[]> {
    const quoteCode = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const current = await tx.commercialRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          status: true,
          quoteRequest: { select: { requestCode: true, deletedAt: true } },
        },
      });
      if (!current) throw new HttpError(404, 'Solicitacao nao encontrada.');

      const updated = await tx.commercialRequest.updateMany({
        where: { id: requestId, status: { in: ['pending', 'quoting'] } },
        data: {
          status: 'rejected',
          rejectionReason: reason,
          statusChangedById: userId,
          statusChangedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw new HttpError(
          409,
          'Somente solicitacoes pendentes ou em cotacao podem ser recusadas.',
        );
      }

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: requestId,
          action: 'reject',
          performedById: userId,
          beforeData: { status: current.status },
          afterData: { status: 'rejected', rejectionReason: reason },
        },
        tx,
      );

      return liveQuoteCode(current.quoteRequest);
    });

    return [{ id: requestId, status: 'rejected', quoteCode, rejectionReason: reason }];
  }

  // (d) Marca atendida: exige vencedor; so admin forca sem preco (com motivo).
  static async fulfill(
    requestId: number,
    input: { force?: boolean; note?: string },
    user: { id: number; role: string },
  ): Promise<StatusChange[]> {
    const force = input.force === true;
    if (force && user.role !== 'admin') {
      throw new HttpError(403, 'Somente administradores podem atender sem preco.');
    }

    const quoteCode = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const current = await tx.commercialRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          status: true,
          quoteRequestId: true,
          quoteRequest: { select: { requestCode: true, deletedAt: true } },
          items: { select: { id: true, quoteRequestItemId: true } },
        },
      });
      if (!current) throw new HttpError(404, 'Solicitacao nao encontrada.');
      if (current.status !== 'quoting') {
        throw new HttpError(
          409,
          'Somente solicitacoes em cotacao podem ser marcadas como atendidas.',
        );
      }

      const winnerKind =
        current.quoteRequestId !== null &&
        current.quoteRequest !== null &&
        current.quoteRequest.deletedAt === null
          ? await findWinnerKind(tx, current.quoteRequestId)
          : null;
      if (winnerKind === null && !force) {
        throw new HttpError(
          409,
          'A cotacao vinculada ainda nao tem vencedor; marque o vencedor na Comparacao antes de atender.',
        );
      }

      // Ter vencedor nao basta: ao menos 1 item VINCULADO precisa ter preco efetivo do vencedor
      // (mesma regra do preco final mostrado ao comercial). So admin com force dispensa.
      if (!force && current.quoteRequestId !== null) {
        const prices = await computeFinalPrices(tx, [
          {
            status: 'fulfilled',
            quoteRequestId: current.quoteRequestId,
            quoteRequest: current.quoteRequest,
            items: current.items ?? [],
          },
        ]);
        if (![...prices.values()].some((price) => price !== null)) {
          throw new HttpError(
            409,
            'O vencedor da cotacao nao tem preco para nenhum item desta solicitacao.',
          );
        }
      }

      const fulfillmentNote = force ? (input.note ?? null) : null;
      const updated = await tx.commercialRequest.updateMany({
        where: { id: requestId, status: 'quoting' },
        data: {
          status: 'fulfilled',
          fulfillmentNote,
          statusChangedById: user.id,
          statusChangedAt: new Date(),
        },
      });
      if (updated.count === 0) throw transitionConflict(requestId);

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: requestId,
          action: 'fulfill',
          performedById: user.id,
          beforeData: { status: 'quoting' },
          afterData: { status: 'fulfilled', fulfillmentNote },
          metadata: { force, winnerKind },
        },
        tx,
      );

      return liveQuoteCode(current.quoteRequest);
    });

    return [{ id: requestId, status: 'fulfilled', quoteCode, rejectionReason: null }];
  }
}
