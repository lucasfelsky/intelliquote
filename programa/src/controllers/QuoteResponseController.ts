import { Request, Response } from 'express';
import { Incoterm, Prisma, QuoteRequestStatus, SupplierStatus } from '@prisma/client';
import {
  classifyForComparison,
  describePartialBasket,
  isInconsistentBasket,
  priceAtRequestedQuantity,
} from '../utils/quoteBasket';
import { buildDangerousGoodItems } from '../utils/dangerousGoods';
import { buildItemOrigins, normalizeItemOriginPort } from '../utils/originPort';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  comparisonCandidateKey,
  QuoteComparisonService,
  type QuoteComparisonWeights,
} from '../services/QuoteComparisonService';
import {
  clearCreditWinners,
  clearStaleCreditWinners,
  CREDIT_OFFER_CHANGED_MESSAGE,
  isManualWinnerActive,
  loadCreditAlternatives,
  loadCreditCandidateForAward,
  type CreditCandidateForAward,
  type CreditPartnerRef,
  persistedWinnerOf,
  type PartnerContactRef,
} from '../services/ComparisonCandidateService';
import { CompanyProfileService, readDispatchCc } from '../services/CompanyProfileService';
import { SupplierPortalService } from '../services/SupplierPortalService';
import { QuoteResponsePriceHistoryService } from '../services/QuoteResponsePriceHistoryService';
import { sendPurchaseOrderEmail } from '../services/PurchaseOrderEmailService';
import { sendAndLog } from '../mailer/MailerService';
import { renderReplyFromTemplate, type QuoteReplyItem } from '../mailer/renderQuoteReply';
import { logger } from '../lib/logger';
import { formatIncoterms, mergeManualIncotermPrices } from '../utils/incoterm';
import { buildPortalLink } from '../utils/portalLink';
import {
  quoteComparisonWeightsSchema,
  quotePurchaseOrderSchema,
  quoteResponseCreateSchema,
  quoteResponseReplySchema,
  quoteResponseUpdateSchema,
  quoteWinnerOverrideSchema,
} from '../validators/domain';
import {
  handleControllerError,
  HttpError,
  parseId,
} from '../utils/http';

export class QuoteResponseController {
  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const parsedBody = quoteResponseCreateSchema.safeParse(req.body);

      if (!parsedBody.success) {
        return res.status(400).json({
          message:
            'Informe quoteRequestId, supplierId, offeredPrice e demais dados da proposta com valores validos.',
        });
      }

      const payload = parsedBody.data;

      const relatedQuoteRequest = await prisma.quoteRequest.findUnique({
        where: { id: payload.quoteRequestId },
      });

      if (!relatedQuoteRequest) {
        return res.status(404).json({
          message: 'Cotacao nao encontrada para vincular a proposta.',
        });
      }

      if (relatedQuoteRequest.status === 'closed') {
        return res.status(400).json({
          message: 'Nao e possivel registrar propostas em cotacoes fechadas.',
        });
      }

      const relatedSupplier = await prisma.supplier.findUnique({
        where: { id: payload.supplierId },
      });

      if (!relatedSupplier) {
        return res.status(404).json({
          message: 'Fornecedor nao encontrado para vincular a proposta.',
        });
      }

      if (relatedSupplier.status !== SupplierStatus.active) {
        return res.status(400).json({
          message: 'Somente fornecedores ativos podem receber propostas.',
        });
      }

      if (!relatedSupplier.acceptedIncoterms.includes(payload.offeredIncoterm)) {
        return res.status(400).json({
          message:
            'O incoterm informado nao esta entre os incoterms aceites pelo fornecedor.',
        });
      }

      let finalOfferedPrice = payload.offeredPrice;
      let itemsToCreate: any[] = [];

      if (payload.items && payload.items.length > 0) {
        let total = 0;
        itemsToCreate = payload.items.map((item) => {
          // Item indisponivel: valores ignorados e gravados como 0 (fora da soma).
          if (item.isUnavailable) {
            return unavailableItemData(item.quoteRequestItemId, item.notes);
          }
          if (item.unitPrice === undefined || item.quantity === undefined) {
            throw new HttpError(400, 'Informe unitPrice e quantity para os itens disponiveis.');
          }
          const totalPrice = item.unitPrice * item.quantity;
          total += totalPrice;
          return {
            quoteRequestItemId: item.quoteRequestItemId,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalPrice,
            leadTimeDays: item.leadTimeDays ?? null,
            notes: item.notes ?? null,
            // null = herda a origem geral da proposta
            originPort: normalizeItemOriginPort(item.originPort, payload.originPort),
            isDangerousGood: item.isDangerousGood ?? false,
          };
        });
        finalOfferedPrice = total;
      }

      if (finalOfferedPrice === undefined) {
        return res.status(400).json({
          message:
            'E necessario informar o preco agregado (offeredPrice) ou enviar a lista de itens com precos.',
        });
      }

      const normalizedCurrency = payload.currency ?? relatedQuoteRequest.currency;
      const landedCost = QuoteComparisonService.calculateLandedCost({
        offeredPrice: finalOfferedPrice,
        currency: normalizedCurrency,
        exchangeRate: resolveExchangeRate(payload.exchangeRate, normalizedCurrency),
        freightCost: payload.freightCost ?? 0,
        insuranceCost: payload.insuranceCost ?? 0,
        otherFees: payload.otherFees ?? 0,
        importDutyRate: payload.importDuty ?? 0,
        ipiRate: payload.ipi ?? 0,
        pisRate: payload.pis ?? 0,
        cofinsRate: payload.cofins ?? 0,
      });

      const existing = await prisma.quoteResponse.findUnique({
        where: { quoteRequestId_supplierId: { quoteRequestId: payload.quoteRequestId, supplierId: payload.supplierId } },
        include: { items: true },
      });
      if (existing && !existing.deletedAt) {
        throw new HttpError(409, 'Ja existe uma proposta ativa deste fornecedor nesta cotacao. Edite a proposta existente.');
      }
      const data: Prisma.QuoteResponseUncheckedCreateInput = {
        quoteRequestId: payload.quoteRequestId,
        supplierId: payload.supplierId,
        offeredPrice: finalOfferedPrice,
        targetPrice: payload.targetPrice ?? null,
        currency: normalizedCurrency,
        exchangeRate: landedCost.exchangeRate,
        freightCost: landedCost.freightCost,
        insuranceCost: landedCost.insuranceCost,
        otherFees: landedCost.otherFees,
        importDuty: landedCost.importDutyRate,
        ipi: landedCost.ipiRate,
        pis: landedCost.pisRate,
        cofins: landedCost.cofinsRate,
        totalLandedCost: landedCost.totalLandedCost,
        offeredIncoterm: payload.offeredIncoterm as Incoterm,
        paymentTermsDays: payload.paymentTermsDays,
        leadTimeDays: payload.leadTimeDays ?? null,
        notes: payload.notes ?? null,
        originPort: payload.originPort ?? null,
        submittedAt: payload.submittedAt,
        createdById: req.user?.id ?? null,
        items: {
          create: itemsToCreate,
        },
      };
      // Reenvio explicito apos exclusao inicia outra versao do mesmo vinculo.
      // Itens antigos e snapshots continuam disponiveis para auditoria.
      // Transacao: o snapshot de preco (historico) e gravado junto com a resposta.
      const quoteResponse = await prisma.$transaction(async (tx) => {
        const saved = existing
          ? await tx.quoteResponse.update({
              where: { id: existing.id, deletedAt: { not: null } },
              data: { ...data, deletedAt: null, isWinner: false, version: { increment: 1 },
                items: { updateMany: { where: { deletedAt: null }, data: { deletedAt: new Date() } }, create: itemsToCreate },
              },
            })
          : await tx.quoteResponse.create({ data });
        await QuoteResponsePriceHistoryService.record(tx, saved.id, { source: 'manual', performedById: req.user?.id ?? null });
        return saved;
      });

      await AuditLogService.log({
        entityType: 'quote_response',
        entityId: quoteResponse.id,
        action: existing ? 'restore' : 'create',
        beforeData: existing ?? undefined,
        performedById: req.user?.id ?? null,
        afterData: quoteResponse,
        metadata: {
          quoteRequestId: quoteResponse.quoteRequestId,
          supplierId: quoteResponse.supplierId,
        },
      });

