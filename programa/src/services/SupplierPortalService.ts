import { createHash, randomBytes } from 'crypto';
import {
  Prisma,
  type PrismaClient,
  type SupplierPortalToken,
  type SupplierPortalTokenLog,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { PortalHttpError } from '../utils/portalHttpError';
import { computeTokenExpiry, type TokenExpirySource } from '../utils/portalTokenExpiry';
import { hashToken } from '../utils/tokens';

export const DEFAULT_TOKEN_TTL_DAYS = 14;
export const PORTAL_INVALID_LINK_MESSAGE =
  'This link is invalid or has expired. Please contact your buyer to request a new one.';
export const TOKEN_RANDOM_BYTES = 32;
// Janela em torno do revokedAt dentro da qual um token com reminderSentAt e
// considerado sucessor emitido pelo lembrete diario (token novo e criado antes
// do envio; revogacao do antigo so apos o envio confirmado).
export const REMINDER_SUCCESSOR_TOLERANCE_MS = 10 * 60 * 1000;
// TTL cap 60 dias, 1 lembrete por dia util: 64 saltos cobre com folga e garante terminacao.
export const MAX_REMINDER_SUCCESSOR_HOPS = 64;

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
  // Lembrete diario: o token de lembrete preserva o deadline ORIGINAL (nao
  // estende o prazo) e nasce com reminderSentAt (informativo; nao impede
  // novos lembretes nos dias seguintes).
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
    expirySource: TokenExpirySource;
  }> {
    const run = async (tx: Prisma.TransactionClient) => {
      const previous = await tx.supplierPortalToken.findUnique({ where: { id: input.tokenId } });
      if (!previous) {
        throw new HttpError(404, 'Token nao encontrado.');
      }
      const quoteRequest = await tx.quoteRequest.findFirst({
        where: { id: previous.quoteRequestId, deletedAt: null },
        select: { id: true, deadlineAt: true },
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
      const expiry = computeTokenExpiry(quoteRequest, input.ttlDays ?? DEFAULT_TOKEN_TTL_DAYS);
      const createdWithRaw = (await this.createToken({
        quoteRequestId: previous.quoteRequestId,
        supplierId: previous.supplierId,
        supplierContactId: previous.supplierContactId,
        createdById: input.createdById,
        expiresAt: expiry.expiresAt,
        dispatchEventId: previous.dispatchEventId,
        client: tx,
      })) as SupplierPortalToken & { rawToken: string };
      const { rawToken, ...created } = createdWithRaw;
      return {
        previous,
        created: created as SupplierPortalToken,
        rawToken,
        revokedCount,
        expirySource: expiry.source,
      };
    };
    if (input.client) return run(input.client);
    return defaultPrisma.$transaction(run);
  }

  /**
   * Botao "Responder" (e-mail quote_reply): emite um token NOVO para o
   * destinatario do reply e migra a resposta do portal (e o historico de
   * revisoes) do token ativo anterior para o novo, revogando o anterior.
   * Diferente de regenerateToken, um token ja respondido NAO bloqueia: o
   * fornecedor abre o link novo com a proposta preenchida e pode revisar.
   * Validade = max(expiresAt do anterior, computeTokenExpiry(deadlineAt da
   * cotacao, DEFAULT_TOKEN_TTL_DAYS)): fim do dia BRT do prazo quando ele ainda
   * vale, senao agora + DEFAULT_TOKEN_TTL_DAYS.
   * O raw token so' existe no retorno (nunca em log/MailLog/AuditLog).
   */
  static async rotateTokenForReply(input: {
    quoteRequestId: number;
    supplierId: number;
    supplierContactId: number;
    createdById: number;
    deadlineAt?: Date | null;
    client?: Prisma.TransactionClient;
  }): Promise<{
    previous: SupplierPortalToken | null;
    created: SupplierPortalToken;
    rawToken: string;
  }> {
    const run = async (tx: Prisma.TransactionClient) => {
      // Prioriza o token que carrega a resposta do portal, mesmo revogado
      // (ex.: cotacao reenviada depois do submit): sem isso o link novo
      // abriria vazio e o proximo submit criaria uma 2a resposta.
      const existingResponse = await tx.supplierPortalResponse.findFirst({
        where: { quoteRequestId: input.quoteRequestId, supplierId: input.supplierId, deletedAt: null },
        orderBy: { id: 'desc' },
        select: { portalTokenId: true },
      });
      const previous =
        (existingResponse
          ? await tx.supplierPortalToken.findUnique({ where: { id: existingResponse.portalTokenId } })
          : null) ??
        (await tx.supplierPortalToken.findFirst({
          where: { quoteRequestId: input.quoteRequestId, supplierId: input.supplierId, revokedAt: null },
          orderBy: [{ respondedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        }));
      const now = new Date();
      const expiresAt = new Date(
        Math.max(
          previous?.expiresAt.getTime() ?? 0,
          computeTokenExpiry({ deadlineAt: input.deadlineAt ?? null }, DEFAULT_TOKEN_TTL_DAYS, now).expiresAt.getTime(),
        ),
      );
      await this.revokeTokensForContact({
        quoteRequestId: input.quoteRequestId,
        supplierContactId: input.supplierContactId,
        client: tx,
      });
      if (previous) {
        // responseId e' @unique: libera no anterior ANTES de criar o novo
        // (tambem revoga quando o anterior pertence a outro contato).
        await tx.supplierPortalToken.update({
          where: { id: previous.id },
          data: { revokedAt: previous.revokedAt ?? now, responseId: null },
        });
      }
      const createdWithRaw = (await this.createToken({
        quoteRequestId: input.quoteRequestId,
        supplierId: input.supplierId,
        supplierContactId: input.supplierContactId,
        createdById: input.createdById,
        dispatchEventId: previous?.dispatchEventId ?? null,
        expiresAt,
        client: tx,
      })) as SupplierPortalToken & { rawToken: string };
      const { rawToken, ...createdBase } = createdWithRaw;
      let created = createdBase as SupplierPortalToken;
      if (previous?.responseId) {
        await tx.supplierPortalResponse.update({
          where: { id: previous.responseId },
          data: { portalTokenId: created.id },
        });
        await tx.supplierPortalResponseRevision.updateMany({
          where: { portalTokenId: previous.id },
          data: { portalTokenId: created.id },
        });
        created = await tx.supplierPortalToken.update({
          where: { id: created.id },
          data: { responseId: previous.responseId, respondedAt: previous.respondedAt },
        });
      }
      return { previous, created, rawToken };
    };
    if (input.client) return run(input.client);
    return defaultPrisma.$transaction(run);
  }

  static async validate(input: ValidateTokenInput): Promise<ValidatedToken> {
    const client = getClient(input.client);
    const tokenHash = hashToken(input.rawToken);

    const original = await client.supplierPortalToken.findUnique({
      where: { tokenHash },
    });
    let token = original;
    let redirect: { redirectedFromTokenId: number; hops: number } | null = null;

    if (!token) {
      await this.logAccess({
        tokenId: null,
        kind: 'INVALID',
        ip: input.ip,
        userAgent: input.userAgent,
        meta: { reason: 'not_found' },
        client,
      }).catch(() => undefined);
      throw new PortalHttpError(404, PORTAL_INVALID_LINK_MESSAGE);
    }

    if (token.revokedAt) {
      // Link revogado pelo lembrete diario: segue a cadeia ate o sucessor ativo.
      const resolved = await this.resolveReminderSuccessor(token, client);
      if (resolved && resolved.token.expiresAt.getTime() > Date.now()) {
        redirect = { redirectedFromTokenId: token.id, hops: resolved.hops };
        token = resolved.token;
      } else {
        await this.logAccess({
          tokenId: token.id,
          kind: 'INVALID',
          ip: input.ip,
          userAgent: input.userAgent,
          meta: { reason: 'revoked' },
          client,
        });
        throw new PortalHttpError(404, PORTAL_INVALID_LINK_MESSAGE);
      }
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
      throw new PortalHttpError(404, PORTAL_INVALID_LINK_MESSAGE);
    }

    if (token.respondedAt) {
      if (redirect) {
        await this.logAccess({
          tokenId: token.id,
          kind: 'VIEW',
          ip: input.ip,
          userAgent: input.userAgent,
          meta: { ...redirect, alreadyResponded: true },
          client,
        });
      }
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
      ...(redirect ? { meta: redirect } : {}),
      client,
    });

    return { token: updated, alreadyResponded: false };
  }

  /**
   * A partir de um token revogado, segue a cadeia de sucessores emitidos pelo
   * lembrete (reminderSentAt != null, criados na janela do revokedAt de cada
   * elo) e devolve o primeiro ativo. null se a cadeia termina sem ativo
   * (revoke manual, regenerate, reenvio, rotacao), em ciclo ou ao estourar o limite.
   */
  private static async resolveReminderSuccessor(
    revoked: SupplierPortalToken,
    client: PrismaClient | Prisma.TransactionClient,
  ): Promise<{ token: SupplierPortalToken; hops: number } | null> {
    const visited = new Set<number>([revoked.id]);
    let current = revoked;
    for (let hops = 1; hops <= MAX_REMINDER_SUCCESSOR_HOPS; hops += 1) {
      if (!current.revokedAt) return null;
      const revokedMs = current.revokedAt.getTime();
      const next = await client.supplierPortalToken.findFirst({
        where: {
          quoteRequestId: current.quoteRequestId,
          supplierContactId: current.supplierContactId,
          id: { not: current.id },
          reminderSentAt: { not: null },
          createdAt: {
            gte: new Date(
              Math.max(current.createdAt?.getTime() ?? 0, revokedMs - REMINDER_SUCCESSOR_TOLERANCE_MS),
            ),
            lte: new Date(revokedMs + REMINDER_SUCCESSOR_TOLERANCE_MS),
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!next || visited.has(next.id)) return null;
      if (!next.revokedAt) return { token: next, hops };
      visited.add(next.id);
      current = next;
    }
    return null;
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
