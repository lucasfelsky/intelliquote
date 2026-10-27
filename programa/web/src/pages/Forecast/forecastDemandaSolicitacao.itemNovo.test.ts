import { describe, expect, it } from 'vitest';
import {
  casarItem,
  indexarProdutosPorCatalogo,
  type ProdutoComCatalogo,
  type SolicitacaoParaDemanda,
} from './forecastDemandaSolicitacao';

// Dados 100% sinteticos.
const PRODUTOS: ProdutoComCatalogo[] = [
  { id: 5, name: 'PRODUTO 001', isActive: true, codes: [{ code: 'C0001', catalogItemId: 101 }] },
];

describe('casarItem - item novo (solicitacao de desenvolvimento sem catalogo)', () => {
  it('catalogItemId null cai em sem-produto, sem produto casado', () => {
    const indice = indexarProdutosPorCatalogo(PRODUTOS);
    const item: SolicitacaoParaDemanda['items'][number] = {
      id: 1,
      catalogItemId: null,
      commercialName: 'ITEM NOVO 001',
      quantity: 10,
      unit: 'KG',
    };

    const casado = casarItem(item, indice);

    expect(casado.catalogItemId).toBeNull();
    expect(casado.produto).toBeNull();
    expect(casado.bloqueio?.motivo).toBe('sem-produto');
  });

  it('item com catalogo continua casando normalmente', () => {
    const indice = indexarProdutosPorCatalogo(PRODUTOS);
    const casado = casarItem(
      { id: 2, catalogItemId: 101, commercialName: 'ITEM CATALOGO 101', quantity: 10, unit: 'KG' },
      indice,
    );

    expect(casado.produto).toMatchObject({ id: 5 });
    expect(casado.bloqueio).toBeNull();
  });
});
