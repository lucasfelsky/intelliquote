import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';
import { listAuditLogs } from './audit';

const base = {
  id: 1,
  entityType: 'company_profile',
  entityId: '1',
  action: 'update',
  performedById: 3,
  createdAt: '2026-09-30T00:00:00.000Z',
};

describe('listAuditLogs', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('mapeia beforeData/afterData da API para before/after', async () => {
    vi.mocked(api.get).mockResolvedValue([
      { ...base, beforeData: { a: 1 }, afterData: '{"a":2}' },
    ]);
    const row = (await listAuditLogs())[0]!;
    expect(row.before).toEqual({ a: 1 });
    expect(row.after).toBe('{"a":2}');
  });

  it('linha sem snapshots resulta em before/after null', async () => {
    vi.mocked(api.get).mockResolvedValue([{ ...base }]);
    const row = (await listAuditLogs())[0]!;
    expect(row.before).toBeNull();
    expect(row.after).toBeNull();
  });

  it('resposta nao-array vira lista vazia', async () => {
    vi.mocked(api.get).mockResolvedValue({});
    expect(await listAuditLogs()).toEqual([]);
  });
});
