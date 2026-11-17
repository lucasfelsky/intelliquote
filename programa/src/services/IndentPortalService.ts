import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  INDENT_PORTAL_CLOSED_MESSAGE,
  INDENT_PORTAL_CURRENCIES,
  INDENT_PORTAL_EXPIRED_MESSAGE,
  INDENT_PORTAL_FILE_TOO_LARGE_MESSAGE,
  INDENT_PORTAL_BAD_LINK_MESSAGE,
  INDENT_PORTAL_MAX_FILES,
  INDENT_PORTAL_MAX_FILE_BYTES,
  INDENT_PORTAL_NOT_PDF_MESSAGE,
  INDENT_PORTAL_PACKAGING_OPTIONS,
  INDENT_PORTAL_PAYMENT_OPTIONS,
  INDENT_PORTAL_TOKEN_PATTERN,
  INDENT_PORTAL_TOO_MANY_FILES_MESSAGE,
} from '../constants/indentPortal';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { buildClientTerms, buildIndentExposureProfile, findClientLeak, hasForbiddenBuyerPhrase } from '../utils/indentExposure';
import { formatQuoteRef } from '../utils/indentQuote';
import { PortalHttpError } from '../utils/portalHttpError';
import { addDaysToKey, dateKeyToDbDate, dbDateToKey, todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import { hashToken } from '../utils/tokens';
import type { IndentPortalRespondInput } from '../validators/indentPortal';
import { AuditLogService } from './AuditLogService';
import { sanitizeFileName } from './IndentDispatchService';
import { applyRequestStatusAfterResponse, lockIndentQuote } from './IndentQuoteWorkflowService';

// IQ Indent PR 4a-2: API PUBLICA (sem login) do portal do fornecedor. O token e o unico credencial: formato validado antes do banco,
// 404 unico para inexistente/formato invalido, 410 so para token que existe. O perfil de sigilo e recalculado a CADA acesso com a
// parceria ATUAL e a view sai por ALLOWLIST (nunca espalha linha do banco). Toda mutacao roda em $transaction com `lockIndentQuote`
// (solicitacao -> cotacao). O portal NUNCA grava ACEITA. O token bruto nunca vai a log, AuditLog nem AccessLog.

const ENTITY_TYPE = 'indent_quote';
const TX_OPTIONS = { timeout: 15000, maxWait: 10000 };
const OPEN_STATUSES = ['ENVIADA', 'RESPONDIDA'];
const FIELD_MAX = 255;

// 410 LINK_EXPIRED com a referencia e a validade do link (a pagina publica mostra "valid until"). Sai so do resolveToken: o token existe,
// entao nao ha enumeracao; nunca leva cliente, parceria nem e-mail. A rota repassa estes 2 campos ao corpo do erro.
export class IndentPortalExpiredError extends PortalHttpError {
  constructor(
    readonly processRef: string,
    readonly expiresAt: Date,
  ) {
    super(410, INDENT_PORTAL_EXPIRED_MESSAGE, 'LINK_EXPIRED');
    this.name = 'IndentPortalExpiredError';
  }
}

export interface IndentPortalMeta {
  ip: string | null;
  userAgent: string | null;
}

export type ResolvedIndentToken = {
  id: number;
  quoteId: number;
  supplierId: number;
  showClientName: boolean;
  destinationPort: string;
  message: string | null;
  expiresAt: Date;
  firstSeenAt: Date | null;
};

type AccessKind = 'VIEW' | 'SUBMIT' | 'INVALID' | 'UPLOAD';
type InvalidReason = 'not_found' | 'bad_format' | 'revoked' | 'expired' | 'closed';

interface PortalOfferItem {
  quoteItemId: number;
  packaging: string | null;
  fobPricePerKg: string | null;
  cfrPricePerKg: string | null;
}

export interface IndentPortalView {
  state: 'open' | 'revision' | 'sent';
  processRef: string;
  revision: number;
  expiresAt: Date;
  requestedBy: string;
  endCustomer: string | null;
  requestType: string;
  destination: string;
  incoterm: string;
  currency: string;
  message: string | null;
  manufacturerRequired: boolean;
  items: Array<{ quoteItemId: number; name: string; cas: string | null; quantityKg: string }>;
  previousOffer: null | {
    currency: string;
    productionLeadTimeDays: number | null;
    paymentTerms: string | null;
    validUntil: string | null;
    manufacturer: string | null;
    items: PortalOfferItem[];
  };
  response: null | {
    via: 'portal' | 'manual';
    version: number | null;
    submittedAt: Date | null;
    currency: string;
    productionLeadTimeDays: number | null;
    paymentTerms: string | null;
    validUntil: string | null;
    manufacturer: string | null;
    notes: string | null;
    items: PortalOfferItem[];
  };
  attachments: Array<{ id: number; fileName: string; fileSize: number; createdAt: Date }>;
  options: {
    packaging: readonly string[];
    paymentTerms: readonly string[];
    currencies: readonly string[];
    maxFiles: number;
    maxFileBytes: number;
  };
}

export interface IndentPortalSubmitResult {
  status: 200 | 201;
  body: { version: number; submittedAt: Date; revised: boolean; unchanged: boolean };
  notify: null | { quoteId: number; version: number; afterAcceptance: boolean };
}

const viewSelect = {
  id: true,
  requestId: true,
  supplierId: true,
  revision: true,
  status: true,
  currency: true,
  incoterm: true,
  respondedAt: true,
  validUntil: true,
  productionLeadTimeDays: true,
  paymentTerms: true,
  manufacturer: true,
  request: { select: { processNumber: true, status: true, client: { select: { name: true, cnpj: true } } } },
  supplier: { select: { hasPartnership: true, type: true } },
  items: {
    orderBy: { requestItem: { position: 'asc' as const } },
    select: {
      id: true,
      requestItemId: true,
      packaging: true,
      fobPricePerKg: true,
      cfrPricePerKg: true,
      requestItem: { select: { description: true, quantityKg: true, product: { select: { name: true, cas: true } } } },
    },
  },
} satisfies Prisma.IndentQuoteSelect;

const fixed = (value: unknown, digits: number): string => new Prisma.Decimal(value as Prisma.Decimal.Value).toFixed(digits);
const fixedOrNull = (value: unknown, digits: number): string | null => (value === null || value === undefined ? null : fixed(value, digits));
const clip = (value: string | null | undefined): string | null => (value ? value.slice(0, FIELD_MAX) : null);

// Sem diferenca de caixa/espacos: so devolve a embalagem se for UMA das opcoes do portal (o resto vira null).
function matchPackaging(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const key = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return INDENT_PORTAL_PACKAGING_OPTIONS.find((option) => option.toLowerCase() === key) ?? null;
}

function offerItems(items: Array<{ id: number; packaging: string | null; fobPricePerKg: unknown; cfrPricePerKg: unknown }>): PortalOfferItem[] {
  return items.map((item) => ({
    quoteItemId: item.id,
    packaging: matchPackaging(item.packaging),
    fobPricePerKg: fixedOrNull(item.fobPricePerKg, 4),
    cfrPricePerKg: fixedOrNull(item.cfrPricePerKg, 4),
  }));
}

interface Normalized {
  currency: string;
  productionLeadTimeDays: number;
  paymentTerms: string;
  validUntil: string;
  manufacturer: string | null;
  notes: string | null;
  items: Array<{ quoteItemId: number; packaging: string; fobPricePerKg: string; cfrPricePerKg: string }>;
}

function normalizeInput(input: IndentPortalRespondInput): Normalized {
  return {
    currency: input.currency,
    productionLeadTimeDays: input.productionLeadTimeDays,
    paymentTerms: input.paymentTerms,
    validUntil: input.validUntil,
    manufacturer: input.manufacturer ?? null,
    notes: input.notes ?? null,
    items: input.items
      .map((item) => ({
        quoteItemId: item.quoteItemId,
        packaging: item.packaging,
        fobPricePerKg: fixed(item.fobPricePerKg, 4),
        cfrPricePerKg: fixed(item.cfrPricePerKg, 4),
      }))
      .sort((a, b) => a.quoteItemId - b.quoteItemId),
  };
}

interface StoredResponse {
  version: number;
  submittedAt: Date;
  currency: string;
  productionLeadTimeDays: number;
  paymentTerms: string;
  validUntil: Date;
  manufacturer: string | null;
  notes: string | null;
  items: Array<{ quoteItemId: number; packaging: string; fobPricePerKg: unknown; cfrPricePerKg: unknown }>;
}

function normalizeStored(stored: StoredResponse): Normalized {
  return {
    currency: stored.currency,
    productionLeadTimeDays: stored.productionLeadTimeDays,
    paymentTerms: stored.paymentTerms,
    validUntil: dbDateToKey(stored.validUntil),
    manufacturer: stored.manufacturer ?? null,
    notes: stored.notes ?? null,
    items: stored.items
      .map((item) => ({
        quoteItemId: item.quoteItemId,
        packaging: item.packaging,
        fobPricePerKg: fixed(item.fobPricePerKg, 4),
        cfrPricePerKg: fixed(item.cfrPricePerKg, 4),
      }))
      .sort((a, b) => a.quoteItemId - b.quoteItemId),
  };
}

const sameContent = (a: Normalized, b: Normalized): boolean => JSON.stringify(a) === JSON.stringify(b);

// Linha a gravar na resposta/itens (Decimal) a partir do conteudo normalizado.
const decimal = (value: string) => new Prisma.Decimal(value);

export class IndentPortalService {
  /** Registra o acesso (sem token nem hash). Falha de log nunca derruba o portal. */
  static async logAccess(tokenId: number | null, kind: AccessKind, reason: InvalidReason | null, meta: IndentPortalMeta): Promise<void> {
    try {
      await prisma.indentPortalAccessLog.create({
        data: { tokenId, kind, reason, ip: clip(meta.ip), userAgent: clip(meta.userAgent) },
      });
    } catch (error) {
      logger.warn({ kind, reason, failure: error instanceof Error ? error.message : String(error) }, 'Falha ao gravar o log de acesso do portal Indent.');
    }
  }

  // Resolve o token (fora de trava). Formato fora do padrao e hash desconhecido dao o MESMO 404; 410 so quando o token existe.
  static async resolveToken(rawToken: string, meta: IndentPortalMeta, now: Date = new Date()): Promise<ResolvedIndentToken> {
    if (typeof rawToken !== 'string' || !INDENT_PORTAL_TOKEN_PATTERN.test(rawToken)) {
      await IndentPortalService.logAccess(null, 'INVALID', 'bad_format', meta);
      throw new PortalHttpError(404, INDENT_PORTAL_BAD_LINK_MESSAGE, 'LINK_INVALID');
    }

    const token = await prisma.indentPortalToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        id: true,
        quoteId: true,
        supplierId: true,
        showClientName: true,
        destinationPort: true,
        message: true,
        expiresAt: true,
        revokedAt: true,
        firstSeenAt: true,
        quote: { select: { status: true, revision: true, request: { select: { status: true, processNumber: true } } } },
      },
    });

    if (!token) {
      await IndentPortalService.logAccess(null, 'INVALID', 'not_found', meta);
      throw new PortalHttpError(404, INDENT_PORTAL_BAD_LINK_MESSAGE, 'LINK_INVALID');
    }
    if (token.revokedAt) {
      await IndentPortalService.logAccess(token.id, 'INVALID', 'revoked', meta);
      throw new PortalHttpError(410, INDENT_PORTAL_BAD_LINK_MESSAGE, 'LINK_CLOSED');
    }
    if (token.expiresAt <= now) {
      await IndentPortalService.logAccess(token.id, 'INVALID', 'expired', meta);
      // So aqui (token que existe e expirou): a tela "Link expired" mostra a referencia e a validade. Mesmo formatador da view; nada do cliente.
      throw new IndentPortalExpiredError(formatQuoteRef(token.quote.request.processNumber, token.quote.revision), token.expiresAt);
    }
    if (!OPEN_STATUSES.includes(token.quote.status) || token.quote.request.status === 'PERDIDA') {
      await IndentPortalService.logAccess(token.id, 'INVALID', 'closed', meta);
      throw new PortalHttpError(410, INDENT_PORTAL_CLOSED_MESSAGE, 'LINK_CLOSED');
    }

    return {
      id: token.id,
      quoteId: token.quoteId,
      supplierId: token.supplierId,
      showClientName: token.showClientName,
      destinationPort: token.destinationPort,
      message: token.message,
      expiresAt: token.expiresAt,
      firstSeenAt: token.firstSeenAt,
    };
  }

  // View do portal (sem trava), recalculada a cada acesso. Montada por ALLOWLIST: nada de dono, comprador, e-mails, notas internas,
  // dados da integracao externa, CNPJ, cidade nem outras cotacoes. Registra VIEW e atualiza o token.
  static async getView(token: ResolvedIndentToken, meta: IndentPortalMeta, now: Date = new Date()): Promise<IndentPortalView> {
    const quote = await prisma.indentQuote.findUnique({ where: { id: token.quoteId }, select: viewSelect });

    if (!quote) {
      throw new PortalHttpError(404, INDENT_PORTAL_BAD_LINK_MESSAGE, 'LINK_INVALID');
    }

    const [stored, attachments] = await Promise.all([
      prisma.indentPortalResponse.findUnique({
        where: { quoteId: quote.id },
        select: {
          version: true,
          submittedAt: true,
          currency: true,
          productionLeadTimeDays: true,
          paymentTerms: true,
          validUntil: true,
          manufacturer: true,
          notes: true,
          items: { select: { quoteItemId: true, packaging: true, fobPricePerKg: true, cfrPricePerKg: true } },
        },
      }),
      prisma.indentPortalAttachment.findMany({
        where: { quoteId: quote.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, fileName: true, fileSize: true, createdAt: true },
      }),
    ]);

    // Perfil com a parceria ATUAL: parceria desligada depois do envio some com o cliente (e, abaixo, com a mensagem).
    const profile = buildIndentExposureProfile(quote.supplier, token.showClientName);
    const client = quote.request.client;
    const terms = client ? buildClientTerms(client) : [];
    const message =
      token.message && !profile.hasPartnership && (findClientLeak({ message: token.message }, terms) || hasForbiddenBuyerPhrase(token.message))
        ? null
        : token.message;
    const answered = stored !== null || quote.respondedAt !== null;
    const state: IndentPortalView['state'] = answered ? 'sent' : quote.revision > 1 ? 'revision' : 'open';

    let previousOffer: IndentPortalView['previousOffer'] = null;

    if (state === 'revision') {
      const previous = await prisma.indentQuote.findFirst({
        where: { requestId: quote.requestId, supplierId: quote.supplierId, revision: quote.revision - 1 },
        select: {
          currency: true,
          productionLeadTimeDays: true,
          paymentTerms: true,
          validUntil: true,
          manufacturer: true,
          items: { select: { requestItemId: true, packaging: true, fobPricePerKg: true, cfrPricePerKg: true } },
        },
      });

      if (previous) {
        const byRequestItem = new Map(previous.items.map((item) => [item.requestItemId, item]));
        const matched = quote.items.flatMap((item) => {
          const old = byRequestItem.get(item.requestItemId);
          return old ? [{ id: item.id, packaging: old.packaging, fobPricePerKg: old.fobPricePerKg, cfrPricePerKg: old.cfrPricePerKg }] : [];
        });

        previousOffer = {
          currency: previous.currency,
          productionLeadTimeDays: previous.productionLeadTimeDays,
          paymentTerms: previous.paymentTerms,
          validUntil: previous.validUntil ? dbDateToKey(previous.validUntil) : null,
          manufacturer: previous.manufacturer,
          items: offerItems(matched),
        };
      }
    }

    let response: IndentPortalView['response'] = null;

    if (stored) {
      response = {
        via: 'portal',
        version: stored.version,
        submittedAt: stored.submittedAt,
        currency: stored.currency,
        productionLeadTimeDays: stored.productionLeadTimeDays,
        paymentTerms: stored.paymentTerms,
        validUntil: dbDateToKey(stored.validUntil),
        manufacturer: stored.manufacturer,
        notes: stored.notes,
        items: offerItems(stored.items.map((item) => ({ ...item, id: item.quoteItemId }))),
      };
    } else if (quote.respondedAt) {
      // Resposta registrada manualmente pela Compras: a observacao e INTERNA e nunca vai ao portal.
      response = {
        via: 'manual',
        version: null,
        submittedAt: quote.respondedAt,
        currency: quote.currency,
        productionLeadTimeDays: quote.productionLeadTimeDays,
        paymentTerms: quote.paymentTerms,
        validUntil: quote.validUntil ? dbDateToKey(quote.validUntil) : null,
        manufacturer: quote.manufacturer,
        notes: null,
        items: offerItems(quote.items),
      };
    }

    const view: IndentPortalView = {
      state,
      processRef: formatQuoteRef(quote.request.processNumber, quote.revision),
      revision: quote.revision,
      expiresAt: token.expiresAt,
      requestedBy: 'SQ Quimica',
      endCustomer: profile.showClient && client ? client.name : null,
      requestType: 'Indent',
      destination: token.destinationPort,
      incoterm: quote.incoterm,
      currency: quote.currency,
      message,
      manufacturerRequired: quote.supplier.type === 'TRADING',
      items: quote.items.map((item) => ({
        quoteItemId: item.id,
        name: item.requestItem.product?.name ?? item.requestItem.description,
        cas: item.requestItem.product?.cas ?? null,
        quantityKg: fixed(item.requestItem.quantityKg, 3),
      })),
      previousOffer,
      response,
      attachments,
      options: {
        packaging: INDENT_PORTAL_PACKAGING_OPTIONS,
        paymentTerms: INDENT_PORTAL_PAYMENT_OPTIONS,
        currencies: INDENT_PORTAL_CURRENCIES,
        maxFiles: INDENT_PORTAL_MAX_FILES,
        maxFileBytes: INDENT_PORTAL_MAX_FILE_BYTES,
      },
    };

    // Sentinela (so sem parceria): nenhum texto que SAI da SQ pode citar o cliente. Os textos digitados pelo proprio fornecedor no
    // portal (observacao, fabricante da resposta do portal, nomes de anexo) ficam de fora: nao ha o que vazar para quem os escreveu.
    if (!profile.hasPartnership && terms.length > 0) {
      const fields: Record<string, string | null> = {
        processRef: view.processRef,
        destination: view.destination,
        message: view.message,
        'previousOffer.manufacturer': view.previousOffer?.manufacturer ?? null,
        'previousOffer.paymentTerms': view.previousOffer?.paymentTerms ?? null,
        'response.paymentTerms': view.response?.paymentTerms ?? null,
        'response.manufacturer': view.response?.via === 'manual' ? view.response.manufacturer : null,
      };
      view.items.forEach((item, index) => {
        fields[`items[${index}].name`] = item.name;
        fields[`items[${index}].cas`] = item.cas;
      });

      const leak = findClientLeak(fields, terms);

      if (leak) {
        logger.error({ quoteId: quote.id, field: leak }, 'Sentinela do portal Indent barrou a view: o conteudo identifica o cliente.');
        throw new HttpError(500, 'Erro interno ao montar a cotação.');
      }
    }

    await IndentPortalService.logAccess(token.id, 'VIEW', null, meta);
    try {
      await prisma.indentPortalToken.update({
        where: { id: token.id },
        data: { firstSeenAt: token.firstSeenAt ?? now, lastSeenAt: now, accessCount: { increment: 1 } },
      });
    } catch (error) {
      logger.warn({ tokenId: token.id, failure: error instanceof Error ? error.message : String(error) }, 'Falha ao atualizar o acesso do token do portal Indent.');
    }

    return view;
  }

  // Resposta do fornecedor. Cada resposta DIFERENTE vira nova versao; resposta identica e idempotente (200 unchanged, sem versao nem aviso).
  // O portal NUNCA grava ACEITA: so RESPONDIDA, e a solicitacao so sai de COTACAO (ator null no AuditLog).
  static async submit(
    token: ResolvedIndentToken,
    input: IndentPortalRespondInput,
    meta: IndentPortalMeta,
    now: Date = new Date(),
  ): Promise<IndentPortalSubmitResult> {
    return prisma.$transaction(async (tx): Promise<IndentPortalSubmitResult> => {
      const { quote, accepted } = await lockIndentQuote(tx, token.quoteId);
      await IndentPortalService.assertTokenStillOpen(tx, token.id, quote, now);

      const quoteItemIds = new Set(quote.items.map((item) => item.id));

      if (input.items.length !== quoteItemIds.size || input.items.some((item) => !quoteItemIds.has(item.quoteItemId))) {
        throw new PortalHttpError(400, 'Please fill in every item.', 'items');
      }

      const today = todayKeyInSaoPaulo(now);

      if (input.validUntil < today || input.validUntil > addDaysToKey(today, 365)) {
        throw new PortalHttpError(400, 'The validity must be between today and 365 days from today.', 'validUntil');
      }
      if (quote.supplier.type === 'TRADING' && !input.manufacturer) {
        throw new PortalHttpError(400, 'Please inform the manufacturer.', 'manufacturer');
      }

      const next = normalizeInput(input);
      const existing = await tx.indentPortalResponse.findUnique({
        where: { quoteId: quote.id },
        select: {
          id: true,
          version: true,
          submittedAt: true,
          currency: true,
          productionLeadTimeDays: true,
          paymentTerms: true,
          validUntil: true,
          manufacturer: true,
          notes: true,
          items: { select: { quoteItemId: true, packaging: true, fobPricePerKg: true, cfrPricePerKg: true } },
        },
      });
      const previous = existing ? normalizeStored(existing) : null;

      if (existing && previous && sameContent(previous, next)) {
        return {
          status: 200,
          body: { version: existing.version, submittedAt: existing.submittedAt, revised: existing.version > 1, unchanged: true },
          notify: null,
        };
      }

      const version = existing ? existing.version + 1 : 1;
      const data = {
        lastTokenId: token.id,
        currency: next.currency,
        productionLeadTimeDays: next.productionLeadTimeDays,
        paymentTerms: next.paymentTerms,
        validUntil: dateKeyToDbDate(next.validUntil),
        manufacturer: next.manufacturer,
        notes: next.notes,
        version,
        submittedAt: now,
        submitterIp: clip(meta.ip),
        submitterUserAgent: clip(meta.userAgent),
      };
      let responseId: number;

      if (existing) {
        await tx.indentPortalResponseRevision.create({
          data: {
            responseId: existing.id,
            version: existing.version,
            snapshot: previous as unknown as Prisma.InputJsonValue, // o submittedAt da versao fica na coluna propria
            submittedAt: existing.submittedAt,
          },
        });
        await tx.indentPortalResponse.update({ where: { id: existing.id }, data });
        await tx.indentPortalResponseItem.deleteMany({ where: { responseId: existing.id } });
        responseId = existing.id;
      } else {
        responseId = (await tx.indentPortalResponse.create({ data: { quoteId: quote.id, ...data }, select: { id: true } })).id;
      }

      await tx.indentPortalResponseItem.createMany({
        data: next.items.map((item) => ({
          responseId,
          quoteItemId: item.quoteItemId,
          packaging: item.packaging,
          fobPricePerKg: decimal(item.fobPricePerKg),
          cfrPricePerKg: decimal(item.cfrPricePerKg),
        })),
      });

      // Copia para a cotacao (a mesma que o registro manual preenche) e marca RESPONDIDA. Nunca ACEITA.
      for (const item of next.items) {
        await tx.indentQuoteItem.update({
          where: { id: item.quoteItemId },
          data: { packaging: item.packaging, fobPricePerKg: decimal(item.fobPricePerKg), cfrPricePerKg: decimal(item.cfrPricePerKg) },
        });
      }
      await tx.indentQuote.update({
        where: { id: quote.id },
        data: {
          status: 'RESPONDIDA',
          respondedAt: now,
          currency: next.currency,
          validUntil: dateKeyToDbDate(next.validUntil),
          productionLeadTimeDays: next.productionLeadTimeDays,
          paymentTerms: next.paymentTerms,
          manufacturer: next.manufacturer,
          notes: next.notes,
        },
      });
      await applyRequestStatusAfterResponse(tx, quote.request, null, now);

      const afterAcceptance = accepted !== null;
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: quote.id,
          action: version === 1 ? 'indent_quote.portal_submit' : 'indent_quote.portal_revise',
          performedById: null,
          beforeData: previous ?? { status: quote.status },
          afterData: { status: 'RESPONDIDA', ...next },
          metadata: {
            via: 'portal',
            ref: formatQuoteRef(quote.request.processNumber, quote.revision),
            version,
            afterAcceptance,
            tokenId: token.id,
          },
        },
        tx,
      );

      return {
        status: 201,
        body: { version, submittedAt: now, revised: version > 1, unchanged: false },
        notify: { quoteId: quote.id, version, afterAcceptance },
      };
    }, TX_OPTIONS);
  }

  // Anexo do fornecedor: ate 5 x 10 MB, `%PDF-`, sem repeticao (sha256). O corpo so chega aqui depois do token valido.
  static async addAttachment(
    token: ResolvedIndentToken,
    file: { fileName: string; buffer: Buffer },
    meta: IndentPortalMeta,
    now: Date = new Date(),
  ): Promise<{ status: 200 | 201; body: { id: number; fileName: string; fileSize: number } }> {
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const fileName = sanitizeFileName(file.fileName);
    const shape = (row: { id: number; fileName: string; fileSize: number }) => ({ id: row.id, fileName: row.fileName, fileSize: row.fileSize });

    try {
      const result = await prisma.$transaction(async (tx) => {
        const { quote } = await lockIndentQuote(tx, token.quoteId);
        await IndentPortalService.assertTokenStillOpen(tx, token.id, quote, now);

        if (file.buffer.length < 5 || file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
          throw new PortalHttpError(400, INDENT_PORTAL_NOT_PDF_MESSAGE, 'NOT_PDF');
        }
        if (file.buffer.length > INDENT_PORTAL_MAX_FILE_BYTES) {
          throw new PortalHttpError(413, INDENT_PORTAL_FILE_TOO_LARGE_MESSAGE, 'FILE_TOO_LARGE');
        }

        const same = await tx.indentPortalAttachment.findFirst({
          where: { quoteId: quote.id, sha256 },
          select: { id: true, fileName: true, fileSize: true },
        });

        if (same) {
          return { status: 200 as const, body: shape(same) };
        }
        if ((await tx.indentPortalAttachment.count({ where: { quoteId: quote.id } })) >= INDENT_PORTAL_MAX_FILES) {
          throw new PortalHttpError(409, INDENT_PORTAL_TOO_MANY_FILES_MESSAGE, 'TOO_MANY_FILES');
        }

        const created = await tx.indentPortalAttachment.create({
          data: { quoteId: quote.id, tokenId: token.id, fileName, mimeType: 'application/pdf', fileSize: file.buffer.length, sha256 },
          select: { id: true, fileName: true, fileSize: true },
        });
        await tx.indentPortalAttachmentFile.create({ data: { attachmentId: created.id, data: new Uint8Array(file.buffer) } });
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: quote.id,
            action: 'indent_quote.portal_attachment_added',
            performedById: null,
            afterData: { attachmentId: created.id, fileName, fileSize: file.buffer.length, sha256 },
            metadata: { via: 'portal', tokenId: token.id },
          },
          tx,
        );

        return { status: 201 as const, body: shape(created) };
      }, TX_OPTIONS);

      await IndentPortalService.logAccess(token.id, 'UPLOAD', null, meta);
      return result;
    } catch (error) {
      // Corrida no mesmo arquivo (unique quoteId + sha256): devolve o que ja existe.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.indentPortalAttachment.findFirst({
          where: { quoteId: token.quoteId, sha256 },
          select: { id: true, fileName: true, fileSize: true },
        });

        if (existing) {
          return { status: 200, body: shape(existing) };
        }
      }
      throw error;
    }
  }

  // Download interno (equipe COMEX): o anexo precisa ser DESTA cotacao.
  static async getAttachmentForDownload(quoteId: number, attachmentId: number): Promise<{ fileName: string; mimeType: string; data: Buffer }> {
    const attachment = await prisma.indentPortalAttachment.findFirst({
      where: { id: attachmentId, quoteId },
      select: { fileName: true, mimeType: true, file: { select: { data: true } } },
    });

    if (!attachment || !attachment.file) {
      throw new HttpError(404, 'Anexo não encontrado.');
    }

    return { fileName: attachment.fileName, mimeType: attachment.mimeType, data: Buffer.from(attachment.file.data) };
  }

  // Revalida DENTRO da trava: o link pode ter vencido/sido revogado e a cotacao pode ter mudado entre o GET e o POST.
  private static async assertTokenStillOpen(
    tx: Prisma.TransactionClient,
    tokenId: number,
    quote: { status: string; request: { status: string } },
    now: Date,
  ): Promise<void> {
    const token = await tx.indentPortalToken.findUnique({ where: { id: tokenId }, select: { revokedAt: true, expiresAt: true } });

    if (!token || token.revokedAt) {
      throw new PortalHttpError(410, INDENT_PORTAL_CLOSED_MESSAGE, 'LINK_CLOSED');
    }
    if (token.expiresAt <= now) {
      throw new PortalHttpError(410, INDENT_PORTAL_EXPIRED_MESSAGE, 'LINK_EXPIRED');
    }
    if (!OPEN_STATUSES.includes(quote.status) || quote.request.status === 'PERDIDA') {
      throw new PortalHttpError(410, INDENT_PORTAL_CLOSED_MESSAGE, 'LINK_CLOSED');
    }
  }
}
