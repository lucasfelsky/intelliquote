import { Prisma, type Incoterm } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { mailerEnv } from '../config/env';
import { getComexCcList, sendAndLog } from '../mailer/MailerService';
import {
  defaultCreditSupportSubject,
  formatCreditSupportExpiry,
  renderCreditSupportFromTemplate,
  type CreditSupportRequestVars,
} from '../mailer/renderCreditSupportRequest';
import { HttpError } from '../utils/http';
import { effectiveOriginPort } from '../utils/originPort';
import type { CreditSupportForwardInput } from '../validators/domain';
import { AuditLogService } from './AuditLogService';
import { CompanyProfileService, readDispatchCc } from './CompanyProfileService';
import { lockQuoteRequestForPurchaseOrders } from './QuotePurchaseOrderService';
import { DEFAULT_TOKEN_TTL_DAYS, generateToken } from './SupplierPortalService';

export const CREDIT_SUPPORT_ENTITY_TYPE = 'credit_support_request';
export const CREDIT_SUPPORT_TEMPLATE_ID = 'credit-support-request';

type Tx = Prisma.TransactionClient;
type DecimalLike = Prisma.Decimal | string | number;

export type CreditSupportStatus = 'revoked' | 'responded' | 'expired' | 'sent';

// ---------------------------------------------------------------------------
// Helpers puros (snapshot, status, stale, markup)
// ---------------------------------------------------------------------------

function toDecimal(value: DecimalLike): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function money(value: DecimalLike): string {
  return toDecimal(value).toFixed(2);
}

export interface SnapshotSourceItem {
  quoteRequestItemId: number;
  unitPrice: DecimalLike;
  quantity: number;
  totalPrice: DecimalLike;
  /** DG declarado pelo fornecedor no item da resposta (#119). */
  isDangerousGood?: boolean;
  deletedAt?: Date | null;
  quoteRequestItem: {
    productName: string;
    itemCode?: string | null;
    unit: string;
    quantity: number;
    deletedAt?: Date | null;
    catalogItem?: { marketName: string } | null;
  };
}

export interface SnapshotSourceResponse {
  version: number;
  currency: string;
  offeredIncoterm: Incoterm;
  paymentTermsDays: number;
  deletedAt?: Date | null;
  items: SnapshotSourceItem[];
}

export interface SnapshotItem {
  quoteRequestItemId: number;
  position: number;
  productName: string;
  itemCode: string | null;
  unit: string;
  quantity: number;
  originalUnitPrice: Prisma.Decimal;
  originalTotalPrice: Prisma.Decimal;
  isUnavailable: boolean;
  originPort: string | null;
  isDangerousGood: boolean;
}

export interface Snapshot {
  sourceResponseVersion: number;
  currency: string;
  offeredIncoterm: Incoterm;
  originalPaymentTermsDays: number;
  originalTotalPrice: Prisma.Decimal;
  originPort: string | null;
  items: SnapshotItem[];
}

/**
 * Leitura tolerante de originPort (#113) e isUnavailable (#116): ausente = default.
 * isDangerousGood e lido de forma tipada direto do item da resposta (#119).
 */
export function readResponseExtras(
  response: SnapshotSourceResponse,
  item: SnapshotSourceItem,
): {
  generalOriginPort: string | null;
  itemOriginPort: string | null;
  isUnavailable: boolean;
} {
  const r = response as SnapshotSourceResponse & { originPort?: string | null };
  const i = item as SnapshotSourceItem & {
    originPort?: string | null;
    isUnavailable?: boolean | null;
  };
  return {
    generalOriginPort: r.originPort ?? null,
    itemOriginPort: i.originPort ?? null,
    isUnavailable: i.isUnavailable === true,
  };
}

