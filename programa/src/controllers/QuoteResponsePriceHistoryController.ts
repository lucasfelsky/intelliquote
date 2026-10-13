import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { QuoteResponsePriceHistoryService } from '../services/QuoteResponsePriceHistoryService';
import { handleControllerError, parseId } from '../utils/http';

/**
 * GET /quote-responses/:id/price-history
 * Historico de preco da resposta do fornecedor (snapshots append-only).
 * Fica fora do QuoteResponseController (2k+ linhas) de proposito.
 */
export class QuoteResponsePriceHistoryController {
  static async getByQuoteResponse(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID da proposta invalido.' });
      }

      const response = await prisma.quoteResponse.findUnique({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      if (!response) {
        return res.status(404).json({ message: 'Proposta nao encontrada.' });
      }

      const history = await QuoteResponsePriceHistoryService.listByQuoteResponse(id);
      return res.status(200).json(history);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
