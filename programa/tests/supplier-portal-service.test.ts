import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOKEN_TTL_DAYS,
  SupplierPortalService,
  generateToken,
} from '../src/services/SupplierPortalService';
import { logger } from '../src/lib/logger';
import { hashToken } from '../src/utils/tokens';

describe('Supplier portal token service', () => {
  describe('generateToken', () => {
    it('retorna token cru, hash e data de expiracao coerente', () => {
      const result = generateToken();
      expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result.tokenHash).toHaveLength(64);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
      const diffMs = result.expiresAt.getTime() - Date.now();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(DEFAULT_TOKEN_TTL_DAYS - 0.1);
      expect(diffDays).toBeLessThan(DEFAULT_TOKEN_TTL_DAYS + 0.1);
    });

    it('gera tokens com bytes suficientes (32 -> base64url ~43 chars)', () => {
      const result = generateToken(1);
      expect(result.rawToken.length).toBeGreaterThanOrEqual(40);
    });
  });

  describe('validate mocks', () => {
    it('lanca HttpError 404 quando o token nao existe e registra INVALID com tokenId null', async () => {
      const createLog = vi.fn().mockResolvedValue({});
      const fakeClient = {
        supplierPortalToken: {
          findUnique: async () => null,
        },
        supplierPortalTokenLog: {
          create: createLog,
        },
      };
      await expect(
        SupplierPortalService.validate({ rawToken: 'invalido', client: fakeClient as never }),
      ).rejects.toMatchObject({ status: 404 });
      expect(createLog).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenId: null,
          kind: 'INVALID',
          meta: { reason: 'not_found' },
        }),
      });
    });

    it('lanca HttpError 404 quando o token esta revogado', async () => {
      const fakeClient = {
        supplierPortalToken: {
          findUnique: async () => ({ id: 1, revokedAt: new Date(), expiresAt: new Date(Date.now() + 1000) }),
        },
        supplierPortalTokenLog: {
          create: async () => ({}),
        },
      };
      await expect(
        SupplierPortalService.validate({ rawToken: 'algum', client: fakeClient as never }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('marca respondedAt sem incrementar accessCount', async () => {
      const now = new Date();
      const token = {
        id: 7,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000),
        respondedAt: now,
        accessCount: 2,
        firstSeenAt: now,
      };
      const fakeClient = {
        supplierPortalToken: {
          findUnique: async () => token,
          update: async () => token,
        },
        supplierPortalTokenLog: {
          create: async () => ({}),
        },
      };
      const result = await SupplierPortalService.validate({ rawToken: 'x', client: fakeClient as never });
      expect(result.alreadyResponded).toBe(true);
    });
  });

  describe('rotateTokenForReply (tx mockada)', () => {
    const DAY = 86_400_000;
    const input = { quoteRequestId: 5, supplierId: 2, supplierContactId: 9, createdById: 1 };

    // `activePrevious`: token ativo devolvido pelo fallback (findFirst).
    // `responseOwner`: token dono da SupplierPortalResponse existente (pode estar
    // revogado) -- tem prioridade sobre o ativo.
    function makeTx(
      activePrevious: Record<string, unknown> | null,
      responseOwner: Record<string, unknown> | null = null,
    ) {
      const tx = {
        supplierPortalResponse: {
          findFirst: vi.fn().mockResolvedValue(responseOwner ? { portalTokenId: responseOwner.id } : null),
          update: vi.fn().mockResolvedValue({}),
        },
        supplierPortalToken: {
          findFirst: vi.fn().mockResolvedValue(activePrevious),
          findUnique: vi.fn().mockResolvedValue(responseOwner),
          updateMany: vi.fn().mockResolvedValue({ count: activePrevious ? 1 : 0 }),
          update: vi.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
          create: vi.fn().mockImplementation(({ data }) =>
            Promise.resolve({ id: 501, ...data, revokedAt: null, respondedAt: null, responseId: null }),
          ),
        },
        supplierPortalResponseRevision: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      return tx;
    }

    function previousToken(overrides: Record<string, unknown> = {}) {
      return {
        id: 400,
        quoteRequestId: 5,
        supplierId: 2,
        supplierContactId: 9,
        expiresAt: new Date(Date.now() + 3 * DAY),
        revokedAt: null,
        respondedAt: new Date('2026-10-01T10:00:00Z'),
        responseId: 900,
        dispatchEventId: 77,
        ...overrides,
      };
    }

    let warnSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      logSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    });

    it('zera o responseId do anterior ANTES de criar o novo e migra resposta + revisoes', async () => {
      const tx = makeTx(previousToken());
      const result = await SupplierPortalService.rotateTokenForReply({ ...input, client: tx as never });

      // Procura primeiro a resposta existente do par (cotacao, fornecedor); sem ela, cai no token ativo.
      expect(tx.supplierPortalResponse.findFirst).toHaveBeenCalledWith({
        where: { quoteRequestId: 5, supplierId: 2, deletedAt: null },
        orderBy: { id: 'desc' },
        select: { portalTokenId: true },
      });
      expect(tx.supplierPortalToken.findUnique).not.toHaveBeenCalled();
      expect(tx.supplierPortalToken.findFirst).toHaveBeenCalledWith({
        where: { quoteRequestId: 5, supplierId: 2, revokedAt: null },
        orderBy: [{ respondedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      });
      expect(tx.supplierPortalToken.updateMany).toHaveBeenCalledWith({
        where: { quoteRequestId: 5, supplierContactId: 9, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      const [releasePrevious, adoptResponse] = tx.supplierPortalToken.update.mock.calls.map((c) => c[0]);
      expect(releasePrevious).toEqual({ where: { id: 400 }, data: { revokedAt: expect.any(Date), responseId: null } });
      expect(tx.supplierPortalToken.update.mock.invocationCallOrder[0]).toBeLessThan(
        tx.supplierPortalToken.create.mock.invocationCallOrder[0],
      );
      expect(tx.supplierPortalResponse.update).toHaveBeenCalledWith({ where: { id: 900 }, data: { portalTokenId: 501 } });
      expect(tx.supplierPortalResponseRevision.updateMany).toHaveBeenCalledWith({
        where: { portalTokenId: 400 },
        data: { portalTokenId: 501 },
      });
      expect(adoptResponse).toEqual({
        where: { id: 501 },
        data: { responseId: 900, respondedAt: new Date('2026-10-01T10:00:00Z') },
      });
      expect(result.previous?.id).toBe(400);
      expect(result.created.id).toBe(501);
      expect(result.created.responseId).toBe(900);
      expect(result.created.respondedAt).toEqual(new Date('2026-10-01T10:00:00Z'));
      // Padrao do portal: hash no banco, cru so' no retorno; nunca em log.
      const createData = tx.supplierPortalToken.create.mock.calls[0][0].data;
      expect(createData.tokenHash).toBe(hashToken(result.rawToken));
      expect(createData).not.toHaveProperty('rawToken');
      expect(createData.dispatchEventId).toBe(77);
      expect(createData.supplierContactId).toBe(9);
      expect(result.created).not.toHaveProperty('rawToken');
      expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      const logged = JSON.stringify([...warnSpy.mock.calls, ...logSpy.mock.calls]);
      expect(logged).not.toContain(result.rawToken);
    });

    it('expiresAt = max(expiresAt do anterior, agora + 14 dias)', async () => {
      const farFuture = new Date(Date.now() + 40 * DAY);
      const txLong = makeTx(previousToken({ expiresAt: farFuture }));
      await SupplierPortalService.rotateTokenForReply({ ...input, client: txLong as never });
      expect(txLong.supplierPortalToken.create.mock.calls[0][0].data.expiresAt).toEqual(farFuture);

      const txShort = makeTx(previousToken({ expiresAt: new Date(Date.now() + 2 * DAY) }));
      const before = Date.now();
      await SupplierPortalService.rotateTokenForReply({ ...input, client: txShort as never });
      const expiresAt = txShort.supplierPortalToken.create.mock.calls[0][0].data.expiresAt as Date;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + DEFAULT_TOKEN_TTL_DAYS * DAY);
      expect(expiresAt.getTime()).toBeLessThan(Date.now() + DEFAULT_TOKEN_TTL_DAYS * DAY + 60_000);
    });

    it('sem token anterior: cria sem revogar nem mover nada', async () => {
      const tx = makeTx(null);
      const before = Date.now();
      const result = await SupplierPortalService.rotateTokenForReply({ ...input, client: tx as never });

      expect(result.previous).toBeNull();
      expect(tx.supplierPortalToken.update).not.toHaveBeenCalled();
      expect(tx.supplierPortalResponse.update).not.toHaveBeenCalled();
      expect(tx.supplierPortalResponseRevision.updateMany).not.toHaveBeenCalled();
      const createData = tx.supplierPortalToken.create.mock.calls[0][0].data;
      expect(createData.dispatchEventId).toBeNull();
      expect((createData.expiresAt as Date).getTime()).toBeGreaterThanOrEqual(before + DEFAULT_TOKEN_TTL_DAYS * DAY);
      expect(result.created.responseId).toBeNull();
    });

    it('resposta num token REVOGADO (cotacao reenviada apos o submit): o revogado e o previous, resposta migra e revokedAt e preservado', async () => {
      const revokedAt = new Date('2026-10-02T08:00:00Z');
      const revokedOwner = previousToken({ id: 300, revokedAt, responseId: 900 });
      const activeEmpty = previousToken({ id: 400, respondedAt: null, responseId: null, createdAt: new Date() });
      const tx = makeTx(activeEmpty, revokedOwner);

      const result = await SupplierPortalService.rotateTokenForReply({ ...input, client: tx as never });

      expect(tx.supplierPortalToken.findUnique).toHaveBeenCalledWith({ where: { id: 300 } });
      // O ativo vazio nao e' o previous (vai so' na revogacao em massa do contato).
      expect(tx.supplierPortalToken.findFirst).not.toHaveBeenCalled();
      expect(result.previous?.id).toBe(300);
      expect(tx.supplierPortalToken.updateMany).toHaveBeenCalledWith({
        where: { quoteRequestId: 5, supplierContactId: 9, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      const [releasePrevious, adoptResponse] = tx.supplierPortalToken.update.mock.calls.map((c) => c[0]);
      expect(releasePrevious).toEqual({ where: { id: 300 }, data: { revokedAt, responseId: null } });
      expect(tx.supplierPortalResponse.update).toHaveBeenCalledWith({ where: { id: 900 }, data: { portalTokenId: 501 } });
      expect(tx.supplierPortalResponseRevision.updateMany).toHaveBeenCalledWith({
        where: { portalTokenId: 300 },
        data: { portalTokenId: 501 },
      });
      expect(adoptResponse).toEqual({
        where: { id: 501 },
        data: { responseId: 900, respondedAt: new Date('2026-10-01T10:00:00Z') },
      });
      expect(result.created.responseId).toBe(900);
    });

    it('anterior sem resposta (nao respondido): revoga e cria, sem migrar', async () => {
      const tx = makeTx(previousToken({ respondedAt: null, responseId: null }));
      const result = await SupplierPortalService.rotateTokenForReply({ ...input, client: tx as never });

      expect(tx.supplierPortalToken.update).toHaveBeenCalledTimes(1);
      expect(tx.supplierPortalToken.update.mock.calls[0][0]).toEqual({
        where: { id: 400 },
        data: { revokedAt: expect.any(Date), responseId: null },
      });
      expect(tx.supplierPortalResponse.update).not.toHaveBeenCalled();
      expect(result.created.responseId).toBeNull();
    });
  });
});
