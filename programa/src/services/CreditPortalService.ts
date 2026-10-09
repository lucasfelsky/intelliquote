import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { PortalHttpError } from '../utils/portalHttpError';
import { hashToken } from '../utils/tokens';
import type { CreditPortalSubmitInput } from '../validators/supplierPortal';
import { AuditLogService } from './AuditLogService';
import { CREDIT_SUPPORT_ENTITY_TYPE, serializeRequest } from './CreditSupportService';
import { lockQuoteRequestForPurchaseOrders } from './QuotePurchaseOrderService';
import { PORTAL_INVALID_LINK_MESSAGE } from './SupplierPortalService';

// Portal publico do parceiro de credito (PR2b). O token bruto so existe na URL do
// e-mail: aqui ele vira hash (SHA-256) antes de qualquer consulta e NUNCA e gravado,
// logado ou auditado. O payload publico e montado campo a campo (allowlist).

type DbClient = PrismaClient | Prisma.TransactionClient;
type AccessKind = 'VIEW' | 'SUBMIT' | 'INVALID';

export const CREDIT_PORTAL_QUOTE_CLOSED_MESSAGE =
  'This quote has been closed. Responses are no longer accepted.';
export const CREDIT_PORTAL_CONFLICT_MESSAGE =
  'Your response could not be saved due to a conflict. Please reload the page and try again.';

const MAX_MONEY = new Prisma.Decimal('999999999999.99');

const validateInclude = {
  quoteRequest: { select: { id: true, requestCode: true, status: true, deletedAt: true } },
} satisfies Prisma.CreditSupportRequestInclude;

const viewInclude = {
  items: { orderBy: { position: 'asc' as const } },
  supplier: { select: { id: true, name: true, country: true } },
  creditPartner: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  quoteRequest: { select: { requestCode: true, status: true } },
} satisfies Prisma.CreditSupportRequestInclude;

export type ValidatedCreditRequest = Prisma.CreditSupportRequestGetPayload<{
  include: typeof validateInclude;
}>;

export interface CreditAccessLogInput {
  creditSupportRequestId: number | null;
  kind: AccessKind;
  ip?: string | null;
  userAgent?: string | null;
  reason?: string;
}

export interface CreditPortalMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface CreditPortalSubmitParams {
  requestId: number;
  quoteRequestId: number;
  rawTokenHash: string;
  payload: CreditPortalSubmitInput;
  ip: string | null;
  userAgent: string | null;
}

function round2(value: number | string): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function invalidLink(): PortalHttpError {
  return new PortalHttpError(404, PORTAL_INVALID_LINK_MESSAGE);
}

/** Log de acesso ao portal do parceiro. `meta` nunca contem token, hash ou URL. */
export async function logCreditAccess(
  input: CreditAccessLogInput,
  client: DbClient = prisma,
): Promise<void> {
  await client.supplierPortalTokenLog.create({
    data: {
      tokenId: null,
      creditSupportRequestId: input.creditSupportRequestId,
      kind: input.kind,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      meta: { portal: 'credit', ...(input.reason ? { reason: input.reason } : {}) },
    },
  });
}

export class CreditPortalService {
  static logAccess = logCreditAccess;

