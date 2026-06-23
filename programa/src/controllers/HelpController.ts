import { Request, Response } from 'express';
import { helpArticles } from '../content/helpArticles';
import { helpArticleListQuerySchema } from '../validators/domain';
import { handleControllerError } from '../utils/http';

function stripAccents(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export class HelpController {
  static list(req: Request, res: Response): Promise<Response> | Response {
    try {
      const parsed = helpArticleListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Filtro de ajuda invalido.' });
      }
      const { category, search } = parsed.data;
      const normalizedSearch = search ? stripAccents(search.toLowerCase()) : null;

      const filtered = helpArticles.filter((article) => {
        if (category && article.category !== category) return false;
        if (normalizedSearch) {
          const haystack = stripAccents(
            `${article.title}\n${article.content}`.toLowerCase(),
          );
          if (!haystack.includes(normalizedSearch)) return false;
        }
        return true;
      });
      // ordenacao estavel por displayOrder
      const sorted = [...filtered].sort((a, b) => a.displayOrder - b.displayOrder);
      return res.status(200).json(sorted);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
