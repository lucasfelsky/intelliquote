import { Router } from 'express';
import {
  CREDIT_PORTAL_QUOTE_CLOSED_MESSAGE,
  CreditPortalService,
} from '../services/CreditPortalService';
import { creditPortalSubmitSchema } from '../validators/supplierPortal';
import { handleControllerError, HttpError } from '../utils/http';
import { PortalHttpError } from '../utils/portalHttpError';
import { hashToken } from '../utils/tokens';
import {
  PORTAL_INVALID_PAYLOAD_MESSAGE,
  getClientKey,
  getRequestMeta,
  getTokenFromRequest,
  isLocked,
  portalErrorBody,
  portalFallbackMessage,
  portalRateLimiter,
  registerInvalidAttempt,
} from './PortalRoutes';

// Rotas publicas do portal do parceiro de credito (PR2b). Rate limit (10/min) e
// lockout (5 invalidas/15 min) sao a MESMA instancia/Map do portal do fornecedor,
// importados de PortalRoutes. Sem /api/v1: rota publica, sem sessao.
const creditPortalRoutes = Router();

creditPortalRoutes.get('/api/credit-portal/:token', portalRateLimiter, async (req, res) => {
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
    const record = await CreditPortalService.validate({
      rawToken,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // Conta a visualizacao mesmo apos resposta: a revisao e permitida ate expirar.
    await CreditPortalService.recordView(record, meta);
    const view = await CreditPortalService.buildPartnerView(record.id);
    res.status(200).json(view);
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

creditPortalRoutes.post('/api/credit-portal/:token/respond', portalRateLimiter, async (req, res) => {
  try {
    const rawToken = getTokenFromRequest(req);
    const meta = getRequestMeta(req);
    const record = await CreditPortalService.validate({
      rawToken,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (record.quoteRequest.status === 'closed') {
      throw new PortalHttpError(409, CREDIT_PORTAL_QUOTE_CLOSED_MESSAGE, 'QUOTE_CLOSED');
    }

    const parsed = creditPortalSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: PORTAL_INVALID_PAYLOAD_MESSAGE });
      return;
    }

    const result = await CreditPortalService.submit({
      requestId: record.id,
      quoteRequestId: record.quoteRequestId,
      rawTokenHash: hashToken(rawToken),
      payload: parsed.data,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // Depois do commit: log SUBMIT (sem token). A resposta ja foi gravada, entao
    // falha no log nao pode devolver erro ao parceiro.
    await CreditPortalService.logAccess({
      creditSupportRequestId: record.id,
      kind: 'SUBMIT',
      ip: meta.ip,
      userAgent: meta.userAgent,
    }).catch(() => undefined);

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json(portalErrorBody(error));
      return;
    }
    const handled = handleControllerError(error);
    res.status(handled.status).json({ message: portalFallbackMessage(handled.status) });
  }
});

export { creditPortalRoutes };
