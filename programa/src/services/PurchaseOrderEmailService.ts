import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { AuditLogService } from './AuditLogService';
import { sendAndLog } from '../mailer/MailerService';
import { renderPoFromTemplate } from '../mailer/renderQuotePo';
import {
  EMAIL_LOGO_CID,
  EMAIL_SIGNATURE_CID,
  emailLogoDisplaySize,
  getEmailLogoAttachment,
  isEmailLogoPlaceholder,
} from '../mailer/emailLogo';
import type { MailAttachment } from '../mailer/Mailer';
import { quotePurchaseOrderSchema } from '../validators/domain';
import { HttpError } from '../utils/http';
import { mergeCc, resolveContactRecipients } from '../utils/contactRecipients';
import {
  CompanyProfileService,
  loadComercialEmails,
  readDispatchCc,
} from './CompanyProfileService';

// Envio do e-mail de "Ordem de Compra" (SMTP real, com o PDF do usuario anexado).
// Trecho comum da PO ao fornecedor vencedor (QuoteResponseController.sendPurchaseOrder)
// e da PO ao parceiro de Credit Support (CreditSupportController.sendPurchaseOrder, PR4b).
// Extraido SEM mudar o comportamento do caminho do fornecedor: mesmas queries, mesma
// ordem, mesmas mensagens e status.

// Limite do PDF anexado (base64 em JSON) -- ver override de body-parser em
// app.ts (10mb) e a TRAP do limite global de 1mb.
export const PO_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export function decodePoAttachment(content: string): Buffer {
  const normalized = content.includes(',') ? content.split(',').pop() ?? '' : content;
  try {
    return Buffer.from(normalized, 'base64');
  } catch (_error) {
    throw new HttpError(400, 'Conteudo base64 do PDF invalido.');
  }
}

export type QuotePurchaseOrderPayload = z.infer<typeof quotePurchaseOrderSchema>;

export interface PurchaseOrderEmailInput {
  payload: QuotePurchaseOrderPayload;
  quoteRequest: {
    id: number;
    requestCode: string;
    destinationPort?: string | null;
    items?: Array<{ destinationPort?: string | null }>;
  };
  // Destinatario unico (To). `name` tambem alimenta "supplierContactName" do template.
  recipient: { name: string; email: string };
  // Lista final (contatos + COMEX), ja filtrada e sem o destinatario.
  cc: Array<{ email: string; name: string }>;
  user?: { id?: number; name?: string; email?: string } | null;
  // PO via parceiro: nomes citados no paragrafo condicional do template.
  extraVars?: { supplierName?: string; creditPartnerName?: string };
  // Parte especifica do `templateVars` do MailLog (o servico acrescenta forwarderInfo,
  // forwarderId, hasCustomMessage e hasSignatureImage).
  templateVars: Record<string, unknown>;
  related: { type: string; id: string };
  audit: { entityType: string; entityId: number; metadata?: Record<string, unknown> };
}

export interface PurchaseOrderEmailResult {
  status: 'sent' | 'queued';
  to: string;
  cc: string[];
}

// Destinatarios da PO: principal/preferido no To, demais contatos em Cc, Equipe COMEX
// (dispatchCc) em Cc. Comerciais saem ANTES de escolher o To.
export interface EmailRecipients {
  to: { id: number; name: string; email: string };
  contactCc: Array<{ id: number; name: string; email: string }>;
  comexCc: Array<{ email: string; name: string }>;
  cc: Array<{ email: string; name: string }>;
}

async function buildEmailRecipients(
  contacts: Array<{ id: number; name: string; email: string }>,
  preferredContactId: number | null,
): Promise<EmailRecipients | null> {
  const blocked = await loadComercialEmails();
  const resolved = resolveContactRecipients(contacts, {
    preferredContactId,
    blockedEmails: blocked,
  });
  if (!resolved) return null;

  const profile = await CompanyProfileService.get();
  const comexRaw = readDispatchCc(profile)
    .filter((email) => !blocked.has((email ?? '').trim().toLowerCase()))
    .map((email) => ({ email, name: '' }));

  const cc = mergeCc(resolved.to.email, resolved.contactCc, comexRaw);
  const contactEmails = new Set(resolved.contactCc.map((c) => c.email.toLowerCase()));
  const comexCc = cc.filter((item) => !contactEmails.has(item.email));
  return { to: resolved.to, contactCc: resolved.contactCc, comexCc, cc };
}

export async function loadSupplierEmailRecipients(
  supplierId: number,
): Promise<EmailRecipients | null> {
  // SupplierContact nao tem deletedAt; o status do Supplier nao e filtrado (PO/Responder
  // nunca filtraram).
  const contacts = await prisma.supplierContact.findMany({
    where: { supplierId },
    orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
    select: { id: true, name: true, email: true },
  });
  return buildEmailRecipients(contacts, null);
}

export async function loadCreditPartnerEmailRecipients(input: {
  creditPartnerId: number;
  preferredContactId?: number | null;
}): Promise<EmailRecipients | null> {
  // CreditPartnerContact nao tem deletedAt.
  const contacts = await prisma.creditPartnerContact.findMany({
    where: { creditPartnerId: input.creditPartnerId },
    orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
    select: { id: true, name: true, email: true },
  });
  return buildEmailRecipients(contacts, input.preferredContactId ?? null);
}

