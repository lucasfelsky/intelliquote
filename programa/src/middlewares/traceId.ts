import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { traceStorage } from '../lib/traceContext';

const HEADER = 'x-request-id';
const MAX_LEN = 128;

/**
 * Generates (or accepts) a request id and binds it to an AsyncLocalStorage
 * scope so `logger.*` can pick it up via `getCurrentTraceId()`.
 *
 * - Reuses the inbound `X-Request-Id` header if present (max 128 chars,
 *   sanitized to alnum/-/_) — useful for cross-service tracing when the
 *   Portal COMEX forwards a request.
 * - Otherwise mints a UUID v4.
 * - Echoes the id back in the response header so clients can correlate.
 *
 * Resolve L6: "Logs não correlacionados com HTTP request" ([[Limitações conhecidas]]).
 */
export function traceIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(HEADER);
  const traceId = sanitize(inbound) ?? randomUUID();
  res.setHeader(HEADER, traceId);
  traceStorage.run({ traceId }, () => next());
}

function sanitize(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().slice(0, MAX_LEN);
  if (trimmed.length === 0) return undefined;
  // Aceita apenas caracteres seguros em headers HTTP/IDs de correlação.
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return undefined;
  return trimmed;
}
