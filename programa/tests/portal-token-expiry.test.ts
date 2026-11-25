import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeTokenExpiry, endOfDayInSaoPaulo } from '../src/utils/portalTokenExpiry';
import { DEFAULT_TOKEN_TTL_DAYS, SupplierPortalService } from '../src/services/SupplierPortalService';

const DAY = 86_400_000;

describe('computeTokenExpiry', () => {
  const now = new Date('2026-12-01T15:00:00.000Z');

  it('sem prazo: now + ttl, source ttl', () => {
    const result = computeTokenExpiry({ deadlineAt: null }, 7, now);
    expect(result.source).toBe('ttl');
    expect(result.expiresAt.getTime()).toBe(now.getTime() + 7 * DAY);
    expect(computeTokenExpiry({ deadlineAt: undefined }, 7, now).source).toBe('ttl');
  });

  it('prazo gravado como meia-noite BRT (03:00Z): fim do dia do prazo em BRT', () => {
    const result = computeTokenExpiry({ deadlineAt: new Date('2026-12-10T03:00:00.000Z') }, 7, now);
    expect(result.source).toBe('deadline');
    expect(result.expiresAt.toISOString()).toBe('2026-12-11T02:59:59.999Z');
  });

  it('prazo com hora (17h BRT): mesmo fim do dia', () => {
    const result = computeTokenExpiry({ deadlineAt: new Date('2026-12-10T20:00:00.000Z') }, 7, now);
    expect(result.source).toBe('deadline');
    expect(result.expiresAt.toISOString()).toBe('2026-12-11T02:59:59.999Z');
  });

  it('prazo 02:00Z (23h BRT do dia anterior): dia BRT anterior', () => {
    const result = computeTokenExpiry({ deadlineAt: new Date('2026-12-10T02:00:00.000Z') }, 7, now);
    expect(result.source).toBe('deadline');
    expect(result.expiresAt.toISOString()).toBe('2026-12-10T02:59:59.999Z');
  });

  it('prazo de hoje com now antes das 23:59 BRT: deadline', () => {
    const result = computeTokenExpiry({ deadlineAt: new Date('2026-12-01T03:00:00.000Z') }, 7, now);
    expect(result.source).toBe('deadline');
    expect(result.expiresAt.toISOString()).toBe('2026-12-02T02:59:59.999Z');
  });

  it('prazo de ontem: cai no TTL', () => {
    const result = computeTokenExpiry({ deadlineAt: new Date('2026-11-30T03:00:00.000Z') }, 7, now);
    expect(result.source).toBe('ttl');
    expect(result.expiresAt.getTime()).toBe(now.getTime() + 7 * DAY);
  });

  it('fim do dia exatamente == now: cai no TTL', () => {
    const deadlineAt = new Date('2026-12-10T03:00:00.000Z');
    const exactlyEnd = endOfDayInSaoPaulo(deadlineAt);
    const result = computeTokenExpiry({ deadlineAt }, 7, exactlyEnd);
    expect(result.source).toBe('ttl');
    expect(result.expiresAt.getTime()).toBe(exactlyEnd.getTime() + 7 * DAY);
  });
});

describe('SupplierPortalService.rotateTokenForReply com deadlineAt (tx mockada)', () => {
  const input = { quoteRequestId: 5, supplierId: 2, supplierContactId: 9, createdById: 1 };
  const fixedNow = new Date('2026-12-01T15:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(fixedNow);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeTx(previous: Record<string, unknown> | null) {
    return {
      supplierPortalResponse: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      supplierPortalToken: {
        findFirst: vi.fn().mockResolvedValue(previous),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: previous ? 1 : 0 }),
        update: vi.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 501, ...data, revokedAt: null, respondedAt: null, responseId: null }),
        ),
      },
      supplierPortalResponseRevision: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
  }

  function previousToken(expiresAt: Date) {
    return {
      id: 400,
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
      expiresAt,
      revokedAt: null,
      respondedAt: null,
      responseId: null,
      dispatchEventId: 77,
    };
  }

  it('prazo futuro e anterior curto: expiresAt = fim do dia do prazo', async () => {
    // Anterior vence em 2 dias; prazo (30 dias) governa e e maior que 14d.
    const tx = makeTx(previousToken(new Date(fixedNow.getTime() + 2 * DAY)));
    await SupplierPortalService.rotateTokenForReply({
      ...input,
      deadlineAt: new Date('2026-12-31T03:00:00.000Z'),
      client: tx as never,
    });
    const data = tx.supplierPortalToken.create.mock.calls[0][0].data;
    expect((data.expiresAt as Date).toISOString()).toBe('2027-01-01T02:59:59.999Z');
  });

  it('anterior mais longo que o prazo: mantem o anterior', async () => {
    const previousExpiry = new Date(fixedNow.getTime() + 40 * DAY);
    const tx = makeTx(previousToken(previousExpiry));
    await SupplierPortalService.rotateTokenForReply({
      ...input,
      deadlineAt: new Date('2026-12-10T03:00:00.000Z'),
      client: tx as never,
    });
    const data = tx.supplierPortalToken.create.mock.calls[0][0].data;
    expect(data.expiresAt).toEqual(previousExpiry);
  });

  it('sem deadlineAt: >= now + 14 dias (paridade com o comportamento anterior)', async () => {
    const tx = makeTx(previousToken(new Date(fixedNow.getTime() + 2 * DAY)));
    await SupplierPortalService.rotateTokenForReply({ ...input, client: tx as never });
    const data = tx.supplierPortalToken.create.mock.calls[0][0].data;
    expect((data.expiresAt as Date).getTime()).toBeGreaterThanOrEqual(
      fixedNow.getTime() + DEFAULT_TOKEN_TTL_DAYS * DAY,
    );
  });
});
