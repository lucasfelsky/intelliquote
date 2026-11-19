import { describe, expect, it } from 'vitest';
import {
  avancarStatus,
  decidirVinculo,
  decisaoAoEntrarNaCotacao,
  decisaoAoSairDaCotacao,
  ehKg,
  MOTIVO_NAO_KG,
  ordemDoStatus,
  quantidadeFinalNoFechamento,
  chaveFonte,
  codigoParaCotacao,
  kgInteiroParaCima,
  statusDaCotacao,
  statusDerivadoDoItem,
  type CotacaoVinculadaData,
  type EntradaDecidirVinculo,
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

  it('cotacao fechada = confirmado, sem regredir po/preco', () => {
    expect(statusDerivadoDoItem('nao', cotacao('fechada'))).toBe('confirmado');
    expect(statusDerivadoDoItem('cotando', cotacao('fechada'))).toBe('confirmado');
    expect(statusDerivadoDoItem('confirmado', cotacao('fechada'))).toBe('confirmado');
    expect(statusDerivadoDoItem('po', cotacao('fechada'))).toBe('po');
    expect(statusDerivadoDoItem('preco', cotacao('fechada'))).toBe('preco');
  });

  it('cotacao com PO enviada = po, sem regredir preco', () => {
    expect(statusDerivadoDoItem('nao', cotacao('po_enviada'))).toBe('po');
    expect(statusDerivadoDoItem('cotando', cotacao('po_enviada'))).toBe('po');
    expect(statusDerivadoDoItem('confirmado', cotacao('po_enviada'))).toBe('po');
    expect(statusDerivadoDoItem('po', cotacao('po_enviada'))).toBe('po');
    expect(statusDerivadoDoItem('preco', cotacao('po_enviada'))).toBe('preco');
  });

  it('sem cotacao vinculada vale o status salvo', () => {
    for (const s of ['nao', 'cotando', 'confirmado', 'po', 'preco'] as const) {
      expect(statusDerivadoDoItem(s, null)).toBe(s);
    }
  });
});

describe('avancarStatus (ganchos nunca regridem)', () => {
  it('avanca ate o alvo e nunca volta', () => {
    expect(avancarStatus('nao', 'confirmado')).toBe('confirmado');
    expect(avancarStatus('cotando', 'confirmado')).toBe('confirmado');
    expect(avancarStatus('confirmado', 'confirmado')).toBe('confirmado');
    expect(avancarStatus('po', 'confirmado')).toBe('po');
    expect(avancarStatus('preco', 'po')).toBe('preco');
    expect(avancarStatus('confirmado', 'po')).toBe('po');
  });
});

