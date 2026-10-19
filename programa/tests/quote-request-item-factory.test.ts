// Fabrica unica de dados do QuoteRequestItem (Novo item, criar cotacao a partir de
// solicitacao e vinculo a cotacao existente). Funcao pura: sem Prisma.
import { describe, expect, it } from 'vitest';
import { buildQuoteRequestItemCreateData } from '../src/services/QuoteRequestItemFactory';

const base = {
  quoteRequestId: 5,
  catalogItemId: 10,
  catalogCommercialName: 'Resina X',
  quantity: 100,
  unit: 'kg',
};

describe('buildQuoteRequestItemCreateData', () => {
  it('catalogo sem texto livre: productName = commercialName', () => {
    const data = buildQuoteRequestItemCreateData(base);
    expect(data.productName).toBe('Resina X');
    expect(data.catalogItemId).toBe(10);
    expect(data.quoteRequestId).toBe(5);
  });

  it('texto livre prevalece sobre o nome comercial e e aparado', () => {
    const data = buildQuoteRequestItemCreateData({ ...base, productName: '  Resina custom  ' });
    expect(data.productName).toBe('Resina custom');
  });

  it('unit e itemCode saem em maiusculas e aparados', () => {
    const data = buildQuoteRequestItemCreateData({ ...base, unit: ' kg ', itemCode: ' ab-1 ' });
    expect(data.unit).toBe('KG');
    expect(data.itemCode).toBe('AB-1');
  });

  it('destinationPort ausente herda da cotacao; informado prevalece', () => {
    expect(
      buildQuoteRequestItemCreateData({ ...base, quoteDestinationPort: 'Santos' }).destinationPort,
    ).toBe('Santos');
    expect(
      buildQuoteRequestItemCreateData({
        ...base,
        destinationPort: ' Paranagua ',
        quoteDestinationPort: 'Santos',
      }).destinationPort,
    ).toBe('Paranagua');
    expect(buildQuoteRequestItemCreateData(base).destinationPort).toBeNull();
  });

  it('targetPrice ausente vira null; informado vira Number', () => {
    expect(buildQuoteRequestItemCreateData(base).targetPrice).toBeNull();
    expect(buildQuoteRequestItemCreateData({ ...base, targetPrice: '12.5' }).targetPrice).toBe(12.5);
    expect(buildQuoteRequestItemCreateData({ ...base, targetPrice: 3 }).targetPrice).toBe(3);
  });

  it('incoterm, description, notes e PO ausentes viram null', () => {
    const data = buildQuoteRequestItemCreateData(base);
    expect(data.desiredIncoterm).toBeNull();
    expect(data.description).toBeNull();
    expect(data.notes).toBeNull();
    expect(data.purchaseOrderId).toBeNull();
  });

  it('repassa incoterm, notes, description e purchaseOrderId quando informados', () => {
    const data = buildQuoteRequestItemCreateData({
      ...base,
      desiredIncoterm: 'FOB',
      notes: ' obs ',
      description: ' desc ',
      purchaseOrderId: 7,
    });
    expect(data.desiredIncoterm).toBe('FOB');
    expect(data.notes).toBe('obs');
    expect(data.description).toBe('desc');
    expect(data.purchaseOrderId).toBe(7);
  });
});