  /**
   * Resolve o token bruto para o encaminhamento. Sequencia igual ao portal do fornecedor
   * (+ cotacao excluida): not_found -> revoked -> expired -> quote_deleted, cada um com log
   * INVALID e 404 generico. Sem efeito colateral de VIEW.
   */
  static async validate(input: {
    rawToken: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ValidatedCreditRequest> {
    const tokenHash = hashToken(input.rawToken);
    const record = await prisma.creditSupportRequest.findUnique({
      where: { tokenHash },
      include: validateInclude,
    });
    const now = new Date();

    if (!record) {
      await logCreditAccess({
        creditSupportRequestId: null,
        kind: 'INVALID',
        ip: input.ip,
        userAgent: input.userAgent,
        reason: 'not_found',
      }).catch(() => undefined);
      throw invalidLink();
    }

    const reject = async (reason: string): Promise<never> => {
      await logCreditAccess({
        creditSupportRequestId: record.id,
        kind: 'INVALID',
        ip: input.ip,
        userAgent: input.userAgent,
        reason,
      });
      throw invalidLink();
    };

    if (record.revokedAt) return reject('revoked');
    if (record.expiresAt <= now) return reject('expired');
    if (record.quoteRequest.deletedAt) return reject('quote_deleted');

    return record;
  }

  /** Conta a visualizacao (inclusive apos resposta: a revisao e permitida) e loga VIEW. */
  static async recordView(
    record: Pick<ValidatedCreditRequest, 'id' | 'firstSeenAt'>,
    meta: CreditPortalMeta,
  ): Promise<void> {
    const now = new Date();
    await prisma.creditSupportRequest.update({
      where: { id: record.id },
      data: {
        accessCount: { increment: 1 },
        firstSeenAt: record.firstSeenAt ?? now,
        lastSeenAt: now,
      },
    });
    await logCreditAccess({
      creditSupportRequestId: record.id,
      kind: 'VIEW',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /** Payload publico do parceiro: allowlist EXATA do contrato, montada campo a campo. */
  static async buildPartnerView(id: number) {
    const row = await prisma.creditSupportRequest.findUnique({
      where: { id },
      include: viewInclude,
    });
    if (!row) {
      throw invalidLink();
    }

    const s = serializeRequest(row, false);
    const closed = row.quoteRequest.status === 'closed';

    return {
      request: {
        requestCode: row.quoteRequest.requestCode,
        currency: s.currency,
        incoterm: s.offeredIncoterm,
        originPort: s.originPort,
        expiresAt: s.expiresAt,
        closed,
        readOnly: closed,
      },
      supplier: {
        name: s.supplier.name,
        country: s.supplier.country,
      },
      partner: {
        name: s.partner.name,
      },
      items: s.items.map((item) => ({
        quoteRequestItemId: item.quoteRequestItemId,
        productName: item.productName,
        itemCode: item.itemCode,
        unit: item.unit,
        quantity: item.quantity,
        isUnavailable: item.isUnavailable,
        originPort: item.originPort,
        isDangerousGood: item.isDangerousGood,
        originalUnitPrice: item.originalUnitPrice,
        originalTotalPrice: item.originalTotalPrice,
        partnerUnitPrice: item.partnerUnitPrice,
        partnerTotalPrice: item.partnerTotalPrice,
        markupPercent: item.markupPercent,
      })),
      totals: {
        original: s.totals.original,
        partner: s.totals.partner,
        markupPercent: s.totals.markupPercent,
      },
      response:
        s.respondedAt === null
          ? null
          : {
              paymentTermsDays: s.partnerPaymentTermsDays,
              validityDays: s.partnerValidityDays,
              notes: s.partnerNotes,
              respondedAt: s.respondedAt,
              version: s.responseVersion,
            },
    };
  }

  /**
   * Grava (ou revisa) a resposta do parceiro. Dentro da transacao: lock da cotacao
   * (mesma ordem de fechar/reabrir/excluir e do PR2a), releitura com checagens de corrida,
   * regras de negocio contra o snapshot, updateMany condicional e auditoria (sem token/ip/UA).
   */
  static async submit(params: CreditPortalSubmitParams) {
    const { requestId, quoteRequestId, rawTokenHash, payload } = params;

    await prisma.$transaction(async (tx) => {
      await lockQuoteRequestForPurchaseOrders(tx, quoteRequestId);
      const now = new Date();

      const before = await tx.creditSupportRequest.findUnique({
        where: { id: requestId },
        include: {
          items: { orderBy: { position: 'asc' } },
          quoteRequest: { select: { status: true, deletedAt: true } },
        },
      });
      if (
        !before ||
        before.tokenHash !== rawTokenHash ||
        before.revokedAt ||
        before.expiresAt <= now ||
        before.quoteRequest.deletedAt
      ) {
        throw invalidLink();
      }
      if (before.quoteRequest.status === 'closed') {
        throw new PortalHttpError(409, CREDIT_PORTAL_QUOTE_CLOSED_MESSAGE, 'QUOTE_CLOSED');
      }

      // Resumo do estado anterior capturado ANTES de qualquer escrita (auditoria).
      const revised = before.respondedAt !== null;
      const previousRespondedAt = before.respondedAt;
      const previousVersion = before.responseVersion;
      const previousSummary = revised
        ? {
            responseVersion: before.responseVersion,
            partnerPaymentTermsDays: before.partnerPaymentTermsDays,
            partnerValidityDays: before.partnerValidityDays,
            partnerTotalPrice:
              before.partnerTotalPrice === null ? null : before.partnerTotalPrice.toFixed(2),
            items: before.items.map((item) => ({
              quoteRequestItemId: item.quoteRequestItemId,
              partnerUnitPrice:
                item.partnerUnitPrice === null ? null : item.partnerUnitPrice.toFixed(2),
              partnerTotalPrice:
                item.partnerTotalPrice === null ? null : item.partnerTotalPrice.toFixed(2),
            })),
          }
        : null;

      // Regras de negocio (ordem do contrato).
      const snapshot = new Map(before.items.map((item) => [item.quoteRequestItemId, item]));
      const seen = new Set<number>();
      for (const input of payload.items) {
        const id = input.quoteRequestItemId;
        if (seen.has(id)) {
          throw new PortalHttpError(
            400,
            `Duplicate item in the response (id=${id}). Please reload the page.`,
          );
        }
        seen.add(id);
        const item = snapshot.get(id);
        if (!item) {
          throw new PortalHttpError(
            400,
            `Item id=${id} is not part of this request. Please reload the page.`,
          );
        }
        if (item.isUnavailable) {
          throw new PortalHttpError(
            400,
            `Item id=${id} is temporarily unavailable and cannot be priced.`,
          );
        }
      }
      for (const item of before.items) {
        if (!item.isUnavailable && !seen.has(item.quoteRequestItemId)) {
          throw new PortalHttpError(400, 'Provide a unit price for every available item.');
        }
      }

      const priced: Array<{
        itemId: number;
        quoteRequestItemId: number;
        unitPrice: Prisma.Decimal;
        totalPrice: Prisma.Decimal;
      }> = [];
      let partnerTotal = new Prisma.Decimal(0);
      for (const input of payload.items) {
        const item = snapshot.get(input.quoteRequestItemId)!;
        const unitPrice = round2(input.unitPrice);
        if (unitPrice.isZero()) {
          throw new PortalHttpError(400, 'Unit prices must be greater than zero.');
        }
        const totalPrice = unitPrice.times(item.quantity);
        if (totalPrice.greaterThan(MAX_MONEY)) {
          throw new PortalHttpError(400, 'The total price is too large.');
        }
        partnerTotal = partnerTotal.plus(totalPrice);
        if (partnerTotal.greaterThan(MAX_MONEY)) {
          throw new PortalHttpError(400, 'The total price is too large.');
        }
        priced.push({
          itemId: item.id,
          quoteRequestItemId: item.quoteRequestItemId,
          unitPrice,
          totalPrice,
        });
      }

      const updated = await tx.creditSupportRequest.updateMany({
        where: {
          id: requestId,
          tokenHash: rawTokenHash,
          revokedAt: null,
          expiresAt: { gt: now },
          quoteRequest: { deletedAt: null, status: { not: 'closed' } },
        },
        data: {
          partnerPaymentTermsDays: payload.paymentTermsDays,
          partnerValidityDays: payload.validityDays,
          partnerNotes: payload.notes ?? null,
          partnerTotalPrice: partnerTotal,
          responseVersion: { increment: 1 },
          respondedAt: previousRespondedAt ?? now,
          submitterIp: params.ip,
          submitterUserAgent: params.userAgent,
        },
      });
      if (updated.count === 0) {
        throw new PortalHttpError(409, CREDIT_PORTAL_CONFLICT_MESSAGE);
      }

      for (const entry of priced) {
        await tx.creditSupportRequestItem.update({
          where: { id: entry.itemId },
          data: { partnerUnitPrice: entry.unitPrice, partnerTotalPrice: entry.totalPrice },
        });
      }

      await AuditLogService.log(
        {
          entityType: CREDIT_SUPPORT_ENTITY_TYPE,
          entityId: requestId,
          action: revised ? 'partner_revise' : 'partner_submit',
          performedById: null,
          beforeData: previousSummary,
          afterData: {
            responseVersion: previousVersion + 1,
            partnerPaymentTermsDays: payload.paymentTermsDays,
            partnerValidityDays: payload.validityDays,
            partnerTotalPrice: partnerTotal.toFixed(2),
            items: priced.map((entry) => ({
              quoteRequestItemId: entry.quoteRequestItemId,
              partnerUnitPrice: entry.unitPrice.toFixed(2),
              partnerTotalPrice: entry.totalPrice.toFixed(2),
            })),
          },
          metadata: { portal: 'credit' },
        },
        tx,
      );
    });

    const view = await this.buildPartnerView(requestId);
    return {
      respondedAt: view.response?.respondedAt ?? null,
      version: view.response?.version ?? 0,
      totals: view.totals,
      items: view.items,
    };
  }
}
