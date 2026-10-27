import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  escolherUltimoPreco,
  type UltimoPrecoCandidata,
  type UltimoPrecoCodigo,
} from '../src/services/ForecastUltimoPrecoService';

// Dados 100% sinteticos (repo publico).
interface Opcoes {
  id?: number;
  preco?: string;
  quoteId?: number;
  status?: 'open' | 'closed';
  closedAt?: Date | null;
  poEm?: Date | null;
  catalogItemId?: number;
  fornecedor?: string;
}

const candidata = (o: Opcoes = {}): UltimoPrecoCandidata => ({
  id: o.id ?? 1,
  unitPrice: new Prisma.Decimal(o.preco ?? '10'),
  quoteRequestItem: { id: 50, unit: 'KG', catalogItemId: o.catalogItemId ?? 77 },
  quoteResponse: {
    id: 9,
    currency: 'USD',
    offeredIncoterm: 'FOB',
    supplier: { name: o.fornecedor ?? 'FORNECEDOR SINTETICO 1' },
    quoteRequest: {
      id: o.quoteId ?? 900,
      requestCode: `QR-SINT-${o.quoteId ?? 900}`,
      status: o.status ?? 'closed',
      closedAt: o.closedAt === undefined ? new Date('2031-03-10T15:00:00.000Z') : o.closedAt,
      purchaseOrderSentAt: o.poEm ?? null,
    },
  },
});

const d = (iso: string) => new Date(iso);

describe('escolherUltimoPreco - ordenacao', () => {
  it('lista vazia -> null', () => {
    expect(escolherUltimoPreco([])).toBeNull();
  });

  it('fechada mais recente vence uma fechada antiga (em qualquer ordem de entrada)', () => {
    const antiga = candidata({ id: 1, quoteId: 901, preco: '5', closedAt: d('2031-01-10T15:00:00.000Z') });
    const nova = candidata({ id: 2, quoteId: 902, preco: '7', closedAt: d('2031-03-10T15:00:00.000Z') });
    expect(escolherUltimoPreco([antiga, nova])?.cotacao.id).toBe(902);
    expect(escolherUltimoPreco([nova, antiga])?.cotacao.id).toBe(902);
  });

  it('PO enviada (cotacao aberta) mais recente vence fechada antiga', () => {
    const fechada = candidata({ quoteId: 901, closedAt: d('2031-01-10T15:00:00.000Z') });
    const comPo = candidata({
      id: 2,
      quoteId: 902,
      status: 'open',
      closedAt: null,
      poEm: d('2031-03-12T15:00:00.000Z'),
    });
    const r = escolherUltimoPreco([fechada, comPo]);
    expect(r?.cotacao.id).toBe(902);
    expect(r?.fechadaEm).toBeNull();
    expect(r?.poEnviadaEm).toBe('2031-03-12');
  });

  it('a data de referencia da fechada e closedAt, mesmo com PO posterior', () => {
    const fechadaComPoTardia = candidata({
      quoteId: 901,
      closedAt: d('2031-01-10T15:00:00.000Z'),
      poEm: d('2031-06-01T15:00:00.000Z'),
    });
    const intermediaria = candidata({ id: 2, quoteId: 902, closedAt: d('2031-03-10T15:00:00.000Z') });
    expect(escolherUltimoPreco([fechadaComPoTardia, intermediaria])?.cotacao.id).toBe(902);
  });

  it('empate de data: maior id de cotacao; mesma cotacao: maior id do item de resposta', () => {
    const mesmaData = d('2031-03-10T15:00:00.000Z');
    const q1 = candidata({ id: 5, quoteId: 901, closedAt: mesmaData });
    const q2 = candidata({ id: 3, quoteId: 902, closedAt: mesmaData });
    expect(escolherUltimoPreco([q1, q2])?.cotacao.id).toBe(902);
    const i1 = candidata({ id: 10, quoteId: 903, preco: '1', closedAt: mesmaData });
    const i2 = candidata({ id: 11, quoteId: 903, preco: '2', closedAt: mesmaData });
    expect(escolherUltimoPreco([i1, i2])?.valorUnitario).toBe('2.00');
    expect(escolherUltimoPreco([i2, i1])?.valorUnitario).toBe('2.00');
  });

  it('candidata sem data (fechada legada sem closedAt e sem PO) fica por ultimo', () => {
    const semData = candidata({ id: 99, quoteId: 999, closedAt: null });
    const comData = candidata({ id: 1, quoteId: 901, closedAt: d('2031-01-10T15:00:00.000Z') });
    expect(escolherUltimoPreco([semData, comData])?.cotacao.id).toBe(901);
    expect(escolherUltimoPreco([comData, semData])?.cotacao.id).toBe(901);
    // So ela: ainda e escolhida, sem datas.
    const so = escolherUltimoPreco([semData]);
    expect(so?.cotacao.id).toBe(999);
    expect(so?.fechadaEm).toBeNull();
    expect(so?.poEnviadaEm).toBeNull();
  });

  it('nao muta a lista recebida', () => {
    const a = candidata({ id: 1, quoteId: 901, closedAt: d('2031-01-10T15:00:00.000Z') });
    const b = candidata({ id: 2, quoteId: 902, closedAt: d('2031-03-10T15:00:00.000Z') });
    const lista = [a, b];
    escolherUltimoPreco(lista);
    expect(lista).toEqual([a, b]);
  });
});