/** Itens da proposta (nao excluidos, com item da cotacao nao excluido) congelados para o parceiro. */
export function buildSnapshot(response: SnapshotSourceResponse): Snapshot {
  const rows = response.items.filter(
    (item) => !item.deletedAt && !item.quoteRequestItem.deletedAt,
  );
  let total = new Prisma.Decimal(0);
  let generalOrigin: string | null = null;

  const items: SnapshotItem[] = rows.map((item, index) => {
    const extras = readResponseExtras(response, item);
    generalOrigin = extras.generalOriginPort;
    const source = item.quoteRequestItem;
    const zero = new Prisma.Decimal(0);
    const unavailable = extras.isUnavailable;
    const unitPrice = unavailable ? zero : toDecimal(item.unitPrice);
    const totalPrice = unavailable ? zero : toDecimal(item.totalPrice);
    if (!unavailable) total = total.plus(totalPrice);

    return {
      quoteRequestItemId: item.quoteRequestItemId,
      position: index + 1,
      productName: source.catalogItem?.marketName ?? source.productName,
      itemCode: source.itemCode ?? null,
      unit: source.unit,
      quantity: unavailable ? source.quantity : item.quantity,
      originalUnitPrice: unitPrice.toDecimalPlaces(2),
      originalTotalPrice: totalPrice.toDecimalPlaces(2),
      isUnavailable: unavailable,
      originPort: effectiveOriginPort(extras.itemOriginPort, extras.generalOriginPort),
      // Item indisponivel nunca e DG (sem mercadoria a declarar).
      isDangerousGood: unavailable ? false : item.isDangerousGood === true,
    };
  });

  return {
    sourceResponseVersion: response.version,
    currency: response.currency,
    offeredIncoterm: response.offeredIncoterm,
    originalPaymentTermsDays: response.paymentTermsDays,
    originalTotalPrice: total.toDecimalPlaces(2),
    originPort: generalOrigin,
    items,
  };
}

