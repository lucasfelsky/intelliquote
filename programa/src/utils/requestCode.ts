import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { HttpError } from './http';

// Marcador do "tombstone": ao excluir (soft delete) uma cotacao, o codigo vira
// `<codigo>#del<id>` para liberar o codigo original (indice unico global).
// Minusculo de proposito: a API maiusculiza todo codigo digitado, entao nunca colide.
export const REQUEST_CODE_TOMBSTONE_MARKER = '#del';
export const REQUEST_CODE_ERROR_PATH = 'requestCode';

export function buildRequestCode(now = new Date()): string {
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomUUID().slice(0, 6).toUpperCase();

  return `QR-${datePart}-${suffix}`;
}

export function buildRequestCodeTombstone(code: string, id: number): string {
  const suffix = `${REQUEST_CODE_TOMBSTONE_MARKER}${id}`;
  return code.endsWith(suffix) ? code : `${code}${suffix}`;
}

export function isRequestCodeUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.some((entry) => typeof entry === 'string' && entry.includes('requestCode'));
  }

  return typeof target === 'string' && target.includes('requestCode');
}

export function requestCodeTakenError(code: string): HttpError {
  return new HttpError(
    409,
    `O código ${code} já está em uso por outra cotação.`,
    REQUEST_CODE_ERROR_PATH,
  );
}
