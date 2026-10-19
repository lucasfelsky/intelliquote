import { describe, expect, it, beforeEach, vi } from 'vitest';

import { logger } from '../src/lib/logger';
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

function bulletin(
  cotacaoCompra: number,
  dataHoraCotacao: string,
  tipoBoletim?: string,
) {
  return {
    cotacaoCompra,
    cotacaoVenda: cotacaoCompra + 0.001,
    paridadeCompra: 1,
    paridadeVenda: 1,
    dataHoraCotacao,
    ...(tipoBoletim ? { tipoBoletim } : {}),
  };
}

// Fetch falso que registra as URLs e responde por moeda (404 para as demais).
function installFetch(byCurrency: Record<string, any[]>) {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    const match = /@moeda='([A-Z]+)'/.exec(String(url));
    const list = match ? byCurrency[match[1]] : undefined;
    if (!list) {
      return { ok: false, status: 404, json: async () => ({ value: [] }) } as any;
    }
    return { ok: true, json: async () => ({ value: list }) } as any;
  }) as unknown as typeof fetch;
  return urls;
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('ExchangeRateService', () => {
  it('consulta PTAX do BCB via Olinda OData e faz upsert por moeda+data', async () => {
    installFetch({
      USD: [bulletin(5.1613, '2026-06-18 13:06:09.849819', 'Fechamento')],
      EUR: [bulletin(5.9205, '2026-06-18 13:08:09.855227', 'Fechamento')],
      JPY: [bulletin(0.0334, '2026-06-18 13:00:00.000000', 'Fechamento')],
    });
    const { client, upserts } = makeClient();
    const snapshots = await ExchangeRateService.refresh(client, new Date('2026-06-18T17:00:00Z'));
    expect(snapshots.find((s) => s.currency === 'USD')?.rateToBrl).toBeCloseTo(5.1613, 4);
    expect(snapshots.find((s) => s.currency === 'EUR')?.rateToBrl).toBeCloseTo(5.9205, 4);
    expect(snapshots.find((s) => s.currency === 'JPY')?.rateToBrl).toBeCloseTo(0.0334, 4);
    const currencies = upserts.map((u) => u.where.currency_referenceDate.currency);
    expect(currencies).toContain('USD');
    expect(currencies).toContain('EUR');
    expect(currencies).toContain('JPY');
  });

  it('usa CotacaoMoedaPeriodo com janela hojeBRT-7..hojeBRT e pede tipoBoletim', async () => {
    const urls = installFetch({
      USD: [bulletin(5.1, '2026-10-16 13:05:00.000000', 'Fechamento')],
    });
    const { client } = makeClient();
    // 2026-10-19 15:00Z = 12:00 BRT, segunda.
    await ExchangeRateService.refresh(client, new Date('2026-10-19T15:00:00Z'));
    const usdUrl = urls.find((u) => u.includes("@moeda='USD'"));
    expect(usdUrl).toBeDefined();
    expect(usdUrl).toContain('CotacaoMoedaPeriodo(');
    expect(usdUrl).not.toContain('CotacaoMoedaDia');
    expect(usdUrl).toContain("@dataInicial='10-12-2026'");
    expect(usdUrl).toContain("@dataFinalCotacao='10-19-2026'");
    expect(usdUrl).toMatch(/\$select=[^&]*tipoBoletim/);
  });

  it('data final eh a data BRT, nao UTC: 2026-10-20T02:30Z (23:30 BRT) usa 10-19-2026', async () => {
    const urls = installFetch({
      USD: [bulletin(5.1, '2026-10-19 13:05:00.000000', 'Fechamento')],
    });
    const { client } = makeClient();
    await ExchangeRateService.refresh(client, new Date('2026-10-20T02:30:00Z'));
    const usdUrl = urls.find((u) => u.includes("@moeda='USD'"));
    expect(usdUrl).toContain("@dataFinalCotacao='10-19-2026'");
    expect(usdUrl).toContain("@dataInicial='10-12-2026'");
  });

  it('virada de mes/ano: janela de 7 dias cruza o limite corretamente', async () => {
    const urls = installFetch({
      USD: [bulletin(5.1, '2026-12-30 13:05:00.000000', 'Fechamento')],
    });
    const { client } = makeClient();
    // 2027-01-03T12:00Z = 09:00 BRT de 2027-01-03.
    await ExchangeRateService.refresh(client, new Date('2027-01-03T12:00:00Z'));
    const usdUrl = urls.find((u) => u.includes("@moeda='USD'"));
    expect(usdUrl).toContain("@dataInicial='12-27-2026'");
    expect(usdUrl).toContain("@dataFinalCotacao='01-03-2027'");
  });

  it('escolhe o Fechamento mesmo quando ha Intermediario posterior na lista', async () => {
    installFetch({
      USD: [
        bulletin(5.0, '2026-10-16 10:05:00.000000', 'Abertura'),
        bulletin(5.1, '2026-10-16 13:05:00.000000', 'Fechamento'),
        bulletin(5.2, '2026-10-19 11:05:00.000000', 'Intermediário'),
      ],
    });
    const { client, upserts } = makeClient();
    const snapshots = await ExchangeRateService.refresh(client, new Date('2026-10-19T15:00:00Z'));
    const usd = snapshots.find((s) => s.currency === 'USD');
    expect(usd?.rateToBrl).toBeCloseTo(5.1, 4);
    expect(usd?.referenceDate).toBe('2026-10-16');
    expect(upserts).toHaveLength(1);
  });

  it('nao depende da ordem da resposta para achar o Fechamento mais recente', async () => {
    installFetch({
      USD: [
        bulletin(5.3, '2026-10-16 13:05:00.000000', 'Fechamento'),
        bulletin(5.1, '2026-10-15 13:05:00.000000', 'Fechamento'),
      ],
    });
    const { client } = makeClient();
    const snapshots = await ExchangeRateService.refresh(client, new Date('2026-10-19T15:00:00Z'));
    expect(snapshots[0].rateToBrl).toBeCloseTo(5.3, 4);
    expect(snapshots[0].referenceDate).toBe('2026-10-16');
  });

  it('sem Fechamento na janela usa o ultimo boletim e loga warn', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    installFetch({
      USD: [
        bulletin(5.0, '2026-10-19 10:05:00.000000', 'Abertura'),
        bulletin(5.2, '2026-10-19 11:05:00.000000', 'Intermediário'),
      ],
    });
    const { client } = makeClient();
    const snapshots = await ExchangeRateService.refresh(client, new Date('2026-10-19T15:00:00Z'));
    expect(snapshots[0].rateToBrl).toBeCloseTo(5.2, 4);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'USD' }),
      expect.stringContaining('Fechamento'),
    );
  });

  it('fim de semana: segunda 08:00 BRT (sem boletim no dia) grava o Fechamento de sexta', async () => {
    const urls = installFetch({
      USD: [
        bulletin(5.0, '2026-10-16 10:05:00.000000', 'Abertura'),
        bulletin(5.1, '2026-10-16 13:05:00.000000', 'Fechamento'),
      ],
    });
    const { client, upserts } = makeClient();
    // 2026-10-19 11:00Z = 08:00 BRT de segunda; BCB ainda nao publicou nada no dia.
    const snapshots = await ExchangeRateService.refresh(client, new Date('2026-10-19T11:00:00Z'));
    const usd = snapshots.find((s) => s.currency === 'USD');
    expect(usd?.rateToBrl).toBeCloseTo(5.1, 4);
    expect(usd?.referenceDate).toBe('2026-10-16');
    expect(upserts[0].where.currency_referenceDate.referenceDate.toISOString()).toBe(
      '2026-10-16T00:00:00.000Z',
    );
    const usdUrl = urls.find((u) => u.includes("@moeda='USD'"));
    expect(usdUrl).toContain("@dataFinalCotacao='10-19-2026'");
  });

  it('CNY nao eh consultado (fora da PTAX)', async () => {
    const urls = installFetch({
      USD: [bulletin(5.1, '2026-10-16 13:05:00.000000', 'Fechamento')],
    });
    const { client } = makeClient();
    await ExchangeRateService.refresh(client, new Date('2026-10-19T15:00:00Z'));
    expect(urls.some((u) => u.includes("@moeda='CNY'"))).toBe(false);
    expect(urls.some((u) => u.includes("@moeda='USD'"))).toBe(true);
    expect(urls.some((u) => u.includes("@moeda='CHF'"))).toBe(true);
  });

  it('refresh devolve [] quando nenhuma moeda veio (cache anterior mantido)', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    installFetch({});
    const { client, upserts } = makeClient();
    const snapshots = await ExchangeRateService.refresh(client, new Date('2026-10-19T15:00:00Z'));
    expect(snapshots).toEqual([]);
    expect(upserts).toHaveLength(0);
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
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes("@moeda='USD'")) {
        return {
          ok: true,
          json: async () => ({
            value: [bulletin(5.1613, '2026-06-18 13:06:09.849819', 'Fechamento')],
          }),
        } as any;
      }
      return { ok: false, status: 500, json: async () => ({ value: [] }) } as any;
    }) as unknown as typeof fetch;
    const { client, upserts } = makeClient();
    const snapshots = await ExchangeRateService.refresh(client, new Date('2026-06-18T17:00:00Z'));
    expect(snapshots.find((s) => s.currency === 'USD')).toBeTruthy();
    expect(upserts.length).toBeGreaterThan(0);
  });
});
