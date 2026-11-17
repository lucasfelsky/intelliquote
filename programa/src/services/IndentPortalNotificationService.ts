import { INDENT_MAILBOX, INDENT_PORTAL_NOTIFY_CAP_MS, INDENT_TEMPLATE_RESPONSE_RECEIVED } from '../constants/indentPortal';
import { mailerEnv } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { sendAndLog } from '../mailer/MailerService';
import { renderIndentResponseReceived } from '../mailer/renderIndentResponseReceived';
import { formatQuoteRef } from '../utils/indentQuote';

// IQ Indent PR 4a-2: avisa a Compras que o fornecedor respondeu (ou revisou) pelo portal. Chamado DEPOIS do commit da resposta.
// NUNCA lanca: falha aqui (usuario, SMTP, template) nao pode falhar a resposta do fornecedor. Recebe so ids: nenhum token, link do
// portal nem preco entra no e-mail, no MailLog ou no log.
export class IndentPortalNotificationService {
  // Aguarda o aviso no maximo `capMs`: SMTP lento nao pode atrasar a resposta ao fornecedor (o Hosting corta em 60 s). Passando do teto,
  // o envio continua em segundo plano (a promessa nunca rejeita) e so a CHAVE vai ao log. Nunca lanca e nao segura nenhuma trava.
  static async notifyWithCap(
    input: { quoteId: number; version: number; afterAcceptance: boolean },
    capMs: number = INDENT_PORTAL_NOTIFY_CAP_MS,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capped = new Promise<'capped'>((resolve) => {
      timer = setTimeout(() => resolve('capped'), capMs);
    });

    try {
      const outcome = await Promise.race([IndentPortalNotificationService.notifyResponseReceived(input).then(() => 'done' as const), capped]);

      if (outcome === 'capped') {
        logger.warn({ quoteId: input.quoteId, capMs }, 'Aviso de resposta do portal Indent passou do teto; segue em segundo plano.');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  static async notifyResponseReceived(input: { quoteId: number; version: number; afterAcceptance: boolean }): Promise<void> {
    try {
      const quote = await prisma.indentQuote.findUnique({
        where: { id: input.quoteId },
        select: { id: true, revision: true, supplier: { select: { name: true } }, request: { select: { processNumber: true } } },
      });

      if (!quote) {
        logger.warn({ quoteId: input.quoteId }, 'Aviso de resposta do portal Indent sem cotacao encontrada.');
        return;
      }

      // Destinatario: quem enviou a cotacao (autor do ultimo IndentMailLog), se ainda ativo e com e-mail; senao a caixa do Indent.
      let to: { email: string; name?: string } = { email: INDENT_MAILBOX, name: 'SQ Quimica Indent' };
      const lastMail = await prisma.indentMailLog.findFirst({
        where: { quoteId: input.quoteId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { sentById: true },
      });

      if (lastMail) {
        const sender = await prisma.user.findUnique({
          where: { id: lastMail.sentById },
          select: { name: true, email: true, isActive: true, role: { select: { name: true } } },
        });
        const email = sender?.email?.trim();

        if (sender && sender.isActive !== false && email && sender.role?.name !== 'comercial') {
          to = { email, name: sender.name };
        }
      }

      const rendered = renderIndentResponseReceived({
        supplierName: quote.supplier.name,
        ref: formatQuoteRef(quote.request.processNumber, quote.revision),
        version: input.version,
        afterAcceptance: input.afterAcceptance,
        quoteUrl: `${mailerEnv.portalUrl.replace(/\/$/, '')}/indent/cotacoes?cotacao=${quote.id}`,
      });

      await sendAndLog({
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateId: INDENT_TEMPLATE_RESPONSE_RECEIVED,
        templateVars: { quoteId: input.quoteId, version: input.version, afterAcceptance: input.afterAcceptance },
        relatedEntityType: 'indent_quote',
        relatedEntityId: String(input.quoteId),
      });
    } catch (error) {
      logger.error(
        { quoteId: input.quoteId, reason: error instanceof Error ? error.message : String(error) },
        'Falha ao avisar a Compras sobre a resposta do portal Indent.',
      );
    }
  }
}
