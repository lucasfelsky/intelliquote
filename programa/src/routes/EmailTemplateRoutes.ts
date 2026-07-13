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
import {
  renderReminderSections,
  renderReminderPlainText,
  loadFileTemplate as loadReminderFileTemplate,
  QUOTE_REMINDER_TEMPLATE_KEY,
  type QuoteReminderVars,
} from '../mailer/renderQuoteReminder';
import {
  renderRegretSections,
  renderRegretPlainText,
  loadFileTemplate as loadRegretFileTemplate,
  QUOTE_REGRET_TEMPLATE_KEY,
  type QuoteRegretVars,
} from '../mailer/renderQuoteRegret';
import {
  renderSections as renderBuyerNoticeSections,
  renderPlainText as renderBuyerNoticePlainText,
  loadFileTemplate as loadBuyerNoticeFileTemplate,
  SUPPLIER_RESPONSE_RECEIVED_TEMPLATE_KEY,
  SUPPLIER_RESPONSE_RECEIVED_DEFAULT_LOCALE,
  type SupplierResponseReceivedVars,
} from '../mailer/renderSupplierResponseReceived';
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
    currency: 'USD',
    items: [
      { name: 'PI-TPO', incoterm: 'CIF', quantity: 500, unit: 'KG', unitPrice: 4.99 },
      { name: 'PI-DTX', incoterm: 'CIF', quantity: 1200, unit: 'KG', unitPrice: 4.99 },
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
              // Preview generico do template (nao de uma resposta real) --
              // sem QuoteResponse.offeredPrice pra usar, mantem o preco de
              // exemplo pra o admin ver a coluna preenchida.
              unitPrice: 4.99,
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

      if (key === QUOTE_REGRET_TEMPLATE_KEY) {
        // F8: preview do aviso de nao-selecionado (EN, fornecedor).
        const [regretTemplate, latestQuoteRequestForRegret] = await Promise.all([
          EmailTemplateService.get(key, locale),
          prisma.quoteRequest.findFirst({
            orderBy: { createdAt: 'desc' },
            select: { requestCode: true, productName: true },
          }),
        ]);

        const regretSample: QuoteRegretVars = {
          subject: 'Update on your quotation for QR-2026-001',
          contactName: 'Li Wei',
          supplierName: 'Shanghai Chem Co.',
          requestCode: latestQuoteRequestForRegret?.requestCode ?? 'QR-2026-001',
          productName: latestQuoteRequestForRegret?.productName ?? 'PI-TPO',
          companyName: 'SQ Quimica',
        };

        if (!regretTemplate) {
          return res.status(200).json({
            subject: regretSample.subject,
            html: renderRegretSections(loadRegretFileTemplate(), regretSample),
            text: renderRegretPlainText(regretSample),
            isActive: false,
            source: 'fallback',
            locale,
          });
        }

        const regretSubject = renderRegretSections(regretTemplate.subject, regretSample);
        const regretVars = { ...regretSample, subject: regretSubject };
        return res.status(200).json({
          subject: regretSubject,
          html: renderRegretSections(regretTemplate.htmlBody, regretVars),
          text: renderRegretSections(regretTemplate.textBody, regretVars),
          isActive: regretTemplate.isActive,
          source: 'database',
          locale,
        });
      }

      if (key === QUOTE_REMINDER_TEMPLATE_KEY) {
        // F5: preview do lembrete pre-deadline (EN, fornecedor).
        const [reminderTemplate, latestQuoteRequestForReminder] = await Promise.all([
          EmailTemplateService.get(key, locale),
          prisma.quoteRequest.findFirst({
            orderBy: { createdAt: 'desc' },
            select: { requestCode: true, productName: true },
          }),
        ]);

        const reminderSample: QuoteReminderVars = {
          subject: 'Reminder: quotation for QR-2026-001 closes on 25 Jun 2026',
          contactName: 'Li Wei',
          supplierName: 'Shanghai Chem Co.',
          requestCode: latestQuoteRequestForReminder?.requestCode ?? 'QR-2026-001',
          productName: latestQuoteRequestForReminder?.productName ?? 'PI-TPO',
          expiresAt: '25 Jun 2026',
          portalLink: 'https://intelliquote.portal-comex.com/portal/preview?token=PREVIEW&v=1',
          companyName: 'SQ Quimica',
        };

        if (!reminderTemplate) {
          return res.status(200).json({
            subject: reminderSample.subject,
            html: renderReminderSections(loadReminderFileTemplate(), reminderSample),
            text: renderReminderPlainText(reminderSample),
            isActive: false,
            source: 'fallback',
            locale,
          });
        }

        const reminderSubject = renderReminderSections(reminderTemplate.subject, reminderSample);
        const reminderVars = { ...reminderSample, subject: reminderSubject };
        return res.status(200).json({
          subject: reminderSubject,
          html: renderReminderSections(reminderTemplate.htmlBody, reminderVars),
          text: renderReminderSections(reminderTemplate.textBody, reminderVars),
          isActive: reminderTemplate.isActive,
          source: 'database',
          locale,
        });
      }

      if (key === SUPPLIER_RESPONSE_RECEIVED_TEMPLATE_KEY) {
        // F1 (backlog 2026-07-12): preview do aviso interno ao comprador.
        // Locale default deste template e' 'pt' (e-mail interno).
        const effectiveLocale =
          typeof req.query.locale === 'string'
            ? locale
            : SUPPLIER_RESPONSE_RECEIVED_DEFAULT_LOCALE;
        const [noticeTemplate, latestQuoteRequest] = await Promise.all([
          EmailTemplateService.get(key, effectiveLocale),
          prisma.quoteRequest.findFirst({
            orderBy: { createdAt: 'desc' },
            select: { requestCode: true, productName: true },
          }),
        ]);

        const noticeSample: SupplierResponseReceivedVars = {
          subject: '[IntelliQuote] Nova resposta de Shanghai Chem Co. na cotação QR-2026-001',
          buyerName: 'Comprador',
          supplierName: 'Shanghai Chem Co.',
          contactName: 'Li Wei',
          requestCode: latestQuoteRequest?.requestCode ?? 'QR-2026-001',
          productName: latestQuoteRequest?.productName ?? 'PI-TPO',
          totalPrice: '12,500.00',
          currency: 'USD',
          itemsCount: 3,
          revisionLabel: '',
          responsesUrl: 'https://intelliquote.web.app/respostas',
        };

        if (!noticeTemplate) {
          return res.status(200).json({
            subject: noticeSample.subject,
            html: renderBuyerNoticeSections(loadBuyerNoticeFileTemplate(), noticeSample),
            text: renderBuyerNoticePlainText(noticeSample),
            isActive: false,
            source: 'fallback',
            locale: effectiveLocale,
          });
        }

        const noticeSubject = renderBuyerNoticeSections(noticeTemplate.subject, noticeSample);
        const noticeVars = { ...noticeSample, subject: noticeSubject };
        return res.status(200).json({
          subject: noticeSubject,
          html: renderBuyerNoticeSections(noticeTemplate.htmlBody, noticeVars),
          text: renderBuyerNoticeSections(noticeTemplate.textBody, noticeVars),
          isActive: noticeTemplate.isActive,
          source: 'database',
          locale: effectiveLocale,
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