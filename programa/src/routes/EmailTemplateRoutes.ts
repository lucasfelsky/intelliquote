import { Router } from 'express';
import { z } from 'zod';
import { EmailTemplateService } from '../services/EmailTemplateService';
import { allowRoles, requireAuth } from '../middlewares/auth';
import { AuditLogService } from '../services/AuditLogService';
import { handleControllerError, HttpError } from '../utils/http';
import { formatIncoterms } from '../utils/incoterm';
import { renderSections, renderDispatchTemplate, type QuoteDispatchVars } from '../mailer/renderQuoteDispatch';
import {
  renderReplySections,
  renderReplyPlainText,
  loadFileTemplate as loadReplyFileTemplate,
  REPLY_TEMPLATE_KEY,
  type QuoteReplyVars,
} from '../mailer/renderQuoteReply';
import { prisma } from '../lib/prisma';
import { CompanyProfileService } from '../services/CompanyProfileService';

const emailTemplateRoutes = Router();

const templateKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9_]+$/i, 'Use apenas letras, numeros e underline.');

const localeSchema = z.string().trim().min(2).max(10);

const templateUpsertSchema = z.object({
  subject: z.string().trim().min(1, 'Informe o assunto.').max(500),
  htmlBody: z.string().min(1, 'Informe o HTML.'),
  textBody: z.string().min(1, 'Informe a versao texto.'),
  isActive: z.boolean().optional().default(true),
});

function renderReplySampleVars(): QuoteReplyVars {
  return {
    subject: 'PHOTOINIATOR - SQ QUIMICA - Acme Chemicals',
    quoteRequestId: 42,
    requestCode: 'QR-20260618-DEMO01',
    productName: 'PHOTOINIATOR',
    supplierName: 'Acme Chemicals',
    items: [
      { name: 'PI-TPO', incoterm: 'CIF', quantity: 500, unit: 'KG' },
      { name: 'PI-DTX', incoterm: 'CIF', quantity: 1200, unit: 'KG' },
    ],
  };
}

function renderSampleVars(): QuoteDispatchVars {
  return {
    subject: 'Sourcing request QR-20260618-DEMO01 - PHOTOINIATOR',
    supplierContactName: 'Joao Fornecedor',
    requestCode: 'QR-20260618-DEMO01',
    productName: 'PHOTOINIATOR',
    quantity: 500,
    unit: 'KG',
    desiredIncoterm: 'CIF',
    currency: 'USD',
    deadlineAt: '25 Jun 2026',
    expiresAt: '02 Jul 2026',
    portalLink: 'https://intelliquote.portal-comex.com/portal/preview?token=PREVIEW&v=1',
    companyName: 'SQ Quimica',
    tradeName: 'SQ Quimica',
    taxId: '14.111.367/0001-97',
    addressLine1: 'Rodovia Jorge Lacerda, 921',
    addressLine2: 'Galpao 2',
    city: 'Itajai',
    state: 'Santa Catarina',
    postalCode: '88304-520',
    country: 'Brasil',
    purchasingEmail: 'comex@sqquimica.com',
    purchasingPhone: '+55 47 99999-0000',
    items: [
      { marketName: 'PI-TPO', quantity: 500, unit: 'KG' },
      { marketName: 'PI-DTX', quantity: 1200, unit: 'KG' },
    ],
  };
}

