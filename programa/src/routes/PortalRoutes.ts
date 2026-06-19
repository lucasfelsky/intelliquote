import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { SupplierPortalService } from '../services/SupplierPortalService';
import { SupplierPortalResponseService } from '../services/SupplierPortalResponseService';
import { ExchangeRateService } from '../services/ExchangeRateService';
import { supplierPortalResponseSubmitSchema } from '../validators/supplierPortal';
import { handleControllerError, HttpError, parseId } from '../utils/http';
import { prisma } from '../lib/prisma';

const portalRoutes = Router();

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
      message: 'Muitas tentativas em pouco tempo. Aguarde um instante antes de tentar novamente.',
    });
  },
});

function getTokenFromRequest(req: Request): string {
  const raw = req.params.token;
  if (typeof raw !== 'string' || raw.length < 16) {
    throw new HttpError(404, 'Link invalido ou expirado.');
  }
  return raw;
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
        },
      },
      supplier: true,
      supplierContact: true,
    },
  });
  if (!token) {
    throw new HttpError(404, 'Link invalido ou expirado.');
  }

  const response = await SupplierPortalResponseService.getByTokenId(token.id);

  return {
    quoteRequest: {
      id: token.quoteRequest.id,
      requestCode: token.quoteRequest.requestCode,
      productName: token.quoteRequest.productName,
      description: token.quoteRequest.description,
      desiredIncoterm: token.quoteRequest.desiredIncoterm,
      currency: token.quoteRequest.currency,
      deadlineAt: token.quoteRequest.deadlineAt,
      items: token.quoteRequest.items.map((item) => ({
        id: item.id,
        itemCode: item.itemCode,
        productName: item.catalogItem?.marketName ?? item.productName,
        commercialName: item.productName,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
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
          })),
        }
      : null,
  };
}

portalRoutes.get('/api/portal/:token', portalRateLimiter, async (req, res) => {
  try {
    const key = getClientKey(req);
    if (isLocked(key)) {
      res.status(429).json({
        message:
          'Acesso temporariamente bloqueado apos multiplas tentativas invalidas. Tente novamente em alguns minutos.',
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

    if (validated.alreadyResponded) {
      // Tokens that already responded are still readable so the supplier can review
      // what they sent; we don't increment the access counter for them.
      const view = await buildPortalView(validated.token.id);
      res.status(200).json({ ...view, readOnly: true });
      return;
    }

    const view = await buildPortalView(validated.token.id);
    res.status(200).json({ ...view, readOnly: false });
  } catch (error) {
  if (error instanceof HttpError) {
    const key = getClientKey(req);
    if (error.status === 404) {
      registerInvalidAttempt(key);
    }
    res.status(error.status).json({ message: error.message });
    return;
  }
  const handled = handleControllerError(error);
  res.status(handled.status).json({ message: handled.message });
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
      res.status(error.status).json({ message: error.message });
      return;
    }
    const handled = handleControllerError(error);
    res.status(handled.status).json({ message: handled.message });
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

    if (validated.alreadyResponded) {
      res.status(409).json({
        message:
          'Esta resposta ja foi enviada. Para altera-la, solicite um novo link ao comprador.',
      });
      return;
    }

    const parsed = supplierPortalResponseSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Os dados enviados sao invalidos.' });
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

    res.status(201).json({
      id: response.id,
      submittedAt: response.submittedAt,
      totalPrice: response.totalPrice.toString(),
      currency: response.currency,
      quoteResponseId: result.quoteResponse?.id ?? null,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    const handled = handleControllerError(error);
    res.status(handled.status).json({ message: handled.message });
  }
});

// helper endpoint para checagem de saude do servico publico (sem tocar no token)
portalRoutes.get('/api/portal/_meta', (_req, res) => {
  res.status(200).json({ ok: true, service: 'supplier-portal' });
});

export { portalRoutes };