describe('quantidadeFinalNoFechamento (E4b)', () => {
  it('usa a quantidade da resposta vencedora do item', () => {
    expect(quantidadeFinalNoFechamento(1000, [800])).toEqual({ kg: 800, origem: 'vencedora' });
  });
  it('sem vencedor para o item mantem a quantidade cotada', () => {
    expect(quantidadeFinalNoFechamento(1000, [])).toEqual({ kg: 1000, origem: 'cotada' });
  });
  it('ignora quantidades nao positivas (item indisponivel grava 0)', () => {
    expect(quantidadeFinalNoFechamento(1000, [0])).toEqual({ kg: 1000, origem: 'cotada' });
    expect(quantidadeFinalNoFechamento(1000, [0, 300])).toEqual({ kg: 300, origem: 'vencedora' });
  });
  it('soma as vencedoras do item (defensivo: o normal e uma so)', () => {
    expect(quantidadeFinalNoFechamento(1000, [300, 200])).toEqual({ kg: 500, origem: 'vencedora' });
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

describe('nenhum outro fluxo regride o status (so desvincular/trocar, em decisaoAoSairDaCotacao)', () => {
  const todos = ['nao', 'cotando', 'confirmado', 'po', 'preco'] as const;

  it('avancarStatus nunca devolve um status abaixo do atual, para todos os pares (atual, alvo)', () => {
    for (const a of todos) {
      for (const b of todos) {
        expect(ordemDoStatus(avancarStatus(a, b))).toBeGreaterThanOrEqual(ordemDoStatus(a));
      }
    }
  });

  it('decisaoAoEntrarNaCotacao tambem nunca regride, para todos os status', () => {
    const agora = new Date('2026-11-18T12:00:00Z');
    for (const status of todos) {
      const patch = decisaoAoEntrarNaCotacao(
        { status, finalKg: null, finalAt: null, finalQuoteRequestId: null },
        { quoteRequestId: 9, enviada: true, quantidadeCotada: 100 },
        agora,
      );
      expect(ordemDoStatus(patch.status ?? status)).toBeGreaterThanOrEqual(ordemDoStatus(status));
    }
  });
});

describe('ehKg / MOTIVO_NAO_KG (D5)', () => {
  it.each([
    ['KG', true],
    ['kg', true],
    [' Kg ', true],
    ['UN', false],
    ['TON', false],
    ['', false],
  ])('ehKg(%j) = %s', (unit, esperado) => {
    expect(ehKg(unit)).toBe(esperado);
  });

  it('o motivo cita a unidade do item', () => {
    expect(MOTIVO_NAO_KG('UN')).toBe('O item está em UN; só itens em KG entram no Forecast.');
  });
});

describe('decidirVinculo (PR2)', () => {
  const base = (over: Partial<EntradaDecidirVinculo> = {}): EntradaDecidirVinculo => ({
    snapshotId: 7,
    productId: 42,
    quoteRequestId: 90,
    requestCode: 'QR-X',
    cotacaoAberta: true,
    itensDoProduto: [{ id: 1, unit: 'KG', quantity: 1000, vinculo: null }],
    outraAbertaLigada: null,
    substituir: false,
    ...over,
  });

  it('cotacao fechada = 409', () => {
    expect(decidirVinculo(base({ cotacaoAberta: false }))).toEqual({
      tipo: 'erro',
      status: 409,
      motivo: 'A cotação QR-X está fechada.',
    });
  });

  it('cotacao sem o item do produto = 400', () => {
    expect(decidirVinculo(base({ itensDoProduto: [] }))).toEqual({
      tipo: 'erro',
      status: 400,
      motivo: 'A cotação QR-X não tem o item.',
    });
  });

  it('so itens em UN = 400 com o motivo da unidade', () => {
    const r = decidirVinculo(base({ itensDoProduto: [{ id: 1, unit: 'UN', quantity: 5, vinculo: null }] }));
    expect(r).toEqual({ tipo: 'erro', status: 400, motivo: MOTIVO_NAO_KG('UN') });
  });

  it('item ligado a OUTRO produto da MESMA quinzena = 409', () => {
    const r = decidirVinculo(
      base({ itensDoProduto: [{ id: 1, unit: 'KG', quantity: 10, vinculo: { snapshotId: 7, productId: 43 } }] }),
    );
    expect(r).toEqual({
      tipo: 'erro',
      status: 409,
      motivo: 'Um item da cotação já está ligado a outro produto desta quinzena.',
    });
  });

  it('tudo ja ligado a este item = nenhuma (idempotente), mesmo com outra aberta ligada', () => {
    const itensDoProduto = [{ id: 1, unit: 'KG', quantity: 10, vinculo: { snapshotId: 7, productId: 42 } }];
    expect(decidirVinculo(base({ itensDoProduto }))).toEqual({ tipo: 'nenhuma' });
    expect(decidirVinculo(base({ itensDoProduto, outraAbertaLigada: { id: 80, requestCode: 'QR-Y' } }))).toEqual({ tipo: 'nenhuma' });
  });

  it('outra cotacao aberta ligada sem substituir = 409 "Use Trocar"', () => {
    expect(decidirVinculo(base({ outraAbertaLigada: { id: 80, requestCode: 'QR-Y' } }))).toEqual({
      tipo: 'erro',
      status: 409,
      motivo: 'O item já está na cotação aberta QR-Y. Use Trocar.',
    });
  });

  it('outra cotacao aberta ligada com substituir = trocar', () => {
    expect(decidirVinculo(base({ outraAbertaLigada: { id: 80, requestCode: 'QR-Y' }, substituir: true }))).toEqual({
      tipo: 'trocar',
      ligar: [1],
      mover: [],
      quantidadeCotada: 1000,
    });
  });

  it('caso simples = vincular', () => {
    expect(decidirVinculo(base())).toEqual({ tipo: 'vincular', ligar: [1], mover: [], quantidadeCotada: 1000 });
  });

  it('item ligado a OUTRA quinzena entra em `mover` e tambem em `ligar` (D1)', () => {
    const r = decidirVinculo(
      base({ itensDoProduto: [{ id: 1, unit: 'KG', quantity: 10, vinculo: { snapshotId: 6, productId: 42 } }] }),
    );
    expect(r).toEqual({
      tipo: 'vincular',
      ligar: [1],
      mover: [{ itemId: 1, de: { snapshotId: 6, productId: 42 } }],
      quantidadeCotada: 10,
    });
  });

  it('soma as embalagens em KG e ignora o item em UN', () => {
    const r = decidirVinculo(
      base({
        itensDoProduto: [
          { id: 1, unit: 'KG', quantity: 600, vinculo: null },
          { id: 2, unit: 'kg', quantity: 400, vinculo: null },
          { id: 3, unit: 'UN', quantity: 9, vinculo: null },
        ],
      }),
    );
    expect(r).toEqual({ tipo: 'vincular', ligar: [1, 2], mover: [], quantidadeCotada: 1000 });
  });

  it('ja ligado + solto: so liga o que falta, mas a quantidade soma todos os KG', () => {
    const r = decidirVinculo(
      base({
        itensDoProduto: [
          { id: 1, unit: 'KG', quantity: 600, vinculo: { snapshotId: 7, productId: 42 } },
          { id: 2, unit: 'KG', quantity: 400, vinculo: null },
        ],
      }),
    );
    expect(r).toEqual({ tipo: 'vincular', ligar: [2], mover: [], quantidadeCotada: 1000 });
  });

  it('soma acima do limite do banco = 400', () => {
    const r = decidirVinculo(
      base({
        itensDoProduto: [
          { id: 1, unit: 'KG', quantity: 2147483647, vinculo: null },
          { id: 2, unit: 'KG', quantity: 1, vinculo: null },
        ],
      }),
    );
    expect(r).toEqual({ tipo: 'erro', status: 400, motivo: 'Quantidade acima do limite da cotação.' });
  });
});

describe('decisaoAoSairDaCotacao (D2: unica excecao a "nunca regride")', () => {
  it('REGRESSO: cotando + Qtd. final da cotacao solta + sem outra ativa = volta a "nao" e zera a Qtd. final', () => {
    expect(decisaoAoSairDaCotacao({ status: 'cotando', finalQuoteRequestId: 9 }, 9, false)).toEqual({
      status: 'nao',
      zerarFinal: true,
    });
  });

  it('com outra cotacao ativa o status e mantido (a Qtd. final da solta ainda e zerada)', () => {
    expect(decisaoAoSairDaCotacao({ status: 'cotando', finalQuoteRequestId: 9 }, 9, true)).toEqual({
      status: 'cotando',
      zerarFinal: true,
    });
  });

  it.each(['confirmado', 'po', 'preco'] as const)('%s nunca regride', (status) => {
    expect(decisaoAoSairDaCotacao({ status, finalQuoteRequestId: 9 }, 9, false).status).toBe(status);
  });

  it('Qtd. final de OUTRA cotacao (ou nenhuma) nao e zerada', () => {
    expect(decisaoAoSairDaCotacao({ status: 'cotando', finalQuoteRequestId: 5 }, 9, false)).toEqual({
      status: 'nao',
      zerarFinal: false,
    });
    expect(decisaoAoSairDaCotacao({ status: 'nao', finalQuoteRequestId: null }, 9, false)).toEqual({
      status: 'nao',
      zerarFinal: false,
    });
  });
});

describe('decisaoAoEntrarNaCotacao (D4)', () => {
  const agora = new Date('2026-11-18T12:00:00Z');
  const antes = new Date('2026-11-10T12:00:00Z');
  const decisao = (over = {}) => ({
    status: 'nao' as const,
    finalKg: null,
    finalAt: null,
    finalQuoteRequestId: null,
    ...over,
  });

  it('cotacao nao enviada = nada a gravar', () => {
    expect(decisaoAoEntrarNaCotacao(decisao(), { quoteRequestId: 9, enviada: false, quantidadeCotada: 100 }, agora)).toEqual({
      camposAlterados: [],
    });
  });

  it('enviada: Qtd. final = cotada, finalAt agora e nao -> cotando', () => {
    expect(decisaoAoEntrarNaCotacao(decisao(), { quoteRequestId: 9, enviada: true, quantidadeCotada: 100 }, agora)).toEqual({
      finalKg: 100,
      finalAt: agora,
      finalQuoteRequestId: 9,
      status: 'cotando',
      camposAlterados: ['finalKg', 'finalAt', 'finalQuoteRequestId', 'status'],
    });
  });

  it('po (e os demais) nao regride', () => {
    const patch = decisaoAoEntrarNaCotacao(decisao({ status: 'po' }), { quoteRequestId: 9, enviada: true, quantidadeCotada: 100 }, agora);
    expect(patch.status).toBe('po');
    expect(patch.camposAlterados).not.toContain('status');
  });

  it('mesma cotacao ja gravada com a mesma quantidade = sem mudanca; quantidade diferente mantem finalAt', () => {
    const ja = decisao({ status: 'cotando', finalKg: 100, finalAt: antes, finalQuoteRequestId: 9 });
    expect(decisaoAoEntrarNaCotacao(ja, { quoteRequestId: 9, enviada: true, quantidadeCotada: 100 }, agora).camposAlterados).toEqual([]);
    const outra = decisaoAoEntrarNaCotacao(ja, { quoteRequestId: 9, enviada: true, quantidadeCotada: 120 }, agora);
    expect(outra.finalAt).toBe(antes);
    expect(outra.camposAlterados).toEqual(['finalKg', 'finalQuoteRequestId']);
  });
});
