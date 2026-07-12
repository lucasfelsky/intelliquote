import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { mailerEnv } from '../config/env';
import { sendAndLog } from '../mailer/MailerService';
import {
  SUPPLIER_RESPONSE_RECEIVED_TEMPLATE_KEY,
  renderSupplierResponseReceivedFromTemplate,
} from '../mailer/renderSupplierResponseReceived';

// F1 (backlog 2026-07-12): fecha o loop do portal — quando o fornecedor
// submete (ou revisa) uma resposta, o COMPRADOR que disparou a cotação
// (token.createdBy) é avisado por e-mail. Antes ele só descobria abrindo a
// tela de Respostas.
//
// Regras de robustez:
// - NUNCA lança: falha aqui não pode falhar (nem atrasar com throw) o submit
//   do fornecedor. Tudo em try/catch com logger.error.
// - Chamado APÓS a transação do submit (dados já commitados).
export class SupplierResponseNotificationService {
  static async notifyBuyerOfSupplierResponse(input: {
    tokenId: number;
    totalPrice: string;
    currency: string;
    itemsCount: number;
    version: number;
    revised: boolean;
  }): Promise<void> {
    try {
      const token = await prisma.supplierPortalToken.findUnique({
        where: { id: input.tokenId },
        include: {
          createdBy: { select: { name: true, email: true, isActive: true } },
          supplier: { select: { name: true } },
          supplierContact: { select: { name: true } },
          quoteRequest: { select: { requestCode: true, productName: true } },
        },
      });

      if (!token?.createdBy?.email) {
        logger.warn(
          { tokenId: input.tokenId },
          'Aviso de resposta do fornecedor sem comprador para notificar.',
        );
        return;
      }

      if (!token.createdBy.isActive) {
        logger.info(
          { tokenId: input.tokenId },
          'Comprador inativo; aviso de resposta do fornecedor não enviado.',
        );
        return;
      }

      const requestCode = token.quoteRequest.requestCode;
      const supplierName = token.supplier.name;
      const revisionLabel = input.revised ? `revisão v${input.version}` : '';
      const base = mailerEnv.portalUrl.replace(/\/$/, '');

      const rendered = await renderSupplierResponseReceivedFromTemplate({
        subject: input.revised
          ? `[IntelliQuote] ${supplierName} revisou a resposta da cotação ${requestCode}`
          : `[IntelliQuote] Nova resposta de ${supplierName} na cotação ${requestCode}`,
        buyerName: token.createdBy.name,
        supplierName,
        contactName: token.supplierContact.name,
        requestCode,
        productName: token.quoteRequest.productName ?? '',
        totalPrice: input.totalPrice,
        currency: input.currency,
        itemsCount: input.itemsCount,
        revisionLabel,
        responsesUrl: `${base}/respostas`,
      });

      await sendAndLog({
        to: { email: token.createdBy.email, name: token.createdBy.name },
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateId: SUPPLIER_RESPONSE_RECEIVED_TEMPLATE_KEY,
        templateVars: {
          tokenId: input.tokenId,
          requestCode,
          supplierName,
          revised: input.revised,
          version: input.version,
        },
        relatedEntityType: 'supplierPortalToken',
        relatedEntityId: String(input.tokenId),
      });
    } catch (error) {
      logger.error(
        {
          tokenId: input.tokenId,
          reason: error instanceof Error ? error.message : String(error),
        },
        'Falha ao avisar o comprador sobre resposta do fornecedor.',
      );
    }
  }
}
