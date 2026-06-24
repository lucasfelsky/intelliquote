import type { Request, Response } from 'express';
import { QuoteRequestStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  CompanyProfileService,
  readDispatchCc,
  requireCompanyProfileFields,
} from '../services/CompanyProfileService';
import { SupplierPortalService } from '../services/SupplierPortalService';
import {
  dispatchCreateSchema,
} from '../validators/supplierPortal';
import { handleControllerError, HttpError, parseId } from '../utils/http';
import { getComexCcList, sendAndLog } from '../mailer/MailerService';
import {
  DISPATCH_DEFAULT_LOCALE,
  DISPATCH_TEMPLATE_KEY,
  renderDispatchFromTemplate,
} from '../mailer/renderQuoteDispatch';
import { mailerEnv } from '../config/env';

interface DispatchRecipient {
  supplierContactId: number;
  email: string;
  name: string;
  supplierId: number;
  supplierName: string;
}

export class DispatchController {
  static async preview(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID da cotacao invalido.' });
      }

      const body = (req.body as { recipientContactIds?: number[]; locale?: string } | undefined) ?? {};
      const ids = Array.isArray(body.recipientContactIds) ? body.recipientContactIds : [];
      const contacts = await loadContactsForPreview(id, ids);
      const quoteRequest = await prisma.quoteRequest.findFirst({
        where: { id, deletedAt: null },
        include: {
          items: {
            include: { catalogItem: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!quoteRequest) {
        return res.status(404).json({ message: 'Cotacao nao encontrada.' });
      }
      const profile = requireCompanyProfileFields(await CompanyProfileService.get());
            const siblingsBySupplier = await loadSiblingContactsForCc(contacts);

      const sample = contacts[0];
      const subject = `Sourcing request ${quoteRequest.requestCode} - ${quoteRequest.productName}`;
      const portalLink = buildPortalLink('__preview__');
            const locale = (typeof body.locale === 'string' && body.locale.trim().length > 0)
              ? body.locale.trim()
              : DISPATCH_DEFAULT_LOCALE;
            const rendered = sample
              ? await renderDispatchFromTemplate(
                  buildTemplateVars({
                    subject,
                    requestCode: quoteRequest.requestCode,
                    productName: quoteRequest.productName,
                    quantity: quoteRequest.quantity,
                    desiredIncoterm: quoteRequest.desiredIncoterm,
                                destinationPort: quoteRequest.destinationPort,
                                originPort: quoteRequest.originPort,
                                currency: quoteRequest.currency,
                                deadlineAt: quoteRequest.deadlineAt,
                                expiresAt: new Date(),
                                portalLink,
                                companyName: profile.companyName,
                                tradeName: profile.tradeName ?? undefined,
                                taxId: profile.taxId ?? undefined,
                                addressLine1: profile.addressLine1 ?? undefined,
                                addressLine2: profile.addressLine2 ?? undefined,
                                city: profile.city ?? undefined,
                                state: profile.state ?? undefined,
                                postalCode: profile.postalCode ?? undefined,
                                country: profile.country ?? undefined,
                                purchasingEmail: profile.purchasingEmail ?? '',
                                purchasingPhone: profile.purchasingPhone ?? undefined,
                                contact: sample,
                                items: quoteRequest.items.map((it) => ({
                                  marketName: it.catalogItem?.marketName ?? it.productName,
                                  quantity: it.quantity,
                                  unit: it.unit,
                                  desiredIncoterm: it.desiredIncoterm ?? quoteRequest.desiredIncoterm,
                                 destinationPort:
                                   it.destinationPort ?? quoteRequest.destinationPort ?? undefined,
                                originPort: quoteRequest.originPort ?? undefined,
                              })),
                             }),
                             locale,
                           )
                          : null;

      return res.status(200).json({
        recipientCount: contacts.length,
        recipients: contacts.map((c) => {
          const cc = (siblingsBySupplier.get(c.supplierId) ?? []).map((s) => ({
            contactId: s.supplierContactId,
            email: s.email,
            name: s.name,
          }));
          return {
            supplierContactId: c.supplierContactId,
            supplierId: c.supplierId,
            supplierName: c.supplierName,
            contactName: c.name,
            contactEmail: c.email,
            ccCount: cc.length,
            cc,
          };
        }),
        preview: rendered
          ? { subject: rendered.subject, html: rendered.html, text: rendered.text }
          : null,
        templateSource: rendered?.source ?? 'fallback',
        cc: getComexCcList(),
        // E-mails fixos configurados no perfil da empresa que serao
        // adicionados automaticamente como copia em todos os envios
        // (mesclados com os recipients do modal; nunca substituem).
        companyCc: readDispatchCc(await CompanyProfileService.get()),
        template: { key: DISPATCH_TEMPLATE_KEY, locale: DISPATCH_DEFAULT_LOCALE, source: rendered?.source ?? 'fallback' },
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID da cotacao invalido.' });
      }

      const parsed = dispatchCreateSchema.safeParse(req.body);
      if (!parsed.success) {
              const firstIssue = parsed.error.issues[0];
              return res.status(400).json({
                message: firstIssue?.message ?? 'Dados do envio invalidos.',
                field: firstIssue?.path?.join('.') ?? null,
              });
            }

      const quoteRequest = await prisma.quoteRequest.findFirst({
        where: { id, deletedAt: null },
        include: {
          items: {
            include: { catalogItem: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!quoteRequest) {
        return res.status(404).json({ message: 'Cotacao nao encontrada.' });
      }
      if (quoteRequest.status !== QuoteRequestStatus.open) {
        return res
          .status(400)
          .json({ message: 'Somente cotacoes abertas podem ser enviadas a fornecedores.' });
      }
      if (quoteRequest.items.length === 0) {
        return res
          .status(400)
          .json({ message: 'A cotacao precisa ter ao menos um item antes do envio.' });
      }

      // Limite seguro de envio por request para evitar timeout no SMTP.
  // Acima disso, o cliente dispara varios lotes.
  const MAX_RECIPIENTS_PER_REQUEST = 200;
  if (parsed.data.recipientContactIds.length > MAX_RECIPIENTS_PER_REQUEST) {
    return res.status(400).json({
      message: `O envio suporta no maximo ${MAX_RECIPIENTS_PER_REQUEST} destinatarios por request. Divida em lotes.`,
    });
  }
  const recipients = await loadContactsForDispatch(
        id,
        parsed.data.recipientContactIds,
      );
      if (recipients.length === 0) {
        return res
          .status(400)
          .json({ message: 'Nenhum destinatario ativo encontrado para esta cotacao.' });
      }
        const siblingsBySupplier = await loadSiblingContactsForCc(recipients);

      const profileRecord = await CompanyProfileService.get();
      const fallbackEmail = req.user?.email ?? null;
      const profile = profileRecord.purchasingEmail
        ? profileRecord
        : requireCompanyProfileFields({
            ...profileRecord,
            purchasingEmail: fallbackEmail,
          });
            const globalCc = getComexCcList();
            const companyCc = readDispatchCc(profileRecord).map((email) => ({ email, name: '' }));
            const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: 'Sessao expirada. Faca login novamente.' });
      }
      const subjectBase = parsed.data.subject?.trim()
        ? parsed.data.subject.trim()
        : `Sourcing request ${quoteRequest.requestCode} - ${quoteRequest.productName}`;
      const customMessage = parsed.data.message?.trim() ?? '';
      const expiresInDays = parsed.data.expiresInDays;
            const locale = parsed.data.locale?.trim() || DISPATCH_DEFAULT_LOCALE;

            const dispatchEvent = await prisma.dispatchEvent.create({
              data: {
                quoteRequestId: id,
                createdById: userId,
                recipientsCount: recipients.length,
                subject: subjectBase,
                ccList: (() => {
                  const parts: string[] = [];
                  if (globalCc.length) {
                    parts.push(globalCc.map((c) => (c.name ? `${c.name} <${c.email}>` : c.email)).join(', '));
                  }
                  if (companyCc.length) {
                    parts.push(companyCc.map((c) => c.email).join(', '));
                  }
                  return parts.length ? parts.join(' | companyCC: ') : null;
                })(),
                locale,
                status: 'in_progress',
              },
            });

      const results: Array<{
        supplierContactId: number;
        status: 'sent' | 'failed';
        error?: string;
        tokenId?: number;
        dispatchEventId: number;
              ccCount?: number;
            }> = [];

      let sentCount = 0;
      let failedCount = 0;

      for (const contact of recipients) {
        try {
          // revoke previous active tokens for this contact to keep the link unique
          await SupplierPortalService.revokeTokensForContact({
            quoteRequestId: id,
            supplierContactId: contact.supplierContactId,
          });

          const token = await SupplierPortalService.createToken({
            quoteRequestId: id,
            supplierId: contact.supplierId,
            supplierContactId: contact.supplierContactId,
            createdById: userId,
            dispatchEventId: dispatchEvent.id,
            ttlDays: expiresInDays,
          });

          // re-read token with full row (createToken returns an augmented object)
          const persistedToken = await prisma.supplierPortalToken.findUnique({
            where: { id: token.id },
          });
          if (!persistedToken) {
            throw new Error('Falha ao persistir token do portal.');
          }

          const portalLink = buildPortalLink((token as { rawToken?: string }).rawToken ?? '');
          const baseSubject = subjectBase;
          const rendered = await renderDispatchFromTemplate(
            buildTemplateVars({
              subject: baseSubject,
              requestCode: quoteRequest.requestCode,
              productName: quoteRequest.productName,
              quantity: quoteRequest.quantity,
              desiredIncoterm: quoteRequest.desiredIncoterm,
                        destinationPort: quoteRequest.destinationPort,
                        originPort: quoteRequest.originPort,
                        currency: quoteRequest.currency,
                        deadlineAt: quoteRequest.deadlineAt,
                        expiresAt: persistedToken.expiresAt,
                        portalLink,
                        companyName: profile.companyName,
                        tradeName: profile.tradeName ?? undefined,
                        taxId: profile.taxId ?? undefined,
                        addressLine1: profile.addressLine1 ?? undefined,
                        addressLine2: profile.addressLine2 ?? undefined,
                        city: profile.city ?? undefined,
                        state: profile.state ?? undefined,
                        postalCode: profile.postalCode ?? undefined,
                        country: profile.country ?? undefined,
                        purchasingEmail: profile.purchasingEmail ?? '',
                        purchasingPhone: profile.purchasingPhone ?? undefined,
                        contact,
                        items: quoteRequest.items.map((it) => ({
                          marketName: it.catalogItem?.marketName ?? it.productName,
                          quantity: it.quantity,
                          unit: it.unit,
                          desiredIncoterm: it.desiredIncoterm ?? quoteRequest.desiredIncoterm,
                          destinationPort:
                            it.destinationPort ?? quoteRequest.destinationPort ?? undefined,
                          originPort: quoteRequest.originPort ?? undefined,
                        })),
                      }),
                                locale,
                    );

          const html = injectCustomMessage(rendered.html, customMessage);
          const text = customMessage
            ? `${customMessage}\n\n${rendered.text}`
            : rendered.text;
          const subject = rendered.subject;

                    const siblingCc = (siblingsBySupplier.get(contact.supplierId) ?? [])
                      .filter((s) => s.email && s.email.toLowerCase() !== contact.email.toLowerCase())
                      .map((s) => ({ email: s.email, name: s.name }));
                    // companyCc sao os e-mails fixos configurados no perfil
                    // da empresa (CompanyProfile.dispatchCc). Mesclamos com os
                    // CCs globais e com os contatos secundarios do mesmo
                    // fornecedor. Dedupe case-insensitive e nunca repetimos o
                    // proprio destinatario.
                    const recipientCc = [...globalCc, ...siblingCc, ...companyCc].reduce<
                      Array<{ email: string; name: string }>
                    >((acc, current) => {
                      if (!current || !current.email) return acc;
                      const lower = current.email.trim().toLowerCase();
                      if (!lower || lower === contact.email.toLowerCase()) return acc;
                      if (acc.some((c) => c.email.toLowerCase() === lower)) return acc;
                      acc.push({ email: lower, name: current.name ?? '' });
                      return acc;
                    }, []);

                    const sendResult = await sendAndLog({
                      to: { email: contact.email, name: contact.name },
                      cc: recipientCc,
                      subject,
                      html,
                      text,
                      templateId: 'quote-dispatch',
                      templateVars: {
                        quoteRequestId: id,
                        requestCode: quoteRequest.requestCode,
                        supplierContactId: contact.supplierContactId,
                        dispatchEventId: dispatchEvent.id,
                        tokenId: persistedToken.id,
                        customMessage: customMessage || null,
                        ccSiblingCount: siblingCc.length,
                      },
                      relatedEntityType: 'quote_request',
                      relatedEntityId: String(id),
                    });

          if (sendResult.status === 'sent') {
            sentCount += 1;
            results.push({
              supplierContactId: contact.supplierContactId,
              status: 'sent',
              tokenId: persistedToken.id,
              dispatchEventId: dispatchEvent.id,
                        ccCount: recipientCc.length,
                      });
                    } else {
                      failedCount += 1;
                      results.push({
                        supplierContactId: contact.supplierContactId,
                        status: 'failed',
                        error: sendResult.error ?? 'Falha desconhecida no envio.',
                        tokenId: persistedToken.id,
                        dispatchEventId: dispatchEvent.id,
                        ccCount: recipientCc.length,
                      });
                    }
                  } catch (error) {
                    failedCount += 1;
                    results.push({
                      supplierContactId: contact.supplierContactId,
                      status: 'failed',
                      error: error instanceof Error ? error.message : 'Falha desconhecida.',
                      dispatchEventId: dispatchEvent.id,
                    });
                  }
      }

      const finalStatus = failedCount === 0 ? 'completed' : sentCount === 0 ? 'failed' : 'partial';
      await prisma.dispatchEvent.update({
        where: { id: dispatchEvent.id },
        data: { status: finalStatus },
      });

      await AuditLogService.log({
        entityType: 'quote_request',
        entityId: id,
        action: 'dispatch',
        performedById: userId,
        metadata: {
          dispatchEventId: dispatchEvent.id,
          recipientsCount: recipients.length,
          sentCount,
          failedCount,
        },
      });

      return res.status(201).json({
        dispatchEventId: dispatchEvent.id,
        status: finalStatus,
        recipientsCount: recipients.length,
        sentCount,
        failedCount,
        results,
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID da cotacao invalido.' });
      }

      const events = await prisma.dispatchEvent.findMany({
        where: { quoteRequestId: id },
        orderBy: { createdAt: 'desc' },
        include: {
          tokens: {
            include: {
              supplier: { select: { id: true, name: true } },
              supplierContact: { select: { id: true, name: true, email: true } },
              response: {
                select: {
                  id: true,
                  submittedAt: true,
                  totalPrice: true,
                  currency: true,
                  totalPriceCurrency: true,
                },
              },
            },
          },
        },
      });

      return res.status(200).json(
        events.map((event) => ({
          id: event.id,
          recipientsCount: event.recipientsCount,
          subject: event.subject,
          ccList: event.ccList,
          status: event.status,
          createdAt: event.createdAt,
          tokens: event.tokens.map((t) => ({
            id: t.id,
            supplier: t.supplier,
            contact: t.supplierContact,
            expiresAt: t.expiresAt,
            revokedAt: t.revokedAt,
            firstSeenAt: t.firstSeenAt,
            lastSeenAt: t.lastSeenAt,
            accessCount: t.accessCount,
            respondedAt: t.respondedAt,
            response: t.response
              ? {
                  id: t.response.id,
                  submittedAt: t.response.submittedAt,
                  totalPrice: t.response.totalPrice.toString(),
                  currency: t.response.currency,
                  totalPriceCurrency: t.response.totalPriceCurrency,
                }
              : null,
          })),
        })),
      );
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async revokeToken(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID do token invalido.' });
      }

      const token = await prisma.supplierPortalToken.findUnique({ where: { id } });
      if (!token) {
        return res.status(404).json({ message: 'Token nao encontrado.' });
      }
      if (token.revokedAt) {
        return res.status(200).json({ ok: true, alreadyRevoked: true });
      }

      const updated = await prisma.supplierPortalToken.update({
        where: { id },
        data: { revokedAt: new Date() },
      });

      await AuditLogService.log({
        entityType: 'supplier_portal_token',
        entityId: id,
        action: 'revoke',
        performedById: req.user?.id ?? null,
        beforeData: token,
        afterData: updated,
      });

      return res.status(200).json({ ok: true });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async listPortalTokens(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID da cotacao invalido.' });
      }

      const tokens = await prisma.supplierPortalToken.findMany({
        where: { quoteRequestId: id, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, name: true } },
          supplierContact: { select: { id: true, name: true, email: true } },
          response: { select: { id: true, submittedAt: true } },
        },
      });

      return res.status(200).json(
        tokens.map((t) => ({
          id: t.id,
          supplier: { id: t.supplierId, name: t.supplier.name },
          contact: {
            id: t.supplierContactId,
            name: t.supplierContact.name,
            email: t.supplierContact.email,
          },
          token: t.tokenHash,
          expiresAt: t.expiresAt,
          revokedAt: t.revokedAt,
          firstSeenAt: t.firstSeenAt,
          lastSeenAt: t.lastSeenAt,
          accessCount: t.accessCount,
          respondedAt: t.response?.submittedAt ?? null,
          createdAt: t.createdAt,
        })),
      );
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async generatePortalTokens(
    req: Request,
    res: Response,
  ): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID da cotacao invalido.' });
      }

      const body = (req.body as
        | { supplierContactIds?: unknown; expiresInDays?: unknown }
        | undefined) ?? {};
      const supplierContactIds = Array.isArray(body.supplierContactIds)
        ? body.supplierContactIds.filter((x): x is number => typeof x === 'number')
        : [];
      const rawTtl = Number(body.expiresInDays);
      const ttlDays = Number.isFinite(rawTtl) && rawTtl > 0 ? Math.min(rawTtl, 90) : 14;

      if (supplierContactIds.length === 0) {
        return res
          .status(400)
          .json({ message: 'Selecione ao menos um contato.' });
      }

      const userId = req.user?.id;
      if (!userId) {
        return res
          .status(401)
          .json({ message: 'Sessao expirada. Faca login novamente.' });
      }

      const quoteRequest = await prisma.quoteRequest.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, requestCode: true, productName: true },
      });
      if (!quoteRequest) {
        return res.status(404).json({ message: 'Cotacao nao encontrada.' });
      }

      const contacts = await prisma.supplierContact.findMany({
        where: { id: { in: supplierContactIds } },
        include: { supplier: { select: { id: true, name: true } } },
      });
      if (contacts.length === 0) {
        return res
          .status(404)
          .json({ message: 'Contatos nao encontrados.' });
      }

      const generated: Array<{
        supplierContactId: number;
        supplierName: string;
        contactName: string;
        contactEmail: string;
        token: {
          id: number;
          supplier: { id: number; name: string };
          contact: { id: number; name: string; email: string };
          token: string;
          expiresAt: Date;
          revokedAt: Date | null;
          firstSeenAt: Date | null;
          lastSeenAt: Date | null;
          accessCount: number;
          respondedAt: Date | null;
          createdAt: Date;
        };
      }> = [];
      let alreadyActiveCount = 0;

      for (const contact of contacts) {
        const existing = await prisma.supplierPortalToken.findFirst({
          where: {
            quoteRequestId: id,
            supplierContactId: contact.id,
            revokedAt: null,
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) {
          alreadyActiveCount += 1;
          continue;
        }

        const token = await SupplierPortalService.createToken({
          quoteRequestId: id,
          supplierId: contact.supplierId,
          supplierContactId: contact.id,
          createdById: userId,
          ttlDays,
        });

        generated.push({
          supplierContactId: contact.id,
          supplierName: contact.supplier.name,
          contactName: contact.name,
          contactEmail: contact.email,
          token: {
            id: token.id,
            supplier: { id: contact.supplierId, name: contact.supplier.name },
            contact: {
              id: contact.id,
              name: contact.name,
              email: contact.email,
            },
            token: (token as { rawToken?: string }).rawToken ?? '',
            expiresAt: token.expiresAt,
            revokedAt: token.revokedAt,
            firstSeenAt: token.firstSeenAt,
            lastSeenAt: token.lastSeenAt,
            accessCount: token.accessCount,
            respondedAt: null,
            createdAt: token.createdAt,
          },
        });
      }

      await AuditLogService.log({
        entityType: 'supplier_portal_token',
        entityId: id,
        action: 'generate',
        performedById: userId,
        afterData: {
          quoteRequestId: id,
          requested: supplierContactIds.length,
          generated: generated.length,
          alreadyActive: alreadyActiveCount,
          ttlDays,
        },
      });

      return res.status(201).json({
        tokens: generated,
        alreadyActiveCount,
        generatedCount: generated.length,
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}

function injectCustomMessage(html: string, message: string): string {
  if (!message) return html;
  const safe = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />');
  const block = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFCF1;border:1px solid #F0E2A8;border-radius:14px;padding:14px 18px;margin:0 32px 18px 32px;">
      <tr>
        <td style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:#8A6A0E;font-weight:600;padding-bottom:6px;">Additional message from the buyer</td>
      </tr>
      <tr>
        <td style="font-size:14px;line-height:1.55;color:#1F2933;">${safe}</td>
      </tr>
    </table>`;
  return html.replace('<!--CUSTOM_MESSAGE_SLOT-->', block);
}

function buildPortalLink(rawToken: string): string {
  const base = mailerEnv.portalUrl.replace(/\/$/, '');
  // Cache-buster: garante que o navegador sempre busca a versao mais recente
  // do portal.html quando o fornecedor clica no link do e-mail (Firebase
  // Hosting e agressivo no cache desse asset).
  const v = Date.now();
  if (rawToken === '__preview__') {
    return `${base}/portal/preview?token=PREVIEW&v=${v}`;
  }
  return `${base}/portal?token=${encodeURIComponent(rawToken)}&v=${v}`;
}

function buildTemplateVars(input: {
  subject: string;
  requestCode: string;
  productName: string | null;
  quantity: number | null;
  desiredIncoterm: string;
  destinationPort?: string | null;
  originPort?: string | null;
  currency: string;
  deadlineAt: Date | null;
  expiresAt: Date;
  portalLink: string;
  companyName: string;
  tradeName?: string;
  taxId?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  purchasingEmail: string;
  purchasingPhone?: string;
  contact: DispatchRecipient;
  items: Array<{
    marketName: string;
    quantity: number;
    unit: string;
    desiredIncoterm?: string;
    destinationPort?: string;
  }>;
}) {
  const summaryName =
    input.items[0]?.marketName ?? input.productName ?? 'Sourcing request';
  const summaryQty = input.items[0]?.quantity ?? input.quantity ?? 1;
  const summaryUnit = input.items[0]?.unit ?? 'UN';
  return {
    subject: input.subject,
    supplierContactName: input.contact.name,
    requestCode: input.requestCode,
    productName: summaryName,
    quantity: summaryQty,
    unit: summaryUnit,
    desiredIncoterm: input.desiredIncoterm,
    destinationPort: input.destinationPort ?? undefined,
    originPort: input.originPort ?? undefined,
    currency: input.currency,
    deadlineAt: formatDate(input.deadlineAt) || 'as soon as possible',
    expiresAt: formatDate(input.expiresAt) || '-',
    portalLink: input.portalLink,
    companyName: input.companyName,
    tradeName: input.tradeName,
    taxId: input.taxId,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    purchasingEmail: input.purchasingEmail,
    purchasingPhone: input.purchasingPhone,
    items: input.items,
  };
}

function formatDate(value: Date | null | undefined): string {
  if (!value) return '';
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

async function loadContactsForPreview(
  quoteRequestId: number,
  recipientContactIds: number[],
): Promise<DispatchRecipient[]> {
  if (recipientContactIds.length === 0) return [];
  const contacts = await prisma.supplierContact.findMany({
    where: {
      id: { in: recipientContactIds },
      supplier: { status: 'active' },
    },
    include: { supplier: true },
  });
  return contacts.map((c) => ({
    supplierContactId: c.id,
    email: c.email,
    name: c.name,
    supplierId: c.supplierId,
    supplierName: c.supplier.name,
  }));
}

async function loadContactsForDispatch(
  quoteRequestId: number,
  recipientContactIds: number[],
): Promise<DispatchRecipient[]> {
  if (recipientContactIds.length === 0) {
    throw new HttpError(400, 'Selecione ao menos um destinatario valido.');
  }
  const contacts = await prisma.supplierContact.findMany({
    where: {
      id: { in: recipientContactIds },
      supplier: { status: 'active' },
    },
    include: { supplier: true },
  });
  if (contacts.length === 0) {
    return [];
  }
  return contacts.map((c) => ({
    supplierContactId: c.id,
    email: c.email,
    name: c.name,
    supplierId: c.supplierId,
    supplierName: c.supplier.name,
  }));
}

interface DispatchSiblingContact {
  supplierContactId: number;
  email: string;
  name: string;
}

/**
 * Retorna, para cada fornecedor envolvido em `recipients`, os demais contatos
 * ativos (nao-primarios) que devem receber o mesmo envio como copia visivel.
 * O id do contato principal e excluido para evitar eco.
 */
async function loadSiblingContactsForCc(
  recipients: DispatchRecipient[],
): Promise<Map<number, DispatchSiblingContact[]>> {
  const result = new Map<number, DispatchSiblingContact[]>();
  if (recipients.length === 0) return result;

  const supplierIds = Array.from(new Set(recipients.map((r) => r.supplierId)));
  const primaryIds = new Set(recipients.map((r) => r.supplierContactId));

  const siblings = await prisma.supplierContact.findMany({
    where: {
      supplierId: { in: supplierIds },
      supplier: { status: 'active' },
      id: { notIn: Array.from(primaryIds) },
    },
    select: { id: true, email: true, name: true, supplierId: true },
  });

  for (const sib of siblings) {
    const list = result.get(sib.supplierId) ?? [];
    list.push({
      supplierContactId: sib.id,
      email: sib.email,
      name: sib.name,
    });
    result.set(sib.supplierId, list);
  }
  return result;
}
