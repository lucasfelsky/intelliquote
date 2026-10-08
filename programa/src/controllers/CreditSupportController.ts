import { Request, Response } from 'express';
import { CreditSupportService } from '../services/CreditSupportService';
import { creditSupportForwardSchema, creditSupportResendSchema } from '../validators/domain';
import { handleControllerError, parseId } from '../utils/http';

const SESSION_EXPIRED = 'Sessao expirada. Faca login novamente.';

// Credit Support (PR2a): rotas autenticadas (/api/v1). O portal publico do parceiro e o PR2b.
export class CreditSupportController {
  static async preview(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID da proposta invalido.' });
      }
      const parsed = creditSupportForwardSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: parsed.error.issues[0]?.message ?? 'Os dados enviados sao invalidos.' });
      }
      const result = await CreditSupportService.preview(id, parsed.data);
      return res.status(200).json(result);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async forward(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID da proposta invalido.' });
      }
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: SESSION_EXPIRED });
      }
      const parsed = creditSupportForwardSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: parsed.error.issues[0]?.message ?? 'Os dados enviados sao invalidos.' });
      }
      const result = await CreditSupportService.forward(id, userId, parsed.data);
      return res.status(201).json(result);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async listByQuoteRequest(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID da cotacao invalido.' });
      }
      const result = await CreditSupportService.listByQuoteRequest(id);
      return res.status(200).json(result);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async revoke(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID do encaminhamento invalido.' });
      }
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: SESSION_EXPIRED });
      }
      const result = await CreditSupportService.revoke(id, userId);
      return res.status(200).json(result);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async resend(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID do encaminhamento invalido.' });
      }
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: SESSION_EXPIRED });
      }
      const parsed = creditSupportResendSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: parsed.error.issues[0]?.message ?? 'Os dados enviados sao invalidos.' });
      }
      const result = await CreditSupportService.resend(id, userId, parsed.data.ttlDays);
      return res.status(201).json(result);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
