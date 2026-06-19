import { Request, Response } from 'express';
import { Incoterm, QuoteRequestStatus, SupplierStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  QuoteComparisonService,
  type QuoteComparisonWeights,
} from '../services/QuoteComparisonService';
import {
  quoteComparisonWeightsSchema,
  quoteResponseCreateSchema,
  quoteResponseUpdateSchema,
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

      const normalizedCurrency = payload.currency ?? relatedQuoteRequest.currency;
      const landedCost = QuoteComparisonService.calculateLandedCost({
        offeredPrice: payload.offeredPrice,
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
          offeredPrice: payload.offeredPrice,
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

      const nextCurrency = payload.currency ?? existingQuoteResponse.currency;
      const landedCost = QuoteComparisonService.calculateLandedCost({
        offeredPrice:
          payload.offeredPrice !== undefined
            ? payload.offeredPrice
            : Number(existingQuoteResponse.offeredPrice),
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
          offeredPrice: payload.offeredPrice,
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

      if (quoteRequest.status === QuoteRequestStatus.closed) {
        return res.status(400).json({
          message: 'A cotacao esta fechada. Reabra antes de executar nova comparacao.',
        });
      }

      const responses = await prisma.quoteResponse.findMany({
        where: { quoteRequestId },
        orderBy: {
          id: 'asc',
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

      await prisma.$transaction(async (tx) => {
        await tx.quoteResponse.updateMany({
          where: { quoteRequestId },
          data: { isWinner: false },
        });

        for (const response of comparisonResults.filter((item) => item.isWinner)) {
          await tx.quoteResponse.update({
            where: { id: response.id },
            data: { isWinner: true },
          });
        }

        const comparisonRecord = await tx.quoteComparison.create({
          data: {
            quoteRequestId,
            executedById: req.user?.id ?? null,
            priceWeight: weights.priceWeight,
            paymentTermsWeight: weights.paymentTermsWeight,
            incotermWeight: weights.incotermWeight,
            winnerQuoteResponseId: winner?.id ?? null,
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
                totalScore: response.totalScore,
                isWinner: response.isWinner,
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
              status: QuoteRequestStatus.closed,
              closedAt: new Date().toISOString(),
              winnerQuoteResponseId: winner?.id ?? null,
              comparisonId: comparisonRecord.id,
            },
            metadata: {
              comparisonId: comparisonRecord.id,
              winnerQuoteResponseId: winner?.id ?? null,
              weights,
              quoteResponseIds: responses.map((response) => response.id),
            },
          },
          tx,
        );

        await tx.quoteRequest.update({
          where: { id: quoteRequestId },
          data: {
            status: 'closed',
            closedAt: new Date(),
          },
        });
      });

      return res.status(200).json(comparisonResults);
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
                  supplier: true,
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
