import { describe, it, expect, vi } from 'vitest';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: 'admin' } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { normalizeItem } from './CotacaoDetalhe';

function itemCom(targetPrice: unknown) {
  return { id: 1, quoteRequestId: 9, productName: 'Resina', quantity: 10, unit: 'KG', targetPrice };
}

describe('CotacaoDetalhe - normalizeItem (targetPrice)', () => {
  it('Decimal em string vira numero ("0.78" -> 0.78)', () => {
    expect(normalizeItem(itemCom('0.78')).targetPrice).toBe(0.78);
  });

  it('numero finito e mantido', () => {
    expect(normalizeItem(itemCom(2.5)).targetPrice).toBe(2.5);
  });

  it('string invalida, vazia, nula ou ausente vira null', () => {
    expect(normalizeItem(itemCom('abc')).targetPrice).toBeNull();
    expect(normalizeItem(itemCom('')).targetPrice).toBeNull();
    expect(normalizeItem(itemCom(null)).targetPrice).toBeNull();
    expect(normalizeItem(itemCom(undefined)).targetPrice).toBeNull();
    expect(normalizeItem(itemCom(Number.NaN)).targetPrice).toBeNull();
  });
});
