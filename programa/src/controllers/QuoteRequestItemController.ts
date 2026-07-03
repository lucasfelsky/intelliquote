import { Incoterm, Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  handleControllerError,
  HttpError,
  isNonEmptyString,
  isPositiveNumber,
  parseId,
} from '../utils/http';

export class QuoteRequestItemController {
  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const quoteRequestId = parseId(req.params.quoteRequestId);
      const {
        catalogItemId,
        itemCode,
        productName,
        description,
        quantity,
        unit,
        desiredIncoterm,
        destinationPort,
        targetPrice,
        notes,
      } = req.body;

      const hasCatalog = catalogItemId !== undefined && catalogItemId !== null;
      const hasFreeText = isNonEmptyString(productName);

      if (
        !quoteRequestId ||
        (hasCatalog && !isPositiveNumber(catalogItemId)) ||
        (!hasCatalog && !hasFreeText) ||
        (hasCatalog && !isPositiveNumber(quantity)) ||
        (!hasCatalog && !isPositiveNumber(quantity)) ||
        !isNonEmptyString(unit) ||
        (itemCode !== undefined && itemCode !== null && !isNonEmptyString(itemCode)) ||
        (description !== undefined && description !== null && !isNonEmptyString(description)) ||
        (desiredIncoterm !== undefined &&
          desiredIncoterm !== null &&
          desiredIncoterm !== '' &&
          !(Object.values(Incoterm) as string[]).includes(String(desiredIncoterm))) ||
        (destinationPort !== undefined &&
          destinationPort !== null &&
          !isNonEmptyString(destinationPort)) ||
        (targetPrice !== undefined && targetPrice !== null && !isPositiveNumber(targetPrice)) ||
        (notes !== undefined && notes !== null && !isNonEmptyString(notes))
      ) {
        return res.status(400).json({
          message:
            'Informe catalogItemId (recomendado) ou productName e demais dados do item com valores validos.',
        });
      }

      const quoteRequest = await prisma.quoteRequest.findUnique({
        where: { id: quoteRequestId },
      });

      if (!quoteRequest) {
        return res.status(404).json({
          message: 'Cotacao nao encontrada para vincular o item.',
        });
      }

      ensureQuoteRequestOpen(
        quoteRequest.status,
        'Nao e possivel adicionar itens em cotacoes fechadas.',
      );

      let resolvedCatalogItemId: number | null = null;
      let resolvedProductName: string;

      if (hasCatalog) {
        const ci = await prisma.catalogItem.findUnique({
          where: { id: Number(catalogItemId) },
        });
        if (!ci) {
          return res.status(400).json({
            message: 'Item de catalogo nao encontrado.',
          });
        }
        if (!ci.isActive) {
          return res.status(400).json({
            message:
              'Item de catalogo inativo. Reative-o antes de vincular a cotacao.',
          });
        }
        resolvedCatalogItemId = ci.id;
        // productName fica com o nome comercial (uso interno); o fornecedor vera o marketName.
        resolvedProductName = hasFreeText
          ? (productName as string).trim()
          : ci.commercialName;
      } else {
        resolvedProductName = (productName as string).trim();
      }

      // Se o item nao trouxe incoterm proprio, fica null -- a exibicao
      // (portal, e-mails, telas) resolve o fallback exibindo os incoterms
      // aceitos pela cotacao. Nao ha um unico valor "herdavel" agora que a
      // cotacao aceita varios incoterms.
      // Porto: se o item nao trouxe porto proprio, herda da cotacao para
      // manter consistencia visual com o portal do fornecedor.
      const item = await prisma.quoteRequestItem.create({
        data: {
          quoteRequestId,
          catalogItemId: resolvedCatalogItemId,
          itemCode: isNonEmptyString(itemCode) ? itemCode.trim().toUpperCase() : null,
          productName: resolvedProductName,
          description: isNonEmptyString(description) ? description.trim() : null,
          quantity: Number(quantity),
          unit: unit.trim().toUpperCase(),
          desiredIncoterm: desiredIncoterm ? (String(desiredIncoterm) as Incoterm) : null,
          destinationPort: isNonEmptyString(destinationPort)
            ? (destinationPort as string).trim()
            : quoteRequest.destinationPort ?? null,
          targetPrice:
            targetPrice !== undefined && targetPrice !== null ? Number(targetPrice) : null,
          notes: isNonEmptyString(notes) ? notes.trim() : null,
        },
        include: {
          quoteRequest: true,
          catalogItem: true,
        },
      });

      await AuditLogService.log({
        entityType: 'quote_request_item',
        entityId: item.id,
        action: 'create',
        performedById: req.user?.id ?? null,
        afterData: item,
        metadata: {
          quoteRequestId,
          catalogItemId: resolvedCatalogItemId,
        },
      });

