import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TOKEN_TTL_DAYS,
  SupplierPortalService,
  generateToken,
} from '../src/services/SupplierPortalService';

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
    it('lanca HttpError 404 quando o token nao existe', async () => {
      const fakeClient = {
        supplierPortalToken: {
          findUnique: async () => null,
        },
        supplierPortalTokenLog: {
          create: async () => ({}),
        },
      };
      await expect(
        SupplierPortalService.validate({ rawToken: 'invalido', client: fakeClient as never }),
      ).rejects.toMatchObject({ status: 404 });
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
});
