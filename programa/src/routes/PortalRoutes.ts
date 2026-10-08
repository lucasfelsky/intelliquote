import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { PORTAL_INVALID_LINK_MESSAGE, SupplierPortalService } from '../services/SupplierPortalService';
import { SupplierPortalResponseService } from '../services/SupplierPortalResponseService';
import { SupplierResponseNotificationService } from '../services/SupplierResponseNotificationService';
import { ExchangeRateService } from '../services/ExchangeRateService';
import { supplierPortalResponseSubmitSchema } from '../validators/supplierPortal';
import { handleControllerError, HttpError, parseId } from '../utils/http';
import { PortalHttpError } from '../utils/portalHttpError';
import { formatIncoterms } from '../utils/incoterm';
import { prisma } from '../lib/prisma';

const portalRoutes = Router();

const PORTAL_INVALID_PAYLOAD_MESSAGE =
  'The submitted data is invalid. Please review the form and try again.';

interface PortalAttemptBucket {
  invalidCount: number;
  firstInvalidAt: number;
  lockedUntil: number;
}

const attemptBuckets = new Map<string, PortalAttemptBucket>();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 5;

function getClientKey(req: Request): string {
  const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  const ua = req.headers['user-agent'] ?? 'unknown';
  return `${ip}::${String(ua).slice(0, 64)}`;
}

function registerInvalidAttempt(key: string): void {
  const now = Date.now();
  const existing = attemptBuckets.get(key);
  if (!existing || now - existing.firstInvalidAt > ATTEMPT_WINDOW_MS) {
    attemptBuckets.set(key, { invalidCount: 1, firstInvalidAt: now, lockedUntil: 0 });
    return;
  }
  existing.invalidCount += 1;
  if (existing.invalidCount >= ATTEMPT_LIMIT) {
    existing.lockedUntil = now + ATTEMPT_WINDOW_MS;
  }
}

function isLocked(key: string): boolean {
  const bucket = attemptBuckets.get(key);
  if (!bucket) return false;
  if (bucket.lockedUntil && bucket.lockedUntil > Date.now()) {
    return true;
  }
  if (bucket.lockedUntil && bucket.lockedUntil <= Date.now()) {
    attemptBuckets.delete(key);
  }
  return false;
}

const portalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => getClientKey(req),
  handler: (req, res) => {
    res.status(429).json({
      message: 'Too many requests in a short time. Please wait a moment and try again.',
    });
  },
});

function getTokenFromRequest(req: Request): string {
  const raw = req.params.token;
  if (typeof raw !== 'string' || raw.length < 16) {
    throw new PortalHttpError(404, PORTAL_INVALID_LINK_MESSAGE);
  }
  return raw;
}

// Mensagens ao fornecedor para erros nao-HttpError: mantem o status de
// handleControllerError (compartilhado com o comprador) e troca so o texto.
function portalFallbackMessage(status: number): string {
  switch (status) {
    case 400:
      return PORTAL_INVALID_PAYLOAD_MESSAGE;
    case 404:
      return PORTAL_INVALID_LINK_MESSAGE;
    case 409:
      return 'Your proposal could not be saved due to a conflict. Please reload the page and try again.';
    case 503:
      return 'The service is temporarily unavailable. Please try again in a few minutes.';
    default:
      return 'Something went wrong on our side. Please try again in a few minutes.';
  }
}

// Mensagens conhecidas (em portugues) de codigo compartilhado com o comprador
// que podem chegar ao fornecedor: traduzidas aqui, so nas rotas do portal.
const PORTAL_KNOWN_MESSAGES: Record<string, string> = {
  'A proposta contem itens duplicados ou precos/quantidades invalidos.':
    'The proposal contains duplicated items or invalid prices/quantities.',
};

// Corpo de resposta para um HttpError nas rotas do portal. So PortalHttpError
// (mensagem ja em ingles) repassa message/code; o resto e traduzido pelo mapa
// de mensagens conhecidas ou, se desconhecido, por status. Status sempre preservado.
function portalErrorBody(error: HttpError): { message: string; code?: string } {
  if (error instanceof PortalHttpError) {
    return { message: error.message, ...(error.code ? { code: error.code } : {}) };
  }
  return { message: PORTAL_KNOWN_MESSAGES[error.message] ?? portalFallbackMessage(error.status) };
}