emailTemplateRoutes.get(
  '/',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  async (req, res) => {
    try {
      const key = typeof req.query.key === 'string' ? req.query.key : undefined;
      const templates = await EmailTemplateService.list(key);
      return res.status(200).json(templates);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  },
);

emailTemplateRoutes.get(
  '/preview',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  async (req, res) => {
    try {
      const key = templateKeySchema.parse(req.query.key);
      const locale = localeSchema.parse(req.query.locale ?? 'en');

      if (key === REPLY_TEMPLATE_KEY) {
        const [replyTemplate, latestQuoteRequestForReply] = await Promise.all([
          EmailTemplateService.get(key, locale),
          prisma.quoteRequest.findFirst({
            orderBy: { createdAt: 'desc' },
            include: { items: { include: { catalogItem: true }, orderBy: { createdAt: 'asc' } } },
          }),
        ]);

        const replySample = renderReplySampleVars();
        if (latestQuoteRequestForReply) {
          replySample.quoteRequestId = latestQuoteRequestForReply.id;
          replySample.requestCode = latestQuoteRequestForReply.requestCode;
          replySample.productName = latestQuoteRequestForReply.productName ?? replySample.productName;
          if (latestQuoteRequestForReply.items.length > 0) {
            replySample.items = latestQuoteRequestForReply.items.map((it) => ({
              name: it.catalogItem?.commercialName ?? it.productName,
              incoterm: it.desiredIncoterm ?? formatIncoterms(latestQuoteRequestForReply.desiredIncoterm),
              quantity: it.quantity,
              unit: it.unit,
            }));
          }
        }

        if (!replyTemplate) {
          // Sem customizacao salva ainda: pre-popula o editor com o
          // template padrao (arquivo .html) em vez de deixar em branco,
          // pra o admin ter um ponto de partida real pra editar.
          return res.status(200).json({
            subject: replySample.subject,
            html: renderReplySections(loadReplyFileTemplate(), replySample),
            text: renderReplyPlainText(replySample),
            isActive: false,
            source: 'fallback',
            locale,
          });
        }

        const replySubject = renderReplySections(replyTemplate.subject, replySample);
        const replyVars = { ...replySample, subject: replySubject };
        return res.status(200).json({
          subject: replySubject,
          html: renderReplySections(replyTemplate.htmlBody, replyVars),
          text: renderReplySections(replyTemplate.textBody, replyVars),
          isActive: replyTemplate.isActive,
          source: 'database',
          locale,
        });
      }

      const [template, profileRecord, latestQuoteRequest] = await Promise.all([
        EmailTemplateService.get(key, locale),
        CompanyProfileService.get(),
        prisma.quoteRequest.findFirst({
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              include: { catalogItem: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        }),
      ]);

      const sample: QuoteDispatchVars = renderSampleVars();
      sample.companyName = profileRecord.companyName;
      sample.tradeName = profileRecord.tradeName ?? undefined;
      sample.taxId = profileRecord.taxId ?? undefined;
      sample.addressLine1 = profileRecord.addressLine1 ?? undefined;
      sample.addressLine2 = profileRecord.addressLine2 ?? undefined;
      sample.city = profileRecord.city ?? undefined;
      sample.state = profileRecord.state ?? undefined;
      sample.postalCode = profileRecord.postalCode ?? undefined;
      sample.country = profileRecord.country ?? undefined;
      sample.purchasingEmail =
        profileRecord.purchasingEmail ?? sample.purchasingEmail;
      sample.purchasingPhone = profileRecord.purchasingPhone ?? undefined;

      if (latestQuoteRequest) {
        sample.requestCode = latestQuoteRequest.requestCode;
        sample.productName = latestQuoteRequest.productName ?? sample.productName;
        sample.quantity = latestQuoteRequest.quantity ?? sample.quantity;
        sample.unit = 'UN';
        sample.desiredIncoterm = formatIncoterms(latestQuoteRequest.desiredIncoterm);
        sample.currency = latestQuoteRequest.currency;
        if (latestQuoteRequest.items.length > 0) {
          sample.items = latestQuoteRequest.items.map((it) => ({
            marketName: it.catalogItem?.marketName ?? it.productName,
            quantity: it.quantity,
            unit: it.unit,
          }));
        }
      }

      if (!template) {
        return res.status(200).json({
          subject: sample.subject,
          html: '',
          text: '',
          isActive: false,
          source: 'fallback',
          locale,
        });
      }

      const subject = renderSections(template.subject, sample);
      const html = renderDispatchTemplate(template.htmlBody, { ...sample, subject });
      const text = renderDispatchTemplate(template.textBody, { ...sample, subject });

      return res.status(200).json({
        subject,
        html,
        text,
        isActive: template.isActive,
        source: 'database',
        locale,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues[0]?.message ?? 'Parametros invalidos.' });
      }
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  },
);

emailTemplateRoutes.put(
  '/:key/:locale',
  requireAuth,
  allowRoles(['admin']),
  async (req, res) => {
    try {
      const key = templateKeySchema.parse(req.params.key);
      const locale = localeSchema.parse(req.params.locale);
      const parsed = templateUpsertSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: parsed.error.issues[0]?.message ?? 'Dados do template invalidos.',
        });
      }
      const userId = req.user?.id ?? null;
      const saved = await EmailTemplateService.upsert(key, locale, parsed.data, userId);
      await AuditLogService.log({
        entityType: 'email_template',
        entityId: saved.id,
        action: 'upsert',
        performedById: userId,
        metadata: { key, locale },
      });
      return res.status(200).json(saved);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues[0]?.message ?? 'Parametros invalidos.' });
      }
      if (error instanceof HttpError) {
        return res.status(error.status).json({ message: error.message });
      }
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  },
);

emailTemplateRoutes.delete(
  '/:key/:locale',
  requireAuth,
  allowRoles(['admin']),
  async (req, res) => {
    try {
      const key = templateKeySchema.parse(req.params.key);
      const locale = localeSchema.parse(req.params.locale);
      await EmailTemplateService.resetToDefault(key, locale, req.user?.id ?? null);
      await AuditLogService.log({
        entityType: 'email_template',
        entityId: 0,
        action: 'reset',
        performedById: req.user?.id ?? null,
        metadata: { key, locale },
      });
      return res.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues[0]?.message ?? 'Parametros invalidos.' });
      }
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  },
);

export { emailTemplateRoutes };