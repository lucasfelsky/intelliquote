import { createHash, randomBytes } from 'crypto';
import {
  Prisma,
  type PrismaClient,
  type SupplierPortalToken,
  type SupplierPortalTokenLog,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { hashToken } from '../utils/tokens';

export const DEFAULT_TOKEN_TTL_DAYS = 14;
export const TOKEN_RANDOM_BYTES = 32;

export interface TokenGeneration {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface CreateTokenInput {
  quoteRequestId: number;
  supplierId: number;
  supplierContactId: number;
  createdById: number;
  dispatchEventId?: number | null;
  ttlDays?: number;
  client?: PrismaClient | Prisma.TransactionClient;
}

export interface ValidateTokenInput {
  rawToken: string;
  ip?: string | null;
  userAgent?: string | null;
  client?: PrismaClient | Prisma.TransactionClient;
}

export interface ValidatedToken {
  token: SupplierPortalToken;
  alreadyResponded: boolean;
}

export function generateToken(ttlDays: number = DEFAULT_TOKEN_TTL_DAYS): TokenGeneration {
  const rawToken = randomBytes(TOKEN_RANDOM_BYTES).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  return { rawToken, tokenHash, expiresAt };
}

function getClient(
  client?: PrismaClient | Prisma.TransactionClient,
): PrismaClient | Prisma.TransactionClient {
  return client ?? defaultPrisma;
}

export class SupplierPortalService {
  static async createToken(input: CreateTokenInput): Promise<SupplierPortalToken> {
    const client = getClient(input.client);
    const { rawToken, tokenHash, expiresAt } = generateToken(input.ttlDays);

    const created = await client.supplierPortalToken.create({
      data: {
        quoteRequestId: input.quoteRequestId,
        supplierId: input.supplierId,
        supplierContactId: input.supplierContactId,
        tokenHash,
        expiresAt,
        createdById: input.createdById,
        dispatchEventId: input.dispatchEventId ?? null,
      },
    });

    return { ...created, rawToken } as SupplierPortalToken & { rawToken: string };
  }

  static async revokeTokensForContact(input: {
    quoteRequestId: number;
    supplierContactId: number;
    client?: PrismaClient | Prisma.TransactionClient;
  }): Promise<number> {
    const client = getClient(input.client);
    const result = await client.supplierPortalToken.updateMany({
      where: {
        quoteRequestId: input.quoteRequestId,
        supplierContactId: input.supplierContactId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  static async validate(input: ValidateTokenInput): Promise<ValidatedToken> {
    const client = getClient(input.client);
    const tokenHash = hashToken(input.rawToken);

    const token = await client.supplierPortalToken.findUnique({
      where: { tokenHash },
    });

    if (!token) {
      await this.logAccess({
        tokenId: 0,
        kind: 'INVALID',
        ip: input.ip,
        userAgent: input.userAgent,
        meta: { reason: 'not_found' },
        client,
      }).catch(() => undefined);
      throw new HttpError(404, 'Link invalido ou expirado.');
    }

    if (token.revokedAt) {
      await this.logAccess({
        tokenId: token.id,
        kind: 'INVALID',
        ip: input.ip,
        userAgent: input.userAgent,
        meta: { reason: 'revoked' },
        client,
      });
      throw new HttpError(404, 'Link invalido ou expirado.');
    }

    if (token.expiresAt.getTime() <= Date.now()) {
      await this.logAccess({
        tokenId: token.id,
        kind: 'INVALID',
        ip: input.ip,
        userAgent: input.userAgent,
        meta: { reason: 'expired' },
        client,
      });
      throw new HttpError(404, 'Link invalido ou expirado.');
    }

    if (token.respondedAt) {
      return { token, alreadyResponded: true };
    }

    const now = new Date();
    const updated = await client.supplierPortalToken.update({
      where: { id: token.id },
      data: {
        accessCount: { increment: 1 },
        firstSeenAt: token.firstSeenAt ?? now,
        lastSeenAt: now,
      },
    });

    await this.logAccess({
      tokenId: updated.id,
      kind: 'VIEW',
      ip: input.ip,
      userAgent: input.userAgent,
      client,
    });

    return { token: updated, alreadyResponded: false };
  }

  static async logAccess(input: {
    tokenId: number;
    kind: 'VIEW' | 'SUBMIT' | 'INVALID';
    ip?: string | null;
    userAgent?: string | null;
    meta?: Prisma.InputJsonValue;
    client?: PrismaClient | Prisma.TransactionClient;
  }): Promise<SupplierPortalTokenLog> {
    const client = getClient(input.client);
    return client.supplierPortalTokenLog.create({
      data: {
        tokenId: input.tokenId,
        kind: input.kind,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        meta: input.meta ?? Prisma.JsonNull,
      },
    });
  }

  static async findActiveToken(input: {
    quoteRequestId: number;
    supplierContactId: number;
    client?: PrismaClient | Prisma.TransactionClient;
  }): Promise<SupplierPortalToken | null> {
    const client = getClient(input.client);
    return client.supplierPortalToken.findFirst({
      where: {
        quoteRequestId: input.quoteRequestId,
        supplierContactId: input.supplierContactId,
        revokedAt: null,
        respondedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