describe('escolherUltimoPreco - montagem da saida', () => {
  it('valorUnitario com 2 casas a partir do Decimal', () => {
    expect(escolherUltimoPreco([candidata({ preco: '12.3' })])?.valorUnitario).toBe('12.30');
    expect(escolherUltimoPreco([candidata({ preco: '12.345' })])?.valorUnitario).toBe('12.35');
  });

  it('datas no calendario de Sao Paulo (nunca UTC)', () => {
    const r = escolherUltimoPreco([candidata({ closedAt: d('2031-03-11T01:30:00.000Z') })]);
    expect(r?.fechadaEm).toBe('2031-03-10');
    const po = escolherUltimoPreco([
      candidata({ status: 'open', closedAt: null, poEm: d('2031-03-13T02:59:00.000Z') }),
    ]);
    expect(po?.poEnviadaEm).toBe('2031-03-12');
  });

  it('fechadaEm nulo quando a cotacao esta aberta (mesmo com closedAt gravado)', () => {
    const r = escolherUltimoPreco([
      candidata({ status: 'open', closedAt: d('2031-03-10T15:00:00.000Z'), poEm: d('2031-03-12T15:00:00.000Z') }),
    ]);
    expect(r?.fechadaEm).toBeNull();
    expect(r?.poEnviadaEm).toBe('2031-03-12');
  });

  it('campos da proposta e codigos do catalogItem vencedor em ordem de posicao', () => {
    const codigos: UltimoPrecoCodigo[] = [
      { code: 'TST0003', position: 3, catalogItemId: 77 },
      { code: 'TST0001', position: 1, catalogItemId: 77 },
      { code: 'TST0002', position: 2, catalogItemId: 88 },
      { code: 'TST0004', position: 4, catalogItemId: null },
    ];
    expect(escolherUltimoPreco([candidata({ quoteId: 901 })], codigos)).toEqual({
      valorUnitario: '10.00',
      moeda: 'USD',
      unidade: 'KG',
      incoterm: 'FOB',
      fornecedor: 'FORNECEDOR SINTETICO 1',
      cotacao: { id: 901, codigo: 'QR-SINT-901' },
      fechadaEm: '2031-03-10',
      poEnviadaEm: null,
      catalogItemId: 77,
      codigos: ['TST0001', 'TST0003'],
    });
  });

  it('com 2 catalogItems, os codigos sao so os do catalogItem da vencedora', () => {
    const codigos: UltimoPrecoCodigo[] = [
      { code: 'TST0001', position: 1, catalogItemId: 77 },
      { code: 'TST0002', position: 2, catalogItemId: 88 },
    ];
    const velha = candidata({ id: 1, quoteId: 901, catalogItemId: 77, closedAt: d('2031-01-10T15:00:00.000Z') });
    const nova = candidata({ id: 2, quoteId: 902, catalogItemId: 88, closedAt: d('2031-03-10T15:00:00.000Z') });
    const r = escolherUltimoPreco([velha, nova], codigos);
    expect(r?.catalogItemId).toBe(88);
    expect(r?.codigos).toEqual(['TST0002']);
  });

  it('a saida nao carrega contato nem e-mail do fornecedor', () => {
    const texto = JSON.stringify(escolherUltimoPreco([candidata()]));
    expect(texto).not.toMatch(/email|contact|notes|targetPrice|landed/i);
  });
});
