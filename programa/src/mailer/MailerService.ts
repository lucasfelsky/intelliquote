import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { mailerEnv } from '../config/env';
import { logger } from '../lib/logger';
import { ConsoleMailer } from './ConsoleMailer';
import { SmtpMailer } from './SmtpMailer';
import type { Mailer, MailAttachment, MailMessage, MailSendResult } from './Mailer';
import { loadComercialEmails } from '../services/CompanyProfileService';

let singleton: Mailer | null = null;

export function getMailer(): Mailer {
  if (singleton) return singleton;
  switch (mailerEnv.provider) {
    case 'console':
      singleton = new ConsoleMailer();
      break;
    case 'smtp':
    case 'sendgrid':
    case 'mailgun':
    case 'resend':
    default:
      singleton = new SmtpMailer();
      break;
  }
  return singleton;
}

export interface SendAndLogInput {
  to: { email: string; name?: string };
  cc?: Array<{ email: string; name?: string }>;
  subject: string;
  html: string;
  text?: string;
  templateId: string;
  templateVars: Record<string, unknown>;
  relatedEntityType?: string;
  relatedEntityId?: string;
  // Anexo so'-envio (ex.: PDF da Ordem de Compra). NAO persistido em disco;
  // NAO entra no mailLog/AuditLog (so' fileName/fileSize, ver metadata do
  // caller) -- efemero no processo do Cloud Run.
  // `cid` marca imagem inline (logo/assinatura do e-mail da PO).
  attachments?: MailAttachment[];
  // DEFESA CENTRAL: por padrao, sendAndLog REMOVE de to/cc qualquer endereco que
  // pertenca a usuario com papel `comercial` (o comercial nunca pode receber
  // e-mail com dados de fornecedor, preco ou magic link). Passe `true` SOMENTE em
  // e-mails que DEVEM ir ao comercial (ex.: aviso ao solicitante, previsto no PR2).
  // Nenhum chamador do PR1 usa o opt-out.
  allowComercialRecipients?: boolean;
}

export const SKIPPED_COMERCIAL_RECIPIENT = 'skipped_comercial_recipient';
export const SKIPPED_COMERCIAL_LOOKUP_FAILED = 'skipped_comercial_lookup_failed';

type MailRecipient = { email: string; name?: string };

/**
 * Aplica a defesa central. Devolve os destinatarios finais, ou `null` quando o envio
 * deve ser suprimido. Se o `to` for comercial, suprime o envio INTEIRO (o cc nao e
 * promovido: o conteudo foi escrito para o destinatario original).
 * Erro ao consultar os papeis propaga (o chamador faz fail-closed: nao envia).
 */
async function applyComercialGuard(
  to: MailRecipient,
  cc: MailRecipient[] | undefined,
): Promise<{ to: MailRecipient; cc: MailRecipient[] | undefined; removed: string[] } | null> {
  const comercial = await loadComercialEmails();
  if (comercial.size === 0) return { to, cc, removed: [] };

  const isComercial = (r: MailRecipient) => comercial.has((r.email ?? '').trim().toLowerCase());
  const removed: string[] = [];
  const keptCc = (cc ?? []).filter((r) => {
    if (!isComercial(r)) return true;
    removed.push(r.email);
    return false;
  });

  if (!isComercial(to)) return { to, cc: keptCc, removed };

  return null;
}

export async function sendAndLog(input: SendAndLogInput): Promise<MailSendResult> {
  const mailer = getMailer();

  let finalTo = input.to;
  let finalCc = input.cc;
  if (!input.allowComercialRecipients) {
    let guarded: Awaited<ReturnType<typeof applyComercialGuard>>;
    try {
      guarded = await applyComercialGuard(input.to, input.cc);
    } catch (error) {
      // Fail-closed: sem conseguir consultar os papeis, nao envia.
      logger.error(
        {
          templateId: input.templateId,
          reason: error instanceof Error ? error.message : String(error),
        },
        'Falha ao consultar usuarios comercial; e-mail NAO enviado (fail-closed).',
      );
      return { providerMessageId: '', status: 'failed', error: SKIPPED_COMERCIAL_LOOKUP_FAILED };
    }

    if (guarded === null) {
      logger.warn(
        { templateId: input.templateId, relatedEntityType: input.relatedEntityType },
        'Todos os destinatarios sao usuarios comercial; e-mail NAO enviado.',
      );
      try {
        await prisma.mailLog.create({
          data: {
            provider: mailerEnv.provider,
            providerMessageId: null,
            fromAddress: mailerEnv.smtp.from || mailerEnv.smtp.user || 'intelliquote@localhost',
            toEmail: input.to.email,
            toName: input.to.name ?? null,
            ccList: null,
            subject: input.subject,
            templateId: input.templateId,
            templateVars: input.templateVars as Prisma.InputJsonValue,
            status: 'suppressed',
            errorMessage: SKIPPED_COMERCIAL_RECIPIENT,
            relatedEntityType: input.relatedEntityType ?? null,
            relatedEntityId: input.relatedEntityId ?? null,
          },
        });
      } catch (error) {
        logger.error(
          { templateId: input.templateId, reason: error instanceof Error ? error.message : String(error) },
          'Falha ao registrar o MailLog do e-mail suprimido (comercial).',
        );
      }
      return { providerMessageId: '', status: 'failed', error: SKIPPED_COMERCIAL_RECIPIENT };
    }

    if (guarded.removed.length > 0) {
      logger.warn(
        { templateId: input.templateId, removedCount: guarded.removed.length },
        'Destinatarios comercial removidos do e-mail (defesa central).',
      );
    }
    finalTo = guarded.to;
    finalCc = guarded.cc;
  }

  const ccList = finalCc && finalCc.length > 0 ? finalCc : undefined;
  const msg: MailMessage = {
    to: [finalTo],
    cc: ccList,
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments,
  };

  const initialLog = await prisma.mailLog.create({
    data: {
      provider: mailerEnv.provider,
      providerMessageId: null,
      fromAddress: mailerEnv.smtp.from || mailerEnv.smtp.user || 'intelliquote@localhost',
      toEmail: finalTo.email,
      toName: finalTo.name ?? null,
      ccList: ccList
        ? ccList
            .map((c) => (c.name ? `${c.name} <${c.email}>` : c.email))
            .join(', ')
        : null,
      subject: input.subject,
      templateId: input.templateId,
      templateVars: input.templateVars as Prisma.InputJsonValue,
      status: 'queued',
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
    },
  });

  const result = await mailer.send(msg);

  // O envio ja aconteceu: uma falha so' ao atualizar o mailLog nao pode virar
  // excecao (o chamador trataria como falha de envio e, p.ex., repassaria a
  // copia COMEX ao proximo destinatario, duplicando-a). Loga e segue.
  try {
    await prisma.mailLog.update({
      where: { id: initialLog.id },
      data: {
        status:
          result.status === 'failed'
            ? 'failed'
            : result.status === 'queued'
              ? 'queued'
              : 'sent',
        providerMessageId: result.providerMessageId || null,
        sentAt: result.status === 'sent' ? new Date() : null,
        errorMessage: result.error ?? null,
      },
    });
  } catch (error) {
    logger.error(
      {
        mailLogId: initialLog.id,
        templateId: input.templateId,
        sendStatus: result.status,
        reason: error instanceof Error ? error.message : String(error),
      },
      'Falha ao atualizar mailLog apos o envio; resultado do provedor preservado.',
    );
  }

  return result;
}

export function getComexCcList(): Array<{ email: string; name?: string }> {
  return mailerEnv.comexCcList;
}
