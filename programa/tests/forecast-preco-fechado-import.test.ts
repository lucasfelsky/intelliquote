import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ForecastProductService, type ProductDraft } from '../src/services/ForecastProductService';

// Dados SINTETICOS (repo publico). A importacao da planilha grava so o SELO (`fixedPriceFlag`, o X da coluna AV): nunca pode
// apagar nem alterar o preco cadastrado na tela (valor, moeda, incoterm e validade). `apply` grava o `desired` do plano.

const draft = (over: Partial<ProductDraft> = {}): ProductDraft => ({
  name: 'PRODUTO A',
  normalizedName: 'PRODUTO A',
  sheetOrder: 1,
  sourceKey: null,
  notes: null,
  fixedPriceFlag: true,
  packaging: null,
  noFractioning: false,
  sampleQty: null,
  sampleRequestNote: null,
  codes: [{ position: 1, code: 'C0001' }],
  ...over,
});

const cadastro = (flag: boolean) => ({
  id: 10,
  name: 'PRODUTO A',
  normalizedName: 'PRODUTO A',
  sheetOrder: 1,
  sourceId: null,
  source: null,
  notes: null,
  fixedPriceFlag: flag,
  fixedPrice: '1.8425',
  fixedPriceCurrency: 'USD',
  fixedPriceIncoterm: 'CFR',
  fixedPriceValidUntil: new Date('2026-12-31'),
  packaging: null,
  noFractioning: false,
  sampleQty: null,
  sampleRequestNote: null,
  familyId: null,
  isActive: true,
  origin: 'planilha',
  codes: [{ id: 1, productId: 10, position: 1, code: 'C0001', catalogItemId: null }],
});

const dbCom = (produtos: unknown[]): Prisma.TransactionClient =>
  ({ forecastProduct: { findMany: async () => produtos }, catalogItem: { findMany: async () => [] } }) as unknown as Prisma.TransactionClient;

describe('import da planilha x preco fechado cadastrado', () => {
  it('o plano nunca carrega as colunas do preco (nao sao gravadas pelo apply)', async () => {
    const plano = await ForecastProductService.plan(dbCom([cadastro(true)]), [draft()], new Set());
    const chaves = Object.keys(plano.items[0]!.desired);
    expect(chaves.some((k) => /fixedPrice(?!Flag)/.test(k))).toBe(false);
    expect(chaves).toContain('fixedPriceFlag');
  });

  it('selo igual ao do cadastro: nao ha alteracao', async () => {
    const plano = await ForecastProductService.plan(dbCom([cadastro(true)]), [draft()], new Set());
    expect(plano.items[0]!.change).toBe('igual');
  });

  it('o X sumir da planilha desliga o SELO (comportamento do import), mas nao toca no preco', async () => {
    const plano = await ForecastProductService.plan(dbCom([cadastro(true)]), [draft({ fixedPriceFlag: false })], new Set());
    const item = plano.items[0]!;
    expect(item.desired.fixedPriceFlag).toBe(false);
    expect(item.change).toBe('alterado');
    expect(Object.keys(item.desired).some((k) => /fixedPrice(?!Flag)/.test(k))).toBe(false);
  });
});
