import { describe, expect, it, beforeEach } from 'vitest';

import { ExchangeRateService } from '../src/services/ExchangeRateService';

const originalFetch = globalThis.fetch;

function makeClient() {
  const upserts: any[] = [];
  const calls: any[] = [];
  const client = {
    exchangeRate: {
      upsert: async (args: any) => {
        upserts.push(args);
        return { ...args.create, ...args.update, id: upserts.length };
      },
      findFirst: async () => null,
      findMany: async () => [],
    },
    $transaction: async (ops: any[]) => Promise.all(ops),
  } as any;
  return { client, upserts, calls };
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ExchangeRateService', () => {
  it('consulta PTAX do BCB via Olinda OData e faz upsert por moeda+data', async () => {
    const fakeFetch = async (url: string) => {
      if (url.includes("@moeda='USD'")) {
        return {
          ok: true,
          json: async () => ({
            value: [
              { cotacaoCompra: 5.1613, cotacaoVenda: 5.1620, dataHoraCotacao: '2026-06-18 10:06:09.849819' },
            ],
          }),
        } as any;
      }
      if (url.includes("@moeda='EUR'")) {
        return {
          ok: true,
          json: async () => ({
            value: [
              { cotacaoCompra: 5.9205, cotacaoVenda: 5.9215, dataHoraCotacao: '2026-06-18 11:08:09.855227' },
            ],
          }),
        } as any;
      }
      if (url.includes("@moeda='JPY'")) {
        return {
          ok: true,
          json: async () => ({
            value: [
              { cotacaoCompra: 0.03340, cotacaoVenda: 0.03345, dataHoraCotacao: '2026-06-18 12:00:00.000000' },
            ],
          }),
        } as any;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ value: [] }),
      } as any;
    };
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    const { client, upserts } = makeClient();
    const snapshots = await ExchangeRateService.refresh(client);
    expect(snapshots.find((s) => s.currency === 'USD')?.rateToBrl).toBeCloseTo(5.1613, 4);
    expect(snapshots.find((s) => s.currency === 'EUR')?.rateToBrl).toBeCloseTo(5.9205, 4);
    expect(snapshots.find((s) => s.currency === 'JPY')?.rateToBrl).toBeCloseTo(0.0334, 4);
    const currencies = upserts.map((u) => u.where.currency_referenceDate.currency);
    expect(currencies).toContain('USD');
    expect(currencies).toContain('EUR');
    expect(currencies).toContain('JPY');
  });

  it('getRateToBrl retorna 1 para BRL mesmo sem cache', async () => {
    const { client } = makeClient();
    const rate = await ExchangeRateService.getRateToBrl('BRL', client);
    expect(rate?.rateToBrl).toBe(1);
  });

  it('getRateToBrl retorna null quando nao ha cache e moeda nao e BRL', async () => {
    const { client } = makeClient();
    const rate = await ExchangeRateService.getRateToBrl('USD', client);
    expect(rate).toBeNull();
  });

  it('refresh nao quebra quando BCB retorna 500 em uma das series', async () => {
    const fakeFetch = async (url: string) => {
      if (url.includes("@moeda='USD'")) {
        return {
          ok: true,
          json: async () => ({
            value: [
              { cotacaoCompra: 5.1613, cotacaoVenda: 5.1620, dataHoraCotacao: '2026-06-18 10:06:09.849819' },
            ],
          }),
        } as any;
      }
      return { ok: false, status: 500, json: async () => ({ value: [] }) } as any;
    };
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    const { client, upserts } = makeClient();
    const snapshots = await ExchangeRateService.refresh(client);
    expect(snapshots.find((s) => s.currency === 'USD')).toBeTruthy();
    expect(upserts.length).toBeGreaterThan(0);
  });
});
