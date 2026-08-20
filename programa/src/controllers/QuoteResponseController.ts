import { Request, Response } from 'express';
import { Incoterm, QuoteRequestStatus, SupplierStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  QuoteComparisonService,
  type QuoteComparisonWeights,
} from '../services/QuoteComparisonService';
import { CompanyProfileService, readDispatchCc } from '../services/CompanyProfileService';
import { sendAndLog } from '../mailer/MailerService';
import {
  renderReplyFromTemplate,
  injectReplyCustomMessage,
  withReplyCustomMessageText,
} from '../mailer/renderQuoteReply';
import {
  renderPoFromTemplate,
  injectPoCustomMessage,
  withPoCustomMessageText,
} from '../mailer/renderQuotePo';
import { formatIncoterms } from '../utils/incoterm';
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
          const totalPrice = item.unitPrice * item.quantity;
          total += totalPrice;
          return {
            quoteRequestItemId: item.quoteRequestItemId,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalPrice,
            leadTimeDays: item.leadTimeDays ?? null,
            notes: item.notes ?? null,
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

      const quoteResponse = await prisma.quoteResponse.create({
        data: {
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
          submittedAt: payload.submittedAt,
          createdById: req.user?.id ?? null,
          items: {
            create: itemsToCreate,
          },
        },
      });

      await AuditLogService.log({
        entityType: 'quote_response',
        entityId: quoteResponse.id,
        action: 'create',
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
        where: { id },
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
        where: { id },
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
          let total = 0;
          itemsToUpdate = payload.items.map((item) => {
            const totalPrice = item.unitPrice * item.quantity;
            total += totalPrice;
            return {
              quoteRequestItemId: item.quoteRequestItemId,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              totalPrice,
              leadTimeDays: item.leadTimeDays ?? null,
              notes: item.notes ?? null,
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

      const quoteResponse = await prisma.quoteResponse.update({
        where: { id },
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
          submittedAt: payload.submittedAt,
          version: shouldIncrementVersion(payload) ? { increment: 1 } : undefined,
          items: itemsToUpdate !== undefined ? { deleteMany: {}, create: itemsToUpdate } : undefined,
        },
      });

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
        where: { id },
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

      await prisma.quoteResponse.delete({
        where: { id },
      });

      await AuditLogService.log({
        entityType: 'quote_response',
        entityId: existingQuoteResponse.id,
        action: 'delete',
        performedById: req.user?.id ?? null,
        beforeData: existingQuoteResponse,
        afterData: null,
        metadata: {
          quoteRequestId: existingQuoteResponse.quoteRequestId,
          supplierId: existingQuoteResponse.supplierId,
        },
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
        items: true,
        quoteRequest: {
          include: {
            items: { include: { catalogItem: true }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
  }

  // Renderiza o e-mail de resposta para uma proposta, aplicando o
  // assunto/mensagem digitados na hora (na modal de "Responder") por cima
  // do template padrao/customizado (`quote_reply`, ver Templates.tsx).
  private static async renderReplyFor(
    quoteResponse: NonNullable<Awaited<ReturnType<typeof QuoteResponseController.findReplyQuoteResponse>>>,
    overrides: {
      subject?: string;
      message?: string;
      targetPrice?: number | null;
      itemTargets?: { quoteResponseItemId: number; targetPrice: number | null }[];
    },
    contactName: string,
  ) {
    const { quoteRequest, supplier } = quoteResponse;
    const itemName = quoteRequest.productName || quoteRequest.requestCode;
    const defaultSubject = `${itemName} - SQ QUIMICA - ${supplier.name}`;
    const message = overrides.message?.trim() ?? '';
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

    let hasItemTargets = false;
    const items = quoteRequest.items.map((item) => {
      const responseItem = quoteResponse.items?.find((i) => i.quoteRequestItemId === item.id);
      const actualUnitPrice = responseItem ? Number(responseItem.unitPrice) : (Number.isFinite(unitPrice) ? unitPrice : null);
      const overrideTarget = responseItem ? itemTargetOverrides.get(responseItem.id) : undefined;
      const itemTargetPrice = overrideTarget !== undefined
        ? overrideTarget
        : (responseItem?.targetPrice != null ? Number(responseItem.targetPrice) : null);
      if (itemTargetPrice !== null) hasItemTargets = true;
      return {
        name: item.catalogItem?.marketName ?? item.productName,
        incoterm: item.desiredIncoterm ?? formatIncoterms(quoteRequest.desiredIncoterm),
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: actualUnitPrice,
        targetPrice: itemTargetPrice,
      };
    });

    const rendered = await renderReplyFromTemplate({
      subject: overrides.subject?.trim() || defaultSubject,
      quoteRequestId: quoteRequest.id,
      requestCode: quoteRequest.requestCode,
      productName: quoteRequest.productName ?? '',
      supplierName: supplier.name,
      supplierContactName: contactName,
      currency: quoteResponse.currency,
      targetPrice: overrides.targetPrice !== undefined ? (overrides.targetPrice === null ? undefined : overrides.targetPrice) : (quoteResponse.targetPrice ? Number(quoteResponse.targetPrice) : undefined),
      hasItemTargets,
      isWinner: quoteResponse.isWinner,
      items,
    });

    return {
      subject: rendered.subject,
      html: injectReplyCustomMessage(rendered.html, message),
      text: withReplyCustomMessageText(rendered.text, message),
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

      const rendered = await QuoteResponseController.renderReplyFor(quoteResponse, parsedBody.data, primaryContact.name);

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
          where: { id },
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
            where: { id: itemTarget.quoteResponseItemId, quoteResponseId: id, deletedAt: null },
            data: { targetPrice: itemTarget.targetPrice },
          });
        }
        quoteResponse.items = quoteResponse.items?.map((responseItem) => {
          const match = parsedBody.data.itemTargets!.find(
            (t) => t.quoteResponseItemId === responseItem.id,
          );
          return match ? { ...responseItem, targetPrice: match.targetPrice as any } : responseItem;
        });
      }

      const rendered = await QuoteResponseController.renderReplyFor(quoteResponse, parsedBody.data, primaryContact.name);

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

  // Limite do PDF anexado (base64 em JSON) -- ver override de body-parser em
  // app.ts (10mb) e a TRAP do limite global de 1mb.
  private static readonly PO_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

  private static decodePoAttachment(content: string): Buffer {
    const normalized = content.includes(',') ? content.split(',').pop() ?? '' : content;
    try {
      return Buffer.from(normalized, 'base64');
    } catch (_error) {
      throw new HttpError(400, 'Conteudo base64 do PDF invalido.');
    }
  }

  // Envia (de verdade, via SMTP) o e-mail de "Ordem de Compra" ao contato
  // principal do fornecedor VENCEDOR, com o PDF (upload do usuario, so'-
  // envio) anexado. Botao na tela de Comparacao, so' habilitado quando
  // `quoteResponse.isWinner === true`.
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

      if (parsedBody.data.fileSize > QuoteResponseController.PO_MAX_FILE_SIZE_BYTES) {
        return res.status(400).json({ message: 'O PDF excede o limite de 10MB.' });
      }

      const buffer = QuoteResponseController.decodePoAttachment(parsedBody.data.contentBase64);
      if (buffer.length === 0) {
        return res.status(400).json({ message: 'Conteudo do PDF vazio.' });
      }
      if (buffer.length > QuoteResponseController.PO_MAX_FILE_SIZE_BYTES) {
        return res.status(400).json({ message: 'O PDF excede o limite de 10MB.' });
      }

      const { quoteRequest } = quoteResponse;
      const defaultSubject = `Purchase Order - ${quoteRequest.requestCode}`;
      const message = parsedBody.data.message?.trim() ?? '';

      const rendered = await renderPoFromTemplate({
        subject: parsedBody.data.subject?.trim() || defaultSubject,
        requestCode: quoteRequest.requestCode,
        supplierContactName: primaryContact.name,
        forwarderInfo: parsedBody.data.forwarderInfo?.trim() ?? '',
      });

      const html = injectPoCustomMessage(rendered.html, message);
      const text = withPoCustomMessageText(rendered.text, message);

      const sendResult = await sendAndLog({
        to: { email: primaryContact.email, name: primaryContact.name },
        cc: companyCc,
        subject: rendered.subject,
        html,
        text,
        templateId: 'quote-po',
        templateVars: {
          quoteRequestId: quoteRequest.id,
          quoteResponseId: quoteResponse.id,
          supplierId: quoteResponse.supplier.id,
          supplierContactId: primaryContact.id,
          forwarderInfo: parsedBody.data.forwarderInfo ?? null,
          hasCustomMessage: Boolean(message),
        },
        relatedEntityType: 'quote_response',
        relatedEntityId: String(id),
        attachments: [
          {
            filename: parsedBody.data.fileName,
            content: buffer,
            contentType: 'application/pdf',
          },
        ],
      });

      await AuditLogService.log({
        entityType: 'quote_response',
        entityId: id,
        action: 'purchase_order',
        performedById: req.user?.id ?? null,
        metadata: {
          to: primaryContact.email,
          cc: companyCc.map((c) => c.email),
          status: sendResult.status,
          subject: rendered.subject,
          fileName: parsedBody.data.fileName,
          fileSize: buffer.length,
        },
      });

      if (sendResult.status === 'failed') {
        return res.status(502).json({
          message: sendResult.error || 'Falha ao enviar a Ordem de Compra.',
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
        where: { id: quoteRequestId },
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
        where: { quoteRequestId },
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
        },
      });

      if (responses.length === 0) {
        return res.status(404).json({
          message: 'Nenhuma proposta encontrada para esta cotacao.',
        });
      }

      if (responses.length < 2) {
        return res.status(400).json({
          message: 'Sao necessarias pelo menos duas propostas para comparar.',
        });
      }

      const supplierIds = Array.from(new Set(responses.map(r => r.supplierId)));
      const reviews = await prisma.supplierReview.groupBy({
        by: ['supplierId'],
        _avg: { qualityRating: true },
        where: { supplierId: { in: supplierIds } },
      });
      const qualityMap = new Map(
        reviews.map(r => [r.supplierId, r._avg.qualityRating]),
      );

      const comparisonInputs = responses.map((response) => ({
        id: response.id,
        quoteRequestId: response.quoteRequestId,
        supplierId: response.supplierId,
        offeredPrice: Number(response.offeredPrice),
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
      if (winner && threshold !== null && winner.totalLandedCost > threshold) {
        requiresApproval = true;
      }

      const comparisonRecord = await prisma.$transaction(async (tx) => {
        await tx.quoteResponse.updateMany({
          where: { quoteRequestId },
          data: { isWinner: false },
        });

        if (!requiresApproval) {
          for (const response of comparisonResults.filter((item) => item.isWinner)) {
            await tx.quoteResponse.update({
              where: { id: response.id },
              data: { isWinner: true },
            });
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
            approvalStatus: requiresApproval ? 'pending' : 'not_required',
            results: {
              create: comparisonResults.map((response) => ({
                quoteResponseId: response.id,
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
              comparisonId: comparisonRecord.id,
              approvalStatus: comparisonRecord.approvalStatus,
            },
            metadata: {
              comparisonId: comparisonRecord.id,
              winnerQuoteResponseId: winner?.id ?? null,
              weights,
              requiresApproval,
              threshold,
              quoteResponseIds: responses.map((response) => response.id),
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
      const enrichedResults = comparisonResults.map((result) => {
        const supplier = supplierById.get(result.supplierId);
        const primaryContact = supplier?.contacts?.[0] ?? null;
        return {
          ...result,
          supplier: supplier ? { id: supplier.id, name: supplier.name } : undefined,
          contact: primaryContact
            ? { id: primaryContact.id, name: primaryContact.name, email: primaryContact.email }
            : null,
        };
      });

      return res.status(200).json({
        results: enrichedResults,
        pendingApproval: requiresApproval,
        winnerQuoteResponseId: requiresApproval ? winner?.id : null,
        thresholdValue: requiresApproval ? threshold : null,
        comparisonId: comparisonRecord.id,
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
        where: { id: quoteRequestId },
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

      await prisma.$transaction(async (tx) => {
        await tx.quoteComparison.update({
          where: { id: comparisonId },
          data: {
            approvalStatus: 'approved',
            approvedById: req.user?.id ?? null,
            approvedAt: new Date(),
          },
        });

        await tx.quoteResponse.update({
          where: { id: comparison.winnerQuoteResponseId! },
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
            },
            metadata: {},
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

      const quoteRequest = await prisma.quoteRequest.findUnique({
        where: { id: quoteRequestId },
      });

      if (!quoteRequest) {
        return res.status(404).json({ message: 'Cotação não encontrada.' });
      }

      const chosenResponse = await prisma.quoteResponse.findFirst({
        where: { id: quoteResponseId, quoteRequestId, deletedAt: null },
      });

      if (!chosenResponse) {
        return res.status(404).json({
          message: 'Proposta não encontrada para esta cotação.',
        });
      }

      const latestComparison = await prisma.quoteComparison.findFirst({
        where: { quoteRequestId },
        orderBy: { createdAt: 'desc' },
      });

      const previousWinnerId = latestComparison?.winnerQuoteResponseId ?? null;
      const trimmedReason = reason?.trim() ?? null;

      if (
        latestComparison?.winnerQuoteResponseId &&
        quoteResponseId !== previousWinnerId &&
        !trimmedReason
      ) {
        return res.status(400).json({
          message: 'Informe o motivo para escolher um vencedor diferente do calculado.',
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.quoteResponse.updateMany({
          where: { quoteRequestId },
          data: { isWinner: false },
        });

        await tx.quoteResponse.update({
          where: { id: quoteResponseId },
          data: { isWinner: true },
        });

        if (latestComparison) {
          await tx.quoteComparisonResult.updateMany({
            where: { comparisonId: latestComparison.id },
            data: { isWinner: false },
          });

          await tx.quoteComparisonResult.updateMany({
            where: { comparisonId: latestComparison.id, quoteResponseId },
            data: { isWinner: true },
          });

          await tx.quoteComparison.update({
            where: { id: latestComparison.id },
            data: {
              winnerQuoteResponseId: quoteResponseId,
              approvalStatus: 'not_required',
            },
          });
        }

        await AuditLogService.log(
          {
            entityType: 'quote_request',
            entityId: quoteRequestId,
            action: 'manual_winner',
            performedById: req.user?.id ?? null,
            beforeData: { winnerQuoteResponseId: previousWinnerId },
            afterData: { winnerQuoteResponseId: quoteResponseId },
            metadata: {
              reason: trimmedReason,
              previousWinnerQuoteResponseId: previousWinnerId,
              newWinnerQuoteResponseId: quoteResponseId,
              comparisonId: latestComparison?.id ?? null,
            },
          },
          tx,
        );
      });

      return res.status(200).json({
        winnerQuoteResponseId: quoteResponseId,
        comparisonId: latestComparison?.id ?? null,
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
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
