import { Request, Response } from 'express';
import { ItemPriceHistoryService } from '../services/ItemPriceHistoryService';
import { handleControllerError, HttpError } from '../utils/http';
import { quoteRequestItemPriceHistoryParamsSchema } from '../validators/domain';

/**
 * GET /quote-request-items/:id/price-history
 * Historico de preco completo do item, cruzando as cotacoes ligadas ao mesmo CatalogItem.
 * Leitura pura: sem AuditLog.
 */
export class QuoteRequestItemPriceHistoryController {
  static async getByQuoteRequestItem(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = quoteRequestItemPriceHistoryParamsSchema.parse(req.params);

      const history = await ItemPriceHistoryService.listByQuoteRequestItem(id);
      if (!history) {
        throw new HttpError(404, 'Item da cotacao nao encontrado.');
      }

      return res.status(200).json(history);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
