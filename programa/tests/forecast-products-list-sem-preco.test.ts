import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dados SINTETICOS (repo publico). A lista do cadastro do Forecast e lida por viewer e gestor: o VALOR do preco fechado
// (ForecastProduct.fixedPrice) nunca pode sair dela; so o selo `fixedPriceFlag`.

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('../src/lib/prisma', () => ({ prisma: { forecastProduct: { findMany } } }));

import { ForecastProductService } from '../src/services/ForecastProductService';

describe('ForecastProductService.list - preco fechado', () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it('omite fixedPrice da consulta e mantem a ordem da planilha', async () => {
    await ForecastProductService.list();

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0]![0] as {
      omit?: Record<string, boolean>;
      select?: unknown;
      orderBy: unknown;
      include: Record<string, unknown>;
    };
    expect(args.omit).toEqual({ fixedPrice: true });
    expect(args.select).toBeUndefined();
    expect(args.orderBy).toEqual([{ sheetOrder: 'asc' }, { id: 'asc' }]);
    expect(Object.keys(args.include).sort()).toEqual(['codes', 'family', 'source']);
  });

  it('devolve as linhas como vieram do banco (selo mantido, sem valor)', async () => {
    findMany.mockResolvedValue([{ id: 1, name: 'PRODUTO A', fixedPriceFlag: true }]);

    const linhas = await ForecastProductService.list();

    expect(linhas).toEqual([{ id: 1, name: 'PRODUTO A', fixedPriceFlag: true }]);
    expect(linhas[0]).not.toHaveProperty('fixedPrice');
  });
});
