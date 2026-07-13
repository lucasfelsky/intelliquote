import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendAndLog } from '../mailer/MailerService';
import {
  QUOTE_REGRET_TEMPLATE_KEY,
  renderRegretFromTemplate,
} from '../mailer/renderQuoteRegret';
import { CompanyProfileService } from './CompanyProfileService';

// F8 (backlog 2026-07-12): ao concluir uma cotacao, avisa os fornecedores
// NAO selecionados (opt-in via notifyLosers). "Perdedor" = fornecedor que
// respondeu (QuoteResponse) e nao e' o vencedor (isWinner=false), dedup por
// fornecedor. Best-effort: nunca lanca (Promise.allSettled) — falha de SMTP
// nao pode reabrir a cotacao ja fechada.
export interface RegretSweepResult {
  losers: number;
  sent: number;
  failed: number;
}

export class SupplierRegretNotificationService {
  static async notifyLosers(quoteRequestId: number): Promise<RegretSweepResult> {
    const result: RegretSweepResult = { losers: 0, sent: 0, failed: 0 };

    try {
      const request = await prisma.quoteRequest.findUnique({
        where: { id: quoteRequestId },
        select: { requestCode: true, productName: true },
      });
      if (!request) return result;

      const responses = await prisma.quoteResponse.findMany({
        where: { quoteRequestId, isWinner: false, deletedAt: null },
        select: { supplierId: true, supplier: { select: { name: true } } },
      });

      // Dedup por fornecedor (pode haver varias respostas/versoes por supplier).
      const loserSupplierIds = [...new Set(responses.map((response) => response.supplierId))];
      result.losers = loserSupplierIds.length;
      if (loserSupplierIds.length === 0) return result;

      const profile = await CompanyProfileService.get();

      const outcomes = await Promise.allSettled(
        loserSupplierIds.map(async (supplierId) => {
          const supplierName =
            responses.find((response) => response.supplierId === supplierId)?.supplier?.name ??
            `Fornecedor #${supplierId}`;

          const primaryContact = await prisma.supplierContact.findFirst({
            where: { supplierId },
            orderBy: { isPrimary: 'desc' },
          });
          if (!primaryContact?.email) {
            throw new Error(`Fornecedor ${supplierId} sem contato para aviso de nao-selecionado.`);
          }

          const rendered = await renderRegretFromTemplate({
            subject: `Update on your quotation for ${request.requestCode}`,
            contactName: primaryContact.name,
            supplierName,
            requestCode: request.requestCode,
            productName: request.productName ?? '',
            companyName: profile.companyName,
          });

          await sendAndLog({
            to: { email: primaryContact.email, name: primaryContact.name },
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            templateId: QUOTE_REGRET_TEMPLATE_KEY,
            templateVars: { quoteRequestId, supplierId, requestCode: request.requestCode },
            relatedEntityType: 'quote_request',
            relatedEntityId: String(quoteRequestId),
          });
        }),
      );

      for (const outcome of outcomes) {
        if (outcome.status === 'fulfilled') result.sent += 1;
        else result.failed += 1;
      }

      if (result.failed > 0) {
        logger.warn(
          { quoteRequestId, ...result },
          'Alguns avisos de nao-selecionado falharam ao enviar.',
        );
      }
    } catch (error) {
      logger.error(
        {
          quoteRequestId,
          reason: error instanceof Error ? error.message : String(error),
        },
        'Falha ao avisar fornecedores nao selecionados.',
      );
    }

    return result;
  }
}