      return res.status(201).json(quoteResponse);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getAll(_req: Request, res: Response): Promise<Response> {
    try {
      const quoteResponses = await prisma.quoteResponse.findMany({
        where: { deletedAt: null, quoteRequest: { deletedAt: null } },
        include: {
          supplier: true,
          quoteRequest: true,
          items: {
            where: { deletedAt: null },
            include: { quoteRequestItem: { select: { productName: true } } },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      const portalLookup = await prisma.supplierPortalToken.findMany({
        where: {
          responseId: { in: quoteResponses.map((r) => r.id) },
        },
        select: { responseId: true },
      });
      const portalSet = new Set(
        portalLookup.map((entry) => entry.responseId).filter((v): v is number => v !== null),
      );

      const decorated = quoteResponses.map((response) => ({
        ...response,
        source: portalSet.has(response.id) ? 'portal' : 'manual',
      }));

      return res.status(200).json(decorated);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getById(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({
          message: 'ID da proposta invalido.',
        });
      }

      const quoteResponse = await prisma.quoteResponse.findUnique({
        where: { id, deletedAt: null },
        include: {
          supplier: true,
          quoteRequest: true,
        },
      });

      if (!quoteResponse) {
        return res.status(404).json({
          message: 'Proposta nao encontrada.',
        });
      }

      return res.status(200).json(quoteResponse);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({
          message: 'ID da proposta invalido.',
        });
      }

      if (hasOwnProperty(req.body, 'isWinner')) {
        return res.status(400).json({
          message:
            'A proposta vencedora so pode ser definida pelo endpoint de comparacao da cotacao.',
        });
      }

      const parsedBody = quoteResponseUpdateSchema.safeParse(req.body);

      if (!parsedBody.success) {
        return res.status(400).json({
          message: 'Os dados enviados para atualizar a proposta sao invalidos.',
        });
      }

      const payload = parsedBody.data;

      const existingQuoteResponse = await prisma.quoteResponse.findUnique({
        where: { id, deletedAt: null },
        include: {
          quoteRequest: true,
          supplier: true,
        },
      });

      if (!existingQuoteResponse) {
        return res.status(404).json({
          message: 'Proposta nao encontrada.',
        });
      }

      if (
        payload.quoteRequestId !== undefined &&
        payload.quoteRequestId !== existingQuoteResponse.quoteRequestId
      ) {
        return res.status(400).json({
          message: 'Nao e permitido mover uma proposta para outra cotacao.',
        });
      }

      if (
        payload.supplierId !== undefined &&
        payload.supplierId !== existingQuoteResponse.supplierId
      ) {
        return res.status(400).json({
          message: 'Nao e permitido trocar o fornecedor de uma proposta existente.',
        });
      }

      if (existingQuoteResponse.quoteRequest.status === QuoteRequestStatus.closed) {
        return res.status(400).json({
          message: 'Reabra a cotacao antes de alterar propostas.',
        });
      }

      if (existingQuoteResponse.supplier.status !== SupplierStatus.active) {
        return res.status(400).json({
          message: 'Somente fornecedores ativos podem manter propostas ativas.',
        });
      }

      const nextIncoterm =
        (payload.offeredIncoterm as Incoterm | undefined) ??
        existingQuoteResponse.offeredIncoterm;

      if (!existingQuoteResponse.supplier.acceptedIncoterms.includes(nextIncoterm)) {
        return res.status(400).json({
          message:
            'O incoterm informado nao esta entre os incoterms aceites pelo fornecedor.',
        });
      }

      let finalOfferedPrice = payload.offeredPrice !== undefined
        ? payload.offeredPrice
        : Number(existingQuoteResponse.offeredPrice);

      let itemsToUpdate: any[] | undefined = undefined;

      if (payload.items) {
        if (payload.items.length > 0) {
          // Moeda alterada: precos por incoterm anteriores estao na moeda antiga e nao ha
          // conversao segura -> a proposta volta a ser de preco unico (DbNull).
          const currencyChanged =
            payload.currency !== undefined &&
            payload.currency !== existingQuoteResponse.currency;
          const previousItems = await prisma.quoteResponseItem.findMany({
            where: { quoteResponseId: id, deletedAt: null },
            select: {
              quoteRequestItemId: true,
              incotermPrices: true,
              originPort: true,
              isDangerousGood: true,
            },
          });
          const previousMap = new Map(
            currencyChanged
              ? []
              : previousItems.map((prev) => [prev.quoteRequestItemId, prev.incotermPrices]),
          );
          const previousOrigins = new Map(
            previousItems.map((prev) => [prev.quoteRequestItemId, prev.originPort]),
          );
          const previousDangerousGoods = new Map(
            previousItems.map((prev) => [prev.quoteRequestItemId, prev.isDangerousGood]),
          );
          const finalGeneralOrigin =
            payload.originPort !== undefined
              ? payload.originPort
              : existingQuoteResponse.originPort;
          let total = 0;
          itemsToUpdate = payload.items.map((item) => {
            if (item.isUnavailable) {
              return unavailableItemData(item.quoteRequestItemId, item.notes);
            }
            if (item.unitPrice === undefined || item.quantity === undefined) {
              throw new HttpError(400, 'Informe unitPrice e quantity para os itens disponiveis.');
            }
            const totalPrice = item.unitPrice * item.quantity;
            total += totalPrice;
            return {
              quoteRequestItemId: item.quoteRequestItemId,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              totalPrice,
              leadTimeDays: item.leadTimeDays ?? null,
              notes: item.notes ?? null,
              // undefined = preserva a origem anterior do item; null/igual a geral = herda
              originPort: normalizeItemOriginPort(
                item.originPort === undefined
                  ? previousOrigins.get(item.quoteRequestItemId)
                  : item.originPort,
                finalGeneralOrigin,
              ),
              // undefined = preserva o DG anterior do item
              isDangerousGood:
                item.isDangerousGood ??
                previousDangerousGoods.get(item.quoteRequestItemId) ??
                false,
              incotermPrices: previousMap.has(item.quoteRequestItemId)
                ? mergeManualIncotermPrices(
                    previousMap.get(item.quoteRequestItemId),
                    nextIncoterm,
                    item.unitPrice,
                    item.quantity,
                  )
                : Prisma.DbNull,
            };
          });
          finalOfferedPrice = total;
        } else {
          itemsToUpdate = [];
        }
      }

      const nextCurrency = payload.currency ?? existingQuoteResponse.currency;
      const landedCost = QuoteComparisonService.calculateLandedCost({
        offeredPrice: finalOfferedPrice,
        currency: nextCurrency,
        exchangeRate: resolveExchangeRate(
          payload.exchangeRate ?? Number(existingQuoteResponse.exchangeRate),
          nextCurrency,
        ),
        freightCost:
          payload.freightCost !== undefined
            ? payload.freightCost
            : Number(existingQuoteResponse.freightCost),
        insuranceCost:
          payload.insuranceCost !== undefined
            ? payload.insuranceCost
            : Number(existingQuoteResponse.insuranceCost),
        otherFees:
          payload.otherFees !== undefined
            ? payload.otherFees
            : Number(existingQuoteResponse.otherFees),
        importDutyRate:
          payload.importDuty !== undefined
            ? payload.importDuty
            : Number(existingQuoteResponse.importDuty),
        ipiRate:
          payload.ipi !== undefined
            ? payload.ipi
            : Number(existingQuoteResponse.ipi),
        pisRate:
          payload.pis !== undefined
            ? payload.pis
            : Number(existingQuoteResponse.pis),
        cofinsRate:
          payload.cofins !== undefined
            ? payload.cofins
            : Number(existingQuoteResponse.cofins),
      });

      // Transacao: o snapshot de preco (historico) e gravado junto com a resposta.
      const quoteResponse = await prisma.$transaction(async (tx) => {
        const saved = await tx.quoteResponse.update({
          where: { id, deletedAt: null },
          data: {
            offeredPrice: finalOfferedPrice,
            targetPrice: payload.targetPrice !== undefined ? payload.targetPrice : undefined,
            currency: nextCurrency,
            exchangeRate: landedCost.exchangeRate,
            freightCost: landedCost.freightCost,
            insuranceCost: landedCost.insuranceCost,
            otherFees: landedCost.otherFees,
            importDuty: landedCost.importDutyRate,
            ipi: landedCost.ipiRate,
            pis: landedCost.pisRate,
            cofins: landedCost.cofinsRate,
            totalLandedCost: landedCost.totalLandedCost,
            offeredIncoterm: payload.offeredIncoterm as Incoterm | undefined,
            paymentTermsDays: payload.paymentTermsDays,
            leadTimeDays: payload.leadTimeDays,
            notes: payload.notes,
            originPort: payload.originPort,
            submittedAt: payload.submittedAt,
            version: shouldIncrementVersion(payload) ? { increment: 1 } : undefined,
            // Proposta com item indisponivel sai do ranking e nao pode ser vencedora (como no sync do portal).
            isWinner: itemsToUpdate?.some((item) => item.isUnavailable) ? false : undefined,
            items: itemsToUpdate !== undefined ? { updateMany: { where: { deletedAt: null }, data: { deletedAt: new Date() } }, create: itemsToUpdate } : undefined,
          },
        });
        await QuoteResponsePriceHistoryService.record(tx, saved.id, { source: 'manual', performedById: req.user?.id ?? null });
        return saved;
      });

      // PR4a: reset simetrico da alternativa via parceiro (mesma condicao do isWinner acima;
      // sem transacao, idempotente).
      if (itemsToUpdate?.some((item) => item.isUnavailable)) {
        await prisma.creditSupportRequest.updateMany({
          where: { quoteResponseId: id, isWinner: true },
          data: { isWinner: false },
        });
      }
      // PR4b: preco/quantidade/moeda/incoterm mudou e o encaminhamento ficou stale => deixa de
      // ser vencedor (so' os stale de verdade; re-salvar igual nao derruba). Fora da transacao.
      const clearedCreditWinnerIds = await clearStaleCreditWinners(prisma, id);

      await AuditLogService.log({
        entityType: 'quote_response',
        entityId: quoteResponse.id,
        action: 'update',
        performedById: req.user?.id ?? null,
        beforeData: existingQuoteResponse,
        afterData: quoteResponse,
        metadata: {
          quoteRequestId: existingQuoteResponse.quoteRequestId,
          supplierId: existingQuoteResponse.supplierId,
          ...(clearedCreditWinnerIds.length > 0 ? { clearedCreditWinnerIds } : {}),
        },
      });

      return res.status(200).json(quoteResponse);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async delete(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({
          message: 'ID da proposta invalido.',
        });
      }

      const existingQuoteResponse = await prisma.quoteResponse.findUnique({
        where: { id, deletedAt: null },
        include: {
          quoteRequest: true,
        },
      });

      if (!existingQuoteResponse) {
        return res.status(404).json({
          message: 'Proposta nao encontrada.',
        });
      }

      if (existingQuoteResponse.quoteRequest.status === QuoteRequestStatus.closed) {
        return res.status(400).json({
          message: 'Reabra a cotacao antes de remover propostas.',
        });
      }

      const deletedAt = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.quoteResponse.update({
          where: { id, deletedAt: null, quoteRequest: { status: { not: 'closed' }, deletedAt: null } },
          data: {
            deletedAt,
            isWinner: false,
            items: { updateMany: { where: { deletedAt: null }, data: { deletedAt } } },
          },
        });
        // PR4a: a alternativa via parceiro desta proposta tambem deixa de ser vencedora.
        await clearCreditWinners(tx, { quoteResponseId: id });
        // Os links existentes nao podem reativar uma proposta removida.
        await tx.supplierPortalToken.updateMany({
          where: {
            quoteRequestId: existingQuoteResponse.quoteRequestId,
            supplierId: existingQuoteResponse.supplierId,
            revokedAt: null,
          },
          data: { revokedAt: deletedAt },
        });
        await AuditLogService.log({
          entityType: 'quote_response',
          entityId: existingQuoteResponse.id,
          action: 'delete',
          performedById: req.user?.id ?? null,
          beforeData: existingQuoteResponse,
          afterData: { deletedAt, isWinner: false },
          metadata: {
            quoteRequestId: existingQuoteResponse.quoteRequestId,
            supplierId: existingQuoteResponse.supplierId,
          },
        }, tx);
      });

      return res.status(204).send();
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  // Monta o contexto comum ao preview e ao envio de verdade do botao
  // "Responder": proposta + cotacao + itens + contato principal do
  // fornecedor + CC da empresa. Devolve `null` com a resposta ja escrita
  // quando algo impede a resposta de ser montada (404/400), pra reply() e
  // replyPreview() nao duplicarem essa checagem.
  private static async loadReplyContext(
    id: number,
    res: Response,
  ): Promise<{
    quoteResponse: NonNullable<Awaited<ReturnType<typeof QuoteResponseController.findReplyQuoteResponse>>>;
    primaryContact: { id: number; email: string; name: string };
    companyCc: Array<{ email: string; name: string }>;
  } | null> {
    const quoteResponse = await QuoteResponseController.findReplyQuoteResponse(id);
    if (!quoteResponse) {
      res.status(404).json({ message: 'Proposta nao encontrada.' });
      return null;
    }

    const primaryContact = await prisma.supplierContact.findFirst({
      where: { supplierId: quoteResponse.supplierId },
      orderBy: { isPrimary: 'desc' },
    });

    if (!primaryContact) {
      res.status(400).json({
        message: 'Fornecedor nao possui contato cadastrado para receber a resposta.',
      });
      return null;
    }

    const profile = await CompanyProfileService.get();
    const companyCc = readDispatchCc(profile).map((email) => ({ email, name: '' }));

    return { quoteResponse, primaryContact, companyCc };
  }

  // "@fulano@sqquimica.com" na mensagem da modal de "Responder" adiciona
  // esse endereco em CC -- e-mail nao tem mention de verdade (nao ha o que
  // "clicar" pra notificar alguem), entao CC e o jeito que realmente
  // avisa a pessoa. O texto da mensagem continua exatamente como digitado.
  private static readonly MENTION_EMAIL_REGEX = /@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

  private static mergeMentionedCc(
    companyCc: Array<{ email: string; name: string }>,
    message: string | undefined,
  ): Array<{ email: string; name: string }> {
    if (!message) return companyCc;
    const mentioned = new Set<string>();
    for (const match of message.matchAll(QuoteResponseController.MENTION_EMAIL_REGEX)) {
      mentioned.add(match[1].toLowerCase());
    }
    if (mentioned.size === 0) return companyCc;
    const seen = new Set(companyCc.map((c) => c.email.toLowerCase()));
    const merged = [...companyCc];
    for (const email of mentioned) {
      if (!seen.has(email)) {
        merged.push({ email, name: '' });
        seen.add(email);
      }
    }
    return merged;
  }

  private static findReplyQuoteResponse(id: number) {
    return prisma.quoteResponse.findFirst({
      where: { id, deletedAt: null },
      include: {
        supplier: true,
        items: { where: { deletedAt: null } },
        quoteRequest: {
          include: {
            items: { where: { deletedAt: null }, include: { catalogItem: true }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
  }

  // Assunto REALMENTE enviado no e-mail de envio inicial (dispatch) da cotacao
  // para um contato deste fornecedor: MailLog mais recente (sent/queued) com
  // templateId 'quote-dispatch'. Casa pelo supplierContactId gravado em
  // templateVars; fallback pelo e-mail do destinatario. Sem log -> null (o
  // chamador cai no assunto do template/padrao legado).
  private static async findDispatchSubjectForSupplier(
    quoteRequestId: number,
    supplierId: number,
  ): Promise<string | null> {
    const contacts = await prisma.supplierContact.findMany({
      where: { supplierId },
      select: { id: true, email: true },
    });
    if (contacts.length === 0) return null;
    const contactIds = new Set(contacts.map((c) => c.id));
    const contactEmails = new Set(contacts.map((c) => c.email.trim().toLowerCase()));

    // O filtro do fornecedor vai no WHERE (nao em memoria): cotacao enviada a muitos
    // contatos tem um MailLog por contato, e o do fornecedor alvo pode estar fora dos
    // N mais recentes da cotacao inteira. Casa por supplierContactId (numero; string por
    // garantia) ou pelo e-mail do destinatario (case-insensitive).
    const logs = await prisma.mailLog.findMany({
      where: {
        templateId: 'quote-dispatch',
        relatedEntityType: 'quote_request',
        relatedEntityId: String(quoteRequestId),
        status: { in: ['sent', 'queued'] },
        OR: [
          { toEmail: { in: [...contactEmails], mode: 'insensitive' } },
          ...contacts.flatMap((c) => [
            { templateVars: { path: ['supplierContactId'], equals: c.id } },
            { templateVars: { path: ['supplierContactId'], equals: String(c.id) } },
          ]),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { subject: true, toEmail: true, templateVars: true },
    });

    for (const log of logs) {
      const subject = log.subject?.trim();
      if (!subject) continue;
      const vars = log.templateVars as { supplierContactId?: unknown } | null;
      const rawContactId = vars?.supplierContactId;
      const logContactId =
        typeof rawContactId === 'number' ? rawContactId : typeof rawContactId === 'string' ? Number(rawContactId) : null;
      if (logContactId !== null && contactIds.has(logContactId)) return subject;
      if (contactEmails.has((log.toEmail ?? '').trim().toLowerCase())) return subject;
    }
    return null;
  }

  // Renderiza o e-mail de resposta para uma proposta, aplicando o
  // assunto/mensagem digitados na hora (na modal de "Responder") por cima
  // do template padrao/customizado (`quote_reply`, ver Templates.tsx).
  //
  // Precedencia do assunto: digitado > assunto do envio inicial (MailLog do
  // dispatch) > assunto do template do banco > padrao legado.
  private static async renderReplyFor(
    quoteResponse: NonNullable<Awaited<ReturnType<typeof QuoteResponseController.findReplyQuoteResponse>>>,
    overrides: {
      subject?: string;
      message?: string;
      targetPrice?: number | null;
      itemTargets?: { quoteResponseItemId: number; targetPrice: number | null }[];
    },
    contactName: string,
    // Link do portal (token cru dentro da URL): so' entra no HTML/texto do
    // e-mail. Nunca vai para templateVars/AuditLog/logger.
    portalLink?: string,
  ) {
    const { quoteRequest, supplier } = quoteResponse;
    const itemName = quoteRequest.productName || quoteRequest.requestCode;
    const defaultSubject = `${itemName} - SQ QUIMICA - ${supplier.name}`;
    const message = overrides.message?.trim() ?? '';
    const typedSubject = overrides.subject?.trim() ?? '';
    const subjectOverride =
      typedSubject ||
      (await QuoteResponseController.findDispatchSubjectForSupplier(quoteRequest.id, quoteResponse.supplierId)) ||
      undefined;
    // QuoteResponse guarda um preco agregado por fornecedor (nao por item);
    // repetimos o mesmo unitPrice em todas as linhas em vez de mostrar "-",
    // que escondia o preco que o fornecedor de fato ofertou.
    const unitPrice = Number(quoteResponse.offeredPrice);

    // Target price POR ITEM: override (digitado na hora, ainda nao
    // persistido) tem prioridade sobre o valor ja gravado em
    // QuoteResponseItem.targetPrice.
    const itemTargetOverrides = new Map<number, number | null>();
    for (const t of overrides.itemTargets ?? []) {
      itemTargetOverrides.set(t.quoteResponseItemId, t.targetPrice);
    }

    // Preco-alvo AGREGADO efetivo (override > persistido).
    const aggregateTarget: number | undefined =
      overrides.targetPrice !== undefined
        ? (overrides.targetPrice === null ? undefined : overrides.targetPrice)
        : (quoteResponse.targetPrice ? Number(quoteResponse.targetPrice) : undefined);

    // Alvo por linha (coluna TARGET PRICE):
    //  - >=2 itens na proposta: so' o alvo POR ITEM (o agregado e' ignorado);
    //  - 1 item: o agregado vale como alvo daquele item (o do proprio item vence);
    //  - 0 itens (proposta legada): o agregado aparece em todas as linhas.
    const responseItemCount = quoteResponse.items?.length ?? 0;
    const aggregateAppliesToRows = responseItemCount <= 1 && aggregateTarget !== undefined;

    let hasItemTargets = false;
    const items: QuoteReplyItem[] = quoteRequest.items.map((item) => {
      const responseItem = quoteResponse.items?.find((i) => i.quoteRequestItemId === item.id);
      if (responseItem?.isUnavailable) {
        // Fornecedor marcou "Temporarily unavailable": sem preco e sem target no e-mail.
        return {
          name: item.catalogItem?.marketName ?? item.productName,
          incoterm: item.desiredIncoterm ?? formatIncoterms(quoteRequest.desiredIncoterm),
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: null,
          targetPrice: null,
          isUnavailable: true,
        };
      }
      const actualUnitPrice = responseItem ? Number(responseItem.unitPrice) : (Number.isFinite(unitPrice) ? unitPrice : null);
      const overrideTarget = responseItem ? itemTargetOverrides.get(responseItem.id) : undefined;
      let itemTargetPrice: number | null = overrideTarget !== undefined
        ? overrideTarget
        : (responseItem?.targetPrice != null ? Number(responseItem.targetPrice) : null);
      let targetFromAggregate = false;
      // Com 1 item, o agregado ocupa a linha desse item; com 0 itens, todas.
      if (itemTargetPrice === null && aggregateAppliesToRows && (responseItem || responseItemCount === 0)) {
        itemTargetPrice = aggregateTarget ?? null;
        targetFromAggregate = itemTargetPrice !== null;
      }
      if (itemTargetPrice !== null) hasItemTargets = true;
      return {
        name: item.catalogItem?.marketName ?? item.productName,
        incoterm: item.desiredIncoterm ?? formatIncoterms(quoteRequest.desiredIncoterm),
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: actualUnitPrice,
        targetPrice: itemTargetPrice,
        ...(targetFromAggregate ? { targetFromAggregate: true } : {}),
      };
    });

    const rendered = await renderReplyFromTemplate(
      {
        subject: defaultSubject,
        quoteRequestId: quoteRequest.id,
        requestCode: quoteRequest.requestCode,
        productName: quoteRequest.productName ?? '',
        supplierName: supplier.name,
        supplierContactName: contactName,
        currency: quoteResponse.currency,
        // Multi-item usa SO' os targets por item: o agregado (eventualmente
        // antigo) nao entra no e-mail.
        targetPrice: responseItemCount <= 1 ? aggregateTarget : undefined,
        hasItemTargets,
        isWinner: quoteResponse.isWinner,
        items,
        message,
        portalLink,
      },
      undefined,
      subjectOverride,
    );

    return {
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };
  }

  // Renderiza o e-mail sem enviar nada -- usado pela modal de "Responder"
  // pra mostrar o preview antes do usuario confirmar o envio (mesmo padrao
  // do preview de disparo de cotacao).
  static async replyPreview(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID da proposta invalido.' });
      }

      const parsedBody = quoteResponseReplySchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        return res.status(400).json({
          message: parsedBody.error.issues[0]?.message ?? 'Dados invalidos.',
        });
      }

      const context = await QuoteResponseController.loadReplyContext(id, res);
      if (!context) return res;
      const { quoteResponse, primaryContact } = context;
      const companyCc = QuoteResponseController.mergeMentionedCc(context.companyCc, parsedBody.data.message);

      // Preview NUNCA emite nem rotaciona token: link ficticio do portal.
      const rendered = await QuoteResponseController.renderReplyFor(
        quoteResponse,
        parsedBody.data,
        primaryContact.name,
        buildPortalLink('__preview__'),
      );

      return res.status(200).json({
        to: primaryContact.email,
        cc: companyCc.map((c) => c.email),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  // Envia (de verdade, via SMTP) um e-mail de resposta ao fornecedor com a
  // tabela de itens da cotacao, com assunto/mensagem editaveis na hora
  // (preco alvo, fechamento do pedido, etc. -- ver modal de "Responder").
  // Substitui o antigo botao "Responder" que abria um mailto: local -- o
  // corpo em HTML so' sai formatado enviando pelo servidor, ja que
  // mailto: (RFC 6068) so' aceita texto puro.
  static async reply(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID da proposta invalido.' });
      }

      const parsedBody = quoteResponseReplySchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        return res.status(400).json({
          message: parsedBody.error.issues[0]?.message ?? 'Dados invalidos.',
        });
      }

      const context = await QuoteResponseController.loadReplyContext(id, res);
      if (!context) return res;
      const { quoteResponse, primaryContact } = context;
      const companyCc = QuoteResponseController.mergeMentionedCc(context.companyCc, parsedBody.data.message);

      if (parsedBody.data.targetPrice !== undefined) {
        if (parsedBody.data.targetPrice !== null) {
          await prisma.quoteResponseTargetPriceHistory.create({
            data: {
              quoteResponseId: id,
              targetPrice: parsedBody.data.targetPrice,
              sentById: req.user?.id ?? null,
            },
          });
        }
        await prisma.quoteResponse.update({
          where: { id, deletedAt: null },
          data: { targetPrice: parsedBody.data.targetPrice },
        });
        quoteResponse.targetPrice = parsedBody.data.targetPrice as any;
      }

      // Target price POR ITEM (cotacoes multi-item) -- caminho independente
      // do bloco agregado acima; nao grava QuoteResponse.targetPrice/
      // historico agregado (decisao de produto: multi-item usa SO' os
      // targets por item).
      if (parsedBody.data.itemTargets && parsedBody.data.itemTargets.length > 0) {
        for (const itemTarget of parsedBody.data.itemTargets) {
          await prisma.quoteResponseItem.updateMany({
            // Target de item indisponivel e ignorado.
            where: {
              id: itemTarget.quoteResponseItemId,
              quoteResponseId: id,
              deletedAt: null,
              isUnavailable: false,
            },
            data: { targetPrice: itemTarget.targetPrice },
          });
        }
        quoteResponse.items = quoteResponse.items?.map((responseItem) => {
          const match = parsedBody.data.itemTargets!.find(
            (t) => t.quoteResponseItemId === responseItem.id,
          );
          return match && !responseItem.isUnavailable
            ? { ...responseItem, targetPrice: match.targetPrice as any }
            : responseItem;
        });
      }

      // Botao "Review or adjust your proposal": token NOVO do portal para o
      // destinatario, com a resposta (e revisoes) migrada e o link anterior
      // revogado (SupplierPortalService.rotateTokenForReply). Rotaciona ANTES
      // do envio, como o dispatch: se o SMTP falhar o reply devolve 502 e o
      // reenvio rotaciona de novo. Cotacao fechada: sem token e sem botao
      // (o portal bloquearia o submit). O raw token so' vive em `portalLink`
      // (HTML/texto do e-mail): nunca em templateVars, AuditLog ou logger.
      let portalLink: string | undefined;
      let portalTokenId: number | null = null;
      let replacedTokenId: number | null = null;
      if (quoteResponse.quoteRequest.status !== QuoteRequestStatus.closed) {
        const userId = req.user?.id;
        if (!userId) {
          return res.status(401).json({ message: 'Sessao expirada. Faca login novamente.' });
        }
        const rotated = await prisma.$transaction(async (tx) => {
          const result = await SupplierPortalService.rotateTokenForReply({
            quoteRequestId: quoteResponse.quoteRequest.id,
            supplierId: quoteResponse.supplierId,
            supplierContactId: primaryContact.id,
            createdById: userId,
            client: tx,
          });
          if (result.previous) {
            await AuditLogService.log(
              {
                entityType: 'supplier_portal_token',
                entityId: result.previous.id,
                action: 'revoke',
                performedById: userId,
                metadata: { reason: 'reply', replacedById: result.created.id },
              },
              tx,
            );
          }
          await AuditLogService.log(
            {
              entityType: 'supplier_portal_token',
              entityId: result.created.id,
              action: 'generate',
              performedById: userId,
              metadata: {
                quoteRequestId: quoteResponse.quoteRequest.id,
                replacesTokenId: result.previous?.id ?? null,
                movedResponseId: result.previous?.responseId ?? null,
              },
            },
            tx,
          );
          return result;
        });
        portalLink = buildPortalLink(rotated.rawToken);
        portalTokenId = rotated.created.id;
        replacedTokenId = rotated.previous?.id ?? null;
      }

      const rendered = await QuoteResponseController.renderReplyFor(
        quoteResponse,
        parsedBody.data,
        primaryContact.name,
        portalLink,
      );

      const sendResult = await sendAndLog({
        to: { email: primaryContact.email, name: primaryContact.name },
        cc: companyCc,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateId: 'quote-reply',
        templateVars: {
          quoteRequestId: quoteResponse.quoteRequest.id,
          quoteResponseId: quoteResponse.id,
          supplierId: quoteResponse.supplier.id,
          supplierContactId: primaryContact.id,
          customMessage: parsedBody.data.message ?? null,
          portalTokenId,
        },
        relatedEntityType: 'quote_response',
        relatedEntityId: String(id),
      });

      await AuditLogService.log({
        entityType: 'quote_response',
        entityId: id,
        action: 'reply',
        performedById: req.user?.id ?? null,
        metadata: {
          to: primaryContact.email,
          cc: companyCc.map((c) => c.email),
          status: sendResult.status,
          subject: rendered.subject,
          hasCustomMessage: Boolean(parsedBody.data.message),
          portalTokenId,
          replacedTokenId,
        },
      });

      if (sendResult.status === 'failed') {
        return res.status(502).json({
          message: sendResult.error || 'Falha ao enviar o e-mail de resposta.',
        });
      }

      return res.status(200).json({
        status: sendResult.status,
        to: primaryContact.email,
        cc: companyCc.map((c) => c.email),
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  // Envia (de verdade, via SMTP) o e-mail de "Ordem de Compra" ao contato
  // principal do fornecedor VENCEDOR, com o PDF (upload do usuario, so'-
  // envio) anexado. Botao na tela de Comparacao, so' habilitado quando
  // `quoteResponse.isWinner === true`. O envio em si mora em
  // PurchaseOrderEmailService (compartilhado com a PO ao parceiro, PR4b).
  static async sendPurchaseOrder(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID da proposta invalido.' });
      }

      const parsedBody = quotePurchaseOrderSchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        return res.status(400).json({
          message: parsedBody.error.issues[0]?.message ?? 'Dados invalidos.',
        });
      }

      const context = await QuoteResponseController.loadReplyContext(id, res);
      if (!context) return res;
      const { quoteResponse, primaryContact, companyCc } = context;

      if (quoteResponse.isWinner !== true) {
        return res.status(400).json({
          message: 'Apenas o fornecedor vencedor pode receber a Ordem de Compra.',
        });
      }

      const result = await sendPurchaseOrderEmail({
        payload: parsedBody.data,
        quoteRequest: quoteResponse.quoteRequest,
        recipient: { name: primaryContact.name, email: primaryContact.email },
        cc: companyCc,
        user: req.user,
        templateVars: {
          quoteRequestId: quoteResponse.quoteRequest.id,
          quoteResponseId: quoteResponse.id,
          supplierId: quoteResponse.supplier.id,
          supplierContactId: primaryContact.id,
        },
        related: { type: 'quote_response', id: String(id) },
        audit: { entityType: 'quote_response', entityId: id },
      });

      return res.status(200).json(result);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async compareByQuoteRequest(
    req: Request,
    res: Response,
  ): Promise<Response> {
    try {
      const quoteRequestId = parseId(req.params.quoteRequestId);
      const weights = parseComparisonWeights(req.body);

      if (!quoteRequestId) {
        return res.status(400).json({
          message: 'ID da cotacao invalido.',
        });
      }

      if (!weights) {
        return res.status(400).json({
          message:
            'Os pesos da comparacao sao invalidos. Use valores positivos para preco, pagamento e incoterm.',
        });
      }

      const quoteRequest = await prisma.quoteRequest.findUnique({
        where: { id: quoteRequestId, deletedAt: null },
        include: { items: { where: { deletedAt: null }, select: { id: true, quantity: true, productName: true } } },
      });

      if (!quoteRequest) {
        return res.status(404).json({
          message: 'Cotacao nao encontrada.',
        });
      }

      // A comparacao e' repetivel e nao altera o status da cotacao: comparar
      // apenas calcula scores e marca a vencedora. Concluir a cotacao passou a
      // ser uma acao explicita (POST /quote-requests/:id/close). Por isso nao ha
      // mais bloqueio por status aqui.
      const responses = await prisma.quoteResponse.findMany({
        where: { quoteRequestId, deletedAt: null },
        orderBy: {
          id: 'asc',
        },
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
              contacts: {
                orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
                take: 1,
                select: { id: true, name: true, email: true },
              },
            },
          },
          items: {
            where: { deletedAt: null },
            select: {
              leadTimeDays: true,
              quoteRequestItemId: true,
              unitPrice: true,
              quantity: true,
              originPort: true,
              isUnavailable: true,
              isDangerousGood: true,
              quoteRequestItem: { select: { productName: true } },
            },
          },
        },
      });

      if (responses.length === 0) {
        return res.status(404).json({
          message: 'Nenhuma proposta encontrada para esta cotacao.',
        });
      }

      // PR4a: encaminhamentos de Credit Support respondidos entram como candidatos proprios
      // ("via Parceiro"); os stale vao direto para `excluded`. Minimo = 2 candidatos.
      const { virtual: creditAlternatives, stale: staleAlternatives } =
        await loadCreditAlternatives(quoteRequestId);

      if (responses.length + creditAlternatives.length + staleAlternatives.length < 2) {
        return res.status(400).json({
          message: 'Sao necessarias pelo menos duas propostas para comparar.',
        });
      }

      // Propostas com item "Temporarily unavailable" ou parciais (item faltando, extra ou
      // duplicado) ficam FORA do ranking (nao entram no compareResponses nem no
      // min(offeredPrice)); a formula do score nao muda. Quantidade divergente ENTRA com o
      // unitario cotado x quantidade pedida (sinalizada).
      const { complete, excluded: partitionExcluded } = partitionForComparison(
        quoteRequest.items ?? [],
        [...responses, ...creditAlternatives],
      );
      const excluded: ExcludedComparisonEntry[] = [...partitionExcluded, ...staleAlternatives];

      if (complete.length < 2) {
        return res.status(400).json({
          message: `Sao necessarias pelo menos duas propostas completas para comparar (${excluded.length} ficaram fora do ranking: item indisponivel, proposta parcial ou oferta do parceiro desatualizada).`,
        });
      }
      const adjustmentById = new Map(
        complete.map((entry) => [
          comparisonCandidateKey({
            id: entry.response.id,
            creditSupportRequestId: creditMetaOf(entry.response).creditSupportRequestId,
          }),
          entry,
        ]),
      );

      const supplierIds = Array.from(new Set(complete.map(({ response }) => response.supplierId)));
      const reviews = await prisma.supplierReview.groupBy({
        by: ['supplierId'],
        _avg: { qualityRating: true },
        where: { supplierId: { in: supplierIds } },
      });
      const qualityMap = new Map(
        reviews.map(r => [r.supplierId, r._avg.qualityRating]),
      );

      const comparisonInputs = complete.map(({ response, price }) => ({
        id: response.id,
        quoteRequestId: response.quoteRequestId,
        supplierId: response.supplierId,
        offeredPrice: price,
        currency: response.currency,
        exchangeRate: Number(response.exchangeRate),
        freightCost: Number(response.freightCost),
        insuranceCost: Number(response.insuranceCost),
        otherFees: Number(response.otherFees),
        importDutyRate: Number(response.importDuty),
        ipiRate: Number(response.ipi),
        pisRate: Number(response.pis),
        cofinsRate: Number(response.cofins),
        offeredIncoterm: response.offeredIncoterm,
        paymentTermsDays: response.paymentTermsDays,
        isWinner: response.isWinner,
        avgQuality: qualityMap.get(response.supplierId) ?? undefined,
        creditSupportRequestId: creditMetaOf(response).creditSupportRequestId,
      }));
      const comparisonValidationError =
        QuoteComparisonService.validateResponsesForComparison(comparisonInputs);

      if (comparisonValidationError) {
        return res.status(400).json({
          message: comparisonValidationError,
        });
      }

      const comparisonResults = QuoteComparisonService.compareResponses(
        comparisonInputs,
        weights,
      );

      const winner = comparisonResults.find((response) => response.isWinner) ?? null;
      const winnerCreditSupportRequestId = winner?.creditSupportRequestId ?? null;

      const companyProfile = await CompanyProfileService.get();
      const threshold = companyProfile.awardApprovalThreshold ? Number(companyProfile.awardApprovalThreshold) : null;

      let requiresApproval = false;
      if (winner && QuoteComparisonService.requiresAwardApproval(winner, threshold)) {
        requiresApproval = true;
      }

      const comparisonRecord = await prisma.$transaction(async (tx) => {
        await tx.quoteResponse.updateMany({
          where: { quoteRequestId, deletedAt: null },
          data: { isWinner: false },
        });
        await clearCreditWinners(tx, { quoteRequestId });

        if (!requiresApproval) {
          for (const response of comparisonResults.filter((item) => item.isWinner)) {
            // Invariante: no maximo UMA entre QuoteResponse.isWinner e
            // CreditSupportRequest.isWinner fica true por cotacao.
            if (response.creditSupportRequestId) {
              await tx.creditSupportRequest.update({
                where: { id: response.creditSupportRequestId },
                data: { isWinner: true },
              });
            } else {
              await tx.quoteResponse.update({
                where: { id: response.id },
                data: { isWinner: true },
              });
            }
          }
        }

        const comparisonRecord = await tx.quoteComparison.create({
          data: {
            quoteRequestId,
            executedById: req.user?.id ?? null,
            priceWeight: weights.priceWeight,
            paymentTermsWeight: weights.paymentTermsWeight,
            incotermWeight: weights.incotermWeight,
            qualityWeight: weights.qualityWeight ?? 0,
            winnerQuoteResponseId: winner?.id ?? null,
            winnerCreditSupportRequestId,
            approvalStatus: requiresApproval ? 'pending' : 'not_required',
            results: {
              create: comparisonResults.map((response) => ({
                quoteResponseId: response.id,
                creditSupportRequestId: response.creditSupportRequestId ?? null,
                supplierId: response.supplierId,
                offeredPrice: response.offeredPrice,
                offeredIncoterm: response.offeredIncoterm,
                paymentTermsDays: response.paymentTermsDays,
                exchangeRate: response.exchangeRate,
                freightCost: response.freightCost,
                insuranceCost: response.insuranceCost,
                otherFees: response.otherFees,
                importDutyRate: response.importDutyRate,
                ipiRate: response.ipiRate,
                pisRate: response.pisRate,
                cofinsRate: response.cofinsRate,
                cifValue: response.cifValue,
                importDutyAmount: response.importDutyAmount,
                ipiAmount: response.ipiAmount,
                pisCofinsAmount: response.pisCofinsAmount,
                totalLandedCost: response.totalLandedCost,
                priceScore: response.priceScore,
                paymentTermsScore: response.paymentTermsScore,
                incotermScore: response.incotermScore,
                qualityScore: response.qualityScore,
                totalScore: response.totalScore,
                isWinner: !requiresApproval && response.isWinner, // isWinner só fica true no registro se a adjudicação não depender de aprovação
              })),
            },
          },
        });

        await AuditLogService.log(
          {
            entityType: 'quote_request',
            entityId: quoteRequestId,
            action: 'compare',
            performedById: req.user?.id ?? null,
            beforeData: {
              status: quoteRequest.status,
              closedAt: quoteRequest.closedAt,
            },
            afterData: {
              status: quoteRequest.status,
              winnerQuoteResponseId: winner?.id ?? null,
              winnerCreditSupportRequestId,
              comparisonId: comparisonRecord.id,
              approvalStatus: comparisonRecord.approvalStatus,
            },
            metadata: {
              comparisonId: comparisonRecord.id,
              winnerQuoteResponseId: winner?.id ?? null,
              winnerCreditSupportRequestId,
              weights,
              requiresApproval,
              threshold,
              quoteResponseIds: responses.map((response) => response.id),
              excludedQuoteResponseIds: excluded.map((entry) => entry.quoteResponseId),
              creditSupportRequestIds: creditAlternatives.map((entry) => entry.creditSupportRequestId),
              excludedCreditSupportRequestIds: excluded
                .map((entry) => entry.creditSupportRequestId)
                .filter((id): id is number => id !== null),
            },
          },
          tx,
        );
        return comparisonRecord;
      });

      // Enriquece o payload retornado com nome do fornecedor e o contato
      // principal (nome/e-mail) para a UI exibir o nome real e montar o mailto
      // de "Responder" na vencedora, sem depender de outra chamada.
      const supplierById = new Map(
        responses.map((response) => [response.supplierId, response.supplier]),
      );
      // Mapa por response.id (nao supplierId) porque comparisonResults nao
      // carrega items; usar id garante 1:1 mesmo se um fornecedor tiver mais
      // de uma proposta. A linha via parceiro le leadTime/origens/DG da resposta de ORIGEM.
      const responseById = new Map(responses.map((response) => [response.id, response]));
      const enrichedResults = comparisonResults.map((result) => {
        const candidateKey = comparisonCandidateKey(result);
        const supplier = supplierById.get(result.supplierId);
        const primaryContact = supplier?.contacts?.[0] ?? null;
        const sourceResponse = responseById.get(result.id);
        const leadTimeDays = deriveMaxLeadTimeDays(
          sourceResponse?.items,
          sourceResponse?.leadTimeDays ?? null,
        );
        const creditMeta = creditMetaOf(adjustmentById.get(candidateKey)?.response ?? { id: result.id });
        return {
          ...result,
          creditSupportRequestId: creditMeta.creditSupportRequestId,
          supplier: supplier ? { id: supplier.id, name: supplier.name } : undefined,
          contact: primaryContact
            ? { id: primaryContact.id, name: primaryContact.name, email: primaryContact.email }
            : null,
          leadTimeDays,
          // Informativo (nao entra em score/landed): origem geral + origem efetiva por item.
          originPort: sourceResponse?.originPort ?? null,
          itemOrigins: buildItemOrigins(sourceResponse?.items, sourceResponse?.originPort),
          // Informativo (nao entra em score/landed): itens que o fornecedor marcou como DG.
          dgItems: buildDangerousGoodItems(sourceResponse?.items),
          // Quantidade divergente: o preco do ranking ja e unitario x quantidade pedida.
          quantityAdjusted: adjustmentById.get(candidateKey)?.quantityAdjusted ?? false,
          quantityMismatches: adjustmentById.get(candidateKey)?.quantityMismatches ?? [],
          // PR4a: alternativa via parceiro (null/false na linha direta).
          creditPartner: creditMeta.creditPartner,
          partnerContact: creditMeta.partnerContact,
          partnerValidityDays: creditMeta.partnerValidityDays,
          validityExpired: creditMeta.validityExpired,
        };
      });

      return res.status(200).json({
        results: enrichedResults,
        pendingApproval: requiresApproval,
        winnerQuoteResponseId: requiresApproval ? winner?.id : null,
        winnerCreditSupportRequestId: requiresApproval ? winnerCreditSupportRequestId : null,
        thresholdValue: requiresApproval ? threshold : null,
        comparisonId: comparisonRecord.id,
        candidateCount: comparisonResults.length,
        excluded,
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async previewComparison(
    req: Request,
    res: Response,
  ): Promise<Response> {
    try {
      const quoteRequestId = parseId(req.params.quoteRequestId);
      const weights = parseComparisonWeights(req.body);

      if (!quoteRequestId) {
        return res.status(400).json({
          message: 'ID da cotacao invalido.',
        });
      }

      if (!weights) {
        return res.status(400).json({
          message:
            'Os pesos da comparacao sao invalidos. Use valores positivos para preco, pagamento e incoterm.',
        });
      }

      const quoteRequest = await prisma.quoteRequest.findUnique({
        where: { id: quoteRequestId, deletedAt: null },
        include: { items: { where: { deletedAt: null }, select: { id: true, quantity: true, productName: true } } },
      });

      if (!quoteRequest) {
        return res.status(404).json({
          message: 'Cotacao nao encontrada.',
        });
      }

      // Preview: apenas calcula, nunca persiste (sem $transaction, sem mutar
      // isWinner, sem criar QuoteComparison/AuditLog). Usado pra recalculo ao
      // vivo enquanto o usuario ajusta os toggles de peso.
      const responses = await prisma.quoteResponse.findMany({
        where: { quoteRequestId, deletedAt: null },
        orderBy: {
          id: 'asc',
        },
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
              contacts: {
                orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
                take: 1,
                select: { id: true, name: true, email: true },
              },
            },
          },
          items: {
            where: { deletedAt: null },
            select: {
              leadTimeDays: true,
              quoteRequestItemId: true,
              unitPrice: true,
              quantity: true,
              originPort: true,
              isUnavailable: true,
              isDangerousGood: true,
              quoteRequestItem: { select: { productName: true } },
            },
          },
        },
      });

      const responseCount = responses.length;

      if (responseCount === 0) {
        return res.status(200).json({
          results: [],
          winnerQuoteResponseId: null,
          winnerCreditSupportRequestId: null,
          pendingApproval: false,
          thresholdValue: null,
          responseCount,
          candidateCount: 0,
          excluded: [],
        });
      }

      // PR4a: alternativas via parceiro (Credit Support) como candidatos; stale -> excluded.
      const { virtual: creditAlternatives, stale: staleAlternatives } =
        await loadCreditAlternatives(quoteRequestId);

      // Mesma particao do compare: proposta com item indisponivel ou parcial fica fora do ranking.
      const { complete, excluded: partitionExcluded } = partitionForComparison(
        quoteRequest.items ?? [],
        [...responses, ...creditAlternatives],
      );
      const excluded: ExcludedComparisonEntry[] = [...partitionExcluded, ...staleAlternatives];
      const adjustmentById = new Map(
        complete.map((entry) => [
          comparisonCandidateKey({
            id: entry.response.id,
            creditSupportRequestId: creditMetaOf(entry.response).creditSupportRequestId,
          }),
          entry,
        ]),
      );

      // Vencedora GRAVADA (isWinner) + se e uma escolha manual vigente. Chave aditiva: omitida
      // quando nao ha vencedora gravada (contrato anterior preservado).
      const persisted = persistedWinnerOf(responses, creditAlternatives);
      const persistedWinnerPayload = persisted
        ? {
            persistedWinner: {
              ...persisted,
              manual: await isManualWinnerActive(prisma, quoteRequestId, persisted),
            },
          }
        : {};

      if (complete.length === 0) {
        return res.status(200).json({
          results: [],
          winnerQuoteResponseId: null,
          winnerCreditSupportRequestId: null,
          pendingApproval: false,
          thresholdValue: null,
          responseCount,
          candidateCount: 0,
          excluded,
          ...persistedWinnerPayload,
        });
      }

      const supplierIds = Array.from(new Set(complete.map(({ response }) => response.supplierId)));
      const reviews = await prisma.supplierReview.groupBy({
        by: ['supplierId'],
        _avg: { qualityRating: true },
        where: { supplierId: { in: supplierIds } },
      });
      const qualityMap = new Map(
        reviews.map(r => [r.supplierId, r._avg.qualityRating]),
      );

      const comparisonInputs = complete.map(({ response, price }) => ({
        id: response.id,
        quoteRequestId: response.quoteRequestId,
        supplierId: response.supplierId,
        offeredPrice: price,
        currency: response.currency,
        exchangeRate: Number(response.exchangeRate),
        freightCost: Number(response.freightCost),
        insuranceCost: Number(response.insuranceCost),
        otherFees: Number(response.otherFees),
        importDutyRate: Number(response.importDuty),
        ipiRate: Number(response.ipi),
        pisRate: Number(response.pis),
        cofinsRate: Number(response.cofins),
        offeredIncoterm: response.offeredIncoterm,
        paymentTermsDays: response.paymentTermsDays,
        isWinner: response.isWinner,
        avgQuality: qualityMap.get(response.supplierId) ?? undefined,
        creditSupportRequestId: creditMetaOf(response).creditSupportRequestId,
      }));
      const comparisonValidationError =
        QuoteComparisonService.validateResponsesForComparison(comparisonInputs);

      if (comparisonValidationError) {
        return res.status(400).json({
          message: comparisonValidationError,
        });
      }

      const comparisonResults = QuoteComparisonService.compareResponses(
        comparisonInputs,
        weights,
      );

      const winner = comparisonResults.find((response) => response.isWinner) ?? null;

      const companyProfile = await CompanyProfileService.get();
      const threshold = companyProfile.awardApprovalThreshold ? Number(companyProfile.awardApprovalThreshold) : null;

      let requiresApproval = false;
      if (winner && QuoteComparisonService.requiresAwardApproval(winner, threshold)) {
        requiresApproval = true;
      }

      const supplierById = new Map(
        responses.map((response) => [response.supplierId, response.supplier]),
      );
      // Mapa por response.id (nao supplierId) porque comparisonResults nao
      // carrega items; usar id garante 1:1 mesmo se um fornecedor tiver mais
      // de uma proposta. A linha via parceiro le leadTime/origens/DG da resposta de ORIGEM.
      const responseById = new Map(responses.map((response) => [response.id, response]));
      const enrichedResults = comparisonResults.map((result) => {
        const candidateKey = comparisonCandidateKey(result);
        const supplier = supplierById.get(result.supplierId);
        const primaryContact = supplier?.contacts?.[0] ?? null;
        const sourceResponse = responseById.get(result.id);
        const leadTimeDays = deriveMaxLeadTimeDays(
          sourceResponse?.items,
          sourceResponse?.leadTimeDays ?? null,
        );
        const creditMeta = creditMetaOf(adjustmentById.get(candidateKey)?.response ?? { id: result.id });
        return {
          ...result,
          quoteResponseId: result.id,
          creditSupportRequestId: creditMeta.creditSupportRequestId,
          supplier: supplier ? { id: supplier.id, name: supplier.name } : undefined,
          contact: primaryContact
            ? { id: primaryContact.id, name: primaryContact.name, email: primaryContact.email }
            : null,
          leadTimeDays,
          // Informativo (nao entra em score/landed): origem geral + origem efetiva por item.
          originPort: sourceResponse?.originPort ?? null,
          itemOrigins: buildItemOrigins(sourceResponse?.items, sourceResponse?.originPort),
          // Informativo (nao entra em score/landed): itens que o fornecedor marcou como DG.
          dgItems: buildDangerousGoodItems(sourceResponse?.items),
          // Quantidade divergente: o preco do ranking ja e unitario x quantidade pedida.
          quantityAdjusted: adjustmentById.get(candidateKey)?.quantityAdjusted ?? false,
          quantityMismatches: adjustmentById.get(candidateKey)?.quantityMismatches ?? [],
          // PR4a: alternativa via parceiro (null/false na linha direta).
          creditPartner: creditMeta.creditPartner,
          partnerContact: creditMeta.partnerContact,
          partnerValidityDays: creditMeta.partnerValidityDays,
          validityExpired: creditMeta.validityExpired,
        };
      });

      return res.status(200).json({
        results: enrichedResults,
        winnerQuoteResponseId: winner?.id ?? null,
        winnerCreditSupportRequestId: winner?.creditSupportRequestId ?? null,
        pendingApproval: requiresApproval,
        thresholdValue: requiresApproval ? threshold : null,
        responseCount,
        candidateCount: comparisonResults.length,
        excluded,
        ...persistedWinnerPayload,
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getComparisonHistoryByQuoteRequest(
    req: Request,
    res: Response,
  ): Promise<Response> {
    try {
      const quoteRequestId = parseId(req.params.quoteRequestId);

      if (!quoteRequestId) {
        return res.status(400).json({
          message: 'ID da cotacao invalido.',
        });
      }

      const quoteRequest = await prisma.quoteRequest.findUnique({
        where: { id: quoteRequestId, deletedAt: null },
      });

      if (!quoteRequest) {
        return res.status(404).json({
          message: 'Cotacao nao encontrada.',
        });
      }

      const comparisons = await prisma.quoteComparison.findMany({
        where: { quoteRequestId },
        include: {
          executedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          results: {
            orderBy: [
              { totalScore: 'desc' },
              { id: 'asc' },
            ],
            include: {
              quoteResponse: {
                include: {
                  supplier: {
                    include: {
                      // contato principal para o botao "Responder" (mailto) da vencedora
                      contacts: {
                        orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
                        take: 1,
                        select: { id: true, name: true, email: true },
                      },
                    },
                  },
                },
              },
              // PR4a (aditivo): linha via parceiro -> parceiro de credito.
              creditSupportRequest: {
                select: { id: true, creditPartner: { select: { id: true, name: true } } },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return res.status(200).json({
        quoteRequestId,
        comparisons,
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getTargetPriceHistory(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID da proposta invalido.' });
      }

      const history = await prisma.quoteResponseTargetPriceHistory.findMany({
        where: { quoteResponseId: id },
        orderBy: { sentAt: 'desc' },
        include: { sentBy: { select: { id: true, name: true } } },
      });

      return res.status(200).json(history);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async approveAward(req: Request, res: Response): Promise<Response> {
    try {
      const quoteRequestId = parseId(req.params.quoteRequestId);
      const comparisonId = parseId(req.params.comparisonId);

      if (!quoteRequestId || !comparisonId) {
        return res.status(400).json({ message: 'IDs inválidos.' });
      }

      const comparison = await prisma.quoteComparison.findUnique({
        where: { id: comparisonId },
      });

      if (!comparison) {
        return res.status(404).json({ message: 'Comparação não encontrada.' });
      }

      if (comparison.quoteRequestId !== quoteRequestId) {
        return res.status(400).json({ message: 'Comparação não pertence a esta cotação.' });
      }

      if (comparison.approvalStatus !== 'pending') {
        return res.status(400).json({ message: 'Comparação não está pendente de aprovação.' });
      }

      if (!comparison.winnerQuoteResponseId) {
        return res.status(400).json({ message: 'Comparação não possui um vencedor para aprovar.' });
      }

      // Valida se é a mais recente
      const latestComparison = await prisma.quoteComparison.findFirst({
        where: { quoteRequestId },
        orderBy: { createdAt: 'desc' },
      });

      if (latestComparison?.id !== comparisonId) {
        return res.status(409).json({
          message: 'Esta não é a comparação mais recente. Por favor, reavalie os resultados.',
        });
      }

      // O fornecedor pode ter revisado a proposta (portal/API) depois da comparacao: item
      // indisponivel ou cesta inconsistente (item extra/duplicado) nao pode ser aprovada como
      // vencedora. Quantidade divergente e item faltando continuam aprovaveis (decisao 2026-10-12).
      const awardQuoteRequest = await prisma.quoteRequest.findUnique({
        where: { id: quoteRequestId, deletedAt: null },
        select: { items: { where: { deletedAt: null }, select: { id: true, quantity: true } } },
      });
      // PR4a: vencedor = alternativa via parceiro -> a cesta avaliada e a do parceiro.
      const winnerCreditSupportRequestId = comparison.winnerCreditSupportRequestId ?? null;
      let awardBasket: { id: number; offeredPrice: Prisma.Decimal; items: { quoteRequestItemId: number; quantity: number; unitPrice: Prisma.Decimal; isUnavailable: boolean }[] } | null = null;
      if (winnerCreditSupportRequestId) {
        let creditCandidate: CreditCandidateForAward;
        try {
          creditCandidate = await loadCreditCandidateForAward(prisma, {
            creditSupportRequestId: winnerCreditSupportRequestId,
            quoteRequestId,
            quoteResponseId: comparison.winnerQuoteResponseId,
          });
        } catch (error) {
          if (error instanceof HttpError && error.status === 404) {
            return res.status(409).json({ message: CREDIT_OFFER_CHANGED_MESSAGE });
          }
          throw error;
        }
        if (creditCandidate.isStale) {
          return res.status(409).json({ message: CREDIT_OFFER_CHANGED_MESSAGE });
        }
        awardBasket = creditCandidate.basket;
      } else {
        awardBasket = await prisma.quoteResponse.findFirst({
          where: { id: comparison.winnerQuoteResponseId, quoteRequestId, deletedAt: null },
          select: {
            id: true,
            offeredPrice: true,
            items: {
              where: { deletedAt: null },
              select: { quoteRequestItemId: true, quantity: true, unitPrice: true, isUnavailable: true },
            },
          },
        });
      }
      if (awardBasket) {
        const classification = classifyForComparison(awardQuoteRequest?.items ?? [], awardBasket);
        // Qualquer item indisponivel barra a aprovacao (inclusive quando a cesta tambem tem
        // item faltando e a classificacao e 'partial').
        if (
          classification.kind === 'unavailable' ||
          (classification.kind === 'partial' && classification.unavailableItemIds.length > 0)
        ) {
          return res.status(409).json({
            message: 'A proposta vencedora mudou (itens indisponíveis). Refaça a comparação antes de aprovar.',
          });
        }
        if (classification.kind === 'partial' && isInconsistentBasket(classification.details)) {
          return res.status(409).json({
            message: 'A proposta vencedora mudou (itens que não pertencem mais à cotação ou duplicados). Refaça a comparação antes de aprovar.',
          });
        }
      }

      await prisma.$transaction(async (tx) => {
        // Uma proposta removida nao pode voltar a vencer por uma aprovacao antiga.
        await tx.quoteResponse.updateMany({
          where: { quoteRequestId, deletedAt: null },
          data: { isWinner: false },
        });
        await clearCreditWinners(tx, { quoteRequestId });
        await tx.quoteComparison.update({
          where: { id: comparisonId },
          data: {
            approvalStatus: 'approved',
            approvedById: req.user?.id ?? null,
            approvedAt: new Date(),
          },
        });

        // Invariante: UMA entre QuoteResponse.isWinner e CreditSupportRequest.isWinner.
        if (winnerCreditSupportRequestId) {
          await tx.creditSupportRequest.update({
            where: { id: winnerCreditSupportRequestId },
            data: { isWinner: true },
          });
        } else {
          await tx.quoteResponse.update({
            where: { id: comparison.winnerQuoteResponseId!, deletedAt: null, quoteRequest: { id: quoteRequestId, deletedAt: null } },
            data: { isWinner: true },
          });
        }
        await tx.quoteComparisonResult.updateMany({
          where: { comparisonId },
          data: { isWinner: false },
        });
        // `creditSupportRequestId` no where: a linha direta e a via parceiro compartilham o
        // mesmo quoteResponseId; so uma delas vence.
        await tx.quoteComparisonResult.updateMany({
          where: {
            comparisonId,
            quoteResponseId: comparison.winnerQuoteResponseId,
            creditSupportRequestId: winnerCreditSupportRequestId,
          },
          data: { isWinner: true },
        });

        await AuditLogService.log(
          {
            entityType: 'quote_request',
            entityId: quoteRequestId,
            action: 'approve_award',
            performedById: req.user?.id ?? null,
            beforeData: {
              comparisonId,
              approvalStatus: 'pending',
            },
            afterData: {
              comparisonId,
              approvalStatus: 'approved',
              winnerQuoteResponseId: comparison.winnerQuoteResponseId,
              winnerCreditSupportRequestId,
            },
            metadata: { winnerCreditSupportRequestId },
          },
          tx,
        );
      });

      return res.status(200).json({ message: 'Aprovação realizada com sucesso.' });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async setManualWinner(req: Request, res: Response): Promise<Response> {
    try {
      const quoteRequestId = parseId(req.params.quoteRequestId);

      if (!quoteRequestId) {
        return res.status(400).json({ message: 'ID da cotação inválido.' });
      }

      const parsed = quoteWinnerOverrideSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: 'Dados inválidos.',
          errors: parsed.error.flatten(),
        });
      }

      const { quoteResponseId, reason } = parsed.data;
      // PR4a: escolher a alternativa via parceiro (Credit Support) da resposta `quoteResponseId`.
      const creditSupportRequestId = parsed.data.creditSupportRequestId ?? null;

      const quoteRequest = await prisma.quoteRequest.findUnique({
        where: { id: quoteRequestId, deletedAt: null },
        include: { items: { where: { deletedAt: null }, select: { id: true, quantity: true, productName: true } } },
      });

      if (!quoteRequest) {
        return res.status(404).json({ message: 'Cotação não encontrada.' });
      }

      const chosenResponse = await prisma.quoteResponse.findFirst({
        where: { id: quoteResponseId, quoteRequestId, deletedAt: null },
        include: {
          items: {
            where: { deletedAt: null },
            include: { quoteRequestItem: { select: { productName: true } } },
          },
        },
      });

      if (!chosenResponse) {
        return res.status(404).json({
          message: 'Proposta não encontrada para esta cotação.',
        });
      }

      // Via parceiro: 404 se nao pertence/revogado/nao respondido (HttpError do service);
      // 409 se a oferta do parceiro ficou stale. A cesta avaliada passa a ser a do parceiro.
      let creditCandidate: CreditCandidateForAward | null = null;
      if (creditSupportRequestId) {
        creditCandidate = await loadCreditCandidateForAward(prisma, {
          creditSupportRequestId,
          quoteRequestId,
          quoteResponseId,
        });
        if (creditCandidate.isStale) {
          throw new HttpError(409, CREDIT_OFFER_CHANGED_MESSAGE);
        }
      }

      const requestedItems = quoteRequest.items ?? [];
      const chosenBasket = creditCandidate ? creditCandidate.basket : chosenResponse;
      const chosenItems = chosenBasket.items ?? [];
      // Proposta com item "Temporarily unavailable" fica fora do ranking e nao pode vencer.
      if (chosenItems.some((item) => item.isUnavailable)) {
        throw new HttpError(
          400,
          'Proposta com item temporariamente indisponivel nao pode ser escolhida como vencedora.',
        );
      }

      // Decisao 2026-10-12: quantidade divergente (ranking usa unitario x pedido) e item
      // faltando PODEM ser escolhidas manualmente; item extra/duplicado (dado inconsistente) nao.
      const classification = classifyForComparison(requestedItems, chosenBasket);
      let comparablePrice: number;
      if (classification.kind === 'partial') {
        if (isInconsistentBasket(classification.details)) {
          const requestedNames = new Map(requestedItems.map((item) => [item.id, item.productName]));
          const responseNames = new Map(
            chosenItems.map((item) => [item.quoteRequestItemId, item.quoteRequestItem?.productName]),
          );
          const nameOf = (id: number) => requestedNames.get(id) ?? responseNames.get(id) ?? `#${id}`;
          throw new HttpError(
            400,
            `Proposta com itens inconsistentes nao pode ser escolhida como vencedora: ${describePartialBasket(classification.details, nameOf)}.`,
          );
        }
        comparablePrice = priceAtRequestedQuantity(requestedItems, chosenItems);
      } else if (classification.kind === 'unavailable') {
        // Inalcancavel (ja tratado acima); mantido para o narrowing do tipo.
        throw new HttpError(
          400,
          'Proposta com item temporariamente indisponivel nao pode ser escolhida como vencedora.',
        );
      } else {
        comparablePrice = classification.price;
      }

      const profile = await CompanyProfileService.get();
      const threshold = profile.awardApprovalThreshold == null ? null : Number(profile.awardApprovalThreshold);
      const exceedsThreshold = QuoteComparisonService.requiresAwardApproval({
        offeredPrice: comparablePrice,
        currency: chosenResponse.currency, exchangeRate: Number(chosenResponse.exchangeRate),
        freightCost: Number(chosenResponse.freightCost), insuranceCost: Number(chosenResponse.insuranceCost),
        otherFees: Number(chosenResponse.otherFees), importDutyRate: Number(chosenResponse.importDuty),
        ipiRate: Number(chosenResponse.ipi), pisRate: Number(chosenResponse.pis), cofinsRate: Number(chosenResponse.cofins),
      }, threshold);
      if (exceedsThreshold && !['admin', 'gestor'].includes(req.user?.role ?? '')) {
        throw new HttpError(403, 'O valor exige aprovacao de um gestor/admin, inclusive na escolha manual.');
      }

      const latestComparison = await prisma.quoteComparison.findFirst({
        where: { quoteRequestId },
        orderBy: { createdAt: 'desc' },
      });

      const previousWinnerId = latestComparison?.winnerQuoteResponseId ?? null;
      const previousWinnerCreditId = latestComparison?.winnerCreditSupportRequestId ?? null;
      const trimmedReason = reason?.trim() ?? null;

      // Motivo obrigatorio quando a IDENTIDADE composta (resposta, encaminhamento) muda:
      // trocar a direta pela mesma origem via parceiro (ou vice-versa) tambem exige motivo.
      const previousWinnerKey = `${previousWinnerId}:${previousWinnerCreditId ?? 0}`;
      const chosenWinnerKey = `${quoteResponseId}:${creditSupportRequestId ?? 0}`;
      if (
        latestComparison?.winnerQuoteResponseId &&
        chosenWinnerKey !== previousWinnerKey &&
        !trimmedReason
      ) {
        return res.status(400).json({
          message: 'Informe o motivo para escolher um vencedor diferente do calculado.',
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.quoteResponse.updateMany({
          where: { quoteRequestId, deletedAt: null },
          data: { isWinner: false },
        });
        await clearCreditWinners(tx, { quoteRequestId });

        // Invariante: UMA entre QuoteResponse.isWinner e CreditSupportRequest.isWinner.
        if (creditSupportRequestId) {
          await tx.creditSupportRequest.update({
            where: { id: creditSupportRequestId },
            data: { isWinner: true },
          });
        } else {
          await tx.quoteResponse.update({
            where: { id: quoteResponseId, deletedAt: null },
            data: { isWinner: true },
          });
        }

        if (latestComparison) {
          await tx.quoteComparisonResult.updateMany({
            where: { comparisonId: latestComparison.id },
            data: { isWinner: false },
          });

          await tx.quoteComparisonResult.updateMany({
            where: { comparisonId: latestComparison.id, quoteResponseId, creditSupportRequestId },
            data: { isWinner: true },
          });

          await tx.quoteComparison.update({
            where: { id: latestComparison.id },
            data: {
              winnerQuoteResponseId: quoteResponseId,
              winnerCreditSupportRequestId: creditSupportRequestId,
              approvalStatus: exceedsThreshold ? 'approved' : 'not_required',
              approvedById: exceedsThreshold ? req.user?.id : null,
              approvedAt: exceedsThreshold ? new Date() : null,
            },
          });
        }

        await AuditLogService.log(
          {
            entityType: 'quote_request',
            entityId: quoteRequestId,
            action: 'manual_winner',
            performedById: req.user?.id ?? null,
            beforeData: {
              winnerQuoteResponseId: previousWinnerId,
              winnerCreditSupportRequestId: previousWinnerCreditId,
            },
            afterData: {
              winnerQuoteResponseId: quoteResponseId,
              winnerCreditSupportRequestId: creditSupportRequestId,
            },
            metadata: {
              reason: trimmedReason,
              approvalRequired: exceedsThreshold,
              threshold,
              previousWinnerQuoteResponseId: previousWinnerId,
              previousWinnerCreditSupportRequestId: previousWinnerCreditId,
              newWinnerQuoteResponseId: quoteResponseId,
              winnerCreditSupportRequestId: creditSupportRequestId,
              comparisonId: latestComparison?.id ?? null,
            },
          },
          tx,
        );
      });

      return res.status(200).json({
        winnerQuoteResponseId: quoteResponseId,
        winnerCreditSupportRequestId: creditSupportRequestId,
        comparisonId: latestComparison?.id ?? null,
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}

type ComparisonSourceResponse = {
  id: number;
  offeredPrice: Prisma.Decimal;
  supplierId: number;
  supplier: { id: number; name: string };
  items: {
    quoteRequestItemId: number;
    quantity: number;
    unitPrice: Prisma.Decimal;
    isUnavailable: boolean;
    isDangerousGood?: boolean;
    quoteRequestItem: { productName: string };
  }[];
  // PR4a: presentes so na "resposta virtual" (alternativa via parceiro).
  creditSupportRequestId?: number | null;
  creditPartner?: CreditPartnerRef | null;
};

// Metadados da alternativa via parceiro (resposta direta: tudo null/false).
type CreditCandidateMeta = {
  creditSupportRequestId: number | null;
  creditPartner: CreditPartnerRef | null;
  partnerContact: PartnerContactRef | null;
  partnerValidityDays: number | null;
  validityExpired: boolean;
};

function creditMetaOf(response: {
  id: number;
  creditSupportRequestId?: number | null;
  creditPartner?: CreditPartnerRef | null;
  partnerContact?: PartnerContactRef | null;
  partnerValidityDays?: number | null;
  validityExpired?: boolean;
}): CreditCandidateMeta {
  return {
    creditSupportRequestId: response.creditSupportRequestId ?? null,
    creditPartner: response.creditPartner ?? null,
    partnerContact: response.partnerContact ?? null,
    partnerValidityDays: response.partnerValidityDays ?? null,
    validityExpired: response.validityExpired === true,
  };
}

type ComparisonItemRef = { quoteRequestItemId: number; productName: string };

type ExcludedComparisonEntry = {
  quoteResponseId: number;
  supplierId: number;
  supplier: { id: number; name: string };
  creditSupportRequestId: number | null;
  creditPartner: CreditPartnerRef | null;
  reason: 'unavailable' | 'partial' | 'stale';
  unavailableItems: ComparisonItemRef[];
  partial?: {
    missingItems: ComparisonItemRef[];
    quantityMismatches: (ComparisonItemRef & { requested: number; offered: number })[];
    extraItems: ComparisonItemRef[];
    duplicateItems: ComparisonItemRef[];
  };
};

// Separa as propostas que entram no ranking das que ficam FORA, com o motivo:
// - 'unavailable': item "Temporarily unavailable";
// - 'partial': item faltando, item que nao pertence mais a cotacao ou duplicado.
// Quantidade divergente (todos os itens presentes) ENTRA no ranking com o unitario cotado x
// quantidade pedida e vem sinalizada (quantityAdjusted + quantityMismatches). Nenhum 400 novo:
// o HttpError de sumQuoteItems (dado invalido) continua subindo.
function partitionForComparison<T extends ComparisonSourceResponse>(
  requestedItems: { id: number; quantity: number; productName?: string }[],
  responses: T[],
) {
  const complete: {
    response: T;
    price: number;
    quantityAdjusted: boolean;
    quantityMismatches: (ComparisonItemRef & { requested: number; offered: number })[];
  }[] = [];
  const excluded: ExcludedComparisonEntry[] = [];
  const requestedNames = new Map(requestedItems.map((item) => [item.id, item.productName]));
  for (const response of responses) {
    const classification = classifyForComparison(requestedItems, response);
    const responseNames = new Map(
      (response.items ?? []).map((item) => [item.quoteRequestItemId, item.quoteRequestItem?.productName]),
    );
    const nameOf = (id: number) => requestedNames.get(id) ?? responseNames.get(id) ?? `#${id}`;
    const ref = (id: number): ComparisonItemRef => ({ quoteRequestItemId: id, productName: nameOf(id) });
    if (classification.kind === 'complete') {
      complete.push({ response, price: classification.price, quantityAdjusted: false, quantityMismatches: [] });
      continue;
    }
    if (classification.kind === 'adjusted') {
      complete.push({
        response,
        price: classification.price,
        quantityAdjusted: true,
        quantityMismatches: classification.quantityMismatches.map((m) => ({ ...ref(m.quoteRequestItemId), requested: m.requested, offered: m.offered })),
      });
      continue;
    }
    const base = {
      quoteResponseId: response.id,
      supplierId: response.supplierId,
      supplier: { id: response.supplier.id, name: response.supplier.name },
      creditSupportRequestId: response.creditSupportRequestId ?? null,
      creditPartner: response.creditPartner ?? null,
      unavailableItems: (response.items ?? [])
        .filter((item) => item.isUnavailable)
        .map((item) => ({
          quoteRequestItemId: item.quoteRequestItemId,
          productName: item.quoteRequestItem.productName,
        })),
    };
    if (classification.kind === 'unavailable') {
      excluded.push({ ...base, reason: 'unavailable' });
      continue;
    }
    const { details } = classification;
    excluded.push({
      ...base,
      reason: 'partial',
      partial: {
        missingItems: details.missingItemIds.map(ref),
        quantityMismatches: details.quantityMismatches.map((m) => ({ ...ref(m.quoteRequestItemId), requested: m.requested, offered: m.offered })),
        extraItems: details.extraItemIds.map(ref),
        duplicateItems: details.duplicateItemIds.map(ref),
      },
    });
  }
  return { complete, excluded };
}

// Item "Temporarily unavailable" (resposta manual): precos/quantidade 0 e sem incoterm/origem.
function unavailableItemData(quoteRequestItemId: number, notes: string | null | undefined) {
  return {
    quoteRequestItemId,
    unitPrice: 0,
    quantity: 0,
    totalPrice: 0,
    leadTimeDays: null,
    notes: notes ?? null,
    originPort: null,
    incotermPrices: Prisma.DbNull,
    isUnavailable: true,
    // Item indisponivel ignora DG
    isDangerousGood: false,
  };
}

function parseComparisonWeights(payload: unknown): QuoteComparisonWeights | null {
  const defaults = QuoteComparisonService.getDefaultWeights();

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return defaults;
  }

  const parsedBody = quoteComparisonWeightsSchema.safeParse(payload);

  if (!parsedBody.success) {
    return null;
  }

  const body = parsedBody.data;

  return {
    priceWeight: body.priceWeight ?? defaults.priceWeight,
    paymentTermsWeight: body.paymentTermsWeight ?? defaults.paymentTermsWeight,
    incotermWeight: body.incotermWeight ?? defaults.incotermWeight,
    qualityWeight: body.qualityWeight ?? defaults.qualityWeight,
  };
}

// Lead time exibido na comparacao = MAIOR leadTimeDays entre os itens da
// proposta (e' quando o pedido inteiro chega). Sem itens com lead time,
// cai no leadTimeDays de topo da QuoteResponse; sem nenhum dado, null.
function deriveMaxLeadTimeDays(
  items: Array<{ leadTimeDays: number | null }> | undefined,
  responseLeadTimeDays: number | null,
): number | null {
  const itemValues = (items ?? [])
    .map((item) => item.leadTimeDays)
    .filter((value): value is number => typeof value === 'number');

  if (itemValues.length > 0) {
    return Math.max(...itemValues);
  }

  return responseLeadTimeDays ?? null;
}

function shouldIncrementVersion(payload: Record<string, unknown>): boolean {
  return [
    'quoteRequestId',
    'supplierId',
    'offeredPrice',
    'currency',
    'exchangeRate',
    'freightCost',
    'insuranceCost',
    'otherFees',
    'importDuty',
    'ipi',
    'pis',
    'cofins',
    'offeredIncoterm',
    'paymentTermsDays',
    'leadTimeDays',
    'notes',
    'originPort',
    'submittedAt',
  ].some((field) => field in payload);
}

function resolveExchangeRate(value: unknown, currency: string): number {
  if (currency === 'BRL' && (value === undefined || value === null || value === '')) {
    return 1;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(
      400,
      currency === 'BRL'
        ? 'A exchangeRate informada deve ser maior que zero.'
        : 'Informe exchangeRate valida para propostas em moeda estrangeira.',
    );
  }

  return parsed;
}

function hasOwnProperty(value: unknown, key: string): boolean {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, key)
  );
}
