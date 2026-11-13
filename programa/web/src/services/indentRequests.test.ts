import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
}));

import { api } from '@/api/client';
import {
  confirmIndentRequestItems,
  createIndentRequest,
  generateIndentQuotes,
  getIndentRequest,
  getIndentRequestClientOptions,
  getIndentRequestSupplierOptions,
  getIndentRequestsNewCount,
  listIndentRequests,
} from './indentRequests';

const PREFIXO = '/api/v1/indent/requests';

function urls(): string[] {
  return [api.get, api.post, api.put, api.del].flatMap((fn) => vi.mocked(fn).mock.calls.map((call) => String(call[0])));
}

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue({});
  vi.mocked(api.post).mockReset().mockResolvedValue({});
});

describe('services/indentRequests', () => {
  it('TODAS as URLs comecam por /api/v1/indent/requests', async () => {
    await listIndentRequests();
    await getIndentRequestsNewCount();
    await getIndentRequestClientOptions();
    await getIndentRequest(11);
    await getIndentRequestSupplierOptions(11);
    await createIndentRequest({ clientId: 3, items: [{ description: 'Zinco', quantityKg: 10 }] });
    await confirmIndentRequestItems(11, [21]);
    await generateIndentQuotes(11, { suppliers: [{ supplierId: 5 }] });

    const todas = urls();
    expect(todas).toHaveLength(8);
    for (const url of todas) {
      expect(url.startsWith(PREFIXO), url).toBe(true);
    }
  });

  it('usa o verbo e o caminho certos em cada chamada', async () => {
    await getIndentRequestsNewCount();
    await getIndentRequestClientOptions();
    await getIndentRequest(11);
    await getIndentRequestSupplierOptions(11);
    expect(vi.mocked(api.get).mock.calls.map((c) => c[0])).toEqual([
      `${PREFIXO}/new-count`,
      `${PREFIXO}/client-options`,
      `${PREFIXO}/11`,
      `${PREFIXO}/11/supplier-options`,
    ]);

    await createIndentRequest({ clientId: 3, items: [{ productId: 2, description: 'Zinco', quantityKg: 10 }] });
    await confirmIndentRequestItems(11, [21, 22]);
    await generateIndentQuotes(11, { suppliers: [{ supplierId: 5 }, { supplierId: 6, exceptionReason: 'Motivo' }] });
    expect(vi.mocked(api.post).mock.calls).toEqual([
      [PREFIXO, { clientId: 3, items: [{ productId: 2, description: 'Zinco', quantityKg: 10 }] }],
      [`${PREFIXO}/11/items/confirm`, { itemIds: [21, 22] }],
      [`${PREFIXO}/11/quotes`, { suppliers: [{ supplierId: 5 }, { supplierId: 6, exceptionReason: 'Motivo' }] }],
    ]);
  });

  it('a listagem manda filter/q/page so quando ha valor e nao manda filter=todas', async () => {
    await listIndentRequests();
    await listIndentRequests({ q: '  zinco ', filter: 'nova', page: 2, pageSize: 20 });
    await listIndentRequests({ q: '   ', filter: 'todas' });

    expect(vi.mocked(api.get).mock.calls).toEqual([
      [PREFIXO, { q: undefined, filter: undefined, page: undefined, pageSize: undefined }],
      [PREFIXO, { q: 'zinco', filter: 'nova', page: 2, pageSize: 20 }],
      [PREFIXO, { q: undefined, filter: undefined, page: undefined, pageSize: undefined }],
    ]);
  });
});