      return res.status(201).json(item);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getAll(_req: Request, res: Response): Promise<Response> {
    try {
      const items = await prisma.quoteRequestItem.findMany({
        include: {
          quoteRequest: true,
          catalogItem: true,
        },
        orderBy: [
          { quoteRequestId: 'desc' },
          { createdAt: 'asc' },
        ],
      });

      return res.status(200).json(items);
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
          message: 'ID do item invalido.',
        });
      }

      const item = await prisma.quoteRequestItem.findUnique({
        where: { id },
        include: {
          quoteRequest: true,
          catalogItem: true,
        },
      });

      if (!item) {
        return res.status(404).json({
          message: 'Item de cotacao nao encontrado.',
        });
      }

      return res.status(200).json(item);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      const {
        quoteRequestId,
        catalogItemId,
        itemCode,
        productName,
        description,
        quantity,
        unit,
        desiredIncoterm,
        destinationPort,
        targetPrice,
        notes,
      } = req.body;

      if (
        !id ||
        (quoteRequestId !== undefined && !isPositiveNumber(quoteRequestId)) ||
        (catalogItemId !== undefined &&
          catalogItemId !== null &&
          !isPositiveNumber(catalogItemId)) ||
        (itemCode !== undefined && itemCode !== null && !isNonEmptyString(itemCode)) ||
        (productName !== undefined && !isNonEmptyString(productName)) ||
        (description !== undefined && description !== null && !isNonEmptyString(description)) ||
        (quantity !== undefined && !isPositiveNumber(quantity)) ||
        (unit !== undefined && !isNonEmptyString(unit)) ||
        (desiredIncoterm !== undefined &&
          desiredIncoterm !== null &&
          desiredIncoterm !== '' &&
          !(Object.values(Incoterm) as string[]).includes(String(desiredIncoterm))) ||
        (destinationPort !== undefined &&
          destinationPort !== null &&
          !isNonEmptyString(destinationPort)) ||
        (targetPrice !== undefined && targetPrice !== null && !isPositiveNumber(targetPrice)) ||
        (notes !== undefined && notes !== null && !isNonEmptyString(notes))
      ) {
        return res.status(400).json({
          message: 'Os dados enviados para atualizar o item sao invalidos.',
        });
      }

      const existingItem = await prisma.quoteRequestItem.findUnique({
        where: { id },
        include: {
          quoteRequest: true,
        },
      });

      if (!existingItem) {
        return res.status(404).json({
          message: 'Item de cotacao nao encontrado.',
        });
      }

      if (
        quoteRequestId !== undefined &&
        Number(quoteRequestId) !== existingItem.quoteRequestId
      ) {
        return res.status(400).json({
          message: 'Nao e permitido mover um item para outra cotacao.',
        });
      }

      ensureQuoteRequestOpen(
        existingItem.quoteRequest.status,
        'Reabra a cotacao antes de alterar os seus itens.',
      );

      const data: Prisma.QuoteRequestItemUncheckedUpdateInput = {};
      if (catalogItemId !== undefined) {
        if (catalogItemId === null) {
          data.catalogItemId = null;
        } else {
          const ci = await prisma.catalogItem.findUnique({
            where: { id: Number(catalogItemId) },
          });
          if (!ci) {
            return res.status(400).json({
              message: 'Item de catalogo nao encontrado.',
            });
          }
          if (!ci.isActive) {
            return res.status(400).json({
              message:
                'Item de catalogo inativo. Reative-o antes de vincular a cotacao.',
            });
          }
          data.catalogItemId = ci.id;
        }
      }
      if (itemCode !== undefined) {
        data.itemCode =
          itemCode === null
            ? null
            : isNonEmptyString(itemCode)
              ? itemCode.trim().toUpperCase()
              : undefined;
      }
      if (isNonEmptyString(productName)) {
        data.productName = productName.trim();
      }
      if (description !== undefined) {
        data.description =
          description === null
            ? null
            : isNonEmptyString(description)
              ? description.trim()
              : undefined;
      }
      if (quantity !== undefined) {
        data.quantity = Number(quantity);
      }
      if (isNonEmptyString(unit)) {
        data.unit = unit.trim().toUpperCase();
      }
      if (desiredIncoterm !== undefined) {
        if (desiredIncoterm === null || desiredIncoterm === '') {
          data.desiredIncoterm = null;
        } else {
          data.desiredIncoterm = String(desiredIncoterm) as Incoterm;
        }
      }
      if (destinationPort !== undefined) {
        if (destinationPort === null || destinationPort === '') {
          data.destinationPort = existingItem.quoteRequest.destinationPort;
        } else if (isNonEmptyString(destinationPort)) {
          data.destinationPort = (destinationPort as string).trim();
        }
      }
      if (targetPrice !== undefined) {
        data.targetPrice =
          targetPrice === null ? null : Number(targetPrice);
      }
      if (notes !== undefined) {
        data.notes =
          notes === null
            ? null
            : isNonEmptyString(notes)
              ? notes.trim()
              : undefined;
      }

      const item = await prisma.quoteRequestItem.update({
        where: { id },
        data,
        include: {
          quoteRequest: true,
          catalogItem: true,
        },
      });

      await AuditLogService.log({
        entityType: 'quote_request_item',
        entityId: item.id,
        action: 'update',
        performedById: req.user?.id ?? null,
        beforeData: existingItem,
        afterData: item,
        metadata: {
          quoteRequestId: existingItem.quoteRequestId,
        },
      });

      return res.status(200).json(item);
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
          message: 'ID do item invalido.',
        });
      }

      const existingItem = await prisma.quoteRequestItem.findUnique({
        where: { id },
        include: {
          quoteRequest: true,
        },
      });

      if (!existingItem) {
        return res.status(404).json({
          message: 'Item de cotacao nao encontrado.',
        });
      }

      ensureQuoteRequestOpen(
        existingItem.quoteRequest.status,
        'Reabra a cotacao antes de remover itens.',
      );

      await prisma.quoteRequestItem.delete({
        where: { id },
      });

      await AuditLogService.log({
        entityType: 'quote_request_item',
        entityId: existingItem.id,
        action: 'delete',
        performedById: req.user?.id ?? null,
        beforeData: existingItem,
        afterData: null,
        metadata: {
          quoteRequestId: existingItem.quoteRequestId,
        },
      });

      return res.status(204).send();
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}

function ensureQuoteRequestOpen(
  status: string,
  message: string,
): void {
  if (status === 'closed') {
    throw new HttpError(400, message);
  }
}
