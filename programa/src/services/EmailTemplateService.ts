import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export interface EmailTemplateRecord {
  id: number;
  key: string;
  locale: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  isActive: boolean;
  updatedAt: Date;
  updatedById: number | null;
}

export interface EmailTemplateInput {
  subject: string;
  htmlBody: string;
  textBody: string;
  isActive: boolean;
}

export const DEFAULT_TEMPLATE_LOCALE = 'en';

function serialize(record: Prisma.EmailTemplateGetPayload<true>): EmailTemplateRecord {
  return {
    id: record.id,
    key: record.key,
    locale: record.locale,
    subject: record.subject,
    htmlBody: record.htmlBody,
    textBody: record.textBody,
    isActive: record.isActive,
    updatedAt: record.updatedAt,
    updatedById: record.updatedById,
  };
}

export class EmailTemplateService {
  static async list(key?: string): Promise<EmailTemplateRecord[]> {
    const records = await prisma.emailTemplate.findMany({
      where: key ? { key } : undefined,
      orderBy: [{ key: 'asc' }, { locale: 'asc' }],
    });
    return records.map(serialize);
  }

  static async get(key: string, locale = DEFAULT_TEMPLATE_LOCALE): Promise<EmailTemplateRecord | null> {
    const record = await prisma.emailTemplate.findUnique({
      where: { key_locale: { key, locale } },
    });
    return record ? serialize(record) : null;
  }

  static async upsert(
    key: string,
    locale: string,
    input: EmailTemplateInput,
    updatedById: number | null,
  ): Promise<EmailTemplateRecord> {
    const record = await prisma.emailTemplate.upsert({
      where: { key_locale: { key, locale } },
      create: {
        key,
        locale,
        subject: input.subject,
        htmlBody: input.htmlBody,
        textBody: input.textBody,
        isActive: input.isActive,
        updatedById,
      },
      update: {
        subject: input.subject,
        htmlBody: input.htmlBody,
        textBody: input.textBody,
        isActive: input.isActive,
        updatedById,
      },
    });
    return serialize(record);
  }

  static async resetToDefault(key: string, locale: string, updatedById: number | null): Promise<void> {
    await prisma.emailTemplate.delete({ where: { key_locale: { key, locale } } });
  }
}