function getRequestMeta(req: Request) {
  return {
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

async function buildPortalView(tokenId: number) {
  const token = await prisma.supplierPortalToken.findUnique({
    where: { id: tokenId },
    include: {
      quoteRequest: {
        include: {
          items: {
            include: { catalogItem: true },
            orderBy: { createdAt: 'asc' },
          },
          purchaseOrders: {
            select: { id: true, label: true, position: true },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
          },
        },
      },
      supplier: true,
      supplierContact: true,
    },
  });
  if (!token) {
    throw new PortalHttpError(404, PORTAL_INVALID_LINK_MESSAGE);
  }

  const response = await SupplierPortalResponseService.getByTokenId(token.id);
  const revisions = await SupplierPortalResponseService.getHistoryByTokenId(token.id);

  return {
    quoteRequest: {
      id: token.quoteRequest.id,
      requestCode: token.quoteRequest.requestCode,
      productName: token.quoteRequest.productName,
      description: token.quoteRequest.description?.trim()
        ? token.quoteRequest.description.trim()
        : null,
      desiredIncoterm: token.quoteRequest.desiredIncoterm,
        destinationPort: token.quoteRequest.destinationPort,
        originPort: token.quoteRequest.originPort ?? 'Shanghai',
        currency: token.quoteRequest.currency,
        deadlineAt: token.quoteRequest.deadlineAt,
        purchaseOrders: [...(token.quoteRequest.purchaseOrders ?? [])]
          .sort((a, b) => a.position - b.position || a.id - b.id)
          .map((po) => ({ id: po.id, label: po.label, position: po.position })),
        items: token.quoteRequest.items.map((item) => ({
                  id: item.id,
                  purchaseOrderId: item.purchaseOrderId ?? null,
                  itemCode: item.itemCode,
                  productName: item.catalogItem?.marketName ?? item.productName,
                  description: item.description,
                  quantity: item.quantity,
                  unit: item.unit,
                  desiredIncoterm: item.desiredIncoterm ?? formatIncoterms(token.quoteRequest.desiredIncoterm),
                  destinationPort: item.destinationPort ?? token.quoteRequest.destinationPort,
                  originPort: token.quoteRequest.originPort ?? 'Shanghai',
                  notes: item.notes,
                  isDangerousGood: item.catalogItem?.isDangerousGood ?? false,
                })),
      },
    supplier: {
      id: token.supplier.id,
      name: token.supplier.name,
      paymentTermsDays: token.supplier.paymentTermsDays ?? 30,
    },
    contact: {
      id: token.supplierContact.id,
      name: token.supplierContact.name,
      email: token.supplierContact.email,
    },
    expiresAt: token.expiresAt,
    alreadyResponded: token.respondedAt !== null,
    respondedAt: token.respondedAt,
    suggestedExchangeRate: await ExchangeRateService.getRateToBrl(
      token.quoteRequest.currency,
    ),
    response: response
      ? {
          id: response.id,
          version: response.version,
          currency: response.currency,
          incoterm: response.incoterm,
          paymentTermsDays: response.paymentTermsDays,
          totalPrice: response.totalPrice.toString(),
          totalPriceCurrency: response.totalPriceCurrency,
          validityDays: response.validityDays,
          notes: response.notes,
          submittedAt: response.submittedAt,
          items: response.items.map((it) => ({
            quoteRequestItemId: it.quoteRequestItemId,
            unitPrice: it.unitPrice.toString(),
            quantity: it.quantity,
            totalPrice: it.totalPrice.toString(),
            leadTimeDays: it.leadTimeDays,
            notes: it.notes,
            incotermPrices: it.incotermPrices ?? null,
          })),
        }
      : null,
    // Versoes anteriores (revisoes) que o fornecedor ja enviou, apenas leitura.
    history: revisions.map((rev) => ({
      version: rev.version,
      currency: rev.currency,
      incoterm: rev.incoterm,
      paymentTermsDays: rev.paymentTermsDays,
      totalPrice: rev.totalPrice.toString(),
      totalPriceCurrency: rev.totalPriceCurrency,
      validityDays: rev.validityDays,
      notes: rev.notes,
      submittedAt: rev.submittedAt,
      supersededAt: rev.supersededAt,
      items: rev.items,
    })),
  };
}

// helper endpoint para checagem de saude do servico publico (sem tocar no token).
// Deve vir ANTES de GET /api/portal/:token para nao ser capturado pelo parametro.
portalRoutes.get('/api/portal/_meta', (_req, res) => {
  res.status(200).json({ ok: true, service: 'supplier-portal' });
});

portalRoutes.get('/api/portal/:token', portalRateLimiter, async (req, res) => {
  try {
    const key = getClientKey(req);
    if (isLocked(key)) {
      res.status(429).json({
        message:
          'Access temporarily blocked after several invalid attempts. Please try again in a few minutes.',
      });
      return;
    }

    const rawToken = getTokenFromRequest(req);
    const meta = getRequestMeta(req);
    const validated = await SupplierPortalService.validate({
      rawToken,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // Tokens que ja responderam continuam EDITAVEIS: o fornecedor pode revisar
    // o preco enquanto o link nao expira (a validacao de token ja barra links
    // expirados/revogados). Nao incrementamos o contador de acesso nesse caso.
    // O front usa `alreadyResponded` + `response` (versao atual) + `history`
    // (versoes anteriores) para montar o modo de revisao.
    const view = await buildPortalView(validated.token.id);
    res.status(200).json({ ...view, readOnly: false });
  } catch (error) {
  if (error instanceof HttpError) {
    const key = getClientKey(req);
    if (error.status === 404) {
      registerInvalidAttempt(key);
    }
    res.status(error.status).json(portalErrorBody(error));
    return;
  }
  const handled = handleControllerError(error);
  res.status(handled.status).json({ message: portalFallbackMessage(handled.status) });
  }
});

portalRoutes.get('/api/portal/:token/respond', portalRateLimiter, async (req, res) => {
  try {
    const rawToken = getTokenFromRequest(req);
    const validated = await SupplierPortalService.validate({
      rawToken,
      ip: getRequestMeta(req).ip,
      userAgent: getRequestMeta(req).userAgent,
    });

    const view = await buildPortalView(validated.token.id);
    res.status(200).json({ ...view, readOnly: true });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json(portalErrorBody(error));
      return;
    }
    const handled = handleControllerError(error);
    res.status(handled.status).json({ message: portalFallbackMessage(handled.status) });
  }
});

portalRoutes.post('/api/portal/:token/respond', portalRateLimiter, async (req, res) => {
  try {
    const rawToken = getTokenFromRequest(req);
    const validated = await SupplierPortalService.validate({
      rawToken,
      ip: getRequestMeta(req).ip,
      userAgent: getRequestMeta(req).userAgent,
    });

    // Reenvio permitido: se ja existe resposta, o submit vira uma revisao
    // (sobrescreve a atual e guarda a anterior no historico). Nao ha mais 409.
    const parsed = supplierPortalResponseSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: PORTAL_INVALID_PAYLOAD_MESSAGE });
      return;
    }

    const meta = getRequestMeta(req);
    const result = await SupplierPortalResponseService.submit({
      tokenId: validated.token.id,
      quoteRequestId: validated.token.quoteRequestId,
      supplierId: validated.token.supplierId,
      supplierContactId: validated.token.supplierContactId,
      payload: parsed.data,
      meta,
    });
    const response = result.portalResponse;

    await SupplierPortalService.logAccess({
      tokenId: validated.token.id,
      kind: 'SUBMIT',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // F1: avisa o comprador que disparou a cotação. O serviço nunca lança
    // (try/catch interno) — falha de SMTP não afeta o 201 do fornecedor.
    await SupplierResponseNotificationService.notifyBuyerOfSupplierResponse({
      tokenId: validated.token.id,
      totalPrice: response.totalPrice.toString(),
      currency: response.currency,
      itemsCount: parsed.data.items.length,
      version: response.version,
      revised: result.revised,
    });

    res.status(201).json({
      id: response.id,
      submittedAt: response.submittedAt,
      totalPrice: response.totalPrice.toString(),
      currency: response.currency,
      version: response.version,
      revised: result.revised,
      quoteResponseId: result.quoteResponse?.id ?? null,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json(portalErrorBody(error));
      return;
    }
    const handled = handleControllerError(error);
    res.status(handled.status).json({ message: portalFallbackMessage(handled.status) });
  }
});

export { portalRoutes };
