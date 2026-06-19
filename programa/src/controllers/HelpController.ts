import { Request, Response } from 'express';
import { helpArticles } from '../content/helpArticles';
import { helpArticleListQuerySchema } from '../validators/domain';
import { handleControllerError } from '../utils/http';

export class HelpController {
  static list(req: Request, res: Response): Promise<Response> | Response {
    try {
      const parsed = helpArticleListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Filtro de ajuda invalido.' });
      }
      const category = parsed.data.category;
      const articles = category
        ? helpArticles.filter((article) => article.category === category)
        : helpArticles;
      return res.status(200).json(articles);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
