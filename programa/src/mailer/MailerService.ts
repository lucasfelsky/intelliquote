import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { mailerEnv } from '../config/env';
import { ConsoleMailer } from './ConsoleMailer';
import { SmtpMailer } from './SmtpMailer';
import type { Mailer, MailMessage, MailSendResult } from './Mailer';

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
}

export async function sendAndLog(input: SendAndLogInput): Promise<MailSendResult> {
  const mailer = getMailer();
  const ccList = input.cc && input.cc.length > 0 ? input.cc : undefined;
  const msg: MailMessage = {
    to: [input.to],
    cc: ccList,
    subject: input.subject,
    html: input.html,
    text: input.text,
  };

  const initialLog = await prisma.mailLog.create({
    data: {
      provider: mailerEnv.provider,
      providerMessageId: null,
      fromAddress: mailerEnv.smtp.from || mailerEnv.smtp.user || 'intelliquote@localhost',
      toEmail: input.to.email,
      toName: input.to.name ?? null,
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

  return result;
}

export function getComexCcList(): Array<{ email: string; name?: string }> {
  return mailerEnv.comexCcList;
}
