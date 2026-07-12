import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { mailerEnv, reminderEnv } from '../config/env';
import { sendAndLog } from '../mailer/MailerService';
import {
  QUOTE_REMINDER_TEMPLATE_KEY,
  renderReminderFromTemplate,
} from '../mailer/renderQuoteReminder';
import { SupplierPortalService } from './SupplierPortalService';
import { CompanyProfileService } from './CompanyProfileService';

// F5 (backlog 2026-07-12): lembrete automatico pre-deadline para fornecedor
// que ainda nao respondeu. Como o token cru NAO e' armazenado (so o hash),
// o lembrete emite um token NOVO com o MESMO deadline do original.
//
// Ordem das operacoes (pensada pro pior caso):
//   1. CLAIM atomico no token original (updateMany reminderSentAt null->now):
//      so uma replica do Cloud Run ganha; as demais pulam.
//   2. Emite token novo (expiresAt = original, reminderSentAt ja setado —
//      nunca gera novo lembrete).
//   3. Envia o e-mail.
//   4. SO ENTAO revoga o original — se o SMTP falhar, o fornecedor continua
//      com o link antigo valido (o claim fica queimado: sem retry automatico,
//      o reenvio manual do dispatch cobre o caso raro).
export interface ReminderSweepResult {
  due: number;
  sent: number;
  skipped: number;
  failed: number;
}

function formatDisplayDate(value: Date): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

function buildPortalLink(rawToken: string): string {
  const base = mailerEnv.portalUrl.replace(/\/$/, '');
  // Mesmo cache-buster do dispatch (Firebase Hosting cacheia portal.html).
  const v = Date.now();
  return `${base}/portal?token=${encodeURIComponent(rawToken)}&v=${v}`;
}

export class SupplierPortalReminderService {
  static async runReminderSweep(
    now: Date = new Date(),
    windowHours: number = reminderEnv.windowHours,
  ): Promise<ReminderSweepResult> {
    const result: ReminderSweepResult = { due: 0, sent: 0, skipped: 0, failed: 0 };

    const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

    const dueTokens = await prisma.supplierPortalToken.findMany({
      where: {
        respondedAt: null,
        revokedAt: null,
        reminderSentAt: null,
        expiresAt: { gt: now, lte: windowEnd },
      },
      include: {
        supplier: { select: { name: true } },
        supplierContact: { select: { name: true, email: true } },
        quoteRequest: { select: { requestCode: true, productName: true, status: true } },
      },
    });

    result.due = dueTokens.length;
    if (dueTokens.length === 0) return result;

    const profile = await CompanyProfileService.get();

    for (const token of dueTokens) {
      // Cotacao ja fechada nao merece lembrete (o token pode ter ficado
      // orfao de um fluxo concluido manualmente).
      if (token.quoteRequest.status === 'closed') {
        result.skipped += 1;
        continue;
      }

      // 1. Claim atomico: uma replica so.
      const claim = await prisma.supplierPortalToken.updateMany({
        where: { id: token.id, reminderSentAt: null, revokedAt: null },
        data: { reminderSentAt: now },
      });
      if (claim.count !== 1) {
        result.skipped += 1;
        continue;
      }

      try {
        // 2. Token novo com o MESMO deadline.
        const freshToken = await SupplierPortalService.createToken({
          quoteRequestId: token.quoteRequestId,
          supplierId: token.supplierId,
          supplierContactId: token.supplierContactId,
          createdById: token.createdById,
          dispatchEventId: token.dispatchEventId,
          expiresAt: token.expiresAt,
          reminderSentAt: now,
        });
        const rawToken = (freshToken as { rawToken?: string }).rawToken ?? '';

        const expiresAtLabel = formatDisplayDate(token.expiresAt);
        const rendered = await renderReminderFromTemplate({
          subject: `Reminder: quotation for ${token.quoteRequest.requestCode} closes on ${expiresAtLabel}`,
          contactName: token.supplierContact.name,
          supplierName: token.supplier.name,
          requestCode: token.quoteRequest.requestCode,
          productName: token.quoteRequest.productName ?? '',
          expiresAt: expiresAtLabel,
          portalLink: buildPortalLink(rawToken),
          companyName: profile.companyName,
        });

        // 3. Envia.
        await sendAndLog({
          to: { email: token.supplierContact.email, name: token.supplierContact.name },
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          templateId: QUOTE_REMINDER_TEMPLATE_KEY,
          templateVars: {
            tokenId: token.id,
            freshTokenId: freshToken.id,
            requestCode: token.quoteRequest.requestCode,
            expiresAt: token.expiresAt.toISOString(),
          },
          relatedEntityType: 'supplierPortalToken',
          relatedEntityId: String(token.id),
        });

        // 4. So agora revoga o original — link antigo morre apos o novo
        //    chegar na caixa do fornecedor.
        await prisma.supplierPortalToken.update({
          where: { id: token.id },
          data: { revokedAt: new Date() },
        });

        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        logger.error(
          {
            tokenId: token.id,
            requestCode: token.quoteRequest.requestCode,
            reason: error instanceof Error ? error.message : String(error),
          },
          'Falha ao enviar lembrete pre-deadline; token original segue valido.',
        );
      }
    }

    logger.info(
      { due: result.due, sent: result.sent, skipped: result.skipped, failed: result.failed },
      'Sweep de lembretes pre-deadline concluido.',
    );

    return result;
  }
}
