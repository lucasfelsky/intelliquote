import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { ZodError } from 'zod';

const INCOTERMS = [
  'EXW',
  'FCA',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
] as const;

export function parseId(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export interface PaginationOptions {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export function hasListQuery(req: Request): boolean {
  return Object.keys(req.query).length > 0;
}

export function parsePagination(req: Request): PaginationOptions {
  const page = parsePositiveIntegerQuery(req.query.page, 1);
  const pageSize = Math.min(parsePositiveIntegerQuery(req.query.pageSize, 20), 100);

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

export function buildPaginatedResponse<T>(
  data: T[],
  totalItems: number,
  options: PaginationOptions,
): PaginatedResponse<T> {
  return {
    data,
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / options.pageSize)),
    },
  };
}

export function parseOptionalQueryString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseOptionalQueryId(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function isValidIncoterm(value: string): boolean {
  return INCOTERMS.includes(value as (typeof INCOTERMS)[number]);
}

export function handleControllerError(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      message: error.message,
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      message: error.issues[0]?.message ?? 'Os dados enviados sao invalidos.',
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = Array.isArray((error.meta as { target?: unknown })?.target)
        ? ((error.meta as { target: string[] }).target as string[]).join(', ')
        : typeof (error.meta as { target?: unknown })?.target === 'string'
          ? ((error.meta as { target: string }).target as string)
          : 'desconhecido';
      // eslint-disable-next-line no-console
      console.error('[Prisma P2002]', {
        model: (error.meta as { modelName?: string })?.modelName,
        target,
        code: error.code,
        message: error.message,
      });
      return {
        status: 409,
        message: `Ja existe um registro com esses dados unicos (${target}).`,
      };
    }

    if (error.code === 'P2025') {
      return {
        status: 404,
        message: 'Registro nao encontrado.',
      };
    }

    if (error.code === 'P2003') {
      return {
        status: 400,
        message: 'Ha relacionamento invalido entre os dados enviados.',
      };
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: 503,
      message:
        'Base de dados indisponivel. Verifique DATABASE_URL, TLS/SSL e disponibilidade do Postgres.',
    };
  }

  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return {
      status: 503,
      message:
        'Falha critica ao comunicar com a base de dados. Reinicie a API e valide a configuracao de conexao.',
    };
  }

  return {
    status: 500,
    message: 'Erro interno do servidor.',
  };
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isPositiveNumber(value: unknown): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function isNonNegativeNumber(value: unknown): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value.trim());
}

function parsePositiveIntegerQuery(value: unknown, fallback: number): number {
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