export async function sendPurchaseOrderEmail(
  input: PurchaseOrderEmailInput,
): Promise<PurchaseOrderEmailResult> {
  const { payload, quoteRequest, recipient, cc: companyCc, user } = input;

  if (payload.fileSize > PO_MAX_FILE_SIZE_BYTES) {
    throw new HttpError(400, 'O PDF excede o limite de 10MB.');
  }

  const buffer = decodePoAttachment(payload.contentBase64);
  if (buffer.length === 0) {
    throw new HttpError(400, 'Conteudo do PDF vazio.');
  }
  if (buffer.length > PO_MAX_FILE_SIZE_BYTES) {
    throw new HttpError(400, 'O PDF excede o limite de 10MB.');
  }

  // forwarderId e' so' rastreio (o texto do e-mail continua sendo forwarderInfo);
  // inativo e' aceito, excluido nao.
  const forwarderId = payload.forwarderId ?? null;
  if (forwarderId !== null) {
    const forwarder = await prisma.forwarder.findFirst({
      where: { id: forwarderId, deletedAt: null },
      select: { id: true },
    });
    if (!forwarder) {
      throw new HttpError(400, 'Forwarder nao encontrado.');
    }
  }

  const defaultSubject = `Purchase Order - ${quoteRequest.requestCode}`;
  const message = payload.message?.trim() ?? '';
  const destinationPort =
    quoteRequest.destinationPort?.trim() ||
    quoteRequest.items?.[0]?.destinationPort?.trim() ||
    'as agreed';

  const subjectOverride = payload.subject?.trim() || undefined;

  if (isEmailLogoPlaceholder()) {
    logger.warn(
      { templateKey: 'quote_po' },
      'Logo da SQ no e-mail da PO ainda e o PLACEHOLDER (src/mailer/assets/sqLogoPng.ts).',
    );
  }

  // Assinatura do proprio usuario logado (Minha conta). Nome e e-mail vem
  // de req.user; texto e imagem, da tabela UserEmailSignature.
  const signature = user?.id
    ? await prisma.userEmailSignature.findUnique({ where: { userId: user.id } })
    : null;
  const signatureImage =
    signature?.imageData && signature.imageMimeType
      ? { data: Buffer.from(signature.imageData), mimeType: signature.imageMimeType }
      : null;

  const rendered = await renderPoFromTemplate(
    {
      subject: subjectOverride || defaultSubject,
      requestCode: quoteRequest.requestCode,
      supplierContactName: recipient.name,
      forwarderInfo: payload.forwarderInfo?.trim() ?? '',
      destinationPort,
      message,
      senderName: user?.name,
      senderEmail: user?.email,
      signatureText: signature?.text ?? null,
      signatureImageSrc: signatureImage ? `cid:${EMAIL_SIGNATURE_CID}` : undefined,
      signatureImageWidth: signature?.imageWidth ?? undefined,
      signatureImageHeight: signature?.imageHeight ?? undefined,
      companyLogoSrc: `cid:${EMAIL_LOGO_CID}`,
      companyLogoWidth: emailLogoDisplaySize().width,
      ...(input.extraVars?.creditPartnerName
        ? {
            supplierName: input.extraVars.supplierName,
            creditPartnerName: input.extraVars.creditPartnerName,
          }
        : {}),
    },
    undefined,
    subjectOverride,
  );

  const { html, text } = rendered;

  const attachments: MailAttachment[] = [
    {
      filename: payload.fileName,
      content: buffer,
      contentType: 'application/pdf',
    },
  ];
  // Cada imagem inline so' e' anexada se o HTML final a referenciar
  // (template customizado pode ter removido o placeholder).
  if (html.includes(`cid:${EMAIL_LOGO_CID}`)) {
    attachments.push(getEmailLogoAttachment());
  }
  if (signatureImage && html.includes(`cid:${EMAIL_SIGNATURE_CID}`)) {
    attachments.push({
      filename: signatureImage.mimeType === 'image/png' ? 'signature.png' : 'signature.jpg',
      content: signatureImage.data,
      contentType: signatureImage.mimeType,
      cid: EMAIL_SIGNATURE_CID,
    });
  }

  const sendResult = await sendAndLog({
    to: { email: recipient.email, name: recipient.name },
    cc: companyCc,
    subject: rendered.subject,
    html,
    text,
    templateId: 'quote-po',
    templateVars: {
      ...input.templateVars,
      forwarderInfo: payload.forwarderInfo ?? null,
      forwarderId,
      hasCustomMessage: Boolean(message),
      hasSignatureImage: Boolean(signatureImage),
    },
    relatedEntityType: input.related.type,
    relatedEntityId: input.related.id,
    attachments,
  });

  await AuditLogService.log({
    entityType: input.audit.entityType,
    entityId: input.audit.entityId,
    action: 'purchase_order',
    performedById: user?.id ?? null,
    metadata: {
      to: recipient.email,
      cc: companyCc.map((c) => c.email),
      status: sendResult.status,
      subject: rendered.subject,
      fileName: payload.fileName,
      fileSize: buffer.length,
      forwarderId,
      ...(input.audit.metadata ?? {}),
    },
  });

  if (sendResult.status === 'failed') {
    throw new HttpError(502, sendResult.error || 'Falha ao enviar a Ordem de Compra.');
  }

  // E-mail ja saiu: falha ao marcar "PO enviada" na cotacao nao vira 5xx.
  try {
    await prisma.quoteRequest.update({
      where: { id: quoteRequest.id },
      data: { purchaseOrderSentAt: new Date() },
    });
  } catch (error) {
    logger.error(
      {
        quoteRequestId: quoteRequest.id,
        reason: error instanceof Error ? error.message : String(error),
      },
      'Falha ao marcar PO enviada; e-mail ja enviado.',
    );
  }

  return {
    status: sendResult.status,
    to: recipient.email,
    cc: companyCc.map((c) => c.email),
  };
}
