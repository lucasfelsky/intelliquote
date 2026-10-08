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
export const PORTAL_INVALID_LINK_MESSAGE =
  'This link is invalid or has expired. Please contact your buyer to request a new one.';
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
  // F5: o token de lembrete preserva o deadline ORIGINAL (nao estende o
  // prazo) e ja nasce com reminderSentAt pra nunca gerar novo lembrete.
  expiresAt?: Date;
  reminderSentAt?: Date | null;
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
        expiresAt: input.expiresAt ?? expiresAt,
        createdById: input.createdById,
        dispatchEventId: input.dispatchEventId ?? null,
        reminderSentAt: input.reminderSentAt ?? null,
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

  /**
   * Revoga o token informado (e qualquer outro ativo do mesmo contato/cotacao)
   * e cria um novo, tudo na mesma transacao. O raw token so existe no retorno.
   * 404 se token/cotacao nao existem; 409 se o token ja foi respondido
   * (o novo token nao carrega a resposta e geraria proposta duplicada).
   */
  static async regenerateToken(input: {
    tokenId: number;
    createdById: number;
    ttlDays?: number;
    client?: Prisma.TransactionClient;
  }): Promise<{
    previous: SupplierPortalToken;
    created: SupplierPortalToken;
    rawToken: string;
    revokedCount: number;
  }> {
    const run = async (tx: Prisma.TransactionClient) => {
      const previous = await tx.supplierPortalToken.findUnique({ where: { id: input.tokenId } });
      if (!previous) {
        throw new HttpError(404, 'Token nao encontrado.');
      }
      const quoteRequest = await tx.quoteRequest.findFirst({
        where: { id: previous.quoteRequestId, deletedAt: null },
        select: { id: true },
      });
      if (!quoteRequest) {
        throw new HttpError(404, 'Cotacao nao encontrada.');
      }
      if (previous.respondedAt) {
        throw new HttpError(
          409,
          'Este fornecedor ja respondeu por este link. Nao e possivel gerar novo link.',
        );
      }
      const revokedCount = await this.revokeTokensForContact({
        quoteRequestId: previous.quoteRequestId,
        supplierContactId: previous.supplierContactId,
        client: tx,
      });
      const createdWithRaw = (await this.createToken({
        quoteRequestId: previous.quoteRequestId,
        supplierId: previous.supplierId,
        supplierContactId: previous.supplierContactId,
        createdById: input.createdById,
        ttlDays: input.ttlDays,
        dispatchEventId: previous.dispatchEventId,
        client: tx,
      })) as SupplierPortalToken & { rawToken: string };
      const { rawToken, ...created } = createdWithRaw;
      return { previous, created: created as SupplierPortalToken, rawToken, revokedCount };
    };
    if (input.client) return run(input.client);
    return defaultPrisma.$transaction(run);
  }

  static async validate(input: ValidateTokenInput): Promise<ValidatedToken> {
    const client = getClient(input.client);
    const tokenHash = hashToken(input.rawToken);

    const token = await client.supplierPortalToken.findUnique({
      where: { tokenHash },
    });

    if (!token) {
      await this.logAccess({
        tokenId: null,
        kind: 'INVALID',
        ip: input.ip,
        userAgent: input.userAgent,
        meta: { reason: 'not_found' },
        client,
      }).catch(() => undefined);
      throw new HttpError(404, PORTAL_INVALID_LINK_MESSAGE);
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
      throw new HttpError(404, PORTAL_INVALID_LINK_MESSAGE);
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
      throw new HttpError(404, PORTAL_INVALID_LINK_MESSAGE);
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
    tokenId: number | null;
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