export function deriveStatus(
  request: { revokedAt: Date | null; respondedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): CreditSupportStatus {
  if (request.revokedAt) return 'revoked';
  if (request.respondedAt) return 'responded';
  if (request.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'sent';
}

/** "Ativo" (bloqueio de novo encaminhamento): nao revogado e nao expirado. */
export function isActive(
  request: { revokedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): boolean {
  return request.revokedAt === null && request.expiresAt.getTime() > now.getTime();
}

/** (partner / original - 1) x 100, 2 casas, como string; null sem base de comparacao. */
export function markupPercent(
  partner: DecimalLike | null | undefined,
  original: DecimalLike | null | undefined,
): string | null {
  if (partner === null || partner === undefined) return null;
  if (original === null || original === undefined) return null;
  const base = toDecimal(original);
  if (base.isZero()) return null;
  return toDecimal(partner).div(base).minus(1).times(100).toFixed(2);
}

interface StoredSnapshotItem {
  quoteRequestItemId: number;
  quantity: number;
  originalUnitPrice: DecimalLike;
  isUnavailable: boolean;
}

/**
 * Proposta original mudou desde o congelamento (ou foi excluida)? Compara moeda, incoterm,
 * conjunto de itens, quantidade/preco dos disponiveis e a disponibilidade.
 */
export function computeIsStale(
  request: { currency: string; offeredIncoterm: Incoterm; items: StoredSnapshotItem[] },
  currentResponse: SnapshotSourceResponse | null | undefined,
): boolean {
  if (!currentResponse || currentResponse.deletedAt) return true;
  if (currentResponse.currency !== request.currency) return true;
  if (currentResponse.offeredIncoterm !== request.offeredIncoterm) return true;

  const current = buildSnapshot(currentResponse).items;
  if (current.length !== request.items.length) return true;
  const byId = new Map(current.map((item) => [item.quoteRequestItemId, item]));
  for (const stored of request.items) {
    const now = byId.get(stored.quoteRequestItemId);
    if (!now) return true;
    if (now.isUnavailable !== stored.isUnavailable) return true;
    if (stored.isUnavailable) continue;
    if (now.quantity !== stored.quantity) return true;
    if (!now.originalUnitPrice.equals(toDecimal(stored.originalUnitPrice))) return true;
  }
  return false;
}

export function buildCreditPortalLink(rawToken: string): string {
  const base = mailerEnv.portalUrl.replace(/\/$/, '');
  return `${base}/portal/credit?token=${encodeURIComponent(rawToken)}&v=${Date.now()}`;
}

function parseRecipientEmails(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Serializacao (NUNCA inclui tokenHash)
// ---------------------------------------------------------------------------

export interface CreditSupportRequestRow {
  id: number;
  quoteRequestId: number;
  quoteResponseId: number;
  recipientEmails: string;
  revokedAt: Date | null;
  respondedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  responseVersion: number;
  currency: string;
  offeredIncoterm: Incoterm;
  originPort: string | null;
  originalPaymentTermsDays: number;
  originalTotalPrice: DecimalLike;
  partnerPaymentTermsDays: number | null;
  partnerValidityDays: number | null;
  partnerNotes: string | null;
  partnerTotalPrice: DecimalLike | null;
  supplier: { id: number; name: string; country: string | null };
  creditPartner: { id: number; name: string };
  createdBy: { id: number; name: string };
  items: Array<{
    quoteRequestItemId: number;
    position: number;
    productName: string;
    itemCode: string | null;
    unit: string;
    quantity: number;
    isUnavailable: boolean;
    originPort: string | null;
    isDangerousGood: boolean;
    originalUnitPrice: DecimalLike;
    originalTotalPrice: DecimalLike;
    partnerUnitPrice: DecimalLike | null;
    partnerTotalPrice: DecimalLike | null;
  }>;
}

export function serializeRequest(
  row: CreditSupportRequestRow,
  isStale: boolean,
  now: Date = new Date(),
) {
  return {
    id: row.id,
    quoteResponseId: row.quoteResponseId,
    supplier: { id: row.supplier.id, name: row.supplier.name, country: row.supplier.country },
    partner: { id: row.creditPartner.id, name: row.creditPartner.name },
    recipientEmails: parseRecipientEmails(row.recipientEmails),
    status: deriveStatus(row, now),
    isStale,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    createdBy: { id: row.createdBy.id, name: row.createdBy.name },
    respondedAt: row.respondedAt,
    responseVersion: row.responseVersion,
    currency: row.currency,
    offeredIncoterm: row.offeredIncoterm,
    originPort: row.originPort,
    originalPaymentTermsDays: row.originalPaymentTermsDays,
    partnerPaymentTermsDays: row.partnerPaymentTermsDays,
    partnerValidityDays: row.partnerValidityDays,
    partnerNotes: row.partnerNotes,
    totals: {
      original: money(row.originalTotalPrice),
      partner: row.partnerTotalPrice === null ? null : money(row.partnerTotalPrice),
      markupPercent: markupPercent(row.partnerTotalPrice, row.originalTotalPrice),
    },
    items: row.items.map((item) => ({
      quoteRequestItemId: item.quoteRequestItemId,
      position: item.position,
      productName: item.productName,
      itemCode: item.itemCode,
      unit: item.unit,
      quantity: item.quantity,
      isUnavailable: item.isUnavailable,
      originPort: item.originPort,
      isDangerousGood: item.isDangerousGood,
      originalUnitPrice: money(item.originalUnitPrice),
      originalTotalPrice: money(item.originalTotalPrice),
      partnerUnitPrice: item.partnerUnitPrice === null ? null : money(item.partnerUnitPrice),
      partnerTotalPrice: item.partnerTotalPrice === null ? null : money(item.partnerTotalPrice),
      markupPercent: item.isUnavailable
        ? null
        : markupPercent(item.partnerUnitPrice, item.originalUnitPrice),
    })),
  };
}

// ---------------------------------------------------------------------------
// Queries compartilhadas
// ---------------------------------------------------------------------------

const responseInclude = {
  supplier: true,
  quoteRequest: true,
  items: {
    where: { deletedAt: null, quoteRequestItem: { deletedAt: null } },
    include: { quoteRequestItem: { include: { catalogItem: true } } },
    orderBy: { quoteRequestItemId: 'asc' as const },
  },
} satisfies Prisma.QuoteResponseInclude;

const partnerInclude = {
  contacts: { orderBy: [{ isPrimary: 'desc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.CreditPartnerInclude;

const listInclude = {
  items: { orderBy: { position: 'asc' as const } },
  supplier: { select: { id: true, name: true, country: true } },
  creditPartner: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.CreditSupportRequestInclude;

type ResponseWithRelations = Prisma.QuoteResponseGetPayload<{ include: typeof responseInclude }>;
type PartnerWithContacts = Prisma.CreditPartnerGetPayload<{ include: typeof partnerInclude }>;

interface PreparedForward {
  response: ResponseWithRelations;
  snapshot: Snapshot;
  partner: PartnerWithContacts;
  contacts: PartnerWithContacts['contacts'];
}

async function prepareForward(
  client: Tx | typeof prisma,
  quoteResponseId: number,
  input: CreditSupportForwardInput,
): Promise<PreparedForward> {
  const response = await client.quoteResponse.findFirst({
    where: { id: quoteResponseId, deletedAt: null },
    include: responseInclude,
  });
  if (!response || response.quoteRequest.deletedAt) {
    throw new HttpError(404, 'Proposta nao encontrada.');
  }
  if (response.quoteRequest.status === 'closed') {
    throw new HttpError(409, 'Cotacao fechada: nao e possivel encaminhar.');
  }

  const snapshot = buildSnapshot(response);
  if (snapshot.items.length === 0) {
    throw new HttpError(400, 'A proposta nao possui itens para encaminhar ao parceiro.');
  }
  if (snapshot.items.every((item) => item.isUnavailable)) {
    throw new HttpError(400, 'Todos os itens da proposta estao indisponiveis.');
  }

  let partner: PartnerWithContacts | null;
  if (input.creditPartnerId !== undefined) {
    partner = await client.creditPartner.findFirst({
      where: { id: input.creditPartnerId, deletedAt: null },
      include: partnerInclude,
    });
    if (!partner) {
      throw new HttpError(404, 'Parceiro de credito nao encontrado.');
    }
    if (!partner.isActive) {
      throw new HttpError(400, 'Parceiro de credito inativo.');
    }
  } else {
    const actives = await client.creditPartner.findMany({
      where: { deletedAt: null, isActive: true },
      include: partnerInclude,
      orderBy: { id: 'asc' },
      take: 2,
    });
    if (actives.length !== 1) {
      throw new HttpError(400, 'Selecione o parceiro de credito.');
    }
    partner = actives[0];
  }

  let contacts: PartnerWithContacts['contacts'];
  if (input.contactIds !== undefined) {
    const byId = new Map(partner.contacts.map((contact) => [contact.id, contact]));
    contacts = input.contactIds.map((id) => {
      const contact = byId.get(id);
      if (!contact) {
        throw new HttpError(400, 'Contato nao pertence ao parceiro de credito.');
      }
      return contact;
    });
  } else {
    contacts = partner.contacts.slice(0, 1);
  }
  if (contacts.length === 0) {
    throw new HttpError(400, 'O parceiro de credito nao possui contato cadastrado.');
  }

  return { response, snapshot, partner, contacts };
}

/** Copia COMEX (env + CompanyProfile.dispatchCc) sem repeticao, mesma regra do envio de cotacao. */
async function loadComexCc(): Promise<Array<{ email: string; name: string }>> {
  const profile = await CompanyProfileService.get();
  const merged = [
    ...getComexCcList().map((c) => ({ email: c.email, name: c.name ?? '' })),
    ...readDispatchCc(profile).map((email) => ({ email, name: '' })),
  ];
  return dedupeCc(merged, null);
}

function dedupeCc(
  list: Array<{ email: string; name: string }>,
  excludeEmail: string | null,
): Array<{ email: string; name: string }> {
  const out: Array<{ email: string; name: string }> = [];
  for (const entry of list) {
    const lower = entry.email?.trim().toLowerCase();
    if (!lower) continue;
    if (excludeEmail && lower === excludeEmail.toLowerCase()) continue;
    if (out.some((c) => c.email === lower)) continue;
    out.push({ email: lower, name: entry.name ?? '' });
  }
  return out;
}

interface Recipient {
  email: string;
  name: string;
}

interface SendContext {
  requestId: number;
  quoteRequestId: number;
  requestCode: string;
  creditPartnerId: number;
  partnerName: string;
  supplierName: string;
  supplierCountry: string;
  companyName: string;
  currency: string;
  incoterm: string;
  itemsCount: number;
  unavailableCount: number;
  expiresAt: Date;
  portalLink: string;
  subject: string;
  subjectIsCustom: boolean;
  customMessage: string;
}

function buildEmailVars(ctx: SendContext, contactName: string): CreditSupportRequestVars {
  return {
    subject: ctx.subject,
    subjectIsCustom: ctx.subjectIsCustom,
    contactName,
    partnerName: ctx.partnerName,
    companyName: ctx.companyName,
    requestCode: ctx.requestCode,
    supplierName: ctx.supplierName,
    supplierCountry: ctx.supplierCountry,
    currency: ctx.currency,
    incoterm: ctx.incoterm,
    itemsCount: ctx.itemsCount,
    unavailableCount: ctx.unavailableCount,
    expiresAt: formatCreditSupportExpiry(ctx.expiresAt),
    portalLink: ctx.portalLink,
    customMessage: ctx.customMessage,
  };
}

/**
 * 1 sendAndLog por destinatario (mesmo link), FORA de transacao. Copia COMEX so no 1o envio
 * entregue (sent|queued). O link/token NAO entra em templateVars (MailLog) nem no AuditLog.
 */
async function sendToRecipients(
  ctx: SendContext,
  recipients: Recipient[],
  cc: Array<{ email: string; name: string }>,
): Promise<Array<{ email: string; status: 'sent' | 'failed' }>> {
  const results: Array<{ email: string; status: 'sent' | 'failed' }> = [];
  let ccDelivered = false;

  for (const recipient of recipients) {
    try {
      const rendered = await renderCreditSupportFromTemplate(
        buildEmailVars(ctx, recipient.name || 'Sir or Madam'),
      );
      const recipientCc = ccDelivered ? [] : dedupeCc(cc, recipient.email);
      const sendResult = await sendAndLog({
        to: { email: recipient.email, name: recipient.name || undefined },
        cc: recipientCc,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateId: CREDIT_SUPPORT_TEMPLATE_ID,
        templateVars: {
          creditSupportRequestId: ctx.requestId,
          quoteRequestId: ctx.quoteRequestId,
          requestCode: ctx.requestCode,
          creditPartnerId: ctx.creditPartnerId,
          recipientEmail: recipient.email,
          customMessage: ctx.customMessage || null,
        },
        relatedEntityType: CREDIT_SUPPORT_ENTITY_TYPE,
        relatedEntityId: String(ctx.requestId),
      });
      if (sendResult.status === 'sent' || sendResult.status === 'queued') {
        if (recipientCc.length > 0) ccDelivered = true;
        results.push({ email: recipient.email, status: 'sent' });
      } else {
        results.push({ email: recipient.email, status: 'failed' });
      }
    } catch (error) {
      logger.error(
        {
          creditSupportRequestId: ctx.requestId,
          reason: error instanceof Error ? error.message : String(error),
        },
        'Falha ao enviar e-mail de credit support.',
      );
      results.push({ email: recipient.email, status: 'failed' });
    }
  }
  return results;
}

function auditSummary(request: {
  id: number;
  quoteResponseId: number;
  creditPartnerId: number;
  recipientEmails: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  currency: string;
  offeredIncoterm: Incoterm;
  originalTotalPrice: DecimalLike;
}) {
  // Deliberadamente sem tokenHash/link.
  return {
    id: request.id,
    quoteResponseId: request.quoteResponseId,
    creditPartnerId: request.creditPartnerId,
    recipientEmails: parseRecipientEmails(request.recipientEmails),
    expiresAt: request.expiresAt,
    revokedAt: request.revokedAt ?? null,
    currency: request.currency,
    offeredIncoterm: request.offeredIncoterm,
    originalTotalPrice: money(request.originalTotalPrice),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CreditSupportService {
  static async preview(quoteResponseId: number, input: CreditSupportForwardInput) {
    const prepared = await prepareForward(prisma, quoteResponseId, input);
    const { response, snapshot, partner, contacts } = prepared;
    const profile = await CompanyProfileService.get();
    const cc = await loadComexCc();
    const ttlDays = input.ttlDays ?? DEFAULT_TOKEN_TTL_DAYS;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    const requestCode = response.quoteRequest.requestCode;
    const subjectCustom = input.subject?.trim() ?? '';
    const base = mailerEnv.portalUrl.replace(/\/$/, '');

    const rendered = await renderCreditSupportFromTemplate(
      buildEmailVars(
        {
          requestId: 0,
          quoteRequestId: response.quoteRequestId,
          requestCode,
          creditPartnerId: partner.id,
          partnerName: partner.name,
          supplierName: response.supplier.name,
          supplierCountry: response.supplier.country ?? '',
          companyName: profile.companyName,
          currency: snapshot.currency,
          incoterm: snapshot.offeredIncoterm,
          itemsCount: snapshot.items.length,
          unavailableCount: snapshot.items.filter((i) => i.isUnavailable).length,
          expiresAt,
          portalLink: `${base}/portal/credit?token=PREVIEW&v=${Date.now()}`,
          subject: subjectCustom || defaultCreditSupportSubject(requestCode, response.supplier.name),
          subjectIsCustom: subjectCustom.length > 0,
          customMessage: input.message?.trim() ?? '',
        },
        contacts[0].name,
      ),
    );

    return {
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      partner: { id: partner.id, name: partner.name },
      recipients: contacts.map((c) => ({ email: c.email, name: c.name })),
      cc: cc.map((c) => c.email),
      items: snapshot.items.length,
    };
  }

  static async forward(quoteResponseId: number, userId: number, input: CreditSupportForwardInput) {
    const ttlDays = input.ttlDays ?? DEFAULT_TOKEN_TTL_DAYS;
    const token = generateToken(ttlDays);
    const profile = await CompanyProfileService.get();
    const cc = await loadComexCc();

    const created = await prisma.$transaction(async (tx) => {
      const head = await tx.quoteResponse.findFirst({
        where: { id: quoteResponseId, deletedAt: null },
        select: { quoteRequestId: true },
      });
      if (!head) {
        throw new HttpError(404, 'Proposta nao encontrada.');
      }
      // Serializa 2 cliques e o fechamento da cotacao (mesma ordem de lock: QuoteRequest primeiro).
      await lockQuoteRequestForPurchaseOrders(tx, head.quoteRequestId);

      const { response, snapshot, partner, contacts } = await prepareForward(
        tx,
        quoteResponseId,
        input,
      );

      const now = new Date();
      const duplicate = await tx.creditSupportRequest.findFirst({
        where: {
          quoteResponseId,
          creditPartnerId: partner.id,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new HttpError(
          409,
          'Ja existe encaminhamento ativo para este parceiro. Use Reenviar ou revogue antes.',
        );
      }

      const requestCode = response.quoteRequest.requestCode;
      const subjectCustom = input.subject?.trim() ?? '';
      const emailSubject =
        subjectCustom || defaultCreditSupportSubject(requestCode, response.supplier.name);
      const recipientEmails = Array.from(
        new Set(contacts.map((contact) => contact.email.trim().toLowerCase())),
      );

      const record = await tx.creditSupportRequest.create({
        data: {
          quoteRequestId: response.quoteRequestId,
          quoteResponseId: response.id,
          supplierId: response.supplierId,
          creditPartnerId: partner.id,
          creditPartnerContactId: contacts[0].id,
          recipientEmails: JSON.stringify(recipientEmails),
          emailSubject,
          emailMessage: input.message?.trim() || null,
          tokenHash: token.tokenHash,
          expiresAt: token.expiresAt,
          sourceResponseVersion: snapshot.sourceResponseVersion,
          currency: snapshot.currency,
          offeredIncoterm: snapshot.offeredIncoterm,
          originalPaymentTermsDays: snapshot.originalPaymentTermsDays,
          originalTotalPrice: snapshot.originalTotalPrice,
          originPort: snapshot.originPort,
          createdById: userId,
          items: {
            create: snapshot.items.map((item) => ({
              quoteRequestItemId: item.quoteRequestItemId,
              position: item.position,
              productName: item.productName,
              itemCode: item.itemCode,
              unit: item.unit,
              quantity: item.quantity,
              originalUnitPrice: item.originalUnitPrice,
              originalTotalPrice: item.originalTotalPrice,
              isUnavailable: item.isUnavailable,
              originPort: item.originPort,
              isDangerousGood: item.isDangerousGood,
            })),
          },
        },
      });

      await AuditLogService.log(
        {
          entityType: CREDIT_SUPPORT_ENTITY_TYPE,
          entityId: record.id,
          action: 'forward',
          performedById: userId,
          afterData: { ...auditSummary(record), itemsCount: snapshot.items.length },
        },
        tx,
      );

      return { record, response, snapshot, partner, contacts, emailSubject, subjectCustom };
    });

    const { record, response, snapshot, partner, contacts, emailSubject, subjectCustom } = created;
    const ctx: SendContext = {
      requestId: record.id,
      quoteRequestId: record.quoteRequestId,
      requestCode: response.quoteRequest.requestCode,
      creditPartnerId: partner.id,
      partnerName: partner.name,
      supplierName: response.supplier.name,
      supplierCountry: response.supplier.country ?? '',
      companyName: profile.companyName,
      currency: snapshot.currency,
      incoterm: snapshot.offeredIncoterm,
      itemsCount: snapshot.items.length,
      unavailableCount: snapshot.items.filter((i) => i.isUnavailable).length,
      expiresAt: record.expiresAt,
      portalLink: buildCreditPortalLink(token.rawToken),
      subject: emailSubject,
      subjectIsCustom: subjectCustom.length > 0,
      customMessage: record.emailMessage ?? '',
    };

    const recipients = Array.from(
      new Map(
        contacts.map((c) => [c.email.trim().toLowerCase(), { email: c.email.trim().toLowerCase(), name: c.name }]),
      ).values(),
    );
    const sent = await sendToRecipients(ctx, recipients, cc);

    if (sent.every((r) => r.status === 'failed')) {
      // Evita registro ativo orfao bloqueando novo encaminhamento (nenhum e-mail saiu).
      await prisma.$transaction(async (tx) => {
        const revokedAt = new Date();
        await tx.creditSupportRequest.update({ where: { id: record.id }, data: { revokedAt } });
        await AuditLogService.log(
          {
            entityType: CREDIT_SUPPORT_ENTITY_TYPE,
            entityId: record.id,
            action: 'revoke',
            performedById: userId,
            afterData: { ...auditSummary(record), revokedAt },
            metadata: { reason: 'send_failed' },
          },
          tx,
        );
      });
      throw new HttpError(
        502,
        'Falha ao enviar o e-mail ao parceiro; nada foi encaminhado.',
      );
    }

    return {
      id: record.id,
      status: deriveStatus(record),
      expiresAt: record.expiresAt,
      portalUrl: ctx.portalLink,
      recipients: sent,
    };
  }

  static async listByQuoteRequest(quoteRequestId: number) {
    const quoteRequest = await prisma.quoteRequest.findFirst({
      where: { id: quoteRequestId, deletedAt: null },
      select: { id: true },
    });
    if (!quoteRequest) {
      throw new HttpError(404, 'Cotacao nao encontrada.');
    }

    const rows = await prisma.creditSupportRequest.findMany({
      where: { quoteRequestId },
      orderBy: { createdAt: 'desc' },
      include: listInclude,
    });
    if (rows.length === 0) return [];

    // Sem filtro de deletedAt na resposta: resposta excluida => stale.
    const responseIds = Array.from(new Set(rows.map((row) => row.quoteResponseId)));
    const responses = await prisma.quoteResponse.findMany({
      where: { id: { in: responseIds } },
      include: {
        items: {
          where: { deletedAt: null, quoteRequestItem: { deletedAt: null } },
          include: { quoteRequestItem: { include: { catalogItem: true } } },
          orderBy: { quoteRequestItemId: 'asc' },
        },
      },
    });
    const responseById = new Map(responses.map((r) => [r.id, r]));
    const now = new Date();

    return rows.map((row) =>
      serializeRequest(row, computeIsStale(row, responseById.get(row.quoteResponseId)), now),
    );
  }

  static async revoke(id: number, userId: number) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.creditSupportRequest.findUnique({ where: { id } });
      if (!before) {
        throw new HttpError(404, 'Encaminhamento nao encontrado.');
      }
      if (before.revokedAt) {
        return { id, alreadyRevoked: true as const };
      }

      const revokedAt = new Date();
      // Condicional: duas revogacoes concorrentes gravam 1 so auditoria.
      const result = await tx.creditSupportRequest.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt },
      });
      if (result.count === 0) {
        return { id, alreadyRevoked: true as const };
      }

      await AuditLogService.log(
        {
          entityType: CREDIT_SUPPORT_ENTITY_TYPE,
          entityId: id,
          action: 'revoke',
          performedById: userId,
          beforeData: auditSummary(before),
          afterData: { ...auditSummary(before), revokedAt },
        },
        tx,
      );
      return { id, status: 'revoked' as const };
    });
  }

  static async resend(id: number, userId: number, ttlDaysInput?: number) {
    const ttlDays = ttlDaysInput ?? DEFAULT_TOKEN_TTL_DAYS;
    const token = generateToken(ttlDays);
    const profile = await CompanyProfileService.get();
    const cc = await loadComexCc();

    const prepared = await prisma.$transaction(async (tx) => {
      const head = await tx.creditSupportRequest.findUnique({
        where: { id },
        select: { quoteRequestId: true },
      });
      if (!head) {
        throw new HttpError(404, 'Encaminhamento nao encontrado.');
      }
      await lockQuoteRequestForPurchaseOrders(tx, head.quoteRequestId);

      const request = await tx.creditSupportRequest.findUnique({
        where: { id },
        include: {
          items: { orderBy: { position: 'asc' } },
          creditPartner: { include: partnerInclude },
          supplier: { select: { id: true, name: true, country: true } },
          quoteRequest: true,
        },
      });
      if (!request) {
        throw new HttpError(404, 'Encaminhamento nao encontrado.');
      }
      if (request.revokedAt) {
        throw new HttpError(409, 'Encaminhamento revogado: encaminhe novamente.');
      }
      if (request.respondedAt) {
        throw new HttpError(
          409,
          'O parceiro ja respondeu por este link. Nao e possivel gerar novo link.',
        );
      }
      if (request.quoteRequest.deletedAt) {
        throw new HttpError(404, 'Cotacao nao encontrada.');
      }
      if (request.quoteRequest.status === 'closed') {
        throw new HttpError(409, 'Cotacao fechada: nao e possivel reenviar.');
      }
      if (request.creditPartner.deletedAt) {
        throw new HttpError(409, 'Parceiro de credito excluido: nao e possivel reenviar.');
      }

      // Resposta atual (inclusive excluida) para detectar mudanca desde o congelamento.
      const current = await tx.quoteResponse.findUnique({
        where: { id: request.quoteResponseId },
        include: {
          items: {
            where: { deletedAt: null, quoteRequestItem: { deletedAt: null } },
            include: { quoteRequestItem: { include: { catalogItem: true } } },
            orderBy: { quoteRequestItemId: 'asc' },
          },
        },
      });
      if (computeIsStale(request, current)) {
        throw new HttpError(
          409,
          'A proposta do fornecedor mudou: revogue e encaminhe de novo.',
        );
      }

      // Gira o token no MESMO registro: o link antigo morre.
      const updated = await tx.creditSupportRequest.update({
        where: { id },
        data: { tokenHash: token.tokenHash, expiresAt: token.expiresAt },
      });

      await AuditLogService.log(
        {
          entityType: CREDIT_SUPPORT_ENTITY_TYPE,
          entityId: id,
          action: 'resend',
          performedById: userId,
          beforeData: auditSummary(request),
          afterData: auditSummary(updated),
        },
        tx,
      );

      return { updated, request };
    });

    const { updated, request } = prepared;
    const emails = parseRecipientEmails(updated.recipientEmails);
    const nameByEmail = new Map(
      request.creditPartner.contacts.map((c) => [c.email.trim().toLowerCase(), c.name]),
    );
    const recipients: Recipient[] = emails.map((email) => ({
      email,
      name: nameByEmail.get(email.toLowerCase()) ?? '',
    }));

    const ctx: SendContext = {
      requestId: updated.id,
      quoteRequestId: updated.quoteRequestId,
      requestCode: request.quoteRequest.requestCode,
      creditPartnerId: updated.creditPartnerId,
      partnerName: request.creditPartner.name,
      supplierName: request.supplier.name,
      supplierCountry: request.supplier.country ?? '',
      companyName: profile.companyName,
      currency: updated.currency,
      incoterm: updated.offeredIncoterm,
      itemsCount: request.items.length,
      unavailableCount: request.items.filter((i) => i.isUnavailable).length,
      expiresAt: updated.expiresAt,
      portalLink: buildCreditPortalLink(token.rawToken),
      subject: updated.emailSubject,
      // Assunto gravado no encaminhamento original e sempre reaproveitado.
      subjectIsCustom: true,
      customMessage: updated.emailMessage ?? '',
    };

    const sent = await sendToRecipients(ctx, recipients, cc);
    if (sent.length === 0 || sent.every((r) => r.status === 'failed')) {
      // Registro continua ativo (ninguem recebeu o link novo): tentar Reenviar de novo ou Revogar.
      throw new HttpError(
        502,
        'Falha ao enviar o e-mail ao parceiro; tente reenviar novamente.',
      );
    }

    return {
      id: updated.id,
      expiresAt: updated.expiresAt,
      portalUrl: ctx.portalLink,
      recipients: sent,
    };
  }
}
