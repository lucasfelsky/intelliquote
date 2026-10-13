import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { CompanyProfileService, readDispatchCc } from '../services/CompanyProfileService';
import {
  CREDIT_OFFER_CHANGED_MESSAGE,
  loadCreditCandidateForAward,
} from '../services/ComparisonCandidateService';
import { CREDIT_SUPPORT_ENTITY_TYPE, CreditSupportService } from '../services/CreditSupportService';
import { sendPurchaseOrderEmail } from '../services/PurchaseOrderEmailService';
import {
  creditSupportForwardSchema,
  creditSupportResendSchema,
  quotePurchaseOrderSchema,
} from '../validators/domain';
import { handleControllerError, HttpError, parseId } from '../utils/http';

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

  // PR4b: Ordem de Compra ao PARCEIRO vencedor (alternativa via Credit Support). Mesmo e-mail
  // `quote_po` da PO ao fornecedor, com o paragrafo citando o fornecedor de origem. To = contato
  // do encaminhamento (fallback: principal do parceiro); CC = dispatchCc; fornecedor NAO em copia.
  static async sendPurchaseOrder(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID do encaminhamento invalido.' });
      }
      const parsedBody = quotePurchaseOrderSchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        return res.status(400).json({
          message: parsedBody.error.issues[0]?.message ?? 'Dados invalidos.',
        });
      }

      const row = await prisma.creditSupportRequest.findFirst({
        where: { id, quoteRequest: { deletedAt: null } },
        include: {
          quoteRequest: {
            include: {
              items: {
                where: { deletedAt: null },
                select: { destinationPort: true },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
          supplier: { select: { id: true, name: true } },
          creditPartner: { select: { id: true, name: true } },
          creditPartnerContact: { select: { id: true, name: true, email: true } },
        },
      });
      if (!row) {
        throw new HttpError(404, 'Encaminhamento nao encontrado.');
      }
      if (row.revokedAt) {
        throw new HttpError(409, 'Este encaminhamento foi revogado.');
      }
      if (row.isWinner !== true) {
        throw new HttpError(
          400,
          'Apenas a oferta vencedora do parceiro pode receber a Ordem de Compra.',
        );
      }

      // Oferta do parceiro (ou proposta de origem) mudou/foi excluida desde o encaminhamento.
      const candidate = await loadCreditCandidateForAward(prisma, {
        creditSupportRequestId: row.id,
        quoteRequestId: row.quoteRequestId,
        quoteResponseId: row.quoteResponseId,
      });
      if (candidate.isStale) {
        throw new HttpError(409, CREDIT_OFFER_CHANGED_MESSAGE);
      }

      const recipient =
        row.creditPartnerContact ??
        (await prisma.creditPartnerContact.findFirst({
          where: { creditPartnerId: row.creditPartnerId },
          orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
          select: { id: true, name: true, email: true },
        }));
      if (!recipient) {
        throw new HttpError(
          400,
          'Parceiro de credito nao possui contato cadastrado para receber a Ordem de Compra.',
        );
      }

      const profile = await CompanyProfileService.get();
      const companyCc = readDispatchCc(profile).map((email) => ({ email, name: '' }));

      const result = await sendPurchaseOrderEmail({
        payload: parsedBody.data,
        quoteRequest: row.quoteRequest,
        recipient: { name: recipient.name, email: recipient.email },
        cc: companyCc,
        user: req.user,
        extraVars: { supplierName: row.supplier.name, creditPartnerName: row.creditPartner.name },
        templateVars: {
          quoteRequestId: row.quoteRequestId,
          quoteResponseId: row.quoteResponseId,
          supplierId: row.supplierId,
          creditSupportRequestId: row.id,
          creditPartnerId: row.creditPartnerId,
          creditPartnerContactId: recipient.id,
        },
        related: { type: CREDIT_SUPPORT_ENTITY_TYPE, id: String(row.id) },
        audit: {
          entityType: CREDIT_SUPPORT_ENTITY_TYPE,
          entityId: row.id,
          metadata: {
            quoteRequestId: row.quoteRequestId,
            quoteResponseId: row.quoteResponseId,
            supplierId: row.supplierId,
            creditPartnerId: row.creditPartnerId,
          },
        },
      });

      return res.status(200).json(result);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
