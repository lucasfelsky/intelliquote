import { describe, expect, it } from 'vitest';
import {
  chaveFonte,
  codigoParaCotacao,
  kgInteiroParaCima,
  statusDaCotacao,
  statusDerivadoDoItem,
  type CotacaoVinculadaData,
} from '../src/utils/forecastCotacaoVinculo';
import { paraDecisaoCompraData, paraDecisaoCompraLeitura } from '../src/utils/forecastDecisaoCompra';

// Funcoes puras do vinculo cotacao <-> Forecast (E4a): espelho das regras do front (forecastGerarCotacaoRegras.ts) e status
// derivado (T6). Tudo sintetico.

const cotacao = (statusCotacao: CotacaoVinculadaData['statusCotacao']): CotacaoVinculadaData => ({
  id: 9,
  requestCode: 'QR-20261110-ABC123',
  statusCotacao,
});

describe('kgInteiroParaCima (mesma regra do front)', () => {
  it.each([
    [1500, 1500],
    [1500.001, 1501],
    [1500.0004, 1500], // arredonda a 3 casas antes: ruido de ponto flutuante nao vira +1 kg
    [0.001, 1],
    [19.9999999, 20],
    [0.1 + 0.2, 1], // 0,30000000000000004 -> 0,3 -> 1
    [12345.678, 12346],
  ])('%s kg -> %s', (entrada, esperado) => {
    expect(kgInteiroParaCima(entrada)).toBe(esperado);
  });
});

describe('codigoParaCotacao', () => {
  const c = (code: string, position: number, catalogItemId: number | null, principal = false) => ({
    code,
    position,
    catalogItemId,
    principal,
  });

  it('usa a embalagem principal quando ela esta vinculada ao catalogo', () => {
    expect(codigoParaCotacao([c('A1', 1, 10), c('A2', 2, 11, true), c('A3', 3, 12)])?.code).toBe('A2');
  });

  it('principal SEM vinculo cai no 1o vinculado por position (ordem de entrada nao importa)', () => {
    expect(codigoParaCotacao([c('A3', 3, 12), c('A2', 2, null, true), c('A1', 1, null), c('A4', 4, 13)])?.code).toBe('A3');
  });

  it('sem principal: 1o vinculado por position', () => {
    expect(codigoParaCotacao([c('A2', 2, 11), c('A1', 1, 10)])?.code).toBe('A1');
  });

  it('nenhum vinculado (ou lista vazia) = null', () => {
    expect(codigoParaCotacao([c('A1', 1, null)])).toBeNull();
    expect(codigoParaCotacao([])).toBeNull();
  });

  it('nao muta a lista recebida', () => {
    const lista = [c('A2', 2, 11), c('A1', 1, 10)];
    codigoParaCotacao(lista);
    expect(lista.map((x) => x.code)).toEqual(['A2', 'A1']);
  });
});

describe('chaveFonte', () => {
  it('compara sem espaco nas pontas e sem diferenca de caixa', () => {
    expect(chaveFonte('  Fonte Asia ')).toBe(chaveFonte('FONTE ASIA'));
  });
});

describe('statusDaCotacao', () => {
  it.each([
    [{ status: 'open', purchaseOrderSentAt: null, enviada: false }, 'criada'],
    [{ status: 'open', purchaseOrderSentAt: null, enviada: true }, 'enviada'],
    [{ status: 'closed', purchaseOrderSentAt: null, enviada: true }, 'fechada'],
    [{ status: 'closed', purchaseOrderSentAt: new Date('2099-01-01'), enviada: true }, 'po_enviada'],
  ] as const)('%j -> %s', (entrada, esperado) => {
    expect(statusDaCotacao({ ...entrada })).toBe(esperado);
  });
});

describe('statusDerivadoDoItem (T6)', () => {
  it('sem cotacao vinculada vale o status salvo: itens antigos nao mudam', () => {
    for (const salvo of ['nao', 'cotando', 'preco', 'confirmado', 'po'] as const) {
      expect(statusDerivadoDoItem(salvo, null)).toBe(salvo);
    }
  });

  it('cotacao criada e ainda nao enviada = cotacao_criada', () => {
    expect(statusDerivadoDoItem('nao', cotacao('criada'))).toBe('cotacao_criada');
  });

  it('cotacao enviada = cotando, mas nunca regride preco/confirmado/po', () => {
    expect(statusDerivadoDoItem('nao', cotacao('enviada'))).toBe('cotando');
    expect(statusDerivadoDoItem('cotando', cotacao('enviada'))).toBe('cotando');
    expect(statusDerivadoDoItem('preco', cotacao('enviada'))).toBe('preco');
    expect(statusDerivadoDoItem('confirmado', cotacao('enviada'))).toBe('confirmado');
    expect(statusDerivadoDoItem('po', cotacao('enviada'))).toBe('po');
  });

  it('cotacao fechada ou com PO enviada mantem o status salvo (quem avanca e a E4b)', () => {
    expect(statusDerivadoDoItem('cotando', cotacao('fechada'))).toBe('cotando');
    expect(statusDerivadoDoItem('po', cotacao('po_enviada'))).toBe('po');
  });
});

describe('paraDecisaoCompraLeitura (aditivo)', () => {
  const linha = {
    productId: 42,
    quantityKg: '1500.500000',
    status: 'nao',
    note: null,
    suggestedKg: '1400',
    demandKg: '-900',
    decidedById: 3,
    createdAt: new Date('2099-01-01T12:00:00.000Z'),
    updatedAt: new Date('2099-01-02T12:00:00.000Z'),
  };

  it('a base nao muda (PUT e XLSX seguem iguais) e os campos novos nascem vazios', () => {
    const leitura = paraDecisaoCompraLeitura(linha, null);
    const { cotacao: c, finalKg, finalAt, statusDerivado, ...base } = leitura;
    expect(base).toEqual(paraDecisaoCompraData(linha));
    expect(c).toBeNull();
    expect(finalKg).toBeNull();
    expect(finalAt).toBeNull();
    expect(statusDerivado).toBe('nao');
  });

  it('traz cotacao, Qtd. final e status derivado', () => {
    const leitura = paraDecisaoCompraLeitura(
      { ...linha, finalKg: '1501.000000', finalAt: new Date('2099-01-03T08:00:00.000Z') },
      cotacao('enviada'),
    );
    expect(leitura).toMatchObject({
      cotacao: { id: 9, requestCode: 'QR-20261110-ABC123', statusCotacao: 'enviada' },
      finalKg: 1501,
      finalAt: '2099-01-03T08:00:00.000Z',
      statusDerivado: 'cotando',
      quantidadeKg: 1500.5,
    });
  });
});
