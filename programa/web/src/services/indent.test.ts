import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
}));

import { api } from '@/api/client';
import {
  createIndentClient,
  createIndentProduct,
  createIndentSupplier,
  importIndentProducts,
  importIndentSuppliers,
  listIndentClients,
  listIndentProductCandidates,
  listIndentProductOptions,
  listIndentProducts,
  listIndentSupplierCandidates,
  listIndentSupplierOptions,
  listIndentSuppliers,
  promoteIndentProduct,
  setIndentClientRule,
  setIndentSupplierProducts,
  updateIndentClient,
  updateIndentProduct,
  updateIndentSupplier,
} from './indent';

const PREFIXO = '/api/v1/indent/';

function urls(): string[] {
  return [api.get, api.post, api.put, api.del].flatMap((fn) => vi.mocked(fn).mock.calls.map((call) => String(call[0])));
}

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue({});
  vi.mocked(api.post).mockReset().mockResolvedValue({});
  vi.mocked(api.put).mockReset().mockResolvedValue({});
  vi.mocked(api.del).mockReset().mockResolvedValue({});
});

describe('services/indent', () => {
  it('TODAS as URLs comecam por /api/v1/indent/ (inclusive o vinculo de produtos e os 2 options)', async () => {
    await listIndentClients();
    await createIndentClient({ name: 'A', cnpj: '11222333000181' });
    await updateIndentClient(3, { city: 'X' });
    await setIndentClientRule(3, { mode: 'LIVRE', supplierIds: [] });
    await listIndentSuppliers();
    await listIndentSupplierOptions();
    await createIndentSupplier({ name: 'A' });
    await updateIndentSupplier(5, { country: 'X' });
    await setIndentSupplierProducts(5, [1, 2]);
    await listIndentProducts();
    await listIndentProductOptions();
    await createIndentProduct({ name: 'A' });
    await updateIndentProduct(2, { notes: 'x' });
    await promoteIndentProduct(2);
    await listIndentSupplierCandidates();
    await listIndentProductCandidates();
    await importIndentSuppliers([1]);
    await importIndentProducts([1]);

    const todas = urls();
    expect(todas).toHaveLength(18);
    for (const url of todas) expect(url.startsWith(PREFIXO), url).toBe(true);
    expect(todas).toContain('/api/v1/indent/suppliers/5/products');
    expect(todas).toContain('/api/v1/indent/suppliers/options');
    expect(todas).toContain('/api/v1/indent/products/options');
    // nada de prefixo antigo ou curto (/v1/..., /api/<algo> fora de /api/v1/)
    expect(todas.some((url) => url.startsWith('/v1/') || /^\/api\/(?!v1\/)/.test(url))).toBe(false);
  });

  it('metodos HTTP: vinculo e regra por PUT, promover e importar por POST', async () => {
    await setIndentSupplierProducts(5, [1, 2]);
    expect(api.put).toHaveBeenCalledWith('/api/v1/indent/suppliers/5/products', { productIds: [1, 2] });
    await setIndentClientRule(3, { mode: 'BLOQUEIO', supplierIds: [5], reason: 'x' });
    expect(api.put).toHaveBeenCalledWith('/api/v1/indent/clients/3/supplier-rule', { mode: 'BLOQUEIO', supplierIds: [5], reason: 'x' });
    await promoteIndentProduct(2);
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/products/2/promote');
    await importIndentProducts([4, 5]);
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/import/products', { ids: [4, 5] });
    await importIndentSuppliers([7]);
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/import/suppliers', { ids: [7] });
  });

  it('listas: q aparado, inativos vira 1 e origin segue na query dos produtos', async () => {
    await listIndentProducts({ q: '  zinco ', origin: 'LIVRE', page: 2, pageSize: 100, inativos: true });
    expect(api.get).toHaveBeenCalledWith('/api/v1/indent/products', {
      q: 'zinco',
      page: 2,
      pageSize: 100,
      inativos: 1,
      origin: 'LIVRE',
    });
    await listIndentSuppliers({ q: '   ' });
    expect(api.get).toHaveBeenLastCalledWith('/api/v1/indent/suppliers', {
      q: undefined,
      page: undefined,
      pageSize: undefined,
      inativos: undefined,
    });
  });

  it('PUT/POST do fornecedor enviam productIds junto (conjunto final)', async () => {
    await createIndentSupplier({ name: 'Acme', productIds: [1, 2] });
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/suppliers', { name: 'Acme', productIds: [1, 2] });
    await updateIndentSupplier(5, { hasPartnership: true, productIds: [] });
    expect(api.put).toHaveBeenCalledWith('/api/v1/indent/suppliers/5', { hasPartnership: true, productIds: [] });
  });
});
