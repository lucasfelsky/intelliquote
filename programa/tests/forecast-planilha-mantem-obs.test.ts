import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ForecastProductService, type ProductDraft } from '../src/services/ForecastProductService';

// Dados SINTETICOS (repo publico). A importacao da planilha nao pode apagar a observacao do cadastro quando a coluna AT vem vazia.

function draft(over: Partial<ProductDraft> = {}): ProductDraft {
  return {
    name: 'PRODUTO A',
    normalizedName: 'PRODUTO A',
    sheetOrder: 1,
    sourceKey: null,
    notes: null,
    fixedPriceFlag: false,
    packaging: null,
    noFractioning: false,
    sampleQty: null,
    sampleRequestNote: null,
    codes: [{ position: 1, code: 'C0001' }],
    ...over,
  };
}

function cadastro(notes: string | null) {
  return {
    id: 10,
    name: 'PRODUTO A',
    normalizedName: 'PRODUTO A',
    sheetOrder: 1,
    sourceId: null,
    source: null,
    notes,
    fixedPriceFlag: false,
    fixedPrice: null,
    packaging: null,
    noFractioning: false,
    sampleQty: null,
    sampleRequestNote: null,
    familyId: null,
    isActive: true,
    origin: 'planilha',
    codes: [{ id: 1, productId: 10, position: 1, code: 'C0001', catalogItemId: null }],
  };
}

function dbCom(produtos: unknown[]): Prisma.TransactionClient {
  return {
    forecastProduct: { findMany: async () => produtos },
    catalogItem: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;
}

describe('ForecastProductService.plan - observacao (AT)', () => {
  it('AT vazia mantem a observacao do cadastro e nao conta como alteracao', async () => {
    const plano = await ForecastProductService.plan(dbCom([cadastro('AGUARDAR CONTRATO')]), [draft({ notes: null })], new Set());
    const item = plano.items[0]!;
    expect(item.desired.notes).toBe('AGUARDAR CONTRATO');
    expect(item.fieldsChanged).toBe(false);
    expect(item.change).toBe('igual');
  });

  it('AT preenchida manda sobre a do cadastro', async () => {
    const plano = await ForecastProductService.plan(dbCom([cadastro('ANTIGA')]), [draft({ notes: 'NOVA' })], new Set());
    const item = plano.items[0]!;
    expect(item.desired.notes).toBe('NOVA');
    expect(item.change).toBe('alterado');
  });

  it('produto novo com AT vazia fica sem observacao', async () => {
    const plano = await ForecastProductService.plan(dbCom([]), [draft({ notes: null })], new Set());
    expect(plano.items[0]!.desired.notes).toBeNull();
    expect(plano.items[0]!.change).toBe('novo');
  });

  it('cadastro sem observacao e AT vazia seguem sem observacao', async () => {
    const plano = await ForecastProductService.plan(dbCom([cadastro(null)]), [draft({ notes: null })], new Set());
    expect(plano.items[0]!.desired.notes).toBeNull();
    expect(plano.items[0]!.change).toBe('igual');
  });
});
