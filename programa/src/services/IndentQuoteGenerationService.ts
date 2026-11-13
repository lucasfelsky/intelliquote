import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { computeCoverage, evaluateSupplierRule, type IndentRuleMode } from '../utils/indentSupplierRule';
import type { IndentGenerateQuotesInput } from '../validators/indentRequest';
import { AuditLogService } from './AuditLogService';
import type { IndentActor } from './IndentRequestService';

const SUPPLIER_LIST_LIMIT = 500;

function ruleSupplierIds(rules: Array<{ supplierId: number }>): Set<number> {
  return new Set(rules.map((rule) => rule.supplierId));
}

export class IndentQuoteGenerationService {
  // Lista do seletor: fornecedores ativos com a restricao do cliente e a cobertura dos itens calculadas aqui.
  // Ordem: permitido primeiro, maior cobertura, nome.
  static async supplierOptions(requestId: number) {
    const request = await prisma.indentRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        clientId: true,
        items: { select: { productId: true } },
        client: {
          select: {
            supplierRuleMode: true,
            supplierRules: { select: { supplierId: true } },
          },
        },
      },
    });

    if (!request) {
      throw new HttpError(404, 'Solicitação não encontrada.');
    }
    if (request.clientId === null || !request.client) {
      throw new HttpError(409, 'Vincule o cliente antes de escolher fornecedores.');
    }

    const mode = request.client.supplierRuleMode as IndentRuleMode;
    const ruleIds = ruleSupplierIds(request.client.supplierRules);
    const itemProductIds = request.items.map((item) => item.productId);
    const itemProductIdList = itemProductIds.filter((id): id is number => id !== null);

    const suppliers = await prisma.indentSupplier.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        country: true,
        type: true,
        hasPartnership: true,
        defaultCurrency: true,
        defaultIncoterm: true,
        // So os vinculos dos produtos deste pedido (a cobertura nao precisa do catalogo inteiro do fornecedor).
        products: { where: { productId: { in: itemProductIdList } }, select: { productId: true } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: SUPPLIER_LIST_LIMIT,
    });

    const options = suppliers.map((supplier) => {
      const rule = evaluateSupplierRule(mode, ruleIds, supplier.id);
      const coverage = computeCoverage(
        itemProductIds,
        new Set(supplier.products.map((link) => link.productId)),
      );

      return {
        id: supplier.id,
        name: supplier.name,
        country: supplier.country,
        type: supplier.type,
        hasPartnership: supplier.hasPartnership,
        defaultCurrency: supplier.defaultCurrency,
        defaultIncoterm: supplier.defaultIncoterm,
        allowed: rule.allowed,
        blockedReason: rule.blockedReason,
        approvedByClient: mode === 'APROVADOS' && ruleIds.has(supplier.id),
        coverage,
      };
    });

    options.sort((a, b) => {
      if (a.allowed !== b.allowed) {
        return a.allowed ? -1 : 1;
      }
      if (a.coverage.covered !== b.coverage.covered) {
        return b.coverage.covered - a.coverage.covered;
      }
      return a.name.localeCompare(b.name, 'pt-BR');
    });

    return { clientRuleMode: mode, suppliers: options };
  }

  // Uma cotacao RASCUNHO por fornecedor, todas com o numero da solicitacao. A restricao e recalculada AQUI
  // (nunca confia no que o front mostrou); fornecedor travado so entra com motivo, que fica na cotacao e no historico.
  static async generate(requestId: number, input: IndentGenerateQuotesInput, user: IndentActor) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "IndentRequest" WHERE id = ${requestId} FOR NO KEY UPDATE`;

        const request = await tx.indentRequest.findUnique({
          where: { id: requestId },
          select: {
            id: true,
            processNumber: true,
            clientId: true,
            status: true,
            items: {
              orderBy: { position: 'asc' },
              select: { id: true, productId: true, confirmed: true },
            },
            quotes: { select: { id: true } },
            client: {
              select: {
                supplierRuleMode: true,
                supplierRules: { select: { supplierId: true } },
              },
            },
          },
        });

        if (!request) {
          throw new HttpError(404, 'Solicitação não encontrada.');
        }
        if (request.clientId === null || !request.client) {
          throw new HttpError(409, 'Vincule o cliente antes de gerar cotações.');
        }
        if (request.status !== 'NOVA' || request.quotes.length > 0) {
          throw new HttpError(409, 'As cotações desta solicitação já foram geradas.');
        }
        if (request.items.length === 0) {
          throw new HttpError(400, 'A solicitação não tem itens.');
        }
        if (request.items.some((item) => !item.confirmed || item.productId === null)) {
          throw new HttpError(400, 'Confirme os itens antes de gerar cotações.');
        }

        const supplierIds = input.suppliers.map((entry) => entry.supplierId);
        const suppliers = await tx.indentSupplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, name: true, isActive: true, defaultCurrency: true, defaultIncoterm: true },
        });
        const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

        if (supplierIds.some((id) => !supplierById.get(id)?.isActive)) {
          throw new HttpError(400, 'Fornecedor inexistente ou inativo.');
        }

        const mode = request.client.supplierRuleMode as IndentRuleMode;
        const ruleIds = ruleSupplierIds(request.client.supplierRules);

        // Valida TODOS antes de gravar qualquer cotacao: excecao sem motivo nao grava nem os permitidos.
        const planned = input.suppliers.map((entry) => {
          const supplier = supplierById.get(entry.supplierId)!;
          const rule = evaluateSupplierRule(mode, ruleIds, supplier.id);
          const reason = (entry.exceptionReason ?? '').trim();

          if (!rule.allowed && !reason) {
            throw new HttpError(400, `Informe o motivo da exceção para ${supplier.name}.`);
          }

          return { supplier, exceptionReason: rule.allowed ? null : reason };
        });

        const exceptionAt = new Date();
        const quotes: Array<{
          id: number;
          supplierId: number;
          supplierName: string;
          exception: { reason: string; byName: string; at: Date } | null;
        }> = [];

        for (const plan of planned) {
          const exception = plan.exceptionReason
            ? { reason: plan.exceptionReason, byName: user.name, at: exceptionAt }
            : null;

          const created = await tx.indentQuote.create({
            data: {
              requestId,
              supplierId: plan.supplier.id,
              status: 'RASCUNHO',
              currency: plan.supplier.defaultCurrency,
              incoterm: plan.supplier.defaultIncoterm,
              destination: null,
              createdById: user.id,
              ...(exception
                ? {
                    exceptionReason: exception.reason,
                    exceptionById: user.id,
                    exceptionByName: exception.byName,
                    exceptionAt: exception.at,
                  }
                : {}),
              items: { create: request.items.map((item) => ({ requestItemId: item.id })) },
            },
            select: { id: true },
          });

          quotes.push({
            id: created.id,
            supplierId: plan.supplier.id,
            supplierName: plan.supplier.name,
            exception,
          });

          if (exception) {
            await AuditLogService.log(
              {
                entityType: 'indent_quote',
                entityId: created.id,
                action: 'indent_quote.exception_granted',
                performedById: user.id,
                afterData: {
                  requestId,
                  processNumber: request.processNumber,
                  supplierId: plan.supplier.id,
                  reason: exception.reason,
                  clientRuleMode: mode,
                },
              },
              tx,
            );
          }
        }

        await tx.indentRequest.update({
          where: { id: requestId },
          data: { status: 'COTACAO', statusChangedAt: new Date() },
        });

        await AuditLogService.log(
          {
            entityType: 'indent_request',
            entityId: requestId,
            action: 'indent_request.quotes_generated',
            performedById: user.id,
            metadata: {
              quoteIds: quotes.map((quote) => quote.id),
              supplierIds: quotes.map((quote) => quote.supplierId),
              exceptionSupplierIds: quotes.filter((quote) => quote.exception).map((quote) => quote.supplierId),
            },
          },
          tx,
        );

        return { processNumber: request.processNumber, quotes };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'As cotações desta solicitação já foram geradas.');
      }
      throw error;
    }
  }
}
